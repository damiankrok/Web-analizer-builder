/**
 * Interior ArchitecturalSpec — STAGE WEB-PIVOT-04, development only.
 *
 * STAGE WEB-PIVOT-02 described a shell: a ring of external walls per storey, a
 * floor plate and two roofs. A shell is not a house. What is missing is
 * everything a person actually stands in — partitions, rooms, the doorways
 * between them, and a stair that makes the two storeys one building rather than
 * two stacked boxes.
 *
 * ## Why this is not a second wall system
 *
 * An internal partition is a wall. It has an origin, a length, a height, a
 * thickness and doors cut through it, and `WallSpec` already says all of that
 * in wall-local coordinates that no bounding box can spoil. So `InteriorWallSpec`
 * *carries* a `WallSpec` rather than restating it, and compilation goes through
 * `compileWalls` — the same code STAGE WEB-PIVOT-01 proved and every stage since
 * has built on. What this module adds is the things a partition has and an
 * external wall does not: the storey it belongs to, whether it is structural,
 * the rooms on either side, and whether this stage is the one that emits it.
 *
 * ## Ownership is stated, never inferred
 *
 * Two partitions that meet at a tee both claim the corner prism, exactly as two
 * external walls do at a corner. STAGE WEB-PIVOT-01B settled that with an
 * explicit junction record and an owner. Here the same fact is carried more
 * directly: every wall states the interval of its own axis that it emits, and
 * the author is the one who decides which of two crossing walls keeps the
 * overlap. Nothing guesses, and `interiorOverlaps` measures what was actually
 * emitted, so a mistake is a reported number rather than a hidden solid.
 *
 * ## What a room is
 *
 * A closed rectilinear polygon in world plan coordinates, a published label, a
 * published area where the source states one, and the ids of the walls and
 * openings on its boundary. A room is not a label with a centroid: every claim
 * in this file is checkable against emitted triangles, and
 * `tests/interior-oracles.ts` checks them without calling any of this code.
 *
 * Nothing in the production analyzer imports this module.
 *
 * PORT_DIRECT (Kotlin) — plain data and pure functions.
 */
import type { Vec3 } from '../contracts/geometry.js'
import type { GlazingSpec, OpeningSpec, WallSpec } from './contracts.js'
import { SOLID_PARTS, type WallPart } from './contracts.js'
import { compileWalls } from './compile.js'
import type { Provenance } from './architectural.js'

/** A point in the world plan, metres. `x` runs east, `z` runs south. */
export type PlanPoint = { x: number; z: number }

/** A closed rectilinear polygon. The last vertex joins the first implicitly. */
export type PlanPolygon = readonly PlanPoint[]

export type InteriorWallKind = 'STRUCTURAL' | 'PARTITION' | 'UNKNOWN'

/**
 * A storey of the interior.
 *
 * `envelopes` are the plan rectangles the storey's rooms and partitions have to
 * add up to — the inner faces of the shell, taken from the exterior gold rather
 * than re-measured here. The partition audit compares their total area against
 * the rooms and walls that were actually described, which is the only way to
 * notice a room nobody wrote down.
 */
export type InteriorLevelSpec = {
  id: string
  name: string
  /** Finished floor level, in the exterior shell's world frame. */
  fflM: number
  /** Height a partition reaches where nothing above it is lower. */
  clearHeightM: number
  /** FLAT: every partition reaches `clearHeightM`. ATTIC_SOFFIT: the roof cuts it. */
  topKind: 'FLAT' | 'ATTIC_SOFFIT'
  envelopes: ReadonlyArray<{ id: string; minX: number; maxX: number; minZ: number; maxZ: number }>
  provenance: Provenance
}

/**
 * One internal wall.
 *
 * `wall` is the proven wall-local record and is what compiles; `axis`, `atM`,
 * `fromM` and `toM` are the same wall said the way a plan says it, and are what
 * the plan audits read. They are not two sources of truth: `interiorWallSpec()`
 * derives the first from the second, and `wallFootprint()` derives the plan
 * rectangle back from the emitted geometry's own frame.
 */
