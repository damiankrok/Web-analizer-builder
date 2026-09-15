/**
 * What the section says its heights are — §10, §11.
 *
 * A level marker is three separate things and this module's whole job is to
 * keep them separate until the last possible moment:
 *
 *   1. **a row of pixels** — where the marker's symbol points, measured by
 *      `section-annotations.ts` and owing nothing to any recogniser;
 *   2. **a string** — what an OCR engine made of the figure, which on project
 *      A's ridge marker is `1.95` where the drawing prints `+7,95`;
 *   3. **a height** — which is neither of those until the rows and the strings
 *      have been checked against each other.
 *
 * §10 asks for the first two to be carried side by side. §11 asks for the
 * third to be refused to any single reading that the rest of the drawing
 * contradicts. Both matter for the same reason: a section carries five or six
 * printed levels, they are all on one vertical scale, and that redundancy is
 * the only thing on the sheet that can catch a misread digit. A pipeline that
 * takes each marker at its word throws the redundancy away and then has no
 * defence at all — it would have accepted 1.95 m for a ridge whose own roof
 * sits four metres higher.
 *
 * ## One figure, several conditionings
 *
 * The same crop read at four paddings gives four different strings. Measured
 * on project A: the terrain marker reads correctly only with half a text-height
 * of paper around it, and the ridge marker only with a full one, because the
 * leading sign is a short component the text grouper does not always take into
 * the run. Neither padding is right; asking which is the wrong question. So
 * every conditioning is offered as a *hypothesis*, exactly as `text-regions.ts`
 * already offers a sideways run in both reading directions, and the consensus
 * below picks the one the rest of the drawing agrees with.
 *
 * ## What a digit string can mean
 *
 * A level is printed to two decimals. So `467` is 4.67, not 467, and this is a
 * fact about how levels are drawn rather than about any publisher. Where a
 * separator survives it is believed; where it does not, the last two digits are
 * the fraction. Both readings are offered when they differ.
 *
 * PORT_DIRECT (Kotlin).
 */
import type { SectionAnnotation } from './section-annotations.js'
import type { PlanTextReading } from './text-engine.js'

/** One way a figure might be read, before anything has checked it. */
export type LevelHypothesis = {
  /** The string exactly as the engine returned it. */
  rawText: string
  /** Which conditioning of the crop produced it. */
  conditioning: string
  confidence: number
  /** Metres, signed. */
  valueM: number
  /** Whether the sign was actually read or assumed. */
  signRead: boolean
  /** How the digits were turned into a number. */
  how: string
}

export type DatumSemanticHint = 'GROUND_ZERO' | 'FLOOR' | 'SLAB' | 'EAVE' | 'RIDGE' | 'TERRAIN' | 'UNKNOWN'

/**
 * One level marker, as §10 requires it: raw text, parsed number, the thing it
 * is physically attached to, and the semantic reading, all kept apart.
 */
export type VerticalDatumObservation = {
  id: string
  sourceAssetId: string
  /** Where the marker's symbol points, source-native pixels, sub-pixel. */
  markerPx: { x: number | null; y: number }
  /** How that row was established, and how well. */
  association: 'TRIANGLE_APEX' | 'NEAREST_RULE'
  associationResidualPx: number
  /** Every reading of this figure, one per conditioning. Never collapsed. */
  hypotheses: LevelHypothesis[]
  /** The hypothesis the solver accepted. Null when none was. */
  acceptedHypothesis: LevelHypothesis | null
  /** The accepted reading's value, or null. Never a guess. */
  parsedLevelM: number | null
  /** What the solved scale predicts at this marker's row, once there is one. */
  predictedLevelM: number | null
  semanticHint: DatumSemanticHint
  confidence: number
  status: 'ACCEPTED' | 'RECONCILED' | 'REJECTED' | 'UNREAD'
  why: string
}

export type DatumSolverOptions = {
  /**
   * How far apart two markers' values must be before the pair is allowed to
   * set a scale. Two levels a few centimetres apart divide a small pixel
   * difference by a small metre difference and produce nonsense.
   */
  minPairSeparationM: number
  /** Pixels a marker's row may miss the fitted line by and still be an inlier. */
  inlierTolerancePx: number
  /** Metres it may miss by, whichever is larger. */
  inlierToleranceM: number
  /** Markers that must agree before a solution is offered at all. */
  minInliers: number
  /**
   * Sanity on the solved scale, as the height of the whole drawing in metres.
   * A section of a house is not two metres tall and not sixty.
   */
  minSheetHeightM: number
  maxSheetHeightM: number
}

