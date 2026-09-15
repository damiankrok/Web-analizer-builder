/**
 * Rooflights, stacks, and the things a facade does in depth — §22, §23, §24.
 *
 * These three sections share a rule and it is the reason they share a file:
 * **recover what the orthographic sources support, and mark the rest
 * unresolved.** Not "estimate it from the render" — §4 forbids that outright —
 * and not "leave it out", because an opening the elevation clearly shows is
 * evidence even when the plan is silent about it.
 *
 * So each of these produces observations with a resolution status, and the
 * three statuses mean three different things:
 *
 *   - `RESOLVED` — two sources show it and they agree;
 *   - `CONFLICTED` — two sources show it and they do not;
 *   - `UNRESOLVED` — one source shows it and nothing else can confirm it, or
 *     the quantity asked for (a depth, a shaft's route between storeys) is not
 *     one an orthographic drawing can answer.
 *
 * §22's last line and §23's Marcówki flue are both instances of the third, and
 * they are the cases this file exists to get right. A rooflight seen on one
 * elevation and nowhere else is not a rooflight the pipeline is sure of; a
 * stack seen on the roof and a flue seen in a plan two storeys down are not
 * known to be one shaft, and joining them would assert a route no drawing
 * shows.
 *
 * PORT_DIRECT (Kotlin).
 */
import type { EvidenceRef, ResolutionStatus } from './candidate-evidence.js'
import type { RoofEdgeFit } from './section-roof.js'
import type { CandidateStorey } from './spec-candidate.js'
import type { FacadeOpening } from './facade-openings.js'

export type ShellFeatureOptions = {
  /** A stack is at least this wide, metres: a flue has a flue in it. */
  minStackWidthM: number
  /** …and narrower than this. */
  maxStackWidthM: number
  /** …and rises at least this far above the roofline before it is one. */
  minStackRiseM: number
  /** How far apart a stack and a plan footprint may sit and still be the same thing, metres. */
  stackMatchToleranceM: number
  /** A plan void up to this area may be a flue rather than a room, m². */
  maxFlueAreaM2: number
  /** A recess must be set back at least this far to be a recess, metres. */
  minRecessDepthM: number
  /** …and no further: past this it is the far side of the building. */
  maxRecessDepthM: number
  /** …and be at least this wide. */
  minRecessWidthM: number
  /** How much of a candidate's width another wall may stand in front of, 0..1. */
  maxOccludedFraction: number
  /** How close to a recess's end a return must start, metres. */
  returnToleranceM: number
  /** A rooflight is at least this far above the eave to be in the roof and not the wall. */
  minRooflightAboveEaveM: number
}

export const DEFAULT_SHELL_FEATURES: ShellFeatureOptions = {
  minStackWidthM: 0.25,
  maxStackWidthM: 1.6,
  minStackRiseM: 0.25,
  stackMatchToleranceM: 1.0,
  maxFlueAreaM2: 2.0,
  minRecessDepthM: 0.6,
  maxRecessDepthM: 4.5,
  minRecessWidthM: 1.0,
  maxOccludedFraction: 0.25,
  returnToleranceM: 0.8,
  minRooflightAboveEaveM: 0.15,
}

// --------------------------------------------------------------------------
// §23 — stacks above the roofline
// --------------------------------------------------------------------------

/** A narrow thing standing above the roof on one elevation. */
export type StackObservation = {
  id: string
  assetId: string
  view: string
  /** Columns it occupies, in the elevation's own pixels. */
  fromPx: number
  toPx: number
  /** Its top, and how far it rises above the roofline under it. */
  topRowPx: number
  widthM: number
  riseM: number
  topLevelM: number
  confidence: number
  why: string
}

/**
 * Find the narrow protrusions standing above a facade's fitted roofline.
 *
 * The roofline is the fitted lines, not the skyline, and that is what makes
 * this work: a chimney *is* part of the skyline, so a skyline-based test can
 * only find it by comparing the skyline against something the chimney did not
 * contribute to. The fitted lines are exactly that, because a thirty-pixel
 * stack never wins enough support to become one.
 *
 * The lines are **extrapolated** rather than used only where they were
 * supported, and that is not a detail either. A stack interrupts the skyline,
 * so the fit on either side of it stops at its edge and the columns the stack
 * occupies are the ones with no fitted line over them — precisely the columns
 * that need one. On project A's entrance elevation the gable's two slopes are
 * supported over x 376..683 and the chimney stands at x 700..740, so a test
 * that needs support at x finds nothing at all.
 *
 * Only the best-supported lines are extrapolated, because a line fitted to
 * thirty samples of a tree is not a roof and extending it would put a roof
 * wherever the tree was.
 */
