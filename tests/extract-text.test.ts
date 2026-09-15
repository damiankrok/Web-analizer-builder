/**
 * STAGE WEB-PIVOT-06 §6, §7 — raster normalization, text-region detection and
 * the OCR adapter seam.
 *
 * The engine tests are skipped, not failed, when no local engine is installed:
 * a checkout without Tesseract must still be able to run the suite, and the
 * stage report says which of these ran.
 */
import { existsSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import type { GrayImage, RasterImage } from '../src/core/contracts/raster.js'
import { inkChannel, enlarge, padWithPaper, scaleForCropHeight } from '../src/core/extract/raster-normalize.js'
import {
  detectTextRegions,
  glyphCandidates,
  inkComponents,
  DEFAULT_TEXT_REGIONS,
} from '../src/core/extract/text-regions.js'
import { buildTextCrop } from '../src/core/extract/text-crops.js'
import { DEFAULT_PLAN_TEXT } from '../src/core/extract/text-engine.js'
import { TesseractEngine } from '../src/node/ocr/tesseract.js'
import { selectPlanAsset } from '../src/core/dimensions/plan-select.js'
import { buildTextCrops } from '../src/core/extract/text-crops.js'
import { loadFixture } from './helpers.js'

const rgba = (w: number, h: number, fn: (x: number, y: number) => [number, number, number]): RasterImage => {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = fn(x, y)
      const i = (y * w + x) * 4
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = 255
    }
  }
  return { width: w, height: h, data }
}

const blank = (w: number, h: number, v = 250): GrayImage => ({
  width: w,
  height: h,
  data: new Uint8ClampedArray(w * h).fill(v),
})

/** A filled box of ink, the simplest thing that stands in for a glyph. */
const block = (g: GrayImage, x0: number, y0: number, w: number, h: number, v = 20): void => {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) g.data[y * g.width + x] = v
}

describe('§3 raster normalization', () => {
  it('keeps a saturated red annotation dark where luminance turns it grey', () => {
    // Red ink on white paper, with neutral grey furniture hatching beside it.
    const img = rgba(9, 3, (x) => (x < 3 ? [200, 30, 40] : x < 6 ? [175, 175, 175] : [250, 250, 250]))
    const ink = inkChannel(img)
    const red = ink.data[0]
    const grey = ink.data[4]
    const paper = ink.data[7]
    // The red stroke must be far darker than the grey it is drawn over, which
    // is exactly what a luminance conversion loses.
    expect(red).toBeLessThan(40)
    expect(grey).toBeGreaterThan(150)
    expect(paper).toBeGreaterThan(240)
    const luma = Math.round(0.299 * 200 + 0.587 * 30 + 0.114 * 40)
    expect(Math.abs(luma - grey)).toBeLessThan(100) // ...and they were nearly equal
  })

  it('enlarges without inventing or dropping extremes', () => {
    const g = blank(4, 4, 200)
    block(g, 1, 1, 2, 2, 10)
    const big = enlarge(g, 4)
    expect(big.width).toBe(16)
    expect(big.height).toBe(16)
    let min = 255
    let max = 0
    for (const v of big.data) {
      if (v < min) min = v
      if (v > max) max = v
    }
    expect(min).toBeGreaterThanOrEqual(10)
    expect(max).toBeLessThanOrEqual(200)
  })

  it('returns the source unchanged when no enlargement is asked for', () => {
    const g = blank(4, 4)
    expect(enlarge(g, 1)).toBe(g)
    expect(padWithPaper(g, 0, 255)).toBe(g)
  })

  it('pads with the crop’s own paper, not with white', () => {
    const g = blank(3, 3, 180)
    const p = padWithPaper(g, 2, 180)
    expect(p.width).toBe(7)
    expect(p.data[0]).toBe(180)
    expect(p.data[3 * 7 + 3]).toBe(180)
  })

  it('never shrinks, and honours the cap', () => {
    expect(scaleForCropHeight(300, 150, 10)).toBe(1)
    expect(scaleForCropHeight(10, 150, 10)).toBe(10)
    expect(scaleForCropHeight(50, 150, 10)).toBeCloseTo(3, 6)
    expect(scaleForCropHeight(0, 150, 10)).toBe(1)
  })
})

