/**
 * Wall-local compiler — STAGE WEB-PIVOT-01, development only.
 *
 * Turns a `WallSpec` and its own openings into a closed, consistently
 * outward-oriented triangle mesh with the openings cut through and lined.
 *
 * ## Why it is watertight
 *
 * The wall is a box minus one or more rectangular through-holes. Its boundary
 * is decomposed on a single grid: the break values along the wall's length are
 * `{0, every opening edge, length}` and along its height `{0, every opening
 * edge, height}`. The outer and inner faces are tiled cell by cell on that
 * grid, skipping cells that fall inside a hole; the two ends are split on the
 * height breaks and the top and bottom on the length breaks; and each hole
 * contributes four reveal faces spanning exactly one cell of the grid.
 *
 * Splitting the ends, top and bottom on the *same* grid is what makes the mesh
 * a manifold rather than merely watertight-looking. If the end faces were left
 * as single rectangles, every break on the face beside them would land in the
 * middle of an end-face edge — a T-junction, which no closed-surface or volume
 * oracle will accept, and which leaves a hairline crack under any renderer that
 * interpolates per-vertex.
 *
 * Every vertex is computed by `wallPoint` from its local `(a, b, c)`, so two
 * faces meeting on an edge produce bit-identical world coordinates.
 *
 * ## Why it does not care where the building is
 *
 * Nothing here reads a bounding box, a facade side, a sibling wall or any other
 * mass. `compileWall` sees one `WallSpec` and the openings that name it. A wall
 * recessed behind its neighbours compiles to exactly the same local geometry as
 * a flush one, transformed by its own frame — not because a tolerance was
 * widened, but because the question "which facade plane is this near?" is never
 * asked.
 *
 * ## Scope
 *
 * Rectangular panels, rectangular through-openings, non-overlapping, strictly
 * inside their host. Anything else returns an explicit diagnostic rather than
 * partial geometry. Nothing is dropped silently.
 *
 * PORT_DIRECT (Kotlin).
 */
import type { Vec3 } from '../contracts/geometry.js'
import type {
  CompiledTri,
  ContactKind,
  CompiledWall,
  CompileResult,
  GlazingSpec,
  OpeningSpec,
  WallCompileInput,
  WallDiagnostic,
  WallExtent,
  WallPart,
  WallSpec,
} from './contracts.js'
import { wallFrame, wallPoint } from './contracts.js'

/** Below this, two break values are the same value. */
const BREAK_EPS = 1e-9
/** Axis unit-length and perpendicularity tolerance. */
const AXIS_EPS = 1e-9
/**
 * Below this, a top plane is too near parallel to the wall's `up` to intersect.
 *
 * `up` is unit length and the normal is normalised before the test, so this is
 * the sine of the angle between the plane and the wall's horizontal — a soffit
 * within about 6e-6 degrees of vertical. Anything flatter than that is a
 * modelling error, not a steep roof.
 */
const PLANE_EPS = 1e-7

const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z
const len = (a: Vec3): number => Math.hypot(a.x, a.y, a.z)

type LocalRect = { a0: number; a1: number; b0: number; b1: number }

/**
 * Emit a planar quad as two triangles.
 *
 * The corners must be given so that `(p1 - p0) x (p2 - p0)` points out of the
 * solid; both triangles then wind the same way and the surface normal is
 * consistent. Each call site below states which axis it is facing.
 */
function quad(
  out: CompiledTri[],
  p0: Vec3,
  p1: Vec3,
  p2: Vec3,
  p3: Vec3,
  part: WallPart,
  ownerId: string,
  wallId: string,
  openingId?: string,
  contactId?: string,
  contactKind?: ContactKind,
): void {
  out.push({ a: p0, b: p1, c: p2, part, ownerId, wallId, openingId, contactId, contactKind })
  out.push({ a: p0, b: p2, c: p3, part, ownerId, wallId, openingId, contactId, contactKind })
}

/** Sorted unique break values spanning `lo..hi`. */
function breaks(lo: number, hi: number, inner: readonly number[]): number[] {
  const all = [lo, hi, ...inner].sort((x, y) => x - y)
  const out: number[] = []
  for (const x of all) {
    if (x < lo - BREAK_EPS || x > hi + BREAK_EPS) continue
    if (out.length === 0 || x - out[out.length - 1] > BREAK_EPS) out.push(x)
  }
  return out
}

const midInside = (r: LocalRect, a: number, b: number): boolean =>
  a > r.a0 - BREAK_EPS && a < r.a1 + BREAK_EPS && b > r.b0 - BREAK_EPS && b < r.b1 + BREAK_EPS

const rectsOverlap = (p: LocalRect, q: LocalRect): boolean =>
  p.a0 < q.a1 - BREAK_EPS && q.a0 < p.a1 - BREAK_EPS && p.b0 < q.b1 - BREAK_EPS && q.b0 < p.b1 - BREAK_EPS

/**
 * Validate a wall. Returns the reasons it cannot be compiled, if any.
 *
 * Exported because the junction layer has to know whether a wall is well formed
 * *before* it does any corner arithmetic on its axes: running the exterior-corner
 * test on a wall whose `u` is not a unit vector produces a confident answer to a
 * meaningless question, and two diagnostics where one would do.
 */
