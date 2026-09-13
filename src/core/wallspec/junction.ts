/**
 * Orthogonal wall-junction ownership — STAGE WEB-PIVOT-01B, development only.
 *
 * STAGE WEB-PIVOT-01 proved one wall. Two walls meeting at a corner is not the
 * same problem twice: the corner prism belongs to both descriptions and to only
 * one building. Compile them independently and that material is emitted twice —
 * the volume is over by `tA x tB x h`, the two solids interpenetrate, and any
 * closed-volume oracle over a storey is wrong before it starts. Take it off both
 * and there is a hole at the corner instead.
 *
 * ## The contract
 *
 * The corner is owned, explicitly, by a record that says so. A `WallJunctionSpec`
 * names two walls, the end of each that meets, and which of the two keeps the
 * corner. Nothing is inferred: this module never looks at a set of walls and
 * decides where the corners probably are. Topology inference is a different
 * problem with a different failure mode, and mixing it into the geometry would
 * make every corner bug ambiguous between "the junction is wrong" and "the
 * junction was never found".
 *
 *   - the OWNER keeps its nominal extent and is compiled exactly as if the
 *     junction did not exist;
 *   - the NON-OWNER has its *emitted material* cut back at the joined end by the
 *     owner's thickness, which is precisely the depth of the owner's slab it
 *     would otherwise duplicate;
 *   - neither `WallSpec` is modified. The trim is a `WallExtent`, an output of
 *     compilation, and the wall's `lengthM` still says what the drawing says.
 *
 * That last point is the one with teeth. Shortening the non-owner's `lengthM`
 * would be the obvious implementation and it would silently move every opening
 * on that wall, because an opening's `offsetM` is measured from the wall origin.
 * Here the interval is expressed in the wall's original coordinate, so an
 * opening at 1.5 m is at 1.5 m in both owner variants and under every rigid
 * motion. An opening that falls in the trimmed zone is refused by name rather
 * than moved or clipped.
 *
 * ## Scope
 *
 * Orthogonal axes, `BUTT` only, one explicit owner, two walls per junction, an
 * exterior corner. MITRE, tee, arbitrary angles, curves and inferred topology
 * are out, and each returns its own diagnostic rather than an approximation.
 *
 * PORT_DIRECT (Kotlin) — plain data and pure functions.
 */
import type { Vec3 } from '../contracts/geometry.js'
import type {
  CompiledTri,
  CompiledWall,
  GlazingSpec,
  OpeningSpec,
  WallDiagnostic,
  WallExtent,
  WallSpec,
} from './contracts.js'
import { SOLID_PARTS, wallFrame, wallPoint } from './contracts.js'
import { checkWall, compileWalls } from './compile.js'

/** Which end of a wall's own `u` axis a junction refers to. */
export type WallEnd = 'START' | 'END'

/**
 * One explicitly owned corner between two walls.
 *
 * `ownerWallId` must be `wallAId` or `wallBId`. There is no default and no
 * tie-break rule: a corner whose owner is not stated is not a corner this stage
 * will build, because "whichever came first in the array" is exactly the kind of
 * rule that makes a model depend on input order.
 */
export type WallJunctionSpec = {
  id: string
  wallAId: string
  wallAEnd: WallEnd
  wallBId: string
  wallBEnd: WallEnd
  /** Butt only at this stage. A mitre divides the corner; a butt assigns it. */
  kind: 'BUTT'
  ownerWallId: string
}

export type JunctionCompileInput = {
  walls: readonly WallSpec[]
  openings: readonly OpeningSpec[]
  glazing: readonly GlazingSpec[]
  junctions: readonly WallJunctionSpec[]
}

export type JunctionDiagnosticCode =
  | 'DUPLICATE_JUNCTION_ID'
  | 'UNSUPPORTED_JUNCTION_KIND'
  | 'UNKNOWN_JUNCTION_WALL'
  | 'JUNCTION_WALL_NOT_COMPILABLE'
  | 'JUNCTION_SELF_REFERENCE'
  | 'JUNCTION_OWNER_NOT_A_MEMBER'
  | 'CONFLICTING_JUNCTION_END'
  | 'JUNCTION_UP_AXES_NOT_ALIGNED'
  | 'JUNCTION_NOT_ORTHOGONAL'
  | 'JUNCTION_ENDS_DO_NOT_MEET'
  | 'JUNCTION_HEIGHT_MISMATCH'
  | 'JUNCTION_NOT_EXTERIOR_CORNER'
  | 'JUNCTION_TRIM_EXCEEDS_WALL'

