/**
 * Level annotations on a section (§6, §12).
 *
 * A section's level markers are the most valuable printed dimensions in an
 * ARCHON package and the easiest to place: each is a signed number sitting
 * beside a horizontal reference line whose height the section geometry has
 * already measured. That gives every marker a predicted value before anything
 * is read, and — since the published building height anchors the datum — an
 * independent check afterwards.
 *
 * They are also, after the resolution upgrade, the largest text on any
 * drawing in the package: roughly 21 pixels tall against 9 on a plan. So this
 * is where the alphabet is learned, and the templates then transfer to the
 * plans, which are drawn in the same text style but too small to bootstrap
 * from.
 *
 * PORT_DIRECT (Kotlin).
 */
import type { GrayImage } from '../contracts/raster.js'
import type { PixelBox } from './contracts.js'
import { runGlyphs, type RunGlyphs } from './room-anchor.js'
import { groupRuns, inkComponents, DEFAULT_RUNS, type RunOptions } from './text-runs.js'
import { paddedCandidateStrings } from './templates.js'
import type { TextGlyph } from './recognizer.js'

export type LevelPrediction = {
  /** Height above the ±0.00 datum, metres, as the section geometry measured it. */
  metres: number
  /** Row in the source image the level line sits on. */
  row: number
  /** How well that row is known, metres. */
  toleranceM: number
  label: string
}

export type SectionLevelCandidate = {
  run: RunGlyphs
  /** Glyphs that are digits (the sign and the comma are excluded). */
  digitGlyphs: TextGlyph[]
  /** Index of the separator component, or -1. */
  separatorIndex: number
  /** Index of the sign component, or -1. */
  signIndex: number
  prediction: LevelPrediction | null
  /** Candidate digit strings, zero-padded, from the prediction. */
  candidates: string[]
  box: PixelBox
}

export type SectionLevelOptions = {
  runs: RunOptions
  /** How far a run may sit from a level line and still annotate it, pixels. */
  maxRowDistance: number
  /** Digits a level marker prints, excluding the sign and separator. */
  digitWidth: number
  slantRad: number
}

export const DEFAULT_SECTION_LEVELS: SectionLevelOptions = {
  // A level marker's sign sits further from its first digit than two digits sit
  // from each other, so the gap allowance has to be generous enough to keep
  // `+4,67` in one piece.
  runs: { ...DEFAULT_RUNS, minHeight: 5, maxHeight: 40, maxGapRatio: 0.75 },
  maxRowDistance: 26,
  digitWidth: 3,
  slantRad: 0,
}

/**
 * Find the level markers and attach a predicted value to each.
 *
 * A marker is recognised structurally: a short run whose components share a
 * height, containing one component much shorter than the rest (the decimal
 * comma) and optionally one narrow leading component (the sign). It is placed
 * by proximity to a measured level row — the association the specification
 * requires before a number may count as a dimension at all (§12).
 */
/**
 * Find the level markers and attach a predicted value to each.
 *
 * A marker is recognised structurally rather than by reading it: a short run
 * in which exactly three components stand at full height — the digits — with
 * the rest being the sign and the decimal comma. That test survives the sign
 * being a plus, a minus or a plus-minus, and the comma being two anti-aliased
 * pixels the threshold may or may not keep.
 *
 * Each marker's value is then predicted from its own position, not from a
 * nearby level line. The section carries a vertical scale (the published
 * building height over the drawing's own extent), so the height of the text's
 * baseline above the datum row *is* the value, up to a constant offset between
 * a marker's text and the line it annotates. That offset is solved from the
 * datum marker itself, whose value is exactly zero by definition — the one
 * printed dimension on any drawing that is known without measurement.
 */
