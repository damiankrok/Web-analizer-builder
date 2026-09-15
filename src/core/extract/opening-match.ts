/**
 * Which wall an elevation's opening is in — §7, §20, §21.
 *
 * ## The assignment is solved, not assumed
 *
 * §7 forbids labelling an elevation left or right by image order, and §20 asks
 * for facade identity to be part of the match rather than an input to it. Both
 * point at the same thing: a package that publishes four elevations and four
 * exterior facades poses an *assignment* problem, and solving it is strictly
 * better than trusting a filename.
 *
 * So each elevation is scored against each of the building's four sides, read
 * in each of two directions — thirty-two independent correspondences — and the
 * assignment that explains the most openings overall wins. A mirrored
 * elevation, or two elevations published under swapped labels, then shows up
 * as the solved assignment disagreeing with the declared one, which is a
 * finding and is reported as one rather than silently accepted.
 *
 * ## A match is a correspondence, not a nearest neighbour
 *
 * Matching each elevation opening to whichever plan opening happens to be
 * closest produces a match for everything, including for openings that are not
 * there. What is solved instead is one offset for the whole facade, and an
 * opening is matched only if *that* offset puts it on a plan gap. An elevation
 * opening with no plan gap under the facade's own offset stays unmatched, and
 * so does a plan gap the elevation does not show — which §20 requires, because
 * those two are the interesting cases and forcing one-to-one would hide them.
 *
 * PORT_DIRECT (Kotlin).
 */
import type { AlongPosition } from './elevation.js'
import { solveAlongFacade } from './elevation.js'
import type { CandidateStorey, CandidateWall } from './spec-candidate.js'

/** The four sides of a rectangular-ish footprint, named by the frame and not by the building. */
export type FacadeSide = 'MIN_X' | 'MAX_X' | 'MIN_Z' | 'MAX_Z'

export const FACADE_SIDES: readonly FacadeSide[] = ['MIN_X', 'MAX_X', 'MIN_Z', 'MAX_Z']

export type PlanFacade = {
  side: FacadeSide
  /** The coordinate of the facade plane itself. */
  planeM: number
  /** Which axis positions along this facade are measured on. */
  alongAxis: 'X' | 'Z'
  /** Openings on it, positioned along `alongAxis`. */
  openings: AlongPosition[]
  /** The wall each opening belongs to, parallel to `openings`. */
  hosts: Array<{ wallId: string; openingIndex: number; storey: string }>
  /** Extent of the facade itself. */
  fromM: number
  toM: number
}

export type FacadeExtractionOptions = {
  /** How close to the extreme a wall face must be to be *on* that facade, metres. */
  facePlaneToleranceM: number
  /** Openings narrower than this are not major and are not matched (§19). */
  minOpeningWidthM: number
}

export const DEFAULT_FACADE_EXTRACTION: FacadeExtractionOptions = {
  facePlaneToleranceM: 0.45,
  minOpeningWidthM: 0.35,
}

/**
 * The building's four exterior facades, as the floor plans show them.
 *
 * A wall is on a facade when one of its two faces lies in that facade's plane.
 * Faces, not centre lines — Stage 06 went to some trouble to keep a wall's two
 * faces as the measurement (§12 of that stage), and throwing that away here to
 * use a centre line would put every opening half a wall thickness out.
 */
