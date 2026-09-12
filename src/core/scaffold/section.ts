/**
 * Building section analysis (§17).
 *
 * The section is the single most informative source on this page. It is a real
 * line drawing rather than a render, and it fixes the entire vertical structure
 * — terrain, floor levels, slabs, knee wall, eaves, ridge — plus the roof pitch
 * and, because it is a cut across the building, the plan widths of the masses
 * it passes through.
 *
 * Everything here is geometric. §17 says to use geometry even where the printed
 * dimension text is too small to read reliably, and that is the right call: the
 * annotations on a 400px-wide section are a few pixels tall, while the lines
 * themselves are unambiguous. The one published number this needs is the
 * building height, which sets absolute scale; the rest is proportion.
 *
 * PORT_DIRECT (Kotlin).
 */
import type { LevelObservation, SectionAnalysis } from '../contracts/scaffold.js'
import type { Segment } from '../raster/lines.js'
import { mkId } from '../util/ids.js'
import { cluster1D, significantClusters, type Cluster1D } from './cluster.js'

export type SectionGeometry = {
  /** Ridge apex in image pixels. */
  apex: { u: number; v: number } | null
  /** Roof pitch in degrees, measured from the two slope segments. */
  pitchDeg: number | null
  /** Horizontal level lines, strongest first. */
  levels: Cluster1D[]
  /** Vertical wall faces, left to right. */
  walls: Cluster1D[]
  /** Terrain datum row. */
  terrainRow: number | null
  /** Finished ground-floor row (the ±0.00 datum). */
  groundFloorRow: number | null
  /** Pixels per metre, once the published height has been applied. */
  pixelsPerMetre: number | null
  notes: string[]
}

const midY = (s: Segment): number => (s.y1 + s.y2) / 2
const midX = (s: Segment): number => (s.x1 + s.x2) / 2

/**
 * The two slope segments meeting at the ridge. Selected as the longest pair of
 * oblique segments with opposite slope signs whose upper endpoints nearly
 * coincide — that coincidence is what makes them a ridge rather than two
 * unrelated diagonals.
 */
export function findRidge(
  segments: readonly Segment[],
  imageWidth: number,
): { apex: { u: number; v: number }; pitchDeg: number; left: Segment; right: Segment } | null {
  const oblique = segments
    .filter((s) => {
      const d = (Math.abs(s.angle) * 180) / Math.PI
      return (d > 12 && d < 78) || (d > 102 && d < 168)
    })
    .filter((s) => s.length > imageWidth * 0.06)
    .sort((a, b) => b.length - a.length)
    .slice(0, 40)

  const topOf = (s: Segment): { u: number; v: number } => (s.y1 <= s.y2 ? { u: s.x1, v: s.y1 } : { u: s.x2, v: s.y2 })
  const slopeSign = (s: Segment): number => {
    const top = topOf(s)
    const bottom = s.y1 <= s.y2 ? { u: s.x2, v: s.y2 } : { u: s.x1, v: s.y1 }
    return Math.sign(bottom.u - top.u)
  }

  let best: { apex: { u: number; v: number }; pitchDeg: number; left: Segment; right: Segment; score: number } | null = null
  const tolerance = Math.max(4, imageWidth * 0.02)
  for (let i = 0; i < oblique.length; i++) {
    for (let j = i + 1; j < oblique.length; j++) {
      const a = oblique[i]
      const b = oblique[j]
      if (slopeSign(a) === slopeSign(b)) continue
      const ta = topOf(a)
      const tb = topOf(b)
      if (Math.hypot(ta.u - tb.u, ta.v - tb.v) > tolerance) continue
      const pitchA = (Math.atan2(Math.abs(a.y2 - a.y1), Math.abs(a.x2 - a.x1)) * 180) / Math.PI
      const pitchB = (Math.atan2(Math.abs(b.y2 - b.y1), Math.abs(b.x2 - b.x1)) * 180) / Math.PI
      // A real gable is symmetric; a large disagreement means these are not the
      // two halves of one roof.
      if (Math.abs(pitchA - pitchB) > 6) continue
      const score = a.length + b.length
      if (best && score <= best.score) continue
      const left = ta.u <= tb.u ? a : b
      const right = ta.u <= tb.u ? b : a
      best = {
        apex: { u: (ta.u + tb.u) / 2, v: (ta.v + tb.v) / 2 },
        pitchDeg: (pitchA + pitchB) / 2,
        left,
        right,
        score,
      }
    }
  }
  return best ? { apex: best.apex, pitchDeg: best.pitchDeg, left: best.left, right: best.right } : null
}

