/**
 * Chain consistency solving (§10, §11).
 *
 * A dimension chain is an arithmetic statement as well as a picture: the parts
 * sum to the whole. That closure is the strongest check available on a printed
 * reading, because it is independent of pixel measurement, of the drawing's
 * scale, and of the recogniser. A chain that closes to a few millimetres was
 * almost certainly read correctly; one that misses by 30 cm contains a bad
 * digit, and the solver can often say which.
 *
 * What the solver may do: reject a reading, choose between interpretations,
 * and raise confidence where independent evidence agrees. What it may not do is
 * invent a value. A segment whose label was not read stays null — the chain
 * then simply does not close, and that is reported rather than repaired by
 * subtraction, because a number obtained by subtracting other numbers is not a
 * printed dimension and must not be labelled as one (§11).
 *
 * PORT_DIRECT (Kotlin).
 */
import type { DimensionChain, DimensionSegment, MetricFidelity, ValueCandidate } from './contracts.js'

export type ChainSolveOptions = {
  /** Closure tolerance, metres. */
  closureToleranceM: number
  /** Fractional tolerance when matching a reading to its pixel length. */
  pixelTolerance: number
  /** Grid the drawing's dimensions are quantised to, metres (1 cm here). */
  gridM: number
}

export const DEFAULT_CHAIN_SOLVE: ChainSolveOptions = {
  closureToleranceM: 0.03,
  pixelTolerance: 0.1,
  gridM: 0.01,
}

const pick = (candidates: readonly ValueCandidate[]): ValueCandidate | null =>
  candidates.length === 0 ? null : [...candidates].sort((a, b) => b.confidence - a.confidence)[0]

/**
 * Settle one chain.
 *
 * Three passes, in order of decreasing authority:
 *
 *  1. *Pixel agreement.* Each segment keeps the reading nearest the length its
 *     own baseline implies. This is what discriminates a centimetre reading
 *     from a millimetre one without assuming a convention.
 *  2. *Closure.* If an overall dimension was printed and the settled parts sum
 *     to it, every part is corroborated — two independent sources agreeing on
 *     the same number, which is what `SOURCE_CORROBORATED` means. If they do
 *     not, the single segment whose removal would close the chain is flagged
 *     and demoted; the rest keep their readings.
 *  3. *Grid.* Settled values are checked against the centimetre grid the
 *     drawing is dimensioned on. A value off-grid by more than rounding is a
 *     misread digit, not a real dimension.
 */
