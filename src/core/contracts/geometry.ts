/**
 * BuildPlan-owned geometry DTOs (§7). These are the only polygon types that
 * cross a module boundary. JSTS types never appear in a public contract.
 */
import type { Vec2, Vec3 } from '../math/vec.js'
export type { Vec2, Vec3, Pixel, Mat3 } from '../math/vec.js'

export type Polygon2D = {
  outer: Vec2[]
  holes: Vec2[][]
}

export type Segment2D = { a: Vec2; b: Vec2 }
export type Segment3D = { a: Vec3; b: Vec3 }

/**
 * Coordinate systems used across the analyzer. Every geometric DTO names the
 * frame it lives in; nothing is implicit.
 *
 *  WORLD    metres, +X east, +Y up, +Z south. Origin at the footprint's
 *           front-left corner at finished ground level (y = 0).
 *  PLAN     metres, the WORLD XZ plane (a Vec2 with fields x/z).
 *  FACADE   metres, per-facade 2D: +s along the facade left-to-right when
 *           viewed from outside, +t up. Origin at the facade's ground-left.
 *  IMAGE    pixels, origin top-left, +u right, +v down.
 */
export type Frame = 'WORLD' | 'PLAN' | 'FACADE' | 'IMAGE'

export const polygonArea = (ring: readonly Vec2[]): number => {
  let s = 0
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    s += a.x * b.z - b.x * a.z
  }
  return s / 2
}

export const polygonAreaAbs = (p: Polygon2D): number =>
  Math.abs(polygonArea(p.outer)) - p.holes.reduce((acc, h) => acc + Math.abs(polygonArea(h)), 0)

export function polygonCentroid(ring: readonly Vec2[]): Vec2 {
  const a = polygonArea(ring)
  if (Math.abs(a) < 1e-12) {
    const n = Math.max(1, ring.length)
    return {
      x: ring.reduce((s, p) => s + p.x, 0) / n,
      z: ring.reduce((s, p) => s + p.z, 0) / n,
    }
  }
  let cx = 0
  let cz = 0
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]
    const q = ring[(i + 1) % ring.length]
    const cr = p.x * q.z - q.x * p.z
    cx += (p.x + q.x) * cr
    cz += (p.z + q.z) * cr
  }
  return { x: cx / (6 * a), z: cz / (6 * a) }
}

export function pointInRing(p: Vec2, ring: readonly Vec2[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]
    const b = ring[j]
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) {
      inside = !inside
    }
  }
  return inside
}

export const pointInPolygon = (p: Vec2, poly: Polygon2D): boolean =>
  pointInRing(p, poly.outer) && !poly.holes.some((h) => pointInRing(p, h))

export function boundsOf(ring: readonly Vec2[]): { minX: number; maxX: number; minZ: number; maxZ: number } {
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const p of ring) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.z < minZ) minZ = p.z
    if (p.z > maxZ) maxZ = p.z
  }
  return { minX, maxX, minZ, maxZ }
}

export const rectRing = (minX: number, minZ: number, maxX: number, maxZ: number): Vec2[] => [
  { x: minX, z: minZ },
  { x: maxX, z: minZ },
  { x: maxX, z: maxZ },
  { x: minX, z: maxZ },
]

/** Ensure counter-clockwise winding in the PLAN frame (positive signed area). */
export const ensureCCW = (ring: Vec2[]): Vec2[] => (polygonArea(ring) < 0 ? [...ring].reverse() : ring)
