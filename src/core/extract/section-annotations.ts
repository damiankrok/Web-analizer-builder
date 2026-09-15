/**
 * What a section draws, before anything on it is read — §9.
 *
 * §9 is a rule about order, and it is the same rule §7 of Stage 06 made about
 * plans: find the geometry first, and only then ask a recogniser what is
 * written in the boxes the geometry chose. A number floating on a section is
 * not a vertical constraint. A number sitting on a reference line whose row
 * this module has measured is one, and the difference between those two
 * sentences is the difference between a datum solver and a wish.
 *
 * So nothing here reads text. It finds:
 *
 *   - **reference lines** — every horizontal stroke, including the short bar a
 *     level symbol is drawn with, which a plan-tuned detector throws away;
 *   - **level markers** — a short text run with a horizontal bar under it;
 *   - **vertical dimension chains** — a text run lying on its side beside a
 *     vertical dimension line, with the extension lines that bound it;
 *   - **pitch callouts** — a text run sitting against an oblique edge.
 *
 * and hands each of them to the caller as a box to be read, with the geometry
 * it is attached to already measured.
 *
 * ## A section has two inks, and the levels are drawn in the fainter one
 *
 * The thing a level marker actually points at is not a line. Measured on
 * project A's section, the symbol is a hairline shelf a few pixels under the
 * figure and, below that, a hollow triangle whose **apex** touches the height
 * being named. The apex is the datum: at `±0,00` it lands on row 641.5 and the
 * ground-floor slab's top edge begins at 642; at `+7,95` it lands on 64.5 and
 * the roof ridge's ink begins at 65.
 *
 * Both the shelf and the triangle are drawn at grey 170–230 against paper at
 * 255, while the section's fabric — slabs, walls, roof — is solid black. A
 * single ink threshold cannot have both: at the fabric's threshold the entire
 * level symbol is invisible, and at the annotation's the poché swallows its
 * neighbourhood. So this module carries two, and says which it used for what.
 *
 * Taking the shelf for the datum instead of the apex is not a small error. It
 * is eleven pixels on this drawing, which is fifteen centimetres of building,
 * and it is eleven pixels in the *same direction* on every marker — so it
 * survives every consistency check a solver can make and moves the whole
 * vertical structure down by a step. Fitting the triangle's two sides and
 * intersecting them costs a dozen lines and removes that failure entirely.
 *
 * PORT_DIRECT (Kotlin).
 */
import type { GrayImage } from '../contracts/raster.js'
import type { PixelBox, TextOrientation } from '../dimensions/contracts.js'
import { detectTextRegions, type TextRegion, type TextRegionOptions, DEFAULT_TEXT_REGIONS } from './text-regions.js'
import { strokeMask, type StrokeMask, type StrokeOptions, DEFAULT_STROKES } from './stroke-lines.js'
import { paperLevel } from './wall-bands.js'

export type SectionAnnotationOptions = {
  /** Text-region settings for a section's larger annotation text. */
  regions: TextRegionOptions
  /**
   * Ink threshold as a fraction of the measured paper level, for *fabric*:
   * the solid poché a section cuts through.
   */
  inkFraction: number
  /**
   * How a horizontal hairline is found: by being darker than what is above and
   * below it. A section's shelves, leaders and level rules are all shorter
   * than the plan detector's six-percent floor, so the floor comes down and
   * the contrast requirement does the work instead.
   */
  strokes: StrokeOptions
  /**
   * How an *oblique* hairline is found: by being darker than what is beside it
   * along its row. `radius` must exceed the hairline's width and stay well
   * inside the gap between the triangle's two sides.
   */
  obliqueRadiusPx: number
  obliqueMinContrast: number
  /**
   * How far below a level marker's figure its shelf may sit, as a multiple of
   * the text height.
   */
  shelfBelowText: number
  /** How far either side of the figure the shelf is looked for, as a multiple of the text width. */
  shelfSideMargin: number
  /** Shelf length admitted, as a multiple of the figure's width. */
  shelfMinRatio: number
  shelfMaxRatio: number
  /** How far below the shelf the triangle may reach, as a multiple of text height. */
  triangleBelowShelf: number
  /** Paired rows the triangle's two sides must be seen on before they are fitted. */
  triangleMinRows: number
  /** Widest the two sides may be when they are called merged, pixels. */
  triangleMergePx: number
  /**
   * Fallback only: how far below the figure a plain horizontal rule is
   * accepted as the association when no triangle is found, in text heights.
   */
  ruleBelowText: number
  /** Shortest such rule that counts, as a fraction of the text width. */
  ruleMinLengthRatio: number
  /** Absolute floor on that, pixels. */
  ruleMinLengthPx: number
  /**
   * How far a vertical dimension chain's text may sit from its dimension line,
   * as a multiple of the text width.
   */
  chainLineMargin: number
  /** Longest gap tolerated along a dimension line before it is two lines, px. */
  chainMaxGapPx: number
  /** How far from a text run an oblique edge may be to be its callout target, px. */
  pitchSearchPx: number
}

