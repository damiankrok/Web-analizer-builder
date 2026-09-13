/**
 * Independent geometric oracles.
 *
 * These exist to check emitted triangles *without* re-using anything the code
 * under test used to emit them. Nothing here imports from `src/core/wallspec/`,
 * and none of these algorithms appears in the compiler: the compiler tiles a
 * grid and never computes a volume, a shared-edge count or a ray intersection.
 * A test built on them can fail for a reason the compiler's author did not
 * think of, which is the only kind of test worth writing about geometry.
 */

export type OTri = { a: OVec; b: OVec; c: OVec }
export type OVec = { x: number; y: number; z: number }

const sub = (p: OVec, q: OVec): OVec => ({ x: p.x - q.x, y: p.y - q.y, z: p.z - q.z })
const cross = (p: OVec, q: OVec): OVec => ({
  x: p.y * q.z - p.z * q.y,
  y: p.z * q.x - p.x * q.z,
  z: p.x * q.y - p.y * q.x,
})
const dot = (p: OVec, q: OVec): number => p.x * q.x + p.y * q.y + p.z * q.z

/**
 * Enclosed volume by the divergence theorem.
 *
 * For a closed surface, the integral of the position field's divergence over
 * the interior is three times the volume, and it reduces to a sum over the
 * triangles of `a . (b x c) / 6`. The sign is positive when the surface is
 * oriented outwards, so this measures orientation as well as size — a mesh
 * wound inside-out returns the negative of its volume, and a half-inverted one
 * returns something that is neither.
 */
export function meshVolume(tris: readonly OTri[]): number {
  let six = 0
  for (const t of tris) six += dot(t.a, cross(t.b, t.c))
  return six / 6
}

/** Surface area, used to sanity-check that a volume did not come from nothing. */
export function meshArea(tris: readonly OTri[]): number {
  let total = 0
  for (const t of tris) {
    const n = cross(sub(t.b, t.a), sub(t.c, t.a))
    total += Math.hypot(n.x, n.y, n.z) / 2
  }
  return total
}

export type ManifoldReport = {
  /** Every directed edge has exactly one reverse partner. */
  closed: boolean
  /** No directed edge appears twice — the winding is consistent. */
  orientable: boolean
  /** Directed edges with no reverse: the mesh has a hole or a T-junction. */
  boundaryEdges: string[]
  /** Directed edges appearing more than once: two faces wound the same way. */
  duplicateEdges: string[]
  vertexCount: number
  edgeCount: number
}

/**
 * Closed-surface and orientation check by directed-edge pairing.
 *
 * On a closed, consistently oriented triangle mesh every edge is traversed
 * exactly twice: once as `p -> q` by one face and once as `q -> p` by its
 * neighbour. A hole leaves an unpaired directed edge. A T-junction does too,
 * because the long side of the junction is one edge while the short sides are
 * two. A face wound the wrong way produces a duplicate rather than a pair.
 *
 * Vertices are compared **exactly**. That is deliberate: the compiler computes
 * every vertex from its local coordinates through one function, so two faces
 * sharing an edge must produce identical doubles. Comparing within a tolerance
 * would let a genuine hairline crack pass.
 */
export function manifoldReport(tris: readonly OTri[]): ManifoldReport {
  const key = (p: OVec): string => `${p.x},${p.y},${p.z}`
  const directed = new Map<string, number>()
  const vertices = new Set<string>()
  for (const t of tris) {
    const ks = [key(t.a), key(t.b), key(t.c)]
    for (const k of ks) vertices.add(k)
    for (let i = 0; i < 3; i++) {
      const e = `${ks[i]}|${ks[(i + 1) % 3]}`
      directed.set(e, (directed.get(e) ?? 0) + 1)
    }
  }
  const boundaryEdges: string[] = []
  const duplicateEdges: string[] = []
  for (const [e, count] of directed) {
    if (count > 1) duplicateEdges.push(e)
    const [from, to] = e.split('|')
    if ((directed.get(`${to}|${from}`) ?? 0) !== count) boundaryEdges.push(e)
  }
  return {
    closed: boundaryEdges.length === 0,
    orientable: duplicateEdges.length === 0,
    boundaryEdges: boundaryEdges.sort(),
    duplicateEdges: duplicateEdges.sort(),
    vertexCount: vertices.size,
    edgeCount: directed.size,
  }
}

