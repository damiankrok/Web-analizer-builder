# STAGE WEB-PIVOT-04 — Marcowki interior ArchitecturalSpec and floor-plan topology

## 1. Starting HEAD

`57b4186bf4d0c9fada401dd507b2699d6d96fc30` — the expected HEAD, verified before any
work started. `git status --short` showed three files already modified from the
§2 preparation (`src/core/contracts/source-package.ts`,
`src/core/contracts/source.ts`, `src/core/pipeline/stages.ts`) and no unknown
OWNER changes. Nothing was reset, cleaned or stashed.

## 2. Final HEAD

Recorded in the commit that carries this report; see §19 of the log below and
`git log --oneline -2` on `claude/new-session-pvd4ik`.

## 3. Branch

`claude/new-session-pvd4ik`.

## 4. Files changed

| file | what |
|---|---|
| `research/gold/marcowki-interior-v1.json` | **new** — the hand transcription of both published floor plans: 2 levels, 5 printed chains, 21 walls, 12 openings, 18 rooms, 1 stair, 1 slab, with a status and a source sentence on every element |
| `src/core/wallspec/interior.ts` | **new** — `InteriorWallSpec` / `RoomSpec` / `InteriorOpeningSpec` / `StairSpec` / `InteriorSlabSpec` and `compileInterior` |
| `src/core/wallspec/marcowki-interior-fixture.ts` | **new** — the gold file turned into an `InteriorSpec`, plus the eight mutations |
| `src/core/dimensions/plan-select.ts` | **new** — the §2 selector: which copy of a floor plan the dimension reader is given |
| `src/core/wallspec/compile.ts` | several openings on one profiled wall, when they share a sill and a head (see §6 below) |
| `src/core/contracts/source.ts` | `SourceAsset.roles` — the four role dimensions, optional, carried through to the analyzer |
| `src/core/contracts/source-package.ts` | `toParsedSource` now copies the role dimensions onto the analyzer's asset view |
| `src/core/pipeline/stages.ts` | the dimension reader selects its ground plan through `selectPlanAsset`, and records both storeys' selections as notes |
| `tests/interior-oracles.ts` | **new** — the independent oracles: coverage, room topology, area cross-check, chains, door cuts, adjacency, stair, slab void, alignment |
| `tests/marcowki-interior.test.ts` | **new** — 52 acceptance tests including the eight mutations |
| `scripts/marcowki-interior-diagnostic.ts` | **new** — the audit console report and the nine renders/overlays |
| `scripts/dimension-source-select.ts` | **new** — the §2 before/after measurement |
| `scripts/plan-measure.ts` | **new** — the raster measuring tool behind every SOURCE_DERIVED number |
| `scripts/plan-calibration.ts` | **new** — the two plans' pixel anchors, shared by the measuring tool and the overlays |
| `scripts/plan-font.ts` | **new** — a 5×7 bitmap font, so the id-debug views can carry ids |
| `docs/MARCOWKI_INTERIOR_ARCHITECTURALSPEC_REPORT.md` | **new** — this report |

## 5. Selected SourcePackage assets

Package `pkg_29b62d3714de8bc4`,
`29b62d3714de8bc473b81f504518eb17efc4e6774dbde3448c86d839af4da940`, unchanged by
this stage. Four of its twelve analysable assets are floor plans:

| asset | roles | decoded | contentHash | used for |
|---|---|---|---|---|
| `asset_8fda78f8654c` | FLOOR_PLAN / GROUND / **DIMENSIONED** | 853×853 | `abfdb262…` | every ground wall, room and chain; the §16 ground overlay |
| `asset_23cd568671ca` | FLOOR_PLAN / GROUND / AREA_LABELS | 853×853 | `87ab5a71…` | the published room labels and areas |
| `asset_8460d17163a4` | FLOOR_PLAN / UPPER_ATTIC / **DIMENSIONED** | 853×853 | `06af9e91…` | every attic wall, room and chain; the §16 attic overlay |
| `asset_d15e9abef990` | FLOOR_PLAN / UPPER_ATTIC / AREA_LABELS | 853×853 | `a1b96ef3…` | the published room labels and areas |

Heights come from `research/gold/marcowki-exterior-shell-v1.json` and not from
the plans, which dimension nothing vertical.

## 6. Dimension-reader selector, before and after

`npx tsx scripts/dimension-source-select.ts` (reproducible; the OCR it runs is
untouched by this stage):