export type InteriorWallSpec = {
  id: string
  levelId: string
  /** Which world axis the wall runs along. */
  axis: 'X' | 'Z'
  /** Centre line: `z` for an X wall, `x` for a Z wall. */
  atM: number
  /** First emitted position along the wall's axis, in world coordinates. */
  fromM: number
  /** Last emitted position along the wall's axis, in world coordinates. */
  toM: number
  thicknessM: number
  kind: InteriorWallKind
  /**
   * Whether this stage emits the wall's solid.
   *
   * False for a wall the exterior shell already emits — the house/garage party
   * wall is a real boundary between two interior rooms and the host of a real
   * door, and it must be nameable here without being built twice.
   */
  emit: boolean
  /** The proven wall-local description. Its `id` is this record's `id`. */
  wall: WallSpec
  openingIds: string[]
  provenance: Provenance
}

export type InteriorOpeningKind = 'DOOR' | 'OPEN_PASSAGE' | 'INTERIOR_WINDOW'

export type InteriorOpeningSpec = {
  id: string
  levelId: string
  hostWallId: string
  /** Distance along the host wall's own `u` from its emitted start. */
  offsetM: number
  widthM: number
  /** Height above the wall base to the sill. A door's sill is the floor. */
  sillM: number
  /** Height above the wall base to the head. */
  headM: number
  kind: InteriorOpeningKind
  /** The two rooms this opening joins. */
  connects: readonly [string, string]
  /** True when this stage cuts the hole; false when the host belongs to the shell. */
  cut: boolean
  provenance: Provenance
}

/** An edge of a room that is open rather than walled — an open-plan boundary. */
export type NotionalEdge = {
  from: PlanPoint
  to: PlanPoint
  /** The space on the other side. */
  toRoomId: string
}

export type RoomSpec = {
  id: string
  levelId: string
  envelopeId: string
  /** The label the source prints, verbatim. */
  label: string
  /** The index the published room table gives it, where it has one. */
  publishedIndex?: number
  /** Published usable area, m². */
  publishedAreaM2?: number
  /** Published gross area where the source states both, m². */
  publishedGrossAreaM2?: number
  polygon: PlanPolygon
  /** Walls whose face runs along this room's boundary. Derived at compile time. */
  boundaryWallIds: string[]
  /** Openings on this room's boundary. Derived at compile time. */
  openingIds: string[]
  /** Boundary edges that carry no wall, and what is on the other side. */
  notionalEdges: readonly NotionalEdge[]
  provenance: Provenance
}

export type StairFlightSpec = {
  id: string
  /** The world axis the flight travels along. */
  axis: 'X' | 'Z'
  /** +1 towards increasing coordinate, -1 towards decreasing. */
  direction: 1 | -1
  /** The flight's extent across its own axis. */
  bandFromM: number
  bandToM: number
  /** Where the flight starts and finishes along its axis. */
  runFromM: number
  runToM: number
  /** 1-based index of this flight's first riser in the whole stair. */
  firstRiser: number
  risers: number
}

export type StairSpec = {
  id: string
  fromLevelId: string
  toLevelId: string
  footprint: PlanPolygon
  /** The hole this stair needs in the floor above. */
  slabVoid: PlanPolygon
  riseFromM: number
  riseToM: number
  risers: number
  shape: string
  flights: readonly StairFlightSpec[]
  provenance: Provenance
  /** What the model deliberately does not reproduce. */
  simplification: string
}

/**
 * The floor plate between two storeys, with the stair's hole in it.
 *
 * The footprint and the void are both axis-aligned rectangles, and the emitted
 * plate is the four rectangles around the void. That is the whole of the
 * boolean this stage needs and the whole of the boolean it implements: a
 * general polygon difference would be a second geometry kernel with one caller.
 */
export type InteriorSlabSpec = {
  id: string
  topLevelId: string
  thicknessM: number
  footprint: PlanPolygon
  /** Ids of the stairs whose voids are cut out of this slab. */
  voidStairIds: string[]
  provenance: Provenance
}

export type InteriorSpec = {
  id: string
  version: string
  levels: InteriorLevelSpec[]
  walls: InteriorWallSpec[]
  openings: InteriorOpeningSpec[]
  rooms: RoomSpec[]
  stairs: StairSpec[]
  slabs: InteriorSlabSpec[]
  provenance: Provenance
  unresolved: string[]
}

// --- Emitted geometry -------------------------------------------------------

export type InteriorElementKind = 'INTERIOR_WALL' | 'ROOM_FLOOR' | 'STAIR' | 'SLAB'
export type InteriorPart = WallPart | 'SLAB' | 'STAIR' | 'ROOM_FLOOR'

