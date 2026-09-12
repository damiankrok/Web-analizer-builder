/**
 * Volumetric building generation.
 *
 * A footprint extruded into a shell is not a building model: it has no wall
 * thickness, its openings are painted on, and there is nothing to take off
 * areas from or to decompose by floor. This module produces real solids —
 * walls as bands between an outer and an inset ring, with openings cut *through*
 * them and reveals lining the cut; floor plates with thickness; roof planes as
 * slabs with a build-up depth; and glazing as its own system sitting inside the
 * openings rather than replacing them.
 *
 * Openings are cut exactly rather than approximately. On a planar wall with
 * axis-aligned rectangular openings, the wall face decomposes into a grid whose
 * break lines are the openings' own edges; every cell is then either wholly
 * solid or wholly a hole. That is exact, needs no CSG library, and cannot leave
 * the slivers a boolean subtraction would.
 *
 * Every triangle is tagged with the part it belongs to and the storey and mass
 * it came from, which is what makes roof-off, storey-by-storey and
 * element-class views possible downstream.
 *
 * PORT_DIRECT (Kotlin).
 */
import type {
  BuildingHypothesis,
  MassHypothesis,
  OpeningGroupHypothesis,
  RoofHypothesis,
  FacadeSide,
} from '../contracts/hypotheses.js'
import type { Vec2, Vec3 } from '../contracts/geometry.js'
import { boundsOf } from '../contracts/geometry.js'
import type { Edge3, Tri } from '../camera/render.js'
import { facadeFrame, facadePlanPoint } from './frames.js'

/** Element class of a triangle, used for materials and decomposition. */
export type BuildPart = 'WALL' | 'WALL_INNER' | 'REVEAL' | 'SLAB' | 'ROOF' | 'ROOF_SOFFIT' | 'GLAZING' | 'RAILING' | 'FEATURE'

export type BuildTri = Tri & {
  part: BuildPart
  massId?: string
  storeyId?: string
}

export type SolidModel = {
  tris: BuildTri[]
  edges: Edge3[]
  /** Metrics a takeoff would want, computed while generating. */
  quantities: {
    wallAreaM2: number
    glazingAreaM2: number
    roofAreaM2: number
    slabAreaM2: number
    openingCount: number
  }
}

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z })

function quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, ownerId: string, part: BuildPart, massId?: string, storeyId?: string): BuildTri[] {
  return [
    { a, b, c, ownerId, part, massId, storeyId },
    { a, b: c, c: d, ownerId, part, massId, storeyId },
  ]
}

const lerp = (a: Vec2, b: Vec2, f: number): Vec2 => ({ x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f })

/** Inset a convex, counter-clockwise plan ring by a uniform distance. */
export function insetRing(ring: readonly Vec2[], distance: number): Vec2[] {
  const n = ring.length
  if (n < 3 || distance <= 0) return [...ring]
  const out: Vec2[] = []
  for (let i = 0; i < n; i++) {
    const prev = ring[(i - 1 + n) % n]
    const cur = ring[i]
    const next = ring[(i + 1) % n]
    const e1 = { x: cur.x - prev.x, z: cur.z - prev.z }
    const e2 = { x: next.x - cur.x, z: next.z - cur.z }
    const l1 = Math.hypot(e1.x, e1.z) || 1
    const l2 = Math.hypot(e2.x, e2.z) || 1
    // Inward normal of a counter-clockwise ring in (x, z).
    const n1 = { x: -e1.z / l1, z: e1.x / l1 }
    const n2 = { x: -e2.z / l2, z: e2.x / l2 }
    const bis = { x: n1.x + n2.x, z: n1.z + n2.z }
    const bl = Math.hypot(bis.x, bis.z)
    if (bl < 1e-9) {
      out.push({ x: cur.x + n1.x * distance, z: cur.z + n1.z * distance })
      continue
    }
    // Scale along the bisector so the offset faces sit exactly `distance` in.
    const cos = (n1.x * bis.x + n1.z * bis.z) / bl
    const scale = cos < 1e-6 ? distance : distance / cos
    out.push({ x: cur.x + (bis.x / bl) * scale, z: cur.z + (bis.z / bl) * scale })
  }
  return out
}

