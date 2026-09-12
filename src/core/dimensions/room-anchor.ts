/**
 * Anchoring the alphabet on published room areas (§8A, §13).
 *
 * The recogniser has a bootstrapping problem: predicting a label's value needs
 * the drawing's scale, measuring the scale needs values, and starting from a
 * rough calibration converges to whichever self-consistent wrong answer it
 * began nearest. Something outside that loop has to supply a certainty.
 *
 * The page itself supplies one. ARCHON publishes a room table — name and area
 * per room — and the floor plan prints those same areas inside the rooms. The
 * numbers are therefore *known* before anything is read, and no scale is
 * involved: an area label is an exact string that appears somewhere on the
 * drawing. Matching runs of ink to those strings gives supervised examples of
 * the drawing's own digits, and of its decimal comma, with no circularity at
 * all.
 *
 * The matching is done by structure before appearance. A candidate string has
 * a length and a comma position; a run of ink has a component count and, where
 * one component is markedly shorter than its neighbours, a separator position.
 * Classes of (length, comma index) with a single published candidate are
 * therefore certain, and they seed a template bank that scores the rest. Each
 * accepted match widens the alphabet, which sharpens the next round.
 *
 * PORT_DIRECT (Kotlin).
 */
import type { GrayImage } from '../contracts/raster.js'
import type { RoomFact } from '../contracts/source.js'
import type { PixelBox } from './contracts.js'
import { normaliseGlyph, countHoles, type TextGlyph } from './recognizer.js'
import { buildTemplates, profileSimilarityFor, type LabelledGlyph, type TemplateBank } from './templates.js'
import { groupRuns, inkComponents, DEFAULT_RUNS, type RunOptions, type TextRun } from './text-runs.js'

/** Polish decimal formatting, as ARCHON prints it: comma, no trailing zeros. */
export function formatArea(value: number): string {
  const fixed = value.toFixed(2)
  const trimmed = fixed.replace(/0+$/, '').replace(/\.$/, '')
  return trimmed.replace('.', ',')
}

export type AreaCandidate = {
  /** As printed, with the decimal comma. */
  text: string
  /** Digits only: the comma is a two-pixel mark that thresholding often loses,
   *  so structure is matched on digits and the comma is inferred afterwards. */
  digits: string
  value: number
  commaIndex: number
}

export function areaCandidates(
  rooms: readonly RoomFact[],
  storey?: 'GROUND' | 'UPPER',
): AreaCandidate[] {
  const seen = new Set<string>()
  const out: AreaCandidate[] = []
  for (const room of rooms) {
    if (room.areaM2 === null || room.areaM2 === undefined) continue
    if (storey && room.storey !== storey) continue
    const text = formatArea(room.areaM2)
    if (seen.has(text)) continue
    seen.add(text)
    out.push({ text, digits: text.replace(/[^0-9]/g, ''), value: room.areaM2, commaIndex: text.indexOf(',') })
  }
  return out.sort((a, b) => b.value - a.value)
}

/** A run turned into normalised glyphs, with its separator position marked. */
export type RunGlyphs = {
  run: TextRun
  glyphs: TextGlyph[]
  /** Index of the component that reads as a separator, or -1. */
  separatorIndex: number
  box: PixelBox
}

export function runGlyphs(gray: GrayImage, runs: readonly TextRun[], ink: number, slantRad: number): RunGlyphs[] {
  const out: RunGlyphs[] = []
  for (const run of runs) {
    const heights = run.components.map((c) => c.box.y1 - c.box.y0 + 1)
    const tallest = Math.max(...heights)
    let separatorIndex = -1
    heights.forEach((h, i) => {
      if (h <= tallest * 0.6 && i > 0 && i < heights.length - 1) {
        if (separatorIndex < 0 || h < heights[separatorIndex]) separatorIndex = i
      }
    })
    const glyphs = run.components.map((c) => ({
      box: c.box,
      sourceBox: c.box,
      area: c.area,
      height: c.box.y1 - c.box.y0 + 1,
      aspect: (c.box.x1 - c.box.x0 + 1) / (c.box.y1 - c.box.y0 + 1),
      profile: normaliseGlyph(gray, c.box, ink, slantRad),
      holes: countHoles(gray, c.box, ink),
    }))
    out.push({ run, glyphs, separatorIndex, box: run.box })
  }
  return out
}

export type RoomAnchorResult = {
  examples: LabelledGlyph[]
  /** Which run was matched to which published area. */
  matches: Array<{ text: string; box: PixelBox; certainty: 'STRUCTURAL' | 'APPEARANCE'; score: number }>
  notes: string[]
}

