/**
 * Metric scaffold assembly (§15).
 *
 * Recovers as much as possible from the metric sources *before* any camera is
 * fitted, because a camera can only be solved against 3D points that already
 * have real coordinates. The scaffold does not have to be the final building
 * (§15) — it has to be metric enough to fit cameras against.
 *
 * Each source is used for what it is actually good at, and nothing is averaged
 * across authority levels (§33, §36):
 *
 *   published facts   exact scalars — footprint area, building height, roof
 *                     pitch, knee wall. These set absolute scale and are never
 *                     overridden by an image measurement.
 *   section           the whole vertical structure and the plan widths of the
 *                     masses it cuts through, all as geometry rather than from
 *                     the unreadable dimension text.
 *   plan              the footprint's aspect and which corner is notched.
 *   elevations        facade widths and opening layout, contributed with low
 *                     weight because the published images put the building on
 *                     a photographic backdrop that the silhouette has to be
 *                     dug out of.
 *
 * Disagreements are recorded as contradictions rather than smoothed away.
 *
 * PORT_DIRECT (Kotlin).
 */
import type { LevelObservation, MetricScaffold, PlanAnalysis, SectionAnalysis, ElevationAnalysis } from '../contracts/scaffold.js'
import type { Polygon2D } from '../contracts/geometry.js'
import { boundsOf, polygonArea } from '../contracts/geometry.js'
import { mkId } from '../util/ids.js'

export type ScaffoldInputs = {
  publishedFootprintAreaM2: number | null
  publishedBuildingHeightM: number | null
  publishedRoofPitchDeg: number | null
  publishedKneeWallM: number | null
  publishedRoofFamily: string | null
  section: SectionAnalysis | null
  /** Section-measured total width along the cut, metres. */
  sectionWidthM: number | null
  /** Section-measured mass spans along the cut, metres. */
  sectionSpansM: number[]
  /** Span the pitched roof covers, from the section's ridge symmetry. */
  gableSpanM: number | null
  plans: PlanAnalysis[]
  elevations: ElevationAnalysis[]
  footprint: Polygon2D | null
}

export type ScaffoldContradiction = {
  key: string
  description: string
  a: { source: string; value: number }
  b: { source: string; value: number }
  deltaAbs: number
}

export type ScaffoldResult = {
  scaffold: MetricScaffold
  contradictions: ScaffoldContradiction[]
}

const pick = <T>(...values: (T | null | undefined)[]): T | null => {
  for (const v of values) if (v !== null && v !== undefined) return v
  return null
}

function levelOf(levels: readonly LevelObservation[], kind: LevelObservation['kind']): number | null {
  const matching = levels.filter((l) => l.kind === kind)
  if (matching.length === 0) return null
  return matching.reduce((best, l) => (l.confidence > best.confidence ? l : best)).y
}

/**
 * Eave height from the gable geometry: with a symmetric gable of known pitch
 * spanning the main body, the ridge sits half a span times the tangent above
 * the eaves. Deriving the eave this way rather than reading a level line is
 * deliberate — the eave is where the roof meets the wall, and a section draws
 * no long horizontal there, so there is nothing to detect.
 */
export function eaveFromGable(ridgeY: number, spanM: number, pitchDeg: number): number {
  return ridgeY - (spanM / 2) * Math.tan((pitchDeg * Math.PI) / 180)
}

