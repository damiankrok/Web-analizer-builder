# STAGE WEB-PIVOT-02A — eave / sloped-soffit wall-top closure

Development-only. Nothing in this stage is reachable from the production
analyzer, the OCR pipeline, the EvidenceGraph, the repair loop or camera
scoring, and the published standalone artifact is byte-identical to the one the
previous stage built (measured — see **Gates**).

| | |
| --- | --- |
| Starting HEAD | `22045ad215c8e49cf930d44d4af2dc025ade0209` |
| Final HEAD | `__FINAL_HEAD__` |
| Branch | `claude/new-session-pvd4ik` |
| Previous stage | STAGE WEB-PIVOT-02 — Marcowki structural shell + roof compiler |
| Result | `PASS_STAGE_WEB_PIVOT_02A_EAVE_SOFFIT_CLOSURE` |

## 1. The defect

STAGE WEB-PIVOT-02 ended with a measured, named limitation. A `WallSpec` had one
top height. A pitched roof's underside is a slope. Where a wall stands *under* a
slope — as the Marcowki attic's two side walls do — the soffit is higher at the
wall's inner face than at its outer one, and a wall that stops flat leaves a
prism of air between itself and the roof:

```
        roof underside
             /
            /  <- void
           /______
          |       |
          | wall  |     flat top: the wall stops at the LOWER of the two heights
          |       |
```

Measured then and re-measured now from the emitted triangles: **1.988036801 m³**
across the two attic side walls, and up to **0.377594834 m** of daylight at the
inner face. The gable ends did not have the defect and still do not — they run
*across* the slope, so their top really is one edge.

## 2. What changed, and what deliberately did not

The fix is in wall-top semantics. The roof was not touched: it was
source-verified in STAGE WEB-PIVOT-02, and its ridge, eave, pitch, span,
overhang, support footprint and emitted triangles are bit-identical before and
after (asserted, not asserted-by-eye — see §7).

### The contract

`WallTopProfile` becomes a two-case union. The existing case keeps its meaning
and its geometry exactly; the new case is the only thing this stage adds.

```ts
export type WallTopPlane = { pointM: Vec3; normal: Vec3 }

export type WallTopProfile =
  | { kind: 'POLYLINE'; points: ReadonlyArray<{ u: number; topM: number }> }
  | { kind: 'PLANE'; plane: WallTopPlane; sourceRoofId: string }
```

- **`POLYLINE`** — STAGE WEB-PIVOT-02's gable end. A height along the wall, the
  same at both faces.
- **`PLANE`** — the wall dies into a stated world plane. The height then varies
  with the local thickness coordinate as well as along the wall.

Everything else about a wall is unchanged and was required to be:

| | |
| --- | --- |
| wall base and local frame | unchanged — `origin`, `u`, `up`, `wallFrame`, `wallPoint` untouched |
| `lengthM`, `heightM` | unchanged; a profile describes what is *emitted*, like `WallExtent` |
| opening coordinates | unchanged — `offsetM`, `sillM`, `widthM`, `heightM` are read as written |
| junction trim | still a `WallExtent` in wall-local `u` |
| roof host | explicit: `sourceRoofId`, checked against the spec's roofs |
| global inference | none — no bounding box, no facade side, no sibling wall is read |

### The compiler

`profileTopAt(w, u)` becomes `wallTopAt(w, u, c)`. For a `PLANE` top the height
is one line of algebra with no iteration:

```
b = ((pointM - wallPoint(w, u, 0, c)) . normal) / (up . normal)
```

`compileProfiledWall` now computes its band boundaries at both faces —
`bands(u, 0)` and `bands(u, T)` — so the outer face, the inner face, the top
ribbon and the two end faces each stop where the plane says. The top face's four
corners all lie on the stated plane, so it is planar by construction; the end
faces' topmost band becomes a trapezoid rather than a rectangle. Under a
`POLYLINE` top `bands(u, 0)` and `bands(u, T)` are equal, so the gable ends emit
the triangles they emitted before, and the rectangular path STAGE WEB-PIVOT-01
proved is not entered at all by a flat-topped wall.

### A second defect, found while doing it

Profiled walls were emitting their end faces with **no `contactId`**. The
rectangular path had tagged them since STAGE WEB-PIVOT-01B; the profiled path,
added in STAGE WEB-PIVOT-02, did not. The consequence was silent: the Marcowki
attic's trimmed side walls reported their buried end faces as exposed facade.
Fixed here, and `contactKind` (`'JUNCTION' | 'ROOF_SOFFIT'`) was added so the two
kinds of contact are distinguishable rather than inferable from an id.

