/**
 * Line detection: Hough accumulation, deterministic peak picking, and
 * extraction of maximal supported runs as finite segments.
 *
 * Finite segments (not infinite lines) are what the rest of the analyzer needs:
 * vanishing-point estimation weights by segment length, and facade/roofline
 * matching needs endpoints.
 *
 * PORT_DIRECT (Kotlin).
 */
import type { MaskImage } from '../contracts/raster.js'
import type { Gradients } from './filters.js'

export type Segment = {
  x1: number
  y1: number
  x2: number
  y2: number
  /** Orientation in [0, pi). */
  angle: number
  length: number
  /** Count of supporting edge pixels. */
  support: number
}

export type HoughOptions = {
  thetaBins: number
  /** Minimum run length in pixels for a segment to be kept. */
  minSegmentLength: number
  /** Largest gap along a line that does not break a run. */
  maxGap: number
  /** Maximum number of accumulator peaks examined. */
  maxPeaks: number
  /** Perpendicular tolerance in pixels when collecting support for a line. */
  tolerance: number
}

export const DEFAULT_HOUGH: HoughOptions = {
  thetaBins: 360,
  minSegmentLength: 12,
  maxGap: 3,
  maxPeaks: 220,
  tolerance: 1.6,
}

export function detectSegments(
  edges: MaskImage,
  grad: Gradients,
  opts: HoughOptions = DEFAULT_HOUGH,
): Segment[] {
  const w = edges.width
  const h = edges.height
  const diag = Math.ceil(Math.hypot(w, h))
  const rhoBins = 2 * diag + 1
  const acc = new Float32Array(opts.thetaBins * rhoBins)
  const cos = new Float64Array(opts.thetaBins)
  const sin = new Float64Array(opts.thetaBins)
  for (let t = 0; t < opts.thetaBins; t++) {
    const a = (Math.PI * t) / opts.thetaBins
    cos[t] = Math.cos(a)
    sin[t] = Math.sin(a)
  }

  // Only vote for the theta bins near the pixel's own gradient normal: an order
  // of magnitude cheaper than a full vote and much less accumulator noise.
  const pixels: number[] = []
  for (let i = 0; i < edges.data.length; i++) if (edges.data[i]) pixels.push(i)
  const window = Math.max(2, Math.round(opts.thetaBins / 24))
  for (const i of pixels) {
    const x = i % w
    const y = (i / w) | 0
    const normal = Math.atan2(grad.gy.data[i], grad.gx.data[i])
    const centre = Math.round((((normal + Math.PI) % Math.PI) / Math.PI) * opts.thetaBins)
    for (let d = -window; d <= window; d++) {
      const t = (centre + d + opts.thetaBins) % opts.thetaBins
      const rho = Math.round(x * cos[t] + y * sin[t]) + diag
      if (rho < 0 || rho >= rhoBins) continue
      acc[t * rhoBins + rho] += 1
    }
  }

  // Deterministic peak selection: sort all cells, then greedily accept peaks
  // that are locally maximal and not too close to an already accepted one.
  type Cell = { t: number; r: number; v: number }
  const cells: Cell[] = []
  const minVotes = Math.max(8, opts.minSegmentLength * 0.6)
  for (let t = 0; t < opts.thetaBins; t++) {
    for (let r = 1; r < rhoBins - 1; r++) {
      const v = acc[t * rhoBins + r]
      if (v < minVotes) continue
      if (v < acc[t * rhoBins + r - 1] || v < acc[t * rhoBins + r + 1]) continue
      cells.push({ t, r, v })
    }
  }
  cells.sort((a, b) => b.v - a.v || a.t - b.t || a.r - b.r)

  const accepted: Cell[] = []
  const suppressTheta = Math.max(1, Math.round(opts.thetaBins / 90))
  const suppressRho = 4
  for (const c of cells) {
    if (accepted.length >= opts.maxPeaks) break
    let ok = true
    for (const a of accepted) {
      const dt = Math.min(Math.abs(a.t - c.t), opts.thetaBins - Math.abs(a.t - c.t))
      if (dt <= suppressTheta && Math.abs(a.r - c.r) <= suppressRho) {
        ok = false
        break
      }
    }
    if (ok) accepted.push(c)
  }

  const segments: Segment[] = []
  for (const c of accepted) {
    const theta = (Math.PI * c.t) / opts.thetaBins
    const rho = c.r - diag
    const ct = Math.cos(theta)
    const st = Math.sin(theta)
    // Walk along the line direction (-sin, cos) from its closest point to origin.
    const px = ct * rho
    const py = st * rho
    const dx = -st
    const dy = ct
    const tMin = -diag
    const tMax = diag
    let runStart: number | null = null
    let lastHit = 0
    let support = 0
    const flush = (end: number): void => {
      if (runStart === null) return
      const len = end - runStart
      if (len >= opts.minSegmentLength) {
        const x1 = px + dx * runStart
        const y1 = py + dy * runStart
        const x2 = px + dx * end
        const y2 = py + dy * end
        segments.push({
          x1,
          y1,
          x2,
          y2,
          angle: ((Math.atan2(y2 - y1, x2 - x1) % Math.PI) + Math.PI) % Math.PI,
          length: Math.hypot(x2 - x1, y2 - y1),
          support,
        })
      }
      runStart = null
      support = 0
    }
    for (let t = tMin; t <= tMax; t++) {
      const x = px + dx * t
      const y = py + dy * t
      if (x < 0 || y < 0 || x >= w || y >= h) {
        flush(lastHit)
        continue
      }
      let hit = false
      const tol = Math.ceil(opts.tolerance)
      for (let oy = -tol; oy <= tol && !hit; oy++) {
        for (let ox = -tol; ox <= tol && !hit; ox++) {
          const xx = Math.round(x) + ox
          const yy = Math.round(y) + oy
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
          if (edges.data[yy * w + xx]) hit = true
        }
      }
      if (hit) {
        if (runStart === null) runStart = t
        lastHit = t
        support++
      } else if (runStart !== null && t - lastHit > opts.maxGap) {
        flush(lastHit)
      }
    }
    flush(lastHit)
  }

  const refined = segments.map((s) => refineSegment(s, edges, opts.tolerance))
  refined.sort((a, b) => b.length - a.length || a.x1 - b.x1 || a.y1 - b.y1)
  return refined
}

