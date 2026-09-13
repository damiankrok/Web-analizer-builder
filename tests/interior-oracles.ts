/**
 * Independent interior oracles — STAGE WEB-PIVOT-04.
 *
 * The rule these follow is the one every stage since WEB-PIVOT-01 has followed:
 * an oracle may read the emitted triangles and the gold transcription, and it
 * may not replay the compiler. Nothing here imports `compileInterior`'s derived
 * results; where a fact could be taken from the compiler it is measured again,
 * from a different direction, so that a compiler bug and an oracle bug cannot
 * cancel out.
 *
 * Three kinds of measurement:
 *
 *   - **plan arithmetic** — exact rectangle decomposition of a storey on the
 *     union of every stated coordinate. Every cell is classified once, so
 *     coverage, overlap and the uncovered remainder are the same partition seen
 *     three ways and have to add up.
 *   - **rays into the geometry** — is there material where a room says its wall
 *     is, and is there none where a door says its hole is. `materialRuns` from
 *     `geometry-oracles.ts` does the work; these functions only choose where to
 *     aim.
 *   - **published-number comparison** — the room table against the polygons,
 *     with the semantic difference stated rather than absorbed.
 */
import type { OTri } from './geometry-oracles.js'
import { materialRuns, meshVolume, intervalsLength } from './geometry-oracles.js'
import type {
  InteriorSpec,
  InteriorTri,
  PlanPoint,
  PlanPolygon,
  PlanRect,
  RoomSpec,
} from '../src/core/wallspec/interior.js'
import {
  pointInPolygon,
  polygonArea,
  polygonInsetArea,
  polygonPerimeter,
  rectArea,
  wallFootprint,
} from '../src/core/wallspec/interior.js'

const EPS = 1e-9
const UP = { x: 0, y: 1, z: 0 }

export const asOTris = (tris: readonly InteriorTri[]): OTri[] => tris.map((t) => ({ a: t.a, b: t.b, c: t.c }))

// --------------------------------------------------------------------------
// §8 — floor partition audit.
// --------------------------------------------------------------------------

export type CoverageCell = {
  rect: PlanRect
  areaM2: number
  roomIds: string[]
  wallIds: string[]
  stairIds: string[]
}

export type CoverageReport = {
  levelId: string
  envelopeM2: number
  roomM2: number
  wallM2: number
  stairM2: number
  /** Plan claimed by more than one room, or by a room and a wall. */
  overlapM2: number
  /** Plan inside the envelope that nothing claims. */
  uncoveredM2: number
  /** The uncovered pieces, largest first, so a gap can be found rather than guessed at. */
  gaps: Array<{ rect: PlanRect; areaM2: number }>
  /** The overlapping pieces, largest first. */
  overlaps: Array<{ rect: PlanRect; areaM2: number; by: string[] }>
}

/**
 * Decompose one storey exactly and classify every piece.
 *
 * The grid is the union of every x and every z any element mentions, so each
 * cell is entirely inside or entirely outside each element and the answer is
 * arithmetic rather than sampling. A cell is tested at its centre: two rooms
 * that share an edge therefore do not overlap, which is the distinction §7
 * draws between touching and overlapping.
 */