export function solveChain(chain: DimensionChain, opts: ChainSolveOptions = DEFAULT_CHAIN_SOLVE): DimensionChain {
  const scale = chainScale(chain)
  const segments: DimensionSegment[] = chain.segments.map((seg) => {
    const rejections = [...seg.rejections]
    let chosen: ValueCandidate | null = null
    if (scale !== null && seg.lengthPx > 0) {
      const expected = seg.lengthPx / scale
      let bestErr = Number.POSITIVE_INFINITY
      for (const c of seg.candidates) {
        const err = Math.abs(c.metres - expected)
        if (err > expected * opts.pixelTolerance) {
          rejections.push(
            `${c.text} as ${c.interpretation} = ${c.metres.toFixed(3)} m disagrees with its ` +
              `${seg.lengthPx.toFixed(0)} px baseline (${expected.toFixed(3)} m)`,
          )
          continue
        }
        if (err < bestErr) {
          bestErr = err
          chosen = c
        }
      }
    } else chosen = pick(seg.candidates)

    if (chosen === null) {
      return { ...seg, metres: null, fidelity: 'UNRESOLVED' as MetricFidelity, rejections, confidence: 0 }
    }
    const offGrid = Math.abs(chosen.metres / opts.gridM - Math.round(chosen.metres / opts.gridM)) * opts.gridM
    if (offGrid > opts.gridM * 0.51) {
      rejections.push(`${chosen.text} = ${chosen.metres.toFixed(4)} m is off the ${opts.gridM * 100} cm grid`)
      return { ...seg, metres: null, fidelity: 'UNRESOLVED' as MetricFidelity, rejections, confidence: 0 }
    }
    return {
      ...seg,
      metres: chosen.metres,
      fidelity: 'SOURCE_EXACT' as MetricFidelity,
      rejections,
      confidence: chosen.confidence,
    }
  })

  const settled = segments.filter((s) => s.metres !== null)
  const sum = settled.reduce((a, s) => a + (s.metres ?? 0), 0)
  const overallValue = chain.overall ? resolveOverall(chain, scale, opts) : null
  let closureResidualM: number | null = null
  let closes = false

  if (overallValue !== null && settled.length === segments.length && segments.length > 0) {
    closureResidualM = sum - overallValue
    closes = Math.abs(closureResidualM) <= opts.closureToleranceM
    if (closes) {
      // Parts and whole agree: both sides corroborate each other.
      for (const s of segments) if (s.metres !== null) s.fidelity = 'SOURCE_CORROBORATED'
    } else {
      // Find the one segment whose reading is most likely wrong: the one whose
      // own pixel length disagrees most with its value.
      let worst: DimensionSegment | null = null
      let worstErr = -1
      if (scale !== null) {
        for (const s of segments) {
          if (s.metres === null) continue
          const err = Math.abs(s.metres - s.lengthPx / scale)
          if (err > worstErr) {
            worstErr = err
            worst = s
          }
        }
      }
      if (worst) {
        worst.rejections.push(
          `chain misses closure by ${(closureResidualM * 100).toFixed(1)} cm; this segment disagrees ` +
            `most with its own baseline and is demoted`,
        )
        worst.fidelity = 'SOURCE_DERIVED'
        worst.confidence *= 0.5
      }
    }
  }

  const readCount = segments.filter((s) => s.metres !== null).length
  return {
    ...chain,
    segments,
    ...(chain.overall ? { overall: { ...chain.overall, metres: overallValue } } : {}),
    closureResidualM,
    closes,
    confidence:
      segments.length === 0 ? 0 : Math.min(0.98, (readCount / segments.length) * (closes ? 0.98 : 0.7)),
  }
}

/** Pixels per metre implied by this chain's own readings, or null. */
export function chainScale(chain: DimensionChain): number | null {
  // Use the overall dimension when it was read: one long measurement beats
  // several short ones for estimating a scale.
  const overall = chain.overall
  if (overall && overall.candidates.length > 0 && overall.lengthPx > 0) {
    const best = pick(overall.candidates)
    if (best && best.metres > 0) return overall.lengthPx / best.metres
  }
  const ratios: number[] = []
  for (const seg of chain.segments) {
    const best = pick(seg.candidates)
    if (best && best.metres > 0 && seg.lengthPx > 0) ratios.push(seg.lengthPx / best.metres)
  }
  if (ratios.length === 0) return null
  ratios.sort((a, b) => a - b)
  return ratios[Math.floor(ratios.length / 2)]
}

function resolveOverall(chain: DimensionChain, scale: number | null, opts: ChainSolveOptions): number | null {
  const overall = chain.overall
  if (!overall) return null
  if (scale === null || overall.lengthPx <= 0) return pick(overall.candidates)?.metres ?? null
  const expected = overall.lengthPx / scale
  let best: number | null = null
  let bestErr = Number.POSITIVE_INFINITY
  for (const c of overall.candidates) {
    const err = Math.abs(c.metres - expected)
    if (err > expected * opts.pixelTolerance) continue
    if (err < bestErr) {
      bestErr = err
      best = c.metres
    }
  }
  return best
}

/**
 * Scale agreed by several chains on one drawing.
 *
 * Independent chains measure the same drawing, so their implied scales must
 * agree; the median is robust to one chain having been misread, and the spread
 * is a usable confidence signal in its own right.
 */