export type RayHit = { t: number; index: number }

/**
 * Every intersection of a ray with a triangle list, by Moller-Trumbore.
 *
 * Both facings count: the question these tests ask is "how much material does
 * this line of sight pass through", and a wall answers two — its outer face and
 * its inner face. Hits are returned in order along the ray.
 */
export function rayHits(
  tris: readonly OTri[],
  origin: OVec,
  direction: OVec,
  epsilon = 1e-12,
): RayHit[] {
  const out: RayHit[] = []
  for (let i = 0; i < tris.length; i++) {
    const tri = tris[i]
    const e1 = sub(tri.b, tri.a)
    const e2 = sub(tri.c, tri.a)
    const pv = cross(direction, e2)
    const det = dot(e1, pv)
    if (Math.abs(det) < epsilon) continue // ray parallel to the triangle's plane
    const inv = 1 / det
    const tv = sub(origin, tri.a)
    const u = dot(tv, pv) * inv
    if (u < 0 || u > 1) continue
    const qv = cross(tv, e1)
    const v = dot(direction, qv) * inv
    if (v < 0 || u + v > 1) continue
    const t = dot(e2, qv) * inv
    if (t < epsilon) continue
    out.push({ t, index: i })
  }
  return out.sort((p, q) => p.t - q.t)
}

/**
 * Distinct surfaces a ray passes through, from its raw hits.
 *
 * Hits at the same distance are one surface met once. A ray aimed at the exact
 * centre of a quad runs along the diagonal its two triangles share and is
 * reported by both; counting raw hits there would say "two panes of glass"
 * where there is one. Both faces of a wall are still two crossings, because
 * they are 0.45 m apart.
 */
export function surfaceCrossings(hits: readonly { t: number }[], tolerance = 1e-9): number {
  let n = 0
  let last = Number.NEGATIVE_INFINITY
  for (const h of hits) {
    if (h.t - last > tolerance) n++
    last = h.t
  }
  return n
}

/** Axis-aligned bounds of a triangle list. */
export function meshBounds(tris: readonly OTri[]): {
  min: OVec
  max: OVec
  size: OVec
} {
  const min = { x: Infinity, y: Infinity, z: Infinity }
  const max = { x: -Infinity, y: -Infinity, z: -Infinity }
  for (const t of tris) {
    for (const p of [t.a, t.b, t.c]) {
      min.x = Math.min(min.x, p.x)
      min.y = Math.min(min.y, p.y)
      min.z = Math.min(min.z, p.z)
      max.x = Math.max(max.x, p.x)
      max.y = Math.max(max.y, p.y)
      max.z = Math.max(max.z, p.z)
    }
  }
  return { min, max, size: { x: max.x - min.x, y: max.y - min.y, z: max.z - min.z } }
}

// --------------------------------------------------------------------------
// Solid intervals along a line. Added for STAGE WEB-PIVOT-01B.
//
// Volume alone cannot tell a corner that is counted twice from a corner with a
// gap beside it: one adds what the other takes away. What distinguishes them is
// *where* the material is, so these read the material out along a line and
// compare it to an interval set stated in metres.
//
// The comparison is exact arithmetic on entry and exit distances, not point
// sampling: a 0.45 m slab is 0.45 m of interval or the test fails, and a
// hairline gap of a micrometre is a visible discrepancy rather than a sample
// that happened to land in the right place.
// --------------------------------------------------------------------------