export type JunctionDiagnostic = {
  code: JunctionDiagnosticCode
  severity: 'ERROR' | 'WARNING'
  message: string
  junctionId?: string
  wallId?: string
}

/** What a junction actually did, in measurable terms. */
export type CompiledJunction = {
  junctionId: string
  ownerWallId: string
  ownerEnd: WallEnd
  /** The wall whose emitted material was cut back. */
  trimmedWallId: string
  trimmedEnd: WallEnd
  /** How far back, along the trimmed wall's own `u`. Equals the owner's thickness. */
  trimM: number
  /** The corner prism, emitted exactly once — by the owner. */
  cornerVolumeM3: number
  /**
   * Area of the trimmed wall's new end face, which is pressed against the
   * owner's material and is therefore not exposed fabric.
   */
  contactAreaM2: number
  /** The corner itself: outer face, wall base, where the two ends meet. */
  cornerPoint: Vec3
}

export type JunctionCompileResult = {
  tris: CompiledTri[]
  walls: CompiledWall[]
  junctions: CompiledJunction[]
  /** The interval of each wall's own length that was emitted, for audit. */
  extents: Array<{ wallId: string } & WallExtent>
  diagnostics: Array<WallDiagnostic | JunctionDiagnostic>
}

/** Corner coincidence tolerance, metres. Loose enough for a drawing, tight enough to mean something. */
const MEET_EPS_M = 1e-6
/** Axis alignment tolerance, as a dot product. */
const DIR_EPS = 1e-9

const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z
const dist = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
const neg = (a: Vec3): Vec3 => ({ x: -a.x, y: -a.y, z: -a.z })
const near = (a: Vec3, b: Vec3): boolean => dot(a, b) > 1 - DIR_EPS

/** The outer-face, base-level point at one end of a wall. */
export const endPoint = (w: WallSpec, e: WallEnd): Vec3 =>
  wallPoint(w, e === 'START' ? 0 : w.lengthM, 0, 0)

/** Unit direction pointing from that end into the wall's own body. */
export const endInwardDir = (w: WallSpec, e: WallEnd): Vec3 => (e === 'START' ? w.u : neg(w.u))

/**
 * Apply one junction's trim to a wall's running extent.
 *
 * Composing rather than replacing, so a wall that is the non-owner at both ends
 * loses material at both — which is what a run of three walls needs and costs
 * nothing to allow here.
 */
function trimExtent(e: WallExtent, end: WallEnd, trimM: number, contactId: string): WallExtent {
  return end === 'START'
    ? { ...e, a0: e.a0 + trimM, a0ContactId: contactId }
    : { ...e, a1: e.a1 - trimM, a1ContactId: contactId }
}

/**
 * Resolve junctions to per-wall compiled extents, then compile.
 *
 * Validation is ordered so that the first reported reason is the most specific
 * one: a junction between walls that are not at right angles is reported as
 * non-orthogonal, not as a pair of ends that fail to meet, because the second
 * message would send a reader looking at the wrong number.
 */
