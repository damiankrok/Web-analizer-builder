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
import type { BuildingHypothesis, MassHypothesis, RoofHypothesis } from '../contracts/hypotheses.js'
import type { Vec2, Vec3 } from '../contracts/geometry.js'
import { boundsOf } from '../contracts/geometry.js'
import type { AnchorKind } from '../contracts/camera.js'
import type { Edge3, Tri } from '../camera/render.js'
import { facadeFrame } from './frames.js'

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
  tris: Tri[]
  edges: Edge3[]
  anchors: Anchor3D[]
}

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z })

function quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, ownerId: string): Tri[] {
  return [
    { a, b, c, ownerId },
    { a, b: c, c: d, ownerId },
  ]
}

/** Prism walls and a flat lid for a mass. */
function massSolid(mass: MassHypothesis, topY: number): { tris: Tri[]; edges: Edge3[] } {
  const ring = mass.footprint.outer
  const tris: Tri[] = []
  const edges: Edge3[] = []
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]
    const q = ring[(i + 1) % ring.length]
    const a = v(p.x, mass.baseY, p.z)
    const b = v(q.x, mass.baseY, q.z)
    const c = v(q.x, topY, q.z)
    const d = v(p.x, topY, p.z)
    tris.push(...quad(a, b, c, d, mass.id))
    edges.push({ a, b: d, ownerId: mass.id, kind: 'MASS' })
    edges.push({ a: d, b: c, ownerId: mass.id, kind: 'MASS' })
    edges.push({ a, b, ownerId: mass.id, kind: 'MASS' })
  }
  // Lid, fan-triangulated about the first vertex. Footprints here are convex
  // rectangles by construction, so a fan is sufficient.
  for (let i = 1; i + 1 < ring.length; i++) {
    tris.push({
      a: v(ring[0].x, topY, ring[0].z),
      b: v(ring[i].x, topY, ring[i].z),
      c: v(ring[i + 1].x, topY, ring[i + 1].z),
      ownerId: mass.id,
    })
  }
  return { tris, edges }
}

/**
 * Gable roof over a rectangular mass: two pitched planes meeting at a ridge,
 * plus the two gable triangles that close the ends. Overhang extends the eaves
 * outwards along the slope and the ridge beyond the gable walls.
 */
