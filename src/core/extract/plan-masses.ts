/**
 * What in a floor plan is the building — STAGE WEB-PIVOT-07R §4, §8, §10.
 *
 * A plan sheet carries more than a building. It carries the terrace the
 * building opens onto, the steps up to the front door, the balcony over the
 * porch, the site outline, the hatch inside a garage, the treads of a stair,
 * and a dimension chain that reaches past all of it. A wall-band detector
 * finds ink, and ink is what all of those are made of.
 *
 * Stage 06 took the outermost band on the sheet as the building's north-west
 * corner. On project A that band is the rear terrace's screen wall, 4.8 m
 * north of the house, so the ground storey's whole frame sat 4.8 m away from
 * the attic's and the two storeys did not stack. This module is the answer to
 * that, and the answer is not to subtract 4.8: it is to decide what the
 * building is before deciding where its corner is.
 *
 * Three questions, asked in this order, each answered by the drawing.
 *
 * **Is this a band at all?** A wall is fabric with two faces. Where the two
 * faces found are within the detector's own face tolerance of each other,
 * what was found is a *line* — a tread, a hatch stroke, a tiling pattern —
 * and it has no thickness to be a wall with. That tolerance is
 * `DEFAULT_PLAN_MODEL.faceTolerancePx`, already the width below which this
 * pipeline treats two faces as the same line, so nothing new is being tuned.
 *
 * **Does it touch the inside?** The candidate publishes where the enclosed
 * space is, as each room's own occupancy raster. A stretch of material with
 * no enclosed space within one cell of either face is not this building's
 * fabric — it is the terrace, the steps, the site. Asked per stretch rather
 * than per run, because a run is merged across gaps and a terrace screen wall
 * collinear with a house wall arrives as one run with the house.
 *
 * **Which faces bound it?** A face bounds the building when the inside is
 * *behind* it. What is in front of it decides nothing: a flood that leaked
 * through a balcony door puts enclosed space on both sides of a real
 * external wall, and that wall is still the wall.
 *
 * Nothing here reads a gold file, a project name or a coordinate. The only
 * numbers it introduces are in `DEFAULT_PLAN_MASSES`, and each is a fact
 * about how stairs and hatches are drawn rather than about this house.
 *
 * PORT_DIRECT (Kotlin).
 */
import type { CandidateStorey, CandidateWall } from './spec-candidate.js'
import { DEFAULT_PLAN_MODEL } from './plan-model.js'
import type { Rect, Vec2 } from './building-frame.js'

export type PlanMassOptions = {
  /**
   * A stair's going: the distance between one tread line and the next. Lines
   * further apart than this are not a flight.
   */
  treadGoingMaxM: number
  /** Fewest parallel tread lines that make a flight rather than a coincidence. */
  minTreads: number
  /** Smallest flight kept, square metres. */
  minFlightAreaM2: number
}

export const DEFAULT_PLAN_MASSES: PlanMassOptions = {
  treadGoingMaxM: 0.6,
  minTreads: 3,
  minFlightAreaM2: 0.8,
}

/**
 * What a wall run turned out to be.
 *
 * `ENVELOPE` has enclosed space behind one face and bounds the building.
 * `PARTITION` has enclosed space behind both. `INTERNAL_FABRIC` is material
 * inside one room — a pier, a chimney breast, the side of a stair.
 * `OUTSIDE_MASS` touches no enclosed space at all. `LINE_ONLY` never had a
 * thickness to begin with.
 */
export type PlanRunRole = 'ENVELOPE' | 'PARTITION' | 'INTERNAL_FABRIC' | 'OUTSIDE_MASS' | 'LINE_ONLY'

export type ClassifiedRun = {
  wallId: string
  axis: 'X' | 'Z'
  role: PlanRunRole
  /** The two faces, in the storey's own plan frame. */
  nearM: number
  farM: number
  thicknessM: number
  /** The whole line's extent along its own axis, material and gaps alike. */
  fromM: number
  toM: number
  /** Stretches of material kept as this storey's fabric, along the run's axis. */
  fabric: Array<{ fromM: number; toM: number }>
  /** Enclosed space stands behind `farM`, so `nearM` can bound the building. */
  boundsLow: boolean
  /** Enclosed space stands behind `nearM`, so `farM` can bound the building. */
  boundsHigh: boolean
  why: string
}

/** A coarse map of one storey, in its own plan frame. */
export type Occupancy = {
  origin: Vec2
  cellM: number
  cols: number
  rows: number
  /** 1 where the storey's own flood found enclosed space. */
  interior: Uint8Array
  /** 1 where this storey's kept fabric stands. */
  fabric: Uint8Array
}

