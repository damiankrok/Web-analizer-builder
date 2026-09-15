/**
 * STAGE WEB-PIVOT-06A §3, §8-§12 — three truths about a doorway, kept apart.
 *
 * The drawings are built pixel by pixel, so what is under test is the rule and
 * not one publisher's line weight. Each case is the smallest drawing that can
 * tell one reading from another.
 */
import { describe, it, expect } from 'vitest'
import type { GrayImage } from '../src/core/contracts/raster.js'
import { detectWallBands, DEFAULT_WALL_BANDS, solidThreshold } from '../src/core/extract/wall-bands.js'
import { buildPlanModel, mergeWallRuns, type WallRun } from '../src/core/extract/plan-model.js'
import {
  classifyOpenings,
  closeAtCrossings,
  placeDoors,
  separatorsOf,
  DEFAULT_TOPOLOGY,
} from '../src/core/extract/room-topology.js'
import {
  detectDoorSymbols,
  inkLayers,
  DEFAULT_DOOR_SYMBOLS,
  type DoorObservation,
} from '../src/core/extract/door-symbols.js'
import { alignLabelledPlan, findRoomLabels } from '../src/core/extract/room-labels.js'
import { buildSpecCandidate } from '../src/core/extract/spec-candidate.js'

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
const stroke = (g: GrayImage, x0: number, y0: number, x1: number, y1: number, v = INK): void => {
  const steps = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0)) * 2)
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    fill(g, Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), 2, 2, v)
  }
}
const arc = (g: GrayImage, cx: number, cy: number, r: number, from: number, to: number): void => {
  for (let a = from; a <= to; a += 0.4) {
    const rad = (a * Math.PI) / 180
    fill(g, Math.round(cx + r * Math.cos(rad)), Math.round(cy + r * Math.sin(rad)), 2, 2, INK)
  }
}

/**
 * Three spaces: a shell, a cross wall, and a partition dividing what is north
 * of it, with a hole in the partition.
 *
 * The partition runs the whole way between the shell and the cross wall, so it
 * is the only thing dividing the two northern spaces — which is what makes the
 * question "does the extraction find this wall" answerable by counting rooms.
 * At `partitionPx` 110 with an 80 px hole the two stubs are 0.15 m each, which
 * is below the shortest run that can be claimed as a wall, so nothing of the
 * partition survives unless a door says it is there.
 */
function twoRooms(
  opts: { partitionPx?: number; door?: boolean; openingPx?: number } = {},
): GrayImage {
  const { partitionPx = 110, door = true, openingPx = 80 } = opts
  const g = paper(400, 500)
  fill(g, 40, 40, 320, 12, INK)
  fill(g, 40, 448, 320, 12, INK)
  fill(g, 40, 40, 12, 420, INK)
  fill(g, 348, 40, 12, 420, INK)
  fill(g, 52, 52, 296, 396, TINT)
  // The cross wall, which is what the partition runs down to.
  const crossY = 52 + partitionPx
  fill(g, 52, crossY, 296, 11, INK)
  // The partition, with its hole centred in it.
  const at = 200
  const from = 52 + Math.round((partitionPx - openingPx) / 2)
  const to = from + openingPx - 1
  fill(g, at, 52, 6, from - 52, INK)
  fill(g, at, to + 1, 6, crossY - to - 1, INK)
  if (door) {
    arc(g, at + 3, from, openingPx, 90, 180)
    stroke(g, at + 3, from, at + 3 - openingPx, from)
  }
  return g
}

const modelOf = (g: GrayImage, doors: readonly DoorObservation[] = []): ReturnType<typeof buildPlanModel> =>
  buildPlanModel(g, detectWallBands(g, PX_PER_CM).bands, PX_PER_CM, undefined, doors)

const doorsOf = (g: GrayImage): DoorObservation[] =>
  detectDoorSymbols(g, PX_PER_CM, 'a', DEFAULT_WALL_BANDS.solidFraction).doors.filter(
    (d) => d.axis === 'Y' && Math.abs(d.atPx - 202.5) <= 4,
  )