export const DEFAULT_SECTION_ANNOTATIONS: SectionAnnotationOptions = {
  regions: {
    ...DEFAULT_TEXT_REGIONS,
    // A section prints larger than a plan — 21 px against 9 on project A — and
    // a level marker is five components (`+`, `7`, `,`, `9`, `5`), so the run
    // length has to admit them. The sign sits further from the first digit
    // than the digits sit from each other, which is what the gap ratio buys.
    minGlyphPx: 4,
    maxGlyphPx: 40,
    maxGapRatio: 1.0,
    minGlyphs: 2,
    maxGlyphs: 8,
  },
  inkFraction: 0.62,
  strokes: {
    ...DEFAULT_STROKES,
    // The shelf under `+7,95` is about fifty pixels on an 1138 px sheet, and
    // the level rule under `+4,67` about sixty. The plan's floor of six
    // percent — 68 px — throws both away, which loses the two levels the roof
    // is made of.
    minLineFraction: 0.015,
    minContrast: 20,
    radiusPx: 4,
  },
  obliqueRadiusPx: 3,
  obliqueMinContrast: 18,
  shelfBelowText: 1.0,
  shelfSideMargin: 0.6,
  shelfMinRatio: 0.5,
  shelfMaxRatio: 2.5,
  triangleBelowShelf: 1.2,
  triangleMinRows: 4,
  triangleMergePx: 6,
  ruleBelowText: 2.0,
  ruleMinLengthRatio: 0.2,
  ruleMinLengthPx: 7,
  chainLineMargin: 1.6,
  chainMaxGapPx: 3,
  pitchSearchPx: 30,
}

/**
 * What a level marker was found pointing at.
 *
 * `row` is the measurement and the only thing downstream may use as a height.
 * `method` says how well it is known, because the two methods are not
 * comparable: a fitted triangle apex is good to a fraction of a pixel, while a
 * rule picked out of the neighbourhood is good to the thickness of the rule
 * and to whether it was the right rule.
 */
export type LevelAssociation = {
  /** Row in the source image, sub-pixel. The height the figure names. */
  row: number
  /** Column the apex sits at, where a triangle gave one. */
  columnPx: number | null
  method: 'TRIANGLE_APEX' | 'NEAREST_RULE'
  /** Rows the triangle's sides were fitted over. */
  fittedRows: number
  /** RMS of the two side fits, pixels. Infinite for a rule. */
  residualPx: number
  /** How the row was localised, for the audit. */
  how: string
}

/** Kept for the diagnostics: the shelf a level figure sits on. */
export type ShelfLine = { row: number; fromPx: number; toPx: number }

/** The kinds of annotation a section carries that Stage 07 reads. */
export type SectionAnnotationKind = 'LEVEL_MARKER' | 'VERTICAL_DIMENSION' | 'PITCH_CALLOUT' | 'UNATTACHED'

