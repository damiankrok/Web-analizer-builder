/**
 * Roof compiler — STAGE WEB-PIVOT-02, development only.
 *
 * Two kinds, and only two: `GABLE` and `FLAT`. `HIP` and `MONO_PITCH` return
 * `UNSUPPORTED_ROOF_KIND` and no triangles, because a hip compiled as a gable
 * is worse than a hip that fails loudly — it looks right from the front and is
 * wrong everywhere else.
 *
 * ## The declared pitch never touches the geometry
 *
 * This is the correction the legacy analyzer needed. There, a roof was accepted
 * because a field said `pitchDeg = 40`; nothing measured the triangles. Here,
 * each slope is built from the eave level, the ridge level and the support
 * footprint's half-span, and `RoofSpec.pitchDeg` is not read at all. The angle
 * that comes out is therefore a *consequence* of the levels, and the oracle in
 * `tests/geometry-oracles.ts` measures it from the emitted normals. Change the
 * declared pitch and nothing moves — which the test catches. Change the ridge
 * and everything moves — which the test also catches.
 *
 * ## Thickness is perpendicular
 *
 * The underside is the top plane pushed back along its own normal, so a 0.10 m
 * roof is 0.10 m thick measured the way a section measures it, not 0.10 m
 * measured vertically. Each slope is therefore a closed hexahedron whose volume
 * is its plan area divided by cos(pitch), times the thickness.
 *
 * ## Openings are cut in the plane's own frame
 *
 * STAGE WEB-PIVOT-05A. A roof plane can carry openings, and an opening is
 * stated in the plane's **local 2D frame** — `u` along the eave, `v` up the
 * slope from the eave — never in world coordinates and never against a
 * building bounding box. That is what makes the placement survive moving or
 * turning the whole house: the frame is built from the plane's own corners, so
 * rotating the building rotates the frame with it and `centerUV` does not
 * change. A plan rectangle would not survive either operation.
 *
 * The cut is real. The plane is tiled into the rectangles that remain around
 * its holes, each emitted as its own closed hexahedron by the same `slab`
 * every roof has always used, so the material through an opening is zero, the
 * material beside it is untouched, and the reveal faces exist because they are
 * the sides of the pieces that bound the hole. With no openings the tiling is
 * one rectangle — the whole plane — and the emitted triangles are exactly what
 * STAGE WEB-PIVOT-02 proved.
 *
 * PORT_DIRECT (Kotlin).
 */
import type { Vec3 } from '../contracts/geometry.js'
import type { SpecStatus } from './architectural.js'
import type { LevelSpec, RoofSpec } from './architectural.js'

export type RoofDiagnosticCode =
  | 'UNSUPPORTED_ROOF_KIND'
  | 'UNKNOWN_ROOF_LEVEL'
  | 'ROOF_MISSING_RIDGE'
  | 'INVALID_ROOF_FOOTPRINT'
  | 'INVALID_ROOF_THICKNESS'
  | 'ROOF_RIDGE_BELOW_EAVE'
  | 'DUPLICATE_ROOF_ID'
  | 'DUPLICATE_ROOF_OPENING_ID'
  | 'ROOF_OPENING_UNKNOWN_ROOF'
  | 'ROOF_OPENING_UNKNOWN_PLANE'
  | 'ROOF_OPENING_OUTSIDE_PLANE'
  | 'ROOF_OPENINGS_OVERLAP'
  | 'INVALID_ROOF_OPENING'
  | 'ROOF_FILL_EXCEEDS_CUT'
  | 'ROOF_FILL_UNKNOWN_OPENING'

export type RoofDiagnostic = {
  code: RoofDiagnosticCode
  severity: 'ERROR' | 'WARNING'
  message: string
  roofId?: string
  planeId?: string
  openingId?: string
}

/**
 * Material semantic of a roof triangle.
 *
 * `ROOF` is the covering itself. `ROOF_REVEAL` is a face that bounds an
 * opening through it — still roof material, and part of the same closed solid,
 * but nameable so an oracle can ask about the hole rather than about the
 * plane. `ROOF_FRAME` and `ROOF_GLAZING` are the unit that sits *in* the cut
 * and are not the roof: a rooflight whose glass counted as roof material would
 * make every "is this really a hole" check pass on an intact roof.
 */
export type RoofPart = 'ROOF' | 'ROOF_REVEAL' | 'ROOF_FRAME' | 'ROOF_GLAZING'

/** Roof parts that make up the closed roof solid. Glazing is a surface. */
export const SOLID_ROOF_PARTS: readonly RoofPart[] = ['ROOF', 'ROOF_REVEAL', 'ROOF_FRAME']

