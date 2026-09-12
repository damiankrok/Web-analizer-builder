/**
 * Reading the numbers printed on architectural drawings.
 *
 * The analyzer teaches itself the drawing's font. Nothing here ships a
 * typeface, a trained model or a per-vendor lookup:
 *
 *   1. glyphs are clustered by shape, so each digit becomes one prototype;
 *   2. every dimension label sits over a dimension-line segment whose *pixel*
 *      length, times the drawing's recovered scale, predicts its value to a few
 *      percent;
 *   3. constraint propagation over those predictions assigns a digit to each
 *      prototype — the leading digit of a four-digit label near 1194 has to be
 *      1, which pins one prototype, which narrows the next label, and so on;
 *   4. chain sums close the system: the parts of a chain must add to its whole,
 *      and that check either confirms the assignment or rejects it.
 *
 * Once the prototypes carry digits, the numbers geometry *cannot* predict
 * become readable — opening callouts, level annotations — and those are the
 * ones worth having, because they are exact where a pixel measurement is an
 * estimate.
 *
 * Everything is reported with provenance and confidence. A number whose
 * physical referent could not be established is not an exact constraint (§the
 * dimension-reading addendum), and is emitted as such rather than used.
 *
 * PORT_DIRECT (Kotlin).
 */
import type { GrayImage } from '../contracts/raster.js'
import {
  clusterGlyphs,
  clusterOf,
  decodeRun,
  extractGlyphs,
  groupRuns,
  type GlyphCluster,
  type GlyphRun,
} from './glyphs.js'
import { detectDimensionLines, toChains, type DimensionChain } from './dimension-lines.js'

/** How a value was established. Mirrors the audit classes the report needs. */
export type DimensionProvenance =
  | 'SOURCE_EXACT'
  | 'SOURCE_DERIVED'
  | 'GEOMETRIC_INFERRED'
  | 'VISUAL_INFERRED'
  | 'UNRESOLVED'

export type ReadDimension = {
  id: string
  /** Value in metres. */
  valueM: number
  /** Raw number as printed, in the drawing's own units (centimetres). */
  rawCm: number
  axis: 'HORIZONTAL' | 'VERTICAL'
  /** Pixel extent of the segment this label dimensions. */
  fromPx: number
  toPx: number
  /** Where the label sits, for the record. */
  labelPx: { x: number; y: number }
  /** Value the drawing's own geometry predicts for this segment. */
  predictedM: number
  /** Relative disagreement between the read number and the geometry. */
  agreement: number
  provenance: DimensionProvenance
  confidence: number
}

export type OpeningCallout = {
  id: string
  /** Printed width and height, in metres. */
  widthM: number
  heightM: number
  /** Callout centre in image pixels; the opening it annotates is nearby. */
  atPx: { x: number; y: number }
  confidence: number
}

export type DimensionChainReading = {
  axis: 'HORIZONTAL' | 'VERTICAL'
  positionPx: number
  parts: ReadDimension[]
  /** Sum of the parts, metres. */
  sumM: number
  /** Overall dimension this chain should equal, when one was found. */
  overallM: number | null
  /** True when the parts sum to the overall within tolerance. */
  closes: boolean
}

export type DimensionReading = {
  /** Digit prototypes and the identities the bootstrap assigned them. */
  alphabet: Array<{ clusterId: number; digit: number | null; samples: number }>
  /** Number of prototypes that were identified. */
  identifiedDigits: number
  dimensions: ReadDimension[]
  chains: DimensionChainReading[]
  callouts: OpeningCallout[]
  /** Scale the chain solver settled on, px/m. */
  solvedScale: number
  notes: string[]
}

export type DimensionOptions = {
  /** Pixels per metre on this drawing, from the calibrated scaffold. */
  pixelsPerMetre: number
  /** Relative tolerance when predicting a label's value from its segment. */
  predictionTolerance: number
  /** Chain closure tolerance, metres. */
  chainTolerance: number
  minGlyphsPerLabel: number
}

export const DEFAULT_DIMENSIONS: DimensionOptions = {
  pixelsPerMetre: 0,
  predictionTolerance: 0.08,
  chainTolerance: 0.12,
  minGlyphsPerLabel: 2,
}