export function coverageReport(spec: InteriorSpec, levelId: string): CoverageReport {
  const level = spec.levels.find((l) => l.id === levelId)!
  const rooms = spec.rooms.filter((r) => r.levelId === levelId)
  const walls = spec.walls.filter((w) => w.levelId === levelId && w.emit)
  const stairs = spec.stairs.filter((s) => s.fromLevelId === levelId)

  const xs = new Set<number>()
  const zs = new Set<number>()
  for (const e of level.envelopes) {
    xs.add(e.minX)
    xs.add(e.maxX)
    zs.add(e.minZ)
    zs.add(e.maxZ)
  }
  for (const r of rooms) for (const p of r.polygon) { xs.add(p.x); zs.add(p.z) }
  for (const w of walls) {
    const f = wallFootprint(w)
    xs.add(f.minX); xs.add(f.maxX); zs.add(f.minZ); zs.add(f.maxZ)
  }
  for (const s of stairs) for (const p of s.footprint) { xs.add(p.x); zs.add(p.z) }
  const X = [...xs].sort((a, b) => a - b)
  const Z = [...zs].sort((a, b) => a - b)

  let roomM2 = 0
  let wallM2 = 0
  let stairM2 = 0
  let overlapM2 = 0
  const gaps: Array<{ rect: PlanRect; areaM2: number }> = []
  const overlaps: Array<{ rect: PlanRect; areaM2: number; by: string[] }> = []

  const envelopeM2 = level.envelopes.reduce((s, e) => s + (e.maxX - e.minX) * (e.maxZ - e.minZ), 0)

  for (let i = 0; i + 1 < X.length; i++) {
    for (let j = 0; j + 1 < Z.length; j++) {
      const rect: PlanRect = { minX: X[i], maxX: X[i + 1], minZ: Z[j], maxZ: Z[j + 1] }
      const a = rectArea(rect)
      if (a <= 1e-12) continue
      const c: PlanPoint = { x: (rect.minX + rect.maxX) / 2, z: (rect.minZ + rect.maxZ) / 2 }
      const inEnvelope = level.envelopes.some((e) => c.x > e.minX && c.x < e.maxX && c.z > e.minZ && c.z < e.maxZ)
      if (!inEnvelope) continue
      const inRooms = rooms.filter((r) => pointInPolygon(c, r.polygon)).map((r) => r.id)
      const inWalls = walls
        .filter((w) => {
          const f = wallFootprint(w)
          return c.x > f.minX && c.x < f.maxX && c.z > f.minZ && c.z < f.maxZ
        })
        .map((w) => w.id)
      const inStairs = stairs.filter((s) => pointInPolygon(c, s.footprint)).map((s) => s.id)
      const claims = [...inRooms, ...inWalls, ...inStairs]
      if (inRooms.length > 0) roomM2 += a
      else if (inWalls.length > 0) wallM2 += a
      else if (inStairs.length > 0) stairM2 += a
      if (claims.length === 0) gaps.push({ rect, areaM2: a })
      if (claims.length > 1) {
        overlapM2 += a
        overlaps.push({ rect, areaM2: a, by: claims })
      }
    }
  }
  // Rooms and walls are counted once each even where a cell is claimed twice,
  // so the three totals below are what was *classified*; `overlapM2` says how
  // much of the storey was claimed more than once and is reported separately.
  const uncoveredM2 = gaps.reduce((s, g) => s + g.areaM2, 0)
  return {
    levelId,
    envelopeM2,
    roomM2,
    wallM2,
    stairM2,
    overlapM2,
    uncoveredM2,
    gaps: gaps.sort((p, q) => q.areaM2 - p.areaM2),
    overlaps: overlaps.sort((p, q) => q.areaM2 - p.areaM2),
  }
}

// --------------------------------------------------------------------------
// §7 — room topology.
// --------------------------------------------------------------------------

export type RoomTopology = {
  roomId: string
  closed: boolean
  rectilinear: boolean
  areaM2: number
  insideEnvelope: boolean
  /** Boundary length held up by emitted material or by the shell's envelope. */
  supportedM: number
  /** Boundary length that is neither walled nor declared open. */
  unexplainedM: number
  /** Boundary length the room itself declares as an open-plan edge. */
  notionalM: number
  /** Boundary length taken up by a doorway into this room. */
  openingM: number
  problems: string[]
}

/**
 * Is a room's boundary actually held up?
 *
 * Each boundary edge is walked in 0.05 m steps. At every step a short ray is
 * fired across the boundary, from just inside the room to just outside, at
 * ankle height above the storey's floor. If it passes through material, that
 * step is supported. The envelope's own faces count as support without a ray —
 * the exterior shell is a different spec and is not in this triangle list.
 *
 * Steps that are neither supported nor covered by one of the room's declared
 * notional edges are the finding: a room boundary with no wall and no stated
 * reason is a room that does not exist.
 */