export type InteriorTri = {
  a: Vec3
  b: Vec3
  c: Vec3
  part: InteriorPart
  elementKind: InteriorElementKind
  /** The wall, room, stair or slab this triangle belongs to. */
  elementId: string
  ownerId: string
  wallId: string
  levelId?: string
  roomId?: string
  openingId?: string
}

export type InteriorDiagnosticCode =
  | 'DUPLICATE_INTERIOR_ID'
  | 'UNKNOWN_LEVEL'
  | 'UNKNOWN_HOST_WALL'
  | 'OPENING_ON_UNCUT_WALL'
  | 'UNKNOWN_ROOM'
  | 'INVALID_WALL_SPAN'
  | 'INVALID_ROOM_POLYGON'
  | 'ROOM_OUTSIDE_ENVELOPE'
  | 'INTERIOR_WALL_OVERLAP'
  | 'ROOM_OVERLAP'
  | 'SLAB_VOID_OUTSIDE_SLAB'
  | 'STAIR_RISE_MISMATCH'
  | 'WALL_COMPILER'

export type InteriorDiagnostic = {
  code: InteriorDiagnosticCode
  severity: 'ERROR' | 'WARNING'
  message: string
  levelId?: string
  wallId?: string
  roomId?: string
  openingId?: string
  stairId?: string
}

export type CompiledInteriorWall = {
  wallId: string
  levelId: string
  openingIds: string[]
  triCount: number
  /** Plan rectangle the emitted solid occupies. */
  footprint: { minX: number; maxX: number; minZ: number; maxZ: number }
}

export type CompiledRoom = {
  roomId: string
  levelId: string
  areaM2: number
  perimeterM: number
  boundaryWallIds: string[]
  openingIds: string[]
}

export type InteriorCompileResult = {
  tris: InteriorTri[]
  walls: CompiledInteriorWall[]
  rooms: CompiledRoom[]
  diagnostics: InteriorDiagnostic[]
}

const EPS = 1e-9

// --- Plan helpers -----------------------------------------------------------

/** Signed area of a closed polygon. Positive when wound anticlockwise in (x, z). */
export function polygonSignedArea(poly: PlanPolygon): number {
  let s = 0
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]
    const q = poly[(i + 1) % poly.length]
    s += p.x * q.z - q.x * p.z
  }
  return s / 2
}

export const polygonArea = (poly: PlanPolygon): number => Math.abs(polygonSignedArea(poly))

export function polygonPerimeter(poly: PlanPolygon): number {
  let s = 0
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]
    const q = poly[(i + 1) % poly.length]
    s += Math.hypot(q.x - p.x, q.z - p.z)
  }
  return s
}

/**
 * Plan area of the same polygon measured to finished surfaces.
 *
 * Offsetting every edge of a simple rectilinear polygon inwards by `d` changes
 * its area by `-P*d + (C - R)*d^2`, where `C` and `R` count the convex and
 * reflex right angles; for any simple rectilinear polygon `C - R = 4`. The
 * published Marcowki room areas are reproduced by this with `d = 0.02`, which
 * is what makes it worth computing — see the gold fixture's
 * `method.publishedAreaConvention`.
 */
export const polygonInsetArea = (poly: PlanPolygon, d: number): number =>
  polygonArea(poly) - polygonPerimeter(poly) * d + 4 * d * d

export const pointInPolygon = (p: PlanPoint, poly: PlanPolygon): boolean => {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside
  }
  return inside
}

export type PlanRect = { minX: number; maxX: number; minZ: number; maxZ: number }

export const rectOf = (poly: PlanPolygon): PlanRect => ({
  minX: Math.min(...poly.map((p) => p.x)),
  maxX: Math.max(...poly.map((p) => p.x)),
  minZ: Math.min(...poly.map((p) => p.z)),
  maxZ: Math.max(...poly.map((p) => p.z)),
})

export const rectArea = (r: PlanRect): number => (r.maxX - r.minX) * (r.maxZ - r.minZ)

/** Area the two rectangles share. Zero when they only touch. */
export function rectOverlapArea(a: PlanRect, b: PlanRect): number {
  const w = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX)
  const h = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ)
  return w > EPS && h > EPS ? w * h : 0
}

/** The plan rectangle an interior wall's emitted solid occupies. */
export const wallFootprint = (w: InteriorWallSpec): PlanRect => {
  const half = w.thicknessM / 2
  return w.axis === 'X'
    ? { minX: w.fromM, maxX: w.toM, minZ: w.atM - half, maxZ: w.atM + half }
    : { minX: w.atM - half, maxX: w.atM + half, minZ: w.fromM, maxZ: w.toM }
}

