/**
 * Digit templates harvested from the drawing itself (§8A).
 *
 * Unsupervised clustering of ten-pixel glyphs does not work well enough to
 * build an alphabet from — tried, and it either fragments ten digits into a
 * hundred prototypes or merges `3`, `8` and `6` into one. The way out is to
 * notice that the drawing contains labelled training data, and that the chain
 * solver can extract it without reading anything.
 *
 * A dimension chain is drawn to a single unknown scale and its printed values
 * are whole centimetres, so the scale at which many independent chains
 * simultaneously land on integers is essentially unique (see `voteScale`). At
 * that scale a chain's segments have *known* values, and a label with the
 * matching digit count is therefore a known character sequence over known
 * glyph images. That is supervision, harvested from the page.
 *
 * Classification is then ordinary nearest-template matching, with two
 * refusals that matter more than the matching itself: an absolute similarity
 * floor, and a margin over the runner-up. A glyph that is not clearly one
 * character is returned as unread. The pipeline's value comes from the numbers
 * it is sure about, and a plausible-looking wrong digit in a dimension is worse
 * than no dimension at all.
 *
 * PORT_DIRECT (Kotlin).
 */
import type { TextGlyph } from './recognizer.js'
import { profileSimilarity, GLYPH_COLS, GLYPH_ROWS } from './recognizer.js'

/** Re-exported so callers need not import the recogniser for one function. */
export const profileSimilarityFor = profileSimilarity

const CELLS = GLYPH_COLS * GLYPH_ROWS

export type DigitTemplate = {
  character: string
  /** Mean profile of the examples, renormalised. */
  profile: Float32Array
  examples: number
  /** Mean hole count of the examples. */
  meanHoles: number
  /** Mean aspect of the examples. */
  meanAspect: number
}

export type TemplateBank = {
  templates: DigitTemplate[]
  /** Characters covered. */
  alphabet: string
  /** How many labelled glyph examples were harvested. */
  examples: number
  /** Labels that supplied them. */
  labels: number
  notes: string[]
}

export type ClassifyOptions = {
  /** Similarity a match must reach at all. */
  floor: number
  /** How far the best match must beat the runner-up. */
  margin: number
  /** Reject a match whose hole count differs by more than this. */
  holeTolerance: number
  /** Reject a match whose aspect ratio differs by more than this fraction. */
  aspectTolerance: number
}

export const DEFAULT_CLASSIFY: ClassifyOptions = {
  floor: 0.62,
  margin: 0.06,
  holeTolerance: 0.6,
  aspectTolerance: 0.45,
}

/** One supervised example: a glyph with a known character. */
export type LabelledGlyph = { glyph: TextGlyph; character: string }

/**
 * Build a template bank by averaging the examples of each character.
 *
 * Averaging rather than keeping every example is deliberate: the examples of
 * one digit differ mainly by sub-pixel phase and threshold, and their mean is
 * a cleaner target than any individual. Characters with a single example are
 * kept but flagged through `examples`, which the caller can use to discount a
 * reading that rests on one instance.
 */
