/**
 * STAGE WEB-PIVOT-06 §11-§17, §19-§21 — walls, rooms, the candidate, and what
 * the candidate is worth against the hand gold.
 *
 * The synthetic groups build a little building out of rectangles, so that what
 * is under test is the rule rather than one publisher's drawing. The last
 * group runs the real pipeline over project A and measures it — and records
 * the numbers it actually gets, floors rather than aspirations, so a
 * regression is caught without the suite pretending the stage met a target it
 * did not.
 */
import { existsSync, readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import type { GrayImage } from '../src/core/contracts/raster.js'
import { detectWallBands, solidThreshold, DEFAULT_WALL_BANDS } from '../src/core/extract/wall-bands.js'
import { buildPlanModel, mergeWallRuns, DEFAULT_PLAN_MODEL } from '../src/core/extract/plan-model.js'
import { buildSpecCandidate } from '../src/core/extract/spec-candidate.js'
import { TesseractEngine } from '../src/node/ocr/tesseract.js'
import { extractPlanSpec, DEFAULT_EXTRACTION } from '../src/node/extract-runner.js'
import { evaluateCandidate, type Gold } from './candidate-evaluator.js'
import { loadFixture } from './helpers.js'

/** One pixel per centimetre keeps every figure in these tests readable. */
const PX_PER_CM = 1

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
const WALL = 10
const TINT = 150

/** A room 200 x 150 cm inside 20 cm walls, with a 90 cm door in the south. */
function oneRoom(doorWidth = 90): GrayImage {
  const g = paper(300, 260)
  fill(g, 40, 40, 220, 20, WALL) // north
  fill(g, 40, 190, 220, 20, WALL) // south
  fill(g, 40, 40, 20, 170, WALL) // west
  fill(g, 240, 40, 20, 170, WALL) // east
  fill(g, 60, 60, 180, 130, TINT) // the room is tinted, as published plans are
  if (doorWidth > 0) fill(g, 120, 190, doorWidth, 20, TINT) // a hole in the south wall
  return g
}

describe('§11 a wall is a band, not a dark line', () => {
  it('finds four walls with their two faces and a plausible thickness', () => {
    const { bands } = detectWallBands(oneRoom(0), PX_PER_CM)
    expect(bands.filter((b) => b.axis === 'X')).toHaveLength(2)
    expect(bands.filter((b) => b.axis === 'Y')).toHaveLength(2)
    for (const b of bands) {
      expect(b.thicknessPx).toBeGreaterThanOrEqual(19)
      expect(b.thicknessPx).toBeLessThanOrEqual(22)
    }
  })

  it('does not mistake a tint for fabric', () => {
    // The room's fill is a tint. A threshold that took it would return one
    // enormous band covering the whole room.
    const g = oneRoom(0)
    const solid = solidThreshold(g, DEFAULT_WALL_BANDS.solidFraction)
    expect(solid).toBeLessThan(TINT)
    expect(solid).toBeGreaterThan(WALL)
    const { bands } = detectWallBands(g, PX_PER_CM)
    expect(bands.every((b) => b.thicknessPx < 30)).toBe(true)
  })

  it('claims nothing without a scale, because thickness is a claim in metres', () => {
    const { bands, notes } = detectWallBands(oneRoom(0), null)
    expect(bands).toEqual([])
    expect(notes.join(' ')).toMatch(/no scale/)
  })

  it('ignores a hairline and a blob alike', () => {
    const g = paper(400, 300)
    fill(g, 20, 150, 360, 1, WALL) // a dimension line: no thickness
    fill(g, 20, 20, 160, 110, WALL) // a solid 1.1 m thick: no building has one
    const { bands } = detectWallBands(g, PX_PER_CM)
    expect(bands).toHaveLength(0)
  })
})

describe('§12, §21 a doorway is an opening, never wall', () => {
  it('joins the two pieces of a wall and records what is between them', () => {
    const { bands } = detectWallBands(oneRoom(90), PX_PER_CM)
    const runs = mergeWallRuns(bands, PX_PER_CM)
    const south = runs.find((r) => r.axis === 'X' && r.nearPx > 180)!
    expect(south).toBeDefined()
    expect(south.openings).toHaveLength(1)
    expect(south.openings[0].lengthPx).toBeGreaterThan(80)
    expect(south.openings[0].lengthPx).toBeLessThan(100)
    expect(south.openings[0].kind).toBe('DOORWAY')
    // ...and the opening is not counted as wall.
    const solid = south.solid.reduce((n, s) => n + (s.toPx - s.fromPx), 0)
    expect(solid).toBeLessThan(south.toPx - south.fromPx - 80)
  })

  it('calls a wide gap wide, rather than calling it a door', () => {
    // A 1.6 m bay in a wall long enough to leave real fabric either side.
    const g = paper(500, 260)
    fill(g, 40, 40, 420, 20, WALL)
    fill(g, 40, 190, 420, 20, WALL)
    fill(g, 40, 40, 20, 170, WALL)
    fill(g, 440, 40, 20, 170, WALL)
    fill(g, 60, 60, 380, 130, TINT)
    fill(g, 180, 190, 160, 20, TINT)
    const runs = mergeWallRuns(detectWallBands(g, PX_PER_CM).bands, PX_PER_CM)
    const south = runs.find((r) => r.axis === 'X' && r.nearPx > 180)!
    expect(south.openings).toHaveLength(1)
    expect(south.openings[0].kind).toBe('WIDE')
  })

  it('reports faces, and offers a centre line as a derived extra (§12)', () => {
    const runs = mergeWallRuns(detectWallBands(oneRoom(0), PX_PER_CM).bands, PX_PER_CM)
    for (const r of runs) {
      expect(r.farPx).toBeGreaterThan(r.nearPx)
      expect(r.centrePx).toBeCloseTo((r.nearPx + r.farPx) / 2, 6)
    }
  })
})

describe('§13 rooms are a partition of the space, so they cannot overlap', () => {
  it('encloses a room and does not leak through its door', () => {
    const model = buildPlanModel(oneRoom(90), detectWallBands(oneRoom(90), PX_PER_CM).bands, PX_PER_CM)
    expect(model.rooms).toHaveLength(1)
    // The enclosed space is 180 x 130 cm between the wall faces.
    const area = model.rooms[0].areaPx / (100 * PX_PER_CM) ** 2
    expect(area).toBeGreaterThan(2.2)
    expect(area).toBeLessThan(2.5)
  })

  it('gives every pixel at most one room, by construction', () => {
    const g = oneRoom(90)
    const model = buildPlanModel(g, detectWallBands(g, PX_PER_CM).bands, PX_PER_CM)
    const counts = new Map<number, number>()
    for (const label of model.labels) counts.set(label, (counts.get(label) ?? 0) + 1)
    // A label array *is* the proof: a pixel holds one number. What has to be
    // checked is that every room's area is exactly its label's pixel count,
    // so no room was assembled from anywhere else.
    for (const room of model.rooms) {
      const index = Number(room.id.slice(2))
      expect(counts.get(index)).toBe(room.areaPx)
    }
  })

  it('separates two rooms across a partition, and joins them through its door', () => {
    const g = paper(420, 260)
    fill(g, 40, 40, 340, 20, WALL)
    fill(g, 40, 190, 340, 20, WALL)
    fill(g, 40, 40, 20, 170, WALL)
    fill(g, 360, 40, 20, 170, WALL)
    fill(g, 200, 60, 12, 130, WALL) // a partition down the middle
    fill(g, 200, 100, 12, 80, TINT) // with an 80 cm doorway in it
    const model = buildPlanModel(g, detectWallBands(g, PX_PER_CM).bands, PX_PER_CM)
    expect(model.rooms).toHaveLength(2)
    expect(model.adjacency).toHaveLength(1)
    expect(model.adjacency[0].openings.length).toBeGreaterThan(0)
    expect(model.adjacency[0].openings[0].kind).toBe('DOORWAY')
  })

  it('does not call the space around the building a room', () => {
    const g = oneRoom(0)
    const model = buildPlanModel(g, detectWallBands(g, PX_PER_CM).bands, PX_PER_CM)
    expect(model.rooms.every((r) => !r.touchesEdge)).toBe(true)
  })
})

describe('§17 a candidate says it is a candidate', () => {
  const emptyModel = {
    runs: [],
    rooms: [],
    adjacency: [],
    doors: [],
    placements: [],
    roomLabels: [],
    separators: [],
    labels: new Int32Array(0),
    width: 0,
    height: 0,
    notes: [],
  }

  it('is labelled, provenanced and not canonical', () => {
    const g = oneRoom(90)
    const model = buildPlanModel(g, detectWallBands(g, PX_PER_CM).bands, PX_PER_CM)
    const candidate = buildSpecCandidate({
      project: 'test',
      sourcePackageId: 'pkg_test',
      sourcePackageHash: 'hash',
      engine: { id: 'test', version: '0' },
      storeys: [{ storey: 'GROUND', assetId: 'asset_test', pxPerCm: PX_PER_CM, model, observations: [] }],
    })
    expect(candidate.kind).toBe('CANDIDATE')
    expect(candidate.notCanonical).toBe(true)
    for (const w of candidate.storeys[0].walls) {
      expect(w.provenance.assetId).toBe('asset_test')
      expect(w.provenance.from.length).toBeGreaterThan(0)
      expect(w.confidence).toBeGreaterThan(0)
      expect(w.confidence).toBeLessThan(1)
      // §21 again, in the DTO: a solid length never includes an opening.
      const span = Math.abs(w.toM - w.fromM)
      const openings = w.openings.reduce((n, o) => n + o.widthM, 0)
      expect(w.solidM).toBeLessThanOrEqual(span + 1e-6)
      if (openings > 0) expect(w.solidM).toBeLessThan(span)
    }
  })

  it('reports no metres at all when no scale was established', () => {
    const candidate = buildSpecCandidate({
      project: 'test',
      sourcePackageId: 'pkg_test',
      sourcePackageHash: 'hash',
      engine: { id: 'test', version: '0' },
      storeys: [{ storey: 'GROUND', assetId: 'a', pxPerCm: null, model: emptyModel, observations: [] }],
    })
    expect(candidate.frame).toBeNull()
    expect(candidate.storeys[0].walls).toEqual([])
    expect(candidate.notes.join(' ')).toMatch(/nothing is reported in metres/)
  })

  /**
   * §2 — a void on two storeys is two observations.
   *
   * The brief forbids another manual stage that forces a shaft to be
   * continuous. What an automatic reading may say is that it saw two voids in
   * the same place on two drawings and cannot tell whether they are one.
   */
  it('leaves vertical continuity unresolved rather than asserting a route', () => {
    const g = paper(200, 200)
    fill(g, 40, 40, 120, 12, WALL)
    fill(g, 40, 148, 120, 12, WALL)
    fill(g, 40, 40, 12, 120, WALL)
    fill(g, 148, 40, 12, 120, WALL)
    fill(g, 52, 52, 96, 96, TINT)
    const model = buildPlanModel(g, detectWallBands(g, PX_PER_CM).bands, PX_PER_CM)
    const candidate = buildSpecCandidate(
      {
        project: 'test',
        sourcePackageId: 'pkg_test',
        sourcePackageHash: 'hash',
        engine: { id: 'test', version: '0' },
        storeys: [
          { storey: 'GROUND', assetId: 'a', pxPerCm: PX_PER_CM, model, observations: [] },
          { storey: 'UPPER_ATTIC', assetId: 'b', pxPerCm: PX_PER_CM, model, observations: [] },
        ],
      },
      { shaftMaxAreaM2: 5, shaftOverlap: 0.4 },
    )
    expect(candidate.conflicts.length).toBeGreaterThan(0)
    const conflict = candidate.conflicts[0]
    expect(conflict.kind).toBe('VERTICAL_CONTINUITY_UNRESOLVED')
    expect(conflict.observations).toHaveLength(2)
    expect(conflict.unresolved).toMatch(/no route is asserted/)
    expect(conflict.confidence).toBeLessThan(1)
  })
})

/**
 * §19-§21 — what the extraction is actually worth on project A.
 *
 * These are floors, set below what the run currently achieves, not the stage's
 * targets. The stage report states the measured figures and says plainly which
 * targets they do and do not meet; the suite's job is to stop a regression,
 * not to launder a PARTIAL into a PASS.
 */
describe('§21 project A, measured against the hand gold', () => {
  const availability = TesseractEngine.available()
  const run = availability.available && existsSync('fixtures/A-marcowki/assets') ? it : it.skip

  run('reads walls, rooms and doors well enough not to have regressed', async () => {
    const gold = JSON.parse(readFileSync('research/gold/marcowki-interior-v1.json', 'utf8')) as Gold
    const { pkg, images } = await loadFixture('A-marcowki')
    const result = extractPlanSpec(pkg, images, { ...DEFAULT_EXTRACTION, engine: new TesseractEngine() })

    for (const [storey, level] of [
      ['GROUND', 'ground'],
      ['UPPER_ATTIC', 'upper'],
    ] as const) {
      const e = evaluateCandidate(result.candidate, gold, level, storey)

      // The alignment is fitted, so a large residual would mean the candidate
      // and the gold are not describing the same building.
      expect(Math.abs(e.alignment.dx)).toBeLessThan(1)

      expect(e.walls.coverage).toBeGreaterThan(0.6)
      // §14's wall target: the *logical* host wall — its material plus the
      // openings it accounts for — against the gold's whole length.
      expect(e.decomposition.logicalCoverage, `${storey} logical wall`).toBeGreaterThanOrEqual(0.9)
      // And the counterpart that stops it being reached by filling openings
      // in: not one source-open passage is closed by candidate material.
      expect(e.invented.closed, `${storey} closed openings: ${e.invented.closedIds.join(', ')}`).toBe(0)
      expect(e.invented.totalM).toBeLessThan(1)
      // Every gold door is either found or explicitly unresolved; none is
      // silently lost.
      expect(e.doors.rate).toBe(1)
      expect(e.doors.rows.every((r) => r.why.length > 0)).toBe(true)
      // §14's door target: read *as a door*, on the wall the gold names.
      expect(e.doors.asDoorRate, `${storey} doors read as DOOR`).toBeGreaterThanOrEqual(0.9)
      expect(e.doors.hostRate, `${storey} doors on the right host`).toBeGreaterThanOrEqual(0.9)
      // §14's room targets.
      expect(e.adjacency.rate, `${storey} adjacency`).toBeGreaterThanOrEqual(0.9)
      expect(e.rooms.goldCovered, `${storey} gold rooms covered`).toBe(e.rooms.goldRooms)
      expect(
        e.rooms.merged <= 1 || e.rooms.mergedUnresolved === e.rooms.merged,
        `${storey}: ${e.rooms.merged} merged regions, ${e.rooms.mergedUnresolved} marked unresolved`,
      ).toBe(true)
      // Every gold adjacency edge is accounted for as agreed, merged or
      // missing — the categories have to add up.
      expect(e.adjacency.agreed + e.adjacency.merged + e.adjacency.missing).toBe(e.adjacency.goldEdges)
    }
  }, 240_000)
})