export function assembleScaffold(inputs: ScaffoldInputs): ScaffoldResult {
  const notes: string[] = []
  const contradictions: ScaffoldContradiction[] = []
  const levels: LevelObservation[] = []

  const sectionLevels = inputs.section?.levels ?? []
  levels.push(...sectionLevels)

  const roofPitchDeg = pick(inputs.publishedRoofPitchDeg, inputs.section?.roofPitchDeg) ?? 0
  const kneeWallM = pick(inputs.publishedKneeWallM, inputs.section?.kneeWallM) ?? 0

  // Vertical structure, from the section where possible.
  const plinth = levelOf(sectionLevels, 'PLINTH')
  const ridgeFromSection = levelOf(sectionLevels, 'RIDGE')
  const heightM = inputs.publishedBuildingHeightM
  const ridgeY = pick(ridgeFromSection, heightM !== null && plinth !== null ? heightM + plinth : heightM)

  if (ridgeFromSection !== null && heightM !== null && plinth !== null) {
    const impliedHeight = ridgeFromSection - plinth
    if (Math.abs(impliedHeight - heightM) > 0.25) {
      contradictions.push({
        key: 'building_height',
        description: 'section-measured ridge above terrain disagrees with the published building height',
        a: { source: 'SECTION_MEASURED', value: impliedHeight },
        b: { source: 'PUBLISHED_EXACT', value: heightM },
        deltaAbs: Math.abs(impliedHeight - heightM),
      })
    }
  }

  // Footprint: the plan supplies the shape, already reconciled with the
  // published area by the plan stage.
  const footprint: Polygon2D = inputs.footprint ?? { outer: [], holes: [] }
  const bounds = footprint.outer.length > 0 ? boundsOf(footprint.outer) : { minX: 0, maxX: 0, minZ: 0, maxZ: 0 }
  const widthM = bounds.maxX - bounds.minX
  const depthM = bounds.maxZ - bounds.minZ
  const footprintAreaM2 = footprint.outer.length > 0 ? Math.abs(polygonArea(footprint.outer)) : 0

  if (inputs.publishedFootprintAreaM2 !== null && footprintAreaM2 > 0) {
    const delta = Math.abs(footprintAreaM2 - inputs.publishedFootprintAreaM2)
    if (delta > 1.0) {
      contradictions.push({
        key: 'footprint_area',
        description: 'fitted footprint area disagrees with the published figure',
        a: { source: 'PLAN_MEASURED', value: footprintAreaM2 },
        b: { source: 'PUBLISHED_EXACT', value: inputs.publishedFootprintAreaM2 },
        deltaAbs: delta,
      })
    }
  }

  if (inputs.sectionWidthM !== null && widthM > 0) {
    const delta = Math.abs(inputs.sectionWidthM - widthM)
    if (delta > Math.max(0.6, widthM * 0.06)) {
      contradictions.push({
        key: 'building_width',
        description: 'section cut width disagrees with the fitted footprint width',
        a: { source: 'SECTION_MEASURED', value: inputs.sectionWidthM },
        b: { source: 'PLAN_MEASURED', value: widthM },
        deltaAbs: delta,
      })
      notes.push('the section may not cut across the building’s full width')
    }
  }

  // The main gable spans the main body, which the section measures as its
  // largest interior span; fall back to the footprint width.
  const spans = [...inputs.sectionSpansM].sort((a, b) => b - a)
  const gableSpanM = inputs.gableSpanM ?? (spans.length > 0 ? spans[0] : widthM)
  if (inputs.gableSpanM === null) {
    notes.push('no ridge symmetry found in the section; the gable span falls back to the widest measured span')
  }
  let eaveY = ridgeY !== null && roofPitchDeg > 0 ? eaveFromGable(ridgeY, gableSpanM, roofPitchDeg) : null

  // Cross-check against the knee wall: the eave cannot sit below the top of the
  // knee wall, which stands on the upper floor.
  const upperFloor = sectionLevels
    .filter((l) => l.kind === 'SLAB' && l.y > 1.5)
    .sort((a, b) => b.y - a.y)[0]?.y ?? null
  if (eaveY !== null && upperFloor !== null && kneeWallM > 0) {
    const kneeTop = upperFloor + kneeWallM
    if (eaveY < kneeTop - 0.15) {
      notes.push(
        `eave derived from the gable (${eaveY.toFixed(2)} m) sits below the knee wall top ` +
          `(${kneeTop.toFixed(2)} m); raised to the knee wall`,
      )
      eaveY = kneeTop
    }
  }
  if (eaveY !== null) {
    levels.push({
      id: mkId('level', 'derived', 'eave', eaveY.toFixed(3)),
      kind: 'EAVE',
      y: eaveY,
      authority: 'SECTION_MEASURED',
      confidence: 0.7,
      ...(inputs.section ? { sourceAssetId: inputs.section.assetId } : {}),
    })
  }

  // Elevation cross-checks, contributed at low weight.
  for (const e of inputs.elevations) {
    if (e.widthM <= 0) continue
    const expected = e.facade === 'FRONT' || e.facade === 'REAR' ? widthM : depthM
    if (expected <= 0) continue
    const delta = Math.abs(e.widthM - expected)
    // A side elevation legitimately shows the gable overhang beyond the wall,
    // so the tolerance there is wider.
    const tolerance = Math.max(1.2, expected * 0.18)
    if (delta > tolerance) {
      contradictions.push({
        key: `elevation_width_${e.facade}`,
        description: `${e.facade} elevation silhouette width disagrees with the footprint`,
        a: { source: 'ELEVATION_MEASURED', value: e.widthM },
        b: { source: 'PLAN_MEASURED', value: expected },
        deltaAbs: delta,
      })
    }
  }

  let confidence = 0.2
  if (inputs.section && inputs.section.confidence > 0.5) confidence += 0.3
  if (footprintAreaM2 > 0) confidence += 0.2
  if (ridgeY !== null) confidence += 0.15
  if (roofPitchDeg > 0) confidence += 0.1
  confidence -= Math.min(0.3, contradictions.length * 0.08)

  const scaffold: MetricScaffold = {
    footprint,
    footprintAreaM2,
    widthM,
    depthM,
    levels,
    roofPitchDeg,
    kneeWallM,
    ridgeY: ridgeY ?? 0,
    eaveY: eaveY ?? 0,
    buildingHeightM: heightM ?? ridgeY ?? 0,
    plans: inputs.plans,
    section: inputs.section,
    elevations: inputs.elevations,
    confidence: Math.max(0.05, Math.min(0.95, confidence)),
    notes,
  }
  return { scaffold, contradictions }
}
