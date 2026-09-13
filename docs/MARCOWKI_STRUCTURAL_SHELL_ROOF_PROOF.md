# STAGE WEB-PIVOT-02 — source-verified Marcówki structural shell + roof compiler

Development-only. A hand-transcribed, source-cited description of the real
Marcówki exterior shell — two levels, a recessed upper storey, a main gable roof
and a flat roof over the garage — compiled into geometry, and that geometry
measured against the drawings it was read from.

No production module was modified. The shipped standalone bundle rebuilds to the
same hashes and the same byte counts as the one already published.

---

## 1. Baseline

| | |
| --- | --- |
| Branch | `claude/new-session-pvd4ik` |
| Starting HEAD | `f73ae7f3a60f27ed98626c5bd384dc5d86bd7e31` (matched the expected SHA) |
| Final HEAD | recorded in the follow-up commit below — a commit cannot name its own hash |
| Working tree at start | clean |

## 2. Files changed

| File | Status | Role |
| --- | --- | --- |
| `research/gold/marcowki-exterior-shell-v1.json` | new | the gold spec: 32 observations, each with source, locator, interpretation and status |
| `src/core/wallspec/architectural.ts` | new | `BuildingSpec`, `LevelSpec`, `StoreyShellSpec`, `SlabSpec`, `RoofSpec`, `Provenance` |
| `src/core/wallspec/roof.ts` | new | GABLE and FLAT compiler; `UNSUPPORTED_ROOF_KIND` for the rest |
| `src/core/wallspec/building.ts` | new | orchestrator; tagged `BuildingTri` output |
| `src/core/wallspec/roof-fixtures.ts` | new | Fixture A, synthetic roof sanity |
| `src/core/wallspec/marcowki-fixture.ts` | new | Fixture B, assembled from the gold file |
| `src/core/wallspec/contracts.ts` | modified, additive | `WallTopProfile`, `OpeningSpec.heightFarM`, three diagnostic codes |
| `src/core/wallspec/compile.ts` | modified | the profiled-wall path, dispatched only for shapes the old one cannot express |
| `tests/geometry-oracles.ts` | modified, additive | `measureRoofPlanes`, `materialRuns`, `verticalProfileAt` |
| `tests/roof-compiler.test.ts` | new | 9 checks, Fixture A |
| `tests/marcowki-shell.test.ts` | new | 31 checks, Fixture B |
| `scripts/marcowki-shell-diagnostic.ts` | new | console report and ten renders |
| `scripts/source-measure.ts` | new | the ink-profiling tool behind every derived figure |
| `docs/MARCOWKI_STRUCTURAL_SHELL_ROOF_PROOF.md` | new | this report |

Three tracked files modified, all inside the development-only `wallspec` and
`tests` areas: 475 insertions against 5 deletions. Nothing in `src/node`,
`src/web`, `src/ui`, `src/core/pipeline`, `src/core/hypotheses` or `fixtures/`
was touched, and **no module outside `src/core/wallspec/` imports any of it** —
checked by grep, reported in §21.

## 3. The new minimal ArchitecturalSpec

Not a BIM schema. Only what this shell needs.

- **`LevelSpec`** — a named horizontal datum with a kind: `TERRAIN`,
  `GROUND_FFL`, `UPPER_FFL`, `EAVE`, `RIDGE`, `FLAT_ROOF_TOP`. The section
  carries five different vertical lines and they mean different things;
  collapsing them into a list of slabs throws away the only information that
  says which one a roof bears on.
- **`StoreyShellSpec`** — STAGE WEB-PIVOT-01C's ring, with a base level, a top
  level and a name.
- **`SlabSpec`** — footprint, top level, thickness, owning storey. The footprint
  is stated rather than derived from the walls, so the plate can be *checked*
  against them instead of agreeing with them by construction.
- **`RoofSpec`** — kind, an **explicit** support footprint, eave and ridge
  levels, ridge axis, declared pitch, overhang, thickness, supporting shell.
