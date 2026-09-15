/**
 * Finding the text on a technical drawing — STAGE WEB-PIVOT-06 §7.
 *
 * §7 says geometry first and OCR second, and that the crops handed to a
 * recogniser must come from the drawing's own structures. Before a crop can be
 * associated with a dimension line it has to exist, and the previous stage's
 * way of producing one — take a band above every thin line and hope there is a
 * number in it — produced 118 candidate bands for about 22 labels on project
 * A's ground plan, most of them empty and most of the real labels missed.
 *
 * This finds text the way text is found: ink components of a consistent small
 * height, grouped into runs that share a baseline. It knows nothing about
 * dimension lines, walls, or any publisher's conventions. Associating a run
 * with the thing it measures is a separate step and a separate file, which is
 * the separation §7 asks for — and the reason a number found here is an
 * *observation* and not yet a constraint.
 *
 * A run is found along X and along Y, because a plan prints its vertical
 * chains rotated. Which of the two rotations a vertical run actually reads in
 * is not decided here: both are offered, and the recogniser's confidence
 * settles it, since guessing costs a whole label when the guess is wrong.
 *
 * PORT_DIRECT (Kotlin).
 */
import type { GrayImage } from '../contracts/raster.js'
import type { PixelBox, TextOrientation } from '../dimensions/contracts.js'

export type TextRegionOptions = {
  /**
   * Ink threshold as a fraction of the paper level.
   *
   * Paper is measured, not assumed: a drawing published as a JPEG has no pure
   * white in it, and a fixed threshold either takes the whole page or none of
   * it.
   */
  inkFraction: number
  /**
   * Glyph sizes admitted, source-native pixels, measured on the box's *longer*
   * side. Longer rather than taller because a plan prints its vertical chains
   * rotated, and a digit lying on its side is as wide as it was tall.
   */
  minGlyphPx: number
  maxGlyphPx: number
  /**
   * How elongated a component may be — longer side over shorter — before it is
   * a rule, a hatching stroke or a leader rather than a character. A `1` is
   * the narrowest digit and sets the bound; it is applied orientation-free for
   * the same reason as the size bounds above.
   */
  maxElongation: number
  /** Ink a component must have, as a fraction of its bounding box. */
  minFill: number
  /** Heights within this ratio count as "the same size". */
  heightRatio: number
  /** Gap admitted between glyphs of one run, as a multiple of glyph height. */
  maxGapRatio: number
  /** Cross-axis drift admitted along a run, as a multiple of glyph height. */
  maxDriftRatio: number
  /** Glyphs a run must have. */
  minGlyphs: number
  maxGlyphs: number
  /** Largest component count considered, so a pathological image still ends. */
  maxComponents: number
}

export const DEFAULT_TEXT_REGIONS: TextRegionOptions = {
  inkFraction: 0.62,
  minGlyphPx: 5,
  maxGlyphPx: 26,
  maxElongation: 6,
  minFill: 0.12,
  heightRatio: 1.45,
  maxGapRatio: 0.9,
  maxDriftRatio: 0.45,
  minGlyphs: 2,
  maxGlyphs: 6,
  maxComponents: 60000,
}

export type GlyphComponent = {
  box: PixelBox
  /** Ink pixels. */
  area: number
  width: number
  height: number
}

export type TextRegion = {
  /** Unique per entry. */
  id: string
  /**
   * The run this entry reads. A vertical run appears twice — once for each
   * direction it could read in — and both entries share this id, so a consumer
   * knows they are two readings of one label and not two labels.
   */
  regionId: string
  box: PixelBox
  /** How the run was found; a vertical run is offered in both readings. */
  orientation: TextOrientation
  glyphs: number
  /** Median glyph height, source-native pixels. */
  glyphHeightPx: number
  /** Axis the run extends along. */
  axis: 'X' | 'Y'
}

/** Paper level: the 95th percentile, so a dark drawing still finds its page. */
function paperLevel(gray: GrayImage): number {
  const hist = new Int32Array(256)
  for (let i = 0; i < gray.data.length; i++) hist[gray.data[i]]++
  const target = gray.data.length * 0.95
  let acc = 0
  for (let v = 0; v < 256; v++) {
    acc += hist[v]
    if (acc >= target) return v
  }
  return 255
}

/**
 * 8-connected components of ink, by iterative flood fill.
 *
 * Iterative rather than recursive because a hatched region on a large drawing
 * is one component tens of thousands of pixels across, and a recursive fill
 * overflows the stack on exactly the images that matter.
 */
export function inkComponents(
  gray: GrayImage,
  opts: TextRegionOptions = DEFAULT_TEXT_REGIONS,
): GlyphComponent[] {
  const ink = Math.max(24, Math.round(paperLevel(gray) * opts.inkFraction))
  const { width, height, data } = gray
  const seen = new Uint8Array(width * height)
  const out: GlyphComponent[] = []
  const stack: number[] = []
  for (let start = 0; start < data.length; start++) {
    if (seen[start] || data[start] > ink) continue
    if (out.length >= opts.maxComponents) break
    stack.length = 0
    stack.push(start)
    seen[start] = 1
    let x0 = width
    let y0 = height
    let x1 = -1
    let y1 = -1
    let area = 0
    while (stack.length > 0) {
      const i = stack.pop()!
      const x = i % width
      const y = (i - x) / width
      area++
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= height) continue
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          if (nx < 0 || nx >= width) continue
          const j = ny * width + nx
          if (seen[j] || data[j] > ink) continue
          seen[j] = 1
          stack.push(j)
        }
      }
    }
    const w = x1 - x0 + 1
    const h = y1 - y0 + 1
    out.push({ box: { x0, y0, x1, y1 }, area, width: w, height: h })
  }
  return out
}

