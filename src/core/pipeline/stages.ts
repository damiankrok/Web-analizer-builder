import type { RasterImage } from '../contracts/raster.js'
import type { SourceAsset, ParsedSource } from '../contracts/source.js'
import { factValue } from '../contracts/source.js'
import type { ProjectionType } from '../contracts/camera.js'
import type { MetricScaffold, ElevationAnalysis, PlanAnalysis } from '../contracts/scaffold.js'
import { prepareAsset, type AssetRaster } from '../raster/pipeline.js'
import { toGray, saturationField } from '../raster/gray.js'
import { classifyProjection, type ProjectionClassification } from '../projection/classifier.js'
import { parseTechnology } from '../source/facts.js'
import { analyseSectionGeometry, buildSectionAnalysis, gableSpanFromSection, sectionMassWidths, type SectionGeometry } from '../scaffold/section.js'
import { wallMask, planExtent, fitFootprint, buildPlanAnalysis, type FootprintFit } from '../scaffold/plan.js'
import { selectPlanAsset } from '../dimensions/plan-select.js'
import { readDimensions, type DimensionReading } from '../scaffold/dimensions.js'
import { buildAudit, type AuditInput, type MetricAudit } from '../scaffold/audit.js'
import { analyseElevation, facadeOf, type ElevationMeasurement } from '../scaffold/elevation.js'
import { solveFacadeFeatures, type FacadeFeatureSet } from '../scaffold/facade-features.js'
import type { FacadeSide } from '../contracts/hypotheses.js'
import { assembleScaffold, type ScaffoldContradiction } from '../scaffold/metric.js'
import { EvidenceGraph } from '../evidence/graph.js'
import type { CameraHypothesis } from '../contracts/camera.js'
import type { Tessellation } from '../hypotheses/tessellate.js'
import { worldBounds } from '../hypotheses/tessellate.js'
import { searchCameras, toCameraHypothesis, viewFromParams, DEFAULT_POSE_SEARCH, type PoseParams, type PoseSearchOptions } from '../camera/pose.js'
import { detectAmbiguity, type AmbiguityReport } from '../camera/ambiguity.js'
import { classifyCamera, viewWeightFor, DEFAULT_CONFIDENCE, type ConfidenceThresholds } from '../camera/confidence.js'
import { deriveAnchors, type AnchorDerivation } from '../camera/anchors.js'
import { extractRenderFeatures, type RenderFeatures } from '../scaffold/render-features.js'
import { renderPerspective } from '../camera/render.js'
import { scoreView } from '../scoring/view.js'
import type { ViewScoreBreakdown } from '../contracts/scoring.js'
/**
 * Pipeline stages up to the metric scaffold.
 *
 * Portable: the pipeline takes decoded images as plain DTOs, so the same code
 * runs in Node, in a Web Worker and on the JVM. Fetching and decoding are host
 * concerns that happen before this point.
 */

export type AnalysedAsset = {
  asset: SourceAsset
  raster: AssetRaster
  projection: ProjectionClassification
}

const LINE_DRAWING_ROLES = new Set(['PLAN_GROUND', 'PLAN_UPPER', 'PLAN_OTHER', 'SITE_PLAN', 'SECTION'])

export function analyseAssets(pkg: ParsedSource, images: Map<string, RasterImage>): AnalysedAsset[] {
  const out: AnalysedAsset[] = []
  for (const asset of pkg.assets) {
    const image = images.get(asset.id)
    if (!image) continue
    const lineDrawing = LINE_DRAWING_ROLES.has(asset.role)
    const raster = prepareAsset(image, { lineDrawing })
    const projection = classifyProjection({
      role: asset.role,
      image: raster.image,
      gray: raster.gray,
      segments: raster.segments,
    })
    out.push({ asset, raster, projection })
  }
  return out
}

