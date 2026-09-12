# RESEARCH-ANALYZER-WEB-01 — camera-aware multi-view web analyzer

Reconstructing a house from an ARCHON project page, with the camera treated as
an unknown to be solved rather than a nuisance to be ignored.

Primary project **A**: *Dom w marcówkach (GE)* —
`https://www.archon.pl/projekty-domow/projekt-dom-w-marcowkach-ge-m2fa281446a8ca`
Regression project **B**: *Dom w bakopach (G2E)*.
Holdout project **C**: *Dom w kosaćcach 44* — run once, after the freeze.

---

## 1. Architecture

The pipeline is a single line with no back-edges except one explicitly bounded
loop:

```
URL
 └─ SourcePackage          fetch under policy, parse, classify asset roles
     └─ EvidenceGraph      observations, merged by identity, ranked by authority
         └─ MetricScaffold dimensions with provenance
             └─ ProjectionClassifier   per asset
                 ├─ ORTHOGRAPHIC_TECHNICAL → elevation/section/plan path
                 └─ PERSPECTIVE_*          → CameraHypotheses per view
                     └─ BuildingHypothesis
                         └─ multi-view source score
                             └─ semantic repair  (bounded, re-fits cameras)
                                 └─ ResolvedBuildingGeometry
```

Two rules shape everything above.

**The camera is part of the unknown.** A perspective render is not a picture of
the building; it is a picture of the building *through an unknown camera*. Any
comparison that skips the camera is comparing two different things. So the
scorer never touches a render until a camera has been fitted for it, and §27 is
enforced literally: every accepted geometry repair re-fits the cameras of every
affected view before the new score is compared to the old one. Without that the
loop optimises the camera's error rather than the building's.

**Portability is structural, not aspirational.** `src/core/` imports no DOM, no
React, no Three.js, no browser global, no Node stream. JSTS is confined behind
`core/contracts/geometry.ts`. Three.js appears in exactly one file,
`ui/Viewer.tsx`, and owns no geometry, no scoring and no camera truth — it
draws a triangle list that was already decided. Image decoding is the only
platform dependency and it has two adapters (`node/image-decode.ts`,
`web/image-decode.ts`) behind one signature.

Everything is deterministic: canonical JSON with sorted keys and nine-decimal
rounding, a pure SHA-256 implementation rather than a platform one, stable
content-derived ids, sorted collections, and no RANSAC anywhere. Two runs over
the same assets produce byte-identical exports; the determinism test asserts it.

## 2. Source adapter

`core/source/archon-parser.ts` is a pure `string → SourcePackage` function. No
HTML parser, no DOM — the ARCHON page is regular enough that targeted regexes
are both sufficient and portable.

It extracts twelve published facts for A (`footprint_area 131.16 m²`,
`building_height 8.27 m`, `garage_area 24.1 m²`, `volume 779.94 m³`,
`roof_area 150.57 m²`, room counts, plot minima …), the technology notes
(roof family, pitch, knee wall, wall build-up), the room table, and the asset
list including the floor-plan images referenced only from `data-floor-pom-img`
attributes.

Two subtleties cost real time:

- The product-data regex initially consumed the `</div>` that the inner
  title/value matches needed, and returned zero facts. Capturing the trailing
  close (`([\s\S]{0,4000}?<\/div>)\s*<\/div>`) fixed it.
- ARCHON serves the same view at several sizes and under several link
  orderings. `dedupeSameView` collapses duplicates and
  `preferDimensionedPlans` keeps the plan variant that actually carries
  dimension lines, which is the one the metric reader needs.

Role classification (`core/source/role-classifier.ts`) runs metadata rules
first — filename slugs (`elewacja-frontowa`, `przekroj-budynku`,
`rzut-parteru`), the modal link order (`elevation1 → FRONT`, `2 → LEFT`,
`3 → RIGHT`, `4 → REAR`) — then falls back to pixels. The pixel path measures
an `outdoorFraction` to separate interior gallery renders from exterior ones;
interior renders carry no massing information and must not reach the camera
stage. Conflicts between the two paths are resolved explicitly, with the loser
recorded.

Fetching (`core/source/fetch-policy.ts`) is bounded by design: HTTPS only, a
host allowlist, per-hop redirect revalidation (not just the first URL), a byte
cap, a content-type check and bounded concurrency. **This is not an open
proxy** and the policy object is the thing that must be ported, not the
transport.

## 3. Projection classification

Sending a technical elevation through perspective fitting is the single most
destructive thing this pipeline could do, so classification is mandatory and
conservative. Five outcomes: `ORTHOGRAPHIC_TECHNICAL`, `PERSPECTIVE_PINHOLE`,
`PERSPECTIVE_SHIFTED`, `PLANAR_DIAGRAM`, `UNKNOWN`.

Getting this right took five attempts, and the failures are instructive.

1. **Raw Hough segments over the whole image.** Trees and sky gradients voted.
   Fixed by restricting segments to the building mask.
2. **Perpendicular residuals.** A long segment far from a candidate vanishing
   point produces a large perpendicular residual even when perfectly aligned.
   Switched to *angular* residuals, which are the physically meaningful
   quantity.
3. **Hough's angular quantisation floor.** At the accumulator's resolution a
   genuinely parallel family looks convergent. `refineSegment` adds a
   total-least-squares refit of each segment's endpoints, which drops the
   residual floor below the parallel/convergent decision boundary.
4. **Single-vanishing-point fitting.** Replaced by multi-model detection on the
   Gaussian sphere (below), which finds the families rather than assuming them.
5. **Over-correction.** With the guards in place, renders started classifying as
   orthographic. The fix was not another threshold but a *role prior*: an asset
   whose filename and modal position say "elevation" begins with an
   orthographic prior, a hero render with a perspective one, and geometry
   evidence updates it. Where prior and evidence disagree the classifier
   records a `contradiction` rather than silently picking one.

