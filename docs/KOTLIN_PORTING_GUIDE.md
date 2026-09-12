# Kotlin porting guide

The analyzer core was written to be moved. Everything under `src/core/`
touches no DOM, no React, no Three.js, no browser global and no Node stream;
it takes plain arrays in and returns plain data out. `src/node/` and
`src/web/` are the two adapters that feed it, and `src/ui/` only draws what it
has already decided.

Every module below carries one of four verdicts.

| Verdict | Meaning |
| --- | --- |
| `PORT_DIRECT` | Translate statement for statement. No platform API is involved. |
| `PORT_WITH_ADAPTER` | Logic ports directly; one narrow interface must be re-implemented on the target. |
| `WEB_ONLY` | Exists to run the core in a browser or in Node. Not ported. |
| `REPLACE_ON_ANDROID` | A platform equivalent is better than the port. |

---

## 1. The required components

The specification names eleven components. This is where each lives.

| Component | Module | Verdict |
| --- | --- | --- |
| `ProjectionClassifier` | `core/projection/classifier.ts` | `PORT_DIRECT` |
| `CameraModel` | `core/contracts/camera.ts`, `core/camera/projector.ts` | `PORT_DIRECT` |
| `CameraPoseEstimator` | `core/camera/pose.ts` | `PORT_DIRECT` |
| `Projector` | `core/camera/projector.ts` | `PORT_DIRECT` |
| `VisibilityEngine` | `core/camera/render.ts` | `PORT_DIRECT` |
| `ViewScorer` | `core/scoring/view.ts` | `PORT_DIRECT` |
| `MultiViewScorer` | `core/scoring/multiview.ts` | `PORT_DIRECT` |
| `EvidenceGraph` | `core/evidence/graph.ts` | `PORT_DIRECT` |
| `MassSolver` | `core/hypotheses/builder.ts`, `core/scaffold/plan.ts` | `PORT_DIRECT` |
| `OpeningGroupSolver` | `core/hypotheses/features.ts`, `core/scaffold/openings.ts` | `PORT_DIRECT` |
| `SelfRepairEngine` | `core/repair/engine.ts` | `PORT_DIRECT` |

## 2. Module by module

### Maths and utilities

| Module | Verdict | Notes |
| --- | --- | --- |
| `core/math/vec.ts` | `PORT_DIRECT` | `Vec2` is `(x, z)` in the plan frame, not `(x, y)`. Keep the naming or the frames will silently swap. |
| `core/math/linalg.ts` | `PORT_DIRECT` | `solveSPD` is a Cholesky factorisation returning `null` when the normal matrix is not positive definite — that null is a real signal (degenerate fit), not an error to swallow. `smallestEigenvector3` fixes a canonical sign so two runs agree byte for byte. |
| `core/math/optimize.ts` | `PORT_DIRECT` | Levenberg–Marquardt with a forward-difference Jacobian and box clamping. No external solver. |
| `core/util/hash.ts` | `PORT_DIRECT` | SHA-256 is implemented here rather than taken from a platform library so the digest cannot drift between platforms. Verified against the `abc` and empty-string vectors. `canonicalJson` sorts keys and rounds to nine decimals; **the rounding is part of the contract**. |
| `core/util/ids.ts` | `PORT_DIRECT` | Stable ids derived from content, never from a counter or a clock. |

### Source adapter