// --- Wall construction ------------------------------------------------------

/**
 * Build the wall-local record for a plan-stated interior wall.
 *
 * An X wall runs along `+x`, so its triad is `u = +x`, `up = +y`, and the
 * derived outward normal is `+z`; material runs *against* the normal, so the
 * origin sits on the `+z` face and the wall occupies `atM - t/2 .. atM + t/2`.
 * A Z wall runs along `+z`, its normal comes out at `-x`, and the origin sits
 * on the `-x` face. Both are the one rule `WallSpec` states — the origin is the
 * outer face — applied to a partition, which has two inner faces and no outer
 * one; which face is called "outer" is arbitrary and only has to be consistent.
 */
export function interiorWallSpec(
  id: string,
  axis: 'X' | 'Z',
  atM: number,
  fromM: number,
  toM: number,
  thicknessM: number,
  baseM: number,
  heightM: number,
  topProfile?: WallSpec['topProfile'],
): WallSpec {
  const half = thicknessM / 2
  return axis === 'X'
    ? {
        id,
        origin: { x: fromM, y: baseM, z: atM + half },
        u: { x: 1, y: 0, z: 0 },
        up: { x: 0, y: 1, z: 0 },
        lengthM: toM - fromM,
        heightM,
        thicknessM,
        ...(topProfile ? { topProfile } : {}),
      }
    : {
        id,
        origin: { x: atM - half, y: baseM, z: fromM },
        u: { x: 0, y: 0, z: 1 },
        up: { x: 0, y: 1, z: 0 },
        lengthM: toM - fromM,
        heightM,
        thicknessM,
        ...(topProfile ? { topProfile } : {}),
      }
}

// --- Geometry emission ------------------------------------------------------

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z })

/** A closed box wound outwards, as two triangles per face. */
function box(out: InteriorTri[], r: PlanRect, bottomY: number, topY: number, tag: Omit<InteriorTri, 'a' | 'b' | 'c'>): void {
  const add = (p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3): void => {
    out.push({ ...tag, a: p0, b: p1, c: p2 })
    out.push({ ...tag, a: p0, b: p2, c: p3 })
  }
  const { minX, maxX, minZ, maxZ } = r
  const t = topY
  const b = bottomY
  add(v(minX, t, maxZ), v(maxX, t, maxZ), v(maxX, t, minZ), v(minX, t, minZ))
  add(v(minX, b, minZ), v(maxX, b, minZ), v(maxX, b, maxZ), v(minX, b, maxZ))
  add(v(minX, b, maxZ), v(maxX, b, maxZ), v(maxX, t, maxZ), v(minX, t, maxZ))
  add(v(maxX, b, minZ), v(minX, b, minZ), v(minX, t, minZ), v(maxX, t, minZ))
  add(v(maxX, b, maxZ), v(maxX, b, minZ), v(maxX, t, minZ), v(maxX, t, maxZ))
  add(v(minX, b, minZ), v(minX, b, maxZ), v(minX, t, maxZ), v(minX, t, minZ))
}

/**
 * A rectangular plate with one rectangular hole, as four plates around it.
 *
 * Each piece is a closed box and no two share material, so the union is closed,
 * the hole is real, and the volume is the plate's less the hole's — all three
 * of which the oracles measure rather than assume. When the hole does not lie
 * strictly inside the plate the caller is told; nothing is clipped silently.
 */
export function plateWithHole(plate: PlanRect, hole: PlanRect): PlanRect[] {
  const out: PlanRect[] = []
  const push = (r: PlanRect): void => {
    if (r.maxX - r.minX > EPS && r.maxZ - r.minZ > EPS) out.push(r)
  }
  push({ minX: plate.minX, maxX: plate.maxX, minZ: plate.minZ, maxZ: hole.minZ })
  push({ minX: plate.minX, maxX: plate.maxX, minZ: hole.maxZ, maxZ: plate.maxZ })
  push({ minX: plate.minX, maxX: hole.minX, minZ: hole.minZ, maxZ: hole.maxZ })
  push({ minX: hole.maxX, maxX: plate.maxX, minZ: hole.minZ, maxZ: hole.maxZ })
  return out
}

