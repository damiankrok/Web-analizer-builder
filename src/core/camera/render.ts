/**
 * Software rasteriser: depth buffer, silhouette mask and visible-edge map for a
 * building hypothesis under a camera (§13, §34).
 *
 * This is the analyzer's own renderer, not Three.js. Three.js is a viewer and a
 * debug surface (§45); scoring truth has to come from code that is portable,
 * deterministic and free of GPU/driver variation, or "same assets -> same
 * score" (§48) cannot hold.
 *
 * Resolution is bounded (§49): scoring runs on a small buffer because silhouette
 * IoU and chamfer distance do not get meaningfully better with more pixels.
 *
 * PORT_DIRECT (Kotlin).
 */
import type { MaskImage } from '../contracts/raster.js'
import { makeMask } from '../contracts/raster.js'
import type { Vec3 } from '../math/vec.js'
import type { CameraView, OrthographicView } from './projector.js'
import { orthoDepth, projectOrtho, toCamera } from './projector.js'

/** A triangle tagged with the hypothesis element it belongs to. */
export type Tri = {
  a: Vec3
  b: Vec3
  c: Vec3
  /** Element id (mass, roof, opening...) used for per-feature visibility. */
  ownerId: string
}

/** A world-space edge tagged with its owner, used for edge-map scoring. */
export type Edge3 = {
  a: Vec3
  b: Vec3
  ownerId: string
  /** Silhouette and roofline edges carry more weight than incidental ones. */
  kind: 'SILHOUETTE' | 'ROOFLINE' | 'OPENING' | 'MASS' | 'OTHER'
}

export type RenderTarget = {
  width: number
  height: number
  /** Per-pixel nearest depth; +Infinity where nothing was drawn. */
  depth: Float32Array
  /** 1 where any geometry was drawn. */
  mask: MaskImage
  /** Index into the triangle list of the nearest surface, -1 where empty. */
  triIndex: Int32Array
}

export function makeTarget(width: number, height: number): RenderTarget {
  const depth = new Float32Array(width * height)
  depth.fill(Number.POSITIVE_INFINITY)
  return { width, height, depth, mask: makeMask(width, height), triIndex: new Int32Array(width * height).fill(-1) }
}

/** Keeps orthographic depths positive for the rasteriser's 1/z interpolation. */
export const ORTHO_DEPTH_BIAS = 1e4

type P2 = { u: number; v: number; invZ: number }

function rasterTriangle(t: RenderTarget, p0: P2, p1: P2, p2: P2, index: number): void {
  const minX = Math.max(0, Math.floor(Math.min(p0.u, p1.u, p2.u)))
  const maxX = Math.min(t.width - 1, Math.ceil(Math.max(p0.u, p1.u, p2.u)))
  const minY = Math.max(0, Math.floor(Math.min(p0.v, p1.v, p2.v)))
  const maxY = Math.min(t.height - 1, Math.ceil(Math.max(p0.v, p1.v, p2.v)))
  if (minX > maxX || minY > maxY) return

  const area = (p1.u - p0.u) * (p2.v - p0.v) - (p2.u - p0.u) * (p1.v - p0.v)
  if (Math.abs(area) < 1e-9) return
  const inv = 1 / area

  for (let y = minY; y <= maxY; y++) {
    const py = y + 0.5
    for (let x = minX; x <= maxX; x++) {
      const pxx = x + 0.5
      const w0 = ((p1.u - pxx) * (p2.v - py) - (p2.u - pxx) * (p1.v - py)) * inv
      const w1 = ((p2.u - pxx) * (p0.v - py) - (p0.u - pxx) * (p2.v - py)) * inv
      const w2 = 1 - w0 - w1
      if (w0 < -1e-9 || w1 < -1e-9 || w2 < -1e-9) continue
      // Interpolate 1/z: linear in screen space, unlike z itself.
      const invZ = w0 * p0.invZ + w1 * p1.invZ + w2 * p2.invZ
      if (invZ <= 0) continue
      const z = 1 / invZ
      const i = y * t.width + x
      if (z < t.depth[i]) {
        t.depth[i] = z
        t.mask.data[i] = 1
        t.triIndex[i] = index
      }
    }
  }
}