| Module | Verdict | Notes |
| --- | --- | --- |
| `core/source/archon-parser.ts` | `PORT_DIRECT` | Pure string→data. Regex only; no HTML parser dependency. Kotlin `Regex` needs `RegexOption.DOT_MATCHES_ALL` where `[\s\S]` is used. |
| `core/source/facts.ts` | `PORT_DIRECT` | Polish number formats (`12,05`), resource-slug map, technology-note parsing. |
| `core/source/role-classifier.ts` | `PORT_DIRECT` | Metadata rules plus a pixel fallback. |
| `core/source/fetch-policy.ts` | `PORT_WITH_ADAPTER` | The *policy* (allowlist, HTTPS-only, per-hop redirect revalidation, size caps, bounded concurrency) ports directly. The transport does not: supply an OkHttp `Interceptor` that calls `checkUrl`/`checkRedirect`/`checkResponse` at the same three points. This is not an open proxy and must not become one on the way across. |
| `node/fetch-adapter.ts`, `node/source-loader.ts` | `WEB_ONLY` | |
| `node/image-decode.ts`, `web/image-decode.ts` | `REPLACE_ON_ANDROID` | Use `BitmapFactory` and read pixels into the same RGBA byte layout. Composite transparent GIFs onto white exactly as both adapters do, or the background classifier sees holes. |

### Raster analysis

| Module | Verdict | Notes |
| --- | --- | --- |
| `core/raster/gray.ts` | `PORT_DIRECT` | |
| `core/raster/filters.ts` | `PORT_DIRECT` | Separable blur, Sobel, percentile, Canny, morphology, connected components, hole filling. All integer/float array work. On Android this is the one place worth considering RenderScript-successor or a `ByteBuffer`-backed native path if profiling demands it — the algorithms are unchanged either way. |
| `core/raster/lines.ts` | `PORT_DIRECT` | Hough plus `refineSegment`, a total-least-squares refit. The refit matters: Hough's angular quantisation floor is coarse enough to turn a technical elevation into a "converging" one. |
| `core/raster/mask.ts` | `PORT_DIRECT` | Edge-bounded flood from the borders with a dilated Canny contour as barrier. Colour-rule background detection was tried first and fails on dusk renders. |
| `core/raster/chamfer.ts` | `PORT_DIRECT` | |
| `core/raster/pipeline.ts` | `PORT_DIRECT` | |

### Projection classification

| Module | Verdict | Notes |
| --- | --- | --- |
| `core/projection/vp-detect.ts` | `PORT_DIRECT` | Pairwise voting on the Gaussian sphere into a 96×96 disk accumulator, peak refinement, overlap dedup. Deterministic — there is no RANSAC anywhere in this codebase. |
| `core/projection/vanishing.ts` | `PORT_DIRECT` | Model selection between *parallel* and *convergent* on angular residuals; `isGenuineConvergence` additionally requires the vanishing point to lie at least 0.8 image diagonals outside the frame. Both guards are needed; either alone misclassifies. |
| `core/projection/classifier.ts` | `PORT_DIRECT` | Role prior combined with geometric evidence, and a `contradiction` field when they disagree. |

### Camera

| Module | Verdict | Notes |
| --- | --- | --- |
| `core/camera/projector.ts` | `PORT_DIRECT` | Pinhole intrinsics, `lookAt`, `cameraCentre`, segment and polygon projection, and a separate `OrthographicView` used for technical elevations. |
| `core/camera/render.ts` | `PORT_DIRECT` | Depth-buffered software rasteriser with perspective-correct `1/z` and near-plane triangle clipping. It is deliberately *not* the display renderer: scoring must not depend on a GPU driver. Keep it in Kotlin as plain arrays. |
| `core/camera/silhouette-descriptor.ts` | `PORT_DIRECT` | A fixed-length radial fan from the centroid. This exists because IoU is one non-smooth scalar and Levenberg–Marquardt needs a residual vector. |
| `core/camera/pose.ts` | `PORT_DIRECT` | Bounded coarse grid, top-K refinement, then LM. `searchCameras(..., refitFrom)` seeds from an existing solution; §27 requires a refit after every accepted geometry change and the seed is what makes that affordable. |
| `core/camera/ambiguity.ts`, `core/camera/confidence.ts` | `PORT_DIRECT` | |
| `core/camera/anchors.ts` | `PORT_DIRECT` | |
| `core/camera/shade.ts` | `PORT_DIRECT` | Monochrome architectural study shading with screen-space cavity ambient occlusion and deferred transparent compositing. |

