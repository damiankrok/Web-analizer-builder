# STAGE WEB-PIVOT-05A — roof features, and the completeness of the manual gold

## 1. Starting checkpoint HEAD

`425d7f9428dd5f6ba2c2e6addaea36b17026f87d` — *WIP checkpoint: unverified STAGE
WEB-PIVOT-05A roof features (not a stage pass)*.

The checkpoint was not authored by the session that finished the stage. It was
found uncommitted in the working tree, written on 2026-09-13 between 18:02 and
18:15 — after STAGE WEB-PIVOT-05 was committed at 17:20 — and committed
unchanged so that a container reclaim could not destroy it. Per §0 of this
stage's brief it is an authorized safety checkpoint and not a stage pass;
nothing in it was reset, discarded, cleaned, stashed or recreated.

| | |
|---|---|
| branch | `claude/new-session-pvd4ik` |
| STAGE WEB-PIVOT-05 implementation | `05d2247dbd706446d5ba2e5a680fb737bb4798a9` |
| STAGE WEB-PIVOT-05 parent | `a44081d9739afa45b8cc8f52dfec651d30defe41` |
| baseline at start | branch, HEAD and clean worktree all as §1 expects; no OWNER changes beyond the checkpoint, so `BLOCKED_…_UNSAFE_BASELINE` did not apply |
| final implementation HEAD | §2 below |

## 2. Final implementation HEAD

`04c1671` — *STAGE WEB-PIVOT-05A: roof features, and the manual gold completed*,
committed on top of the checkpoint. The HEAD that carries this line is the
commit after it.

## 3. Branch

`claude/new-session-pvd4ik`, throughout. The finished work is a **new commit on
top of** the checkpoint; the checkpoint was not amended and remains in history
as evidence of the interrupted work.

## 4. Checkpoint reconciliation — kept, changed, removed

Every changed and new file in `425d7f9` was mapped to this brief's numbered
requirements before anything was written.

### Kept, because it satisfies the brief

| file | requirement | why it was kept |
|---|---|---|
| `src/core/wallspec/roof.ts` (+611) | §7 | Plane-local tiling done properly: `RoofPlaneFrame`, `PlaneRect`, `planeTiling`, `planeRectMinus`, and `RoofOpeningSpec` / `RoofOpeningFillSpec` in plane-local UV. Reveals are *derived from the emitted triangles*, not from the spec, so a hole that was never lined cannot claim to be. The fill is sized from the unit and not from the hole, so a hole cut too small produces measurable overlap instead of a silent clip. The pane is a surface, not a solid, so rays pass through it. Eight new structured diagnostic codes. |
| `src/core/wallspec/architectural.ts` (+44) | §11 | `MassSpec` with an explicit `kind`, plan footprint, base/top, owner storey, `penetratesRoofIds` and provenance — and the penetration claim deliberately separate from the roof's own cut. |
| `research/gold/marcowki-roof-features-v1.json` | §5, §6, §10 | Re-verified against source, below. |
| `src/core/wallspec/marcowki-roof-features-fixture.ts` | §18 | Already carried ten mutation levers matching §18's ten defects. |
| `src/core/wallspec/building.ts` (+146) | §7 | Threads openings and fills to `compileRoofs` as optional trailing arguments, so every pre-existing caller compiles unchanged. |
| `src/core/wallspec/marcowki-facade-fixture.ts` | §16 | The `MarcowkiSceneExtension` hook itself is sound: two optional spec transforms, identity by default. |

### Changed

| what | why |
|---|---|
| `tests/roof-feature-oracles.ts` — `roofOpeningCutReport.throughM` | Probed along the plane normal, which is the wrong question. See §12 below. |
| `tests/roof-feature-oracles.ts` — `roofOpeningCutReport.strayFillM` | Same defect, same fix. |
| `tests/roof-feature-oracles.ts` — `chimneyClearanceM` | Returned `NaN` on every call. Rewritten as a plan-space measurement. |
| `marcowki-roof-features-fixture.ts` — `fillWithoutCut` | The mutation did not build the defect it claimed. See §16 below. |
| `marcowki-facade-fixture.ts` — doc placement | §16 of the brief; the fix is comment movement only, no code. |

### Removed

The fourteen `scripts/_*` scratch probes the checkpoint preserved, plus six more
written while auditing it. See §15.

### Added

| file | lines | what |
|---|---:|---|
| `tests/marcowki-roof-features.test.ts` | 481 | The dedicated Stage-05A suite: 39 tests including the ten mutations and the generic-contract block. |
| `scripts/marcowki-roof-features-diagnostic.ts` | 300 | The named diagnostic and its eleven views. |
| `scripts/roof-feature-measure.ts` | 152 | The promoted raster tool behind this stage's three source-derived claims. |

