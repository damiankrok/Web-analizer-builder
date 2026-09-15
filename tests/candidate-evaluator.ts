/**
 * The gold boundary — STAGE WEB-PIVOT-06 §19, §20, §21.
 *
 * This file is the *only* place a hand-transcribed gold fixture meets an
 * automatically extracted candidate, and it lives under tests/ for that
 * reason: nothing under src/core/extract or src/node/ocr can import it, and a
 * test asserts that none of them imports anything under research/ either. The
 * extraction has never seen a gold coordinate and cannot.
 *
 * Two design points are worth stating.
 *
 * **Alignment is fitted, not assumed.** The candidate's origin is its own
 * drawing's outermost wall faces; the gold's is a corner someone chose by
 * hand. Those are different conventions and comparing them directly would
 * measure the conventions rather than the extraction. So the evaluator finds
 * the translation that best explains the walls and reports it, which also
 * makes any residual offset visible instead of hidden.
 *
 * **There is no single number.** §19 forbids one score deciding PASS, and the
 * reason is that the failures are different in kind: a missing wall, an
 * invented one, a room that swallowed its neighbour and a door nobody found
 * are four different problems, and averaging them lets three hide behind one.
 * Each dimension is measured and reported separately.
 */
import type { ArchitecturalSpecCandidate, CandidateWall } from '../src/core/extract/spec-candidate.js'

export type GoldWall = {
  id: string
  level: string
  axis: 'X' | 'Z'
  /** Centre of the wall, across its own axis. */
  atM: number
  thicknessM: number
  fromM: number
  toM: number
  kind: string
  emit?: boolean
}

export type GoldOpening = {
  id: string
  level: string
  wallId: string
  fromM: number
  toM: number
  kind: string
  connects: string[]
}

export type GoldRoom = {
  id: string
  level: string
  label: string
  polygon: number[][]
  notionalEdges?: Array<{ toRoomId: string }>
}

export type Gold = {
  walls: GoldWall[]
  openings: GoldOpening[]
  rooms: GoldRoom[]
}

export type EvaluationOptions = {
  /** How far a candidate wall's centre may sit from the gold's, metres. */
  positionToleranceM: number
  /** Offsets searched when aligning, metres. */
  maxAlignM: number
  /** Gold walls shorter than this are not "major". */
  majorWallM: number
}

export const DEFAULT_EVALUATION: EvaluationOptions = {
  positionToleranceM: 0.2,
  maxAlignM: 8,
  majorWallM: 0.6,
}

const overlapOf = (a0: number, a1: number, b0: number, b1: number): number =>
  Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))

const centreOf = (w: CandidateWall): number => (w.nearM + w.farM) / 2
const spanOf = (w: CandidateWall): [number, number] => [Math.min(w.fromM, w.toM), Math.max(w.fromM, w.toM)]

/**
 * The translation that best explains the walls.
 *
 * Each axis is solved on its own, from the walls that constrain it: walls
 * running down the sheet fix the horizontal offset, walls running across it
 * fix the vertical one. Every candidate/gold pairing proposes an offset, and
 * the offset that matches the most wall length wins — a one-dimensional
 * consensus, the same shape of argument the scale search uses.
 */
export function alignToGold(
  candidate: ArchitecturalSpecCandidate,
  gold: Gold,
  level: string,
  storey: string,
  opts: EvaluationOptions = DEFAULT_EVALUATION,
): { dx: number; dz: number } {
  const walls = candidate.storeys.find((s) => s.storey === storey)?.walls ?? []
  const goldWalls = gold.walls.filter((w) => w.level === level)

  const solve = (axis: 'X' | 'Z'): number => {
    const mine = walls.filter((w) => w.axis === axis)
    const theirs = goldWalls.filter((w) => w.axis === axis)
    const offsets: number[] = []
    for (const a of mine) {
      for (const b of theirs) {
        const d = b.atM - centreOf(a)
        if (Math.abs(d) <= opts.maxAlignM) offsets.push(d)
      }
    }
    let best = 0
    let bestScore = -1
    for (const d of offsets) {
      let score = 0
      for (const a of mine) {
        const [a0, a1] = spanOf(a)
        for (const b of theirs) {
          if (Math.abs(centreOf(a) + d - b.atM) > opts.positionToleranceM) continue
          score += overlapOf(a0, a1, b.fromM, b.toM)
        }
      }
      if (score > bestScore) {
        bestScore = score
        best = d
      }
    }
    return best
  }
  // A wall running along Z has its faces on X, so it fixes the X offset.
  return { dx: solve('Z'), dz: solve('X') }
}