/** A run of solid material along a ray, in metres from the ray origin. */
export type Interval = { t0: number; t1: number }

const norm = (v: OVec): OVec => {
  const l = Math.hypot(v.x, v.y, v.z)
  return { x: v.x / l, y: v.y / l, z: v.z / l }
}

/**
 * The runs of material a ray passes through inside one closed mesh.
 *
 * A ray that starts outside a closed surface alternates in, out, in, out, so
 * distinct crossings pair up into intervals. Coincident crossings are collapsed
 * first: a ray down the diagonal two triangles share is reported by both, and a
 * quad met once must not count as a surface met twice.
 *
 * The direction is normalised, so `t` is a distance in metres and interval
 * lengths are thicknesses. Throws rather than guessing if the crossing count is
 * odd — that means the mesh was not closed along this line, which is a fact the
 * caller needs rather than an interval list to be interpreted.
 */
export function rayIntervals(
  tris: readonly OTri[],
  origin: OVec,
  direction: OVec,
  tolerance = 1e-9,
): Interval[] {
  const dir = norm(direction)
  const hits = rayHits(tris, origin, dir)
  const ts: number[] = []
  for (const h of hits) {
    if (ts.length === 0 || h.t - ts[ts.length - 1] > tolerance) ts.push(h.t)
  }
  if (ts.length % 2 !== 0) {
    throw new Error(
      `ray from (${origin.x}, ${origin.y}, ${origin.z}) crossed ${ts.length} surfaces: ` +
        'an odd count means the mesh is not closed along this line',
    )
  }
  const out: Interval[] = []
  for (let i = 0; i < ts.length; i += 2) out.push({ t0: ts[i], t1: ts[i + 1] })
  return out
}

/** Total length of positive overlap between two interval lists. Zero means contact at most. */
export function intervalsOverlapLength(p: readonly Interval[], q: readonly Interval[]): number {
  let total = 0
  for (const x of p) {
    for (const y of q) total += Math.max(0, Math.min(x.t1, y.t1) - Math.max(x.t0, y.t0))
  }
  return total
}

/** Merge touching and overlapping intervals into a canonical sorted list. */
export function mergeIntervals(list: readonly Interval[], tolerance = 1e-9): Interval[] {
  const sorted = [...list].sort((a, b) => a.t0 - b.t0)
  const out: Interval[] = []
  for (const x of sorted) {
    const last = out[out.length - 1]
    if (last && x.t0 - last.t1 <= tolerance) last.t1 = Math.max(last.t1, x.t1)
    else out.push({ ...x })
  }
  return out
}

export const intervalsLength = (list: readonly Interval[]): number =>
  list.reduce((acc, i) => acc + (i.t1 - i.t0), 0)

// --------------------------------------------------------------------------
// Whole-ring oracles — STAGE WEB-PIVOT-01C.
//
// A ring is several closed solids that touch. The single-mesh oracles above
// still apply to each wall on its own, but three questions only make sense
// across the whole set: does the material form one continuous ring, does any
// pair of walls share volume, and how much of the emitted surface is actually
// on the outside of the building.
//
// All three read triangles. None reads a junction record, an extent, an
// ownership schedule or any other thing the compiler wrote down.
// --------------------------------------------------------------------------

/** One named closed mesh, so a failure can say which wall it was. */
export type NamedMesh = { id: string; tris: readonly OTri[] }

/**
 * The material a ray passes through, per mesh and merged.
 *
 * `merged` is the union: touching runs are joined, so a ring whose corners are
 * continuous reports one interval where a ring with a crack reports two. `byId`
 * keeps them separate so a caller can say which wall each run came from.
 */
export function scanMaterial(
  meshes: readonly NamedMesh[],
  origin: OVec,
  direction: OVec,
  tolerance = 1e-9,
): { merged: Interval[]; byId: Array<{ id: string; intervals: Interval[] }> } {
  const byId = meshes.map((m) => ({ id: m.id, intervals: rayIntervals(m.tris, origin, direction, tolerance) }))
  return { merged: mergeIntervals(byId.flatMap((m) => m.intervals), tolerance), byId }
}

