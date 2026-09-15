/**
 * Dimension geometry first, text second — STAGE WEB-PIVOT-06 §7.
 *
 * A number on a drawing means nothing until something says what it measures.
 * This module builds the "what": the baselines a chain is drawn on, the ticks
 * that cut them into intervals, and the leader-and-ring callouts that point at
 * openings. Only then is a text run — found independently, by
 * `text-regions.ts`, with no knowledge of any of this — attached to the one
 * interval it labels.
 *
 * Two things follow from that order, and both are §7's point:
 *
 *   - a text run that attaches to nothing is kept, and kept *as* an
 *     unattached observation. It is not a measurement, it is not silently
 *     dropped, and it is not allowed to become a constraint;
 *   - an interval with no text is kept too. A chain that closes can recover
 *     it arithmetically later (§9); a chain that does not, cannot, and the
 *     difference has to survive to be reported.
 *
 * Nothing here reads a number. Attachment is decided on geometry alone — which
 * side of the baseline the run sits on, how far off it, and where along it —
 * so a mis-read digit cannot change what a label is attached to.
 *
 * PORT_DIRECT (Kotlin).
 */
import type { GrayImage } from '../contracts/raster.js'
import type { PixelBox } from '../dimensions/contracts.js'
import {
  detectCallouts,
  DEFAULT_DIMENSION_GEOMETRY,
  type DimensionGeometryOptions,
  type CalloutMarker,
} from '../dimensions/geometry.js'
import {
  strokeMask,
  detectStrokeRuns,
  mergeStrokeRuns,
  DEFAULT_STROKES,
  type StrokeMask,
  type StrokeOptions,
} from './stroke-lines.js'
import type { TextRegion } from './text-regions.js'

export type DimensionStructureOptions = {
  /** Only the callout-ring settings are still taken from the legacy geometry. */
  geometry: DimensionGeometryOptions
  strokes: StrokeOptions
  /** Perpendicular reach searched for an anchor, pixels. */
  anchorReachPx: number
  /**
   * How far past each end of a stroke the anchor search still looks, pixels.
   *
   * Small on purpose. A terminator sitting at the end of the line it
   * terminates is dark on both sides of that line, so the stroke is found a
   * few pixels short of it; looking a little further out recovers the two
   * anchors that say what the line measures. Looking much further out starts
   * collecting whatever else is nearby, and every spurious anchor is another
   * partition a wrong scale can hide in.
   */
  endReachPx: number
  /** Perpendicular stroke pixels an anchor must show within that reach. */
  minAnchorExtent: number
  /**
   * How far a baseline may run past its outermost anchor, pixels.
   *
   * This is what separates a dimension line from every other long thin stroke
   * on a plan. A dimension line is drawn *between* its terminators: it starts
   * at its first tick, stops at its last, and overshoots each only by the
   * small flick a draughtsman's slash adds. A wall edge, a paving joint or a
   * counter front crosses other strokes wherever it happens to and then keeps
   * going, so its outermost crossings sit far inside its ends.
   *
   * Expressed as a fraction of the stroke's own length as well as an absolute
   * floor, because the flick scales with the drawing and a fixed pixel budget
   * is a different rule on a 600 px sheet and a 2000 px one.
   */
  maxOverrunPx: number
  maxOverrunFraction: number
  /**
   * How far off a baseline a label may sit, as a multiple of its own glyph
   * height. Measured in glyph heights rather than pixels so the rule holds at
   * any published resolution.
   */
  maxOffsetRatio: number
  /**
   * How far past a baseline's end a label's centre may sit, as a multiple of
   * glyph height. A label centred on a short interval overhangs it.
   */
  maxOverhangRatio: number
}

export const DEFAULT_DIMENSION_STRUCTURES: DimensionStructureOptions = {
  geometry: DEFAULT_DIMENSION_GEOMETRY,
  strokes: DEFAULT_STROKES,
  anchorReachPx: 7,
  endReachPx: 3,
  minAnchorExtent: 4,
  maxOverrunPx: 10,
  maxOverrunFraction: 0.06,
  maxOffsetRatio: 2.2,
  maxOverhangRatio: 2.5,
}

/**
 * A baseline carrying anchors.
 *
 * `axis` is the axis the line *measures along*, which is the axis it runs
 * along: a horizontal baseline measures X.
 */
