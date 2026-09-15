/**
 * The roof, as the section actually draws it — §13, §14.
 *
 * §13 is blunt about the thing that matters: *do not derive roof pitch only
 * from a text label*. A drawing that prints `40°` beside a slope it drew at
 * 38.4° has told you two things, and a pipeline that reads the label and stops
 * has recorded one of them and lost the disagreement. So the slopes are fitted
 * to the raster edges first, and the label is a second, independent
 * observation that meets the fit in §14 rather than replacing it.
 *
 * ## Why the roof is fitted and not traced
 *
 * The top of a roof on a section is not a clean polyline. It is interrupted by
 * a chimney, by the eave detail, by a JPEG's ringing along a strong diagonal,
 * and — on a house like project A — by a second roof at a different level over
 * the garage. Walking the skyline and calling the result a roof gives a
 * polygon with a chimney-shaped notch in it.
 *
 * What survives all of that is line *support*: a roof plane is hundreds of
 * skyline samples that lie on one straight line to within a pixel or two, and
 * a chimney is thirty samples that do not lie on it. So the skyline is
 * decomposed into supported lines, strongest first, and what is reported is
 * the lines and their residuals — never a trace.
 *
 * ## The ridge is an intersection, not a pixel
 *
 * Taking the topmost dark pixel for the ridge is accurate to the width of the
 * drafting pen and to whether the apex happened to be drawn sharp. Crossing
 * the two fitted slopes is accurate to the fit, which on hundreds of samples
 * is far better than a pixel, and it also works on a roof whose apex is hidden
 * behind a chimney.
 *
 * PORT_DIRECT (Kotlin).
 */
import type { GrayImage } from '../contracts/raster.js'

export type SectionRoofOptions = {
  /** Distance from a candidate line a skyline sample may sit and still support it, px. */
  inlierPx: number
  /** Samples a line must have before it is reported at all. */
  minInliers: number
  /** Shortest line reported, as a fraction of the drawing's width. */
  minRunFraction: number
  /**
   * Gap along a line that may be jumped before its support is two stretches
   * rather than one, as a fraction of the drawing's width.
   *
   * This is what stops a handful of scattered agreeing samples at one end of
   * the sheet being reported as a surface that reaches there. A roof plane is
   * a *contiguous* stretch of skyline; forty samples spread over eight hundred
   * columns is a coincidence with a good residual.
   */
  supportGapFraction: number
  /** How many lines are peeled off the skyline before the search stops. */
  maxLines: number
  /** Within this many degrees of horizontal, a line is a flat component. */
  flatToleranceDeg: number
  /** Beyond this, a line is too steep to be a roof surface and is a wall or a stack. */
  maxPitchDeg: number
  /** Thinnest top run that counts as fabric rather than a stray mark, px. */
  minFabricRunPx: number
  /**
   * How far apart two slopes' intersection may sit from both of their upper
   * ends and still be called their ridge, as a fraction of the drawing width.
   */
  ridgeReachFraction: number
}

export const DEFAULT_SECTION_ROOF: SectionRoofOptions = {
  inlierPx: 2.0,
  minInliers: 40,
  minRunFraction: 0.05,
  supportGapFraction: 0.06,
  maxLines: 8,
  flatToleranceDeg: 2.0,
  maxPitchDeg: 75,
  minFabricRunPx: 2,
  ridgeReachFraction: 0.08,
}

/** One straight run of the section's upper surface. */
export type RoofEdgeFit = {
  id: string
  /** `y = intercept + slope * x`, in source pixels with y downwards. */
  slope: number
  intercept: number
  /** Signed degrees from horizontal. Negative rises to the right. */
  slopeDeg: number
  /** Unsigned pitch, which is what a roof is described by. */
  pitchDeg: number
  fromX: number
  toX: number
  inliers: number
  rmsPx: number
  kind: 'FLAT' | 'PITCHED'
}