function gableRoof(
  mass: MassHypothesis,
  roof: RoofHypothesis,
): { tris: Tri[]; edges: Edge3[]; anchors: Anchor3D[] } {
  const b = boundsOf(mass.footprint.outer)
  const alongZ = (roof.ridgeDir?.z ?? 1) !== 0
  const oh = roof.overhangM
  const tris: Tri[] = []
  const edges: Edge3[] = []
  const anchors: Anchor3D[] = []

  const eaveY = roof.eaveY
  const ridgeY = roof.ridgeY
  // Overhang drops below the eave line along the pitch.
  const drop = oh * Math.tan((roof.pitchDeg * Math.PI) / 180)

  if (alongZ) {
    const midX = (b.minX + b.maxX) / 2
    const z0 = b.minZ - oh
    const z1 = b.maxZ + oh
    const xL = b.minX - oh
    const xR = b.maxX + oh
    const ridgeA = v(midX, ridgeY, z0)
    const ridgeB = v(midX, ridgeY, z1)
    const eaveLA = v(xL, eaveY - drop, z0)
    const eaveLB = v(xL, eaveY - drop, z1)
    const eaveRA = v(xR, eaveY - drop, z0)
    const eaveRB = v(xR, eaveY - drop, z1)
    tris.push(...quad(ridgeA, ridgeB, eaveLB, eaveLA, roof.id))
    tris.push(...quad(ridgeA, ridgeB, eaveRB, eaveRA, roof.id))
    // Gable triangles close the ends so the silhouette is solid.
    tris.push({ a: v(b.minX, eaveY, b.minZ), b: v(b.maxX, eaveY, b.minZ), c: v(midX, ridgeY, b.minZ), ownerId: roof.id })
    tris.push({ a: v(b.minX, eaveY, b.maxZ), b: v(b.maxX, eaveY, b.maxZ), c: v(midX, ridgeY, b.maxZ), ownerId: roof.id })
    edges.push({ a: ridgeA, b: ridgeB, ownerId: roof.id, kind: 'ROOFLINE' })
    edges.push({ a: eaveLA, b: eaveLB, ownerId: roof.id, kind: 'ROOFLINE' })
    edges.push({ a: eaveRA, b: eaveRB, ownerId: roof.id, kind: 'ROOFLINE' })
    edges.push({ a: ridgeA, b: eaveLA, ownerId: roof.id, kind: 'SILHOUETTE' })
    edges.push({ a: ridgeA, b: eaveRA, ownerId: roof.id, kind: 'SILHOUETTE' })
    edges.push({ a: ridgeB, b: eaveLB, ownerId: roof.id, kind: 'SILHOUETTE' })
    edges.push({ a: ridgeB, b: eaveRB, ownerId: roof.id, kind: 'SILHOUETTE' })
    anchors.push(
      { id: `${roof.id}_ridge_a`, kind: 'RIDGE_END', world: ridgeA, ownerId: roof.id, weight: 1 },
      { id: `${roof.id}_ridge_b`, kind: 'RIDGE_END', world: ridgeB, ownerId: roof.id, weight: 1 },
      { id: `${roof.id}_eave_la`, kind: 'EAVE_END', world: eaveLA, ownerId: roof.id, weight: 0.9 },
      { id: `${roof.id}_eave_lb`, kind: 'EAVE_END', world: eaveLB, ownerId: roof.id, weight: 0.9 },
      { id: `${roof.id}_eave_ra`, kind: 'EAVE_END', world: eaveRA, ownerId: roof.id, weight: 0.9 },
      { id: `${roof.id}_eave_rb`, kind: 'EAVE_END', world: eaveRB, ownerId: roof.id, weight: 0.9 },
    )
  } else {
    const midZ = (b.minZ + b.maxZ) / 2
    const x0 = b.minX - oh
    const x1 = b.maxX + oh
    const zL = b.minZ - oh
    const zR = b.maxZ + oh
    const ridgeA = v(x0, ridgeY, midZ)
    const ridgeB = v(x1, ridgeY, midZ)
    const eaveLA = v(x0, eaveY - drop, zL)
    const eaveLB = v(x1, eaveY - drop, zL)
    const eaveRA = v(x0, eaveY - drop, zR)
    const eaveRB = v(x1, eaveY - drop, zR)
    tris.push(...quad(ridgeA, ridgeB, eaveLB, eaveLA, roof.id))
    tris.push(...quad(ridgeA, ridgeB, eaveRB, eaveRA, roof.id))
    tris.push({ a: v(b.minX, eaveY, b.minZ), b: v(b.minX, eaveY, b.maxZ), c: v(b.minX, ridgeY, midZ), ownerId: roof.id })
    tris.push({ a: v(b.maxX, eaveY, b.minZ), b: v(b.maxX, eaveY, b.maxZ), c: v(b.maxX, ridgeY, midZ), ownerId: roof.id })
    edges.push({ a: ridgeA, b: ridgeB, ownerId: roof.id, kind: 'ROOFLINE' })
    edges.push({ a: eaveLA, b: eaveLB, ownerId: roof.id, kind: 'ROOFLINE' })
    edges.push({ a: eaveRA, b: eaveRB, ownerId: roof.id, kind: 'ROOFLINE' })
    anchors.push(
      { id: `${roof.id}_ridge_a`, kind: 'RIDGE_END', world: ridgeA, ownerId: roof.id, weight: 1 },
      { id: `${roof.id}_ridge_b`, kind: 'RIDGE_END', world: ridgeB, ownerId: roof.id, weight: 1 },
      { id: `${roof.id}_eave_la`, kind: 'EAVE_END', world: eaveLA, ownerId: roof.id, weight: 0.9 },
      { id: `${roof.id}_eave_rb`, kind: 'EAVE_END', world: eaveRB, ownerId: roof.id, weight: 0.9 },
    )
  }
  return { tris, edges, anchors }
}

