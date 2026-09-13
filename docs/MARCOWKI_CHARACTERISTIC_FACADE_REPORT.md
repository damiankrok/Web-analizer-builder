# STAGE WEB-PIVOT-05 — the Marcówki characteristic facade

## 1. What this stage was for, and what it found

STAGE WEB-PIVOT-02 built a shell with the right dimensions and STAGE
WEB-PIVOT-04 put rooms inside it. Both are correct, and neither is
recognisable: a gable box 7.90 × 12.60 with a flat-roofed garage is every gable
box 7.90 × 12.60 with a flat-roofed garage. This stage's job was to find what
makes Marcówki *Marcówki* and to build it as geometry a ray can be fired
through.

The decisive finding is that **the house is 14.60 m deep, not 12.60 m, and 2.00
of those metres are holes.** The front and rear facades are each set back 1.00 m
behind a pair of 0.61 m wall returns that run the full height of the building.
The recessed front zone is the dark portal over the entrance and the garage; the
recessed rear zone is a loggia. Above them sit balconies with glass balustrades.

This is not an impression from a render. It is in the plans:

- The ground plan's right-hand dimension column reads **100 | 510 | 750 | 100**,
  where 510 + 750 = the printed overall depth 1260 and the two 100s are the
  projections beyond it.
- Row scans past the walled envelope find 0.61 m of solid wall ink and nothing
  else: on the ground plan at z 12.8 / 13.1 / 13.4 only x 0.000..0.636 and
  11.441..12.050; at z −0.3 / −0.6 / −0.9 only x 0.000..0.636 and 7.283..7.892.
  The attic plan finds x 0.000..0.609 and 7.259..7.895 at both ends.
- The east elevation closes it. Its silhouette runs px 212..1072, and the scale
  that puts its 300/230 window at z 0.884..3.906 — against the plan's
  0.874..3.918 — makes that silhouette **14.60 m**. A walls-only reading of
  12.60 m cannot produce it.

A second finding falls out of the same scans and is what makes the front
asymmetric: **the two recesses are not the same shape at both storeys.** At the
front the ground plan has *no* ink at x 7.283..7.892 while the attic plan does,
so the east return of the front recess exists only above the balcony slab and
the ground-level recess runs unbroken from x 0.61 to x 11.44. At the rear both
plans carry both returns.

## 2. Starting and final HEAD

| | |
|---|---|
| starting HEAD | `a5bf0931d98fa7b97abab4c59c41a1113b9861a3` |
| branch | `claude/new-session-pvd4ik` |
| working tree at start | clean apart from the STAGE WEB-PIVOT-05 work in progress described here |
| implementation commit | `05d2247e` — *STAGE WEB-PIVOT-05: the Marcowki characteristic facade* |
| final HEAD | the commit that adds this line, recorded below |

No unknown OWNER change was present, so `BLOCKED_STAGE_WEB_PIVOT_05_UNSAFE_BASELINE`
did not apply. Nothing was stashed, reset or cleaned.

## 3. Files changed

| file | lines | what it is |
|---|---:|---|
| `research/gold/marcowki-facade-v1.json` | 188 | **new.** The hand-transcribed facade gold: two recesses, five returns, three slabs, one portal, two balustrades, the roof extent, twelve openings, four material bands, six unresolved items and six observed-but-not-modelled items. |
| `src/core/wallspec/facade.ts` | 747 | **new.** Generic facade contracts and `compileFacade`. Nothing in it knows it is Marcówki. |
| `src/core/wallspec/marcowki-facade-fixture.ts` | 576 | **new.** The gold read into those contracts, the shell extended with this stage's cuts, the whole-house scene assembler, and the ten mutations. |
| `tests/facade-oracles.ts` | 851 | **new.** Independent measurement: opening cuts, recess depth, portal, slabs, balustrades, the orthographic depth map and its source anchors, the plan oracle, opening→room, the raked-head polygon oracle and duplicate volume. |
| `tests/marcowki-facade.test.ts` | 608 | **new.** 73 tests, of which 10 are the §26 mutations. |
| `scripts/marcowki-facade-diagnostic.ts` | 494 | **new.** The console audit and the twelve views. |
| `scripts/elevation-measure.ts` | 75 | **new.** The tool behind every VISUAL_DERIVED figure in the gold. |
| `src/core/wallspec/compile.ts` | +134 / −76 | **modified.** `compileProfiledWall` generalised from one opening to N. See §19. |

Nothing under `src/core/pipeline`, `src/core/camera`, `src/core/hypotheses`,
`src/core/dimensions`, `src/node` or `src/ui` was touched. See §20.

## 4. The facade gold schema

`marcowki-facade-1.1.0`. Top level:

| key | contents |
|---|---|
| `method` | the frame, the §3 authority order, the elevation calibration for all four views, how the recesses were discovered, how the two storeys differ, the source assets, and what each status means |
| `levels` | the shell's levels, repeated so this file is readable alone |
| `recesses` | 2 — outer plane, back plane, depth, span, base, top |
| `returns` | 5 — axis, centre line, thickness, extent, base, and either a flat top or the soffit plane it dies into |
| `slabs` | 3 — footprint, top, thickness, usable extent, kind |
| `portals` | 1 — outer plane, depth, mouth rectangle, jamb and head ids, material class |
| `railings` | 2 — axis, centre line, thickness, base, height, material, and the four panel spans each |
| `roofExtent` | the single main roof, z −1.00..13.60, with the shell's own z 0.00..12.60 recorded beside it |
| `openings` | 12 — host wall, further leaves, host-local offset, width, sill, head, raked far head, kind, exposure, printed callout, room, fills, mullions |
| `materialBands` | 4 — flush cladding changes, which emit no geometry |
| `observedButNotModelled` | 6 |
| `unresolved` | 6 |

Every record carries `status` and `source`. Statuses mean:

| status | meaning |
|---|---|
| `SOURCE_EXACT` | a number printed on a drawing, read directly |
| `SOURCE_CORROBORATED` | printed once and independently confirmed by a measurement or a second drawing |
| `SOURCE_DERIVED` | measured in the plan raster with `scripts/plan-measure.ts`; no printed dimension covers it |
| `VISUAL_DERIVED` | measured on a published elevation render through the stated registration; good to about a decimetre and never better |
| `ASSUMPTION` | a modelling choice no source settles |
| `UNRESOLVED` | no source settles it and no choice was made |

## 5. Source assets

| role | asset | size | used for |
|---|---|---|---|
| FLOOR_PLAN / GROUND / DIMENSIONED | `asset_8fda78f8654c` | 853×853 | every horizontal position; the recess discovery |
| FLOOR_PLAN / UPPER_ATTIC / DIMENSIONED | `asset_8460d17163a4` | 853×853 | the attic returns, the balcony floors, the balustrade posts |
| SECTION | `asset_b1e8c064c1ba` | 1138×854 | the levels, through the shell gold |
| ELEVATION / FRONT | `asset_3c991e46a7e7` | 1280×597 | sill and head heights, the slab and portal band, the balustrade |
| ELEVATION / REAR | `asset_863c2909651e` | 1280×598 | the balcony fascia and soffit, the rear gable rake, the garage's north wall |
| ELEVATION (east) | `asset_fcb1602240db` | 1280×597 | the 14.60 m silhouette; the 300/230 window |
| ELEVATION (west) | `asset_3915ee416ac4` | 1280×598 | the 90/230 and 140/140 windows and the dark band |
| PERSPECTIVE_RENDER / HERO | `asset_a26220a6e905` | 1600×900 | depth ordering only |
| PERSPECTIVE_RENDER / GARDEN | `asset_ac9a07c288f1` | 800×600 | depth ordering only |

The two published side elevations are labelled LEFT and RIGHT and the labels do
not say which compass direction each is. They were identified by content, not by
name: `asset_fcb1602240db` has the garage on its left and puts the 300/230
window at z 0.884..3.906 against the plan's 0.874..3.918, so it is the **east**
view; `asset_3915ee416ac4` has the two roof windows and puts the 90/230 and
140/140 openings where the plan puts them, so it is the **west** view.

Registrations, all two anchors per axis and none detected:

| view | horizontal | vertical |
|---|---|---|
| FRONT | x 0 at px 376, 59.34 px/m rightwards | y 0 at px 572.8 |
| REAR | x 0 at px 970, 58.73 px/m **leftwards** | y 0 at px 568.9 |
| EAST | z 13.60 at px 212, 58.9 px/m leftwards | y 0 at px 577 |
| WEST | z −1.00 at px 217, 58.9 px/m rightwards | y 0 at px 575 |

The EAST and WEST scale was not assumed: 58.9 px/m is what the silhouette px
212..1072 gives for the 14.60 m the plans measure, and the same scale then puts
three windows within 0.03 m of where the plans put them.

## 6. Complete opening inventory

Twelve structural openings, of which eleven are visible from outside.

| id | facade | storey | host wall | offset | width | sill | head | far head | printed | status |
|---|---|---|---|---:|---:|---:|---:|---:|---|---|
| `og_front_room_window` | FRONT | ground | `ground_main_front` | 1.397 | 1.10 | 0.00 | 2.30 | — | 110/230 | CORROBORATED |
| `og_front_entrance` | FRONT | ground | `ground_main_front` | 4.176 | 1.05 | 0.00 | 2.10 | — | 105/210 | CORROBORATED |
| `og_east_living_window` | EAST | ground | `ground_main_right` | 8.704 | 3.00 | 0.00 | 2.30 | — | 300/230 | CORROBORATED |
| `og_east_garage_door` | EAST *(concealed)* | ground | `ground_main_right` **+ `garage_left`** | 1.216 / 5.354 | 0.93 | 0.00 | 2.10 | — | — | DERIVED |
| `og_rear_living_glazing` | REAR | ground | `ground_main_rear` | 0.942 | 4.70 | 0.00 | 2.30 | — | 470/230 | CORROBORATED |
| `og_west_living_window` | WEST | ground | `ground_main_left` | 3.653 | 0.90 | 0.00 | 2.30 | — | 90/230 | CORROBORATED |
| `og_west_kitchen_window` | WEST | ground | `ground_main_left` | 5.402 | 1.40 | 0.90 | 2.30 | — | 140/140 | CORROBORATED |
| `og_garage_door` | FRONT | ground | `garage_front` | 0.656 | 2.75 | 0.00 | 2.25 | — | 275/225 | CORROBORATED |
| `og_garage_side_door` | NORTH_GARAGE | ground | `garage_rear` | 1.128 | 1.00 | 0.00 | 2.10 | — | 100/210 | CORROBORATED |
| `og_front_gable_glazing` | FRONT | upper | `attic_front` | 3.940 | 2.70 | 0.00 | 3.20 | 0.93443 | 270/320 | EXACT |
| `og_rear_gable_east` | REAR | upper | `attic_rear` | 0.970 | 2.34 | 0.00 | 1.0634 | 3.03 | 234/303 | CORROBORATED |
| `og_rear_gable_west` | REAR | upper | `attic_rear` | 4.620 | 2.34 | 0.00 | 3.03 | 1.0634 | 234/303 | CORROBORATED |

Offsets are in the host wall's own `u`, the same wall-local frame every stage
since WEB-PIVOT-01 has used. Heads are above the wall base, so an attic opening's
world head is 3.06 higher.

Every one is a real hole. Measured across the host wall at the opening's centre,
beside it, and just above its head:

| opening | through | beside | above | fill | reveal |
|---|---:|---:|---:|---:|---:|
| every one of the twelve | **0.0000 m** | 0.4500 m | 0.4500 m | 0.0500 m | 2.31–4.19 m² |