- **`Provenance`** on every one of them: source, locator, interpretation, and a
  `SpecStatus` of `SOURCE_EXACT` / `SOURCE_CORROBORATED` / `SOURCE_DERIVED` /
  `ASSUMPTION` / `UNRESOLVED`.

`WallSpec` is reused unchanged apart from one optional field, `topProfile`, and
`OpeningSpec` gains one, `heightFarM`. Both are absent on every wall the earlier
stages compile, and a wall without them goes through the proven rectangular path
byte for byte.

## 4. The gold spec, and how it was verified

`research/gold/marcowki-exterior-shell-v1.json`. Every figure was read from the
official drawings and then **measured independently** off the decoded raster, so
that a transcription error and a reading error would have to agree to get
through. The tool is committed (`scripts/source-measure.ts`), so any of it can
be repeated.

### Scale, established twice on each drawing

- **Ground plan**: the printed chain `1205` spans the outer wall faces at
  x = 58…514, 457 px → 37.93 px/m. The chain `1260` spans y = 259…735, 477 px →
  37.86 px/m. Independent, and they agree to 0.2 %.
- **Section**: the five printed datum markers sit at rows 65 / 303 / 420 / 642 /
  665 for `+7,95` / `+4,67` / `+3,06` / `±0,00` / `−0,32`. **Every pair** of them
  gives between 72.55 and 72.67 px/m — so the five printed levels are mutually
  consistent with one linear scale to about 0.15 %, which is what makes them
  usable at all.

### The candidate observations in the brief, checked

| Candidate | Verdict |
| --- | --- |
| main plan chain ~1205 cm | **Confirmed.** Printed `1205`, and it closes as `790 + 415` against a dividing wall the drawing actually shows. |
| depth chain ~1260 cm | **Confirmed.** Printed `1260`, closing as `510 + 750` against a wall at y = 452. The 100 cm segments above and below it are the rear terrace and the entrance canopy, outside the building. |
| section levels +7.95 / +4.67 / +3.06 / ±0.00 / −0.32 | **Confirmed**, all five, and mutually consistent as above. |
| published height ~8.27 m | **Confirmed** in the published facts table. |
| roof pitch 40° | **Confirmed twice.** Printed `40°`; and a least-squares fit of the right roof edge over rows 80…220 gives **40.014°** with a maximum residual of 0.61 px. |
| knee wall 1.30 m | **Confirmed.** Printed `130`; the dimension's ticks at rows 325 and 420 span 95 px = 1.309 m. |
| external wall 25 + 20 cm | **Corroborated, not printed.** The section fills 33 px (0.455 m) and the plan 18 px (0.475 m). Both round to the 0.45 m a 25 + 20 build-up implies; no figure states it, so the status is `SOURCE_CORROBORATED`. |

### Datum semantics

The brief's interpretation is what the source says. `+7,95` is the ridge above
the ground finished floor; `−0,32` is terrain; and

```
7.95 + 0.32 = 8.27 m
```

is exactly the published `building height`. The two descriptions of the same
height agree, so the datum reading is settled rather than assumed.

### The eave, which the source states twice and differently

The printed datum is `+4,67`. Measured off the section ink, the roof's top
surface crosses the outer wall face at **+4.64**. The model uses a **derived**
eave,

```
eave = ridge − (span / 2) × tan(pitch) = 7.95 − 3.95 × tan 40° = 4.63556 m
```

because that is the value for which the three *printed* figures — span 7.90,
pitch 40°, ridge +7.95 — are simultaneously true. Taking the printed `+4,67`
instead would make the geometry's pitch 39.71° against a printed 40°. The
printed datum is recorded as corroborating evidence 0.034 m above the structural
plane, and the report says so rather than choosing silently.

### The knee wall reconciles the wall top with the roof

The printed `130` puts the masonry top at +4.36; the roof plane is at +4.63556.
The 0.27556 m between them is 0.21109 m measured perpendicular to a 40° plane,
and taking **that** as the roof build-up makes the roof's underside land exactly
on the knee wall. Two printed figures that look unrelated then close with no gap
and no overlap. The attic walls therefore stop at the roof's **underside**:
stopping them at the eave plane would bury 0.276 m of roof inside the wall.

