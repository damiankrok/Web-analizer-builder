/**
 * Vanishing geometry summary (§20): turns the raw vanishing-point candidates
 * into the two decisions the camera stage needs — do the verticals converge,
 * and do the horizontals converge — plus the horizon and Manhattan checks.
 *
 * Two guards matter here.
 *
 * First, a *genuine* vanishing point is a family of near-parallel lines that
 * converge slightly. A set of short segments radiating from a corner also fits
 * a point beautifully, but it is a pencil of lines, not a vanishing point; it
 * shows itself by a huge parallel-model residual (40-50 degrees rather than a
 * few). Requiring the family to be near-parallel *before* crediting convergence
 * removes those.
 *
 * Second, only the dominant family of each orientation class decides. A render
 * or an elevation will always throw up a weak secondary family somewhere; the
 * building's own main edges are the ones with the support.
 *
 * PORT_DIRECT (Kotlin).
 */
import type { Segment } from '../raster/lines.js'
import {
  DEFAULT_VP,
  detectVanishingPoints,
  orientationFromVertical,
  type VpCandidate,
  type VpOptions,
} from './vp-detect.js'

export type { VpCandidate, VpOptions } from './vp-detect.js'
export type { HomogPoint, VanishingModel } from './vp-detect.js'

export type VanishingOptions = VpOptions & {
  /**
   * A convergent family whose parallel-model residual exceeds this is a pencil
   * of lines, not a vanishing point.
   */
  maxParallelResidualRad: number
  /** A family below this fraction of the dominant support does not decide. */
  minRelativeSupport: number
  /** Orientation tolerance for calling a family vertical / horizontal. */
  verticalTolRad: number
  horizontalTolRad: number
  /**
   * A credible architectural vanishing point lies well outside the frame. One
   * that lands inside the picture would mean the camera is staring along a
   * wall, and in practice always comes from a few short segments that happen to
   * meet near a corner.
   */
  minVpDistanceDiag: number
}

export const DEFAULT_VANISHING: VanishingOptions = {
  ...DEFAULT_VP,
  maxParallelResidualRad: 0.21, // ~12 degrees
  minRelativeSupport: 0.25,
  verticalTolRad: 0.44,
  horizontalTolRad: 0.61,
  minVpDistanceDiag: 0.8,
}

/** A convergent candidate that is a real vanishing point rather than a pencil. */
export function isGenuineConvergence(
  c: VpCandidate,
  opts: VanishingOptions,
  centre: { u: number; v: number },
  diagonal: number,
): boolean {
  if (c.model !== 'CONVERGENT' || !c.finite) return false
  if (c.parallelResidualRad > opts.maxParallelResidualRad) return false
  const d = Math.hypot(c.finite.u - centre.u, c.finite.v - centre.v) / diagonal
  return d >= opts.minVpDistanceDiag
}

const orientationFromHorizontal = (theta: number): number => {
  const d = Math.abs(theta) % Math.PI
  return d > Math.PI / 2 ? Math.PI - d : d
}

export type VanishingGeometry = {
  candidates: VpCandidate[]
  /** Dominant vertical family, if any. */
  vertical: VpCandidate | null
  /** Horizontal families by support, strongest first. */
  horizontals: VpCandidate[]
  verticalConverges: boolean
  horizontalConverges: boolean
  /** The horizontal family whose convergence was believed, if any. */
  convergentHorizontal: VpCandidate | null
  /** Horizon through two finite horizontal vanishing points. */
  horizon: { a: number; b: number; c: number } | null
  manhattanConsistent: boolean
  notes: string[]
}

function horizonThrough(a: VpCandidate, b: VpCandidate): { a: number; b: number; c: number } | null {
  if (!a.finite || !b.finite) return null
  const dx = b.finite.u - a.finite.u
  const dy = b.finite.v - a.finite.v
  const n = Math.hypot(dx, dy)
  if (n < 1e-9) return null
  const la = -dy / n
  const lb = dx / n
  return { a: la, b: lb, c: -(la * a.finite.u + lb * a.finite.v) }
}