export function compileJunctions(input: JunctionCompileInput): JunctionCompileResult {
  const diagnostics: Array<WallDiagnostic | JunctionDiagnostic> = []
  const junctions: CompiledJunction[] = []
  const extents = new Map<string, WallExtent>()

  const byId = new Map<string, WallSpec>()
  for (const w of input.walls) if (!byId.has(w.id)) byId.set(w.id, w)

  const extentOf = (w: WallSpec): WallExtent => extents.get(w.id) ?? { a0: 0, a1: w.lengthM }

  const seenJunction = new Set<string>()
  /** `wallId|END` -> the junction that already claimed it. */
  const claimedEnd = new Map<string, string>()

  const reject = (code: JunctionDiagnosticCode, j: WallJunctionSpec, message: string, wallId?: string): void => {
    diagnostics.push({ code, severity: 'ERROR', message, junctionId: j.id, wallId })
  }

  for (const j of input.junctions) {
    if (seenJunction.has(j.id)) {
      reject('DUPLICATE_JUNCTION_ID', j, `junction id ${j.id} appears more than once; the later record was ignored`)
      continue
    }
    seenJunction.add(j.id)

    if (j.kind !== 'BUTT') {
      reject(
        'UNSUPPORTED_JUNCTION_KIND',
        j,
        `junction ${j.id} is ${String(j.kind)}; this stage builds BUTT only, where one wall owns the ` +
          'whole corner. A mitre divides the corner between both walls and is a different construction',
      )
      continue
    }

    if (j.wallAId === j.wallBId) {
      reject('JUNCTION_SELF_REFERENCE', j, `junction ${j.id} names wall ${j.wallAId} on both sides`, j.wallAId)
      continue
    }

    const a = byId.get(j.wallAId)
    const b = byId.get(j.wallBId)
    if (!a || !b) {
      const missing = !a ? j.wallAId : j.wallBId
      reject('UNKNOWN_JUNCTION_WALL', j, `junction ${j.id} names wall ${missing}, which is not in the input`, missing)
      continue
    }

    if (j.ownerWallId !== j.wallAId && j.ownerWallId !== j.wallBId) {
      reject(
        'JUNCTION_OWNER_NOT_A_MEMBER',
        j,
        `junction ${j.id} gives the corner to ${j.ownerWallId}, which is neither ${j.wallAId} nor ${j.wallBId}`,
        j.ownerWallId,
      )
      continue
    }

    const ends: Array<[WallSpec, WallEnd]> = [
      [a, j.wallAEnd],
      [b, j.wallBEnd],
    ]
    const clash = ends.find(([w, e]) => claimedEnd.has(`${w.id}|${e}`))
    if (clash) {
      const key = `${clash[0].id}|${clash[1]}`
      reject(
        'CONFLICTING_JUNCTION_END',
        j,
        `junction ${j.id} claims the ${clash[1]} end of wall ${clash[0].id}, which junction ` +
          `${claimedEnd.get(key)!} already owns; one wall end joins at most one corner`,
        clash[0].id,
      )
      continue
    }

    const illFormed = [a, b].find((w) => checkWall(w).length > 0)
    if (illFormed) {
      reject(
        'JUNCTION_WALL_NOT_COMPILABLE',
        j,
        `junction ${j.id} cannot be resolved because wall ${illFormed.id} is not well formed; ` +
          'its own diagnostic says why',
        illFormed.id,
      )
      continue
    }

    const fa = wallFrame(a)
    const fb = wallFrame(b)

    if (!near(fa.up, fb.up)) {
      reject(
        'JUNCTION_UP_AXES_NOT_ALIGNED',
        j,
        `junction ${j.id}: walls ${a.id} and ${b.id} do not share an up axis, so they do not stand ` +
          'on the same base plane and the corner prism is not a prism',
      )
      continue
    }

    if (Math.abs(dot(fa.u, fb.u)) > 1e-6) {
      reject(
        'JUNCTION_NOT_ORTHOGONAL',
        j,
        `junction ${j.id}: the axes of ${a.id} and ${b.id} meet at ` +
          `${((Math.acos(Math.min(1, Math.abs(dot(fa.u, fb.u)))) * 180) / Math.PI).toFixed(3)} degrees from ` +
          'perpendicular; this stage builds right-angled corners only',
      )
      continue
    }

    const pa = endPoint(a, j.wallAEnd)
    const pb = endPoint(b, j.wallBEnd)
    if (dist(pa, pb) > MEET_EPS_M) {
      reject(
        'JUNCTION_ENDS_DO_NOT_MEET',
        j,
        `junction ${j.id}: the ${j.wallAEnd} end of ${a.id} is ${dist(pa, pb).toFixed(6)} m from the ` +
          `${j.wallBEnd} end of ${b.id}, measured at the outer face and wall base`,
      )
      continue
    }

    if (Math.abs(a.heightM - b.heightM) > MEET_EPS_M) {
      reject(
        'JUNCTION_HEIGHT_MISMATCH',
        j,
        `junction ${j.id}: ${a.id} is ${a.heightM} m high and ${b.id} is ${b.heightM} m; a butt corner ` +
          'between walls of different heights leaves material above the shorter one that one trim cannot describe',
      )
      continue
    }

    // An exterior corner, stated as a property of the two frames rather than of
    // the world: walking into either wall from the corner must go behind the
    // other's outer face. The reflex arrangement — both walls turning away from
    // each other — passes every test above and shares no corner volume at all,
    // so trimming it would cut a hole in a wall for nothing.
    const inA = endInwardDir(a, j.wallAEnd)
    const inB = endInwardDir(b, j.wallBEnd)
    if (!near(inA, neg(fb.n)) || !near(inB, neg(fa.n))) {
      reject(
        'JUNCTION_NOT_EXTERIOR_CORNER',
        j,
        `junction ${j.id}: ${a.id} and ${b.id} meet at their stated ends but their outward normals do ` +
          'not form an exterior corner, so there is no shared corner prism for an owner to keep',
      )
      continue
    }

    const owner = j.ownerWallId === a.id ? a : b
    const ownerEnd = j.ownerWallId === a.id ? j.wallAEnd : j.wallBEnd
    const trimmed = owner === a ? b : a
    const trimmedEnd = owner === a ? j.wallBEnd : j.wallAEnd
    const trimM = owner.thicknessM

    const current = extentOf(trimmed)
    if (current.a1 - current.a0 - trimM <= MEET_EPS_M) {
      reject(
        'JUNCTION_TRIM_EXCEEDS_WALL',
        j,
        `junction ${j.id}: trimming ${trimmed.id} by the ${trimM} m thickness of ${owner.id} would leave ` +
          `${(current.a1 - current.a0 - trimM).toFixed(6)} m of it; the corner is longer than the wall`,
        trimmed.id,
      )
      continue
    }

    for (const [w, e] of ends) claimedEnd.set(`${w.id}|${e}`, j.id)
    extents.set(trimmed.id, trimExtent(current, trimmedEnd, trimM, j.id))
    junctions.push({
      junctionId: j.id,
      ownerWallId: owner.id,
      ownerEnd,
      trimmedWallId: trimmed.id,
      trimmedEnd,
      trimM,
      cornerVolumeM3: owner.thicknessM * trimmed.thicknessM * owner.heightM,
      contactAreaM2: trimmed.thicknessM * trimmed.heightM,
      cornerPoint: pa,
    })
  }

  const compiled = compileWalls(
    { walls: input.walls, openings: input.openings, glazing: input.glazing },
    extents,
  )

  return {
    tris: compiled.tris,
    walls: compiled.walls,
    junctions,
    extents: input.walls.map((w) => ({ wallId: w.id, ...extentOf(w) })),
    diagnostics: [...diagnostics, ...compiled.diagnostics],
  }
}

