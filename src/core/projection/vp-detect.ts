/**
 * Multi-model vanishing-point detection by pairwise voting on the Gaussian
 * sphere (§20).
 *
 * Splitting segments into families by orientation before fitting does not work
 * on real architectural views. In a near-frontal render the facade parallel to
 * the image plane produces exactly-horizontal lines while the receding facade
 * produces lines a couple of degrees off horizontal; an orientation split mixes
 * the two, and the mixture looks neither parallel nor convergent. The families
 * have to come *out* of the fit rather than be assumed going in.
 *
 * So: every pair of segments votes for its intersection, votes are accumulated
 * on the Gaussian sphere (which represents finite points and points at infinity
 * uniformly), peaks become candidate vanishing points, and each candidate then
 * claims its own inliers. Deterministic throughout — no random sampling.
 *
 * PORT_DIRECT (Kotlin).
 */
import { smallestEigenvector3 } from '../math/linalg.js'
import type { Segment } from '../raster/lines.js'
import { segmentLine } from '../raster/lines.js'

export type HomogPoint = readonly [number, number, number]
export type VanishingModel = 'PARALLEL' | 'CONVERGENT' | 'UNDETERMINED'

export type VpCandidate = {
  id: string
  model: VanishingModel
  point: HomogPoint
  finite: { u: number; v: number } | null
  /** Unit direction on the Gaussian sphere under the nominal focal. */
  sphere: readonly [number, number, number]
  inliers: number[]
  supportLength: number
  /** Weighted RMS angular residual of the chosen model, radians. */
  residualRad: number
  parallelResidualRad: number
  convergentResidualRad: number
  /** Mean absolute segment orientation of the inliers, radians in [0, pi). */
  meanOrientation: number
}

export type VpOptions = {
  /** Longest N segments considered; caps the pairwise cost at N^2/2. */
  maxSegments: number
  /** Accumulator resolution over the unit disk of the sphere's upper half. */
  gridSize: number
  /** Candidate peaks examined. */
  maxCandidates: number
  /** Angular inlier threshold, radians. */
  inlierRad: number
  /** Convergent must beat parallel by this factor on the same inliers. */
  convergenceMargin: number
  /** Absolute ceiling on a believable convergent residual, radians. */
  maxConvergentResidualRad: number
  /** A finite point further than this many diagonals is treated as parallel. */
  infinityFactor: number
  minInliers: number
  minSupportLength: number
}

export const DEFAULT_VP: VpOptions = {
  maxSegments: 140,
  gridSize: 96,
  maxCandidates: 6,
  inlierRad: 0.045,
  convergenceMargin: 0.7,
  maxConvergentResidualRad: 0.06,
  infinityFactor: 25,
  minInliers: 5,
  minSupportLength: 160,
}

/** Angular residual of a segment against a candidate vanishing point. */
export function segmentResidualRad(s: Segment, v: HomogPoint): number {
  const mu = (s.x1 + s.x2) / 2
  const mv = (s.y1 + s.y2) / 2
  let dx: number
  let dy: number
  if (Math.abs(v[2]) < 1e-12) {
    dx = v[0]
    dy = v[1]
  } else {
    dx = v[0] / v[2] - mu
    dy = v[1] / v[2] - mv
  }
  const n = Math.hypot(dx, dy)
  if (n < 1e-12) return Math.PI / 2
  const sx = s.x2 - s.x1
  const sy = s.y2 - s.y1
  const sn = Math.hypot(sx, sy)
  if (sn < 1e-12) return Math.PI / 2
  return Math.acos(Math.min(1, Math.abs((dx * sx + dy * sy) / (n * sn))))
}

function weightedRmsRad(segments: readonly Segment[], idx: readonly number[], v: HomogPoint): number {
  let sum = 0
  let wsum = 0
  for (const i of idx) {
    const r = segmentResidualRad(segments[i], v)
    const w = segments[i].length
    sum += w * r * r
    wsum += w
  }
  return wsum > 0 ? Math.sqrt(sum / wsum) : Number.POSITIVE_INFINITY
}

/**
 * Map a homogeneous image point onto the unit sphere of camera rays under a
 * nominal focal length. Finite points land off the equator, points at infinity
 * land exactly on it, and both are then comparable in one accumulator.
 */