describe('§7 text-region detection', () => {
  it('groups a row of same-sized marks into one run and finds its hull', () => {
    const g = blank(80, 30)
    for (let i = 0; i < 4; i++) block(g, 10 + i * 8, 10, 5, 12)
    const regions = detectTextRegions(g)
    const horizontal = regions.filter((r) => r.axis === 'X')
    expect(horizontal).toHaveLength(1)
    expect(horizontal[0].glyphs).toBe(4)
    expect(horizontal[0].box.x0).toBe(10)
    expect(horizontal[0].box.x1).toBe(10 + 3 * 8 + 4)
    expect(horizontal[0].glyphHeightPx).toBe(12)
  })

  it('finds a column of marks too, and offers it in both reading directions', () => {
    const g = blank(30, 80)
    for (let i = 0; i < 3; i++) block(g, 10, 10 + i * 8, 12, 5)
    const vertical = detectTextRegions(g).filter((r) => r.axis === 'Y')
    expect(vertical).toHaveLength(2)
    expect(new Set(vertical.map((r) => r.orientation))).toEqual(new Set(['VERTICAL_UP', 'VERTICAL_DOWN']))
    // Both are readings of one label, so they share a region id.
    expect(vertical[0].regionId).toBe(vertical[1].regionId)
    expect(vertical[0].id).not.toBe(vertical[1].id)
  })

  it('admits a glyph lying on its side, which is how a plan prints its vertical chains', () => {
    // The same mark upright and rotated must both survive the size filter.
    const upright = { box: { x0: 0, y0: 0, x1: 4, y1: 12 }, area: 40, width: 5, height: 13 }
    const onItsSide = { box: { x0: 0, y0: 0, x1: 12, y1: 4 }, area: 40, width: 13, height: 5 }
    const kept = glyphCandidates([upright, onItsSide])
    expect(kept).toHaveLength(2)
  })

  it('rejects rules, hatching strokes and blobs', () => {
    const rule = { box: { x0: 0, y0: 0, x1: 400, y1: 1 }, area: 400, width: 401, height: 2 }
    const blob = { box: { x0: 0, y0: 0, x1: 90, y1: 90 }, area: 8100, width: 91, height: 91 }
    const hollow = { box: { x0: 0, y0: 0, x1: 10, y1: 12 }, area: 4, width: 11, height: 13 }
    expect(glyphCandidates([rule, blob, hollow])).toHaveLength(0)
  })

  it('does not join marks that differ in size or drift off the line', () => {
    const g = blank(90, 40)
    block(g, 10, 10, 5, 12)
    block(g, 18, 10, 5, 22) // far taller
    const tall = detectTextRegions(g).filter((r) => r.axis === 'X')
    expect(tall).toHaveLength(0)

    const h = blank(90, 60)
    block(h, 10, 10, 5, 12)
    block(h, 18, 34, 5, 12) // same size, wrong line
    expect(detectTextRegions(h).filter((r) => r.axis === 'X')).toHaveLength(0)
  })

  it('separates two runs across a wide gap instead of welding them into one', () => {
    const g = blank(140, 30)
    for (let i = 0; i < 3; i++) block(g, 10 + i * 8, 10, 5, 12)
    for (let i = 0; i < 3; i++) block(g, 90 + i * 8, 10, 5, 12)
    const runs = detectTextRegions(g).filter((r) => r.axis === 'X')
    expect(runs).toHaveLength(2)
  })

  it('finds text of any size, because the rules are ratios and not pixel counts', () => {
    const small = blank(60, 24)
    for (let i = 0; i < 3; i++) block(small, 6 + i * 5, 6, 3, 7)
    const large = blank(180, 72)
    for (let i = 0; i < 3; i++) block(large, 18 + i * 15, 18, 9, 21)
    expect(detectTextRegions(small).filter((r) => r.axis === 'X')).toHaveLength(1)
    expect(detectTextRegions(large).filter((r) => r.axis === 'X')).toHaveLength(1)
  })

  it('terminates on a pathological image instead of running away', () => {
    const noise = blank(200, 200)
    for (let i = 0; i < noise.data.length; i++) noise.data[i] = (i * 7919) % 256
    const t0 = Date.now()
    const comps = inkComponents(noise, { ...DEFAULT_TEXT_REGIONS, maxComponents: 500 })
    expect(comps.length).toBeLessThanOrEqual(500)
    expect(Date.now() - t0).toBeLessThan(5000)
  })
})