export function findSectionLevels(
  gray: GrayImage,
  datumRow: number,
  pixelsPerMetre: number,
  opts: SectionLevelOptions = DEFAULT_SECTION_LEVELS,
  /**
   * Rows of the horizontal reference lines, source-native and ideally
   * sub-pixel. A marker annotates one of these, and the precision of that row
   * is the precision of the prediction: a row known to half a pixel predicts
   * the printed value to under a centimetre and pins two of its three digits,
   * where a row known to two pixels pins one.
   */
  lineRows: readonly number[] = [],
): SectionLevelCandidate[] {
  if (pixelsPerMetre <= 0) return []
  const runs = groupRuns(inkComponents(gray, opts.runs), opts.runs)
  const glyphRuns = runGlyphs(gray, runs, opts.runs.inkThreshold, opts.slantRad)
  type Marker = { rg: RunGlyphs; digitGlyphs: TextGlyph[]; separatorIndex: number; signIndex: number; baseline: number }
  const markers: Marker[] = []
  for (const rg of glyphRuns) {
    if (rg.glyphs.length < opts.digitWidth + 1 || rg.glyphs.length > opts.digitWidth + 3) continue
    const tallest = Math.max(...rg.glyphs.map((g) => g.height))
    const fullIdx = rg.glyphs.map((g, i) => ({ g, i })).filter(({ g }) => g.height >= tallest * 0.8)
    if (fullIdx.length !== opts.digitWidth) continue
    const shortIdx = rg.glyphs.map((g, i) => ({ g, i })).filter(({ g }) => g.height < tallest * 0.8)
    // Of the short components, an interior one is the comma and a leading one
    // is the sign.
    const separatorIndex = shortIdx.find(({ i }) => i > 0 && i < rg.glyphs.length - 1)?.i ?? -1
    const signIndex = shortIdx.find(({ i }) => i === 0)?.i ?? -1
    markers.push({
      rg,
      digitGlyphs: fullIdx.map(({ g }) => g),
      separatorIndex,
      signIndex,
      baseline: rg.box.y1,
    })
  }
  if (markers.length === 0) return []

  // Attach each marker to the reference line it annotates: the nearest line
  // *below* its text, since drafting convention puts the figure above the
  // line. Going through the line rather than through the text's own position
  // is what removes the text-offset unknown entirely.
  const annotated = (m: Marker): number | null => {
    const height = Math.max(...m.rg.glyphs.map((g) => g.height))
    let best: number | null = null
    let bestD = Number.POSITIVE_INFINITY
    for (const row of lineRows) {
      const d = row - m.baseline
      if (d < -height * 0.4 || d > height * 1.6) continue
      if (d < bestD) {
        bestD = d
        best = row
      }
    }
    return best
  }

  return markers.map((m) => {
    const row = annotated(m)
    const metres = row === null ? (datumRow - m.baseline) / pixelsPerMetre : (datumRow - row) / pixelsPerMetre
    // The datum marker is the one whose line *is* the datum, and its value is
    // exactly zero by definition — the only printed dimension on any drawing
    // that needs no measurement at all.
    const exact = row !== null && Math.abs(row - datumRow) < 1.5
    // A reference row is localised to about a pixel and the text baseline to
    // another, so a marker's predicted value carries a couple of centimetres of
    // uncertainty. Claiming less is how an invariant-position harvest starts
    // teaching wrong characters.
    const toleranceM = exact ? 0.004 : row === null ? 0.12 : 0.032
    const prediction: LevelPrediction = {
      metres,
      row: row ?? m.baseline,
      toleranceM,
      label: exact
        ? 'datum (exact by definition)'
        : row === null
          ? `${metres.toFixed(2)} m from the text position (no reference line found)`
          : `${metres.toFixed(2)} m above datum, from a reference line at row ${row.toFixed(1)}`,
    }
    return {
      run: m.rg,
      digitGlyphs: m.digitGlyphs,
      separatorIndex: m.separatorIndex,
      signIndex: m.signIndex,
      prediction,
      candidates: paddedCandidateStrings(Math.abs(metres) * 100, Math.max(0.4, toleranceM * 100), opts.digitWidth),
      box: m.rg.box,
    }
  })
}

/** Metres per pixel implied by two placed level markers, or null. */
export function verticalScaleFrom(levels: readonly SectionLevelCandidate[]): number | null {
  const placed = levels.filter((l) => l.prediction !== null)
  if (placed.length < 2) return null
  let best: { ppm: number; span: number } | null = null
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const dm = Math.abs((placed[i].prediction as LevelPrediction).metres - (placed[j].prediction as LevelPrediction).metres)
      const dp = Math.abs(placed[i].box.y1 - placed[j].box.y1)
      if (dm < 0.5 || dp < 20) continue
      if (!best || dp > best.span) best = { ppm: dp / dm, span: dp }
    }
  }
  return best ? best.ppm : null
}