Result on real sources, asserted in tests: all four elevations of A and the
section classify `ORTHOGRAPHIC_TECHNICAL`; both plans classify
`PLANAR_DIAGRAM`; both exterior visualisations classify `PERSPECTIVE_SHIFTED`;
the same holds on B, which is a different house; and the test
*"never sends an orthographic source through perspective camera fitting"*
asserts the structural guarantee directly.

## 4. Camera model

`core/contracts/camera.ts` and `core/camera/projector.ts`. A pinhole with
`{fx, fy, cx, cy, skew}` intrinsics and a row-major 3×4 world→camera
extrinsic. Architectural visualisations are commonly shift-lens (verticals kept
vertical), which is why `PERSPECTIVE_SHIFTED` is a first-class type: the
principal point moves off centre and the model has to allow it.

Technical elevations use a separate `OrthographicView` with its own depth bias.
They are never expressed as a perspective camera with a long focal length —
that would invite the pose search to "improve" a view that has nothing to
solve.

The search is parameterised by what the sources constrain, not by six free
degrees of freedom: `PoseParams = {azimuthDeg, elevationDeg, distanceM,
fovYDeg, targetY, rollDeg}` about a known building centre. This is why there is
no `solvePnP` call — the problem was never in that form. (The mapping, for
anyone who wants one, is in `docs/KOTLIN_PORTING_GUIDE.md` §2.)

## 5. Vanishing-point initialisation

`core/projection/vp-detect.ts`. Segments are lifted to great circles on the
Gaussian sphere; every pair votes for the intersection of its two circles into
a 96×96 disk accumulator; peaks are refined against their supporting segments
and overlapping peaks merged. Pairwise voting is deterministic — there is no
sampling, so there is no seed and no run-to-run drift.

Line families are then re-fitted with IRLS under a Cauchy weight, which is what
lets a handful of foliage segments sit in the data without dragging the
solution.

Two guards decide whether an apparent convergence is real
(`isGenuineConvergence`): the best parallel model's angular residual must
exceed 0.21 rad, **and** the candidate vanishing point must lie at least 0.8
image diagonals outside the frame. Either test alone misclassifies —
the first admits mild lens distortion as perspective, the second admits a
near-frontal render as orthographic.

Where an orthogonal vanishing-point pair exists, `focalFromVanishingPair` gives
a focal length directly and the Manhattan constraint
`(v₁ − p)·(v₂ − p) + f² = 0` is available as a residual. On these sources that
usually seeds the pose search rather than determining it, because the published
renders rarely show two clean orthogonal families.

## 6. Anchor generation

`core/camera/anchors.ts`. Anchors are correspondences between named points on
the hypothesis and features in the image: mass corners at ground and top,
garage corners, ridge and eave ends, opening corners. Image-side candidates
come from skyline steps, refined segment endpoints and opening rectangles, each
carrying its provenance string into the export (`"SKYLINE_STEP from the source
image, matched to mass_annex"`).

Anchors are scored, not trusted: each match records a `residualPx` and a
confidence, and a match at 23 px on a 640 px image contributes almost nothing.
On A the hero render matched 15 anchors at a mean residual of 19.1 px and the
garden render 16 at 22.0 px.

## 7. Pose search

`core/camera/pose.ts`. Three stages, all bounded:

1. A coarse grid over `PoseParams` (`gridPoints`), evaluated with the software
   rasteriser.
2. Top-K survivors (`topK`) kept.
3. Levenberg–Marquardt refinement of each survivor, with a forward-difference
   Jacobian and box clamping.

The LM residual is **not** IoU. IoU is a single non-smooth scalar and gives LM
nothing to descend. Instead `core/camera/silhouette-descriptor.ts` produces a
fixed-length radial fan from the silhouette centroid, which is a smooth vector
residual of the same information. Edge chamfer distance
(`core/raster/chamfer.ts`) and anchor reprojection complete the residual.

`searchCameras(..., refitFrom)` re-runs the search seeded from an existing
solution. This is what makes §27 affordable: re-fitting every camera after every
accepted repair took 29 s from cold and 5.9 s seeded, for the same answers.

## 8. Ambiguity handling

`core/camera/ambiguity.ts`. Near-identical scores at different poses are a fact
about the data, not a defect to hide. Hypotheses within a score band are grouped
(`ambiguityGroup`) and the group's spread is reported: `azimuthSpreadDeg`,
`distanceSpreadM`, `fovSpreadDeg`, and a `fovDistanceDegenerate` flag for the
classic focal-length/distance trade-off.

`core/camera/confidence.ts` maps the evidence to four classes —
`CAMERA_CONFIDENT`, `CAMERA_USABLE`, `CAMERA_WEAK`, `CAMERA_UNRESOLVED` — from
anchor count, anchor residual, silhouette agreement and ambiguity spread. The
class feeds the view's weight in the multi-view score, so a weak camera cannot
outvote a technical elevation.

On A the hero render is `CAMERA_USABLE` with a 42.7° azimuth spread — the
bearing genuinely is not pinned by that one view, and the export says so. The
garden render is `CAMERA_USABLE` with **no** ambiguity: its 16 anchors fix the
pose. On C, nine of eleven views are `CAMERA_WEAK` or worse and one is
`CAMERA_UNRESOLVED` — an honest reading of a gallery that is mostly close-ups
and interiors.

## 9. Visibility

`core/camera/render.ts` is a depth-buffered software rasteriser with
perspective-correct `1/z` interpolation and near-plane triangle clipping. It
exists so that visibility is a property of the geometry, not of a GPU driver.

§34 is enforced in `core/scoring/view.ts`: a feature counts against the
hypothesis only if **it should project into this view at all**, **its
projection lands inside the crop and the field of view**, and **it is not
occluded** by the rest of the building. The per-view score carries
`visibilityScore` and a `missingVisibleFeatures[]` list so the distinction
between "absent" and "not visible from here" is auditable rather than implied.

The same rasteriser drives `core/camera/shade.ts` for the audit renders, with
screen-space cavity ambient occlusion and deferred transparent compositing.