/** Outward normal of a CCW ring edge, in plan. */
const edgeNormal = (p: Vec2, q: Vec2): Vec2 => {
  const dx = q.x - p.x
  const dz = q.z - p.z
  const l = Math.hypot(dx, dz) || 1
  return { x: dz / l, z: -dx / l }
}

const facadeForNormal = (n: Vec2): FacadeSide => {
  if (Math.abs(n.x) > Math.abs(n.z)) return n.x > 0 ? 'RIGHT' : 'LEFT'
  return n.z > 0 ? 'FRONT' : 'REAR'
}

type WallOpening = {
  group: OpeningGroupHypothesis
  /** Fraction along the wall edge. */
  f0: number
  f1: number
  t0: number
  t1: number
}

/** Unique sorted break values, merging ones closer than epsilon. */
function breaks(values: readonly number[], lo: number, hi: number, epsilon: number): number[] {
  const all = [lo, hi, ...values.filter((x) => x > lo + epsilon && x < hi - epsilon)].sort((a, b) => a - b)
  const out: number[] = []
  for (const x of all) if (out.length === 0 || x - out[out.length - 1] > epsilon) out.push(x)
  if (out[out.length - 1] < hi - epsilon) out.push(hi)
  return out
}

/**
 * One wall: the band between an outer edge and its inset counterpart, from
 * baseY to topY, with its openings cut through and lined.
 */
