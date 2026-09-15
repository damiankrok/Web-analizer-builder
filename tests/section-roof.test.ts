/**
 * STAGE WEB-PIVOT-07 §13, §14 — the roof as the section draws it.
 *
 * §13's rule is that the slopes are *fitted* and the printed pitch is a second
 * observation, so the synthetic groups check that the fit survives the things
 * that actually interrupt a section's skyline — a chimney, a callout drawn
 * over the roof, an eave detail the poché does not reach — and that a pitch is
 * never taken from a label alone.
 */
import { describe, it, expect } from 'vitest'
import type { GrayImage } from '../src/core/contracts/raster.js'
import {
  fabricSkyline,
  fitSkylineLines,
  findRidge,
  analyseSectionRoof,
  DEFAULT_SECTION_ROOF,
} from '../src/core/extract/section-roof.js'
import {
  calloutsAlongLine,
  obliqueCalloutCrop,
  parsePitchText,
  DEFAULT_OBLIQUE_TEXT,
} from '../src/core/extract/oblique-text.js'
import { findSectionAnnotations, DEFAULT_SECTION_ANNOTATIONS } from '../src/core/extract/section-annotations.js'
import { inkChannel } from '../src/core/extract/raster-normalize.js'
import { pitchTextOptions } from '../src/core/extract/section-read.js'
import { TesseractEngine } from '../src/node/ocr/tesseract.js'
import { loadFixture } from './helpers.js'

const paper = (w: number, h: number, v = 255): GrayImage => ({
  width: w,
  height: h,
  data: new Uint8ClampedArray(w * h).fill(v),
})
const box = (g: GrayImage, x0: number, y0: number, x1: number, y1: number, v = 20): void => {
  for (let y = Math.max(0, y0); y <= Math.min(g.height - 1, y1); y++) {
    for (let x = Math.max(0, x0); x <= Math.min(g.width - 1, x1); x++) g.data[y * g.width + x] = v
  }
}
/** A gable: two slopes of `rise` over `run`, apex at `apexX`, drawn solid. */
const gable = (g: GrayImage, apexX: number, apexY: number, halfSpan: number, pitch: number, thickness = 12): void => {
  const t = Math.tan((pitch * Math.PI) / 180)
  for (let x = apexX - halfSpan; x <= apexX + halfSpan; x++) {
    const top = Math.round(apexY + Math.abs(x - apexX) * t)
    box(g, x, top, x, top + thickness)
  }
}

describe('§13 the roof is fitted, not traced', () => {
  it('recovers both pitches and the ridge from a clean gable', () => {
    const g = paper(900, 600)
    gable(g, 450, 80, 350, 35)
    const sky = fabricSkyline(g, 158, 600)
    const edges = fitSkylineLines(sky, g.width)
    const pitched = edges.filter((e) => e.kind === 'PITCHED')
    expect(pitched).toHaveLength(2)
    for (const e of pitched) expect(e.pitchDeg).toBeCloseTo(35, 1)
    const ridge = findRidge(edges, g.width)
    expect(ridge).not.toBeNull()
    expect(ridge!.x).toBeCloseTo(450, 0)
    expect(ridge!.y).toBeCloseTo(80, 0)
  })

  it('is not moved by a chimney standing above the roof', () => {
    const g = paper(900, 600)
    gable(g, 450, 80, 350, 35)
    box(g, 560, 40, 600, 200)
    const roof = analyseSectionRoof(g, 158, 600)
    expect(roof.ridge).not.toBeNull()
    expect(roof.ridge!.y).toBeCloseTo(80, 0)
    for (const e of roof.edges.filter((x) => x.kind === 'PITCHED')) expect(e.pitchDeg).toBeCloseTo(35, 1)
  })

  it('jumps an annotation drawn over the roof rather than ending the plane there', () => {
    const g = paper(900, 600)
    gable(g, 450, 80, 350, 35)
    // A callout's glyphs, sitting above the left slope.
    box(g, 250, 180, 262, 200)
    box(g, 266, 180, 278, 200)
    const roof = analyseSectionRoof(g, 158, 600)
    const left = roof.edges.find((e) => e.slope < -0.1)
    expect(left).toBeDefined()
    expect(left!.fromX).toBeLessThan(150)
    expect(left!.pitchDeg).toBeCloseTo(35, 1)
  })

  it('reports a flat component beside a pitched one', () => {
    const g = paper(1100, 700)
    gable(g, 400, 80, 300, 35)
    box(g, 750, 400, 1050, 412)
    const roof = analyseSectionRoof(g, 158, 700)
    expect(roof.edges.filter((e) => e.kind === 'FLAT')).toHaveLength(1)
    expect(roof.edges.filter((e) => e.kind === 'PITCHED')).toHaveLength(2)
  })

  it('will not call two unrelated diagonals a ridge', () => {
    const g = paper(900, 600)
    // Two slopes that cross far above both of them.
    for (let x = 50; x < 300; x++) box(g, x, 400 - Math.round(x * 0.2), x, 412 - Math.round(x * 0.2))
    for (let x = 600; x < 850; x++) box(g, x, 250 + Math.round((x - 600) * 0.2), x, 262 + Math.round((x - 600) * 0.2))
    const roof = analyseSectionRoof(g, 158, 600)
    expect(roof.ridge).toBeNull()
  })

  it('measures the roof build-up as the run below the fitted top edge', () => {
    const g = paper(900, 600)
    gable(g, 450, 80, 350, 35, 14)
    const roof = analyseSectionRoof(g, 158, 600)
    expect(roof.soffits.length).toBeGreaterThan(0)
    for (const s of roof.soffits) expect(s.thicknessPx).toBeGreaterThanOrEqual(13)
  })
})