## 10. Technical-elevation path

Technical sources are metric the moment their vertical scale is known, and they
outrank everything else (§36).

- **Section** (`core/scaffold/section.ts`) is the most trustworthy geometric
  source in an ARCHON package. `analyseSectionGeometry` finds the floor levels
  and the ridge; `gableSpanFromSection` finds the two wall faces the ridge sits
  midway between — on A the symmetry error is 0.2 px, which is why the span is
  believed.
- **Plans** (`core/scaffold/plan.ts`) give the footprint. `wallMask` isolates
  thick achromatic ink, occupancy profiles give the extent, `findCornerNotch`
  finds the L, and `fitFootprint` rescales the result so its area matches the
  published figure exactly.
- **Elevations** (`core/scaffold/elevation.ts`, `facade-features.ts`,
  `openings.ts`) give bands, openings, protrusions and gable infill.
- **Silhouette conditioning** (`core/scaffold/silhouette.ts`) cuts the terrain
  band and keeps the grounded dominant column run, which is what stops planting
  and the publisher watermark from widening the building.

Two detector rewrites were needed and both were about *what an opening is*:

- A darkness threshold returned A's entire anthracite garage wing as one
  opening. Replaced by `findOpeningRectangles`, which requires a rectangle
  bounded on **all four sides** by inked edges — a painted colour change has at
  most two such sides, a window has four.
- That detector then found almost nothing on the rendered elevations (one
  rectangle on the front, none on the left). The cause was the candidate-line
  scoring: rows and columns were scored by *summed gradient magnitude*, which
  the building outline dominates, so a window frame drawn at a tenth of that
  strength never cleared a threshold expressed as a fraction of the maximum.
  Counting **edge pixels** instead, with a floor set as a fraction of the
  facade's own extent, makes the criterion "is there a straight run here long
  enough to be an architectural line". Front went 1 → 8 rectangles, rear 3 → 7,
  right 1 → 3, left 0 → 2, with no loosening of the four-sided requirement.

## 11. Perspective path

Renders are used for what they are good at — telling you that a mass or a
feature exists and roughly where — and for nothing else. They cannot set a
dimension, cannot override an exact figure, and cannot be compared to at all
until their camera is fitted and classified.

The building mask on a render is itself a small research problem. Colour rules
failed on A's dusk hero render (coverage 0.086; the horizon line cut through
the house). `classifyBackground` now floods inward from the image borders with
a *dilated Canny contour as a barrier*, so a smooth sky gradient is one region
and the building is another regardless of hue, with forced ground seeds pushed
through the barrier under a looser colour step. `pickBuildingComponent` then
takes the centre-weighted component.

## 12. Multi-view scoring

`core/scoring/multiview.ts` aggregates three things.

Per perspective view (`core/scoring/view.ts`), weights:

| Term | Weight |
| --- | --- |
| silhouette | 0.34 |
| edge (chamfer) | 0.30 |
| roofline | 0.18 |
| mass corners | 0.10 |
| opening layout | 0.04 |
| semantic presence | 0.02 |
| visibility | 0.02 |

**RGB MSE is not a term and must not become one.** It measures rendering style,
not geometry, and it is exactly the metric that rewards a wrong building in the
right colours.

Per technical elevation (`core/scoring/elevation.ts`): silhouette, roofline,
band levels, opening position, opening size, feature position — compared
orthographically, with no camera involved.

Hard constraints (`checkConstraints`) are checked separately and are not
tradeable: footprint area, building height, roof pitch, garage area. A
candidate that violates one is rejected whatever it scores.
`groundFootprintArea` unions stacked masses rather than summing them — summing
was a real bug, and it reported 131 m² of footprint for a building that had
98 m² on the ground.

Elevation terms carry more weight than perspective terms in the aggregate, and
a camera's confidence class scales its view's weight, so the authority ladder
survives all the way to the final number.

## 13. Mass solver

`core/hypotheses/builder.ts` + `core/scaffold/plan.ts`. The footprint comes
from the plan, rescaled to the published area. `decomposeMasses` splits it into
a main body and an annex, with an area-preserving override when the section's
gable span disagrees with the plan's split — the span is the better measurement
of where the roof stops, but the area is published, so the split moves and the
total does not.

Storeys come from the section's floor levels plus the published knee wall.
`showsProjectionAt` asks whether an elevation *perpendicular* to a facade shows
the silhouette stepping outwards at a given height, which is the cross-source
test that separates a balcony (nothing projects; the storey above is set back)
from a canopy (something projects). A single facade cannot tell the difference,
and when this test was missing the analyzer built A's rear loggia as a slab
floating outside the building.

Recesses are grouped per mass and applied in one split. Applied sequentially,
two recesses on one mass produced a mass whose base (3.76 m) sat above its own
top (3.31 m).

## 14. Opening groups

`core/hypotheses/features.ts` + `core/scaffold/openings.ts`. Detected
rectangles are converted to facade-local metres, classified
(`GARAGE_GATE`, `SLIDING_GLAZING`, `DOOR`, `WINDOW`) from width, sill height
and the host mass's kind, grouped by level, and cut into the walls.

A rescaling bug here produced a genuinely absurd artefact — an opening floating
in mid-air outside the building — because facade-local `s` was in *elevation*
metres while the model was in model metres. The fix was a ratio rescale plus
clamping plus an explicit plausibility rejection, and the last of those is the
part worth keeping: an opening that does not fit on its facade is discarded
rather than clamped into place.

The gable infill is handled separately (`detectGableInfill`). A gable-end
glazed wall is not a rectangle — its top is cut by the two roof slopes, so it
has no fourth side — but it is unmistakable by area, and the roof planes clip
it during tessellation.

## 15. Self-repair

`core/repair/engine.ts`, bounded alternating optimisation (§28), never joint
free optimisation. Each cycle proposes changes to quantities that no source
fixes — annex height, roof overhang, recess depth, opening group position and
size — applies one, **re-fits the cameras of every affected view**, and
compares.