### New diagnostics

| code | when |
| --- | --- |
| `WALL_TOP_PLANE_UNCROSSABLE` | the top plane is parallel to the wall's own `up`; the wall never reaches it |
| `WALL_TOP_BELOW_BASE` | the top plane cuts at or below the wall base somewhere in the emitted extent |
| `INVALID_WALL_PROFILE` | degenerate normal, non-finite plane, or a `PLANE` top naming no roof |
| `OPENING_ABOVE_WALL_PROFILE` | an opening reaches the soffit at either face — explicit rejection, no undocumented clip |
| `WALL_TOP_ROOF_UNKNOWN` | (`building.ts`) the named `sourceRoofId` is not a roof in the spec |

## 3. Files changed

| file | change |
| --- | --- |
| `src/core/wallspec/contracts.ts` | `WallTopPlane`; `WallTopProfile` as `POLYLINE \| PLANE`; `ContactKind`; `CompiledTri.contactKind`; two diagnostic codes |
| `src/core/wallspec/compile.ts` | `wallTopAt(w, u, c)`, `topMinAt`, `topMaxAt`; plane validation; `checkWallTop`; profiled tiling across the thickness; trapezoid end faces with junction contact ids; `contactKind` on both paths |
| `src/core/wallspec/building.ts` | `WALL_TOP_ROOF_UNKNOWN`: the named roof must exist |
| `src/core/wallspec/marcowki-fixture.ts` | per-side ring profiles; the attic side walls get `PLANE` tops from the gold pitch; `flatEaveTops` / `soffitLiftM` / `soffitRoofId` switches for measurement and mutation |
| `src/core/wallspec/eave-fixture.ts` | **new** — Fixture C, the synthetic eave |
| `tests/geometry-oracles.ts` | **new oracles** — `sampleContact`, `measureContact`, `ContactSample`, `ContactReport` |
| `tests/eave-closure.test.ts` | **new** — 31 tests: the synthetic proof, the Marcowki recheck, five mutations |
| `tests/marcowki-shell.test.ts` | three STAGE-02 assertions restated against the corrected eave (see §11) |
| `scripts/eave-closure-diagnostic.ts` | **new** — console report and seven renders |
| `scripts/marcowki-shell-diagnostic.ts` | the "known limitation" section now prints the closed interface; knee wall measured at the outer face |

## 4. Fixture C — the synthetic eave

One wall, one roof, round numbers, no house.

| | |
| --- | --- |
| wall length `L` | 4.0 m |
| wall thickness `t` | 0.45 m |
| outer-face top reference | 3.0 m |
| soffit pitch `p` | 40° |

```
dh = t * tan(p)        = 0.45 * tan(40°)              = 0.377594834029776 m
V  = 0.5 * t * dh * L  = 0.5 * 0.45 * dh * 4.0        = 0.339835350626798 m³
```

Both are computed in `eave-fixture.ts` from the definition. Neither is measured
from a mesh, and neither appears in any compiler.

### Synthetic before / after

| | m³ |
| --- | --- |
| flat-top wall volume (rectangular path) | `5.400000000000` |
| plane-top wall volume | `5.739835350627` |
| difference | `0.339835350627` |
| difference − analytic `V` | `2.220e-16` |

The flat-top wall is `L × 3.0 × t = 5.4` m³ exactly, by hand.

## 5. Interface measurement

The oracle is a ray and nothing else. `sampleContact` puts a vertical line
through both solids, takes the top of the lower one and the bottom of the upper
one from `materialRuns`, and reports the **signed** gap — positive is a void,
negative is an overlap. It also compares the material length when the two are
measured separately against the length of their union: the difference is exactly
the length of line inside both, which catches one solid passing *through* the
other where a signed gap cannot. Nothing in it knows that a wall has a top, a
profile, a plane or a host.

25 lines on Fixture C (5 along × 5 across), 50 on Marcowki (5 along × 5 across ×
2 walls).

| | max void | max overlap | max double-filled | one-run samples |
| --- | --- | --- | --- | --- |
| Fixture C, flat top | `3.692e-1 m` | `0` | `0` | 0 / 25 |
| Fixture C, plane top | `1.137e-13 m` | `2.274e-13 m` | `2.274e-13 m` | **25 / 25** |
| Marcowki, before | `3.608e-1 m` | `0` | `0` | 0 / 50 |
| Marcowki, after | `1.679e-6 m` | `0` | `0` | **50 / 50** |

### The documented tolerances, and why they differ