export type StoreyFabric = {
  storey: string
  runs: ClassifiedRun[]
  /** The structural envelope's four faces, in the storey's own plan frame. */
  envelope: Rect | null
  occupancy: Occupancy | null
  /**
   * Runs of parallel tread-like lines. An *observation* about the drawing,
   * not a claim about a stair: a tiled floor and a flight of stairs are drawn
   * the same way, and one storey cannot tell them apart. What settles it is
   * two storeys agreeing, which `register-building.ts` decides.
   */
  flights: Rect[]
  notes: string[]
}

const solidPieces = (w: CandidateWall): Array<{ fromM: number; toM: number }> => {
  const out: Array<{ fromM: number; toM: number }> = []
  let cursor = w.fromM
  for (const o of [...w.openings].sort((a, b) => a.fromM - b.fromM)) {
    if (o.fromM > cursor) out.push({ fromM: cursor, toM: o.fromM })
    cursor = Math.max(cursor, o.toM)
  }
  if (w.toM > cursor) out.push({ fromM: cursor, toM: w.toM })
  return out
}

/** Where the storey's rooms say the enclosed space is, at their own resolution. */
export function interiorProbe(storey: CandidateStorey): { at: (x: number, z: number) => string | null; cellM: number } | null {
  const rooms = storey.rooms.filter((r) => r.footprint.cols > 0 && r.footprint.rows > 0)
  if (rooms.length === 0) return null
  const cellM = rooms[0].footprint.cellM
  const at = (x: number, z: number): string | null => {
    for (const r of rooms) {
      const { box, footprint } = r
      if (x < box.x0 || x >= box.x1 || z < box.z0 || z >= box.z1) continue
      const col = Math.floor((x - box.x0) / footprint.cellM)
      const row = Math.floor((z - box.z0) / footprint.cellM)
      if (col < 0 || col >= footprint.cols || row < 0 || row >= footprint.rows) continue
      if (footprint.filled[row * footprint.cols + col] === '1') return r.id
    }
    return null
  }
  return { at, cellM }
}

/**
 * The storey's runs, each told what it is.
 *
 * A run with no scale, or a storey with no rooms, leaves everything
 * `OUTSIDE_MASS` with a reason: without enclosed space to refer to, this
 * module cannot say what the building is, and guessing is what it exists to
 * stop.
 */