export function findStacks(
  assetId: string,
  view: string,
  skyline: Int32Array,
  lines: readonly RoofEdgeFit[],
  fromX: number,
  toX: number,
  pixelsPerMetre: number,
  rowAtZero: number,
  /** A stack terminates above the roof, so anything topping out below the eave is not one. */
  eaveLevelM: number | null,
  opts: ShellFeatureOptions = DEFAULT_SHELL_FEATURES,
): StackObservation[] {
  if (lines.length === 0 || !(pixelsPerMetre > 0)) return []
  const primary = [...lines].sort((a, b) => b.inliers - a.inliers).slice(0, 2)
  const roofAt = (x: number): number | null => {
    let best: number | null = null
    for (const l of primary) {
      // Extrapolated, but only as far as the line is itself supported: a
      // hundred-pixel plane does not describe the roof five hundred pixels
      // away from where it was seen.
      const reach = Math.max(40, (l.toX - l.fromX) * 1.5)
      if (x < l.fromX - reach || x > l.toX + reach) continue
      const y = l.intercept + l.slope * x
      if (best === null || y > best) best = y
    }
    return best
  }
  const risePx = opts.minStackRiseM * pixelsPerMetre
  const above: boolean[] = []
  for (let x = fromX; x <= toX; x++) {
    const sky = skyline[x]
    const roof = roofAt(x)
    above.push(sky >= 0 && roof !== null && roof - sky >= risePx)
  }
  const out: StackObservation[] = []
  let start = -1
  for (let i = 0; i <= above.length; i++) {
    if (i < above.length && above[i]) {
      if (start < 0) start = i
      continue
    }
    if (start < 0) continue
    const a = fromX + start
    const b = fromX + i - 1
    start = -1
    const widthM = (b - a + 1) / pixelsPerMetre
    if (widthM > opts.maxStackWidthM || widthM < opts.minStackWidthM) continue
    let topRowPx = Number.POSITIVE_INFINITY
    for (let x = a; x <= b; x++) if (skyline[x] >= 0) topRowPx = Math.min(topRowPx, skyline[x])
    const roof = roofAt((a + b) / 2)
    if (!Number.isFinite(topRowPx) || roof === null) continue
    const topLevelM = (rowAtZero - topRowPx) / pixelsPerMetre
    // A chimney finishes above the roof it passes through. Something narrow
    // standing proud of a roof slope near its eave is a downpipe, a corner of
    // a tree, or the edge of the render — not a stack.
    if (eaveLevelM !== null && topLevelM < eaveLevelM) continue
    out.push({
      id: `stack${out.length}`,
      assetId,
      view,
      fromPx: a,
      toPx: b,
      topRowPx,
      widthM,
      riseM: (roof - topRowPx) / pixelsPerMetre,
      topLevelM,
      confidence: 0.6,
      why:
        `${b - a + 1} px of silhouette standing ${((roof - topRowPx) / pixelsPerMetre).toFixed(2)} m above the fitted ` +
        'roofline, and narrow enough to be a stack rather than a mass',
    })
  }
  return out
}

/** Small enclosed voids in a plan: flues, ducts, and whatever else is that size. */
export type PlanVoid = {
  id: string
  storey: string
  areaM2: number
  box: { x0: number; z0: number; x1: number; z1: number }
}

export function planVoids(
  storeys: readonly CandidateStorey[],
  opts: ShellFeatureOptions = DEFAULT_SHELL_FEATURES,
): PlanVoid[] {
  const out: PlanVoid[] = []
  for (const s of storeys) {
    for (const r of s.rooms) {
      if (r.areaM2 > opts.maxFlueAreaM2) continue
      out.push({ id: r.id, storey: s.storey, areaM2: r.areaM2, box: r.box })
    }
  }
  return out
}

