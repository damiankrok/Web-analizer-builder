/**
 * STAGE WEB-PIVOT-06 §7, §8, §9, §10 — dimension structures, chain fitting and
 * the scale the sheet states about itself.
 *
 * Most of this is tested on drawings built here, pixel by pixel, so that what
 * is under test is the rule and not one publisher's house style. The last
 * group runs the whole thing over project A and asserts what the drawing
 * itself says — a printed sum, and a scale the plan's own extent confirms.
 */
import { existsSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import type { GrayImage } from '../src/core/contracts/raster.js'
import { strokeMask, detectStrokeRuns, mergeStrokeRuns, DEFAULT_STROKES } from '../src/core/extract/stroke-lines.js'
import {
  detectBaselines,
  detectDimensionStructures,
  textOccupancy,
  anchorsOn,
  DEFAULT_DIMENSION_STRUCTURES,
} from '../src/core/extract/dimension-structures.js'
import { fitChain, DEFAULT_CHAIN_FIT, type ChainLabel } from '../src/core/extract/chain-fit.js'
import { parsePlanCentimetres, buildObservations } from '../src/core/extract/dimension-observations.js'
import { detectTextRegions } from '../src/core/extract/text-regions.js'
import { inkChannel } from '../src/core/extract/raster-normalize.js'
import { buildTextCrops } from '../src/core/extract/text-crops.js'
import { DEFAULT_PLAN_TEXT } from '../src/core/extract/text-engine.js'
import { TesseractEngine } from '../src/node/ocr/tesseract.js'
import { extractPlanSpec, DEFAULT_EXTRACTION } from '../src/node/extract-runner.js'
import { loadFixture } from './helpers.js'

const paper = (w: number, h: number, v = 250): GrayImage => ({
  width: w,
  height: h,
  data: new Uint8ClampedArray(w * h).fill(v),
})
const fill = (g: GrayImage, x0: number, y0: number, w: number, h: number, v: number): void => {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      if (x >= 0 && y >= 0 && x < g.width && y < g.height) g.data[y * g.width + x] = v
    }
  }
}

describe('§7 a stroke is what is darker than its own surroundings', () => {
  it('finds a hairline drawn over a filled room, where a threshold cannot', () => {
    // Paper 250, room fill 150, line 60. Any global threshold that catches the
    // line inside the room also catches the whole room.
    const g = paper(200, 60)
    fill(g, 20, 10, 160, 40, 150)
    fill(g, 20, 30, 160, 2, 60)
    const runs = mergeStrokeRuns(detectStrokeRuns(strokeMask(g, 'X'), 'X'), DEFAULT_STROKES.radiusPx)
    const hairline = runs.find((r) => r.position >= 29 && r.position <= 32)
    expect(hairline).toBeDefined()
    expect(hairline!.to - hairline!.from).toBeGreaterThan(150)
    // The room's own top and bottom edges are strokes too, and should be: a
    // boundary is exactly what this is meant to find. What matters is that the
    // room's *interior* is not one.
    expect(runs.every((r) => r.position < 12 || r.position > 28 || r.position > 47 || r.position >= 29)).toBe(true)
    expect(runs.some((r) => r.position > 15 && r.position < 28)).toBe(false)
  })

  it('does not answer through the body of a wall', () => {
    const g = paper(200, 60)
    fill(g, 20, 20, 160, 20, 20) // a 20 px thick solid band
    const mask = strokeMask(g, 'X')
    // Its edges answer; its middle does not, which is what keeps a wall out of
    // a set of dimension baselines.
    expect(mask.data[30 * 200 + 100]).toBe(0)
  })

  it('ignores a stroke running the other way', () => {
    const g = paper(120, 120)
    fill(g, 60, 10, 2, 100, 40)
    expect(detectStrokeRuns(strokeMask(g, 'X'), 'X')).toHaveLength(0)
    expect(mergeStrokeRuns(detectStrokeRuns(strokeMask(g, 'Y'), 'Y'), 4)).toHaveLength(1)
  })
})