/**
 * Harvest labelled glyphs by matching ink runs to published room areas.
 *
 * Structural matches come first and are treated as certain: a (length, comma
 * position) class with exactly one published candidate can only be that
 * candidate, whatever the pixels look like. Appearance matches follow, scored
 * against the bank the structural ones built, and each is accepted only if it
 * beats its next best rival by a margin — the same refusal the glyph
 * classifier uses, applied one level up.
 */
export function harvestRoomAreas(
  gray: GrayImage,
  rooms: readonly RoomFact[],
  opts: {
    runs?: RunOptions
    slantRad?: number
    minMargin?: number
    storey?: 'GROUND' | 'UPPER'
    seed?: TemplateBank
    /**
     * Boxes already claimed by the dimension-geometry stage. A run sitting in
     * a dimension line's label band is that line's figure, not a room area,
     * and excluding them is what makes the largest area's digit class
     * unambiguous without any appeal to appearance.
     */
    exclude?: readonly PixelBox[]
  } = {},
): RoomAnchorResult {
  const notes: string[] = []
  const runOpts = opts.runs ?? DEFAULT_RUNS
  const slantRad = opts.slantRad ?? 0
  const minMargin = opts.minMargin ?? 0.05
  // Restricting to the storey this plan draws is what makes a class unique:
  // across both storeys a four-digit area is one of three, within one storey
  // it is exactly one.
  const candidates = areaCandidates(rooms, opts.storey)
  if (candidates.length === 0) return { examples: [], matches: [], notes: ['no published room areas to anchor on'] }

  const overlaps = (a: PixelBox, b: PixelBox): boolean =>
    a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0
  const excluded = opts.exclude ?? []
  const runs = groupRuns(inkComponents(gray, runOpts), runOpts).filter(
    (r) => !excluded.some((b) => overlaps(r.box, b)),
  )
  const withGlyphs = runGlyphs(gray, runs, runOpts.inkThreshold, slantRad)
  if (excluded.length > 0) notes.push(`${excluded.length} dimension label bands excluded from the area search`)

  // Structural classes: (component count, separator index).
  const byClass = new Map<string, AreaCandidate[]>()
  for (const c of candidates) {
    const k = String(c.digits.length)
    const list = byClass.get(k)
    if (list) list.push(c)
    else byClass.set(k, [c])
  }

  const examples: LabelledGlyph[] = []
  const matches: RoomAnchorResult['matches'] = []
  const usedRuns = new Set<RunGlyphs>()
  const usedTexts = new Set<string>()
  // A bank harvested from a sibling drawing seeds the appearance rounds: every
  // plan in one project is drawn in the same text style, so templates
  // transfer and a storey whose classes are all ambiguous can still be read.
  if (opts.seed) for (const t of opts.seed.templates) for (let n = 0; n < t.examples; n++) void n

  const addMatch = (rg: RunGlyphs, text: string, certainty: 'STRUCTURAL' | 'APPEARANCE', score: number): void => {
    usedRuns.add(rg)
    usedTexts.add(text)
    matches.push({ text, box: rg.box, certainty, score })
    for (let k = 0; k < text.length; k++) examples.push({ glyph: rg.glyphs[k], character: text[k] })
  }

  // The printed label carries a unit — `29,52 m²` — so the published digits are
  // a *prefix* of the run. Up to two trailing components are allowed for the
  // unit; more than that and this run is not an area label.
  const MAX_UNIT_GLYPHS = 2
  const fits = (rg: RunGlyphs, c: AreaCandidate): boolean => {
    const extra = rg.glyphs.length - c.digits.length
    return extra >= 0 && extra <= MAX_UNIT_GLYPHS
  }
  /**
   * Does this run look like an area label rather than any other run of digits?
   *
   * Every published area is printed with its unit, and `m²` is wider than it
   * is tall where a digit is narrower — a proportion that holds for any text
   * style and needs no character recognition. Requiring a wide trailing
   * component and narrow leading ones picks the area labels out of a plan full
   * of room numbers and dimension figures, which is what makes a
   * digit-count class unique enough to be certain.
   */
  const areaShaped = (rg: RunGlyphs, digits: number): boolean => {
    const extra = rg.glyphs.length - digits
    if (extra === 0) return false
    const unit = rg.glyphs.slice(digits)
    if (!unit.some((g) => g.aspect >= 0.85)) return false
    return rg.glyphs.slice(0, digits).every((g) => g.aspect <= 0.95)
  }
  for (const [cls, list] of byClass) {
    if (list.length !== 1) {
      notes.push(`digit class ${cls}: ${list.length} published candidates, not certain`)
      continue
    }
    const c = list[0]
    const hits = withGlyphs.filter((rg) => !usedRuns.has(rg) && fits(rg, c) && areaShaped(rg, c.digits.length))
    if (hits.length !== 1) {
      notes.push(`digit class ${cls} ("${c.text}"): ${hits.length} unit-shaped runs fit, not certain`)
      continue
    }
    addMatch(hits[0], c.digits, 'STRUCTURAL', 1)
  }
  notes.push(`${matches.length} structurally certain area labels (unique digit-count class, unit-shaped run)`)

  // Appearance rounds.
  for (let round = 0; round < 10; round++) {
    const bank = examples.length > 0 ? buildTemplates(examples) : opts.seed
    if (!bank || bank.templates.length === 0) break
    let best: { rg: RunGlyphs; text: string; score: number; margin: number } | null = null
    for (const rg of withGlyphs) {
      if (usedRuns.has(rg)) continue
      const scored: Array<{ text: string; score: number }> = []
      for (const c of candidates) {
        if (usedTexts.has(c.digits)) continue
        if (!fits(rg, c)) continue
        if (!areaShaped(rg, c.digits.length)) continue
        let total = 0
        let n = 0
        for (let i = 0; i < c.digits.length; i++) {
          const template = bank.templates.find((t) => t.character === c.digits[i])
          if (!template) continue
          total += profileSimilarityFor(template.profile, rg.glyphs[i].profile)
          n++
        }
        if (n === 0) continue
        scored.push({ text: c.digits, score: total / n })
      }
      if (scored.length === 0) continue
      scored.sort((a, b) => b.score - a.score)
      const margin = scored.length > 1 ? scored[0].score - scored[1].score : 1
      if (scored[0].score < 0.55 || margin < minMargin) continue
      if (!best || scored[0].score > best.score) best = { rg, text: scored[0].text, score: scored[0].score, margin }
    }
    if (!best) break
    addMatch(best.rg, best.text, 'APPEARANCE', best.score)
  }

  const alphabet = [...new Set(examples.map((e) => e.character))].sort().join('')
  notes.push(
    `${matches.length} area labels matched from ${withGlyphs.length} ink runs against ${candidates.length} ` +
      `published areas; alphabet {${alphabet}} from ${examples.length} examples`,
  )
  return { examples, matches, notes }
}

