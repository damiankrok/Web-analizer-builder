/**
 * Floor-plan analysis (§16).
 *
 * What a published plan can and cannot give up, honestly.
 *
 * It *can* give the building's extent and the shape of its footprint. The
 * exterior and interior walls are the only thick achromatic ink in the drawing,
 * so an opening filter separates them cleanly from dimension lines, furniture,
 * hatching and labels, and the row/column occupancy of that wall mask locates
 * the building's extent to well under a percent — everything outside it
 * (terrace edging, entrance steps, the publisher's logo) contributes far fewer
 * wall pixels per row than a wall does.
 *
 * It *cannot* reliably give a free-form outline. The wall network is broken at
 * every door and window, so contour tracing and flood filling both leak, and
 * the printed dimension strings are a handful of pixels tall.
 *
 * So the footprint is recovered as a fitted shape rather than a traced one:
 * a rectangle, optionally with one corner notched out, with the notch corner
 * chosen by where the plan actually has no walls and the notch *size* set by
 * the published footprint area — which is exact, and is the strongest
 * constraint available (§33: a weaker source never overrides a published
 * dimension). The residual between the fitted shape and the wall evidence is
 * reported, so a footprint this prior cannot express shows up as a low
 * confidence rather than as a confident wrong answer.
 *
 * PORT_DIRECT (Kotlin).
 */
import type { GrayImage, FloatImage, MaskImage } from '../contracts/raster.js'
import { makeMask } from '../contracts/raster.js'
import { openMask } from '../raster/filters.js'
import type { PlanAnalysis, PlanCalibration } from '../contracts/scaffold.js'
import type { Polygon2D, Vec2 } from '../contracts/geometry.js'
import { polygonArea } from '../contracts/geometry.js'

export type PlanExtent = {
  minX: number
  maxX: number
  minY: number
  maxY: number
  widthPx: number
  heightPx: number
  wallMask: MaskImage
  wallPixels: number
}

/**
 * Thick achromatic ink. Both conditions matter: thickness separates walls from
 * dimension lines and furniture, and the achromatic test drops the publisher's
 * coloured logo, the green planting symbols and the red room labels without
 * needing to know where on the page they sit.
 */
export function wallMask(gray: GrayImage, saturation: FloatImage, inkThreshold = 130, maxSaturation = 0.2, openRadius = 2): MaskImage {
  const m = makeMask(gray.width, gray.height)
  for (let i = 0; i < gray.data.length; i++) {
    m.data[i] = gray.data[i] < inkThreshold && saturation.data[i] < maxSaturation ? 1 : 0
  }
  return openMask(m, openRadius)
}

/** Building extent from the rows and columns that actually carry walls. */
export function planExtent(walls: MaskImage, occupancyFraction = 0.25): PlanExtent {
  const w = walls.width
  const h = walls.height
  const rowC = new Int32Array(h)
  const colC = new Int32Array(w)
  let total = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!walls.data[y * w + x]) continue
      rowC[y]++
      colC[x]++
      total++
    }
  }
  let maxR = 0
  let maxC = 0
  for (const v of rowC) if (v > maxR) maxR = v
  for (const v of colC) if (v > maxC) maxC = v

  let minY = -1
  let maxY = -1
  let minX = -1
  let maxX = -1
  for (let y = 0; y < h; y++) if (rowC[y] >= maxR * occupancyFraction) { if (minY < 0) minY = y; maxY = y }
  for (let x = 0; x < w; x++) if (colC[x] >= maxC * occupancyFraction) { if (minX < 0) minX = x; maxX = x }
  if (minX < 0 || minY < 0) {
    return { minX: 0, maxX: w - 1, minY: 0, maxY: h - 1, widthPx: w, heightPx: h, wallMask: walls, wallPixels: total }
  }
  return {
    minX,
    maxX,
    minY,
    maxY,
    widthPx: maxX - minX + 1,
    heightPx: maxY - minY + 1,
    wallMask: walls,
    wallPixels: total,
  }
}

export type Corner = 'TOP_LEFT' | 'TOP_RIGHT' | 'BOTTOM_LEFT' | 'BOTTOM_RIGHT'
export const CORNERS: readonly Corner[] = ['TOP_LEFT', 'TOP_RIGHT', 'BOTTOM_LEFT', 'BOTTOM_RIGHT']

export type NotchFit = {
  corner: Corner
  /** Notch size as a fraction of the extent, in each axis. */
  fx: number
  fy: number
  /** Wall pixels falling inside the notch — lower is a better notch. */
  wallsInside: number
  /** Wall pixels per unit area inside the notch, relative to the whole extent. */
  relativeDensity: number
}

/**
 * Largest wall-free rectangle anchored at each corner of the extent, found by a
 * bounded scan over candidate widths. The notch of an L-shaped plan is exactly
 * such a rectangle, and a rectangular plan has no sizeable one at any corner.
 */