```
package pkg_29b62d3714de8bc4  29b62d3714de8bc473b81f504518eb17efc4e6774dbde3448c86d839af4da940
assets 12, of which floor plans 4

GROUND
  before (legacy analyzerRole PLAN_GROUND): asset_23cd568671ca  853x853  FLOOR_PLAN/GROUND/AREA_LABELS  sha 87ab5a71
  after  (ROLE_DIMENSIONS): asset_8fda78f8654c  853x853  FLOOR_PLAN/GROUND/DIMENSIONED  sha abfdb262
         reason: FLOOR_PLAN / GROUND / DIMENSIONED, preferred over 1 other published copy of the same floor
         rejected asset_23cd568671ca (AREA_LABELS): same floor, annotation AREA_LABELS ranks below DIMENSIONED for reading dimensions
    before: calibration 40.77 px/m, 12 dimensions read, 0 corroborated against the geometry, 10 chains
    after : calibration 40.77 px/m, 8 dimensions read, 0 corroborated against the geometry, 7 chains

UPPER_ATTIC
  before (legacy analyzerRole PLAN_UPPER): asset_d15e9abef990  853x853  FLOOR_PLAN/UPPER_ATTIC/AREA_LABELS  sha a1b96ef3
  after  (ROLE_DIMENSIONS): asset_8460d17163a4  853x853  FLOOR_PLAN/UPPER_ATTIC/DIMENSIONED  sha 06af9e91
         reason: FLOOR_PLAN / UPPER_ATTIC / DIMENSIONED, preferred over 1 other published copy of the same floor
         rejected asset_d15e9abef990 (AREA_LABELS): same floor, annotation AREA_LABELS ranks below DIMENSIONED for reading dimensions
    before: calibration 33.07 px/m, 16 dimensions read, 1 corroborated against the geometry, 12 chains
    after : calibration 33.07 px/m, 14 dimensions read, 1 corroborated against the geometry, 11 chains
```

**The correction is real and the OCR is still weak, and both facts are reported.**
Before the correction the reader was handed the one published copy of each floor
with no dimension chains printed on it, because the legacy single-enum role is
decided by filename and `rzut-parteru-z-powierzchniami` — "ground floor with
areas" — names the storey, so it took `PLAN_GROUND` and the copy carrying the
chains was demoted to `PLAN_OTHER`. It now gets the dimensioned copy. On that
copy it reads 8 tokens on the ground floor and corroborates none of them against
the drawing's own geometry, and 14 on the attic of which it corroborates one.
That is an honest finding about the recogniser on an 853×853 raster whose
dimension text is roughly 7 px tall, and §2 anticipated it: **the manual gold
transcription below does not depend on the OCR at all.**

`§18` allowed exactly this one change and no other automation. The OCR engine,
its thresholds and its grammar are untouched; `plan-select.ts` chooses which
image they are given and nothing else.

One honesty note on scope: the production pipeline reads only the *ground* plan
for dimensions, so the attic selection is computed, recorded as a note and used
by the diagnostics and the overlays, but there is no attic dimension consumer in
the pipeline for it to feed.

## 7. Ground-floor room table

Envelope: the shell's inner faces, x 0.45..7.45 by z 0.45..12.15 for the main
body (81.90 m²) and x 7.90..11.60 by z 5.55..12.15 for the garage (24.42 m²).

| id | level | label | # | polygon area | boundary walls | openings |
|---|---|---|---|---|---|---|
| `g_salon` | ground | Salon + Jadalnia | 4 | 30.049 | `gw_pantry_north` | — |
| `g_kitchen` | ground | Kuchnia | 3 | 9.699 | `gw_kitchen_south` | — |
| `g_hall` | ground | Hol | 2 | 9.277 | `gw_kitchen_south`, `gw_bath_east`, `gw_bath_south`, `gw_room_east`, `gw_entry_north`, `gw_boiler_north`, `gw_boiler_west`, `gw_pantry_north`, `gw_pantry_west`, `gw_pantry_south`, `gw_house_garage` | `gd_bathroom`, `gd_room`, `gd_entry`, `gd_pantry` |
| `g_pantry` | ground | Spizarnia | 5 | 2.215 | `gw_pantry_north`, `gw_pantry_west`, `gw_pantry_south`, `gw_house_garage` | `gd_pantry` |
| `g_bathroom` | ground | Lazienka | 6 | 4.132 | `gw_kitchen_south`, `gw_bath_east`, `gw_bath_south` | `gd_bathroom` |
| `g_room` | ground | Pokoj | 7 | 9.457 | `gw_bath_south`, `gw_room_east` | `gd_room` |
| `g_entry` | ground | Wiatrolap | 1 | 3.818 | `gw_room_east`, `gw_entry_north`, `gw_boiler_west` | `gd_entry`, `gd_boiler` |
| `g_boiler` | ground | Kotlownia | 8 | 6.115 | `gw_boiler_north`, `gw_boiler_west`, `gw_house_garage` | `gd_boiler`, `gd_garage` |
| `g_garage` | ground | Garaz | 9 | 24.420 | `gw_house_garage` | `gd_garage` |

## 8. Upper-floor room table

Envelope: x 0.45..7.45 by z 0.45..12.15, the same 81.90 m² as the ground floor.

