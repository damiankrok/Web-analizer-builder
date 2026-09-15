/**
 * Putting a published elevation into the building's own metres — §17, §18.
 *
 * ## These are orthographic, and that is all they are
 *
 * §17 says to treat a technical elevation as an orthographic planar drawing
 * and not to fit a camera to it. That is right, and on ARCHON's elevations it
 * is also the *only* thing that is right about them: they are renders. There
 * is no dimension line anywhere on any of the four, so nothing on them is a
 * stated dimension and everything measured from one is `RENDER_DERIVED`.
 *
 * What they do have is a scale, and the section knows what it is. The ridge
 * and the terrain are two heights the section prints and the datum solver has
 * already recovered; the elevation shows the same two things as a row of
 * pixels each. Two anchors is a registration. Measured on project A this puts
 * all four facades within about half a percent of a scale established by hand
 * from the same drawings.
 *
 * ## Horizontally, the assumption is stated rather than hidden
 *
 * A render of an orthographic projection has one scale, so the horizontal one
 * is the vertical one. That is an assumption and it is written down as one —
 * and it is checked: the facade's own measured width is compared against the
 * footprint the floor plans give, and the residual is reported whether it
 * agrees or not (§17's "if raster stretch differs in X/Y, report it
 * explicitly"). On project A the check is what settles the question: the side
 * elevations measure 14.6 m wide against a *printed* depth chain of 12.60 m,
 * and it is the attic plan's own footprint — 14.48 m — that shows the
 * elevations right and the chain partial.
 *
 * ## Which way round the facade runs is solved, not assumed
 *
 * §7 forbids labelling left and right by image order. So the direction the
 * building's coordinate runs across each elevation is a *hypothesis*, both
 * values are tried, and what decides is which one lines the elevation's
 * openings up with the plan's. An elevation published under the wrong label,
 * or mirrored, then shows up as a facade whose openings only agree with the
 * plan when read backwards — which is a finding, and is reported as one.
 *
 * PORT_DIRECT (Kotlin).
 */
import type { GrayImage, MaskImage } from '../contracts/raster.js'
import type { RoofEdgeFit, SectionRidge, SectionRoofOptions } from './section-roof.js'
import { fitSkylineLines, findRidge } from './section-roof.js'

/** Which face of the building an elevation looks at. */
export type FacadeView = 'FRONT' | 'REAR' | 'LEFT' | 'RIGHT'

export type ElevationOptions = {
  /** Skyline fitting for a facade outline, which is smoother than a section's. */
  skyline: SectionRoofOptions
  /**
   * How much of the facade's width a near-horizontal top line must span before
   * it counts as a ridge seen along its length rather than a parapet detail.
   */
  plateauWidthFraction: number
  /** Rows sampled through the storey band when the facade's width is measured. */
  widthSampleRows: number
  /** Tolerance on the plan-footprint cross-check, as a fraction of the width. */
  footprintToleranceFraction: number
}

export const DEFAULT_ELEVATION: ElevationOptions = {
  skyline: {
    inlierPx: 3,
    minInliers: 30,
    minRunFraction: 0.05,
    supportGapFraction: 0.04,
    maxLines: 6,
    flatToleranceDeg: 1.5,
    maxPitchDeg: 75,
    minFabricRunPx: 1,
    ridgeReachFraction: 0.1,
  },
  plateauWidthFraction: 0.5,
  widthSampleRows: 24,
  footprintToleranceFraction: 0.06,
}

/** What the outline of a facade is, before anything is in metres. */
export type FacadeSilhouette = {
  assetId: string
  view: FacadeView
  minX: number
  maxX: number
  /** Foot of the facade, where it meets the terrain. */
  groundRow: number
  /** The building's top, from the fitted roofline rather than the tallest pixel. */
  roofTopRow: number
  /** How that was established. */
  roofTopFrom: 'GABLE_APEX' | 'RIDGE_PLATEAU' | 'HIGHEST_PIXEL'
  widthPx: number
  heightPx: number
  skyline: Int32Array
  lines: RoofEdgeFit[]
  apex: SectionRidge | null
  plateau: RoofEdgeFit | null
  /**
   * The facade's width measured through the storey band rather than over the
   * whole silhouette, which is what keeps foliage standing against the wall
   * from widening the building.
   */
  wallSpan: { minX: number; maxX: number; rows: number } | null
  notes: string[]
}