export function findCornerNotch(extent: PlanExtent, steps = 24): NotchFit[] {
  const { minX, maxX, minY, maxY, wallMask: walls } = extent
  const w = walls.width
  const W = extent.widthPx
  const H = extent.heightPx
  const totalInside = countWalls(walls, minX, minY, maxX, maxY)
  const density = totalInside / Math.max(1, W * H)

  const out: NotchFit[] = []
  for (const corner of CORNERS) {
    let best: NotchFit = { corner, fx: 0, fy: 0, wallsInside: 0, relativeDensity: 1 }
    let bestArea = 0
    for (let i = 1; i <= steps; i++) {
      const fx = i / steps
      // For each width, grow the height while the rectangle stays wall-free.
      for (let j = 1; j <= steps; j++) {
        const fy = j / steps
        const rw = Math.round(W * fx)
        const rh = Math.round(H * fy)
        if (rw < 4 || rh < 4) continue
        const x0 = corner === 'TOP_LEFT' || corner === 'BOTTOM_LEFT' ? minX : maxX - rw + 1
        const y0 = corner === 'TOP_LEFT' || corner === 'TOP_RIGHT' ? minY : maxY - rh + 1
        const inside = countWalls(walls, x0, y0, x0 + rw - 1, y0 + rh - 1)
        const rel = inside / Math.max(1, rw * rh * density)
        // "Wall-free" is relative: a notch may clip a stray pixel or two.
        if (rel > 0.12) continue
        const area = rw * rh
        if (area > bestArea) {
          bestArea = area
          best = { corner, fx, fy, wallsInside: inside, relativeDensity: rel }
        }
      }
    }
    out.push(best)
  }
  return out
}

function countWalls(m: MaskImage, x0: number, y0: number, x1: number, y1: number): number {
  let n = 0
  for (let y = Math.max(0, y0); y <= Math.min(m.height - 1, y1); y++) {
    for (let x = Math.max(0, x0); x <= Math.min(m.width - 1, x1); x++) {
      n += m.data[y * m.width + x]
    }
  }
  return n
}

export type FootprintFit = {
  /** Footprint in PLAN metres, origin at the extent's front-left corner. */
  polygon: Polygon2D
  widthM: number
  depthM: number
  notch: { corner: Corner; widthM: number; depthM: number } | null
  areaM2: number
  /** How well the fitted shape matches the published area, in m². */
  areaResidualM2: number
  confidence: number
  notes: string[]
}

/**
 * Fit the footprint shape.
 *
 * `widthM` comes from a stronger source than the plan wherever one exists — the
 * section measures the building's width directly against a published height —
 * and the plan then supplies only the aspect ratio and the notch geometry.
 */