describe('§9 a door makes the host wall the bands could not', () => {
  it('leaves the two spaces as one when the stubs are too short and no door is drawn', () => {
    const g = twoRooms({ partitionPx: 110, door: false })
    const model = modelOf(g)
    // The big space south of the cross wall, and the two northern ones as one.
    expect(model.rooms).toHaveLength(2)
  })

  it('divides them when a door is drawn in the same hole, and the wall it makes is its two stubs', () => {
    const g = twoRooms({ partitionPx: 110, door: true })
    const doors = doorsOf(g)
    expect(doors).toHaveLength(1)
    const model = modelOf(g, doors)
    expect(model.rooms).toHaveLength(3)
    const made = model.placements.find((p) => p.doorId === doors[0].id)
    expect(made?.outcome).toBe('MADE')
    const host = model.runs.find((r) => r.id === made?.hostWallId)!
    // The material is the two stubs, followed into the walls they run into —
    // material the raster shows, and a small fraction of the host's length.
    const solidPx = host.solid.reduce((n, p) => n + (p.toPx - p.fromPx + 1), 0)
    expect(solidPx).toBeGreaterThan(20)
    expect(solidPx).toBeLessThan(host.toPx - host.fromPx + 1)
    // And the doorway is an opening on it, never material.
    const door = host.openings.find((o) => o.class === 'DOOR')!
    expect(door).toBeDefined()
    expect(host.solid.some((p) => p.fromPx <= door.fromPx && p.toPx >= door.toPx)).toBe(false)
  })

  it('joins two collinear walls that stop either side of one doorway into one wall', () => {
    const g = twoRooms({ partitionPx: 260, door: true })
    const doors = doorsOf(g)
    const bands = detectWallBands(g, PX_PER_CM).bands
    const runs = mergeWallRuns(bands, PX_PER_CM)
    const layers = inkLayers(g, solidThreshold(g, DEFAULT_WALL_BANDS.solidFraction))
    // Pulled apart first, so the merge has something to do.
    const split: WallRun[] = runs.flatMap((r) =>
      r.axis === 'Y' && Math.abs(r.centrePx - 202.5) <= 4
        ? r.solid.map((p, i) => ({ ...r, id: `${r.id}-${i}`, fromPx: p.fromPx, toPx: p.toPx, solid: [p], openings: [] }))
        : [r],
    )
    expect(split.filter((r) => r.id.includes('-')).length).toBe(2)
    const placed = placeDoors(split, doors, layers.fabric, g.width, g.height, PX_PER_CM)
    expect(placed.placements[0].outcome).toBe('MERGED')
    const host = placed.runs.find((r) => r.id === placed.placements[0].hostWallId)!
    expect(host.solid).toHaveLength(2)
    expect(host.openings.filter((o) => o.class === 'DOOR')).toHaveLength(1)
  })

  it('adds no material anywhere: every piece of wall it reports is material the raster has', () => {
    // §3.2 as a property rather than as a number. A door may create a host
    // wall and an opening; it may not create a square centimetre of fabric.
    const g = twoRooms({ partitionPx: 110, door: true })
    const model = modelOf(g, doorsOf(g))
    const layers = inkLayers(g, solidThreshold(g, DEFAULT_WALL_BANDS.solidFraction))
    for (const run of model.runs) {
      for (const piece of run.solid) {
        let material = 0
        let samples = 0
        for (let a = Math.ceil(piece.fromPx); a <= Math.floor(piece.toPx); a++) {
          samples++
          const x = run.axis === 'X' ? a : Math.round(run.centrePx)
          const y = run.axis === 'X' ? Math.round(run.centrePx) : a
          if (layers.fabric[y * g.width + x] === 1) material++
        }
        if (samples === 0) continue
        expect(material / samples, `${run.id} ${piece.fromPx}..${piece.toPx}`).toBeGreaterThan(0.8)
      }
    }
  })
})