- **Fixture C: 1 nm (`1e-9 m`).** Its wall top and its roof are stated from the
  same exact constants, so the only thing between the two emitted surfaces is
  floating-point arithmetic. Measured worst case `2.3e-13 m`.
- **Marcowki: 5 µm (`5e-6 m`).** All of the residual is the gold file's own
  rounding. The wall top is stated from `roof.pitchDeg = 40`; the roof is built
  from `level.eaveM = 4.63556` and `level.ridgeM = 7.95`, each recorded to five
  decimals. Those two statements of the same slope differ by `9.0e-7`, which
  over 0.45 m of wall thickness is `1.7e-6 m`. Measured worst case `1.679e-6 m`
  — four thousand times smaller than the half-millimetre these tests already
  treat as below drawing precision.

The two numbers are stated separately on purpose. The tolerance the gold shell
needs measures the **transcription**, not the compiler, and Fixture C is what
proves that.

## 6. Marcowki gold-shell recheck

| | before | after |
| --- | --- | --- |
| attic side-wall volume | `13.689000` m³ | `15.677037` m³ |
| material added | — | `1.988037` m³ |
| analytic wedge, `2 × 0.5 t · dh · L` with `L = 12.60 − 2 × 0.45` | `1.988037` m³ | |
| max eave void | `0.360812841` m (0.377594834 m at the inner face) | `1.679e-6` m |
| max eave overlap | `0` | `0` |
| main roof pitch, measured from triangles | `39.99997°` | `39.99997°` |
| eave, measured | `4.635560` | `4.635560` |
| ridge, measured | `7.950000` | `7.950000` |
| roof footprint bbox | x `[0, 7.90]`, z `[0, 12.60]` | identical |
| main roof triangles | — | **bit-identical** (`toEqual`) |
| flat garage roof triangles | — | **bit-identical** (`toEqual`) |
| gable opening reveal bounds | — | **bit-identical** (`toEqual`) |
| every attic wall closed and outward-wound | yes | yes |
| compile diagnostics | none | none |

A section across the attic left wall at z = 6.3, printed by
`scripts/eave-closure-diagnostic.ts`:

```
  c=0.0001  before wall [3.060, 4.360]  after wall [3.060, 4.360]  roof [4.360, 4.636]
  c=0.1000  before wall [3.060, 4.360]  after wall [3.060, 4.444]  roof [4.444, 4.719]
  c=0.2250  before wall [3.060, 4.360]  after wall [3.060, 4.549]  roof [4.549, 4.824]
  c=0.3500  before wall [3.060, 4.360]  after wall [3.060, 4.654]  roof [4.654, 4.929]
  c=0.4499  before wall [3.060, 4.360]  after wall [3.060, 4.738]  roof [4.738, 5.013]
```

The "after" wall top and the roof underside are the same number at every depth.
The printed knee wall, 1.30 m above the attic floor, is still where the section
draws it — **at the outer face**, which is where the eave datum is taken; the
inner face is now `dh` higher, as the drawing's own slope requires.

## 7. The roof was not moved

Required by §8 of the brief and checked as an equality, not a tolerance:

```ts
expect(gableRoof(after)).toEqual(gableRoof(before))
expect(flat(after)).toEqual(flat(before))
```

Ridge, eave, pitch, span, overhang and support footprint are all downstream of
those triangles and are asserted individually as well.

## 8. Opening invariance

- Fixture C's window (`offset 1.0`, `sill 0.5`, `1.2 × 1.6`) produces **the same
  reveal geometry** under a flat top and under a plane top — `toEqual`, not a
  tolerance — and lands exactly on its four stated numbers.
- Cutting it does not disturb the wedge: the wall's volume is
  `5.4 + V − (1.2 × 1.6 × 0.45)` and the mesh is still closed.
- Marcowki's gable opening keeps bit-identical reveal bounds before and after,
  on the front facade at its stated offset above the attic floor.
- An opening that **reaches** the soffit is refused by name
  (`OPENING_ABOVE_WALL_PROFILE`) and nothing is emitted for it. Under a `PLANE`
  top the head is measured against the *lower* of the two faces and must clear
  it, so an opening cannot end up with a zero-height band on one side of the
  wall and not the other. No silent clip, no undocumented shape.

## 9. Junction / ring regression