/** Components that could be a digit: right size, not a line, not a blob. */
export function glyphCandidates(
  components: readonly GlyphComponent[],
  opts: TextRegionOptions = DEFAULT_TEXT_REGIONS,
): GlyphComponent[] {
  return components.filter((c) => {
    const long = Math.max(c.width, c.height)
    const short = Math.min(c.width, c.height)
    if (long < opts.minGlyphPx || long > opts.maxGlyphPx) return false
    if (short < 1 || long > short * opts.maxElongation) return false
    if (c.area < c.width * c.height * opts.minFill) return false
    return true
  })
}

/**
 * Group glyphs into runs along one axis.
 *
 * Two glyphs join when they are the same size, sit on the same line across the
 * run, and are close enough along it. "Close enough" is measured in glyph
 * heights rather than pixels so the rule holds at any published resolution.
 */
function runsAlong(
  glyphs: readonly GlyphComponent[],
  axis: 'X' | 'Y',
  opts: TextRegionOptions,
): GlyphComponent[][] {
  const along = (g: GlyphComponent): number => (axis === 'X' ? g.box.x0 : g.box.y0)
  const alongEnd = (g: GlyphComponent): number => (axis === 'X' ? g.box.x1 : g.box.y1)
  const across = (g: GlyphComponent): number =>
    axis === 'X' ? (g.box.y0 + g.box.y1) / 2 : (g.box.x0 + g.box.x1) / 2
  // Size along the run's own cross axis is what "the same size" means: a digit
  // read sideways is as tall as its neighbours across the run, not along it.
  const size = (g: GlyphComponent): number => (axis === 'X' ? g.height : g.width)

  const sorted = [...glyphs].sort((a, b) => along(a) - along(b) || across(a) - across(b))
  const used = new Uint8Array(sorted.length)
  const out: GlyphComponent[][] = []
  for (let i = 0; i < sorted.length; i++) {
    if (used[i]) continue
    const run = [sorted[i]]
    used[i] = 1
    for (let j = i + 1; j < sorted.length; j++) {
      if (used[j]) continue
      const last = run[run.length - 1]
      const h = size(last)
      const gap = along(sorted[j]) - alongEnd(last)
      if (gap > h * opts.maxGapRatio) {
        // Sorted along the axis, so nothing further can be closer — but only
        // for runs, not for the whole list: another run may start later.
        if (gap > h * opts.maxGapRatio * 4) break
        continue
      }
      if (gap < -h) continue
      const s = size(sorted[j])
      if (s > h * opts.heightRatio || h > s * opts.heightRatio) continue
      if (Math.abs(across(sorted[j]) - across(last)) > h * opts.maxDriftRatio) continue
      run.push(sorted[j])
      used[j] = 1
    }
    if (run.length >= opts.minGlyphs && run.length <= opts.maxGlyphs) out.push(run)
    else for (const g of run) used[sorted.indexOf(g)] = 0
  }
  return out
}

const hull = (run: readonly GlyphComponent[]): PixelBox => ({
  x0: Math.min(...run.map((g) => g.box.x0)),
  y0: Math.min(...run.map((g) => g.box.y0)),
  x1: Math.max(...run.map((g) => g.box.x1)),
  y1: Math.max(...run.map((g) => g.box.y1)),
})

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

/**
 * Every run of text on a drawing, each offered in the readings it could have.
 *
 * A horizontal run has one reading. A vertical run has two — bottom-to-top and
 * top-to-bottom — and both are returned, because choosing between them without
 * reading them is guessing, and a wrong guess loses the label outright.
 */
export function detectTextRegions(
  gray: GrayImage,
  opts: TextRegionOptions = DEFAULT_TEXT_REGIONS,
): TextRegion[] {
  const glyphs = glyphCandidates(inkComponents(gray, opts), opts)
  const out: TextRegion[] = []
  let n = 0
  for (const run of runsAlong(glyphs, 'X', opts)) {
    const id = `tx${n++}`
    out.push({
      id,
      regionId: id,
      box: hull(run),
      orientation: 'HORIZONTAL',
      glyphs: run.length,
      glyphHeightPx: median(run.map((g) => g.height)),
      axis: 'X',
    })
  }
  for (const run of runsAlong(glyphs, 'Y', opts)) {
    const regionId = `ty${n++}`
    const box = hull(run)
    const glyphHeightPx = median(run.map((g) => g.width))
    for (const orientation of ['VERTICAL_UP', 'VERTICAL_DOWN'] as const) {
      out.push({
        id: `${regionId}:${orientation === 'VERTICAL_UP' ? 'up' : 'down'}`,
        regionId,
        box,
        orientation,
        glyphs: run.length,
        glyphHeightPx,
        axis: 'Y',
      })
    }
  }
  return out
}