/**
 * Positive volume shared by two meshes, measured along one ray.
 *
 * Butt ownership means at most *contact*: the ownership record says one wall
 * keeps the corner and the other stops at its face. Two solids that touch share
 * a surface and no length, so every pair here must come back zero. Anything
 * else is the corner prism emitted twice, and the pair names which corner.
 */
export function meshOverlapAlong(
  meshes: readonly NamedMesh[],
  origin: OVec,
  direction: OVec,
  tolerance = 1e-9,
): Array<{ a: string; b: string; lengthM: number }> {
  const scan = scanMaterial(meshes, origin, direction, tolerance).byId
  const out: Array<{ a: string; b: string; lengthM: number }> = []
  for (let i = 0; i < scan.length; i++) {
    for (let j = i + 1; j < scan.length; j++) {
      const lengthM = intervalsOverlapLength(scan[i].intervals, scan[j].intervals)
      if (lengthM > tolerance) out.push({ a: scan[i].id, b: scan[j].id, lengthM })
    }
  }
  return out
}

/** A triangle's outward unit normal and area. */
function normalAndArea(t: OTri): { n: OVec; area: number } {
  const n = cross(sub(t.b, t.a), sub(t.c, t.a))
  const l = Math.hypot(n.x, n.y, n.z)
  return { n: { x: n.x / l, y: n.y / l, z: n.z / l }, area: l / 2 }
}

/** A plane of the building's outer envelope: a point on it and its outward normal. */
export type EnvelopePlane = { point: OVec; normal: OVec }

/**
 * Area of emitted surface lying on the building's outer envelope.
 *
 * This is the facade oracle, and it is deliberately *not* a visibility test.
 * The obvious independent classifier — "a ray leaving the face along its normal
 * escapes" — is wrong here, and wrong in a way worth recording: an open window
 * lets a ray out, so the inner face of the wall opposite a window escapes
 * through it and is counted as facade. Measured on the ring fixture that
 * inflated 80.00 m2 to 99.65 m2, the surplus being exactly the two inner-face
 * triangles whose centroids happened to line up with an opening. Visibility and
 * facade are different questions, and through a hole the answers differ.
 *
 * What facade means is: on the outer envelope. So the envelope is what this
 * takes — as planes, supplied by the caller from the fixture's own dimensions,
 * never from anything the compiler recorded. A triangle counts when its normal
 * matches a plane's outward normal and all three of its vertices lie in that
 * plane. Ownership cannot change that answer, which is the invariant the two
 * schedules are compared on; a rigid motion cannot either, as long as the
 * planes move with the building.
 *
 * Only the planes given are considered, so passing the four vertical faces of a
 * rectangular storey measures facade and leaves the open top and the underside
 * out of it.
 */
export function envelopeFaceArea(
  tris: readonly OTri[],
  planes: readonly EnvelopePlane[],
  opts?: { distanceTolerance?: number; normalTolerance?: number },
): number {
  const distTol = opts?.distanceTolerance ?? 1e-9
  const normTol = opts?.normalTolerance ?? 1e-9
  const unitPlanes = planes.map((p) => ({ point: p.point, normal: norm(p.normal) }))
  let total = 0
  for (const t of tris) {
    const { n, area } = normalAndArea(t)
    const plane = unitPlanes.find((p) => dot(n, p.normal) > 1 - normTol)
    if (!plane) continue
    const onPlane = [t.a, t.b, t.c].every(
      (v) => Math.abs(dot(sub(v, plane.point), plane.normal)) <= distTol,
    )
    if (onPlane) total += area
  }
  return total
}

