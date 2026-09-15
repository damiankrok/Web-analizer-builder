/**
 * Readings with owners — STAGE WEB-PIVOT-06 §7, §8, §9, §10.
 *
 * This is the boundary the brief draws twice: a *reading* is what a recogniser
 * returned, and an *observation* is a reading that knows what it measures.
 * Nothing downstream may treat the first as the second. A number with no
 * physical owner is recorded here, with the reason it has none, and it never
 * becomes a metric constraint.
 *
 * ## How a number finds its owner
 *
 * Not by proximity, and not one number at a time. A plan stacks its chains in
 * bands and draws a great many lines that are not chains, so the baseline
 * nearest a label is often the wrong one, and nothing in the pixels around the
 * label says which is right.
 *
 * What says is the structure of a chain. Its segments tile the line they are
 * drawn on, end to end, in the order the labels are printed, and every segment
 * on every chain of the sheet is drawn at one scale. So:
 *
 *   1. each label proposes the scales it would imply, paired with each span of
 *      anchors on a line it is near enough to be labelling;
 *   2. the proposals are clustered, and the best-supported become candidate
 *      scales for the sheet;
 *   3. each candidate scale is *tested*, by fitting an actual chain to every
 *      baseline — a monotone partition of its anchors, in label order — and
 *      asking how much of the drawing the fit accounts for;
 *   4. the two axes then have to agree with each other, because one sheet was
 *      drawn at one scale.
 *
 * Step 3 is what makes this robust. A wrong scale can always find *a* span for
 * any one label; what it cannot do is make a whole chain's segments join up.
 * And step 4 catches the rest: a spurious reading of one axis has no
 * counterpart on the other.
 *
 * Where the axes disagree materially that is reported as distortion and never
 * averaged away (§10).
 *
 * PORT_DIRECT (Kotlin).
 */
import type { PixelBox } from '../dimensions/contracts.js'
import type { PlanTextReading } from './text-engine.js'
import type { TextRegion } from './text-regions.js'
import type { DimensionStructures, DimensionBaseline } from './dimension-structures.js'
import { fitChain, DEFAULT_CHAIN_FIT, type ChainFit, type ChainLabel } from './chain-fit.js'

export type ObservationOwner =
  | {
      kind: 'INTERVAL'
      baselineId: string
      axis: 'X' | 'Y'
      /** The span this label measures, along the baseline's axis. */
      fromPx: number
      toPx: number
      lengthPx: number
      /** How far this segment's own ratio sits from the sheet's scale. */
      scaleError: number
      /** How many segments the chain this belongs to placed. */
      chainSegments: number
    }
  | {
      kind: 'CALLOUT'
      calloutId: string
      half: 'UPPER' | 'LOWER'
      leaderEnd: { x: number; y: number } | null
    }
  | { kind: 'NONE'; why: string }

export type DimensionObservation = {
  id: string
  regionId: string
  /** The token exactly as read. */
  text: string
  /** Centimetres the token states, or null when it does not state a length. */
  valueCm: number | null
  /** The engine's own confidence, 0..1. */
  confidence: number
  engineId: string
  owner: ObservationOwner
  box: PixelBox
  /** Other readings of this same label, so a disagreement stays visible. */
  alternatives: Array<{ text: string; confidence: number }>
}