export type SectionRidge = {
  x: number
  y: number
  leftId: string
  rightId: string
  /** The two pitches, kept apart: a roof whose sides differ is not symmetric. */
  leftPitchDeg: number
  rightPitchDeg: number
  /** How far the crossing sits from the nearest supported sample, px. */
  extrapolationPx: number
}

export type SectionRoofGeometry = {
  /** Topmost fabric row per column, or -1. The evidence everything else fits. */
  skyline: Int32Array
  edges: RoofEdgeFit[]
  ridge: SectionRidge | null
  /** Where a pitched edge stops being supported at its low end. */
  eaves: Array<{ edgeId: string; x: number; y: number; side: 'LEFT' | 'RIGHT' }>
  /** Underside of the fabric directly below a pitched edge, where it is one run. */
  soffits: Array<{ edgeId: string; slope: number; intercept: number; thicknessPx: number; rmsPx: number }>
  notes: string[]
}

/**
 * Topmost fabric row in each column.
 *
 * `aboveRow` keeps the search to the part of the sheet that can contain a
 * roof. Without it the publisher's logo at the foot of the page contributes a
 * long horizontal run that is a perfectly good line and not a roof.
 */
export function fabricSkyline(
  gray: GrayImage,
  inkThreshold: number,
  aboveRow: number,
  opts: SectionRoofOptions = DEFAULT_SECTION_ROOF,
): Int32Array {
  const out = new Int32Array(gray.width).fill(-1)
  for (let x = 0; x < gray.width; x++) {
    for (let y = 0; y < Math.min(gray.height, Math.ceil(aboveRow)); y++) {
      if (gray.data[y * gray.width + x] > inkThreshold) continue
      let run = 0
      while (y + run < gray.height && gray.data[(y + run) * gray.width + x] <= inkThreshold) run++
      if (run >= opts.minFabricRunPx) {
        out[x] = y
        break
      }
      y += run
    }
  }
  return out
}

type Sample = { x: number; y: number }

const fitLine = (pts: readonly Sample[]): { slope: number; intercept: number; rms: number } | null => {
  const n = pts.length
  if (n < 2) return null
  let sx = 0
  let sy = 0
  for (const p of pts) {
    sx += p.x
    sy += p.y
  }
  const mx = sx / n
  const my = sy / n
  let num = 0
  let den = 0
  for (const p of pts) {
    num += (p.x - mx) * (p.y - my)
    den += (p.x - mx) ** 2
  }
  if (den === 0) return null
  const slope = num / den
  const intercept = my - slope * mx
  let sq = 0
  for (const p of pts) sq += (p.y - (intercept + slope * p.x)) ** 2
  return { slope, intercept, rms: Math.sqrt(sq / n) }
}

/**
 * Decompose the skyline into the straight lines that support it.
 *
 * Exhaustive over pairs of samples rather than random, because the input is a
 * few hundred points and a deterministic answer is worth more here than the
 * constant factor: two runs of this pipeline on one drawing must produce the
 * same roof.
 *
 * Each accepted line takes its inliers out of the pool, so a second plane is
 * fitted to what the first did not explain. A line is kept only if its inliers
 * actually span a stretch of the drawing — forty samples scattered across the
 * width is a coincidence, forty consecutive ones is a surface.
 */