export function analyseSectionGeometry(
  segments: readonly Segment[],
  width: number,
  height: number,
  publishedHeightM: number | null,
): SectionGeometry {
  const notes: string[] = []
  const minLen = width * 0.1
  const horizontals = segments.filter((s) => Math.abs(Math.sin(s.angle)) < 0.06 && s.length >= minLen)
  const verticals = segments.filter((s) => Math.abs(Math.cos(s.angle)) < 0.06 && s.length >= height * 0.1)

  const levels = significantClusters(
    cluster1D(horizontals.map((s) => ({ position: midY(s), weight: s.length })), Math.max(2, height * 0.012)),
    0.08,
  ).sort((a, b) => b.weight - a.weight)

  const walls = cluster1D(
    verticals.map((s) => ({ position: midX(s), weight: s.length })),
    Math.max(2, width * 0.008),
  )
    .filter((c) => c.weight >= 40)
    .sort((a, b) => a.position - b.position)

  const ridge = findRidge(segments, width)
  if (!ridge) notes.push('no ridge found: the section may show a flat or mono-pitch roof')

  // Terrain is the lowest strong level line; the finished floor is the next
  // level above it, which is how a section is always drawn.
  const byRow = [...levels].sort((a, b) => b.position - a.position)
  const terrainRow = byRow.length > 0 ? byRow[0].position : null
  let groundFloorRow: number | null = null
  if (terrainRow !== null) {
    const above = byRow.find((c) => c.position < terrainRow - height * 0.01)
    groundFloorRow = above ? above.position : terrainRow
  }

  let pixelsPerMetre: number | null = null
  if (ridge && terrainRow !== null && publishedHeightM && publishedHeightM > 0) {
    pixelsPerMetre = (terrainRow - ridge.apex.v) / publishedHeightM
    if (pixelsPerMetre <= 0) {
      pixelsPerMetre = null
      notes.push('ridge lies below the terrain datum; section calibration rejected')
    }
  } else if (!publishedHeightM) {
    notes.push('no published building height: the section gives proportions only')
  }

  return {
    apex: ridge?.apex ?? null,
    pitchDeg: ridge?.pitchDeg ?? null,
    levels,
    walls,
    terrainRow,
    groundFloorRow,
    pixelsPerMetre,
    notes,
  }
}

/**
 * Turn the section geometry into metric level observations, measured from the
 * finished ground floor (the ±0.00 datum every other source is quoted against).
 */
export function sectionLevels(geom: SectionGeometry, assetId: string): LevelObservation[] {
  if (geom.pixelsPerMetre === null || geom.groundFloorRow === null) return []
  const s = geom.pixelsPerMetre
  const datum = geom.groundFloorRow
  const toMetres = (row: number): number => (datum - row) / s

  const out: LevelObservation[] = []
  const push = (kind: LevelObservation['kind'], y: number, confidence: number): void => {
    out.push({
      id: mkId('level', assetId, kind, y.toFixed(3)),
      kind,
      y,
      authority: 'SECTION_MEASURED',
      confidence,
      sourceAssetId: assetId,
    })
  }

  push('GROUND_FLOOR', 0, 0.9)
  if (geom.terrainRow !== null) push('PLINTH', toMetres(geom.terrainRow), 0.8)
  if (geom.apex) push('RIDGE', toMetres(geom.apex.v), 0.9)

  // Intermediate levels: everything strictly between the floor and the ridge.
  const ridgeY = geom.apex ? toMetres(geom.apex.v) : Number.POSITIVE_INFINITY
  const candidates = geom.levels
    .map((c) => ({ y: toMetres(c.position), weight: c.weight }))
    .filter((c) => c.y > 0.4 && c.y < ridgeY - 0.4)
    .sort((a, b) => a.y - b.y)

  // The upper floor slab is the strongest intermediate pair: a ceiling line and
  // a floor line a slab thickness apart.
  for (const c of candidates) {
    const kind: LevelObservation['kind'] = c.y < 3.6 ? 'SLAB' : 'EAVE'
    push(kind, c.y, 0.6)
  }
  return out
}

