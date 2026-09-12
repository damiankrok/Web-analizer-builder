# STAGE WEB-PIVOT-01 — wall-local compiler proof

Development-only vertical slice. It proves one claim and nothing more: **a wall
described in its own coordinates compiles to a correctly cut solid, and keeps
doing so when the wall is recessed relative to the building around it.**

It is not a migration. No production module was modified; the shipped web bundle
is byte-identical to the one built before this stage.

---

## 0. Source documents

`ROOT_CAUSE_MATRIX.md` and `FULL_ANALYZER_TECHNICAL_AUDIT.md` are **not present
in this repository** — not at the audit snapshot, not at HEAD, and not on any
branch (`main`, `claude/new-session-pvd4ik`). RC03 and experiments E3/E4 were
therefore taken from the counterexample stated in the stage prompt and verified
against the actual code rather than read from those files. Everything below is a
measurement of this repository, not a restatement of an audit.

The audit snapshot `a7b2968194c2cc34851a6cc47198e5b1b00e8677` **did** match the
actual HEAD of `claude/new-session-pvd4ik` when this stage began.

## 1. RC03 reproduced

`src/core/hypotheses/solid.ts` resolves an opening's position through the whole
building's bounding box:

```ts
const bounds = boundsOf(h.masses.flatMap((m) => m.footprint.outer))   // :437
...
const frame = facadeFrame(g.facade, bounds)                           // :480
const a = facadePlanPoint(frame, g.s)
const distA = Math.abs((a.x - pA.x) * nrm.x + (a.z - pA.z) * nrm.z)
if (distA > 0.6) continue                                             // :490
```

The audit's massing — lower mass `x 0..8, z 0..10, y 0..3`; upper mass
`x 0..8, z 0..9, y 3..6`; a 2.0 × 1.5 m opening on the upper FRONT wall —
measured against that code:

| upper front wall | recess | openings | glazing tris | reveal tris |
| --- | --- | --- | --- | --- |
| `z = 9` (as designed) | 1.0 m | **0** | **0** | **0** |
| `z = 9.3` | 0.7 m | 0 | 0 | 0 |
| `z = 9.4` | 0.6 m | 1 | 2 | 8 |
| `z = 10` (flush) | 0.0 m | 1 | 2 | 8 |

Three findings, all retained as tests in `tests/wall-compiler.test.ts`:

1. **The opening is dropped in silence.** No diagnostic, no warning, no note —
   `continue`. Downstream the wall simply has no window.
2. **It is a cliff on the 0.6 m constant, not a gradient.** Raising the constant
   moves the cliff; it does not make the attachment correct.
3. **The along-facade coordinate is measured from the global box too.** With the
   host wall's start moved 2 m (upper mass `minX = 0` → `2`, opening record and
   wall length otherwise untouched), the emitted opening moves **1.84 m along
   its own wall**. So widening the tolerance would not repair the counterexample;
   it would make openings reappear in the wrong place instead of not at all.

A fourth finding, outside RC03 and recorded as follow-up rather than fixed here:
even in the flush case that "works", the emitted cut is splayed. The inner ring
is inset in both axes, so it is parametrised over a shorter edge than the outer
ring. For a 2.0 m opening in a 0.45 m wall the inner face hole measures 1.80 m
against the outer face's 2.000 m, the glazing comes out 1.910 m wide, and
`quantities.glazingAreaM2` reports 3.000 m² because it is computed from the
input record and never looks at the triangles. This is exactly why acceptance
check 3 below is required to read emitted geometry.

## 2. What was added

| File | Role |
| --- | --- |
| `src/core/wallspec/contracts.ts` | `WallSpec`, `OpeningSpec`, `GlazingSpec`, `CompileResult`, diagnostics, `wallFrame`, `wallPoint` |
| `src/core/wallspec/compile.ts` | `compileWalls` — validation and mesh generation |
| `src/core/wallspec/fixtures.ts` | the audit panel and its four placements |
| `tests/geometry-oracles.ts` | volume, manifold and ray oracles — no import from `src/core/wallspec/` |
| `tests/wall-compiler.test.ts` | RC03 diagnostic + acceptance checks 1–7 |
| `scripts/wall-compiler-diagnostic.ts` | console report and renders of the emitted triangles |

Nothing in `src/` outside `src/core/wallspec/` imports any of it. `git diff`
against the previous commit shows **no modified tracked file**.

## 3. Origin and axis semantics

A `WallSpec` carries a right-handed orthonormal triad:

- `u` runs along the wall's length, from the origin towards `lengthM`;
- `up` runs along its height, from the origin towards `heightM`;
- `n = u × up` is the **outward** normal.

Only `u` and `up` are stored; `wallFrame()` derives `n`. Storing the third axis
would create a second place for it to be wrong. `compileWalls` refuses any wall
whose stored axes are not unit length and perpendicular to 1e-9, which is
exactly the condition for the derived triad to be orthonormal.

