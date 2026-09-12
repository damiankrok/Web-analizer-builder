# RESEARCH-ANALYZER-WEB-01 — camera-aware multi-view web analyzer

Research analyzer that reconstructs a house from a published ARCHON project page by
combining **metric source geometry** (plans, section, technical elevations, published
numeric facts) with **camera-aware analysis of architectural visualisations**, so that a
single shared 3D hypothesis projects consistently into several source views.

```
URL → SourcePackage → EvidenceGraph → metric scaffold → ProjectionClassifier
    → CameraHypotheses per view → BuildingHypotheses → multi-view source score
    → semantic repair → ResolvedBuildingGeometry
```

## Layout

| Path | Portability | Contents |
| --- | --- | --- |
| `src/core/` | **portable** | No DOM, React, Three.js, Node or browser globals. Pure functions over immutable JSON-serialisable DTOs. This is what ports to Kotlin/JVM. |
| `src/node/` | host adapter | Bounded fetching, image decoding, CLI. |
| `src/web/` | host adapter | Browser image decoding, worker entry. |
| `src/ui/` | web only | React debug panels + Three.js viewer/debug renderer. |
| `fixtures/` | data | Cached source pages for the A/B/C development projects. |
| `scripts/` | tooling | Standard audit renders. |
| `docs/` | docs | Kotlin porting guide, export schemas, research report. |

## Development projects

- **A — Dom w marcówkach (GE)** — primary. Ground storey + usable attic, 40° gable, flat-roof garage wing.
- **B — Dom w bakopach (G2E)** — continuous regression. Single storey, 35° gable, double garage, no knee wall.
- **C — Dom w kosaćcach 44** — the WEB-01 holdout, run once after that freeze. Observed, so no longer clean; kept as a second regression project.
- **D — Dom w kruszczykach 22** — the WEB-02 holdout. Single storey, hipped roof, no attic, no wing. Chosen before development on the presence of technical drawings alone; not run until the freeze.

## Commands

```
npm run typecheck
npm test                                 # 75 tests
npm run fetch A                          # populate a project's asset cache (network)
npm run analyze A                        # analyze one development project, write exports
npm run bench                            # A + B benchmark summary
npm run freeze                           # write the freeze hashes, then C may run
npx tsx src/node/cli.ts holdout          # run D; refuses unless the freeze and HEAD still match
npx tsx scripts/render-views.ts A out/views/A   # standard audit renders
npm run ui:dev                           # debug UI (vite)
npm run ui:build                         # production UI bundle into dist-ui/
```

Analysis runs offline from `fixtures/<project>/` by default; pass `--online` to
fetch. Ten JSON documents are written per run into `out/<project>/`; see
`docs/SCHEMAS.md`.

Printed dimensions are read from **source-native** rasters, not from the bounded
640 px structural frame: the page embeds small copies of the technical drawings
and links the originals, and an 11-pixel digit does not survive being resampled
to 8. `printed-dimensions.json` records which copy of each asset supplied the
pixels.

## Design rules the code enforces

- A technical elevation is **never** sent through perspective camera fitting.
- Every accepted geometry repair **re-fits** the cameras of the affected views
  before the new score is compared (§27).
- RGB MSE is not a scoring term.
- A missing feature counts against a hypothesis only if it should project into
  the view, lands inside the frame, and is not occluded (§34).
- `REFERENCE_WEIGHT = 0` — manual reference imagery is development audit only,
  never a scoring input, geometry seed or PASS/FAIL source (§39).
- Exact source dimensions are never silently averaged; conflicts are retained
  and every metric item carries its provenance.
- A printed number is a dimension only once the analyzer knows what it measures:
  a reading is accepted only where it also agrees with the geometry it
  annotates, and a reading that does not is exported with the disagreement
  stated rather than used.
- Only `SOURCE_EXACT` and `SOURCE_CORROBORATED` may act as exact or hard metric
  constraints.
- Fetching is policy-bounded: HTTPS only, host allowlist, per-hop redirect
  revalidation, size caps, bounded concurrency. Not an open proxy.

## Documents

- `docs/WEB_ANALYZER_CAMERA_AWARE_RESEARCH_REPORT.md` — the research write-up,
  including the final visual acceptance audit and the 3D/photo-driven section.
- `docs/KOTLIN_PORTING_GUIDE.md` — per-module port verdicts and port order.
- `docs/WEB_ANALYZER_DIMENSION_OCR_HARDENING_REPORT.md` — the WEB-02 write-up:
  source resolutions, the dimension pipeline, what was recovered and what the
  holdout exposed.
- `docs/SCHEMAS.md` — the ten export documents.
