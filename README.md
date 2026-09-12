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
| `docs/` | docs | Kotlin porting guide, schemas, research report. |

## Development projects

- **A — Dom w marcówkach (GE)** — primary. Two storeys + usable attic, 40° gable, flat-roof garage wing.
- **B — Dom w bakopach (G2E)** — continuous regression. Single storey, 35° gable, double garage, no knee wall.
- **C — Dom w kosaćcach 44** — holdout. Not run until weights and thresholds are frozen.

## Commands

```
npm run typecheck
npm test
npm run analyze -- --project A          # analyze one development project
npm run bench                            # A + B benchmark summary
npm run freeze                           # write the freeze hashes, then C may run
npm run ui:dev                           # debug UI
```

See `docs/WEB_ANALYZER_CAMERA_AWARE_RESEARCH_REPORT.md` for the research write-up and
`docs/KOTLIN_PORTING_GUIDE.md` for the port plan.