export type { TemplateBank }

export type RoomRegion = {
  id: number
  areaPx: number
  box: PixelBox
  centroid: { x: number; y: number }
}

/**
 * Enclosed rooms of a plan, found by flooding between the walls.
 *
 * The barrier is the wall mask — thick achromatic ink — and nothing else.
 * Furniture, appliances, tiling hatch and dimension witness lines are all thin
 * or coloured, so they do not stop the flood and a room stays one region
 * however densely it is furnished. That is what makes region *area* a usable
 * quantity here.
 *
 * Area matters because it is the one scale-free correspondence between a plan
 * and its published room table: the largest room in the drawing is the largest
 * area in the table, whatever the scale, whatever the units, without reading a
 * character. It is the only certainty available to bootstrap recognition from,
 * and it is the reason this function exists in the dimension pipeline rather
 * than in the plan analyser.
 */
export function roomRegions(
  walls: { width: number; height: number; data: Uint8Array | Uint8ClampedArray },
  bounds: PixelBox,
  minAreaPx: number,
): RoomRegion[] {
  const w = walls.width
  const h = walls.height
  const seen = new Uint8Array(w * h)
  const queue = new Int32Array(w * h)
  const out: RoomRegion[] = []
  const x0b = Math.max(0, bounds.x0)
  const y0b = Math.max(0, bounds.y0)
  const x1b = Math.min(w - 1, bounds.x1)
  const y1b = Math.min(h - 1, bounds.y1)
  for (let sy = y0b; sy <= y1b; sy++) {
    for (let sx = x0b; sx <= x1b; sx++) {
      const start = sy * w + sx
      if (seen[start] || walls.data[start]) continue
      let head = 0
      let tail = 0
      queue[tail++] = start
      seen[start] = 1
      let area = 0
      let minX = w
      let maxX = -1
      let minY = h
      let maxY = -1
      let cx = 0
      let cy = 0
      let touchesEdge = false
      while (head < tail) {
        const i = queue[head++]
        area++
        const x = i % w
        const y = (i / w) | 0
        cx += x
        cy += y
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
        if (x <= x0b || x >= x1b || y <= y0b || y >= y1b) touchesEdge = true
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const nx = x + dx
          const ny = y + dy
          if (nx < x0b || ny < y0b || nx > x1b || ny > y1b) continue
          const j = ny * w + nx
          if (seen[j] || walls.data[j]) continue
          seen[j] = 1
          queue[tail++] = j
        }
      }
      // A region running off the plan's own bounding box is the outside, not a
      // room.
      if (touchesEdge || area < minAreaPx) continue
      out.push({
        id: out.length,
        areaPx: area,
        box: { x0: minX, y0: minY, x1: maxX, y1: maxY },
        centroid: { x: cx / area, y: cy / area },
      })
    }
  }
  return out.sort((a, b) => b.areaPx - a.areaPx)
}

