# Export schemas

Nine JSON documents are written per project run, all of them
`schemaVersion: "1.0.0"`. Every document is serialised through
`canonicalJson` (sorted keys, numbers rounded to nine decimals), so two runs
over the same assets produce byte-identical files. Lengths are metres, angles
degrees, areas m², pixel coordinates integers in the source image's own frame.

The shared axis convention: **plan frame** is `x` right, `z` away from the
front facade, `y` up; world `y = 0` is finished floor level of the ground
storey, and the plinth is reported separately.

---

## 1. `source-package.json`

What was fetched and what it was taken to be.

| Field | Type | Meaning |
| --- | --- | --- |
| `projectId` | string | ARCHON identifier parsed from the URL |
| `sourceUrl` | string | canonical project page URL |
| `title` | string | published project name |
| `facts[]` | `{key, label, rawText, value, unit, confidence}` | published scalar facts (`footprint_area`, `building_height`, `garage_area`, room counts …) |
| `notes[]` | string | published technology notes (roof family, pitch, knee wall, wall build-up) |
| `rooms[]` | `{storey, name, areaM2}` | published room table |
| `assets[]` | `{id, url, role, roleConfidence, widthPx, heightPx, byteLength, mediaType}` | one entry per image |

`role` is one of `ELEVATION_FRONT/REAR/LEFT/RIGHT`, `SECTION`,
`PLAN_GROUND/PLAN_UPPER/PLAN_OTHER`, `SITE_PLAN`, `HERO_RENDER`,
`GARDEN_RENDER`, `INTERIOR_RENDER`, `OTHER_RENDER`, `UNKNOWN_ASSET`.

## 2. `evidence-graph.json`

The observation graph, after identity merging.

| Field | Type | Meaning |
| --- | --- | --- |
| `nodes[]` | `{id, type, assetId?, identityKey?, authority, confidence, payload}` | one node per *physical* observation |
| `relations[]` | `{from, to, kind}` | `SUPPORTS`, `CONTRADICTS`, `DERIVED_FROM`, `OBSERVED_IN` |
| `contradictions[]` | `{a, b, key, deltaAbs}` | retained, never averaged away |

`type` ∈ `SourceAsset`, `PublishedFact`, `PlanRegion`, `LevelObservation`,
`OpeningObservation`, `CameraHypothesis`. `authority` is the ladder
`PUBLISHED_EXACT > PLAN_MEASURED > SECTION_MEASURED > ELEVATION_MEASURED >
RENDER_INFERRED > PRIOR`. Two observations sharing an `identityKey` are one
feature and are merged rather than counted twice.

## 3. `camera-hypotheses.json`

Per perspective view, every camera considered and what it is worth.

| Field | Type | Meaning |
| --- | --- | --- |
| `views[].assetId` | string | source image |
| `views[].role` | AssetRole | which render |
| `views[].projection` | `{type, confidence, evidence[], contradiction?}` | classifier output |
| `views[].hypotheses[]` | see below | ranked cameras |
| `views[].ambiguity` | `{ambiguous, axis, spread, note}` | FOV–distance degeneracy, reported not hidden |

Each hypothesis: `{id, confidenceClass, intrinsics:{fx,fy,cx,cy}, extrinsics,
fovYDeg, distanceM, azimuthDeg, elevationDeg, silhouetteIoU, edgeScore,
anchorMatches[], meanAnchorResidualPx, weight}`. `confidenceClass` ∈
`CAMERA_CONFIDENT`, `CAMERA_USABLE`, `CAMERA_WEAK`, `CAMERA_UNRESOLVED`.
An `ORTHOGRAPHIC_TECHNICAL` asset never appears here — it is never sent
through perspective fitting.

## 4. `building-hypotheses.json`

The candidate the scoring loop started from.

| Field | Type | Meaning |
| --- | --- | --- |
| `base` | BuildingHypothesis | the scaffold-derived candidate |
| `resolvedId` | string | which candidate became the answer |
| `scaffold` | MetricScaffold | the metric frame the candidate was built in |

`MetricScaffold`: `{widthM, depthM, footprintAreaM2, ridgeY, eaveY,
upperFloorY, roofPitchDeg, kneeWallM, wallThicknessM, plinthY, gableSpanM,
notch?, contradictions[], notes[]}`.

## 5. `resolved-building-geometry.json`

The answer. A real building, not an extruded outline.