export type ObservationOptions = {
  /** Readings below this confidence are not considered at all. */
  minConfidence: number
  /** Digits a plan dimension token must have. */
  minDigits: number
  maxDigits: number
  /** How far a segment's implied scale may sit from the sheet's consensus. */
  scaleTolerance: number
  /** Distinct labels a proposed scale must rest on before it is tested. */
  minScaleSupport: number
  /** Candidate scales per axis that are tested by fitting chains. */
  maxCandidateScales: number
  /**
   * How far the two axes' scales may differ and still be treated as two
   * measurements of one sheet.
   */
  maxAxisRatio: number
  /**
   * Difference between the two axes' scales that is reported as distortion
   * rather than treated as noise (§10).
   */
  axisDisagreement: number
  /**
   * How much more drawing two independent axis scales must read than one
   * shared scale before the sheet is called stretched.
   */
  sharedScaleMargin: number
  /** Shortest segment a chain may place, pixels. */
  minSegmentPx: number
  /**
   * Fit at this scale instead of searching for one.
   *
   * A drawing does not always settle its own scale — a plan with three
   * readable vertical labels can be read several ways — but the *sheet set* it
   * belongs to does, because its drawings are published together at one size.
   * The caller that holds all of a project's plans can therefore propose a
   * scale to a plan that could not find its own, and this is how it does it.
   */
  scaleOverride: number | null
}

export const DEFAULT_OBSERVATIONS: ObservationOptions = {
  minConfidence: 0.6,
  minDigits: 2,
  maxDigits: 4,
  scaleTolerance: 0.06,
  minScaleSupport: 3,
  maxCandidateScales: 16,
  maxAxisRatio: 0.2,
  axisDisagreement: 0.02,
  sharedScaleMargin: 0.12,
  minSegmentPx: 8,
  scaleOverride: null,
}

/**
 * Centimetres a plan token states, or null.
 *
 * Rejected: anything that is not all digits, a leading zero (no drawing prints
 * `090` for ninety, and a leading zero is what an engine returns when it reads
 * a vertical label from the wrong end), and a token outside the digit count a
 * plan dimension uses. Nothing here knows what any value *should* be.
 */
export function parsePlanCentimetres(
  text: string,
  opts: ObservationOptions = DEFAULT_OBSERVATIONS,
): number | null {
  if (!/^[0-9]+$/.test(text)) return null
  if (text.length < opts.minDigits || text.length > opts.maxDigits) return null
  if (text[0] === '0') return null
  return Number(text)
}

const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length === 0
    ? 0
    : s.length % 2 === 1
      ? s[(s.length - 1) / 2]
      : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}

export type ScaleEstimate = {
  axis: 'X' | 'Y'
  /** Source-native pixels per centimetre, or null when nothing agreed. */
  pxPerCm: number | null
  /** Labels the fit read, each counted by how squarely its segment landed. */
  score: number
  /** Chain segments the winning fit placed. */
  segments: number
  /** Pixel length of the drawing those segments account for. */
  explainedPx: number
  /** Median relative deviation of those segments' own ratios. */
  spread: number
}

/** One label as the chain fitter needs it, on one baseline. */
type BaselineLabel = ChainLabel & { regionId: string; confidence: number; engineId: string; text: string }

/** Everything one axis offers the fitter. */
type AxisWork = {
  axis: 'X' | 'Y'
  baselines: Array<{ baseline: DimensionBaseline; labels: BaselineLabel[] }>
}

/** Scales the labels themselves propose, best-supported first. */
function proposedScales(work: AxisWork, opts: ObservationOptions): number[] {
  const ratios: number[] = []
  for (const { baseline, labels } of work.baselines) {
    for (const label of labels) {
      if (label.valueCm <= 0) continue
      for (let i = 0; i < baseline.anchors.length; i++) {
        for (let j = i + 1; j < baseline.anchors.length; j++) {
          const lengthPx = baseline.anchors[j] - baseline.anchors[i]
          if (lengthPx < opts.minSegmentPx) continue
          const centre = label.centrePx
          if (centre < baseline.anchors[i] - label.runPx || centre > baseline.anchors[j] + label.runPx) continue
          ratios.push(lengthPx / label.valueCm)
        }
      }
    }
  }
  if (ratios.length === 0) return []

  const clusters: Array<{ ratio: number; support: number }> = []
  for (const seed of ratios) {
    let support = 0
    const members: number[] = []
    for (const r of ratios) {
      if (Math.abs(r - seed) > seed * opts.scaleTolerance) continue
      support++
      members.push(r)
    }
    if (support < opts.minScaleSupport) continue
    const refined = median(members)
    if (clusters.some((c) => Math.abs(c.ratio - refined) <= refined * opts.scaleTolerance)) continue
    clusters.push({ ratio: refined, support })
  }
  return clusters
    .sort((a, b) => b.support - a.support)
    .slice(0, opts.maxCandidateScales)
    .map((c) => c.ratio)
}

