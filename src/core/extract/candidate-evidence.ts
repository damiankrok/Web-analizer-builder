/**
 * What every Stage-07 field has to carry with it — §26.
 *
 * Stage 06 got away with one confidence number per wall because a floor plan
 * is one kind of source and a wall is read from it one way. Stage 07 is not
 * like that. A ridge level can be a number the section prints, or the same
 * number recovered after the recogniser misread it, or a row of pixels where a
 * fitted roof edge happened to meet another — and a reader who is told `7.95`
 * without being told which of those it was has been told almost nothing.
 *
 * So a Stage-07 measurement is never a bare number. It is a value, the kind of
 * evidence that produced it, how far that kind of evidence can be trusted on
 * this source, what it was read from, and whether the sources agreed.
 *
 * ## Fidelity is about the *route*, not the confidence
 *
 * The two are different and collapsing them loses the thing worth keeping. A
 * silhouette edge on a rendered elevation can be localised to a pixel — high
 * confidence — and is still only `RENDER_DERIVED`, because a render carries no
 * dimension line and the publisher never promised it was drawn to scale. A
 * printed `+7,95` read at confidence 0.4 is still `SOURCE_EXACT` once the
 * datum solver has confirmed it against the rest of the section: the number is
 * the publisher's, not this pipeline's.
 *
 * Ordering them is what §12's authority list needs, so they are ordered, and
 * `beats` is the only place that ordering is written down.
 *
 * PORT_DIRECT (Kotlin).
 */

/**
 * How a value came to be known, best first.
 *
 * `SOURCE_EXACT` — the publisher printed this number and the pipeline read it,
 * and nothing in the source contradicts it.
 *
 * `SOURCE_RECONCILED` — the publisher printed it, the recogniser got it wrong,
 * and the rest of the drawing says what it must have been. Deliberately its
 * own level rather than folded into `SOURCE_EXACT`: the digits were not read,
 * they were deduced, and a reader deciding whether to trust a millimetre needs
 * to know which. §2's warning about the attic door widths is the same warning.
 *
 * `SOURCE_DERIVED` — measured off a technical drawing through a solved scale.
 * Good to about the localisation of an ink edge, so a pixel or two.
 *
 * `RENDER_DERIVED` — measured off a published orthographic *render*. ARCHON's
 * elevations are renders: they are orthographic, so they are usable, but they
 * carry no dimension lines and nothing on them is a stated dimension.
 *
 * `GEOMETRIC_INFERENCE` — not measured anywhere, computed from other
 * quantities under a stated assumption.
 *
 * `UNRESOLVED` — the sources do not settle it. The value is not to be used.
 */
export type Fidelity =
  | 'SOURCE_EXACT'
  | 'SOURCE_RECONCILED'
  | 'SOURCE_DERIVED'
  | 'RENDER_DERIVED'
  | 'GEOMETRIC_INFERENCE'
  | 'UNRESOLVED'

const FIDELITY_RANK: Record<Fidelity, number> = {
  SOURCE_EXACT: 5,
  SOURCE_RECONCILED: 4,
  SOURCE_DERIVED: 3,
  RENDER_DERIVED: 2,
  GEOMETRIC_INFERENCE: 1,
  UNRESOLVED: 0,
}

/** §12's authority order, as a comparison. Higher wins; ties do not resolve. */
export const beats = (a: Fidelity, b: Fidelity): boolean => FIDELITY_RANK[a] > FIDELITY_RANK[b]

export const fidelityRank = (f: Fidelity): number => FIDELITY_RANK[f]

/**
 * Whether the sources agree about a thing.
 *
 * `CONFLICTED` is not a failure and is never repaired by choosing. Two
 * drawings of one building that disagree are a fact about the publication, and
 * §14 and §27 both require it to survive into the candidate.
 */
export type ResolutionStatus = 'RESOLVED' | 'CONFLICTED' | 'UNRESOLVED'

/**
 * Where a value was read.
 *
 * `assetId` rather than a filename, because an asset id is stable across a
 * publisher renaming a resolution suffix and a filename is not. `locator` is
 * for a human retracing the reading by eye; it is prose and nothing keys on it.
 */
export type EvidenceRef = {
  assetId: string
  /** `SECTION`, `ELEVATION:FRONT`, `FLOOR_PLAN:GROUND`, and so on. */
  role: string
  /** Where on that drawing, in its own native pixels. */
  locator: string
}

/**
 * One measured quantity, with everything needed to judge it.
 *
 * `toleranceM` is the source-derived spatial tolerance §29 requires: it comes
 * from the resolution of the drawing the value was read on and the residual of
 * the registration that put it in metres, so a plan reading and an elevation
 * reading do not get handed the same centimetre threshold.
 */