/** Ear-free fan triangulation of a rectilinear polygon, by horizontal slabs. */
export function triangulateRectilinear(poly: PlanPolygon): Array<[PlanPoint, PlanPoint, PlanPoint]> {
  const zs = [...new Set(poly.map((p) => p.z))].sort((a, b) => a - b)
  const out: Array<[PlanPoint, PlanPoint, PlanPoint]> = []
  for (let i = 0; i + 1 < zs.length; i++) {
    const z0 = zs[i]
    const z1 = zs[i + 1]
    const zm = (z0 + z1) / 2
    // Every x where an edge of the polygon crosses this slab.
    const xs: number[] = []
    for (let k = 0; k < poly.length; k++) {
      const a = poly[k]
      const b = poly[(k + 1) % poly.length]
      if (Math.min(a.z, b.z) <= zm && zm <= Math.max(a.z, b.z) && Math.abs(a.z - b.z) > EPS) {
        xs.push(a.x + ((zm - a.z) / (b.z - a.z)) * (b.x - a.x))
      }
    }
    xs.sort((p, q) => p - q)
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = xs[k]
      const x1 = xs[k + 1]
      if (x1 - x0 <= EPS) continue
      out.push([
        { x: x0, z: z0 },
        { x: x1, z: z0 },
        { x: x1, z: z1 },
      ])
      out.push([
        { x: x0, z: z0 },
        { x: x1, z: z1 },
        { x: x0, z: z1 },
      ])
    }
  }
  return out
}

// --- The compiler -----------------------------------------------------------

