/**
 * Opening detection on orthographic facades (§18, §32).
 *
 * An earlier version thresholded darkness and kept compact regions. That fails
 * on these sources for a specific reason: ARCHON's elevations are *rendered*,
 * and this house has an anthracite-rendered garage wing, so "dark and
 * rectangular" describes an entire wall as readily as it describes a window.
 * The detector duly returned the wing as one enormous opening.
 *
 * What actually distinguishes an opening on a facade is that it is a rectangle
 * *bounded on all four sides* by edges — a frame — rather than merely a patch
 * of dark colour. So candidates are built from the facade's own dominant
 * horizontal and vertical lines and then tested for border support: what
 * fraction of each of the four sides is actually inked. A painted colour change
 * has at most two such sides; a window has four.
 *
 * PORT_DIRECT (Kotlin).
 */
import type { GrayImage, MaskImage } from '../contracts/raster.js'
import type { Gradients } from '../raster/filters.js'
import { cluster1D, significantClusters } from './cluster.js'

export type OpeningRect = {
  x0: number
  y0: number
  x1: number
  y1: number
  /** Fraction of the four borders covered by edge pixels, 0..1. */
  borderSupport: number
  /** How much darker the interior is than the surrounding ring, 0..1. */
  contrast: number
  score: number
}

export type OpeningDetectOptions = {
  /** Candidate lines kept per axis. */
  maxRows: number
  maxColumns: number
  /** Minimum fraction of each border that must be inked. */
  minBorderSupport: number
  /** Minimum fraction of the facade an opening may occupy. */
  minAreaFraction: number
  maxAreaFraction: number
  minAspect: number
  maxAspect: number
  /** Tolerance in pixels when testing whether a border pixel is inked. */
  borderTolerance: number
  /** Overlap above which two rectangles are treated as the same opening. */
  suppressIoU: number
}

export const DEFAULT_OPENING_DETECT: OpeningDetectOptions = {
  maxRows: 14,
  maxColumns: 18,
  minBorderSupport: 0.62,
  minAreaFraction: 0.004,
  maxAreaFraction: 0.3,
  minAspect: 0.12,
  maxAspect: 9,
  borderTolerance: 2,
  suppressIoU: 0.3,
}

/** Rows and columns carrying the facade's dominant straight lines. */
function candidateLines(
  grad: Gradients,
  region: MaskImage,
  bounds: { x0: number; x1: number; y0: number; y1: number },
  maxRows: number,
  maxColumns: number,
): { rows: number[]; columns: number[] } {
  const w = grad.mag.width
  const rowScore = new Float64Array(grad.mag.height)
  const colScore = new Float64Array(w)
  for (let y = bounds.y0; y <= bounds.y1; y++) {
    for (let x = bounds.x0; x <= bounds.x1; x++) {
      const i = y * w + x
      if (!region.data[i]) continue
      // A horizontal line shows as a vertical gradient and vice versa.
      rowScore[y] += Math.abs(grad.gy.data[i])
      colScore[x] += Math.abs(grad.gx.data[i])
    }
  }
  const pick = (score: Float64Array, lo: number, hi: number, limit: number): number[] => {
    const samples: { position: number; weight: number }[] = []
    let max = 0
    for (let i = lo; i <= hi; i++) if (score[i] > max) max = score[i]
    if (max <= 0) return []
    for (let i = lo; i <= hi; i++) if (score[i] >= max * 0.18) samples.push({ position: i, weight: score[i] })
    const clusters = significantClusters(cluster1D(samples, 2), 0.12)
    return clusters
      .sort((a, b) => b.weight - a.weight)
      .slice(0, limit)
      .map((c) => Math.round(c.position))
      .sort((a, b) => a - b)
  }
  return {
    rows: pick(rowScore, bounds.y0, bounds.y1, maxRows),
    columns: pick(colScore, bounds.x0, bounds.x1, maxColumns),
  }
}

/** Fraction of a border run that has an edge pixel within tolerance. */
function borderCoverage(
  edges: MaskImage,
  from: { x: number; y: number },
  to: { x: number; y: number },
  tolerance: number,
): number {
  const steps = Math.max(1, Math.round(Math.hypot(to.x - from.x, to.y - from.y)))
  let hit = 0
  for (let s = 0; s <= steps; s++) {
    const f = s / steps
    const x = Math.round(from.x + (to.x - from.x) * f)
    const y = Math.round(from.y + (to.y - from.y) * f)
    let found = false
    for (let d = -tolerance; d <= tolerance && !found; d++) {
      const nx = from.y === to.y ? x : x + d
      const ny = from.y === to.y ? y + d : y
      if (nx < 0 || ny < 0 || nx >= edges.width || ny >= edges.height) continue
      if (edges.data[ny * edges.width + nx]) found = true
    }
    if (found) hit++
  }
  return hit / (steps + 1)
}