export function classifyStorey(storey: CandidateStorey, opts: PlanMassOptions = DEFAULT_PLAN_MASSES): StoreyFabric {
  const notes: string[] = []
  const probe = interiorProbe(storey)
  if (!probe || storey.pxPerCm === null || storey.pxPerCm <= 0) {
    notes.push(
      `${storey.storey}: no enclosed space was published for this storey, so nothing on the sheet can be told ` +
        'from the building and no envelope is derived',
    )
    return {
      storey: storey.storey,
      runs: storey.walls.map((w) => ({
        wallId: w.id,
        axis: w.axis,
        role: 'OUTSIDE_MASS' as const,
        nearM: w.nearM,
        farM: w.farM,
        thicknessM: w.thicknessM,
        fromM: w.fromM,
        toM: w.toM,
        fabric: [],
        boundsLow: false,
        boundsHigh: false,
        why: 'the storey publishes no enclosed space to refer this run to',
      })),
      envelope: null,
      occupancy: null,
      flights: [],
      notes,
    }
  }

  const cellM = probe.cellM
  // Two faces this close together were never two faces: see the header.
  const lineMaxM = (DEFAULT_PLAN_MODEL.faceTolerancePx + 1) / storey.pxPerCm / 100
  const runs: ClassifiedRun[] = []

  for (const w of storey.walls) {
    if (w.thicknessM <= lineMaxM) {
      runs.push({
        wallId: w.id,
        axis: w.axis,
        role: 'LINE_ONLY',
        nearM: w.nearM,
        farM: w.farM,
        thicknessM: w.thicknessM,
        fromM: w.fromM,
        toM: w.toM,
        fabric: [],
        boundsLow: false,
        boundsHigh: false,
        why:
          `its two faces are ${(w.thicknessM * 1000).toFixed(0)} mm apart, within the ` +
          `${(lineMaxM * 1000).toFixed(0)} mm below which this pipeline treats two faces as one line, so it is a ` +
          'drawn line and not a band with a thickness',
      })
      continue
    }

    const sideAt = (along: number, offset: number): string | null =>
      w.axis === 'X' ? probe.at(along, offset) : probe.at(offset, along)

    const kept: Array<{ fromM: number; toM: number }> = []
    let sawLow = false
    let sawHigh = false
    let sawBoth = 0
    let sawOne = 0
    let sawNeither = 0
    for (const piece of solidPieces(w)) {
      const n = Math.max(3, Math.ceil((piece.toM - piece.fromM) / cellM))
      let touches = false
      for (let i = 0; i < n; i++) {
        const along = piece.fromM + ((i + 0.5) / n) * (piece.toM - piece.fromM)
        const low = sideAt(along, w.nearM - cellM)
        const high = sideAt(along, w.farM + cellM)
        if (low !== null) sawLow = true
        if (high !== null) sawHigh = true
        if (low !== null && high !== null) sawBoth++
        else if (low !== null || high !== null) sawOne++
        else sawNeither++
        if (low !== null || high !== null) touches = true
      }
      if (touches) kept.push(piece)
    }

    if (kept.length === 0) {
      runs.push({
        wallId: w.id,
        axis: w.axis,
        role: 'OUTSIDE_MASS',
        nearM: w.nearM,
        farM: w.farM,
        thicknessM: w.thicknessM,
        fromM: w.fromM,
        toM: w.toM,
        fabric: [],
        boundsLow: false,
        boundsHigh: false,
        why: 'no stretch of this run has enclosed space within one occupancy cell of either face',
      })
      continue
    }
    const role: PlanRunRole = sawOne >= Math.max(sawBoth, sawNeither) ? 'ENVELOPE' : sawBoth > 0 ? 'PARTITION' : 'INTERNAL_FABRIC'
    runs.push({
      wallId: w.id,
      axis: w.axis,
      role,
      nearM: w.nearM,
      farM: w.farM,
      thicknessM: w.thicknessM,
      fromM: w.fromM,
      toM: w.toM,
      fabric: kept,
      // A face bounds the building when the inside is behind it. What stands
      // in front of it — garden, terrace, a region that leaked through a
      // door — is not what makes it an outside face.
      boundsLow: sawHigh,
      boundsHigh: sawLow,
      why:
        `${kept.length} of this run's stretches stand against enclosed space; ` +
        `${sawOne} samples had it on one side, ${sawBoth} on both, ${sawNeither} on neither`,
    })
  }

  // Two passes. The first decides what each run *is*, and the faces of what
  // is left settle the envelope. The second trims the fabric to that
  // envelope, which is what separates a run merged across a terrace screen
  // and a house wall — same line, one wall — from a wall the flood simply
  // did not reach the far side of. Membership is decided once, by the first
  // pass; the second only cuts material that stands outside the building.
  const envelope = envelopeOf(runs)
  if (envelope !== null) {
    for (const run of runs) {
      if (run.role === 'OUTSIDE_MASS' || run.role === 'LINE_ONLY') continue
      const wall = storey.walls.find((w) => w.id === run.wallId)
      if (!wall) continue
      const lo = (run.axis === 'X' ? envelope.x0 : envelope.z0) - cellM
      const hi = (run.axis === 'X' ? envelope.x1 : envelope.z1) + cellM
      run.fabric = solidPieces(wall)
        .map((piece) => ({ fromM: Math.max(piece.fromM, lo), toM: Math.min(piece.toM, hi) }))
        .filter((piece) => piece.toM > piece.fromM)
    }
  }
  const occupancy = occupancyOf(storey, runs, cellM)
  const flights = flightsOf(runs, opts)
  if (envelope === null) {
    notes.push(`${storey.storey}: no run has enclosed space behind a face, so this storey bounds nothing`)
  }
  return { storey: storey.storey, runs, envelope, occupancy, flights, notes }
}

/**
 * The four faces the building stops at.
 *
 * Faces, never extents. A run's extent along its own axis is where a drawn
 * line stops, and on project A the west wall's run is merged with the
 * terrace screen 15 m north of the house. Its *face* is still the west wall.
 */
export function envelopeOf(runs: readonly ClassifiedRun[]): Rect | null {
  let x0 = Infinity
  let x1 = -Infinity
  let z0 = Infinity
  let z1 = -Infinity
  for (const r of runs) {
    if (r.role === 'OUTSIDE_MASS' || r.role === 'LINE_ONLY') continue
    // An X-axis run's faces measure on Z; a Z-axis run's measure on X.
    if (r.axis === 'X') {
      if (r.boundsLow) z0 = Math.min(z0, r.nearM)
      if (r.boundsHigh) z1 = Math.max(z1, r.farM)
    } else {
      if (r.boundsLow) x0 = Math.min(x0, r.nearM)
      if (r.boundsHigh) x1 = Math.max(x1, r.farM)
    }
  }
  if (!Number.isFinite(x0) || !Number.isFinite(x1) || !Number.isFinite(z0) || !Number.isFinite(z1)) return null
  return { x0, z0, x1, z1 }
}