`through` is the wall material a ray still finds inside the opening; `beside`
and `above` are the same wall measured 0.12 m to the side and 0.08 m above the
head. A painted rectangle returns 0.45 through. Glass outside its own reveal —
the floating-pane failure — measures **0.0000 m** on every opening.

### The one opening that is a hole through two walls

`og_east_garage_door` is the kotłownia/garage door STAGE WEB-PIVOT-04 recorded
and could not cut. The main body's ring and the garage's ring each carry their
own wall on the shared plane x = 7.90, so the door is one opening through two
leaves: `ground_main_right` at offset 1.216 and `garage_left` at offset 5.354.
Cutting only the near leaf leaves the far one standing in the doorway — which a
ray notices and a picture does not. Both leaves measure 0.0000 m through.

It is marked `exposure: CONCEALED`: the garage stands against it, no elevation
shows it, and it is therefore not counted among the east facade's exterior
openings.

## 7. The recess / loggia

| | front | rear |
|---|---|---|
| outer plane | z 13.60 | z −1.00 |
| back plane | z 12.60 | z 0.00 |
| depth | 1.00 m | 1.00 m |
| span | x 0.61..11.44 | x 0.61..7.29 |
| status | SOURCE_CORROBORATED | SOURCE_CORROBORATED |

Measured from outside, 60 probes each at y 0.40 / 1.20 / 2.00:

| | front | rear |
|---|---|---|
| stated depth | 1.000 m | 1.000 m |
| samples with no material in the outer plane | **100%** | **100%** |
| shallowest material found | **1.000 m** | **1.000 m** |
| samples nearer than the stated depth | **0 / 60** | **0 / 60** |

The back wall is the shell's own front and rear walls, physically 1.00 m behind
the outer plane. The side returns are walls: they compile through STAGE
WEB-PIVOT-01's wall compiler, they are closed solids, and each dies into the
roof soffit at the plane the printed 40° pitch puts there:

| return | span | base | measured top | soffit at its centre line |
|---|---|---:|---:|---:|
| `return_west_front` | x 0.00..0.61, z 12.60..13.60 | 0.00 | 4.6159 | 4.6159 |
| `return_west_rear` | x 0.00..0.61, z −1.00..0.00 | 0.00 | 4.6159 | 4.6159 |
| `return_east_front` | x 7.29..7.90, z 12.60..13.60 | **2.96** | 4.6159 | 4.6159 |
| `return_east_rear` | x 7.29..7.90, z −1.00..0.00 | 0.00 | 4.6159 | 4.6159 |
| `return_garage_east_front` | x 11.44..12.05, z 12.60..13.60 | 0.00 | 3.0800 | flat |

`return_east_front` starts at 2.96 because it stands on the balcony slab, which
is what the ground plan's *absence* of ink there means. The slab reaches x 7.90
so it carries the return rather than leaving it in the air.

The recess is not a dark material patch, and the orthographic depth map says so
directly. Nearest surface along Z in the front elevation:

| x | y = 1.20 | y = 3.50 |
|---:|---|---|
| 0.305 | 13.600 (west return) | 13.600 (west return) |
| 1.500 | 8.900 (through the window) | 12.600 (recessed wall) |
| 3.000 | 12.600 | 12.600 |
| 7.000 | 12.600 | 12.600 |
| **7.595** | **12.600** (no return at ground level) | **13.600** (return at attic level) |
| 9.000 | 5.550 (through the garage door) | sky |
| 11.745 | 13.600 (garage east return) | sky |

The 7.595 row is the storey difference, measured.

## 8. The balcony and portal-head slabs

| slab | kind | footprint | top | thickness | volume | stated | footprint covered |
|---|---|---|---:|---:|---:|---:|---:|
| `balcony_front` | BALCONY | x 3.338..7.900, z 12.60..13.60 | 2.96 | 0.55 | 2.509 m³ | 2.509 m³ | 100% |
| `balcony_rear` | BALCONY | x 0.610..7.290, z −1.00..0.00 | 2.96 | 0.55 | 3.674 m³ | 3.674 m³ | 100% |
| `portal_head_front` | PORTAL_HEAD | x 7.900..11.440, z 12.60..13.60 | 3.08 | 0.67 | 2.372 m³ | 2.372 m³ | 100% |

None is a zero-thickness quad: each is a closed solid whose measured volume
equals its footprint times its thickness to six decimal places, and a vertical
probe finds its top at 2.96 (or 3.08) and its soffit at 2.41.

The top and the soffit are VISUAL_DERIVED and the rear elevation is where they
are legible: at x 1.5..2.5 the timber cladding ends at 2.41, the dark fascia
runs 2.41..2.96, and the balustrade's base rail sits above it at 2.96..3.02. The
front elevation cannot separate the fascia from the dark wall behind it, which
is why the rear is the measurement of record.

`balcony_front`'s west edge is x 3.338 — the 0.026 m edge line the attic plan's
row scans find at z 12.8, 13.1, 13.4 and 13.5. The front elevation puts it at
3.19..3.24. The plan wins per the §3 authority order and the 0.15 m difference
is left standing in `unresolved`.

## 9. The glass balustrades

| railing | on | centre line | panels | glass measured | daylight between panels | base | top | all glass |
|---|---|---|---:|---:|---:|---:|---:|---|
| `railing_front` | `balcony_front` | z 13.575 | 4 | 3.280 m of 3.680 m | **0.000 m** | 2.96 | 3.86 | yes |
| `railing_rear` | `balcony_rear` | z −0.880 | 4 | 6.000 m of 6.440 m | **0.000 m** | 2.96 | 3.86 | yes |

The panels are not a count divided into a run: they are the post marks the
attic plan draws. At z 13.55 the row scan finds 0.026 m marks at x 3.444,
3.497, 4.212, 4.265, 4.398, 4.451, 5.166, 5.219, 5.378, 5.431, 6.146, 6.199,
6.332, 6.411, 7.126 and 7.153 — four equal 0.821 m panels. At z −0.88 the same
scan finds four 1.48–1.51 m panels from x 0.689 to 7.153.