export function buildSectionAnalysis(
  assetId: string,
  geom: SectionGeometry,
  publishedPitchDeg: number | null,
  publishedKneeWallM: number | null,
): SectionAnalysis {
  const levels = sectionLevels(geom, assetId)
  const notes = [...geom.notes]
  let confidence = 0.2
  if (geom.pixelsPerMetre !== null) confidence += 0.4
  if (geom.apex) confidence += 0.2
  if (levels.length >= 3) confidence += 0.15

  if (geom.pitchDeg !== null && publishedPitchDeg !== null) {
    const delta = Math.abs(geom.pitchDeg - publishedPitchDeg)
    if (delta <= 2) {
      notes.push(`measured pitch ${geom.pitchDeg.toFixed(1)}° agrees with the published ${publishedPitchDeg}°`)
      confidence = Math.min(0.95, confidence + 0.05)
    } else {
      notes.push(`measured pitch ${geom.pitchDeg.toFixed(1)}° disagrees with the published ${publishedPitchDeg}°`)
      confidence *= 0.8
    }
  }

  return {
    assetId,
    levels,
    roofPitchDeg: publishedPitchDeg ?? geom.pitchDeg,
    kneeWallM: publishedKneeWallM,
    confidence: Math.min(0.95, confidence),
    notes,
  }
}

/**
 * Mass widths along the section cut, from the outermost wall faces inwards.
 * Wall faces come in pairs (outer and inner face of one wall), so the metric
 * extent of a mass is the distance between outermost faces.
 */
export function sectionMassWidths(geom: SectionGeometry): { totalM: number; spansM: number[] } | null {
  if (geom.pixelsPerMetre === null || geom.walls.length < 2) return null
  const s = geom.pixelsPerMetre
  const positions = geom.walls.map((w) => w.position)
  const totalM = (positions[positions.length - 1] - positions[0]) / s
  const spansM: number[] = []
  for (let i = 1; i < positions.length; i++) spansM.push((positions[i] - positions[i - 1]) / s)
  return { totalM, spansM }
}

/**
 * Span of the gable, from the pair of wall faces the ridge sits midway between.
 *
 * A pitched roof is symmetric about its ridge, so in a section cut across the
 * gable the two walls carrying it are mirror images about the apex. Searching
 * for that symmetry identifies them without having to reason about which of the
 * detected faces are interior partitions — the consecutive gaps between faces
 * give interior room widths, never the span the roof actually covers, which is
 * what the eave height depends on.
 */
export function gableSpanFromSection(geom: SectionGeometry): {
  spanM: number
  leftPx: number
  rightPx: number
  symmetryErrorPx: number
} | null {
  if (!geom.apex || geom.pixelsPerMetre === null || geom.walls.length < 2) return null
  const apex = geom.apex.u
  const faces = geom.walls.map((w) => w.position)
  let best: { left: number; right: number; error: number; span: number } | null = null
  for (let i = 0; i < faces.length; i++) {
    for (let j = i + 1; j < faces.length; j++) {
      const left = faces[i]
      const right = faces[j]
      if (right <= left) continue
      const centre = (left + right) / 2
      const span = right - left
      const error = Math.abs(centre - apex)
      // Symmetry has to be good relative to the span itself, and the span must
      // actually straddle the apex.
      if (left > apex || right < apex) continue
      if (error > span * 0.08) continue
      if (!best || span > best.span) best = { left, right, error, span }
    }
  }
  if (!best) return null
  return {
    spanM: best.span / geom.pixelsPerMetre,
    leftPx: best.left,
    rightPx: best.right,
    symmetryErrorPx: best.error,
  }
}