function occupancyOf(storey: CandidateStorey, runs: readonly ClassifiedRun[], cellM: number): Occupancy | null {
  const rooms = storey.rooms.filter((r) => r.footprint.cols > 0 && r.footprint.rows > 0)
  if (rooms.length === 0) return null
  let x0 = Infinity
  let z0 = Infinity
  let x1 = -Infinity
  let z1 = -Infinity
  const see = (x: number, z: number): void => {
    x0 = Math.min(x0, x)
    x1 = Math.max(x1, x)
    z0 = Math.min(z0, z)
    z1 = Math.max(z1, z)
  }
  for (const r of rooms) {
    see(r.box.x0, r.box.z0)
    see(r.box.x1, r.box.z1)
  }
  for (const r of runs) {
    if (r.fabric.length === 0) continue
    for (const f of r.fabric) {
      if (r.axis === 'X') {
        see(f.fromM, r.nearM)
        see(f.toM, r.farM)
      } else {
        see(r.nearM, f.fromM)
        see(r.farM, f.toM)
      }
    }
  }
  const origin = { x: x0 - cellM, z: z0 - cellM }
  const cols = Math.max(1, Math.ceil((x1 - origin.x) / cellM) + 1)
  const rows = Math.max(1, Math.ceil((z1 - origin.z) / cellM) + 1)
  const interior = new Uint8Array(cols * rows)
  const fabric = new Uint8Array(cols * rows)
  const mark = (grid: Uint8Array, x: number, z: number): void => {
    const col = Math.floor((x - origin.x) / cellM)
    const row = Math.floor((z - origin.z) / cellM)
    if (col < 0 || col >= cols || row < 0 || row >= rows) return
    grid[row * cols + col] = 1
  }
  for (const r of rooms) {
    for (let row = 0; row < r.footprint.rows; row++) {
      for (let col = 0; col < r.footprint.cols; col++) {
        if (r.footprint.filled[row * r.footprint.cols + col] !== '1') continue
        mark(interior, r.box.x0 + (col + 0.5) * r.footprint.cellM, r.box.z0 + (row + 0.5) * r.footprint.cellM)
      }
    }
  }
  for (const r of runs) {
    for (const f of r.fabric) {
      const alongSteps = Math.max(1, Math.ceil(((f.toM - f.fromM) / cellM) * 2))
      const acrossSteps = Math.max(1, Math.ceil(((r.farM - r.nearM) / cellM) * 2))
      for (let i = 0; i <= alongSteps; i++) {
        const along = f.fromM + ((f.toM - f.fromM) * i) / alongSteps
        for (let j = 0; j <= acrossSteps; j++) {
          const across = r.nearM + ((r.farM - r.nearM) * j) / acrossSteps
          if (r.axis === 'X') mark(fabric, along, across)
          else mark(fabric, across, along)
        }
      }
    }
  }
  return { origin, cellM, cols, rows, interior, fabric }
}

/**
 * Runs of parallel lines a tread's going apart, over the same stretch.
 *
 * This is deliberately only an observation. A flight of stairs and a tiled
 * bathroom floor are both drawn as a run of parallel lines, and on project A
 * the attic sheet carries four such runs of which one is the stair. Nothing
 * here decides which; what decides it is the storey below drawing a flight in
 * the same place, and that comparison belongs to registration, not to one
 * storey read on its own.
 */
function flightsOf(runs: readonly ClassifiedRun[], opts: PlanMassOptions): Rect[] {
  const out: Rect[] = []
  for (const axis of ['X', 'Z'] as const) {
    const lines = runs
      .filter((r) => r.role === 'LINE_ONLY' && r.axis === axis && r.toM > r.fromM)
      .map((r) => ({ at: (r.nearM + r.farM) / 2, from: r.fromM, to: r.toM }))
      .sort((a, b) => a.at - b.at)
    let group: typeof lines = []
    const flush = (): void => {
      if (group.length >= opts.minTreads) {
        const at0 = group[0].at
        const at1 = group[group.length - 1].at
        const from = Math.min(...group.map((g) => g.from))
        const to = Math.max(...group.map((g) => g.to))
        const rect: Rect =
          axis === 'X' ? { x0: from, x1: to, z0: at0, z1: at1 } : { x0: at0, x1: at1, z0: from, z1: to }
        const area = (rect.x1 - rect.x0) * (rect.z1 - rect.z0)
        if (area >= opts.minFlightAreaM2) out.push(rect)
      }
      group = []
    }
    for (const line of lines) {
      if (group.length === 0) {
        group = [line]
        continue
      }
      const last = group[group.length - 1]
      const overlap = Math.min(last.to, line.to) - Math.max(last.from, line.from)
      const shorter = Math.min(last.to - last.from, line.to - line.from)
      if (line.at - last.at <= opts.treadGoingMaxM && overlap >= 0.5 * shorter) group.push(line)
      else {
        flush()
        group = [line]
      }
    }
    flush()
  }
  return out
}
