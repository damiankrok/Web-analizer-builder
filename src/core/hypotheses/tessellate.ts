/**
 * Hypothesis -> triangles, edges and semantic anchors.
 *
 * One conversion feeds three consumers: the software rasteriser (silhouette and
 * depth), the edge-map scorer, and the camera solver's 3D anchor points. Having
 * a single source keeps a rendered candidate and the points a camera was fitted
 * to describing the same building — if they drifted apart, a camera could score
 * well against geometry the renderer never drew.
 *
 * PORT_DIRECT (Kotlin).
 */
import type { BuildingHypothesis } from '../contracts/hypotheses.js'
import type { Vec2, Vec3 } from '../contracts/geometry.js'
import { boundsOf } from '../contracts/geometry.js'
import type { AnchorKind } from '../contracts/camera.js'
import type { Edge3, Tri } from '../camera/render.js'
import { facadeFrame } from './frames.js'
import { buildSolidModel, type BuildPart, type BuildTri, type SolidModel } from './solid.js'

export type Anchor3D = {
  id: string
  kind: AnchorKind
  world: Vec3
  /** What produced it, for provenance in the export. */
  ownerId: string
  /** Relative usefulness as a correspondence target. */
  weight: number
}

export type Tessellation = {
  tris: BuildTri[]
  edges: Edge3[]
  anchors: Anchor3D[]
  /** Areas a takeoff would want, from the solid generation. */
  quantities: SolidModel['quantities']
}

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z })

function quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, ownerId: string, part: BuildPart = 'FEATURE'): BuildTri[] {
  return [
    { a, b, c, ownerId, part },
    { a, b: c, c: d, ownerId, part },
  ]
}