| id | level | label | # | polygon area | boundary walls | openings |
|---|---|---|---|---|---|---|
| `u_pokoj_nw` | upper | Pokoj | 6 | 15.446 | `uw_corridor_west`, `uw_pokoj_nw_south` | `ud_pokoj_nw` |
| `u_pokoj_ne` | upper | Pokoj | 7 | 11.180 | `uw_corridor_west`, `uw_pokoj_ne_south` | `ud_pokoj_ne` |
| `u_garderoba_ne` | upper | Garderoba | 8 | 2.514 | `uw_pokoj_ne_south`, `uw_garderoba_ne_west`, `uw_stair_north`, `uw_chimney` | — |
| `u_pralnia` | upper | Pralnia | 5 | 6.949 | `uw_corridor_west`, `uw_pokoj_nw_south`, `uw_pralnia_south` | `ud_pralnia` |
| `u_bathroom` | upper | Lazienka | 4 | 8.045 | `uw_corridor_west`, `uw_pralnia_south`, `uw_bath_south`, `uw_corridor_south`, `uw_room2_west` | `ud_bathroom` |
| `u_garderoba_sw` | upper | Garderoba | 3 | 6.815 | `uw_bath_south`, `uw_room2_west` | `ud_garderoba_sw` |
| `u_pokoj_s` | upper | Pokoj | 2 | 12.935 | `uw_corridor_south`, `uw_room2_west` | `ud_pokoj_s`, `ud_garderoba_sw` |
| `u_corridor` | upper | Korytarz | 1 | 5.704 | `uw_corridor_west`, `uw_pokoj_ne_south`, `uw_garderoba_ne_west`, `uw_stair_north`, `uw_corridor_south` | `ud_pokoj_nw`, `ud_pralnia`, `ud_bathroom`, `ud_pokoj_ne`, `ud_pokoj_s` |
| `u_stairs` | upper | Schody | 9 | 8.313 | `uw_stair_north`, `uw_corridor_south` | — |

## 9. Internal wall table

| id | level | axis | centre (m) | span (m) | thickness | height above FFL | kind | openings | status |
|---|---|---|---|---|---|---|---|---|---|
| `gw_kitchen_south` | ground | X | 7.300 | 0.45..4.11 | 0.12 | 2.730 | PARTITION | — | SOURCE_CORROBORATED |
| `gw_bath_east` | ground | Z | 3.420 | 7.36..8.78 | 0.12 | 2.730 | PARTITION | gd_bathroom | SOURCE_DERIVED |
| `gw_bath_south` | ground | X | 8.840 | 0.45..3.48 | 0.12 | 2.730 | PARTITION | — | SOURCE_CORROBORATED |
| `gw_room_east` | ground | Z | 3.420 | 8.90..12.15 | 0.12 | 2.730 | PARTITION | gd_room | SOURCE_CORROBORATED |
| `gw_entry_north` | ground | X | 10.070 | 3.48..5.37 | 0.12 | 2.730 | PARTITION | gd_entry | SOURCE_CORROBORATED |
| `gw_boiler_north` | ground | X | 8.900 | 5.37..7.45 | 0.26 | 2.730 | STRUCTURAL | — | SOURCE_CORROBORATED |
| `gw_boiler_west` | ground | Z | 5.430 | 9.03..12.15 | 0.12 | 2.730 | PARTITION | gd_boiler | SOURCE_CORROBORATED |
| `gw_pantry_north` | ground | X | 4.970 | 5.37..7.45 | 0.12 | 2.730 | PARTITION | — | SOURCE_CORROBORATED |
| `gw_pantry_west` | ground | Z | 5.430 | 5.03..6.16 | 0.12 | 2.730 | PARTITION | gd_pantry | SOURCE_DERIVED |
| `gw_pantry_south` | ground | X | 6.220 | 5.37..6.44 | 0.12 | 2.730 | PARTITION | — | SOURCE_DERIVED |
| `gw_house_garage` | ground | Z | 7.675 | 5.55..12.15 | 0.45 | 2.730 | STRUCTURAL, not emitted | gd_garage | SOURCE_CORROBORATED |
| `uw_corridor_west` | upper | Z | 3.950 | 0.45..8.78 | 0.12 | 2.600 | PARTITION | ud_pokoj_nw, ud_pralnia, ud_bathroom | SOURCE_CORROBORATED |
| `uw_pokoj_ne_south` | upper | X | 3.760 | 4.01..5.28 | 0.12 | 2.600 | PARTITION | ud_pokoj_ne | SOURCE_CORROBORATED |
| `uw_garderoba_ne_west` | upper | Z | 5.220 | 3.82..5.03 | 0.12 | 2.600 | PARTITION | — | SOURCE_CORROBORATED |
| `uw_pokoj_nw_south` | upper | X | 5.000 | 0.45..3.89 | 0.12 | 1.678..2.600 sloped | PARTITION | — | SOURCE_CORROBORATED |
| `uw_pralnia_south` | upper | X | 7.140 | 0.45..3.89 | 0.12 | 1.678..2.600 sloped | PARTITION | — | SOURCE_CORROBORATED |
| `uw_bath_south` | upper | X | 9.740 | 0.45..3.35 | 0.12 | 1.678..2.600 sloped | PARTITION | — | SOURCE_CORROBORATED |
| `uw_stair_north` | upper | X | 5.090 | 5.16..7.45 | 0.12 | 1.678..2.600 sloped | PARTITION | — | SOURCE_DERIVED |
| `uw_corridor_south` | upper | X | 8.840 | 3.35..7.45 | 0.12 | 1.678..2.600 sloped | PARTITION | ud_pokoj_s | SOURCE_CORROBORATED |
| `uw_room2_west` | upper | Z | 3.410 | 8.90..12.15 | 0.12 | 2.600 | PARTITION | ud_garderoba_sw | SOURCE_CORROBORATED |
| `uw_chimney` | upper | X | 4.725 | 5.50..6.11 | 0.61 | 2.600 | STRUCTURAL | — | SOURCE_DERIVED |