export type CompiledRoofTri = {
  a: Vec3
  b: Vec3
  c: Vec3
  part: RoofPart
  /** The roof, or the opening for a reveal or a fill. */
  ownerId: string
  /** The roof this triangle was compiled from, always. */
  wallId: string
  /** The plane it belongs to. */
  planeId: string
  /** Set on reveal, frame and glazing triangles. */
  openingId?: string
}

/**
 * One emitted roof plane and the local 2D frame its openings are stated in.
 *
 * `originM` is the plane's own eave corner at the along-axis minimum, `uDir`
 * runs along the eave and `vDir` up the slope. Every value here comes from the
 * plane's corners, so the frame travels with the building: translate or turn
 * the house and the same `centerUV` still names the same point of the same
 * plane. Nothing in it is derived from a bounding box, a facade or a compass
 * direction.
 */
export type RoofPlaneFrame = {
  planeId: string
  roofId: string
  originM: Vec3
  uDir: Vec3
  vDir: Vec3
  /** Unit normal of the top surface, pointing out of the roof. */
  normal: Vec3
  lengthU: number
  lengthV: number
  /** Vertical drop from the top surface to the underside. */
  verticalDropM: number
  /** Perpendicular depth of the roof build-up. */
  thicknessM: number
  /** The angle the plane actually makes, measured from its own corners. */
  pitchDeg: number
}

export type RoofOpeningKind =
  /** A glazed unit lying in the roof surface. */
  | 'ROOFLIGHT'
  /** A hole for something that passes through, such as a chimney. */
  | 'PENETRATION'

/**
 * An opening in one roof plane — STAGE WEB-PIVOT-05A §6.
 *
 * The smallest description that can be cut: which plane, where on it, how big,
 * and what it is for. `centerUV` and `sizeUV` are in the host plane's local
 * frame, in metres, `u` along the eave and `v` up the slope.
 *
 * `cutToleranceM` is the gap left around the unit when the structure is cut —
 * a real detail (a roof window needs its rafters trimmed a little wider than
 * its frame), and the one field that separates the hole from the thing in it.
 * A negative value means the hole is smaller than the unit, which is a defect
 * and is reported as one.
 */
export type RoofOpeningSpec = {
  id: string
  hostRoofId: string
  hostPlaneId: string
  centerUV: { u: number; v: number }
  sizeUV: { u: number; v: number }
  kind: RoofOpeningKind
  /** Extra clearance cut around the unit, per side. Defaults to zero. */
  cutToleranceM?: number
  sourceRefs: string[]
  status: SpecStatus
}

/**
 * The unit that fills a roof opening: a frame ring and a pane.
 *
 * Kept apart from the opening for the same reason `GlazingSpec` is kept apart
 * from `OpeningSpec`: a fill that came with the hole could never be emitted
 * without it, and the one defect worth catching is exactly the fill that was
 * emitted without one.
 */
export type RoofOpeningFillSpec = {
  id: string
  openingId: string
  /** Width of the frame, measured inwards from the unit's edge. */
  frameWidthM: number
}

/** What a roof actually became, in measurable terms. */
export type CompiledRoof = {
  roofId: string
  kind: 'GABLE' | 'FLAT'
  /** Slope faces emitted: two for a gable, one for a flat roof. */
  planeCount: number
  eaveM: number
  ridgeM: number
  /** Half-span for a gable, zero for a flat roof. */
  horizontalRunM: number
  /** The angle the emitted planes actually make. Measured here, checked there. */
  builtPitchDeg: number
  /** What the spec declared, for comparison. Undefined when the spec said nothing. */
  declaredPitchDeg?: number
  triCount: number
  /** The planes this roof emitted, each with the frame its openings live in. */
  planes: RoofPlaneFrame[]
}

export type CompiledRoofOpening = {
  openingId: string
  roofId: string
  planeId: string
  kind: RoofOpeningKind
  /** The unit's own rectangle in the plane frame. */
  unitUV: { u0: number; u1: number; v0: number; v1: number }
  /** The rectangle actually cut out, the unit widened by the tolerance. */
  cutUV: { u0: number; u1: number; v0: number; v1: number }
  /** Area of the cut on the plane, and the roof volume it removed. */
  cutAreaM2: number
  removedVolumeM3: number
}

export type RoofCompileResult = {
  tris: CompiledRoofTri[]
  roofs: CompiledRoof[]
  openings: CompiledRoofOpening[]
  diagnostics: RoofDiagnostic[]
}

const EPS = 1e-9
const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z })

type TriTag = { part: RoofPart; ownerId: string; wallId: string; planeId: string; openingId?: string }

