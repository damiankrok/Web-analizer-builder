/**
 * Closed storey ring fixture — STAGE WEB-PIVOT-01C, development only.
 *
 * One rectangular storey: 8.0 m by 6.0 m outside, 3.0 m high, 0.45 m thick,
 * four walls, four explicit corners, two hosted openings.
 *
 * Every wall is stated in its own frame. There is no facade enum anywhere in
 * this file: `FRONT`, `REAR`, `LEFT` and `RIGHT` are *names* for four walls,
 * not directions a compiler is allowed to read. Each one's geometry comes from
 * its own origin, `u` and `up`, exactly as a wall lifted off a drawing would.
 *
 * ## The analytic numbers this fixture exists to be checked against
 *
 *     outer prism        8 x 6 x 3                       = 144.00 m3
 *     inner void         7.10 x 5.10 x 3                 = 108.63 m3
 *     wall ring          144.00 - 108.63                 =  35.37 m3
 *     FRONT opening      2.0 x 1.5 x 0.45                =   1.35 m3
 *     RIGHT opening      1.0 x 1.0 x 0.45                =   0.45 m3
 *     final material     35.37 - 1.35 - 0.45             =  33.57 m3
 *     gross facade       2*(8*3) + 2*(6*3)               =  84.00 m2
 *     opaque facade      84.00 - 3.00 - 1.00             =  80.00 m2
 *
 * None of these is computed by the compiler. They are arithmetic on the
 * fixture's own dimensions, which is what makes them an oracle.
 */
import type { Vec3 } from '../contracts/geometry.js'
import { deg2rad, mat3mul, rotX, rotY, type Mat3 } from '../math/vec.js'
import type { GlazingSpec, OpeningSpec, WallSpec } from './contracts.js'
import type { JunctionCompileInput, WallJunctionSpec } from './junction.js'
import { transformWall } from './fixtures.js'

export const RING_WIDTH_M = 8.0
export const RING_DEPTH_M = 6.0
export const RING_HEIGHT_M = 3.0
export const RING_THICKNESS_M = 0.45

/** Interior clear dimensions: the outer rectangle less one thickness each side. */
export const INNER_WIDTH_M = RING_WIDTH_M - 2 * RING_THICKNESS_M // 7.10
export const INNER_DEPTH_M = RING_DEPTH_M - 2 * RING_THICKNESS_M // 5.10

export const OUTER_PRISM_M3 = RING_WIDTH_M * RING_DEPTH_M * RING_HEIGHT_M // 144.00
export const INNER_VOID_M3 = INNER_WIDTH_M * INNER_DEPTH_M * RING_HEIGHT_M // 108.63
export const RING_VOLUME_NO_OPENINGS_M3 = OUTER_PRISM_M3 - INNER_VOID_M3 // 35.37

export const FRONT_ID = 'wall_front'
export const REAR_ID = 'wall_rear'
export const LEFT_ID = 'wall_left'
export const RIGHT_ID = 'wall_right'
export const RING_WALL_IDS = [FRONT_ID, REAR_ID, LEFT_ID, RIGHT_ID] as const

/** The four corners, named by the two walls that meet there. */
export const CORNER_FL = 'corner_front_left'
export const CORNER_FR = 'corner_front_right'
export const CORNER_RR = 'corner_right_rear'
export const CORNER_RL = 'corner_rear_left'
export const RING_CORNER_IDS = [CORNER_FL, CORNER_FR, CORNER_RR, CORNER_RL] as const

export const FRONT_OPENING_ID = 'win_front'
export const RIGHT_OPENING_ID = 'win_right'
export const FRONT_GLAZING_ID = 'glass_front'
export const RIGHT_GLAZING_ID = 'glass_right'

export const FRONT_OPENING = { offsetM: 2.0, sillM: 0.8, widthM: 2.0, heightM: 1.5 } as const
export const RIGHT_OPENING = { offsetM: 2.0, sillM: 0.8, widthM: 1.0, heightM: 1.0 } as const