export function planFacades(
  storeys: readonly CandidateStorey[],
  /**
   * Where the building's four faces are, as the caller measured them.
   *
   * Passed in rather than taken as the minimum and maximum of the wall faces,
   * because a floor-plan sheet carries marks outside the building and a band
   * detector picks some of them up: on project A the raw maximum along Z is
   * 19.66 m for a building that is fourteen and a half, and a facade plane put
   * there makes every wall in the house look like the back of a five-metre
   * recess.
   */
  extents: { x: { fromM: number; toM: number }; z: { fromM: number; toM: number } } | null,
  opts: FacadeExtractionOptions = DEFAULT_FACADE_EXTRACTION,
): PlanFacade[] {
  const walls: Array<{ wall: CandidateWall; storey: string }> = []
  for (const s of storeys) for (const wall of s.walls) walls.push({ wall, storey: s.storey })
  if (walls.length === 0) return []

  const faces = (w: CandidateWall): number[] => [w.nearM, w.farM]
  const xFaces = walls.filter(({ wall }) => wall.axis === 'Z').flatMap(({ wall }) => faces(wall))
  const zFaces = walls.filter(({ wall }) => wall.axis === 'X').flatMap(({ wall }) => faces(wall))
  if (xFaces.length === 0 || zFaces.length === 0) return []
  const extremes: Record<FacadeSide, number> = extents
    ? { MIN_X: extents.x.fromM, MAX_X: extents.x.toM, MIN_Z: extents.z.fromM, MAX_Z: extents.z.toM }
    : {
        MIN_X: Math.min(...xFaces),
        MAX_X: Math.max(...xFaces),
        MIN_Z: Math.min(...zFaces),
        MAX_Z: Math.max(...zFaces),
      }

  const out: PlanFacade[] = []
  for (const side of FACADE_SIDES) {
    const alongAxis: 'X' | 'Z' = side === 'MIN_X' || side === 'MAX_X' ? 'Z' : 'X'
    const wallAxis: 'X' | 'Z' = alongAxis === 'Z' ? 'Z' : 'X'
    const plane = extremes[side]
    const openings: AlongPosition[] = []
    const hosts: PlanFacade['hosts'] = []
    let fromM = Number.POSITIVE_INFINITY
    let toM = Number.NEGATIVE_INFINITY
    for (const { wall, storey } of walls) {
      if (wall.axis !== wallAxis) continue
      const onPlane = faces(wall).some((f) => Math.abs(f - plane) <= opts.facePlaneToleranceM)
      if (!onPlane) continue
      fromM = Math.min(fromM, wall.fromM)
      toM = Math.max(toM, wall.toM)
      wall.openings.forEach((o, i) => {
        if (o.widthM < opts.minOpeningWidthM) return
        openings.push({
          id: `${wall.id}#${i}`,
          fromM: o.fromM,
          toM: o.toM,
          centreM: (o.fromM + o.toM) / 2,
          widthM: o.widthM,
        })
        hosts.push({ wallId: wall.id, openingIndex: i, storey })
      })
    }
    out.push({
      side,
      planeM: plane,
      alongAxis,
      openings,
      hosts,
      fromM: Number.isFinite(fromM) ? fromM : 0,
      toM: Number.isFinite(toM) ? toM : 0,
    })
  }
  return out
}

export type ElevationCorrespondence = {
  assetId: string
  side: FacadeSide
  direction: 1 | -1
  offsetM: number
  scale: number
  matches: Array<{ elevationId: string; planId: string; residualM: number }>
  score: number
}

/** The best correspondence of one elevation against one side, in one direction. */
export function scoreAgainstFacade(
  assetId: string,
  elevationOpenings: readonly AlongPosition[],
  facade: PlanFacade,
  toleranceM: number,
): ElevationCorrespondence[] {
  const out: ElevationCorrespondence[] = []
  for (const direction of [1, -1] as const) {
    const solved = solveAlongFacade(
      elevationOpenings.map((o) => ({ ...o, centreM: direction * o.centreM })),
      facade.openings,
      { toleranceM, minMatches: 1 },
    )
    if (!solved) continue
    // `solveAlongFacade` explores directions of its own; the outer loop fixes
    // the sign of the elevation's own coordinate so that the result reports
    // which reading of the facade was used.
    const effective = (solved.direction * direction) as 1 | -1
    const residual = solved.matches.reduce((a, m) => a + m.residualM, 0) / Math.max(1, solved.matches.length)
    out.push({
      assetId,
      side: facade.side,
      direction: effective,
      offsetM: solved.offsetM,
      scale: solved.scale,
      matches: solved.matches,
      // Matches first, then how tightly they sit. A facade explained by six
      // openings at ten centimetres beats one explained by three at two.
      score: solved.matches.length - residual / Math.max(1e-6, toleranceM) / 10,
    })
  }
  return out
}

export type FacadeAssignment = {
  assignments: Array<{ assetId: string; declaredView: string; side: FacadeSide; correspondence: ElevationCorrespondence | null }>
  totalScore: number
  /** Elevations whose solved side contradicts a consistent reading of the declared views. */
  disagreements: string[]
}

/**
 * Assign each elevation to a side of the building, all four at once.
 *
 * Exhaustive over the permutations, which is twenty-four for four elevations
 * and is the right way to do it: choosing the best side for each elevation
 * independently can assign two of them to the same facade, and a building does
 * not have two fronts.
 */