export function checkWall(w: WallSpec): WallDiagnostic[] {
  const out: WallDiagnostic[] = []
  const bad = (field: string, value: number): void => {
    out.push({
      code: 'INVALID_WALL_DIMENSION',
      severity: 'ERROR',
      message: `wall ${w.id}: ${field} must be a positive finite number, got ${value}`,
      wallId: w.id,
    })
  }
  if (!Number.isFinite(w.lengthM) || w.lengthM <= 0) bad('lengthM', w.lengthM)
  if (!Number.isFinite(w.heightM) || w.heightM <= 0) bad('heightM', w.heightM)
  if (!Number.isFinite(w.thicknessM) || w.thicknessM <= 0) bad('thicknessM', w.thicknessM)

  const prof = w.topProfile
  if (prof?.kind === 'POLYLINE') {
    const pts = prof.points
    if (pts.length < 2) {
      out.push({
        code: 'INVALID_WALL_PROFILE',
        severity: 'ERROR',
        message: `wall ${w.id}: a top profile needs at least two points, got ${pts.length}`,
        wallId: w.id,
      })
    } else {
      for (let i = 0; i < pts.length; i++) {
        const q = pts[i]
        if (!Number.isFinite(q.u) || !Number.isFinite(q.topM) || q.topM <= 0) {
          out.push({
            code: 'INVALID_WALL_PROFILE',
            severity: 'ERROR',
            message: `wall ${w.id}: profile point ${i} is (${q.u}, ${q.topM}); u and a positive topM are required`,
            wallId: w.id,
          })
        } else if (i > 0 && q.u < pts[i - 1].u - AXIS_EPS) {
          out.push({
            code: 'INVALID_WALL_PROFILE',
            severity: 'ERROR',
            message: `wall ${w.id}: profile point ${i} is at u = ${q.u}, behind point ${i - 1} at ${pts[i - 1].u}; points must run along the wall`,
            wallId: w.id,
          })
        }
      }
    }
  } else if (prof?.kind === 'PLANE') {
    const pl = prof.plane
    const finite = (v: Vec3): boolean => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)
    if (!finite(pl.pointM) || !finite(pl.normal)) {
      out.push({
        code: 'INVALID_WALL_PROFILE',
        severity: 'ERROR',
        message: `wall ${w.id}: top plane point and normal must be finite`,
        wallId: w.id,
      })
    } else if (!(len(pl.normal) > AXIS_EPS)) {
      out.push({
        code: 'INVALID_WALL_PROFILE',
        severity: 'ERROR',
        message: `wall ${w.id}: top plane normal is degenerate (length ${len(pl.normal)})`,
        wallId: w.id,
      })
    } else {
      // The wall rises along `up`; a top plane it never meets is not a top. A
      // vertical soffit is the case that matters — a wall under it would have
      // no finite height at all, and dividing by the tiny denominator would
      // emit one hundreds of metres tall instead of saying so.
      const sin = dot(w.up, pl.normal) / (len(w.up) * len(pl.normal))
      if (Math.abs(sin) <= PLANE_EPS) {
        out.push({
          code: 'WALL_TOP_PLANE_UNCROSSABLE',
          severity: 'ERROR',
          message:
            `wall ${w.id}: its top plane is parallel to the wall's own up axis ` +
            `(up . n / |n| = ${sin}), so the wall never reaches it`,
          wallId: w.id,
        })
      }
    }
    if (prof.sourceRoofId.length === 0) {
      out.push({
        code: 'INVALID_WALL_PROFILE',
        severity: 'ERROR',
        message: `wall ${w.id}: a PLANE top must name the roof whose underside it is`,
        wallId: w.id,
      })
    }
  }

  const lu = len(w.u)
  const lup = len(w.up)
  const perp = dot(w.u, w.up)
  if (Math.abs(lu - 1) > AXIS_EPS || Math.abs(lup - 1) > AXIS_EPS || Math.abs(perp) > AXIS_EPS) {
    out.push({
      code: 'NON_ORTHONORMAL_AXES',
      severity: 'ERROR',
      message:
        `wall ${w.id}: u and up must be unit length and perpendicular ` +
        `(|u| = ${lu}, |up| = ${lup}, u.up = ${perp})`,
      wallId: w.id,
    })
  }
  return out
}