export const FRONT_OPENING_M3 = FRONT_OPENING.widthM * FRONT_OPENING.heightM * RING_THICKNESS_M // 1.35
export const RIGHT_OPENING_M3 = RIGHT_OPENING.widthM * RIGHT_OPENING.heightM * RING_THICKNESS_M // 0.45
export const RING_VOLUME_M3 = RING_VOLUME_NO_OPENINGS_M3 - FRONT_OPENING_M3 - RIGHT_OPENING_M3 // 33.57

export const OUTER_PERIMETER_M = 2 * (RING_WIDTH_M + RING_DEPTH_M) // 28
export const GROSS_FACADE_M2 = OUTER_PERIMETER_M * RING_HEIGHT_M // 84
export const FRONT_OPENING_FACE_M2 = FRONT_OPENING.widthM * FRONT_OPENING.heightM // 3.0
export const RIGHT_OPENING_FACE_M2 = RIGHT_OPENING.widthM * RIGHT_OPENING.heightM // 1.0
export const OPAQUE_FACADE_M2 = GROSS_FACADE_M2 - FRONT_OPENING_FACE_M2 - RIGHT_OPENING_FACE_M2 // 80.0

const UP: Vec3 = { x: 0, y: 1, z: 0 }

/**
 * The four walls.
 *
 * The outer rectangle is `x` in `0..8`, `z` in `0..6`. Each wall's `u` is chosen
 * so that `u x up` points away from the enclosure, and each wall's origin is the
 * outer-face corner it starts from — so the four of them run nose to tail around
 * the rectangle and every corner is one wall's END meeting another's START.
 */
export function ringWalls(): WallSpec[] {
  const wall = (id: string, origin: Vec3, u: Vec3, lengthM: number): WallSpec => ({
    id,
    origin,
    u,
    up: UP,
    lengthM,
    heightM: RING_HEIGHT_M,
    thicknessM: RING_THICKNESS_M,
  })
  return [
    // +X along the front, outward normal +Z. START at the left corner.
    wall(FRONT_ID, { x: 0, y: 0, z: RING_DEPTH_M }, { x: 1, y: 0, z: 0 }, RING_WIDTH_M),
    // -Z down the right side, outward normal +X. START where FRONT ends.
    wall(RIGHT_ID, { x: RING_WIDTH_M, y: 0, z: RING_DEPTH_M }, { x: 0, y: 0, z: -1 }, RING_DEPTH_M),
    // -X along the rear, outward normal -Z. START where RIGHT ends.
    wall(REAR_ID, { x: RING_WIDTH_M, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }, RING_WIDTH_M),
    // +Z up the left side, outward normal -X. START where REAR ends, END at FRONT's START.
    wall(LEFT_ID, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, RING_DEPTH_M),
  ]
}

/** The four corner points, in the untransformed fixture. */
export const RING_CORNER_POINTS: Record<string, Vec3> = {
  [CORNER_FL]: { x: 0, y: 0, z: RING_DEPTH_M },
  [CORNER_FR]: { x: RING_WIDTH_M, y: 0, z: RING_DEPTH_M },
  [CORNER_RR]: { x: RING_WIDTH_M, y: 0, z: 0 },
  [CORNER_RL]: { x: 0, y: 0, z: 0 },
}

/** Which two wall ends meet at each corner. Geometry, not ownership. */
const CORNER_ENDS: Record<string, { a: string; aEnd: 'START' | 'END'; b: string; bEnd: 'START' | 'END' }> = {
  [CORNER_FL]: { a: FRONT_ID, aEnd: 'START', b: LEFT_ID, bEnd: 'END' },
  [CORNER_FR]: { a: FRONT_ID, aEnd: 'END', b: RIGHT_ID, bEnd: 'START' },
  [CORNER_RR]: { a: RIGHT_ID, aEnd: 'END', b: REAR_ID, bEnd: 'START' },
  [CORNER_RL]: { a: REAR_ID, aEnd: 'END', b: LEFT_ID, bEnd: 'START' },
}