**`solvePnP` mapping.** There is no OpenCV dependency and none is needed.
The analyzer never has the six-degree-of-freedom problem OpenCV's `solvePnP`
solves, because the camera is parameterised by what the sources actually
constrain: `PoseParams` is `{azimuthDeg, elevationDeg, distanceM, fovYDeg,
targetY, rollDeg}` about a known building centre. If you do port to OpenCV:

| This codebase | OpenCV equivalent | Caveat |
| --- | --- | --- |
| `intrinsicsFromFovY` | `cameraMatrix` | `fx = fy = (h/2)/tan(fovY/2)`, `cx, cy` at the image centre. |
| `viewFromParams` → `extrinsics` | `rvec`, `tvec` | Extrinsics here are a row-major 3×4 world→camera matrix. `Rodrigues` converts the rotation block to `rvec`; `tvec` is the translation column verbatim. |
| `searchCameras` | `solvePnPRansac` | **Do not substitute it.** RANSAC is stochastic; the determinism tests compare byte-identical exports across runs. The bounded grid + LM path gives the same answer every time. |
| `anchorMatches` | `objectPoints`/`imagePoints` | The anchor correspondences are exactly a PnP problem when ≥ 6 are matched — useful as a *seed*, but the FOV–distance ambiguity remains and `ambiguity.ts` must still run. |
| `focalFromVanishingPair` | `calibrationMatrixValues` | Focal from an orthogonal vanishing-point pair, used when the render gives no metadata. |

### Printed dimensions (WEB-02)

| Module | Verdict | Notes |
| --- | --- | --- |
| `core/dimensions/contracts.ts` | `PORT_DIRECT` | Types only. `MetricFidelity` and `FIDELITY_RANK` decide which readings may act as hard constraints; keep `isExactFidelity` as the single gate. |
| `core/dimensions/geometry.ts` | `PORT_DIRECT` | Lines, ticks, chain families, callout rings, leader tracing, level bands, slant. A tick must ink *both* sides of the baseline — that one test is what keeps a digit's stem from being read as an anchor. `refineLinePosition` and the tick centroids must stay `Double`: the sub-pixel fraction they recover is the point. |
| `core/dimensions/crops.ts` | `PORT_DIRECT` | Source-native crops, upright rotation, contrast normalisation, rule removal, deterministic threshold variants. |
| `core/dimensions/recognizer.ts` | `PORT_DIRECT` | The seam, glyph segmentation, bilinear normalisation with the slant removed. Nearest-neighbour sampling aliases the stroke edge by half a pixel and makes two instances of one character disagree more than two different characters do. |
| `core/dimensions/templates.ts` | `PORT_DIRECT` | Harvested templates, the labelling-coherence objective, invariant-position harvesting. |
| `core/dimensions/alphabet.ts` | `PORT_DIRECT` | The earlier clustering path, kept for the propagation helpers. |
| `core/dimensions/grammar.ts` | `PORT_DIRECT` | Alternative unit interpretations with plausibility by kind. Must not choose; only the geometry chooses. |
| `core/dimensions/chains.ts` | `PORT_DIRECT` | Joint scale/integer solving, closure, scale voting with the aliasing guard. |
| `core/dimensions/section-levels.ts` | `PORT_DIRECT` | Level markers found structurally and placed on the reference line they annotate. |
| `core/dimensions/text-runs.ts` | `PORT_DIRECT` | General run finder; baseline agreement is measured against the run's *first* member, or the baseline drifts a pixel per character. |
| `core/dimensions/room-anchor.ts` | `PORT_DIRECT` | Published-room-area anchoring. Present, not wired: see the WEB-02 report §14. |
| `core/dimensions/reader.ts`, `project.ts`, `stage.ts` | `PORT_DIRECT` | Per-drawing and per-package orchestration. The section supervises the package; the plans are read, not predicted. |
| `core/openings/identity.ts` | `PORT_DIRECT` | Cross-source opening identity, panel structure from nesting, retained conflicts. |
| `core/roof/rooflights.ts` | `PORT_DIRECT` | Two-sided contrast, the four rejections, single-view placement on the slope. |
| `core/source/resolution.ts` | `PORT_DIRECT` | The upgrade *policy* — candidates and the strictly-larger test. |
| `node/source-loader.ts` (probe) | `PORT_WITH_ADAPTER` | The probe is a new network path and must go through the same fetch-policy checks as every other request. |

