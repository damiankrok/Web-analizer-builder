/**
 * Technical elevation analysis (§18).
 *
 * An elevation is an orthographic facade source, so once its vertical scale is
 * known every measurement on it is metric with no camera involved. That is what
 * makes elevations outrank perspective renders (§36): there is nothing to solve
 * before reading a dimension off one.
 *
 * The facade is conditioned first (see silhouette.ts) because the published
 * image also contains terrain, planting and a watermark. Openings are then
 * found as compact dark regions on the facade — ARCHON's elevations are
 * rendered, so glazing reads as a dark rectangle against render or cladding
 * rather than as a line-drawn symbol.
 *
 * PORT_DIRECT (Kotlin).
 */
import type { GrayImage, MaskImage, RasterImage } from '../contracts/raster.js'
import { makeMask } from '../contracts/raster.js'
import type { ElevationAnalysis, ElevationOpening } from '../contracts/scaffold.js'
import type { FacadeSide } from '../contracts/hypotheses.js'
import type { AssetRole } from '../contracts/source.js'
import { mkId } from '../util/ids.js'
import type { Gradients } from '../raster/filters.js'
import { cannyEdges } from '../raster/filters.js'
import { findOpeningRectangles, DEFAULT_OPENING_DETECT } from './openings.js'
import { cluster1D, significantClusters } from './cluster.js'
import { conditionSilhouette, facadeSkyline, type ConditionedSilhouette } from './silhouette.js'

export const facadeOf = (role: AssetRole): FacadeSide | null => {
  switch (role) {
    case 'ELEVATION_FRONT':
      return 'FRONT'
    case 'ELEVATION_REAR':
      return 'REAR'
    case 'ELEVATION_LEFT':
      return 'LEFT'
    case 'ELEVATION_RIGHT':
      return 'RIGHT'
    default:
      return null
  }
}

/** Otsu threshold over the pixels of a mask. */
export function otsuThreshold(gray: GrayImage, region: MaskImage): number {
  const hist = new Float64Array(256)
  let total = 0
  for (let i = 0; i < gray.data.length; i++) {
    if (!region.data[i]) continue
    hist[gray.data[i]]++
    total++
  }
  if (total === 0) return 128
  let sum = 0
  for (let t = 0; t < 256; t++) sum += t * hist[t]
  let sumB = 0
  let wB = 0
  let best = 0
  let bestVar = -1
  for (let t = 0; t < 256; t++) {
    wB += hist[t]
    if (wB === 0) continue
    const wF = total - wB
    if (wF === 0) break
    sumB += t * hist[t]
    const mB = sumB / wB
    const mF = (sum - sumB) / wF
    const between = wB * wF * (mB - mF) * (mB - mF)
    if (between > bestVar) {
      bestVar = between
      best = t
    }
  }
  return best
}

export type OpeningBox = {
  minX: number
  maxX: number
  minY: number
  maxY: number
  area: number
  rectangularity: number
}

/**
 * Compact dark regions on the facade. Glazing and garage doors are markedly
 * darker than render, cladding or roof tile in these images; shadow gradients
 * are not compact, and the rectangularity test drops them.
 */
export function findDarkOpenings(
  gray: GrayImage,
  facade: MaskImage,
  minAreaPx: number,
  maxAreaPx: number,
): OpeningBox[] {
  const threshold = Math.max(30, otsuThreshold(gray, facade) - 12)
  const w = gray.width
  const h = gray.height
  const dark = makeMask(w, h)
  for (let i = 0; i < gray.data.length; i++) dark.data[i] = facade.data[i] && gray.data[i] < threshold ? 1 : 0

  const label = new Int32Array(w * h).fill(-1)
  const queue = new Int32Array(w * h)
  const out: OpeningBox[] = []
  let next = 0
  for (let start = 0; start < w * h; start++) {
    if (!dark.data[start] || label[start] >= 0) continue
    const id = next++
    let head = 0
    let tail = 0
    queue[tail++] = start
    label[start] = id
    let area = 0
    let minX = w
    let maxX = -1
    let minY = h
    let maxY = -1
    while (head < tail) {
      const i = queue[head++]
      const x = i % w
      const y = (i / w) | 0
      area++
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      if (x > 0 && dark.data[i - 1] && label[i - 1] < 0) (label[i - 1] = id), (queue[tail++] = i - 1)
      if (x < w - 1 && dark.data[i + 1] && label[i + 1] < 0) (label[i + 1] = id), (queue[tail++] = i + 1)
      if (y > 0 && dark.data[i - w] && label[i - w] < 0) (label[i - w] = id), (queue[tail++] = i - w)
      if (y < h - 1 && dark.data[i + w] && label[i + w] < 0) (label[i + w] = id), (queue[tail++] = i + w)
    }
    if (area < minAreaPx || area > maxAreaPx) continue
    const bw = maxX - minX + 1
    const bh = maxY - minY + 1
    const rectangularity = area / (bw * bh)
    const aspect = bw / bh
    if (rectangularity < 0.55) continue
    if (aspect < 0.1 || aspect > 12) continue
    out.push({ minX, maxX, minY, maxY, area, rectangularity })
  }
  out.sort((a, b) => b.area - a.area || a.minX - b.minX)
  return out
}