/** Clip a camera-space triangle against z = near, returning 0, 1 or 2 triangles. */
function clipNear(a: Vec3, b: Vec3, c: Vec3, near: number): Vec3[][] {
  const pts = [a, b, c]
  const inside = pts.map((p) => p.z > near)
  const count = inside.filter(Boolean).length
  if (count === 3) return [[a, b, c]]
  if (count === 0) return []
  const lerp = (p: Vec3, q: Vec3): Vec3 => {
    const t = (near - p.z) / (q.z - p.z)
    return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t, z: near }
  }
  const out: Vec3[] = []
  for (let i = 0; i < 3; i++) {
    const cur = pts[i]
    const next = pts[(i + 1) % 3]
    if (inside[i]) out.push(cur)
    if (inside[i] !== inside[(i + 1) % 3]) out.push(lerp(cur, next))
  }
  if (out.length === 3) return [[out[0], out[1], out[2]]]
  if (out.length === 4) return [[out[0], out[1], out[2]], [out[0], out[2], out[3]]]
  return []
}

export function renderPerspective(tris: readonly Tri[], view: CameraView, width: number, height: number): RenderTarget {
  const target = makeTarget(width, height)
  const sx = width / view.width
  const sy = height / view.height
  const k = view.intrinsics
  for (let i = 0; i < tris.length; i++) {
    const t = tris[i]
    const ca = toCamera(t.a, view.extrinsics)
    const cb = toCamera(t.b, view.extrinsics)
    const cc = toCamera(t.c, view.extrinsics)
    for (const poly of clipNear(ca, cb, cc, view.near)) {
      const proj = poly.map((p) => ({
        u: ((k.fx * p.x + k.skew * p.y) / p.z + k.cx) * sx,
        v: ((k.fy * p.y) / p.z + k.cy) * sy,
        invZ: 1 / p.z,
      }))
      rasterTriangle(target, proj[0], proj[1], proj[2], i)
    }
  }
  return target
}

export function renderOrthographic(tris: readonly Tri[], view: OrthographicView, width: number, height: number): RenderTarget {
  const target = makeTarget(width, height)
  const sx = width / view.width
  const sy = height / view.height
  for (let i = 0; i < tris.length; i++) {
    const t = tris[i]
    const pts = [t.a, t.b, t.c].map((p) => {
      const q = projectOrtho(p, view)
      // Orthographic depth is linear, so store it directly as 1/z-equivalent by
      // shifting it into a strictly positive range.
      // An orthographic projection has no perspective divide, so the
      // rasteriser's 1/z interpolation must be fed a biased depth that stays
      // positive and monotonic for geometry on either side of the origin.
      return { u: q.u * sx, v: q.v * sy, invZ: 1 / Math.max(1e-3, orthoDepth(p, view) + ORTHO_DEPTH_BIAS) }
    })
    rasterTriangle(target, pts[0], pts[1], pts[2], i)
  }
  return target
}

export type VisibilityVerdict = {
  /** Projects inside the image at all. */
  inFrame: boolean
  /** Inside the image and not hidden by nearer geometry. */
  visible: boolean
  /** Hidden by geometry closer to the camera. */
  occluded: boolean
  /** Falls outside the image rectangle (crop / FOV). */
  cropped: boolean
  depth: number
  occluderTriIndex: number
}

/**
 * Visibility of a world point against a rendered depth buffer (§34).
 *
 * The tolerance matters: a point that lies exactly *on* a rendered surface —
 * a mass corner, an opening centroid on its facade — must read as visible, not
 * as self-occluded by the surface it belongs to. The tolerance scales with
 * depth because a fixed metric slack is far too tight up close and far too
 * loose at distance.
 */
export function pointVisibility(
  world: Vec3,
  view: CameraView,
  target: RenderTarget,
  relativeTolerance = 0.02,
): VisibilityVerdict {
  const c = toCamera(world, view.extrinsics)
  if (c.z <= view.near) {
    return { inFrame: false, visible: false, occluded: false, cropped: true, depth: c.z, occluderTriIndex: -1 }
  }
  const k = view.intrinsics
  const u = ((k.fx * c.x + k.skew * c.y) / c.z + k.cx) * (target.width / view.width)
  const v = ((k.fy * c.y) / c.z + k.cy) * (target.height / view.height)
  const x = Math.round(u - 0.5)
  const y = Math.round(v - 0.5)
  if (x < 0 || y < 0 || x >= target.width || y >= target.height) {
    return { inFrame: false, visible: false, occluded: false, cropped: true, depth: c.z, occluderTriIndex: -1 }
  }
  const i = y * target.width + x
  const front = target.depth[i]
  const tol = Math.max(0.01, c.z * relativeTolerance)
  const occluded = Number.isFinite(front) && front < c.z - tol
  return {
    inFrame: true,
    visible: !occluded,
    occluded,
    cropped: false,
    depth: c.z,
    occluderTriIndex: occluded ? target.triIndex[i] : -1,
  }
}