function quad(out: CompiledRoofTri[], p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, tag: TriTag): void {
  out.push({ ...tag, a: p0, b: p1, c: p2 })
  out.push({ ...tag, a: p0, b: p2, c: p3 })
}

/**
 * A closed slab from four top corners and a vertical drop to its underside.
 *
 * The corners must be given anticlockwise seen from above. The underside is the
 * same quad dropped straight down by `verticalDrop`, and the four sides close
 * it, so the result is a hexahedron with a consistent outward winding.
 *
 * The drop is **vertical**, not perpendicular to the plane, and that is a
 * deliberate choice with a measurable consequence. A perpendicular extrusion
 * leaves the eave and ridge end faces tilted, and a tilted ridge face points
 * partly upwards — at 45 degrees it points in exactly the same direction as the
 * opposite slope's top surface, so an oracle that clusters faces by normal
 * silently merges the two and reports a slope longer than it is. Cutting the
 * ends vertically, as a section does, makes every side face vertical and leaves
 * the top surfaces as the only upward-facing geometry there is. The
 * perpendicular thickness is still exact: a vertical drop of `t / cos(pitch)`
 * is a perpendicular depth of `t`.
 */
function slab(
  out: CompiledRoofTri[],
  corners: [Vec3, Vec3, Vec3, Vec3],
  verticalDrop: number,
  tag: TriTag,
): void {
  const back = (p: Vec3): Vec3 => v(p.x, p.y - verticalDrop, p.z)
  // Normalise the winding rather than trust the caller: the handedness of
  // "anticlockwise from above" flips between the two ridge axes, and a slab
  // wound the wrong way is a negative volume that every later check inherits.
  const e1 = v(corners[1].x - corners[0].x, corners[1].y - corners[0].y, corners[1].z - corners[0].z)
  const e2 = v(corners[2].x - corners[0].x, corners[2].y - corners[0].y, corners[2].z - corners[0].z)
  const upY = e1.z * e2.x - e1.x * e2.z
  const [a, b, c, d] = upY >= 0 ? corners : [corners[0], corners[3], corners[2], corners[1]]
  const [ab, bb, cb, db] = [back(a), back(b), back(c), back(d)]
  quad(out, a, b, c, d, tag) // top, outward along the normal
  quad(out, ab, db, cb, bb, tag) // underside, outward the other way
  // Four sides. At edge p->q the outward normal is (q - p) x normal, which is
  // what this corner order gives.
  quad(out, a, ab, bb, b, tag)
  quad(out, b, bb, cb, c, tag)
  quad(out, c, cb, db, d, tag)
  quad(out, d, db, ab, a, tag)
}

// --- openings in a plane ----------------------------------------------------

/** A rectangle in one plane's local frame. */
export type PlaneRect = { u0: number; u1: number; v0: number; v1: number }

export const planeRectOf = (centerUV: { u: number; v: number }, sizeUV: { u: number; v: number }, grow = 0): PlaneRect => ({
  u0: centerUV.u - sizeUV.u / 2 - grow,
  u1: centerUV.u + sizeUV.u / 2 + grow,
  v0: centerUV.v - sizeUV.v / 2 - grow,
  v1: centerUV.v + sizeUV.v / 2 + grow,
})

export const planeRectArea = (r: PlaneRect): number => Math.max(0, r.u1 - r.u0) * Math.max(0, r.v1 - r.v0)

export function planeRectOverlap(a: PlaneRect, b: PlaneRect): number {
  const du = Math.min(a.u1, b.u1) - Math.max(a.u0, b.u0)
  const dv = Math.min(a.v1, b.v1) - Math.max(a.v0, b.v0)
  return du > 0 && dv > 0 ? du * dv : 0
}

/**
 * One rectangle less another, as the up-to-eight rectangles of a 3x3 grid.
 *
 * The obvious tiling is four pieces — two full-width strips and two side
 * fillets — and it is wrong here for a reason worth stating. The four-piece
 * tiling gives the strip above the hole a side face that runs the *whole*
 * width of the plane, of which only the part over the hole is a reveal; the
 * rest is an internal face shared with a fillet. Nothing can then tell a
 * reveal from a seam by looking at the triangles, and this stage's §7 turns on
 * exactly that distinction. Splitting on both of the hole's axes costs four
 * more pieces and makes every face that touches the hole *exactly* the hole's
 * edge.
 *
 * Tolerant of a hole that only partly overlaps the piece, which is what
 * iterating over several holes needs. The pieces tile the difference exactly:
 * no two overlap, and together they cover everything the hole does not.
 */