/** Validate one opening against its host. Returns the reasons it is rejected. */
function checkOpening(o: OpeningSpec, host: WallSpec, extent: WallExtent): WallDiagnostic[] {
  const out: WallDiagnostic[] = []
  const bad = (field: string, value: number): void => {
    out.push({
      code: 'INVALID_OPENING_DIMENSION',
      severity: 'ERROR',
      message: `opening ${o.id}: ${field} must be a positive finite number, got ${value}`,
      wallId: host.id,
      openingId: o.id,
    })
  }
  if (!Number.isFinite(o.widthM) || o.widthM <= 0) bad('widthM', o.widthM)
  if (!Number.isFinite(o.heightM) || o.heightM <= 0) bad('heightM', o.heightM)
  if (!Number.isFinite(o.offsetM)) bad('offsetM', o.offsetM)
  if (!Number.isFinite(o.sillM)) bad('sillM', o.sillM)
  if (out.length > 0) return out

  const a0 = o.offsetM
  const a1 = o.offsetM + o.widthM
  const b0 = o.sillM
  const b1 = Math.max(o.sillM + o.heightM, o.sillM + (o.heightFarM ?? o.heightM))
  // How high the wall gets anywhere the opening could be. For a POLYLINE that
  // is the tallest stated point; for a PLANE, the top is linear in `u` so the
  // extremes are at the emitted ends, on whichever face is higher.
  const nominalTop = !host.topProfile
    ? host.heightM
    : host.topProfile.kind === 'POLYLINE'
      ? Math.max(...host.topProfile.points.map((q) => q.topM))
      : Math.max(topMaxAt(host, extent.a0), topMaxAt(host, extent.a1))
  if (a0 < -BREAK_EPS || b0 < -BREAK_EPS || a1 > host.lengthM + BREAK_EPS || b1 > nominalTop + BREAK_EPS) {
    out.push({
      code: 'OPENING_OUTSIDE_HOST',
      severity: 'ERROR',
      message:
        `opening ${o.id} spans ${a0}..${a1} along and ${b0}..${b1} up wall ${host.id}, ` +
        `which is ${host.lengthM} x ${host.heightM}`,
      wallId: host.id,
      openingId: o.id,
    })
    return out
  }
  // Flush with an edge leaves no material on that side. The cut is legitimate
  // but it is a different element — a doorway to the wall's end, or a wall that
  // stops at the head — and the rectangular path does not build those.
  //
  // The base is the one exception, and only on the profiled path: Marcowki's
  // gable glazing is a door onto a balcony, so its sill *is* the attic floor,
  // and the profiled tiling emits that correctly by collapsing the band below
  // the sill and leaving the wall's underside open across the opening. The
  // rectangular path's rule is deliberately left exactly as STAGE
  // WEB-PIVOT-01 proved it.
  const profiled = host.topProfile !== undefined || o.heightFarM !== undefined
  const baseFlush = b0 <= BREAK_EPS
  if (
    a0 <= BREAK_EPS ||
    a1 >= host.lengthM - BREAK_EPS ||
    b1 >= nominalTop - BREAK_EPS ||
    (baseFlush && !profiled)
  ) {
    out.push({
      code: 'OPENING_TOUCHES_WALL_EDGE',
      severity: 'ERROR',
      message:
        `opening ${o.id} touches an edge of wall ${host.id}; this stage compiles ` +
        'only openings strictly inside their host',
      wallId: host.id,
      openingId: o.id,
    })
    return out
  }
  if (host.topProfile) {
    // Under a sloped top, "inside the wall" is not a rectangle. Both head
    // corners have to clear the profile, or the cut would open the roof.
    //
    // Under a PLANE top the wall is lower on one face than the other, and the
    // cut goes through both, so the head is measured against the *lower* of
    // them. STAGE WEB-PIVOT-02A refuses an opening that reaches the soffit
    // rather than clipping it to some shape nobody wrote down: the head of a
    // window is a stated dimension, and a compiler that silently turned it into
    // a rake would be inventing the drawing.
    const headNear = o.sillM + o.heightM
    const headFar = o.sillM + (o.heightFarM ?? o.heightM)
    const topNear = topMinAt(host, a0)
    const topFar = topMinAt(host, a1)
    // A PLANE top must be *cleared*, not merely reached: an opening whose head
    // lands exactly on the soffit at one face and below it at the other leaves
    // a zero-height band on one side of the wall and not the other. The wall
    // would still close, but nobody drew that, so it is refused by name.
    const margin = host.topProfile.kind === 'PLANE' ? -BREAK_EPS : BREAK_EPS
    if (headNear > topNear + margin || headFar > topFar + margin) {
      out.push({
        code: 'OPENING_ABOVE_WALL_PROFILE',
        severity: 'ERROR',
        message:
          `opening ${o.id} reaches ${headNear.toFixed(3)} m at u = ${a0} and ${headFar.toFixed(3)} m at ` +
          `u = ${a1}, where wall ${host.id} is only ${topNear.toFixed(3)} m and ${topFar.toFixed(3)} m high; ` +
          'the opening is not clipped to fit',
        wallId: host.id,
        openingId: o.id,
      })
      return out
    }
  }

  // The opening is inside the wall the drawing describes. It may still be
  // inside the part of it a junction took away, and that is refused rather than
  // repaired: moving the opening would put a window somewhere nobody asked for,
  // and clipping it would emit a reveal face onto a plane that is buried inside
  // the neighbouring wall. Both are worse than saying so.
  if (a0 <= extent.a0 + BREAK_EPS || a1 >= extent.a1 - BREAK_EPS) {
    out.push({
      code: 'OPENING_IN_TRIMMED_ZONE',
      severity: 'ERROR',
      message:
        `opening ${o.id} spans ${a0}..${a1} along wall ${host.id}, which is compiled only over ` +
        `${extent.a0}..${extent.a1} because a junction gave the rest of it to another wall; ` +
        'the opening is not moved and not clipped',
      wallId: host.id,
      openingId: o.id,
    })
  }
  return out
}

/** The whole wall — the extent every wall has unless a junction says otherwise. */
const fullExtent = (w: WallSpec): WallExtent => ({ a0: 0, a1: w.lengthM })

/** Validate a compiled extent against the wall it belongs to. */
function checkExtent(w: WallSpec, e: WallExtent): WallDiagnostic[] {
  const out: WallDiagnostic[] = []
  const bad = (why: string): void => {
    out.push({
      code: 'INVALID_WALL_EXTENT',
      severity: 'ERROR',
      message: `wall ${w.id}: compiled extent ${e.a0}..${e.a1} ${why} (nominal length ${w.lengthM} m)`,
      wallId: w.id,
    })
  }
  if (!Number.isFinite(e.a0) || !Number.isFinite(e.a1)) bad('is not finite')
  else if (e.a1 - e.a0 <= BREAK_EPS) bad('is empty or inverted')
  else if (e.a0 < -BREAK_EPS || e.a1 > w.lengthM + BREAK_EPS) bad('reaches outside the wall')
  return out
}

/**
 * Validate a wall's top over the span that is actually emitted.
 *
 * Separate from `checkWall` because it needs the extent: a junction may have
 * given part of the wall away, and a top that dips below the base out there is
 * not this wall's problem. The top is linear in `u` on a `PLANE` and piecewise
 * linear on a `POLYLINE`, so the minimum over the emitted rectangle is attained
 * at one of its corners — the extent ends crossed with the two faces, plus any
 * interior profile vertex.
 */