And the openings:

| id | level | host wall | along the wall (m) | width | sill..head | kind | connects | status |
|---|---|---|---|---|---|---|---|---|
| `gd_bathroom` | ground | `gw_bath_east` | 7.81..8.71 | 0.90 | 0.00..2.00 | DOOR | g_bathroom ↔ g_hall | SOURCE_DERIVED |
| `gd_room` | ground | `gw_room_east` | 9.00..9.90 | 0.90 | 0.00..2.00 | DOOR | g_room ↔ g_hall | SOURCE_DERIVED |
| `gd_entry` | ground | `gw_entry_north` | 4.21..5.14 | 0.93 | 0.00..2.00 | DOOR | g_entry ↔ g_hall | SOURCE_DERIVED |
| `gd_boiler` | ground | `gw_boiler_west` | 10.46..11.36 | 0.90 | 0.00..2.00 | DOOR | g_boiler ↔ g_entry | SOURCE_DERIVED |
| `gd_pantry` | ground | `gw_pantry_west` | 5.24..6.04 | 0.80 | 0.00..2.00 | DOOR | g_pantry ↔ g_hall | SOURCE_DERIVED |
| `gd_garage` | ground | `gw_house_garage` | 10.46..11.38 | 0.92 | 0.00..2.00 | DOOR (recorded, not cut) | g_boiler ↔ g_garage | SOURCE_DERIVED |
| `ud_pokoj_nw` | upper | `uw_corridor_west` | 3.94..4.77 | 0.83 | 0.00..2.00 | DOOR | u_pokoj_nw ↔ u_corridor | SOURCE_DERIVED |
| `ud_pralnia` | upper | `uw_corridor_west` | 5.64..6.40 | 0.76 | 0.00..2.00 | DOOR | u_pralnia ↔ u_corridor | SOURCE_DERIVED |
| `ud_bathroom` | upper | `uw_corridor_west` | 7.83..8.58 | 0.75 | 0.00..2.00 | DOOR | u_bathroom ↔ u_corridor | SOURCE_DERIVED |
| `ud_pokoj_ne` | upper | `uw_pokoj_ne_south` | 4.20..5.00 | 0.80 | 0.00..2.00 | DOOR | u_pokoj_ne ↔ u_corridor | SOURCE_DERIVED |
| `ud_pokoj_s` | upper | `uw_corridor_south` | 4.08..4.98 | 0.90 | 0.00..2.00 | DOOR | u_corridor ↔ u_pokoj_s | SOURCE_DERIVED |
| `ud_garderoba_sw` | upper | `uw_room2_west` | 10.70..11.52 | 0.82 | 0.00..2.00 | DOOR | u_garderoba_sw ↔ u_pokoj_s | SOURCE_DERIVED |

## 10. Source area against polygon area

The published room areas are **not** raw plan-polygon areas, and two rooms
identify the convention exactly. The attic `Pokój` is printed 344 × 449, a raw
15.4456 m², and published as 15.13 m². The attic `Pralnia` is printed 344 × 202,
a raw 6.9488 m², and published as 6.73 m². Both are reproduced to the centimetre
by

    A(d) = A − P·d + 4d²     with d = 0.02 m

which is the plan area measured to *finished* surfaces with 20 mm of finish on
every face. (For any simple rectilinear polygon the convex and reflex right
angles satisfy C − R = 4, so the formula is exact and not an approximation.)
Both rooms are simple rectangles with both dimensions printed, so there is no
freedom in the polygon: if the rule were wrong they could not land.

The rule is a **finding about the source, not an input to any geometry here**.
No polygon was moved to make it fit; the table reports the raw area, the inset
area and the published figure, and classifies against the inset one.

| room | label | raw m² | finished m² | published m² | Δ% | class |
|---|---|---|---|---|---|---|
| `g_salon` | Salon + Jadalnia | 30.049 | 29.592 | 29.52 | +0.2 | MATCH |
| `g_kitchen` | Kuchnia | 9.699 | 9.448 | 9.63 | −1.9 | CLOSE |
| `g_hall` | Hol | 9.277 | 8.912 | 9.18 | −2.9 | CLOSE |
| `g_pantry` | Spiżarnia | 2.215 | 2.093 | 2.42 | −13.5 | SOURCE_SEMANTICS_DIFFER |
| `g_bathroom` | Łazienka | 4.132 | 3.961 | 3.95 | +0.3 | MATCH |
| `g_room` | Pokój | 9.457 | 9.213 | 9.18 | +0.4 | MATCH |
| `g_entry` | Wiatrołap | 3.818 | 3.663 | 3.70 | −1.0 | MATCH |
| `g_boiler` | Kotłownia | 6.115 | 5.914 | 5.80 | +2.0 | CLOSE |
| `g_garage` | Garaż | 24.420 | 24.010 | 24.10 | −0.4 | MATCH |
| `u_pokoj_nw` | Pokój | 15.446 | 15.130 | 15.13 | **0.0** | MATCH |
| `u_pokoj_ne` | Pokój | 11.180 | 10.914 | 10.88 | +0.3 | MATCH |
| `u_garderoba_ne` | Garderoba | 2.514 | 2.351 | 2.38 | −1.2 | MATCH |
| `u_pralnia` | Pralnia | 6.949 | 6.732 | 6.73 | **0.0** | MATCH |
| `u_bathroom` | Łazienka | 8.045 | 7.810 | 7.81 | **−0.0** | MATCH |
| `u_garderoba_sw` | Garderoba | 6.815 | 6.607 | 6.53 | +1.2 | MATCH |
| `u_pokoj_s` | Pokój | 12.935 | 12.647 | 11.88 | +6.5 | SOURCE_SEMANTICS_DIFFER |
| `u_corridor` | Korytarz | 5.704 | 5.461 | 6.17 | −11.5 | SOURCE_SEMANTICS_DIFFER |
| `u_stairs` | Schody | 8.313 | 8.077 | 5.63 | +43.5 | SOURCE_SEMANTICS_DIFFER |