describe('§8 an opening is only what the drawing says it is', () => {
  it('starts every opening unexplained', () => {
    const g = twoRooms({ partitionPx: 260, door: false })
    const runs = mergeWallRuns(detectWallBands(g, PX_PER_CM).bands, PX_PER_CM)
    for (const r of runs) for (const o of r.openings) expect(o.class).toBe('UNKNOWN_GAP')
  })

  it('leaves a door-width hole with nothing drawn in it unexplained, rather than calling it a door', () => {
    const g = twoRooms({ partitionPx: 260, door: false })
    const model = modelOf(g)
    const partition = model.runs.find((r) => r.axis === 'Y' && Math.abs(r.centrePx - 202.5) <= 4)!
    expect(partition.openings.map((o) => o.class)).not.toContain('DOOR')
    expect(partition.openings.some((o) => o.class === 'UNKNOWN_GAP')).toBe(true)
  })

  it('calls an opening onto the space around the building an exterior opening', () => {
    const g = twoRooms({ partitionPx: 260, door: false })
    // A hole in the shell's south wall.
    fill(g, 150, 448, 90, 12, PAPER)
    const model = modelOf(g)
    const south = model.runs.find((r) => r.axis === 'X' && r.centrePx > 440)!
    expect(south).toBeDefined()
    expect(south.openings.some((o) => o.class === 'EXTERIOR_OPENING')).toBe(true)
  })

  it('calls a stretch wider than any door between two interior spaces a passage, and joins them', () => {
    const g = twoRooms({ partitionPx: 260, door: false, openingPx: 190 })
    const model = modelOf(g)
    const partition = model.runs.find((r) => r.axis === 'Y' && Math.abs(r.centrePx - 202.5) <= 4)
    expect(partition?.openings.some((o) => o.class === 'OPEN_PASSAGE')).toBe(true)
    // §11: the two spaces are one space, and no wall is invented to split them.
    expect(model.rooms).toHaveLength(2)
  })
})

describe('§10 the barrier is made of material and of separators that are not material', () => {
  it('puts a separator in a doorway, and says a door put it there', () => {
    const g = twoRooms({ partitionPx: 110, door: true })
    const model = modelOf(g, doorsOf(g))
    const door = model.separators.find((s) => s.kind === 'DOOR')
    expect(door).toBeDefined()
    expect(door!.why).toMatch(/not material/i)
  })

  it('puts none in an open passage, which is why the two spaces stay one', () => {
    const g = twoRooms({ partitionPx: 260, door: false, openingPx: 190 })
    const model = modelOf(g)
    const partition = model.runs.find((r) => r.axis === 'Y' && Math.abs(r.centrePx - 202.5) <= 4)
    const passage = partition?.openings.find((o) => o.class === 'OPEN_PASSAGE')
    expect(passage).toBeDefined()
    const across = model.separators.filter(
      (s) => s.wallRunId === partition!.id && s.fromPx >= passage!.fromPx && s.toPx <= passage!.toPx,
    )
    expect(across).toHaveLength(0)
  })

  it('leaves no unpainted pixel along a wall, whatever its openings are made of', () => {
    const g = twoRooms({ partitionPx: 110, door: true })
    const model = modelOf(g, doorsOf(g))
    for (const run of model.runs) {
      const painted = new Set<number>()
      for (const s of model.separators.filter((x) => x.wallRunId === run.id)) {
        for (let a = Math.floor(s.fromPx); a <= Math.ceil(s.toPx); a++) painted.add(a)
      }
      const passages = run.openings.filter((o) => o.class === 'OPEN_PASSAGE' || o.carried === true)
      for (let a = Math.floor(run.fromPx); a <= Math.ceil(run.toPx); a++) {
        if (passages.some((o) => a >= o.fromPx && a <= o.toPx)) continue
        expect(painted.has(a), `${run.id} at ${a}`).toBe(true)
      }
    }
  })

  it('marks an adjacency that rests on an unexplained gap as unresolved', () => {
    const g = twoRooms({ partitionPx: 260, door: false })
    const model = modelOf(g)
    expect(model.rooms.length).toBeGreaterThanOrEqual(2)
    const edge = model.adjacency.find((a) => a.openings.some((o) => o.class === 'UNKNOWN_GAP'))!
    expect(edge).toBeDefined()
    expect(edge.unresolved).toBe(true)
    expect(edge.why).toMatch(/nothing says/i)
  })

  it('does not mark one that rests on a door', () => {
    const g = twoRooms({ partitionPx: 260, door: true })
    const model = modelOf(g, doorsOf(g))
    const edge = model.adjacency.find((a) => a.openings.some((o) => o.class === 'DOOR'))!
    expect(edge).toBeDefined()
    expect(edge.unresolved).toBe(false)
  })
})

