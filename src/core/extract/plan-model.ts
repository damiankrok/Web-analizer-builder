/**
 * From bands of ink to a floor plan — STAGE WEB-PIVOT-06 §11-§16.
 *
 * Three things happen here, and the order is the order the evidence allows.
 *
 * **Runs.** A wall on a drawing is broken wherever something crosses it or a
 * door opens through it, so the bands found in the raster are pieces. Pieces
 * that share a line and a thickness are one wall, and what separates them is
 * kept — those stretches are the doorways and passages, not missing wall. §21
 * forbids inventing wall to close a source-open passage, so the solid parts
 * and the openings are reported separately and never merged into one length.
 *
 * **Rooms.** A room is what is enclosed, and it is found by flooding the space
 * between the walls rather than by assembling rectangles. The flood is stopped
 * by a wall's *line*, doorways included, because a doorway is a hole in the
 * fabric and not a hole in the boundary — a flood that leaks through every
 * door produces one room per storey, which is what a naive mask gives. Rooms
 * are therefore disjoint by construction, which is what §13 asks for: a
 * pixel belongs to one region or to none.
 *
 * **Adjacency.** Two rooms are neighbours when one wall separates them, and
 * that is read off the wall itself by looking at what lies on either side of
 * it. Reading it from the wall rather than from the rooms' outlines is what
 * makes "these two rooms share this wall" a statement about the drawing.
 *
 * Nothing here reads a label. §14 is explicit that labels may not redefine
 * walls, and the way to guarantee it is for the geometry not to know they
 * exist.
 *
 * PORT_DIRECT (Kotlin).
 */
import type { GrayImage } from '../contracts/raster.js'
import { solidThreshold, DEFAULT_WALL_BANDS, type WallBand } from './wall-bands.js'
import { inkLayers, DEFAULT_DOOR_SYMBOLS, type DoorObservation } from './door-symbols.js'
import type { RoomLabel } from './room-labels.js'
import {
  classifyOpenings,
  closeAtCrossings,
  placeDoors,
  separatorsOf,
  paintSeparators,
  DEFAULT_TOPOLOGY,
  type DoorPlacement,
  type Separator,
  type TopologyOptions,
} from './room-topology.js'

export type PlanModelOptions = {
  /** Faces this close are the same line, pixels. */
  faceTolerancePx: number
  /**
   * Longest stretch of no material still treated as an opening in one wall
   * rather than as the end of it.
   *
   * Generous, because a glazed rear elevation is a single opening several
   * metres wide and splitting the wall there leaves the storey open to the
   * outside — every room then floods into the garden and none is found. What
   * keeps this honest is that an opening is never counted as wall: a run's
   * solid pieces and its openings are reported separately, so bridging a gap
   * to bound a room cannot inflate a wall length (§21).
   */
  maxOpeningM: number
  /** An opening at most this wide is a doorway; wider is a bay or a passage. */
  doorwayM: number
  /** Smallest region kept as a room, square metres. */
  minRoomAreaM2: number
  /** Ink level that counts as fabric rather than tint; see wall-bands. */
  solidFraction: number
  /**
   * How far a wall may be carried to reach a wall it plainly meets, metres.
   *
   * Walls meet. Where two do, the junction is a blob of ink belonging to
   * neither, so each is found stopping a little short of the other, and the
   * corner is left with a hole the size of a wall's thickness — through which
   * a room drains into the garden. Carrying a run to the line of the wall it
   * runs into closes that without inventing anything: the destination is
   * another wall the drawing already shows, and whether the carried stretch
   * counts as fabric is read from the drawing rather than assumed.
   */
  maxJunctionReachM: number
}

export const DEFAULT_PLAN_MODEL: PlanModelOptions = {
  faceTolerancePx: 2.5,
  maxOpeningM: 5,
  doorwayM: 1.4,
  minRoomAreaM2: 0.8,
  solidFraction: DEFAULT_WALL_BANDS.solidFraction,
  maxJunctionReachM: 1.2,
}