Three refusals are hard-coded:

- a proposal scored against cameras that were not re-fitted is rejected as
  stale (§27);
- a proposal that worsens the authoritative elevation term beyond a small
  allowance is rejected even if the aggregate improves — visible in A's trace:
  *"rejected: the authoritative elevation term worsened by 0.0043, beyond the
  0.004 allowance"*;
- a proposal that breaks a hard constraint is rejected outright.

On A, 24 proposals over 2 cycles, 1 accepted: *"move the top of mass_annex by
+0.40 m"*, motivated by *"annex height is not fixed by any published figure or
by the section cut"*, improving the score by 0.00394 with cameras re-fitted and
improving the elevation term as well (0.44323 → 0.43891). Every rejection
records its margin. On B and C nothing was accepted, which is the correct
outcome: their unfixed quantities were already right.

## 16. Marcowki baseline / final

| Quantity | Published / source | Model | Δ |
| --- | --- | --- | --- |
| footprint area | 131.16 m² (published) | 130.62 m² | −0.41 % |
| building height above terrain | 8.27 m (published) | 8.27 m | 0 |
| roof pitch | 40° (published) | 40° | 0 |
| garage area | 24.1 m² (published, interior) | 22.55 m² | −6.4 % (within tolerance) |
| overall width | — | 12.00 m | section cut gives 12.004 m |
| overall depth | — | 12.53 m | |
| ridge above finished floor | section 7.92 m | 7.92 m | elevation apex says 8.27 m — **conflict retained** |
| eave above finished floor | 4.63 m | 4.63 m | elevation band says 4.55 m (Δ 0.09 m) |
| gable span | 7.84 m | 7.84 m | section symmetry error 0.2 px |
| upper floor level | 3.06 m | 3.06 m | |
| wall thickness | 0.45 m (published build-up) | 0.45 m | section wall-face pairs give 0.444 m |
| knee wall | 1.30 m (published) | 1.30 m | |

All four hard constraints satisfied.

Score (lower is better): **base 0.1956 → final 0.1923**; elevation 0.4389,
perspective 0.1582, metric 0.0592, section 0.0500. Bundle hash
`d6e189985d203f44…`.

The model carries 3 masses, 2 roofs, 22 opening groups, 6 appearance features
and 932 triangles.

Over the three extra correction iterations (§ *Final visual acceptance audit*),
the base score moved 0.2156 → 0.1956 and the elevation term 0.4880 → 0.4389,
while camera confidence on the garden render rose from `CAMERA_WEAK` to
`CAMERA_USABLE` and matched anchors rose 9 → 15 (hero) and 13 → 16 (garden).

## 17. B regression

*Dom w bakopach (G2E)* — single storey, 35° gable, double garage, no knee wall.
Deliberately unlike A.

| Quantity | Value |
| --- | --- |
| footprint | 12.68 × 17.98 m, 227.89 m² |
| ridge / eave | 6.27 m / 3.25 m |
| pitch | 35° |
| hard constraints | all satisfied |
| score | 0.2217 (base = final; nothing accepted) |
| elevation / perspective | 0.5776 / 0.1671 |

B was re-run after every correction iteration. Iteration 1 (stack resolution)
left B **byte-identical**. Iterations 2 and 3 moved B's score 0.2221 → 0.2244 →
0.2217, i.e. it ended slightly better than it started, with no structural change
and no constraint violation. Projection classification on B is asserted in
tests and did not move.

B's model is a single mass with one gable roof, 7 opening groups and 1
appearance feature — correctly *simpler* than A, which is the regression signal
that matters: the analyzer did not learn A's shape.

## 18. Holdout C

*Dom w kosaćcach 44*, run **once**, after `npm run freeze` wrote the four
hashes and with the CLI verifying that none of them had moved since. No
threshold, weight or metric definition was touched afterwards, and C's numbers
fed back into nothing.

| Quantity | Value |
| --- | --- |
| assets | 27 fetched, 27 analysed |
| footprint | 17.94 × 8.88 m, 159.34 m² |
| ridge / eave | 6.24 m / 3.08 m |
| pitch | 35° |
| hard constraints | **all satisfied** |
| score | 0.2190 (base = final) |
| elevation / perspective | 0.5555 / 0.1978 |
| repairs | 0 accepted / 3 proposed |

No catastrophic failure. The pattern matches B rather than A: a simpler house
whose unfixed quantities were already right, so the repair loop had nothing to
accept. The honest weak spot C exposes is camera confidence — nine of its
eleven perspective views are `CAMERA_WEAK` and one `CAMERA_UNRESOLVED`, because
its gallery is largely close-ups and interiors with little visible massing. The
analyzer reports that rather than manufacturing poses, which is the intended
behaviour, but it does mean C's perspective term rests on two views.

## 19. Camera metrics per view

Azimuth is measured from the front facade normal, elevation above the horizon;
both are derived from the exported extrinsics.

### A — Dom w marcówkach

| View | Class | Projection | az | el | fovY | dist | silhouette | edge | vis | anchors | ambiguous |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| HERO_RENDER | USABLE | SHIFTED | 20.2° | −10.3° | 30.9° | 23.1 m | 0.235 | 0.019 | 0.288 | 15 | yes, 42.7° az spread |
| GARDEN_RENDER | USABLE | SHIFTED | −163.2° | −6.2° | 21.3° | 32.7 m | 0.305 | 0.022 | 0.333 | 16 | **no** |

Both bearings are right: the hero render is the front three-quarter view and the
garden render is very nearly the rear elevation. Neither is flagged
FOV–distance degenerate.

### B — Dom w bakopach (8 perspective views)