/**
 * The column most rows agree the facade's edge is at.
 *
 * A median is not good enough here and the reason is that the contamination is
 * one-sided: a tree standing against a wall widens the row it is on and
 * nothing ever narrows one, so half the rows can be wrong in the same
 * direction and the median goes with them. The *mode* does not: the building's
 * edge is at the same column on almost every row and a tree's outline is at a
 * different one on each, so the tallest bin is the wall.
 */
const modalEdge = (xs: number[], binPx: number): number => {
  if (xs.length === 0) return Number.NaN
  const counts = new Map<number, number>()
  for (const x of xs) {
    const bin = Math.round(x / binPx)
    counts.set(bin, (counts.get(bin) ?? 0) + 1)
  }
  let bestBin = 0
  let bestCount = -1
  for (const [bin, n] of counts) {
    if (n > bestCount) {
      bestCount = n
      bestBin = bin
    }
  }
  const inBin = xs.filter((x) => Math.round(x / binPx) === bestBin)
  return inBin.reduce((a, b) => a + b, 0) / inBin.length
}

/** Longest contiguous run of `mask` on one row, within the span. */
function longestRun(mask: MaskImage, row: number, x0: number, x1: number): { from: number; to: number } | null {
  let best: { from: number; to: number } | null = null
  let start = -1
  for (let x = x0; x <= x1 + 1; x++) {
    const on = x <= x1 && mask.data[row * mask.width + x] === 1
    if (on) {
      if (start < 0) start = x
      continue
    }
    if (start >= 0) {
      if (best === null || x - 1 - start > best.to - best.from) best = { from: start, to: x - 1 }
      start = -1
    }
  }
  return best
}

/**
 * The outline of one facade, and the top of the building on it.
 *
 * The top is taken from the fitted roofline, never from the tallest pixel. On
 * project A's entrance elevation the tallest pixel is a chimney; on the two
 * side elevations it is a tree. Crossing the two fitted gable slopes, or
 * taking the row of a ridge seen end-on as a long horizontal top, gives the
 * building instead of whatever is standing in front of it (§18).
 */