function buildWall(
  outerA: Vec2,
  outerB: Vec2,
  innerA: Vec2,
  innerB: Vec2,
  baseY: number,
  topY: number,
  openings: readonly WallOpening[],
  ownerId: string,
  massId: string,
  storeyId: string | undefined,
  model: SolidModel,
): void {
  const eps = 0.01
  const fBreaks = breaks(openings.flatMap((o) => [o.f0, o.f1]), 0, 1, 0.004)
  const tBreaks = breaks(openings.flatMap((o) => [o.t0, o.t1]), baseY, topY, eps)

  const outerAt = (f: number, y: number): Vec3 => {
    const p = lerp(outerA, outerB, f)
    return v(p.x, y, p.z)
  }
  const innerAt = (f: number, y: number): Vec3 => {
    const p = lerp(innerA, innerB, f)
    return v(p.x, y, p.z)
  }

  const isHole = (f: number, y: number): WallOpening | undefined =>
    openings.find((o) => f > o.f0 - 1e-6 && f < o.f1 + 1e-6 && y > o.t0 - 1e-6 && y < o.t1 + 1e-6)

  const length = Math.hypot(outerB.x - outerA.x, outerB.z - outerA.z)

  // Outer and inner faces, cell by cell.
  for (let i = 0; i + 1 < fBreaks.length; i++) {
    for (let j = 0; j + 1 < tBreaks.length; j++) {
      const f0 = fBreaks[i]
      const f1 = fBreaks[i + 1]
      const y0 = tBreaks[j]
      const y1 = tBreaks[j + 1]
      if (isHole((f0 + f1) / 2, (y0 + y1) / 2)) continue
      model.tris.push(
        ...quad(outerAt(f0, y0), outerAt(f1, y0), outerAt(f1, y1), outerAt(f0, y1), ownerId, 'WALL', massId, storeyId),
      )
      model.tris.push(
        ...quad(innerAt(f0, y1), innerAt(f1, y1), innerAt(f1, y0), innerAt(f0, y0), ownerId, 'WALL_INNER', massId, storeyId),
      )
      model.quantities.wallAreaM2 += (f1 - f0) * length * (y1 - y0)
    }
  }

  // Reveals: the four surfaces lining each cut.
  for (const o of openings) {
    const id = `${o.group.id}_reveal`
    model.tris.push(...quad(outerAt(o.f0, o.t0), innerAt(o.f0, o.t0), innerAt(o.f0, o.t1), outerAt(o.f0, o.t1), id, 'REVEAL', massId, storeyId))
    model.tris.push(...quad(outerAt(o.f1, o.t1), innerAt(o.f1, o.t1), innerAt(o.f1, o.t0), outerAt(o.f1, o.t0), id, 'REVEAL', massId, storeyId))
    model.tris.push(...quad(outerAt(o.f0, o.t0), outerAt(o.f1, o.t0), innerAt(o.f1, o.t0), innerAt(o.f0, o.t0), id, 'REVEAL', massId, storeyId))
    model.tris.push(...quad(innerAt(o.f0, o.t1), innerAt(o.f1, o.t1), outerAt(o.f1, o.t1), outerAt(o.f0, o.t1), id, 'REVEAL', massId, storeyId))

    // Glazing: its own system, set into the reveal rather than replacing it.
    const inset = 0.45
    const g = (f: number, y: number): Vec3 => {
      const a = outerAt(f, y)
      const b = innerAt(f, y)
      return v(a.x + (b.x - a.x) * inset, y, a.z + (b.z - a.z) * inset)
    }
    const glassId = `${o.group.id}_glass`
    model.tris.push(...quad(g(o.f0, o.t0), g(o.f1, o.t0), g(o.f1, o.t1), g(o.f0, o.t1), glassId, 'GLAZING', massId, storeyId))
    const areaM2 = (o.f1 - o.f0) * length * (o.t1 - o.t0)
    model.quantities.glazingAreaM2 += areaM2
    model.quantities.openingCount++

    // Frame and mullions, as edges: they read as a window rather than a hole.
    model.edges.push(
      { a: outerAt(o.f0, o.t0), b: outerAt(o.f1, o.t0), ownerId: o.group.id, kind: 'OPENING' },
      { a: outerAt(o.f1, o.t0), b: outerAt(o.f1, o.t1), ownerId: o.group.id, kind: 'OPENING' },
      { a: outerAt(o.f1, o.t1), b: outerAt(o.f0, o.t1), ownerId: o.group.id, kind: 'OPENING' },
      { a: outerAt(o.f0, o.t1), b: outerAt(o.f0, o.t0), ownerId: o.group.id, kind: 'OPENING' },
    )
    const panels = Math.max(1, o.group.panelCount)
    for (let m = 1; m < panels; m++) {
      const f = o.f0 + ((o.f1 - o.f0) * m) / panels
      model.edges.push({ a: g(f, o.t0), b: g(f, o.t1), ownerId: o.group.id, kind: 'OPENING' })
    }
  }

  // Top and bottom caps close the band into a solid.
  model.tris.push(
    ...quad(outerAt(0, topY), outerAt(1, topY), innerAt(1, topY), innerAt(0, topY), ownerId, 'WALL', massId, storeyId),
  )
  model.tris.push(
    ...quad(innerAt(0, baseY), innerAt(1, baseY), outerAt(1, baseY), outerAt(0, baseY), ownerId, 'WALL', massId, storeyId),
  )

  model.edges.push(
    { a: outerAt(0, baseY), b: outerAt(0, topY), ownerId, kind: 'MASS' },
    { a: outerAt(1, baseY), b: outerAt(1, topY), ownerId, kind: 'MASS' },
    { a: outerAt(0, topY), b: outerAt(1, topY), ownerId, kind: 'MASS' },
    { a: outerAt(0, baseY), b: outerAt(1, baseY), ownerId, kind: 'MASS' },
  )
}

