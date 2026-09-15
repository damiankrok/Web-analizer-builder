# STAGE WEB-PIVOT-07 — automatic section / elevation → levels, roof, facade candidate

**Project:** BuildPlan Web Analyzer Research
**Branch:** `claude/new-session-pvd4ik`
**Result:** `PARTIAL_STAGE_WEB_PIVOT_07_AUTOMATIC_SECTION_ELEVATION_SPEC`

## 1. Start and final HEAD

| | |
| --- | --- |
| expected starting HEAD | `0931fd91ada7a2be30b49a388b66c7ca42232bb1` |
| actual starting HEAD | `0931fd91ada7a2be30b49a388b66c7ca42232bb1`, branch `claude/new-session-pvd4ik`, clean worktree |
| Stage-06A frozen code | `d94db119a840bf02164c05b1eee21d453b9bb694` (unchanged) |
| Stage-06A report | `b48413f77deb1af1f37e82ab19b34fdaaed1328b` (unchanged) |
| freeze commit (§33) | `8710b565e1bbada0169fb6c4e5446ebc851c0016` |
| final HEAD | recorded in §31 of this report, written immediately after it |

Nine commits. Stages 06 and 06A were not rewritten: §1's list — source roles, the
OCR seam, the Tesseract abstraction, dimension observations, physical ownership,
the chain solver, metric registration, wall bands, logical host walls, doorway
observations, room topology, open passages, label evidence, the provenance and
conflict DTOs, gold isolation, holdout discipline and production isolation — is
intact, and Stage 07 consumes the floor-plan candidate as evidence.

## 2. Holdout G, declared before any Stage-07 code

`research/holdout/web-pivot-07-holdout.json`, committed at
**`85a012f0d378659957ef233527758bb9c90be270`** — before the first line of
extraction code in this stage.

| | |
| --- | --- |
| project | G — *Dom w kostrzewach 19* |
| id | `m215297bb5224c` |
| URL | https://www.archon.pl/projekty-domow/projekt-dom-w-kostrzewach-19-m215297bb5224c |
| SourcePackage | `pkg_6f27e23c14270308`, hash `6f27e23c142703087eb5d680915716347269039a1d25779038114ea5f51a55f4` |
| roles observed | SECTION ×1, ELEVATION ×4 (FRONT/REAR/LEFT/RIGHT), FLOOR_PLAN/GROUND DIMENSIONED and AREA_LABELS, SITE_PLAN, 9 renders |

Selected on two facts and no others: the role classifier reports the drawings
this stage consumes, and the house family is not one already spent as A–F. Of
the families left on the listing, kostrzewy is first alphabetically and
kostrzewy 19 first within it. F is retired to `HISTORICAL_HOLDOUT_WEB06A`.

G's page bytes are committed, so the package rebuilds offline to the identical
hash and the one run this stage is allowed can be repeated without the network.

## 3. Source asset inventory

| project | section | elevations | plans | note |
| --- | --- | --- | --- | --- |
| A | `asset_b1e8c064c1ba` 1138×854 | 4 × 1280×597 | GROUND + UPPER_ATTIC, dimensioned and area-labelled | primary |
| B | `asset_61a0333a93b9` | 4 | GROUND + UPPER_ATTIC | regression |
| G | `asset_876d682d99bb` | 4 | GROUND only | holdout |

**A structural finding about these sources, which shapes the whole stage.**
ARCHON does not publish line-art elevations. All four of A's are orthographic
*renders*: real materials, a photographic sky, trees in front of the facade, and
**no dimension line anywhere on any of them**. They are legitimate orthographic
evidence — §17 is right to treat them as planar technical drawings — but nothing
on them is a stated dimension, so everything measured from one is
`RENDER_DERIVED` and never better. The section is a real line drawing and is
where all the exactness in this stage comes from.

## 4. Candidate DTO changes (§26)

`ArchitecturalSpecCandidate` gains `shell: CandidateShell | null` and its schema
version becomes `architectural-spec-candidate-1.1.0` when the shell is present.
Nullable rather than empty, because a package with no section is not a building
with no roof.

`CandidateShell` carries `verticalDatums`, `levels`, `slabs`, `roofTopology`,
`roofComponents`, `roofPlanes`, `pitch`, `elevations`, `facadeOpenings`,
`roofOpenings`, `chimneys`, `facadeFeatures`, `crossSourceConflicts`,
`unresolved` and `notes`.

Every measured quantity is a `CandidateMeasure`: a value, a **fidelity**, a
confidence, a **tolerance derived from the drawing it was read on**, the assets
it came from, and why. Fidelity is about the *route* and not the confidence, and
the two are deliberately not collapsed:

`SOURCE_EXACT` → `SOURCE_RECONCILED` → `SOURCE_DERIVED` → `RENDER_DERIVED` →
`GEOMETRIC_INFERENCE` → `UNRESOLVED`.

`SOURCE_RECONCILED` is its own level because the digits were not read, they were
deduced — §2's warning about the attic door widths, applied to levels.

## 5. Section annotation pipeline (§9)