export function roomTopology(
  spec: InteriorSpec,
  tris: readonly InteriorTri[],
  room: RoomSpec,
  stepM = 0.05,
): RoomTopology {
  const level = spec.levels.find((l) => l.id === room.levelId)!
  const env = level.envelopes.find((e) => e.id === room.envelopeId)
  const solid = asOTris(tris.filter((t) => t.levelId === room.levelId && t.elementKind === 'INTERIOR_WALL'))
  const y = level.fflM + 0.30
  const problems: string[] = []

  const n = room.polygon.length
  const closed = n >= 4
  if (!closed) problems.push(`polygon has ${n} vertices`)
  let rectilinear = true
  for (let i = 0; i < n; i++) {
    const a = room.polygon[i]
    const b = room.polygon[(i + 1) % n]
    if (Math.abs(a.x - b.x) > 1e-9 && Math.abs(a.z - b.z) > 1e-9) rectilinear = false
    if (Math.hypot(a.x - b.x, a.z - b.z) <= 1e-9) problems.push(`zero-length edge at vertex ${i}`)
  }
  if (!rectilinear) problems.push('polygon has an edge that is neither along x nor along z')

  const areaM2 = polygonArea(room.polygon)
  if (!(areaM2 > EPS)) problems.push(`area is ${areaM2}`)

  let insideEnvelope = true
  if (env) {
    for (const p of room.polygon) {
      if (p.x < env.minX - 1e-6 || p.x > env.maxX + 1e-6 || p.z < env.minZ - 1e-6 || p.z > env.maxZ + 1e-6) {
        insideEnvelope = false
      }
    }
    if (!insideEnvelope) problems.push(`polygon reaches outside envelope ${env.id}`)
  }

  const onNotional = (p: PlanPoint): boolean =>
    room.notionalEdges.some((e) => {
      const minX = Math.min(e.from.x, e.to.x) - 1e-6
      const maxX = Math.max(e.from.x, e.to.x) + 1e-6
      const minZ = Math.min(e.from.z, e.to.z) - 1e-6
      const maxZ = Math.max(e.from.z, e.to.z) + 1e-6
      return p.x >= minX && p.x <= maxX && p.z >= minZ && p.z <= maxZ
    })

  // A doorway is a legitimate gap in a wall, and a ray through one finds no
  // material by design. Each opening's own plan footprint is collected first,
  // so a step that lands in a doorway into this room is attributed to the door
  // rather than counted against the wall that carries it.
  const doorways: PlanRect[] = spec.openings
    .filter((o) => o.connects.includes(room.id))
    .map((o) => {
      const w = spec.walls.find((x) => x.id === o.hostWallId)!
      const a0 = w.fromM + o.offsetM
      const a1 = a0 + o.widthM
      const half = w.thicknessM / 2 + 0.01
      return w.axis === 'X'
        ? { minX: a0, maxX: a1, minZ: w.atM - half, maxZ: w.atM + half }
        : { minX: w.atM - half, maxX: w.atM + half, minZ: a0, maxZ: a1 }
    })
  const inDoorway = (p: PlanPoint): boolean =>
    doorways.some((d) => p.x >= d.minX - 1e-6 && p.x <= d.maxX + 1e-6 && p.z >= d.minZ - 1e-6 && p.z <= d.maxZ + 1e-6)

  let supportedM = 0
  let notionalM = 0
  let unexplainedM = 0
  let openingM = 0
  for (let i = 0; i < n; i++) {
    const a = room.polygon[i]
    const b = room.polygon[(i + 1) % n]
    const len = Math.hypot(b.x - a.x, b.z - a.z)
    if (len <= EPS) continue
    const steps = Math.max(1, Math.ceil(len / stepM))
    const dx = (b.x - a.x) / len
    const dz = (b.z - a.z) / len
    // Outward normal of this edge, for a polygon walked in either winding: try
    // one side and flip if it points into the room.
    let nx = dz
    let nz = -dx
    const probe = { x: (a.x + b.x) / 2 + nx * 0.02, z: (a.z + b.z) / 2 + nz * 0.02 }
    if (pointInPolygon(probe, room.polygon)) {
      nx = -nx
      nz = -nz
    }
    for (let s = 0; s < steps; s++) {
      const t = ((s + 0.5) / steps) * len
      const p = { x: a.x + dx * t, z: a.z + dz * t }
      const seg = len / steps
      const onEnvelope =
        env !== undefined &&
        (Math.abs(p.x - env.minX) < 1e-6 ||
          Math.abs(p.x - env.maxX) < 1e-6 ||
          Math.abs(p.z - env.minZ) < 1e-6 ||
          Math.abs(p.z - env.maxZ) < 1e-6)
      if (onEnvelope) {
        supportedM += seg
        continue
      }
      const origin = { x: p.x - nx * 0.05, y, z: p.z - nz * 0.05 }
      const runs = materialRuns(solid, origin, { x: nx, y: 0, z: nz })
      const hitsWithin = runs.some((r) => r.t0 < 0.35 && r.t1 > 0.02)
      if (hitsWithin) supportedM += seg
      else if (inDoorway(p)) openingM += seg
      else if (onNotional(p)) notionalM += seg
      else unexplainedM += seg
    }
  }
  if (unexplainedM > 1e-6) {
    problems.push(`${unexplainedM.toFixed(3)} m of boundary is neither walled, a doorway, nor declared open`)
  }

  return { roomId: room.id, closed, rectilinear, areaM2, insideEnvelope, supportedM, unexplainedM, notionalM, openingM, problems }
}