export type StackMatch = {
  stack: StackObservation
  /** The plan void it lines up with, where one does. */
  planVoid: PlanVoid | null
  residualM: number | null
  crossSource: 'MATCHED' | 'CONFLICT' | 'UNRESOLVED'
  why: string
}

/**
 * Match a stack seen on an elevation against a void seen in a plan.
 *
 * One coordinate is all an elevation gives — the position along the facade —
 * so that is all that is compared, and a match on one coordinate is recorded
 * as a match on one coordinate. Where the elevation shows a stack and no plan
 * void lines up under it, the result is `UNRESOLVED` rather than `CONFLICT`:
 * the plans may simply not cut through it, and §23 wants the Marcówki flue's
 * ambiguity preserved rather than forced into a continuous shaft.
 */
export function matchStacks(
  stacks: readonly StackObservation[],
  voids: readonly PlanVoid[],
  alongOf: (v: PlanVoid) => number,
  alongOfStack: (s: StackObservation) => number,
  opts: ShellFeatureOptions = DEFAULT_SHELL_FEATURES,
): StackMatch[] {
  return stacks.map((stack) => {
    const along = alongOfStack(stack)
    let best: { v: PlanVoid; d: number } | null = null
    for (const v of voids) {
      const d = Math.abs(alongOf(v) - along)
      if (best === null || d < best.d) best = { v, d }
    }
    if (!best || best.d > opts.stackMatchToleranceM) {
      return {
        stack,
        planVoid: null,
        residualM: best ? best.d : null,
        crossSource: 'UNRESOLVED',
        why:
          best === null
            ? 'the plans show no void small enough to be a flue, so nothing confirms or contradicts this stack'
            : `the nearest plan void sits ${best.d.toFixed(2)} m away along the facade, which is further than a stack ` +
              'and its own flue would be. Whether they are the same shaft is not something these drawings settle (§23)',
      }
    }
    return {
      stack,
      planVoid: best.v,
      residualM: best.d,
      crossSource: 'MATCHED',
      why:
        `a ${best.v.areaM2.toFixed(2)} m² void in the ${best.v.storey} plan sits ${best.d.toFixed(2)} m from this stack ` +
        'along the facade. That is one coordinate agreeing, and is recorded as one coordinate agreeing',
    }
  })
}

// --------------------------------------------------------------------------
// §22 — openings in a roof plane
// --------------------------------------------------------------------------

export type RooflightObservationLite = {
  id: string
  assetId: string
  view: string
  /** Position along the facade and level, metres. */
  alongFromM: number
  alongToM: number
  sillLevelM: number
  headLevelM: number
  widthM: number
  heightM: number
  /** Which roof edge of the section it is above, where that is known. */
  aboveEaveByM: number
  status: ResolutionStatus
  confidence: number
  why: string
}

/**
 * Openings that fall in the roof rather than in a wall.
 *
 * The test is the eave: an opening whose sill is above the level at which the
 * roof meets the wall is not in the wall, because there is no wall there. It
 * is a rooflight, a roof window, or glazing in a gable — and which of those it
 * is depends on the roof's topology at that point, which this does not claim
 * to know.
 *
 * Every one of these is `UNRESOLVED` unless a second source shows it. §22 is
 * explicit about that, and on these packages it is usually the case: a
 * rooflight appears on one elevation and on no other drawing at all.
 */
