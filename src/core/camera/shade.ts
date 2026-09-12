/**
 * Architectural study rendering.
 *
 * The analyzer's scoring runs on masks and edge maps, which are the right
 * representation for measuring agreement and the wrong one for judging a
 * building. §40 requires the model to be *looked at*, and a flat silhouette
 * hides exactly the things a human needs to see: whether a reveal has depth,
 * whether a slab reads as a slab, whether glazing reads as glass.
 *
 * So this is a small but deliberate renderer in the idiom of a physical study
 * model — near-white monochrome solids, one soft key light, contact darkening
 * in the concave corners, restrained translucent glazing, and a light line
 * overlay on the structural edges. No textures, no colour, nothing that would
 * flatter the model into looking more resolved than it is.
 *
 * Two effects do most of the work:
 *
 *   screen-space cavity   sampling the depth buffer around each pixel and
 *                         darkening where neighbours are nearer approximates
 *                         the ambient occlusion that makes reveals, soffits and
 *                         slab undersides read as depth rather than as outline.
 *   deferred glazing      glass is rasterised after the opaque pass and
 *                         composited, so what is behind it shows through and it
 *                         reads as a window rather than a grey panel.
 *
 * PORT_DIRECT (Kotlin) — pure arithmetic over typed arrays.
 */
import type { RasterImage } from '../contracts/raster.js'
import type { Vec3 } from '../contracts/geometry.js'
import { v3cross, v3norm, v3sub, v3dot } from '../math/vec.js'
import type { CameraView, OrthographicView } from './projector.js'
import { toCamera, projectOrtho, orthoDepth } from './projector.js'
import type { Edge3 } from './render.js'
import { ORTHO_DEPTH_BIAS } from './render.js'
import type { BuildPart, BuildTri } from '../hypotheses/solid.js'

export type Material = {
  /** Base albedo, near-white for a study model. */
  colour: [number, number, number]
  /** 0 = opaque. Glass is the only translucent class. */
  transparency: number
  /** Extra specular sheen, used only for glazing. */
  sheen: number
}

/**
 * Materials. Values are close together on purpose: a study model is read by
 * form and shadow, not by colour, and strong tints would disguise geometry
 * problems as material variation.
 */
export const STUDY_MATERIALS: Record<BuildPart, Material> = {
  WALL: { colour: [246, 244, 240], transparency: 0, sheen: 0 },
  WALL_INNER: { colour: [232, 229, 224], transparency: 0, sheen: 0 },
  REVEAL: { colour: [224, 221, 215], transparency: 0, sheen: 0 },
  SLAB: { colour: [240, 238, 233], transparency: 0, sheen: 0 },
  ROOF: { colour: [226, 224, 219], transparency: 0, sheen: 0 },
  ROOF_SOFFIT: { colour: [214, 211, 206], transparency: 0, sheen: 0 },
  GLAZING: { colour: [176, 196, 208], transparency: 0.62, sheen: 0.35 },
  RAILING: { colour: [186, 202, 212], transparency: 0.55, sheen: 0.3 },
  FEATURE: { colour: [238, 236, 231], transparency: 0, sheen: 0 },
}

export type ShadeOptions = {
  lightDir: Vec3
  ambient: number
  background: [number, number, number]
  drawEdges: boolean
  edgeColour: [number, number, number]
  /** Strength of the screen-space cavity darkening, 0..1. */
  cavity: number
  /** Ground shadow plane at y = 0. */
  groundPlane: boolean
  materials: Record<BuildPart, Material>
}

export const DEFAULT_SHADE: ShadeOptions = {
  lightDir: v3norm({ x: -0.42, y: -0.82, z: -0.39 }),
  ambient: 0.55,
  background: [238, 237, 234],
  drawEdges: true,
  edgeColour: [96, 99, 104],
  cavity: 0.75,
  groundPlane: true,
  materials: STUDY_MATERIALS,
}

type Proj = { u: number; v: number; z: number }
type Projector = (p: Vec3) => Proj | null

type GBuffer = {
  width: number
  height: number
  colour: Float32Array
  depth: Float32Array
  /** Lambert term per pixel, kept so glazing can be lit consistently. */
  shade: Float32Array
  covered: Uint8Array
}

function makeBuffer(width: number, height: number, background: [number, number, number]): GBuffer {
  const colour = new Float32Array(width * height * 3)
  for (let i = 0; i < width * height; i++) {
    colour[i * 3] = background[0]
    colour[i * 3 + 1] = background[1]
    colour[i * 3 + 2] = background[2]
  }
  return {
    width,
    height,
    colour,
    depth: new Float32Array(width * height).fill(Number.POSITIVE_INFINITY),
    shade: new Float32Array(width * height).fill(1),
    covered: new Uint8Array(width * height),
  }
}