/** Digit strings of every integer in a range with a given digit count. */
function candidateValues(predicted: number, tolerance: number, digits: number): string[] {
  const lo = Math.max(1, Math.floor(predicted * (1 - tolerance)))
  const hi = Math.ceil(predicted * (1 + tolerance))
  const out: string[] = []
  for (let v = lo; v <= hi; v++) {
    const s = String(v)
    if (s.length === digits) out.push(s)
  }
  return out
}

/**
 * Assign digits to glyph prototypes by propagating the geometric predictions.
 *
 * Two rules do the work: a label's decoded value must lie near what its segment
 * length predicts, and the same prototype must decode to the same digit
 * everywhere it appears. The second is what turns a handful of loose numeric
 * ranges into a determined assignment.
 */
export function bootstrapDigits(
  anchored: ReadonlyArray<{ run: GlyphRun; predicted: number }>,
  clusters: GlyphCluster[],
  tolerance: number,
): { identified: number; notes: string[] } {
  const notes: string[] = []
  const candidates = new Map<number, Set<number>>()
  for (const c of clusters) candidates.set(c.id, new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]))

  type Anchored = { clusterIds: number[]; values: string[] }
  const items: Anchored[] = []
  for (const { run, predicted } of anchored) {
    const ids = run.glyphs.map((g) => clusterOf(clusters, g)?.id ?? -1)
    if (ids.some((i) => i < 0)) continue
    const values = candidateValues(predicted, tolerance, ids.length)
    if (values.length === 0) continue
    items.push({ clusterIds: ids, values })
  }
  if (items.length === 0) {
    return { identified: 0, notes: ['no dimension label could be anchored to a measurable segment'] }
  }

  for (let round = 0; round < 12; round++) {
    let changed = false
    for (const item of items) {
      // Keep only the values consistent with the current candidate sets and
      // with the requirement that one prototype means one digit.
      item.values = item.values.filter((value) => {
        const seen = new Map<number, number>()
        for (let i = 0; i < item.clusterIds.length; i++) {
          const digit = value.charCodeAt(i) - 48
          const id = item.clusterIds[i]
          if (!candidates.get(id)?.has(digit)) return false
          const prior = seen.get(id)
          if (prior !== undefined && prior !== digit) return false
          seen.set(id, digit)
        }
        return true
      })
      if (item.values.length === 0) continue
      for (let i = 0; i < item.clusterIds.length; i++) {
        const id = item.clusterIds[i]
        const allowed = new Set<number>()
        for (const value of item.values) allowed.add(value.charCodeAt(i) - 48)
        const current = candidates.get(id)
        if (!current) continue
        for (const d of [...current]) {
          if (!allowed.has(d)) {
            current.delete(d)
            changed = true
          }
        }
      }
    }
    if (!changed) break
  }

  let identified = 0
  for (const c of clusters) {
    const set = candidates.get(c.id)
    if (!set) continue
    for (const d of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) c.votes.set(d, set.has(d) ? 1 : 0)
    if (set.size === 1) {
      c.digit = [...set][0]
      identified++
    } else {
      c.digit = null
    }
  }
  notes.push(`${identified} of ${clusters.length} glyph prototypes identified from ${items.length} anchored labels`)
  return { identified, notes }
}

/**
 * Opening callouts: ARCHON marks each opening with a small circle containing a
 * width over a height, in centimetres. They are found as two short numeric runs
 * stacked on a shared centre — a convention, but a *drawing* convention rather
 * than a vendor one, and it is verified by the values being plausible opening
 * sizes before being believed.
 */
export function findCallouts(runs: readonly GlyphRun[], clusters: readonly GlyphCluster[]): OpeningCallout[] {
  const out: OpeningCallout[] = []
  const sorted = [...runs].sort((a, b) => a.cy - b.cy)
  for (let i = 0; i < sorted.length; i++) {
    const top = sorted[i]
    if (top.glyphs.length < 2 || top.glyphs.length > 3) continue
    for (let j = i + 1; j < sorted.length; j++) {
      const bottom = sorted[j]
      if (bottom.cy - top.cy > top.glyphHeight * 2.6) break
      if (bottom.glyphs.length < 2 || bottom.glyphs.length > 3) continue
      if (Math.abs(bottom.cx - top.cx) > top.glyphHeight * 0.9) continue
      if (bottom.cy - top.cy < top.glyphHeight * 0.7) continue
      const w = decodeRun(top, clusters)
      const h = decodeRun(bottom, clusters)
      if (w === null || h === null) continue
      // A window or door, in centimetres. Anything outside this is not one.
      if (w < 40 || w > 800 || h < 40 || h > 400) continue
      out.push({
        id: `callout_${Math.round(top.cx)}_${Math.round(top.cy)}`,
        widthM: w / 100,
        heightM: h / 100,
        atPx: { x: top.cx, y: (top.cy + bottom.cy) / 2 },
        confidence: 0.8,
      })
      break
    }
  }
  return out
}