/**
 * What an opening in a wall line has been made of.
 *
 * `DOOR` is a stretch a door symbol was actually found across (§8): a swing
 * arc, a leaf, or both, hinged on this wall. `OPEN_PASSAGE` is a stretch the
 * drawing shows as open between two interior spaces with no door drawn in it.
 * `EXTERIOR_OPENING` is an opening in a wall with outside on one side.
 * `UNKNOWN_GAP` is the honest default: material stops here and nothing in the
 * drawing says why.
 *
 * §8 is explicit that not every gap becomes a DOOR and that insufficient
 * evidence must stay unresolved, so `UNKNOWN_GAP` is what an opening is until
 * evidence moves it, and never the other way round.
 */
export type OpeningClass = 'DOOR' | 'OPEN_PASSAGE' | 'EXTERIOR_OPENING' | 'UNKNOWN_GAP'

/** A stretch of one wall line with no material in it. */
export type WallOpening = {
  fromPx: number
  toPx: number
  lengthPx: number
  /**
   * `DOORWAY` where a door could hang, `WIDE` for anything larger — a glazed
   * bay, a garage front, an opening between two spaces. The distinction is a
   * width, not a claim about what is in it.
   */
  kind: 'DOORWAY' | 'WIDE'
  /** What the drawing says is in it; see `OpeningClass`. */
  class: OpeningClass
  /** The door observation that classified it, when one did. */
  doorId?: string
  /** 0..1 in the classification, not in the geometry. */
  classConfidence: number
  /** Why it was classified the way it was. */
  why: string
  /**
   * True where this opening is not a gap in the material at all but the
   * stretch between a wall's end and the wall it runs into.
   *
   * It is an inference about where a boundary goes, and a weaker one than a
   * hole in the fabric. It is strong enough to keep the outside out and too
   * weak to cut a room in half, and §10's barrier treats it accordingly.
   */
  carried?: boolean
}

export type WallRun = {
  id: string
  axis: 'X' | 'Y'
  /** Extent of the whole line, openings included. */
  fromPx: number
  toPx: number
  /** The two faces. §12: these are the measurement, not a centre line. */
  nearPx: number
  farPx: number
  thicknessPx: number
  /** The solid pieces. Their total is the wall that exists. */
  solid: Array<{ fromPx: number; toPx: number }>
  /** What separates them: doorways and passages, never counted as wall. */
  openings: WallOpening[]
  /** Convenience only. */
  centrePx: number
}

const overlaps = (a: WallBand, b: { nearPx: number; farPx: number }, tol: number): boolean =>
  Math.abs(a.nearPx - b.nearPx) <= tol && Math.abs(a.farPx - b.farPx) <= tol

/**
 * Bands that share a line and a thickness, joined into walls.
 *
 * Joined only across a gap a door or a passage could be. A longer gap is two
 * walls that happen to be collinear, and treating them as one would invent
 * fabric across whatever lies between.
 */