/**
 * Re-fit a Hough segment to the edge pixels that support it, by total least
 * squares.
 *
 * Hough quantises orientation into theta bins, which puts a floor of roughly
 * half a bin on every segment's angle. That floor is fatal downstream: deciding
 * whether a family of lines converges or stays parallel is a question about
 * angles of a few degrees, and a one-degree quantisation noise floor swamps the
 * answer. Fitting the supporting pixels directly recovers sub-degree direction.
 */
export function refineSegment(s: Segment, edges: MaskImage, tolerance: number): Segment {
  const w = edges.width
  const h = edges.height
  const dx0 = s.x2 - s.x1
  const dy0 = s.y2 - s.y1
  const len0 = Math.hypot(dx0, dy0)
  if (len0 < 1e-6) return s
  const ux = dx0 / len0
  const uy = dy0 / len0
  const tol = Math.max(1, Math.ceil(tolerance))

  let n = 0
  let sx = 0
  let sy = 0
  const xs: number[] = []
  const ys: number[] = []
  // Walk the nominal segment and gather nearby edge pixels once each.
  const seen = new Set<number>()
  for (let t = 0; t <= len0; t += 0.5) {
    const cx = s.x1 + ux * t
    const cy = s.y1 + uy * t
    for (let oy = -tol; oy <= tol; oy++) {
      for (let ox = -tol; ox <= tol; ox++) {
        const x = Math.round(cx) + ox
        const y = Math.round(cy) + oy
        if (x < 0 || y < 0 || x >= w || y >= h) continue
        const i = y * w + x
        if (!edges.data[i] || seen.has(i)) continue
        // Keep only pixels genuinely close to the line, not to the walk square.
        const perp = Math.abs((x - s.x1) * uy - (y - s.y1) * ux)
        if (perp > tolerance + 0.5) continue
        seen.add(i)
        xs.push(x)
        ys.push(y)
        sx += x
        sy += y
        n++
      }
    }
  }
  if (n < 4) return s

  const mx = sx / n
  const my = sy / n
  let cxx = 0
  let cxy = 0
  let cyy = 0
  for (let i = 0; i < n; i++) {
    const ax = xs[i] - mx
    const ay = ys[i] - my
    cxx += ax * ax
    cxy += ax * ay
    cyy += ay * ay
  }
  // Largest eigenvector of the 2x2 scatter matrix is the fitted direction.
  const tr = cxx + cyy
  const det = cxx * cyy - cxy * cxy
  const disc = Math.max(0, (tr * tr) / 4 - det)
  const lambda = tr / 2 + Math.sqrt(disc)
  let vx = cxy
  let vy = lambda - cxx
  if (Math.hypot(vx, vy) < 1e-9) {
    vx = lambda - cyy
    vy = cxy
  }
  const vn = Math.hypot(vx, vy)
  if (vn < 1e-9) return s
  vx /= vn
  vy /= vn

  let tMin = Infinity
  let tMax = -Infinity
  for (let i = 0; i < n; i++) {
    const t = (xs[i] - mx) * vx + (ys[i] - my) * vy
    if (t < tMin) tMin = t
    if (t > tMax) tMax = t
  }
  const x1 = mx + vx * tMin
  const y1 = my + vy * tMin
  const x2 = mx + vx * tMax
  const y2 = my + vy * tMax
  return {
    x1,
    y1,
    x2,
    y2,
    angle: ((Math.atan2(y2 - y1, x2 - x1) % Math.PI) + Math.PI) % Math.PI,
    length: Math.hypot(x2 - x1, y2 - y1),
    support: n,
  }
}

/** Homogeneous line through a segment's endpoints, normalised. */
export function segmentLine(s: Segment): [number, number, number] {
  const a = s.y1 - s.y2
  const b = s.x2 - s.x1
  const c = s.x1 * s.y2 - s.x2 * s.y1
  const n = Math.hypot(a, b)
  return n < 1e-12 ? [0, 0, 0] : [a / n, b / n, c / n]
}

/** Angular difference of two orientations in [0, pi), result in [0, pi/2]. */
export function angleDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % Math.PI
  return d > Math.PI / 2 ? Math.PI - d : d
}

export const isNearVertical = (s: Segment, tolRad: number): boolean =>
  angleDiff(s.angle, Math.PI / 2) <= tolRad

export const isNearHorizontal = (s: Segment, tolRad: number): boolean =>
  angleDiff(s.angle, 0) <= tolRad