const meanIn = (gray: GrayImage, x0: number, y0: number, x1: number, y1: number): number => {
  let sum = 0
  let n = 0
  for (let y = Math.max(0, y0); y <= Math.min(gray.height - 1, y1); y++) {
    for (let x = Math.max(0, x0); x <= Math.min(gray.width - 1, x1); x++) {
      sum += gray.data[y * gray.width + x]
      n++
    }
  }
  return n === 0 ? 0 : sum / n
}

const rectIoU = (a: OpeningRect, b: OpeningRect): number => {
  const ix = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0))
  const iy = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0))
  const inter = ix * iy
  const areaA = (a.x1 - a.x0) * (a.y1 - a.y0)
  const areaB = (b.x1 - b.x0) * (b.y1 - b.y0)
  const union = areaA + areaB - inter
  return union <= 0 ? 0 : inter / union
}

export function findOpeningRectangles(
  gray: GrayImage,
  grad: Gradients,
  edges: MaskImage,
  region: MaskImage,
  bounds: { x0: number; x1: number; y0: number; y1: number },
  opts: OpeningDetectOptions = DEFAULT_OPENING_DETECT,
): OpeningRect[] {
  const facadeW = bounds.x1 - bounds.x0 + 1
  const facadeH = bounds.y1 - bounds.y0 + 1
  const facadeArea = facadeW * facadeH
  if (facadeArea <= 0) return []

  const { rows, columns } = candidateLines(grad, region, bounds, opts.maxRows, opts.maxColumns)
  if (rows.length < 2 || columns.length < 2) return []

  const candidates: OpeningRect[] = []
  for (let ci = 0; ci < columns.length; ci++) {
    for (let cj = ci + 1; cj < columns.length; cj++) {
      const x0 = columns[ci]
      const x1 = columns[cj]
      const rectW = x1 - x0
      if (rectW < 4) continue
      for (let ri = 0; ri < rows.length; ri++) {
        for (let rj = ri + 1; rj < rows.length; rj++) {
          const y0 = rows[ri]
          const y1 = rows[rj]
          const rectH = y1 - y0
          if (rectH < 4) continue
          const area = rectW * rectH
          if (area < facadeArea * opts.minAreaFraction || area > facadeArea * opts.maxAreaFraction) continue
          const aspect = rectW / rectH
          if (aspect < opts.minAspect || aspect > opts.maxAspect) continue

          const top = borderCoverage(edges, { x: x0, y: y0 }, { x: x1, y: y0 }, opts.borderTolerance)
          const bottom = borderCoverage(edges, { x: x0, y: y1 }, { x: x1, y: y1 }, opts.borderTolerance)
          const left = borderCoverage(edges, { x: x0, y: y0 }, { x: x0, y: y1 }, opts.borderTolerance)
          const right = borderCoverage(edges, { x: x1, y: y0 }, { x: x1, y: y1 }, opts.borderTolerance)
          // Every side must be supported: three strong sides and one absent is
          // a corner of something else, not a frame.
          const weakest = Math.min(top, bottom, left, right)
          if (weakest < opts.minBorderSupport) continue
          const borderSupport = (top + bottom + left + right) / 4

          const inner = meanIn(gray, x0 + 2, y0 + 2, x1 - 2, y1 - 2)
          const pad = Math.max(3, Math.round(Math.min(rectW, rectH) * 0.25))
          const outer = meanIn(gray, x0 - pad, y0 - pad, x1 + pad, y1 + pad)
          // Openings read darker than the wall around them in every one of
          // these sources, rendered or drawn.
          const contrast = Math.max(0, (outer - inner) / 255)
          if (contrast < 0.02) continue

          candidates.push({
            x0,
            y0,
            x1,
            y1,
            borderSupport,
            contrast,
            score: borderSupport * 0.65 + Math.min(1, contrast * 4) * 0.35,
          })
        }
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score || a.x0 - b.x0 || a.y0 - b.y0)
  const kept: OpeningRect[] = []
  for (const c of candidates) {
    if (kept.some((k) => rectIoU(k, c) > opts.suppressIoU)) continue
    kept.push(c)
    if (kept.length >= 24) break
  }
  kept.sort((a, b) => a.x0 - b.x0 || a.y0 - b.y0)
  return kept
}
