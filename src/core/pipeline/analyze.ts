/**
 * End-to-end orchestration (§28).
 *
 *   metric scaffold -> camera fit -> source residuals -> semantic repair
 *   -> camera re-fit -> score -> repeat
 *
 * Bounded alternating optimisation, not joint free optimisation: building
 * vertices and camera parameters are never freed together (§28). Each stage
 * solves one thing against the other held fixed, and the repair loop re-fits
 * the cameras for every candidate so a geometry change is never scored against
 * cameras that were fitted to the geometry it replaced (§27).
 *
 * Portable: decoded images in, JSON-serialisable result out.
 */
import type { RasterImage } from '../contracts/raster.js'
import type { SourcePackage } from '../contracts/source.js'
import { factValue } from '../contracts/source.js'
import type { BuildingHypothesis } from '../contracts/hypotheses.js'
import type { MultiViewScore, ElevationScoreBreakdown, ViewScoreBreakdown } from '../contracts/scoring.js'
import type { MetricScaffold } from '../contracts/scaffold.js'
import { EvidenceGraph } from '../evidence/graph.js'
import { parseTechnology } from '../source/facts.js'
import { analyseAssets, buildMetricScaffold, fitCameras, type AnalysedAsset, type ViewCameras } from './stages.js'
import { gableSpanFromSection } from '../scaffold/section.js'
import { buildHypothesis } from '../hypotheses/builder.js'
import { tessellate, worldBounds, type Tessellation } from '../hypotheses/tessellate.js'
import { facadeOf } from '../scaffold/elevation.js'
import { scoreElevation } from '../scoring/elevation.js'
import { scoreView } from '../scoring/view.js'
import { hypothesisBounds, scoreMultiView } from '../scoring/multiview.js'
import { viewFromParams, type PoseParams } from '../camera/pose.js'
import { runRepairLoop, type RepairTraceEntry, DEFAULT_REPAIR } from '../repair/engine.js'
import { generateProposals } from '../repair/proposals.js'
import { freezeHashes, type FreezeHashes } from '../config/weights.js'
import { DEFAULT_CAMERA_STAGE, type CameraStageOptions } from './stages.js'

export type AnalyzeOptions = {
  camera: CameraStageOptions
  /** Cap on repair cycles; 0 disables repair entirely. */
  maxRepairCycles: number
  scoreSize: number
}

export const DEFAULT_ANALYZE: AnalyzeOptions = {
  camera: DEFAULT_CAMERA_STAGE,
  maxRepairCycles: DEFAULT_REPAIR.maxCycles,
  scoreSize: 128,
}

export type PerformanceRecord = {
  totalMs: number
  assetAnalysisMs: number
  scaffoldMs: number
  cameraFitMs: number
  repairMs: number
  cameraProjections: number
  hypothesesEvaluated: number
  repairProposals: number
}

export type AnalyzeResult = {
  pkg: SourcePackage
  /** Every dimension the model rests on, with its provenance. */
  audit: import('../scaffold/audit.js').MetricAudit
  dimensionReadings: Map<string, import('../scaffold/dimensions.js').DimensionReading>
  analysed: AnalysedAsset[]
  scaffold: MetricScaffold
  graph: EvidenceGraph
  baseHypothesis: BuildingHypothesis
  resolved: BuildingHypothesis
  tessellation: Tessellation
  baseScore: MultiViewScore
  finalScore: MultiViewScore
  views: ViewCameras[]
  repairTrace: RepairTraceEntry[]
  freeze: FreezeHashes
  performance: PerformanceRecord
  notes: string[]
}

/**
 * Residual of the published scalar facts the geometry must reproduce. This is
 * the term that keeps the model source-true when views pull elsewhere (§51).
 */
function metricResidual(h: BuildingHypothesis, score: MultiViewScore): number {
  const checks = score.constraintChecks
  if (checks.length === 0) return 0.2
  let sum = 0
  for (const c of checks) {
    sum += Math.min(1, Math.abs(c.deviation) / Math.max(c.toleranceAbs, 1e-6)) * 0.25
  }
  return Math.min(1, sum / checks.length)
}

