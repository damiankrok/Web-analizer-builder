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
  CompiledWall,
  CompileResult,
  GlazingSpec,
  OpeningSpec,
  WallCompileInput,
  WallDiagnostic,
  WallPart,
  WallSpec,
} from './contracts.js'
import { wallPoint } from './contracts.js'

/** Below this, two break values are the same value. */
const BREAK_EPS = 1e-9
/** Axis unit-length and perpendicularity tolerance. */
const AXIS_EPS = 1e-9

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
): void {
  out.push({ a: p0, b: p1, c: p2, part, ownerId, wallId, openingId })
  out.push({ a: p0, b: p2, c: p3, part, ownerId, wallId, openingId })
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

/** Validate a wall. Returns the reasons it cannot be compiled, if any. */
function checkWall(w: WallSpec): WallDiagnostic[] {
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
function checkOpening(o: OpeningSpec, host: WallSpec): WallDiagnostic[] {
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
  const b1 = o.sillM + o.heightM
  if (a0 < -BREAK_EPS || b0 < -BREAK_EPS || a1 > host.lengthM + BREAK_EPS || b1 > host.heightM + BREAK_EPS) {
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
  // stops at the head — and this stage does not build those.
  if (a0 <= BREAK_EPS || b0 <= BREAK_EPS || a1 >= host.lengthM - BREAK_EPS || b1 >= host.heightM - BREAK_EPS) {
    out.push({
      code: 'OPENING_TOUCHES_WALL_EDGE',
      severity: 'ERROR',
      message:
        `opening ${o.id} touches an edge of wall ${host.id}; this stage compiles ` +
        'only openings strictly inside their host',
      wallId: host.id,
      openingId: o.id,
    })
  }
  return out
}

/** Compile one wall and the openings already validated against it. */
function compileWall(
  w: WallSpec,
  openings: readonly OpeningSpec[],
  glazingFor: ReadonlyMap<string, GlazingSpec>,
  out: CompiledTri[],
): void {
  const P = (a: number, b: number, c: number): Vec3 => wallPoint(w, a, b, c)
  const T = w.thicknessM
  const L = w.lengthM
  const H = w.heightM

  const holes: LocalRect[] = openings.map((o) => ({
    a0: o.offsetM,
    a1: o.offsetM + o.widthM,
    b0: o.sillM,
    b1: o.sillM + o.heightM,
  }))
  const aBreaks = breaks(0, L, holes.flatMap((h) => [h.a0, h.a1]))
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

  // Ends, split on the height breaks so they meet the faces edge to edge.
  for (let j = 0; j + 1 < bBreaks.length; j++) {
    const b0 = bBreaks[j]
    const b1 = bBreaks[j + 1]
    quad(out, P(0, b0, 0), P(0, b1, 0), P(0, b1, T), P(0, b0, T), 'WALL', w.id, w.id) // -u
    quad(out, P(L, b0, 0), P(L, b0, T), P(L, b1, T), P(L, b1, 0), 'WALL', w.id, w.id) // +u
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
 * Compile every wall in the input.
 *
 * The input is never mutated; the result is built from scratch. Given the same
 * input the output is identical, element for element and float for float —
 * there is no iteration over a hash map, no clock and no randomness.
 */
export function compileWalls(input: WallCompileInput): CompileResult {
  const diagnostics: WallDiagnostic[] = []
  const tris: CompiledTri[] = []
  const compiled: CompiledWall[] = []

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
    const problems = checkOpening(o, host)
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
    compileWall(w, openings, glazingFor, tris)
    compiled.push({ wallId: w.id, openingIds: openings.map((o) => o.id), triCount: tris.length - before })
  }

  return { tris, walls: compiled, diagnostics }
}