type AxisFit = {
  pxPerCm: number
  fits: Map<string, ChainFit>
  explainedPx: number
  segments: number
  spread: number
  /**
   * How many of the sheet's labels the fit actually reads, each counted by how
   * squarely its segment lands.
   *
   * Labels rather than pixels, and the difference decides real cases. Scoring
   * on explained length rewards a fit that claims one enormous span: on
   * project A's attic plan a vertical scale nearly five times too large places
   * two segments, one of them 320 px long, and out-scores the true scale that
   * places five. Scoring on labels cannot be fooled that way — reading two
   * numbers is reading two numbers, however long the line.
   *
   * Weighting by fit quality then separates the near-misses from the reads. A
   * scale 19% too small places twelve segments on that same plan, each about
   * 3.2% out; the true scale places eleven, each 0.7% out. The first is
   * assembling spans that nearly work and the second is reading spans that do.
   */
  score: number
}

/** Fit a chain to every baseline of one axis at one proposed scale. */
function fitAxis(work: AxisWork, pxPerCm: number, opts: ObservationOptions): AxisFit {
  const fits = new Map<string, ChainFit>()
  let explainedPx = 0
  let segments = 0
  let score = 0
  const errors: number[] = []
  for (const { baseline, labels } of work.baselines) {
    if (labels.length === 0) continue
    const ordered = [...labels].sort((a, b) => a.centrePx - b.centrePx)
    const fit = fitChain(baseline.anchors, ordered, pxPerCm, {
      ...DEFAULT_CHAIN_FIT,
      scaleTolerance: opts.scaleTolerance,
      minSegmentPx: opts.minSegmentPx,
    })
    if (fit.segments.length === 0) continue
    fits.set(baseline.id, fit)
    explainedPx += fit.explainedPx
    segments += fit.segments.length
    for (const s of fit.segments) errors.push(s.scaleError)
    score += fit.score
  }
  return { pxPerCm, fits, explainedPx, segments, spread: median(errors), score }
}

/**
 * The scale of the sheet, with the two axes corroborating each other.
 *
 * A sheet is drawn at one scale, so the first thing tried is one scale for
 * both axes: every ratio either axis proposed is used to fit *both*, and the
 * one that reads the most drawing wins. Only if letting the axes go their own
 * ways reads materially more is the sheet called distorted.
 *
 * That ordering matters, because two axes almost never agree to the last
 * decimal and the difference is usually noise rather than a stretched raster.
 * Project A's ground plan is the case in point: its vertical chains, fitted
 * alone, settle 3.7% away from its horizontal ones, which at face value is a
 * distortion finding. Fitting them at the horizontal scale reads essentially
 * as much of the drawing, so the 3.7% was the slack in a loose fit and not a
 * property of the raster. A publication stretch would not give way like that —
 * forcing the wrong scale on a genuinely stretched axis costs most of its
 * segments — and when it does not give way, the distortion is reported and
 * never averaged (§10).
 */