| suite | tests | result |
| --- | --- | --- |
| STAGE WEB-PIVOT-01 `tests/wall-compiler.test.ts` | 15 | pass |
| STAGE WEB-PIVOT-01B `tests/wall-junction.test.ts` | 17 | pass |
| STAGE WEB-PIVOT-01C `tests/storey-ring.test.ts` | 52 | pass |
| STAGE WEB-PIVOT-02 `tests/roof-compiler.test.ts` | 9 | pass |
| STAGE WEB-PIVOT-02 `tests/marcowki-shell.test.ts` | 31 | pass |
| STAGE WEB-PIVOT-02A `tests/eave-closure.test.ts` | 31 | pass |

Junction ownership, pair no-overlap/no-gap, closed-ring volume, ownership
schedule equivalence, facade-area semantics and hosted-opening invariance are
all unchanged. The Marcowki attic ring is the case that exercises them together
with the new top: its two `PLANE`-topped side walls are trimmed at **both** ends
by real BUTT junctions, and they compile closed, outward-wound and correctly
tagged.

No arbitrary wall networks were introduced. Fixture C is deliberately **not** a
ring — one wall under one roof — because rings are proven elsewhere.

## 10. Semantic contact surface

The new wall-top face carries

```ts
contactId:   <the roof's id>       // 'roof_main_gable' on Marcowki
contactKind: 'ROOF_SOFFIT'
```

which is this repository's equivalent of `WALL_TOP_SOFFIT_CONTACT`.

| | count |
| --- | --- |
| `ROOF_SOFFIT` triangles, Marcowki after | 4 (two per side wall) |
| `ROOF_SOFFIT` triangles, Marcowki before | 0 |
| `JUNCTION` triangles, Marcowki after | 24 |

Checked:

- every tagged triangle lies on the stated soffit plane, and every untagged
  triangle carries no `contactId` (Fixture C);
- `exposedWallAreaM2` of the tagged set is **0** — it is not exterior facade;
- `faceEscapes` is false for all of them — they are buried under the roof, not
  merely excluded by convention;
- a `POLYLINE` gable end is **not** tagged: its top really is outside, and
  STAGE WEB-PIVOT-02's facade numbers are unchanged.

## 11. Three STAGE-02 assertions were restated

Not silently. Three assertions in `tests/marcowki-shell.test.ts` encoded the
defect as the expected answer, and this stage changes the answer:

1. *stands the attic on the ground storey…* — a probe at mid-thickness used to
   read `4.360`; it now reads the soffit at that depth. Restated as an interface
   check: the wall's top is compared with the **roof's own emitted underside**
   on the same line, and the two must agree within the gold tolerance.
2. *matches the section: levels, eave, ridge and pitch* — same probe, same
   restatement.
3. *puts the knee wall where the section prints it* — used to take the wall's
   whole bounding box. Now measures the **outer face** (where the section prints
   the knee wall) at `4.360`, and additionally asserts the inner face is
   `dh` higher, which is the corrected behaviour stated positively.

Every other STAGE-02 assertion passes untouched.

## 12. Mutations

None is committed. Each is a perturbed spec built inside the test.

| # | mutation | caught by |
| --- | --- | --- |
| 1 | revert the attic side walls to a flat top (`flatEaveTops`) | max void `> 0.3 m`, every one of 50 lines reads two runs instead of one; side-wall volume drops 1.988 m³ |
| 2 | lift the stated top plane 0.05 m without moving the roof (`soffitLiftM`) | max overlap `0.05 m`, max double-filled `0.05 m`; the signed gap is what distinguishes this from mutation 1, and an unsigned oracle would have passed it |
| 3 | name a roof the spec does not have (`soffitRoofId`) | two `WALL_TOP_ROOF_UNKNOWN` diagnostics, one per side wall, named by wall id |
| 4 | raise the roof's EAVE and RIDGE levels 0.3 m, leaving the profile alone | still a 40° gable, but max void `0.3 m` — the interface gate, not the roof gate, is what fails |
| 5 | shift the opening 0.1 m | the host-local gate: the measured reveal is at `offset + 0.1`, not at `offset`, while the wall top is unchanged — so the gate names the opening, not the profile |

## 13. Visual diagnostics

```
npx tsx scripts/eave-closure-diagnostic.ts        # -> out/eave-closure/
npx tsx scripts/marcowki-shell-diagnostic.ts      # -> out/marcowki-shell/
```

Seven renders, all software rasterisations of the emitted triangle list by this
repository's own renderer — not browser screenshots, and no product UI is
touched.