Eleven MATCH, three CLOSE, four SOURCE_SEMANTICS_DIFFER, none UNRESOLVED and
none COMPILER_FAIL. Every difference beyond 5% is named:

- **`g_pantry`** — the drawing shows the stair soffit over the pantry's
  south-east corner, and `gw_pantry_south` stops at the measured x 6.435 rather
  than reaching the east wall. The published *gross* 2.42 m² appears to include
  floor the model gives to the stair; the published *net* 1.44 m² applies a
  headroom rule the plans do not state.
- **`u_pokoj_s`** — the attic plan draws a recess at the room's north-west
  corner that the model does not reproduce. The 0.77 m² difference is that
  recess.
- **`u_corridor` and `u_stairs`** — no wall separates Korytarz from Schody, so
  the published pair 6.17 + 5.63 = 11.80 m² splits a space the model splits
  differently at `uw_stair_north`'s west end. The model's own pair is
  5.46 + 8.08 = 13.54 m², and the model's `u_stairs` polygon includes the floor
  void, which a published floor area would not.

The attic's published *usable* areas (12.57 against a 15.13 gross, and so on)
apply an unstated headroom rule. The model reports the raw and finished plan
areas and never the net one; §9's own note allows exactly this, and no attic
polygon was distorted to chase a usable-area number.

## 11. Coverage, overlap and uncovered audit

```
level    envelope     rooms     walls     stair   overlap uncovered
ground    106.320    99.183     3.019     4.118     0.000     0.000
upper      81.900    77.900     4.000     0.000     0.000     0.000
```

The storey is decomposed exactly, on the union of every x and every z any
element mentions, so each cell is entirely inside or entirely outside each
element and the result is arithmetic rather than sampling. Cells are tested at
their centres, so two rooms that share an edge do not overlap — which is §7's
distinction between touching and overlapping.

**Both storeys tile to the last square centimetre.** Rooms plus interior wall
footprints plus the stair equal the interior envelope, with no overlap and no
uncovered remainder at all. Nothing is approximate here and nothing is excused:
the number that would be non-zero if a wall or a room were in the wrong place
is 0.000 on both floors.

Intentional exclusions are therefore all *accounted*, not discarded:
wall thickness is 3.019 m² on the ground floor and 4.000 m² in the attic, and
the stair shaft is 4.118 m². The garage is audited inside the same ground
envelope as its own compartment.

## 12. Door adjacency graph

```
ground: 9 rooms, 9 ways through, one connected component
    g_bathroom <-> g_hall      via gw_bath_east     (DOOR)
    g_room     <-> g_hall      via gw_room_east     (DOOR)
    g_entry    <-> g_hall      via gw_entry_north   (DOOR)
    g_boiler   <-> g_entry     via gw_boiler_west   (DOOR)
    g_pantry   <-> g_hall      via gw_pantry_west   (DOOR)
    g_boiler   <-> g_garage    via gw_house_garage  (DOOR, recorded not cut)
    g_salon    <-> g_hall      via open             (OPEN_BOUNDARY)
    g_salon    <-> g_kitchen   via open             (OPEN_BOUNDARY)
    g_kitchen  <-> g_hall      via open             (OPEN_BOUNDARY)

upper: 9 rooms, 8 ways through, one connected component
    u_pokoj_nw     <-> u_corridor  via uw_corridor_west     (DOOR)
    u_pralnia      <-> u_corridor  via uw_corridor_west     (DOOR)
    u_bathroom     <-> u_corridor  via uw_corridor_west     (DOOR)
    u_pokoj_ne     <-> u_corridor  via uw_pokoj_ne_south    (DOOR)
    u_corridor     <-> u_pokoj_s   via uw_corridor_south    (DOOR)
    u_garderoba_sw <-> u_pokoj_s   via uw_room2_west        (DOOR)
    u_pokoj_ne     <-> u_garderoba_ne via open              (OPEN_BOUNDARY)
    u_corridor     <-> u_stairs    via open                 (OPEN_BOUNDARY)
```

Every room on each floor is reachable from every other, and the two floors are
joined by the stair. Open-plan boundaries are edges too: a graph that counted
only doors would call an open-plan kitchen unreachable.