export function buildFacadeSilhouette(
  assetId: string,
  view: FacadeView,
  mask: MaskImage,
  conditioned: { minX: number; maxX: number; topRow: number; groundRow: number },
  opts: ElevationOptions = DEFAULT_ELEVATION,
): FacadeSilhouette {
  const notes: string[] = []
  const width = conditioned.maxX - conditioned.minX + 1
  const skyline = new Int32Array(mask.width).fill(-1)
  for (let x = conditioned.minX; x <= conditioned.maxX; x++) {
    for (let y = 0; y < mask.height; y++) {
      if (mask.data[y * mask.width + x]) {
        skyline[x] = y
        break
      }
    }
  }

  const lines = fitSkylineLines(skyline, width, opts.skyline)
  const apex = findRidge(lines, width, opts.skyline)
  const plateaus = lines
    .filter((l) => l.kind === 'FLAT' && l.toX - l.fromX >= width * opts.plateauWidthFraction)
    .sort((a, b) => a.intercept + a.slope * a.fromX - (b.intercept + b.slope * b.fromX))
  const plateau = plateaus[0] ?? null

  let roofTopRow = conditioned.topRow
  let roofTopFrom: FacadeSilhouette['roofTopFrom'] = 'HIGHEST_PIXEL'
  if (apex && (!plateau || apex.y <= plateau.intercept + plateau.slope * apex.x)) {
    roofTopRow = apex.y
    roofTopFrom = 'GABLE_APEX'
    notes.push(`the top is the crossing of two fitted slopes at ${apex.leftPitchDeg.toFixed(1)}° and ${apex.rightPitchDeg.toFixed(1)}°`)
  } else if (plateau) {
    roofTopRow = plateau.intercept + plateau.slope * ((plateau.fromX + plateau.toX) / 2)
    roofTopFrom = 'RIDGE_PLATEAU'
    notes.push(
      `the top is a horizontal line spanning ${Math.round(((plateau.toX - plateau.fromX) / width) * 100)}% of the facade, ` +
        'which is a ridge seen along its length',
    )
  } else {
    notes.push('no roofline could be fitted; the top is the highest pixel of the silhouette, whatever that is')
  }

  // The wall span: the longest run on each of a set of rows through the storey
  // band, then the median of those ends. Foliage widens some rows and not
  // others, and a median over two dozen rows is not moved by it.
  const bandTop = Math.round(roofTopRow + (conditioned.groundRow - roofTopRow) * 0.55)
  const bandBottom = Math.round(conditioned.groundRow - (conditioned.groundRow - roofTopRow) * 0.08)
  const lefts: number[] = []
  const rights: number[] = []
  for (let k = 0; k < opts.widthSampleRows; k++) {
    const row = Math.round(bandTop + ((bandBottom - bandTop) * k) / Math.max(1, opts.widthSampleRows - 1))
    if (row < 0 || row >= mask.height) continue
    const run = longestRun(mask, row, conditioned.minX, conditioned.maxX)
    if (!run) continue
    lefts.push(run.from)
    rights.push(run.to)
  }
  const bin = Math.max(2, Math.round(width * 0.006))
  const wallSpan =
    lefts.length >= 4
      ? { minX: Math.round(modalEdge(lefts, bin)), maxX: Math.round(modalEdge(rights, bin)), rows: lefts.length }
      : null
  if (wallSpan) {
    notes.push(
      `the wall spans x ${wallSpan.minX}..${wallSpan.maxX}, the column most of ${wallSpan.rows} rows through the ` +
        `storey band agree its edge is at (${bin} px bins)`,
    )
  }

  return {
    assetId,
    view,
    minX: conditioned.minX,
    maxX: conditioned.maxX,
    groundRow: conditioned.groundRow,
    roofTopRow,
    roofTopFrom,
    widthPx: width,
    heightPx: conditioned.groundRow - roofTopRow + 1,
    skyline,
    lines,
    apex,
    plateau,
    wallSpan,
    notes,
  }
}

/** One height the section knows and the elevation shows. */
export type VerticalAnchor = {
  row: number
  levelM: number
  what: string
}

export type ElevationRegistration = {
  assetId: string
  view: FacadeView
  /** `metres = (rowAtZero - row) / pixelsPerMetreY`. */
  pixelsPerMetreY: number
  rowAtZero: number
  /** `alongM = direction * (col - colAtZero) / pixelsPerMetreX`. */
  pixelsPerMetreX: number
  colAtZero: number
  direction: 1 | -1
  /** `pixelsPerMetreX / pixelsPerMetreY`. One means the raster is not stretched. */
  anisotropy: number
  anchors: VerticalAnchor[]
  horizontalMethod: 'OPENING_CORRESPONDENCE' | 'PLAN_FOOTPRINT' | 'UNRESOLVED'
  /** What the facade measures against what the plans say it should, metres. */
  footprintCheck: { measuredM: number; planM: number; residualM: number } | null
  /** Whether the solved direction agrees with the view the package declares. */
  directionAgreesWithRole: boolean
  confidence: number
  notes: string[]
}

/**
 * Register one facade vertically from the section's own datums.
 *
 * Two anchors, both of them heights the section prints: the terrain at the
 * foot of the silhouette and the ridge at its fitted top. Nothing about the
 * elevation is used to establish a *height* — the elevation supplies two rows
 * and the section supplies the two metres, which is the authority order §12
 * sets out and the reason an elevation silhouette can never override a printed
 * datum.
 */
