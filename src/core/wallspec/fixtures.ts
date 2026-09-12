/**
 * Fixtures for STAGE WEB-PIVOT-01 — development only.
 *
 * One panel, four placements. The panel's *local* description never changes;
 * only the frame it is placed in does. That is the whole experiment: if the
 * compiled result differs between placements by anything other than a rigid
 * transform, the compiler is reading something it should not.
 *
 * Dimensions are the audit's:
 *
 *     8.0 x 3.0 m panel, 0.45 m thick
 *     opening 2.0 m wide x 1.5 m high, 2.0 m along the wall, sill 0.8 m up
 *     remaining volume = (8*3 - 2*1.5) * 0.45 = 9.45 m3
 */
import type { Vec3 } from '../contracts/geometry.js'
import { mat3apply, rotY, type Mat3 } from '../math/vec.js'
import type { GlazingSpec, OpeningSpec, WallCompileInput, WallSpec } from './contracts.js'

export const PANEL_LENGTH_M = 8.0
export const PANEL_HEIGHT_M = 3.0
export const PANEL_THICKNESS_M = 0.45
export const OPENING_OFFSET_M = 2.0
export const OPENING_SILL_M = 0.8
export const OPENING_WIDTH_M = 2.0
export const OPENING_HEIGHT_M = 1.5

/** The volume an independent oracle must measure. Stated, not computed by the compiler. */
export const EXPECTED_VOLUME_M3 =
  (PANEL_LENGTH_M * PANEL_HEIGHT_M - OPENING_WIDTH_M * OPENING_HEIGHT_M) * PANEL_THICKNESS_M

/**
 * The audit's massing.
 *
 * A lower mass spans x 0..8, z 0..10, y 0..3. An upper mass spans x 0..8,
 * z 0..9, y 3..6. The panel under test is the upper mass's FRONT wall, whose
 * outer face therefore sits at z = 9 — one metre behind the building's global
 * front plane at z = 10.
 */
export const LOWER_MASS = { minX: 0, maxX: 8, minZ: 0, maxZ: 10, baseY: 0, topY: 3 } as const
export const UPPER_MASS = { minX: 0, maxX: 8, minZ: 0, maxZ: 9, baseY: 3, topY: 6 } as const

/** Recessed: the upper front wall where it actually is. */
export const RECESSED_ORIGIN: Vec3 = { x: UPPER_MASS.minX, y: UPPER_MASS.baseY, z: UPPER_MASS.maxZ }
/** Flush: the same panel moved out to the building's global front plane. */
export const FLUSH_ORIGIN: Vec3 = { x: UPPER_MASS.minX, y: UPPER_MASS.baseY, z: LOWER_MASS.maxZ }

/**
 * The panel, placed at `origin` facing +Z.
 *
 * `u` runs +X and `up` runs +Y, so the outward normal `u x up` is +Z — the
 * FRONT direction in this repository's world frame.
 */
export function auditPanel(origin: Vec3, id = 'panel'): WallSpec {
  return {
    id,
    origin,
    u: { x: 1, y: 0, z: 0 },
    up: { x: 0, y: 1, z: 0 },
    lengthM: PANEL_LENGTH_M,
    heightM: PANEL_HEIGHT_M,
    thicknessM: PANEL_THICKNESS_M,
  }
}

export function auditOpening(hostWallId = 'panel', id = 'win'): OpeningSpec {
  return {
    id,
    hostWallId,
    offsetM: OPENING_OFFSET_M,
    sillM: OPENING_SILL_M,
    widthM: OPENING_WIDTH_M,
    heightM: OPENING_HEIGHT_M,
    cut: 'THROUGH',
  }
}

/** Glazing set in the middle of the wall's thickness. */
export function auditGlazing(openingId = 'win', id = 'glass'): GlazingSpec {
  return { id, openingId, insetM: PANEL_THICKNESS_M / 2 }
}

/** The single-panel case the volume oracle runs on: one wall, one hole, one pane. */
export function singlePanelInput(origin: Vec3): WallCompileInput {
  return { walls: [auditPanel(origin)], openings: [auditOpening()], glazing: [auditGlazing()] }
}

/**
 * Rigidly move a wall: rotate its frame, then translate.
 *
 * The wall's own dimensions are untouched, which is the point — a rigid motion
 * is exactly the transformation a correct compiler must commute with.
 */
export function transformWall(w: WallSpec, rotation: Mat3, translation: Vec3): WallSpec {
  const r = (v: Vec3): Vec3 => mat3apply(rotation, v)
  const o = r(w.origin)
  return {
    ...w,
    origin: { x: o.x + translation.x, y: o.y + translation.y, z: o.z + translation.z },
    u: r(w.u),
    up: r(w.up),
  }
}

/** A deliberately awkward rigid motion: not a right angle, not on an axis. */
export const AWKWARD_ROTATION: Mat3 = rotY((37 * Math.PI) / 180)
export const AWKWARD_TRANSLATION: Vec3 = { x: -13.5, y: 4.25, z: 61.75 }

/**
 * The lower mass's four walls, for the diagnostic render only.
 *
 * Context, never oracle input: they show that the panel under test is set back
 * behind the front of the building, which is the condition the production
 * compiler cannot handle.
 */
export function contextWalls(thicknessM = PANEL_THICKNESS_M): WallSpec[] {
  const { minX, maxX, minZ, maxZ, baseY, topY } = LOWER_MASS
  const h = topY - baseY
  const mk = (id: string, origin: Vec3, u: Vec3, lengthM: number): WallSpec => ({
    id,
    origin,
    u,
    up: { x: 0, y: 1, z: 0 },
    lengthM,
    heightM: h,
    thicknessM,
  })
  return [
    // Each u is chosen so that u x up points away from the building.
    mk('ctx_front', { x: minX, y: baseY, z: maxZ }, { x: 1, y: 0, z: 0 }, maxX - minX),
    mk('ctx_rear', { x: maxX, y: baseY, z: minZ }, { x: -1, y: 0, z: 0 }, maxX - minX),
    mk('ctx_left', { x: minX, y: baseY, z: minZ }, { x: 0, y: 0, z: 1 }, maxZ - minZ),
    mk('ctx_right', { x: maxX, y: baseY, z: maxZ }, { x: 0, y: 0, z: -1 }, maxZ - minZ),
  ]
}
