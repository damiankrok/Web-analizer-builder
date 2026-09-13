# STAGE WEB-PIVOT-01B — wall junction ownership proof

Development-only. It proves one claim and nothing more: **two orthogonal walls,
each still described only in its own frame, join at an exterior corner whose
material is emitted exactly once, with no gap, no interpenetration, and a hosted
opening that does not move.**

No production module was modified and the shipped web bundle is byte-identical
to the one built before this stage.

---

## 0. Provenance

| | |
| --- | --- |
| Branch | `claude/new-session-pvd4ik` |
| Start HEAD | `a7f8082dee6c758dccbf475783e66b5f290df699` |
| Final HEAD | `b6f0ed90fd02fe001cd6553ddcab7cfa23cd43aa` |

`ROOT_CAUSE_MATRIX.md` and `FULL_ANALYZER_TECHNICAL_AUDIT.md` are still not
present in this repository, and nothing below depends on them. Everything here
is a measurement of this repository.

## 1. What was wrong

STAGE WEB-PIVOT-01 proved a single wall and stated its own remaining limitation:

> **No junctions.** Walls do not know about each other, so nothing mitres, tees
> or shares a corner volume. Two walls meeting at a corner double-count their
> overlap.

Measured, not assumed. Two 4.0 × 3.0 m walls 0.45 m thick meeting at one corner,
compiled independently:

```
volume A + B = 10.800000000 m3     (correct: 10.192500000)
```

The 0.6075 m³ difference is the corner prism `0.45 × 0.45 × 3`, which is inside
both walls' nominal descriptions and inside one building. This is reproduced as
a standing check in `tests/wall-junction.test.ts` (case 12b), so the number this
stage removes stays visible rather than becoming folklore.

## 2. Files changed

| File | Status | Role |
| --- | --- | --- |
| `src/core/wallspec/junction.ts` | added | `WallJunctionSpec`, `compileJunctions`, junction diagnostics, `exposedWallAreaM2` |
| `src/core/wallspec/junction-fixtures.ts` | added | the 90° corner fixture, both owner variants, the rigid motion, the distant geometry |
| `tests/wall-junction.test.ts` | added | 17 acceptance checks |
| `scripts/wall-junction-diagnostic.ts` | added | console report and five renders of the emitted triangles |
| `docs/WALL_JUNCTION_OWNERSHIP_PROOF.md` | added | this report |
| `src/core/wallspec/contracts.ts` | modified | `WallExtent`, `CompiledTri.contactId`, two diagnostic codes |
| `src/core/wallspec/compile.ts` | modified | `compileWalls` takes an optional extent map; `checkWall` exported |
| `tests/geometry-oracles.ts` | modified | `rayIntervals`, `mergeIntervals`, `intervalsOverlapLength`, `intervalsLength` |

Nothing in `src/` outside `src/core/wallspec/` imports any of it. The three
modified files are the three STAGE WEB-PIVOT-01 development files; §10 shows
their emitted geometry is unchanged byte for byte.

## 3. Junction semantics

```ts
type WallEnd = 'START' | 'END'

type WallJunctionSpec = {
  id: string
  wallAId: string;  wallAEnd: WallEnd
  wallBId: string;  wallBEnd: WallEnd
  kind: 'BUTT'
  ownerWallId: string        // must be wallAId or wallBId
}
```

- The **owner** keeps its nominal extent and is compiled exactly as if the
  junction did not exist.
- The **non-owner** has its *emitted material* cut back at the joined end by the
  owner's thickness — precisely the depth of the owner's slab it would otherwise
  duplicate.
- **Neither `WallSpec` is modified.** The trim is a `WallExtent`, an output of
  compilation:

  ```ts
  type WallExtent = { a0: number; a1: number; a0ContactId?: string; a1ContactId?: string }
  ```

  `a0`/`a1` are in the wall's own `u` coordinate — the same axis as
  `OpeningSpec.offsetM` — so an opening keeps the offset it was given.

There is no default owner and no tie-break. A corner whose owner is not stated
is not built, because "whichever came first in the array" makes a model depend
on input order. Topology is never inferred: this module never looks at a set of
walls and decides where the corners probably are.

### Why an extent and not a shorter wall