export function planeRectMinus(p: PlaneRect, h: PlaneRect): PlaneRect[] {
  const iu0 = Math.max(p.u0, h.u0)
  const iu1 = Math.min(p.u1, h.u1)
  const iv0 = Math.max(p.v0, h.v0)
  const iv1 = Math.min(p.v1, h.v1)
  if (!(iu1 > iu0 + EPS && iv1 > iv0 + EPS)) return [p]
  const out: PlaneRect[] = []
  const push = (r: PlaneRect): void => {
    if (r.u1 - r.u0 > EPS && r.v1 - r.v0 > EPS) out.push(r)
  }
  const us: Array<[number, number]> = [
    [p.u0, iu0],
    [iu0, iu1],
    [iu1, p.u1],
  ]
  const vs: Array<[number, number]> = [
    [p.v0, iv0],
    [iv0, iv1],
    [iv1, p.v1],
  ]
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      if (i === 1 && j === 1) continue
      push({ u0: us[i][0], u1: us[i][1], v0: vs[j][0], v1: vs[j][1] })
    }
  }
  return out
}

/**
 * The plane, less every hole, as a grid of rectangles.
 *
 * Every hole's edges are cut lines of the grid, so no cell ever straddles a
 * hole boundary and every face that touches a hole is exactly one of that
 * hole's edges. Taking the holes one at a time and subtracting each from the
 * pieces so far does not have that property — the second hole inherits the
 * first hole's pieces, and where their extents line up it ends up bounded by a
 * face that runs the width of the plane. That face is then partly a reveal and
 * partly a seam, and nothing downstream can tell which part is which.
 *
 * The cost is cells: three holes on one plane give a seven-by-seven grid. They
 * are a development fixture's triangles, and being able to ask "is this face a
 * reveal" and get an answer from the geometry is worth them.
 */
export function planeTiling(lengthU: number, lengthV: number, holes: ReadonlyArray<PlaneRect>): PlaneRect[] {
  const cuts = (lo: number, hi: number, inner: number[]): number[] => {
    const all = [lo, hi, ...inner.filter((x) => x > lo + EPS && x < hi - EPS)].sort((a, b) => a - b)
    const out: number[] = []
    for (const x of all) if (out.length === 0 || x - out[out.length - 1] > EPS) out.push(x)
    return out
  }
  const us = cuts(0, lengthU, holes.flatMap((h) => [h.u0, h.u1]))
  const vs = cuts(0, lengthV, holes.flatMap((h) => [h.v0, h.v1]))
  const out: PlaneRect[] = []
  for (let i = 0; i + 1 < us.length; i++) {
    for (let j = 0; j + 1 < vs.length; j++) {
      const cell = { u0: us[i], u1: us[i + 1], v0: vs[j], v1: vs[j + 1] }
      const cu = (cell.u0 + cell.u1) / 2
      const cv = (cell.v0 + cell.v1) / 2
      if (holes.some((h) => cu > h.u0 + EPS && cu < h.u1 - EPS && cv > h.v0 + EPS && cv < h.v1 - EPS)) continue
      out.push(cell)
    }
  }
  return out
}

/** A point of a plane's top surface, from its local coordinates. */
export const planePointM = (f: RoofPlaneFrame, u: number, vv: number): Vec3 =>
  v(
    f.originM.x + f.uDir.x * u + f.vDir.x * vv,
    f.originM.y + f.uDir.y * u + f.vDir.y * vv,
    f.originM.z + f.uDir.z * u + f.vDir.z * vv,
  )

/** A world point's coordinates in a plane's frame. The inverse of `planePointM`. */
export const planeUVofM = (f: RoofPlaneFrame, p: Vec3): { u: number; v: number } => {
  const d = v(p.x - f.originM.x, p.y - f.originM.y, p.z - f.originM.z)
  return { u: d.x * f.uDir.x + d.y * f.uDir.y + d.z * f.uDir.z, v: d.x * f.vDir.x + d.y * f.vDir.y + d.z * f.vDir.z }
}

/**
 * Where a vertical line through a plan point meets a plane, in the plane frame.
 *
 * This is how a chimney — which is stated in plan, because that is how a plan
 * draws it — becomes a rectangle a plane can cut. The conversion is a
 * projection onto the plane's own axes, so it carries no world assumption of
 * its own: turn the building and the chimney's plan rectangle and the plane's
 * frame turn together, and the answer is the same.
 */
export function planeUVofPlanXZ(f: RoofPlaneFrame, x: number, z: number): { u: number; v: number } {
  // The top surface is originM + u*uDir + v*vDir. Both directions are unit, so
  // solving the two horizontal components gives u and v directly.
  const dx = x - f.originM.x
  const dz = z - f.originM.z
  const det = f.uDir.x * f.vDir.z - f.uDir.z * f.vDir.x
  if (Math.abs(det) < EPS) return { u: NaN, v: NaN }
  return { u: (dx * f.vDir.z - dz * f.vDir.x) / det, v: (f.uDir.x * dz - f.uDir.z * dx) / det }
}