export function fitSkylineLines(
  skyline: Int32Array,
  width: number,
  opts: SectionRoofOptions = DEFAULT_SECTION_ROOF,
): RoofEdgeFit[] {
  let pool: Sample[] = []
  for (let x = 0; x < skyline.length; x++) if (skyline[x] >= 0) pool.push({ x, y: skyline[x] })
  const out: RoofEdgeFit[] = []
  const minSpan = Math.max(8, Math.round(width * opts.minRunFraction))
  const step = Math.max(1, Math.floor(pool.length / 400))

  for (let round = 0; round < opts.maxLines && pool.length >= opts.minInliers; round++) {
    let best: { inliers: Sample[]; slope: number; intercept: number } | null = null
    for (let i = 0; i < pool.length; i += step) {
      for (let j = i + minSpan; j < pool.length; j += step) {
        const a = pool[i]
        const b = pool[j]
        if (b.x - a.x < minSpan) continue
        const slope = (b.y - a.y) / (b.x - a.x)
        const deg = (Math.atan(slope) * 180) / Math.PI
        if (Math.abs(deg) > opts.maxPitchDeg) continue
        const intercept = a.y - slope * a.x
        const inliers = pool.filter((p) => Math.abs(p.y - (intercept + slope * p.x)) <= opts.inlierPx)
        if (inliers.length < opts.minInliers) continue
        if (best === null || inliers.length > best.inliers.length) best = { inliers, slope, intercept }
      }
    }
    if (!best) break
    const refined = fitLine(best.inliers)
    if (!refined) break
    // Re-gather against the refined line, then keep only its longest
    // contiguous stretch of support, so the extent that gets reported is the
    // one the drawing actually draws.
    const agreeing = pool
      .filter((p) => Math.abs(p.y - (refined.intercept + refined.slope * p.x)) <= opts.inlierPx)
      .sort((a, b) => a.x - b.x)
    const maxGap = Math.max(3, Math.round(width * opts.supportGapFraction))
    let bestRun: Sample[] = []
    let run: Sample[] = []
    for (const p of agreeing) {
      if (run.length > 0 && p.x - run[run.length - 1].x > maxGap) {
        if (run.length > bestRun.length) bestRun = run
        run = []
      }
      run.push(p)
    }
    if (run.length > bestRun.length) bestRun = run
    const inliers = bestRun
    if (inliers.length < opts.minInliers) break
    const fromX = inliers[0].x
    const toX = inliers[inliers.length - 1].x
    if (toX - fromX < minSpan) break
    // Refit on the contiguous stretch alone; a line pulled by distant strays
    // is not the line the surface lies on.
    const onRun = fitLine(inliers) ?? refined
    refined.slope = onRun.slope
    refined.intercept = onRun.intercept
    refined.rms = onRun.rms
    const slopeDeg = (Math.atan(refined.slope) * 180) / Math.PI
    out.push({
      id: `edge${out.length}`,
      slope: refined.slope,
      intercept: refined.intercept,
      slopeDeg,
      pitchDeg: Math.abs(slopeDeg),
      fromX,
      toX,
      inliers: inliers.length,
      rmsPx: refined.rms,
      kind: Math.abs(slopeDeg) <= opts.flatToleranceDeg ? 'FLAT' : 'PITCHED',
    })
    const taken = new Set(inliers)
    pool = pool.filter((p) => !taken.has(p))
  }
  return out.sort((a, b) => a.fromX - b.fromX)
}

/**
 * The ridge, where two opposed slopes meet.
 *
 * Both fitted lines are extrapolated and crossed. The crossing is required to
 * sit near where both lines actually stop being supported — a roof's two
 * planes end *at* the ridge — which is what stops a pair of unrelated
 * diagonals on opposite sides of a drawing being reported as a ridge a long
 * way from either of them.
 */
export function findRidge(
  edges: readonly RoofEdgeFit[],
  width: number,
  opts: SectionRoofOptions = DEFAULT_SECTION_ROOF,
): SectionRidge | null {
  const pitched = edges.filter((e) => e.kind === 'PITCHED')
  const reach = width * opts.ridgeReachFraction
  let best: (SectionRidge & { support: number }) | null = null
  for (const a of pitched) {
    for (const b of pitched) {
      if (a.id === b.id) continue
      // `a` rises to the right (negative slope, y down), `b` falls away again.
      if (!(a.slope < 0 && b.slope > 0)) continue
      const denom = a.slope - b.slope
      if (Math.abs(denom) < 1e-9) continue
      const x = (b.intercept - a.intercept) / denom
      const y = a.intercept + a.slope * x
      // The crossing must be at the high end of `a` and the high end of `b`.
      const gapA = Math.abs(x - a.toX)
      const gapB = Math.abs(x - b.fromX)
      if (gapA > reach || gapB > reach) continue
      const support = a.inliers + b.inliers
      if (best === null || support > best.support) {
        best = {
          x,
          y,
          leftId: a.id,
          rightId: b.id,
          leftPitchDeg: a.pitchDeg,
          rightPitchDeg: b.pitchDeg,
          extrapolationPx: Math.max(gapA, gapB),
          support,
        }
      }
    }
  }
  if (!best) return null
  const { support: _support, ...ridge } = best
  return ridge
}