export function mergeWallRuns(
  bands: readonly WallBand[],
  pxPerCm: number,
  opts: PlanModelOptions = DEFAULT_PLAN_MODEL,
): WallRun[] {
  const maxOpeningPx = opts.maxOpeningM * 100 * pxPerCm
  const runs: WallRun[] = []
  let n = 0
  for (const axis of ['X', 'Y'] as const) {
    const lines: Array<{ nearPx: number; farPx: number; members: WallBand[] }> = []
    for (const band of bands.filter((b) => b.axis === axis).sort((a, b) => a.nearPx - b.nearPx)) {
      const line = lines.find((l) => overlaps(band, l, opts.faceTolerancePx))
      if (line) {
        line.members.push(band)
        // The line's faces are the average of what has joined it, so one
        // ragged piece cannot drag the wall off its own edge.
        line.nearPx = line.members.reduce((s, m) => s + m.nearPx, 0) / line.members.length
        line.farPx = line.members.reduce((s, m) => s + m.farPx, 0) / line.members.length
      } else lines.push({ nearPx: band.nearPx, farPx: band.farPx, members: [band] })
    }

    for (const line of lines) {
      const pieces = [...line.members].sort((a, b) => a.fromPx - b.fromPx)
      let current: Array<{ fromPx: number; toPx: number }> = []
      const openings: WallOpening[] = []
      const flush = (): void => {
        if (current.length === 0) return
        const fromPx = current[0].fromPx
        const toPx = current[current.length - 1].toPx
        runs.push({
          id: `wr${n++}`,
          axis,
          fromPx,
          toPx,
          nearPx: line.nearPx,
          farPx: line.farPx,
          thicknessPx: line.farPx - line.nearPx + 1,
          solid: current,
          openings: openings.filter((o) => o.fromPx >= fromPx && o.toPx <= toPx),
          centrePx: (line.nearPx + line.farPx) / 2,
        })
        current = []
        openings.length = 0
      }
      for (const piece of pieces) {
        if (current.length === 0) {
          current.push({ fromPx: piece.fromPx, toPx: piece.toPx })
          continue
        }
        const last = current[current.length - 1]
        const gap = piece.fromPx - last.toPx
        if (gap <= 1) {
          last.toPx = Math.max(last.toPx, piece.toPx)
          continue
        }
        if (gap > maxOpeningPx) {
          flush()
          current.push({ fromPx: piece.fromPx, toPx: piece.toPx })
          continue
        }
        openings.push({
          fromPx: last.toPx + 1,
          toPx: piece.fromPx - 1,
          lengthPx: gap - 1,
          kind: gap - 1 <= opts.doorwayM * 100 * pxPerCm ? 'DOORWAY' : 'WIDE',
          class: 'UNKNOWN_GAP',
          classConfidence: 0,
          why: 'material stops here; nothing has said why',
        })
        current.push({ fromPx: piece.fromPx, toPx: piece.toPx })
      }
      flush()
    }
  }
  return runs
}

/**
 * Carry each wall to the walls it runs into.
 *
 * Only to a wall that is actually there, only across the width of that wall's
 * own band plus a little, and only where the carried stretch is the wall's own
 * line rather than open space: the material along it is read from the drawing,
 * so a corner that is solid is reported as fabric and a stretch that is open
 * is reported as an opening.
 */
export function joinAtJunctions(
  runs: readonly WallRun[],
  gray: GrayImage,
  solid: number,
  pxPerCm: number,
  opts: PlanModelOptions = DEFAULT_PLAN_MODEL,
): WallRun[] {
  const reachPx = opts.maxJunctionReachM * 100 * pxPerCm
  const isSolid = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < gray.width && y < gray.height && gray.data[Math.round(y) * gray.width + Math.round(x)] <= solid

  return runs.map((run) => {
    const crossing = runs.filter(
      (o) => o.axis !== run.axis && o.nearPx <= run.farPx + 1 && o.farPx >= run.nearPx - 1,
    )
    let fromPx = run.fromPx
    let toPx = run.toPx
    for (const other of crossing) {
      // The other wall's own extent must reach this line, or the two do not
      // meet however close their coordinates are.
      if (other.fromPx > run.centrePx + 1 || other.toPx < run.centrePx - 1) continue
      if (other.farPx < fromPx && fromPx - other.farPx <= reachPx) fromPx = other.centrePx
      if (other.nearPx > toPx && other.nearPx - toPx <= reachPx) toPx = other.centrePx
    }
    if (fromPx === run.fromPx && toPx === run.toPx) return run

    // What was carried: solid where the drawing has material, open where not.
    const sample = (a: number): boolean => {
      const c = run.centrePx
      return run.axis === 'X' ? isSolid(a, c) : isSolid(c, a)
    }
    const spans: Array<{ fromPx: number; toPx: number; solid: boolean }> = []
    for (let a = Math.floor(fromPx); a <= Math.ceil(toPx); a++) {
      const insideOld = a >= run.fromPx && a <= run.toPx
      const material = insideOld
        ? run.solid.some((p) => a >= p.fromPx && a <= p.toPx)
        : sample(a)
      const last = spans[spans.length - 1]
      if (last && last.solid === material) last.toPx = a
      else spans.push({ fromPx: a, toPx: a, solid: material })
    }
    const doorwayPx = opts.doorwayM * 100 * pxPerCm
    return {
      ...run,
      fromPx,
      toPx,
      solid: spans.filter((s2) => s2.solid).map((s2) => ({ fromPx: s2.fromPx, toPx: s2.toPx })),
      openings: spans
        .filter((s2) => !s2.solid)
        .map((s2) => ({
          fromPx: s2.fromPx,
          toPx: s2.toPx,
          lengthPx: s2.toPx - s2.fromPx + 1,
          kind: s2.toPx - s2.fromPx + 1 <= doorwayPx ? ('DOORWAY' as const) : ('WIDE' as const),
          class: 'UNKNOWN_GAP' as const,
          classConfidence: 0,
          why: 'material stops here; nothing has said why',
        })),
    }
  })
}