function chooseScales(
  work: Record<'X' | 'Y', AxisWork>,
  byAxis: Record<'X' | 'Y', AxisFit[]>,
  opts: ObservationOptions,
): { chosen: Record<'X' | 'Y', AxisFit | null>; notes: string[]; corroborated: boolean } {
  const bestX = byAxis.X[0] ?? null
  const bestY = byAxis.Y[0] ?? null
  const notes: string[] = []
  if (!bestX && !bestY) return { chosen: { X: null, Y: null }, notes, corroborated: false }

  // --- one scale for the whole sheet
  const ratios = [...new Set([...byAxis.X, ...byAxis.Y].map((f) => f.pxPerCm))]
  let shared: { x: AxisFit; y: AxisFit; score: number } | null = null
  for (const ratio of ratios) {
    const x = fitAxis(work.X, ratio, opts)
    const y = fitAxis(work.Y, ratio, opts)
    const score = x.score + y.score
    if (shared === null || score > shared.score) shared = { x, y, score }
  }

  // --- each axis on its own
  const independent = (bestX?.score ?? 0) + (bestY?.score ?? 0)

  if (shared && shared.score >= independent * (1 - opts.sharedScaleMargin)) {
    notes.push(
      `one scale of ${shared.x.pxPerCm.toFixed(5)} px/cm reads both axes (${shared.x.segments} segments across, ` +
        `${shared.y.segments} down); letting the axes differ would read ` +
        `${(Math.max(0, independent / Math.max(1e-6, shared.score) - 1) * 100).toFixed(1)}% more labels, ` +
        'which is not enough to call the raster stretched',
    )
    return { chosen: { X: shared.x, Y: shared.y }, notes, corroborated: false }
  }

  if (bestX && bestY) {
    notes.push(
      'no single scale reads both axes: separate scales read ' +
        `${(Math.max(0, independent / Math.max(1e-6, shared?.score ?? 1) - 1) * 100).toFixed(1)}% more labels than the best shared one`,
    )
    return { chosen: { X: bestX, Y: bestY }, notes, corroborated: true }
  }
  return { chosen: { X: bestX ?? shared?.x ?? null, Y: bestY ?? shared?.y ?? null }, notes, corroborated: false }
}

export type ObservationResult = {
  observations: DimensionObservation[]
  scales: ScaleEstimate[]
  /**
   * Every scale that was proposed and tested, with what its chains accounted
   * for. Kept because a single chosen number hides whether it won by a mile or
   * by a whisker, and because a near-tie is exactly the case a reader of the
   * audit needs to see (§19).
   */
  testedScales: Array<{
    axis: 'X' | 'Y'
    pxPerCm: number
    segments: number
    explainedPx: number
    spread: number
    score: number
  }>
  /**
   * Set when the two axes' scales disagree by more than the drawing's own
   * noise. §10: report the distortion, never silently average it.
   */
  distortion: { axisRatio: number; material: boolean; note: string } | null
  notes: string[]
}