export type SectionAnnotation = {
  id: string
  kind: SectionAnnotationKind
  box: PixelBox
  orientation: TextOrientation
  /** Median glyph height, source-native pixels. */
  textHeightPx: number
  /** For a level marker: the height it names, and how that was established. */
  level: LevelAssociation | null
  /** For a level marker: the hairline shelf the figure sits on. */
  shelf: ShelfLine | null
  /**
   * For a vertical dimension chain: the two rows its extension lines bound,
   * and the column its dimension line runs down.
   */
  span: { columnPx: number; fromRow: number; toRow: number; how: string } | null
  /** For a pitch callout: the oblique edge it points at, as a direction in degrees. */
  obliqueDeg: number | null
  /** Why it was classified this way. */
  why: string
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)

/**
 * Maximal runs on one row where `present` holds, jumping gaps up to `maxGap`.
 */
function runsOnRow(
  present: (x: number) => boolean,
  x0: number,
  x1: number,
  maxGap: number,
): Array<{ from: number; to: number }> {
  const out: Array<{ from: number; to: number }> = []
  let start = -1
  let last = -1
  const flush = (): void => {
    if (start >= 0) out.push({ from: start, to: last })
    start = -1
    last = -1
  }
  for (let x = x0; x <= x1; x++) {
    if (!present(x)) {
      if (start >= 0 && x - last > maxGap) flush()
      continue
    }
    if (start < 0) start = x
    last = x
  }
  flush()
  return out
}

/**
 * Where one row has a thin dark blip against what lies *beside* it.
 *
 * This is the stroke test of `stroke-lines.ts` turned ninety degrees, and it
 * is used for the same reason: the sides of a level triangle are hairlines
 * drawn anywhere between grey 170 and grey 230 on paper at 255, and no
 * absolute threshold catches all of them without also catching the paper. What
 * is stable is that they are darker than the paper a few pixels to their left
 * and right, by tens of levels, everywhere along their length.
 *
 * A horizontal rule answers *not at all* here — its neighbours along the row
 * are the rule itself — which is exactly right: a rule is found by being
 * darker than what is above and below it, and that is what `strokeMask` does.
 * The two tests are complementary and this module uses each for the thing it
 * can actually see.
 */
function obliqueStrokeOnRow(
  gray: GrayImage,
  row: number,
  radiusPx: number,
  minContrast: number,
): (x: number) => boolean {
  return (x: number): boolean => {
    const v = gray.data[row * gray.width + x]
    let background = v
    for (let d = -radiusPx; d <= radiusPx; d++) {
      const xx = x + d
      if (xx < 0 || xx >= gray.width) continue
      const n = gray.data[row * gray.width + xx]
      if (n > background) background = n
    }
    return background - v >= minContrast
  }
}

/** Least squares of column against row, for one side of the triangle. */
function fitColumnAgainstRow(
  pts: ReadonlyArray<{ row: number; col: number }>,
): { slope: number; intercept: number; rms: number } | null {
  const n = pts.length
  if (n < 2) return null
  let sr = 0
  let sc = 0
  for (const p of pts) {
    sr += p.row
    sc += p.col
  }
  const mr = sr / n
  const mc = sc / n
  let num = 0
  let den = 0
  for (const p of pts) {
    num += (p.row - mr) * (p.col - mc)
    den += (p.row - mr) ** 2
  }
  if (den === 0) return null
  const slope = num / den
  const intercept = mc - slope * mr
  let sq = 0
  for (const p of pts) sq += (p.col - (intercept + slope * p.row)) ** 2
  return { slope, intercept, rms: Math.sqrt(sq / n) }
}

/**
 * The hairline shelf a level figure sits on.
 *
 * Distinguished from the figure's own strokes by length: the shelf runs the
 * width of the figure and a glyph's crossbar does not. Searched strictly below
 * the text baseline, because a figure like `±0,00` has a horizontal stroke
 * inside it — the bar of the `±` — that is exactly shelf-shaped and two pixels
 * higher.
 */
