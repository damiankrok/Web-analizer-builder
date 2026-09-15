/**
 * STAGE WEB-PIVOT-06A §4-§8 — the door detector, on drawings built pixel by
 * pixel.
 *
 * Every case here is drawn rather than cropped from a published sheet, so what
 * is being tested is the rule and not one publisher's line weight. The
 * drawings are deliberately plain: a wall with a hole in it, and whatever
 * symbol the case is about drawn into the hole.
 */
import { describe, it, expect } from 'vitest'
import type { GrayImage } from '../src/core/contracts/raster.js'
import {
  detectDoorSymbols,
  wallLineGaps,
  inkLayers,
  DEFAULT_DOOR_SYMBOLS,
  type DoorObservation,
} from '../src/core/extract/door-symbols.js'
import { solidThreshold, DEFAULT_WALL_BANDS } from '../src/core/extract/wall-bands.js'

/** One pixel is one centimetre, so a metre is a hundred pixels. */
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

/** A drawn line, two pixels wide, the way a plan draws its annotation. */
const stroke = (g: GrayImage, x0: number, y0: number, x1: number, y1: number, v = INK): void => {
  const steps = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0)) * 2)
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    fill(g, Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), 2, 2, v)
  }
}

const arc = (
  g: GrayImage,
  cx: number,
  cy: number,
  r: number,
  fromDeg: number,
  toDeg: number,
  v = INK,
): void => {
  for (let a = fromDeg; a <= toDeg; a += 0.4) {
    const rad = (a * Math.PI) / 180
    fill(g, Math.round(cx + r * Math.cos(rad)), Math.round(cy + r * Math.sin(rad)), 2, 2, v)
  }
}

/**
 * Two rooms, one wall between them running down the sheet, and a hole in it.
 *
 * The hinge is the top jamb, the leaf is drawn open to the left, and the swing
 * runs from the closed position round to the leaf. The wall carries on well
 * past both ends of the hole, which is what makes the hole a doorway.
 */
function partitionWithDoor(
  opts: { leaf?: boolean; swing?: boolean; openingPx?: number; blocked?: boolean } = {},
): GrayImage {
  const { leaf = true, swing = true, openingPx = 80, blocked = false } = opts
  const g = paper(400, 400)
  // The enclosing shell, so there are two spaces and not one.
  fill(g, 40, 40, 320, 12, INK)
  fill(g, 40, 348, 320, 12, INK)
  fill(g, 40, 40, 12, 320, INK)
  fill(g, 348, 40, 12, 320, INK)
  fill(g, 52, 52, 296, 296, TINT)
  // The partition, with its hole.
  const at = 200
  const from = 150
  const to = from + openingPx - 1
  fill(g, at, 52, 6, from - 52, INK)
  fill(g, at, to + 1, 6, 348 - to - 1, INK)
  if (blocked) fill(g, at, from, 6, openingPx, INK)
  const hinge = { x: at + 3, y: from }
  if (swing) arc(g, hinge.x, hinge.y, openingPx, 90, 180)
  if (leaf) stroke(g, hinge.x, hinge.y, hinge.x - openingPx, hinge.y)
  return g
}

const doorsOf = (g: GrayImage, opts = DEFAULT_DOOR_SYMBOLS): DoorObservation[] =>
  detectDoorSymbols(g, PX_PER_CM, 'asset', DEFAULT_WALL_BANDS.solidFraction, opts).doors

/** The door the case is about: the one on the partition, if it was found. */
const onPartition = (doors: readonly DoorObservation[]): DoorObservation | undefined =>
  doors.find((d) => d.axis === 'Y' && Math.abs(d.atPx - 202.5) <= 4)

describe('the line work is separated from the fabric', () => {
  it('keeps a drawn stroke and drops the wall it is drawn beside', () => {
    const g = partitionWithDoor()
    const layers = inkLayers(g, solidThreshold(g, DEFAULT_WALL_BANDS.solidFraction))
    // A point in the middle of the partition is fabric and not line work.
    const wall = 300 * g.width + 202
    expect(layers.fabric[wall]).toBe(1)
    expect(layers.thin[wall]).toBe(0)
    // A point on the leaf is line work and not fabric.
    const onLeaf = 150 * g.width + 160
    expect(layers.thin[onLeaf]).toBe(1)
    expect(layers.fabric[onLeaf]).toBe(0)
  })
})

