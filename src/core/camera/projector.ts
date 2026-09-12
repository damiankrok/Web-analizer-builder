/**
 * Pure projection math (§13). Deterministic, dependency-free, and the module
 * the whole solver is built on: Three.js never owns projection truth (§45).
 *
 * Conventions
 *   WORLD  metres, +X east, +Y up, +Z south.
 *   CAMERA +x right, +y down, +z forward (into the scene). Chosen so that the
 *          intrinsic matrix is the textbook K and the image v axis points down
 *          like every image coordinate in this codebase.
 *   IMAGE  pixels, origin top-left.
 *
 *   x_cam = R * x_world + t          (R is world->camera)
 *   [u v 1]^T ~ K * x_cam,  K = [[fx, skew, cx], [0, fy, cy], [0, 0, 1]]
 *
 * PORT_DIRECT (Kotlin).
 */
import type { CameraExtrinsics, CameraIntrinsics } from '../contracts/camera.js'
import type { Mat3, Vec3 } from '../math/vec.js'
import { mat3apply, mat3orthonormalize, mat3transpose, v3add, v3cross, v3norm, v3scale, v3sub } from '../math/vec.js'

/** A camera plus the raster it projects into. */
export type CameraView = {
  intrinsics: CameraIntrinsics
  extrinsics: CameraExtrinsics
  width: number
  height: number
  /** Points closer than this are behind the camera for projection purposes. */
  near: number
}

export type Projected = {
  u: number
  v: number
  /** Depth along the camera's +z axis, metres. */
  depth: number
  /** In front of the near plane and inside the image rectangle. */
  visible: boolean
  /** In front of the near plane, regardless of image bounds. */
  inFront: boolean
}

export const DEFAULT_NEAR = 0.05

export function intrinsicsFromFovY(
  fovY: number,
  width: number,
  height: number,
  principal?: { cx: number; cy: number },
): CameraIntrinsics {
  const fy = height / (2 * Math.tan(fovY / 2))
  return {
    fx: fy,
    fy,
    cx: principal?.cx ?? width / 2,
    cy: principal?.cy ?? height / 2,
    skew: 0,
  }
}

/** World -> camera transform of a point. */
export function toCamera(x: Vec3, e: CameraExtrinsics): Vec3 {
  return v3add(mat3apply(e.rotation, x), e.translation)
}

/** Camera -> world transform of a point. */
export function toWorld(x: Vec3, e: CameraExtrinsics): Vec3 {
  const rt = mat3transpose(e.rotation)
  return mat3apply(rt, v3sub(x, e.translation))
}

/** Camera centre in world coordinates: C = -R^T t. */
export function cameraCentre(e: CameraExtrinsics): Vec3 {
  return v3scale(mat3apply(mat3transpose(e.rotation), e.translation), -1)
}

export function project(world: Vec3, view: CameraView): Projected {
  const c = toCamera(world, view.extrinsics)
  const inFront = c.z > view.near
  if (!inFront) {
    return { u: Number.NaN, v: Number.NaN, depth: c.z, visible: false, inFront: false }
  }
  const k = view.intrinsics
  const u = (k.fx * c.x + k.skew * c.y) / c.z + k.cx
  const v = (k.fy * c.y) / c.z + k.cy
  const visible = u >= 0 && v >= 0 && u < view.width && v < view.height
  return { u, v, depth: c.z, visible, inFront: true }
}

/**
 * Build extrinsics from an eye point and a target.
 *
 * `roll` rotates about the viewing axis. Architectural renders are level, so it
 * defaults to zero, but it stays a parameter rather than an assumption.
 */
export function lookAt(eye: Vec3, target: Vec3, roll = 0, worldUp: Vec3 = { x: 0, y: 1, z: 0 }): CameraExtrinsics {
  const forward = v3norm(v3sub(target, eye))
  let right = v3cross(forward, worldUp)
  if (Math.hypot(right.x, right.y, right.z) < 1e-6) {
    // Looking straight up or down: pick any consistent right vector.
    right = v3cross(forward, { x: 1, y: 0, z: 0 })
  }
  right = v3norm(right)
  // Camera +y points down, so it is the negative of the scene up vector.
  const down = v3norm(v3cross(forward, right))

  let rotation: Mat3 = [right.x, right.y, right.z, down.x, down.y, down.z, forward.x, forward.y, forward.z]
  if (roll !== 0) {
    const c = Math.cos(roll)
    const s = Math.sin(roll)
    const rz: Mat3 = [c, -s, 0, s, c, 0, 0, 0, 1]
    const m: number[] = new Array(9).fill(0)
    for (let r = 0; r < 3; r++) {
      for (let col = 0; col < 3; col++) {
        m[r * 3 + col] =
          rz[r * 3] * rotation[col] + rz[r * 3 + 1] * rotation[3 + col] + rz[r * 3 + 2] * rotation[6 + col]
      }
    }
    rotation = m
  }
  rotation = mat3orthonormalize(rotation)
  const translation = v3scale(mat3apply(rotation, eye), -1)
  return { rotation, translation }
}