export function consensusScale(chains: readonly DimensionChain[]): { pixelsPerMetre: number | null; spread: number } {
  const scales = chains.map(chainScale).filter((s): s is number => s !== null && s > 0)
  if (scales.length === 0) return { pixelsPerMetre: null, spread: 0 }
  scales.sort((a, b) => a - b)
  const median = scales[Math.floor(scales.length / 2)]
  const spread = scales.length < 2 ? 0 : (scales[scales.length - 1] - scales[0]) / median
  return { pixelsPerMetre: median, spread }
}

export type IntegerChainSolution = {
  /** Pixels per centimetre the chain is drawn at. */
  pixelsPerCm: number
  /** One integer value per segment, centimetres. */
  values: number[]
  /** Integer the overall baseline solves to, when there is one. */
  overall: number | null
  /** Mean absolute rounding error, centimetres. */
  residualCm: number
  /** Whether the integer parts sum to the integer overall. */
  closes: boolean
}

/**
 * Solve a chain's printed integers from its geometry alone.
 *
 * A dimension chain is drawn to scale, so there is one unknown — the scale —
 * shared by every segment, and the printed values are integers in centimetres.
 * Searching the scale and rounding is therefore massively over-determined: a
 * chain of five segments has five rounding residuals and a closure residual
 * that all bottom out together at the true scale, and nowhere else.
 *
 * This is what makes the recogniser tractable. Without it a four-digit label
 * on a plan calibrated to a few percent has forty candidate values, so a glyph
 * position gets forty weak votes and no digit is ever named. With it the label
 * has *one* candidate, and its glyphs are named outright. The chain solver
 * runs before recognition for exactly that reason.
 *
 * It does not, on its own, produce printed dimensions: the integers are what
 * the drawing's geometry implies, not what it says. They become printed values
 * only where the glyphs agree (§11 — the solver must not invent a number).
 */
export function solveChainIntegers(
  lengthsPx: readonly number[],
  overallPx: number | null,
  pixelsPerCmHint: number,
  searchFraction = 0.18,
): IntegerChainSolution | null {
  const usable = lengthsPx.filter((l) => l > 2)
  if (usable.length === 0 || pixelsPerCmHint <= 0) return null
  const evaluate = (s: number): { residual: number; values: number[]; overall: number | null; closes: boolean } => {
    let residual = 0
    const values: number[] = []
    for (const l of lengthsPx) {
      const v = l / s
      const r = Math.round(v)
      values.push(r)
      // Weight by length: a 300 px segment rounding 0.4 cm off is a worse fit
      // than a 20 px one doing the same, because its value has more digits.
      residual += Math.abs(v - r)
    }
    let overall: number | null = null
    let closes = false
    if (overallPx !== null && overallPx > 2) {
      const v = overallPx / s
      overall = Math.round(v)
      residual += Math.abs(v - overall)
      const sum = values.reduce((a, b) => a + b, 0)
      closes = sum === overall
      // Closure is a hard arithmetic fact, so violating it costs far more than
      // a rounding wobble.
      if (!closes) residual += Math.min(4, Math.abs(sum - overall) * 0.5)
    }
    return { residual: residual / (lengthsPx.length + (overallPx ? 1 : 0)), values, overall, closes }
  }

  type Eval = { residual: number; values: number[]; overall: number | null; closes: boolean }
  let best: { s: number; out: Eval } | null = null
  const lo = pixelsPerCmHint * (1 - searchFraction)
  const hi = pixelsPerCmHint * (1 + searchFraction)
  const coarse = 1200
  for (let i = 0; i <= coarse; i++) {
    const s = lo + ((hi - lo) * i) / coarse
    const out = evaluate(s)
    if (!best || out.residual < best.out.residual) best = { s, out }
  }
  if (!best) return null
  // Refine around the coarse optimum.
  const span = (hi - lo) / coarse
  const centre: number = best.s
  for (let i = -20; i <= 20; i++) {
    const s: number = centre + (span * i) / 20
    if (s <= 0) continue
    const out = evaluate(s)
    if (out.residual < best.out.residual) best = { s, out }
  }
  return {
    pixelsPerCm: best.s,
    values: best.out.values,
    overall: best.out.overall,
    residualCm: best.out.residual,
    closes: best.out.closes,
  }
}