/**
 * Manhattan check: for a pinhole camera with focal f and principal point p, two
 * vanishing points of orthogonal world directions satisfy
 *   (v1-p)·(v2-p) + f^2 = 0.
 * Only meaningful when both are finite; a parallel family degenerates the
 * constraint, which is reported as unverifiable rather than as a failure (§20 —
 * do not assume Manhattan when the source does not say so).
 */
export function manhattanResidual(
  a: VpCandidate,
  b: VpCandidate,
  principal: { u: number; v: number },
  focal: number,
): number | null {
  if (!a.finite || !b.finite) return null
  const d =
    (a.finite.u - principal.u) * (b.finite.u - principal.u) + (a.finite.v - principal.v) * (b.finite.v - principal.v)
  return (d + focal * focal) / (focal * focal)
}

/**
 * Focal length implied by two orthogonal finite vanishing points:
 *   f^2 = -(v1-p)·(v2-p)
 * Returns null when the geometry admits no real solution — which happens often
 * and legitimately, e.g. when both points fall on the same side of the
 * principal point.
 */
export function focalFromVanishingPair(
  a: VpCandidate,
  b: VpCandidate,
  principal: { u: number; v: number },
): number | null {
  if (!a.finite || !b.finite) return null
  const d =
    (a.finite.u - principal.u) * (b.finite.u - principal.u) + (a.finite.v - principal.v) * (b.finite.v - principal.v)
  if (d >= -1e-6) return null
  return Math.sqrt(-d)
}

export function analyseVanishingGeometry(
  segments: readonly Segment[],
  width: number,
  height: number,
  opts: VanishingOptions = DEFAULT_VANISHING,
): VanishingGeometry {
  const notes: string[] = []
  const candidates = detectVanishingPoints(segments, width, height, opts)

  const verticals = candidates
    .filter((c) => orientationFromVertical(c.meanOrientation) <= opts.verticalTolRad)
    .sort((a, b) => b.supportLength - a.supportLength)
  const horizontals = candidates
    .filter((c) => orientationFromHorizontal(c.meanOrientation) <= opts.horizontalTolRad)
    .sort((a, b) => b.supportLength - a.supportLength)

  const centre = { u: width / 2, v: height / 2 }
  const diagonal = Math.hypot(width, height)
  const vertical = verticals[0] ?? null
  if (!vertical) notes.push('no vertical line family found')

  const verticalConverges = vertical !== null && isGenuineConvergence(vertical, opts, centre, diagonal)

  const dominantSupport = horizontals[0]?.supportLength ?? 0
  let convergentHorizontal: VpCandidate | null = null
  for (const c of horizontals.slice(0, 3)) {
    if (!isGenuineConvergence(c, opts, centre, diagonal)) continue
    if (c.supportLength < dominantSupport * opts.minRelativeSupport) continue
    convergentHorizontal = c
    break
  }
  if (horizontals.length === 0) notes.push('no horizontal line family found')

  const finiteHorizontals = horizontals.filter((c) => c.finite)
  const horizon = finiteHorizontals.length >= 2 ? horizonThrough(finiteHorizontals[0], finiteHorizontals[1]) : null

  const principal = centre
  let manhattanConsistent = true
  if (finiteHorizontals.length >= 2) {
    const r = manhattanResidual(finiteHorizontals[0], finiteHorizontals[1], principal, width)
    if (r !== null && Math.abs(r) >= 0.5) {
      manhattanConsistent = false
      notes.push(`horizontal vanishing pair is not Manhattan-consistent under a nominal focal (residual ${r.toFixed(2)})`)
    }
  }

  return {
    candidates,
    vertical,
    horizontals: horizontals.slice(0, 2),
    verticalConverges,
    horizontalConverges: convergentHorizontal !== null,
    convergentHorizontal,
    horizon,
    manhattanConsistent,
    notes,
  }
}