function checkWallTop(w: WallSpec, e: WallExtent): WallDiagnostic[] {
  if (!w.topProfile) return []
  const us = [e.a0, e.a1]
  if (w.topProfile.kind === 'POLYLINE') {
    for (const q of w.topProfile.points) if (q.u > e.a0 && q.u < e.a1) us.push(q.u)
  }
  let worstU = e.a0
  let worst = Infinity
  for (const u of us) {
    for (const c of [0, w.thicknessM]) {
      const t = wallTopAt(w, u, c)
      if (!Number.isFinite(t) || t < worst) {
        worst = Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY
        worstU = u
      }
    }
  }
  if (worst > BREAK_EPS) return []
  return [
    {
      code: 'WALL_TOP_BELOW_BASE',
      severity: 'ERROR',
      message:
        `wall ${w.id}: its top reaches only ${worst} m above the base at u = ${worstU}, so the wall ` +
        'has no material there; a top profile describes where the wall stops, it does not invert it',
      wallId: w.id,
    },
  ]
}

/**
 * Compile one wall and the openings already validated against it.
 *
 * `extent` is the span of the wall's own `u` coordinate that is emitted. It
 * replaces the literal `0` and `lengthM` that used to bound the tiling, and
 * nothing else changes: the grid, the winding and the vertex function are the
 * ones STAGE WEB-PIVOT-01 proved. A wall with the default full extent therefore
 * compiles to exactly the triangles it did before junctions existed.
 */
function compileWall(
  w: WallSpec,
  extent: WallExtent,
  openings: readonly OpeningSpec[],
  glazingFor: ReadonlyMap<string, GlazingSpec>,
  out: CompiledTri[],
): void {
  const P = (a: number, b: number, c: number): Vec3 => wallPoint(w, a, b, c)
  const T = w.thicknessM
  const A0 = extent.a0
  const A1 = extent.a1
  const H = w.heightM

  const holes: LocalRect[] = openings.map((o) => ({
    a0: o.offsetM,
    a1: o.offsetM + o.widthM,
    b0: o.sillM,
    b1: o.sillM + o.heightM,
  }))
  const aBreaks = breaks(A0, A1, holes.flatMap((h) => [h.a0, h.a1]))
  const bBreaks = breaks(0, H, holes.flatMap((h) => [h.b0, h.b1]))

  // Outer face, c = 0, outward +n. Inner face, c = T, outward -n.
  for (let i = 0; i + 1 < aBreaks.length; i++) {
    for (let j = 0; j + 1 < bBreaks.length; j++) {
      const a0 = aBreaks[i]
      const a1 = aBreaks[i + 1]
      const b0 = bBreaks[j]
      const b1 = bBreaks[j + 1]
      const am = (a0 + a1) / 2
      const bm = (b0 + b1) / 2
      if (holes.some((h) => midInside(h, am, bm))) continue
      quad(out, P(a0, b0, 0), P(a1, b0, 0), P(a1, b1, 0), P(a0, b1, 0), 'WALL', w.id, w.id)
      quad(out, P(a0, b0, T), P(a0, b1, T), P(a1, b1, T), P(a1, b0, T), 'WALL_INNER', w.id, w.id)
    }
  }

  // Ends, split on the height breaks so they meet the faces edge to edge. An end
  // cut back by a junction is still a face of the closed solid; it just carries
  // the junction's id so a caller can tell it apart from exposed fabric.
  for (let j = 0; j + 1 < bBreaks.length; j++) {
    const b0 = bBreaks[j]
    const b1 = bBreaks[j + 1]
    const k0: ContactKind | undefined = extent.a0ContactId ? 'JUNCTION' : undefined
    const k1: ContactKind | undefined = extent.a1ContactId ? 'JUNCTION' : undefined
    quad(out, P(A0, b0, 0), P(A0, b1, 0), P(A0, b1, T), P(A0, b0, T), 'WALL', w.id, w.id, undefined, extent.a0ContactId, k0) // -u
    quad(out, P(A1, b0, 0), P(A1, b0, T), P(A1, b1, T), P(A1, b1, 0), 'WALL', w.id, w.id, undefined, extent.a1ContactId, k1) // +u
  }

  // Bottom and top, split on the length breaks for the same reason.
  for (let i = 0; i + 1 < aBreaks.length; i++) {
    const a0 = aBreaks[i]
    const a1 = aBreaks[i + 1]
    quad(out, P(a0, 0, 0), P(a0, 0, T), P(a1, 0, T), P(a1, 0, 0), 'WALL', w.id, w.id) // -up
    quad(out, P(a0, H, 0), P(a1, H, 0), P(a1, H, T), P(a0, H, T), 'WALL', w.id, w.id) // +up
  }

  for (const o of openings) {
    const a0 = o.offsetM
    const a1 = o.offsetM + o.widthM
    const b0 = o.sillM
    const b1 = o.sillM + o.heightM
    // Reveals line the cut. Each faces *into* the hole, which is out of the
    // solid: the jamb at a0 has material behind it at a < a0, so it faces +u.
    quad(out, P(a0, b0, 0), P(a0, b0, T), P(a0, b1, T), P(a0, b1, 0), 'REVEAL', o.id, w.id, o.id) // +u
    quad(out, P(a1, b0, 0), P(a1, b1, 0), P(a1, b1, T), P(a1, b0, T), 'REVEAL', o.id, w.id, o.id) // -u
    quad(out, P(a0, b0, 0), P(a1, b0, 0), P(a1, b0, T), P(a0, b0, T), 'REVEAL', o.id, w.id, o.id) // +up (sill)
    quad(out, P(a0, b1, 0), P(a0, b1, T), P(a1, b1, T), P(a1, b1, 0), 'REVEAL', o.id, w.id, o.id) // -up (head)

    const g = glazingFor.get(o.id)
    if (!g) continue
    const c = g.insetM
    quad(out, P(a0, b0, c), P(a1, b0, c), P(a1, b1, c), P(a0, b1, c), 'GLAZING', g.id, w.id, o.id)
  }
}