const norm = (p: Vec3): Vec3 => {
  const l = Math.hypot(p.x, p.y, p.z)
  return v(p.x / l, p.y / l, p.z / l)
}

/** Compile one roof into its plane frames. Returns nothing and a diagnostic when it cannot. */
function roofPlanes(
  spec: RoofSpec,
  levelAt: (id: string | undefined) => number | undefined,
  diagnostics: RoofDiagnostic[],
): CompiledRoof | undefined {
  const reject = (code: RoofDiagnosticCode, message: string): undefined => {
    diagnostics.push({ code, severity: 'ERROR', message, roofId: spec.id })
    return undefined
  }

  if (spec.kind !== 'GABLE' && spec.kind !== 'FLAT') {
    return reject(
      'UNSUPPORTED_ROOF_KIND',
      `roof ${spec.id} is ${spec.kind}; this stage compiles GABLE and FLAT only. A ${spec.kind} roof ` +
        'has hips or a single slope that a two-plane gable cannot express, and emitting gable ' +
        'triangles for it would be wrong in every view but one',
    )
  }

  const f = spec.footprint
  if (!(f.maxX - f.minX > EPS) || !(f.maxZ - f.minZ > EPS)) {
    return reject(
      'INVALID_ROOF_FOOTPRINT',
      `roof ${spec.id} spans ${f.minX}..${f.maxX} by ${f.minZ}..${f.maxZ}, which has no area`,
    )
  }
  if (!Number.isFinite(spec.thicknessM) || spec.thicknessM <= 0) {
    return reject('INVALID_ROOF_THICKNESS', `roof ${spec.id} has thickness ${spec.thicknessM}`)
  }

  const eave = levelAt(spec.eaveLevelId)
  if (eave === undefined) {
    return reject('UNKNOWN_ROOF_LEVEL', `roof ${spec.id} names eave level ${spec.eaveLevelId}, which is not in the spec`)
  }

  const oh = Math.max(0, spec.overhangM)

  if (spec.kind === 'FLAT') {
    const x0 = f.minX - oh
    const x1 = f.maxX + oh
    const z0 = f.minZ - oh
    const z1 = f.maxZ + oh
    return {
      roofId: spec.id,
      kind: 'FLAT',
      planeCount: 1,
      eaveM: eave,
      ridgeM: eave,
      horizontalRunM: 0,
      builtPitchDeg: 0,
      declaredPitchDeg: spec.pitchDeg,
      triCount: 0,
      planes: [
        {
          planeId: `${spec.id}:deck`,
          roofId: spec.id,
          originM: v(x0, eave, z0),
          uDir: v(1, 0, 0),
          vDir: v(0, 0, 1),
          normal: v(0, 1, 0),
          lengthU: x1 - x0,
          lengthV: z1 - z0,
          verticalDropM: spec.thicknessM,
          thicknessM: spec.thicknessM,
          pitchDeg: 0,
        },
      ],
    }
  }

  if (!spec.ridgeLevelId || !spec.ridgeAxis) {
    return reject('ROOF_MISSING_RIDGE', `roof ${spec.id} is GABLE but has no ridge level or ridge axis`)
  }
  const ridge = levelAt(spec.ridgeLevelId)
  if (ridge === undefined) {
    return reject('UNKNOWN_ROOF_LEVEL', `roof ${spec.id} names ridge level ${spec.ridgeLevelId}, which is not in the spec`)
  }
  if (ridge <= eave + EPS) {
    return reject(
      'ROOF_RIDGE_BELOW_EAVE',
      `roof ${spec.id} has its ridge at ${ridge} m and its eave at ${eave} m; a gable rises to its ridge`,
    )
  }

  // Everything below is built from the levels and the span. `spec.pitchDeg` is
  // deliberately not read.
  const alongZ = spec.ridgeAxis === 'Z'
  const halfSpan = (alongZ ? f.maxX - f.minX : f.maxZ - f.minZ) / 2
  const rise = ridge - eave
  const slope = rise / halfSpan
  const builtPitchDeg = (Math.atan(slope) * 180) / Math.PI
  // The overhang follows the plane it belongs to, so it drops at the same slope.
  const eaveOuter = eave - oh * slope

  const mid = alongZ ? (f.minX + f.maxX) / 2 : (f.minZ + f.maxZ) / 2
  // A vertical drop of t / cos(pitch) is a perpendicular depth of t.
  const cosPitch = 1 / Math.hypot(slope, 1)
  const verticalDrop = spec.thicknessM / cosPitch

  const P = (along: number, cross: number, y: number): Vec3 => (alongZ ? v(cross, y, along) : v(along, y, cross))
  const a0 = (alongZ ? f.minZ : f.minX) - oh
  const a1 = (alongZ ? f.maxZ : f.maxX) + oh

  /**
   * `side` is which way the eave lies from the ridge along the cross axis, so
   * `slope_minus` is the plane whose eave is at the cross-axis minimum. The
   * names are the plane's own and mention no compass direction: the frame is
   * built from the corners, and a building that is turned keeps both.
   */
  const planeOf = (side: -1 | 1): RoofPlaneFrame => {
    const eaveCross = side < 0 ? (alongZ ? f.minX : f.minZ) - oh : (alongZ ? f.maxX : f.maxZ) + oh
    const crossRun = Math.abs(mid - eaveCross)
    const slopeLen = Math.hypot(crossRun, ridge - eaveOuter)
    const origin = P(a0, eaveCross, eaveOuter)
    const uDir = alongZ ? v(0, 0, 1) : v(1, 0, 0)
    const toRidge = v(
      (P(a0, mid, ridge).x - origin.x) / slopeLen,
      (ridge - eaveOuter) / slopeLen,
      (P(a0, mid, ridge).z - origin.z) / slopeLen,
    )
    // The top surface's outward normal is up the hill and away from the roof:
    // u x v, with the sign chosen so it points upwards.
    const n = norm(
      v(uDir.y * toRidge.z - uDir.z * toRidge.y, uDir.z * toRidge.x - uDir.x * toRidge.z, uDir.x * toRidge.y - uDir.y * toRidge.x),
    )
    return {
      planeId: `${spec.id}:slope_${side < 0 ? 'minus' : 'plus'}`,
      roofId: spec.id,
      originM: origin,
      uDir,
      vDir: toRidge,
      normal: n.y >= 0 ? n : v(-n.x, -n.y, -n.z),
      lengthU: a1 - a0,
      lengthV: slopeLen,
      verticalDropM: verticalDrop,
      thicknessM: spec.thicknessM,
      pitchDeg: builtPitchDeg,
    }
  }

  return {
    roofId: spec.id,
    kind: 'GABLE',
    planeCount: 2,
    eaveM: eave,
    ridgeM: ridge,
    horizontalRunM: halfSpan,
    builtPitchDeg,
    declaredPitchDeg: spec.pitchDeg,
    triCount: 0,
    planes: [planeOf(-1), planeOf(1)],
  }
}