export type RoomRegion = {
  id: string
  /** Pixels the region covers. */
  areaPx: number
  box: { x0: number; y0: number; x1: number; y1: number }
  centroid: { x: number; y: number }
  /** Whether the region touches the drawing's border: the outside, not a room. */
  touchesEdge: boolean
  /**
   * Room labels the source prints inside this region (§11, §12).
   *
   * More than one means the source names more than one space here and the
   * extraction returned them as one. That is a question, not a licence to
   * divide the region: §11 forbids inventing a wall to split an open plan, so
   * what is done with it is to record it unresolved.
   */
  labels: string[]
  /**
   * Which parts of the region's own box the region actually covers, as a
   * coarse grid of cells over that box.
   *
   * A room is a shape, not a rectangle. A corridor's bounding box contains
   * most of the rooms off it, so anything that asks "is this point in that
   * room" of a box gets the wrong answer about exactly the rooms that matter.
   * The grid is a few hundred cells and answers it properly.
   */
  occupancy: { cols: number; rows: number; cellPx: number; filled: Uint8Array }
}

export type RoomAdjacency = {
  wallRunId: string
  /** The two regions the wall separates. */
  a: string
  b: string
  /** How much of the wall has those two regions on its sides, pixels. */
  sharedPx: number
  /** Openings in that shared stretch: the doors between them. */
  openings: WallOpening[]
  /**
   * True where the only thing keeping these two apart is an opening nothing
   * explained. §10: an `UNKNOWN_GAP` may not receive a confident topology
   * decision, so the edge is reported and marked rather than asserted.
   */
  unresolved: boolean
  why: string
}

export type PlanModel = {
  runs: WallRun[]
  rooms: RoomRegion[]
  adjacency: RoomAdjacency[]
  /** The doors that were read, and where each of them was hung (§9). */
  doors: DoorObservation[]
  placements: DoorPlacement[]
  /** The room labels the source prints, placed in this drawing's pixels. */
  roomLabels: RoomLabel[]
  /** The boundary model rooms were flooded against (§10). */
  separators: Separator[]
  /** Region id per pixel, or -1. Kept so a caller can measure what it likes. */
  labels: Int32Array
  width: number
  height: number
  notes: string[]
}

/**
 * The barrier a room is flooded against.
 *
 * Two things, and both are needed.
 *
 * The drawing's own solid fabric, because a wall's corners and junctions are
 * where two bands meet and neither band's own rectangle covers the meeting;
 * flooding against the merged rectangles alone leaks out through every corner
 * and returns one region for the sheet.
 *
 * And each wall's whole line, doorways included, because a doorway is a hole
 * in the fabric and not a hole in the boundary; flooding through every door
 * likewise returns one region for the storey.
 */