### Provenance summary

32 observations: **20 `SOURCE_EXACT`**, **3 `SOURCE_CORROBORATED`**,
**9 `SOURCE_DERIVED`**, **0 `ASSUMPTION`** and **0 `UNRESOLVED`**. A test asserts
that every value the compiler uses is `SOURCE_EXACT`, `SOURCE_CORROBORATED` or
`SOURCE_DERIVED`, so an assumption cannot become geometry without the suite
failing.

## 5. Assumptions and unresolved values

No assumption is used as a dimension. Three things the source did not settle are
recorded in the gold file and are **not** compiled as if they were known:

1. **Verge projection at the gable ends.** Not dimensioned. The band above the
   attic's rear wall on the upper plan measures exactly the 100 cm rear terrace
   the ground plan gives, so the model uses zero overhang; a small verge would
   not show at this scale.
2. **Head clearance above the gable opening.** Not dimensioned. The model takes
   the printed `320` at the tall edge, leaving 1.68 m of cladding above it; the
   elevation render suggests nearer 1.3 m. The dimensioned callout is preferred
   over the render, and the difference is reported.
3. **House/garage partition thickness.** One 0.45 m wall in the drawings. This
   stage's ring compiler has no shared-wall or T-junction semantics, so the two
   shells each carry their own wall and the modelled partition is 0.90 m. The
   exterior envelope is unaffected; the garage's internal area is about 2.6 m²
   short as a result.

Six further things were **observed and deliberately not modelled**, each with a
reason: the two 234/303 rear-gable openings, the three 78/118 roof windows, the
balcony slab, the chimney, the ground-storey openings, and the terrace and
canopy. They are listed in the gold file so that their absence is a decision
rather than an oversight.

## 6. Stacked storeys

Three shells, each compiled from its own walls and its own junctions, none of
which knows the others exist:

| Shell | Base | Top | Ring closed | Wall volume |
| --- | --- | --- | --- | --- |
| `shell_ground_main` | 0.000 | 3.060 | yes | 53.978 m³ |
| `shell_ground_garage` | 0.000 | 2.540 | yes | 24.575 m³ |
| `shell_attic` | 3.060 | 7.950 | yes | 32.203 m³ |

Measured, not assumed: a vertical line through the left wall returns **one
unbroken run** from 0.000 to 4.360 — two storeys of separate solids standing on
each other with no seam. Sweeping vertical lines across the plan, **no run of
lower-storey material ever shares a length with upper-storey material**.

The ground storey's top and the attic's base are the same level, `+3.06`, and
that level is the printed `+3,06`.

## 7. The floor plate

Top at `+3.06`, 0.33 m thick, spanning the main body's interior. A vertical line
through the middle of the room meets it and nothing else below the roof, and the
run it returns is 0.330 m long. It is inside the walls rather than through them,
so no volume is counted twice.

## 8. The recessed upper storey

The attic occupies the main body's footprint and stops there, so its right wall
sits **4.15 m inboard** of the building's own right facade — measured off the
emitted geometry, not read from the spec. That is RC03's condition at nearly
seven times the legacy 0.6 m tolerance.

The real building has no window on that wall: the attic plan's three `78/118`
callouts are roof windows, which the right elevation shows in the slope. The
stage brief allows a dedicated diagnostic wall, so the proof uses a **stated,
non-source diagnostic opening** on the real recessed wall, off by default so the
gold shell stays source-only. With it:

- the opening is cut, and its triangles are hosted by `attic_right`;
- a ray through it crosses **no** wall material, while a ray 2 m to the side
  crosses exactly 0.45 m of it;
- pushing the whole attic another 1.5 m further from the facade leaves the
  opening at **exactly** the same host-local position, `u` 4.000…5.000.

The compiler also refused a first attempt at that opening — 1.0 m tall on a 1.30
m knee wall — by name (`OPENING_OUTSIDE_HOST`) rather than clipping it to fit.

## 9. The gable roof, measured from the triangles

`RoofSpec.pitchDeg` is **never read when building the geometry**. Each slope is
built from the eave level, the ridge level and the support footprint's half-span.