/**
 * Area of emitted wall surface that is genuinely exposed.
 *
 * Experimental, and the reason it exists is §12 of the stage brief: separate
 * closed solids in contact are acceptable *provided* nothing downstream reads
 * the contact as facade. A butt corner puts one full wall section — thickness by
 * height — flat against the owner's material, and a measure that counted it
 * would report a building with more outside than it has.
 *
 * It excludes the faces this compiler knows are in contact, which at this stage
 * means the trimmed wall's new end face. It does **not** subtract the patch of
 * the owner's inner face that the same contact covers: that face is interior
 * anyway, and tagging it would need the owner's grid split at the corner. Stated
 * here rather than left for someone to discover.
 */
export function exposedWallAreaM2(tris: readonly CompiledTri[]): number {
  let total = 0
  for (const t of tris) {
    if (!SOLID_PARTS.includes(t.part)) continue
    if (t.contactId) continue
    const e1 = { x: t.b.x - t.a.x, y: t.b.y - t.a.y, z: t.b.z - t.a.z }
    const e2 = { x: t.c.x - t.a.x, y: t.c.y - t.a.y, z: t.c.z - t.a.z }
    const n = {
      x: e1.y * e2.z - e1.z * e2.y,
      y: e1.z * e2.x - e1.x * e2.z,
      z: e1.x * e2.y - e1.y * e2.x,
    }
    total += Math.hypot(n.x, n.y, n.z) / 2
  }
  return total
}