export type ElevationMeasurement = {
  silhouette: ConditionedSilhouette
  metresPerPixel: number
  /** Facade width in metres, including any roof overhang in this view. */
  widthM: number
  /** Height of the silhouette apex above the ground line, metres. */
  apexHeightM: number
  /** Apex position measured from the facade's left edge, metres. */
  apexOffsetM: number
  /** Horizontal bands (eaves, slab lines, parapets) as heights in metres. */
  bandLevels: number[]
  openings: ElevationOpening[]
  notes: string[]
}

export function analyseElevation(
  assetId: string,
  role: AssetRole,
  image: RasterImage,
  gray: GrayImage,
  gradients: Gradients,
  buildingMask: MaskImage,
  publishedHeightM: number | null,
): { analysis: ElevationAnalysis; measurement: ElevationMeasurement } | null {
  const facade = facadeOf(role)
  if (!facade) return null

  const sil = conditionSilhouette(buildingMask)
  const notes = [...sil.notes]
  if (sil.heightPx <= 0 || sil.widthPx <= 0) {
    return {
      analysis: {
        assetId,
        facade,
        metresPerPixel: 0,
        silhouette: [],
        widthM: 0,
        ridgeY: null,
        eaveY: null,
        openings: [],
        bandLevels: [],
        confidence: 0,
        notes: [...notes, 'empty silhouette'],
      },
      measurement: {
        silhouette: sil,
        metresPerPixel: 0,
        widthM: 0,
        apexHeightM: 0,
        apexOffsetM: 0,
        bandLevels: [],
        openings: [],
        notes,
      },
    }
  }

  // Vertical scale from the published height. The published figure is measured
  // from terrain, and the conditioned silhouette starts at the terrain cut, so
  // the two agree by construction.
  const metresPerPixel = publishedHeightM && publishedHeightM > 0 ? publishedHeightM / sil.heightPx : 0
  if (!metresPerPixel) notes.push('no published height: elevation measurements are proportional only')

  const widthM = sil.widthPx * metresPerPixel
  const apexHeightM = sil.heightPx * metresPerPixel
  const apexOffsetM = (sil.apexX - sil.minX) * metresPerPixel

  // Facade region: the conditioned silhouette restricted to its column span.
  const facadeMask = makeMask(gray.width, gray.height)
  for (let y = 0; y < gray.height; y++) {
    for (let x = sil.minX; x <= sil.maxX; x++) {
      const i = y * gray.width + x
      facadeMask.data[i] = sil.mask.data[i]
    }
  }

  // Openings are read with the same framed-rectangle detector the feature
  // solver uses. One physical window must produce one observation whatever
  // consumes it: when the analysis and the solver ran different detectors the
  // scorer compared the model against a weaker opening set than the model was
  // built from, and reported "no openings" on facades where the solver had
  // found several.
  const denseAll = cannyEdges(gradients, 0.72, 0.88)
  const dense = makeMask(gray.width, gray.height)
  for (let i = 0; i < dense.data.length; i++) dense.data[i] = denseAll.data[i] && facadeMask.data[i] ? 1 : 0
  const rects = findOpeningRectangles(
    gray,
    gradients,
    dense,
    facadeMask,
    { x0: sil.minX, x1: sil.maxX, y0: sil.topRow, y1: sil.groundRow },
    { ...DEFAULT_OPENING_DETECT, minBorderSupport: 0.45, maxRows: 22, maxColumns: 26 },
  )

  const groundRow = sil.groundRow
  const openings: ElevationOpening[] = rects.map((r, i) => ({
    id: mkId('elevop', assetId, i, r.x0, r.y0),
    s: (r.x0 - sil.minX) * metresPerPixel,
    sillY: (groundRow - r.y1) * metresPerPixel,
    widthM: (r.x1 - r.x0) * metresPerPixel,
    heightM: (r.y1 - r.y0) * metresPerPixel,
    confidence: Math.min(0.85, 0.35 + r.borderSupport * 0.5),
  }))

  // Horizontal bands: rows where the silhouette's own skyline steps, plus the
  // strongest horizontal edges inside the facade.
  const skyline = facadeSkyline(sil)
  const steps: Array<{ position: number; weight: number }> = []
  for (let x = sil.minX + 1; x <= sil.maxX; x++) {
    const a = skyline[x - 1]
    const b = skyline[x]
    if (a < 0 || b < 0) continue
    if (Math.abs(a - b) >= 2) steps.push({ position: Math.min(a, b), weight: Math.abs(a - b) })
  }
  const bandRows = significantClusters(cluster1D(steps, 3), 0.25).map((c) => c.position)
  const bandLevels = bandRows.map((row) => (groundRow - row) * metresPerPixel).filter((v) => v > 0.3)

  // Ridge is the apex; the eave is the highest band strictly below it.
  const ridgeY = apexHeightM > 0 ? apexHeightM : null
  const eaveCandidates = bandLevels.filter((v) => ridgeY === null || v < ridgeY - 0.3).sort((a, b) => b - a)
  const eaveY = eaveCandidates.length > 0 ? eaveCandidates[0] : null

  let confidence = sil.confidence * 0.8
  if (metresPerPixel > 0) confidence += 0.1
  if (openings.length > 0) confidence += 0.05

  const analysis: ElevationAnalysis = {
    assetId,
    facade,
    metresPerPixel,
    silhouette: [],
    widthM,
    ridgeY,
    eaveY,
    openings,
    bandLevels,
    confidence: Math.min(0.9, confidence),
    notes,
  }
  return {
    analysis,
    measurement: { silhouette: sil, metresPerPixel, widthM, apexHeightM, apexOffsetM, bandLevels, openings, notes },
  }
}