export function compileInterior(spec: InteriorSpec): InteriorCompileResult {
  const diagnostics: InteriorDiagnostic[] = []
  const tris: InteriorTri[] = []
  const compiledWalls: CompiledInteriorWall[] = []
  const compiledRooms: CompiledRoom[] = []

  const levelById = new Map(spec.levels.map((l) => [l.id, l]))
  const wallById = new Map<string, InteriorWallSpec>()
  const roomIds = new Set(spec.rooms.map((r) => r.id))

  const dupe = (kind: string, id: string): void => {
    diagnostics.push({
      code: 'DUPLICATE_INTERIOR_ID',
      severity: 'ERROR',
      message: `${kind} id ${id} appears more than once; the later one was not compiled`,
    })
  }

  for (const w of spec.walls) {
    if (wallById.has(w.id)) {
      dupe('wall', w.id)
      continue
    }
    wallById.set(w.id, w)
    if (!levelById.has(w.levelId)) {
      diagnostics.push({
        code: 'UNKNOWN_LEVEL',
        severity: 'ERROR',
        message: `wall ${w.id} names level ${w.levelId}, which is not in the spec`,
        wallId: w.id,
      })
    }
    if (!(w.toM - w.fromM > EPS) || !(w.thicknessM > EPS)) {
      diagnostics.push({
        code: 'INVALID_WALL_SPAN',
        severity: 'ERROR',
        message: `wall ${w.id} spans ${w.fromM}..${w.toM} at ${w.thicknessM} m thick`,
        wallId: w.id,
      })
    }
  }

  // Emitted partitions must not share material. This is the tee-ownership check
  // STAGE WEB-PIVOT-01B made for external corners, measured directly on the
  // plan rectangles rather than trusted: a pair that overlaps is named, with
  // the area, so the fix is to the stated span and not to a tolerance.
  const emitted = spec.walls.filter((w) => w.emit)
  for (let i = 0; i < emitted.length; i++) {
    for (let j = i + 1; j < emitted.length; j++) {
      if (emitted[i].levelId !== emitted[j].levelId) continue
      const overlap = rectOverlapArea(wallFootprint(emitted[i]), wallFootprint(emitted[j]))
      if (overlap > 1e-6) {
        diagnostics.push({
          code: 'INTERIOR_WALL_OVERLAP',
          severity: 'ERROR',
          message:
            `walls ${emitted[i].id} and ${emitted[j].id} both claim ${overlap.toFixed(4)} m² of plan on ` +
            `level ${emitted[i].levelId}; one of them has to stop at the other's face`,
          wallId: emitted[i].id,
        })
      }
    }
  }

  // Openings, grouped by host. Validation of the hole itself is the wall
  // compiler's job and is not repeated here.
  const openingsByWall = new Map<string, OpeningSpec[]>()
  const openingById = new Map<string, InteriorOpeningSpec>()
  for (const o of spec.openings) {
    if (openingById.has(o.id)) {
      dupe('opening', o.id)
      continue
    }
    openingById.set(o.id, o)
    const host = wallById.get(o.hostWallId)
    if (!host) {
      diagnostics.push({
        code: 'UNKNOWN_HOST_WALL',
        severity: 'ERROR',
        message: `opening ${o.id} names host wall ${o.hostWallId}, which is not in the spec`,
        openingId: o.id,
      })
      continue
    }
    for (const rid of o.connects) {
      if (!roomIds.has(rid)) {
        diagnostics.push({
          code: 'UNKNOWN_ROOM',
          severity: 'ERROR',
          message: `opening ${o.id} connects room ${rid}, which is not in the spec`,
          openingId: o.id,
        })
      }
    }
    if (!o.cut) {
      if (host.emit) {
        diagnostics.push({
          code: 'OPENING_ON_UNCUT_WALL',
          severity: 'WARNING',
          message: `opening ${o.id} is not cut although its host ${host.id} is emitted here`,
          openingId: o.id,
        })
      }
      continue
    }
    const list = openingsByWall.get(o.hostWallId) ?? []
    list.push({
      id: o.id,
      hostWallId: o.hostWallId,
      offsetM: o.offsetM,
      sillM: o.sillM,
      widthM: o.widthM,
      heightM: o.headM - o.sillM,
      cut: 'THROUGH',
    })
    openingsByWall.set(o.hostWallId, list)
  }

  // Walls compile through STAGE WEB-PIVOT-01's own compiler, one storey at a
  // time, with no extents: an interior wall's stated span *is* its emitted
  // span, so there is nothing for a junction to trim.
  for (const level of spec.levels) {
    const walls = emitted.filter((w) => w.levelId === level.id)
    if (walls.length === 0) continue
    const openings: OpeningSpec[] = walls.flatMap((w) => openingsByWall.get(w.id) ?? [])
    const glazing: GlazingSpec[] = []
    const r = compileWalls({ walls: walls.map((w) => w.wall), openings, glazing })
    for (const d of r.diagnostics) {
      diagnostics.push({
        code: 'WALL_COMPILER',
        severity: d.severity,
        message: `[${d.code}] ${d.message}`,
        levelId: level.id,
        wallId: d.wallId,
        openingId: d.openingId,
      })
    }
    for (const t of r.tris) {
      tris.push({
        a: t.a,
        b: t.b,
        c: t.c,
        part: t.part,
        elementKind: 'INTERIOR_WALL',
        elementId: t.wallId,
        ownerId: t.ownerId,
        wallId: t.wallId,
        levelId: level.id,
        ...(t.openingId ? { openingId: t.openingId } : {}),
      })
    }
    for (const cw of r.walls) {
      const w = wallById.get(cw.wallId)!
      compiledWalls.push({
        wallId: cw.wallId,
        levelId: level.id,
        openingIds: cw.openingIds,
        triCount: cw.triCount,
        footprint: wallFootprint(w),
      })
    }
  }

  // Rooms: a selectable floor surface at the storey's own level, plus the
  // boundary walls and openings, derived here rather than restated by hand.
  const seenRoom = new Set<string>()
  for (const room of spec.rooms) {
    if (seenRoom.has(room.id)) {
      dupe('room', room.id)
      continue
    }
    seenRoom.add(room.id)
    const level = levelById.get(room.levelId)
    if (!level) {
      diagnostics.push({
        code: 'UNKNOWN_LEVEL',
        severity: 'ERROR',
        message: `room ${room.id} names level ${room.levelId}, which is not in the spec`,
        roomId: room.id,
      })
      continue
    }
    const area = polygonArea(room.polygon)
    if (room.polygon.length < 4 || !(area > EPS)) {
      diagnostics.push({
        code: 'INVALID_ROOM_POLYGON',
        severity: 'ERROR',
        message: `room ${room.id} has ${room.polygon.length} vertices and area ${area}`,
        roomId: room.id,
      })
      continue
    }
    const env = level.envelopes.find((e) => e.id === room.envelopeId)
    if (env) {
      const r = rectOf(room.polygon)
      if (r.minX < env.minX - 1e-6 || r.maxX > env.maxX + 1e-6 || r.minZ < env.minZ - 1e-6 || r.maxZ > env.maxZ + 1e-6) {
        diagnostics.push({
          code: 'ROOM_OUTSIDE_ENVELOPE',
          severity: 'ERROR',
          message:
            `room ${room.id} spans ${r.minX}..${r.maxX} by ${r.minZ}..${r.maxZ}, outside envelope ` +
            `${env.id} (${env.minX}..${env.maxX} by ${env.minZ}..${env.maxZ})`,
          roomId: room.id,
        })
      }
    }
    const boundaryWallIds = boundaryWallsOf(room, spec.walls)
    const openingIds = spec.openings.filter((o) => o.connects.includes(room.id)).map((o) => o.id)
    for (const t of triangulateRectilinear(room.polygon)) {
      tris.push({
        a: v(t[0].x, level.fflM, t[0].z),
        b: v(t[1].x, level.fflM, t[1].z),
        c: v(t[2].x, level.fflM, t[2].z),
        part: 'ROOM_FLOOR',
        elementKind: 'ROOM_FLOOR',
        elementId: room.id,
        ownerId: room.id,
        wallId: room.id,
        levelId: level.id,
        roomId: room.id,
      })
    }
    compiledRooms.push({
      roomId: room.id,
      levelId: level.id,
      areaM2: area,
      perimeterM: polygonPerimeter(room.polygon),
      boundaryWallIds,
      openingIds,
    })
  }

  // Rooms on the same storey may touch but never share plan.
  for (let i = 0; i < compiledRooms.length; i++) {
    for (let j = i + 1; j < compiledRooms.length; j++) {
      if (compiledRooms[i].levelId !== compiledRooms[j].levelId) continue
      const a = spec.rooms.find((r) => r.id === compiledRooms[i].roomId)!
      const b = spec.rooms.find((r) => r.id === compiledRooms[j].roomId)!
      const ov = polygonOverlapArea(a.polygon, b.polygon)
      if (ov > 1e-6) {
        diagnostics.push({
          code: 'ROOM_OVERLAP',
          severity: 'ERROR',
          message: `rooms ${a.id} and ${b.id} share ${ov.toFixed(4)} m² of plan`,
          roomId: a.id,
        })
      }
    }
  }

  // Stairs: a stepped envelope, one box per riser.
  const stairById = new Map(spec.stairs.map((s) => [s.id, s]))
  for (const s of spec.stairs) {
    const totalRise = s.riseToM - s.riseFromM
    const flightRisers = s.flights.reduce((n, f) => n + f.risers, 0)
    if (flightRisers !== s.risers) {
      diagnostics.push({
        code: 'STAIR_RISE_MISMATCH',
        severity: 'ERROR',
        message: `stair ${s.id} declares ${s.risers} risers but its flights add up to ${flightRisers}`,
        stairId: s.id,
      })
    }
    const rise = totalRise / s.risers
    for (const f of s.flights) {
      const going = (f.runToM - f.runFromM) / f.risers
      for (let i = 0; i < f.risers; i++) {
        const a0 = f.runFromM + going * i
        const a1 = f.runFromM + going * (i + 1)
        const top = s.riseFromM + rise * (f.firstRiser + i)
        const r: PlanRect =
          f.axis === 'X'
            ? { minX: Math.min(a0, a1), maxX: Math.max(a0, a1), minZ: f.bandFromM, maxZ: f.bandToM }
            : { minX: f.bandFromM, maxX: f.bandToM, minZ: Math.min(a0, a1), maxZ: Math.max(a0, a1) }
        box(tris, r, s.riseFromM, top, {
          part: 'STAIR',
          elementKind: 'STAIR',
          elementId: s.id,
          ownerId: `${f.id}_${f.firstRiser + i}`,
          wallId: s.id,
          levelId: s.fromLevelId,
        })
      }
    }
  }

  // Slabs: the plate, minus each named stair's void.
  for (const sl of spec.slabs) {
    const level = levelById.get(sl.topLevelId)
    if (!level) {
      diagnostics.push({
        code: 'UNKNOWN_LEVEL',
        severity: 'ERROR',
        message: `slab ${sl.id} names level ${sl.topLevelId}, which is not in the spec`,
      })
      continue
    }
    let pieces: PlanRect[] = [rectOf(sl.footprint)]
    for (const sid of sl.voidStairIds) {
      const st = stairById.get(sid)
      if (!st) {
        diagnostics.push({
          code: 'SLAB_VOID_OUTSIDE_SLAB',
          severity: 'ERROR',
          message: `slab ${sl.id} names stair ${sid}, which is not in the spec`,
        })
        continue
      }
      const hole = rectOf(st.slabVoid)
      const plate = rectOf(sl.footprint)
      if (hole.minX < plate.minX - 1e-6 || hole.maxX > plate.maxX + 1e-6 || hole.minZ < plate.minZ - 1e-6 || hole.maxZ > plate.maxZ + 1e-6) {
        diagnostics.push({
          code: 'SLAB_VOID_OUTSIDE_SLAB',
          severity: 'ERROR',
          message: `stair ${sid}'s void reaches outside slab ${sl.id}`,
          stairId: sid,
        })
        continue
      }
      pieces = pieces.flatMap((p) => (rectOverlapArea(p, hole) > EPS ? plateWithHole(p, hole) : [p]))
    }
    const top = level.fflM
    for (const p of pieces) {
      box(tris, p, top - sl.thicknessM, top, {
        part: 'SLAB',
        elementKind: 'SLAB',
        elementId: sl.id,
        ownerId: sl.id,
        wallId: sl.id,
        levelId: sl.topLevelId,
      })
    }
  }

  return { tris, walls: compiledWalls, rooms: compiledRooms, diagnostics }
}