export function findShelf(
  gray: GrayImage,
  horizontalStrokes: StrokeMask,
  box: PixelBox,
  textHeightPx: number,
  opts: SectionAnnotationOptions = DEFAULT_SECTION_ANNOTATIONS,
): ShelfLine | null {
  const w = Math.max(1, box.x1 - box.x0)
  const x0 = clamp(Math.round(box.x0 - w * opts.shelfSideMargin), 0, gray.width - 1)
  const x1 = clamp(Math.round(box.x1 + w * opts.shelfSideMargin), 0, gray.width - 1)
  const rowFrom = clamp(Math.round(box.y1 + 2), 0, gray.height - 1)
  const rowTo = clamp(Math.round(box.y1 + textHeightPx * opts.shelfBelowText), 0, gray.height - 1)
  const at = (row: number) => (x: number): boolean => horizontalStrokes.data[row * gray.width + x] === 1
  for (let row = rowFrom; row <= rowTo; row++) {
    for (const run of runsOnRow(at(row), x0, x1, 3)) {
      const len = run.to - run.from + 1
      if (len < w * opts.shelfMinRatio || len > w * opts.shelfMaxRatio) continue
      return { row, fromPx: run.from, toPx: run.to }
    }
  }
  return null
}

/**
 * The apex of the hollow triangle under a shelf — the height the figure names.
 *
 * The two sides are tracked row by row as the only two ink runs inside the
 * shelf's span, and each is fitted as a straight line of column against row.
 * The apex is where the fits cross, which is sub-pixel and does not require
 * the drawing to have put any ink exactly there: on project A's `±0,00` the
 * sides are last seen apart on row 640 and merged on 641, and the crossing
 * lands at 641.6 against a slab edge the fabric threshold puts at 642.
 *
 * Returns null rather than a guess whenever the triangle is not clearly two
 * converging sides — the sides must have opposite slopes, be seen on enough
 * rows to fit, and cross below the shelf rather than above it.
 */
export function findTriangleApex(
  gray: GrayImage,
  shelf: ShelfLine,
  textHeightPx: number,
  opts: SectionAnnotationOptions = DEFAULT_SECTION_ANNOTATIONS,
): LevelAssociation | null {
  const x0 = clamp(shelf.fromPx - 2, 0, gray.width - 1)
  const x1 = clamp(shelf.toPx + 2, 0, gray.width - 1)
  const limit = clamp(Math.round(shelf.row + textHeightPx * opts.triangleBelowShelf), 0, gray.height - 1)
  const left: Array<{ row: number; col: number }> = []
  const right: Array<{ row: number; col: number }> = []
  for (let row = shelf.row + 1; row <= limit; row++) {
    const runs = runsOnRow(obliqueStrokeOnRow(gray, row, opts.obliqueRadiusPx, opts.obliqueMinContrast), x0, x1, 1)
    if (runs.length === 1 && runs[0].to - runs[0].from + 1 <= opts.triangleMergePx) break
    if (runs.length !== 2) {
      if (left.length === 0) continue
      break
    }
    left.push({ row, col: (runs[0].from + runs[0].to) / 2 })
    right.push({ row, col: (runs[1].from + runs[1].to) / 2 })
  }
  if (left.length < opts.triangleMinRows) return null
  const fl = fitColumnAgainstRow(left)
  const fr = fitColumnAgainstRow(right)
  if (!fl || !fr) return null
  // Converging: the left side must move right as the row grows and the right
  // side left. Two parallel hairlines are a pair of leaders, not a symbol.
  if (!(fl.slope > 0 && fr.slope < 0)) return null
  const denom = fl.slope - fr.slope
  if (Math.abs(denom) < 1e-6) return null
  const row = (fr.intercept - fl.intercept) / denom
  if (row <= shelf.row || row > limit + textHeightPx) return null
  return {
    row,
    columnPx: fl.intercept + fl.slope * row,
    method: 'TRIANGLE_APEX',
    fittedRows: left.length,
    residualPx: Math.max(fl.rms, fr.rms),
    how:
      `the two sides of the level triangle under the shelf at row ${shelf.row}, fitted over ${left.length} rows ` +
      `and crossed at row ${row.toFixed(2)}`,
  }
}