export type ScaffoldStageResult = {
  scaffold: MetricScaffold
  contradictions: ScaffoldContradiction[]
  sectionGeometry: SectionGeometry | null
  footprintFit: FootprintFit | null
  elevationMeasurements: Map<string, ElevationMeasurement>
  /** Architectural features solved per facade from the orthographic elevations. */
  facadeFeatures: FacadeFeatureSet[]
  /** Facades whose silhouette shows a gable apex. */
  gableFacades: FacadeSide[]
  /** Printed dimensions read off each plan. */
  dimensionReadings: Map<string, DimensionReading>
  /** Every dimension the model rests on, with its provenance. */
  audit: MetricAudit
  notes: string[]
}

export function buildMetricScaffold(
  pkg: ParsedSource,
  analysed: readonly AnalysedAsset[],
  images: Map<string, RasterImage>,
  graph: EvidenceGraph,
): ScaffoldStageResult {
  const notes: string[] = []
  const tech = parseTechnology(pkg.notes)
  const publishedHeight = factValue(pkg, 'building_height')
  const publishedArea = factValue(pkg, 'footprint_area')

  // Published facts enter the graph first: they are the top of the authority
  // ladder and everything downstream is compared against them.
  for (const f of pkg.facts) {
    if (f.value === null) continue
    graph.add({
      id: f.id,
      type: 'PublishedFact',
      authority: 'PUBLISHED_EXACT',
      confidence: 0.98,
      identityKey: `fact:${f.key}`,
      payload: { key: f.key, value: f.value, unit: f.unit, label: f.sourceLabel },
    })
  }
  for (const a of pkg.assets) {
    graph.add({
      id: a.id,
      type: 'SourceAsset',
      sourceAssetId: a.id,
      authority: 'PRIOR',
      confidence: a.roleConfidence,
      payload: { role: a.role, url: a.url, width: a.width, height: a.height },
    })
  }

  // --- Section ---------------------------------------------------------
  const sectionAsset = analysed.find((a) => a.asset.role === 'SECTION')
  let sectionGeometry: SectionGeometry | null = null
  let sectionAnalysis = null
  let sectionWidthM: number | null = null
  let sectionSpansM: number[] = []
  let gableSpanM: number | null = null
  let wallThicknessesM: number[] = []
  if (sectionAsset) {
    sectionGeometry = analyseSectionGeometry(
      sectionAsset.raster.segments,
      sectionAsset.raster.image.width,
      sectionAsset.raster.image.height,
      publishedHeight,
    )
    sectionAnalysis = buildSectionAnalysis(sectionAsset.asset.id, sectionGeometry, tech.roofPitchDeg, tech.kneeWallM)
    const widths = sectionMassWidths(sectionGeometry)
    if (widths) {
      sectionWidthM = widths.totalM
      // Wall faces alternate outer/inner, so a mass span is the gap between
      // consecutive faces; the thin ones are wall thicknesses, not masses.
      sectionSpansM = widths.spansM.filter((s) => s > 1.0)
      wallThicknessesM = widths.spansM.filter((s) => s <= 1.0)
    }
    const gable = gableSpanFromSection(sectionGeometry)
    if (gable) {
      gableSpanM = gable.spanM
      notes.push(
        `gable span ${gable.spanM.toFixed(2)} m taken from the wall faces the ridge sits midway between ` +
          `(symmetry error ${gable.symmetryErrorPx.toFixed(1)} px)`,
      )
    }
    for (const level of sectionAnalysis.levels) {
      graph.add({
        id: level.id,
        type: 'LevelObservation',
        sourceAssetId: sectionAsset.asset.id,
        authority: level.authority,
        confidence: level.confidence,
        identityKey: `level:${level.kind}`,
        payload: { kind: level.kind, y: level.y },
      })
    }
  } else {
    notes.push('no section published: the vertical structure rests on published facts alone')
  }

  // --- Plans -----------------------------------------------------------
  const plans: PlanAnalysis[] = []
  const dimensionReadings = new Map<string, DimensionReading>()
  let footprintFit: FootprintFit | null = null
  let planChainWidthM: number | null = null
  let planChainDepthM: number | null = null
  // Which copy of the ground floor carries the dimension chains — STAGE
  // WEB-PIVOT-04. Selecting by the single-enum role pointed the reader at the
  // area-labelled copy, which is the one published copy of this floor with no
  // dimensions printed on it.
  const groundSelection = selectPlanAsset(
    analysed.map((a) => a.asset),
    'GROUND',
  )
  const upperSelection = selectPlanAsset(
    analysed.map((a) => a.asset),
    'UPPER_ATTIC',
  )
  for (const [storey, sel] of [
    ['ground', groundSelection],
    ['upper', upperSelection],
  ] as const) {
    if (sel) notes.push(`${storey} plan selected by ${sel.by}: ${sel.reason}`)
    else notes.push(`no ${storey} floor plan published`)
  }
  const groundPlan = groundSelection ? analysed.find((a) => a.asset.id === groundSelection.asset.id) : undefined
  if (groundPlan) {
    const image = images.get(groundPlan.asset.id)
    if (image) {
      const walls = wallMask(toGray(image), saturationField(image))
      const extent = planExtent(walls)
      footprintFit = fitFootprint(extent, publishedArea, sectionWidthM)
      const analysis = buildPlanAnalysis(groundPlan.asset.id, 'GROUND', extent, footprintFit)
      plans.push(analysis)

      // Printed dimensions. The plan's own dimension chains are an independent
      // measurement of the same building the wall extent gave, which is exactly
      // the cross-source corroboration the audit reports on.
      const gray = toGray(image)
      const reading = readDimensions(gray, {
        pixelsPerMetre: analysis.calibration.pixelsPerMetre,
        predictionTolerance: 0.08,
        chainTolerance: 0.12,
        minGlyphsPerLabel: 2,
      })
      dimensionReadings.set(groundPlan.asset.id, reading)
      notes.push(...reading.notes.map((n) => `plan dimensions: ${n}`))

      // A chain measures the building overall only if it actually spans it.
      // A short interior chain is a real dimension of something, but it is not
      // the overall one, and offering it as such would manufacture a conflict.
      const overallChain = (axis: 'HORIZONTAL' | 'VERTICAL', extentPx: number): number | null => {
        const candidates = reading.chains
          .filter((c) => c.axis === axis && c.parts.length >= 1)
          .map((c) => ({ sum: c.sumM, span: c.parts.reduce((s2, p) => s2 + (p.toPx - p.fromPx), 0) }))
          .filter((c) => c.span >= extentPx * 0.75)
          .sort((a, b) => b.span - a.span)
        return candidates.length > 0 ? candidates[0].sum : null
      }
      planChainWidthM = overallChain('HORIZONTAL', extent.widthPx)
      planChainDepthM = overallChain('VERTICAL', extent.heightPx)
      graph.add({
        id: `plan_${groundPlan.asset.id}`,
        type: 'PlanRegion',
        sourceAssetId: groundPlan.asset.id,
        authority: 'PLAN_MEASURED',
        confidence: analysis.confidence,
        identityKey: 'footprint:ground',
        payload: {
          widthM: footprintFit.widthM,
          depthM: footprintFit.depthM,
          areaM2: footprintFit.areaM2,
          notch: footprintFit.notch,
        },
      })
    }
  } else {
    notes.push('no ground-floor plan published: the footprint shape is unconstrained')
  }

  // --- Elevations ------------------------------------------------------
  const elevations: ElevationAnalysis[] = []
  const elevationMeasurements = new Map<string, ElevationMeasurement>()
  for (const a of analysed) {
    if (a.projection.type !== 'ORTHOGRAPHIC_TECHNICAL') continue
    const image = images.get(a.asset.id)
    if (!image) continue
    const result = analyseElevation(
      a.asset.id,
      a.asset.role,
      a.raster.image,
      a.raster.gray,
      a.raster.gradients,
      a.raster.building.mask,
      publishedHeight,
    )
    if (!result) continue
    elevations.push(result.analysis)
    elevationMeasurements.set(a.asset.id, result.measurement)
    for (const op of result.analysis.openings) {
      graph.add({
        id: op.id,
        type: 'OpeningObservation',
        sourceAssetId: a.asset.id,
        authority: 'ELEVATION_MEASURED',
        confidence: op.confidence,
        identityKey: `opening:${result.analysis.facade}:${op.s.toFixed(1)}:${op.sillY.toFixed(1)}`,
        payload: { facade: result.analysis.facade, ...op },
      })
    }
    if (result.analysis.ridgeY !== null) {
      graph.add({
        id: `ridge_${a.asset.id}`,
        type: 'ElevationFeature',
        sourceAssetId: a.asset.id,
        authority: 'ELEVATION_MEASURED',
        confidence: result.analysis.confidence * 0.8,
        identityKey: 'level:RIDGE',
        payload: { kind: 'RIDGE', y: result.analysis.ridgeY },
      })
    }
  }

  // --- architectural features per facade -------------------------------
  // Solved after the scaffold's first pass, because the eave height decides
  // which part of a facade is wall and which is roof.
  const provisionalEave = (() => {
    const ridge = sectionAnalysis?.levels.find((l) => l.kind === 'RIDGE')?.y ?? null
    if (ridge === null || !gableSpanM || !tech.roofPitchDeg) return null
    return ridge - (gableSpanM / 2) * Math.tan((tech.roofPitchDeg * Math.PI) / 180)
  })()

  const facadeFeatures: FacadeFeatureSet[] = []
  const gableFacades: FacadeSide[] = []
  for (const a of analysed) {
    if (a.projection.type !== 'ORTHOGRAPHIC_TECHNICAL') continue
    const facade = facadeOf(a.asset.role)
    if (!facade) continue
    const measurement = elevationMeasurements.get(a.asset.id)
    if (!measurement) continue
    const set = solveFacadeFeatures({
      facade,
      assetId: a.asset.id,
      gray: a.raster.gray,
      gradients: a.raster.gradients,
      silhouette: measurement.silhouette,
      publishedHeightM: publishedHeight,
      eaveHeightM: provisionalEave,
      // Only a gable end shows the pitch in its outline; a side elevation of
      // the same roof is flat-topped, and predicting a slope there would find
      // protrusions all along the ridge.
      roofPitchDeg: null,
    })
    facadeFeatures.push(set)
    // A gable facade is one whose silhouette rises to a pronounced apex well
    // inside its own width; a side elevation of the same roof is flat-topped.
    const sil = measurement.silhouette
    const apexFraction = sil.widthPx > 0 ? (sil.apexX - sil.minX) / sil.widthPx : 0
    const shoulderRow = Math.max(
      ...[0.08, 0.92].map((f) => {
        const x = Math.round(sil.minX + sil.widthPx * f)
        for (let y = 0; y < sil.mask.height; y++) if (sil.mask.data[y * sil.mask.width + x]) return y
        return sil.groundRow
      }),
    )
    const peakiness = sil.heightPx > 0 ? (shoulderRow - sil.topRow) / sil.heightPx : 0
    if (apexFraction > 0.12 && apexFraction < 0.88 && peakiness > 0.2) gableFacades.push(facade)
  }

  // Re-solve the gable facades now that they are known to be gables: their
  // roof outline is a pitch, not a flat top, and protrusion detection needs it.
  if (tech.roofPitchDeg) {
    for (let i = 0; i < facadeFeatures.length; i++) {
      const set = facadeFeatures[i]
      if (!gableFacades.includes(set.facade)) continue
      const asset = analysed.find((x) => x.asset.id === set.assetId)
      const measurement = elevationMeasurements.get(set.assetId)
      if (!asset || !measurement) continue
      facadeFeatures[i] = solveFacadeFeatures({
        facade: set.facade,
        assetId: set.assetId,
        gray: asset.raster.gray,
        gradients: asset.raster.gradients,
        silhouette: measurement.silhouette,
        publishedHeightM: publishedHeight,
        eaveHeightM: provisionalEave,
        roofPitchDeg: tech.roofPitchDeg,
      })
    }
  }

  const { scaffold, contradictions } = assembleScaffold({
    publishedFootprintAreaM2: publishedArea,
    publishedBuildingHeightM: publishedHeight,
    publishedRoofPitchDeg: tech.roofPitchDeg,
    publishedKneeWallM: tech.kneeWallM,
    publishedRoofFamily: tech.roofFamily,
    section: sectionAnalysis,
    sectionWidthM,
    sectionSpansM,
    gableSpanM,
    wallThicknessesM,
    plans,
    elevations,
    footprint: footprintFit?.polygon ?? null,
  })

  for (const c of contradictions) {
    graph.relate('contradicts', `${c.key}:${c.a.source}`, `${c.key}:${c.b.source}`, c.deltaAbs, c.description)
  }

  // --- metric audit -----------------------------------------------------
  const auditInputs: AuditInput[] = [
    {
      key: 'building_width',
      label: 'overall building width',
      unit: 'm',
      toleranceAbs: 0.35,
      candidates: [
        { source: 'plan wall extent fitted to the published footprint area', value: scaffold.widthM, provenance: 'SOURCE_DERIVED', confidence: 0.8 },
        { source: 'section cut between outermost wall faces', value: sectionWidthM, provenance: 'GEOMETRIC_INFERRED', confidence: 0.75 },
        { source: 'plan dimension chain', value: planChainWidthM, provenance: 'GEOMETRIC_INFERRED', confidence: 0.7 },
      ],
    },
    {
      key: 'building_depth',
      label: 'overall building depth',
      unit: 'm',
      toleranceAbs: 0.35,
      candidates: [
        { source: 'plan wall extent fitted to the published footprint area', value: scaffold.depthM, provenance: 'SOURCE_DERIVED', confidence: 0.78 },
        { source: 'plan dimension chain', value: planChainDepthM, provenance: 'GEOMETRIC_INFERRED', confidence: 0.7 },
      ],
    },
    {
      key: 'footprint_area',
      label: 'footprint area',
      unit: 'm2',
      toleranceAbs: 1.5,
      candidates: [
        { source: 'published project data', value: publishedArea, provenance: 'SOURCE_EXACT', confidence: 0.98 },
        { source: 'fitted footprint polygon', value: scaffold.footprintAreaM2, provenance: 'GEOMETRIC_INFERRED', confidence: 0.7 },
      ],
    },
    {
      key: 'building_height',
      label: 'building height above terrain',
      unit: 'm',
      toleranceAbs: 0.2,
      candidates: [
        { source: 'published project data', value: publishedHeight, provenance: 'SOURCE_EXACT', confidence: 0.98 },
        {
          source: 'section ridge above terrain',
          value: sectionAnalysis ? (levelValue(sectionAnalysis.levels, 'RIDGE') ?? 0) - (levelValue(sectionAnalysis.levels, 'PLINTH') ?? 0) : null,
          provenance: 'GEOMETRIC_INFERRED',
          confidence: 0.75,
        },
      ],
    },
    {
      key: 'ridge_level',
      label: 'ridge above finished floor',
      unit: 'm',
      toleranceAbs: 0.2,
      candidates: [
        { source: 'section', value: sectionAnalysis ? levelValue(sectionAnalysis.levels, 'RIDGE') : null, provenance: 'GEOMETRIC_INFERRED', confidence: 0.8 },
        { source: 'elevation silhouette apex', value: elevations[0]?.ridgeY ?? null, provenance: 'VISUAL_INFERRED', confidence: 0.4 },
      ],
    },
    {
      key: 'eave_level',
      label: 'eave above finished floor',
      unit: 'm',
      toleranceAbs: 0.25,
      candidates: [
        { source: 'gable geometry from the section ridge, span and published pitch', value: scaffold.eaveY, provenance: 'GEOMETRIC_INFERRED', confidence: 0.75 },
        {
          source: 'elevation band at eave level',
          value: facadeFeatures.flatMap((f) => f.bands).filter((b) => Math.abs(b.t - scaffold.eaveY) < 0.6).map((b) => b.t)[0] ?? null,
          provenance: 'VISUAL_INFERRED',
          confidence: 0.5,
        },
      ],
    },
    {
      key: 'upper_floor_level',
      label: 'upper floor level',
      unit: 'm',
      toleranceAbs: 0.2,
      candidates: [
        {
          source: 'section slab line',
          value: sectionAnalysis ? sectionAnalysis.levels.filter((l) => l.kind === 'SLAB' && l.y > 1.5).sort((a, b) => b.y - a.y)[0]?.y ?? null : null,
          provenance: 'GEOMETRIC_INFERRED',
          confidence: 0.78,
        },
      ],
    },
    {
      key: 'roof_pitch',
      label: 'main roof pitch',
      unit: 'deg',
      toleranceAbs: 2,
      candidates: [
        { source: 'published technology note', value: tech.roofPitchDeg, provenance: 'SOURCE_EXACT', confidence: 0.95 },
        { source: 'section roof slope segments', value: sectionGeometry?.pitchDeg ?? null, provenance: 'GEOMETRIC_INFERRED', confidence: 0.8 },
      ],
    },
    {
      key: 'knee_wall',
      label: 'knee wall height',
      unit: 'm',
      toleranceAbs: 0.1,
      candidates: [{ source: 'published technology note', value: tech.kneeWallM, provenance: 'SOURCE_EXACT', confidence: 0.95 }],
    },
    {
      key: 'wall_thickness',
      label: 'exterior wall thickness',
      unit: 'm',
      toleranceAbs: 0.08,
      candidates: [
        { source: 'section wall face pairs', value: scaffold.wallThicknessM, provenance: 'GEOMETRIC_INFERRED', confidence: 0.7 },
        {
          source: 'published wall build-up',
          value: parseWallBuildUp(pkg.notes['ściany'] ?? pkg.notes['sciany'] ?? ''),
          provenance: 'SOURCE_EXACT',
          confidence: 0.9,
        },
      ],
    },
    {
      key: 'gable_span',
      label: 'span covered by the pitched roof',
      unit: 'm',
      toleranceAbs: 0.3,
      candidates: [
        { source: 'section wall faces symmetric about the ridge', value: gableSpanM, provenance: 'GEOMETRIC_INFERRED', confidence: 0.8 },
      ],
    },
    {
      key: 'garage_area',
      label: 'garage floor area',
      unit: 'm2',
      toleranceAbs: 2,
      candidates: [{ source: 'published room table', value: factValue(pkg, 'garage_area'), provenance: 'SOURCE_EXACT', confidence: 0.98 }],
    },
    {
      key: 'ground_rooms',
      label: 'ground floor room count',
      unit: 'count',
      toleranceAbs: 0,
      candidates: [
        { source: 'published room table', value: pkg.rooms.filter((r) => r.storey === 'GROUND').length || null, provenance: 'SOURCE_EXACT', confidence: 0.98 },
      ],
    },
    {
      key: 'upper_rooms',
      label: 'upper floor room count',
      unit: 'count',
      toleranceAbs: 0,
      candidates: [
        { source: 'published room table', value: pkg.rooms.filter((r) => r.storey === 'UPPER').length || null, provenance: 'SOURCE_EXACT', confidence: 0.98 },
      ],
    },
  ]

  const audit = buildAudit(auditInputs)

  return {
    scaffold,
    contradictions,
    sectionGeometry,
    footprintFit,
    elevationMeasurements,
    facadeFeatures,
    gableFacades,
    dimensionReadings,
    audit,
    notes,
  }
}