The difference between `glass measured` and the run is the posts, which are
emitted as solids: zero daylight between panels, and glass over 89% of the front
run and 93% of the rear. An opaque parapet with the same silhouette reports the
same extent and `all glass: false`, which is the substitution §12 forbids and
mutation 4 exercises.

## 10. The portal / frame

| | |
|---|---|
| outer plane | z 13.60 |
| depth | 1.00 m |
| mouth | x 0.61..11.44, y 0.00..2.41 |
| jambs | `return_west_front`, `return_garage_east_front` |
| heads | `balcony_front`, `portal_head_front` |
| material class | `DARK_RENDER` |

It is geometry, not colour. Measured:

| check | result |
|---|---|
| samples inside the mouth that meet material in the outer plane | **0 / 66** |
| material in the first metre behind the plane just outside each jamb | 1.000 m / 1.000 m |
| material in a vertical probe above the mouth at its centre | 0.550 m (the balcony slab) |
| measured depth at the mouth's centre | 1.000 m |

The dark render is the material class the elevations show on the wall behind it,
and it is recorded as a `materialBand`, which emits nothing. Take the render
away and the portal is still there.

## 11. Garage and entrance doors

**Garage door** (§14). Printed 275/225, centred on the measured gap x
8.554..11.308 in the garage's south wall. The front elevation reads the
timber-lined reveal at x 8.470..11.303 with its head at 2.270. Real cut: 0.0000
m of wall through it, 0.4500 m beside it, a separate `GARAGE_PANEL` fill in the
hole, and nothing behind it — a ray at y 1.20 passes from z 13.60 clean through
to the garage's rear wall at z 5.55. The published render shows the door rolled
up so its panels cover only the lower 1.03 m; the structural opening is the
whole 275/225 and the model fills all of it.

**Entrance** (§15). Printed 105/210, centred on the measured gap x 4.158..5.244;
the front elevation reads the leaf at x 4.196..5.174. Real cut, a `DOOR_LEAF`
fill over 0..0.72 of the width, a narrow `GLASS` sidelight over 0.76..1.00 and a
mullion between them, as the hero render shows. The room behind it is `g_entry`,
found by probe and not by label.

**Garage side door.** Printed 100/210, centred on x 9.905..10.938; the rear
elevation reads the fully glazed leaf at x 9.893..10.914 with its head at 2.05.

## 12. Major glazing groups

Each is **one** structural hole with fills and mullions inside it, not several
overlapping holes:

| group | width | fills | mullions | source for the mullion |
|---|---:|---|---|---|
| `og_east_living_window` | 3.00 | 2 × GLASS | 0.50 | symmetric pair |
| `og_rear_living_glazing` | 4.70 | 2 × GLASS | 0.50 | the rear elevation reads one central break at x 4.63 against a 4.608 midpoint |
| `og_front_gable_glazing` | 2.70 | 2 × GLASS | 0.374 | the front elevation reads a break at x 4.95 at both y 4.30 and y 5.00 |
| `og_rear_gable_east` | 2.34 | 2 × GLASS | 0.573 | the rear elevation reads the break at x 5.59 |
| `og_rear_gable_west` | 2.34 | 2 × GLASS | 0.406 | the rear elevation reads the break at x 2.33 — the mirror of the east window's 0.573 to within 0.05 m |

Quantities come off the structural opening. A compiler that made one hole per
pane would report this facade with five extra reveals and the wrong wall area.

### The raked gable openings (§17)

The structural hole follows the source polygon, which is rebuilt in the oracle
from the printed callout and the printed pitch alone — the oracle never asks the
compiler where it put the head:

| opening | polygon | worst head error | least wall above the head | glass outside the polygon |
|---|---|---:|---:|---:|
| `og_front_gable_glazing` | 3.20 − f × 2.70 × tan 40° | 9.4 × 10⁻⁷ m | 1.698 m | 0.000 m |
| `og_rear_gable_east` | 3.03 − (1−f) × 2.34 × tan 40° | 2.9 × 10⁻³ m | 1.323 m | 0.000 m |
| `og_rear_gable_west` | 3.03 − f × 2.34 × tan 40° | 2.9 × 10⁻³ m | 1.298 m | 0.000 m |

The rear pair's heads rake at the roof pitch, tall at the ridge side: 3.03 −
2.34 × tan 40° = 1.0634 at the eave side, a constant 1.05 m below the roof's
underside. The rear elevation confirms the rake at three heights — the east
window's glass reaches x 6.538 at y 4.30, 5.72 at y 5.00 and 4.887 at y 5.70,
against 6.719, 5.887 and 5.054 predicted plus a frame inset.

The wall is genuinely cut and closes over the head everywhere — the minimum wall
found above the polygon at any sampled column is 1.30 m — and no glass exists
above it. A rectangular hole with a triangle of glass laid over it fails both
columns.

## 13. Side and rear completeness (§18)

| facade | source-supported major openings | implemented | unresolved | missing characteristic features |
|---|---:|---:|---:|---|
| FRONT | 4 | **4** | 0 | none |
| REAR | 3 | **3** | 0 | none |
| EAST | 1 exterior (+1 concealed) | **1 (+1)** | 0 | none |
| WEST | 2 | **2** | 0 | two 78/118 roof windows, out of scope per §31 |
| NORTH_GARAGE | 1 | **1** | 0 | none |
| roof | 3 rooflights, 1 chimney | 0 | 0 | cutting a roof plane is a capability the roof compiler does not have; §31 keeps it out of scope, and both are counted here rather than quietly dropped |

No unexplained major opening omission. The three rooflights and the chimney are
the only source-supported openings not implemented, and both are recorded in
`observedButNotModelled` with the reason.

## 14. Plan-depth checks (§22)

The model sliced the way the plans are sliced. Each row is a ray through the
compiled triangles, reported in world coordinates, beside what the plan raster
says:

| slice | model | plan |
|---|---|---|
| z = 13.10, y = 1.20 | 0.000..0.610, 11.440..12.050 | ink at x 0.000..0.636 and 11.441..12.050, nothing between |
| z = −0.50, y = 1.20 | 0.000..0.610, 7.290..7.900 | ink at x 0.000..0.636 and 7.283..7.892 |
| z = 12.30, y = 1.20 | 0.000..1.397, 2.497..4.176, 5.226..8.556, 11.306..12.050 | the front wall with the 110/230, the 105/210 and the 275/225 in it |
| x = 0.305, y = 1.20 | −1.000..3.653, 4.553..5.402, 6.802..13.600 | the west return runs the full **14.60 m**, broken only by the two west windows |
| x = 7.595, y = 1.20 | −1.000..0.896, 3.896..10.454, 11.384..12.600 | ends at **12.60**: no east return at ground level |
| x = 7.595, y = 3.50 | −1.000..13.600 | ends at **13.60**: the east return exists at attic level |
| z = 6.00, y = 1.20 | 7.450..8.350, 11.600..12.050 | the main body's east wall against the garage's west wall, then the garage's east wall |

## 15. Orthographic checks (§21)

Four deterministic depth maps, 160 × 110 samples over the whole site, one ray
per cell, nearest solid surface kept.

| view | silhouette across | expected | up |
|---|---|---|---|
| FRONT | 0.011..12.004 (11.992 m) | 0..12.05 | 0.032..7.886 |
| REAR | 0.011..12.004 (11.992 m) | 0..12.05 | 0.032..7.886 |
| EAST | −0.964..13.564 (**14.527 m**) | −1.00..13.60 | 0.032..7.886 |
| WEST | −0.964..13.564 (**14.527 m**) | −1.00..13.60 | 0.032..7.886 |

The residual is the sampling grid: a cell is 0.0975 m across and 0.0818 m up,
and a bound is read at a cell centre. The tests assert the bounds to within one
cell rather than pretending to sub-cell accuracy.

Every exterior opening was then checked against its *source* rectangle — the
printed width and height, placed at the plan-measured offset. "Open" is not
"sky": looking through a window you see the far side of the house, so the test
is whether the nearest surface lies behind the host wall's own outer face.

| opening | view | source rectangle | open inside | open beside | verdict |
|---|---|---|---:|---:|---|
| `og_front_room_window` | FRONT | 1.397..2.497 × 0.000..2.300 | 100% | 0% | MATCH |
| `og_front_entrance` | FRONT | 4.176..5.226 × 0.000..2.100 | 100% | 0% | MATCH |
| `og_east_living_window` | EAST | 0.896..3.896 × 0.000..2.300 | 100% | 0% | MATCH |
| `og_rear_living_glazing` | REAR | 2.258..6.958 × 0.000..2.300 | 100% | 0% | MATCH |
| `og_west_living_window` | WEST | 3.653..4.553 × 0.000..2.300 | 100% | 0% | MATCH |
| `og_west_kitchen_window` | WEST | 5.402..6.802 × 0.900..2.300 | 100% | 0% | MATCH |
| `og_garage_door` | FRONT | 8.556..11.306 × 0.000..2.250 | 100% | 0% | MATCH |
| `og_garage_side_door` | REAR | 9.922..10.922 × 0.000..2.100 | 100% | 0% | MATCH |
| `og_front_gable_glazing` | FRONT | 3.940..6.640 × 3.060..3.994 | 100% | 0% | MATCH |
| `og_rear_gable_east` | REAR | 4.590..6.930 × 3.060..4.123 | 100% | 0% | MATCH |
| `og_rear_gable_west` | REAR | 0.940..3.280 × 3.060..4.123 | 100% | 0% | MATCH |

Both numbers are needed and neither is enough. A model with no opening has
`open inside` 0; a model whose wall simply stops has `open inside` 1 and `open
beside` 1 as well, which is a missing wall rather than an opening. No global
visual score is used anywhere.

The recess outline, the balcony slab, the railing extent and the portal are
checked by direct measurement (§7, §8, §9, §10) rather than by the projection,
because a depth is a stronger statement than a silhouette.

## 16. Room adjacency (§8)

The probe is a point 0.33 m inside the host wall's inner face at the middle of
the opening, and the answer is whichever room polygon on that storey contains
it. Nothing consults the opening's own claim until the two are compared.

| opening | host wall | claims | found | verdict |
|---|---|---|---|---|
| `og_front_room_window` | `ground_main_front` | g_room | g_room | MATCH |
| `og_front_entrance` | `ground_main_front` | g_entry | g_entry | MATCH |
| `og_east_living_window` | `ground_main_right` | g_salon | g_salon | MATCH |
| `og_east_garage_door` | `ground_main_right` | g_boiler | g_boiler | MATCH |
| `og_rear_living_glazing` | `ground_main_rear` | g_salon | g_salon | MATCH |
| `og_west_living_window` | `ground_main_left` | g_salon | g_salon | MATCH |
| `og_west_kitchen_window` | `ground_main_left` | g_kitchen | g_kitchen | MATCH |
| `og_garage_door` | `garage_front` | g_garage | g_garage | MATCH |
| `og_garage_side_door` | `garage_rear` | g_garage | g_garage | MATCH |
| `og_front_gable_glazing` | `attic_front` | u_pokoj_s | u_pokoj_s | MATCH |
| `og_rear_gable_east` | `attic_rear` | u_pokoj_ne | u_pokoj_ne | MATCH |
| `og_rear_gable_west` | `attic_rear` | u_pokoj_nw | u_pokoj_nw | MATCH |

12 / 12. No major opening connects to an impossible room.

## 17. Source-to-feature table (§23)