describe('§14 a pitch label is an observation, not the pitch', () => {
  it('rejects a reading that is not a pitch', () => {
    expect(parsePitchText('')).toBeNull()
    expect(parsePitchText('°')).toBeNull()
    expect(parsePitchText('120')).toBeNull()
    expect(parsePitchText('0')).toBeNull()
    expect(parsePitchText('40°')).toBe(40)
    expect(parsePitchText('37,5°')).toBe(37.5)
  })

  it('does not take upright text beside a slope for a callout along it', () => {
    const g = paper(900, 600)
    gable(g, 450, 80, 350, 40)
    // Three upright glyphs above the left slope: their offset from a
    // forty-degree line climbs by a glyph height across the run.
    box(g, 200, 120, 212, 141)
    box(g, 216, 120, 228, 141)
    box(g, 232, 120, 244, 141)
    const roof = analyseSectionRoof(g, 158, 600)
    const left = roof.edges.find((e) => e.slope < -0.1)!
    const callouts = calloutsAlongLine(g, left, DEFAULT_SECTION_ANNOTATIONS.regions, DEFAULT_OBLIQUE_TEXT)
    // Each glyph may stand alone, but the three never become one run along
    // the slope, which is what a pitch callout is.
    expect(callouts.every((c) => c.glyphs < 3)).toBe(true)
  })
})

describe('§13, §14 project A, measured', () => {
  it('fits the roof, crosses it at the ridge, and reads the printed pitch', async () => {
    const { pkg, images } = await loadFixture('A-marcowki')
    const section = pkg.assets.find((a) => a.roles?.document === 'SECTION')!
    const gray = inkChannel(images.get(section.id)!)
    const found = findSectionAnnotations(gray)
    // The datum row is 642 on this drawing; the roof search only needs to be
    // kept above the ground line, and the runner passes the solved value.
    const roof = analyseSectionRoof(gray, found.inkThreshold, 642)

    const pitched = roof.edges.filter((e) => e.kind === 'PITCHED')
    expect(pitched).toHaveLength(2)
    for (const e of pitched) expect(e.pitchDeg).toBeGreaterThan(39.5)
    for (const e of pitched) expect(e.pitchDeg).toBeLessThan(40.5)
    expect(roof.edges.filter((e) => e.kind === 'FLAT')).toHaveLength(1)
    expect(roof.ridge).not.toBeNull()
    // 72.546 px/m with the zero at row 641.97 puts this at 7.95 m; the
    // evaluator checks the metre value, this checks the pixel geometry.
    expect(roof.ridge!.y).toBeGreaterThan(64)
    expect(roof.ridge!.y).toBeLessThan(67)

    if (!TesseractEngine.available().available) return
    const engine = new TesseractEngine()
    const readings: string[] = []
    for (const e of pitched) {
      const callouts = calloutsAlongLine(gray, e, DEFAULT_SECTION_ANNOTATIONS.regions, DEFAULT_OBLIQUE_TEXT)
      const crops = callouts.map((c) => {
        const { gray: cg, scale } = obliqueCalloutCrop(gray, c)
        return { id: `${e.id}:${c.id}`, gray: cg, sourceBox: c.box, orientation: 'HORIZONTAL' as const, scale }
      })
      for (const r of engine.readBatch(crops, pitchTextOptions())) {
        const pitch = parsePitchText(r.text)
        if (pitch !== null && r.confidence > 0.5) readings.push(`${pitch}`)
      }
    }
    // The drawing prints 40° once, along the left slope, at forty degrees to
    // the sheet — which is why it is read here and not by the upright finder.
    expect(readings).toContain('40')
  }, 120_000)
})