**If an OCR library is ever added** it sits behind
`TechnicalTextRecognizer`, is marked `REPLACE_ON_ANDROID`, and stays subject to
the geometry check: a reading that does not match the thing it annotates is not
a dimension, whatever produced it. On Android the equivalent is ML Kit's text
recogniser, and it needs exactly that treatment — its output must never become
exact metric truth.

### Metric scaffold

| Module | Verdict | Notes |
| --- | --- | --- |
| `core/scaffold/silhouette.ts` | `PORT_DIRECT` | Terrain-band cut and grounded dominant-column run. |
| `core/scaffold/section.ts` | `PORT_DIRECT` | Levels, ridge, and `gableSpanFromSection` (the wall faces the ridge sits midway between). The section is the most trustworthy geometric source in an ARCHON package and is treated as such. |
| `core/scaffold/plan.ts` | `PORT_DIRECT` | Wall-ink mask, occupancy profiles, corner-notch detection, footprint fit rescaled to the published area. |
| `core/scaffold/elevation.ts` | `PORT_DIRECT` | Otsu, facade conditioning, opening reading. |
| `core/scaffold/openings.ts` | `PORT_DIRECT` | Framed-rectangle detection. Candidate lines are scored by **edge-pixel run length**, not summed gradient magnitude — summed magnitude is captured by the building outline and window frames never clear the threshold. |
| `core/scaffold/facade-features.ts` | `PORT_DIRECT` | Bands, protrusions above a *predicted* roof outline, roof openings, gable infill. |
| `core/scaffold/glyphs.ts` | `PORT_DIRECT` | Connected-component glyph extraction, target-to-source normalisation, grayscale cosine clustering. |
| `core/scaffold/dimension-lines.ts` | `PORT_DIRECT` | Dimension-line and tick detection, chain assembly. |
| `core/scaffold/dimensions.ts` | `PORT_DIRECT` | Self-calibrating OCR with constraint propagation, plus `solveChainGeometry` — a joint fit of scale and grid-snapped values. Acceptance is verified-only: a glyph reading is used only if the number it produces matches the segment length it labels. |
| `core/scaffold/audit.ts` | `PORT_DIRECT` | Provenance ladder. Never averages across provenance classes. |
| `core/scaffold/metric.ts` | `PORT_DIRECT` | Assembles the scaffold and records contradictions. |
| `core/scaffold/render-features.ts`, `core/scaffold/cluster.ts` | `PORT_DIRECT` | |

### Hypotheses and geometry

| Module | Verdict | Notes |
| --- | --- | --- |
| `core/hypotheses/frames.ts` | `PORT_DIRECT` | FRONT is the plan's lower edge and faces `+z`; LEFT is the `−x` side. Get this wrong and every facade feature lands on the wrong wall. |
| `core/hypotheses/builder.ts` | `PORT_DIRECT` | Mass decomposition, `roofHeightAt` (with and without the overhang), `showsProjectionAt`, constraint construction. |
| `core/hypotheses/features.ts` | `PORT_DIRECT` | Bands, canopies, balconies, recesses, opening groups, and stack resolution — the last of which merges observations of one flue across facades and triangulates it from two orthogonal elevations. |
| `core/hypotheses/solid.ts` | `PORT_DIRECT` | Volumetric walls, exact opening cuts by grid decomposition on planar walls (no CSG library), reveals, glazing, caps, slabs, pitched-roof solids, rake-clipped gable glazing. |
| `core/hypotheses/tessellate.ts` | `PORT_DIRECT` | |
| `core/contracts/geometry.ts` | `PORT_WITH_ADAPTER` | Pure polygon maths. JSTS is used **only** behind this boundary and only for robust polygon predicates; on Android use JTS (`org.locationtech.jts`), which is the same library's ancestor and has the same semantics. Nothing outside this module may import it. |