| | |
| --- | --- |
| declared pitch | 40° (printed on the section) |
| **measured pitch, from the emitted normals** | **39.99997°** |
| eave, from the emitted vertices | 4.63556 m |
| ridge | 7.950 m |
| horizontal run | 3.950 m |
| rise | 3.31444 m |
| `tan(measured pitch) × run` | **3.31444 m** |
| area per plane | 64.970 m² |

The identity holds to nine decimal places, and it relates two things measured
separately: the angle comes from the face normals, the rise and run from the
vertex positions.

Both slopes report identically and their normals mirror across the ridge, which
runs front to back (`|normal.z| < 1e-9`).

## 10. The flat roof

A separate element with its own support footprint.

| | |
| --- | --- |
| measured pitch | **0.000000000°** |
| rise | 0.000 m |
| top | 2.880 m |
| area | 31.125 m² = 4.15 × 7.50 |
| bounds | exactly the garage rectangle |

Its underside, 2.880 − 0.340 = **2.540**, lands exactly on the garage walls'
top, so the two meet with no gap and no overlap. It inherits nothing from the
gable: the two roofs share no level, no footprint and no triangle.

## 11. Roof support and overhang

The roof's extent comes from `RoofSpec.footprint`, which is stated. Two tests
pin that down:

- **Shrinking the wall under it changes nothing.** Moving `attic_right` 1.2 m
  inboard leaves the gable roof's triangles **deep-equal** to before — same run,
  same area, same vertices. This is the direct answer to the legacy "a recess
  changes the whole mass" behaviour.
- **Widening the RoofSpec does change it.** Adding 1.0 m to the footprint's
  `maxX` moves the measured half-span to 4.45 m.

Overhang is zero, from the source: the section's roof edge lands on the outer
wall face at x = 128…129 rather than beyond it. The compiler supports a non-zero
overhang and Fixture A exercises it (0.5 m, dropping the eave by 0.5 m at a 45°
pitch, and lengthening the slope past both gable ends).

## 12. Gable wall closure

The gable ends are **wall solids**, not triangular patches: closed, consistently
wound, and their volume is the rectangle plus the triangle times the thickness,
checked against arithmetic on the gold dimensions.

A vertical line through the gable wall, at seven positions across it, meets the
wall and then the roof with **no daylight and no shared solid**:

```
  x=0.40  wall [3.060, 4.696]   roof [4.696, 4.971]
  x=1.50  wall [3.060, 5.619]   roof [5.619, 5.894]
  x=3.00  wall [3.060, 6.877]   roof [6.877, 7.153]
  x=3.60  wall [3.060, 7.381]   roof [7.381, 7.656]
  x=5.29  wall [5.127, 6.550]   roof [6.550, 6.826]
  x=6.90  wall [3.060, 5.199]   roof [5.199, 5.475]
  x=7.50  wall [3.060, 4.696]   roof [4.696, 4.971]
```

The wall's top **is** the roof's underside at every position, to five decimal
places — the gold file records the derived build-up to five, so the two sides of
that identity can differ by that rounding and no more.

At x = 5.29 the wall starts at 5.127 rather than 3.060 because that line passes
through the gable opening.

## 13. The gable opening

