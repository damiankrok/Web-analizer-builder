/**
 * Dimension grammar (§9).
 *
 * A token is not a length. `272` on a plan chain is 2.72 m; the same three
 * characters beside a section level are 2.72 m of storey height; `+3,06` is a
 * level 3.06 m above datum; `24` in a room table is an area. Nothing about the
 * characters says which, so the grammar's job is to enumerate the readings a
 * token *could* carry and let later stages — chain arithmetic, published facts,
 * physical association — decide. Committing to one interpretation here is how
 * an analyzer ends up confidently 100 times wrong.
 *
 * The rule that does the most work is plausibility by kind: a chain segment on
 * a house plan is between 0.2 m and 40 m, so a centimetre reading of `1205` is
 * plausible and a millimetre reading is not, while `12` as centimetres is a
 * wall offset and as metres is a building. Readings outside the plausible band
 * for their kind are dropped with a reason, not silently.
 *
 * PORT_DIRECT (Kotlin).
 */
import type { DimensionLabelKind, UnitInterpretation, ValueCandidate } from './contracts.js'

export type GrammarOptions = {
  /** Plausible length band for a linear dimension, metres. */
  minLengthM: number
  maxLengthM: number
  /** Plausible band for a level above datum, metres. */
  minLevelM: number
  maxLevelM: number
  /** Plausible band for an opening dimension, metres. */
  minOpeningM: number
  maxOpeningM: number
}

export const DEFAULT_GRAMMAR: GrammarOptions = {
  minLengthM: 0.2,
  maxLengthM: 60,
  minLevelM: -6,
  maxLevelM: 30,
  minOpeningM: 0.3,
  maxOpeningM: 8,
}

/** Characters the recogniser may emit, beyond digits. */
export const SEPARATORS = ',.'
export const SIGNS = '+-±'

export type ParsedToken = {
  /** Sign prefix, if the token carried one. */
  sign: 1 | -1 | 0
  hadSign: boolean
  /** Digits before the separator. */
  whole: string
  /** Digits after the separator, empty when there was none. */
  fraction: string
  hadSeparator: boolean
}

/** Split a raw token into sign / whole / fraction without interpreting units. */
export function parseToken(text: string): ParsedToken | null {
  let i = 0
  let sign: 1 | -1 | 0 = 1
  let hadSign = false
  if (i < text.length && SIGNS.includes(text[i])) {
    hadSign = true
    sign = text[i] === '-' ? -1 : text[i] === '±' ? 0 : 1
    i++
  }
  let whole = ''
  while (i < text.length && text[i] >= '0' && text[i] <= '9') whole += text[i++]
  let fraction = ''
  let hadSeparator = false
  if (i < text.length && SEPARATORS.includes(text[i])) {
    hadSeparator = true
    i++
    while (i < text.length && text[i] >= '0' && text[i] <= '9') fraction += text[i++]
  }
  if (i !== text.length) return null
  if (whole.length === 0 && fraction.length === 0) return null
  return { sign, hadSign, whole, fraction, hadSeparator }
}

const band = (kind: DimensionLabelKind, opts: GrammarOptions): { lo: number; hi: number } => {
  switch (kind) {
    case 'LEVEL_MARKER':
      return { lo: opts.minLevelM, hi: opts.maxLevelM }
    case 'OPENING_CALLOUT_WIDTH':
    case 'OPENING_CALLOUT_HEIGHT':
      return { lo: opts.minOpeningM, hi: opts.maxOpeningM }
    default:
      return { lo: opts.minLengthM, hi: opts.maxLengthM }
  }
}

/**
 * Every reading a token can carry, with the implausible ones removed.
 *
 * Interpretations are ordered by how commonly they apply to the kind, not by
 * preference: the caller is expected to keep them all until something external
 * chooses. `rejections` records what was dropped and why, because a token with
 * no surviving reading is a finding, not a silence.
 */
export function interpretToken(
  text: string,
  kind: DimensionLabelKind,
  opts: GrammarOptions = DEFAULT_GRAMMAR,
): { candidates: ValueCandidate[]; rejections: string[] } {
  const rejections: string[] = []
  const parsed = parseToken(text)
  if (!parsed) return { candidates: [], rejections: [`"${text}" is not a dimension token`] }

  const out: ValueCandidate[] = []
  const { lo, hi } = band(kind, opts)
  const add = (metres: number, interpretation: UnitInterpretation, confidence: number): void => {
    if (!Number.isFinite(metres)) return
    if (metres < lo || metres > hi) {
      rejections.push(`"${text}" as ${interpretation} is ${metres.toFixed(3)} m, outside ${lo}..${hi} m for ${kind}`)
      return
    }
    out.push({ text, metres, interpretation, confidence })
  }

  if (parsed.hadSeparator) {
    // A separator means the drawing already chose metres: `2,72` is 2.72 m.
    const magnitude = Number(`${parsed.whole || '0'}.${parsed.fraction || '0'}`)
    const signed = parsed.sign === 0 ? 0 : magnitude * parsed.sign
    if (parsed.hadSign) add(signed, 'METRES_SIGNED', 0.95)
    else add(magnitude, 'METRES', 0.9)
    return { candidates: out, rejections }
  }

  const digits = parsed.whole
  const value = Number(digits)
  if (parsed.hadSign) {
    // A signed integer level is printed without a separator only when it is a
    // whole number of metres, which on these drawings means the datum itself.
    add(parsed.sign === 0 ? 0 : value * parsed.sign, 'METRES_SIGNED', 0.7)
    return { candidates: out, rejections }
  }

  // Bare integers: centimetres is the convention on ARCHON plans and sections,
  // but it is a convention, not a certainty, so metres and millimetres stay on
  // the table wherever they are plausible.
  add(value / 100, 'CENTIMETRES', digits.length >= 2 ? 0.85 : 0.5)
  add(value / 1000, 'MILLIMETRES', digits.length >= 4 ? 0.4 : 0.15)
  if (digits.length <= 2) add(value, 'METRES', 0.35)
  return { candidates: out, rejections }
}

/**
 * Pick between readings using an external expectation.
 *
 * Returns the candidate closest to `expectedM` within `tolerance`, or null when
 * none is close enough. Deliberately does not fall back to "the most likely
 * interpretation": a reading nothing corroborates should stay unresolved rather
 * than become a number the model then trusts.
 */
export function chooseByExpectation(
  candidates: readonly ValueCandidate[],
  expectedM: number,
  tolerance: number,
): ValueCandidate | null {
  let best: ValueCandidate | null = null
  let bestErr = Number.POSITIVE_INFINITY
  for (const c of candidates) {
    const err = Math.abs(c.metres - expectedM)
    if (err > Math.abs(expectedM) * tolerance) continue
    if (err < bestErr) {
      bestErr = err
      best = c
    }
  }
  return best
}