/**
 * Height of a wall's top above its base at position `u`, on the face `c` metres
 * in from the outer face.
 *
 * Three cases, and the third is the whole of STAGE WEB-PIVOT-02A:
 *
 *   - **no profile** — a flat top at the nominal height, which is what every
 *     wall in STAGE WEB-PIVOT-01, 01B and 01C has. `c` is not read.
 *   - **`POLYLINE`** — piecewise linear in `u`. Outside the profile's own span
 *     the first and last points hold, so a profile never has to restate the
 *     ends. `c` is not read: a gable end has one top edge.
 *   - **`PLANE`** — the height at which the wall's material line at `(u, c)`
 *     meets the stated world plane. This is the only case where the answer
 *     depends on `c`, and it is what closes the eave wedge: the outer face and
 *     the inner face stop at different heights because the soffit above them is
 *     not level.
 *
 * The plane solve is one line of algebra and no iteration. A point of the wall
 * is `p(b) = wallPoint(w, u, 0, c) + b * up`; it is on the plane when
 * `(p(b) - pointM) . normal = 0`, so
 *
 *     b = ((pointM - wallPoint(w, u, 0, c)) . normal) / (up . normal)
 *
 * which is defined exactly when `up` is not parallel to the plane. `checkWall`
 * refuses a wall whose plane fails that test rather than dividing by something
 * near zero and emitting a wall a kilometre tall.
 */
export function wallTopAt(w: WallSpec, u: number, c: number): number {
  const prof = w.topProfile
  if (!prof) return w.heightM
  if (prof.kind === 'PLANE') {
    const up = wallFrame(w).up
    const nLen = len(prof.plane.normal)
    const den = dot(up, prof.plane.normal)
    if (!(nLen > 0) || Math.abs(den) <= PLANE_EPS * nLen) return w.heightM
    const base = wallPoint(w, u, 0, c)
    const d = {
      x: prof.plane.pointM.x - base.x,
      y: prof.plane.pointM.y - base.y,
      z: prof.plane.pointM.z - base.z,
    }
    return dot(d, prof.plane.normal) / den
  }
  const pts = prof.points
  if (pts.length === 0) return w.heightM
  if (u <= pts[0].u) return pts[0].topM
  const last = pts[pts.length - 1]
  if (u >= last.u) return last.topM
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    if (u >= a.u && u <= b.u) {
      const span = b.u - a.u
      return span <= BREAK_EPS ? b.topM : a.topM + ((u - a.u) / span) * (b.topM - a.topM)
    }
  }
  return last.topM
}

/** Lowest the wall top gets at `u`, across the full thickness. */
const topMinAt = (w: WallSpec, u: number): number =>
  Math.min(wallTopAt(w, u, 0), wallTopAt(w, u, w.thicknessM))

/** Highest the wall top gets at `u`, across the full thickness. */
const topMaxAt = (w: WallSpec, u: number): number =>
  Math.max(wallTopAt(w, u, 0), wallTopAt(w, u, w.thicknessM))

/** Head height of an opening above the wall base at `u`, raked or level. */
const headAt = (o: OpeningSpec, u: number): number => {
  const near = o.sillM + o.heightM
  if (o.heightFarM === undefined) return near
  const far = o.sillM + o.heightFarM
  const span = o.widthM
  return span <= BREAK_EPS ? far : near + ((u - o.offsetM) / span) * (far - near)
}

/** True when a wall needs the profiled path rather than the proven rectangular one. */
const needsProfiledPath = (w: WallSpec, openings: readonly OpeningSpec[]): boolean =>
  w.topProfile !== undefined || openings.some((o) => o.heightFarM !== undefined)

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x)

/**
 * A wall whose top is a polyline, whose opening may have a raked head, or both.
 *
 * ## Why this is a second path and not a generalisation
 *
 * STAGE WEB-PIVOT-01's tiling is proven, and everything built on it since — the
 * junction extents, the ring, the ownership schedules — is proven against the
 * triangles it emits. A wall with a flat top and level openings still goes
 * through that code, untouched, and produces the identical triangles it always
 * did. This path runs only for the shapes the old one cannot express.
 *
 * ## How it stays watertight with slanted edges
 *
 * The face is tiled in vertical strips rather than on a 2D grid, and every
 * strip is split into the **same three bands** at both of its ends:
 *
 *     0  ..  sill  ..  head(u)  ..  top(u)
 *
 * The two middle boundaries come from the opening — clamped into `[0, top(u)]`
 * so they stay ordered — and they are computed at *every* strip boundary, not
 * only inside the opening. That is the whole trick: two neighbouring strips
 * always cut their shared vertical edge at the same four heights, so no face
 * ever meets the middle of another face's edge. Outside the opening's span the
 * middle band is simply solid; where a band collapses to zero height the quad
 * degenerates to a triangle or vanishes, and both cases keep the edge count
 * right.
 *
 * At most one opening per wall takes this path. Two raked heads could cross
 * each other and reorder the bands, which would silently break the pairing, so
 * a second opening is refused by name instead.
 */
