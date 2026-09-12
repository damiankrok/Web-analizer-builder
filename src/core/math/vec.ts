/**
 * Portable vector/matrix primitives.
 *
 * PORT_DIRECT (Kotlin): every function here is a pure function over plain data
 * classes. No browser globals, no library types. Mat3 is row-major and flat so
 * that a Kotlin `DoubleArray(9)` maps 1:1.
 */

export type Vec2 = { x: number; z: number }
export type Vec3 = { x: number; y: number; z: number }

/** Pixel coordinate. Origin top-left, +u right, +v down (image convention). */
export type Pixel = { u: number; v: number }

/** Row-major 3x3: [m00,m01,m02, m10,m11,m12, m20,m21,m22]. */
export type Mat3 = readonly number[]

export const v2 = (x: number, z: number): Vec2 => ({ x, z })
export const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z })
export const px = (u: number, v: number): Pixel => ({ u, v })

export const v2add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, z: a.z + b.z })
export const v2sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, z: a.z - b.z })
export const v2scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, z: a.z * s })
export const v2dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.z * b.z
export const v2cross = (a: Vec2, b: Vec2): number => a.x * b.z - a.z * b.x
export const v2len = (a: Vec2): number => Math.hypot(a.x, a.z)
export const v2dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.z - b.z)
export function v2norm(a: Vec2): Vec2 {
  const l = v2len(a)
  return l < 1e-12 ? { x: 0, z: 0 } : { x: a.x / l, z: a.z / l }
}

export const v3add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z })
export const v3sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
export const v3scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s })
export const v3dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z
export const v3len = (a: Vec3): number => Math.hypot(a.x, a.y, a.z)
export const v3dist = (a: Vec3, b: Vec3): number => v3len(v3sub(a, b))
export const v3cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
})
export function v3norm(a: Vec3): Vec3 {
  const l = v3len(a)
  return l < 1e-12 ? { x: 0, y: 0, z: 0 } : { x: a.x / l, y: a.y / l, z: a.z / l }
}

/** Drop the vertical component: plan-space projection of a world point. */
export const v3toPlan = (a: Vec3): Vec2 => ({ x: a.x, z: a.z })
export const planToV3 = (a: Vec2, y: number): Vec3 => ({ x: a.x, y, z: a.z })

export const MAT3_IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]

export function mat3mul(a: Mat3, b: Mat3): Mat3 {
  const out = new Array<number>(9)
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]
    }
  }
  return out
}

export function mat3apply(m: Mat3, v: Vec3): Vec3 {
  return {
    x: m[0] * v.x + m[1] * v.y + m[2] * v.z,
    y: m[3] * v.x + m[4] * v.y + m[5] * v.z,
    z: m[6] * v.x + m[7] * v.y + m[8] * v.z,
  }
}

export function mat3transpose(m: Mat3): Mat3 {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]
}

export function mat3det(m: Mat3): number {
  return (
    m[0] * (m[4] * m[8] - m[5] * m[7]) -
    m[1] * (m[3] * m[8] - m[5] * m[6]) +
    m[2] * (m[3] * m[7] - m[4] * m[6])
  )
}

/** Rotation about the world Y (vertical) axis, radians, right-handed. */
export function rotY(theta: number): Mat3 {
  const c = Math.cos(theta)
  const s = Math.sin(theta)
  return [c, 0, s, 0, 1, 0, -s, 0, c]
}

/** Rotation about the camera-local X axis (pitch), radians. */
export function rotX(theta: number): Mat3 {
  const c = Math.cos(theta)
  const s = Math.sin(theta)
  return [1, 0, 0, 0, c, -s, 0, s, c]
}

/** Rotation about the camera-local Z axis (roll), radians. */
export function rotZ(theta: number): Mat3 {
  const c = Math.cos(theta)
  const s = Math.sin(theta)
  return [c, -s, 0, s, c, 0, 0, 0, 1]
}

/**
 * Re-orthonormalise a nearly-orthonormal matrix (modified Gram-Schmidt on rows).
 * Pose refinement accumulates drift; every solver result passes through here so
 * that downstream code may assume R is a true rotation.
 */
export function mat3orthonormalize(m: Mat3): Mat3 {
  let r0 = v3norm({ x: m[0], y: m[1], z: m[2] })
  let r1 = { x: m[3], y: m[4], z: m[5] }
  r1 = v3norm(v3sub(r1, v3scale(r0, v3dot(r0, r1))))
  const r2 = v3cross(r0, r1)
  return [r0.x, r0.y, r0.z, r1.x, r1.y, r1.z, r2.x, r2.y, r2.z]
}

export const deg2rad = (d: number): number => (d * Math.PI) / 180
export const rad2deg = (r: number): number => (r * 180) / Math.PI
export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x)

/** Round to a fixed number of decimals. Keeps exported JSON byte-stable. */
export const round = (x: number, decimals = 6): number => {
  const f = Math.pow(10, decimals)
  const r = Math.round(x * f) / f
  return Object.is(r, -0) ? 0 : r
}