/** The four world corners of a rectangle of a plane's top surface, as a cycle. */
const patchCorners = (f: RoofPlaneFrame, r: PlaneRect): [Vec3, Vec3, Vec3, Vec3] => [
  planePointM(f, r.u0, r.v1),
  planePointM(f, r.u1, r.v1),
  planePointM(f, r.u1, r.v0),
  planePointM(f, r.u0, r.v0),
]

const near = (a: number, b: number, tol = 1e-6): boolean => Math.abs(a - b) <= tol

/**
 * Emit one plane, tiled around its holes, with the hole boundaries named.
 *
 * The reveals are not drawn separately. They are the side faces the tiling
 * already produces where a piece stops at a hole, and they are found the only
 * way that cannot disagree with the geometry: by asking, of each emitted side
 * face, whether it lies on a hole's boundary in the plane's own frame. A
 * reveal list built from the spec instead would say a hole was lined whether
 * or not the triangles were there.
 */
function emitPlane(
  out: CompiledRoofTri[],
  f: RoofPlaneFrame,
  holes: ReadonlyArray<{ id: string; rect: PlaneRect }>,
): void {
  const pieces = planeTiling(f.lengthU, f.lengthV, holes.map((h) => h.rect))
  const from = out.length
  for (const piece of pieces) {
    slab(out, patchCorners(f, piece), f.verticalDropM, {
      part: 'ROOF',
      ownerId: f.roofId,
      wallId: f.roofId,
      planeId: f.planeId,
    })
  }
  if (holes.length === 0) return
  // Name the faces that bound a hole. A face qualifies when all three of its
  // vertices project onto one boundary line of that hole and lie within the
  // hole's extent along the other axis.
  //
  // The projection is the **vertical** one, not the perpendicular one, and the
  // difference is the whole of it. A piece's side faces run from the top
  // surface straight down, so a face's lower vertices are its upper ones
  // dropped in y; measured perpendicular to the plane they land at a different
  // `v` from the edge they belong to, and a test built on that would find no
  // reveals at all. `planeUVofPlanXZ` asks where a vertical line through the
  // vertex meets the plane, which gives a point and its dropped copy the same
  // answer — which is what makes a vertical-sided hole a rectangle in this
  // frame at every depth.
  for (let i = from; i < out.length; i++) {
    const t = out[i]
    const uv = [t.a, t.b, t.c].map((q) => planeUVofPlanXZ(f, q.x, q.z))
    for (const h of holes) {
      const onU = uv.every((q) => near(q.u, h.rect.u0) ) || uv.every((q) => near(q.u, h.rect.u1))
      const onV = uv.every((q) => near(q.v, h.rect.v0)) || uv.every((q) => near(q.v, h.rect.v1))
      const spanU = uv.every((q) => q.u >= h.rect.u0 - 1e-6 && q.u <= h.rect.u1 + 1e-6)
      const spanV = uv.every((q) => q.v >= h.rect.v0 - 1e-6 && q.v <= h.rect.v1 + 1e-6)
      if ((onU && spanV) || (onV && spanU)) {
        out[i] = { ...t, part: 'ROOF_REVEAL', ownerId: h.id, openingId: h.id }
        break
      }
    }
  }
}