/**
 * Pair ink runs with published areas by room size, then harvest.
 *
 * Rank correspondence is the certainty the appearance rounds needed: the
 * biggest region holds the biggest published area, and the area-shaped run
 * inside that region therefore prints a string that is known before a single
 * glyph is examined. Only the unambiguous end of the ranking is used — pairs
 * whose neighbouring areas are close in value are skipped, because a rank
 * swap there would teach the templates a wrong character, and one wrong
 * character propagates through every label that contains it.
 */
export function harvestByRegionRank(
  gray: GrayImage,
  regions: readonly RoomRegion[],
  rooms: readonly RoomFact[],
  opts: {
    runs?: RunOptions
    slantRad?: number
    storey?: 'GROUND' | 'UPPER'
    exclude?: readonly PixelBox[]
    /** Minimum relative gap to the next published area for a rank to be trusted. */
    minRankGap?: number
  } = {},
): RoomAnchorResult {
  const notes: string[] = []
  const runOpts = opts.runs ?? DEFAULT_RUNS
  const slantRad = opts.slantRad ?? 0
  const minRankGap = opts.minRankGap ?? 0.08
  // Published areas for this storey, largest first, duplicates kept: two rooms
  // of the same size occupy two ranks.
  const areas = rooms
    .filter((r) => r.areaM2 !== null && r.areaM2 !== undefined && (!opts.storey || r.storey === opts.storey))
    .map((r) => r.areaM2 as number)
    .sort((a, b) => b - a)
  if (areas.length === 0 || regions.length === 0) {
    return { examples: [], matches: [], notes: ['no published areas or no enclosed regions to rank'] }
  }

  const overlaps = (a: PixelBox, b: PixelBox): boolean =>
    a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0
  const excluded = opts.exclude ?? []
  const runs = groupRuns(inkComponents(gray, runOpts), runOpts).filter(
    (r) => !excluded.some((b) => overlaps(r.box, b)),
  )
  const withGlyphs = runGlyphs(gray, runs, runOpts.inkThreshold, slantRad)

  const examples: LabelledGlyph[] = []
  const matches: RoomAnchorResult['matches'] = []
  const pairs = Math.min(areas.length, regions.length)
  for (let rank = 0; rank < pairs; rank++) {
    const value = areas[rank]
    // Trust this rank only if the neighbouring published areas are clearly
    // different: adjacent equal-ish areas can swap under any measurement error.
    const above = rank > 0 ? areas[rank - 1] : Number.POSITIVE_INFINITY
    const below = rank + 1 < areas.length ? areas[rank + 1] : 0
    if ((above - value) / value < minRankGap || (value - below) / value < minRankGap) {
      notes.push(`rank ${rank + 1} (${value} m²) skipped: neighbouring published areas are too close to order safely`)
      continue
    }
    const region = regions[rank]
    const digits = formatArea(value).replace(/[^0-9]/g, '')
    const inside = withGlyphs.filter((rg) => {
      const cx = (rg.box.x0 + rg.box.x1) / 2
      const cy = (rg.box.y0 + rg.box.y1) / 2
      if (cx < region.box.x0 || cx > region.box.x1 || cy < region.box.y0 || cy > region.box.y1) return false
      const extra = rg.glyphs.length - digits.length
      if (extra < 0 || extra > 2) return false
      const unit = rg.glyphs.slice(digits.length)
      if (extra > 0 && !unit.some((g) => g.aspect >= 0.85)) return false
      return rg.glyphs.slice(0, digits.length).every((g) => g.aspect <= 0.95)
    })
    if (inside.length !== 1) {
      notes.push(`rank ${rank + 1} (${value} m², region ${region.areaPx} px): ${inside.length} matching runs inside`)
      continue
    }
    matches.push({ text: digits, box: inside[0].box, certainty: 'STRUCTURAL', score: 1 })
    for (let k = 0; k < digits.length; k++) examples.push({ glyph: inside[0].glyphs[k], character: digits[k] })
  }
  const alphabet = [...new Set(examples.map((e) => e.character))].sort().join('')
  notes.push(
    `region-rank harvest: ${matches.length} of ${pairs} ranks matched, alphabet {${alphabet}} ` +
      `from ${examples.length} examples`,
  )
  return { examples, matches, notes }
}