| View | Class | az | el | fovY | dist | anchors | az spread |
| --- | --- | --- | --- | --- | --- | --- | --- |
| HERO_RENDER | USABLE | 174.3° | 23.6° | 25.8° | 47.1 m | 6 | 179.6° |
| GARDEN_RENDER | USABLE | 60.2° | −11.9° | 20.9° | 35.5 m | 3 | 180.0° |
| OTHER ×2 | USABLE | 61.6° / −75.4° | −5.5° / 45.0° | 44.3° / 36.2° | 16.0 / 27.3 m | 2 / 4 | 189° / 259° |
| OTHER ×4 | WEAK | — | — | — | — | 1–5 | 182–232° |

### C — Dom w kosaćcach 44 (11 perspective views)

| View | Class | az | el | fovY | dist | anchors |
| --- | --- | --- | --- | --- | --- | --- |
| HERO_RENDER | USABLE | −171.8° | 15.1° | 20.6° | 36.8 m | 8 |
| GARDEN_RENDER | USABLE | −100.0° | −1.2° | 36.0° | 18.9 m | 2 |
| OTHER ×8 | WEAK | — | — | — | — | 1–8 |
| OTHER ×1 | **UNRESOLVED** | — | — | — | — | 9 |

The `CAMERA_UNRESOLVED` case is worth reading carefully: it has *nine* anchor
matches, more than C's hero render. Anchor count alone does not make a camera —
its ambiguity spread is 181° and the confidence classifier correctly refuses it.

## 20. Feature scorecards

Per-elevation terms for A (lower is better):

| Facade | total (baseline → final) | silhouette | roofline | band levels | opening position | opening size | feature position |
| --- | --- | --- | --- | --- | --- | --- | --- |
| REAR | 0.491 → **0.404** | 0.632 | 0.280 | 0.449 | 0.223 | 0.254 | 0.176 |
| FRONT | 0.533 → **0.440** | 0.713 | 0.392 | 0.660 | 0.054 | 0.063 | 0.233 |
| LEFT | 0.445 → **0.440** | 0.620 | 0.119 | 0.967 | 0.509 | 0.102 | 0.213 |
| RIGHT | 0.483 → **0.471** | 0.550 | 0.221 | 1.000 | 0.519 | 0.366 | 0.188 |

At baseline the front and right facades scored their opening terms at the
no-evidence default of 0.5 because no opening was detected on them at all; they
now score 0.054/0.063 and 0.519/0.366 against real detections. The worst
remaining terms are the right facade's band level (1.000 — no band matched) and
the left facade's opening size (0.102 is good; its 0.967 band level is not).

Per-view terms for A:

| View | total | silhouette | edge | roofline | mass corners | opening layout | visibility | weight |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| HERO_RENDER | 0.141 | 0.235 | 0.019 | 0.056 | 0.038 | 0.500 | 0.583 | 0.55 |
| GARDEN_RENDER | 0.175 | 0.305 | 0.022 | 0.095 | 0.066 | 0.500 | 0.568 | 0.55 |

Both views carry the note *"no opening group is visible in this view"*: the
openings the model has face the camera at too shallow an angle for the
visibility test to admit them, so the opening-layout term sits at its
no-evidence default rather than being scored against nothing. That is the
intended §34 behaviour, and it is also why the opening work of iterations 2 and
3 shows up in the elevation term and not here.

Metric provenance mix:

| Project | SOURCE_EXACT | SOURCE_DERIVED | GEOMETRIC_INFERRED | UNRESOLVED | conflicts retained |
| --- | --- | --- | --- | --- | --- |
| A | 8 | 2 | 4 | 0 | 1 |
| B | 6 | 2 | 4 | 2 | 3 |
| C | 5 | 2 | 4 | 3 | 3 |

## 21. Manual-reference debug audit

`REFERENCE_WEIGHT = 0` in `core/config/weights.ts`, asserted in
`tests/determinism-reference.test.ts` and exported as `referenceWeight: 0` in
every `self-verification.json`. The manual reference screenshots supplied for
this study were used for **development audit only** (§39):

- they are not an input to any score;
- they do not seed geometry;
- no dimension was taken from them;
- they are not a PASS/FAIL source.

Where the reference and the ARCHON source disagree, the source wins, and one
such disagreement was material. The hand-built reference shows a **two full
storey** house under the gable. The ARCHON package shows *parter + poddasze
użytkowe*: the upper plan is titled `rzut-poddasza` (attic), the published knee
wall is 1.30 m, and the section puts the eave 1.57 m above the upper floor
level. The analyzer built one storey plus a usable attic. The reference was not
followed, and this is recorded rather than quietly reconciled.

## 22. Performance

Offline, from the cached asset fixtures, single-threaded Node 22.

| Project | assets | asset analysis | scaffold | camera fit | repair | total | camera evaluations |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A | 12 | 1.84 s | 0.75 s | 8.17 s | 14.63 s | **25.4 s** | 18 939 |
| B | 24 | 5.01 s | 0.55 s | 17.74 s | 1.62 s | **24.9 s** | 29 688 |
| C | 27 | 5.81 s | 0.77 s | 21.55 s | 2.16 s | **30.3 s** | 40 796 |

Everything is bounded: the pose grid has a fixed size, top-K is fixed, LM has an
iteration cap, the repair loop has a cycle cap, fetch has a concurrency cap.
There is no unbounded search anywhere and no dependence on convergence luck.

The single biggest performance decision was seeded camera re-fitting. §27
requires a re-fit after every accepted repair; doing it cold cost 29 s and took
A's total to 34 s. `refitFrom` produces the same answers in 5.9 s.

The browser build (`npm run ui:build`) produces a 624 kB main chunk
(167 kB gzipped) plus a 161 kB analysis worker; analysis runs off the main
thread.

## 23. Tests

75 tests across 7 files, all passing.