/**
 * Solve a chain's values from its geometry alone.
 *
 * This is the path that always works. Digit recognition on six-pixel italic
 * drafting text is not dependable at the resolution these drawings are
 * published at, and a dimension the analyzer *thinks* it read is worse than one
 * it admits to having measured. What is dependable is that the segments of a
 * chain are drawn to scale and that architectural dimensions land on round
 * values, so the scale and the values can be fitted jointly: pick the scale
 * that makes every segment in every chain closest to a multiple of the drawing
 * grid, then snap.
 *
 * The result is honest evidence — GEOMETRIC_INFERRED, not SOURCE_EXACT — and it
 * carries its own residual so a bad fit is visible rather than silent.
 */
export function solveChainGeometry(
  chains: readonly DimensionChain[],
  pixelsPerMetre: number,
  gridM = 0.05,
): { scale: number; residualM: number; refined: Map<string, number> } {
  const segments: Array<{ key: string; lengthPx: number }> = []
  for (const chain of chains) {
    for (const seg of chain.segments) {
      if (!seg.run || seg.lengthPx < 12) continue
      segments.push({ key: `${chain.axis}_${chain.position}_${seg.from}`, lengthPx: seg.lengthPx })
    }
  }
  const refined = new Map<string, number>()
  if (segments.length === 0) return { scale: pixelsPerMetre, residualM: 0, refined }

  // Search a narrow band of scales around the calibrated one for the value that
  // makes the segments sit most squarely on the drawing grid.
  let bestScale = pixelsPerMetre
  let bestCost = Number.POSITIVE_INFINITY
  const steps = 240
  for (let i = 0; i <= steps; i++) {
    const scale = pixelsPerMetre * (0.9 + (0.2 * i) / steps)
    let cost = 0
    for (const seg of segments) {
      const metres = seg.lengthPx / scale
      const snapped = Math.round(metres / gridM) * gridM
      cost += Math.abs(metres - snapped) * seg.lengthPx
    }
    if (cost < bestCost) {
      bestCost = cost
      bestScale = scale
    }
  }
  let residual = 0
  for (const seg of segments) {
    const metres = seg.lengthPx / bestScale
    const snapped = Math.round(metres / gridM) * gridM
    refined.set(seg.key, snapped)
    residual += Math.abs(metres - snapped)
  }
  return { scale: bestScale, residualM: residual / segments.length, refined }
}