/** A horizontal plate with thickness. */
function buildPlate(ring: readonly Vec2[], topY: number, thickness: number, ownerId: string, part: BuildPart, model: SolidModel, storeyId?: string, massId?: string): void {
  const baseY = topY - thickness
  const n = ring.length
  for (let i = 1; i + 1 < n; i++) {
    model.tris.push({ a: v(ring[0].x, topY, ring[0].z), b: v(ring[i].x, topY, ring[i].z), c: v(ring[i + 1].x, topY, ring[i + 1].z), ownerId, part, storeyId, massId })
    model.tris.push({ a: v(ring[0].x, baseY, ring[0].z), b: v(ring[i + 1].x, baseY, ring[i + 1].z), c: v(ring[i].x, baseY, ring[i].z), ownerId, part, storeyId, massId })
  }
  for (let i = 0; i < n; i++) {
    const p = ring[i]
    const q = ring[(i + 1) % n]
    model.tris.push(...quad(v(p.x, baseY, p.z), v(q.x, baseY, q.z), v(q.x, topY, q.z), v(p.x, topY, p.z), ownerId, part, massId, storeyId))
    model.edges.push({ a: v(p.x, topY, p.z), b: v(q.x, topY, q.z), ownerId, kind: 'MASS' })
    model.edges.push({ a: v(p.x, baseY, p.z), b: v(q.x, baseY, q.z), ownerId, kind: 'MASS' })
  }
  let area = 0
  for (let i = 0; i < n; i++) {
    const p = ring[i]
    const q = ring[(i + 1) % n]
    area += p.x * q.z - q.x * p.z
  }
  model.quantities.slabAreaM2 += Math.abs(area / 2)
}

const ROOF_THICKNESS_M = 0.28

/**
 * A pitched roof as two solid slabs meeting at the ridge, with gable walls
 * closing the ends. The slabs have real depth, so the eave reads as a fascia
 * and the underside as a soffit, which is what the overhang looks like in the
 * source visualisations.
 */
function buildPitchedRoof(mass: MassHypothesis, roof: RoofHypothesis, model: SolidModel): void {
  const b = boundsOf(mass.footprint.outer)
  const alongZ = (roof.ridgeDir?.z ?? 1) !== 0
  const oh = roof.overhangM
  const drop = oh * Math.tan((roof.pitchDeg * Math.PI) / 180)
  const eaveY = roof.eaveY - drop
  const ridgeY = roof.ridgeY
  const th = ROOF_THICKNESS_M
  const id = roof.id

  const slab = (p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3): void => {
    // Offset downwards by the build-up thickness, measured vertically, which is
    // how a roof is drawn in section.
    const d = (p: Vec3): Vec3 => v(p.x, p.y - th, p.z)
    model.tris.push(...quad(p0, p1, p2, p3, id, 'ROOF', mass.id))
    model.tris.push(...quad(d(p3), d(p2), d(p1), d(p0), id, 'ROOF_SOFFIT', mass.id))
    model.tris.push(...quad(p0, p1, d(p1), d(p0), id, 'ROOF', mass.id))
    model.tris.push(...quad(p2, p3, d(p3), d(p2), id, 'ROOF', mass.id))
    model.tris.push(...quad(p1, p2, d(p2), d(p1), id, 'ROOF', mass.id))
    model.tris.push(...quad(p3, p0, d(p0), d(p3), id, 'ROOF', mass.id))
    model.edges.push(
      { a: p0, b: p1, ownerId: id, kind: 'ROOFLINE' },
      { a: p1, b: p2, ownerId: id, kind: 'ROOFLINE' },
      { a: p2, b: p3, ownerId: id, kind: 'ROOFLINE' },
      { a: p3, b: p0, ownerId: id, kind: 'ROOFLINE' },
      { a: d(p0), b: d(p1), ownerId: id, kind: 'ROOFLINE' },
    )
    model.quantities.roofAreaM2 += Math.abs(
      Math.hypot(p1.x - p0.x, p1.y - p0.y, p1.z - p0.z) * Math.hypot(p3.x - p0.x, p3.y - p0.y, p3.z - p0.z),
    )
  }

  if (alongZ) {
    const midX = (b.minX + b.maxX) / 2
    const z0 = b.minZ - oh
    const z1 = b.maxZ + oh
    const xL = b.minX - oh
    const xR = b.maxX + oh
    slab(v(midX, ridgeY, z0), v(midX, ridgeY, z1), v(xL, eaveY, z1), v(xL, eaveY, z0))
    slab(v(midX, ridgeY, z1), v(midX, ridgeY, z0), v(xR, eaveY, z0), v(xR, eaveY, z1))
  } else {
    const midZ = (b.minZ + b.maxZ) / 2
    const x0 = b.minX - oh
    const x1 = b.maxX + oh
    const zL = b.minZ - oh
    const zR = b.maxZ + oh
    slab(v(x0, ridgeY, midZ), v(x1, ridgeY, midZ), v(x1, eaveY, zL), v(x0, eaveY, zL))
    slab(v(x1, ridgeY, midZ), v(x0, ridgeY, midZ), v(x0, eaveY, zR), v(x1, eaveY, zR))
  }
}