export function fitFootprint(
  extent: PlanExtent,
  publishedAreaM2: number | null,
  externalWidthM: number | null,
): FootprintFit {
  const notes: string[] = []
  const aspect = extent.heightPx / Math.max(1, extent.widthPx)

  let W: number
  if (externalWidthM && externalWidthM > 0) {
    W = externalWidthM
    notes.push(`width ${W.toFixed(2)} m taken from a stronger source; plan supplies the aspect ratio`)
  } else if (publishedAreaM2) {
    // Without an external width, assume the notch is modest and solve from area.
    W = Math.sqrt(publishedAreaM2 / aspect)
    notes.push('no external width available; width derived from the published area and the plan aspect')
  } else {
    W = 10
    notes.push('no metric anchor at all; footprint is proportional only')
  }
  const D = W * aspect

  const bboxArea = W * D
  const target = publishedAreaM2 ?? bboxArea
  const notchArea = Math.max(0, bboxArea - target)

  const candidates = findCornerNotch(extent)
  let notch: FootprintFit['notch'] = null
  if (notchArea > bboxArea * 0.02) {
    // Pick the corner whose wall-free rectangle is closest in area to the notch
    // the published figure demands, then rescale it to match exactly.
    let best = candidates[0]
    let bestDelta = Number.POSITIVE_INFINITY
    for (const c of candidates) {
      const area = c.fx * W * (c.fy * D)
      const delta = Math.abs(area - notchArea)
      if (delta < bestDelta) {
        bestDelta = delta
        best = c
      }
    }
    if (best.fx > 0 && best.fy > 0) {
      const scale = Math.sqrt(notchArea / (best.fx * W * best.fy * D))
      const nw = Math.min(W * 0.9, best.fx * W * scale)
      const nd = Math.min(D * 0.9, notchArea / Math.max(nw, 1e-6))
      notch = { corner: best.corner, widthM: nw, depthM: nd }
      notes.push(
        `notch at ${best.corner}: the plan's largest wall-free corner rectangle is ` +
          `${(best.fx * W).toFixed(2)} x ${(best.fy * D).toFixed(2)} m, rescaled to the ` +
          `${notchArea.toFixed(2)} m² the published footprint area requires`,
      )
    } else {
      notes.push(`published area implies a ${notchArea.toFixed(2)} m² notch but the plan shows no wall-free corner`)
    }
  } else {
    notes.push('published area matches the extent: footprint treated as rectangular')
  }

  const outer = notch ? notchedRectangle(W, D, notch) : [
    { x: 0, z: 0 },
    { x: W, z: 0 },
    { x: W, z: D },
    { x: 0, z: D },
  ]
  let ring = outer
  let areaM2 = Math.abs(polygonArea(ring))
  let widthM = W
  let depthM = D
  let scaledNotch = notch

  // The published footprint area is exact, the plan aspect is reliable, and the
  // external width may not be (a section only measures what it happens to cut
  // through). So the fitted shape is rescaled uniformly until its area matches
  // the published figure, and a correction beyond a few percent is reported as
  // a disagreement rather than absorbed silently.
  if (publishedAreaM2 !== null && areaM2 > 1e-6) {
    const k = Math.sqrt(publishedAreaM2 / areaM2)
    if (Math.abs(k - 1) > 1e-6) {
      widthM = W * k
      depthM = D * k
      scaledNotch = notch ? { ...notch, widthM: notch.widthM * k, depthM: notch.depthM * k } : null
      ring = scaledNotch
        ? notchedRectangle(widthM, depthM, scaledNotch)
        : [
            { x: 0, z: 0 },
            { x: widthM, z: 0 },
            { x: widthM, z: depthM },
            { x: 0, z: depthM },
          ]
      areaM2 = Math.abs(polygonArea(ring))
      if (Math.abs(k - 1) > 0.04) {
        notes.push(
          `footprint rescaled by ${((k - 1) * 100).toFixed(1)}% to match the published area: ` +
            `the external width ${W.toFixed(2)} m and the plan aspect ${aspect.toFixed(3)} disagree with it`,
        )
      }
    }
  }
  const areaResidualM2 = publishedAreaM2 === null ? 0 : areaM2 - publishedAreaM2

  let confidence = 0.35
  if (externalWidthM) confidence += 0.25
  if (publishedAreaM2) confidence += 0.2
  if (Math.abs(areaResidualM2) < 1) confidence += 0.1
  if (aspect < 0.15 || aspect > 7) {
    confidence *= 0.4
    notes.push(`implausible plan aspect ratio ${aspect.toFixed(2)}; wall extent is probably wrong`)
  }

  return {
    polygon: { outer: ring, holes: [] },
    widthM,
    depthM,
    notch: scaledNotch,
    areaM2,
    areaResidualM2,
    confidence: Math.min(0.9, confidence),
    notes,
  }
}

/**
 * Footprint ring in PLAN metres. +X runs right across the plan, +Z runs down the
 * plan (away from the viewer), so the plan's top edge is z = 0.
 */
export function notchedRectangle(W: number, D: number, notch: { corner: Corner; widthM: number; depthM: number }): Vec2[] {
  const nw = Math.min(notch.widthM, W * 0.95)
  const nd = Math.min(notch.depthM, D * 0.95)
  switch (notch.corner) {
    case 'TOP_LEFT':
      return [
        { x: nw, z: 0 },
        { x: W, z: 0 },
        { x: W, z: D },
        { x: 0, z: D },
        { x: 0, z: nd },
        { x: nw, z: nd },
      ]
    case 'TOP_RIGHT':
      return [
        { x: 0, z: 0 },
        { x: W - nw, z: 0 },
        { x: W - nw, z: nd },
        { x: W, z: nd },
        { x: W, z: D },
        { x: 0, z: D },
      ]
    case 'BOTTOM_LEFT':
      return [
        { x: 0, z: 0 },
        { x: W, z: 0 },
        { x: W, z: D },
        { x: nw, z: D },
        { x: nw, z: D - nd },
        { x: 0, z: D - nd },
      ]
    case 'BOTTOM_RIGHT':
    default:
      return [
        { x: 0, z: 0 },
        { x: W, z: 0 },
        { x: W, z: D - nd },
        { x: W - nw, z: D - nd },
        { x: W - nw, z: D },
        { x: 0, z: D },
      ]
  }
}

export function buildPlanAnalysis(
  assetId: string,
  storey: 'GROUND' | 'UPPER',
  extent: PlanExtent,
  fit: FootprintFit,
): PlanAnalysis {
  const pixelsPerMetre = fit.widthM > 0 ? extent.widthPx / fit.widthM : 0
  const calibration: PlanCalibration = {
    assetId,
    pixelsPerMetre,
    method: fit.notch ? 'AREA_FIT' : 'BBOX_FIT',
    confidence: fit.confidence,
    residual: Math.abs(fit.areaResidualM2),
  }
  return {
    assetId,
    storey,
    calibration,
    outline: fit.polygon,
    outlineAreaM2: fit.areaM2,
    walls: [],
    regions: [],
    confidence: fit.confidence,
    notes: fit.notes,
  }
}