/**
 * The unit in the cut: a frame ring through the roof's depth and one pane.
 *
 * Both are sized from the opening, not from the hole, which is the whole point
 * of keeping them apart. When the hole has been cut smaller than the unit the
 * frame lands inside roof material and the overlap is real and measurable,
 * rather than being quietly clipped to fit.
 */
function emitFill(
  out: CompiledRoofTri[],
  f: RoofPlaneFrame,
  openingId: string,
  unit: PlaneRect,
  frameWidthM: number,
): void {
  const w = Math.max(0, Math.min(frameWidthM, (unit.u1 - unit.u0) / 2 - EPS, (unit.v1 - unit.v0) / 2 - EPS))
  const inner: PlaneRect = { u0: unit.u0 + w, u1: unit.u1 - w, v0: unit.v0 + w, v1: unit.v1 - w }
  const tag = (part: RoofPart): TriTag => ({ part, ownerId: openingId, wallId: f.roofId, planeId: f.planeId, openingId })
  for (const ring of planeRectMinus(unit, inner)) {
    slab(out, patchCorners(f, ring), f.verticalDropM, tag('ROOF_FRAME'))
  }
  // The pane is a surface at mid-depth, not a solid: a ray has to pass through
  // a rooflight, and glass that stopped one would make every opening check
  // pass on a roof that was never cut.
  const half = f.verticalDropM / 2
  const [p0, p1, p2, p3] = patchCorners(f, inner).map((p) => v(p.x, p.y - half, p.z)) as [Vec3, Vec3, Vec3, Vec3]
  quad(out, p0, p1, p2, p3, tag('ROOF_GLAZING'))
}