describe('§7 baselines, anchors and what is not a dimension line', () => {
  /** A chain: one rule, ticks across it, and nothing else. */
  const chainImage = (ticksAt: readonly number[]): GrayImage => {
    const g = paper(400, 80)
    const from = ticksAt[0]
    const to = ticksAt[ticksAt.length - 1]
    fill(g, from, 40, to - from + 1, 2, 30)
    for (const t of ticksAt) fill(g, t, 34, 2, 14, 30)
    return g
  }

  it('cuts a chain at its ticks', () => {
    const { baselines } = detectBaselines(chainImage([40, 140, 300, 360]), [])
    const chain = baselines.find((b) => b.axis === 'X')!
    expect(chain).toBeDefined()
    expect(chain.anchors).toHaveLength(4)
    expect(chain.anchors[0]).toBeGreaterThanOrEqual(39)
    expect(chain.anchors[3]).toBeLessThanOrEqual(362)
  })

  it('rejects a long stroke whose crossings sit far inside its ends', () => {
    // A counter front or paving joint: it crosses things, then keeps going.
    const g = paper(400, 80)
    fill(g, 10, 40, 380, 2, 30)
    for (const t of [150, 250]) fill(g, t, 34, 2, 14, 30)
    const { baselines } = detectBaselines(g, [])
    expect(baselines.filter((b) => b.axis === 'X')).toHaveLength(0)
  })

  it('does not count the digits of a label as ticks', () => {
    // Three uprights just above the rule, exactly where a label is printed.
    const g = chainImage([40, 360])
    for (const x of [180, 190, 200]) fill(g, x, 29, 2, 10, 30)
    const withoutText = detectBaselines(g, []).baselines.find((b) => b.axis === 'X')!
    expect(withoutText.anchors.length).toBeGreaterThan(2)

    const label = {
      id: 'tx0',
      regionId: 'tx0',
      box: { x0: 178, y0: 27, x1: 204, y1: 40 },
      orientation: 'HORIZONTAL' as const,
      glyphs: 3,
      glyphHeightPx: 10,
      axis: 'X' as const,
    }
    const withText = detectBaselines(g, [label]).baselines.find((b) => b.axis === 'X')!
    expect(withText.anchors).toHaveLength(2)
  })

  it('marks where the text is, so the tick search can avoid it', () => {
    const mask = textOccupancy(20, 20, [
      {
        id: 'a',
        regionId: 'a',
        box: { x0: 5, y0: 5, x1: 8, y1: 8 },
        orientation: 'HORIZONTAL',
        glyphs: 2,
        glyphHeightPx: 4,
        axis: 'X',
      },
    ])
    expect(mask[6 * 20 + 6]).toBe(1)
    expect(mask[15 * 20 + 15]).toBe(0)
  })

  it('groups the columns of one tick into one anchor', () => {
    const cross = { width: 100, height: 20, data: new Uint8Array(100 * 20) }
    for (let y = 4; y < 16; y++) for (let x = 48; x < 53; x++) cross.data[y * 100 + x] = 1
    const anchors = anchorsOn({ position: 10, from: 0, to: 99 }, 'X', cross, null, DEFAULT_DIMENSION_STRUCTURES)
    expect(anchors).toHaveLength(1)
    expect(anchors[0]).toBeGreaterThanOrEqual(48)
    expect(anchors[0]).toBeLessThanOrEqual(52)
  })
})