export function analyze(
  pkg: SourcePackage,
  images: Map<string, RasterImage>,
  opts: AnalyzeOptions = DEFAULT_ANALYZE,
): AnalyzeResult {
  const started = Date.now()
  const notes: string[] = []
  const graph = new EvidenceGraph()

  const tAssets = Date.now()
  const analysed = analyseAssets(pkg, images)
  const assetAnalysisMs = Date.now() - tAssets

  const tScaffold = Date.now()
  const stage = buildMetricScaffold(pkg, analysed, images, graph)
  const scaffoldMs = Date.now() - tScaffold
  notes.push(...stage.notes)

  const tech = parseTechnology(pkg.notes)
  const gable = stage.sectionGeometry ? gableSpanFromSection(stage.sectionGeometry) : null
  const groundNet = pkg.rooms.filter((r) => r.storey === 'GROUND').reduce((a, b) => a + b.areaM2, 0)
  const upperNet = pkg.rooms.filter((r) => r.storey === 'UPPER').reduce((a, b) => a + b.areaM2, 0)

  // Which plan axis the section cuts across: whichever of the footprint's two
  // extents its own measured width matches better. That fixes the ridge
  // direction, since a section only shows the gable triangle when it cuts
  // across the span the roof covers (§31).
  let sectionAxis: 'X' | 'Z' | null = null
  const sectionWidth = stage.sectionGeometry?.pixelsPerMetre != null && stage.footprintFit
    ? stage.footprintFit.widthM
    : null
  if (stage.sectionGeometry) {
    const w = stage.scaffold.widthM
    const d = stage.scaffold.depthM
    if (sectionWidth !== null && w > 0 && d > 0) {
      sectionAxis = Math.abs(sectionWidth - w) <= Math.abs(sectionWidth - d) ? 'X' : 'Z'
    } else {
      sectionAxis = 'X'
    }
  }

  const baseHypothesis = buildHypothesis({
    scaffold: stage.scaffold,
    gableSpanM: gable?.spanM ?? null,
    sectionAxis,
    publishedRoofFamily: tech.roofFamily,
    publishedGarageAreaM2: factValue(pkg, 'garage_area'),
    storeyNetAreas: { ground: groundNet || null, upper: upperNet || null },
    notch: stage.footprintFit?.notch ?? null,
    facadeFeatures: stage.facadeFeatures,
    gableFacades: stage.gableFacades,
  })

  let cameraProjections = 0
  let hypothesesEvaluated = 0
  const tCamera = Date.now()

  /** Fit cameras and score every source view against one candidate geometry. */
  // Poses from the last full search, so the repair loop re-fits from them
  // rather than re-running the whole grid for every proposal (§27).
  let poseSeeds: Map<string, PoseParams[]> | undefined

  const evaluateHypothesis = (
    h: BuildingHypothesis,
    seeds?: Map<string, PoseParams[]>,
  ): { score: MultiViewScore; views: ViewCameras[]; tess: Tessellation; camerasRefitted: boolean } => {
    hypothesesEvaluated++
    const tess = tessellate(h)
    const views = fitCameras(analysed, tess, graph, opts.camera, seeds)
    for (const v of views) cameraProjections += v.evaluations

    const bounds = hypothesisBounds(h)
    const elevationScores: ElevationScoreBreakdown[] = []
    for (const a of analysed) {
      if (a.projection.type !== 'ORTHOGRAPHIC_TECHNICAL') continue
      const facade = facadeOf(a.asset.role)
      if (!facade) continue
      const analysis = stage.scaffold.elevations.find((e) => e.assetId === a.asset.id)
      if (!analysis) continue
      elevationScores.push(
        scoreElevation({
          assetId: a.asset.id,
          facade,
          tess,
          worldMin: bounds.min,
          worldMax: bounds.max,
          sourceMask: a.raster.building.mask,
          analysis,
          hypothesisOpenings: h.openingGroups.filter((g) => g.facade === facade),
          hypothesisBands: h.roofs.map((r) => r.eaveY).concat(h.masses.map((m) => m.topY)),
          scoreSize: opts.scoreSize,
        }),
      )
    }

    const viewScores: ViewScoreBreakdown[] = views
      .map((v) => v.scores[0])
      .filter((x): x is ViewScoreBreakdown => x !== undefined)

    const planResidual = stage.footprintFit ? Math.min(1, Math.abs(stage.footprintFit.areaResidualM2) / 5) : 0.5
    const sectionResidual = stage.scaffold.section ? 1 - stage.scaffold.section.confidence : 0.5

    const provisional = scoreMultiView({
      hypothesis: h,
      metricResidual: 0,
      planResidual,
      sectionResidual,
      elevationScores,
      viewScores,
    })
    const score = scoreMultiView({
      hypothesis: h,
      metricResidual: metricResidual(h, provisional),
      planResidual,
      sectionResidual,
      elevationScores,
      viewScores,
    })
    return { score, views, tess, camerasRefitted: true }
  }

  const base = evaluateHypothesis(baseHypothesis)
  poseSeeds = new Map(base.views.map((v) => [v.assetId, v.poses.filter(Boolean).slice(0, 2)]))
  const cameraFitMs = Date.now() - tCamera

  // --- bounded alternating optimisation --------------------------------
  const tRepair = Date.now()
  let repairProposals = 0
  let resolved = baseHypothesis
  let finalScore = base.score
  let finalViews = base.views
  let finalTess = base.tess
  let repairTrace: RepairTraceEntry[] = []

  if (opts.maxRepairCycles > 0) {
    const result = runRepairLoop(
      baseHypothesis,
      base.score,
      (h) => {
        const e = evaluateHypothesis(h, poseSeeds)
        return { score: e.score, camerasRefitted: e.camerasRefitted }
      },
      (h, score, cycle) => {
        const proposals = generateProposals(h, score, cycle)
        repairProposals += proposals.length
        return proposals
      },
      { ...DEFAULT_REPAIR, maxCycles: opts.maxRepairCycles },
    )
    repairTrace = result.trace
    resolved = result.hypothesis
    finalScore = result.score
    if (resolved.id !== baseHypothesis.id) {
      // The accepted geometry gets one full, unseeded camera search, so the
      // reported cameras are not merely a local nudge of the base poses.
      const refit = evaluateHypothesis(resolved)
      finalViews = refit.views
      finalTess = refit.tess
      finalScore = refit.score
    }
    notes.push(
      `repair: ${result.accepted} accepted, ${result.rejected} rejected over ${result.cycles} cycle(s)`,
    )
  } else {
    notes.push('repair disabled')
  }
  const repairMs = Date.now() - tRepair

  return {
    pkg,
    audit: stage.audit,
    dimensionReadings: stage.dimensionReadings,
    analysed,
    scaffold: stage.scaffold,
    graph,
    baseHypothesis,
    resolved,
    tessellation: finalTess,
    baseScore: base.score,
    finalScore,
    views: finalViews,
    repairTrace,
    freeze: freezeHashes(),
    performance: {
      totalMs: Date.now() - started,
      assetAnalysisMs,
      scaffoldMs,
      cameraFitMs,
      repairMs,
      cameraProjections,
      hypothesesEvaluated,
      repairProposals,
    },
    notes,
  }
}

export { worldBounds }