## 5. Files changed

Against the checkpoint: 3 modified, 3 added, 14 deleted. Against STAGE
WEB-PIVOT-05 (`a44081d`), the stage as a whole adds `roof.ts` +611,
`building.ts` +146, `architectural.ts` +44, the roof-features gold, fixture,
oracles, test suite, diagnostic and measurement tool, and touches
`marcowki-facade-fixture.ts` for the extension hook and its doc placement.

## 6. The slab conflict, and the accepted resolution

Two gold files described `slab_upper_floor` and did not agree. STAGE
WEB-PIVOT-05's report could only record the disagreement; this stage settles it
from the section.

| | polygon |
|---|---|
| old shell polygon | x 0.450..7.450, z 0.450..12.150 — the main body inset by the 0.45 m external wall |
| old interior polygon | x 0.000..7.900, z 0.000..12.600 — the whole outline |
| symptom | the ground walls run their full thickness from 0.00 to 3.06, so a plate on the interior's outline occupies the same 0.45 m ring over y 2.73..3.06 — 0.33 m of plate inside the wall head, the same material twice |
| checkpoint proposal | one `STRUCTURAL_SLAB` on the bearing rectangle, with separate finish/walkable semantics |
| **accepted resolution** | **the checkpoint proposal, confirmed** — verdict `ONE_PLATE_NOT_TWO_LAYERS` |

§5 of the brief says not to accept it only because it is already written, so its
decisive evidence was reproduced independently. A scan of the section at row 432
— y = 2.90 m, inside the slab band — returns:

```
128..517(390)  668..826(159)  950..1001(52)
```

With x = (px − 128) / 72.66 that is X 0.000..5.353, 7.431..9.605 and
11.312..12.024. Two things follow, and both are the whole argument:

- **The run starts at px 128, which is the wall's *outer* face.** The section
  draws wall and plate as one solid with no hairline between them at the slab
  level. The drawing gives the 0.45 m zone to the wall and shows no bearing
  line inside it, so a plate modelled across that zone would emit the wall's
  material a second time.
- **The gap at X 5.353..7.431 is the stair void**, which STAGE WEB-PIVOT-04
  read from the ground plan as 5.37..7.45. The section and the plan agree to
  0.02 m without either having been fitted to the other.

Final output:

| field | value | status |
|---|---|---|
| structural slab footprint | x 0.450..7.450, z 0.450..12.150 | SOURCE_DERIVED |
| top / bottom / thickness | 3.060 / 2.729 / 0.331 | SOURCE_DERIVED — section column at px 300 reads the band at py 420..444 |
| stair void | `stair_main`, x 5.37..7.45, z 6.79..8.77 | unchanged from STAGE WEB-PIVOT-04 |
| support / edge semantics | bears on the inner faces of the 0.45 m ring on all four sides | SOURCE_DERIVED |
| separate finish semantics | walkable floor = plate − stair void − the two chimney footprints | SOURCE_DERIVED |
| plate area | 81.900 m² | measured |
| walkable floor | 77.125 m² | measured |

Independent checks, all measured on the emitted triangles:

| check | result |
|---|---|
| unexplained slab↔wall positive overlap | **0 m** across all 36 solid elements |
| unsupported slab | none — the plate's four edges land on wall inner faces |
| stair void stays open | a vertical probe in the void meets **0.000 m**, a metre clear of it **0.330 m** |
| room topology and registration | unchanged — STAGE WEB-PIVOT-04's 52 tests pass untouched |

## 7. Side-elevation calibration re-check

The checkpoint recorded a correction to the two side views' vertical origin.
§14 asks for it to be reproduced, and it was:

```
elev_left  (east): topmost roof row py 102 (unbroken run of 572 px from x 277)
elev_right (west): topmost roof row py 102 (unbroken run of 481 px from x 248)
```

Both silhouettes top out at **py 102**. That row is the ridge, so at 58.9 px/m
the origin is 102 + 7.95 × 58.9 = **py 570.3**, not the 575 (west) and 577
(east) STAGE WEB-PIVOT-05 used. **Confirmed**, and used for every 05A
measurement.

**Do STAGE WEB-PIVOT-05's conclusions materially change? No.** The reason is
that the correction moves absolute heights and not heights *of things*: a
height is a difference of two rows, so the origin cancels out of it. Every
figure the correction touches was either a corroboration of a printed dimension
that governs anyway, or an already-recorded unresolved:

| STAGE WEB-PIVOT-05 reading | corrected | effect |
|---|---|---|
| west 90/230 window head 2.38 | **2.30** | improves — now exactly the printed 230 |
| west 140/140 sill / head 0.93 / 2.29 | 0.85 / 2.21 | measured *height* 1.36 m unchanged; the printed 140 still governs and the sill stays 0.90 |
| east garage band top 3.06..3.14 | 2.95..3.03 | widens the cross-view corroboration of the portal head to 2.95..3.10 |
| portal head top 3.08 | **3.08** | unchanged — it is a FRONT-elevation reading, and the front anchors need no correction (their apexes measure 7.951 and 7.950 against the printed +7,95) |

The STAGE WEB-PIVOT-05 report has **not** been rewritten. The correction is
recorded here, which is where §14 asks for it.

## 8. Rooflight inventory

§6 says not to trust the checkpoint's count of three. It was verified from
source, twice, on two independent kinds of drawing.

**Attic plan.** Exactly three 78/118 callouts and no others; the plan's other
callouts are 234/303 twice, 270/320 once, and the 140/220 pair STAGE
WEB-PIVOT-05 leaves unresolved. STAGE WEB-PIVOT-05's own transcription
independently recorded three.

**Elevations.** A scan of the roof band for sky-reflecting pixels, with a
threshold calibrated against sampled tile (b−r 12..20 at luminance 80..105) and
sampled pane (b−r 38..56 at 184..198):

```
west: 2 glazed patches   z 5.689..6.267 (centre 5.978)   z 7.913..8.474 (centre 8.194)
east: 1 glazed patch     z 7.878..8.456 (centre 8.167)
```

**Three, counted twice, from two kinds of drawing. Verdict: THREE** — the
checkpoint's count confirmed, not assumed.

| id | host roof | host plane | plane-local UV | size | plan x | plan z | room below | source | status |
|---|---|---|---|---|---|---|---|---|---|
| `rl_pralnia_w` | `roof_main_gable` | `:slope_minus` | u 7.008, v 1.177 | 0.78 × 1.18 | 0.450..1.354 | 5.618..6.398 | `u_pralnia` | attic plan symbol py 407..437; west elevation patch centre 5.978 (0.030 m away) | SOURCE_DERIVED |
| `rl_lazienka_w` | `roof_main_gable` | `:slope_minus` | u 9.167, v 1.177 | 0.78 × 1.18 | 0.450..1.354 | 7.777..8.557 | `u_bathroom` | attic plan symbol py 488.8..518.2; west elevation patch centre 8.194 (0.027 m away) | SOURCE_DERIVED |
| `rl_schody_e` | `roof_main_gable` | `:slope_plus` | u 9.167, v 1.177 | 0.78 × 1.18 | 6.546..7.450 | 7.777..8.557 | `u_stairs` | attic plan symbol py 489..518; east elevation patch centre 8.167 (exact) | SOURCE_DERIVED |

The 78/118 unit is `SOURCE_EXACT` — the callout printed in the circle beside
each unit. The lower edge sits 0.45 m from the eave in plan, which is the
external wall's inner face, where each unit's dashed plan symbol begins.

### The cuts are real (§8)

| rooflight | roof through the hole¹ | roof beside it (min) | reveal faces | reveal area | fill in the hole | fill outside it¹ |
|---|---:|---:|---:|---:|---:|---:|
| `rl_pralnia_w` | **0.000 m** | 0.143 m | 8 | 0.928 m² | 0.211 m | **0.000 m** |
| `rl_lazienka_w` | **0.000 m** | 0.143 m | 8 | 0.928 m² | 0.211 m | **0.000 m** |
| `rl_schody_e` | **0.000 m** | 0.143 m | 8 | 0.928 m² | 0.211 m | **0.000 m** |

¹ `through` and `stray` are **sums over a sampling grid**, not single-ray
depths: 25 vertical probes inside the hole and 20 on a ring outside it. Zero
therefore means every probe found nothing, which is the point — one thin spot
cannot hide in an average. For scale, the same `through` figure on the
mutation-1 mutant, where the hole was never cut, is 6.889 m.

No duplicate solid anywhere in the house (§17).

## 9. The roof-opening contract

§7's requirements, each with what establishes it:

| requirement | how it is met | evidence |
|---|---|---|
| coordinates in roof-plane local 2D | `RoofOpeningSpec.centerUV` / `sizeUV` in the host `RoofPlaneFrame` | contract |
| roof genuinely cut through full thickness | `planeTiling` tiles around the hole and each piece is extruded the plane's full vertical drop | vertical probe through every hole reads 0.000 m |
| reveal / jamb surfaces exist | the tiling's own side faces, *named by asking the geometry* whether each lies on a hole boundary — not from a spec list | 8 faces and 0.928 m² per rooflight, 12 and 0.59..0.67 m² per penetration |
| frame and glazing separate from the roof | `ROOF_FRAME` and `ROOF_GLAZING` parts, sized from the unit rather than the hole; the pane is a surface, not a solid | a ray passes through every pane |
| rigid-transform invariance | tested on a synthetic bare gable compiled twice, ridge along Z and along X | every plane-local quantity — pitch, lengths, drop, reveal count, reveal area, frame and pane counts — is **identical**; only world coordinates turn |
| no global bbox or facade dependence | `grep` over `roof.ts` finds only the roof's own footprint and its ridge midpoint | audited |
| invalid openings produce structured diagnostics | seven codes, each asserted to fire | `ROOF_OPENING_UNKNOWN_ROOF`, `…_UNKNOWN_PLANE`, `…_OUTSIDE_PLANE`, `INVALID_ROOF_OPENING`, `DUPLICATE_ROOF_OPENING_ID`, `ROOF_OPENINGS_OVERLAP`, `ROOF_FILL_UNKNOWN_OPENING` |
| no Marcowki ids in generic compiler code | `grep -niE 'marcowki\|rl_\|chimney_\|uw_\|shell_\|attic_\|roof_main'` over `roof.ts`, `building.ts`, `architectural.ts` | **no matches** |

A roof with no openings compiles to exactly what earlier stages compiled: same
triangle count, every triangle `ROOF`, no diagnostics.

## 10. Rooflight ↔ room adjacency

| rooflight | roof plane | local UV | room below | found by probe | source | verdict |
|---|---|---|---|---|---|---|
| `rl_pralnia_w` | `roof_main_gable:slope_minus` | u 7.008, v 1.177 | `u_pralnia` | `u_pralnia` | attic plan symbol + west elevation | **MATCH** |
| `rl_lazienka_w` | `roof_main_gable:slope_minus` | u 9.167, v 1.177 | `u_bathroom` | `u_bathroom` | attic plan symbol + west elevation | **MATCH** |
| `rl_schody_e` | `roof_main_gable:slope_plus` | u 9.167, v 1.177 | `u_stairs` | `u_stairs` | attic plan symbol + east elevation | **MATCH** |

The room is found by taking the centre of the opening's own plan footprint and
asking which upper-storey room polygon contains it. Nothing consults the gold's
claim until the two are compared.

No mirrored-plane mistake: the west pair's plan boxes lie entirely west of the
ridge at x 3.95 and the east one entirely east of it, and each unit's host plane
agrees. No impossible wall or void intersection: the whole-house audit finds no
shared volume.

## 11. Chimney / shaft inventory

§10 says not to trust the checkpoint's two. Verified from source on three kinds
of drawing.

**Attic plan:** two solid blocks. **East elevation:** two stacks, read at
z 8.95..9.49 and 4.43..4.99 against the checkpoint's 8.93..9.51 and 4.42..5.04.
**Front and rear elevations:** one chimney silhouette each — both stacks occupy
the same band of x, so they overlap exactly in those two views. Measured with
the promoted tool:

```
front: silhouette x 5.342..6.050 (width 0.708)   rear: x 5.415..6.130 (width 0.715)
```

matching the gold's stated figures exactly. (Each gable view also shows a wider
silhouette at x ≈ 3.2..4.6; that is the roof's own apex, not a stack.)

**Verdict: TWO** — confirmed, not assumed.

| id | kind | plan footprint | base | top | roof planes crossed | source | status |
|---|---|---|---:|---:|---|---|---|
| `chimney_salon` | CHIMNEY | x 5.500..6.110, z 4.420..5.030 | 3.060 | 7.880 | `roof_main_gable:slope_plus` | STAGE WEB-PIVOT-04 read the same block as `uw_chimney`; re-measured here at x 5.484..6.093, z 4.417..5.027, agreeing to 0.017 m | SOURCE_CORROBORATED |
| `chimney_boiler` | CHIMNEY | x 5.484..6.000, z 8.900..9.452 | 3.060 | 7.880 | `roof_main_gable:slope_plus` | attic plan ink px 254..273 × 531..551; east elevation z 8.931..9.508 | SOURCE_DERIVED |