const levelValue = (levels: readonly { kind: string; y: number }[], kind: string): number | null => {
  const found = levels.filter((l) => l.kind === kind)
  return found.length > 0 ? found[0].y : null
}

/** Sum the thicknesses printed in a wall build-up note, e.g. "25 cm ... 20 cm". */
export function parseWallBuildUp(note: string): number | null {
  const matches = [...note.matchAll(/(\d+(?:[.,]\d+)?)\s*cm/gi)].map((m) => Number(m[1].replace(',', '.')))
  if (matches.length === 0) return null
  const total = matches.reduce((s2, x) => s2 + x, 0) / 100
  return total > 0.1 && total < 1.2 ? total : null
}

export const projectionSummary = (analysed: readonly AnalysedAsset[]): Record<ProjectionType, number> => {
  const out = {
    ORTHOGRAPHIC_TECHNICAL: 0,
    PERSPECTIVE_PINHOLE: 0,
    PERSPECTIVE_SHIFTED: 0,
    PLANAR_DIAGRAM: 0,
    UNKNOWN: 0,
  }
  for (const a of analysed) out[a.projection.type]++
  return out
}

// ---------------------------------------------------------------------------
// Camera stage
// ---------------------------------------------------------------------------


export type ViewCameras = {
  assetId: string
  role: string
  /** Pose parameters of each hypothesis, kept so a repair can re-fit from them. */
  poses: PoseParams[]
  hypotheses: CameraHypothesis[]
  /** Full structural score of the best hypothesis, used for re-ranking. */
  scores: ViewScoreBreakdown[]
  ambiguity: AmbiguityReport
  features: RenderFeatures
  anchors: AnchorDerivation
  evaluations: number
  elapsedMs: number
  notes: string[]
}