| file | what it shows |
| --- | --- |
| `out/eave-closure/01-synthetic-flat-gap.png` | Fixture C with a flat top: the wedge is a lit triangle between the wall head and the roof underside |
| `out/eave-closure/02-synthetic-plane-closed.png` | the same view, corrected: the wall head meets the soffit along its whole width |
| `out/eave-closure/03a-section-before.png` | Fixture C sectioned down the wall's length, flat top — the void is a clear triangle of background |
| `out/eave-closure/03b-section-after.png` | the same section, plane top — no background between the two solids |
| `out/eave-closure/04a-marcowki-eave-before.png` | the Marcowki left eave, sectioned along the ridge, before |
| `out/eave-closure/04b-marcowki-eave-after.png` | the same section, after |
| `out/eave-closure/05-marcowki-oblique-after.png` | the whole corrected shell, obliquely |

The sections are orthographic projections along the wall's own length with the
gable ends left out of frame. Nothing is clipped: every triangle drawn is one
the compiler emitted.

## 14. Gates

| gate | command | result |
| --- | --- | --- |
| STAGE 02A focused tests | `npx vitest run tests/eave-closure.test.ts` | 31 / 31 pass |
| STAGE 01 | `npx vitest run tests/wall-compiler.test.ts` | 15 / 15 pass |
| STAGE 01B | `npx vitest run tests/wall-junction.test.ts` | 17 / 17 pass |
| STAGE 01C | `npx vitest run tests/storey-ring.test.ts` | 52 / 52 pass |
| STAGE 02 roof / shell | `npx vitest run tests/roof-compiler.test.ts tests/marcowki-shell.test.ts` | 40 / 40 pass |
| full suite | `npm test` | **284 / 284 pass, 17 files** |
| typecheck | `npm run typecheck` | clean |
| build | `npm run build` | clean |
| standalone bundle | `npm run standalone:bundle` | clean |
| standalone build | `npm run standalone:build` | clean |
| browser verification | `npm run standalone:verify` | **11 / 11 pass** |

### Production isolation, measured

`dist-standalone/` was built from the stage's starting tree and from the final
tree and the two were compared file by file:

```
165b15afe01dacc4c1cd788b037094472717aa7ffbf5654967f79ae650341446   before
165b15afe01dacc4c1cd788b037094472717aa7ffbf5654967f79ae650341446   after
```

Byte-identical. Nothing outside `src/core/wallspec/` imports `wallspec`, and
`grep` confirms it: the analyzer, OCR, EvidenceGraph, repair loop and camera
scoring are unchanged and unaware of this contract. The one console 404 the
browser verification reports is pre-existing and unrelated.

## 15. Limitations

1. **A `PLANE` top is a plane.** A wall under a hip, a valley or a dormer cheek
   meets more than one surface, and this stage compiles one. Such a wall would
   need either several profiles along `u` or a polygonal top, and neither is
   written down here.
2. **The plane is stated, not derived.** That is what makes the interface check
   real, but it also means a fixture author can state the wrong plane. The check
   that they did not is the interface oracle, which is a test, not a compile-time
   guarantee: `building.ts` verifies only that the named roof *exists*.
3. **One opening per profiled wall.** Inherited from STAGE WEB-PIVOT-02 and
   unchanged: two raked heads could cross and reorder the bands the tiling pairs
   up, so a second opening is refused by name.
4. **The 1.7 µm residual on Marcowki is real**, and it is the gold file's
   five-decimal rounding, not float noise. It will stay until the gold file
   records the eave to more decimals or the fixture states the plane from the
   eave and ridge levels instead of the pitch. It is four orders of magnitude
   below drawing precision and is not worth spending on now.
5. **`ROOF_SOFFIT` faces are still emitted.** They are tagged and excluded from
   facade measures, but a renderer that wants them culled has to do the culling.
6. **`overhangM` is 0** in the gold spec. A real overhang would put the soffit
   plane's crossing outside the wall's outer face; the arithmetic handles it,
   but no fixture exercises it.

## 16. Recommended next bounded step

**One whole-shell solid audit.** Now that wall/roof contacts are exact rather
than approximate, scan the entire compiled building — every wall, slab and roof
— and prove two things with the existing oracles and no new contract: that the
sum of the individual element volumes equals the volume of their union (no
double-filled material anywhere, not only at the eaves), and that a dense grid of
vertical lines through the footprint meets no interior void between elements that
are meant to touch. That would catch any remaining interface of this class —
slab-to-wall, garage-to-main, flat-roof-to-parapet — in one measurement, instead
of finding them one stage at a time.

Nothing else. No SourcePackage, no OCR, no plan parsing, no camera-verifier
migration.

---

`PASS_STAGE_WEB_PIVOT_02A_EAVE_SOFFIT_CLOSURE`