Shortening the non-owner's `lengthM` is the obvious implementation. It silently
moves every opening on that wall, because `offsetM` is measured from the wall
origin and trimming a `START` end has to move that origin. Measured on the
fixture's opening, which is stated at `u = 1.50`:

| implementation | emitted opening |
| --- | --- |
| compiled extent (this stage) | `z = 1.500 .. 2.500` |
| shortened `lengthM` + moved origin | `z = 1.050 .. 2.050` |

0.45 m, in a window nobody asked to move. Case 6b fails if the trim is ever
implemented that way.

### Validity

A junction is built only if, in order: the kind is `BUTT`; the two walls are
distinct and both present; the owner is one of them; neither end is already
claimed; both walls are well formed; their `up` axes agree; their `u` axes are
perpendicular; their stated ends coincide at the **outer face, wall base**;
their heights agree; and the corner is **exterior** — walking into either wall
from the corner must go behind the other's outer face. Anything else is a
diagnostic (§9).

The exterior test is what rejects the reflex arrangement, which passes every
other check and shares no corner volume at all, so trimming it would cut a hole
in a wall for nothing.

## 4. Inherited coordinate semantics

Unchanged from STAGE WEB-PIVOT-01 and re-checked here:

- `u` along the length, `up` along the height, `n = u × up` **outward**; only `u`
  and `up` are stored.
- `origin` is the corner at `u = 0`, wall base, **on the outer face**; material
  runs inward against `n`.
- `OpeningSpec.offsetM` / `sillM` are in the host wall's frame and nowhere else.
- `GlazingSpec.insetM` is measured from the outer face.

The junction layer adds no frame of its own. The corner point is derived from
the two walls' own frames (`endPoint`), and no bounding box, facade side or
sibling mass is read anywhere.

## 5. The fixture

Two 4.0 × 3.0 m walls, 0.45 m thick, one 90° exterior corner at `(4, 0, 4)`:

```
  z
  4  +--------------------+      wall_a  origin (0,0,4), u = +X, n = +Z
     |                    |              outer face z = 4, material to z = 3.55
3.55 +----------------+   |      wall_b  origin (4,0,4), u = -Z, n = +X
     .                |   |              outer face x = 4, material to x = 3.55
  0  .................+---+      corner prism 0.45 x 0.45 x 3 = 0.6075 m3
     0             3.55   4  x
```

`wall_a`'s `END` meets `wall_b`'s `START`, and at that end both walls' outer-face
base points are the same point — which is what makes "these two ends meet" a
checkable statement rather than a drawing convention.

Hosted opening, on the non-owner, clear of the corner at either end:
offset 1.50 m, sill 0.80 m, 1.00 × 1.00 m, through, glazed at mid-thickness.

## 6. Expected against actual

| | expected | measured | |
| --- | --- | --- | --- |
| no openings | `(4×3×0.45) + (4×3×0.45) − (0.45×0.45×3)` = **10.1925** | **10.192500000 m³** | both owner variants |
| with the opening | `10.1925 − (1.0×1.0×0.45)` = **9.7425** | **9.742500000 m³** | both owner variants |

Measured by the divergence theorem over the emitted triangles, per wall, summed.
Tolerance 1e-9; the oracle's own rounding is ~1e-13.

Each wall is separately closed and consistently wound outward (directed-edge
pairing, exact vertex comparison, positive signed volume). 24 triangles without
openings, 78 with (76 solid + 2 glazing; 8 reveal; 6 contact).

## 7. A-owner against B-owner

| | `wall_a` owns | `wall_b` owns |
| --- | --- | --- |
| trimmed wall / end | `wall_b` START | `wall_a` END |
| compiled extents | `wall_a 0..4`, `wall_b 0.45..4` | `wall_a 0..3.55`, `wall_b 0..4` |
| nominal `lengthM` | `4`, `4` — unchanged | `4`, `4` — unchanged |
| volume A + B | 9.742500000 m³ | 9.742500000 m³ |
| exterior boundary | identical on 320 scan lines | identical on 320 scan lines |
| exposed surface area | 55.945000 m² | 55.945000 m² |
| corner prism owner | `wall_a` | `wall_b` |