export type OwnershipSchedule = {
  name: string
  description: string
  /** Corner id -> the wall that keeps that corner's material. */
  owners: Record<string, string>
}

/**
 * Schedule A — the two long walls run through.
 *
 * FRONT and REAR keep their full 8.0 m and own all four corners; LEFT and RIGHT
 * are trimmed at both ends and fit between them at 5.10 m emitted each. This is
 * how a bricklayer would build it and how most drawings imply it.
 */
export const SCHEDULE_A: OwnershipSchedule = {
  name: 'A',
  description: 'long walls run through: FRONT and REAR own all four corners',
  owners: {
    [CORNER_FL]: FRONT_ID,
    [CORNER_FR]: FRONT_ID,
    [CORNER_RR]: REAR_ID,
    [CORNER_RL]: REAR_ID,
  },
}

/**
 * Schedule B — a pinwheel.
 *
 * Every wall owns exactly one corner, the one at its own START, and is trimmed
 * at its END. No wall runs through and no wall is trimmed twice. Physically it
 * must produce the identical solid; semantically every corner has a different
 * owner from Schedule A, which is the point of comparing them.
 */
export const SCHEDULE_B: OwnershipSchedule = {
  name: 'B',
  description: 'pinwheel: each wall owns the corner at its own START and is trimmed at its END',
  owners: {
    [CORNER_FL]: FRONT_ID,
    [CORNER_FR]: RIGHT_ID,
    [CORNER_RR]: REAR_ID,
    [CORNER_RL]: LEFT_ID,
  },
}

export const RING_SCHEDULES = [SCHEDULE_A, SCHEDULE_B] as const

/** The four junctions for one ownership schedule. */
export function ringJunctions(schedule: OwnershipSchedule): WallJunctionSpec[] {
  return RING_CORNER_IDS.map((id) => {
    const c = CORNER_ENDS[id]
    return {
      id,
      wallAId: c.a,
      wallAEnd: c.aEnd,
      wallBId: c.b,
      wallBEnd: c.bEnd,
      kind: 'BUTT' as const,
      ownerWallId: schedule.owners[id],
    }
  })
}

export function ringOpenings(): OpeningSpec[] {
  return [
    { id: FRONT_OPENING_ID, hostWallId: FRONT_ID, ...FRONT_OPENING, cut: 'THROUGH' },
    { id: RIGHT_OPENING_ID, hostWallId: RIGHT_ID, ...RIGHT_OPENING, cut: 'THROUGH' },
  ]
}

export function ringGlazing(): GlazingSpec[] {
  return [
    { id: FRONT_GLAZING_ID, openingId: FRONT_OPENING_ID, insetM: RING_THICKNESS_M / 2 },
    { id: RIGHT_GLAZING_ID, openingId: RIGHT_OPENING_ID, insetM: RING_THICKNESS_M / 2 },
  ]
}

export type RingOptions = {
  schedule: OwnershipSchedule
  /** Leave the openings out, for the 35.37 m³ check. */
  withOpenings?: boolean
  /** Rigidly move the whole ring. */
  rotation?: Mat3
  translation?: Vec3
  /** Add large, far-away walls that must change nothing. */
  distant?: boolean
}

const NO_MOTION: Vec3 = { x: 0, y: 0, z: 0 }
const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]

export function ringInput(opts: RingOptions): JunctionCompileInput {
  const withOpenings = opts.withOpenings ?? true
  const moved = (w: WallSpec): WallSpec =>
    opts.rotation || opts.translation
      ? transformWall(w, opts.rotation ?? IDENTITY, opts.translation ?? NO_MOTION)
      : w
  return {
    walls: [...ringWalls().map(moved), ...(opts.distant ? ringDistantWalls().map(moved) : [])],
    openings: withOpenings ? ringOpenings() : [],
    glazing: withOpenings ? ringGlazing() : [],
    junctions: ringJunctions(opts.schedule),
  }
}