describe('§8 a chain is a partition, not a bag of spans', () => {
  const label = (id: string, valueCm: number, centrePx: number, runPx = 20): ChainLabel => ({
    id,
    valueCm,
    centrePx,
    runPx,
  })

  it('places segments end to end, in printed order', () => {
    const anchors = [0, 100, 250, 400]
    const labels = [label('a', 100, 50), label('b', 150, 175), label('c', 150, 325)]
    const fit = fitChain(anchors, labels, 1)
    expect(fit.segments.map((s) => s.labelId)).toEqual(['a', 'b', 'c'])
    expect(fit.segments.map((s) => [s.fromPx, s.toPx])).toEqual([
      [0, 100],
      [100, 250],
      [250, 400],
    ])
    expect(fit.unplacedLabelIds).toEqual([])
  })

  it('steps over an anchor that is not part of the chain', () => {
    // A partition wall crosses the line at 60; the chain still reads.
    const anchors = [0, 60, 100, 250]
    const fit = fitChain(anchors, [label('a', 100, 50), label('b', 150, 175)], 1)
    expect(fit.segments.map((s) => [s.fromPx, s.toPx])).toEqual([
      [0, 100],
      [100, 250],
    ])
  })

  it('refuses a scale whose segments cannot be made to join up', () => {
    // At 1.5 px/cm the first label wants 150 px and the second 225; the
    // anchors offer no monotone partition that gives both.
    const anchors = [0, 100, 250]
    const fit = fitChain(anchors, [label('a', 100, 50), label('b', 150, 175)], 1.5)
    expect(fit.segments.length).toBeLessThan(2)
  })

  it('leaves a label unplaced rather than forcing it somewhere', () => {
    const anchors = [0, 100]
    const fit = fitChain(anchors, [label('a', 100, 50), label('b', 999, 400)], 1)
    expect(fit.segments.map((s) => s.labelId)).toEqual(['a'])
    expect(fit.unplacedLabelIds).toEqual(['b'])
  })

  it('will not let a label measure a span it is not printed on', () => {
    // The span 0..100 fits the value, but the label is printed at 400.
    const fit = fitChain([0, 100], [label('a', 100, 400)], 1)
    expect(fit.segments).toHaveLength(0)
  })

  it('allows a long label to overhang the short span it measures', () => {
    const fit = fitChain([0, 12], [label('a', 12, 6, 30)], 1)
    expect(fit.segments).toHaveLength(1)
  })

  it('takes the partition that lands squarely, not the first inside tolerance', () => {
    // Both readings account for the same 250 px — every partition between the
    // same two ends does — so pixels cannot choose. 0..90 is 10% out where
    // 0..100 is exact, and that is the difference.
    const anchors = [0, 90, 100, 250]
    const fit = fitChain(anchors, [label('a', 100, 50), label('b', 150, 175)], 1, {
      ...DEFAULT_CHAIN_FIT,
      scaleTolerance: 0.12,
    })
    expect(fit.segments).toHaveLength(2)
    expect(fit.segments[0].toPx).toBe(100)
    expect(fit.score).toBeGreaterThan(1.9)
  })

  it('returns nothing when there is nothing to fit', () => {
    expect(fitChain([], [label('a', 100, 50)], 1).segments).toEqual([])
    expect(fitChain([0, 100], [], 1).segments).toEqual([])
    expect(fitChain([0, 100], [label('a', 100, 50)], 0).segments).toEqual([])
  })
})

describe('§8 what a plan dimension token may look like', () => {
  it('reads a plain centimetre value', () => {
    expect(parsePlanCentimetres('1205')).toBe(1205)
    expect(parsePlanCentimetres('90')).toBe(90)
  })

  it('rejects a leading zero, which is a label read from the wrong end', () => {
    expect(parsePlanCentimetres('001')).toBeNull()
    expect(parsePlanCentimetres('099')).toBeNull()
  })

  it('rejects a single digit and anything that is not digits', () => {
    expect(parsePlanCentimetres('7')).toBeNull()
    expect(parsePlanCentimetres('12a')).toBeNull()
    expect(parsePlanCentimetres('')).toBeNull()
    expect(parsePlanCentimetres('12345')).toBeNull()
  })
})