export type WallCoverage = {
  goldId: string
  goldLengthM: number
  matchedM: number
  candidateIds: string[]
}

export type CandidateEvaluation = {
  storey: string
  alignment: { dx: number; dz: number }
  walls: {
    goldCount: number
    goldLengthM: number
    matchedM: number
    coverage: number
    rows: WallCoverage[]
  }
  /**
   * Candidate fabric lying across a stretch the gold says is open. §21 forbids
   * inventing wall to close a source-open passage, and this is the measurement
   * that would catch it.
   */
  invented: { count: number; totalM: number; worst: Array<{ goldOpeningId: string; overlapM: number }> }
  adjacency: {
    goldEdges: number
    agreed: number
    merged: number
    missing: number
    rate: number
  }
  doors: {
    goldDoors: number
    detected: number
    unresolved: number
    rate: number
    rows: Array<{ goldId: string; outcome: 'DETECTED' | 'UNRESOLVED' | 'MISSED'; why: string }>
  }
  rooms: {
    candidateRooms: number
    goldRooms: number
    mapped: number
    /** Candidate rooms covering more than one gold room: under-segmentation. */
    merged: number
  }
}

const insidePolygon = (p: { x: number; z: number }, poly: number[][]): boolean => {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i]
    const [xj, zj] = poly[j]
    if (zi > p.z !== zj > p.z && p.x < ((xj - xi) * (p.z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}

export function evaluateCandidate(
  candidate: ArchitecturalSpecCandidate,
  gold: Gold,
  level: string,
  storey: string,
  opts: EvaluationOptions = DEFAULT_EVALUATION,
): CandidateEvaluation {
  const alignment = alignToGold(candidate, gold, level, storey, opts)
  const plan = candidate.storeys.find((s) => s.storey === storey)
  const walls = plan?.walls ?? []
  const rooms = plan?.rooms ?? []
  const adjacency = plan?.adjacency ?? []
  const goldWalls = gold.walls.filter((w) => w.level === level && w.emit !== false)
  const goldOpenings = gold.openings.filter((o) => o.level === level)
  const goldRooms = gold.rooms.filter((r) => r.level === level)

  const shifted = (w: CandidateWall): { centre: number; from: number; to: number } => {
    const [a0, a1] = spanOf(w)
    // A wall running along X is offset along X by dx and sits at a Z the dz
    // shifts; the other way round for one running along Z.
    return w.axis === 'X'
      ? { centre: centreOf(w) + alignment.dz, from: a0 + alignment.dx, to: a1 + alignment.dx }
      : { centre: centreOf(w) + alignment.dx, from: a0 + alignment.dz, to: a1 + alignment.dz }
  }

  // --- wall coverage
  const rows: WallCoverage[] = []
  for (const g of goldWalls) {
    const covered: Array<[number, number]> = []
    const ids: string[] = []
    for (const w of walls) {
      if (w.axis !== g.axis) continue
      const s = shifted(w)
      if (Math.abs(s.centre - g.atM) > opts.positionToleranceM) continue
      // Only the solid stretches count. A bridged opening is not wall (§21).
      for (const piece of w.openings.length === 0 ? [{ fromM: s.from, toM: s.to }] : solidPieces(w, s)) {
        const o = overlapOf(piece.fromM, piece.toM, g.fromM, g.toM)
        if (o <= 0) continue
        covered.push([Math.max(piece.fromM, g.fromM), Math.min(piece.toM, g.toM)])
        if (!ids.includes(w.id)) ids.push(w.id)
      }
    }
    rows.push({
      goldId: g.id,
      goldLengthM: g.toM - g.fromM,
      matchedM: unionLength(covered),
      candidateIds: ids,
    })
  }
  const major = rows.filter((r) => r.goldLengthM >= opts.majorWallM)
  const goldLengthM = major.reduce((n, r) => n + r.goldLengthM, 0)
  const matchedM = major.reduce((n, r) => n + r.matchedM, 0)

  // --- fabric across an opening the source shows as open
  const invented: CandidateEvaluation['invented'] = { count: 0, totalM: 0, worst: [] }
  for (const o of goldOpenings) {
    const host = goldWalls.find((w) => w.id === o.wallId)
    if (!host) continue
    let across = 0
    for (const w of walls) {
      if (w.axis !== host.axis) continue
      const s = shifted(w)
      if (Math.abs(s.centre - host.atM) > opts.positionToleranceM) continue
      for (const piece of w.openings.length === 0 ? [{ fromM: s.from, toM: s.to }] : solidPieces(w, s)) {
        across += overlapOf(piece.fromM, piece.toM, o.fromM, o.toM)
      }
    }
    if (across > 0.1) {
      invented.count++
      invented.totalM += across
      invented.worst.push({ goldOpeningId: o.id, overlapM: across })
    }
  }
  invented.worst.sort((a, b) => b.overlapM - a.overlapM)

  // --- rooms: which gold room each candidate region sits in
  const mapping = new Map<string, string[]>()
  for (const r of rooms) {
    const p = { x: r.centroid.x + alignment.dx, z: r.centroid.z + alignment.dz }
    const hit = goldRooms.find((g) => insidePolygon(p, g.polygon))
    if (!hit) continue
    const list = mapping.get(r.id) ?? []
    list.push(hit.id)
    mapping.set(r.id, list)
  }
  const goldOfCandidate = new Map<string, string>()
  for (const [candidateId, list] of mapping) goldOfCandidate.set(candidateId, list[0])
  // A candidate region that contains several gold rooms' centres has merged
  // them; that is under-segmentation and is counted rather than excused.
  let mergedRooms = 0
  for (const r of rooms) {
    if (goldRooms.filter((g) => centroidInside(g, r, alignment)).length > 1) mergedRooms++
  }

  // --- adjacency
  const goldEdges = new Set<string>()
  for (const o of goldOpenings) {
    if (o.connects.length !== 2) continue
    goldEdges.add(edgeKey(o.connects[0], o.connects[1]))
  }
  for (const r of goldRooms) {
    for (const e of r.notionalEdges ?? []) goldEdges.add(edgeKey(r.id, e.toRoomId))
  }
  const candidateEdges = new Set<string>()
  for (const a of adjacency) {
    const ga = goldOfCandidate.get(a.a)
    const gb = goldOfCandidate.get(a.b)
    if (!ga || !gb || ga === gb) continue
    candidateEdges.add(edgeKey(ga, gb))
  }
  let agreed = 0
  let merged = 0
  for (const e of goldEdges) {
    if (candidateEdges.has(e)) {
      agreed++
      continue
    }
    // Both rooms inside one candidate region: the edge is in the drawing and
    // the extraction merged the rooms rather than missing the wall between
    // them. Saying which of the two happened is the point of reporting it.
    const [a, b] = e.split('|')
    if (insideSameRegion(a, b, rooms, goldRooms, alignment)) merged++
  }

  // --- doors
  const doorRows: CandidateEvaluation['doors']['rows'] = []
  for (const o of goldOpenings.filter((x) => x.kind === 'DOOR')) {
    const host = goldWalls.find((w) => w.id === o.wallId)
    if (!host) {
      doorRows.push({ goldId: o.id, outcome: 'UNRESOLVED', why: 'the gold names a host wall that is not in the gold' })
      continue
    }
    let found = false
    let hostFound = false
    for (const w of walls) {
      if (w.axis !== host.axis) continue
      const s = shifted(w)
      if (Math.abs(s.centre - host.atM) > opts.positionToleranceM) continue
      hostFound = true
      for (const op of w.openings) {
        const from = Math.min(op.fromM, op.toM) + (w.axis === 'X' ? alignment.dx : alignment.dz)
        const to = Math.max(op.fromM, op.toM) + (w.axis === 'X' ? alignment.dx : alignment.dz)
        if (overlapOf(from, to, o.fromM, o.toM) > 0.2) found = true
      }
    }
    doorRows.push({
      goldId: o.id,
      outcome: found ? 'DETECTED' : hostFound ? 'UNRESOLVED' : 'MISSED',
      why: found
        ? 'an opening on the matching wall covers it'
        : hostFound
          ? 'the host wall was found but reported no opening there'
          : 'the host wall was not found at all',
    })
  }
  const detected = doorRows.filter((r) => r.outcome === 'DETECTED').length
  const unresolved = doorRows.filter((r) => r.outcome === 'UNRESOLVED').length

  return {
    storey,
    alignment,
    walls: { goldCount: major.length, goldLengthM, matchedM, coverage: goldLengthM === 0 ? 0 : matchedM / goldLengthM, rows },
    invented,
    adjacency: {
      goldEdges: goldEdges.size,
      agreed,
      merged,
      missing: goldEdges.size - agreed - merged,
      rate: goldEdges.size === 0 ? 0 : agreed / goldEdges.size,
    },
    doors: {
      goldDoors: doorRows.length,
      detected,
      unresolved,
      rate: doorRows.length === 0 ? 0 : (detected + unresolved) / doorRows.length,
      rows: doorRows,
    },
    rooms: {
      candidateRooms: rooms.length,
      goldRooms: goldRooms.length,
      mapped: goldOfCandidate.size,
      merged: mergedRooms,
    },
  }
}

const edgeKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`)

/** The solid stretches of a wall, in aligned coordinates. */
function solidPieces(
  w: CandidateWall,
  s: { from: number; to: number },
): Array<{ fromM: number; toM: number }> {
  const shift = s.from - Math.min(w.fromM, w.toM)
  const cuts = w.openings
    .map((o) => ({ from: Math.min(o.fromM, o.toM) + shift, to: Math.max(o.fromM, o.toM) + shift }))
    .sort((a, b) => a.from - b.from)
  const out: Array<{ fromM: number; toM: number }> = []
  let at = s.from
  for (const cut of cuts) {
    if (cut.from > at) out.push({ fromM: at, toM: Math.min(cut.from, s.to) })
    at = Math.max(at, cut.to)
  }
  if (at < s.to) out.push({ fromM: at, toM: s.to })
  return out
}

function unionLength(spans: ReadonlyArray<[number, number]>): number {
  if (spans.length === 0) return 0
  const sorted = [...spans].sort((a, b) => a[0] - b[0])
  let total = 0
  let [from, to] = sorted[0]
  for (const [a, b] of sorted.slice(1)) {
    if (a > to) {
      total += to - from
      from = a
      to = b
      continue
    }
    to = Math.max(to, b)
  }
  return total + (to - from)
}

const centroidInside = (
  g: GoldRoom,
  r: { centroid: { x: number; z: number }; box: { x0: number; z0: number; x1: number; z1: number } },
  alignment: { dx: number; dz: number },
): boolean => {
  // A gold room sits inside a candidate region when the gold room's own
  // centroid falls in the region's box; used only to count merges.
  const cx = g.polygon.reduce((n, p) => n + p[0], 0) / g.polygon.length
  const cz = g.polygon.reduce((n, p) => n + p[1], 0) / g.polygon.length
  return (
    cx >= r.box.x0 + alignment.dx &&
    cx <= r.box.x1 + alignment.dx &&
    cz >= r.box.z0 + alignment.dz &&
    cz <= r.box.z1 + alignment.dz
  )
}

const insideSameRegion = (
  a: string,
  b: string,
  rooms: ReadonlyArray<{ centroid: { x: number; z: number }; box: { x0: number; z0: number; x1: number; z1: number } }>,
  goldRooms: readonly GoldRoom[],
  alignment: { dx: number; dz: number },
): boolean => {
  const ga = goldRooms.find((g) => g.id === a)
  const gb = goldRooms.find((g) => g.id === b)
  if (!ga || !gb) return false
  return rooms.some((r) => centroidInside(ga, r, alignment) && centroidInside(gb, r, alignment))
}