function barrierMask(
  gray: GrayImage,
  runs: readonly WallRun[],
  fabric: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const mask = new Uint8Array(width * height)
  // Fabric, not ink. A stair tread, a worktop, a car, a dimension line and a
  // room's number are all ink, and none of them stops a room: flooding against
  // ink returns a staircase as fifteen slivers of a tenth of a square metre
  // each and a kitchen chopped up by its own units. What a room ends at is
  // material, which is the ink thick enough to be a wall.
  for (let i = 0; i < mask.length; i++) if (fabric[i] === 1) mask[i] = 1
  for (const run of runs) {
    const near = Math.floor(run.nearPx)
    const far = Math.ceil(run.farPx)
    const from = Math.floor(run.fromPx)
    const to = Math.ceil(run.toPx)
    for (let a = from; a <= to; a++) {
      for (let c = near; c <= far; c++) {
        const x = run.axis === 'X' ? a : c
        const y = run.axis === 'X' ? c : a
        if (x < 0 || y < 0 || x >= width || y >= height) continue
        mask[y * width + x] = 1
      }
    }
  }
  return mask
}

/** Connected regions of the space between the walls. */
function floodRegions(
  mask: Uint8Array,
  width: number,
  height: number,
): { labels: Int32Array; regions: RoomRegion[] } {
  const labels = new Int32Array(width * height).fill(-1)
  const regions: RoomRegion[] = []
  const stack: number[] = []
  for (let seed = 0; seed < labels.length; seed++) {
    if (mask[seed] === 1 || labels[seed] !== -1) continue
    const id = regions.length
    stack.length = 0
    stack.push(seed)
    labels[seed] = id
    let areaPx = 0
    let x0 = width
    let y0 = height
    let x1 = -1
    let y1 = -1
    let sx = 0
    let sy = 0
    let touchesEdge = false
    while (stack.length > 0) {
      const i = stack.pop()!
      const x = i % width
      const y = (i - x) / width
      areaPx++
      sx += x
      sy += y
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesEdge = true
      if (x > 0 && mask[i - 1] === 0 && labels[i - 1] === -1) {
        labels[i - 1] = id
        stack.push(i - 1)
      }
      if (x + 1 < width && mask[i + 1] === 0 && labels[i + 1] === -1) {
        labels[i + 1] = id
        stack.push(i + 1)
      }
      if (y > 0 && mask[i - width] === 0 && labels[i - width] === -1) {
        labels[i - width] = id
        stack.push(i - width)
      }
      if (y + 1 < height && mask[i + width] === 0 && labels[i + width] === -1) {
        labels[i + width] = id
        stack.push(i + width)
      }
    }
    regions.push({
      id: `rg${id}`,
      areaPx,
      box: { x0, y0, x1, y1 },
      centroid: { x: sx / areaPx, y: sy / areaPx },
      touchesEdge,
      labels: [],
      occupancy: { cols: 0, rows: 0, cellPx: 1, filled: new Uint8Array(0) },
    })
  }
  return { labels, regions }
}

/** Fill in each region's coarse footprint, once the labels are known. */
function measureOccupancy(
  regions: RoomRegion[],
  labels: Int32Array,
  width: number,
  cellPx: number,
): void {
  for (let id = 0; id < regions.length; id++) {
    const r = regions[id]
    const cols = Math.max(1, Math.ceil((r.box.x1 - r.box.x0 + 1) / cellPx))
    const rows = Math.max(1, Math.ceil((r.box.y1 - r.box.y0 + 1) / cellPx))
    const filled = new Uint8Array(cols * rows)
    for (let y = r.box.y0; y <= r.box.y1; y++) {
      for (let x = r.box.x0; x <= r.box.x1; x++) {
        if (labels[y * width + x] !== id) continue
        const cx = Math.min(cols - 1, Math.floor((x - r.box.x0) / cellPx))
        const cy = Math.min(rows - 1, Math.floor((y - r.box.y0) / cellPx))
        filled[cy * cols + cx] = 1
      }
    }
    r.occupancy = { cols, rows, cellPx, filled }
  }
}