function compileProfiledWall(
  w: WallSpec,
  extent: WallExtent,
  openings: readonly OpeningSpec[],
  glazingFor: ReadonlyMap<string, GlazingSpec>,
  out: CompiledTri[],
): void {
  const P = (a: number, b: number, c: number): Vec3 => wallPoint(w, a, b, c)
  const T = w.thicknessM
  const A0 = extent.a0
  const A1 = extent.a1
  /**
   * The openings cut into this wall, and the one whose sill and head set the
   * band schedule.
   *
   * STAGE WEB-PIVOT-02 compiled exactly one opening on this path, because two
   * *raked* heads can cross each other and reorder the bands the tiling pairs
   * up. STAGE WEB-PIVOT-04 needs three doorways on one attic corridor wall, and
   * those have level heads at a common sill and a common height — so the three
   * band boundaries are the same constants the whole length of the wall, every
   * strip is split at the same four heights, and the pairing cannot reorder.
   * `compileWalls` checks exactly that precondition before calling here; where
   * it does not hold it still passes one opening and says so, as before.
   */
  const holes = openings
  const schedule = openings[0]
  /**
   * The roof this wall's top dies into, when it has one.
   *
   * A `PLANE` top is not exposed fabric: the roof sits on it. Tagging the top
   * face with the roof's id keeps it out of every facade measure — the same
   * mechanism a junction uses for a trimmed end — and says which element it is
   * in contact with. A `POLYLINE` gable end is genuinely outside, so it is not
   * tagged, and STAGE WEB-PIVOT-02's facade numbers are unchanged.
   */
  const soffitId = w.topProfile?.kind === 'PLANE' ? w.topProfile.sourceRoofId : undefined

  /**
   * The three band boundaries at `(u, c)`, always non-decreasing, always four
   * long.
   *
   * Only the last boundary — the wall top — can depend on `c`, and only under a
   * `PLANE` profile. The sill and the head are opening coordinates, which this
   * stage does not touch: a window is at the same height on both faces of the
   * wall, whatever the roof above it is doing.
   */
  const bands = (u: number, c: number): [number, number, number, number] => {
    const t0 = wallTopAt(w, u, c)
    if (!schedule) return [0, t0, t0, t0]
    const sill = clamp(schedule.sillM, 0, t0)
    const head = clamp(Math.max(headAt(schedule, u), schedule.sillM), sill, t0)
    return [0, sill, head, t0]
  }

  const aBreaks = breaks(
    A0,
    A1,
    [
      ...(w.topProfile?.kind === 'POLYLINE' ? w.topProfile.points.map((q) => q.u) : []),
      ...holes.flatMap((h) => [h.offsetM, h.offsetM + h.widthM]),
    ].filter((u) => u > A0 + BREAK_EPS && u < A1 - BREAK_EPS),
  )

  /** Emit a planar quad, collapsing either degenerate edge to a triangle. */
  const face = (
    p0: Vec3,
    p1: Vec3,
    p2: Vec3,
    p3: Vec3,
    degenerate01: boolean,
    degenerate23: boolean,
    part: WallPart,
    ownerId: string,
    openingId?: string,
    contactId?: string,
    contactKind?: ContactKind,
  ): void => {
    if (degenerate01 && degenerate23) return
    const tag = { part, ownerId, wallId: w.id, openingId, contactId, contactKind }
    if (degenerate01) out.push({ a: p0, b: p2, c: p3, ...tag })
    else if (degenerate23) out.push({ a: p0, b: p1, c: p2, ...tag })
    else quad(out, p0, p1, p2, p3, part, ownerId, w.id, openingId, contactId, contactKind)
  }

  /** The opening a strip falls inside, when it falls inside one. */
  const activeHole = (u0: number, u1: number): OpeningSpec | undefined =>
    holes.find((h) => u0 >= h.offsetM - BREAK_EPS && u1 <= h.offsetM + h.widthM + BREAK_EPS)

  for (let i = 0; i + 1 < aBreaks.length; i++) {
    const u0 = aBreaks[i]
    const u1 = aBreaks[i + 1]
    const LO = bands(u0, 0)
    const RO = bands(u1, 0)
    const LI = bands(u0, T)
    const RI = bands(u1, T)
    const active = activeHole(u0, u1)
    const void1 = active !== undefined

    for (let j = 0; j < 3; j++) {
      if (j === 1 && void1) continue
      // Outer face, outward +n.
      face(
        P(u0, LO[j], 0),
        P(u1, RO[j], 0),
        P(u1, RO[j + 1], 0),
        P(u0, LO[j + 1], 0),
        Math.abs(RO[j + 1] - RO[j]) <= BREAK_EPS,
        Math.abs(LO[j + 1] - LO[j]) <= BREAK_EPS,
        'WALL',
        w.id,
      )
      // Inner face, outward -n: the same corners the other way round, at its
      // own band heights — under a PLANE top the two faces stop at different
      // places, and that difference *is* the wedge this stage closes.
      face(
        P(u0, LI[j], T),
        P(u0, LI[j + 1], T),
        P(u1, RI[j + 1], T),
        P(u1, RI[j], T),
        Math.abs(LI[j + 1] - LI[j]) <= BREAK_EPS,
        Math.abs(RI[j + 1] - RI[j]) <= BREAK_EPS,
        'WALL_INNER',
        w.id,
      )
    }

    // Bottom, outward -up — but not under an opening that reaches the base: a
    // door to floor level has no wall underneath it to close off.
    const openToBase = void1 && LO[1] <= BREAK_EPS && RO[1] <= BREAK_EPS
    if (!openToBase) quad(out, P(u0, 0, 0), P(u0, 0, T), P(u1, 0, T), P(u1, 0, 0), 'WALL', w.id, w.id)
    // Top. Under a POLYLINE the four corners are at two heights and this is the
    // ribbon STAGE WEB-PIVOT-02 emitted; under a PLANE all four lie on the
    // stated plane, so the quad is planar and *is* the soffit contact.
    quad(
      out,
      P(u0, LO[3], 0),
      P(u1, RO[3], 0),
      P(u1, RI[3], T),
      P(u0, LI[3], T),
      'WALL',
      w.id,
      w.id,
      undefined,
      soffitId,
      soffitId ? 'ROOF_SOFFIT' : undefined,
    )

    if (active) {
      const id = active.id
      // Sill, outward +up; head, outward the other way, both following the strip.
      // A sill at the wall base is the wall's own underside, already closed (or
      // deliberately open) above, so it is not emitted twice.
      if (!openToBase) quad(out, P(u0, LO[1], 0), P(u1, RO[1], 0), P(u1, RO[1], T), P(u0, LO[1], T), 'REVEAL', id, w.id, id)
      quad(out, P(u0, LO[2], 0), P(u0, LO[2], T), P(u1, RO[2], T), P(u1, RO[2], 0), 'REVEAL', id, w.id, id)
    }
  }

  // Ends, split on the same bands so they meet the faces edge to edge. Each
  // band is a trapezoid, not a rectangle: the top boundary is at one height on
  // the outer face and another on the inner. An end cut back by a junction
  // carries that junction's id, exactly as the rectangular path's ends do —
  // without it a trimmed profiled wall would report its buried end face as
  // facade, which is what STAGE WEB-PIVOT-02's attic walls were doing.
  for (const [u, outward, contactId] of [
    [A0, -1, extent.a0ContactId],
    [A1, 1, extent.a1ContactId],
  ] as const) {
    const BO = bands(u, 0)
    const BI = bands(u, T)
    for (let j = 0; j < 3; j++) {
      const dOuter = Math.abs(BO[j + 1] - BO[j]) <= BREAK_EPS
      const dInner = Math.abs(BI[j + 1] - BI[j]) <= BREAK_EPS
      const kind: ContactKind | undefined = contactId ? 'JUNCTION' : undefined
      if (outward < 0) {
        face(
          P(u, BO[j], 0),
          P(u, BO[j + 1], 0),
          P(u, BI[j + 1], T),
          P(u, BI[j], T),
          dOuter,
          dInner,
          'WALL',
          w.id,
          undefined,
          contactId,
          kind,
        )
      } else {
        face(
          P(u, BO[j], 0),
          P(u, BI[j], T),
          P(u, BI[j + 1], T),
          P(u, BO[j + 1], 0),
          dInner,
          dOuter,
          'WALL',
          w.id,
          undefined,
          contactId,
          kind,
        )
      }
    }
  }

  // Jambs: each opening's two vertical edges, spanning its own band there.
  for (const hole of holes) {
    const h0 = hole.offsetM
    const h1 = hole.offsetM + hole.widthM
    const B0 = bands(h0, 0)
    const B1 = bands(h1, 0)
    quad(out, P(h0, B0[1], 0), P(h0, B0[1], T), P(h0, B0[2], T), P(h0, B0[2], 0), 'REVEAL', hole.id, w.id, hole.id)
    quad(out, P(h1, B1[1], 0), P(h1, B1[2], 0), P(h1, B1[2], T), P(h1, B1[1], T), 'REVEAL', hole.id, w.id, hole.id)

    const g = glazingFor.get(hole.id)
    if (!g) continue
    const c = g.insetM
    quad(out, P(h0, B0[1], c), P(h1, B1[1], c), P(h1, B1[2], c), P(h0, B0[2], c), 'GLAZING', g.id, w.id, hole.id)
  }
}