// --------------------------------------------------------------------------
// §9 — published area cross-check.
// --------------------------------------------------------------------------

export type AreaClass = 'MATCH' | 'CLOSE' | 'SOURCE_SEMANTICS_DIFFER' | 'UNRESOLVED' | 'COMPILER_FAIL'

export type AreaCheck = {
  roomId: string
  label: string
  publishedM2?: number
  publishedKind: 'GROSS' | 'USABLE' | 'NONE'
  rawM2: number
  finishedM2: number
  deltaM2?: number
  deltaPct?: number
  classification: AreaClass
  note: string
}

/** Finish depth the published Marcowki areas are measured to. See the gold file. */
export const FINISH_M = 0.02

/**
 * Compare one room's polygon with what the source publishes for it.
 *
 * `finishedM2` is the polygon inset by the finish depth, which is the quantity
 * the published table actually reports — two rooms reproduce it to the
 * centimetre and that is what identifies the convention. The classification is
 * against the finished figure; the raw one is kept because it is the geometry,
 * and a reader who disagrees with the convention needs to see it.
 *
 * `semanticNotes` names rooms whose published figure is known to mean something
 * the polygon cannot: an open-plan boundary nobody drew, floor the drawing
 * gives to the stair, a headroom rule the plans do not state.
 */
export function areaCheck(room: RoomSpec, semanticNotes: Readonly<Record<string, string>> = {}): AreaCheck {
  const rawM2 = polygonArea(room.polygon)
  const finishedM2 = polygonInsetArea(room.polygon, FINISH_M)
  const published = room.publishedGrossAreaM2 ?? room.publishedAreaM2
  const publishedKind: AreaCheck['publishedKind'] =
    room.publishedGrossAreaM2 !== undefined ? 'GROSS' : room.publishedAreaM2 !== undefined ? 'USABLE' : 'NONE'
  if (!(rawM2 > EPS) || !Number.isFinite(finishedM2)) {
    return { roomId: room.id, label: room.label, publishedKind, rawM2, finishedM2, classification: 'COMPILER_FAIL', note: 'the polygon has no positive area' }
  }
  if (published === undefined) {
    return { roomId: room.id, label: room.label, publishedKind, rawM2, finishedM2, classification: 'UNRESOLVED', note: 'the source publishes no area for this room' }
  }
  const deltaM2 = finishedM2 - published
  const deltaPct = (deltaM2 / published) * 100
  const semantic = semanticNotes[room.id]
  const classification: AreaClass = semantic
    ? 'SOURCE_SEMANTICS_DIFFER'
    : Math.abs(deltaPct) <= 1.5
      ? 'MATCH'
      : Math.abs(deltaPct) <= 5
        ? 'CLOSE'
        : 'SOURCE_SEMANTICS_DIFFER'
  return {
    roomId: room.id,
    label: room.label,
    publishedM2: published,
    publishedKind,
    rawM2,
    finishedM2,
    deltaM2,
    deltaPct,
    classification,
    note: semantic ?? (classification === 'SOURCE_SEMANTICS_DIFFER' ? 'unexplained: the polygon and the published figure disagree by more than 5%' : ''),
  }
}