/**
 * Rasterise world-space edges into a mask, keeping only the parts that survive
 * a depth test against the rendered surfaces. This is the candidate edge map
 * that the symmetric chamfer score compares against the source edges (§35).
 */
export function renderEdges(
  edges: readonly Edge3[],
  view: CameraView,
  target: RenderTarget,
  relativeTolerance = 0.03,
): MaskImage {
  const out = makeMask(target.width, target.height)
  const k = view.intrinsics
  const sx = target.width / view.width
  const sy = target.height / view.height
  for (const e of edges) {
    const ca = toCamera(e.a, view.extrinsics)
    const cb = toCamera(e.b, view.extrinsics)
    const inA = ca.z > view.near
    const inB = cb.z > view.near
    if (!inA && !inB) continue
    let pa = ca
    let pb = cb
    if (!inA || !inB) {
      const from = inA ? ca : cb
      const to = inA ? cb : ca
      const t = (view.near - from.z) / (to.z - from.z)
      const cut = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, z: view.near }
      if (inA) pb = cut
      else pa = cut
    }
    const ua = ((k.fx * pa.x + k.skew * pa.y) / pa.z + k.cx) * sx
    const va = ((k.fy * pa.y) / pa.z + k.cy) * sy
    const ub = ((k.fx * pb.x + k.skew * pb.y) / pb.z + k.cx) * sx
    const vb = ((k.fy * pb.y) / pb.z + k.cy) * sy
    const steps = Math.max(1, Math.ceil(Math.hypot(ub - ua, vb - va)))
    for (let s = 0; s <= steps; s++) {
      const f = s / steps
      const x = Math.round(ua + (ub - ua) * f)
      const y = Math.round(va + (vb - va) * f)
      if (x < 0 || y < 0 || x >= target.width || y >= target.height) continue
      // Depth at this point: interpolate 1/z for perspective correctness.
      const invZ = (1 - f) / pa.z + f / pb.z
      const z = 1 / invZ
      const i = y * target.width + x
      const front = target.depth[i]
      if (Number.isFinite(front) && front < z - Math.max(0.01, z * relativeTolerance)) continue
      out.data[i] = 1
    }
  }
  return out
}

/**
 * Same for an orthographic view. Depths in the target are biased by
 * ORTHO_DEPTH_BIAS; the comparison below works in those same units.
 */
export function renderEdgesOrtho(
  edges: readonly Edge3[],
  view: OrthographicView,
  target: RenderTarget,
): MaskImage {
  const out = makeMask(target.width, target.height)
  const sx = target.width / view.width
  const sy = target.height / view.height
  for (const e of edges) {
    const pa = projectOrtho(e.a, view)
    const pb = projectOrtho(e.b, view)
    const ua = pa.u * sx
    const va = pa.v * sy
    const ub = pb.u * sx
    const vb = pb.v * sy
    const steps = Math.max(1, Math.ceil(Math.hypot(ub - ua, vb - va)))
    const da = orthoDepth(e.a, view)
    const db = orthoDepth(e.b, view)
    for (let s = 0; s <= steps; s++) {
      const f = s / steps
      const x = Math.round(ua + (ub - ua) * f)
      const y = Math.round(va + (vb - va) * f)
      if (x < 0 || y < 0 || x >= target.width || y >= target.height) continue
      // The orthographic target stores (depth + ORTHO_DEPTH_BIAS), which is
      // monotonic in depth, so compare in exactly those units.
      const z = da + (db - da) * f + ORTHO_DEPTH_BIAS
      const i = y * target.width + x
      const front = target.depth[i]
      if (Number.isFinite(front) && front < z - 0.05) continue
      out.data[i] = 1
    }
  }
  return out
}