export function toSphere(v: HomogPoint, cx: number, cy: number, f: number): readonly [number, number, number] {
  let x = v[0] - cx * v[2]
  let y = v[1] - cy * v[2]
  let z = f * v[2]
  const n = Math.hypot(x, y, z)
  if (n < 1e-12) return [1, 0, 0]
  x /= n
  y /= n
  z /= n
  // Canonical hemisphere: z > 0, and on the equator pick a fixed sign.
  if (z < 0 || (z === 0 && (x < 0 || (x === 0 && y < 0)))) {
    x = -x
    y = -y
    z = -z
  }
  return [x, y, z]
}

export function fromSphere(s: readonly [number, number, number], cx: number, cy: number, f: number): HomogPoint {
  // Inverse of toSphere: (x, y, z) -> homogeneous (f*cx*... ) simplified below.
  return [s[0] * f + cx * s[2], s[1] * f + cy * s[2], s[2]]
}

const solveConvergent = (lines: readonly HomogPoint[], weights: readonly number[]): HomogPoint => {
  const m = new Array<number>(9).fill(0)
  for (let i = 0; i < lines.length; i++) {
    const [a, b, c] = lines[i]
    const w = weights[i]
    m[0] += w * a * a
    m[1] += w * a * b
    m[2] += w * a * c
    m[3] += w * b * a
    m[4] += w * b * b
    m[5] += w * b * c
    m[6] += w * c * a
    m[7] += w * c * b
    m[8] += w * c * c
  }
  return smallestEigenvector3(m)
}

const solveParallel = (lines: readonly HomogPoint[], weights: readonly number[]): HomogPoint => {
  let m00 = 0
  let m01 = 0
  let m11 = 0
  for (let i = 0; i < lines.length; i++) {
    const [a, b] = lines[i]
    const w = weights[i]
    m00 += w * a * a
    m01 += w * a * b
    m11 += w * b * b
  }
  const tr = m00 + m11
  const det = m00 * m11 - m01 * m01
  const lambda = tr / 2 - Math.sqrt(Math.max(0, (tr * tr) / 4 - det))
  let x = m01
  let y = lambda - m00
  if (Math.hypot(x, y) < 1e-12) {
    x = lambda - m11
    y = m01
  }
  const n = Math.hypot(x, y)
  return n < 1e-12 ? [1, 0, 0] : [x / n, y / n, 0]
}

function meanOrientationOf(segments: readonly Segment[], idx: readonly number[]): number {
  // Orientations are mod pi, so average the doubled angle.
  let sx = 0
  let sy = 0
  for (const i of idx) {
    const w = segments[i].length
    sx += w * Math.cos(2 * segments[i].angle)
    sy += w * Math.sin(2 * segments[i].angle)
  }
  const a = Math.atan2(sy, sx) / 2
  return (a + Math.PI) % Math.PI
}

/**
 * Refine one candidate: claim inliers, choose parallel vs convergent on that
 * inlier set, and re-fit. Two rounds, so the inlier set and the model agree.
 */
function refineCandidate(
  segments: readonly Segment[],
  lines: readonly HomogPoint[],
  seed: HomogPoint,
  diag: number,
  opts: VpOptions,
): VpCandidate | null {
  let current = seed
  let inliers: number[] = []
  for (let round = 0; round < 3; round++) {
    inliers = []
    for (let i = 0; i < segments.length; i++) {
      if (segmentResidualRad(segments[i], current) <= opts.inlierRad) inliers.push(i)
    }
    if (inliers.length < opts.minInliers) return null
    const sub = inliers.map((i) => lines[i])
    const wts = inliers.map((i) => segments[i].length)
    current = solveConvergent(sub, wts)
  }

  const sub = inliers.map((i) => lines[i])
  const wts = inliers.map((i) => segments[i].length)
  const vConv = solveConvergent(sub, wts)
  const vPar = solveParallel(sub, wts)
  const convergentResidualRad = weightedRmsRad(segments, inliers, vConv)
  const parallelResidualRad = weightedRmsRad(segments, inliers, vPar)

  let finite: { u: number; v: number } | null = null
  if (Math.abs(vConv[2]) > 1e-12) {
    const u = vConv[0] / vConv[2]
    const v = vConv[1] / vConv[2]
    if (Number.isFinite(u) && Number.isFinite(v) && Math.hypot(u, v) < opts.infinityFactor * diag) finite = { u, v }
  }
  const convergentWins =
    finite !== null &&
    convergentResidualRad < parallelResidualRad * opts.convergenceMargin &&
    convergentResidualRad < opts.maxConvergentResidualRad

  const supportLength = inliers.reduce((s, i) => s + segments[i].length, 0)
  if (supportLength < opts.minSupportLength) return null

  const point = convergentWins ? vConv : vPar
  return {
    id: '',
    model: convergentWins ? 'CONVERGENT' : 'PARALLEL',
    point,
    finite: convergentWins ? finite : null,
    sphere: [0, 0, 0],
    inliers,
    supportLength,
    residualRad: convergentWins ? convergentResidualRad : parallelResidualRad,
    parallelResidualRad,
    convergentResidualRad,
    meanOrientation: meanOrientationOf(segments, inliers),
  }
}