`origin` is the corner at **`u = 0`, wall base, on the OUTER face**. Material
occupies

```
origin + u·a + up·b − n·c     a ∈ [0, lengthM], b ∈ [0, heightM], c ∈ [0, thicknessM]
```

so thickness runs *inward*, against the outward normal, and the inner face is at
`c = thicknessM`. The outer face is the referenced plane because that is the
face an elevation drawing dimensions; a compiler that quietly treats the same
number as a centre plane puts every wall half a thickness out.

An `OpeningSpec` states `offsetM` (along `u`) and `sillM` (along `up`) in its
host wall's frame and nowhere else. There is no facade, no building and no
bounding box in the record. `GlazingSpec.insetM` is the distance from the outer
face to the glazing plane, along `−n`.

### Why it is watertight

The wall is a box minus rectangular through-holes. Its boundary is tiled on one
grid: breaks along the length at `{0, every opening edge, length}`, along the
height at `{0, every opening edge, height}`. Outer and inner faces are tiled
cell by cell, skipping cells inside a hole; **the two ends are split on the same
height breaks and the top and bottom on the same length breaks**; each hole
contributes four reveal faces spanning exactly one cell.

Splitting the ends, top and bottom on that same grid is what makes the result a
manifold rather than merely watertight-looking. Left as single rectangles they
would meet the face beside them in T-junctions, which no closed-surface oracle
accepts and which leave hairline cracks under any interpolating renderer.

Every vertex is computed by `wallPoint` from its local `(a, b, c)`, so two faces
sharing an edge produce bit-identical doubles — which is what lets the manifold
oracle compare vertices **exactly** instead of within a tolerance.

## 4. Independent oracles

`tests/geometry-oracles.ts` reads emitted triangles and shares no code path with
the compiler. The compiler tiles a grid; it never computes a volume, a
shared-edge count or a ray intersection.

- **`meshVolume`** — divergence theorem, `Σ a·(b×c)/6`. Measures orientation as
  well as size: a mesh wound inside out returns the negative of its volume.
- **`manifoldReport`** — directed-edge pairing. Every edge of a closed,
  consistently oriented mesh is traversed once as `p→q` and once as `q→p`. A
  hole or a T-junction leaves an unpaired edge; a face wound the wrong way
  leaves a duplicate.
- **`rayHits`** / **`surfaceCrossings`** — Möller–Trumbore, both facings counted,
  hits at the same distance collapsed to one surface.

## 5. Legacy result versus new result

Same wall, same opening, same two placements:

| | recessed (`z = 9`) | flush (`z = 10`) |
| --- | --- | --- |
| **production compiler** | 0 openings, 0 glazing tris, 0 reveal tris | 1 opening, 2 glazing tris, 8 reveal tris |
| **wall-local compiler** | 66 tris (64 solid, 2 glazing), closed, 9.450000000 m³ | 66 tris (64 solid, 2 glazing), closed, 9.450000000 m³ |

The two wall-local results are identical in wall-local coordinates, vertex for
vertex — not close, identical — and differ only by the world transform.

## 6. Measured volume

```
expected  (8·3 − 2·1.5) · 0.45 = 9.450000000 m³
measured                         9.450000000 m³   (recessed, flush, and after a rigid motion)
```

The test asserts to 9 decimal places (1 nm³). The oracle sums ~100 triple
products of coordinates of order 10², so accumulated rounding is around 1e-13;
the assertion sits six orders of magnitude above that and far below any
modelling error worth reporting, so a failure means a real geometric fault.

Local-coordinate comparisons across the rigid motion are rounded to **1 nm**: a
rotation and its inverse do not compose to the identity in floating point and
leave residue near 1e-16 m.

## 7. Test results

```
npx vitest run tests/wall-compiler.test.ts     15 passed
npm test                                       144 passed (12 files) — 129 before this stage, 15 added
npm run typecheck                              clean
npm run build                                  clean
npm run standalone:bundle && npm run standalone:build
                                               clean; assets/index-BzrIX8C4.js unchanged, byte for byte
```

The determinism and reference-isolation tests still pass, which is the direct
check that production behaviour did not move.

Acceptance checks, all reading emitted triangles:

1. **Local identity** — recessed and flush produce identical local vertex sets;
   asserted alongside a check that the world geometry really does differ, so the
   comparison is not comparing a thing with itself.
2. **Closed oriented solid** — 0 boundary edges, 0 duplicate edges, positive
   volume, 9.450000000 m³. Reveals span exactly `c = 0 … 0.45`.
3. **Ray oracle** — through the opening centre: 0 wall surfaces crossed, exactly
   1 glazing surface. Beside the opening, below the sill, above the head and
   50 mm outside the jamb: 2 surfaces each. 50 mm *inside* the jamb: 0. A
   5 mm-step section sweep at opening mid-height finds the gap starting within
   one step of 2.000 m and ending within one step of 4.000 m.