function rasterise(
  tris: readonly BuildTri[],
  project: Projector,
  buf: GBuffer,
  opts: ShadeOptions,
  pass: 'OPAQUE' | 'TRANSPARENT',
): void {
  for (const t of tris) {
    const material = opts.materials[t.part] ?? opts.materials.FEATURE
    const transparent = material.transparency > 0
    if ((pass === 'OPAQUE') === transparent) continue

    const pa = project(t.a)
    const pb = project(t.b)
    const pc = project(t.c)
    if (!pa || !pb || !pc) continue

    const normal = v3norm(v3cross(v3sub(t.b, t.a), v3sub(t.c, t.a)))
    const lambert = Math.abs(v3dot(normal, opts.lightDir))
    // A soft wrap keeps unlit faces readable instead of crushing them to black.
    const lit = opts.ambient + (1 - opts.ambient) * Math.pow(lambert, 0.85)
    const spec = material.sheen > 0 ? material.sheen * Math.pow(lambert, 6) * 90 : 0

    const minX = Math.max(0, Math.floor(Math.min(pa.u, pb.u, pc.u)))
    const maxX = Math.min(buf.width - 1, Math.ceil(Math.max(pa.u, pb.u, pc.u)))
    const minY = Math.max(0, Math.floor(Math.min(pa.v, pb.v, pc.v)))
    const maxY = Math.min(buf.height - 1, Math.ceil(Math.max(pa.v, pb.v, pc.v)))
    const area = (pb.u - pa.u) * (pc.v - pa.v) - (pc.u - pa.u) * (pb.v - pa.v)
    if (Math.abs(area) < 1e-9) continue
    const inv = 1 / area

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5
        const py = y + 0.5
        const w0 = ((pb.u - px) * (pc.v - py) - (pc.u - px) * (pb.v - py)) * inv
        const w1 = ((pc.u - px) * (pa.v - py) - (pa.u - px) * (pc.v - py)) * inv
        const w2 = 1 - w0 - w1
        if (w0 < -1e-9 || w1 < -1e-9 || w2 < -1e-9) continue
        const z = w0 * pa.z + w1 * pb.z + w2 * pc.z
        const i = y * buf.width + x

        if (pass === 'OPAQUE') {
          if (z >= buf.depth[i]) continue
          buf.depth[i] = z
          buf.shade[i] = lit
          buf.covered[i] = 1
          buf.colour[i * 3] = material.colour[0] * lit + spec
          buf.colour[i * 3 + 1] = material.colour[1] * lit + spec
          buf.colour[i * 3 + 2] = material.colour[2] * lit + spec
        } else {
          // Glazing composites over whatever the opaque pass left, and only
          // where it is actually in front of it.
          if (z > buf.depth[i] + 1e-4) continue
          const a = 1 - material.transparency
          const r = material.colour[0] * lit + spec
          const g = material.colour[1] * lit + spec
          const b = material.colour[2] * lit + spec
          buf.colour[i * 3] = buf.colour[i * 3] * (1 - a) + r * a
          buf.colour[i * 3 + 1] = buf.colour[i * 3 + 1] * (1 - a) + g * a
          buf.colour[i * 3 + 2] = buf.colour[i * 3 + 2] * (1 - a) + b * a
          buf.covered[i] = 1
        }
      }
    }
  }
}

/**
 * Screen-space cavity: darken a pixel in proportion to how much nearer its
 * neighbourhood is. Cheap, stable, and enough to make a 150 mm reveal or a
 * soffit read as depth on a near-white model.
 */
function applyCavity(buf: GBuffer, strength: number): void {
  if (strength <= 0) return
  const { width, height, depth } = buf
  const radius = Math.max(2, Math.round(Math.min(width, height) / 110))
  const out = new Float32Array(width * height).fill(1)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const z = depth[i]
      if (!Number.isFinite(z)) continue
      let occl = 0
      let n = 0
      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          if (dx === 0 && dy === 0) continue
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          const nz = depth[ny * width + nx]
          n++
          if (!Number.isFinite(nz)) continue
          // Only nearer geometry occludes, and only within a metre or so.
          const diff = z - nz
          if (diff > 0.004) occl += Math.min(1, diff / (z * 0.05 + 0.25))
        }
      }
      if (n === 0) continue
      out[i] = 1 - Math.min(0.55, (occl / n) * 2.6) * strength
    }
  }
  for (let i = 0; i < width * height; i++) {
    if (!buf.covered[i]) continue
    const f = out[i]
    buf.colour[i * 3] *= f
    buf.colour[i * 3 + 1] *= f
    buf.colour[i * 3 + 2] *= f
  }
}

