/**
 * The corner fixture for STAGE WEB-PIVOT-01B — development only.
 *
 * Two 4.0 x 3.0 m walls, 0.45 m thick, meeting at one 90-degree exterior corner.
 * In the nominal frame the corner is at `(4, 0, 4)`:
 *
 *       z
 *       4  +--------------------+        wall A: origin (0,0,4), u = +X, n = +Z
 *          |                    |                outer face z = 4, material to z = 3.55
 *    3.55  +----------------+   |        wall B: origin (4,0,4), u = -Z, n = +X
 *          .                |   |                outer face x = 4, material to x = 3.55
 *          .                |   |
 *       0  .................+---+        corner prism: x,z in 3.55..4, 0.45 x 0.45 x 3
 *          0             3.55   4   x
 *
 * A's END meets B's START, and at that end both walls' outer-face base points
 * are the same point — which is what makes "these two ends meet" a checkable
 * statement rather than a drawing convention.
 *
 * The numbers are the stage brief's, and the volumes below are written as the
 * arithmetic the brief states, not as anything the compiler computes.
 */
import type { Vec3 } from '../contracts/geometry.js'
import { deg2rad, mat3mul, rotX, rotY, type Mat3 } from '../math/vec.js'
import type { GlazingSpec, OpeningSpec, WallSpec } from './contracts.js'
import type { JunctionCompileInput, WallJunctionSpec } from './junction.js'
import { transformWall } from './fixtures.js'

export const CORNER_HEIGHT_M = 3.0
export const CORNER_THICKNESS_M = 0.45
export const WALL_A_LENGTH_M = 4.0
export const WALL_B_LENGTH_M = 4.0

/** The required hosted opening, placed well clear of the corner at either end. */
export const CORNER_OPENING_OFFSET_M = 1.5
export const CORNER_OPENING_SILL_M = 0.8
export const CORNER_OPENING_WIDTH_M = 1.0
export const CORNER_OPENING_HEIGHT_M = 1.0

/**
 * `(4x3x0.45) + (4x3x0.45) - (0.45x0.45x3)` = 10.1925 m3.
 *
 * The subtraction is the whole stage: the corner prism is in both walls'
 * nominal descriptions and must be emitted once.
 */
export const EXPECTED_CORNER_VOLUME_M3 =
  WALL_A_LENGTH_M * CORNER_HEIGHT_M * CORNER_THICKNESS_M +
  WALL_B_LENGTH_M * CORNER_HEIGHT_M * CORNER_THICKNESS_M -
  CORNER_THICKNESS_M * CORNER_THICKNESS_M * CORNER_HEIGHT_M

/** `10.1925 - (1.0x1.0x0.45)` = 9.7425 m3. */
export const EXPECTED_CORNER_VOLUME_WITH_OPENING_M3 =
  EXPECTED_CORNER_VOLUME_M3 - CORNER_OPENING_WIDTH_M * CORNER_OPENING_HEIGHT_M * CORNER_THICKNESS_M

/** Where the two outer faces meet, in the nominal frame. */
export const CORNER_POINT: Vec3 = { x: WALL_A_LENGTH_M, y: 0, z: WALL_B_LENGTH_M }

/** The inner face of each wall, in the nominal frame: 4.0 - 0.45. */
export const INNER_X = WALL_A_LENGTH_M - CORNER_THICKNESS_M
export const INNER_Z = WALL_B_LENGTH_M - CORNER_THICKNESS_M

export const WALL_A_ID = 'wall_a'
export const WALL_B_ID = 'wall_b'
export const JUNCTION_ID = 'corner_ab'
export const OPENING_ID = 'win'
export const GLAZING_ID = 'glass'

/** Wall A: runs +X along the building front, outward normal +Z. */
export function cornerWallA(): WallSpec {
  return {
    id: WALL_A_ID,
    origin: { x: 0, y: 0, z: WALL_B_LENGTH_M },
    u: { x: 1, y: 0, z: 0 },
    up: { x: 0, y: 1, z: 0 },
    lengthM: WALL_A_LENGTH_M,
    heightM: CORNER_HEIGHT_M,
    thicknessM: CORNER_THICKNESS_M,
  }
}

/** Wall B: runs -Z down the building side, outward normal +X. */
export function cornerWallB(): WallSpec {
  return {
    id: WALL_B_ID,
    origin: { x: WALL_A_LENGTH_M, y: 0, z: WALL_B_LENGTH_M },
    u: { x: 0, y: 0, z: -1 },
    up: { x: 0, y: 1, z: 0 },
    lengthM: WALL_B_LENGTH_M,
    heightM: CORNER_HEIGHT_M,
    thicknessM: CORNER_THICKNESS_M,
  }
}