describe('§6 crops and the engine seam', () => {
  it('enlarges a small crop and surrounds it with paper', () => {
    const g = blank(200, 60)
    block(g, 20, 20, 6, 14)
    const crop = buildTextCrop(g, { id: 'c1', box: { x0: 14, y0: 14, x1: 40, y1: 40 }, orientation: 'HORIZONTAL' })
    expect(crop.id).toBe('c1')
    expect(crop.scale).toBeGreaterThan(1)
    expect(crop.gray.height).toBeGreaterThan(40)
    // Corners are margin, so they carry paper rather than ink.
    expect(crop.gray.data[0]).toBeGreaterThan(100)
  })

  const availability = TesseractEngine.available()
  const withEngine = availability.available ? it : it.skip

  it('reports engine availability rather than throwing', () => {
    expect(typeof availability.available).toBe('boolean')
    expect(availability.engineId).toBe('tesseract')
    if (!availability.available) expect(availability.note).not.toBe('')
  })

  withEngine('honours the alphabet it is given', () => {
    const g = blank(40, 40)
    const engine = new TesseractEngine()
    const readings = engine.readBatch(
      [{ id: 'empty', gray: g, sourceBox: { x0: 0, y0: 0, x1: 40, y1: 40 }, orientation: 'HORIZONTAL', scale: 1 }],
      DEFAULT_PLAN_TEXT,
    )
    for (const r of readings) expect(r.text).toMatch(/^[0-9]*$/)
  })

  withEngine('reports a confidence in 0..1, never a bare certainty', () => {
    const g = blank(120, 60)
    block(g, 20, 15, 12, 30)
    block(g, 45, 15, 12, 30)
    const engine = new TesseractEngine()
    for (const r of engine.readBatch(
      [{ id: 'x', gray: g, sourceBox: { x0: 0, y0: 0, x1: 120, y1: 60 }, orientation: 'HORIZONTAL', scale: 1 }],
      DEFAULT_PLAN_TEXT,
    )) {
      expect(r.confidence).toBeGreaterThanOrEqual(0)
      expect(r.confidence).toBeLessThan(1)
    }
  })

  withEngine('keeps each reading with its own crop across a batch', () => {
    const one = blank(120, 60)
    block(one, 30, 15, 14, 30)
    const two = blank(120, 60)
    block(two, 30, 15, 14, 30)
    block(two, 60, 15, 14, 30)
    const engine = new TesseractEngine()
    const readings = engine.readBatch(
      [
        { id: 'first', gray: one, sourceBox: { x0: 0, y0: 0, x1: 120, y1: 60 }, orientation: 'HORIZONTAL', scale: 1 },
        { id: 'second', gray: two, sourceBox: { x0: 0, y0: 0, x1: 120, y1: 60 }, orientation: 'HORIZONTAL', scale: 1 },
      ],
      DEFAULT_PLAN_TEXT,
    )
    for (const r of readings) expect(['first', 'second']).toContain(r.cropId)
  })

  withEngine('returns nothing for an empty batch and leaves no working directory', () => {
    const engine = new TesseractEngine()
    expect(engine.readBatch([], DEFAULT_PLAN_TEXT)).toEqual([])
  })
})

/**
 * §6, §9 — the measurement that decided the engine, reduced to an assertion.
 *
 * Project A's ground plan prints `790 + 415 = 1205` across its top margin.
 * Reproducing that sum from the drawing's own pixels is the whole claim of the
 * stage: the parts and the total are three separate labels, nothing here knows
 * what they should say, and no gold file is read.
 */
describe('\u00a76 the chosen engine on a real drawing', () => {
  const availability = TesseractEngine.available()
  const haveFixture = existsSync('fixtures/A-marcowki/assets')
  const run = availability.available && haveFixture ? it : it.skip

  run('reads the printed width chain off project A and closes it', async () => {
    const { pkg, images } = await loadFixture('A-marcowki')
    const sel = selectPlanAsset(pkg.assets, 'GROUND')!
    const ink = inkChannel(images.get(sel.asset.id)!)
    const regions = detectTextRegions(ink)
    const crops = buildTextCrops(
      ink,
      regions.map((r) => ({ id: r.id, box: r.box, orientation: r.orientation })),
    )
    const readings = new TesseractEngine().readBatch(crops, DEFAULT_PLAN_TEXT)
    const regionOf = new Map(regions.map((r) => [r.id, r.regionId]))
    const best = new Map<string, { text: string; confidence: number }>()
    for (const r of readings) {
      const key = regionOf.get(r.cropId) ?? r.cropId
      const prev = best.get(key)
      if (!prev || r.confidence > prev.confidence) best.set(key, r)
    }
    const tokens = new Set(
      [...best.values()].filter((r) => r.confidence >= 0.6 && r.text.length >= 2).map((r) => r.text),
    )
    expect(tokens.has('790')).toBe(true)
    expect(tokens.has('415')).toBe(true)
    expect(tokens.has('1205')).toBe(true)
    expect(790 + 415).toBe(1205)
  }, 120_000)
})
