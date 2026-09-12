/**
 * Pipeline stages up to the metric scaffold.
 *
 * Portable: the pipeline takes decoded images as plain DTOs, so the same code
 * runs in Node, in a Web Worker and on the JVM. Fetching and decoding are host
 * concerns that happen before this point.
 */
import type { RasterImage } from '../contracts/raster.js'
import type { SourceAsset, SourcePackage } from '../contracts/source.js'
import { factValue } from '../contracts/source.js'
import type { ProjectionType } from '../contracts/camera.js'
import type { MetricScaffold, ElevationAnalysis, PlanAnalysis } from '../contracts/scaffold.js'
import { prepareAsset, type AssetRaster } from '../raster/pipeline.js'
import { toGray, saturationField } from '../raster/gray.js'
import { classifyProjection, type ProjectionClassification } from '../projection/classifier.js'
import { parseTechnology } from '../source/facts.js'
import { analyseSectionGeometry, buildSectionAnalysis, gableSpanFromSection, sectionMassWidths, type SectionGeometry } from '../scaffold/section.js'
import { wallMask, planExtent, fitFootprint, buildPlanAnalysis, type FootprintFit } from '../scaffold/plan.js'
import { analyseElevation, type ElevationMeasurement } from '../scaffold/elevation.js'
import { assembleScaffold, type ScaffoldContradiction } from '../scaffold/metric.js'
import { EvidenceGraph } from '../evidence/graph.js'

export type AnalysedAsset = {
  asset: SourceAsset
  raster: AssetRaster
  projection: ProjectionClassification
}

const LINE_DRAWING_ROLES = new Set(['PLAN_GROUND', 'PLAN_UPPER', 'PLAN_OTHER', 'SITE_PLAN', 'SECTION'])

export function analyseAssets(pkg: SourcePackage, images: Map<string, RasterImage>): AnalysedAsset[] {
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
  notes: string[]
}

export function buildMetricScaffold(
  pkg: SourcePackage,
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
  let footprintFit: FootprintFit | null = null
  const groundPlan = analysed.find((a) => a.asset.role === 'PLAN_GROUND')
  if (groundPlan) {
    const image = images.get(groundPlan.asset.id)
    if (image) {
      const walls = wallMask(toGray(image), saturationField(image))
      const extent = planExtent(walls)
      footprintFit = fitFootprint(extent, publishedArea, sectionWidthM)
      const analysis = buildPlanAnalysis(groundPlan.asset.id, 'GROUND', extent, footprintFit)
      plans.push(analysis)
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
    plans,
    elevations,
    footprint: footprintFit?.polygon ?? null,
  })

  for (const c of contradictions) {
    graph.relate('contradicts', `${c.key}:${c.a.source}`, `${c.key}:${c.b.source}`, c.deltaAbs, c.description)
  }

  return { scaffold, contradictions, sectionGeometry, footprintFit, elevationMeasurements, notes }
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