Every cut opening was checked by ray: material met crossing the wall at the
opening's centre is **0.0000 m** for all eleven, while the same ray 0.06 m past
a jamb meets 0.1200 m and the same ray 0.20 m above the head meets 0.1200 m. The
holes are real and they are the right size. Each opening's two rooms were also
checked to sit on opposite sides of its host wall; all eleven do.

`gd_garage` is the one exception and it is stated rather than quietly dropped:
the kotłownia/garage door is read off the plan (the 10.456..11.382 gap in the
column scans at x 7.6 and 7.75, straight through the main body's east wall), it
is recorded in the spec and it is an edge in the graph, but its host is the
STAGE WEB-PIVOT-02 exterior shell and this stage does not cut the shell. That is
§24's boundary, not an oversight.

## 13. Stair and slab-opening semantics

```
stair volume 6.486 m³, base 0.000 m, top 3.060 m, reaches the attic floor: true
stair footprint x 5.370..7.450 z 6.790..8.770, uncovered 0.000 m²
stair material shared with walls or the plate: 0.00e+0 m³
slab volume 31.489 m³ against 31.489 m³ with the hole and 32.848 m³ without it
vertical line through the void meets 0.000 m of plate; 0.20 m outside it, 0.330 m
stair footprint still covered by plate: 0.00e+0 m²
```

- The flight starts at the ground finished floor and its top tread is at 3.060 m,
  the attic finished floor, to nine decimal places.
- Its emitted steps cover its stated 2.08 × 1.98 m footprint with nothing left
  over, and share no material with any wall or with the floor plate.
- The plate is emitted as **four boxes around one rectangular hole**, so the
  hole is a real absence rather than a shaded one: the measured volume equals
  the plate less the hole exactly, a vertical line through the void meets no
  plate at all, and the same line 0.20 m outside it meets the full 0.330 m
  thickness. There is no duplicate solid through the opening — the shell's own
  floor plate is dropped from the combined scene precisely so that two plates
  cannot occupy the same place.
- The general polygon boolean §13 warns against was not written. `plateWithHole`
  does one axis-aligned rectangle in one axis-aligned rectangle, which is the
  whole of what this stage needs.

**Where the footprint comes from, and how it is checked.** The shaft is the
2.08 × 1.98 m zone east of the hall between the measured top-step line at
z 6.78..6.99 and `gw_boiler_north`'s north face at z 8.77. It is not a guess:
subtracting it from the circulation space leaves 9.28 m² against the published
`Hol` of 9.18 m², which is an independent check that the footprint is the right
size and in the right place.

**The simplification, stated.** The ground plan draws tread nosings running
across X in the southern band and across Z at the east end — a U with winders.
The model uses two straight flights joined at the east end, 17 risers of 0.18 m
(8 then 9). The winders are *not* represented: the turn is a change of flight
rather than tapered treads. That is a modelling choice, recorded in the gold
file's `stairs[0].simplification`, and §12 allows it — the goal there is correct
location and vertical connection, not visual polish.

## 14. Two-floor alignment proof

```
  ground: x 0.45..7.45 z 0.45..12.15
  upper:  x 0.45..7.45 z 0.45..12.15
  envelopes agree: true; the slab void lands inside the attic stair compartment: true
  gw_room_east and uw_room2_west are 0.010 m apart
  gw_boiler_north and uw_corridor_south are 0.060 m apart
```

Both storeys are stated in the STAGE WEB-PIVOT-02 world frame and share one
interior envelope. The two walls the *source* says are one structural line —
`gw_room_east` and `uw_room2_west`, both fixed by a printed 290 from the west
inner face — land 0.010 m apart, which is well inside one pixel of either
drawing. `gw_boiler_north` and `uw_corridor_south` are 0.060 m apart, which is
the difference between the printed 312 the kotłownia is dimensioned by and the
printed 325 the attic bedroom is dimensioned by; both are read, neither is
adjusted.

No screenshot fitting was used anywhere: the alignment comes from the printed
dimensions and the accepted shell frame. Mirroring or rotating the attic layout
breaks both checks at once — see mutations 7a and 7b.

## 15. Dimension-chain checks

Two chains per floor, one horizontal and one vertical, each crossing several
internal walls:

```
chain_ground_x_south 2.9 | 1.9 | 1.96 from 0.45 to 7.45 → closure 0.00e+0 m
    boundary at 3.350 → gw_bath_east      face 3.360 (error 0.010 m)
    boundary at 5.370 → gw_boiler_west    face 5.370 (error 0.000 m)
chain_ground_z_west  4.14 | 2.65 | 1.42 | 3.25 from 0.45 to 12.15 → closure 0.00e+0 m
    boundary at 4.590 → (no wall: open-plan split)
    boundary at 7.240 → gw_kitchen_south  face 7.240 (error 0.000 m)
    boundary at 8.780 → gw_bath_south     face 8.780 (error 0.000 m)
chain_upper_x_north  3.44 | 3.44 from 0.45 to 7.45 → closure -0.00e+0 m
    boundary at 3.890 → uw_corridor_west  face 3.890 (error 0.000 m)
chain_upper_z_west   4.49 | 2.02 | 2.48 | 2.35 from 0.45 to 12.15 → closure -0.00e+0 m
    boundary at 4.940 → uw_pokoj_nw_south face 4.940 (error 0.000 m)
    boundary at 7.080 → uw_pralnia_south  face 7.080 (error 0.000 m)
    boundary at 9.680 → uw_bath_south     face 9.680 (error 0.000 m)
chain_upper_x_south  2.9 | 3.98 from 0.45 to 7.45 → closure 0.00e+0 m
    boundary at 3.350 → uw_room2_west     face 3.350 (error 0.000 m)
```

Each chain's endpoints are real wall faces (the shell's inner faces), the
printed segments plus the measured wall thicknesses close on the printed total
to floating-point exactness, and every boundary the chain steps over lands on an
actual wall face — six of the seven to 0.000 m and the seventh to 0.010 m. The
one boundary that lands on nothing is stated as landing on nothing: the
414-from-the-north split in the open-plan salon/kitchen crosses no wall, and the
gold file records its crossing thickness as 0.