**Chimney or vent?** Both render as substantial masonry stacks 0.55–0.61 m
across, not slim terminals, and each serves a known appliance — the salon
fireplace and the kotłownia. No published elevation of this project shows a
ventilation terminal. The ground plan's four-flue block is recorded as
unresolved rather than modelled, because the attic block and all three
elevations put the stack 1.2 m away from it.

**Stack top.** The gold states 7.88, below the 7.95 ridge. Reproduced: on the
front elevation the stack is absent from rows 103..105 (y 7.883..7.917) and
present from rows 106..108 (y 7.833..7.867), so the top is ~7.88. A scan of the
band above the ridge on all three views finds **zero** stacks, which is the same
fact from the other side.

## 12. Penetration semantics

§11 is explicit that a `penetratesRoofIds` claim is not enough, and the model
honours that: the mass states the relation, and the host roof independently
carries a `PENETRATION` opening. Both are asserted separately.

| stack | continuous | shortest run | roof inside the footprint | roof beside it | worst overlap | clearance (minX / maxX / minZ / maxZ) |
|---|---|---:|---:|---:|---:|---|
| `chimney_salon` | yes | 4.820 m | **0.000 m** | 0.276 m | **0.000 m** | 0.000 / 0.000 / 0.000 / 0.000 |
| `chimney_boiler` | yes | 4.820 m | **0.000 m** | 0.276 m | **0.000 m** | 0.000 / 0.000 / 0.000 / 0.000 |

No positive roof/chimney overlap, no unexplained annular gap, no floating roof
fragments, and the shaft is one unbroken run from the attic floor to 7.88 on
every section. The clearance is zero because no drawing dimensions one, which
§12 asks to be modelled as minimal structural clearance and the gold records as
unresolved.

### Three oracle defects found and fixed

The checkpoint's oracles disagreed with its compiler about what "inside the
hole" means, and the disagreement produced three readings that looked like
geometry faults and were not. All three came from the same root cause.

A hole in a sloped plane is a **vertical** cut. Probing it along the plane
*normal* leaves the hole through its side before reaching the underside: on this
40° roof a 0.2756 m vertical drop displaces a perpendicular projection
0.2756 × sin 40° = **0.1771 m** down-slope. `emitPlane` already knew this — it
finds its reveals with `planeUVofPlanXZ`, a vertical projection, and says why in
a comment. The oracles did not.

| reading | was | diagnosis | now |
|---|---|---|---|
| `strayFillM` on every rooflight | 0.340 m | the ring was sampled 0.12 m out, inside the fill's own 0.177 m perpendicular shadow | **0.000 m** |
| `throughM` on both penetrations | 0.265 / 0.386 m | same, on the through-probe | **0.000 m** |
| `throughM` on the three rooflights | 0.000 m | *happened* to read zero — their rect is large relative to the 0.177 m shift, so the artifact did not surface there | **0.000 m**, now for the right reason |
| `chimneyClearanceM` | `NaN` on every call | measured on a horizontal line at an arbitrary height, which at that `x` either misses the roof or crosses it far from the penetration | **0.000 m**, measured in plan |

The fix was to the oracles, not the compiler: the compiler was right throughout.
What established that — and what makes this worth recording — is that two
*independent* measurements disagreed. `throughM` said roof was left in the
penetration; `roofInsideM` and the pairwise overlap both said nothing was
embedded. Only a cross-check could say which was wrong, which is the argument
for §8's insistence on independent oracles rather than one number.

The fill and the reveal were then confirmed to occupy byte-identical plan boxes
and y ranges — x 0.450..1.354, z 5.618..6.398, y 4.738..5.772 — so the fill does
not extend past the hole at all.

## 13. Roof regression

§13 says not to move the verified roof to fit features. It did not move.

| property | STAGE WEB-PIVOT-05 | now |
|---|---|---|
| declared pitch | 40° | **40°** |
| built pitch, measured from the emitted planes | 40.000° | **40.000°** |
| eave | 4.636 | **4.636** |
| ridge | 7.950 | **7.950** |
| support footprint | x 0..7.90, z −1.00..13.60 | **unchanged** |
| overhang | 0 | **0** |
| thickness | 0.211 | **0.211** |
| wall / soffit closure | STAGE WEB-PIVOT-02A's contact oracles | 71 tests pass unchanged |

Roof continuity away from its registered holes: **0 gaps in 1521 vertical
probes**. The probe grid is nudged off x 3.95 — a vertical ray exactly down the
ridge passes through the shared edge of the two slope prisms, where an entry and
an exit fall at the same distance and cancel. That is a measure-zero sampling
artifact and not a gap: 3.94 and 3.96 both read the full 0.276 m.