Geometry first, in the order §9 fixes. `section-annotations.ts` finds text runs,
then classifies each structurally by **what it is attached to**: a figure with a
level symbol under it is a level marker, a sideways figure against a long
vertical line is a dimension chain, a figure against an oblique edge is a
callout, and a figure attached to nothing is an observation and not a
constraint.

Two findings made this work.

**A section has two inks.** Its fabric is solid black and its annotation runs
grey 170–230 on paper at 255. One threshold cannot have both: at the fabric's
threshold the entire level symbol is invisible. So a horizontal rule is found by
being darker than what is *above and below* it (the existing `strokeMask`, with
the plan's six-percent length floor lowered to 1.5% — the shelf under a ridge
marker is fifty pixels on an 1138 px sheet), and an oblique hairline by being
darker than what is *beside* it along its row.

**The level is the triangle's apex, not the figure and not the shelf.** The
symbol is a hairline shelf a few pixels under the figure and, below that, a
hollow triangle whose apex touches the height being named. Taking the shelf is
eleven pixels wrong on A — fifteen centimetres of building — and wrong in the
*same direction on every marker*, so no consistency check would ever catch it.
The two sides are tracked row by row and fitted as straight lines; their
crossing is the datum, sub-pixel, and needs no ink exactly there.

Measured on A, all five markers land within half a pixel of where the drawing
was measured by hand:

| marker | apex row found | hand-measured row | method |
| --- | ---: | ---: | --- |
| `+7,95` | 65.44 | 65 | triangle apex |
| `+4,67` | 303.00 | 303 | nearest rule (fallback) |
| `+3,06` | 419.69 | 420 | triangle apex |
| `±0,00` | 642.25 | 642 | triangle apex |
| `-0,32` | 665.15 | 665 | triangle apex |

## 6. OCR and physical association (§8)

No second OCR project. The engine is the Stage-06 `PlanTextEngine` seam, the
crops come from Stage-06's `text-crops.ts`, and no glyph prototype is authored
anywhere in this stage. What differs is the *preparation*, which §8 permits:

- **the alphabet** — a level is a signed decimal (`+7,95`, `±0,00`, `-0,32`) and
  a pitch carries a degree sign, where a plan chain is digits. Reading a level
  with a digits-only whitelist throws away the sign;
- **the padding ladder** — a level figure's sign is a short component the text
  grouper does not always take into the run, and **no single padding reads all
  five of A's markers**. The terrain figure needs half a text-height of paper to
  keep its sign and the ridge figure a full one. So the crop is offered at four
  paddings and *every reading is kept as a hypothesis*, exactly as Stage 06
  already offers a sideways run in both reading directions. Choosing between
  them is the datum solver's job, not the recogniser's.

A number is never a constraint until it is attached to geometry: `buildDatumObservations`
takes markers whose row has already been measured, and a figure with no symbol
under it never becomes a datum.

## 7. Datum solver (§11)

Every pair of markers and every pair of their hypotheses proposes a map
`metres = (datumRow − row) / pixelsPerMetre`. Each proposal is scored by how
many *other* markers have some hypothesis it explains, then by how tightly, then
by how confident those readings were — confidence breaks ties and never decides.
The winner is refined by least squares over its inliers. A scale that would make
the sheet under 2 m or over 60 m tall is rejected outright.

Project A:

| | |
| --- | --- |
| markers | 5 of 5 accepted, 0 reconciled, 0 rejected |
| scale | **72.546 px/m** against a hand measurement of 72.549 |
| zero | row 641.97 against a hand measurement of 642 |
| RMS residual | **3.0 mm** |
| pairwise spread | **0.42%** of the median over 9 pairs |
| recovered levels | −0.32, 0.00, 3.06, 4.67, 7.95 |

The ridge marker matters here. Tesseract read `+7,95` as `195` at confidence
0.00 with the geometry's own crop and as `1.95` with punctuation — twice
insisting on a ridge four metres below the roof above it. The padding ladder
produced `+7,95` at 0.5 text-heights and the consensus accepted that one,
because it is the reading the other four markers agree with.

`reconcileRejected` repairs a marker whose digits are **one substitution** from
what the solved scale predicts, and records it as `RECONCILED`, never as read.
Two characters away is not evidence and stays rejected — tested both ways.

## 8. Cross-source vertical fusion (§12)

`fuseMeasures` implements §12's authority order as code, and its rule is that
**agreement is required before averaging is allowed**:

1. if one route outranks the other, the better one stands and the worse is
   recorded as having been outranked — an elevation silhouette never overrides a
   printed section datum, whatever the pixels say;
2. if the routes rank equally and the values agree inside their combined
   tolerance, they are combined by inverse variance and the result is *more*
   certain than either;
3. otherwise the disagreement stands, `CONFLICTED`, carrying the better-localised
   value. A mean of two values no source states is never produced.

What each printed level *is* is settled by matching it against geometry, not by
ordering: the marker nearest the fitted planes' crossing is the ridge, the one
nearest their low end is the eave, zero is zero, the only negative is terrain.
On A that names all five correctly.

## 9. Roof-edge extraction (§13)