/**
 * Whether a ray leaving this face along its own normal meets nothing.
 *
 * Not a facade test — see `envelopeFaceArea` for why — but exactly the right
 * test for the other half of the contact-face policy: a face pressed against a
 * neighbour's material must have something immediately in front of it. The ray
 * starts a micrometre off the face so the coincident surface it is pressed
 * against does not count as its own escape.
 */
export function faceEscapes(tris: readonly OTri[], face: OTri, offsetM = 1e-6): boolean {
  const { n } = normalAndArea(face)
  const c = {
    x: (face.a.x + face.b.x + face.c.x) / 3 + n.x * offsetM,
    y: (face.a.y + face.b.y + face.c.y) / 3 + n.y * offsetM,
    z: (face.a.z + face.b.z + face.c.z) / 3 + n.z * offsetM,
  }
  return rayHits(tris, c, n).length === 0
}

/**
 * Free distance from a point to the first surface in a direction.
 *
 * Used for clear-dimension measurement: stand in the middle of a room, look
 * both ways, add the two answers. Returns Infinity when nothing is hit, which a
 * caller should treat as a failure rather than a very large room.
 */
export function distanceToSurface(tris: readonly OTri[], origin: OVec, direction: OVec): number {
  const hits = rayHits(tris, origin, norm(direction))
  return hits.length === 0 ? Number.POSITIVE_INFINITY : hits[0].t
}

// --------------------------------------------------------------------------
// Roof oracles — STAGE WEB-PIVOT-02.
//
// The legacy analyzer accepted a roof because a field said `pitchDeg = 40`.
// Nothing here reads a field. A roof plane is a set of triangles that share a
// normal; its pitch is the angle that normal makes with the vertical; its rise
// and run are the extents of its own vertices. The identity
//
//     rise = tan(pitch) x run
//
// then relates two things measured separately — an angle from the normals and
// a pair of distances from the positions — so it is a real check and not a
// restatement.
// --------------------------------------------------------------------------

/** One planar face of a roof, measured from the triangles that make it. */
export type MeasuredPlane = {
  /** Unit outward normal, averaged over the cluster. */
  normal: OVec
  /** Angle from horizontal, degrees. Zero is flat. */
  pitchDeg: number
  areaM2: number
  /** Lowest and highest points of the plane, along `up`. */
  lowM: number
  highM: number
  /** Horizontal extent along the plane's own downhill direction. */
  horizontalRunM: number
  /** `highM - lowM`. */
  riseM: number
  triangleCount: number
}

/**
 * The upward-facing planes of a roof, one entry per distinct normal.
 *
 * Only faces whose normal has an upward component are considered: a roof slab
 * is a solid, so its underside and its edges are emitted too, and a pitch
 * measured off an underside would come back mirrored. Clusters are keyed on the
 * normal to nine decimal places, which is exact for a compiler that computes
 * every vertex from the same arithmetic.
 */