export type DimensionBaseline = {
  id: string
  axis: 'X' | 'Y'
  /** Row (X axis) or column (Y axis) the baseline sits on. */
  position: number
  from: number
  to: number
  /** Anchor positions along the axis: ticks, arrows and witness-line feet. */
  anchors: number[]
  strength: number
}

/**
 * A baseline a text run is close enough to be labelling.
 *
 * Deliberately not a measurement, and deliberately not even a span. A plan
 * prints its chains in stacked bands and draws plenty of lines that are not
 * chains at all, so the nearest baseline is very often the wrong one, and
 * nothing in the pixels around a label says which is right. What says is the
 * chain's own arithmetic: at the drawing's scale, the segments of one chain
 * tile the line they are drawn on, in the order their labels are printed.
 * Fitting that needs the numbers, so it happens where the numbers are
 * (`chain-fit.ts`), and this stage only says which lines are in reach.
 */
export type BaselineReach = {
  regionId: string
  baselineId: string
  axis: 'X' | 'Y'
  /** Centre of the run along the baseline's axis, source-native pixels. */
  centrePx: number
  /** Length of the run along that axis. */
  runPx: number
  /** Distance from the run's centre to the baseline. */
  offsetPx: number
  /** Which side of the baseline the run sits on. */
  side: 'BEFORE' | 'AFTER'
}

/** A run that belongs to a callout ring rather than a baseline. */
export type CalloutAttachment = {
  regionId: string
  calloutId: string
  half: 'UPPER' | 'LOWER'
  /** Where the leader ends, when one was traced; the opening it points at. */
  leaderEnd: { x: number; y: number } | null
}

export type DimensionStructures = {
  baselines: DimensionBaseline[]
  callouts: CalloutMarker[]
  /** Every baseline each run is near enough to label, decided later. */
  reaches: BaselineReach[]
  /** Text runs attached to a callout half. */
  calloutAttachments: CalloutAttachment[]
  /**
   * Runs no baseline or ring can reach at all. Kept deliberately: an unowned
   * number is an observation and never a constraint (§7), and losing it hides
   * the failure rather than fixing it.
   */
  unreachableRegionIds: string[]
  inkThreshold: number
  notes: string[]
}

const centreOf = (box: PixelBox): { x: number; y: number } => ({
  x: (box.x0 + box.x1) / 2,
  y: (box.y0 + box.y1) / 2,
})

/** Page white level: the 95th percentile, which is the paper. */
function whiteLevel(gray: GrayImage): number {
  const hist = new Int32Array(256)
  for (let i = 0; i < gray.data.length; i++) hist[gray.data[i]]++
  const target = gray.data.length * 0.95
  let acc = 0
  for (let v = 0; v < 256; v++) {
    acc += hist[v]
    if (acc >= target) return v
  }
  return 255
}

/**
 * Anchors along one stroke: ticks, arrowheads and witness-line feet.
 *
 * All three are the same thing seen from the baseline — a short stroke
 * crossing it — so all three are found by asking where the *perpendicular*
 * stroke mask is present near the line. Reusing the mask is what makes this
 * hold for a chain drawn with slashes and one drawn with arrows without a
 * rule for either.
 *
 * Text is excluded, and has to be. The upright of a `1`, the stem of a `4` and
 * the back of a `5` are all short perpendicular strokes, and a label printed
 * just above its own baseline puts several of them within a tick's reach of
 * it. Left in, the overall dimension across project A's ground plan collects
 * ten anchors instead of two, and the chain it states is cut into pieces that
 * measure nothing. The text is already known — it was found before any of this
 * — so the honest fix is to not look where it is.
 *
 * Adjacent hits are one anchor: a tick is a few pixels wide, and counting each
 * of its columns separately would cut the chain into slivers.
 */