// --------------------------------------------------------------------------
// §10 — printed dimension chains.
// --------------------------------------------------------------------------

export type ChainCheck = {
  chainId: string
  printedSumM: number
  crossedM: number
  fromM: number
  toM: number
  closureM: number
  /** Each boundary the chain lands on, and the wall face nearest to it. */
  landings: Array<{ atM: number; wallId: string | null; faceM: number | null; errorM: number | null }>
}

/**
 * Walk a printed chain across the gold geometry.
 *
 * The chain is the drawing's own arithmetic: a start face, a list of printed
 * clear dimensions, the wall thicknesses between them, and an end face. Walking
 * it says two things at once — whether the printed numbers add up to the
 * printed total, and whether each boundary it steps over is really where a wall
 * face is. The second is the one that catches a moved wall: the sum still
 * closes, and a landing lands on nothing.
 */
export function chainCheck(
  spec: InteriorSpec,
  chain: { id: string; level: string; axis: string; printed: number[]; crossings: number[]; fromM: number; toM: number },
  toleranceM = 0.06,
): ChainCheck {
  const walls = spec.walls.filter((w) => w.levelId === chain.level && w.axis !== chain.axis)
  const faces: Array<{ wallId: string; at: number }> = []
  for (const w of walls) {
    faces.push({ wallId: w.id, at: w.atM - w.thicknessM / 2 })
    faces.push({ wallId: w.id, at: w.atM + w.thicknessM / 2 })
  }
  const landings: ChainCheck['landings'] = []
  let at = chain.fromM
  let printedSumM = 0
  let crossedM = 0
  for (let i = 0; i < chain.printed.length; i++) {
    at += chain.printed[i]
    printedSumM += chain.printed[i]
    const t = chain.crossings[i]
    if (t === undefined) break
    if (t <= 1e-9) {
      // A boundary the chain states but no wall crosses: an open-plan split.
      landings.push({ atM: at, wallId: null, faceM: null, errorM: null })
      continue
    }
    let best: { wallId: string; at: number } | null = null
    for (const f of faces) if (!best || Math.abs(f.at - at) < Math.abs(best.at - at)) best = f
    const err = best ? Math.abs(best.at - at) : null
    landings.push({ atM: at, wallId: best && err !== null && err <= toleranceM ? best.wallId : null, faceM: best?.at ?? null, errorM: err })
    at += t
    crossedM += t
  }
  return { chainId: chain.id, printedSumM, crossedM, fromM: chain.fromM, toM: chain.toM, closureM: at - chain.toM, landings }
}

// --------------------------------------------------------------------------
// §11 — doors are real holes, and the graph they make.
// --------------------------------------------------------------------------

export type OpeningCut = {
  openingId: string
  hostWallId: string
  /** Material a ray meets crossing the wall at the opening's centre. Zero is the point. */
  throughOpeningM: number
  /** Material the same ray meets 0.15 m outside the opening's jamb. */
  besideOpeningM: number
  /** Material the same ray meets 0.20 m above the opening's head. */
  aboveOpeningM: number
  /** True when the two rooms the opening names sit on opposite sides of its host. */
  separatesItsRooms: boolean
}

