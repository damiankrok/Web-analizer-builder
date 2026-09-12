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