export function anchorsOn(
  run: { position: number; from: number; to: number },
  axis: 'X' | 'Y',
  cross: StrokeMask,
  textMask: Uint8Array | null,
  opts: DimensionStructureOptions,
): number[] {
  const { width, height, data } = cross
  const hits: number[] = []
  // The search runs a little past each end of the stroke. A terminator sits
  // *at* the end of the line it terminates, and being dark on both sides of
  // the line there, it swallows the line's own last pixels: the stroke is
  // found a few pixels short of the tick that ends it. Looking only inside the
  // stroke would then miss both outermost anchors — which are the two that say
  // what the line measures.
  const limit = axis === 'X' ? width - 1 : height - 1
  const from = Math.max(0, run.from - opts.endReachPx)
  const to = Math.min(limit, run.to + opts.endReachPx)
  for (let t = from; t <= to; t++) {
    let extent = 0
    for (let d = -opts.anchorReachPx; d <= opts.anchorReachPx; d++) {
      const x = axis === 'X' ? t : run.position + d
      const y = axis === 'X' ? run.position + d : t
      if (x < 0 || y < 0 || x >= width || y >= height) continue
      if (textMask && textMask[y * width + x] === 1) continue
      if (data[y * width + x] === 1) extent++
    }
    if (extent >= opts.minAnchorExtent) hits.push(t)
  }
  const anchors: number[] = []
  let group: number[] = []
  for (const t of hits) {
    if (group.length > 0 && t - group[group.length - 1] > 2) {
      anchors.push(Math.round(group.reduce((a, b) => a + b, 0) / group.length))
      group = []
    }
    group.push(t)
  }
  if (group.length > 0) anchors.push(Math.round(group.reduce((a, b) => a + b, 0) / group.length))
  return anchors
}

/** Where the drawing's text sits, so a tick search can avoid it. */
export function textOccupancy(
  width: number,
  height: number,
  regions: readonly TextRegion[],
  padPx = 2,
): Uint8Array {
  const mask = new Uint8Array(width * height)
  for (const r of regions) {
    const x0 = Math.max(0, Math.floor(r.box.x0) - padPx)
    const y0 = Math.max(0, Math.floor(r.box.y0) - padPx)
    const x1 = Math.min(width - 1, Math.ceil(r.box.x1) + padPx)
    const y1 = Math.min(height - 1, Math.ceil(r.box.y1) + padPx)
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) mask[y * width + x] = 1
  }
  return mask
}

/** Baselines with their anchors and the intervals those anchors cut. */
export function detectBaselines(
  gray: GrayImage,
  regions: readonly TextRegion[],
  opts: DimensionStructureOptions = DEFAULT_DIMENSION_STRUCTURES,
): { baselines: DimensionBaseline[]; ink: number; notes: string[] } {
  // Still needed by the legacy callout-ring detector, which works on a
  // threshold; the baselines themselves no longer use one.
  const ink = Math.max(40, Math.round(whiteLevel(gray) * opts.geometry.inkFraction))

  const horizontal = strokeMask(gray, 'X', opts.strokes)
  const vertical = strokeMask(gray, 'Y', opts.strokes)
  const runs: Array<{ run: { position: number; from: number; to: number; coverage: number }; axis: 'X' | 'Y' }> = [
    ...mergeStrokeRuns(detectStrokeRuns(horizontal, 'X', opts.strokes), opts.strokes.radiusPx).map((run) => ({
      run,
      axis: 'X' as const,
    })),
    ...mergeStrokeRuns(detectStrokeRuns(vertical, 'Y', opts.strokes), opts.strokes.radiusPx).map((run) => ({
      run,
      axis: 'Y' as const,
    })),
  ]
  const notes: string[] = [`${runs.length} thin strokes`]
  const textMask = textOccupancy(gray.width, gray.height, regions)

  const baselines: DimensionBaseline[] = []
  for (const { run, axis } of runs) {
    const anchors = anchorsOn(run, axis, axis === 'X' ? vertical : horizontal, textMask, opts)
    // A baseline needs at least one measured interval. One is enough: an
    // overall dimension is drawn on its own line with an anchor at each end,
    // and demanding more discards exactly the label that pins a chain's total.
    if (anchors.length < 2) continue
    const sorted = [...anchors].sort((a, b) => a - b)
    const overrun = Math.max(opts.maxOverrunPx, (run.to - run.from) * opts.maxOverrunFraction)
    if (sorted[0] - run.from > overrun) continue
    if (run.to - sorted[sorted.length - 1] > overrun) continue
    baselines.push({
      id: `${axis === 'X' ? 'hl' : 'vl'}_${run.position}_${run.from}`,
      axis,
      position: run.position,
      from: run.from,
      to: run.to,
      anchors: sorted,
      strength: run.coverage,
    })
  }
  notes.push(
    `${baselines.length} baselines carrying ${baselines.reduce((n, b) => n + b.anchors.length, 0)} anchors`,
  )
  return { baselines, ink, notes }
}