export type CameraStageOptions = {
  pose: PoseSearchOptions
  confidence: ConfidenceThresholds
  /** Resolution of the render used for anchor visibility tests. */
  visibilitySize: number
}

export const DEFAULT_CAMERA_STAGE: CameraStageOptions = {
  pose: DEFAULT_POSE_SEARCH,
  confidence: DEFAULT_CONFIDENCE,
  visibilitySize: 256,
}

/**
 * Fit cameras for every perspective view against one shared building (§26).
 *
 * Each render gets its own camera; they are never averaged into a single pose,
 * because the whole point of the multi-view architecture is that independent
 * cameras have to agree about one geometry rather than the geometry being bent
 * to suit one camera.
 */
export function fitCameras(
  analysed: readonly AnalysedAsset[],
  tess: Tessellation,
  graph: EvidenceGraph,
  opts: CameraStageOptions = DEFAULT_CAMERA_STAGE,
  /** Previous poses per asset, to re-fit from during the repair loop (§27). */
  seeds?: Map<string, PoseParams[]>,
): ViewCameras[] {
  const bounds = worldBounds(tess)
  const scene = { centre: bounds.centre, radius: bounds.radius }
  const out: ViewCameras[] = []

  for (const a of analysed) {
    if (a.projection.type !== 'PERSPECTIVE_PINHOLE' && a.projection.type !== 'PERSPECTIVE_SHIFTED') continue
    const started = Date.now()
    const notes: string[] = []
    const raster = a.raster
    const features = extractRenderFeatures(raster.gray, raster.building.mask, raster.segments, a.asset.id)

    const search = searchCameras(
      tess.tris,
      raster.building.mask,
      scene,
      raster.image.width,
      raster.image.height,
      opts.pose,
      null,
      seeds?.get(a.asset.id) ?? [],
    )
    notes.push(...search.notes, ...features.notes)

    const ambiguity = detectAmbiguity(search.candidates, a.asset.id)
    notes.push(...ambiguity.notes)

    type Scored = {
      hypothesis: CameraHypothesis
      derived: AnchorDerivation
      score: ViewScoreBreakdown
      reasons: string[]
    }
    const scored: Scored[] = []
    const poses: PoseParams[] = []

    for (const [rank, candidate] of search.candidates.entries()) {
      const view = viewFromParams(candidate.params, scene, raster.image.width, raster.image.height)
      const visH = Math.max(8, Math.round((opts.visibilitySize * raster.image.height) / raster.image.width))
      const target = renderPerspective(tess.tris, view, opts.visibilitySize, visH)
      const derived = deriveAnchors(tess.anchors, features.features, view, target, 1)

      const verdict = classifyCamera(
        {
          cost: candidate.cost,
          iou: candidate.iou,
          anchorMatches: derived.matches.length,
          meanAnchorResidualPx: derived.meanResidualPx,
          ambiguity,
          hasVanishingConstraint: a.projection.geometry.horizontalConverges,
        },
        opts.confidence,
      )

      const hypothesis = toCameraHypothesis(
        candidate,
        scene,
        a.asset.id,
        a.projection.type,
        raster.image.width,
        raster.image.height,
        rank,
      )
      hypothesis.anchorMatches = derived.matches
      hypothesis.confidenceClass = verdict.klass
      hypothesis.visibilityScore = derived.matches.length + derived.unmatchedVisible.length > 0
        ? derived.matches.length / (derived.matches.length + derived.unmatchedVisible.length)
        : 0
      if (ambiguity.groupId && ambiguity.memberIndices.includes(rank)) hypothesis.ambiguityGroup = ambiguity.groupId

      // The silhouette descriptor drives refinement because it is smooth, but
      // it cannot tell a gable end seen from the front from the same gable seen
      // from the back. Ranking uses the full structural score, where the
      // openings, the garage wing and the edge map do separate them.
      poses.push(candidate.params)
      const score = scoreView({
        assetId: a.asset.id,
        camera: hypothesis,
        view,
        tess,
        sourceMask: raster.building.mask,
        sourceEdges: raster.buildingEdges,
        features,
        scoreSize: opts.pose.scoreSize,
      })
      hypothesis.edgeScore = score.edge
      scored.push({ hypothesis, derived, score, reasons: verdict.reasons })
    }

    scored.sort((x, y) => x.score.total - y.score.total)
    const hypotheses = scored.map((x, rank) => ({ ...x.hypothesis, id: `cam_${a.asset.id}_${rank}`, rank }))
    const bestAnchors = scored[0]?.derived ?? { matches: [], unmatchedVisible: [], notVisible: [], meanResidualPx: null }
    if (scored[0]) notes.push(...scored[0].reasons)

    for (const [rank, h] of hypotheses.entries()) {
      graph.add({
        id: h.id,
        type: 'CameraHypothesis',
        sourceAssetId: a.asset.id,
        authority: 'RENDER_INFERRED',
        confidence: viewWeightFor(h.confidenceClass),
        payload: {
          rank,
          confidenceClass: h.confidenceClass,
          silhouette: h.silhouetteScore,
          edge: h.edgeScore,
          anchorMatches: h.anchorMatches.length,
          ambiguous: ambiguity.ambiguous,
          viewScore: scored[rank].score.total,
        },
      })
      graph.relate('projectsTo', h.id, a.asset.id, viewWeightFor(h.confidenceClass))
    }

    out.push({
      assetId: a.asset.id,
      role: a.asset.role,
      poses: scored.map((_, i) => poses[i]),
      hypotheses,
      scores: scored.map((x) => x.score),
      ambiguity,
      features,
      anchors: bestAnchors,
      evaluations: search.evaluations,
      elapsedMs: Date.now() - started,
      notes,
    })
  }
  return out
}