export function rooflightsFromElevation(
  assetId: string,
  view: string,
  openings: ReadonlyArray<FacadeOpening & { alongFromM: number; alongToM: number; sillLevelM: number; headLevelM: number }>,
  eaveLevelM: number,
  confirmedBy: (o: { alongFromM: number; alongToM: number }) => EvidenceRef[] = () => [],
  opts: ShellFeatureOptions = DEFAULT_SHELL_FEATURES,
): RooflightObservationLite[] {
  const out: RooflightObservationLite[] = []
  for (const o of openings) {
    const aboveEaveByM = o.sillLevelM - eaveLevelM
    if (aboveEaveByM < opts.minRooflightAboveEaveM) continue
    const others = confirmedBy(o)
    out.push({
      id: `roofop${out.length}`,
      assetId,
      view,
      alongFromM: o.alongFromM,
      alongToM: o.alongToM,
      sillLevelM: o.sillLevelM,
      headLevelM: o.headLevelM,
      widthM: Math.abs(o.alongToM - o.alongFromM),
      heightM: o.headLevelM - o.sillLevelM,
      aboveEaveByM,
      status: others.length > 0 ? 'RESOLVED' : 'UNRESOLVED',
      confidence: others.length > 0 ? Math.min(0.85, o.confidence) : Math.min(0.5, o.confidence),
      why:
        others.length > 0
          ? `its sill is ${aboveEaveByM.toFixed(2)} m above the eave, so it is in the roof, and ${others.length} other source(s) show it`
          : `its sill is ${aboveEaveByM.toFixed(2)} m above the eave, so it is in the roof — but only this elevation ` +
            'shows it, and one weak source is not a confirmation (§22)',
    })
  }
  return out
}

// --------------------------------------------------------------------------
// §24 — what a facade does in depth
// --------------------------------------------------------------------------

export type RecessObservation = {
  id: string
  side: string
  /** Extent along the facade. */
  fromM: number
  toM: number
  /** How far the back wall sits behind the facade plane. */
  depthM: number
  storey: string
  wallId: string
  confidence: number
  why: string
}

/**
 * Recesses, from the plan and from the plan only.
 *
 * A facade's plane is where its outermost walls are. A wall parallel to it,
 * set back, and still bounding the building is the back of a recess — a
 * loggia, a covered entrance, a sheltered terrace — and how far back it sits
 * is a plan measurement and therefore a real one.
 *
 * Depth is the whole point. §24 says that a depth no orthographic source
 * constrains must be left unresolved, and the corollary is that a depth the
 * plan *does* constrain should be taken from the plan and not from a render.
 * This takes it from the plan.
 */
export function recessesFromPlan(
  storeys: readonly CandidateStorey[],
  facadePlaneM: number,
  side: string,
  wallAxis: 'X' | 'Z',
  /** +1 when the building lies at coordinates greater than the plane. */
  inward: 1 | -1,
  opts: ShellFeatureOptions = DEFAULT_SHELL_FEATURES,
): RecessObservation[] {
  /**
   * A recess is bounded. Without this test a set-back wall is indistinguishable
   * from the building simply being narrower there — an L-shaped plan reads as a
   * four-metre recess, which on project A is exactly what happened. What makes
   * a recess a recess is that it has *returns*: walls running back from the
   * facade plane to the set-back wall at each of its ends. The gold fixture
   * models them under that name for the same reason.
   */
  const hasReturn = (
    perpendicular: CandidateStorey['walls'],
    atM: number,
    depthM: number,
  ): boolean =>
    perpendicular.some((w) => {
      const near = inward > 0 ? Math.min(w.nearM, w.farM) : Math.max(w.nearM, w.farM)
      const far = inward > 0 ? Math.max(w.nearM, w.farM) : Math.min(w.nearM, w.farM)
      if (Math.abs(near - atM) > opts.returnToleranceM && Math.abs(far - atM) > opts.returnToleranceM) return false
      const from = inward * (w.fromM - facadePlaneM)
      const to = inward * (w.toM - facadePlaneM)
      const lo = Math.min(from, to)
      const hi = Math.max(from, to)
      // It must reach from near the facade plane to near the set-back wall.
      return lo <= opts.returnToleranceM && hi >= depthM - opts.returnToleranceM
    })

  const out: RecessObservation[] = []
  for (const s of storeys) {
    const parallel = s.walls.filter((w) => w.axis === wallAxis)
    if (parallel.length === 0) continue
    // A storey that does not reach this facade cannot have a recess in it.
    // Project A's attic stops where the garage wing begins, four metres behind
    // the ground floor's east face; calling that a four-metre recess confuses
    // a storey being smaller than the one under it with a hole in a wall.
    const reach = parallel.map((w) => (inward > 0 ? Math.min(w.nearM, w.farM) : Math.max(w.nearM, w.farM)))
    const closest = inward > 0 ? Math.min(...reach) : Math.max(...reach)
    if (inward * (closest - facadePlaneM) > opts.minRecessDepthM) continue
    for (const wall of parallel) {
      const nearest = inward > 0 ? Math.min(wall.nearM, wall.farM) : Math.max(wall.nearM, wall.farM)
      const depthM = inward * (nearest - facadePlaneM)
      if (depthM < opts.minRecessDepthM || depthM > opts.maxRecessDepthM) continue
      const widthM = wall.toM - wall.fromM
      if (widthM < opts.minRecessWidthM) continue
      // The test that makes this a recess and not an internal wall: stand at
      // the facade plane and look in. A wall with another wall in front of it
      // is not visible from outside, so it is not the back of anything — it is
      // just a wall inside a building. Without this test every parallel
      // partition in the plan is reported as a recess, which on project A is a
      // hundred and seventy-seven of them.
      let occluded = 0
      for (const other of parallel) {
        if (other.id === wall.id) continue
        const otherNear = inward > 0 ? Math.min(other.nearM, other.farM) : Math.max(other.nearM, other.farM)
        const otherDepth = inward * (otherNear - facadePlaneM)
        if (otherDepth >= depthM - 0.05) continue
        const overlap = Math.min(wall.toM, other.toM) - Math.max(wall.fromM, other.fromM)
        if (overlap > 0) occluded += overlap
      }
      if (occluded > widthM * opts.maxOccludedFraction) continue
      const perpendicular = s.walls.filter((w) => w.axis !== wallAxis)
      const returns = [hasReturn(perpendicular, wall.fromM, depthM), hasReturn(perpendicular, wall.toM, depthM)]
      if (!returns[0] || !returns[1]) continue
      out.push({
        id: `recess${out.length}`,
        side,
        fromM: wall.fromM,
        toM: wall.toM,
        depthM,
        storey: s.storey,
        wallId: wall.id,
        confidence: 0.5,
        why:
          `a ${widthM.toFixed(2)} m run of wall lying ${depthM.toFixed(2)} m behind the ${side} facade plane, with nothing ` +
          `of the building in front of ${((occluded / widthM) * 100).toFixed(0)}% of it and a return at each end reaching ` +
          'back from the facade plane. The depth is a plan measurement, which is the only kind that can measure one',
      })
    }
  }
  return out
}