/** Geometry for the named architectural features (§19, §37). */
function appearanceGeometry(
  h: BuildingHypothesis,
  bounds: ReturnType<typeof boundsOf>,
  edges: Edge3[],
  anchors: Anchor3D[],
): BuildTri[] {
  const tris: BuildTri[] = []
  for (const f of h.appearance) {
    switch (f.kind) {
      case 'CHIMNEY': {
        if (!f.world) break
        const w = (f.widthM ?? 0.5) / 2
        const d = w
        const top = f.world.y + (f.heightM ?? 1)
        const base = f.world.y - 0.4
        const corners = [
          { x: f.world.x - w, z: f.world.z - d },
          { x: f.world.x + w, z: f.world.z - d },
          { x: f.world.x + w, z: f.world.z + d },
          { x: f.world.x - w, z: f.world.z + d },
        ]
        for (let i = 0; i < 4; i++) {
          const p = corners[i]
          const q = corners[(i + 1) % 4]
          tris.push(...quad(v(p.x, base, p.z), v(q.x, base, q.z), v(q.x, top, q.z), v(p.x, top, p.z), f.id))
          edges.push({ a: v(p.x, top, p.z), b: v(q.x, top, q.z), ownerId: f.id, kind: 'SILHOUETTE' })
          edges.push({ a: v(p.x, base, p.z), b: v(p.x, top, p.z), ownerId: f.id, kind: 'SILHOUETTE' })
        }
        tris.push(
          ...quad(
            v(corners[0].x, top, corners[0].z),
            v(corners[1].x, top, corners[1].z),
            v(corners[2].x, top, corners[2].z),
            v(corners[3].x, top, corners[3].z),
            f.id,
          ),
        )
        anchors.push({ id: `${f.id}_top`, kind: 'MASS_CORNER', world: v(f.world.x, top, f.world.z), ownerId: f.id, weight: 0.7 })
        break
      }
      case 'BAND':
      case 'PLINTH': {
        if (!f.facade) break
        const frame = facadeFrame(f.facade, bounds)
        const s0 = f.s ?? 0
        const s1 = s0 + (f.widthM ?? frame.widthM)
        const t0 = f.t ?? 0
        const t1 = t0 + (f.heightM ?? 0.25)
        // A slab edge or render band projects a few centimetres, not a ledge.
        const out = f.kind === 'PLINTH' ? 0.05 : 0.07
        const pt = (s: number, t: number, o: number): Vec3 => ({
          x: frame.origin.x + frame.right.x * s + frame.normal.x * o,
          y: t,
          z: frame.origin.z + frame.right.z * s + frame.normal.z * o,
        })
        const a0 = pt(s0, t0, out)
        const a1 = pt(s1, t0, out)
        const a2 = pt(s1, t1, out)
        const a3 = pt(s0, t1, out)
        const b0 = pt(s0, t0, 0)
        const b1 = pt(s1, t0, 0)
        const b2 = pt(s1, t1, 0)
        const b3 = pt(s0, t1, 0)
        tris.push(...quad(a0, a1, a2, a3, f.id))
        tris.push(...quad(a3, a2, b2, b3, f.id))
        tris.push(...quad(a0, a1, b1, b0, f.id))
        edges.push({ a: a3, b: a2, ownerId: f.id, kind: 'MASS' })
        edges.push({ a: a0, b: a1, ownerId: f.id, kind: 'MASS' })
        break
      }
      case 'RAILING': {
        if (!f.facade) break
        const frame = facadeFrame(f.facade, bounds)
        const s0 = f.s ?? 0
        const s1 = s0 + (f.widthM ?? 2)
        const t0 = f.t ?? 0
        const t1 = t0 + (f.heightM ?? 1.05)
        const out = 0.06
        const pt = (s: number, t: number): Vec3 => ({
          x: frame.origin.x + frame.right.x * s + frame.normal.x * out,
          y: t,
          z: frame.origin.z + frame.right.z * s + frame.normal.z * out,
        })
        // A glass balustrade: one thin panel plus its capping rail.
        tris.push(...quad(pt(s0, t0), pt(s1, t0), pt(s1, t1), pt(s0, t1), `${f.id}_glass`, 'GLAZING'))
        edges.push({ a: pt(s0, t1), b: pt(s1, t1), ownerId: f.id, kind: 'SILHOUETTE' })
        edges.push({ a: pt(s0, t0), b: pt(s0, t1), ownerId: f.id, kind: 'OTHER' })
        edges.push({ a: pt(s1, t0), b: pt(s1, t1), ownerId: f.id, kind: 'OTHER' })
        break
      }
      case 'PORTAL':
      case 'PIER': {
        if (!f.facade) break
        const frame = facadeFrame(f.facade, bounds)
        const s0 = f.s ?? 0
        const s1 = s0 + (f.widthM ?? 0.4)
        const t0 = f.t ?? 0
        const t1 = t0 + (f.heightM ?? 2.5)
        const out = 0.16
        const pt = (s: number, t: number, o: number): Vec3 => ({
          x: frame.origin.x + frame.right.x * s + frame.normal.x * o,
          y: t,
          z: frame.origin.z + frame.right.z * s + frame.normal.z * o,
        })
        tris.push(...quad(pt(s0, t0, out), pt(s1, t0, out), pt(s1, t1, out), pt(s0, t1, out), f.id))
        tris.push(...quad(pt(s0, t0, 0), pt(s0, t0, out), pt(s0, t1, out), pt(s0, t1, 0), f.id))
        tris.push(...quad(pt(s1, t0, 0), pt(s1, t0, out), pt(s1, t1, out), pt(s1, t1, 0), f.id))
        edges.push({ a: pt(s0, t0, out), b: pt(s0, t1, out), ownerId: f.id, kind: 'SILHOUETTE' })
        edges.push({ a: pt(s1, t0, out), b: pt(s1, t1, out), ownerId: f.id, kind: 'SILHOUETTE' })
        edges.push({ a: pt(s0, t1, out), b: pt(s1, t1, out), ownerId: f.id, kind: 'SILHOUETTE' })
        break
      }
      default:
        break
    }
  }
  return tris
}

/**
 * Build the model and the semantic anchors together.
 *
 * The solid generator produces the geometry; anchors are derived from the
 * hypothesis rather than from that geometry, so a camera is fitted to named
 * architectural points — ridge ends, mass corners, opening centroids — and not
 * to whichever triangle happened to be emitted.
 */