/**
 * The walls whose face runs along a room's boundary.
 *
 * A wall is a boundary wall when one of its two faces is collinear with a
 * boundary edge of the room and the two overlap over a positive length. It is
 * derived, not stated: a hand-written list would agree with the polygon by
 * assertion, and the point of the list is to say whether the polygon is
 * actually held up by fabric.
 */
export function boundaryWallsOf(room: RoomSpec, walls: readonly InteriorWallSpec[]): string[] {
  const out: string[] = []
  for (const w of walls) {
    if (w.levelId !== room.levelId) continue
    const f = wallFootprint(w)
    if (roomEdgeOnRect(room.polygon, f) > 1e-6) out.push(w.id)
  }
  return out
}

/** Total length of the room's boundary that lies on one of the rectangle's faces. */
export function roomEdgeOnRect(poly: PlanPolygon, r: PlanRect): number {
  let total = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    if (Math.abs(a.z - b.z) <= EPS) {
      // Horizontal edge: it can lie on the rectangle's minZ or maxZ face.
      if (Math.abs(a.z - r.minZ) > 1e-6 && Math.abs(a.z - r.maxZ) > 1e-6) continue
      const lo = Math.max(Math.min(a.x, b.x), r.minX)
      const hi = Math.min(Math.max(a.x, b.x), r.maxX)
      if (hi - lo > EPS) total += hi - lo
    } else if (Math.abs(a.x - b.x) <= EPS) {
      if (Math.abs(a.x - r.minX) > 1e-6 && Math.abs(a.x - r.maxX) > 1e-6) continue
      const lo = Math.max(Math.min(a.z, b.z), r.minZ)
      const hi = Math.min(Math.max(a.z, b.z), r.maxZ)
      if (hi - lo > EPS) total += hi - lo
    }
  }
  return total
}

