/**
 * Structural feature extraction from architectural renders (§19).
 *
 * Only robust structural evidence is taken: the building mask, its skyline, the
 * high-curvature corners of its outline, long straight edges, and compact dark
 * regions that behave like openings. Decorative background is already excluded
 * upstream, because segments are detected inside the building mask rather than
 * across the whole frame.
 *
 * Nothing here decides geometry. These are 2D observations that a camera
 * hypothesis is later asked to explain (§29: detectors do not mutate geometry).
 *
 * PORT_DIRECT (Kotlin).
 */
import type { GrayImage, MaskImage } from '../contracts/raster.js'
import type { Segment } from '../raster/lines.js'
import { maskBounds, skylineProfile } from '../raster/mask.js'
import { findDarkOpenings, type OpeningBox } from './elevation.js'

export type Feature2D = {
  id: string
  kind: 'OUTLINE_CORNER' | 'SKYLINE_PEAK' | 'SKYLINE_STEP' | 'SEGMENT_END' | 'OPENING_CENTROID' | 'OPENING_CORNER'
  u: number
  v: number
  /** Relative strength, used to weight anchor matches. */
  strength: number
}

export type RenderFeatures = {
  features: Feature2D[]
  skyline: Int32Array
  openings: OpeningBox[]
  /** Longest structural segments, for roofline and facade-direction evidence. */
  segments: Segment[]
  notes: string[]
}

/**
 * Corners of the silhouette outline, by turning angle along the boundary.
 *
 * The outline is walked as the skyline plus the two side profiles rather than
 * by full contour tracing: for a building photographed from outside, the parts
 * a camera solver cares about — ridge, eaves, mass steps, gable apex — all lie
 * on the upper profile, and that profile is far more stable than a traced
 * contour through foreground planting at the foot of the image.
 */
export function skylineCorners(skyline: Int32Array, minGap: number, angleThresholdDeg = 22): Feature2D[] {
  const out: Feature2D[] = []
  const xs: number[] = []
  for (let x = 0; x < skyline.length; x++) if (skyline[x] >= 0) xs.push(x)
  if (xs.length < 3 * minGap) return out

  const span = Math.max(3, Math.round(minGap))
  const threshold = (angleThresholdDeg * Math.PI) / 180
  for (let i = span; i < xs.length - span; i++) {
    const x = xs[i]
    const xa = xs[i - span]
    const xb = xs[i + span]
    const ya = skyline[xa]
    const yb = skyline[xb]
    const y = skyline[x]
    if (ya < 0 || yb < 0 || y < 0) continue
    const a1 = Math.atan2(y - ya, x - xa)
    const a2 = Math.atan2(yb - y, xb - x)
    let d = Math.abs(a2 - a1)
    if (d > Math.PI) d = 2 * Math.PI - d
    if (d < threshold) continue
    // Keep the locally strongest corner only.
    const last = out[out.length - 1]
    if (last && Math.abs(last.u - x) < span) {
      if (d > last.strength) out[out.length - 1] = { ...last, u: x, v: y, strength: d }
      continue
    }
    out.push({ id: `sk_${x}`, kind: 'SKYLINE_STEP', u: x, v: y, strength: d })
  }
  return out
}

export function extractRenderFeatures(
  gray: GrayImage,
  buildingMask: MaskImage,
  segments: readonly Segment[],
  assetId: string,
): RenderFeatures {
  const notes: string[] = []
  const bounds = maskBounds(buildingMask)
  if (bounds.empty) {
    return { features: [], skyline: new Int32Array(0), openings: [], segments: [], notes: ['empty building mask'] }
  }
  const skyline = skylineProfile(buildingMask)
  const widthPx = bounds.maxX - bounds.minX + 1
  const features: Feature2D[] = []

  // Apex: the highest point of the skyline.
  let apexX = bounds.minX
  let apexY = Number.POSITIVE_INFINITY
  for (let x = bounds.minX; x <= bounds.maxX; x++) {
    const y = skyline[x]
    if (y >= 0 && y < apexY) {
      apexY = y
      apexX = x
    }
  }
  if (Number.isFinite(apexY)) {
    features.push({ id: `${assetId}_apex`, kind: 'SKYLINE_PEAK', u: apexX, v: apexY, strength: 1 })
  }

  const corners = skylineCorners(skyline, Math.max(4, widthPx * 0.03))
  for (const c of corners) features.push({ ...c, id: `${assetId}_${c.id}` })

  // Outline extremes: the silhouette's left and right feet are stable mass
  // corners wherever the ground line is clean.
  const leftY = skyline[bounds.minX]
  const rightY = skyline[bounds.maxX]
  if (leftY >= 0) features.push({ id: `${assetId}_left`, kind: 'OUTLINE_CORNER', u: bounds.minX, v: leftY, strength: 0.8 })
  if (rightY >= 0) features.push({ id: `${assetId}_right`, kind: 'OUTLINE_CORNER', u: bounds.maxX, v: rightY, strength: 0.8 })

  // Endpoints of the longest structural segments.
  const longest = [...segments].sort((a, b) => b.length - a.length).slice(0, 24)
  for (const [i, s] of longest.entries()) {
    const strength = Math.min(1, s.length / Math.max(1, widthPx))
    features.push({ id: `${assetId}_seg${i}a`, kind: 'SEGMENT_END', u: s.x1, v: s.y1, strength })
    features.push({ id: `${assetId}_seg${i}b`, kind: 'SEGMENT_END', u: s.x2, v: s.y2, strength })
  }

  // Openings: compact dark regions on the building.
  const area = (bounds.maxX - bounds.minX + 1) * (bounds.maxY - bounds.minY + 1)
  const openings = findDarkOpenings(gray, buildingMask, Math.max(30, area * 0.0015), area * 0.3)
  for (const [i, o] of openings.entries()) {
    features.push({
      id: `${assetId}_op${i}`,
      kind: 'OPENING_CENTROID',
      u: (o.minX + o.maxX) / 2,
      v: (o.minY + o.maxY) / 2,
      strength: Math.min(1, o.rectangularity),
    })
    features.push({ id: `${assetId}_op${i}c0`, kind: 'OPENING_CORNER', u: o.minX, v: o.minY, strength: 0.5 })
    features.push({ id: `${assetId}_op${i}c1`, kind: 'OPENING_CORNER', u: o.maxX, v: o.maxY, strength: 0.5 })
  }

  if (features.length < 6) notes.push('few structural features recovered; anchor support will be thin')
  features.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return { features, skyline, openings, segments: longest, notes }
}
