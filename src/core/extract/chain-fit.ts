/**
 * Fitting a dimension chain to a baseline — STAGE WEB-PIVOT-06 §8, §9.
 *
 * A chain is not a bag of independent measurements. It is a partition: its
 * segments run end to end along one line, each starting where the last
 * finished, in the order the labels are printed. That structure is the single
 * most useful thing known about a plan's dimensions, and using it is what
 * makes the difference between reading a drawing and finding numbers that
 * happen to fit.
 *
 * The problem it solves is concrete. A plan is dense, so a baseline collects
 * crossings that look like ticks; allowing a label to claim any pair of
 * anchors then makes a baseline with twenty anchors able to supply a plausible
 * span for almost any value, and a scale half again too large finds a
 * self-consistent reading of the whole sheet. On project A's attic plan that
 * wrong reading is supported by eleven labels and is entirely wrong.
 *
 * Requiring the segments to tile removes it. At the wrong scale the spans do
 * not join up: each label's span overshoots into the next label's, and no
 * monotone partition exists. At the right scale they fit together exactly,
 * because that is how the draughtsman drew them.
 *
 * The fit is exact rather than greedy — a small dynamic program over (label,
 * anchor) — because a greedy walk commits to an early segment that a later one
 * then cannot follow, which is the same failure in slower motion.
 *
 * PORT_DIRECT (Kotlin).
 */

export type ChainLabel = {
  /** Identifies the label to the caller; nothing here interprets it. */
  id: string
  /** Centimetres the label states. */
  valueCm: number
  /** Centre of the printed run along the baseline's axis, pixels. */
  centrePx: number
  /** Length of the printed run along that axis, pixels. */
  runPx: number
}

export type ChainFitOptions = {
  /** How far a segment's implied scale may sit from the proposed one. */
  scaleTolerance: number
  /** Shortest segment, pixels. */
  minSegmentPx: number
  /**
   * How far outside its own segment a label's centre may sit, as a multiple of
   * the label's printed length. A label longer than what it measures is pushed
   * off the end; one that fits is inside.
   */
  overhangRatio: number
}

export const DEFAULT_CHAIN_FIT: ChainFitOptions = {
  scaleTolerance: 0.06,
  minSegmentPx: 8,
  overhangRatio: 0.75,
}

export type ChainSegment = {
  labelId: string
  fromAnchor: number
  toAnchor: number
  fromPx: number
  toPx: number
  lengthPx: number
  valueCm: number
  /** How far this segment's own ratio sits from the proposed scale. */
  scaleError: number
}

export type ChainFit = {
  segments: ChainSegment[]
  /** Total pixel length the fit accounts for. */
  explainedPx: number
  /**
   * What the fit is worth: one point per label read, discounted by how far its
   * segment sits from the proposed scale.
   *
   * Labels rather than pixels. Every partition of the same anchors between the
   * same two ends accounts for exactly the same pixels, so pixel length cannot
   * tell a partition that lands squarely from one that merely stays inside
   * tolerance. How squarely each segment lands can.
   */
  score: number
  /** Labels on this baseline that the fit could not place. */
  unplacedLabelIds: string[]
}

/**
 * Whether a label printed at `centrePx` could be the one measuring
 * `from..to`.
 *
 * Centred if it fits; pushed off the end by about half its own length if it
 * does not. Nothing else is admitted: a label merely *near* a span is a
 * different label's.
 */
function labelFits(label: ChainLabel, from: number, to: number, opts: ChainFitOptions): boolean {
  const span = to - from
  const distance = label.centrePx < from ? from - label.centrePx : label.centrePx > to ? label.centrePx - to : 0
  if (distance === 0) return true
  if (span >= label.runPx) return false
  return distance <= label.runPx * opts.overhangRatio
}

/**
 * The best chain the anchors and labels admit at a proposed scale.
 *
 * Labels must be given in printed order along the axis, and anchors sorted.
 * A label may be left unplaced — a drawing has labels that belong to other
 * lines, and forcing every one of them somewhere is how a fit becomes
 * fiction — but a placed one takes a span that starts where the previous
 * placed span ended or later, never before.
 */
export function fitChain(
  anchors: readonly number[],
  labels: readonly ChainLabel[],
  pxPerCm: number,
  opts: ChainFitOptions = DEFAULT_CHAIN_FIT,
): ChainFit {
  const n = labels.length
  const m = anchors.length
  if (n === 0 || m < 2 || pxPerCm <= 0) {
    return { segments: [], explainedPx: 0, score: 0, unplacedLabelIds: labels.map((l) => l.id) }
  }

  // best[i][k]: the best score reachable using labels i.. from anchor k.
  const best: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m).fill(0))
  // choice[i][k]: the anchor a placed label i runs to, or -1 for "not placed".
  const choice: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m).fill(-1))

  for (let i = n - 1; i >= 0; i--) {
    const label = labels[i]
    const wantPx = label.valueCm * pxPerCm
    const slack = wantPx * opts.scaleTolerance
    for (let k = m - 1; k >= 0; k--) {
      // Leave this label unplaced, or step past this anchor.
      let bestValue = best[i + 1][k]
      let bestTo = -1
      if (k + 1 < m && best[i][k + 1] > bestValue) {
        bestValue = best[i][k + 1]
        bestTo = -2 // "advance the anchor"
      }
      if (label.valueCm > 0) {
        for (let j = k + 1; j < m; j++) {
          const lengthPx = anchors[j] - anchors[k]
          if (lengthPx < opts.minSegmentPx) continue
          if (lengthPx > wantPx + slack) break // anchors ascend; no later j is closer
          if (lengthPx < wantPx - slack) continue
          if (!labelFits(label, anchors[k], anchors[j], opts)) continue
          const error = Math.abs(lengthPx / label.valueCm - pxPerCm) / pxPerCm
          const value = Math.max(0, 1 - error / opts.scaleTolerance) + best[i + 1][j]
          if (value > bestValue) {
            bestValue = value
            bestTo = j
          }
        }
      }
      best[i][k] = bestValue
      choice[i][k] = bestTo
    }
  }

  const segments: ChainSegment[] = []
  const placed = new Set<string>()
  let i = 0
  let k = 0
  while (i < n && k < m) {
    const to = choice[i][k]
    if (to === -2) {
      k++
      continue
    }
    if (to === -1) {
      i++
      continue
    }
    const lengthPx = anchors[to] - anchors[k]
    segments.push({
      labelId: labels[i].id,
      fromAnchor: k,
      toAnchor: to,
      fromPx: anchors[k],
      toPx: anchors[to],
      lengthPx,
      valueCm: labels[i].valueCm,
      scaleError: Math.abs(lengthPx / labels[i].valueCm - pxPerCm) / pxPerCm,
    })
    placed.add(labels[i].id)
    i++
    k = to
  }

  return {
    segments,
    explainedPx: segments.reduce((n2, s) => n2 + s.lengthPx, 0),
    score: segments.reduce((n2, s) => n2 + Math.max(0, 1 - s.scaleError / opts.scaleTolerance), 0),
    unplacedLabelIds: labels.filter((l) => !placed.has(l.id)).map((l) => l.id),
  }
}