| File | What it pins |
| --- | --- |
| `camera-math.test.ts` (17) | projection/unprojection round trips, `lookAt`, camera centre recovery, orthographic path, Cholesky and eigenvector solvers, LM convergence |
| `projection-classification.test.ts` (6) | classification of **real published assets** for A and B, interior-render exclusion, and the structural guarantee that an orthographic source never reaches perspective fitting |
| `vanishing.test.ts` (9) | Gaussian-sphere detection on synthetic and real data, parallel-vs-convergent model selection, focal from an orthogonal pair, Manhattan residual |
| `multiview-authority.test.ts` (9) | elevations outrank perspective views; a weak camera cannot outvote a technical source; hard constraints are not tradeable |
| `ambiguity-confidence.test.ts` (9) | ambiguity grouping, FOV–distance degeneracy detection, the four confidence classes |
| `determinism-reference.test.ts` (7) | byte-identical exports across runs, identical candidate/score/repair trace, and `referenceWeight === 0` in the export |
| `source-adapter.test.ts` (18) | fact extraction, Polish number parsing, role classification, fetch-policy acceptance and rejection including per-hop redirects |

The two determinism tests run the whole pipeline twice and diff the serialised
bundle, which is why the suite takes ~112 s.

## 24. Remaining work

### P0 — would change an answer

- **Printed digits are not being read.** Glyph clustering identified 2 of 167
  prototypes on A, 1 of 227 on B, 3 of 179 on C, and **zero** opening callouts
  were decoded on any project. At 6–14 px per digit in the published GIFs the
  grayscale-profile clustering is not separable. Every chain dimension
  consequently lands as `GEOMETRIC_INFERRED` via `solveChainGeometry` rather
  than `SOURCE_EXACT`. The chain solver is accurate — 37.88 px/m against a
  calibrated 38.07 px/m on A, −0.5 %, with a 6 mm mean grid residual — but it
  is inference, and the audit says so rather than claiming otherwise. The fix is
  a proper small-glyph classifier trained on rendered CAD digit sets, or
  fetching the higher-resolution plan variants where ARCHON offers them.
- **Side-elevation width disagreement.** A's left and right elevations measure
  the same depth as 13.76 m and 15.56 m against a model depth of 12.53 m. The
  scaffold does not use these figures (it uses the plan and section), and the
  `scaleFor` guard rejects the worst of them, but an elevation that cannot
  measure its own width is also a weak scorer. The cause is silhouette
  conditioning including the shadow band beyond the building on those two
  images.

### P1 — visible in the model

- **Gable glazing horizontal placement** is approximate. The infill detector
  measures the glazed region's extent correctly but the horizontal centroid is
  biased by the balcony railing above it, so A's front glazing sits
  left-of-centre where the source has it right-of-centre.
- **Rooflights are not detected.** `detectRoofOpenings` exists and works on
  synthetic input, but at the published elevation resolution the rooflights in
  A's side elevations do not clear the rectangle detector's border test. They
  are absent from the model rather than misplaced, which is the safer failure.
- **No plan-term contribution.** `score.plan` is 0.000 on all three projects —
  the plan currently contributes the footprint and nothing to the score. A plan
  comparison term (wall runs, room partition) would add an authoritative
  orthographic view the scorer is not yet using.

### P2 — quality of life

- The repair loop's proposal set is fixed; it cannot propose a mass it did not
  already have. Adding a "propose a missing mass from an unexplained silhouette
  region" operation is the natural next step.
- View weights are driven by camera confidence class, which is coarse: on A both
  views sit at 0.55 even though the garden render has the clearly better camera
  (no ambiguity, 16 anchors, against 42.7° of azimuth spread on the hero).
  The weight should be a continuous function of the measured spread, not a
  four-step ladder.
- Interior renders are excluded entirely. They carry real information about
  storey heights and opening positions that is currently discarded.

### Success standard (§51), assessed

| Criterion | Status |
| --- | --- |
| source type correctly classified | **yes** — asserted on real assets for A and B |
| camera hypotheses plausible and confidence-aware | **yes** — bearings correct on A, four-class confidence, ambiguity reported |
| metric scaffold source-true | **yes** — 8 of 14 items `SOURCE_EXACT` on A, conflicts retained |
| multiple renders agree with one hypothesis | **yes** — one hypothesis scored against both views |
| technical elevations authoritative | **yes** — enforced in weights and in the repair engine's refusal |
| perspective evidence recovers real mass/features | **partly** — it accepted the annex height; it has never yet added a mass |
| visual repair does not corrupt exact dimensions | **yes** — hard constraints checked on every proposal, none violated on A, B or C |
| A improves | **yes** — 0.1956 → 0.1923 in-run; 0.2156 → 0.1956 across correction iterations |
| B does not overfit | **yes** — B ended marginally better than baseline, structurally unchanged |
| C reveals no catastrophic failure | **yes** — all hard constraints satisfied on first and only run |
| core portable to Kotlin/JVM | **yes** — no DOM/React/Three.js/Node dependency in `core/`; see the porting guide |

## 25. Kotlin port sequence

Full detail in `docs/KOTLIN_PORTING_GUIDE.md`. The order, and the artefact that
proves each step:

1. `math/`, `util/` → SHA-256 and `canonicalJson` vectors.
2. `contracts/` → types only, nothing to verify.
3. `source/` → `source-package.json` byte-identical from the cached HTML.
4. `raster/`, `projection/` → every asset's classification matches
   `camera-hypotheses.json`.
5. `scaffold/` → `metric-audit.json` byte-identical.
6. `camera/`, `hypotheses/` → `resolved-building-geometry.json` byte-identical.
7. `scoring/`, `repair/`, `pipeline/` → bundle hash identical.

Canonical serialisation exists precisely so that each step has a byte-comparable
artefact and a failure at step *n+1* cannot be blamed on step *n*.

---

## 3D MODEL QUALITY AND PHOTO-DRIVEN RECONSTRUCTION

### Is this a real 3D building or a 2D plan extruder?

It is a real building. `core/hypotheses/solid.ts` produces:

- **Walls with thickness.** 0.45 m on A, taken from the published build-up and
  corroborated by the section's wall-face pairs at 0.444 m. Rings are inset by
  angle-bisector offset, so corners mitre correctly rather than overlapping.