export const DEFAULT_DATUM_SOLVER: DatumSolverOptions = {
  minPairSeparationM: 0.5,
  inlierTolerancePx: 3,
  inlierToleranceM: 0.05,
  minInliers: 3,
  minSheetHeightM: 2,
  maxSheetHeightM: 60,
}

const DIGITS = /^[0-9]+$/

/**
 * Every height a figure might be stating.
 *
 * Returns nothing for a string with no digits in it, and more than one reading
 * where the separator is missing or where a stray character trails the number
 * — both of which happen, and neither of which this function is entitled to
 * resolve on its own.
 */
export function parseLevelText(raw: string): Array<{ valueM: number; signRead: boolean; how: string }> {
  const text = raw.replace(/\s+/g, '')
  if (text === '') return []
  const out: Array<{ valueM: number; signRead: boolean; how: string }> = []
  const seen = new Set<string>()
  const add = (valueM: number, signRead: boolean, how: string): void => {
    if (!Number.isFinite(valueM)) return
    const key = `${valueM.toFixed(4)}|${signRead}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ valueM, signRead, how })
  }

  // A trailing separator or a stray digit at either end is a recogniser
  // artefact often enough to be worth offering as its own hypothesis.
  const bodies = new Set<string>([text])
  if (text.length > 1) {
    bodies.add(text.slice(0, -1))
    bodies.add(text.slice(1))
  }

  for (const body of bodies) {
    const signMatch = /^[+\-±]/.exec(body)
    const signChar = signMatch ? signMatch[0] : ''
    const rest = signChar === '' ? body : body.slice(1)
    // `±` is only ever printed on the datum itself, and its value is zero
    // whatever follows it. It is still parsed rather than assumed.
    const negative = signChar === '-'
    const signRead = signChar !== ''
    const sign = negative ? -1 : 1
    const trailing = body === text ? '' : ' (with one character trimmed)'

    const sep = /[.,]/.exec(rest)
    if (sep) {
      const [whole, frac] = rest.split(/[.,]/)
      if (DIGITS.test(whole === '' ? '0' : whole) && DIGITS.test(frac ?? '')) {
        const value = Number(`${whole === '' ? '0' : whole}.${frac}`)
        add(sign * value, signRead, `the figure prints a separator: ${whole || '0'} and ${frac}${trailing}`)
      }
      continue
    }
    if (!DIGITS.test(rest) || rest.length === 0) continue
    if (rest.length >= 3) {
      add(
        (sign * Number(rest)) / 100,
        signRead,
        `no separator survived; a level is printed to two decimals, so the last two of ${rest} are the fraction${trailing}`,
      )
    }
    // A short string is ambiguous between whole metres and centimetres, and
    // both are offered rather than one being chosen.
    add(sign * Number(rest), signRead, `${rest} read as whole metres${trailing}`)
    if (rest.length <= 2) add((sign * Number(rest)) / 100, signRead, `${rest} read as centimetres${trailing}`)
  }
  return out
}

/**
 * Turn markers and readings into observations, with nothing decided.
 *
 * `readingsFor` is how the caller supplies whatever its recogniser returned
 * for each crop it built from each marker — one entry per conditioning. This
 * module never calls an engine, which is what keeps it portable and keeps §8's
 * seam intact.
 */
export function buildDatumObservations(
  assetId: string,
  markers: readonly SectionAnnotation[],
  readingsFor: (markerId: string) => Array<{ reading: PlanTextReading; conditioning: string }>,
): VerticalDatumObservation[] {
  const out: VerticalDatumObservation[] = []
  for (const marker of markers) {
    if (marker.kind !== 'LEVEL_MARKER' || marker.level === null) continue
    const hypotheses: LevelHypothesis[] = []
    for (const { reading, conditioning } of readingsFor(marker.id)) {
      for (const p of parseLevelText(reading.text)) {
        hypotheses.push({
          rawText: reading.text,
          conditioning,
          confidence: reading.confidence,
          valueM: p.valueM,
          signRead: p.signRead,
          how: p.how,
        })
      }
    }
    out.push({
      id: marker.id,
      sourceAssetId: assetId,
      markerPx: { x: marker.level.columnPx, y: marker.level.row },
      association: marker.level.method,
      associationResidualPx: marker.level.residualPx,
      hypotheses,
      acceptedHypothesis: null,
      parsedLevelM: null,
      predictedLevelM: null,
      semanticHint: 'UNKNOWN',
      confidence: 0,
      status: hypotheses.length === 0 ? 'UNREAD' : 'REJECTED',
      why:
        hypotheses.length === 0
          ? 'the figure could not be read at any conditioning; the row it points at stands as geometry with no printed value attached'
          : `${hypotheses.length} readings offered across the conditionings, none accepted yet`,
    })
  }
  return out
}

/** The vertical map a section settles on: `metres = (datumRow - row) / pixelsPerMetre`. */
export type VerticalScaleSolution = {
  pixelsPerMetre: number
  /** The row at which the map reads zero. */
  datumRow: number
  metresPerPixel: number
  inlierIds: string[]
  /** §11: the scale every accepted pair implies, before any of them is fused. */
  pairScales: Array<{ a: string; b: string; pixelsPerMetre: number }>
  residualsM: Array<{ id: string; residualM: number }>
  rejected: Array<{ id: string; rawTexts: string[]; predictedLevelM: number; why: string }>
  rmsResidualM: number
  /**
   * The spread of the pairwise scales, as a fraction of the fitted one. §11
   * asks for this explicitly and it is the honest measure of how well the
   * drawing agrees with itself.
   */
  pairSpread: number
  why: string
}

const median = (xs: readonly number[]): number => {
  if (xs.length === 0) return Number.NaN
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * Solve one vertical scale and one datum row from the markers, by consensus.
 *
 * Every pair of markers and every pair of their hypotheses proposes a map.
 * Each proposal is scored by how many *other* markers have some hypothesis it
 * explains, then by how tightly, then by how confident those readings were.
 * The winner is refined by least squares over its inliers.
 *
 * Nothing here trusts a reading because it was confident. A recogniser that is
 * ninety-six percent sure of `3.06` and zero percent sure of `1.95` is telling
 * the truth about both in this case and would be lying in the next one, so
 * confidence breaks ties and never decides.
 */
export function solveVerticalScale(
  observations: VerticalDatumObservation[],
  opts: DatumSolverOptions = DEFAULT_DATUM_SOLVER,
  sheetHeightPx = Number.POSITIVE_INFINITY,
): VerticalScaleSolution | null {
  const usable = observations.filter((o) => o.hypotheses.length > 0)
  if (usable.length < 2) return null

  type Model = { pixelsPerMetre: number; datumRow: number }
  const explains = (m: Model, o: VerticalDatumObservation): LevelHypothesis | null => {
    const predicted = (m.datumRow - o.markerPx.y) / m.pixelsPerMetre
    const tol = Math.max(opts.inlierToleranceM, opts.inlierTolerancePx / m.pixelsPerMetre)
    let best: LevelHypothesis | null = null
    let bestErr = Number.POSITIVE_INFINITY
    for (const h of o.hypotheses) {
      const err = Math.abs(h.valueM - predicted)
      if (err > tol) continue
      // A hypothesis whose sign was actually read is preferred over one that
      // assumed it, at equal error, because the sign is the half of a level
      // marker a recogniser most often drops.
      const score = err - (h.signRead ? tol * 0.15 : 0)
      if (score < bestErr) {
        bestErr = score
        best = h
      }
    }
    return best
  }

  let best: { model: Model; inliers: Array<{ o: VerticalDatumObservation; h: LevelHypothesis }>; error: number; conf: number } | null = null
  for (let i = 0; i < usable.length; i++) {
    for (let j = i + 1; j < usable.length; j++) {
      const a = usable[i]
      const b = usable[j]
      const dRow = b.markerPx.y - a.markerPx.y
      if (Math.abs(dRow) < 1) continue
      for (const ha of a.hypotheses) {
        for (const hb of b.hypotheses) {
          const dValue = ha.valueM - hb.valueM
          if (Math.abs(dValue) < opts.minPairSeparationM) continue
          const pixelsPerMetre = dRow / dValue
          if (!Number.isFinite(pixelsPerMetre) || pixelsPerMetre <= 0) continue
          if (Number.isFinite(sheetHeightPx)) {
            const sheetM = sheetHeightPx / pixelsPerMetre
            if (sheetM < opts.minSheetHeightM || sheetM > opts.maxSheetHeightM) continue
          }
          const model: Model = { pixelsPerMetre, datumRow: a.markerPx.y + pixelsPerMetre * ha.valueM }
          const inliers: Array<{ o: VerticalDatumObservation; h: LevelHypothesis }> = []
          let error = 0
          let conf = 0
          for (const o of usable) {
            const h = explains(model, o)
            if (!h) continue
            inliers.push({ o, h })
            error += Math.abs(h.valueM - (model.datumRow - o.markerPx.y) / model.pixelsPerMetre)
            conf += h.confidence
          }
          if (inliers.length < opts.minInliers) continue
          const better =
            best === null ||
            inliers.length > best.inliers.length ||
            (inliers.length === best.inliers.length && error < best.error - 1e-9) ||
            (inliers.length === best.inliers.length && Math.abs(error - best.error) <= 1e-9 && conf > best.conf)
          if (better) best = { model, inliers, error, conf }
        }
      }
    }
  }
  if (!best) return null

  // Least squares over the inliers: row = datumRow - pixelsPerMetre * value.
  const n = best.inliers.length
  let sv = 0
  let sr = 0
  for (const { o, h } of best.inliers) {
    sv += h.valueM
    sr += o.markerPx.y
  }
  const mv = sv / n
  const mr = sr / n
  let num = 0
  let den = 0
  for (const { o, h } of best.inliers) {
    num += (h.valueM - mv) * (o.markerPx.y - mr)
    den += (h.valueM - mv) ** 2
  }
  const pixelsPerMetre = den > 0 ? -num / den : best.model.pixelsPerMetre
  const datumRow = mr + pixelsPerMetre * mv
  const model: Model = { pixelsPerMetre, datumRow }

  const pairScales: VerticalScaleSolution['pairScales'] = []
  for (let i = 0; i < best.inliers.length; i++) {
    for (let j = i + 1; j < best.inliers.length; j++) {
      const a = best.inliers[i]
      const b = best.inliers[j]
      const dValue = a.h.valueM - b.h.valueM
      if (Math.abs(dValue) < opts.minPairSeparationM) continue
      pairScales.push({
        a: a.o.id,
        b: b.o.id,
        pixelsPerMetre: (b.o.markerPx.y - a.o.markerPx.y) / dValue,
      })
    }
  }

  const residualsM: VerticalScaleSolution['residualsM'] = []
  let sq = 0
  for (const { o, h } of best.inliers) {
    const residualM = h.valueM - (datumRow - o.markerPx.y) / pixelsPerMetre
    residualsM.push({ id: o.id, residualM })
    sq += residualM ** 2
  }

  const inlierIds = new Set(best.inliers.map((x) => x.o.id))
  const rejected: VerticalScaleSolution['rejected'] = []
  for (const o of observations) {
    if (inlierIds.has(o.id)) continue
    const predictedLevelM = (datumRow - o.markerPx.y) / pixelsPerMetre
    rejected.push({
      id: o.id,
      rawTexts: [...new Set(o.hypotheses.map((h) => h.rawText))],
      predictedLevelM,
      why:
        o.hypotheses.length === 0
          ? 'no reading at any conditioning'
          : `no reading of it is within tolerance of the ${predictedLevelM.toFixed(3)} m its row implies; ` +
            `the readings offered were ${[...new Set(o.hypotheses.map((h) => h.rawText))].join(', ')}`,
    })
  }

  const scales = pairScales.map((p) => p.pixelsPerMetre)
  const med = median(scales)
  const pairSpread =
    scales.length === 0 || !Number.isFinite(med) || med === 0
      ? 0
      : (Math.max(...scales) - Math.min(...scales)) / med

  // Write the accepted reading back onto the observations. This is the one
  // point at which a string becomes a height, and it happens only for readings
  // the whole drawing agrees with.
  for (const { o, h } of best.inliers) {
    o.acceptedHypothesis = h
    o.parsedLevelM = h.valueM
    o.predictedLevelM = (datumRow - o.markerPx.y) / pixelsPerMetre
    o.status = 'ACCEPTED'
    o.confidence = Math.min(0.97, 0.55 + 0.3 * h.confidence + (h.signRead ? 0.08 : 0))
    o.why =
      `read as ${h.rawText} at ${h.conditioning}; ${h.how}; agrees with the other ` +
      `${best.inliers.length - 1} markers on one vertical scale to ${Math.abs(h.valueM - o.predictedLevelM).toFixed(3)} m`
  }
  for (const o of observations) {
    if (inlierIds.has(o.id)) continue
    o.predictedLevelM = (datumRow - o.markerPx.y) / pixelsPerMetre
    o.confidence = 0
    o.why =
      o.hypotheses.length === 0
        ? o.why
        : `rejected by the consensus: the readings ${[...new Set(o.hypotheses.map((h) => h.rawText))].join(', ')} ` +
          `cannot be reconciled with the ${o.predictedLevelM.toFixed(3)} m its own row implies (§11)`
  }

  return {
    pixelsPerMetre,
    datumRow,
    metresPerPixel: 1 / pixelsPerMetre,
    inlierIds: [...inlierIds],
    pairScales,
    residualsM,
    rejected,
    rmsResidualM: Math.sqrt(sq / n),
    pairSpread,
    why:
      `${n} of ${observations.length} level markers agree on ${pixelsPerMetre.toFixed(3)} px per metre with the zero at ` +
      `row ${datumRow.toFixed(2)}; the ${pairScales.length} pairwise scales span ${(pairSpread * 100).toFixed(2)}% of their median`,
  }
}

/**
 * Give a rejected marker back its printed value where the drawing can prove it.
 *
 * A marker whose row the geometry knows and whose figure the recogniser
 * mangled is not a lost level: the solved scale predicts what the figure must
 * say, and if some reading of it is one substituted character away from that
 * prediction, the drawing has effectively told us twice. That is worth
 * recovering, and it is emphatically *not* worth recording as though the
 * digits had been read — hence `RECONCILED`, which ranks below `ACCEPTED`
 * everywhere it is used.
 *
 * One substitution and no more. A reading two characters away from the
 * prediction is not evidence of anything; it is the prediction with a
 * decoration, and accepting it would let this function manufacture agreement
 * wherever the scale happened to be wrong.
 */
export function reconcileRejected(
  observations: VerticalDatumObservation[],
  solution: VerticalScaleSolution,
): number {
  const digitsOf = (s: string): string => s.replace(/[^0-9]/g, '')
  let count = 0
  for (const o of observations) {
    if (o.status !== 'REJECTED' || o.predictedLevelM === null) continue
    const predicted = o.predictedLevelM
    const canonical = `${Math.round(Math.abs(predicted) * 100)}`.padStart(3, '0')
    let repaired: LevelHypothesis | null = null
    for (const h of o.hypotheses) {
      const digits = digitsOf(h.rawText)
      if (digits.length !== canonical.length) continue
      let diff = 0
      for (let i = 0; i < digits.length; i++) if (digits[i] !== canonical[i]) diff++
      if (diff === 1) {
        repaired = h
        break
      }
    }
    if (!repaired) continue
    const signed = predicted < 0 ? -Math.abs(Number(canonical) / 100) : Number(canonical) / 100
    o.status = 'RECONCILED'
    o.acceptedHypothesis = repaired
    o.parsedLevelM = signed
    o.confidence = 0.55
    o.why =
      `the recogniser read ${repaired.rawText}, which no reading reconciles with this marker's row. The solved ` +
      `scale puts that row at ${predicted.toFixed(3)} m, whose figure would be ${canonical}: one character from what ` +
      'was read. The value is taken as the publisher’s but recorded as reconciled, not as read (§11)'
    count++
  }
  return count
}

/**
 * A provisional semantic reading of each accepted level.
 *
 * Provisional is the operative word and the field is named `semanticHint` for
 * it. Ordering says which level is the lowest and which the highest; it does
 * not say that the highest is a ridge, because a flat-roofed building's
 * highest printed level is a parapet and a section through a garage wing may
 * not reach the ridge at all. What settles it is matching a level against
 * geometry the roof extraction has fitted, which happens in §12's fusion and
 * not here.
 */
export function hintSemantics(observations: VerticalDatumObservation[]): void {
  const placed = observations.filter((o) => o.parsedLevelM !== null)
  if (placed.length === 0) return
  const values = placed.map((o) => o.parsedLevelM as number)
  const highest = Math.max(...values)
  for (const o of placed) {
    const v = o.parsedLevelM as number
    o.semanticHint =
      Math.abs(v) < 1e-6
        ? 'GROUND_ZERO'
        : v < 0
          ? 'TERRAIN'
          : v === highest
            ? 'RIDGE'
            : 'FLOOR'
  }
}