export function registerVertically(
  silhouette: FacadeSilhouette,
  levels: { ridgeM: number; terrainM: number },
): { pixelsPerMetreY: number; rowAtZero: number; anchors: VerticalAnchor[] } | null {
  const spanPx = silhouette.groundRow - silhouette.roofTopRow
  const spanM = levels.ridgeM - levels.terrainM
  if (spanPx <= 1 || spanM <= 0.5) return null
  const pixelsPerMetreY = spanPx / spanM
  const rowAtZero = silhouette.groundRow + levels.terrainM * pixelsPerMetreY
  return {
    pixelsPerMetreY,
    rowAtZero,
    anchors: [
      { row: silhouette.roofTopRow, levelM: levels.ridgeM, what: `the fitted roofline top (${silhouette.roofTopFrom})` },
      { row: silhouette.groundRow, levelM: levels.terrainM, what: 'the foot of the silhouette, at the terrain the section prints' },
    ],
  }
}

/** An opening's position along a facade, in whichever frame the caller has. */
export type AlongPosition = { id: string; fromM: number; toM: number; centreM: number; widthM: number }

/**
 * Solve which way the facade runs and where its origin is, by correspondence.
 *
 * Every pairing of an elevation opening with a plan opening proposes an
 * offset; every pairing of two such pairings proposes an offset *and* a scale.
 * The proposal explaining the most openings wins. Both directions are tried,
 * which is the whole point: §7 forbids deciding left from right by image
 * order, and this decides it by which reading makes the two drawings agree.
 *
 * The scale it recovers is not used to override the registration — it is
 * reported, because a solved scale that differs from the vertical one is the
 * measurement of raster stretch §17 asks for.
 */
export function solveAlongFacade(
  elevation: readonly AlongPosition[],
  plan: readonly AlongPosition[],
  opts: { toleranceM: number; minMatches: number },
): {
  direction: 1 | -1
  offsetM: number
  scale: number
  matches: Array<{ elevationId: string; planId: string; residualM: number }>
} | null {
  if (elevation.length === 0 || plan.length === 0) return null
  type Best = {
    direction: 1 | -1
    offsetM: number
    scale: number
    matches: Array<{ elevationId: string; planId: string; residualM: number }>
    error: number
  }
  let best: Best | null = null

  const score = (direction: 1 | -1, offsetM: number, scale: number): Best => {
    const used = new Set<string>()
    const matches: Array<{ elevationId: string; planId: string; residualM: number }> = []
    let error = 0
    for (const e of elevation) {
      const mapped = direction * e.centreM * scale + offsetM
      let pick: { p: AlongPosition; d: number } | null = null
      for (const p of plan) {
        if (used.has(p.id)) continue
        const d = Math.abs(p.centreM - mapped)
        if (d > opts.toleranceM) continue
        if (pick === null || d < pick.d) pick = { p, d }
      }
      if (!pick) continue
      used.add(pick.p.id)
      matches.push({ elevationId: e.id, planId: pick.p.id, residualM: pick.d })
      error += pick.d
    }
    return { direction, offsetM, scale, matches, error }
  }

  for (const direction of [1, -1] as const) {
    for (const e of elevation) {
      for (const p of plan) {
        // Offset alone, at the registration's own scale.
        const cand = score(direction, p.centreM - direction * e.centreM, 1)
        if (best === null || cand.matches.length > best.matches.length || (cand.matches.length === best.matches.length && cand.error < best.error)) {
          best = cand
        }
        // Offset and scale together, from a second pairing.
        for (const e2 of elevation) {
          if (e2.id === e.id) continue
          for (const p2 of plan) {
            if (p2.id === p.id) continue
            const de = direction * (e2.centreM - e.centreM)
            if (Math.abs(de) < 0.5) continue
            const scale = (p2.centreM - p.centreM) / de
            if (!Number.isFinite(scale) || scale < 0.7 || scale > 1.4) continue
            const c2 = score(direction, p.centreM - direction * e.centreM * scale, scale)
            if (c2.matches.length > (best?.matches.length ?? 0) || (c2.matches.length === best?.matches.length && c2.error < best.error)) {
              best = c2
            }
          }
        }
      }
    }
  }
  if (!best || best.matches.length < opts.minMatches) return null
  const { error: _error, ...rest } = best
  return rest
}