export function compileRoofs(
  roofs: readonly RoofSpec[],
  levels: readonly LevelSpec[],
  roofOpenings: readonly RoofOpeningSpec[] = [],
  roofOpeningFills: readonly RoofOpeningFillSpec[] = [],
): RoofCompileResult {
  const byLevel = new Map(levels.map((l) => [l.id, l.elevationM]))
  const levelAt = (id: string | undefined): number | undefined => (id === undefined ? undefined : byLevel.get(id))
  const tris: CompiledRoofTri[] = []
  const diagnostics: RoofDiagnostic[] = []
  const compiled: CompiledRoof[] = []
  const openings: CompiledRoofOpening[] = []
  const seen = new Set<string>()
  for (const spec of roofs) {
    if (seen.has(spec.id)) {
      diagnostics.push({
        code: 'DUPLICATE_ROOF_ID',
        severity: 'ERROR',
        message: `roof id ${spec.id} appears more than once; the later record was not compiled`,
        roofId: spec.id,
      })
      continue
    }
    seen.add(spec.id)
    const r = roofPlanes(spec, levelAt, diagnostics)
    if (r) compiled.push(r)
  }

  const planeById = new Map<string, RoofPlaneFrame>()
  for (const r of compiled) for (const pl of r.planes) planeById.set(pl.planeId, pl)
  const roofById = new Map(compiled.map((r) => [r.roofId, r]))

  // Sort the openings onto their planes, rejecting the ones that cannot be cut.
  const holesByPlane = new Map<string, Array<{ id: string; rect: PlaneRect }>>()
  const seenOpening = new Set<string>()
  const unitByOpening = new Map<string, { frame: RoofPlaneFrame; unit: PlaneRect }>()
  for (const o of roofOpenings) {
    const reject = (code: RoofDiagnosticCode, message: string): void => {
      diagnostics.push({ code, severity: 'ERROR', message, roofId: o.hostRoofId, planeId: o.hostPlaneId, openingId: o.id })
    }
    if (seenOpening.has(o.id)) {
      reject('DUPLICATE_ROOF_OPENING_ID', `roof opening id ${o.id} appears more than once; the later record was not cut`)
      continue
    }
    seenOpening.add(o.id)
    if (!roofById.has(o.hostRoofId)) {
      reject('ROOF_OPENING_UNKNOWN_ROOF', `roof opening ${o.id} names roof ${o.hostRoofId}, which no plane was compiled for`)
      continue
    }
    const frame = planeById.get(o.hostPlaneId)
    if (!frame || frame.roofId !== o.hostRoofId) {
      reject(
        'ROOF_OPENING_UNKNOWN_PLANE',
        `roof opening ${o.id} names plane ${o.hostPlaneId}, which roof ${o.hostRoofId} did not emit. ` +
          `That roof's planes are ${(roofById.get(o.hostRoofId)?.planes ?? []).map((p) => p.planeId).join(', ')}`,
      )
      continue
    }
    if (!(o.sizeUV.u > EPS) || !(o.sizeUV.v > EPS)) {
      reject('INVALID_ROOF_OPENING', `roof opening ${o.id} is ${o.sizeUV.u} by ${o.sizeUV.v} m, which has no area`)
      continue
    }
    const unit = planeRectOf(o.centerUV, o.sizeUV)
    const cut = planeRectOf(o.centerUV, o.sizeUV, o.cutToleranceM ?? 0)
    if (!(cut.u1 - cut.u0 > EPS) || !(cut.v1 - cut.v0 > EPS)) {
      reject('INVALID_ROOF_OPENING', `roof opening ${o.id} has a clearance of ${o.cutToleranceM} m, which closes the hole`)
      continue
    }
    if (cut.u0 < EPS || cut.v0 < EPS || cut.u1 > frame.lengthU - EPS || cut.v1 > frame.lengthV - EPS) {
      reject(
        'ROOF_OPENING_OUTSIDE_PLANE',
        `roof opening ${o.id} spans u ${cut.u0.toFixed(3)}..${cut.u1.toFixed(3)}, v ${cut.v0.toFixed(3)}..` +
          `${cut.v1.toFixed(3)} on a plane that is ${frame.lengthU.toFixed(3)} by ${frame.lengthV.toFixed(3)} m. ` +
          'An opening has to lie strictly inside its plane: one that reaches an edge is a change to the roof outline, not a hole in it',
      )
      continue
    }
    const list = holesByPlane.get(frame.planeId) ?? []
    const clash = list.find((h) => planeRectOverlap(h.rect, cut) > EPS)
    if (clash) {
      reject('ROOF_OPENINGS_OVERLAP', `roof openings ${clash.id} and ${o.id} overlap on plane ${frame.planeId}`)
      continue
    }
    list.push({ id: o.id, rect: cut })
    holesByPlane.set(frame.planeId, list)
    unitByOpening.set(o.id, { frame, unit })
    const cutArea = planeRectArea(cut)
    openings.push({
      openingId: o.id,
      roofId: o.hostRoofId,
      planeId: frame.planeId,
      kind: o.kind,
      unitUV: unit,
      cutUV: cut,
      cutAreaM2: cutArea,
      // A vertical prism through a plane of pitch p removes plan area times the
      // vertical drop, which is exactly the area on the plane times the
      // perpendicular thickness.
      removedVolumeM3: cutArea * frame.thicknessM,
    })
    if ((o.cutToleranceM ?? 0) < -EPS) {
      diagnostics.push({
        code: 'ROOF_FILL_EXCEEDS_CUT',
        severity: 'ERROR',
        message:
          `roof opening ${o.id} is cut ${(-(o.cutToleranceM ?? 0)).toFixed(3)} m per side smaller than the unit it ` +
          'carries, so the frame stands in roof material',
        roofId: o.hostRoofId,
        planeId: frame.planeId,
        openingId: o.id,
      })
    }
  }

  for (const r of compiled) {
    const before = tris.length
    for (const pl of r.planes) emitPlane(tris, pl, holesByPlane.get(pl.planeId) ?? [])
    r.triCount = tris.length - before
  }

  for (const fill of roofOpeningFills) {
    const target = unitByOpening.get(fill.openingId)
    if (!target) {
      diagnostics.push({
        code: 'ROOF_FILL_UNKNOWN_OPENING',
        severity: 'ERROR',
        message: `roof fill ${fill.id} names opening ${fill.openingId}, which was not cut`,
        openingId: fill.openingId,
      })
      continue
    }
    emitFill(tris, target.frame, fill.openingId, target.unit, fill.frameWidthM)
  }

  return { tris, roofs: compiled, openings, diagnostics }
}