export type LineFamilies = {
  vertical: Segment[]
  /** Near-horizontal segments sloping down-right and down-left. */
  horizontalA: Segment[]
  horizontalB: Segment[]
  /** Genuinely oblique segments — roof pitches, ramps, diagonal glazing. */
  oblique: Segment[]
}

/**
 * Split segments by orientation. Used for diagnostics and for the debug UI;
 * the solver itself does not rely on it, because an orientation split cannot
 * separate a frontal facade from a receding one (see the module header).
 */
export function groupLineFamilies(
  segments: readonly Segment[],
  verticalTolRad = 0.26,
  horizontalTolRad = 0.44,
): LineFamilies {
  const vertical: Segment[] = []
  const horizontalA: Segment[] = []
  const horizontalB: Segment[] = []
  const oblique: Segment[] = []
  for (const s of segments) {
    if (orientationFromVertical(s.angle) <= verticalTolRad) {
      vertical.push(s)
      continue
    }
    const fromHorizontal = Math.min(s.angle, Math.PI - s.angle)
    if (fromHorizontal <= horizontalTolRad) {
      const slope = (s.y2 - s.y1) / (s.x2 - s.x1 || 1e-9)
      if (slope >= 0) horizontalA.push(s)
      else horizontalB.push(s)
      continue
    }
    oblique.push(s)
  }
  return { vertical, horizontalA, horizontalB, oblique }
}

/**
 * Fit one *known* family: choose between the parallel and convergent models on
 * exactly these segments, with no inlier search. Use this when the family is
 * already established (a vertical family, say); use detectVanishingPoints when
 * the families themselves have to be discovered.
 */
export function fitVanishingPoint(
  segments: readonly Segment[],
  imageDiagonal: number,
  opts: VpOptions = DEFAULT_VP,
): VpCandidate {
  const supportLength = segments.reduce((s, x) => s + x.length, 0)
  const empty: VpCandidate = {
    id: 'family',
    model: 'UNDETERMINED',
    point: [1, 0, 0],
    finite: null,
    sphere: [1, 0, 0],
    inliers: [],
    supportLength,
    residualRad: Number.POSITIVE_INFINITY,
    parallelResidualRad: Number.POSITIVE_INFINITY,
    convergentResidualRad: Number.POSITIVE_INFINITY,
    meanOrientation: 0,
  }
  if (segments.length < opts.minInliers || supportLength < opts.minSupportLength) return empty

  const lines = segments.map(segmentLine)
  const weights = segments.map((s) => s.length)
  const indices = segments.map((_, i) => i)
  const vConv = solveConvergent(lines, weights)
  const vPar = solveParallel(lines, weights)
  const convergentResidualRad = weightedRmsRad(segments, indices, vConv)
  const parallelResidualRad = weightedRmsRad(segments, indices, vPar)

  let finite: { u: number; v: number } | null = null
  if (Math.abs(vConv[2]) > 1e-12) {
    const u = vConv[0] / vConv[2]
    const v = vConv[1] / vConv[2]
    if (Number.isFinite(u) && Number.isFinite(v) && Math.hypot(u, v) < opts.infinityFactor * imageDiagonal) {
      finite = { u, v }
    }
  }
  const convergentWins =
    finite !== null &&
    convergentResidualRad < parallelResidualRad * opts.convergenceMargin &&
    convergentResidualRad < opts.maxConvergentResidualRad

  return {
    id: 'family',
    model: convergentWins ? 'CONVERGENT' : 'PARALLEL',
    point: convergentWins ? vConv : vPar,
    finite: convergentWins ? finite : null,
    sphere: [0, 0, 0],
    inliers: indices,
    supportLength,
    residualRad: convergentWins ? convergentResidualRad : parallelResidualRad,
    parallelResidualRad,
    convergentResidualRad,
    meanOrientation: meanOrientationOf(segments, indices),
  }
}