/** A deliberately awkward rigid motion: two axes, neither a right angle. */
export const RING_ROTATION: Mat3 = mat3mul(rotY(deg2rad(41)), rotX(deg2rad(23)))
export const RING_TRANSLATION: Vec3 = { x: 137.25, y: -58.5, z: -1041.75 }
/** A Y-only motion, for renders that want a level ground plane. */
export const RING_ROTATION_LEVEL: Mat3 = rotY(deg2rad(34))

/**
 * Enormous walls, far away, joined to nothing.
 *
 * They exist to be irrelevant. If any ring measurement moves when they are in
 * the input, something read a global bounding box.
 */
export function ringDistantWalls(): WallSpec[] {
  return [
    {
      id: 'far_north',
      origin: { x: -800, y: -240, z: -800 },
      u: { x: 1, y: 0, z: 0 },
      up: UP,
      lengthM: 1600,
      heightM: 90,
      thicknessM: 4,
    },
    {
      id: 'far_south',
      origin: { x: 800, y: 240, z: 800 },
      u: { x: 0, y: 0, z: -1 },
      up: UP,
      lengthM: 1600,
      heightM: 90,
      thicknessM: 4,
    },
  ]
}

/**
 * The ring's own frame, for oracles that need to scan it.
 *
 * Fixture knowledge, not compiler output: these are the axes the walls were
 * *written* in, transformed by whatever rigid motion the caller applied. An
 * oracle that used the compiler's idea of the frame would be checking the
 * compiler against itself.
 */
export function ringFrame(rotation?: Mat3, translation?: Vec3): {
  origin: Vec3
  x: Vec3
  y: Vec3
  z: Vec3
} {
  const probe = transformWall(
    {
      id: 'frame',
      origin: { x: 0, y: 0, z: 0 },
      u: { x: 1, y: 0, z: 0 },
      up: UP,
      lengthM: 1,
      heightM: 1,
      thicknessM: 1,
    },
    rotation ?? IDENTITY,
    translation ?? NO_MOTION,
  )
  const f = probe
  // u is world +X, up is world +Y; the third axis is their cross product, which
  // for the untransformed fixture is world +Z.
  const z: Vec3 = {
    x: f.u.y * f.up.z - f.u.z * f.up.y,
    y: f.u.z * f.up.x - f.u.x * f.up.z,
    z: f.u.x * f.up.y - f.u.y * f.up.x,
  }
  return { origin: f.origin, x: f.u, y: f.up, z }
}

/**
 * The four vertical planes of the ring's outer envelope, with outward normals.
 *
 * Fixture arithmetic on the 8 x 6 rectangle, transformed by whatever rigid
 * motion the caller applied. This is what the facade oracle measures against,
 * and it is deliberately stated here rather than read back from the compiler:
 * an envelope derived from the emitted triangles would agree with them by
 * construction and prove nothing.
 */
export function ringEnvelopePlanes(
  rotation?: Mat3,
  translation?: Vec3,
): Array<{ point: Vec3; normal: Vec3 }> {
  const f = ringFrame(rotation, translation)
  const at = (a: number, c: number): Vec3 => ({
    x: f.origin.x + f.x.x * a + f.z.x * c,
    y: f.origin.y + f.x.y * a + f.z.y * c,
    z: f.origin.z + f.x.z * a + f.z.z * c,
  })
  const negate = (v: Vec3): Vec3 => ({ x: -v.x, y: -v.y, z: -v.z })
  return [
    { point: at(0, RING_DEPTH_M), normal: f.z }, // front
    { point: at(0, 0), normal: negate(f.z) }, // rear
    { point: at(0, 0), normal: negate(f.x) }, // left
    { point: at(RING_WIDTH_M, 0), normal: f.x }, // right
  ]
}