export function buildTemplates(examples: readonly LabelledGlyph[]): TemplateBank {
  const notes: string[] = []
  const byChar = new Map<string, TextGlyph[]>()
  for (const e of examples) {
    const list = byChar.get(e.character)
    if (list) list.push(e.glyph)
    else byChar.set(e.character, [e.glyph])
  }
  const templates: DigitTemplate[] = []
  for (const [character, glyphs] of [...byChar.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const profile = new Float32Array(CELLS)
    for (const g of glyphs) for (let i = 0; i < CELLS; i++) profile[i] += g.profile[i]
    let norm = 0
    for (let i = 0; i < CELLS; i++) norm += profile[i] * profile[i]
    norm = Math.sqrt(norm)
    if (norm > 1e-6) for (let i = 0; i < CELLS; i++) profile[i] /= norm
    templates.push({
      character,
      profile,
      examples: glyphs.length,
      meanHoles: glyphs.reduce((a, g) => a + g.holes, 0) / glyphs.length,
      meanAspect: glyphs.reduce((a, g) => a + g.aspect, 0) / glyphs.length,
    })
  }
  const alphabet = templates.map((t) => t.character).join('')
  notes.push(
    `template bank over {${alphabet}} from ${examples.length} harvested examples ` +
      `(${templates.map((t) => `${t.character}:${t.examples}`).join(' ')})`,
  )
  return { templates, alphabet, examples: examples.length, labels: 0, notes }
}

export type Classification = {
  character: string | null
  confidence: number
  /** Best and runner-up similarity, for the audit. */
  best: number
  runnerUp: number
  reason?: string
}

/** Nearest template, with the two refusals that keep a wrong digit out. */
export function classifyGlyph(
  glyph: TextGlyph,
  bank: TemplateBank,
  opts: ClassifyOptions = DEFAULT_CLASSIFY,
): Classification {
  let best: DigitTemplate | null = null
  let bestSim = -2
  let runnerUp = -2
  for (const t of bank.templates) {
    if (Math.abs(t.meanHoles - glyph.holes) > opts.holeTolerance) continue
    if (Math.abs(t.meanAspect - glyph.aspect) > Math.max(0.18, t.meanAspect * opts.aspectTolerance)) continue
    const sim = profileSimilarity(t.profile, glyph.profile)
    if (sim > bestSim) {
      runnerUp = bestSim
      bestSim = sim
      best = t
    } else if (sim > runnerUp) runnerUp = sim
  }
  if (!best) return { character: null, confidence: 0, best: 0, runnerUp: 0, reason: 'no template passed the shape gates' }
  if (bestSim < opts.floor) {
    return {
      character: null,
      confidence: 0,
      best: bestSim,
      runnerUp: Math.max(0, runnerUp),
      reason: `best match ${best.character} at ${bestSim.toFixed(2)} is below the ${opts.floor} floor`,
    }
  }
  if (runnerUp > -2 && bestSim - runnerUp < opts.margin) {
    return {
      character: null,
      confidence: 0,
      best: bestSim,
      runnerUp,
      reason: `ambiguous: ${best.character} at ${bestSim.toFixed(2)} beats runner-up by only ${(bestSim - runnerUp).toFixed(3)}`,
    }
  }
  // Confidence blends absolute quality, the margin, and how many examples the
  // template rests on.
  const quality = Math.min(1, (bestSim - opts.floor) / (1 - opts.floor))
  const separation = Math.min(1, (bestSim - Math.max(0, runnerUp)) / 0.25)
  const support = Math.min(1, best.examples / 3)
  return {
    character: best.character,
    confidence: Math.max(0.05, Math.min(0.97, 0.45 * quality + 0.35 * separation + 0.2 * support)),
    best: bestSim,
    runnerUp: Math.max(0, runnerUp),
  }
}

/** Read a whole glyph run with a bank. */
export function classifyRun(
  glyphs: readonly TextGlyph[],
  bank: TemplateBank,
  opts: ClassifyOptions = DEFAULT_CLASSIFY,
): { text: string | null; chars: Array<string | null>; confidence: number[]; reasons: string[] } {
  const chars: Array<string | null> = []
  const confidence: number[] = []
  const reasons: string[] = []
  for (const g of glyphs) {
    const c = classifyGlyph(g, bank, opts)
    chars.push(c.character)
    confidence.push(c.confidence)
    if (c.reason) reasons.push(c.reason)
  }
  const text = chars.every((c) => c !== null) ? chars.join('') : null
  return { text, chars, confidence, reasons }
}

/**
 * How well a labelling of glyph images holds together (§8A, §11).
 *
 * This is the objective that breaks the circularity between scale and
 * recognition. Predicting values needs a scale; measuring the scale needs
 * values; and an alternating estimate started from a rough calibration simply
 * converges to whichever self-consistent wrong answer it was nearest — it
 * trains templates on its own mistaken predictions and then confirms them.
 *
 * Coherence is external to that loop because it never looks at values at all.
 * It asks only whether the *images* agree with the labels: at the true scale
 * the same printed digit is labelled the same character wherever it appears, so
 * each class is tight and the classes separate. At a wrong scale the same
 * stroke shape gets called `9` in one label and `8` in another, every class
 * blurs toward the mean, and the margin collapses. The quantity below is that
 * margin — each example's similarity to its own class minus its best
 * similarity to any other — and maximising it over candidate scales selects a
 * labelling that the drawing's own pixels endorse.
 */
export function labellingCoherence(examples: readonly LabelledGlyph[]): {
  score: number
  margin: number
  classes: number
  examples: number
} {
  if (examples.length < 4) return { score: 0, margin: 0, classes: 0, examples: examples.length }
  const bank = buildTemplates(examples)
  if (bank.templates.length < 2) return { score: 0, margin: 0, classes: bank.templates.length, examples: examples.length }
  let total = 0
  let n = 0
  for (const e of examples) {
    let own = -2
    let other = -2
    for (const t of bank.templates) {
      const sim = profileSimilarity(t.profile, e.glyph.profile)
      if (t.character === e.character) own = Math.max(own, sim)
      else other = Math.max(other, sim)
    }
    if (own < -1) continue
    total += own - Math.max(0, other)
    n++
  }
  if (n === 0) return { score: 0, margin: 0, classes: bank.templates.length, examples: examples.length }
  const margin = total / n
  // Weight by evidence: a labelling resting on four examples of two characters
  // can be tight by accident, so the score grows with both the number of
  // examples and the number of distinct characters they cover.
  const breadth = Math.min(1, bank.templates.length / 8)
  const depth = Math.min(1, n / 18)
  return { score: margin * (0.35 + 0.4 * breadth + 0.25 * depth), margin, classes: bank.templates.length, examples: n }
}

/**
 * Harvest only the glyph positions every candidate value agrees on.
 *
 * The earlier rule — supervise from labels whose value the geometry pins to a
 * single integer — asks for more precision than a drawing measured in whole
 * pixels can give. A ridge at 7.92 m measured off a section is 7.95 m printed;
 * the prediction is excellent and the last digit is still wrong, and one wrong
 * character corrupts every label that contains it.
 *
 * The fix is to supervise per *position* rather than per label. With the
 * candidate set 791..799 the hundreds digit is 7 and the tens digit is 9 in
 * every member, so those two glyph images are labelled with certainty while
 * the units glyph is left alone. Nothing is guessed, the alphabet grows from
 * whatever the measurements genuinely determine, and each new character
 * narrows the next round's candidates — which is how the ambiguous positions
 * eventually resolve.
 */
export function harvestInvariantPositions(
  labels: ReadonlyArray<{ glyphs: readonly TextGlyph[]; candidates: readonly string[] }>,
): { examples: LabelledGlyph[]; positions: number; labelsUsed: number } {
  const examples: LabelledGlyph[] = []
  let positions = 0
  let labelsUsed = 0
  for (const label of labels) {
    const candidates = label.candidates.filter((c) => c.length === label.glyphs.length)
    if (candidates.length === 0) continue
    let used = false
    for (let k = 0; k < label.glyphs.length; k++) {
      const ch = candidates[0][k]
      if (!candidates.every((c) => c[k] === ch)) continue
      examples.push({ glyph: label.glyphs[k], character: ch })
      positions++
      used = true
    }
    if (used) labelsUsed++
  }
  return { examples, positions, labelsUsed }
}

/**
 * Integer candidates for a measured length, expressed as digit strings.
 *
 * The band is the measurement's own uncertainty, not a fixed tolerance: a
 * dimension read off a 400-pixel baseline is known far better than one read
 * off 30 pixels, and pretending otherwise either throws away certainty or
 * manufactures it.
 */
export function integerCandidateStrings(centreCm: number, absoluteToleranceCm: number, digits: number): string[] {
  const lo = Math.max(Math.pow(10, digits - 1), Math.ceil(centreCm - absoluteToleranceCm))
  const hi = Math.min(Math.pow(10, digits) - 1, Math.floor(centreCm + absoluteToleranceCm))
  const out: string[] = []
  for (let v = lo; v <= hi; v++) out.push(String(v))
  return out
}

/** Same, but zero-padded to a fixed width — how a level marker prints. */
export function paddedCandidateStrings(centreCm: number, absoluteToleranceCm: number, width: number): string[] {
  const lo = Math.max(0, Math.ceil(centreCm - absoluteToleranceCm))
  const hi = Math.min(Math.pow(10, width) - 1, Math.floor(centreCm + absoluteToleranceCm))
  const out: string[] = []
  for (let v = lo; v <= hi; v++) out.push(String(v).padStart(width, '0'))
  return out
}