export function openingCut(spec: InteriorSpec, tris: readonly InteriorTri[], openingId: string): OpeningCut {
  const o = spec.openings.find((x) => x.id === openingId)!
  const w = spec.walls.find((x) => x.id === o.hostWallId)!
  const level = spec.levels.find((l) => l.id === w.levelId)!
  const solid = asOTris(tris.filter((t) => t.wallId === w.id))
  const alongCentre = w.fromM + o.offsetM + o.widthM / 2
  // Just outside one jamb, on whichever side still has wall left to hit: a door
  // near one end of its host leaves nothing to probe on that side.
  const before = w.fromM + o.offsetM - 0.06
  const after = w.fromM + o.offsetM + o.widthM + 0.06
  const beside = before - w.fromM > 0.03 ? before : after
  const dir = w.axis === 'X' ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 }
  const at = (along: number, y: number): { x: number; y: number; z: number } =>
    w.axis === 'X' ? { x: along, y, z: w.atM - 1 } : { x: w.atM - 1, y, z: along }
  const mid = level.fflM + (o.sillM + o.headM) / 2
  const measure = (along: number, y: number): number => intervalsLength(materialRuns(solid, at(along, y), dir))

  const roomSide = (roomId: string): number | null => {
    const r = spec.rooms.find((x) => x.id === roomId)
    if (!r) return null
    const c = { x: r.polygon.reduce((s, p) => s + p.x, 0) / r.polygon.length, z: r.polygon.reduce((s, p) => s + p.z, 0) / r.polygon.length }
    const v = w.axis === 'X' ? c.z - w.atM : c.x - w.atM
    return Math.sign(v)
  }
  const s0 = roomSide(o.connects[0])
  const s1 = roomSide(o.connects[1])

  return {
    openingId,
    hostWallId: w.id,
    throughOpeningM: measure(alongCentre, mid),
    besideOpeningM: measure(beside, mid),
    aboveOpeningM: measure(alongCentre, level.fflM + o.headM + 0.2),
    separatesItsRooms: s0 !== null && s1 !== null && s0 !== 0 && s1 !== 0 && s0 !== s1,
  }
}

export type AdjacencyReport = {
  nodes: string[]
  edges: Array<{ a: string; b: string; via: string; kind: string }>
  components: string[][]
  connected: boolean
}

/**
 * The graph of spaces a person can walk between.
 *
 * Edges come from two places: an opening cut through a wall, and a room's own
 * declared open-plan boundary. Both are real ways through, and a graph that
 * only counted doors would call an open-plan kitchen unreachable.
 */
export function adjacencyGraph(spec: InteriorSpec, levelId?: string): AdjacencyReport {
  const rooms = spec.rooms.filter((r) => levelId === undefined || r.levelId === levelId)
  const nodes = rooms.map((r) => r.id)
  const index = new Set(nodes)
  const edges: AdjacencyReport['edges'] = []
  for (const o of spec.openings) {
    if (!index.has(o.connects[0]) || !index.has(o.connects[1])) continue
    edges.push({ a: o.connects[0], b: o.connects[1], via: o.hostWallId, kind: o.kind })
  }
  for (const r of rooms) {
    for (const e of r.notionalEdges) {
      if (!index.has(e.toRoomId)) continue
      if (edges.some((x) => (x.a === r.id && x.b === e.toRoomId) || (x.a === e.toRoomId && x.b === r.id))) continue
      edges.push({ a: r.id, b: e.toRoomId, via: 'open', kind: 'OPEN_BOUNDARY' })
    }
  }
  const seen = new Set<string>()
  const components: string[][] = []
  for (const n of nodes) {
    if (seen.has(n)) continue
    const stack = [n]
    const comp: string[] = []
    seen.add(n)
    while (stack.length > 0) {
      const cur = stack.pop()!
      comp.push(cur)
      for (const e of edges) {
        const other = e.a === cur ? e.b : e.b === cur ? e.a : null
        if (other && !seen.has(other)) {
          seen.add(other)
          stack.push(other)
        }
      }
    }
    components.push(comp.sort())
  }
  return { nodes, edges, components, connected: components.length === 1 }
}

// --------------------------------------------------------------------------
// §12 / §13 — the stair and the hole it needs.
// --------------------------------------------------------------------------

export type SlabVoidReport = {
  slabId: string
  volumeM3: number
  expectedSolidM3: number
  expectedWholeM3: number
  /** Material a vertical line through the void's centre meets in the slab. */
  throughVoidM: number
  /** Material a vertical line 0.20 m outside the void meets in the slab. */
  besideVoidM: number
  /**
   * Plan area of a stair's footprint that the hole above it does not cover.
   *
   * The architectural statement §13 asks for, in one number: the opening has to
   * be at least as big as the flight that comes up through it, and in the same
   * place. A void left out, moved or made too small all show here as plan the
   * stair would have to pass through solid plate to reach.
   */
  stairFootprintOutsideVoidM2: number
}

