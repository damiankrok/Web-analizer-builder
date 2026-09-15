/**
 * STAGE WEB-PIVOT-07 §9-§11 — what a section draws, and the heights it names.
 *
 * The synthetic groups build level markers out of rectangles and lines, so
 * what is under test is the rule and not one publisher's drafting. The last
 * group runs the real thing over project A's section and records the numbers
 * it actually gets.
 */
import { describe, it, expect } from 'vitest'
import type { GrayImage } from '../src/core/contracts/raster.js'
import {
  findSectionAnnotations,
  findShelf,
  findTriangleApex,
  DEFAULT_SECTION_ANNOTATIONS,
} from '../src/core/extract/section-annotations.js'
import { strokeMask } from '../src/core/extract/stroke-lines.js'
import {
  parseLevelText,
  buildDatumObservations,
  solveVerticalScale,
  reconcileRejected,
  hintSemantics,
  type VerticalDatumObservation,
} from '../src/core/extract/vertical-datums.js'
import { inkChannel } from '../src/core/extract/raster-normalize.js'
import { buildTextCrops } from '../src/core/extract/text-crops.js'
import { sectionCropRequests, groupByAnnotation, levelTextOptions } from '../src/core/extract/section-read.js'
import { TesseractEngine } from '../src/node/ocr/tesseract.js'
import { loadFixture } from './helpers.js'

const paper = (w: number, h: number, v = 255): GrayImage => ({
  width: w,
  height: h,
  data: new Uint8ClampedArray(w * h).fill(v),
})
const hline = (g: GrayImage, y: number, x0: number, x1: number, v = 190): void => {
  for (let x = x0; x <= x1; x++) g.data[y * g.width + x] = v
}
const px = (g: GrayImage, x: number, y: number, v = 190): void => {
  if (x >= 0 && y >= 0 && x < g.width && y < g.height) g.data[y * g.width + x] = v
}

/** A level symbol: a shelf, and a triangle whose apex lands on `apexRow`. */
const levelSymbol = (g: GrayImage, shelfRow: number, x0: number, x1: number, apexRow: number): void => {
  hline(g, shelfRow, x0, x1)
  const apexCol = (x0 + x1) / 2
  const rows = apexRow - shelfRow
  for (let i = 1; i < rows; i++) {
    const t = i / rows
    px(g, Math.round(x0 + (apexCol - x0) * t), shelfRow + i)
    px(g, Math.round(x1 - (x1 - apexCol) * t), shelfRow + i)
  }
}

describe('§9 the level symbol is the triangle, not the shelf', () => {
  it('fits the apex below the shelf to sub-pixel', () => {
    const g = paper(200, 200)
    levelSymbol(g, 40, 60, 100, 62)
    const sm = strokeMask(g, 'X', DEFAULT_SECTION_ANNOTATIONS.strokes)
    const shelf = findShelf(g, sm, { x0: 60, y0: 20, x1: 100, y1: 38 }, 18)
    expect(shelf?.row).toBe(40)
    const apex = findTriangleApex(g, shelf!, 18)
    expect(apex?.method).toBe('TRIANGLE_APEX')
    // Twenty-two rows of convergence, so the crossing is known far better than
    // the pixel grid the sides were sampled on.
    expect(apex!.row).toBeGreaterThan(60)
    expect(apex!.row).toBeLessThan(64)
  })

  it('does not call two parallel hairlines a level symbol', () => {
    const g = paper(200, 200)
    hline(g, 40, 60, 100)
    for (let i = 1; i < 20; i++) {
      px(g, 70, 40 + i)
      px(g, 90, 40 + i)
    }
    const sm = strokeMask(g, 'X', DEFAULT_SECTION_ANNOTATIONS.strokes)
    const shelf = findShelf(g, sm, { x0: 60, y0: 20, x1: 100, y1: 38 }, 18)
    expect(findTriangleApex(g, shelf!, 18)).toBeNull()
  })
})

describe('§10 a figure is a string until something checks it', () => {
  it('reads a printed separator', () => {
    expect(parseLevelText('+3,06').some((p) => Math.abs(p.valueM - 3.06) < 1e-9 && p.signRead)).toBe(true)
    expect(parseLevelText('-0,32').some((p) => Math.abs(p.valueM + 0.32) < 1e-9)).toBe(true)
  })

  it('takes the last two digits as the fraction when the separator is lost', () => {
    expect(parseLevelText('+467').some((p) => Math.abs(p.valueM - 4.67) < 1e-9)).toBe(true)
  })

  it('offers both readings rather than choosing, where the string is short', () => {
    const vs = parseLevelText('95').map((p) => p.valueM)
    expect(vs).toContain(95)
    expect(vs).toContain(0.95)
  })

  it('offers a trimmed reading for a stray trailing character', () => {
    expect(parseLevelText('+4,67,').some((p) => Math.abs(p.valueM - 4.67) < 1e-9)).toBe(true)
  })

  it('returns nothing rather than a guess for a string with no digits', () => {
    expect(parseLevelText('+-')).toEqual([])
    expect(parseLevelText('')).toEqual([])
  })
})

/** Markers at known rows, with the readings a recogniser might have returned. */
const synthetic = (
  rows: ReadonlyArray<{ id: string; row: number; texts: string[] }>,
): VerticalDatumObservation[] =>
  buildDatumObservations(
    'asset_test',
    rows.map((r) => ({
      id: r.id,
      kind: 'LEVEL_MARKER' as const,
      box: { x0: 0, y0: r.row - 20, x1: 40, y1: r.row - 2 },
      orientation: 'HORIZONTAL' as const,
      textHeightPx: 18,
      level: { row: r.row, columnPx: 20, method: 'TRIANGLE_APEX' as const, fittedRows: 8, residualPx: 0.2, how: 'synthetic' },
      shelf: null,
      span: null,
      obliqueDeg: null,
      why: 'synthetic',
    })),
    (id) => {
      const row = rows.find((r) => r.id === id)
      return (row?.texts ?? []).map((t, i) => ({
        reading: { cropId: `${id}#${i}`, text: t, confidence: 0.9, boxInCrop: null, engineId: 'test' },
        conditioning: `pad ${i}`,
      }))
    },
  )