Only local cutouts differ, and every one of them is a registered opening.

## 14. Whole-house interface audit

| check | result |
|---|---|
| positive-volume overlap between any two solid elements | **0 pairs**, over 36 elements and a three-axis ray grid |
| rooflight voids | 3, each registered as a `ROOFLIGHT` opening |
| chimney penetrations | 2, each registered as a `PENETRATION` opening with a matching `MassSpec` |
| stair void | 1, `stair_main`, intentional and open |
| facade recesses | 2, unchanged from STAGE WEB-PIVOT-05 |
| unexplained interface gaps | none |

Rooms are intentionally air and are not counted as solids.

## 15. Scratch-tool cleanup and promotions

The checkpoint preserved fourteen anonymous probes; auditing it produced six
more. All twenty are **deleted**. One named tool was promoted in their place:

**`scripts/roof-feature-measure.ts`** — `top`, `patches`, `silhouette` and
`sample`. Every anchor is passed in and nothing is detected, as with
`elevation-measure.ts` from STAGE WEB-PIVOT-05. It reproduces all three of this
stage's raster-derived claims: the side-elevation origin (§7), the rooflight
count and positions (§8), and the chimney silhouettes and stack top (§11).

Two deliberate omissions, both recorded in the tool's own header rather than
papered over:

- **There is no automatic stack counter for a side elevation.** A stack and the
  slope it stands on are the same material and differ only in shading; a
  threshold tuned to one render would be a guess on the next. The `silhouette`
  mode works on the gable views, where a stack is outlined against sky, and the
  count is anchored on the attic plan.
- **A column scan was tried and dropped.** The render draws tile courses, so a
  column through the roof returns nine to twelve short runs rather than one
  extent. Shipping it would have let a reader think it measured something.

Five `scripts/_*` files remain and are **not** this stage's: `_audit.ts`,
`_crop.mjs`, `_dump.ts`, `_inspect.ts`, `_srcaudit.ts` all predate the
checkpoint and belong to earlier stages.

## 16. Mutation results

Ten defects, none ever the default, none committed. Two facts about the
mutations themselves are worth stating: the eleventh is a bonus the fixture
already carried, and mutation 1 **did not work when found** and had to be built
properly.

| # | §18 defect | lever | what catches it |
|---:|---|---|---|
| 1 | rooflight fill without roof cut | `fillWithoutCut` | fill 0.211 m present **and** 6.889 m of roof still through it; zero reveal faces |
| 2 | rooflight mirrored to the wrong plane | `mirrorRooflight` | host plane flips to `slope_minus`, the plan box crosses to the west of the ridge, and the room below is no longer `u_stairs` |
| 3 | rooflight shifted over the wrong room | `shiftRooflight` | the room under the opening's plan centre is no longer `u_bathroom` |
| 4 | roof cut smaller than glazing/frame | `shrinkRoofCut` | frame and roof share measurable volume, because the frame is sized from the unit and not clipped to the hole |
| 5 | chimney inserted without a roof cut | `chimneyWithoutCut` | no `PENETRATION` opening exists; roof inside the stack's footprint > 0.2 m and sections show positive overlap |
| 6 | chimney moved to the wrong plan position | `moveChimney` | the stack leaves its hole behind: roof inside the footprint > 0.2 m |
| 7 | slab reverted to the conflicting old footprint | `revertSlabFootprint` | the plate reaches x 0.000 and the whole-house audit reports it sharing volume |
| 8 | stair void accidentally filled | `interior.fillStairVoid` | a vertical probe in the void meets 0.330 m instead of 0.000 |
| 9 | roof pitch/ridge/eave altered by integration | `moveRidgeM` | the *built* pitch, measured from the emitted planes, moves off 40° by more than 2° |
| 10 | chimney cut leaving unexplained clearance | `growChimneyCut` | a plan-space clearance probe finds a gap > 0.08 m where the gold states zero |
| 11 | STAGE WEB-PIVOT-04's flue wall left beside the new stack | `keepInteriorChimneyWall` | wall and mass share volume |

**Mutation 1 did not build its defect.** As found, suppressing the cut also
suppressed the fill — the compiler rightly refuses a fill naming an opening that
was never cut — so the mutant had no glass and no hole, which is not the defect
§18 names. It now splices two compiles: the fabric from the scene that never cut
the hole, and the unit from the scene that did. That is the honest way to get
glass onto an intact roof; the alternative would be a "declare but do not cut"
flag in the roof compiler, which would put a mutation affordance into generic
code and let the compiler produce the very thing §8 forbids.