| feature | source(s) | gold geometry | status | compiled geometry | delta | verdict |
|---|---|---|---|---|---|---|
| front recess / loggia | ground plan dimension column 100\|510\|750\|100; row scans at z 12.8/13.1/13.4; east elevation silhouette | outer 13.60, back 12.60, depth 1.00, x 0.61..11.44 | SOURCE_CORROBORATED | shallowest material 1.000 m, 100% open at the mouth | 0.000 m | **MATCH** |
| rear recess / loggia | same column; row scans at z −0.3/−0.6/−0.9 on both plans | outer −1.00, back 0.00, depth 1.00, x 0.61..7.29 | SOURCE_CORROBORATED | shallowest material 1.000 m, 100% open | 0.000 m | **MATCH** |
| side returns (5) | plan row scans, 0.61 m ink | 0.61 thick, to the soffit or to 3.08 | SOURCE_DERIVED | tops 4.6159 / 3.0800, zero gap to the roof | 0.000 m | **MATCH** |
| front gable opening polygon | printed 270/320; pitch 40° | 2.70 wide, head 3.20 → 0.93443 | SOURCE_EXACT | worst head error 9.4 × 10⁻⁷ m | ~0 | **MATCH** |
| rear gable opening polygons | printed 234/303; gap x 4.583..6.941 and 0.927..3.285; rear elevation at three heights | 2.34 wide, head 3.03 → 1.0634 | SOURCE_CORROBORATED | worst head error 2.9 × 10⁻³ m | 3 mm | **MATCH** |
| balcony slab, front | attic plan edge line at x 3.338; rear elevation fascia 2.41..2.96 | x 3.338..7.90, top 2.96, 0.55 thick | SOURCE_DERIVED / VISUAL_DERIVED | volume 2.509 m³ = stated; top 2.960, soffit 2.410 | 0.000 | **VISUAL_DERIVED** |
| balcony slab, rear | attic plan; rear elevation fascia continuous x 0.647..7.254 at y 2.60 | x 0.61..7.29, top 2.96, 0.55 thick | SOURCE_DERIVED / VISUAL_DERIVED | volume 3.674 m³ = stated | 0.000 | **VISUAL_DERIVED** |
| glass railing, front | attic plan post marks at z 13.55; front elevation glass 3.13..3.89 | 4 panels 3.444..7.153, base 2.96, 0.90 high | SOURCE_DERIVED / VISUAL_DERIVED | 4 panels, 3.280 m glass, 0 m daylight, base 2.960 top 3.860 | ≤0.03 m on the ends | **VISUAL_DERIVED** |
| glass railing, rear | attic plan post marks at z −0.88; rear elevation glass top 3.85 | 4 panels 0.689..7.153 | SOURCE_DERIVED / VISUAL_DERIVED | 4 panels, 6.000 m glass, 0 m daylight | ≤0.03 m | **VISUAL_DERIVED** |
| garage portal / frame | the recess mouth, its two measured returns, the balcony slab and the portal head | mouth x 0.61..11.44, y 0..2.41, 1.00 deep | SOURCE_CORROBORATED | 0/66 blocked, jambs 1.000 m each, head 0.550 m | 0.000 | **MATCH** |
| portal head | front elevation band top 3.081 at x 9.50 and 3.097 at x 11.80; east 3.06..3.14; rear 2.99 | x 7.90..11.44, top 3.08, 0.67 thick | VISUAL_DERIVED | volume 2.372 m³ = stated, top 3.080 | 0.000 | **VISUAL_DERIVED** |
| garage door | printed 275/225; gap x 8.554..11.308; front elevation reveal 8.470..11.303, head 2.270 | 2.75 × 2.25 at offset 0.656 | SOURCE_CORROBORATED | 0.0000 m through, nothing behind | 0.02 m on the elevation | **MATCH** |
| entrance | printed 105/210; gap x 4.158..5.244; front elevation leaf 4.196..5.174 | 1.05 × 2.10 at offset 4.176 | SOURCE_CORROBORATED | 0.0000 m through; leaf + sidelight | 0.02 m | **MATCH** |
| rear major glazing | printed 470/230; gap x 2.251..6.965; rear elevation glass 2.12..6.90, head 2.285 | 4.70 × 2.30 at offset 0.942 | SOURCE_CORROBORATED | 0.0000 m through; 2 panes + 1 mullion | 0.015 m on the head | **MATCH** |
| east 300/230 | printed 300/230; gap z 0.874..3.918; east elevation z 0.884..3.906 | 3.00 × 2.30 | SOURCE_CORROBORATED | anchor 100% open, 0% beside | 0.012 m | **MATCH** |
| west 90/230 and 140/140 | printed; gaps z 3.653..4.553 and 5.400..6.803; west elevation 3.635..4.568 and 5.332..6.810 | as printed | SOURCE_CORROBORATED | both anchors 100% / 0% | ≤0.07 m | **MATCH** |
| gable opening ↔ roof relation | pitch 40°; §7 soffit plane | head a constant 1.05 m below the roof underside | SOURCE_DERIVED | ≥1.30 m of wall above the head everywhere | — | **MATCH** |
| garage flat roof level | section +2.88 vs three elevations measuring 2.99..3.14 | shell 2.88 kept; portal head 3.08 | UNRESOLVED | as stated | 0.20 m, recorded | **SOURCE_UNRESOLVED** |

No `COMPILER_FAIL`.

## 18. Visual diagnostics (§24)

`npx tsx scripts/marcowki-facade-diagnostic.ts` writes twelve views to
`out/marcowki-facade/`:

| # | file | what it shows |
|---|---|---|
| 1 | `01-ortho-front.png` | front elevation |
| 2 | `02-ortho-rear.png` | rear elevation |
| 3 | `03-ortho-left-west.png` | west elevation, +z to the right |
| 4 | `04-ortho-right-east.png` | east elevation, +z to the left |
| 5 | `05-front-three-quarter.png` | front three-quarter |
| 6 | `06-rear-three-quarter.png` | rear three-quarter |
| 7 | `07-front-recess-closeup.png` | the west return projecting 1.00 m past the wall behind it |
| 8 | `08-balcony-railing-closeup.png` | the slab and the four glass panels |
| 9 | `09-portal-closeup.png` | the entrance and garage portal, jambs and head |
| 10 | `10-roof-off.png` | rooms, openings and both recesses with the roof removed |
| 11 | `11-opening-ids-front.png` | opening ids marked on the front elevation |
| 12 | `12-feature-ids-front.png` | returns, slabs, railings and the portal, marked |