The corner material is assigned to a different wall in each variant and that is
the only difference. Ownership is a bookkeeping choice, not a different
building. (The equality holds for unequal thicknesses too — the union is
`L_A·t_A·h + L_B·t_B·h − t_A·t_B·h` either way — but only the equal-thickness
fixture required by the brief is tested.)

## 8. Independent geometry oracles

`tests/geometry-oracles.ts` imports nothing from `src/core/wallspec/`, and none
of its algorithms appears in the compiler: the compiler tiles a grid and never
computes a volume, an edge pairing, a ray intersection or an interval.

The oracle that carries this stage is the new one. **Volume alone cannot tell a
doubled corner from a corner with a gap beside it** — the two errors cancel — so
the corner is checked by reading the material out *along a line* and comparing it
to the L-shaped cross-section written down in metres.

Intervals are read **one closed solid at a time and merged afterwards**, never
from a combined triangle list. Two solids in contact share a plane, and a
combined list reports that plane as one crossing where there are two surfaces.
That is also the honest shape of the contract: separate closed solids in
contact, not one boolean union.

| check | how | result |
| --- | --- | --- |
| **Volume** | divergence theorem | 9.742500000 m³ against 9.7425, tolerance 1e-9 |
| **No overlap** | interval intersection between the two solids, 480 lines per variant (3 heights × 2 axes × 80 positions) | worst shared length **1.78e-15 m** — contact, not material |
| **No gap** | union of intervals against the analytic L, 320 lines per variant, plus a 1 mm sweep 20 mm either side of the inner face at three heights | exact on every line |
| **Opening ray** | ray through the opening centre | 0 wall surfaces, exactly 1 pane |
| | 50 mm outside either jamb, below the sill, above the head | 2 wall surfaces each |
| | 50 mm inside the jamb | 0 |
| **Opening section** | horizontal section at opening mid-height | material `0..1.500` and `2.500..4.000`; whole again 1 mm below the sill |
| **Local opening** | emitted reveal + glazing projected back into the host frame | `u = 1.50 .. 2.50`, `up = 0.80 .. 1.80`, `c = 0 .. 0.45` — exact, both variants |
| **Rigid transform** | rotate 37° about Y **and** 19° about X, translate `(−13.5, 4.25, 61.75)` | volume, area, per-wall local vertex sets and junction record all unchanged; L cross-section exact on 160 carried scan lines |
| **Global isolation** | two 900 m × 40 m walls, 500 m away | corner triangles **deep-equal**, junction record and extents identical |

The rotation is deliberately not about Y alone: a Y-only rotation leaves `up` at
world +Y, and a compiler that had quietly assumed vertical would survive it.
After this one no wall axis is a world axis.

### The oracles were checked against deliberate faults

Two mutations of the trim, each run against the full suite:

| mutation | overlap check | gap check | volume |
| --- | --- | --- | --- |
| `trimM = 0` (the Stage-01 behaviour) | **fails** | passes | fails |
| `trimM = 2 × thickness` | fails | **fails** | fails |

The two checks discriminate: a doubled corner has no gap, and an over-trimmed
one has both. 7 and 9 of 17 tests fail respectively. A suite where every check
failed on every fault would not have told us that.

## 9. Refusals

Fourteen cases, each returning its own structured diagnostic with a message and
`severity: 'ERROR'`. Nothing is silently repaired.

| case | code |
| --- | --- |
| missing wall id | `UNKNOWN_JUNCTION_WALL` |
| same wall on both sides | `JUNCTION_SELF_REFERENCE` |
| owner is neither wall | `JUNCTION_OWNER_NOT_A_MEMBER` |
| ends a metre apart | `JUNCTION_ENDS_DO_NOT_MEET` |
| axes at 45° | `JUNCTION_NOT_ORTHOGONAL` |
| reflex corner, no shared material | `JUNCTION_NOT_EXTERIOR_CORNER` |
| walls of different heights | `JUNCTION_HEIGHT_MISMATCH` |
| walls on different `up` axes | `JUNCTION_UP_AXES_NOT_ALIGNED` |
| corner longer than the wall it trims | `JUNCTION_TRIM_EXCEEDS_WALL` |
| wall whose axes are not orthonormal | `JUNCTION_WALL_NOT_COMPILABLE` |
| `kind` other than `BUTT` | `UNSUPPORTED_JUNCTION_KIND` |
| same junction id twice | `DUPLICATE_JUNCTION_ID` |
| two junctions claiming one wall end | `CONFLICTING_JUNCTION_END` |
| opening inside the trimmed zone | `OPENING_IN_TRIMMED_ZONE` |