## 17. Final gold completeness matrix

| system | state | note |
|---|---|---|
| exterior shell | `COMPLETE` | STAGE WEB-PIVOT-02, unchanged |
| levels / slabs | `COMPLETE` | the upper plate's conflict is resolved here |
| internal walls | `COMPLETE` | STAGE WEB-PIVOT-04; `uw_chimney` promoted to a `MassSpec` |
| rooms | `COMPLETE` | 18 rooms, both storeys |
| doors | `COMPLETE` | 11 interior + 4 exterior, every one a real cut |
| stairs | `COMPLETE` | 17 risers, void open |
| roof | `COMPLETE` | GABLE + FLAT, now with plane-local openings |
| wall / roof closure | `COMPLETE` | STAGE WEB-PIVOT-02A contact oracles |
| facade recesses | `COMPLETE` | both 1.00 m recesses |
| balconies / loggias | `COMPLETE` | 2 balcony slabs + 1 portal head |
| railings | `COMPLETE` | 2 glass balustrades, 4 panels each |
| exterior openings | `COMPLETE` | 12, one through two wall leaves |
| glazing | `COMPLETE` | fills and mullions in every structural hole |
| portal / frame | `COMPLETE` | mouth, jambs, heads |
| rooflights | `COMPLETE` | 3, each a real hole with reveal, frame and pane |
| chimneys / shafts | `COMPLETE` | 2, each through a roof that terminates at it |

No major source-clear architectural system remains absent. Four things are
source-visible and deliberately not modelled — chimney caps, the shafts below
the attic floor, flashings, and a knee-wall lining — and each is
`DEFERRED_NONSTRUCTURAL` with its reason recorded in the gold's
`observedButNotModelled`.

## 18. Diagnostic paths

`npx tsx scripts/marcowki-roof-features-diagnostic.ts` →
`out/marcowki-roof-features/`

| # | file |
|---|---|
| 1 | `01-roof-top-ids.png` — roof from above, rooflight and penetration ids |
| 2 | `02-roof-oblique-west.png` |
| 3 | `03-roof-oblique-east.png` |
| 4 | `04-attic-underside.png` — roof off, the rooms the units open into |
| 5 | `05-rooflight-closeup.png` — reveal, frame and pane in a hole through the full thickness |
| 6 | `06-chimney-closeup.png` — the roof terminating at the stack |
| 7 | `07-chimney-section.png` — the shaft with the roof removed |
| 8 | `08-slab-before.png` — the rejected interior outline |
| 9 | `09-slab-after.png` — the accepted bearing rectangle |
| 10 | `10-front-three-quarter.png` |
| 11 | `11-rear-three-quarter.png` |

## 19. Gates

All run, in this working tree, at the state this report describes.

| gate | command | result |
|---|---|---|
| dedicated Stage-05A tests | `vitest run tests/marcowki-roof-features.test.ts` | **39 passed** |
| Stages 01 / 01B / 01C | `vitest run tests/wall-compiler tests/wall-junction tests/storey-ring` | **84 passed** |
| Stages 02 / 02A | `vitest run tests/marcowki-shell tests/eave-closure tests/roof-compiler` | **71 passed** |
| Stage 03 | `vitest run tests/source-package tests/source-adapter tests/source-resolution` | **64 passed** |
| Stage 04 | `vitest run tests/marcowki-interior.test.ts` | **52 passed** |
| Stage 05 | `vitest run tests/marcowki-facade.test.ts` | **73 passed** |
| full suite | `npx vitest run` | §19a below |
| typecheck | `npx tsc --noEmit -p tsconfig.json` | clean |
| build | `npm run build` | clean |
| standalone bundle + build | `npm run standalone:build` | clean |
| browser verification | `npm run standalone:verify` | **11/11 passed** |
| production A/B/C benchmark | `npx tsx src/node/cli.ts bench` | §19a below |

The browser run logs one console 404, the same pre-existing one earlier stages
recorded; no check depends on it and all eleven pass.

### 19a. Full suite and benchmark

| | |
|---|---|
| full suite | **485 passed, 21 files, 0 failed** (`npx vitest run`) |

485 = the 446 that passed before this stage plus its 39 new tests, so no
pre-existing test changed its result.

Production analyzer scores, re-run with `npx tsx src/node/cli.ts bench`:

| project | before 05A | now |
|---|---|---|
| A — Dom w marcówkach (GE) | 0.21756 | **0.21756** |
| B — Dom w bakopach (G2E) | 0.21175 | **0.21175** |
| C — Dom w kosaćcach 44 | 0.19570 | **0.19570** |