**Manual gold truth and automatic OCR output are kept apart.** These chains were
transcribed by hand from the DIMENSIONED plans and checked against the raster
with `scripts/plan-measure.ts`; the OCR's own reading is reported separately in
§6 and is *not* claimed as the source of any number here. Nothing in this stage
claims automation the recogniser did not deliver.

## 16. Diagnostic images

`npx tsx scripts/marcowki-interior-diagnostic.ts` → `out/marcowki-interior/`

| file | view |
|---|---|
| `01-ground-plan-top.png` | ground floor from directly above, attic, slab and roofs hidden |
| `02-upper-plan-top.png` | attic from directly above, roofs hidden |
| `03-exploded-two-floors.png` | the two storeys pulled 4 m apart vertically |
| `04-interior-oblique.png` | oblique interior with the roofs and the two nearest exterior walls removed |
| `05-stair-and-slab-void.png` | the stair and the hole it comes up through; the plate is drawn see-through *here and nowhere else*, because an opaque plate seen from above hides the thing the view exists to show |
| `06-room-ids-ground.png`, `06-room-ids-upper.png` | every room's id, published label and plan area |
| `07-wall-opening-ids-ground.png`, `07-wall-opening-ids-upper.png` | every wall's id and thickness and every opening's id and width |
| `08-overlay-ground.png`, `09-overlay-upper.png` | **the registration proof** — the published drawing with the gold walls (red), room polygons (blue) and the stair/void (orange) drawn straight onto it |

The five 3D views are a software rasterisation of the emitted triangle list by
this repository's own renderer. They are not browser screenshots and no product
UI is touched.

The two overlays are orthographic and affine by construction: the mapping is two
pixel anchors per axis from `scripts/plan-calibration.ts` and nothing else.
There is no perspective fit anywhere in them, which is what makes them evidence
— a wall transcribed into the wrong place lands off the ink, visibly, and the
reader does not have to take the numbers on trust.

## 17. Mutation results

Eight defects, each built behind an option on the fixture and never committed as
a default. All eight are caught.

| # | mutation | caught by |
|---|---|---|
| 1 | `uw_pokoj_nw_south` slid 0.30 m off the printed 449 boundary | `chainCheck`: the chain's 4.940 boundary lands on no wall face, nearest face 0.09 m away |
| 2 | `g_bathroom` grown 0.50 m across its neighbour | `ROOM_OVERLAP` from the compiler **and** 0.710 m² of overlap in the coverage audit |
| 3 | `g_room` pulled 0.40 m back from its wall | 1.300 m² uncovered in the coverage audit, largest gap 0.808 m² |
| 4 | `ud_pokoj_s` re-hosted on `uw_corridor_west` | `separatesItsRooms` false **and** `OVERLAPPING_OPENINGS` from the wall compiler |
| 5 | the stair void left out of the slab | a vertical line through the void meets the full 0.330 m of plate, the volume equals the whole plate, and the stair's entire 4.118 m² footprint is still covered by plate |
| 6 | the void slid 1.20 m away from the stair below it | the plate is still the right volume and still has a hole, and 2.471 m² of the stair's 4.118 m² footprint comes up under solid plate |
| 7a | the attic layout mirrored about the building's centre line | the slab void no longer lands inside the attic stair compartment, and the structural pair opens to more than 1 m |
| 7b | the attic layout turned through 180° | the same two checks, the same way |
| 8 | the AREA_LABELS copy selected where DIMENSIONED was required | `selectPlanAsset` refuses it in either input order, and the legacy-role fallback is shown returning exactly the wrong asset the correction replaced |

No mutant is committed. `marcowkiInteriorSpec()` with no options is the gold
model, and every mutation is a parameter the tests pass explicitly.

## 18. Tests, build and browser gates

| gate | result |
|---|---|
| focused interior topology / room polygon / door adjacency / stair-slab / selector tests | `tests/marcowki-interior.test.ts` — **52 passed** |
| Stage 01 / 01B / 01C (`wall-compiler`, `wall-junction`, `storey-ring`) | passed |
| Stage 02 / 02A (`marcowki-shell`, `roof-compiler`, `eave-closure`) | passed |
| Stage 03 SourcePackage (`source-package`) | 37 passed |
| full suite | `npx vitest run` — **373 passed, 19 files**, 117 s |
| typecheck | `npx tsc -p tsconfig.json --noEmit` — clean |
| normal build | `npm run build` — clean |
| standalone bundle/build | `npm run standalone:build` — clean |
| browser verification | `npm run standalone:verify` — **11/11 passed**; the single console 404 is the expected `/favicon.ico` the verifier already documents |