function drawEdges(edges: readonly Edge3[], project: Projector, buf: GBuffer, colour: [number, number, number]): void {
  for (const e of edges) {
    const pa = project(e.a)
    const pb = project(e.b)
    if (!pa || !pb) continue
    const steps = Math.max(1, Math.ceil(Math.hypot(pb.u - pa.u, pb.v - pa.v)))
    const weight = e.kind === 'SILHOUETTE' || e.kind === 'ROOFLINE' ? 0.85 : 0.55
    for (let s = 0; s <= steps; s++) {
      const f = s / steps
      const x = Math.round(pa.u + (pb.u - pa.u) * f)
      const y = Math.round(pa.v + (pb.v - pa.v) * f)
      if (x < 0 || y < 0 || x >= buf.width || y >= buf.height) continue
      const z = pa.z + (pb.z - pa.z) * f
      const i = y * buf.width + x
      if (Number.isFinite(buf.depth[i]) && z > buf.depth[i] * 1.006 + 0.02) continue
      buf.colour[i * 3] = buf.colour[i * 3] * (1 - weight) + colour[0] * weight
      buf.colour[i * 3 + 1] = buf.colour[i * 3 + 1] * (1 - weight) + colour[1] * weight
      buf.colour[i * 3 + 2] = buf.colour[i * 3 + 2] * (1 - weight) + colour[2] * weight
    }
  }
}

function toImage(buf: GBuffer): RasterImage {
  const data = new Uint8ClampedArray(buf.width * buf.height * 4)
  for (let i = 0; i < buf.width * buf.height; i++) {
    data[i * 4] = buf.colour[i * 3]
    data[i * 4 + 1] = buf.colour[i * 3 + 1]
    data[i * 4 + 2] = buf.colour[i * 3 + 2]
    data[i * 4 + 3] = 255
  }
  return { width: buf.width, height: buf.height, data }
}

/** Ground plane quad, so the model sits on something rather than floating. */
function groundTris(tris: readonly BuildTri[]): BuildTri[] {
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const t of tris) {
    for (const p of [t.a, t.b, t.c]) {
      if (p.x < minX) minX = p.x
      if (p.x > maxX) maxX = p.x
      if (p.z < minZ) minZ = p.z
      if (p.z > maxZ) maxZ = p.z
    }
  }
  if (!Number.isFinite(minX)) return []
  const pad = Math.max(maxX - minX, maxZ - minZ) * 0.45
  const y = -0.02
  const a = { x: minX - pad, y, z: minZ - pad }
  const b = { x: maxX + pad, y, z: minZ - pad }
  const c = { x: maxX + pad, y, z: maxZ + pad }
  const d = { x: minX - pad, y, z: maxZ + pad }
  return [
    { a, b, c, ownerId: 'ground', part: 'SLAB' },
    { a, b: c, c: d, ownerId: 'ground', part: 'SLAB' },
  ]
}

export function shadePerspective(
  tris: readonly BuildTri[],
  edges: readonly Edge3[],
  view: CameraView,
  width: number,
  height: number,
  opts: ShadeOptions = DEFAULT_SHADE,
): RasterImage {
  const k = view.intrinsics
  const sx = width / view.width
  const sy = height / view.height
  const project: Projector = (p) => {
    const c = toCamera(p, view.extrinsics)
    if (c.z <= view.near) return null
    return { u: ((k.fx * c.x + k.skew * c.y) / c.z + k.cx) * sx, v: ((k.fy * c.y) / c.z + k.cy) * sy, z: c.z }
  }
  const buf = makeBuffer(width, height, opts.background)
  const all = opts.groundPlane ? [...groundTris(tris), ...tris] : [...tris]
  rasterise(all, project, buf, opts, 'OPAQUE')
  applyCavity(buf, opts.cavity)
  rasterise(all, project, buf, opts, 'TRANSPARENT')
  if (opts.drawEdges) drawEdges(edges, project, buf, opts.edgeColour)
  return toImage(buf)
}

export function shadeOrthographic(
  tris: readonly BuildTri[],
  edges: readonly Edge3[],
  view: OrthographicView,
  width: number,
  height: number,
  opts: ShadeOptions = DEFAULT_SHADE,
): RasterImage {
  const sx = width / view.width
  const sy = height / view.height
  const project: Projector = (p) => {
    const q = projectOrtho(p, view)
    return { u: q.u * sx, v: q.v * sy, z: orthoDepth(p, view) + ORTHO_DEPTH_BIAS }
  }
  const buf = makeBuffer(width, height, opts.background)
  rasterise(tris, project, buf, opts, 'OPAQUE')
  applyCavity(buf, opts.cavity * 0.8)
  rasterise(tris, project, buf, opts, 'TRANSPARENT')
  if (opts.drawEdges) drawEdges(edges, project, buf, opts.edgeColour)
  return toImage(buf)
}