describe('interruptions in a wall line', () => {
  it('finds the hole a doorway leaves, at pixel resolution', () => {
    const g = partitionWithDoor({ leaf: false, swing: false })
    const layers = inkLayers(g, solidThreshold(g, DEFAULT_WALL_BANDS.solidFraction))
    const gaps = wallLineGaps(layers.fabric, g.width, g.height, {
      minWallPx: 5,
      maxWallPx: 80,
      minGapPx: 50,
      maxGapPx: 160,
      collinearPx: 2,
    })
    const mine = gaps.filter((x) => x.axis === 'Y' && Math.abs(x.atPx - 202.5) <= 3)
    expect(mine.length).toBeGreaterThan(0)
    expect(mine[0].fromPx).toBe(150)
    expect(mine[0].toPx).toBe(229)
  })

  it('finds the hole even where the wall either side is far too short to be claimed', () => {
    // §4's case: a 0.8 m door in a 1.1 m partition leaves 0.15 m stubs, and a
    // detector that needs wall *bands* sees no wall and therefore no doorway.
    const g = paper(400, 400)
    fill(g, 40, 40, 320, 12, INK)
    fill(g, 40, 348, 320, 12, INK)
    fill(g, 40, 40, 12, 320, INK)
    fill(g, 348, 40, 12, 320, INK)
    fill(g, 52, 52, 296, 296, TINT)
    // A partition 1.10 m long with an 0.80 m hole in it: two 0.15 m stubs.
    fill(g, 200, 150, 6, 15, INK)
    fill(g, 200, 245, 6, 15, INK)
    const layers = inkLayers(g, solidThreshold(g, DEFAULT_WALL_BANDS.solidFraction))
    const gaps = wallLineGaps(layers.fabric, g.width, g.height, {
      minWallPx: 5,
      maxWallPx: 80,
      minGapPx: 50,
      maxGapPx: 160,
      collinearPx: 2,
    })
    // The stubs also leave the line interrupted between each of them and the
    // shell, and those are interruptions too; what matters is that the hole
    // between the two stubs is one of them.
    const mine = gaps.filter((x) => x.axis === 'Y' && Math.abs(x.atPx - 202.5) <= 3)
    expect(mine.some((x) => x.fromPx === 165 && x.toPx === 244)).toBe(true)
  })
})

describe('a door is read from its symbol', () => {
  it('reads a leaf and a swing as one hinged door, with the opening the jambs leave', () => {
    const door = onPartition(doorsOf(partitionWithDoor()))
    expect(door).toBeDefined()
    expect(door!.classification).toBe('SINGLE_HINGED')
    expect(door!.arc).not.toBeNull()
    expect(door!.leaf).not.toBeNull()
    expect(door!.widthM).toBeCloseTo(0.8, 1)
    // The opening is what the jambs leave, to within the pixel or two the
    // leaf's own ink adds where it meets the wall.
    expect(Math.abs(door!.fromPx - 150)).toBeLessThanOrEqual(3)
    expect(Math.abs(door!.toPx - 229)).toBeLessThanOrEqual(3)
  })

  it('returns a centre, a radius, a span, a residual and a confidence for the swing', () => {
    const door = onPartition(doorsOf(partitionWithDoor()))!
    expect(Math.abs(door.arc!.radiusPx - 80)).toBeLessThan(8)
    expect(door.arc!.spanDeg).toBeGreaterThan(60)
    expect(door.arc!.residualPx).toBeLessThan(2)
    expect(door.arc!.coverage).toBeGreaterThan(0.8)
    expect(door.arc!.confidence).toBeGreaterThan(0.5)
    expect(Math.abs(door.arc!.centrePx.y - 150)).toBeLessThanOrEqual(3)
  })

  it('still reads a door when the publisher drew no swing, and says the swing is missing', () => {
    const door = onPartition(doorsOf(partitionWithDoor({ swing: false })))
    expect(door).toBeDefined()
    expect(door!.arc).toBeNull()
    expect(door!.leaf).not.toBeNull()
    expect(door!.classification).toBe('LEAF_ONLY')
    expect(door!.evidence.join(' ')).toMatch(/no swing/i)
    // Weaker evidence has to read as weaker.
    expect(door!.confidence).toBeLessThan(onPartition(doorsOf(partitionWithDoor()))!.confidence)
  })

  it('still reads a door when the publisher drew no leaf, and says the leaf is missing', () => {
    const door = onPartition(doorsOf(partitionWithDoor({ leaf: false })))
    expect(door).toBeDefined()
    expect(door!.arc).not.toBeNull()
    expect(door!.leaf).toBeNull()
    expect(door!.evidence.join(' ')).toMatch(/no leaf/i)
  })

  it('reads the width from the jambs rather than from the swing', () => {
    for (const openingPx of [60, 80, 100]) {
      const door = onPartition(doorsOf(partitionWithDoor({ openingPx })))
      expect(door, `opening ${openingPx}`).toBeDefined()
      expect(Math.abs(door!.widthM - openingPx / 100), `opening ${openingPx}`).toBeLessThan(0.05)
    }
  })
})