Identical to four decimal places, and the freeze hashes — config, grammar,
metric definitions, thresholds and weights — are unchanged. This is the expected
result: no production file was touched, and the `compileRoofs` signature change
is additive.

## 20. Production isolation

- **Nothing in production imports any of this.** `grep -rn 'wallspec/'` over
  `src/core/pipeline`, `src/core/camera`, `src/core/hypotheses`,
  `src/core/dimensions`, `src/node` and `src/ui` returns nothing: the whole
  `wallspec` tree is unreachable from the URL → model flow.
- **No gold geometry is wired into the automatic flow.** Both gold files are
  read by one development fixture each, and nothing in production imports
  either.
- **Nothing was tuned.** OCR, the mass solver, the camera solver, the repair
  loop and the score weights are untouched; no file under those directories
  changed.
- **The generic compiler changes were source-required and regression-tested.**
  `compileRoofs` gained two optional trailing parameters, so every pre-existing
  caller compiles unchanged, and a roof with no openings emits exactly what it
  emitted before.
- **Production scores are unchanged:** A 0.21756, B 0.21175, C 0.19570, to four
  decimal places. Nothing changed materially, so §22's stop-and-explain did not
  apply.

## 21. Unresolved and assumptions

Modelled as zero because no drawing dimensions them, and recorded rather than
invented:

1. **The clearance cut** around a roof window and around a chimney. Both are
   modelled as zero, which is the minimal structural clearance §12 allows.
2. **How far the upper plate bears into the 0.45 m wall.** The section draws the
   wall as one solid with no leaf line, so the plate is butted to the inner
   face.

Genuinely unresolved:

3. **The kotłownia flue's route.** The ground plan's four-flue block sits at
   x 6.724..7.452 while the attic block and all three elevations put the stack
   at x 5.48..6.13 — either the shaft offsets ~1.2 m between storeys, or the
   ground block is a separate ventilation stack. Neither reading changes the
   roof penetration, which all three elevations agree on.
4. **The west face of `chimney_boiler`.** Read here as x 5.484 and by STAGE
   WEB-PIVOT-04 as 5.50 for the salon stack. The 0.016 m between them is under
   one pixel and is left standing rather than reconciled by fiat.
5. **Whether the stacks really finish below the ridge.** Two elevations agree on
   7.88 against a ridge of 7.95 — 0.07 m, inside what a render measurement can
   claim. Carried as measured, not rounded up.

Deferred, non-structural: chimney caps; the shafts below the attic floor
(carrying either down would mean cutting STAGE WEB-PIVOT-04's interior walls and
the upper slab, which §3 puts out of bounds); flashings and soakers, which no
published drawing shows; a 0.116 m knee-wall lining band; and ventilation
terminals, none of which appears on any published elevation.

## 22. Result

Three jobs, all three done and measured:

- **the upper-floor slab conflict is reconciled** — one plate on the bearing
  rectangle the section supports, with the walkable floor separated from it only
  where something stands on it, and zero shared volume anywhere in the house;
- **all three source-supported rooflights are real roof-plane openings** — 0.000 m
  of roof through each, lined reveals, frame and pane in the cut, each over the
  room the plan puts it over;
- **both source-supported chimneys are real roof-penetrating geometry** — one
  unbroken shaft each, zero roof inside the footprint, zero overlap, zero
  unexplained gap, with the roof independently carrying the matching cut.

`PASS_STAGE_WEB_PIVOT_05A_GOLD_COMPLETENESS`

## 23. Recommended next bounded step

**Carry the two chimney shafts down through the storeys they actually start
in.** Both stacks are modelled from the attic floor at 3.06 upwards, because
that is where the attic plan draws them; the ground plan draws the salon flue at
x 5.39..5.97, z 4.51..4.99 and a four-flue block in the kotłownia at
x 6.724..7.452, z 9.059..9.589, and neither is modelled. It is the one remaining
place where a source-drawn solid stops at a storey boundary for a modelling
reason rather than a source one.

The step is bounded the way STAGE WEB-PIVOT-02A was. `MassSpec` already exists
and already states its own base and top, so no new contract is needed; what is
needed is the penetration relation extended from roofs to slabs and interior
walls — one `penetratesSlabIds`, the same independent-cut rule §11 established,
and the oracles this stage already has (`chimneyPenetrationReport` works on any
horizontal plane). It would also settle unresolved item 3 above, because
carrying the kotłownia shaft down forces the question of whether the ground
plan's four-flue block is the same stack or a separate ventilation one.