describe('a wall line carries on to the wall it runs into', () => {
  it('closes a boundary the material leaves open, without inventing any', () => {
    const g = paper(400, 400)
    fill(g, 40, 40, 320, 12, INK)
    fill(g, 40, 40, 12, 320, INK)
    fill(g, 348, 40, 12, 320, INK)
    // The south wall stops two thirds of the way across: the rest is a
    // garage-front-sized hole between its end and the east wall.
    fill(g, 40, 348, 180, 12, INK)
    const layers = inkLayers(g, solidThreshold(g, DEFAULT_WALL_BANDS.solidFraction))
    const runs = mergeWallRuns(detectWallBands(g, PX_PER_CM).bands, PX_PER_CM)
    const carried = closeAtCrossings(runs, layers.fabric, g.width, g.height, PX_PER_CM)
    expect(carried.closed).toBeGreaterThan(0)
    const south = carried.runs.find((r) => r.axis === 'X' && r.centrePx > 340)!
    expect(south.toPx).toBeGreaterThan(330)
    const gap = south.openings.find((o) => o.carried === true)
    expect(gap).toBeDefined()
    // What was carried is an opening, not wall.
    expect(south.solid.some((p) => p.fromPx <= gap!.fromPx && p.toPx >= gap!.toPx)).toBe(false)
  })

  it('does not carry the line of a band thicker than it is long', () => {
    // A chunk of wall read along the wrong axis: carrying its line would draw
    // a boundary the width of the wall through the middle of a room.
    const run: WallRun = {
      id: 'wr0',
      axis: 'Y',
      fromPx: 190,
      toPx: 209,
      nearPx: 40,
      farPx: 119,
      thicknessPx: 80,
      solid: [{ fromPx: 190, toPx: 209 }],
      openings: [],
      centrePx: 79.5,
    }
    const fabric = new Uint8Array(400 * 400).fill(1)
    const carried = closeAtCrossings([run], fabric, 400, 400, PX_PER_CM)
    expect(carried.closed).toBe(0)
    expect(carried.runs[0]).toBe(run)
  })
})