/**
 * Enumerate, for every text run, the baselines that could own it.
 *
 * Reading direction is *not* used to narrow this. It is tempting — surely a
 * rotated label belongs to a vertical chain — and it is wrong: project A's
 * attic plan prints its top chain, which measures across the sheet, with every
 * label rotated. A rule that looked right on one drawing would have silently
 * discarded that whole chain on the next. What a label measures is settled by
 * arithmetic downstream, not by which way up it is printed.
 *
 * A callout ring is the exception and is decided here, because a ring is an
 * unambiguous container: a run inside one is labelling that opening and
 * nothing else.
 */
export function reachableBaselines(
  regions: readonly TextRegion[],
  baselines: readonly DimensionBaseline[],
  callouts: readonly CalloutMarker[],
  opts: DimensionStructureOptions = DEFAULT_DIMENSION_STRUCTURES,
): {
  reaches: BaselineReach[]
  calloutAttachments: CalloutAttachment[]
  unreachableRegionIds: string[]
} {
  const reaches: BaselineReach[] = []
  const calloutAttachments: CalloutAttachment[] = []
  const reached = new Set<string>()

  // One entry per *region*: a vertical run offered in two reading directions
  // is one label in one place, so its reach is enumerated once.
  const byRegion = new Map<string, TextRegion>()
  for (const r of regions) if (!byRegion.has(r.regionId)) byRegion.set(r.regionId, r)

  for (const region of byRegion.values()) {
    const c = centreOf(region.box)
    const h = Math.max(1, region.glyphHeightPx)

    let inRing: { callout: CalloutMarker; half: 'UPPER' | 'LOWER' } | null = null
    for (const callout of callouts) {
      const inside = (b: PixelBox): boolean => c.x >= b.x0 && c.x <= b.x1 && c.y >= b.y0 && c.y <= b.y1
      if (inside(callout.upper)) inRing = { callout, half: 'UPPER' }
      else if (inside(callout.lower)) inRing = { callout, half: 'LOWER' }
      if (inRing) break
    }
    if (inRing) {
      calloutAttachments.push({
        regionId: region.regionId,
        calloutId: inRing.callout.id,
        half: inRing.half,
        leaderEnd: inRing.callout.leaderEnd,
      })
      reached.add(region.regionId)
      continue
    }

    for (const baseline of baselines) {
      const along = baseline.axis === 'X' ? c.x : c.y
      const offset = Math.abs((baseline.axis === 'X' ? c.y : c.x) - baseline.position)
      if (offset > h * opts.maxOffsetRatio) continue
      if (along < baseline.from - h * opts.maxOverhangRatio) continue
      if (along > baseline.to + h * opts.maxOverhangRatio) continue
      reaches.push({
        regionId: region.regionId,
        baselineId: baseline.id,
        axis: baseline.axis,
        centrePx: along,
        runPx: baseline.axis === 'X' ? region.box.x1 - region.box.x0 : region.box.y1 - region.box.y0,
        offsetPx: offset,
        side: (baseline.axis === 'X' ? c.y : c.x) < baseline.position ? 'BEFORE' : 'AFTER',
      })
      reached.add(region.regionId)
    }
  }

  const unreachableRegionIds = [...byRegion.keys()].filter((id) => !reached.has(id)).sort()
  return { reaches, calloutAttachments, unreachableRegionIds }
}

/** Everything §7 asks for, in one pass over a source-native drawing. */
export function detectDimensionStructures(
  gray: GrayImage,
  regions: readonly TextRegion[],
  opts: DimensionStructureOptions = DEFAULT_DIMENSION_STRUCTURES,
): DimensionStructures {
  const { baselines, ink, notes } = detectBaselines(gray, regions, opts)
  const callouts = detectCallouts(gray, opts.geometry, ink)
  notes.push(`${callouts.length} callout rings`)
  const { reaches, calloutAttachments, unreachableRegionIds } = reachableBaselines(
    regions,
    baselines,
    callouts,
    opts,
  )
  const withReach = new Set(reaches.map((r) => r.regionId)).size
  notes.push(
    `${reaches.length} run/baseline reaches for ${withReach} runs, ` +
      `${calloutAttachments.length} runs in callout rings, ${unreachableRegionIds.length} runs out of reach`,
  )

  return {
    baselines,
    callouts,
    reaches,
    calloutAttachments,
    unreachableRegionIds,
    inkThreshold: ink,
    notes,
  }
}