export function assignFacades(
  elevations: ReadonlyArray<{
    assetId: string
    declaredView: string
    openings: AlongPosition[]
    /**
     * Which sides this elevation can possibly be of, from evidence that is not
     * the opening correspondence.
     *
     * The strong one is the roof. The section says which axis it cuts across,
     * so it says which axis the ridge runs along; an elevation whose skyline
     * comes to an apex is looking along the ridge and can only be one of the
     * two facades at the ends of it, and one whose skyline is level across the
     * building is looking at the ridge side-on and can only be one of the
     * other two. Measured on project A, correspondence alone assigns the
     * entrance elevation to a side wall — seven openings can be made to line
     * up on a facade with enough gaps in it — and this constraint is what
     * stops it.
     */
    admissible: FacadeSide[] | null
  }>,
  facades: readonly PlanFacade[],
  toleranceM: number,
): FacadeAssignment {
  const best = new Map<string, ElevationCorrespondence>()
  const scores = new Map<string, number>()
  for (const e of elevations) {
    for (const f of facades) {
      if (e.admissible && !e.admissible.includes(f.side)) continue
      for (const c of scoreAgainstFacade(e.assetId, e.openings, f, toleranceM)) {
        const key = `${e.assetId}|${f.side}`
        const prev = best.get(key)
        if (!prev || c.score > prev.score) {
          best.set(key, c)
          scores.set(key, c.score)
        }
      }
    }
  }

  const sides = facades.map((f) => f.side)
  let bestAssignment: { order: FacadeSide[]; total: number } | null = null
  const permute = (remaining: FacadeSide[], chosen: FacadeSide[]): void => {
    if (chosen.length === elevations.length) {
      let total = 0
      let admissible = true
      chosen.forEach((side, i) => {
        const e = elevations[i]
        if (e.admissible && !e.admissible.includes(side)) admissible = false
        total += scores.get(`${e.assetId}|${side}`) ?? 0
      })
      if (!admissible) return
      if (bestAssignment === null || total > bestAssignment.total) bestAssignment = { order: [...chosen], total }
      return
    }
    for (let i = 0; i < remaining.length; i++) {
      permute([...remaining.slice(0, i), ...remaining.slice(i + 1)], [...chosen, remaining[i]])
    }
  }
  if (sides.length > 0 && elevations.length > 0 && elevations.length <= sides.length) permute(sides, [])

  const chosen: FacadeSide[] = bestAssignment ? (bestAssignment as { order: FacadeSide[] }).order : []
  const assignments = elevations.map((e, i) => ({
    assetId: e.assetId,
    declaredView: e.declaredView,
    side: chosen[i] ?? facades[0]?.side ?? 'MIN_X',
    correspondence: best.get(`${e.assetId}|${chosen[i]}`) ?? null,
  }))

  // A declared-view convention is never assumed, but it *is* checked for
  // self-consistency: opposite views must land on opposite sides, and two
  // elevations must not claim one facade. Anything else is a disagreement.
  const disagreements: string[] = []
  const bySide = new Map<FacadeSide, string[]>()
  for (const a of assignments) {
    const list = bySide.get(a.side) ?? []
    list.push(a.declaredView)
    bySide.set(a.side, list)
  }
  for (const [side, views] of bySide) {
    if (views.length > 1) disagreements.push(`${views.join(' and ')} both solve onto the ${side} facade`)
  }
  const sideOf = (view: string): FacadeSide | undefined => assignments.find((a) => a.declaredView === view)?.side
  const opposite: Record<FacadeSide, FacadeSide> = { MIN_X: 'MAX_X', MAX_X: 'MIN_X', MIN_Z: 'MAX_Z', MAX_Z: 'MIN_Z' }
  for (const [a, b] of [
    ['FRONT', 'REAR'],
    ['LEFT', 'RIGHT'],
  ] as const) {
    const sa = sideOf(a)
    const sb = sideOf(b)
    if (sa && sb && opposite[sa] !== sb) {
      disagreements.push(`${a} solves onto ${sa} and ${b} onto ${sb}, which are not opposite faces of the building`)
    }
  }

  return {
    assignments,
    totalScore: bestAssignment ? (bestAssignment as { total: number }).total : 0,
    disagreements,
  }
}