export function slabVoidReport(
  spec: InteriorSpec,
  tris: readonly InteriorTri[],
  slabId: string,
): SlabVoidReport {
  const sl = spec.slabs.find((s) => s.id === slabId)!
  const slab = asOTris(tris.filter((t) => t.elementKind === 'SLAB' && t.elementId === slabId))
  const plate = rectOfPoly(sl.footprint)
  const holes = sl.voidStairIds.map((id) => rectOfPoly(spec.stairs.find((s) => s.id === id)!.slabVoid))
  const holeArea = holes.reduce((s, h) => s + rectArea(h), 0)
  const c = holes[0]
    ? { x: (holes[0].minX + holes[0].maxX) / 2, z: (holes[0].minZ + holes[0].maxZ) / 2 }
    : { x: (plate.minX + plate.maxX) / 2, z: (plate.minZ + plate.maxZ) / 2 }
  const beside = holes[0] ? { x: holes[0].minX - 0.2, z: c.z } : { x: c.x, z: c.z }
  const cast = (p: { x: number; z: number }): number =>
    intervalsLength(materialRuns(slab, { x: p.x, y: -50, z: p.z }, UP))

  // How much of every stair's footprint the plate still covers. Sampled on a
  // grid over the footprint rather than computed from the rectangles, so a void
  // that is present but wrong is measured the same way as one that is missing.
  let outside = 0
  for (const st of spec.stairs) {
    const fp = rectOfPoly(st.footprint)
    const N = 40
    const cell = ((fp.maxX - fp.minX) / N) * ((fp.maxZ - fp.minZ) / N)
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const x = fp.minX + ((i + 0.5) / N) * (fp.maxX - fp.minX)
        const z = fp.minZ + ((j + 0.5) / N) * (fp.maxZ - fp.minZ)
        if (cast({ x, z }) > 1e-9) outside += cell
      }
    }
  }

  return {
    slabId,
    volumeM3: meshVolume(slab),
    expectedSolidM3: (rectArea(plate) - holeArea) * sl.thicknessM,
    expectedWholeM3: rectArea(plate) * sl.thicknessM,
    throughVoidM: cast(c),
    besideVoidM: cast(beside),
    stairFootprintOutsideVoidM2: outside,
  }
}

export type StairReport = {
  stairId: string
  volumeM3: number
  /** Height of the topmost material in the stair envelope. */
  topM: number
  /** Height of the lowest material. */
  baseM: number
  /** Plan rectangle the emitted steps occupy. */
  footprint: PlanRect
  /** Plan area of the stair's stated footprint that its steps do not cover. */
  uncoveredFootprintM2: number
  /**
   * Material the stair shares with a wall or with the floor plate above it.
   *
   * Zero is the whole claim of §12 and §13 at once: the flight occupies no
   * wall, and the hole in the slab is in the right place and the right size, so
   * the stair runs through it rather than into it.
   */
  clashM3: number
  /** True when the top of the flight reaches the upper storey's floor. */
  reachesUpperFloor: boolean
}

