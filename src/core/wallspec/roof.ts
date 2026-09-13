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
 * PORT_DIRECT (Kotlin).
 */
import type { Vec3 } from '../contracts/geometry.js'
import type { CompiledTri } from './contracts.js'
import type { LevelSpec, RoofSpec } from './architectural.js'

export type RoofDiagnosticCode =
  | 'UNSUPPORTED_ROOF_KIND'
  | 'UNKNOWN_ROOF_LEVEL'
  | 'ROOF_MISSING_RIDGE'
  | 'INVALID_ROOF_FOOTPRINT'
  | 'INVALID_ROOF_THICKNESS'
  | 'ROOF_RIDGE_BELOW_EAVE'
  | 'DUPLICATE_ROOF_ID'

export type RoofDiagnostic = {
  code: RoofDiagnosticCode
  severity: 'ERROR' | 'WARNING'
  message: string
  roofId?: string
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
}

export type RoofCompileResult = {
  tris: CompiledTri[]
  roofs: CompiledRoof[]
  diagnostics: RoofDiagnostic[]
}

const EPS = 1e-9
const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z })

function quad(
  out: CompiledTri[],
  p0: Vec3,
  p1: Vec3,
  p2: Vec3,
  p3: Vec3,
  ownerId: string,
  wallId: string,
): void {
  out.push({ a: p0, b: p1, c: p2, part: 'WALL', ownerId, wallId })
  out.push({ a: p0, b: p2, c: p3, part: 'WALL', ownerId, wallId })
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
  out: CompiledTri[],
  corners: [Vec3, Vec3, Vec3, Vec3],
  verticalDrop: number,
  ownerId: string,
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
  quad(out, a, b, c, d, ownerId, ownerId) // top, outward along the normal
  quad(out, ab, db, cb, bb, ownerId, ownerId) // underside, outward the other way
  // Four sides. At edge p->q the outward normal is (q - p) x normal, which is
  // what this corner order gives.
  quad(out, a, ab, bb, b, ownerId, ownerId)
  quad(out, b, bb, cb, c, ownerId, ownerId)
  quad(out, c, cb, db, d, ownerId, ownerId)
  quad(out, d, db, ab, a, ownerId, ownerId)
}

const norm = (p: Vec3): Vec3 => {
  const l = Math.hypot(p.x, p.y, p.z)
  return v(p.x / l, p.y / l, p.z / l)
}

/** Compile one roof. Returns nothing and a diagnostic when it cannot. */
function compileRoof(
  spec: RoofSpec,
  levelAt: (id: string | undefined) => number | undefined,
  out: CompiledTri[],
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
  const before = out.length

  if (spec.kind === 'FLAT') {
    const x0 = f.minX - oh
    const x1 = f.maxX + oh
    const z0 = f.minZ - oh
    const z1 = f.maxZ + oh
    slab(out, [v(x0, eave, z1), v(x1, eave, z1), v(x1, eave, z0), v(x0, eave, z0)], spec.thicknessM, spec.id)
    return {
      roofId: spec.id,
      kind: 'FLAT',
      planeCount: 1,
      eaveM: eave,
      ridgeM: eave,
      horizontalRunM: 0,
      builtPitchDeg: 0,
      declaredPitchDeg: spec.pitchDeg,
      triCount: out.length - before,
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

  const emitSlope = (side: -1 | 1): void => {
    // `side` is which way the eave lies from the ridge along the cross axis.
    const eaveCross = side < 0 ? (alongZ ? f.minX : f.minZ) - oh : (alongZ ? f.maxX : f.maxZ) + oh
    const a0 = (alongZ ? f.minZ : f.minX) - oh
    const a1 = (alongZ ? f.maxZ : f.maxX) + oh
    const P = (along: number, cross: number, y: number): Vec3 =>
      alongZ ? v(cross, y, along) : v(along, y, cross)
    // Anticlockwise seen from above the plane.
    const corners: [Vec3, Vec3, Vec3, Vec3] =
      side < 0
        ? [P(a0, eaveCross, eaveOuter), P(a1, eaveCross, eaveOuter), P(a1, mid, ridge), P(a0, mid, ridge)]
        : [P(a1, eaveCross, eaveOuter), P(a0, eaveCross, eaveOuter), P(a0, mid, ridge), P(a1, mid, ridge)]
    slab(out, corners, verticalDrop, spec.id)
  }
  emitSlope(-1)
  emitSlope(1)

  return {
    roofId: spec.id,
    kind: 'GABLE',
    planeCount: 2,
    eaveM: eave,
    ridgeM: ridge,
    horizontalRunM: halfSpan,
    builtPitchDeg,
    declaredPitchDeg: spec.pitchDeg,
    triCount: out.length - before,
  }
}

export function compileRoofs(
  roofs: readonly RoofSpec[],
  levels: readonly LevelSpec[],
): RoofCompileResult {
  const byLevel = new Map(levels.map((l) => [l.id, l.elevationM]))
  const levelAt = (id: string | undefined): number | undefined => (id === undefined ? undefined : byLevel.get(id))
  const tris: CompiledTri[] = []
  const diagnostics: RoofDiagnostic[] = []
  const compiled: CompiledRoof[] = []
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
    const r = compileRoof(spec, levelAt, tris, diagnostics)
    if (r) compiled.push(r)
  }
  return { tris, roofs: compiled, diagnostics }
}
