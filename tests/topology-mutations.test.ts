/**
 * STAGE WEB-PIVOT-06A §18 — twelve things done to a drawing on purpose, and
 * the measurement that has to notice each of them.
 *
 * A test that only shows the pipeline agreeing with itself on the drawing it
 * was built against shows very little. What these do is take a drawing that
 * reads correctly, break one thing in it, and require the *right* oracle to
 * change — and, just as important, require the others not to. A mutation that
 * every metric notices is not evidence that any of them measures what it
 * claims to.
 *
 * Every drawing is built pixel by pixel. Nothing here is cropped from a
 * published sheet, so what is under test is the rule.
 */
import { describe, it, expect } from 'vitest'
import type { GrayImage } from '../src/core/contracts/raster.js'
import { detectWallBands, DEFAULT_WALL_BANDS, solidThreshold } from '../src/core/extract/wall-bands.js'
import { buildPlanModel, type PlanModel } from '../src/core/extract/plan-model.js'
import { detectDoorSymbols, inkLayers, type DoorObservation } from '../src/core/extract/door-symbols.js'
import { alignLabelledPlan, findRoomLabels } from '../src/core/extract/room-labels.js'
import { separatorsOf } from '../src/core/extract/room-topology.js'
import { buildSpecCandidate } from '../src/core/extract/spec-candidate.js'
import { evaluateCandidate, type Gold } from './candidate-evaluator.js'

const PX_PER_CM = 1
const INK = 10
const TINT = 170
const PAPER = 250

const paper = (w: number, h: number): GrayImage => ({
  width: w,
  height: h,
  data: new Uint8ClampedArray(w * h).fill(PAPER),
})
const fill = (g: GrayImage, x0: number, y0: number, w: number, h: number, v: number): void => {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      if (x >= 0 && y >= 0 && x < g.width && y < g.height) g.data[y * g.width + x] = v
    }
  }
}
const stroke = (g: GrayImage, x0: number, y0: number, x1: number, y1: number): void => {
  const steps = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0)) * 2)
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    fill(g, Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), 2, 2, INK)
  }
}
const arcInk = (g: GrayImage, cx: number, cy: number, r: number, from: number, to: number): void => {
  for (let a = from; a <= to; a += 0.4) {
    const rad = (a * Math.PI) / 180
    fill(g, Math.round(cx + r * Math.cos(rad)), Math.round(cy + r * Math.sin(rad)), 2, 2, INK)
  }
}

/**
 * The drawing everything below is a mutation of.
 *
 * A shell, a cross wall, and a partition dividing what is north of it, with a
 * door hung in the partition. The partition's two stubs are 0.15 m each, so
 * neither survives the shortest run that can be claimed as a wall: the door is
 * the only thing that says the partition is there.
 */
type Build = {
  partitionPx?: number
  partitionThickness?: number
  southThickness?: number
  openingPx?: number
  leaf?: boolean
  swing?: boolean
  fillDoorway?: boolean
  furnitureArc?: boolean
  mirrored?: boolean
}

function plan(opts: Build = {}): GrayImage {
  const {
    partitionPx = 110,
    partitionThickness = 6,
    southThickness = 6,
    openingPx = 80,
    leaf = true,
    swing = true,
    fillDoorway = false,
    furnitureArc = false,
    mirrored = false,
  } = opts
  const g = paper(400, 500)
  fill(g, 40, 40, 320, 12, INK)
  fill(g, 40, 448, 320, 12, INK)
  fill(g, 40, 40, 12, 420, INK)
  fill(g, 348, 40, 12, 420, INK)
  fill(g, 52, 52, 296, 396, TINT)
  const crossY = 52 + partitionPx
  fill(g, 52, crossY, 296, 11, INK)
  const at = 200
  const from = 52 + Math.round((partitionPx - openingPx) / 2)
  const to = from + openingPx - 1
  fill(g, at, 52, partitionThickness, from - 52, INK)
  fill(g, at, to + 1, southThickness, crossY - to - 1, INK)
  if (fillDoorway) fill(g, at, from, partitionThickness, openingPx, INK)
  if (swing) arcInk(g, at + 3, from, openingPx, 90, 180)
  if (leaf) stroke(g, at + 3, from, at + 3 - openingPx, from)
  // A round table in the big southern room: an arc of a door's radius, drawn
  // where nothing is hung in anything.
  if (furnitureArc) {
    arcInk(g, 180, 320, 80, 0, 359)
    stroke(g, 180, 320, 260, 320)
  }
  if (!mirrored) return g
  const m = paper(g.width, g.height)
  for (let y = 0; y < g.height; y++) {
    for (let x = 0; x < g.width; x++) m.data[y * m.width + (m.width - 1 - x)] = g.data[y * g.width + x]
  }
  return m
}

const doorsOn = (g: GrayImage): DoorObservation[] =>
  detectDoorSymbols(g, PX_PER_CM, 'a', DEFAULT_WALL_BANDS.solidFraction).doors