/**
 * True when every opening in the set cuts the same three bands.
 *
 * The profiled tiling splits every strip at `0 | sill | head(u) | top(u)`. With
 * one opening those boundaries are the same functions of `u` everywhere on the
 * wall, whatever the opening's shape. With several they are only the same
 * everywhere when no head is raked and all of them share a sill and a height —
 * and that is precisely the condition under which the strips of two different
 * openings still meet edge to edge. Anything else keeps STAGE WEB-PIVOT-02's
 * rule: one opening, and the rest refused by name rather than mis-tiled.
 */
const sharesOneBandSchedule = (openings: readonly OpeningSpec[]): boolean =>
  openings.length <= 1 ||
  openings.every(
    (o) =>
      o.heightFarM === undefined &&
      Math.abs(o.sillM - openings[0].sillM) <= BREAK_EPS &&
      Math.abs(o.heightM - openings[0].heightM) <= BREAK_EPS,
  )

/**
 * Compile every wall in the input.
 *
 * The input is never mutated; the result is built from scratch. Given the same
 * input the output is identical, element for element and float for float —
 * there is no iteration over a hash map, no clock and no randomness.
 *
 * `extents` is optional and is how STAGE WEB-PIVOT-01B trims a wall at a
 * junction without touching a single input record. Omit it and every wall
 * compiles over its full nominal length, which is what every caller before that
 * stage does.
 */