describe('what is not a door', () => {
  it('does not read a swing drawn in open space as a door', () => {
    // §5: a furniture arc or a curved annotation is not a door swing. Nothing
    // is hung in anything here, and a garden table is exactly this drawing.
    const g = paper(400, 400)
    fill(g, 40, 40, 320, 12, INK)
    fill(g, 40, 348, 320, 12, INK)
    fill(g, 40, 40, 12, 320, INK)
    fill(g, 348, 40, 12, 320, INK)
    fill(g, 52, 52, 296, 296, TINT)
    arc(g, 200, 150, 80, 90, 180)
    stroke(g, 200, 150, 120, 150)
    expect(onPartition(doorsOf(g))).toBeUndefined()
  })

  it('does not read a doorway that has been filled in with wall', () => {
    // §18's case: the symbol is still drawn, but nothing opens through it.
    const door = onPartition(doorsOf(partitionWithDoor({ blocked: true })))
    expect(door).toBeUndefined()
  })

  it('does not read a gap wider than any door as a door', () => {
    const door = onPartition(doorsOf(partitionWithDoor({ openingPx: 240 })))
    expect(door).toBeUndefined()
  })

  it('does not read a swing whose floor is full of material', () => {
    // A stair tread, a run of joinery: a leaf does not turn through it.
    const g = partitionWithDoor()
    fill(g, 120, 170, 70, 8, INK)
    fill(g, 120, 190, 70, 8, INK)
    fill(g, 120, 210, 70, 8, INK)
    const door = onPartition(doorsOf(g))
    expect(door?.arc ?? null).toBeNull()
  })

  it('claims nothing at all without a scale, because a radius is not a width', () => {
    const found = detectDoorSymbols(
      partitionWithDoor(),
      null,
      'asset',
      DEFAULT_WALL_BANDS.solidFraction,
    )
    expect(found.doors).toHaveLength(0)
    expect(found.notes.join(' ')).toMatch(/no scale/i)
  })
})

describe('the detector is a function of the drawing', () => {
  it('reads the same drawing the same way twice', () => {
    const g = partitionWithDoor()
    const a = JSON.stringify(doorsOf(g))
    const b = JSON.stringify(doorsOf(g))
    expect(a).toBe(b)
  })

  it('reads the same door when the drawing is moved on its sheet', () => {
    const g = partitionWithDoor()
    const moved = paper(g.width + 40, g.height + 40)
    for (let y = 0; y < g.height; y++) {
      for (let x = 0; x < g.width; x++) {
        moved.data[(y + 17) * moved.width + (x + 23)] = g.data[y * g.width + x]
      }
    }
    const here = onPartition(doorsOf(g))!
    const there = doorsOf(moved).find((d) => d.axis === 'Y' && Math.abs(d.atPx - 225.5) <= 4)
    expect(there).toBeDefined()
    expect(there!.widthM).toBeCloseTo(here.widthM, 2)
    expect(there!.fromPx - here.fromPx).toBe(17)
  })
})