/** The door on the partition, whichever side of the sheet it is on. */
const partitionDoor = (g: GrayImage, mirrored = false): DoorObservation | undefined => {
  const at = mirrored ? 400 - 1 - 202 : 202.5
  return doorsOn(g).find((d) => d.axis === 'Y' && Math.abs(d.atPx - at) <= 5)
}

const modelOn = (g: GrayImage, doors?: readonly DoorObservation[]): PlanModel =>
  buildPlanModel(g, detectWallBands(g, PX_PER_CM).bands, PX_PER_CM, undefined, doors ?? doorsOn(g))

/** The reading of the unmutated drawing, which every case is measured against. */
const baseline = (): { model: PlanModel; door: DoorObservation } => {
  const g = plan()
  const door = partitionDoor(g)!
  return { model: modelOn(g), door }
}

describe('§18 the mutations, and the oracle each of them has to move', () => {
  it('reads the unmutated drawing correctly, so the cases below have something to break', () => {
    const { model, door } = baseline()
    expect(door.classification).toBe('SINGLE_HINGED')
    expect(door.arc).not.toBeNull()
    expect(door.leaf).not.toBeNull()
    expect(model.rooms).toHaveLength(3)
    expect(model.runs.flatMap((r) => r.openings).filter((o) => o.class === 'DOOR')).toHaveLength(1)
  })

  it('1. the swing arc removed, the leaf kept: the door is still read, and says its arc is gone', () => {
    const door = partitionDoor(plan({ swing: false }))
    expect(door).toBeDefined()
    expect(door!.arc).toBeNull()
    expect(door!.leaf).not.toBeNull()
    expect(door!.classification).toBe('LEAF_ONLY')
    expect(door!.evidence.join(' ')).toMatch(/no swing/i)
    // Weaker evidence has to read as weaker.
    expect(door!.confidence).toBeLessThan(baseline().door.confidence)
  })

  it('2. the leaf removed, the arc kept: the door is still read, and says its leaf is gone', () => {
    const door = partitionDoor(plan({ leaf: false }))
    expect(door).toBeDefined()
    expect(door!.arc).not.toBeNull()
    expect(door!.leaf).toBeNull()
    expect(door!.evidence.join(' ')).toMatch(/no leaf/i)
    expect(door!.confidence).toBeLessThan(baseline().door.confidence)
  })

  it('3. a furniture arc added: it is not a door, and the doors that are there are unchanged', () => {
    const before = doorsOn(plan())
    const after = doorsOn(plan({ furnitureArc: true }))
    // Nothing is hung in anything at the table, so nothing is claimed there.
    expect(after.some((d) => Math.hypot(d.hingePx.x - 180, d.hingePx.y - 320) < 90)).toBe(false)
    expect(after).toHaveLength(before.length)
  })

  it('4. one wall piece beside the door broken away: the door still makes a host, with less material in it', () => {
    const g = plan()
    // The southern stub erased: the drawing now shows the door hung on one
    // jamb only, which is a defect in the drawing and not in the reading.
    fill(g, 200, 132, 6, 30, PAPER)
    const door = partitionDoor(g)
    expect(door).toBeDefined()
    const model = modelOn(g, [door!])
    const made = model.placements.find((p) => p.doorId === door!.id)
    expect(made?.outcome).toBe('MADE')
    const host = model.runs.find((r) => r.id === made?.hostWallId)!
    const solidPx = host.solid.reduce((n, p) => n + (p.toPx - p.fromPx + 1), 0)
    const whole = baseline().model.runs
      .filter((r) => r.axis === 'Y' && Math.abs(r.centrePx - 202.5) <= 5)
      .reduce((n, r) => n + r.solid.reduce((m, p) => m + (p.toPx - p.fromPx + 1), 0), 0)
    expect(solidPx).toBeLessThan(whole)
  })

  it('5. the gap widened past any door: no door is read there', () => {
    expect(partitionDoor(plan({ openingPx: 190 }))).toBeUndefined()
  })

  it('6. the wall thickened on one side of the doorway only: the two sides are not one wall', () => {
    // §9's compatible-thickness test. A 0.06 m partition meeting a 0.30 m one
    // across a gap is two walls facing each other, not one with a hole in it.
    const door = partitionDoor(plan({ partitionThickness: 6, southThickness: 30 }))
    expect(door).toBeUndefined()
  })

  it('7. the door turned into an open passage: the two spaces become one, and the barrier lets them', () => {
    const withDoor = modelOn(plan({ partitionPx: 260 }))
    const asPassage = modelOn(plan({ partitionPx: 260, openingPx: 190, swing: false, leaf: false }))
    expect(withDoor.rooms).toHaveLength(3)
    expect(asPassage.rooms).toHaveLength(2)
    const passage = asPassage.runs
      .flatMap((r) => r.openings)
      .find((o) => o.class === 'OPEN_PASSAGE')
    expect(passage).toBeDefined()
    expect(
      asPassage.separators.some((s) => s.fromPx >= passage!.fromPx && s.toPx <= passage!.toPx && s.kind !== 'FABRIC'),
    ).toBe(false)
  })

  it('8. the separator removed while the opening stays: the rooms merge, and the count says so', () => {
    // Done to the barrier rather than to the drawing, because that is what the
    // mutation is: the same openings, and nothing standing in the doorway.
    const g = plan()
    const model = modelOn(g)
    const withoutDoors = modelOn(g, [])
    expect(model.rooms).toHaveLength(3)
    expect(withoutDoors.rooms).toHaveLength(2)
    expect(separatorsOf(model.runs).some((s) => s.kind === 'DOOR')).toBe(true)
    expect(separatorsOf(withoutDoors.runs).some((s) => s.kind === 'DOOR')).toBe(false)
  })

  it('9. the doorway filled in with wall: no door is read, and no room is divided by one', () => {
    const g = plan({ fillDoorway: true })
    expect(partitionDoor(g)).toBeUndefined()
    const model = modelOn(g)
    expect(model.runs.flatMap((r) => r.openings).filter((o) => o.class === 'DOOR')).toHaveLength(0)
  })

  it('10. a room label moved across the doorway: the unresolved question moves with it', () => {
    const labelled = (positions: Array<{ x: number; y: number }>): GrayImage => {
      const g = plan()
      // The labelled copy has no chains and no door symbol drawn on it; what
      // it has instead is the names.
      const clean = plan({ swing: false, leaf: false })
      for (const q of positions) {
        for (let i = 0; i < 8; i++) fill(clean, q.x + i * 5, q.y, 3, 7, INK)
        for (let i = 0; i < 6; i++) fill(clean, q.x + i * 5, q.y + 11, 3, 7, INK)
      }
      void g
      return clean
    }
    const readWith = (positions: Array<{ x: number; y: number }>): PlanModel => {
      const dimensioned = plan()
      const withLabels = labelled(positions)
      const solid = solidThreshold(dimensioned, DEFAULT_WALL_BANDS.solidFraction)
      const a = inkLayers(dimensioned, solid)
      const b = inkLayers(withLabels, solid)
      const alignment = alignLabelledPlan(a.fabric, b.fabric, dimensioned.width, dimensioned.height)
      const found = findRoomLabels(withLabels, a.ink, solid, alignment, PX_PER_CM)
      return buildPlanModel(
        dimensioned,
        detectWallBands(dimensioned, PX_PER_CM).bands,
        PX_PER_CM,
        undefined,
        doorsOn(dimensioned),
        undefined,
        found,
      )
    }
    // Two labels in the big southern room: one region carrying two names.
    const together = readWith([
      { x: 100, y: 300 },
      { x: 220, y: 300 },
    ])
    const crowded = together.rooms.filter((r) => r.labels.length > 1)
    expect(crowded).toHaveLength(1)

    // One of them moved across the partition into the north-west space: now
    // each region carries one name and there is nothing unresolved.
    const apart = readWith([
      { x: 100, y: 300 },
      { x: 100, y: 90 },
    ])
    expect(apart.rooms.filter((r) => r.labels.length > 1)).toHaveLength(0)
  })

  it('11. the whole plan mirrored: the same building, read the same way, the other way round', () => {
    const straight = modelOn(plan())
    const mirrored = modelOn(plan({ mirrored: true }))
    expect(mirrored.rooms).toHaveLength(straight.rooms.length)
    const door = partitionDoor(plan({ mirrored: true }), true)
    const original = partitionDoor(plan())!
    expect(door).toBeDefined()
    expect(door!.widthM).toBeCloseTo(original.widthM, 2)
    // The door is on the other side of the sheet, and the same distance from
    // the edge it is now near.
    expect(Math.round(door!.atPx + original.atPx)).toBeCloseTo(399, -0.5)
    // And it swings the other way.
    expect(door!.swingSide).toBe(-original.swingSide)
  })

  it('12. the gold fixture altered and nothing else: the evaluation moves and the reading does not', () => {
    const g = plan()
    const model = modelOn(g)
    const candidate = buildSpecCandidate({
      project: 'test',
      sourcePackageId: 'pkg',
      sourcePackageHash: 'hash',
      engine: { id: 'e', version: '0' },
      storeys: [{ storey: 'GROUND', assetId: 'a', pxPerCm: PX_PER_CM, model, observations: [] }],
    })
    const gold = (wallToM: number): Gold => ({
      walls: [
        { id: 'w_part', level: 'g', axis: 'Z', atM: 0.0, thicknessM: 0.06, fromM: 0, toM: wallToM, kind: 'PARTITION' },
      ],
      openings: [],
      rooms: [],
    })
    const before = evaluateCandidate(candidate, gold(1.1), 'g', 'GROUND')
    const after = evaluateCandidate(candidate, gold(3.0), 'g', 'GROUND')
    // The gold moved, so the score moved.
    expect(after.decomposition.goldLengthM).toBeGreaterThan(before.decomposition.goldLengthM)
    expect(after.walls.coverage).not.toBe(before.walls.coverage)
    // The candidate did not: the same drawing, read the same way, whatever the
    // gold says about it.
    const again = modelOn(g)
    expect(JSON.stringify(again.runs)).toBe(JSON.stringify(model.runs))
    expect(again.rooms.length).toBe(model.rooms.length)
  })
})