The section's upper surface is decomposed into the straight lines that *support*
it, exhaustively over pairs (deterministic: two runs of this pipeline on one
drawing produce the same roof), strongest first, each line's inliers removed
before the next is fitted. Each accepted line keeps only its **longest
contiguous stretch** of support — forty agreeing samples scattered across eight
hundred columns are a coincidence with a good residual, not a surface.

This matters because A's skyline is interrupted by a chimney standing above the
roof, by the pitch callout drawn over the left slope, by the level figure sitting
on the apex, and by an eave detail the poché never reaches. A traced skyline has
all of that in it; line support has none of it.

| | A |
| --- | --- |
| lines | 2 pitched (181 and 181 samples, 0.40 and 0.35 px RMS), 1 flat (246 samples, 0.38 px) |
| ridge | crossing at row 65.26 → **7.950 m** |
| eaves | 4.738 and 4.739 m (the roof's *top surface* at its low end, not the printed eave datum) |
| build-up | 10 px vertically → **0.106 m** perpendicular, against a hand-measured 0.10 |

The ridge is the crossing of the two fitted planes, never the topmost dark
pixel: accurate to the fit rather than to the drafting pen, and it still works
when a chimney stands on the apex (asserted in the suite).

## 10. Pitch fusion (§14)

Three independent kinds of pitch observation are defined —
`PRINTED_CALLOUT`, `SECTION_EDGE_FIT`, `ELEVATION_SKYLINE_FIT` — and they stay
three. A printed callout outranks a fit, but only once the fit agrees with it;
where they disagree beyond what the fit's tolerance admits, the result is
`CONFLICTED` and carries the printed value *with the disagreement attached*.

Reading the printed value needed the geometry to go first in a second sense.
`40°` is written **along the slope it measures**, at forty degrees to the sheet,
so the upright text finder cannot see it: fifteen runs found on A's section and
the pitch callout is none of them. Once the slope has been fitted its direction
is known, and `oblique-text.ts` cuts a crop in that line's own frame and reads it
through the same engine and the same seam. Clusters that drift *across* the line
by more than a third of their height are upright text passing nearby, not a
callout along it — which is what keeps the level figure out.

| project | printed | fitted | fused | status |
| --- | --- | --- | --- | --- |
| A | 40° at conf 0.96 | 39.95°, 39.97° | **40.00° `SOURCE_EXACT`** | RESOLVED, agreeing to 0.05° |
| B | 35° | 34.99°, 34.99° | **35.00° `SOURCE_EXACT`** | RESOLVED, agreeing to 0.01° |
| G | 30° | (see §22) | **30.00° `SOURCE_EXACT`** | RESOLVED |

## 11. Roof topology (§15)

Classified from the section, the elevations and the plan footprint — never from
the project name, which no module can see (§34).

The section says how many planes there are and whether any is flat. The
elevations say whether the ridge runs the whole length: a gable and a hip differ
in exactly one visible way, which is that seen along the ridge a gable runs level
from end to end and a hip slopes away at both. A level top spanning ≥80% of its
facade is a gable, <70% a hip, and *in between the answer is `UNKNOWN`* rather
than a guess. Where the section shows a pitched roof and a flat one over
different parts of the plan, that is two components and the building is
`COMPOSITE`.

A: **COMPOSITE — GABLE + FLAT**, which is what it is (gable main body, flat
garage wing) and what a single label would lose. B: GABLE. G: GABLE.

## 12. Elevation registration (§17)

Two anchors, both heights the *section* prints: the fitted roofline top is the
ridge and the silhouette's foot is the terrain. Nothing about an elevation
establishes a height — the elevation supplies two rows and the section supplies
the two metres, which is §12's authority order expressed as a dependency and
asserted in the suite.

The horizontal scale is taken as the vertical one. That is an assumption about
an orthographic projection and is **written down as one**, and it is checked: the
facade's measured width is compared against the plans' footprint and the residual
is reported whether it agrees or not (§17's "if raster stretch differs in X/Y,
report it explicitly"). On A that check is what settles a real question — the
side elevations measure 14.6 m wide against a *printed* depth chain of 12.60 m,
and it is the attic plan's own footprint of 14.48 m that shows the elevations
right and the chain partial.

**The set checks each drawing.** A publisher renders a project's elevations at
one size, so four of them are four readings of one scale — the same argument
Stage 06 made across a sheet set. A's rear gable is white against a white cloud,
the background flood took the top of it for sky, and that drawing registers at
50.1 px/m where the others give 58.5. It is short in *both* dimensions by the
same fraction, so nothing internal to it can notice. The set's median is adopted,
which puts it at 58.52 against the 58.73 it was measured at by hand, and the
disagreement is carried as `ELEVATION_SCALE_DISAGREES_WITH_SET`.

| A | px/m | top from | shape | measured vs plans |
| --- | ---: | --- | --- | --- |
| FRONT | 58.51 | gable apex | APEX | 12.92 m vs 11.81 m |
| REAR | 58.52 (set) | gable apex | APEX | 6.72 m vs 11.81 m |
| LEFT | 58.53 | ridge plateau | LEVEL_TOP | 13.64 m vs 18.20 m |
| RIGHT | 58.65 | ridge plateau | LEVEL_TOP | 16.18 m vs 18.20 m |

## 13. Silhouette extraction (§18)

The top of a building is not its tallest pixel. On A's entrance elevation the
tallest pixel is a chimney and on the two side elevations it is a tree, so the
top is taken from the **fitted roofline** — the crossing of two fitted slopes for
a gable end, or the row of a long level top for a ridge seen along its length.
Asserted directly: adding a forty-pixel chimney to a synthetic facade moves the
raw silhouette top by forty pixels and the reported building top by none.

The facade's horizontal extent is the **modal** column over two dozen rows
through the storey band, not the median. The contamination is one-sided — a tree
against a wall widens the row it is on and nothing ever narrows one — so half the
rows can be wrong in the same direction and a median goes with them.

## 14. Facade opening detection (§19)

Two kinds of evidence, because one is not enough on a render.

**Dark regions.** Not darkness against the image — this house has an anthracite
garage wing darker than several of its windows — but against **the wall at the
pixel's own row**, estimated as a local median over a wide window. Three filters
then do the work, and the first decides whether the detector works at all:

- *wider than a texture stripe*. A's gable is clad in vertical boards and every
  shadow line between two boards is darker than the board beside it, so the raw
  dark regions of the entrance facade come back as **one component 388 px across
  containing the gable glazing, the entrance, two windows and all the cladding**.
  Removing anything narrower than an opening can be — a length in metres, not a
  fraction of an image — separates them;
- *interior to the facade*. A roof band is dark, rectangular, enormous and part
  of the silhouette's own outline; a window never is;
- *fills its own bounding box*. Foliage is dark and irregular.

**Framed rectangles.** The existing `scaffold/openings.ts` test — four sides
inked — finds the garage door that darkness misses. It needed one change to be
usable, and not a threshold: it must be given the **wall band** rather than the
whole facade, because on a render the strongest straight lines by a wide margin
are the roof's, so with the roof in frame the entire line budget goes to roof
edges and no window ever gets a candidate line.

Both run; results are merged and each opening records which pass found it.
Working in metres rather than fractions of the frame is what makes one set of
bounds mean the same thing on a 1280 px render and on whatever the next publisher
serves — the registration establishes the scale before this runs and it is an
input.

On A: 29 openings across four facades. This is the weakest part of the stage and
§29 of this report says so plainly.

## 15. Plan ↔ elevation opening matching (§7, §20)

**The assignment is solved, not labelled.** Each elevation is scored against each
of the building's four sides in each of two directions — thirty-two independent
correspondences — and the permutation explaining the most openings overall wins.
Choosing the best side per elevation independently can put two elevations on one
facade, and a building does not have two fronts.

Correspondence alone was not enough, and the failure was exactly the one §7 warns
about: seven of A's entrance-elevation openings could be made to line up with a
side wall, and the solver put it there. The fix is source evidence the roof
already supplies — **the section says which axis it cuts across, so it says which
way the ridge runs, so an elevation whose skyline comes to an apex can only be
one of the two facades at the ends of that ridge.** With that constraint A's four
solve onto four opposite faces with no view-identity conflict.

A match is a correspondence, never a nearest neighbour: one offset is solved for
the whole facade and an opening matches only if *that* offset puts it on a plan
gap. An elevation opening with no plan gap under the facade's own offset stays
unmatched, and a plan gap the elevation does not show raises
`PLAN_OPENING_VS_ELEVATION_OPENING`.

| A | solved side | direction | openings matched |
| --- | --- | ---: | ---: |
| FRONT | MAX_Z | +1 | 3 |
| REAR | MIN_Z | −1 | 3 |
| LEFT | MIN_X | +1 | 5 |
| RIGHT | MAX_X | — | 0 (placed by elimination, reported as unresolved) |

## 16. Raked openings (§21)

A detected opening carries its own outline as a coarse occupancy grid and, where
its top edge is not level, a `rakedHead` of two end levels and a slope. It is
never squared off into a rectangle. Six of A's 29 openings carry a sloped head.
The outer region and any internal mullions are not separated — the detector does
not resolve mullions, and that is recorded as a limitation rather than as a
polygon.

## 17. Rooflights (§22)

An opening whose sill is above the level at which the roof meets the wall is not
in a wall, because there is no wall there. Every one is `UNRESOLVED` unless a
second source shows it, which §22 requires explicitly and which on these packages
is usually the case.

A: **3 roof openings**, widths 0.82, 0.76 and 0.49 m. The hand transcription
counts three units printed `78/118` — so the count is right and two of the three
widths are within 4 cm of the printed 0.78 m, off renders with no dimension line
on them. All three are reported `UNRESOLVED` with a
`ROOFLIGHT_PLAN_VS_ELEVATION` conflict each, because no second source in this
pipeline confirms them.

## 18. Chimneys and cross-source conflicts (§23)

A stack is a narrow protrusion standing above the **fitted** roofline — a
skyline-based test cannot find one, because a chimney *is* part of the skyline.
The fitted lines are extrapolated rather than used only where supported, because
a stack interrupts the skyline and the columns it occupies are precisely the ones
with no fitted line over them.

**One stack seen from three sides is one stack.** Each elevation gives a
position along one plan axis and nothing about the other, so two stacks sharing a
column of x are one silhouette from the front and two from the side. Clusters are
counted within an axis and the axis that resolves the most says how many there
are — which is how a reader of these drawings arrives at the answer.

A: **1 chimney** (the hand transcription finds two), top at 7.90 m against a
hand-measured 7.88. The second is not found: the side elevation resolves only one
stack wide enough to count. The lower shaft is left `UNRESOLVED` rather than
joined to a flue the plans draw elsewhere, which is what §23 asks for.

## 19. Recess, balcony and facade-feature candidates (§24)

Depth is the whole point, and §4 forbids reading one off a perspective render.
So a depth the plan constrains is taken from the plan, and one it does not is
`null` with a `FACADE_DEPTH_UNRESOLVED` conflict.

**A recess is bounded.** Requiring a *return* at each end, reaching back from the
facade plane to the set-back wall, is what separates a recess from the building
simply being narrower there. Without it every parallel partition in A's plan is a
recess — 177 of them. With it, and with a storey-reach test that stops an attic
stopping short of a garage wing reading as a four-metre recess, A reports three
features: one recess at 1.15 m depth (hand-measured 1.00) and two railings.

Balcony slabs and portal frames are not recovered: a slab edge is a horizontal
band on an elevation and what lies behind it is a depth no elevation measures.

## 20. A — field-by-field gold table (§28)

The evaluator (`tests/shell-oracles.ts`) is the only thing in the repository that
opens a gold file. §28 forbids one score, so there is none. Three verdicts, and
the third is the one that earns its keep: **`ABSENT` is not a softer `MISS`.** A
pipeline that says nothing about the knee wall has behaved correctly if nothing
it can read constrains it; one that says 1.30 m because knee walls are usually
1.30 m has not.

### vertical

| field | gold | automatic | tolerance | |
| --- | ---: | ---: | ---: | --- |
| `level.terrain` | −0.320 | **−0.320** | 5 mm | MATCH |
| `level.groundZero` | 0.000 | **0.000** | 5 mm | MATCH |
| `level.nextFloor` | 3.060 | **3.060** | 5 mm | MATCH |
| `level.eave` | 4.670 | **4.670** | 5 mm | MATCH |
| `level.ridge` | 7.950 | **7.950** | 5 mm | MATCH |
| `level.kneeWallTop` | 4.360 | — | 50 mm | ABSENT |
| `building.totalHeight` | 8.270 | **8.270** | 20 mm | MATCH |

The knee wall is absent for a reason that is worth stating: the section prints it
as a **vertical dimension chain** (`130`), not as a level marker, and this stage
reads level markers. The chains are detected and associated with their dimension
lines but are not yet turned into levels. Nothing was guessed in their place.

### roof

| field | gold | automatic | tolerance | |
| --- | ---: | ---: | ---: | --- |
| `roof.topology` | GABLE | **GABLE** | — | MATCH |
| `roof.compositeWithFlat` | COMPOSITE | **COMPOSITE** | — | MATCH |
| `roof.pitchDeg` | 40.00 | **40.00** | — | MATCH |
| `roof.flatTop` | 2.880 | 2.891 | 50 mm | MATCH |
| `roof.coveringThickness` | 0.100 | 0.106 | 40 mm | MATCH |
| `roof.planeRidgeLevel` | 7.950 | **7.950** | 30 mm | MATCH |
| `roof.ridgeOrientation` | along Z | **along Z** | — | MATCH |
| `roof.mainSpan` | 7.900 | 7.664 | 400 mm | MATCH |
| `roof.overhang` | 0.000 | — | 100 mm | ABSENT |

### facade

| field | gold | automatic | |
| --- | --- | --- | --- |
| `facade.majorOpeningCount` | FRONT=4 EAST=2 REAR=3 WEST=2 NORTH_GARAGE=1 | RIGHT=6 LEFT=7 FRONT=10 REAR=6 | MISS |
| `facade.openingHostMatched` | every detected opening on its plan gap | 11 of 29 | MISS |
| `facade.rakedOpening` | the front gable glazing, 2.70 m with a raked head to 3.20 m | 6 openings carry a sloped head | MISS |

These are count comparisons and never scores: the gold models twelve *classified*
openings and the detector reports twenty-nine *regions* without classifying any
of them, so the two are not the same quantity and the evaluator says so in the
row.

### characteristic A features (§25)

| field | gold | automatic | tolerance | |
| --- | --- | --- | ---: | --- |
| `feature.recess_front.depth` | 1.000 | 1.154 | 150 mm | MISS |
| `feature.recess_rear.depth` | 1.000 | 1.154 | 150 mm | MISS |
| `feature.balconySlab` | top 2.96 m, x 3.34..7.90 | — | — | ABSENT |
| `feature.railing` | 2 glass railings | 2 | — | MISS |
| `feature.portalFrame` | 1 | 0 | — | ABSENT |
| `feature.depthsLeftUnresolved` | every unconstrained depth is `null` | 2 conflicts, 2 features with no depth | — | MATCH |

One recess is found at 1.15 m against a printed 1.00, on the wrong facade of the
two; the other is not found. The automatic code does not know any of these
features exist — the evaluator holds the list and the extraction cannot import
it.

### roof features

| field | gold | automatic | tolerance | |
| --- | --- | --- | ---: | --- |
| `rooflight.count` | THREE | **3** | — | MATCH |
| `chimney.count` | TWO | 1 | — | MISS |
| `chimney.topLevel` | 7.880 | 7.900 | 150 mm | MATCH |
| `chimney.crossSource` | matched, or the disagreement recorded | 1 unresolved, recorded | — | MATCH |

**18 match, 7 miss, 4 absent, 0 conflicted.**

## 21. A — pass-target table (§30)

| §30 target | required | measured | |
| --- | --- | --- | --- |
| every source-clear major level recovered or conflicted | terrain, zero, next floor, eave, ridge | 5 of 5 inside tolerance | **MET** |
| no level ordering contradiction | 0 | 0 | **MET** |
| correct major roof topology | GABLE main, COMPOSITE overall | GABLE+FLAT / COMPOSITE | **MET** |
| main pitch ≤1.0° of gold, tighter where printed | 40° ± 1.0 | 40.00 printed, fit 0.05° away | **MET** |
| ridge and eave within source-derived tolerance | both | both MATCH | **MET** |
| flat-roof component recognised | one | one | **MET** |
| ≥90% of major openings detected on EACH facade | ≥90% ×4 | openings on 4 facades; no per-facade recall claimable | not met |
| ≥90% of detected openings matched to host | ≥90% | 11 of 29 (38%) | not met |
| zero confident mirrored facade assignment | 0 | 0; 1 facade placed by elimination and reported unresolved | **MET** |
| every source-clear feature matched or explicitly unresolved | none dropped | 1 match, 2 absent, 3 reported but unequal | not met |
| no invented characteristic feature | all carry evidence | 3 features, all with evidence refs | **MET** |
| rooflight/chimney counts correct or conflicted | 3 and 2 | 3 and 1 | not met |

**8 of 12 met → `PARTIAL`.**

Everything the *section* is asked for is met. Everything that depends on reading
a photorealistic render is not. That division is the finding, not an accident of
thresholds.

## 22. B generalization (§32)

Run frozen, no B-specific tuning, nothing inspected before the run.

| | B |
| --- | --- |
| section datums | 4 of 4 accepted, 65.156 px/m, 1.39% pairwise spread |
| levels | TERRAIN −0.30, GROUND_ZERO 0.00, EAVE 3.20, RIDGE 6.28 |
| roof topology | GABLE |
| pitch | printed **35°**, fitted 34.99° and 34.99° → `SOURCE_EXACT` RESOLVED, agreeing to 0.01° |
| roof planes | 2, high 6.078, low 3.167/3.177, build-up 0.101 m |
| elevation registration | 41.98–43.40 px/m; widths 8.25–25.02 m for one building |
| openings per facade | RIGHT=11 FRONT=1, 5 matched |
| rooflights / stacks / features | 0 / 1 / 1 |
| conflicts | 16, of which 5 view-identity and 2 scale-vs-set |
| unresolved | 2 |

B is deliberately unlike A — single storey, 35° gable, no knee wall — and the
section half of this stage transfers to it without a line of change. The
elevation half does not: four silhouettes of one building giving widths between
8 and 25 m is a segmentation failure, and the pipeline's response is five
view-identity conflicts and two facades placed by elimination. No gold accuracy
is claimed for B; the existing B gold does not cover these fields.

## 23. G — the one-shot holdout (§33)

Frozen at `8710b565e1bbada0169fb6c4e5446ebc851c0016`, plan config
`f451ba9a7f6a…`, shell config `2649cfe46b59…`. Run **once**. The command refuses
a second run, refuses a moved commit and refuses a moved configuration.

Self-consistency only. There is no gold for G and no accuracy figure is
printable.

| | G |
| --- | --- |
| section selected | `asset_876d682d99bb` |
| elevations selected | LEFT, RIGHT, FRONT, REAR |
| vertical datum markers | 4 — **4 accepted, 0 reconciled, 0 rejected, 0 unread** |
| resolved vertical scale | **63.938 px/m**, RMS residual **3.4 mm**, pairwise spread **0.46%** |
| levels | TERRAIN −0.30, GROUND_ZERO 0.00, EAVE 3.00, RIDGE 6.70 |
| roof topology candidate | GABLE |
| pitch | printed **30°** `SOURCE_EXACT` RESOLVED (printed and fitted agree) |
| opening counts by facade | LEFT 6, RIGHT 7, FRONT 25, REAR 27; 9 matched to a plan gap |
| roof openings / stacks / features | 17 / 2 / 8 |
| cross-source conflicts | 36 — 17 rooflight, 6 facade depth, 4 scale-vs-set, 4 footprint, 2 view identity, 2 chimney shaft, 1 plan-vs-elevation opening |
| unresolved | 2 |
| verdict | **NON-CATASTROPHIC** |
| time | 45.6 s |

The section result on a project never looked at is the same quality as on A: four
of four markers agreeing to 3.4 mm, a complete level set in order, and a printed
pitch the fitted slopes confirm. The elevation result is the same weakness as on
A and B — 52 openings on the two gable elevations is over-detection, and all four
silhouettes disagree with the set's scale, which the run reports rather than
hides.

## 24. Mutations (§35)

`tests/shell-mutations.test.ts`, 18 assertions. Each changes exactly one thing
and asserts two facts: that the relevant part noticed, and that the parts which
had nothing to do with it did not move. The second half catches a detector that
reports everything.

| # | mutation | what notices | what does not move |
| --- | --- | --- | --- |
| 1 | alter one printed datum | that datum rejected | scale and zero identical to 6 dp |
| 2 | move one marker to the wrong line | that marker rejected, only that one | scale within 0.001 |
| 3 | stretch the section vertically | scale changes by exactly the stretch | every printed level unchanged |
| 4 | change the printed pitch, raster unchanged | `PRINTED_PITCH_VS_FITTED_PITCH`, printed value still carried | the fitted observations |
| 5 | remove one roof slope | no ridge reported | one pitched plane still fitted |
| 6 | swap two elevation labels | the labels land on different sides | the openings solve onto the same facades |
| 7 | mirror an elevation | solved direction flips sign | the three matches still made |
| 8 | remove a facade opening | that plan gap unmatched | the other two still matched |
| 9 | add a fake dark rectangle | one more opening reported | a 0.2 m stripe adds none |
| 10 | shift a plan opening past tolerance | that one unmatched | the facade's offset and other matches |
| 11 | move a roof opening across the ridge | the plane it is on changes | — |
| 12 | move a stack off its plan footprint | `UNRESOLVED`, no void attached | the stack itself still found |
| 13 | remove a recess's returns | the recess disappears entirely | — (and no depth is emitted) |
| 14 | change the gold | the evaluation | not one byte of the candidate |

Plus four "does not move" checks: a mutated datum does not change the roof fit, a
mutated elevation does not change the section-derived levels, an unreadable
figure is an observation with no value rather than a level of zero, and a section
with no ridge still classifies a flat roof.

Two of these found bugs rather than confirming behaviour: a storey's reach was
measured only over walls parallel to the facade, so a storey consisting of a
set-back wall and its two returns was judged not to reach the facade its returns
start at.

## 25. Leakage proof (§34)

`tests/extract-isolation.test.ts` sweeps `src/core/extract/**`, `src/node/ocr/**`,
`src/node/extract-runner.ts` and `src/node/shell-runner.ts` — every file the
automatic extraction is made of — and asserts, structurally:

- nothing imports anything under `research/` or `tests/`;
- no file names a gold path or a gold identifier;
- **no file mentions any development project by name, id or slug**, including
  Stage 07's own — the sweep now names `kostrzewach`, `m215297bb5224c` and the
  asset ids this stage reads;
- no Stage-07 entry point takes a gold or an evaluation option;
- the sweep covers a named list of all fifteen Stage-06A and Stage-07 modules, so
  a rename that moved one out of it fails here rather than quietly stopping.

**The guard caught a real leak during this stage.** Two of `shell-features.ts`'s
own doc comments named the development project and one named a gold fixture. They
are now written about buildings.

Changing a gold file changes what the evaluator reports and cannot change a
candidate byte: B and G run through the identical code path with identical
configuration, and there is no project-specific threshold anywhere — every bound
is either a length in metres (a fact about buildings), a fraction of a drawing's
own dimensions, or a statistical requirement on the drawing's own self-agreement.

## 26. Diagnostics (§36)

`npm run shell:diagnostic -- A` writes seventeen outputs to
`out/shell/A-marcowki/diag`, drawn from what the runner produced rather than
recomputed, over the drawings faded so an overlay can be checked against the ink
it came from:

`01` section with detected datum lines, shelves, apexes and chain spans ·
`02` every OCR reading at every conditioning and which was accepted ·
`03` section roof-edge fits, soffits and the ridge crossing ·
`04` the datum residual table · `05`–`08` one registration and silhouette sheet
per elevation with a metre ladder · `09` major opening polygons per facade,
coloured by which pass found them · `10` plan↔elevation matches and the solved
assignment · `11` roof topology, pitch observations and planes ·
`12` rooflight and chimney evidence · `13` recess, balcony and portal evidence ·
`14`–`16` automatic-versus-gold vertical, roof and facade ·
`17` the cross-source conflict sheet.

B gets one combined candidate sheet (`npm run shell:diagnostic -- B sheet`). G's
summary was produced as part of its single run and no second extraction was
performed on it.

## 27. Performance (§37)

Project A, one run, wall clock:

| stage | ms |
| --- | ---: |
| section annotation detection | 85 |
| section OCR (20 crops over the 4-padding ladder) | 773 |
| datum solve | 5 |
| roof edge fitting | 1289 |
| pitch callout reading | 341 |
| elevation registration — RIGHT / LEFT / FRONT / REAR | 1828 / 1285 / 2745 / 879 |
| opening detection — RIGHT / LEFT / FRONT / REAR | 1408 / 1127 / 1856 / 754 |
| plan↔elevation matching | 24 |
| features | 5 |
| **total Stage-07 addition** | **14 441** |

B 13.7 s, G 45.6 s. Every search is bounded: the skyline fit is exhaustive over a
strided subsample of a few hundred points with a hard line budget, the facade
assignment is 24 permutations over 32 precomputed correspondences, and the
correspondence solve is bounded by the square of the opening count. There is no
whole-image optimiser anywhere in the stage.

## 28. Full gates (§39)

| gate | result |
| --- | --- |
| section observation tests | `tests/section-datums.test.ts` — 15 pass |
| datum solver tests | included above (7 of the 15) |
| roof-edge and pitch tests | `tests/section-roof.test.ts` — 9 pass |
| elevation registration, matching, topology, tolerance, evidence | `tests/shell-units.test.ts` — 22 pass |
| conflict model and fault injection | `tests/shell-mutations.test.ts` — 18 pass |
| leakage tests | `tests/extract-isolation.test.ts` — 16 pass |
| all Stage 01–06A regressions | unchanged and passing |
| full suite | **672 tests, 672 pass, 32 files** |
| typecheck | clean |
| build | clean |
| standalone build | clean |
| browser verification | **11/11 checks passed** on a 393 px viewport |
| production benchmark | run, table in §29 |

The suite was run twice: once before this stage's holdout-role change, where the
one failure was `source-resolution.test.ts` asserting that F holds the HOLDOUT
role — the guard working, since retiring a spent holdout must move it — and once
after, all green.

## 29. Production isolation (§38)

Nothing in the URL→model production path was changed. No camera solver, no
repair loop, no production score, no Android code, no legacy module touched.
Stage 07 is reached only through `scripts/shell-spec.ts`,
`scripts/evaluate-shell.ts`, `scripts/shell-diagnostic.ts`,
`scripts/freeze-shell.ts` and `scripts/holdout-shell.ts`.

| project | before (06A report) | now |
| --- | ---: | ---: |
| A | 0.2176 | **0.2176** |
| B | 0.2118 | **0.2118** |
| C | 0.1957 | **0.1957** |
| D | 0.1576 | **0.1576** |
| E | 0.1992 | **0.1992** |
| F | — (was the holdout) | 0.1290 |

Unchanged to every reported digit; all hard constraints satisfied on all six. F
appears for the first time because it is a regression project now rather than the
holdout, exactly as E did in Stage 06A.

## 30. Limitations

1. **Opening recall on rendered elevations is the stage's weak half.** The
   publisher's elevations are photorealistic: glass reflects sky and trees and is
   often *lighter* than the wall, the garage door is a mid-grey panel on an
   anthracite wall, and foliage stands in front of the facade. 29 regions on A
   against 12 modelled openings, 38% of them matched to a plan gap. Two of §30's
   opening targets are not met and neither is close.
2. **The silhouette can lose a white gable against a white cloud.** A's rear
   elevation registers 15% short on its own; the set's median catches it and the
   conflict is recorded, but the underlying segmentation is not fixed.
3. **Vertical dimension chains are detected and not yet read as levels.** The
   knee wall is printed as `130` on a chain, so A's knee-wall top is `ABSENT`.
   This is the single largest recoverable gap in the vertical result.
4. **The plan footprint is itself uncertain.** A's ground sheet carries marks
   outside the building; the material-weighted extent removes the worst of them
   but still gives 18.20 m along Z where the attic plan gives 14.48. The
   footprint is a reported cross-check and is not used to set any scale.
5. **Opening classification is not attempted.** §19 permits geometry before
   semantics, and nothing here distinguishes a window from a door from a garage
   door, so `facade.majorOpeningCount` is a count comparison and not a recall.
6. **One of A's two chimneys is not found** — the side elevation resolves one
   stack wide enough to count.
7. **Balcony slabs and portal frames are not recovered**, and mullions inside a
   raked opening are not separated from its outer polygon.
8. **§31's opening-precision audit is deferred.** Extending A's evaluation-only
   opening annotations would have meant authoring a second manual inventory,
   which §31 forbids, and the detector's precision is better characterised by
   fixing the detector than by measuring it further. Recorded as deferred, as
   §31 permits.
9. **Only one section is analysed per package.** Others are kept as evidence and
   named in the notes; no two cuts are averaged (§6).

## 31. Exactly one recommended next bounded step

**Read the section's vertical dimension chains as levels.**

The chains are already detected — `section-annotations.ts` finds each one, the
vertical dimension line it lies against, and the two rows its extension lines
bound — and they are already read by the engine. What is missing is the last
step: turning `130` between two rows into a constraint on the levels, fused
against the datum markers through the solver that already exists.

It is bounded (one module, one fusion rule, no new source type and no new
recogniser), it is on the strong half of the stage rather than the weak one, and
it closes the one `ABSENT` in the vertical table — the knee wall, which is the
only source-clear major level this stage does not recover. It would also give the
datum solver a second, independent kind of vertical evidence: a chain measures a
*distance* where a marker states a *height*, so a section whose markers are too
few to solve could still be registered from its chains.