describe('§11 and §12 a label is evidence about names, never about walls', () => {
  /** The same drawing twice: chains on one copy, room labels on the other. */
  const pair = (labels: Array<{ x: number; y: number }>): { dimensioned: GrayImage; labelled: GrayImage } => {
    const base = (): GrayImage => {
      const g = paper(400, 400)
      fill(g, 40, 40, 320, 12, INK)
      fill(g, 40, 348, 320, 12, INK)
      fill(g, 40, 40, 12, 320, INK)
      fill(g, 348, 40, 12, 320, INK)
      fill(g, 52, 52, 296, 296, TINT)
      return g
    }
    const dimensioned = base()
    // A chain in the margin, which the labelled copy does not have.
    fill(dimensioned, 60, 20, 200, 2, INK)
    const labelled = base()
    for (const l of labels) {
      // A block of small strokes: a name and an area, as a publisher prints it.
      for (let i = 0; i < 8; i++) fill(labelled, l.x + i * 5, l.y, 3, 7, INK)
      for (let i = 0; i < 6; i++) fill(labelled, l.x + i * 5, l.y + 11, 3, 7, INK)
    }
    return { dimensioned, labelled }
  }

  it('finds the shift between the two copies from the building, not from the annotation', () => {
    const { dimensioned, labelled } = pair([{ x: 150, y: 150 }])
    const solid = solidThreshold(dimensioned, DEFAULT_WALL_BANDS.solidFraction)
    const a = inkLayers(dimensioned, solid)
    const b = inkLayers(labelled, solid)
    const alignment = alignLabelledPlan(a.fabric, b.fabric, 400, 400)
    expect(alignment.aligned).toBe(true)
    expect(alignment.dx).toBe(0)
    expect(alignment.dy).toBe(0)
    expect(alignment.agreement).toBeGreaterThan(0.95)
  })

  it('reads each printed block as one label, and none of the drawing as a label', () => {
    const { dimensioned, labelled } = pair([
      { x: 120, y: 150 },
      { x: 240, y: 150 },
    ])
    const solid = solidThreshold(dimensioned, DEFAULT_WALL_BANDS.solidFraction)
    const a = inkLayers(dimensioned, solid)
    const b = inkLayers(labelled, solid)
    const alignment = alignLabelledPlan(a.fabric, b.fabric, 400, 400)
    const found = findRoomLabels(labelled, a.ink, solid, alignment, PX_PER_CM)
    expect(found).toHaveLength(2)
    expect(found.map((f) => Math.round(f.centre.x)).sort((x, y) => x - y)[0]).toBeGreaterThan(110)
  })

  it('records a region carrying two labels as unresolved rather than dividing it', () => {
    const { dimensioned, labelled } = pair([
      { x: 120, y: 150 },
      { x: 240, y: 150 },
    ])
    const solid = solidThreshold(dimensioned, DEFAULT_WALL_BANDS.solidFraction)
    const a = inkLayers(dimensioned, solid)
    const b = inkLayers(labelled, solid)
    const alignment = alignLabelledPlan(a.fabric, b.fabric, 400, 400)
    const found = findRoomLabels(labelled, a.ink, solid, alignment, PX_PER_CM)
    const model = buildPlanModel(
      dimensioned,
      detectWallBands(dimensioned, PX_PER_CM).bands,
      PX_PER_CM,
      undefined,
      [],
      undefined,
      found,
    )
    expect(model.rooms).toHaveLength(1)
    expect(model.rooms[0].labels).toHaveLength(2)
    const candidate = buildSpecCandidate({
      project: 'test',
      sourcePackageId: 'pkg',
      sourcePackageHash: 'hash',
      engine: { id: 'e', version: '0' },
      storeys: [{ storey: 'GROUND', assetId: 'a', pxPerCm: PX_PER_CM, model, observations: [] }],
    })
    expect(candidate.storeys[0].rooms[0].segmentation).toBe('UNRESOLVED')
    const conflict = candidate.conflicts.find((c) => c.kind === 'OPEN_PLAN_SEGMENTATION_UNRESOLVED')
    expect(conflict).toBeDefined()
    expect(conflict!.unresolved).toMatch(/no source shows|does not/i)
    // And nothing was divided: one region, as the drawing has it.
    expect(candidate.storeys[0].rooms).toHaveLength(1)
  })

  it('claims no label evidence when the two copies cannot be placed over each other', () => {
    const { dimensioned, labelled } = pair([{ x: 120, y: 150 }])
    const solid = solidThreshold(dimensioned, DEFAULT_WALL_BANDS.solidFraction)
    const a = inkLayers(dimensioned, solid)
    const scrambled = inkLayers(paper(400, 400), solid)
    const alignment = alignLabelledPlan(a.fabric, scrambled.fabric, 400, 400)
    expect(alignment.aligned).toBe(false)
    expect(findRoomLabels(labelled, a.ink, solid, alignment, PX_PER_CM)).toHaveLength(0)
  })
})

describe('the classifier reads in one direction only', () => {
  it('never moves an opening back to unexplained once something has explained it', () => {
    const g = twoRooms({ partitionPx: 260, door: true })
    const layers = inkLayers(g, solidThreshold(g, DEFAULT_WALL_BANDS.solidFraction))
    const runs = mergeWallRuns(detectWallBands(g, PX_PER_CM).bands, PX_PER_CM)
    const placed = placeDoors(runs, doorsOf(g), layers.fabric, g.width, g.height, PX_PER_CM)
    const before = placed.runs.flatMap((r) => r.openings).filter((o) => o.class === 'DOOR').length
    expect(before).toBeGreaterThan(0)
    const classified = classifyOpenings(placed.runs, () => false, PX_PER_CM, DEFAULT_TOPOLOGY)
    expect(classified.runs.flatMap((r) => r.openings).filter((o) => o.class === 'DOOR').length).toBe(before)
  })

  it('gives every opening a reason, whatever it decided', () => {
    const g = twoRooms({ partitionPx: 260, door: true })
    const model = modelOf(g, doorsOf(g))
    for (const run of model.runs) {
      for (const o of run.openings) expect(o.why.length, `${run.id} ${o.class}`).toBeGreaterThan(10)
    }
    expect(separatorsOf(model.runs).every((s) => s.why.length > 10)).toBe(true)
  })
})