/**
 * The underside of the roof band below a fitted top edge.
 *
 * Sampled by walking down the one fabric run that starts at the top edge. It
 * exists only where the section draws the build-up as a solid band; where the
 * run is interrupted, that column contributes nothing rather than a guess.
 */
export function fitSoffit(
  gray: GrayImage,
  inkThreshold: number,
  edge: RoofEdgeFit,
): SectionRoofGeometry['soffits'][number] | null {
  const pts: Sample[] = []
  const thicknesses: number[] = []
  const stepPx = Math.max(1, Math.round((edge.toX - edge.fromX) / 200))
  for (let x = Math.ceil(edge.fromX); x <= Math.floor(edge.toX); x += stepPx) {
    const top = Math.round(edge.intercept + edge.slope * x)
    if (top < 0 || top >= gray.height) continue
    if (gray.data[top * gray.width + x] > inkThreshold) continue
    let y = top
    while (y + 1 < gray.height && gray.data[(y + 1) * gray.width + x] <= inkThreshold) y++
    const thickness = y - top + 1
    if (thickness < 2) continue
    pts.push({ x, y })
    thicknesses.push(thickness)
  }
  if (pts.length < 10) return null
  const fit = fitLine(pts)
  if (!fit) return null
  const sorted = [...thicknesses].sort((a, b) => a - b)
  return {
    edgeId: edge.id,
    slope: fit.slope,
    intercept: fit.intercept,
    thicknessPx: sorted[sorted.length >> 1],
    rmsPx: fit.rms,
  }
}

/** Everything the section's upper surface says about the roof. */
export function analyseSectionRoof(
  gray: GrayImage,
  inkThreshold: number,
  aboveRow: number,
  opts: SectionRoofOptions = DEFAULT_SECTION_ROOF,
): SectionRoofGeometry {
  const skyline = fabricSkyline(gray, inkThreshold, aboveRow, opts)
  const edges = fitSkylineLines(skyline, gray.width, opts)
  const ridge = findRidge(edges, gray.width, opts)
  const eaves: SectionRoofGeometry['eaves'] = []
  for (const e of edges) {
    if (e.kind !== 'PITCHED') continue
    // The low end of a pitched edge is the eave; which end that is depends on
    // which way the plane falls.
    const x = e.slope > 0 ? e.toX : e.fromX
    eaves.push({ edgeId: e.id, x, y: e.intercept + e.slope * x, side: e.slope > 0 ? 'RIGHT' : 'LEFT' })
  }
  const soffits: SectionRoofGeometry['soffits'] = []
  for (const e of edges) {
    if (e.kind !== 'PITCHED') continue
    const s = fitSoffit(gray, inkThreshold, e)
    if (s) soffits.push(s)
  }
  const notes = [
    `${edges.length} straight runs support the section's upper surface: ` +
      edges
        .map((e) => `${e.id} ${e.kind === 'FLAT' ? 'flat' : `${e.pitchDeg.toFixed(2)}°`} over x ${Math.round(e.fromX)}..${Math.round(e.toX)} (${e.inliers} samples, ${e.rmsPx.toFixed(2)} px rms)`)
        .join('; '),
    ridge
      ? `${ridge.leftId} and ${ridge.rightId} cross at (${ridge.x.toFixed(1)}, ${ridge.y.toFixed(1)}), ` +
        `${ridge.extrapolationPx.toFixed(1)} px beyond where either stops being supported`
      : 'no pair of opposed slopes meets near both of their high ends, so the section shows no ridge',
  ]
  return { skyline, edges, ridge, eaves, soffits, notes }
}