| Field | Type | Meaning |
| --- | --- | --- |
| `units` | `"m"` | |
| `frame` | `{origin, xAxis, zAxis}` | plan frame definition |
| `wallThicknessM` | number | exterior wall thickness actually built |
| `plinthY` | number | finished floor above terrain |
| `footprintAreaM2` | number | ground footprint, stacked masses unioned not summed |
| `boundingBox` | `{min, max}` | world extent |
| `masses[]` | `{id, kind, footprint:{outer[], holes[]}, baseY, topY, areaM2, authority, confidence}` | volumetric masses |
| `storeys[]` | `{id, massId, levelY, heightM}` | |
| `roofs[]` | `{id, massId, kind, pitchDeg, eaveY, ridgeY, ridgeDir?, overhangM, authority, confidence}` | |
| `openingGroups[]` | `{id, massId, facade, kind, s, sillY, widthM, heightM, count, authority, confidence}` | |
| `openings[]` | `{id, groupId, facade, s, sillY, widthM, heightM}` | the cuts actually made in the walls |
| `appearance[]` | `{id, kind, facade?, world?, s?, t?, widthM, heightM, authority, confidence}` | `CHIMNEY`, `BAND`, `RAILING`, `PORTAL` |
| `constraints[]` | `{id, key, description, target, toleranceAbs}` | hard metric constraints carried with the geometry |
| `notes[]` | string | how each element was arrived at |

`kind` for masses ∈ `MAIN_BODY`, `GARAGE`, `ANNEX`, `CANOPY`, `SLAB`.

## 6. `self-verification.json`

Whether to believe the answer.

| Field | Type | Meaning |
| --- | --- | --- |
| `score` | `{base, final, elevation, perspective, plan, section, metric}` | lower is better |
| `hardConstraintsSatisfied` | bool | |
| `constraintChecks[]` | `{constraintId, key, target, actual, deviation, toleranceAbs, satisfied}` | |
| `elevationScores[]` | `{assetId, facade, silhouette, roofline, bandLevels, openingPosition, openingSize, featurePosition, total, notes[]}` | orthographic comparison |
| `viewScores[]` | `{assetId, cameraId, silhouette, edge, roofline, massCorner, openingLayout, semanticPresence, visibility, viewWeight, total, missingVisibleFeatures[], notes[]}` | perspective comparison |
| `cameraConfidence[]` | `{assetId, role, best, anchorMatches, meanAnchorResidualPx, unmatchedVisible, notVisible}` | |
| `evidence` | `{nodeCount, relationCount, byType, contradictions}` | |
| `freeze` | `{weightHash, thresholdHash, metricDefinitionHash, configHash}` | |
| `referenceWeight` | number | **asserted 0** (§39) |
| `notes[]` | string | |

## 7. `repair-trace.json`

Every repair the loop considered.

`entries[]`: `{cycle, operation, target, parameter, before, after, scoreBefore,
scoreAfter, camerasRefitted, accepted, reason}`.

`operation` ∈ `ADJUST_MASS_DEPTH`, `ADJUST_MASS_WIDTH`, `ADJUST_EAVE`,
`ADJUST_RIDGE`, `ADJUST_OVERHANG`, `MOVE_OPENING_GROUP`, `RESIZE_OPENING_GROUP`,
`ADJUST_RECESS_DEPTH`, `ADJUST_ANNEX_TOP`. A proposal that would break a hard
constraint, or that was scored against cameras not refitted after the change,
is rejected with the reason recorded.

## 8. `metric-audit.json`

Where every number came from (addendum 3).

| Field | Type | Meaning |
| --- | --- | --- |
| `entries[]` | `{key, label, value, unit, provenance, source, confidence, corroboration[], note?}` | one per metric item |
| `conflicts[]` | `{key, a, b, deltaAbs}` | retained disagreements |
| `printedDimensions[]` | `{assetId, chains[], callouts[], dimensionLines}` | what was read off the drawings |

`provenance` ∈ `SOURCE_EXACT` (printed or published figure, verified),
`SOURCE_DERIVED` (from a dimension chain or a published area),
`GEOMETRIC_INFERRED` (from measured drawing geometry),
`VISUAL_INFERRED` (from a render), `UNRESOLVED`.

`chains[]`: `{axis, positionPx, partCount, sumM, overallM, closes}` — a chain
`closes` when its parts sum to its own overall dimension.
`callouts[]`: `{text, valueM, verified, x, y}`.

## 9. `benchmark-summary.json`

`{project, name, schemaVersion, assetCount, analysedCount, scores, performance,
freeze}` where `performance` is `{assetAnalysisMs, scaffoldMs, cameraFitMs,
repairMs, totalMs, cameraProjections, hypothesesEvaluated, repairProposals}`.

Timing fields are excluded from the determinism digest
(`stripNonDeterministic`); everything else is compared byte for byte.