/**
 * Area two rectilinear polygons share.
 *
 * Both are decomposed on the union of their own x and z coordinates, which is
 * exact for axis-aligned shapes and needs no clipping library. Cells are tested
 * at their centres, so a shared edge contributes nothing — two rooms that touch
 * are not two rooms that overlap.
 */
export function polygonOverlapArea(a: PlanPolygon, b: PlanPolygon): number {
  const xs = [...new Set([...a, ...b].map((p) => p.x))].sort((p, q) => p - q)
  const zs = [...new Set([...a, ...b].map((p) => p.z))].sort((p, q) => p - q)
  let total = 0
  for (let i = 0; i + 1 < xs.length; i++) {
    for (let j = 0; j + 1 < zs.length; j++) {
      const c = { x: (xs[i] + xs[i + 1]) / 2, z: (zs[j] + zs[j + 1]) / 2 }
      if (pointInPolygon(c, a) && pointInPolygon(c, b)) total += (xs[i + 1] - xs[i]) * (zs[j + 1] - zs[j])
    }
  }
  return total
}

/** Parts that make up closed interior solids. Room floors are surfaces. */
export const SOLID_INTERIOR_PARTS: readonly InteriorPart[] = [...SOLID_PARTS, 'SLAB', 'STAIR']
export const isSolidInteriorPart = (p: InteriorPart): boolean => SOLID_INTERIOR_PARTS.includes(p)