export type CandidateMeasure = {
  valueM: number
  fidelity: Fidelity
  /** 0..1. How sure the pipeline is *given* the route named by `fidelity`. */
  confidence: number
  /** Half-width of the interval this value is known to, metres. */
  toleranceM: number
  evidence: EvidenceRef[]
  /** In the words of whatever measured it. */
  why: string
}

/** A measure that stands for "the sources do not settle this". */
export const unresolvedMeasure = (why: string, evidence: EvidenceRef[] = []): CandidateMeasure => ({
  valueM: Number.NaN,
  fidelity: 'UNRESOLVED',
  confidence: 0,
  toleranceM: Number.POSITIVE_INFINITY,
  evidence,
  why,
})

export const isResolved = (m: CandidateMeasure | null | undefined): m is CandidateMeasure =>
  m !== null && m !== undefined && m.fidelity !== 'UNRESOLVED' && Number.isFinite(m.valueM)

/**
 * Fuse two measurements of one quantity.
 *
 * The rules are §12's and §14's, in order, and the third is the one that
 * matters: **agreement is required before averaging is allowed.** Two values
 * that differ by more than their tolerances admit are not one better value,
 * they are a disagreement, and a mean of them is a number no source states and
 * no reader can trace. So:
 *
 *   1. if one route outranks the other, the better one stands and the other is
 *      recorded as having been outranked — an elevation silhouette does not
 *      override a printed section datum, whatever the pixels say;
 *   2. if the routes rank equally and the values agree inside their combined
 *      tolerance, they are averaged by inverse variance and the result is
 *      *more* certain than either, which is the only case where fusing buys
 *      anything;
 *   3. otherwise the disagreement stands: the better-localised value is
 *      carried, the status is `CONFLICTED`, and §27 requires the caller to
 *      raise a conflict about it.
 */
export function fuseMeasures(
  a: CandidateMeasure,
  b: CandidateMeasure,
): { fused: CandidateMeasure; status: ResolutionStatus; residualM: number } {
  if (!isResolved(a) && !isResolved(b)) {
    return { fused: a, status: 'UNRESOLVED', residualM: Number.NaN }
  }
  if (!isResolved(b)) return { fused: a, status: 'RESOLVED', residualM: Number.NaN }
  if (!isResolved(a)) return { fused: b, status: 'RESOLVED', residualM: Number.NaN }

  const residualM = Math.abs(a.valueM - b.valueM)
  if (beats(a.fidelity, b.fidelity) || beats(b.fidelity, a.fidelity)) {
    const better = beats(a.fidelity, b.fidelity) ? a : b
    const worse = better === a ? b : a
    const agrees = residualM <= worse.toleranceM + better.toleranceM
    return {
      fused: {
        ...better,
        evidence: [...better.evidence, ...worse.evidence],
        confidence: agrees ? Math.min(0.99, better.confidence + 0.05) : better.confidence,
        why:
          `${better.why}; the ${worse.fidelity} reading of ${worse.valueM.toFixed(3)} m ` +
          `${agrees ? 'agrees within tolerance' : `disagrees by ${residualM.toFixed(3)} m`} and does not override it (§12)`,
      },
      status: agrees ? 'RESOLVED' : 'CONFLICTED',
      residualM,
    }
  }

  const tol = a.toleranceM + b.toleranceM
  if (residualM <= tol) {
    const wa = 1 / Math.max(1e-6, a.toleranceM ** 2)
    const wb = 1 / Math.max(1e-6, b.toleranceM ** 2)
    return {
      fused: {
        valueM: (a.valueM * wa + b.valueM * wb) / (wa + wb),
        fidelity: a.fidelity,
        confidence: Math.min(0.99, Math.max(a.confidence, b.confidence) + 0.05),
        toleranceM: 1 / Math.sqrt(wa + wb),
        evidence: [...a.evidence, ...b.evidence],
        why: `two ${a.fidelity} readings ${residualM.toFixed(3)} m apart, inside the ${tol.toFixed(3)} m their tolerances admit, combined`,
      },
      status: 'RESOLVED',
      residualM,
    }
  }
  const sharper = a.toleranceM <= b.toleranceM ? a : b
  const other = sharper === a ? b : a
  return {
    fused: {
      ...sharper,
      evidence: [...sharper.evidence, ...other.evidence],
      why:
        `${sharper.why}; a second reading of the same kind gives ${other.valueM.toFixed(3)} m, ` +
        `${residualM.toFixed(3)} m away and outside the ${tol.toFixed(3)} m their tolerances admit. ` +
        'Neither source outranks the other, so this is carried as the better-localised of two and the disagreement stands (§14)',
    },
    status: 'CONFLICTED',
    residualM,
  }
}