/** Ray direction in world space through an image pixel (unit length). */
export function unproject(u: number, v: number, view: CameraView): Vec3 {
  const k = view.intrinsics
  const y = (v - k.cy) / k.fy
  const x = (u - k.cx - k.skew * y) / k.fx
  const dirCam = { x, y, z: 1 }
  const rt = mat3transpose(view.extrinsics.rotation)
  return v3norm(mat3apply(rt, dirCam))
}

export type ProjectedSegment = {
  a: { u: number; v: number }
  b: { u: number; v: number }
  /** False when the whole segment is behind the camera. */
  valid: boolean
  /** True when the segment was clipped against the near plane. */
  clipped: boolean
  depthA: number
  depthB: number
}

/**
 * Project a world-space line segment, clipping it against the near plane.
 * Without clipping, a segment crossing behind the camera projects to a wild
 * line across the image and poisons every line-based residual.
 */
export function projectSegment(a: Vec3, b: Vec3, view: CameraView): ProjectedSegment {
  const ca = toCamera(a, view.extrinsics)
  const cb = toCamera(b, view.extrinsics)
  const inA = ca.z > view.near
  const inB = cb.z > view.near
  if (!inA && !inB) {
    return { a: { u: 0, v: 0 }, b: { u: 0, v: 0 }, valid: false, clipped: true, depthA: ca.z, depthB: cb.z }
  }
  let pa = ca
  let pb = cb
  let clipped = false
  if (!inA) {
    const t = (view.near - ca.z) / (cb.z - ca.z)
    pa = { x: ca.x + (cb.x - ca.x) * t, y: ca.y + (cb.y - ca.y) * t, z: view.near }
    clipped = true
  } else if (!inB) {
    const t = (view.near - cb.z) / (ca.z - cb.z)
    pb = { x: cb.x + (ca.x - cb.x) * t, y: cb.y + (ca.y - cb.y) * t, z: view.near }
    clipped = true
  }
  const k = view.intrinsics
  const proj = (p: Vec3): { u: number; v: number } => ({
    u: (k.fx * p.x + k.skew * p.y) / p.z + k.cx,
    v: (k.fy * p.y) / p.z + k.cy,
  })
  return { a: proj(pa), b: proj(pb), valid: true, clipped, depthA: ca.z, depthB: cb.z }
}

/**
 * Project a closed polygon, clipping against the near plane (Sutherland-Hodgman
 * on the single z = near plane). Returns an empty ring when fully behind.
 */
export function projectPolygon(points: readonly Vec3[], view: CameraView): Array<{ u: number; v: number }> {
  if (points.length === 0) return []
  const cam = points.map((p) => toCamera(p, view.extrinsics))
  const clippedPts: Vec3[] = []
  for (let i = 0; i < cam.length; i++) {
    const cur = cam[i]
    const next = cam[(i + 1) % cam.length]
    const curIn = cur.z > view.near
    const nextIn = next.z > view.near
    if (curIn) clippedPts.push(cur)
    if (curIn !== nextIn) {
      const t = (view.near - cur.z) / (next.z - cur.z)
      clippedPts.push({ x: cur.x + (next.x - cur.x) * t, y: cur.y + (next.y - cur.y) * t, z: view.near })
    }
  }
  const k = view.intrinsics
  return clippedPts.map((p) => ({
    u: (k.fx * p.x + k.skew * p.y) / p.z + k.cx,
    v: (k.fy * p.y) / p.z + k.cy,
  }))
}

/** Whether a world point lies inside the view frustum. */
export function inFrustum(world: Vec3, view: CameraView): boolean {
  return project(world, view).visible
}

/**
 * Orthographic view, used for technical elevations (§18). These have no camera
 * centre: the projection is a scaled, translated orthonormal basis change.
 */
export type OrthographicView = {
  /** Unit world direction mapping to image +u. */
  right: Vec3
  /** Unit world direction mapping to image -v (i.e. up on the page). */
  up: Vec3
  /** Pixels per metre. */
  scale: number
  /** World point that maps to (originU, originV). */
  origin: Vec3
  originU: number
  originV: number
  width: number
  height: number
}

export function projectOrtho(world: Vec3, view: OrthographicView): { u: number; v: number; visible: boolean } {
  const d = v3sub(world, view.origin)
  const s = d.x * view.right.x + d.y * view.right.y + d.z * view.right.z
  const t = d.x * view.up.x + d.y * view.up.y + d.z * view.up.z
  const u = view.originU + s * view.scale
  const v = view.originV - t * view.scale
  return { u, v, visible: u >= 0 && v >= 0 && u < view.width && v < view.height }
}

/** Depth of a point along the orthographic viewing direction (for visibility). */
export function orthoDepth(world: Vec3, view: OrthographicView): number {
  const forward = v3cross(view.up, view.right)
  const d = v3sub(world, view.origin)
  return d.x * forward.x + d.y * forward.y + d.z * forward.z
}
