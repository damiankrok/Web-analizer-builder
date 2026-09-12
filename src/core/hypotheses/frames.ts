/**
 * Facade frames (§18 "build facade-local coordinates").
 *
 * Every facade has a 2D frame: +s runs left-to-right as seen by someone
 * standing outside looking at it, +t runs up. Openings measured off an
 * elevation are expressed in that frame, and this module is the single place
 * that converts them to WORLD — so the handedness is defined once instead of
 * being re-derived (and re-mistaken) at each call site.
 *
 * PORT_DIRECT (Kotlin).
 */
import type { FacadeSide } from '../contracts/hypotheses.js'
import type { Vec2, Vec3 } from '../contracts/geometry.js'

export type FacadeFrame = {
  side: FacadeSide
  /** Outward normal of the facade. */
  normal: Vec3
  /** World direction of increasing s. */
  right: Vec3
  /** World origin of the facade frame: its ground-level, s = 0 corner. */
  origin: Vec3
  /** Extent of the facade along s, metres. */
  widthM: number
}

export type PlanBounds = { minX: number; maxX: number; minZ: number; maxZ: number }

export function facadeFrame(side: FacadeSide, b: PlanBounds, baseY = 0): FacadeFrame {
  switch (side) {
    case 'FRONT':
      return {
        side,
        normal: { x: 0, y: 0, z: 1 },
        right: { x: 1, y: 0, z: 0 },
        origin: { x: b.minX, y: baseY, z: b.maxZ },
        widthM: b.maxX - b.minX,
      }
    case 'REAR':
      return {
        side,
        normal: { x: 0, y: 0, z: -1 },
        right: { x: -1, y: 0, z: 0 },
        origin: { x: b.maxX, y: baseY, z: b.minZ },
        widthM: b.maxX - b.minX,
      }
    case 'LEFT':
      return {
        side,
        normal: { x: -1, y: 0, z: 0 },
        right: { x: 0, y: 0, z: 1 },
        origin: { x: b.minX, y: baseY, z: b.minZ },
        widthM: b.maxZ - b.minZ,
      }
    case 'RIGHT':
    default:
      return {
        side,
        normal: { x: 1, y: 0, z: 0 },
        right: { x: 0, y: 0, z: -1 },
        origin: { x: b.maxX, y: baseY, z: b.maxZ },
        widthM: b.maxZ - b.minZ,
      }
  }
}

/** Facade-local (s, t) to WORLD. */
export const facadePoint = (f: FacadeFrame, s: number, t: number): Vec3 => ({
  x: f.origin.x + f.right.x * s,
  y: f.origin.y + t,
  z: f.origin.z + f.right.z * s,
})

/** Plan-space point on the facade line at parameter s. */
export const facadePlanPoint = (f: FacadeFrame, s: number): Vec2 => ({
  x: f.origin.x + f.right.x * s,
  z: f.origin.z + f.right.z * s,
})
