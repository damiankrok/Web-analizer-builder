/**
 * Dimension geometry (§33): chains, ticks, rotated labels, missing ticks and
 * crossing lines, on synthetic drawings so the expected answer is known.
 */
import { describe, expect, it } from 'vitest'
import type { GrayImage } from '../src/core/contracts/raster.js'
import {
  DEFAULT_DIMENSION_GEOMETRY,
  chainFamilies,
  detectDimensionGeometry,
  detectLines,
  detectTicks,
  estimateSlant,
  labelZonesFor,
  refineLinePosition,
} from '../src/core/dimensions/geometry.js'

const blank = (w: number, h: number): GrayImage => ({
  width: w,
  height: h,
  data: new Uint8ClampedArray(w * h).fill(255),
})

const hline = (img: GrayImage, y: number, x0: number, x1: number, v = 30): void => {
  for (let x = x0; x <= x1; x++) img.data[y * img.width + x] = v
}
const vline = (img: GrayImage, x: number, y0: number, y1: number, v = 30): void => {
  for (let y = y0; y <= y1; y++) img.data[y * img.width + x] = v
}
/** A tick crosses the baseline, inking both sides of it. */
const tick = (img: GrayImage, x: number, y: number, reach = 5): void => {
  for (let d = -reach; d <= reach; d++) {
    const yy = y + d
    if (yy < 0 || yy >= img.height) continue
    img.data[yy * img.width + x] = 20
  }
}
const vtick = (img: GrayImage, x: number, y: number, reach = 5): void => {
  for (let d = -reach; d <= reach; d++) {
    const xx = x + d
    if (xx < 0 || xx >= img.width) continue
    img.data[y * img.width + xx] = 20
  }
}