/**
 * Gable walls: the triangles that close a pitched roof's ends. They are walls,
 * not roof, and they carry the gable glazing — which is why they are built with
 * thickness and with their openings cut, like any other wall.
 */
function buildGableWalls(
  mass: MassHypothesis,
  roof: RoofHypothesis,
  wallThickness: number,
  groups: readonly OpeningGroupHypothesis[],
  bounds: ReturnType<typeof boundsOf>,
  model: SolidModel,
): void {
  const b = boundsOf(mass.footprint.outer)
  const alongZ = (roof.ridgeDir?.z ?? 1) !== 0
  const eaveY = roof.eaveY
  const ridgeY = roof.ridgeY

  const ends: { side: FacadeSide; z?: number; x?: number }[] = alongZ
    ? [
        { side: 'REAR', z: b.minZ },
        { side: 'FRONT', z: b.maxZ },
      ]
    : [
        { side: 'LEFT', x: b.minX },
        { side: 'RIGHT', x: b.maxX },
      ]

  for (const end of ends) {
    const frame = facadeFrame(end.side, bounds)
    const infill = groups.find((g) => g.facade === end.side && g.kind === 'GABLE_GLAZING')

    const spanLo = alongZ ? b.minX : b.minZ
    const spanHi = alongZ ? b.maxX : b.maxZ
    const mid = (spanLo + spanHi) / 2
    const half = (spanHi - spanLo) / 2
    const inward = end.side === 'FRONT' || end.side === 'RIGHT' ? -1 : 1
    const point = (u: number, y: number, depth: number): Vec3 =>
      alongZ ? v(u, y, (end.z as number) + inward * depth) : v((end.x as number) + inward * depth, y, u)

    // The gable triangle, sliced into vertical strips so the glazing can be cut
    // out of it exactly as on any other wall.
    const strips = 28
    const glazeLo = infill ? facadeU(frame, infill.s, alongZ) : 0
    const glazeHi = infill ? facadeU(frame, infill.s + infill.widthM, alongZ) : 0
    const glazeLoU = Math.min(glazeLo, glazeHi)
    const glazeHiU = Math.max(glazeLo, glazeHi)
    const sill = infill ? infill.sillY : 0

    for (let i = 0; i < strips; i++) {
      const u0 = spanLo + ((spanHi - spanLo) * i) / strips
      const u1 = spanLo + ((spanHi - spanLo) * (i + 1)) / strips
      const roofAt = (u: number): number => ridgeY - ((ridgeY - eaveY) * Math.abs(u - mid)) / Math.max(half, 1e-6)
      const top0 = roofAt(u0)
      const top1 = roofAt(u1)
      const inGlazing = infill !== undefined && u0 >= glazeLoU - 1e-6 && u1 <= glazeHiU + 1e-6
      const base = inGlazing ? Math.min(sill, Math.min(top0, top1) - 0.05) : eaveY

      if (inGlazing) {
        // Glass follows the rake: this is the gable glazing clipped by the roof
        // plane (§32), modelled rather than approximated by a rectangle.
        const gd = 0.5 * wallThickness
        model.tris.push(
          ...quad(point(u0, base, gd), point(u1, base, gd), point(u1, top1, gd), point(u0, top0, gd), `${infill.id}_glass`, 'GLAZING', mass.id),
        )
        model.quantities.glazingAreaM2 += ((u1 - u0) * (top0 + top1 - 2 * base)) / 2
        continue
      }

      // Solid gable wall strip, with thickness.
      const outer = 0
      const inner = wallThickness
      model.tris.push(...quad(point(u0, base, outer), point(u1, base, outer), point(u1, top1, outer), point(u0, top0, outer), roof.id, 'WALL', mass.id))
      model.tris.push(...quad(point(u0, top0, inner), point(u1, top1, inner), point(u1, base, inner), point(u0, base, inner), roof.id, 'WALL_INNER', mass.id))
      model.tris.push(...quad(point(u0, top0, outer), point(u1, top1, outer), point(u1, top1, inner), point(u0, top0, inner), roof.id, 'WALL', mass.id))
      model.quantities.wallAreaM2 += ((u1 - u0) * (top0 + top1 - 2 * base)) / 2
    }

    if (infill) {
      model.quantities.openingCount++
      const gd = 0.5 * wallThickness
      const topAt = (u: number): number => ridgeY - ((ridgeY - eaveY) * Math.abs(u - mid)) / Math.max(half, 1e-6)
      model.edges.push(
        { a: point(glazeLoU, sill, gd), b: point(glazeHiU, sill, gd), ownerId: infill.id, kind: 'OPENING' },
        { a: point(glazeLoU, sill, gd), b: point(glazeLoU, topAt(glazeLoU), gd), ownerId: infill.id, kind: 'OPENING' },
        { a: point(glazeHiU, sill, gd), b: point(glazeHiU, topAt(glazeHiU), gd), ownerId: infill.id, kind: 'OPENING' },
      )
      const panels = Math.max(2, infill.panelCount)
      for (let m = 1; m < panels; m++) {
        const u = glazeLoU + ((glazeHiU - glazeLoU) * m) / panels
        model.edges.push({ a: point(u, sill, gd), b: point(u, topAt(u), gd), ownerId: infill.id, kind: 'OPENING' })
      }
    }

    model.edges.push(
      { a: point(spanLo, eaveY, 0), b: point(mid, ridgeY, 0), ownerId: roof.id, kind: 'SILHOUETTE' },
      { a: point(mid, ridgeY, 0), b: point(spanHi, eaveY, 0), ownerId: roof.id, kind: 'SILHOUETTE' },
    )
  }
}