export function compileWalls(
  input: WallCompileInput,
  extents?: ReadonlyMap<string, WallExtent>,
): CompileResult {
  const diagnostics: WallDiagnostic[] = []
  const tris: CompiledTri[] = []
  const compiled: CompiledWall[] = []
  const extentOf = new Map<string, WallExtent>()

  // Walls, by id. A duplicate id is an error for the *second* wall: the first
  // keeps the name it was given, so openings hosted by it still compile.
  const byId = new Map<string, WallSpec>()
  const usable: WallSpec[] = []
  for (const w of input.walls) {
    if (byId.has(w.id)) {
      diagnostics.push({
        code: 'DUPLICATE_WALL_ID',
        severity: 'ERROR',
        message: `wall id ${w.id} appears more than once; the later wall was not compiled`,
        wallId: w.id,
      })
      continue
    }
    const problems = checkWall(w)
    byId.set(w.id, w)
    if (problems.length > 0) {
      diagnostics.push(...problems)
      continue
    }
    const extent = extents?.get(w.id) ?? fullExtent(w)
    const extentProblems = checkExtent(w, extent)
    if (extentProblems.length === 0) extentProblems.push(...checkWallTop(w, extent))
    if (extentProblems.length > 0) {
      diagnostics.push(...extentProblems)
      continue
    }
    extentOf.set(w.id, extent)
    usable.push(w)
  }

  // Openings, resolved onto their host wall and validated there.
  const seenOpening = new Set<string>()
  const accepted = new Map<string, OpeningSpec[]>()
  for (const o of input.openings) {
    if (seenOpening.has(o.id)) {
      diagnostics.push({
        code: 'DUPLICATE_OPENING_ID',
        severity: 'ERROR',
        message: `opening id ${o.id} appears more than once; the later opening was not compiled`,
        openingId: o.id,
      })
      continue
    }
    seenOpening.add(o.id)
    const host = byId.get(o.hostWallId)
    if (!host) {
      diagnostics.push({
        code: 'UNKNOWN_HOST_WALL',
        severity: 'ERROR',
        message: `opening ${o.id} names host wall ${o.hostWallId}, which is not in the input`,
        openingId: o.id,
        wallId: o.hostWallId,
      })
      continue
    }
    if (!usable.includes(host)) continue // the host's own diagnostic already says why
    const problems = checkOpening(o, host, extentOf.get(host.id)!)
    if (problems.length > 0) {
      diagnostics.push(...problems)
      continue
    }
    const already = accepted.get(host.id) ?? []
    const clash = already.find((p) =>
      rectsOverlap(
        { a0: p.offsetM, a1: p.offsetM + p.widthM, b0: p.sillM, b1: p.sillM + p.heightM },
        { a0: o.offsetM, a1: o.offsetM + o.widthM, b0: o.sillM, b1: o.sillM + o.heightM },
      ),
    )
    if (clash) {
      diagnostics.push({
        code: 'OVERLAPPING_OPENINGS',
        severity: 'ERROR',
        message:
          `opening ${o.id} overlaps ${clash.id} on wall ${host.id}; overlapping cuts are not ` +
          'supported at this stage and would emit reveal faces inside the hole',
        wallId: host.id,
        openingId: o.id,
      })
      continue
    }
    already.push(o)
    accepted.set(host.id, already)
  }

  // Glazing, resolved onto its opening.
  const seenGlazing = new Set<string>()
  const glazingFor = new Map<string, GlazingSpec>()
  const openingById = new Map<string, { spec: OpeningSpec; host: WallSpec }>()
  for (const [wallId, list] of accepted) {
    const host = byId.get(wallId)!
    for (const o of list) openingById.set(o.id, { spec: o, host })
  }
  for (const g of input.glazing) {
    if (seenGlazing.has(g.id)) {
      diagnostics.push({
        code: 'DUPLICATE_GLAZING_ID',
        severity: 'ERROR',
        message: `glazing id ${g.id} appears more than once; the later record was not compiled`,
        glazingId: g.id,
      })
      continue
    }
    seenGlazing.add(g.id)
    const target = openingById.get(g.openingId)
    if (!target) {
      diagnostics.push({
        code: 'UNKNOWN_GLAZING_OPENING',
        severity: 'ERROR',
        message: `glazing ${g.id} names opening ${g.openingId}, which was not compiled`,
        glazingId: g.id,
        openingId: g.openingId,
      })
      continue
    }
    if (!Number.isFinite(g.insetM) || g.insetM < 0 || g.insetM > target.host.thicknessM) {
      diagnostics.push({
        code: 'GLAZING_OUTSIDE_THICKNESS',
        severity: 'ERROR',
        message:
          `glazing ${g.id} sits ${g.insetM} m in from the outer face of wall ${target.host.id}, ` +
          `whose thickness is ${target.host.thicknessM} m`,
        glazingId: g.id,
        openingId: g.openingId,
        wallId: target.host.id,
      })
      continue
    }
    glazingFor.set(g.openingId, g)
  }

  for (const w of usable) {
    const openings = accepted.get(w.id) ?? []
    const before = tris.length
    const extent = extentOf.get(w.id)!
    if (needsProfiledPath(w, openings)) {
      const cuttable = sharesOneBandSchedule(openings) ? openings : openings.slice(0, 1)
      if (cuttable.length < openings.length) {
        diagnostics.push({
          code: 'TOO_MANY_OPENINGS_ON_PROFILED_WALL',
          severity: 'ERROR',
          message:
            `wall ${w.id} has a sloped top or a raked head and ${openings.length} openings that do not ` +
            'share one sill and head; this stage compiles one opening on such a wall, because two raked ' +
            'heads can cross and reorder the bands the tiling pairs up. The extra openings were not cut',
          wallId: w.id,
        })
      }
      compileProfiledWall(w, extent, cuttable, glazingFor, tris)
    } else {
      compileWall(w, extent, openings, glazingFor, tris)
    }
    compiled.push({ wallId: w.id, openingIds: openings.map((o) => o.id), triCount: tris.length - before })
  }

  return { tris, walls: compiled, diagnostics }
}