describe('§11 one OCR reading does not outvote the drawing', () => {
  // 70 px per metre, zero at row 700.
  const truth = [
    { id: 'a', row: 700, texts: ['+0,00'] },
    { id: 'b', row: 700 - 3.0 * 70, texts: ['+3,00'] },
    { id: 'c', row: 700 - 4.6 * 70, texts: ['+4,60'] },
    { id: 'd', row: 700 + 0.3 * 70, texts: ['-0,30'] },
  ]

  it('solves one scale and one zero from markers that agree', () => {
    const obs = synthetic(truth)
    const sol = solveVerticalScale(obs, undefined, 900)
    expect(sol).not.toBeNull()
    expect(sol!.pixelsPerMetre).toBeCloseTo(70, 3)
    expect(sol!.datumRow).toBeCloseTo(700, 3)
    expect(sol!.inlierIds).toHaveLength(4)
    expect(sol!.pairSpread).toBeLessThan(1e-6)
  })

  it('rejects a single contradicting reading instead of averaging it in', () => {
    const obs = synthetic([...truth, { id: 'bad', row: 700 - 7.0 * 70, texts: ['+1,95'] }])
    const sol = solveVerticalScale(obs, undefined, 900)
    expect(sol!.pixelsPerMetre).toBeCloseTo(70, 3)
    expect(sol!.rejected.map((r) => r.id)).toContain('bad')
    expect(obs.find((o) => o.id === 'bad')!.status).toBe('REJECTED')
  })

  it('reconciles a one-character misreading against the solved scale, and says so', () => {
    const obs = synthetic([...truth, { id: 'ridge', row: 700 - 7.0 * 70, texts: ['+1,00'] }])
    const sol = solveVerticalScale(obs, undefined, 900)
    expect(reconcileRejected(obs, sol!)).toBe(1)
    const ridge = obs.find((o) => o.id === 'ridge')!
    expect(ridge.status).toBe('RECONCILED')
    expect(ridge.parsedLevelM).toBeCloseTo(7.0, 6)
    // Never promoted to a reading that was actually made.
    expect(ridge.confidence).toBeLessThan(0.8)
  })

  it('will not reconcile a reading two characters from the prediction', () => {
    const obs = synthetic([...truth, { id: 'ridge', row: 700 - 7.0 * 70, texts: ['+1,95'] }])
    const sol = solveVerticalScale(obs, undefined, 900)
    expect(reconcileRejected(obs, sol!)).toBe(0)
    expect(obs.find((o) => o.id === 'ridge')!.status).toBe('REJECTED')
  })

  it('refuses a solution when too few markers agree', () => {
    expect(solveVerticalScale(synthetic([truth[0], truth[1]]), undefined, 900)).toBeNull()
  })

  it('rejects a scale that would make the sheet an implausible height', () => {
    const obs = synthetic([
      { id: 'a', row: 700, texts: ['+0,00'] },
      { id: 'b', row: 699, texts: ['+3,00'] },
      { id: 'c', row: 698, texts: ['+4,60'] },
    ])
    expect(solveVerticalScale(obs, undefined, 900)).toBeNull()
  })

  it('hints semantics from ordering and marks nothing else', () => {
    const obs = synthetic(truth)
    solveVerticalScale(obs, undefined, 900)
    hintSemantics(obs)
    expect(obs.find((o) => o.id === 'a')!.semanticHint).toBe('GROUND_ZERO')
    expect(obs.find((o) => o.id === 'd')!.semanticHint).toBe('TERRAIN')
    expect(obs.find((o) => o.id === 'c')!.semanticHint).toBe('RIDGE')
  })
})

describe('§9-§11 project A, measured', () => {
  it('recovers every printed level on the section and agrees with itself', async () => {
    const { pkg, images } = await loadFixture('A-marcowki')
    const section = pkg.assets.find((a) => a.roles?.document === 'SECTION')
    expect(section).toBeDefined()
    const gray = inkChannel(images.get(section!.id)!)
    const found = findSectionAnnotations(gray)
    const markers = found.annotations.filter((a) => a.kind === 'LEVEL_MARKER')
    expect(markers.length).toBe(5)

    const engine = new TesseractEngine()
    if (!TesseractEngine.available().available) return
    const crops = buildTextCrops(gray, sectionCropRequests(markers))
    const grouped = groupByAnnotation(engine.readBatch(crops, levelTextOptions()))
    const obs = buildDatumObservations(section!.id, markers, (id) => grouped.get(id) ?? [])
    const sol = solveVerticalScale(obs, undefined, gray.height)
    expect(sol).not.toBeNull()

    // The five printed levels, recovered without any of them being given.
    const values = obs
      .filter((o) => o.parsedLevelM !== null)
      .map((o) => o.parsedLevelM as number)
      .sort((a, b) => a - b)
    expect(values).toEqual([-0.32, 0, 3.06, 4.67, 7.95])
    // 72.549 px/m is what the hand measurement of this drawing gives; the
    // evaluator checks that separately, and this is a regression floor.
    expect(sol!.pixelsPerMetre).toBeGreaterThan(72.3)
    expect(sol!.pixelsPerMetre).toBeLessThan(72.8)
    expect(sol!.rmsResidualM).toBeLessThan(0.01)
    expect(sol!.pairSpread).toBeLessThan(0.02)
  }, 120_000)
})