/**
 * Fallback association: the longest horizontal rule below the figure.
 *
 * Used only where no triangle is found, and marked as such, because it is the
 * weaker reading in exactly the way that matters: it cannot tell the rule the
 * marker points at from a rule that happens to be nearby, and the datum solver
 * has to be free to throw it out on that basis.
 */
export function findNearestRule(
  gray: GrayImage,
  horizontalStrokes: StrokeMask,
  box: PixelBox,
  textHeightPx: number,
  opts: SectionAnnotationOptions = DEFAULT_SECTION_ANNOTATIONS,
): LevelAssociation | null {
  const w = Math.max(1, box.x1 - box.x0)
  const x0 = clamp(Math.round(box.x0 - w), 0, gray.width - 1)
  const x1 = clamp(Math.round(box.x1 + w), 0, gray.width - 1)
  const rowTo = clamp(Math.round(box.y1 + textHeightPx * opts.ruleBelowText), 0, gray.height - 1)
  const minLength = Math.max(opts.ruleMinLengthPx, w * opts.ruleMinLengthRatio)
  const at = (row: number) => (x: number): boolean => horizontalStrokes.data[row * gray.width + x] === 1
  let best: { row: number; from: number; to: number } | null = null
  for (let row = clamp(Math.round(box.y1 + 2), 0, gray.height - 1); row <= rowTo; row++) {
    for (const run of runsOnRow(at(row), x0, x1, 4)) {
      const len = run.to - run.from + 1
      if (len < minLength) continue
      if (best === null || len > best.to - best.from + 1) best = { row, from: run.from, to: run.to }
    }
  }
  if (!best) return null
  return {
    row: best.row,
    columnPx: null,
    method: 'NEAREST_RULE',
    fittedRows: 0,
    residualPx: Number.POSITIVE_INFINITY,
    how: `no level triangle was found; the longest horizontal rule below the figure runs ${best.to - best.from + 1} px at row ${best.row}`,
  }
}

/**
 * The vertical dimension line a sideways text run sits against, and the two
 * extension lines that bound it.
 *
 * A vertical chain is drawn as a line with an arrowhead at each end, running
 * between two extension lines. The text lies alongside it. So: find the column
 * near the text that carries the longest uninterrupted vertical dark run
 * through the text's own rows, then walk that column out in both directions
 * until the ink stops. The ends are the chain's extent, and the value printed
 * beside it is what that extent measures.
 */
export function findChainSpan(
  gray: GrayImage,
  box: PixelBox,
  ink: number,
  opts: SectionAnnotationOptions = DEFAULT_SECTION_ANNOTATIONS,
): SectionAnnotation['span'] {
  const w = Math.max(1, box.x1 - box.x0)
  const from = clamp(Math.round(box.x0 - w * opts.chainLineMargin), 0, gray.width - 1)
  const to = clamp(Math.round(box.x1 + w * opts.chainLineMargin), 0, gray.width - 1)
  const midRow = Math.round((box.y0 + box.y1) / 2)

  let bestCol = -1
  let bestLen = 0
  for (let x = from; x <= to; x++) {
    // Only columns that are *not* the text itself: a digit's stem is a short
    // vertical run and a dimension line is a long one, so length decides.
    let up = midRow
    while (up > 0 && gray.data[(up - 1) * gray.width + x] <= ink) up--
    let down = midRow
    while (down < gray.height - 1 && gray.data[(down + 1) * gray.width + x] <= ink) down++
    if (gray.data[midRow * gray.width + x] > ink) continue
    const len = down - up
    if (len > bestLen) {
      bestLen = len
      bestCol = x
    }
  }
  if (bestCol < 0 || bestLen < (box.y1 - box.y0)) return null

  // Walk the found column out, jumping the gaps the arrowheads and the text
  // leave, until the line genuinely stops.
  const walk = (dir: -1 | 1): number => {
    let y = midRow
    let gap = 0
    let lastInk = midRow
    while (y > 0 && y < gray.height - 1) {
      y += dir
      if (gray.data[y * gray.width + bestCol] <= ink) {
        lastInk = y
        gap = 0
      } else if (++gap > opts.chainMaxGapPx) break
    }
    return lastInk
  }
  const fromRow = walk(-1)
  const toRow = walk(1)
  if (toRow - fromRow < (box.y1 - box.y0)) return null
  return {
    columnPx: bestCol,
    fromRow,
    toRow,
    how: `the dimension line at column ${bestCol}, walked to rows ${fromRow} and ${toRow} (gaps up to ${opts.chainMaxGapPx} px jumped)`,
  }
}