## 19. Production isolation proof

- **The gold interior is not wired into the automatic analyzer.** The only
  module that imports `research/gold/marcowki-interior-v1.json` is
  `src/core/wallspec/marcowki-interior-fixture.ts` (`scripts/plan-measure.ts`
  names it in a comment and reads nothing), and that fixture is imported only by
  `tests/marcowki-interior.test.ts` and `scripts/marcowki-interior-diagnostic.ts`.
  Nothing under `src/core/pipeline`, `src/core/hypotheses`, `src/core/scoring`,
  `src/web` or `src/ui` imports anything from `src/core/wallspec` at all —
  `grep -rn 'wallspec/'` over those five directories returns nothing. No gold
  coordinate is reachable from the URL → model flow.
- **The repair loop, camera scoring, the mass solver and the score weights are
  untouched.** The only production file changed is `src/core/pipeline/stages.ts`,
  and the change is the §2 selector plus two audit notes.
- **The analyzer's output is unchanged.** Re-running the production CLI on both
  projects reproduces the scores recorded at the end of STAGE WEB-PIVOT-03 to
  four decimal places:

  | project | STAGE WEB-PIVOT-03 | now |
  |---|---|---|
  | A — Dom w marcówkach (GE) | 0.2176 | **0.2176** |
  | B — Dom w bakopach (G2E) | 0.2118 | **0.2118** |

  So the selector correction gives the dimension reader the right drawing
  without moving the model. That is the expected result and not a surprise: the
  reader corroborates nothing on either copy, so the evidence it contributes is
  the same either way. Nothing changed unexpectedly, and nothing needed
  investigating.
- The one change to shared compiler code is described in §20 below, and every
  earlier stage's tests pass against it unchanged.

## 20. Assumptions and unresolved

**The one change to proven code.** `compileProfiledWall` compiled exactly one
opening per wall, because two *raked* heads can cross each other and reorder the
bands its tiling pairs up. The attic corridor wall carries three doorways. The
restriction is now conditional: several openings are compiled when none has a
raked head and all share a sill and a height, which is precisely the condition
under which every strip is still split at the same four heights and the pairing
cannot reorder. Anything else keeps the old rule — one opening, the rest refused
by name. A doorway also has its sill *at the floor*, which only the profiled
path can express, which is why every interior wall here carries an explicit top
profile even where that profile is level.

**Assumptions, stated:**

- Attic partitions are capped at 2.60 m above the attic floor where the roof is
  higher than that. The plans dimension the 130 knee wall and the ridge, not the
  ceiling line, so 2.60 m is the author's choice; below it the partitions follow
  the roof's real underside, `4.36 + tan(40°)·min(x, 7.90 − x)`, which is the
  same plane STAGE WEB-PIVOT-02A gave the attic side walls.
- Interior door heads are at 2.00 m. The plans dimension no interior opening
  vertically.
- The stair is two straight flights, not the drawn U with winders (§13).

**Unresolved, carried in the gold file:**

1. The exact west edge of the ground-floor hall where it meets the open-plan
   kitchen: the drawing prints no chain across it, and 4.11 m is the free end of
   `gw_kitchen_south` rather than a measured room boundary.
2. The ground-floor pantry's published gross 2.42 m² against the 2.21 m² the
   measured walls enclose (§10).
3. The boundary between the attic Korytarz and Schody, which no wall draws (§10).
4. The published *net* areas of the attic rooms, which apply a headroom rule the
   plans do not state. The model reports raw and finished plan areas and never
   the net one.
5. Whether the kotłownia/garage door is a fire door and how it is detailed; only
   its position is read, and it is not cut, because its host is the exterior
   shell.

Observed and deliberately not modelled: the stair's winders, the attic balcony
beyond the south wall, all furniture and sanitary ware, the external window and
door callouts, and the ground-floor flue block beside the fireplace.

## 21. Exactly one recommended next bounded step

**Cut the openings the source already states into the STAGE WEB-PIVOT-02
exterior shell — windows, external doors and the kotłownia/garage door — from
the printed `width/height` callouts on the plans and elevations, with the same
kind of proof this stage gave the interior doors: every opening a measured hole,
every hole traced back to a printed callout, and a mutation test that catches one
placed on the wrong facade.**

It is bounded, it is the only thing standing between the current model and a
house a person can see through, it needs no new representation (the openings are
`OpeningSpec` on walls that already exist), and it closes the one place where
this stage had to record a door instead of building it. It is deliberately *not*
the characteristic loggia/recess, the balcony, the portal or the large-glazing
composition, which §24 puts in a later stage.

---

STOP. Per §25 this stage ends at the interior proof; characteristic facade
geometry has not been started.

`PASS_STAGE_WEB_PIVOT_04_MARCOWKI_INTERIOR_SPEC`