export type CornerOwner = 'A' | 'B'

export function cornerJunction(owner: CornerOwner, id = JUNCTION_ID): WallJunctionSpec {
  return {
    id,
    wallAId: WALL_A_ID,
    wallAEnd: 'END',
    wallBId: WALL_B_ID,
    wallBEnd: 'START',
    kind: 'BUTT',
    ownerWallId: owner === 'A' ? WALL_A_ID : WALL_B_ID,
  }
}

export const nonOwner = (owner: CornerOwner): CornerOwner => (owner === 'A' ? 'B' : 'A')

export function cornerOpening(hostWallId: string, id = OPENING_ID): OpeningSpec {
  return {
    id,
    hostWallId,
    offsetM: CORNER_OPENING_OFFSET_M,
    sillM: CORNER_OPENING_SILL_M,
    widthM: CORNER_OPENING_WIDTH_M,
    heightM: CORNER_OPENING_HEIGHT_M,
    cut: 'THROUGH',
  }
}

export function cornerGlazing(openingId = OPENING_ID, id = GLAZING_ID): GlazingSpec {
  return { id, openingId, insetM: CORNER_THICKNESS_M / 2 }
}

export type CornerOptions = {
  owner: CornerOwner
  /**
   * Which wall hosts the opening. `'NON_OWNER'` is the brief's requirement and
   * the default; naming a wall directly is how the owner-swap invariance check
   * keeps the opening on the *same* wall while the ownership moves under it.
   */
  openingOn?: 'NON_OWNER' | 'OWNER' | CornerOwner | 'NONE'
  rotation?: Mat3
  translation?: Vec3
  /** Unrelated geometry, to show the result does not depend on it. */
  extraWalls?: readonly WallSpec[]
}

const wallIdOf = (which: CornerOwner): string => (which === 'A' ? WALL_A_ID : WALL_B_ID)

/** The two-wall assembly, its junction, and optionally one hosted opening. */
export function cornerInput(opts: CornerOptions): JunctionCompileInput {
  const place = (w: WallSpec): WallSpec =>
    opts.rotation || opts.translation
      ? transformWall(w, opts.rotation ?? IDENTITY_ROTATION, opts.translation ?? { x: 0, y: 0, z: 0 })
      : w

  const which: CornerOwner | 'NONE' =
    opts.openingOn === 'NONE'
      ? 'NONE'
      : opts.openingOn === 'OWNER'
        ? opts.owner
        : opts.openingOn === 'A' || opts.openingOn === 'B'
          ? opts.openingOn
          : nonOwner(opts.owner)

  return {
    walls: [place(cornerWallA()), place(cornerWallB()), ...(opts.extraWalls ?? [])],
    openings: which === 'NONE' ? [] : [cornerOpening(wallIdOf(which))],
    glazing: which === 'NONE' ? [] : [cornerGlazing()],
    junctions: [cornerJunction(opts.owner)],
  }
}

const IDENTITY_ROTATION: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]

/**
 * A rigid motion with nothing convenient about it.
 *
 * Rotating about X as well as Y is deliberate: a Y-only rotation leaves `up`
 * pointing at world +Y, and a compiler that had quietly assumed vertical would
 * survive it. After this one no wall axis is a world axis.
 */
export const CORNER_ROTATION: Mat3 = mat3mul(rotY(deg2rad(37)), rotX(deg2rad(19)))
export const CORNER_TRANSLATION: Vec3 = { x: -13.5, y: 4.25, z: 61.75 }

/** A Y-only motion, for renders where a level ground plane is wanted. */
export const CORNER_ROTATION_LEVEL: Mat3 = rotY(deg2rad(37))

/**
 * Two very large walls, far away, carrying no openings and no junction.
 *
 * They exist to be irrelevant. If the corner result changes when they are
 * present, something read a global bounding box.
 */
export function distantWalls(): WallSpec[] {
  return [
    {
      id: 'far_a',
      origin: { x: -500, y: -120, z: -500 },
      u: { x: 1, y: 0, z: 0 },
      up: { x: 0, y: 1, z: 0 },
      lengthM: 900,
      heightM: 40,
      thicknessM: 2,
    },
    {
      id: 'far_b',
      origin: { x: 500, y: 120, z: 500 },
      u: { x: 0, y: 0, z: -1 },
      up: { x: 0, y: 1, z: 0 },
      lengthM: 900,
      heightM: 40,
      thicknessM: 2,
    },
  ]
}