describe('§7 an unowned number stays an observation', () => {
  it('keeps a reading that no baseline claims, and says why', () => {
    const g = paper(200, 200)
    const regions = detectTextRegions(g)
    const structures = detectDimensionStructures(g, regions)
    const built = buildObservations(
      [{ cropId: 'ghost', text: '250', confidence: 0.9, boxInCrop: null, engineId: 'test' }],
      [
        {
          id: 'ghost',
          regionId: 'ghost',
          box: { x0: 10, y0: 10, x1: 40, y1: 24 },
          orientation: 'HORIZONTAL',
          glyphs: 3,
          glyphHeightPx: 13,
          axis: 'X',
        },
      ],
      structures,
    )
    expect(built.observations).toHaveLength(1)
    expect(built.observations[0].text).toBe('250')
    expect(built.observations[0].valueCm).toBe(250)
    expect(built.observations[0].owner.kind).toBe('NONE')
    if (built.observations[0].owner.kind === 'NONE') {
      expect(built.observations[0].owner.why).toMatch(/no dimension baseline/)
    }
  })

  it('drops nothing on an empty drawing, and claims no scale', () => {
    const g = paper(120, 120)
    const built = buildObservations([], [], detectDimensionStructures(g, []))
    expect(built.observations).toEqual([])
    expect(built.scales.every((s) => s.pxPerCm === null)).toBe(true)
    expect(built.distortion).toBeNull()
  })
})

/**
 * §9, §10 — the whole pipeline on a real drawing.
 *
 * Nothing here is told what project A measures. The assertions are things the
 * drawing states about itself: a sum it prints across its own top margin, and
 * the agreement between every label it read and the span that label claims.
 */
describe('\u00a79 the pipeline on project A', () => {
  const availability = TesseractEngine.available()
  const run = availability.available && existsSync('fixtures/A-marcowki/assets') ? it : it.skip

  run('settles one scale for the sheet set and closes the printed chain', async () => {
    const { pkg, images } = await loadFixture('A-marcowki')
    const result = extractPlanSpec(pkg, images, { ...DEFAULT_EXTRACTION, engine: new TesseractEngine() })

    // Two drawings of one building, published together, are one scale.
    expect(result.sheetScale).not.toBeNull()
    expect(result.sheetScale!.adoptedBy.sort()).toEqual(['GROUND', 'UPPER_ATTIC'])

    const ground = result.plans.find((p) => p.storey === 'GROUND')!
    const owned = new Map<string, number>()
    for (const o of ground.observations) {
      if (o.owner.kind === 'INTERVAL' && o.valueCm !== null) owned.set(o.text, o.owner.lengthPx)
    }

    // The ground plan prints 790 and 415 above 1205. All three are read as
    // separate labels, each attached to its own span; the arithmetic is the
    // source's, not ours.
    expect(owned.has('790')).toBe(true)
    expect(owned.has('415')).toBe(true)
    expect(owned.has('1205')).toBe(true)
    const parts = owned.get('790')! + owned.get('415')!
    expect(Math.abs(parts / owned.get('1205')! - 1)).toBeLessThan(0.03)

    // ...and every span a label claims is the length the sheet's scale
    // predicts for the number printed on it.
    const scale = result.sheetScale!.pxPerCm
    for (const [text, lengthPx] of owned) {
      expect(Math.abs(lengthPx / (Number(text) * scale) - 1)).toBeLessThan(0.07)
    }

    // A dozen or so labels find owners on each storey. This is a floor, not a
    // target: it exists so a regression that reads nothing cannot pass.
    for (const plan of result.plans) {
      expect(plan.observations.filter((o) => o.owner.kind === 'INTERVAL').length).toBeGreaterThanOrEqual(8)
    }

    // Nothing is thrown away: a reading that found no owner is still reported,
    // with the reason it has none (\u00a77).
    for (const plan of result.plans) {
      for (const o of plan.observations) {
        if (o.owner.kind === 'NONE') expect(o.owner.why.length).toBeGreaterThan(0)
      }
    }
  }, 240_000)
})