Presentation is the architectural-study shader (§20): solid, glass, frame and
panel materials, flat colour, no photographic texture, no landscaping and no
furniture.

Two honest notes about the images rather than the model:

- **The exterior views draw the shell and the facade; view 10 draws all three
  layers.** This repository's software rasteriser loses depth precision at a
  30 m eye distance and paints a handful of attic partitions over the roof they
  sit under. The geometry is right and the audit proves it: the worst interior
  wall top measured against the roof underside by ray is **−0.0000 m**, i.e.
  contact, never penetration. Rather than tune a shared renderer for this
  stage, the exterior views draw the exterior.
- The main roof is **one solid** spanning z −1.00..13.60 rather than the shell's
  roof plus two abutting pieces. The source shows one roof; three prisms would
  have the same volume and the same silhouette and two seams through the middle
  of it.

## 19. The one change to shared compiler code

`compileProfiledWall` in `src/core/wallspec/compile.ts` compiled **one** opening
before this stage. Marcówki's rear gable carries two windows whose heads rake in
*opposite* directions, so the restriction had to go — and the reason for it had
to be answered rather than ignored. Two changes do that:

1. **Outside its own span an opening contributes nothing.** A raked head
   extrapolated across the whole wall is meaningless and can sit above the wall
   top, so each opening's sill and head collapse to the wall base outside
   `[offset, offset + width]`. That is still a function of `u` alone, so
   neighbouring strips still cut their shared edge at identical heights.
2. **The band boundaries cannot reorder.** `sharesOneTiling` refuses a wall
   whose openings overlap along `u`; with the collapse above, at most one
   opening is non-degenerate at any `u`, every other contributes the pair
   `(0, 0)`, and a strip's two ends differ only in that one opening's own
   `sill ≤ head`. A sorted list whose only moving pair stays ordered cannot
   invert. Where the precondition fails the compiler still cuts one opening and
   raises `TOO_MANY_OPENINGS_ON_PROFILED_WALL` by name, exactly as before.

Voidness is decided by asking, at both ends of a strip, whether a band's
midpoint lies between the active opening's own sill and head — a question about
that one opening, needing no global ordering at all.

Every earlier stage passes against it unchanged: 446 tests across 20 files, of
which STAGE WEB-PIVOT-01/01B/01C, 02, 02A, 03 and 04 are 373 and were all
passing before this stage began.

## 20. Production isolation (§27)

- **Nothing in production imports any of this.** `grep -rn 'wallspec/'` over
  `src/core/pipeline`, `src/core/camera`, `src/core/hypotheses`,
  `src/core/dimensions`, `src/node` and `src/ui` returns nothing at all — the
  whole `wallspec` tree, this stage included, is unreachable from the URL →
  model flow. `grep -rln 'marcowki-facade'` over `src` returns only
  `facade.ts` and `marcowki-facade-fixture.ts`. A test asserts this.
- **No gold coordinate can leak.** `research/gold/marcowki-facade-v1.json` is
  read by exactly one module, which nothing in production imports.
- **Nothing was tuned.** The camera solver, the repair loop, the OCR, the legacy
  mass solver and the score weights are untouched; no file under those
  directories changed.
- **The analyzer's output is unchanged.** Re-running the production CLI
  reproduces the recorded scores to four decimal places:

  | project | STAGE WEB-PIVOT-04 | now |
  |---|---|---|
  | A — Dom w marcówkach (GE) | 0.2176 | **0.21756** |
  | B — Dom w bakopach (G2E) | 0.2118 | **0.21175** |
  | C — Dom w kosaćcach 44 | — | 0.19570 |

  `npx tsx src/node/cli.ts bench` re-ran all three and the freeze hashes —
  config, grammar, metric definitions, thresholds and weights — came back
  unchanged as well.

## 21. Mutation results (§26)

Ten defects, each built behind an option on the fixture, none ever the default,
and none committed. Each is caught by a *measurement*, and the table names which
one.

| # | §26 defect | how it is built | what catches it |
|---:|---|---|---|
| 1 | recess depth = 0 | the mouth filled with a 1.00 m thick solid — the flat facade with a dark patch | `recessReport`: 0% open at the mouth, shallowest 0.000 m, 60/60 samples nearer than stated; `portalReport` 66/66 blocked; four front anchors MISSING |
| 2 | recess back wall moved to the global facade | the front walls translated 1.00 m forward | `recessReport`: shallowest 0.000 m, 33 samples nearer than stated; `openingRoomTable`: four front openings NO_ROOM |
| 3 | balcony slab removed / shifted | `dropSlab`, `moveSlab` | dropped: volume 0.000 m³, footprint 0% covered, portal head 0.000 m. Shifted 1.2 m: same volume, footprint 83% covered |
| 4 | glass railing replaced by opaque / wrong extent | `opaqueRailing`, `shortenRailing` | opaque: `all glass: false`, glass 0.000 m. Shortened 1.6 m: 3 panels, run ends at 5.534 |
| 5 | glazing added without cutting the wall | `glazingWithoutCut` | `openingCutReport`: fill 0.050 m present *and* 0.450 m of wall still through it; the REAR anchor MISSING |
| 6 | garage door on the wrong wall / room | `moveOpening` to `ground_main_rear` | `openingRoomTable` WRONG_ROOM; the FRONT anchor MISSING |
| 7 | portal projection sign reversed | slabs and returns mirrored about the back plane | both slabs' stated footprints 0% covered with their volumes unchanged; portal depth negative |
| 8 | gable opening changed to a wrong rectangular top | `levelGableHead` | `rakedHeadReport`: worst head error 6.13 m against the printed polygon |
| 9 | rear major opening omitted | `dropOpening` | the REAR anchor MISSING with 0% open inside |
| 10 | one facade mirrored | `mirrorFacade: 'WEST'` | both WEST anchors MISSING; the EAST anchor still MATCH, so it reads as a facade fault and not a whole-model fault |