A refused junction does not half-apply: no trim, no contact face, both walls
whole at their nominal volume, and the corner visibly double-counted at 10.8 m³
(case 12b). A refused opening does not take its wall with it: no hole, no
reveal, no glazing, the wall still closed over its trimmed extent at the correct
4.792500 m³, and the input record still reading `offsetM: 0.2` (case 12c).

### Determinism and immutability

Input deep-frozen and unchanged after compilation; two compilations deep-equal
in triangles, junctions and extents. The junction is named by its own id and the
contact face carries it, so identity is semantic rather than positional.

## 10. Contact semantics, and what production sees

No global boolean union. Two separate closed solids that touch on a shared
plane, with the shared face tagged:

- contact face = the trimmed wall's new end face, **2 triangles, 1.350000 m²**
  (thickness × height), carrying `contactId: 'corner_ab'`;
- `exposedWallAreaM2` excludes it: **55.945000 m² exposed of 57.295000 m² total**;
- nothing else is tagged — the owner's end face at the same corner is real
  exterior fabric and stays counted.

Without the tag each corner would add 1.35 m² of facade nobody can see or paint.

**Production behaviour is unchanged.** Nothing was touched in source
interpretation, the Marcówki production output, OCR, camera fitting, repair
scoring or roof behaviour. Direct evidence rather than inspection:

- the three modified files are the STAGE WEB-PIVOT-01 development files, and
  their emitted geometry is identical. Compiling the five Stage-01 fixture cases
  (recessed, flush, rotated, the four context walls, and the rejected-opening
  case with its diagnostics) at the start HEAD and at this one, in a `git
  worktree` of `a7f8082`, gives JSON that matches to the byte:
  `sha256 d714dc7f5b61d5e144e5d40ca0d12d6606b946f9f4e15eb870668452ccf3d66c` both
  times. The `CompiledTri` record gains one optional field, `contactId`, which is
  `undefined` when no junction is involved;
- `npm run standalone:build` reproduces the bundle at the same aggregate hash as
  before the stage: `sha256 0e30b0defaf6bbaed316188d02a32b31c4dcad387d92e581becd611b7a98a80d`
  over all 17 published files, the application chunk still
  `assets/index-BzrIX8C4.js`;
- `npm run standalone:verify` passes 11/11 in a real browser;
- the determinism and reference-isolation suites still pass, which is the direct
  check that the analyzer did not move.

## 11. Visual evidence

```
npx tsx scripts/wall-junction-diagnostic.ts            # -> out/wallspec-junction/
npx tsx scripts/wall-junction-diagnostic.ts some/dir   # elsewhere
```

Five PNGs of the **actual emitted triangle list**, rasterised by this
repository's own software renderer (`src/core/camera/shade.ts`). A programmatic
rasterisation — not a browser screenshot and not a Three.js view. The UI is
untouched and has no diagnostic entry added to it.

Warm = owner, cool = trimmed non-owner, red = contact face at the join,
blue-grey = glazing. That palette is local to the diagnostic script;
`STUDY_MATERIALS` is not modified. The production study palette is near-white by
design so that form and shadow carry the reading, and the question here — *which
wall owns what* — needs colour to answer.

| File | View |
| --- | --- |
| `01-owner-wall-a.png` | `wall_a` owns: it runs through the corner, `wall_b` stops short against it |
| `02-owner-wall-b.png` | the same two walls, ownership mirrored; the exterior boundary is the same L |
| `03-rotated-assembly.png` | after a 37° rigid rotation, framed from the camera carried through the same rotation — the same picture, under different light |
| `04-hosted-opening.png` | the 1.0 × 1.0 m opening on the trimmed wall, reveals and glazing, clear of the corner |
| `05-corner-contact-exploded.png` | the join pulled apart: the red 0.45 × 3 m end face is the contact |

`05` slides the trimmed wall 0.9 m along its own axis **for that view only**.
Nothing is re-compiled — the same emitted triangles, displaced — because the
contact face is by construction invisible in the assembly, which is the whole
claim being made about it.