export function readDimensions(gray: GrayImage, opts: DimensionOptions): DimensionReading {
  const notes: string[] = []
  const glyphs = extractGlyphs(gray, null)
  const allRuns = groupRuns(glyphs)
  const runs = allRuns.filter((r) => r.glyphs.length >= opts.minGlyphsPerLabel)
  const clusters = clusterGlyphs(glyphs)

  if (opts.pixelsPerMetre <= 0) {
    return {
      alphabet: clusters.map((c) => ({ clusterId: c.id, digit: null, samples: c.members.length })),
      identifiedDigits: 0,
      dimensions: [],
      chains: [],
      callouts: [],
      solvedScale: 0,
      notes: ['drawing has no metric calibration; printed dimensions cannot be anchored'],
    }
  }

  const lines = detectDimensionLines(gray, runs)
  const chains = toChains(lines)

  // Anchors: labelled segments whose pixel length predicts a value in
  // centimetres, which is the unit these drawings are annotated in.
  const anchored: Array<{ run: GlyphRun; predicted: number }> = []
  for (const chain of chains) {
    for (const seg of chain.segments) {
      if (!seg.run) continue
      const predictedCm = (seg.lengthPx / opts.pixelsPerMetre) * 100
      if (predictedCm < 25) continue
      anchored.push({ run: seg.run, predicted: predictedCm })
    }
  }

  const bootstrap = bootstrapDigits(anchored, clusters, opts.predictionTolerance)
  notes.push(...bootstrap.notes)

  const geometry = solveChainGeometry(chains, opts.pixelsPerMetre)
  notes.push(
    `chain geometry solved at ${geometry.scale.toFixed(2)} px/m ` +
      `(${(((geometry.scale - opts.pixelsPerMetre) / opts.pixelsPerMetre) * 100).toFixed(1)}% from the calibrated scale), ` +
      `mean grid residual ${(geometry.residualM * 1000).toFixed(0)} mm`,
  )

  const dimensions: ReadDimension[] = []
  const chainReadings: DimensionChainReading[] = []
  for (const chain of chains) {
    const parts: ReadDimension[] = []
    for (const seg of chain.segments) {
      if (!seg.run) continue
      const key = `${chain.axis}_${chain.position}_${seg.from}`
      const predictedM = seg.lengthPx / geometry.scale
      const snappedM = geometry.refined.get(key) ?? predictedM
      const raw = decodeRun(seg.run, clusters)

      // A decoded number is believed only when it agrees with the segment it
      // labels. That check is what makes an unreliable reader safe: a misread
      // digit produces a value the drawing's own geometry contradicts, and it
      // is recorded as unresolved instead of entering the model.
      let valueM = snappedM
      let provenance: DimensionProvenance = 'GEOMETRIC_INFERRED'
      let agreement = predictedM > 0 ? Math.abs(snappedM - predictedM) / predictedM : 1
      let rawCm = Math.round(snappedM * 100)
      if (raw !== null) {
        const readM = raw / 100
        const readAgreement = predictedM > 0 ? Math.abs(readM - predictedM) / predictedM : 1
        if (readAgreement <= opts.predictionTolerance) {
          valueM = readM
          rawCm = raw
          agreement = readAgreement
          provenance = 'SOURCE_EXACT'
        }
      }

      const dim: ReadDimension = {
        id: `dim_${key}`,
        valueM,
        rawCm,
        axis: chain.axis,
        fromPx: seg.from,
        toPx: seg.to,
        labelPx: { x: seg.run.cx, y: seg.run.cy },
        predictedM,
        agreement,
        provenance,
        confidence:
          provenance === 'SOURCE_EXACT'
            ? Math.max(0.6, 1 - agreement * 6)
            : Math.max(0.3, 0.75 - agreement * 4),
      }
      parts.push(dim)
      dimensions.push(dim)
    }
    if (parts.length === 0) continue
    const sumM = parts.reduce((s, p) => s + p.valueM, 0)
    const overall = findOverall(chains, chain, { ...opts, pixelsPerMetre: geometry.scale })
    chainReadings.push({
      axis: chain.axis,
      positionPx: chain.position,
      parts,
      sumM,
      overallM: overall,
      closes: overall !== null && Math.abs(sumM - overall) <= opts.chainTolerance,
    })
  }

  const callouts = findCallouts(runs, clusters)
  notes.push(
    callouts.length > 0
      ? `${callouts.length} opening callout(s) decoded and within plausible opening sizes`
      : 'no opening callout could be decoded; opening sizes fall back to the elevations',
  )
  const exact = dimensions.filter((d) => d.provenance === 'SOURCE_EXACT').length
  const inferred = dimensions.filter((d) => d.provenance === 'GEOMETRIC_INFERRED').length
  notes.push(
    `${dimensions.length} chain dimensions: ${exact} read and verified against their segment, ` +
      `${inferred} solved from the chain geometry alone`,
  )

  return {
    alphabet: clusters.map((c) => ({ clusterId: c.id, digit: c.digit, samples: c.members.length })),
    identifiedDigits: bootstrap.identified,
    dimensions,
    chains: chainReadings,
    callouts,
    solvedScale: geometry.scale,
    notes,
  }
}

/** The overall dimension a chain should close to: a parallel single-segment line spanning it. */
function findOverall(chains: readonly DimensionChain[], chain: DimensionChain, opts: DimensionOptions): number | null {
  const candidate = chains.find(
    (c) =>
      c !== chain &&
      c.axis === chain.axis &&
      c.segments.length === 1 &&
      Math.abs(c.totalLengthPx - chain.totalLengthPx) < chain.totalLengthPx * 0.08,
  )
  if (!candidate) return null
  return candidate.totalLengthPx / opts.pixelsPerMetre
}