export function tessellate(h: BuildingHypothesis): Tessellation {
  const model = buildSolidModel(h)
  const tris = model.tris
  const edges = model.edges
  const anchors: Anchor3D[] = []
  const bounds = boundsOf(h.masses.flatMap((m) => m.footprint.outer))

  for (const mass of h.masses) {
    const roof = h.roofs.find((r) => r.massId === mass.id)
    const topY = roof && roof.kind !== 'FLAT' && roof.kind !== 'NONE' ? roof.eaveY : (roof?.ridgeY ?? mass.topY)
    const ring = mass.footprint.outer
    for (let i = 0; i < ring.length; i++) {
      anchors.push({
        id: `${mass.id}_corner_${i}_top`,
        kind: mass.kind === 'GARAGE' ? 'GARAGE_CORNER' : 'MASS_CORNER',
        world: v(ring[i].x, topY, ring[i].z),
        ownerId: mass.id,
        weight: 1,
      })
      anchors.push({
        id: `${mass.id}_corner_${i}_base`,
        kind: 'GROUND_CORNER',
        world: v(ring[i].x, mass.baseY, ring[i].z),
        ownerId: mass.id,
        weight: 0.7,
      })
    }
    if (!roof || roof.kind === 'FLAT' || roof.kind === 'NONE' || roof.pitchDeg <= 0) continue
    const b = boundsOf(ring)
    const alongZ = (roof.ridgeDir?.z ?? 1) !== 0
    const oh = roof.overhangM
    const drop = oh * Math.tan((roof.pitchDeg * Math.PI) / 180)
    if (alongZ) {
      const midX = (b.minX + b.maxX) / 2
      anchors.push(
        { id: `${roof.id}_ridge_a`, kind: 'RIDGE_END', world: v(midX, roof.ridgeY, b.minZ - oh), ownerId: roof.id, weight: 1 },
        { id: `${roof.id}_ridge_b`, kind: 'RIDGE_END', world: v(midX, roof.ridgeY, b.maxZ + oh), ownerId: roof.id, weight: 1 },
        { id: `${roof.id}_eave_la`, kind: 'EAVE_END', world: v(b.minX - oh, roof.eaveY - drop, b.minZ - oh), ownerId: roof.id, weight: 0.9 },
        { id: `${roof.id}_eave_lb`, kind: 'EAVE_END', world: v(b.minX - oh, roof.eaveY - drop, b.maxZ + oh), ownerId: roof.id, weight: 0.9 },
        { id: `${roof.id}_eave_ra`, kind: 'EAVE_END', world: v(b.maxX + oh, roof.eaveY - drop, b.minZ - oh), ownerId: roof.id, weight: 0.9 },
        { id: `${roof.id}_eave_rb`, kind: 'EAVE_END', world: v(b.maxX + oh, roof.eaveY - drop, b.maxZ + oh), ownerId: roof.id, weight: 0.9 },
      )
    } else {
      const midZ = (b.minZ + b.maxZ) / 2
      anchors.push(
        { id: `${roof.id}_ridge_a`, kind: 'RIDGE_END', world: v(b.minX - oh, roof.ridgeY, midZ), ownerId: roof.id, weight: 1 },
        { id: `${roof.id}_ridge_b`, kind: 'RIDGE_END', world: v(b.maxX + oh, roof.ridgeY, midZ), ownerId: roof.id, weight: 1 },
        { id: `${roof.id}_eave_la`, kind: 'EAVE_END', world: v(b.minX - oh, roof.eaveY - drop, b.minZ - oh), ownerId: roof.id, weight: 0.9 },
        { id: `${roof.id}_eave_rb`, kind: 'EAVE_END', world: v(b.maxX + oh, roof.eaveY - drop, b.maxZ + oh), ownerId: roof.id, weight: 0.9 },
      )
    }
  }

  for (const g of h.openingGroups) {
    const frame = facadeFrame(g.facade, bounds)
    const corner = (s: number, t: number): Vec3 => ({
      x: frame.origin.x + frame.right.x * s,
      y: t,
      z: frame.origin.z + frame.right.z * s,
    })
    const c0 = corner(g.s, g.sillY)
    const c2 = corner(g.s + g.widthM, g.sillY + g.heightM)
    anchors.push({
      id: `${g.id}_centroid`,
      kind: 'OPENING_GROUP_CENTROID',
      world: { x: (c0.x + c2.x) / 2, y: (c0.y + c2.y) / 2, z: (c0.z + c2.z) / 2 },
      ownerId: g.id,
      weight: 0.8,
    })
    anchors.push({ id: `${g.id}_c0`, kind: 'OPENING_GROUP_CORNER', world: c0, ownerId: g.id, weight: 0.6 })
    anchors.push({ id: `${g.id}_c2`, kind: 'OPENING_GROUP_CORNER', world: c2, ownerId: g.id, weight: 0.6 })
  }

  tris.push(...appearanceGeometry(h, bounds, edges, anchors))

  anchors.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return { tris, edges, anchors, quantities: model.quantities }
}

/** Axis-aligned world bounds of a tessellation, used to frame default cameras. */
export function worldBounds(t: Tessellation): { min: Vec3; max: Vec3; centre: Vec3; radius: number } {
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity
  const visit = (p: Vec3): void => {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.z < minZ) minZ = p.z
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
    if (p.z > maxZ) maxZ = p.z
  }
  for (const tri of t.tris) {
    visit(tri.a)
    visit(tri.b)
    visit(tri.c)
  }
  if (!Number.isFinite(minX)) {
    const zero = v(0, 0, 0)
    return { min: zero, max: zero, centre: zero, radius: 1 }
  }
  const centre = v((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2)
  const radius = Math.max(maxX - minX, maxY - minY, maxZ - minZ) / 2
  return { min: v(minX, minY, minZ), max: v(maxX, maxY, maxZ), centre, radius: Math.max(radius, 0.5) }
}

export const planCornersOf = (ring: readonly Vec2[]): Vec2[] => [...ring]