/** Which regions each wall separates, and through which openings. */
function readAdjacency(
  runs: readonly WallRun[],
  labels: Int32Array,
  regions: readonly RoomRegion[],
  width: number,
  height: number,
  keep: ReadonlySet<string>,
): RoomAdjacency[] {
  const out: RoomAdjacency[] = []
  const at = (x: number, y: number): number =>
    x < 0 || y < 0 || x >= width || y >= height ? -1 : labels[y * width + x]
  for (const run of runs) {
    const counts = new Map<string, { n: number; from: number; to: number }>()
    for (let a = Math.floor(run.fromPx); a <= Math.ceil(run.toPx); a++) {
      const beforeC = Math.floor(run.nearPx) - 1
      const afterC = Math.ceil(run.farPx) + 1
      const before = run.axis === 'X' ? at(a, beforeC) : at(beforeC, a)
      const after = run.axis === 'X' ? at(a, afterC) : at(afterC, a)
      if (before < 0 || after < 0 || before === after) continue
      const idA = regions[before].id
      const idB = regions[after].id
      if (!keep.has(idA) || !keep.has(idB)) continue
      const key = idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`
      const entry = counts.get(key) ?? { n: 0, from: a, to: a }
      entry.n++
      entry.to = a
      counts.set(key, entry)
    }
    for (const [key, entry] of counts) {
      const [a, b] = key.split('|')
      const shared = run.openings.filter((o) => o.toPx >= entry.from && o.fromPx <= entry.to)
      const doors = shared.filter((o) => o.class === 'DOOR')
      const unknown = shared.filter((o) => o.class === 'UNKNOWN_GAP')
      out.push({
        wallRunId: run.id,
        a,
        b,
        sharedPx: entry.n,
        openings: shared,
        // §10: what a door says is that these two rooms are neighbours. What
        // an unexplained gap says is nothing, and this edge exists only
        // because keeping the two apart was the reading that asserts least.
        unresolved: doors.length === 0 && unknown.length > 0,
        why:
          doors.length > 0
            ? `${doors.length} door${doors.length === 1 ? '' : 's'} is drawn in the wall between them`
            : unknown.length > 0
              ? `the wall between them is interrupted ${unknown.length} time${unknown.length === 1 ? '' : 's'} and nothing says what is in the gap`
              : 'one wall runs between them with no opening in it',
      })
    }
  }
  return out
}

export function buildPlanModel(
  gray: GrayImage,
  bands: readonly WallBand[],
  pxPerCm: number | null,
  opts: PlanModelOptions = DEFAULT_PLAN_MODEL,
  doors: readonly DoorObservation[] = [],
  topology: TopologyOptions = DEFAULT_TOPOLOGY,
  roomLabels: readonly RoomLabel[] = [],
): PlanModel {
  const { width, height } = gray
  if (pxPerCm === null || pxPerCm <= 0 || (bands.length === 0 && doors.length === 0)) {
    return {
      runs: [],
      rooms: [],
      adjacency: [],
      roomLabels: [],
      doors: [],
      placements: [],
      separators: [],
      labels: new Int32Array(width * height).fill(-1),
      width,
      height,
      notes: ['no scale or no wall bands, so no plan model is built'],
    }
  }
  const solid = solidThreshold(gray, opts.solidFraction)
  const joined = joinAtJunctions(mergeWallRuns(bands, pxPerCm, opts), gray, solid, pxPerCm, opts)

  // §9: every door on a host wall, and a host wall wherever a door says there
  // is one that the bands were too short to claim.
  const { fabric } = inkLayers(gray, solid, DEFAULT_DOOR_SYMBOLS)
  const placed = placeDoors(joined, doors, fabric, width, height, pxPerCm, topology)
  // A wall's line does not stop where its material stops: it carries on to the
  // wall it runs into, and what is between is an opening. Without this the
  // garage drains into the street through its own door.
  const carried = closeAtCrossings(placed.runs, fabric, width, height, pxPerCm, topology)

  // What the space around the building is, so an opening onto it can be told
  // from one between two rooms. Found with every wall line closed, because a
  // window is drawn as line work and a flood that leaks through every window
  // cannot tell inside from outside.
  const closed = barrierMask(gray, carried.runs, fabric, width, height)
  const around = floodRegions(closed, width, height)
  const outsideIds = new Set(
    around.regions.filter((r) => r.touchesEdge).map((r) => around.regions.indexOf(r)),
  )
  const isOutside = (x: number, y: number): boolean => {
    const xi = Math.round(x)
    const yi = Math.round(y)
    if (xi < 0 || yi < 0 || xi >= width || yi >= height) return true
    return outsideIds.has(around.labels[yi * width + xi])
  }

  // §8: what each opening is, read in one direction from UNKNOWN_GAP.
  const classified = classifyOpenings(carried.runs, isOutside, pxPerCm, topology)
  const runs = classified.runs

  // §10: the boundary model, made explicit. Fabric, and a separator wherever a
  // room is not continuous through an opening — never the other way round.
  const separators = separatorsOf(runs)
  const mask = new Uint8Array(width * height)
  for (let i = 0; i < mask.length; i++) if (fabric[i] === 1) mask[i] = 1
  paintSeparators(mask, separators, width, height)
  const flooded = floodRegions(mask, width, height)
  const regions = flooded.regions
  const labelsAt = (x: number, y: number): number => flooded.labels[y * width + x]
  // A quarter of a metre: fine enough to tell a corridor from the rooms its
  // box contains, coarse enough to stay a few hundred cells.
  measureOccupancy(regions, flooded.labels, width, Math.max(1, Math.round(0.25 * 100 * pxPerCm)))

  const minAreaPx = opts.minRoomAreaM2 * (100 * pxPerCm) ** 2
  // A region touching the sheet's border is the space around the building, not
  // a room in it. That is a statement about where the drawing ends, not about
  // any publisher's layout.
  // §12: a label says how many spaces the source names here, and nothing
  // about where any boundary is.
  for (const label of roomLabels) {
    const x = Math.round(label.centre.x)
    const y = Math.round(label.centre.y)
    if (x < 0 || y < 0 || x >= width || y >= height) continue
    const id = labelsAt(x, y)
    if (id >= 0) regions[id].labels.push(label.id)
  }
  const rooms = regions.filter((r) => !r.touchesEdge && r.areaPx >= minAreaPx)
  const keep = new Set(rooms.map((r) => r.id))
  const adjacency = readAdjacency(runs, flooded.labels, regions, width, height, keep)

  const openings = runs.reduce((n, r) => n + r.openings.length, 0)
  const counts = classified.counts
  return {
    runs,
    rooms,
    adjacency,
    doors: [...doors],
    placements: placed.placements,
    roomLabels: [...roomLabels],
    separators,
    labels: flooded.labels,
    width,
    height,
    notes: [
      `${bands.length} bands merged into ${runs.length} wall runs with ${openings} openings`,
      `${doors.length} doors read: ${placed.placements.filter((p) => p.outcome === 'MATCHED').length} hung on a wall ` +
        `already found, ${placed.placements.filter((p) => p.outcome === 'MERGED').length} joining two collinear walls ` +
        `into one, ${placed.placements.filter((p) => p.outcome === 'MADE').length} making their own host from the ` +
        `material at their jambs, ${placed.placements.filter((p) => p.outcome === 'UNPLACED').length} left unplaced`,
      `${carried.closed} wall lines carried on to the wall they run into`,
      `openings: ${counts.DOOR} door, ${counts.OPEN_PASSAGE} open passage, ` +
        `${counts.EXTERIOR_OPENING} onto the outside, ${counts.UNKNOWN_GAP} unexplained`,
      `${separators.length} pieces of boundary: ${separators.filter((s2) => s2.kind === 'FABRIC').length} material, ` +
        `${separators.filter((s2) => s2.kind !== 'FABRIC').length} separators that are not material`,
      `${roomLabels.length} room labels read from the area-labelled copy, ` +
        `${rooms.filter((r) => r.labels.length > 1).length} regions carrying more than one`,
      `${regions.length} enclosed regions, ${rooms.length} kept as rooms ` +
        `(>= ${opts.minRoomAreaM2} m² and not touching the sheet edge)`,
      `${adjacency.length} room-to-room adjacencies, ` +
        `${adjacency.filter((a) => a.openings.some((o) => o.class === 'DOOR')).length} through a door, ` +
        `${adjacency.filter((a) => a.unresolved).length} left unresolved`,
    ],
  }
}