/**
 * The direction of the oblique edge a callout sits against.
 *
 * A pitch callout is printed beside the roof slope it measures, so the slope
 * is the dominant oblique ink direction in its neighbourhood. This reports
 * that direction; it does not report a pitch, because the number beside a
 * slope and the slope itself are two observations and §14 requires them to
 * stay two.
 */
export function obliqueDirectionNear(
  gray: GrayImage,
  box: PixelBox,
  ink: number,
  radiusPx: number,
): number | null {
  const cx = (box.x0 + box.x1) / 2
  const cy = (box.y0 + box.y1) / 2
  const x0 = clamp(Math.round(cx - radiusPx), 1, gray.width - 2)
  const x1 = clamp(Math.round(cx + radiusPx), 1, gray.width - 2)
  const y0 = clamp(Math.round(cy - radiusPx), 1, gray.height - 2)
  const y1 = clamp(Math.round(cy + radiusPx), 1, gray.height - 2)
  // Structure tensor over the window, skipping the text's own box so the
  // glyphs' strokes do not vote.
  let sxx = 0
  let syy = 0
  let sxy = 0
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (x >= box.x0 - 2 && x <= box.x1 + 2 && y >= box.y0 - 2 && y <= box.y1 + 2) continue
      const v = gray.data[y * gray.width + x]
      if (v > ink) continue
      const gx = gray.data[y * gray.width + x + 1] - gray.data[y * gray.width + x - 1]
      const gy = gray.data[(y + 1) * gray.width + x] - gray.data[(y - 1) * gray.width + x]
      sxx += gx * gx
      syy += gy * gy
      sxy += gx * gy
    }
  }
  if (sxx + syy < 1e3) return null
  // The edge direction is perpendicular to the dominant gradient.
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy)
  const edgeRad = theta + Math.PI / 2
  let deg = (edgeRad * 180) / Math.PI
  while (deg < 0) deg += 180
  while (deg >= 180) deg -= 180
  // Only an oblique direction is a pitch target; a horizontal or vertical
  // neighbour means the callout is against something else.
  const fromHorizontal = Math.min(deg, 180 - deg)
  if (fromHorizontal < 8 || fromHorizontal > 82) return null
  return deg
}

export type SectionAnnotationResult = {
  annotations: SectionAnnotation[]
  /** Threshold below which a pixel is the section's solid fabric. */
  inkThreshold: number
  paper: number
  notes: string[]
}

/**
 * Every annotation on a section, classified by what it is attached to.
 *
 * The classification is structural and nothing in it reads a character. A run
 * with a bar under it is a level marker because that is how a level marker is
 * drawn; a sideways run against a long vertical line is a chain because that
 * is how a chain is drawn. Whether the level marker says `+7,95` or `+1,95` is
 * a later and separate question, and one this module deliberately cannot
 * influence.
 */