export function measureRoofPlanes(
  tris: readonly OTri[],
  up: OVec,
  opts?: { minAreaM2?: number },
): MeasuredPlane[] {
  const u = norm(up)
  const minArea = opts?.minAreaM2 ?? 1e-6
  const groups = new Map<string, { n: OVec; tris: OTri[]; area: number }>()
  for (const t of tris) {
    const raw = cross(sub(t.b, t.a), sub(t.c, t.a))
    const l = Math.hypot(raw.x, raw.y, raw.z)
    if (l < 1e-12) continue
    const n = { x: raw.x / l, y: raw.y / l, z: raw.z / l }
    if (dot(n, u) <= 1e-9) continue
    const key = `${n.x.toFixed(9)},${n.y.toFixed(9)},${n.z.toFixed(9)}`
    const g = groups.get(key) ?? { n, tris: [], area: 0 }
    g.tris.push(t)
    g.area += l / 2
    groups.set(key, g)
  }
  const out: MeasuredPlane[] = []
  for (const g of groups.values()) {
    if (g.area < minArea) continue
    const cosPitch = Math.min(1, Math.max(-1, dot(g.n, u)))
    const pitchDeg = (Math.acos(cosPitch) * 180) / Math.PI
    // Downhill in plan is the normal's horizontal part: a roof's outward normal
    // leans away from its ridge.
    const horiz = { x: g.n.x - u.x * cosPitch, y: g.n.y - u.y * cosPitch, z: g.n.z - u.z * cosPitch }
    const hl = Math.hypot(horiz.x, horiz.y, horiz.z)
    const d = hl < 1e-9 ? { x: 0, y: 0, z: 0 } : { x: horiz.x / hl, y: horiz.y / hl, z: horiz.z / hl }
    let lowM = Infinity
    let highM = -Infinity
    let dMin = Infinity
    let dMax = -Infinity
    for (const t of g.tris) {
      for (const p of [t.a, t.b, t.c]) {
        const h = dot(p, u)
        lowM = Math.min(lowM, h)
        highM = Math.max(highM, h)
        if (hl >= 1e-9) {
          const s = dot(p, d)
          dMin = Math.min(dMin, s)
          dMax = Math.max(dMax, s)
        }
      }
    }
    out.push({
      normal: g.n,
      pitchDeg,
      areaM2: g.area,
      lowM,
      highM,
      horizontalRunM: hl < 1e-9 ? 0 : dMax - dMin,
      riseM: highM - lowM,
      triangleCount: g.tris.length,
    })
  }
  return out.sort((a, b) => b.areaM2 - a.areaM2)
}

/** Heights at which a vertical line through `(x, z)` enters and leaves solid material. */
export function verticalProfileAt(
  tris: readonly OTri[],
  x: number,
  z: number,
  up: OVec,
  from = -1000,
): Interval[] {
  const u = norm(up)
  const back = Math.abs(from)
  // Start well below the building on the up axis, so `t` minus that distance is
  // the height above the datum the caller is thinking in.
  const origin = { x: x - u.x * back, y: -u.y * back, z: z - u.z * back }
  return rayIntervals(tris, origin, u).map((i) => ({ t0: i.t0 - back, t1: i.t1 - back }))
}

/**
 * Runs of material along a ray through a **union** of solids.
 *
 * `rayIntervals` pairs crossings up and insists the count be even, which is
 * right for one closed mesh and wrong for a building: walls stand on walls, a
 * roof lands on a wall, and every one of those contacts puts two coincident
 * faces on the line. Pairing them collapses the two into one crossing and the
 * count comes out odd.
 *
 * This counts depth instead. Each crossing is an entry or an exit depending on
 * whether the face it hit points with or against the ray, and material is
 * wherever the depth is above zero. Coincident faces then cancel exactly: an
 * exit and an entry at the same distance leave the depth where it was, so two
 * solids in contact read as one run rather than two runs and a seam.
 */
export function materialRuns(
  tris: readonly OTri[],
  origin: OVec,
  direction: OVec,
  tolerance = 1e-9,
): Interval[] {
  const dir = norm(direction)
  const events = rayHits(tris, origin, dir).map((h) => {
    const t = tris[h.index]
    const n = cross(sub(t.b, t.a), sub(t.c, t.a))
    return { t: h.t, enter: dot(n, dir) < 0 }
  })
  // At equal distances an entry must be processed before an exit, or a contact
  // between two solids briefly drops the depth to zero and splits the run.
  events.sort((a, b) => (Math.abs(a.t - b.t) <= tolerance ? Number(b.enter) - Number(a.enter) : a.t - b.t))
  const out: Interval[] = []
  let depth = 0
  let start = 0
  for (const e of events) {
    if (e.enter) {
      if (depth === 0) start = e.t
      depth++
    } else if (depth > 0) {
      depth--
      if (depth === 0) out.push({ t0: start, t1: e.t })
    }
  }
  if (depth > 0 && events.length > 0) out.push({ t0: start, t1: events[events.length - 1].t })
  return mergeIntervals(out, tolerance)
}