export function buildObservations(
  readings: readonly PlanTextReading[],
  regions: readonly TextRegion[],
  structures: DimensionStructures,
  opts: ObservationOptions = DEFAULT_OBSERVATIONS,
): ObservationResult {
  const regionOfCrop = new Map<string, TextRegion>()
  for (const r of regions) regionOfCrop.set(r.id, r)
  const regionById = new Map<string, TextRegion>()
  for (const r of regions) if (!regionById.has(r.regionId)) regionById.set(r.regionId, r)

  // Every reading of every label, grouped by the label it reads.
  const perRegion = new Map<string, Array<{ text: string; confidence: number; engineId: string }>>()
  for (const reading of readings) {
    if (reading.confidence < opts.minConfidence) continue
    const region = regionOfCrop.get(reading.cropId)
    if (!region) continue
    const list = perRegion.get(region.regionId) ?? []
    list.push({ text: reading.text, confidence: reading.confidence, engineId: reading.engineId })
    perRegion.set(region.regionId, list)
  }

  const baselineById = new Map(structures.baselines.map((b) => [b.id, b]))
  const calloutOf = new Map(structures.calloutAttachments.map((a) => [a.regionId, a]))

  // --- what each axis offers the fitter
  //
  // A label that was read several ways offers each reading as its own
  // candidate on the baseline; the chain fit then keeps whichever one lets the
  // chain close, which is how a vertical label read from the wrong end loses
  // to the same label read from the right one.
  const work: Record<'X' | 'Y', AxisWork> = {
    X: { axis: 'X', baselines: [] },
    Y: { axis: 'Y', baselines: [] },
  }
  const labelsOf = new Map<string, BaselineLabel[]>()
  for (const reach of structures.reaches) {
    const readingsHere = perRegion.get(reach.regionId)
    if (!readingsHere) continue
    const list = labelsOf.get(reach.baselineId) ?? []
    for (const r of readingsHere) {
      const valueCm = parsePlanCentimetres(r.text, opts)
      if (valueCm === null || valueCm <= 0) continue
      list.push({
        id: `${reach.regionId}|${r.text}`,
        regionId: reach.regionId,
        text: r.text,
        valueCm,
        centrePx: reach.centrePx,
        runPx: reach.runPx,
        confidence: r.confidence,
        engineId: r.engineId,
      })
    }
    labelsOf.set(reach.baselineId, list)
  }
  for (const [baselineId, labels] of labelsOf) {
    const baseline = baselineById.get(baselineId)
    if (!baseline || labels.length === 0) continue
    work[baseline.axis].baselines.push({ baseline, labels })
  }

  // --- propose, then test by fitting
  const fitsByAxis: Record<'X' | 'Y', AxisFit[]> = { X: [], Y: [] }
  for (const axis of ['X', 'Y'] as const) {
    const ratios =
      opts.scaleOverride !== null && opts.scaleOverride > 0
        ? [opts.scaleOverride]
        : proposedScales(work[axis], opts)
    for (const ratio of ratios) {
      const fit = fitAxis(work[axis], ratio, opts)
      if (fit.segments === 0) continue
      fitsByAxis[axis].push(fit)
    }
    fitsByAxis[axis].sort((a, b) => b.score - a.score || b.explainedPx - a.explainedPx)
  }
  const { chosen, notes: scaleNotes, corroborated } =
    opts.scaleOverride !== null && opts.scaleOverride > 0
      ? {
          chosen: { X: fitsByAxis.X[0] ?? null, Y: fitsByAxis.Y[0] ?? null },
          notes: [`fitted at the scale the project's other drawings settled: ${opts.scaleOverride.toFixed(5)} px/cm`],
          corroborated: false,
        }
      : chooseScales(work, fitsByAxis, opts)

  // --- ownership comes from the winning fits
  const ownerByRegion = new Map<string, { owner: ObservationOwner; text: string; confidence: number; engineId: string }>()
  for (const axis of ['X', 'Y'] as const) {
    const fit = chosen[axis]
    if (!fit) continue
    for (const [baselineId, chain] of fit.fits) {
      for (const segment of chain.segments) {
        const [regionId, text] = segment.labelId.split('|')
        const reading = (perRegion.get(regionId) ?? []).find((r) => r.text === text)
        if (!reading) continue
        const previous = ownerByRegion.get(regionId)
        // A label reachable from two baselines can be placed on both. The
        // better placement is the one whose own ratio fits the sheet.
        if (
          previous &&
          previous.owner.kind === 'INTERVAL' &&
          previous.owner.scaleError <= segment.scaleError
        ) {
          continue
        }
        ownerByRegion.set(regionId, {
          text,
          confidence: reading.confidence,
          engineId: reading.engineId,
          owner: {
            kind: 'INTERVAL',
            baselineId,
            axis,
            fromPx: segment.fromPx,
            toPx: segment.toPx,
            lengthPx: segment.lengthPx,
            scaleError: segment.scaleError,
            chainSegments: chain.segments.length,
          },
        })
      }
    }
  }

  const observations: DimensionObservation[] = []
  let n = 0
  for (const [regionId, list] of [...perRegion].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const region = regionById.get(regionId)
    if (!region) continue
    const placed = ownerByRegion.get(regionId)
    const callout = calloutOf.get(regionId)
    const ranked = [...list].sort(
      (a, b) =>
        (parsePlanCentimetres(b.text, opts) === null ? 0 : 1) -
          (parsePlanCentimetres(a.text, opts) === null ? 0 : 1) || b.confidence - a.confidence,
    )
    const text = placed?.text ?? ranked[0].text
    const confidence = placed?.confidence ?? ranked[0].confidence
    const engineId = placed?.engineId ?? ranked[0].engineId

    let owner: ObservationOwner
    if (placed) owner = placed.owner
    else if (callout) {
      owner = {
        kind: 'CALLOUT',
        calloutId: callout.calloutId,
        half: callout.half,
        leaderEnd: callout.leaderEnd,
      }
    } else {
      const reachable = structures.reaches.some((r) => r.regionId === regionId)
      owner = {
        kind: 'NONE',
        why:
          parsePlanCentimetres(text, opts) === null
            ? 'the reading does not state a plan dimension'
            : reachable
              ? 'no chain on a baseline within reach places this value at the sheet’s own scale'
              : 'no dimension baseline or callout ring reaches this run',
      }
    }

    observations.push({
      id: `obs${n++}`,
      regionId,
      text,
      valueCm: parsePlanCentimetres(text, opts),
      confidence,
      engineId,
      owner,
      box: region.box,
      alternatives: ranked
        .filter((r) => r.text !== text)
        .map((r) => ({ text: r.text, confidence: r.confidence })),
    })
  }

  const scales: ScaleEstimate[] = (['X', 'Y'] as const).map((axis) => {
    const fit = chosen[axis]
    return {
      axis,
      pxPerCm: fit?.pxPerCm ?? null,
      score: fit?.score ?? 0,
      segments: fit?.segments ?? 0,
      explainedPx: fit?.explainedPx ?? 0,
      spread: fit?.spread ?? 0,
    }
  })

  const x = scales[0].pxPerCm
  const y = scales[1].pxPerCm
  let distortion: ObservationResult['distortion'] = null
  if (x !== null && y !== null && x > 0 && y > 0 && corroborated) {
    const axisRatio = x / y
    const material = Math.abs(axisRatio - 1) > opts.axisDisagreement
    distortion = {
      axisRatio,
      material,
      note: material
        ? `the horizontal and vertical scales differ by ${((axisRatio - 1) * 100).toFixed(1)}%; both axes settled that independently, so the raster is not square and the axes are kept apart rather than averaged`
        : `the horizontal and vertical scales agree to ${((axisRatio - 1) * 100).toFixed(2)}%`,
    }
  }

  const testedScales = (['X', 'Y'] as const).flatMap((axis) =>
    fitsByAxis[axis].map((f) => ({
      axis,
      pxPerCm: f.pxPerCm,
      segments: f.segments,
      explainedPx: f.explainedPx,
      spread: f.spread,
      score: f.score,
    })),
  )

  const owned = observations.filter((o) => o.owner.kind === 'INTERVAL').length
  const inRings = observations.filter((o) => o.owner.kind === 'CALLOUT').length
  const notes = [
    `${fitsByAxis.X.length} candidate scales tested across X, ${fitsByAxis.Y.length} across Y`,
    `${observations.length} observations: ${owned} on a chain segment, ${inRings} in a callout ring, ` +
      `${observations.length - owned - inRings} with no owner`,
    ...scales.map(
      (s) =>
        `scale ${s.axis} ${s.pxPerCm === null ? 'not established' : `${s.pxPerCm.toFixed(5)} px/cm`} ` +
        `from ${s.segments} chain segments covering ${s.explainedPx.toFixed(0)} px (spread ${(s.spread * 100).toFixed(2)}%)`,
    ),
    ...scaleNotes,
    ...(distortion
      ? [distortion.note]
      : ['the axes did not independently corroborate a scale, so no distortion is claimed either way']),
  ]
  return { observations, scales, testedScales, distortion, notes }
}