export function findSectionAnnotations(
  gray: GrayImage,
  opts: SectionAnnotationOptions = DEFAULT_SECTION_ANNOTATIONS,
): SectionAnnotationResult {
  const paper = paperLevel(gray)
  const ink = Math.max(20, Math.round(paper * opts.inkFraction))
  const horizontalStrokes = strokeMask(gray, 'X', opts.strokes)
  const regions = detectTextRegions(gray, opts.regions)
  const notes: string[] = [`${regions.length} text-region readings offered on the section`]

  // A vertical run is offered twice, once for each direction it could read in
  // (`text-regions.ts` does this deliberately). Both entries describe one
  // label, so the geometry is solved once per `regionId` and shared.
  const byRegion = new Map<string, TextRegion[]>()
  for (const r of regions) {
    const list = byRegion.get(r.regionId)
    if (list) list.push(r)
    else byRegion.set(r.regionId, [r])
  }

  const annotations: SectionAnnotation[] = []
  for (const [regionId, entries] of byRegion) {
    const first = entries[0]
    const horizontal = entries.find((e) => e.orientation === 'HORIZONTAL')
    const height = first.glyphHeightPx

    if (horizontal) {
      const shelf = findShelf(gray, horizontalStrokes, horizontal.box, height, opts)
      const level =
        (shelf ? findTriangleApex(gray, shelf, height, opts) : null) ??
        findNearestRule(gray, horizontalStrokes, horizontal.box, height, opts)
      if (level) {
        annotations.push({
          id: `lvl:${regionId}`,
          kind: 'LEVEL_MARKER',
          box: horizontal.box,
          orientation: 'HORIZONTAL',
          textHeightPx: height,
          level,
          shelf,
          span: null,
          obliqueDeg: null,
          why: `an upright figure naming a height: ${level.how}`,
        })
        continue
      }
      const oblique = obliqueDirectionNear(gray, horizontal.box, ink, opts.pitchSearchPx)
      if (oblique !== null) {
        annotations.push({
          id: `ptc:${regionId}`,
          kind: 'PITCH_CALLOUT',
          box: horizontal.box,
          orientation: 'HORIZONTAL',
          textHeightPx: height,
          level: null,
          shelf: null,
          span: null,
          obliqueDeg: oblique,
          why: `an upright figure against an ink edge running at ${oblique.toFixed(1)}° to the sheet`,
        })
        continue
      }
    }

    const sideways = entries.find((e) => e.orientation !== 'HORIZONTAL')
    if (sideways) {
      const span = findChainSpan(gray, sideways.box, ink, opts)
      if (span) {
        for (const e of entries.filter((x) => x.orientation !== 'HORIZONTAL')) {
          annotations.push({
            id: `dim:${regionId}:${e.orientation}`,
            kind: 'VERTICAL_DIMENSION',
            box: e.box,
            orientation: e.orientation,
            textHeightPx: height,
            level: null,
            shelf: null,
            span,
            obliqueDeg: null,
            why: `a figure lying on its side beside ${span.how}`,
          })
        }
        continue
      }
    }

    for (const e of entries) {
      annotations.push({
        id: `unk:${regionId}:${e.orientation}`,
        kind: 'UNATTACHED',
        box: e.box,
        orientation: e.orientation,
        textHeightPx: height,
        level: null,
        shelf: null,
        span: null,
        obliqueDeg: null,
        why: 'a figure with nothing measurable under or beside it; §9 makes it an observation and not a constraint',
      })
    }
  }

  const count = (k: SectionAnnotationKind): number => annotations.filter((a) => a.kind === k).length
  notes.push(
    `${count('LEVEL_MARKER')} level markers, ${count('VERTICAL_DIMENSION')} vertical chain readings, ` +
      `${count('PITCH_CALLOUT')} pitch callouts, ${count('UNATTACHED')} figures attached to nothing`,
  )
  const apexes = annotations.filter((a) => a.level?.method === 'TRIANGLE_APEX').length
  notes.push(
    `paper reads ${paper} and fabric is darker than ${ink}; ` +
      `${apexes} of ${count('LEVEL_MARKER')} level markers were placed by fitting their symbol's triangle, ` +
      `the rest by the nearest rule below the figure`,
  )
  return { annotations, inkThreshold: ink, paper, notes }
}