One honest artefact: in `01` and `02` a red hairline shows at the join. The two
solids share a plane there, and a depth buffer resolves coincident faces
arbitrarily. It is a rendering consequence of the contact-interface approach
(§10), not a gap — the interval oracle reads that line at 1.78e-15 m.

## 12. Verification

Every gate below was run on the tree this stage commits. The typecheck, the
full suite (144 passing) and the standalone build were also run at the start
HEAD, on a clean tree, to establish the baseline the §10 hashes compare against.

| gate | command | result |
| --- | --- | --- |
| new junction tests | `npx vitest run tests/wall-junction.test.ts` | **17 passed** |
| Stage-01 compiler tests | `npx vitest run tests/wall-compiler.test.ts` | **15 passed** |
| full suite | `npx vitest run` | **161 passed, 13 files** (144 before) |
| typecheck | `npm run typecheck` | clean |
| build | `npm run build` | clean |
| standalone bundle | `npm run standalone:bundle` | 12 assets, unchanged |
| standalone build | `npm run standalone:build` | bundle hash unchanged (§10) |
| browser verification | `npm run standalone:verify` | **11/11 passed** |

Nothing above is claimed unrun.

**Final HEAD of the stage work:** `b6f0ed90fd02fe001cd6553ddcab7cfa23cd43aa`
— the commit that carries every file in §2. A commit cannot name its own hash,
so that SHA is recorded by a second commit which changes this document and
nothing else; the gates above were run on the tree of `b6f0ed9`, and the two
commits differ only by these three lines.

## 13. Limitations

- **One corner kind.** Orthogonal, `BUTT`, exterior, two walls. Mitres, tees,
  arbitrary angles, curves, wall layers and inferred topology are refused by
  name, not approximated.
- **Equal heights.** A butt between walls of different heights leaves material
  above the shorter one that a single trim cannot describe. Refused.
- **The owner's covered inner face is not tagged.** `exposedWallAreaM2` excludes
  the trimmed wall's end face but not the patch of the owner's inner face the
  same contact covers. That face is interior anyway; tagging it would need the
  owner's grid split at the corner, which this stage did not do.
- **Contact, not union.** Two closed solids share a plane. Volume, closure and
  the interval oracle all handle that correctly; a renderer with a depth buffer
  shows a hairline (§11), and any consumer that needs a single manifold per
  storey will need a real union step.
- **Sampled, not proved, in the continuum.** "No gap" and "no overlap" are exact
  interval arithmetic on 800+ lines per variant at several heights, plus exact
  volume additivity against the stated union. That is strong evidence, not a
  theorem over all of R³.
- **Nothing is connected to the analyzer.** No plan, elevation or dimension
  reading produces a `WallSpec` or a `WallJunctionSpec` yet. RC03 is still open
  in production and was not touched.

## 14. Next bounded step

**A closed storey ring: four walls, four junctions, one loop.** On the same
terms — explicit ownership, wall-local frames, independent oracles — compile a
rectangular storey and prove the four corners are consistent *together*: every
wall end claimed exactly once, the ring's enclosed volume correct against
`perimeter × thickness × height` less the corner double-counts, and no ordering
of the junction records changing the result.

That is the smallest thing the two-wall case cannot answer. A wall that is
non-owner at both ends already composes here, and `CONFLICTING_JUNCTION_END`
already refuses a contested end, but neither is exercised by a single corner —
and a ring is the first shape where the ownership choice has to be globally
consistent rather than locally free. It is also the first shape for which
"exposed facade area" is a question with a right answer.

It is **not** the next step to wire this into the production compiler. RC03's
repair needs a stable wall host to attach openings to, and a storey ring is the
smallest thing that actually is one.

## 15. Explicitly not done

No full wall-network inference, T-junctions, mitres, arbitrary angles, curved
walls, wall layers, slabs, roofs, gold Marcówki spec, OCR, plan vectorisation,
`EvidenceGraph` rewrite, camera repair, production integration, Kotlin port or
IFC export. No camera was fitted and no dimension tuned. The complete Marcówki
house is **not** solved by this stage, and the production analyzer is exactly as
correct — and as wrong — as it was before it.