/** World coordinate along a gable end for a facade-local s. */
function facadeU(frame: ReturnType<typeof facadeFrame>, s: number, alongZ: boolean): number {
  const p = facadePlanPoint(frame, s)
  return alongZ ? p.x : p.z
}

export type SolidOptions = {
  wallThicknessM: number
  slabThicknessM: number
}

export function buildSolidModel(h: BuildingHypothesis, opts?: Partial<SolidOptions>): SolidModel {
  const wallThickness = Math.max(0.15, opts?.wallThicknessM ?? h.wallThicknessM ?? 0.4)
  const slabThickness = opts?.slabThicknessM ?? 0.28
  const model: SolidModel = {
    tris: [],
    edges: [],
    quantities: { wallAreaM2: 0, glazingAreaM2: 0, roofAreaM2: 0, slabAreaM2: 0, openingCount: 0 },
  }
  const bounds = boundsOf(h.masses.flatMap((m) => m.footprint.outer))

  for (const mass of h.masses) {
    const roof = h.roofs.find((r) => r.massId === mass.id)
    const pitched = roof !== undefined && roof.kind !== 'FLAT' && roof.kind !== 'NONE' && roof.pitchDeg > 0
    const wallTop = pitched ? roof.eaveY : (roof?.ridgeY ?? mass.topY)

    // Slabs and balconies are plates, not enclosures.
    if (mass.kind === 'BALCONY_SLAB' || mass.kind === 'CANOPY') {
      buildPlate(mass.footprint.outer, mass.topY, Math.max(0.12, mass.topY - mass.baseY), mass.id, 'SLAB', model, undefined, mass.id)
      continue
    }

    const outer = mass.footprint.outer
    const inner = insetRing(outer, wallThickness)

    // Openings belonging to this mass, resolved onto the wall they sit on.
    const massGroups = h.openingGroups.filter((g) => g.massId === mass.id && g.kind !== 'GABLE_GLAZING')

    for (let i = 0; i < outer.length; i++) {
      const pA = outer[i]
      const pB = outer[(i + 1) % outer.length]
      const qA = inner[i]
      const qB = inner[(i + 1) % inner.length]
      const nrm = edgeNormal(pA, pB)
      const side = facadeForNormal(nrm)
      const edgeLen = Math.hypot(pB.x - pA.x, pB.z - pA.z)
      if (edgeLen < 0.05) continue

      // Skip the gable ends of a pitched mass: they are built as gable walls,
      // which rise to the ridge rather than stopping at the eave.
      const alongZ = pitched ? (roof.ridgeDir?.z ?? 1) !== 0 : false
      const isGableEnd = pitched && ((alongZ && (side === 'FRONT' || side === 'REAR')) || (!alongZ && (side === 'LEFT' || side === 'RIGHT')))

      const wallOpenings: WallOpening[] = []
      for (const g of massGroups) {
        if (g.facade !== side) continue
        const frame = facadeFrame(g.facade, bounds)
        const a = facadePlanPoint(frame, g.s)
        const b = facadePlanPoint(frame, g.s + g.widthM)
        const project = (p: Vec2): number => {
          const t = ((p.x - pA.x) * (pB.x - pA.x) + (p.z - pA.z) * (pB.z - pA.z)) / (edgeLen * edgeLen)
          return t
        }
        // The opening must lie on this wall's own plane, not merely face the
        // same way: a garage and a main body share a facade direction.
        const distA = Math.abs((a.x - pA.x) * nrm.x + (a.z - pA.z) * nrm.z)
        if (distA > 0.6) continue
        let f0 = project(a)
        let f1 = project(b)
        if (f1 < f0) [f0, f1] = [f1, f0]
        const clipped0 = Math.max(0.01, f0)
        const clipped1 = Math.min(0.99, f1)
        if (clipped1 - clipped0 < 0.02) continue
        const top = Math.min(g.sillY + g.heightM, wallTop - 0.08)
        if (top - g.sillY < 0.3) continue
        wallOpenings.push({ group: g, f0: clipped0, f1: clipped1, t0: Math.max(mass.baseY + 0.02, g.sillY), t1: top })
      }

      if (isGableEnd) continue
      buildWall(pA, pB, qA, qB, mass.baseY, wallTop, wallOpenings, mass.id, mass.id, mass.storeyIds[0], model)
    }

    if (pitched) {
      buildPitchedRoof(mass, roof, model)
      buildGableWalls(mass, roof, wallThickness, h.openingGroups.filter((g) => g.massId === mass.id || g.kind === 'GABLE_GLAZING'), bounds, model)
    } else if (roof) {
      const oh = roof.overhangM
      const b = boundsOf(mass.footprint.outer)
      const ring = [
        { x: b.minX - oh, z: b.minZ - oh },
        { x: b.maxX + oh, z: b.minZ - oh },
        { x: b.maxX + oh, z: b.maxZ + oh },
        { x: b.minX - oh, z: b.maxZ + oh },
      ]
      buildPlate(ring, roof.ridgeY + ROOF_THICKNESS_M, ROOF_THICKNESS_M, roof.id, 'ROOF', model, undefined, mass.id)
      model.quantities.roofAreaM2 += (b.maxX - b.minX + 2 * oh) * (b.maxZ - b.minZ + 2 * oh)
    }

    // Floor plates for each storey this mass encloses.
    for (const storeyId of mass.storeyIds) {
      const storey = h.storeys.find((s) => s.id === storeyId)
      if (!storey) continue
      if (storey.floorY < mass.baseY - 0.01 || storey.floorY > wallTop - 0.2) continue
      buildPlate(insetRing(outer, wallThickness * 0.5), storey.floorY, slabThickness, `${mass.id}_${storeyId}_slab`, 'SLAB', model, storeyId, mass.id)
    }
  }

  return model
}