function flatRoof(mass: MassHypothesis, roof: RoofHypothesis): { tris: Tri[]; edges: Edge3[]; anchors: Anchor3D[] } {
  const b = boundsOf(mass.footprint.outer)
  const oh = roof.overhangM
  const y = roof.ridgeY
  const corners = [
    v(b.minX - oh, y, b.minZ - oh),
    v(b.maxX + oh, y, b.minZ - oh),
    v(b.maxX + oh, y, b.maxZ + oh),
    v(b.minX - oh, y, b.maxZ + oh),
  ]
  const tris = quad(corners[0], corners[1], corners[2], corners[3], roof.id)
  const edges: Edge3[] = []
  for (let i = 0; i < 4; i++) {
    edges.push({ a: corners[i], b: corners[(i + 1) % 4], ownerId: roof.id, kind: 'ROOFLINE' })
  }
  const anchors: Anchor3D[] = corners.map((c, i) => ({
    id: `${roof.id}_corner_${i}`,
    kind: 'MASS_CORNER',
    world: c,
    ownerId: roof.id,
    weight: 0.95,
  }))
  return { tris, edges, anchors }
}

export function tessellate(h: BuildingHypothesis): Tessellation {
  const tris: Tri[] = []
  const edges: Edge3[] = []
  const anchors: Anchor3D[] = []

  for (const mass of h.masses) {
    const roof = h.roofs.find((r) => r.massId === mass.id)
    const topY = roof && roof.kind !== 'FLAT' ? roof.eaveY : (roof?.ridgeY ?? mass.topY)
    const solid = massSolid(mass, topY)
    tris.push(...solid.tris)
    edges.push(...solid.edges)

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

    if (!roof) continue
    const built =
      roof.kind === 'FLAT' || roof.kind === 'NONE' ? flatRoof(mass, roof) : gableRoof(mass, roof)
    tris.push(...built.tris)
    edges.push(...built.edges)
    anchors.push(...built.anchors)
  }

  // Opening groups: outer rectangle on its facade, as edges and corner anchors.
  const bounds = boundsOf(h.masses.flatMap((m) => m.footprint.outer))
  for (const g of h.openingGroups) {
    const mass = h.masses.find((m) => m.id === g.massId)
    const mb = mass ? boundsOf(mass.footprint.outer) : bounds
    const frame = facadeFrame(g.facade, bounds)
    const outward = 0.02
    const corner = (s: number, t: number): Vec3 => ({
      x: frame.origin.x + frame.right.x * s + frame.normal.x * outward,
      y: t,
      z: frame.origin.z + frame.right.z * s + frame.normal.z * outward,
    })
    const c0 = corner(g.s, g.sillY)
    const c1 = corner(g.s + g.widthM, g.sillY)
    const c2 = corner(g.s + g.widthM, g.sillY + g.heightM)
    const c3 = corner(g.s, g.sillY + g.heightM)
    edges.push(
      { a: c0, b: c1, ownerId: g.id, kind: 'OPENING' },
      { a: c1, b: c2, ownerId: g.id, kind: 'OPENING' },
      { a: c2, b: c3, ownerId: g.id, kind: 'OPENING' },
      { a: c3, b: c0, ownerId: g.id, kind: 'OPENING' },
    )
    const centroid: Vec3 = {
      x: (c0.x + c2.x) / 2,
      y: (c0.y + c2.y) / 2,
      z: (c0.z + c2.z) / 2,
    }
    anchors.push({ id: `${g.id}_centroid`, kind: 'OPENING_GROUP_CENTROID', world: centroid, ownerId: g.id, weight: 0.8 })
    anchors.push({ id: `${g.id}_c0`, kind: 'OPENING_GROUP_CORNER', world: c0, ownerId: g.id, weight: 0.6 })
    anchors.push({ id: `${g.id}_c2`, kind: 'OPENING_GROUP_CORNER', world: c2, ownerId: g.id, weight: 0.6 })
    void mb
  }

  // Deterministic ordering keeps rendering and scoring byte-stable.
  anchors.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return { tris, edges, anchors }
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