4. **Glazing separate** — 2 triangles, tagged `GLAZING`, owner `glass`, host
   opening `win`, all vertices at `c = 0.225` inside the opening rectangle.
   Adding them to the mesh opens it (`closed: false`); the solid parts alone are
   closed. That is the assertion that they are genuinely not part of the volume.
5. **Rigid motion** — rotate 37° about Y, translate `(−13.5, 4.25, 61.75)`:
   volume preserved, surface still closed, local vertex set unchanged.
   Separately, compiling the panel beside two 900 m walls produces triangles
   **deep-equal** to compiling it alone — the direct statement that no global
   frame is involved.
6. **Diagnostics** — thirteen rejection cases each produce their specific code:
   `UNKNOWN_HOST_WALL`, `OPENING_OUTSIDE_HOST` (past the end, above the head),
   `OPENING_TOUCHES_WALL_EDGE`, `DUPLICATE_WALL_ID`, `DUPLICATE_OPENING_ID`,
   `NON_ORTHONORMAL_AXES`, `INVALID_WALL_DIMENSION`,
   `INVALID_OPENING_DIMENSION`, `OVERLAPPING_OPENINGS`,
   `GLAZING_OUTSIDE_THICKNESS`, `UNKNOWN_GLAZING_OPENING`, `DUPLICATE_GLAZING_ID`. A rejected opening
   does not take its wall with it: the wall is emitted whole and closed at
   10.800 m³, with the diagnostic saying why there is no hole in it.
7. **Purity** — the input is deep-frozen before compilation and unchanged after;
   two compilations of the same input are deep-equal.

## 8. Visual evidence

```
npx tsx scripts/wall-compiler-diagnostic.ts            # -> out/wallspec/
npx tsx scripts/wall-compiler-diagnostic.ts some/dir   # elsewhere
```

Five PNGs of the **actual emitted triangle list**, rasterised by this
repository's own software renderer (`src/core/camera/shade.ts`):

| File | View |
| --- | --- |
| `01-recessed-in-context.png` | the panel set back behind the lower mass's front wall |
| `02-recessed-oblique.png` | the recessed panel alone, obliquely |
| `03-flush-oblique.png` | the flush panel, same view |
| `04-recessed-and-flush.png` | both, side by side |
| `05-reveal-close.png` | close on the cut: jamb, sill, head and the pane set half-way into the thickness |

These are a programmatic rasterisation, **not** a browser screenshot and not a
Three.js view — no browser is involved. The UI is untouched; the existing viewer
has no diagnostic entry added to it.

The context walls in `01` are render-only. They are never oracle input, and
being four full-length panels they double up at the corners.

## 9. Limitations

- **Rectangular only**: rectangular panels, rectangular through-cuts, axes
  orthonormal. Anything else returns a diagnostic, not partial geometry.
- **No overlapping openings.** The grid would still tile correctly, but the
  reveal faces would be emitted inside the union. Explicitly refused.
- **Openings must be strictly inside their host.** One flush with an edge is a
  legitimate element (a doorway to a wall's end) but a different one, and this
  stage does not build it.
- **Through-cuts only.** `OpeningSpec.cut` exists so partial-depth recesses
  arrive as a new case rather than by reinterpreting this one.
- **No junctions.** Walls do not know about each other, so nothing mitres,
  tees or shares a corner volume. Two walls meeting at a corner double-count
  their overlap. This is the first thing the next stage has to answer.
- **Glazing is a zero-thickness plane**, deliberately distinct from the wall
  solid. It has no frame, no rebate and no mullions.
- **Nothing is connected to the analyzer.** No plan, elevation or dimension
  reading produces a `WallSpec` yet. This stage proves the compiler, not the
  route to it.

## 10. Next bounded step

Wall junctions, on the same terms: two walls meeting at a corner, each still
described only in its own frame, compiled to a pair of solids that share the
corner volume exactly once. That is what a closed-volume oracle over a whole
storey requires, and it is the smallest thing that cannot be answered by the
single-panel case proven here.

It is **not** the next step to wire this into the production compiler. RC03's
repair needs a stable wall host to attach openings to, and there is no such
host until junctions define where one wall ends and the next begins.

## 11. Explicitly not done

No `ArchitecturalSpec`, no gold Marcówki, no roof compiler, plan parser, room
solver, OCR adapter, `EvidenceGraph` migration, camera repair, URL ingestion,
IFC export, Android port or materials work. No camera was fitted to an ARCHON
image and no dimension was tuned to the reference screenshots. The complete
Marcówki house is **not** solved by this stage, and the production analyzer is
exactly as correct — and as wrong — as it was before it.
