/**
 * Finding text runs anywhere on a drawing (§6, §7).
 *
 * The dimension-geometry path locates labels by the lines they annotate, which
 * is precise but only reaches labels that annotate a line. Two of the most
 * valuable annotations do not: the room-area figures printed inside rooms, and
 * the level markers on a section. They need a general run finder.
 *
 * A run here is a horizontal sequence of ink components that share a height
 * and a baseline and sit within a character's width of each other. That is a
 * weak filter on its own — a plan is full of furniture outlines at text scale —
 * so nothing downstream may treat a run as text merely because it was found.
 * The runs are candidates; what makes one a number is that something
 * independent already knows what that number says.
 *
 * PORT_DIRECT (Kotlin).
 */
import type { GrayImage } from '../contracts/raster.js'
import type { PixelBox } from './contracts.js'

export type RunOptions = {
  inkThreshold: number
  minHeight: number
  maxHeight: number
  minArea: number
  /** Largest gap between characters, as a multiple of glyph height. */
  maxGapRatio: number
  /** Baseline agreement required, as a fraction of glyph height. */
  baselineTolerance: number
  /** Height agreement required between members of one run. */
  heightTolerance: number
  maxRunLength: number
}

export const DEFAULT_RUNS: RunOptions = {
  inkThreshold: 165,
  minHeight: 2,
  maxHeight: 26,
  minArea: 4,
  maxGapRatio: 0.55,
  baselineTolerance: 0.42,
  heightTolerance: 1.45,
  maxRunLength: 10,
}

export type RunComponent = { box: PixelBox; area: number }
export type TextRun = { box: PixelBox; components: RunComponent[] }

/** Ink components at text scale. */
export function inkComponents(gray: GrayImage, opts: RunOptions = DEFAULT_RUNS): RunComponent[] {
  const w = gray.width
  const h = gray.height
  const seen = new Uint8Array(w * h)
  const queue = new Int32Array(w * h)
  const out: RunComponent[] = []
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || gray.data[start] >= opts.inkThreshold) continue
    let head = 0
    let tail = 0
    queue[tail++] = start
    seen[start] = 1
    let x0 = w
    let x1 = -1
    let y0 = h
    let y1 = -1
    let area = 0
    let overflow = false
    while (head < tail) {
      const i = queue[head++]
      area++
      const x = i % w
      const y = (i / w) | 0
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
      if (y1 - y0 > opts.maxHeight * 3 || x1 - x0 > opts.maxHeight * 6) overflow = true
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
          const j = ny * w + nx
          if (!seen[j] && gray.data[j] < opts.inkThreshold) {
            seen[j] = 1
            queue[tail++] = j
          }
        }
      }
    }
    if (overflow) continue
    const ch = y1 - y0 + 1
    if (ch < opts.minHeight || ch > opts.maxHeight || area < opts.minArea) continue
    out.push({ box: { x0, y0, x1, y1 }, area })
  }
  return out
}

/**
 * Group components into left-to-right runs.
 *
 * Members must agree on height and baseline, which is what keeps a digit from
 * being grouped with the tabletop it sits on. A decimal comma breaks the
 * height rule by design — it is a third the height and sits below the baseline
 * — so a short low component between two full-height ones is admitted as a
 * separator rather than ending the run.
 */
export function groupRuns(components: readonly RunComponent[], opts: RunOptions = DEFAULT_RUNS): TextRun[] {
  const sorted = [...components].sort((a, b) => a.box.x0 - b.box.x0 || a.box.y0 - b.box.y0)
  const used = new Set<number>()
  const runs: TextRun[] = []
  for (let i = 0; i < sorted.length; i++) {
    if (used.has(i)) continue
    const first = sorted[i]
    const refH = first.box.y1 - first.box.y0 + 1
    const members = [first]
    used.add(i)
    let last = first
    for (let j = i + 1; j < sorted.length; j++) {
      if (used.has(j)) continue
      const c = sorted[j]
      const gap = c.box.x0 - last.box.x1
      // Stop at the first component too far right: the list is x-sorted, so
      // everything after it is further still.
      if (gap > refH * opts.maxGapRatio + 2) break
      if (gap < -refH * 0.5) continue
      const ch = c.box.y1 - c.box.y0 + 1
      const tallEnough = ch >= refH / opts.heightTolerance && ch <= refH * opts.heightTolerance
      // A decimal comma is a third the height and sits on the baseline, so it
      // is admitted as a separator rather than ending the run.
      const separator = ch <= refH * 0.6 && Math.abs(c.box.y1 - first.box.y1) <= refH * 0.35
      if (!tallEnough && !separator) continue
      // Baseline agreement is measured against the run's *first* member, not
      // its last: comparing to the last lets the baseline drift a pixel per
      // character and chain a label into whatever sits above or below it.
      if (Math.abs(c.box.y1 - first.box.y1) > refH * opts.baselineTolerance) continue
      members.push(c)
      used.add(j)
      last = c
      if (members.length >= opts.maxRunLength) break
    }
    // A run needs at least two full-height characters. Without this, two
    // specks of hatching at the decimal-comma size form a "run" of their own
    // and the separator rule has nothing to anchor against.
    const tallest = Math.max(...members.map((m) => m.box.y1 - m.box.y0 + 1))
    const full = members.filter((m) => m.box.y1 - m.box.y0 + 1 >= tallest * 0.7).length
    if (members.length < 2 || full < 2) continue
    runs.push({
      box: members.reduce<PixelBox>(
        (acc, m) => ({
          x0: Math.min(acc.x0, m.box.x0),
          y0: Math.min(acc.y0, m.box.y0),
          x1: Math.max(acc.x1, m.box.x1),
          y1: Math.max(acc.y1, m.box.y1),
        }),
        { x0: Number.POSITIVE_INFINITY, y0: Number.POSITIVE_INFINITY, x1: -1, y1: -1 },
      ),
      components: members,
    })
  }
  return runs
}
