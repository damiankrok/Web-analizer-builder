/**
 * Dimension-line and chain detection on architectural drawings.
 *
 * A printed dimension is not a floating number: it belongs to a segment of a
 * dimension line, delimited by tick marks, and that segment measures a specific
 * distance on the drawing. Recovering the geometry as well as the text is what
 * makes a chain checkable — a chain whose parts sum to its whole is far stronger
 * evidence than three numbers read in isolation, and the segment's own pixel
 * length predicts its value closely enough to teach the analyzer which glyph is
 * which (see glyphs.ts).
 *
 * PORT_DIRECT (Kotlin).
 */
import type { GrayImage } from '../contracts/raster.js'
import type { GlyphRun } from './glyphs.js'

export type Axis = 'HORIZONTAL' | 'VERTICAL'

export type DimensionSegment = {
  /** Position along the line's axis, in pixels. */
  from: number
  to: number
  lengthPx: number
  /** The label found over this segment, if any. */
  run: GlyphRun | null
}

export type DimensionLine = {
  axis: Axis
  /** Position of the line across its axis (row for horizontal, column for vertical). */
  position: number
  from: number
  to: number
  /** Tick positions along the line. */
  ticks: number[]
  segments: DimensionSegment[]
}

export type DimensionLineOptions = {
  inkThreshold: number
  /** Minimum length as a fraction of the image, for a line to be a chain. */
  minLengthFraction: number
  /** How far above/below the line a tick must reach. */
  tickReach: number
  /** Maximum distance from the line to its label, in pixels. */
  labelDistance: number
  /** Tolerated break along a line, in pixels. */
  maxGap: number
}

export const DEFAULT_DIMENSION_LINES: DimensionLineOptions = {
  inkThreshold: 170,
  minLengthFraction: 0.18,
  tickReach: 3,
  labelDistance: 22,
  maxGap: 6,
}

const isInk = (g: GrayImage, x: number, y: number, threshold: number): boolean =>
  x >= 0 && y >= 0 && x < g.width && y < g.height && g.data[y * g.width + x] < threshold

/**
 * Long thin runs of ink that behave like dimension lines: continuous, one pixel
 * or so thick, and crossed at intervals by short ticks.
 */
export function detectDimensionLines(
  gray: GrayImage,
  runs: readonly GlyphRun[],
  opts: DimensionLineOptions = DEFAULT_DIMENSION_LINES,
): DimensionLine[] {
  const lines: DimensionLine[] = []
  const minLenH = gray.width * opts.minLengthFraction
  const minLenV = gray.height * opts.minLengthFraction

  const scan = (axis: Axis): void => {
    const across = axis === 'HORIZONTAL' ? gray.height : gray.width
    const along = axis === 'HORIZONTAL' ? gray.width : gray.height
    const minLen = axis === 'HORIZONTAL' ? minLenH : minLenV
    for (let p = 1; p < across - 1; p++) {
      let start = -1
      let gap = 0
      for (let a = 0; a <= along; a++) {
        const x = axis === 'HORIZONTAL' ? a : p
        const y = axis === 'HORIZONTAL' ? p : a
        const on = a < along && isInk(gray, x, y, opts.inkThreshold)
        if (on) {
          if (start < 0) start = a
          gap = 0
        } else if (start >= 0) {
          gap++
          if (gap > opts.maxGap || a === along) {
            const end = a - gap
            if (end - start >= minLen) {
              const line = buildLine(gray, axis, p, start, end, runs, opts)
              if (line) lines.push(line)
            }
            start = -1
            gap = 0
          }
        }
      }
    }
  }
  scan('HORIZONTAL')
  scan('VERTICAL')

  // A drawn line is a few pixels thick and would otherwise be found several
  // times; keep the strongest representative of each cluster.
  const merged: DimensionLine[] = []
  for (const line of lines.sort((a, b) => b.segments.length - a.segments.length || b.to - b.from - (a.to - a.from))) {
    const dup = merged.some(
      (m) => m.axis === line.axis && Math.abs(m.position - line.position) <= 3 && Math.abs(m.from - line.from) <= 20,
    )
    if (!dup) merged.push(line)
  }
  return merged.sort((a, b) => a.axis.localeCompare(b.axis) || a.position - b.position)
}

function buildLine(
  gray: GrayImage,
  axis: Axis,
  position: number,
  from: number,
  to: number,
  runs: readonly GlyphRun[],
  opts: DimensionLineOptions,
): DimensionLine | null {
  // Ticks: positions where ink reaches clear of the line on both sides. On an
  // architectural drawing these are the slashes or arrows closing a segment.
  const ticks: number[] = []
  for (let a = from; a <= to; a++) {
    const reachA = opts.tickReach
    let above = false
    let below = false
    for (let d = 2; d <= reachA + 2; d++) {
      const xa = axis === 'HORIZONTAL' ? a : position - d
      const ya = axis === 'HORIZONTAL' ? position - d : a
      const xb = axis === 'HORIZONTAL' ? a : position + d
      const yb = axis === 'HORIZONTAL' ? position + d : a
      if (isInk(gray, xa, ya, opts.inkThreshold)) above = true
      if (isInk(gray, xb, yb, opts.inkThreshold)) below = true
    }
    if (above && below) {
      if (ticks.length === 0 || a - ticks[ticks.length - 1] > 4) ticks.push(a)
      else ticks[ticks.length - 1] = a
    }
  }
  const bounds = [from, ...ticks.filter((t) => t > from + 4 && t < to - 4), to]
  const unique: number[] = []
  for (const b of bounds) if (unique.length === 0 || b - unique[unique.length - 1] > 6) unique.push(b)
  if (unique.length < 2) return null

  const segments: DimensionSegment[] = []
  for (let i = 0; i + 1 < unique.length; i++) {
    const s0 = unique[i]
    const s1 = unique[i + 1]
    const mid = (s0 + s1) / 2
    // Label: the numeric run centred over this segment and close to the line.
    let best: GlyphRun | null = null
    let bestScore = Number.POSITIVE_INFINITY
    for (const run of runs) {
      const alongPos = axis === 'HORIZONTAL' ? run.cx : run.cy
      const acrossPos = axis === 'HORIZONTAL' ? run.cy : run.cx
      if (alongPos < s0 || alongPos > s1) continue
      const across = Math.abs(acrossPos - position)
      if (across > opts.labelDistance) continue
      const score = across + Math.abs(alongPos - mid) * 0.2
      if (score < bestScore) {
        bestScore = score
        best = run
      }
    }
    segments.push({ from: s0, to: s1, lengthPx: s1 - s0, run: best })
  }
  if (!segments.some((s) => s.run !== null)) return null
  return { axis, position, from, to, ticks: unique, segments }
}

/**
 * Chains: a dimension line whose segments carry labels. The whole-line segment
 * (when a line has only one) is an overall dimension; a multi-segment line is a
 * chain whose parts should sum to the overall.
 */
export type DimensionChain = {
  axis: Axis
  position: number
  totalLengthPx: number
  segments: DimensionSegment[]
  labelled: number
}

export function toChains(lines: readonly DimensionLine[]): DimensionChain[] {
  return lines
    .map((l) => ({
      axis: l.axis,
      position: l.position,
      totalLengthPx: l.to - l.from,
      segments: l.segments,
      labelled: l.segments.filter((s) => s.run !== null).length,
    }))
    .filter((c) => c.labelled > 0)
    .sort((a, b) => b.labelled - a.labelled || b.totalLengthPx - a.totalLengthPx)
}