## 22. Gates (§28)

All of these were run, in this working tree, at the state this report describes.

| gate | command | result |
|---|---|---|
| focused facade / opening tests | `vitest run tests/marcowki-facade.test.ts` | **73 passed** |
| recess / loggia tests | same file, §9/§10 block | 4 passed |
| balcony / railing tests | same file, §11 and §12 blocks | 6 passed |
| opening-group tests | same file, §5/§7/§14/§15/§16 block | 14 passed |
| facade projection / source-anchor tests | same file, §21 block | 12 passed |
| interior ↔ exterior adjacency tests | same file, §8 block | 13 passed |
| Stages 01 / 01B / 01C | `vitest run tests/wall-compiler.test.ts tests/wall-junction.test.ts tests/storey-ring.test.ts` | **84 passed** |
| Stages 02 / 02A | `vitest run tests/marcowki-shell.test.ts tests/eave-closure.test.ts tests/roof-compiler.test.ts` | **71 passed** |
| Stage 03 | `vitest run tests/source-package.test.ts tests/source-adapter.test.ts tests/source-resolution.test.ts` | **64 passed** |
| Stage 04 | `vitest run tests/marcowki-interior.test.ts` | **52 passed** |
| full suite | `npx vitest run` | **446 passed, 20 files, 0 failed** |
| typecheck | `npx tsc --noEmit -p tsconfig.json` | clean |
| build | `npm run build` | clean |
| standalone bundle / build | `npm run standalone:build` | clean |
| browser verification | `npm run standalone:verify` | **11/11 passed** |

The browser run logs one console 404, which is the same pre-existing one earlier
stages recorded; no check depends on it and all eleven pass.

## 23. Assumptions and unresolved

Assumptions, each stated in the gold:

- The kotłownia/garage door's head is **2.10 m**, matching every other single
  door in the house. No drawing dimensions it.

Unresolved, carried rather than absorbed:

1. **The printed `140 | 220` pair** at the head of the attic plan's top
   dimension row. Their extension lines fall at x 0.57 and x 1.55 — a 0.99 m
   segment — and neither number matches any distance the drawing shows there. No
   feature in this file depends on them.
2. **The balcony slab's exact thickness.** Its top is measured at 2.96 and its
   soffit at 2.41 on the rear elevation, where timber below and glass above
   bracket the fascia; the plans dimension neither.
3. **The balustrade's height.** The elevations put the top of the glass at 3.85
   (rear) and 3.89 (front), 0.89–0.93 m above the measured slab top — below what
   a balustrade is normally built to. Either the slab top is lower than measured
   or the renders show the glass without its top rail. The model uses 0.90 and
   says so.
4. **The garage's flat roof level.** The section fixes it at 2.88; the front
   elevation measures the band top at 3.081 and 3.097, the east at 3.06..3.14
   and the rear at 2.99 on the garage's north wall. The shell's 2.88 is kept for
   the roof and the measured 3.08 for the portal head; the ~0.2 m parapet
   upstand is recorded, not modelled.
5. **The kotłownia door's head**, as above.
6. **The balcony slab's west edge.** The attic plan's edge line sits at x 3.338
   and the front elevation's dark band begins at 3.185..3.236. The plan is taken
   per the authority order and the 0.15 m difference is left standing.

Two further facts found while assembling the whole house, recorded here because
they are inconsistencies between earlier stages rather than of this one:

- **The two gold files disagree about the upper floor slab.** The shell insets it
  to the bearing rectangle x 0.45..7.45, z 0.45..12.15 and runs the ground walls
  past it to 3.06; the interior spans the whole 7.90 × 12.60 outline. Taken
  together that is 0.33 m of slab inside the wall head — the same material
  twice. The scene keeps the shell's **footprint** and the interior's **void**,
  so one slab bears where the shell says with the stair opening STAGE
  WEB-PIVOT-04 proved still in it. With that join, the whole house shares **0
  m** of volume between any two of its 35 solid elements.
- **The published side elevations' labels are unreliable** and were ignored in
  favour of content, as §5 records.

## 24. Verdict

Every mandatory item in §5, §7, §9–§18 and §21–§26 is implemented and measured:

- twelve structural openings, every one a real hole in every leaf, with fills
  inside the cut and no glass outside it;
- two 1.00 m recesses proven by 120 depth probes, with real wall returns that
  meet the roof soffit with neither gap nor overlap;
- three slabs whose measured volumes equal their stated ones exactly;
- two glass balustrades in the four panels the plan draws, with no daylight
  between them;
- one portal whose mouth passes 66 rays and whose jambs and head are named
  elements that exist;
- three raked gable openings that follow the printed polygon to 3 mm, with the
  wall closed over each of them;
- four orthographic elevations in which all eleven visible openings land on
  their source rectangles at 100% open inside and 0% beside;
- every opening looking into the room it claims.

`PASS_STAGE_WEB_PIVOT_05_MARCOWKI_CHARACTERISTIC_FACADE`

## 25. Recommended next bounded step

**Cut the roof planes, so the three 78/118 rooflights and the chimney can come
through the roof.** They are the only source-supported openings this stage
counted and did not implement, and the reason is a single missing capability:
`compileRoofs` emits a roof plane as a closed prism with no way to take a hole
out of it. The step is bounded in the same way STAGE WEB-PIVOT-02A was — one
contract (`RoofOpeningSpec`: a plan rectangle, a host roof, a kerb upstand), one
compiler path, and the oracles this stage already has (`rayIntervals` through the
plane, the polygon oracle for the opening's own outline). It would finish the
west elevation's opening count, carry STAGE WEB-PIVOT-04's chimney shaft out to
where the renders show it, and leave everything else in this report untouched.