export function detectVanishingPoints(
  allSegments: readonly Segment[],
  width: number,
  height: number,
  opts: VpOptions = DEFAULT_VP,
): VpCandidate[] {
  const diag = Math.hypot(width, height)
  const cx = width / 2
  const cy = height / 2
  const f0 = width // nominal focal, used only to place votes on the sphere

  const segments = [...allSegments].sort((a, b) => b.length - a.length).slice(0, opts.maxSegments)
  if (segments.length < opts.minInliers) return []
  const lines = segments.map(segmentLine)

  // Pairwise votes into a grid over the (x, y) disk of the upper hemisphere.
  const G = opts.gridSize
  const acc = new Float64Array(G * G)
  const binOf = (s: readonly [number, number, number]): number => {
    const bx = Math.min(G - 1, Math.max(0, Math.floor(((s[0] + 1) / 2) * G)))
    const by = Math.min(G - 1, Math.max(0, Math.floor(((s[1] + 1) / 2) * G)))
    return by * G + bx
  }
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const a = lines[i]
      const b = lines[j]
      const v: HomogPoint = [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
      ]
      if (Math.hypot(v[0], v[1], v[2]) < 1e-12) continue
      // Near-parallel pairs give an unstable intersection; their vote is still
      // meaningful (it lands near the equator) but should not dominate.
      const s = toSphere(v, cx, cy, f0)
      acc[binOf(s)] += Math.min(segments[i].length, segments[j].length)
    }
  }

  type Peak = { bin: number; value: number }
  const peaks: Peak[] = []
  for (let b = 0; b < acc.length; b++) if (acc[b] > 0) peaks.push({ bin: b, value: acc[b] })
  peaks.sort((p, q) => q.value - p.value || p.bin - q.bin)

  const chosen: VpCandidate[] = []
  const suppress = Math.max(2, Math.round(G / 24))
  const taken: Array<{ bx: number; by: number }> = []
  for (const p of peaks) {
    if (chosen.length >= opts.maxCandidates) break
    const bx = p.bin % G
    const by = (p.bin / G) | 0
    if (taken.some((t) => Math.abs(t.bx - bx) <= suppress && Math.abs(t.by - by) <= suppress)) continue
    const sx = ((bx + 0.5) / G) * 2 - 1
    const sy = ((by + 0.5) / G) * 2 - 1
    const r2 = sx * sx + sy * sy
    if (r2 > 1) continue
    const sz = Math.sqrt(Math.max(0, 1 - r2))
    const seed = fromSphere([sx, sy, sz], cx, cy, f0)
    const cand = refineCandidate(segments, lines, seed, diag, opts)
    taken.push({ bx, by })
    if (!cand) continue
    // Drop a candidate that mostly re-claims an accepted one's inliers.
    const overlapping = chosen.some((c) => {
      const set = new Set(c.inliers)
      let shared = 0
      for (const i of cand.inliers) if (set.has(i)) shared++
      return shared > 0.7 * Math.min(c.inliers.length, cand.inliers.length)
    })
    if (overlapping) continue
    chosen.push({ ...cand, sphere: toSphere(cand.point, cx, cy, f0) })
  }

  chosen.sort((a, b) => b.supportLength - a.supportLength)
  return chosen.map((c, i) => ({ ...c, id: `vp${i}` }))
}

/** Orientation distance to vertical, radians in [0, pi/2]. */
export const orientationFromVertical = (theta: number): number => {
  const d = Math.abs(theta - Math.PI / 2) % Math.PI
  return d > Math.PI / 2 ? Math.PI - d : d
}