One structural opening, 2.70 m wide, sill at the attic floor, head **raked
parallel to the roof** — because a level head is impossible here: a 2.70 m
opening 3.20 m tall starting 3.94 m along the wall would project 0.67 m out
through the gable. The front elevation shows the raked head, and its near edge
sits directly under the ridge, which the elevation confirms independently (the
glazing's left edge is at image x = 610 against a ridge apex at x = 607).

- It **crosses the eave line**: at its centre the wall is void from 3.060 to
  5.127, and the attic's rectangular zone ends at 4.360.
- **Wall material is really removed**: the gable wall's volume drops by exactly
  the trapezoid the opening describes, `(3.20 + 0.93443) / 2 × 2.70 × 0.45`.
- It is **one hole, not one per panel**: the volume identity above would not hold
  if the cut had been split, and the emitted reveals carry one `openingId`.
- Glazing fills it at half the wall thickness, is tagged separately, and adding
  it to the wall's mesh opens the surface — which is how we know it is not part
  of the solid.

The compiler refuses a raked opening that would reach past the profile
(`OPENING_ABOVE_WALL_PROFILE`) rather than clipping it.

## 14. Compiler output

Every triangle carries `elementKind`, `elementId`, `storeyId`, `levelId`,
`provenanceSource`, the material `part`, the host `wallId`, and where it applies
`openingId` and `contactId`. Asserted for all 234 triangles. The Three.js viewer
is an adapter over this list and is not the record; nothing in the product UI was
changed.

## 15. Gold-field comparison

| Field | Gold value | Source | Status | Compiler output | Delta | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| overall plan width | 12.05 m | plan chain `1205` | SOURCE_EXACT | 12.050 | 0.000 | **MATCH** |
| overall plan depth | 12.60 m | plan chain `1260` | SOURCE_EXACT | 12.600 | 0.000 | **MATCH** |
| main body width | 7.90 m | plan chain `790` | SOURCE_EXACT | 7.900 | 0.000 | **MATCH** |
| garage width | 4.15 m | plan chain `415` | SOURCE_EXACT | 4.150 | 0.000 | **MATCH** |
| garage depth | 7.50 m | plan chain `750` | SOURCE_EXACT | 7.500 | 0.000 | **MATCH** |
| ground FFL | 0.00 m | section `±0,00` | SOURCE_EXACT | 0.000 | 0.000 | **MATCH** |
| upper FFL / slab top | 3.06 m | section `+3,06` | SOURCE_EXACT | 3.060 | 0.000 | **MATCH** |
| terrain offset | −0.32 m | section `−0,32` | SOURCE_EXACT | −0.320 | 0.000 | **MATCH** |
| knee wall top | 4.36 m | section `130` | SOURCE_EXACT | 4.360 | 0.000 | **MATCH** |
| ridge | 7.95 m | section `+7,95` | SOURCE_EXACT | 7.950 | 0.000 | **MATCH** |
| eave (structural plane) | 4.63556 m | derived from span, pitch, ridge | SOURCE_DERIVED | 4.63556 | 0.000 | **MATCH** (to its own derivation) |
| eave (printed datum) | 4.67 m | section `+4,67` | SOURCE_EXACT | 4.636 | −0.034 | **CLOSE** — the datum marks the wall assembly's top, the model the structural plane |
| emitted roof pitch | 40° | section `40°`, fit 40.014° | SOURCE_EXACT | **39.99997°** | −0.00003° | **MATCH** |
| external wall thickness | 0.45 m | 25 + 20 build-up, measured 0.455 / 0.475 | SOURCE_CORROBORATED | 0.450 | 0.000 | **MATCH** |
| garage roof kind | FLAT | section, upper plan, elevation | SOURCE_EXACT | FLAT, measured 0.000000000° | 0 | **MATCH** |
| garage flat roof top | 2.88 m | section, row 433 | SOURCE_DERIVED | 2.880 | 0.000 | **MATCH** |
| building height above terrain | 8.27 m | published facts | SOURCE_EXACT | 8.270 | 0.000 | **MATCH** |
| footprint area | 131.16 m² | published facts | SOURCE_EXACT | 130.665 | −0.495 (−0.38 %) | **CLOSE** |
| recessed upper-wall relation | 4.15 m | upper plan against ground plan | SOURCE_DERIVED | 4.150 | 0.000 | **MATCH** |
| gable opening width | 2.70 m | callout `270/320`, measured 2.695 | SOURCE_EXACT | 2.700 | 0.000 | **MATCH** |
| gable opening height (tall edge) | 3.20 m | callout `270/320` | SOURCE_EXACT | 3.200 | 0.000 | **MATCH** against the callout; the elevation render places it ≈0.35 m lower — **SOURCE_UNRESOLVED** against the render |
| gable opening offset | 3.94 m | upper plan, 149 px | SOURCE_DERIVED | 3.940 | 0.000 | **MATCH** |
| gable opening head rake | parallel to the roof | front elevation | SOURCE_CORROBORATED | raked at the roof pitch | — | **MATCH** |
| attic footprint | = main body | upper plan | SOURCE_CORROBORATED | 7.900 × 12.600 | 0.000 | **MATCH** |
| house/garage partition | 0.45 m | plans, section | SOURCE_CORROBORATED | 0.900 (two abutting walls) | +0.450 | **SOURCE_UNRESOLVED** — no shared-wall semantics at this stage |

No `ASSUMPTION` appears in this table, and none is called a match.

## 16. Orthographic metric diagnostics

```
npx tsx scripts/marcowki-shell-diagnostic.ts        # -> out/marcowki-shell/
```

The console report prints all of §15 measured from emitted triangles, plus the
per-shell closure, the roof planes, the gable section table of §12 and the eaves
wedge of §18. Renders:

| File | View |
| --- | --- |
| `01-ortho-front.png` | front elevation |
| `02-ortho-rear.png` | rear elevation |
| `03-ortho-left.png` | left elevation |
| `04-ortho-right.png` | right elevation |
| `05-front-three-quarter.png` | front 3/4 |
| `06-rear-three-quarter.png` | rear 3/4 |
| `07-ortho-top.png` | top, entrance facade at the bottom |
| `08-roof-off.png` | roofs removed, the upper shell exposed |
| `09-cut-away.png` | cut at z = 6.4: wall thickness, the floor plate, the roof build-up |
| `10-elements.png` | coloured by element: roofs, walls, slab, glazing |

Software rasterisation of the emitted triangle list by
`src/core/camera/shade.ts`. No browser, no Three.js, and the product UI is
untouched.

## 17. Human comparison against the source

Against the **technical elevations** first, as the brief requires. The compiled
front elevation and ARCHON's agree on the composition: a gabled main body on the
left with the garage and its flat roof on the right; the gable glazing on the
ridge side of the gable with a raked head descending to the right; the flat roof
meeting the gable wall at the same height. The right elevation's long slope, the
top view's L footprint and the 3/4 views all correspond.

Against the **perspective renders** second: the massing and the roof geometry
match. What the renders show and the model does not is the material palette, the
balcony and railing, the chimney, the roof windows, the ground-storey openings
and the rear gable windows — all listed in §5 as observed and not modelled.

The hand-built reference model was not used. `referenceWeight` is 0 and stays
asserted by the existing test.

## 18. Limitations

- **The eaves wedge.** A wall top cannot vary across the wall's thickness in
  this contract, but a sloping soffit does. The attic's side walls are flat at
  the knee wall, so between them and the roof's underside there is an unfilled
  wedge: **0 at the outer face, 0.378 m at the inner face**, about 0.994 m³ per
  side and **1.99 m³** in total. The gable ends have no such gap — their profile
  *is* the roof's underside — and §12 shows it closing to five decimals. In the
  real building that wedge is the wall plate and the rafter feet. Closing it
  needs a wall top that varies across the thickness, which is the single missing
  contract feature.
- **No shared walls.** The house/garage partition is modelled as two abutting
  0.45 m walls. T-junctions and party walls need semantics STAGE WEB-PIVOT-01B
  and 01C did not prove.
- **One opening per profiled wall.** Two raked heads could cross and reorder the
  bands the tiling pairs up, so a second is refused by name. This is why the two
  rear-gable openings are not modelled.
- **Rectangular footprints only.** The L is two rings, not one: a reflex corner
  is explicitly refused by the junction validator.
- **Roof openings are not in the roof compiler**, so the three roof windows are
  absent.
- **The gold spec is a transcription, not an analyzer output.** It says nothing
  about whether the analyzer can *read* Marcówki — only about whether the
  compiler can *realise* it once read.
- **Renders are diagnostics.** No shader work was done; materials are flat.

## 19. Mutations

Each mutant is built inline in a test and discarded.

| # | Mutation | Detected by | Result |
| --- | --- | --- | --- |
| 1 | declared pitch changed to 22°, geometry untouched | emitted-pitch oracle | triangles **deep-equal** to before; measured pitch still 39.99997°; the compiler's own report shows declared and built 18° apart |
| 2 | ridge raised 1.5 m | emitted-pitch and section gates | measured pitch moves more than 8°; ridge measures 9.450; the gable wall no longer reaches the roof and the closure oracle sees 0.5 m+ of daylight |
| 3 | `attic_right` moved 1.2 m inboard | roof-support independence | the gable roof's triangles are **deep-equal**; run and area unchanged |
| 4 | whole attic moved 1.5 m further from the facade | host-local opening oracle | the diagnostic opening keeps `u` 4.000…5.000 exactly |
| 5 | gable declared `HIP`, then `MONO_PITCH` | roof compiler | `UNSUPPORTED_ROOF_KIND`, **zero triangles**, the flat roof still compiles |
| 6 | one attic junction removed | ring topology | `RING_WALL_END_UNJOINED`, ring not closed, attic wall volume over by more than 0.2 m³ |

Fixture A adds a seventh in isolation: moving a synthetic ridge from 8 to 11
moves the measured pitch from 45° to 58°, and the declared 45 is reported
alongside it.

Four further refusals are checked: unknown wall, unknown level, a roof on a
level that is not there, and a wall belonging to no shell.

## 20. Tests and builds

```
npx vitest run tests/roof-compiler.test.ts      9 passed    (Fixture A)
npx vitest run tests/marcowki-shell.test.ts    31 passed    (Fixture B)
npx vitest run tests/wall-compiler.test.ts     15 passed    (Stage 01)
npx vitest run tests/wall-junction.test.ts     17 passed    (Stage 01B)
npx vitest run tests/storey-ring.test.ts       52 passed    (Stage 01C)
npm test                                      253 passed, 16 files   (213 before this stage)
npm run typecheck                             clean
npm run build                                 clean
npm run standalone:bundle                     clean
npm run standalone:build                      clean
PAGE=hosted.html STRICT_CSP=1 npm run standalone:verify
                                              11/11 browser checks passed
```

## 21. Production isolation

- **No module outside `src/core/wallspec/` imports** `architectural.ts`,
  `roof.ts`, `building.ts`, either fixture, or the gold JSON. Verified by grep
  over `src/`.
- **The standalone artifact is unchanged**: `assets/index-BzrIX8C4.js` at
  1 390 453 bytes, `assets/style-Dqog2LH0.css` at 3 742, and
  `assets/analyze-worker-i3TYSxLR.js` at 206 420 — the same hashed names and the
  same byte counts as the published build. Nothing to investigate.
- **The determinism and reference-isolation tests still pass**, which is the
  direct check that the analyzer's own output did not move. Source
  interpretation, the EvidenceGraph, camera fitting, the repair loop, OCR and
  the product UI are exactly as they were.
- The only modified production-adjacent file is `src/core/wallspec/compile.ts`,
  which is itself development-only, and a wall without a top profile or a raked
  head still takes the path STAGE WEB-PIVOT-01 proved.

## 22. Next bounded step

**Give a wall a top profile that varies across its thickness, and close the
eaves.**

It is the one geometric gap this stage measured in its own output — 1.99 m³ of
unfilled wedge — it is the last thing standing between the shell and a
watertight envelope, and it is small: the strip tiling already interpolates a
boundary along `u`, and the same machinery has to interpolate along `c`. Every
other limitation in §18 is a scope decision; this one is a defect the oracles
found.

It is **not** the next step to start automatic source interpretation. This stage
proved the compiler can realise a correct description; nothing yet produces that
description from the drawings, and the two problems should not be debugged
together.

## 23. Out of scope, confirmed not done

No OCR replacement, plan vectorisation, automatic wall extraction, room solver
or EvidenceGraph-to-spec migration. No full `ArchitecturalSpec`, no gold
Marcówki interiors, no camera verifier migration, no production integration, no
Kotlin port, no IFC export. No camera was fitted to an ARCHON image, and no
dimension was tuned to the hand-built reference model.

---

`PASS_STAGE_WEB_PIVOT_02_MARCOWKI_SHELL_ROOF_PROOF`