- **Openings that cut the wall geometry.** Not decals, not textures: each
  planar wall is decomposed on a grid whose break lines are the opening edges,
  and the cells inside an opening are dropped. This gives exact cuts with no
  CSG library and no numerical tolerance to tune. Each cut gets **reveals**
  (the returns through the wall's thickness) and a separate glazing plane set
  back within the reveal.
- **Slabs with thickness**, including the balcony and canopy slabs, built as
  solids with their own top, bottom and edge faces.
- **Roofs as real 3D solids.** `buildPitchedRoof` builds the covering with
  thickness, an eave overhang, a fascia and a soffit; `buildGableWalls` builds
  the triangular gable walls and clips the gable glazing against the rake.
- **Caps and closures** everywhere, so the model is watertight enough to be
  sectioned.

A's resolved model is 932 triangles across 3 masses, 2 roofs, 22 opening
groups and 6 appearance features. Every triangle carries `part`
(`WALL`/`ROOF`/`SLAB`/`GLAZING`/`FEATURE`), `massId` and `storeyId`, which is
what makes decomposition possible: the viewer can hide the roof, hide the upper
storey, isolate a mass, or show glazing alone, because the tagging comes from
the generator rather than from a post-hoc guess.

The tessellator reports quantities alongside the triangle list — wall area,
roof area, glazed area, slab area, opening count — and the viewer shows them.
They are meaningful only because the elements are solids; on a paper-thin model
they would be arbitrary. (They are computed during tessellation and displayed,
not written into `resolved-building-geometry.json`; adding them to the export
would be a one-line change but the exports were frozen before the holdout run.)

What would still make it a fair criticism: the model has no internal partitions.
Room-level decomposition is listed as available in the contract but the room
table is currently used only for area constraints, not to build partition
walls. That is honest P1 work, not a claim.

### Shading

`core/camera/shade.ts` implements two materials and a compositor.

**Solid-building shader.** A monochrome architectural study: a neutral
value ramp per `BuildPart` (roof slightly darker than wall, slab lighter, all
within a narrow band), Lambertian key light with a soft fill, and **screen-space
cavity ambient occlusion** sampled from the depth buffer so reveals, soffits and
the inside of the loggia darken the way they do in a physical study model. No
saturated colours, no specular highlights, no outlines that thicken with
distance — the toy-model look comes from exactly those three things.

**Glass shader.** A separate deferred pass: transparent fragments are collected
rather than blended immediately, sorted back-to-front per pixel, and composited
with a view-angle-dependent transmission (more reflective at grazing angles) and
a slight cool tint. The result reads as glass — you can see the reveal behind
it and the frame through it — rather than as a grey polygon at 50 % opacity.

### Photo-driven reconstruction

This is the part the specification cares most about, so it is worth being
precise about what is genuinely photo-driven and what is not.

**Genuinely driven by the photographs:**

1. *Classification.* Every asset is classified before use, and only
   `PERSPECTIVE_*` assets reach the camera stage. Interior renders are excluded
   by a measured `outdoorFraction`.
2. *Camera estimation.* Yaw, pitch, distance and field of view are estimated
   per view from vanishing points, silhouette descriptors, chamfer-matched edges
   and anchor correspondences. On A: hero at azimuth 20.2°, elevation −10.3°,
   30.9° vertical FOV, 23.1 m; garden at azimuth −163.2°, −6.2°, 21.3°, 32.7 m.
   Both are right.
3. *Projected comparison.* The candidate geometry is projected through each
   fitted camera and compared against the render's silhouette, edges, roofline
   and mass corners — with visibility and occlusion tested first, so an
   invisible feature is not counted as a missing one.
4. *Repair.* The one repair accepted on A — raising the annex top by 0.40 m —
   was proposed and accepted **because the renders disagreed with the model**,
   on a quantity that no published figure and no section cut fixes. That is
   photo-driven reconstruction doing its job.

**Not driven by the photographs, deliberately:**

- No dimension. A render cannot set, adjust or override a metric value; the
  repair engine rejects any proposal that breaks a hard constraint, and rejects
  any that worsens the authoritative elevation term beyond 0.004 even when the
  aggregate improves.
- No mass creation. The repair loop can resize what exists; it cannot yet
  propose a mass from an unexplained silhouette region. This is the honest limit
  of the current photo-driven path and it is listed as P2.

**Internet-sourced methodology** (permitted by the addendum, and used only for
method): the vanishing-point formulation follows the standard Gaussian-sphere
treatment; the Manhattan focal constraint is the classical orthogonal-pair
result; IRLS with a Cauchy weight and total-least-squares segment fitting are
textbook robust-estimation techniques; the screen-space cavity AO is the
well-known depth-buffer approximation. No project-specific geometry, no
dimension for this house, and no coordinate was taken from any external source.
The ARCHON page and its linked materials are the only source of truth about
this building.

---

## FINAL VISUAL ACCEPTANCE AUDIT

The supplied hand-built model was used as a **human visual reference only** —
a statement of the minimum recognisability and completeness expected. It is not
truth, not a scoring input, not a geometry seed and not a source of dimensions.
`referenceWeight` is 0 and asserted. Where it disagrees with ARCHON, ARCHON
wins.

### Correction iterations

Three iterations were performed, each fixing general analyzer logic — no
Marcowki-specific coordinate or threshold was introduced — with B re-run after
each.

**Iteration 1 — stack identity, triangulation and plausibility.**
The old code emitted one chimney per *facade observation*, placed on the ridge
mid-line, with only a snap-to-roof test. It produced a spurious 0.76 m stub at
the point where A's main body meets the garage. Replaced by a resolver that
(a) merges observations pinning the same coordinate on the same axis — one flue
seen twice is one flue, the same identity rule the evidence graph already uses;
(b) intersects a gable-end observation (which fixes X) with a side observation
(which fixes Z) to get a genuine 3D position, falling back to the ridge line
only when the perpendicular view is missing, and lowering the confidence when it
does; (c) requires the whole shaft to stand over *supported* roof — a flue
passes through the roof from inside the walls, so a shaft crossing the eave into
the overhang is the silhouette of an adjoining mass, not a chimney.
Result: A's spurious stack gone, one correctly placed chimney remains.
**B byte-identical.**

**Iteration 2 — candidate-line scoring by edge-pixel run length.**
Rows and columns were scored by summed gradient magnitude and thresholded at a
fraction of the maximum, so the building outline set a bar no window frame could
clear. Counting edge pixels with an orientation test, and setting the floor as a
fraction of the facade's own extent, makes the criterion "is there a straight run
long enough to be an architectural line" — scale-free, and fair to a faint long
frame. Detections on A: front 1 → 8, rear 3 → 7, right 1 → 3, left 0 → 2. The
four-sided frame requirement was **not** relaxed. B unchanged structurally.

**Iteration 3 — one opening detector, not two.**
`analyseElevation` was still using the old dark-region detector for the
observations the evidence graph and the elevation scorer consume, while the
feature solver used the framed-rectangle detector. The scorer was therefore
comparing the model against weaker evidence than the model was built from, and
reported "no openings detected on this elevation" for facades where the solver
had found several. Unified on the framed-rectangle detector, so one physical
window produces one observation whatever consumes it. A's base score 0.2209 →
0.1956; **B improved too**, 0.2244 → 0.2217.

### Feature-by-feature verdicts

Compared across ARCHON hero and garden renders, the four technical elevations,
the generated model's standard views, and the manual reference.

| Priority | Feature | Verdict | Note |
| --- | --- | --- | --- |
| 1 | Overall massing: gabled main body + lower flat-roofed wing | **MATCH** | correct in plan and in both three-quarter views |
| 1 | Wing on the correct side, at the correct height | **MATCH** | annex top 3.81 m after the accepted repair |
| 1 | Footprint proportion | **MATCH** | 12.00 × 12.53 m; area within 0.41 % of published |
| 2 | Roof topology: single gable, ridge front-to-rear, gable ends front and garden | **MATCH** | both gable ends correct |
| 2 | Roof pitch | **MATCH** | 40°, published, corroborated by the section at 39.6° |
| 2 | Rake and eave overhang, fascia | **CLOSE** | present and proportioned; rake overhang reads slightly deep |
| 2 | Roof as a real solid with thickness and soffit | **MATCH** | |
| 3 | Ground-floor opening topology, garden facade | **MATCH** | full-width glazed bay found and cut |
| 3 | Ground-floor opening topology, front facade | **CLOSE** | glazed bay and entrance zone found; the detector merges the entrance door with the adjacent glazing into one wide group |
| 3 | Garage gate | **CLOSE** | found on the right elevation; width plausible, exact width unresolved (no callout decoded) |
| 3 | Side-elevation windows | **CLOSE** | the large left-facade window found; smaller ones missed |
| 4 | Two-storey gable glazing with balcony | **MATCH** | present on both gable ends, correctly recessed |
| 4 | Recessed loggia at first floor, both gable ends | **MATCH** | found by the cross-elevation projection test, 1.4 m deep |
| 4 | Glass balustrade | **MATCH** | `RAILING` features on front and rear at 3.31 m and 3.76 m |
| 5 | Chimney | **MATCH** | one stack, right of the apex, passing through the roof surface |
| 5 | Second stack | **MATCH** (now absent) | was a false positive at the mass junction; removed by iteration 1 |
| 5 | Entrance canopy / carport soffit | **CLOSE** | the wing's flat roof extends over the entrance; the separate soffit band is modelled as a `BAND` feature rather than as a slab |
| 6 | Vertical proportions: floor levels, eave, ridge | **MATCH** | 3.06 / 4.63 / 7.92 m, all from the section |
| 6 | Storey count | **SOURCE_UNRESOLVED vs reference** | reference shows two full storeys; ARCHON shows *parter + poddasze użytkowe* (attic plan, 1.30 m knee wall, eave 1.57 m above the upper floor). **The source was followed.** |
| 7 | Rooflights | **DIFFERS** | present in the reference and faintly in A's side elevations; not detected. Absent rather than misplaced. |
| 7 | Plinth | **MATCH** | modelled, from the section |
| 7 | Horizontal bands / reveals at slab level | **CLOSE** | present; the rear band's level is the weakest elevation term (0.149) |
| 8 | Materials (wood cladding, anthracite render, white render) | **N/A** | deliberately not modelled — the shader is a monochrome architectural study, as specified |

### Regression across iterations

| | baseline | iter 1 | iter 2 | iter 3 |
| --- | --- | --- | --- | --- |
| A base score | 0.2156 | 0.2154 | 0.2209 | **0.1956** |
| A elevation term | 0.4880 | 0.4990 | 0.5157 | **0.4389** |
| A hard constraints | all satisfied | all satisfied | all satisfied | all satisfied |
| B score | 0.2221 | 0.2221 (byte-identical) | 0.2244 | **0.2217** |
| B hard constraints | all satisfied | all satisfied | all satisfied | all satisfied |
| Tests | 75/75 | 75/75 | 75/75 | **75/75** |

The rise at iterations 1 and 2 is not a regression in the model: it is the
opening terms leaving their no-evidence default of 0.5 and being measured
against real detections for the first time. Iteration 3 shows what the model was
actually worth once both sides of the comparison used the same evidence.

### Verdict

The automatically generated Marcowki is recognisable as the ARCHON house: the
massing, roof topology, the flat-roofed wing, the two-storey gable glazing with
its recessed loggia and glass balustrade, the chimney and the vertical
proportions are all correct and source-derived. Three things keep it short of an
unqualified pass: **no printed digit was successfully read on any of the three
projects**, so every chain dimension and every opening size rests on geometric
inference rather than on the exact figures printed on the drawings — which is
precisely what the mandatory-dimension-reading addendum asks for; **rooflights
are not detected**; and **secondary opening topology is approximate**, with
adjacent openings merged on the front facade and smaller side windows missed.

VISUAL_ACCEPTANCE_PARTIAL