export function stairReport(spec: InteriorSpec, tris: readonly InteriorTri[], stairId: string): StairReport {
  const s = spec.stairs.find((x) => x.id === stairId)!
  const steps = asOTris(tris.filter((t) => t.elementKind === 'STAIR' && t.elementId === stairId))
  const otherSolid = asOTris(tris.filter((t) => t.elementKind === 'INTERIOR_WALL' || t.elementKind === 'SLAB'))
  const fp = rectOfPoly(s.footprint)
  let minY = Infinity
  let maxY = -Infinity
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const t of steps) {
    for (const p of [t.a, t.b, t.c]) {
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y)
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x)
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z)
    }
  }
  // Sample the footprint on a grid; where the stair has material, check the
  // walls do not, and where it has none, the footprint is not being used.
  const N = 24
  let uncovered = 0
  let clash = 0
  const cell = ((fp.maxX - fp.minX) / N) * ((fp.maxZ - fp.minZ) / N)
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const x = fp.minX + ((i + 0.5) / N) * (fp.maxX - fp.minX)
      const z = fp.minZ + ((j + 0.5) / N) * (fp.maxZ - fp.minZ)
      const st = materialRuns(steps, { x, y: -50, z }, UP)
      const wl = materialRuns(otherSolid, { x, y: -50, z }, UP)
      if (intervalsLength(st) <= 1e-9) uncovered += cell
      for (const a of st) for (const b of wl) clash += Math.max(0, Math.min(a.t1, b.t1) - Math.max(a.t0, b.t0)) * cell
    }
  }
  return {
    stairId,
    volumeM3: meshVolume(steps),
    topM: maxY,
    baseM: minY,
    footprint: { minX, maxX, minZ, maxZ },
    uncoveredFootprintM2: uncovered,
    clashM3: clash,
    reachesUpperFloor: Math.abs(maxY - s.riseToM) <= 1e-6,
  }
}

// --------------------------------------------------------------------------
// §14 — the two storeys share one frame.
// --------------------------------------------------------------------------

export type AlignmentReport = {
  /** Every storey's envelope rectangle, so a mirrored or rotated plan is visible. */
  envelopes: Array<{ levelId: string; rect: PlanRect }>
  envelopesAgree: boolean
  /** The stair's void, and whether the upper stair compartment contains it. */
  voidInsideUpperStair: boolean
  /** Pairs of walls the source says are one structural line, and how far apart they are. */
  structuralPairs: Array<{ groundWallId: string; upperWallId: string; offsetM: number }>
}

export function alignmentReport(
  spec: InteriorSpec,
  pairs: ReadonlyArray<[string, string]>,
  upperStairRoomId: string,
): AlignmentReport {
  const envelopes = spec.levels.map((l) => {
    const main = l.envelopes[0]
    return { levelId: l.id, rect: { minX: main.minX, maxX: main.maxX, minZ: main.minZ, maxZ: main.maxZ } }
  })
  const first = envelopes[0].rect
  const envelopesAgree = envelopes.every(
    (e) =>
      Math.abs(e.rect.minX - first.minX) < 1e-6 &&
      Math.abs(e.rect.maxX - first.maxX) < 1e-6 &&
      Math.abs(e.rect.minZ - first.minZ) < 1e-6 &&
      Math.abs(e.rect.maxZ - first.maxZ) < 1e-6,
  )
  const stairRoom = spec.rooms.find((r) => r.id === upperStairRoomId)
  const hole = spec.stairs[0] ? rectOfPoly(spec.stairs[0].slabVoid) : null
  const voidInsideUpperStair =
    stairRoom !== undefined &&
    hole !== null &&
    [
      { x: hole.minX + 0.01, z: hole.minZ + 0.01 },
      { x: hole.maxX - 0.01, z: hole.minZ + 0.01 },
      { x: hole.maxX - 0.01, z: hole.maxZ - 0.01 },
      { x: hole.minX + 0.01, z: hole.maxZ - 0.01 },
    ].every((p) => pointInPolygon(p, stairRoom.polygon))

  const structuralPairs = pairs.map(([g, u]) => {
    const gw = spec.walls.find((w) => w.id === g)!
    const uw = spec.walls.find((w) => w.id === u)!
    return { groundWallId: g, upperWallId: u, offsetM: Math.abs(gw.atM - uw.atM) }
  })
  return { envelopes, envelopesAgree, voidInsideUpperStair, structuralPairs }
}

const rectOfPoly = (poly: PlanPolygon): PlanRect => ({
  minX: Math.min(...poly.map((p) => p.x)),
  maxX: Math.max(...poly.map((p) => p.x)),
  minZ: Math.min(...poly.map((p) => p.z)),
  maxZ: Math.max(...poly.map((p) => p.z)),
})

export { polygonArea, polygonPerimeter, polygonInsetArea, rectOfPoly }