### Scoring, repair, pipeline

| Module | Verdict | Notes |
| --- | --- | --- |
| `core/scoring/view.ts` | `PORT_DIRECT` | Silhouette 0.34, edge 0.30, roofline 0.18, mass corners 0.10, opening layout 0.04, semantic presence 0.02, visibility 0.02. RGB MSE is not a term and must not become one. |
| `core/scoring/elevation.ts` | `PORT_DIRECT` | Orthographic comparison. Technical elevations outrank perspective views. |
| `core/scoring/multiview.ts` | `PORT_DIRECT` | Hard-constraint checks, `groundFootprintArea` (stacked masses unioned, not summed), aggregation. |
| `core/repair/operations.ts`, `proposals.ts`, `engine.ts` | `PORT_DIRECT` | Bounded alternating optimisation. The engine refuses any proposal scored against cameras that were not refitted after the change (§27) and any that regresses an elevation. |
| `core/config/weights.ts` | `PORT_DIRECT` | `REFERENCE_WEIGHT = 0` and `freezeHashes()`. The zero is asserted in tests; keep the assertion. |
| `core/pipeline/stages.ts`, `analyze.ts`, `exports.ts` | `PORT_DIRECT` | `stripNonDeterministic` removes timing fields before the determinism digest. |

### Adapters and UI

| Module | Verdict |
| --- | --- |
| `node/cli.ts`, `node/projects.ts` | `WEB_ONLY` |
| `web/analyze-worker.ts` | `WEB_ONLY` |
| `ui/App.tsx`, `ui/Viewer.tsx`, `ui/main.tsx` | `WEB_ONLY` |

Three.js appears only in `ui/Viewer.tsx`. It owns no domain geometry, no
scoring and no camera truth: it receives the already-resolved triangle list and
draws it. On Android, replace it with whatever renderer you like — Filament,
SceneView, raw GLES — without touching anything in `core/`.

## 3. Porting order

1. `math/`, `util/` — then run the SHA-256 and `canonicalJson` vectors.
2. `contracts/` — types only.
3. `source/` — then parse the cached `fixtures/*/page.html` and compare the
   `source-package.json` byte for byte.
4. `raster/`, `projection/` — then check the classification of every asset in
   A and B against `camera-hypotheses.json`.
5. `scaffold/` — then compare `metric-audit.json`.
6. `camera/`, `hypotheses/` — then compare `resolved-building-geometry.json`.
7. `scoring/`, `repair/`, `pipeline/` — then compare the bundle hash.

Each step has a byte-comparable artefact, which is the point of canonical
serialisation. If step *n* matches, step *n+1*'s failures are its own.

## 4. Kotlin-specific traps

- **Float determinism.** Use `Double` throughout, as the TypeScript does.
  `Math.fma` and `-Xjvm-default` strictfp differences will not bite at nine
  decimals, but a `Float` intermediate will.
- **Integer division.** TypeScript `/` is always floating point. Every `/` in
  the ported code must stay floating point; `Math.floor` is explicit where
  truncation is meant.
- **`Int8Array` vs `ByteArray`.** Mask data is 0/1 in a `Uint8Array`. Kotlin's
  `ByteArray` is signed; use `UByteArray` or compare against `0.toByte()`.
- **Sorting stability.** `Array.prototype.sort` is stable in modern JS engines
  and several comparators here rely on that for tie-breaking. Kotlin's
  `sortedWith` is stable; `sortedArrayWith` on primitives is not always.
  Where ties matter the comparators already fall back to an explicit key —
  keep those fallbacks.
- **Map iteration order.** JS `Map` iterates in insertion order and the
  evidence graph depends on it. Use `LinkedHashMap`.