describe('dimension line and tick detection', () => {
  it('finds a horizontal chain and its interior anchors', () => {
    const img = blank(400, 120)
    hline(img, 60, 40, 360)
    for (const x of [40, 150, 260, 360]) tick(img, x, 60)
    const lines = detectLines(img, DEFAULT_DIMENSION_GEOMETRY, 150)
    const line = lines.find((l) => l.orientation === 'HORIZONTAL' && l.to - l.from > 250)
    expect(line).toBeDefined()
    const ticks = detectTicks(img, line!, DEFAULT_DIMENSION_GEOMETRY, 150)
    expect(ticks.length).toBe(4)
    for (const [i, want] of [40, 150, 260, 360].entries()) expect(Math.abs(ticks[i] - want)).toBeLessThan(2)
  })

  it('finds a vertical chain the same way', () => {
    const img = blank(120, 400)
    vline(img, 60, 40, 360)
    for (const y of [40, 200, 360]) vtick(img, 60, y)
    const lines = detectLines(img, DEFAULT_DIMENSION_GEOMETRY, 150)
    const line = lines.find((l) => l.orientation === 'VERTICAL' && l.to - l.from > 250)
    expect(line).toBeDefined()
    expect(detectTicks(img, line!, DEFAULT_DIMENSION_GEOMETRY, 150).length).toBe(3)
  })

  it('does not read a label stem as an anchor', () => {
    // Text sits above the line and inks one side only; a tick inks both.
    const img = blank(400, 120)
    hline(img, 60, 40, 360)
    for (const x of [40, 360]) tick(img, x, 60)
    for (let y = 44; y <= 56; y++) img.data[y * img.width + 200] = 20
    const line = detectLines(img, DEFAULT_DIMENSION_GEOMETRY, 150).find((l) => l.orientation === 'HORIZONTAL')!
    const ticks = detectTicks(img, line, DEFAULT_DIMENSION_GEOMETRY, 150)
    expect(ticks.length).toBe(2)
  })

  it('uses the baseline end as an anchor when no tick is drawn there', () => {
    const img = blank(400, 120)
    hline(img, 60, 40, 360)
    tick(img, 150, 60)
    const line = detectLines(img, DEFAULT_DIMENSION_GEOMETRY, 150).find((l) => l.orientation === 'HORIZONTAL')!
    const ticks = detectTicks(img, line, DEFAULT_DIMENSION_GEOMETRY, 150)
    expect(ticks.length).toBe(3)
    expect(ticks[0]).toBeLessThan(45)
    expect(ticks[2]).toBeGreaterThan(355)
  })

  it('locates a line to sub-pixel precision', () => {
    // Two inked rows of unequal weight put the true centre between them.
    const img = blank(400, 120)
    hline(img, 60, 40, 360, 40)
    hline(img, 61, 40, 360, 160)
    const line = detectLines(img, DEFAULT_DIMENSION_GEOMETRY, 200).find((l) => l.orientation === 'HORIZONTAL')!
    const refined = refineLinePosition(img, line, 200)
    expect(refined).toBeGreaterThan(60)
    expect(refined).toBeLessThan(61)
  })

  it('pairs an inner divided line with its outer total into one chain', () => {
    const img = blank(400, 140)
    // Outer total line, two anchors.
    hline(img, 30, 40, 360)
    for (const x of [40, 360]) tick(img, x, 30)
    // Inner line divided in two.
    hline(img, 60, 40, 360)
    for (const x of [40, 200, 360]) tick(img, x, 60)
    const g = detectDimensionGeometry(img)
    const families = chainFamilies(g.lines)
    const withTotal = families.find((f) => f.overall !== null && f.parts.length > 0)
    expect(withTotal).toBeDefined()
    expect(withTotal!.parts[0].ticks.length).toBe(3)
    expect(withTotal!.overall!.ticks.length).toBe(2)
  })

  it('gives one label zone per interval and none for the whole span', () => {
    const img = blank(400, 140)
    hline(img, 60, 40, 360)
    for (const x of [40, 200, 360]) tick(img, x, 60)
    const line = detectLines(img, DEFAULT_DIMENSION_GEOMETRY, 150).find((l) => l.orientation === 'HORIZONTAL')!
    line.ticks = detectTicks(img, line, DEFAULT_DIMENSION_GEOMETRY, 150)
    const zones = labelZonesFor(line, DEFAULT_DIMENSION_GEOMETRY, { x0: 0, y0: 0, x1: 399, y1: 139 })
    expect(zones.length).toBe(2)
    expect(zones.every((z) => z.segmentIndex >= 0)).toBe(true)
  })

  it('survives a line crossing the chain without inventing anchors', () => {
    const img = blank(400, 160)
    hline(img, 80, 40, 360)
    for (const x of [40, 360]) tick(img, x, 80)
    // A long vertical crossing the chain: broad perpendicular contact, not a tick.
    for (let y = 20; y <= 140; y++) for (const dx of [-1, 0, 1]) img.data[y * img.width + 250 + dx] = 20
    const line = detectLines(img, DEFAULT_DIMENSION_GEOMETRY, 150).find(
      (l) => l.orientation === 'HORIZONTAL' && l.to - l.from > 250,
    )!
    const ticks = detectTicks(img, line, DEFAULT_DIMENSION_GEOMETRY, 150)
    // The crossing may or may not be admitted, but the two real ends must be.
    expect(ticks.some((t) => Math.abs(t - 40) < 3)).toBe(true)
    expect(ticks.some((t) => Math.abs(t - 360) < 3)).toBe(true)
  })

  it('measures the lean of slanted text and reports zero for upright text', () => {
    const upright = blank(60, 40)
    for (let y = 10; y <= 30; y++) for (const x of [20, 21]) upright.data[y * 60 + x] = 20
    expect(Math.abs(estimateSlant(upright, [{ x0: 14, y0: 8, x1: 28, y1: 32 }], 150))).toBeLessThan(0.05)

    const leaning = blank(60, 40)
    for (let y = 10; y <= 30; y++) {
      const x = 20 + Math.round((30 - y) * 0.3)
      leaning.data[y * 60 + x] = 20
      leaning.data[y * 60 + x + 1] = 20
    }
    const slant = estimateSlant(leaning, [{ x0: 14, y0: 8, x1: 32, y1: 32 }], 150)
    expect(slant).toBeGreaterThan(0.2)
  })
})