export type ScaleVote = {
  pixelsPerCm: number
  /** How many chains resolve to integers at this scale. */
  support: number
  /** Total number of chains that voted. */
  chains: number
  /** Mean residual of the supporting chains, centimetres. */
  residualCm: number
}

/**
 * Recover the drawing's scale from its own dimension chains.
 *
 * The alternative — calibrating from the published footprint area and the
 * fitted wall extent — is accurate to a few percent, and a few percent is not
 * good enough: a four-digit label then has forty candidate values and the
 * recogniser learns nothing. The chains themselves do much better, because
 * they are drawn to one scale and their values are whole centimetres, so the
 * true scale is the one at which many independent chains simultaneously land
 * on integers. Wrong scales satisfy one chain by luck and never several.
 *
 * This is a one-dimensional vote, not an optimisation: each chain contributes a
 * hit wherever it resolves, and the scale with the most hits wins. That makes
 * it robust to the majority of candidate "chains" on a plan being counter
 * edges and door leaves, which resolve at no consistent scale at all.
 */
export function voteScale(
  chainLengths: ReadonlyArray<{ lengths: number[]; overall: number | null }>,
  loPixelsPerCm: number,
  hiPixelsPerCm: number,
  steps = 4000,
  residualLimitCm = 0.16,
  preferPixelsPerCm: number | null = null,
): ScaleVote | null {
  const usable = chainLengths.filter((c) => c.lengths.filter((l) => l > 4).length >= 2)
  if (usable.length === 0) return null
  let best: ScaleVote | null = null
  for (let i = 0; i <= steps; i++) {
    const s = loPixelsPerCm + ((hiPixelsPerCm - loPixelsPerCm) * i) / steps
    if (s <= 0) continue
    let support = 0
    let residual = 0
    for (const chain of usable) {
      let r = 0
      let n = 0
      for (const l of chain.lengths) {
        if (l <= 4) continue
        const v = l / s
        r += Math.abs(v - Math.round(v))
        n++
      }
      if (chain.overall !== null && chain.overall > 4) {
        const v = chain.overall / s
        r += Math.abs(v - Math.round(v))
        n++
      }
      if (n === 0) continue
      const mean = r / n
      if (mean <= residualLimitCm) {
        support++
        residual += mean
      }
    }
    if (support === 0) continue
    const vote: ScaleVote = {
      pixelsPerCm: s,
      support,
      chains: usable.length,
      residualCm: residual / support,
    }
    // Aliasing guard. At a scale whose reciprocal is a small integer — half a
    // pixel per centimetre, say — *every* integer pixel length divides exactly,
    // so every candidate chain resolves perfectly and the vote is unanimous and
    // meaningless. Unanimity across a large field of candidates, most of which
    // are not dimension chains at all, is therefore evidence against a scale
    // rather than for it.
    if (vote.chains >= 5 && vote.support === vote.chains && vote.residualCm < 1e-6) continue
    const better =
      !best ||
      vote.support > best.support ||
      (vote.support === best.support && vote.residualCm < best.residualCm - 1e-9) ||
      // Among equally supported scales prefer the one nearest the independent
      // calibration: rational near-aliases can tie on rounding alone.
      (vote.support === best.support &&
        Math.abs(vote.residualCm - best.residualCm) <= 1e-9 &&
        preferPixelsPerCm !== null &&
        Math.abs(vote.pixelsPerCm - preferPixelsPerCm) < Math.abs(best.pixelsPerCm - preferPixelsPerCm))
    if (better) best = vote
  }
  return best
}