/** A horizontal band on a facade: a balcony slab's edge, a railing, a canopy. */
export type FacadeBandObservation = {
  id: string
  view: string
  fromM: number
  toM: number
  bottomLevelM: number
  topLevelM: number
  kind: 'SLAB_EDGE' | 'RAILING' | 'BAND'
  confidence: number
  why: string
}

/**
 * Horizontal bands on a facade, from the elevation's own openings and edges.
 *
 * A balcony reads as a slab edge with a railing above it, and both are
 * horizontal, wide and shallow. Whether the thing behind the railing projects
 * or is recessed is *not* readable from an elevation — that is a depth — so
 * this reports the band and leaves the depth to the plan or to nothing.
 */
export function bandsFromOpenings(
  view: string,
  openings: ReadonlyArray<{ alongFromM: number; alongToM: number; sillLevelM: number; headLevelM: number; confidence: number }>,
  minWidthM = 1.5,
  maxHeightM = 1.3,
): FacadeBandObservation[] {
  const out: FacadeBandObservation[] = []
  for (const o of openings) {
    const widthM = Math.abs(o.alongToM - o.alongFromM)
    const heightM = o.headLevelM - o.sillLevelM
    if (widthM < minWidthM || heightM > maxHeightM || heightM <= 0) continue
    if (widthM / heightM < 2.2) continue
    out.push({
      id: `band${out.length}`,
      view,
      fromM: Math.min(o.alongFromM, o.alongToM),
      toM: Math.max(o.alongFromM, o.alongToM),
      bottomLevelM: o.sillLevelM,
      topLevelM: o.headLevelM,
      kind: heightM < 0.35 ? 'SLAB_EDGE' : 'RAILING',
      confidence: Math.min(0.6, o.confidence),
      why:
        `a ${widthM.toFixed(2)} m by ${heightM.toFixed(2)} m horizontal band on the ${view} elevation. What lies behind ` +
        'it is a depth, and an elevation cannot measure one',
    })
  }
  return out
}
