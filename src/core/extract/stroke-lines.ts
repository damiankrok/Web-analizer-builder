/**
 * Finding the thin strokes a drawing is built from — STAGE WEB-PIVOT-06 §7,
 * §11.
 *
 * A global ink threshold cannot do this, and the reason is visible on any
 * published plan: the sheet has three tones, not two. Paper is near white,
 * rooms are filled a mid grey, and the line work is dark. A threshold loose
 * enough to catch a dimension line drawn over a room also catches the whole
 * room, and every row of the drawing then looks like one enormous line.
 *
 * What actually distinguishes a stroke is not how dark it is but that it is
 * darker than what is immediately beside it, across its own width. So the
 * response measured here is a directional top-hat: for a horizontal stroke,
 * compare each pixel with the lightest value within a few pixels *above and
 * below* it. A hairline over a grey room answers strongly, because its
 * neighbours are the room. A room answers not at all, because its neighbours
 * are the room too. And a wall — the other thing a plan draws in solid dark —
 * answers only at its two edges, never through its body, which is what keeps
 * walls out of a set of dimension baselines and, later, lets them be measured
 * as bands with a thickness (§11).
 *
 * Nothing here decides what a stroke is *for*.
 *
 * PORT_DIRECT (Kotlin).
 */
import type { GrayImage } from '../contracts/raster.js'

export type StrokeOptions = {
  /**
   * Half-width of the window a stroke is compared against, pixels. It must
   * exceed the thickest stroke that should still answer, and stay well below
   * the thinnest wall that should not.
   */
  radiusPx: number
  /** How much darker than its surroundings a stroke must be, 0..255. */
  minContrast: number
  /** Shortest line, as a fraction of the image's long edge. */
  minLineFraction: number
  /** Gap along a line that may be jumped: text and ticks interrupt it. */
  maxGapPx: number
  /** Fraction of a run's samples that must still read as a thin stroke. */
  minThinFraction: number
}

export const DEFAULT_STROKES: StrokeOptions = {
  radiusPx: 4,
  minContrast: 28,
  minLineFraction: 0.06,
  maxGapPx: 6,
  minThinFraction: 0.8,
}

export type StrokeMask = {
  width: number
  height: number
  /** 1 where a stroke of the requested direction was found. */
  data: Uint8Array
}

/**
 * Where the drawing has a thin stroke running along `axis`.
 *
 * `axis` names the direction the stroke *runs*: `X` finds horizontal strokes
 * by looking up and down, `Y` finds vertical ones by looking left and right.
 */
export function strokeMask(
  gray: GrayImage,
  axis: 'X' | 'Y',
  opts: StrokeOptions = DEFAULT_STROKES,
): StrokeMask {
  const { width, height, data } = gray
  const out = new Uint8Array(width * height)
  const r = Math.max(1, Math.round(opts.radiusPx))
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = data[y * width + x]
      // The lightest neighbour across the stroke's width is the background it
      // is drawn on; a grayscale dilation, done the simple way because the
      // window is a handful of pixels.
      let background = 0
      if (axis === 'X') {
        for (let d = -r; d <= r; d++) {
          const yy = y + d
          if (yy < 0 || yy >= height) continue
          const n = data[yy * width + x]
          if (n > background) background = n
        }
      } else {
        for (let d = -r; d <= r; d++) {
          const xx = x + d
          if (xx < 0 || xx >= width) continue
          const n = data[y * width + xx]
          if (n > background) background = n
        }
      }
      if (background - v >= opts.minContrast) out[y * width + x] = 1
    }
  }
  return { width, height, data: out }
}

export type StrokeRun = {
  /** Row (for a horizontal stroke) or column (for a vertical one). */
  position: number
  from: number
  to: number
  /** Fraction of samples along the run that read as a stroke. */
  coverage: number
}

/** Maximal runs along one scanline, tolerating gaps where text crosses. */
function runsOn(
  present: (t: number) => boolean,
  length: number,
  minLength: number,
  maxGap: number,
): Array<{ from: number; to: number; covered: number }> {
  const out: Array<{ from: number; to: number; covered: number }> = []
  let start = -1
  let last = -1
  let covered = 0
  const flush = (): void => {
    if (start >= 0 && last - start + 1 >= minLength) out.push({ from: start, to: last, covered })
    start = -1
    last = -1
    covered = 0
  }
  for (let t = 0; t < length; t++) {
    if (!present(t)) {
      if (start >= 0 && t - last > maxGap) flush()
      continue
    }
    if (start < 0) start = t
    last = t
    covered++
  }
  flush()
  return out
}

/** Every long thin stroke running along `axis`. */
export function detectStrokeRuns(
  mask: StrokeMask,
  axis: 'X' | 'Y',
  opts: StrokeOptions = DEFAULT_STROKES,
): StrokeRun[] {
  const { width, height, data } = mask
  const minLen = Math.round(Math.max(width, height) * opts.minLineFraction)
  const out: StrokeRun[] = []
  const outer = axis === 'X' ? height : width
  const inner = axis === 'X' ? width : height
  for (let p = 0; p < outer; p++) {
    const at = axis === 'X' ? (t: number) => data[p * width + t] === 1 : (t: number) => data[t * width + p] === 1
    for (const run of runsOn(at, inner, minLen, opts.maxGapPx)) {
      const coverage = run.covered / (run.to - run.from + 1)
      if (coverage < opts.minThinFraction) continue
      out.push({ position: p, from: run.from, to: run.to, coverage })
    }
  }
  return out
}

/**
 * Collapse runs that describe one stroke.
 *
 * A two-pixel line answers on both its rows, and antialiasing can add a third.
 * Neighbouring runs that overlap along their length are one stroke, and the
 * merged run keeps the widest extent and the best coverage.
 */
export function mergeStrokeRuns(runs: readonly StrokeRun[], radiusPx: number): StrokeRun[] {
  const sorted = [...runs].sort((a, b) => a.position - b.position || a.from - b.from)
  const merged: StrokeRun[] = []
  for (const run of sorted) {
    const prev = merged.find(
      (m) =>
        Math.abs(m.position - run.position) <= radiusPx &&
        run.from <= m.to &&
        run.to >= m.from,
    )
    if (prev) {
      prev.from = Math.min(prev.from, run.from)
      prev.to = Math.max(prev.to, run.to)
      prev.coverage = Math.max(prev.coverage, run.coverage)
      continue
    }
    merged.push({ ...run })
  }
  return merged
}
