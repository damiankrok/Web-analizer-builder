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
  /** Step at which a gold room's polygon is sampled when matching it, metres. */
  roomSampleM: number
  /** How much of a gold room a region must cover to be standing for it, 0..1. */
  roomOverlap: number
}

export const DEFAULT_EVALUATION: EvaluationOptions = {
  positionToleranceM: 0.2,
  maxAlignM: 8,
  majorWallM: 0.6,
  roomSampleM: 0.1,
  roomOverlap: 0.3,
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

/**
 * Where a gold wall's length went — §13 of the 06A brief.
 *
 * Stage 06 reported one number per gold wall: how much of it a candidate's
 * *solid* stretches covered. That number cannot say whether the rest is a
 * doorway the drawing shows, a wall the extraction missed, or a wall it found
 * in pieces, and those are three different defects with three different fixes.
 * So each is measured on its own and none is allowed to stand in for another.
 *
 * The distinction §3 of the brief insists on runs right through here:
 *
 *   - `fabricM` is material. A doorway is never in it, and inventing fabric
 *     across a source-open stretch shows up as `fabricAcrossGoldOpeningM`
 *     rather than as a better score.
 *   - `logicalM` is the host wall: its fabric *plus* the openings it has
 *     actually accounted for — a stretch the extraction says is a door or a
 *     passage in this wall. An opening it cannot explain (`UNKNOWN_GAP`) is
 *     not in it, so bridging arbitrary gaps cannot raise it.
 *   - `hostExtentM` is the whole extent of every candidate wall on this line,
 *     explained or not. It is the ceiling `logicalM` could reach if every gap
 *     were accounted for, and is reported to make that headroom visible.
 */
export type WallDecomposition = {
  goldId: string
  goldLengthM: number
  /** Of the gold length, what the gold itself says is an opening. */
  goldOpeningM: number
  /** Gold length that is material: `goldLengthM - goldOpeningM`. */
  goldFabricM: number
  /** Gold *fabric* covered by candidate material. */
  fabricM: number
  /** Gold length covered by candidate fabric plus accounted-for openings. */
  logicalM: number
  /** Gold length covered by any candidate wall's extent, accounted for or not. */
  hostExtentM: number
  /** Candidate material lying across a stretch the gold says is open. */
  fabricAcrossGoldOpeningM: number
  /** Gold opening span the candidate also reports as an opening. */
  openingAgreedM: number
  /** Gold length no candidate wall reaches at all. */
  missingM: number
  /** How many distinct candidate walls carry this gold wall. */
  hostCount: number
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
  /** §13: the same failure, taken apart. Major gold walls only. */
  decomposition: {
    goldLengthM: number
    goldOpeningM: number
    goldFabricM: number
    /** Stage 06's number: material over the whole gold length. */
    fabricM: number
    /** Material over the gold length the gold says is material. */
    fabricOfGoldFabric: number
    /** §14's number: fabric plus openings the extraction accounted for. */
    logicalM: number
    logicalCoverage: number
    /** The ceiling logicalM could reach with every gap accounted for. */
    hostExtentM: number
    hostExtentCoverage: number
    fabricAcrossGoldOpeningM: number
    openingAgreedM: number
    missingM: number
    /** Gold walls carried by more than one candidate wall, but fully carried. */
    fragmentedButCorrect: number
    /** Gold walls no candidate wall reaches over more than a tenth of them. */
    trulyMissing: number
    rows: WallDecomposition[]
  }
  /**
   * Candidate fabric lying across a stretch the gold says is open. §21 forbids
   * inventing wall to close a source-open passage, and this is the measurement
   * that would catch it.
   */
  invented: {
    /** Gold openings with any candidate material across them, over 0.1 m. */
    count: number
    totalM: number
    /**
     * Gold openings the candidate has actually *closed*: most of the span is
     * material and nothing is reported open there. §14's requirement is about
     * these, and touching a jamb is not one of them.
     */
    closed: number
    closedIds: string[]
    worst: Array<{ goldOpeningId: string; overlapM: number }>
  }
  adjacency: {
    goldEdges: number
    agreed: number
    merged: number
    missing: number
    rate: number
    /** Edges the gold carries a door on, and how many of those agree. */
    doorEdges: number
    doorAgreed: number
    /** Edges the gold marks notional — one open space — and how many agree. */
    openEdges: number
    openAgreed: number
    /**
     * Open edges satisfied by the candidate returning the two as one space
     * rather than as two regions with a wall between them. Agreed, and
     * reported separately because it is also a merge.
     */
    agreedByMerge: number
    rows: Array<{ edge: string; kind: 'DOOR' | 'OPEN'; outcome: 'AGREED' | 'MERGED' | 'MISSING'; why: string }>
  }
  doors: {
    goldDoors: number
    detected: number
    unresolved: number
    rate: number
    /** §14: read as a DOOR, not merely as an opening nobody explained. */
    asDoor: number
    asDoorRate: number
    /** Of those, the ones on the wall the gold says hosts them. */
    hostCorrect: number
    hostRate: number
    /** Widths compared, where the gold gives one. */
    widthsCompared: number
    widthsWithin: number
    widthToleranceM: number
    /** And within a pixel more, which is what the two that miss cost. */
    widthsWithinLoose: number
    widthToleranceLooseM: number
    rows: Array<{
      goldId: string
      outcome: 'DETECTED' | 'UNRESOLVED' | 'MISSED'
      /** What the candidate says is in the opening it found there. */
      foundClass: string
      hostCorrect: boolean
      goldWidthM: number
      foundWidthM: number | null
      why: string
    }>
  }
  rooms: {
    candidateRooms: number
    goldRooms: number
    mapped: number
    /** Gold rooms whose own centre falls inside some candidate region. */
    goldCovered: number
    /** Gold rooms no candidate region covers at all. */
    goldUncovered: string[]
    /** Candidate rooms covering more than one gold room: under-segmentation. */
    merged: number
    /** Which gold rooms each merged region absorbed. */
    mergedRows: string[][]
    /**
     * Merged regions the candidate itself marks unresolved. §14 allows a
     * remaining merge only when the candidate says it is one.
     */
    mergedUnresolved: number
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

  // --- §13: the same length, taken apart
  const decompRows: WallDecomposition[] = []
  for (const g of goldWalls) {
    const goldGaps = goldOpenings
      .filter((o) => o.wallId === g.id)
      .map((o) => [Math.max(o.fromM, g.fromM), Math.min(o.toM, g.toM)] as [number, number])
      .filter(([a, b]) => b > a)
    const fabric: Array<[number, number]> = []
    const logical: Array<[number, number]> = []
    const extent: Array<[number, number]> = []
    const acrossGold: Array<[number, number]> = []
    const openingAgreed: Array<[number, number]> = []
    const ids: string[] = []
    for (const w of walls) {
      if (w.axis !== g.axis) continue
      const s = shifted(w)
      if (Math.abs(s.centre - g.atM) > opts.positionToleranceM) continue
      const clipped = overlapOf(s.from, s.to, g.fromM, g.toM)
      if (clipped <= 0) continue
      if (!ids.includes(w.id)) ids.push(w.id)
      extent.push([Math.max(s.from, g.fromM), Math.min(s.to, g.toM)])
      for (const piece of w.openings.length === 0 ? [{ fromM: s.from, toM: s.to }] : solidPieces(w, s)) {
        const o = overlapOf(piece.fromM, piece.toM, g.fromM, g.toM)
        if (o <= 0) continue
        const span: [number, number] = [Math.max(piece.fromM, g.fromM), Math.min(piece.toM, g.toM)]
        fabric.push(span)
        logical.push(span)
        for (const [ga, gb] of goldGaps) {
          if (overlapOf(span[0], span[1], ga, gb) > 0) {
            acrossGold.push([Math.max(span[0], ga), Math.min(span[1], gb)])
          }
        }
      }
      // An opening the extraction accounted for is part of the host wall; one
      // it cannot explain is not, so a bridged gap of unknown provenance can
      // never raise the logical figure (§8, §9).
      const shift = s.from - Math.min(w.fromM, w.toM)
      for (const op of w.openings) {
        const from = Math.min(op.fromM, op.toM) + shift
        const to = Math.max(op.fromM, op.toM) + shift
        if (overlapOf(from, to, g.fromM, g.toM) <= 0) continue
        const span: [number, number] = [Math.max(from, g.fromM), Math.min(to, g.toM)]
        if (op.class === 'DOOR' || op.class === 'OPEN_PASSAGE') logical.push(span)
        for (const [ga, gb] of goldGaps) {
          if (overlapOf(span[0], span[1], ga, gb) > 0) {
            openingAgreed.push([Math.max(span[0], ga), Math.min(span[1], gb)])
          }
        }
      }
    }
    const goldLength = g.toM - g.fromM
    const hostExtentM = unionLength(extent)
    decompRows.push({
      goldId: g.id,
      goldLengthM: goldLength,
      goldOpeningM: unionLength(goldGaps),
      goldFabricM: goldLength - unionLength(goldGaps),
      fabricM: unionLength(fabric),
      logicalM: unionLength(logical),
      hostExtentM,
      fabricAcrossGoldOpeningM: unionLength(acrossGold),
      openingAgreedM: unionLength(openingAgreed),
      missingM: goldLength - hostExtentM,
      hostCount: ids.length,
    })
  }
  const majorDecomp = decompRows.filter((r) => r.goldLengthM >= opts.majorWallM)
  const sum = (f: (r: WallDecomposition) => number): number => majorDecomp.reduce((n, r) => n + f(r), 0)
  const decompGoldLengthM = sum((r) => r.goldLengthM)
  const decompLogicalM = sum((r) => r.logicalM)
  const decompHostExtentM = sum((r) => r.hostExtentM)
  const decomposition: CandidateEvaluation['decomposition'] = {
    goldLengthM: decompGoldLengthM,
    goldOpeningM: sum((r) => r.goldOpeningM),
    goldFabricM: sum((r) => r.goldFabricM),
    fabricM: sum((r) => r.fabricM),
    fabricOfGoldFabric:
      sum((r) => r.goldFabricM) === 0 ? 0 : (sum((r) => r.fabricM) - sum((r) => r.fabricAcrossGoldOpeningM)) / sum((r) => r.goldFabricM),
    logicalM: decompLogicalM,
    logicalCoverage: decompGoldLengthM === 0 ? 0 : decompLogicalM / decompGoldLengthM,
    hostExtentM: decompHostExtentM,
    hostExtentCoverage: decompGoldLengthM === 0 ? 0 : decompHostExtentM / decompGoldLengthM,
    fabricAcrossGoldOpeningM: sum((r) => r.fabricAcrossGoldOpeningM),
    openingAgreedM: sum((r) => r.openingAgreedM),
    missingM: sum((r) => r.missingM),
    fragmentedButCorrect: majorDecomp.filter((r) => r.hostCount > 1 && r.hostExtentM >= 0.9 * r.goldLengthM).length,
    trulyMissing: majorDecomp.filter((r) => r.hostExtentM < 0.1 * r.goldLengthM).length,
    rows: decompRows,
  }

  // --- fabric across an opening the source shows as open
  const invented: CandidateEvaluation['invented'] = {
    count: 0,
    totalM: 0,
    closed: 0,
    closedIds: [],
    worst: [],
  }
  for (const o of goldOpenings) {
    const host = gold.walls.find((w) => w.id === o.wallId && w.level === level)
    if (!host) continue
    const goldWidth = o.toM - o.fromM
    let across = 0
    let reportedOpen = 0
    for (const w of walls) {
      if (w.axis !== host.axis) continue
      const s = shifted(w)
      if (Math.abs(s.centre - host.atM) > opts.positionToleranceM) continue
      for (const piece of w.openings.length === 0 ? [{ fromM: s.from, toM: s.to }] : solidPieces(w, s)) {
        across += overlapOf(piece.fromM, piece.toM, o.fromM, o.toM)
      }
      const shift = s.from - Math.min(w.fromM, w.toM)
      for (const op of w.openings) {
        reportedOpen = Math.max(
          reportedOpen,
          overlapOf(
            Math.min(op.fromM, op.toM) + shift,
            Math.max(op.fromM, op.toM) + shift,
            o.fromM,
            o.toM,
          ),
        )
      }
    }
    if (across > 0.1) {
      invented.count++
      invented.totalM += across
      invented.worst.push({ goldOpeningId: o.id, overlapM: across })
    }
    // Closed, rather than merely touched: most of the opening is material and
    // the candidate reports nothing open across it.
    if (across > 0.5 * goldWidth && reportedOpen < 0.2 * goldWidth) {
      invented.closed++
      invented.closedIds.push(o.id)
    }
  }
  invented.worst.sort((a, b) => b.overlapM - a.overlapM)

  // --- rooms: which gold rooms each candidate region stands for
  //
  // A region stands for every gold room whose own centre it covers. Reading it
  // the other way round — one gold room per region, by the region's centre —
  // gets a corridor that swallowed the stairs wrong twice over: it names the
  // pair by whichever of them the merged centroid happens to land in, and then
  // every edge to that corridor is counted against the wrong room. Which of
  // the two happened is what §14 wants counted, and it is counted below as a
  // merge; it is not also allowed to destroy the adjacency figure.
  const goldRoomsOf = new Map<string, string[]>()
  for (const r of rooms) goldRoomsOf.set(r.id, [])
  for (const g of goldRooms) {
    const home = bestRegionFor(g, rooms, alignment, opts)
    if (!home) continue
    goldRoomsOf.get(home)?.push(g.id)
  }
  // A region covering several gold rooms' centres has merged them; that is
  // under-segmentation and is counted rather than excused.
  const mergedRooms = [...goldRoomsOf.values()].filter((list) => list.length > 1).length
  const mappedRooms = [...goldRoomsOf.values()].filter((list) => list.length > 0).length

  // --- adjacency
  //
  // The gold has two kinds of edge and they are not the same claim.
  //
  // An edge carried by a *door* says the two rooms are separate spaces joined
  // by a door. Merging them is a failure: the door was supposed to separate
  // them and did not.
  //
  // An edge the gold marks `notional` says the opposite — that these two
  // labelled spaces run into each other with nothing between them. A candidate
  // that returns them as one region has got that connection right, and §11 of
  // the brief is explicit that inventing a wall to split them would be wrong.
  // So such an edge agrees either way: two regions with an adjacency between
  // them, or one region containing both. What is lost — that the source gives
  // the one space two names — is counted as a merge and reported separately,
  // and the candidate is required to say so itself (§11, §12).
  const doorEdgeKeys = new Set<string>()
  for (const o of goldOpenings) {
    if (o.connects.length !== 2) continue
    doorEdgeKeys.add(edgeKey(o.connects[0], o.connects[1]))
  }
  const openEdgeKeys = new Set<string>()
  for (const r of goldRooms) {
    for (const e of r.notionalEdges ?? []) {
      const k = edgeKey(r.id, e.toRoomId)
      if (!doorEdgeKeys.has(k)) openEdgeKeys.add(k)
    }
  }
  const goldEdges = new Set<string>([...doorEdgeKeys, ...openEdgeKeys])
  const candidateEdges = new Set<string>()
  for (const a of adjacency) {
    for (const ga of goldRoomsOf.get(a.a) ?? []) {
      for (const gb of goldRoomsOf.get(a.b) ?? []) {
        if (ga === gb) continue
        candidateEdges.add(edgeKey(ga, gb))
      }
    }
  }
  let agreed = 0
  let merged = 0
  let agreedByMerge = 0
  const edgeRows: CandidateEvaluation['adjacency']['rows'] = []
  for (const e of goldEdges) {
    const kind: 'DOOR' | 'OPEN' = doorEdgeKeys.has(e) ? 'DOOR' : 'OPEN'
    const [a, b] = e.split('|')
    const inOneRegion = [...goldRoomsOf.values()].some((list) => list.includes(a) && list.includes(b))
    if (candidateEdges.has(e)) {
      agreed++
      edgeRows.push({ edge: e, kind, outcome: 'AGREED', why: 'two regions, and the candidate reports a wall between them' })
      continue
    }
    if (inOneRegion) {
      if (kind === 'OPEN') {
        agreed++
        agreedByMerge++
        edgeRows.push({
          edge: e,
          kind,
          outcome: 'AGREED',
          why: 'the gold says these two run into each other, and the candidate returns them as one space',
        })
        continue
      }
      merged++
      edgeRows.push({
        edge: e,
        kind,
        outcome: 'MERGED',
        why: 'a door separates these in the gold, and the candidate returned them as one region',
      })
      continue
    }
    edgeRows.push({
      edge: e,
      kind,
      outcome: 'MISSING',
      why: 'neither joined nor merged: the candidate has no region pair standing for these two',
    })
  }

  // --- doors
  //
  // §14 replaced Stage 06's "detected or explicitly unresolved" with something
  // stricter: the opening has to be read *as a door*, on the wall the gold
  // says hosts it, and at a width the source supports. All three are measured.
  //
  // The width tolerance adapts to the drawing rather than being a constant: it
  // is four pixels of the raster this candidate was read from, which is about
  // the resolution of the reading and of the hand transcription alike.
  const pxPerCm = plan?.pxPerCm ?? null
  const widthToleranceM = pxPerCm && pxPerCm > 0 ? Math.max(0.06, 4 / (pxPerCm * 100)) : 0.1
  const doorRows: CandidateEvaluation['doors']['rows'] = []
  // A wall the gold marks `emit: false` is still a wall the gold knows about;
  // the flag says it is not part of the wall set being matched, not that the
  // door hanging in it has no host.
  const allGoldWalls = gold.walls.filter((w) => w.level === level)
  for (const o of goldOpenings.filter((x) => x.kind === 'DOOR')) {
    const host = allGoldWalls.find((w) => w.id === o.wallId)
    const goldWidthM = o.toM - o.fromM
    if (!host) {
      doorRows.push({
        goldId: o.id,
        outcome: 'UNRESOLVED',
        foundClass: 'NONE',
        hostCorrect: false,
        goldWidthM,
        foundWidthM: null,
        why: 'the gold names a host wall that is not in the gold',
      })
      continue
    }
    let hostFound = false
    let best: { cls: string; widthM: number; overlap: number } | null = null
    for (const w of walls) {
      if (w.axis !== host.axis) continue
      const s = shifted(w)
      if (Math.abs(s.centre - host.atM) > opts.positionToleranceM) continue
      hostFound = true
      const shift = s.from - Math.min(w.fromM, w.toM)
      for (const op of w.openings) {
        const from = Math.min(op.fromM, op.toM) + shift
        const to = Math.max(op.fromM, op.toM) + shift
        const cover = overlapOf(from, to, o.fromM, o.toM)
        if (cover <= 0.2) continue
        // A DOOR outranks any other reading of the same stretch: what is
        // being asked is whether the pipeline knows a door is there.
        const better =
          best === null ||
          (op.class === 'DOOR' && best.cls !== 'DOOR') ||
          (op.class === best.cls && cover > best.overlap)
        if (better) best = { cls: op.class, widthM: to - from, overlap: cover }
      }
    }
    const found = best !== null
    doorRows.push({
      goldId: o.id,
      outcome: found ? 'DETECTED' : hostFound ? 'UNRESOLVED' : 'MISSED',
      foundClass: best?.cls ?? 'NONE',
      hostCorrect: best?.cls === 'DOOR',
      goldWidthM,
      foundWidthM: best?.widthM ?? null,
      why: found
        ? best!.cls === 'DOOR'
          ? 'a door is reported on the wall the gold says hosts it'
          : `an opening on the matching wall covers it, but it is reported as ${best!.cls}`
        : hostFound
          ? 'the host wall was found but reported no opening there'
          : 'the host wall was not found at all',
    })
  }
  const detected = doorRows.filter((r) => r.outcome === 'DETECTED').length
  const unresolved = doorRows.filter((r) => r.outcome === 'UNRESOLVED').length
  const asDoor = doorRows.filter((r) => r.foundClass === 'DOOR').length
  const hostCorrect = doorRows.filter((r) => r.hostCorrect).length
  const widthRows = doorRows.filter((r) => r.foundWidthM !== null)
  const widthsWithin = widthRows.filter(
    (r) => Math.abs((r.foundWidthM ?? 0) - r.goldWidthM) <= widthToleranceM,
  ).length
  const widthToleranceLooseM = pxPerCm && pxPerCm > 0 ? Math.max(0.08, 5 / (pxPerCm * 100)) : 0.13
  const widthsWithinLoose = widthRows.filter(
    (r) => Math.abs((r.foundWidthM ?? 0) - r.goldWidthM) <= widthToleranceLooseM,
  ).length

  return {
    storey,
    alignment,
    walls: { goldCount: major.length, goldLengthM, matchedM, coverage: goldLengthM === 0 ? 0 : matchedM / goldLengthM, rows },
    decomposition,
    invented,
    adjacency: {
      goldEdges: goldEdges.size,
      agreed,
      merged,
      missing: edgeRows.filter((r) => r.outcome === 'MISSING').length,
      rate: goldEdges.size === 0 ? 0 : agreed / goldEdges.size,
      doorEdges: doorEdgeKeys.size,
      doorAgreed: edgeRows.filter((r) => r.kind === 'DOOR' && r.outcome === 'AGREED').length,
      openEdges: openEdgeKeys.size,
      openAgreed: edgeRows.filter((r) => r.kind === 'OPEN' && r.outcome === 'AGREED').length,
      agreedByMerge,
      rows: edgeRows,
    },
    doors: {
      goldDoors: doorRows.length,
      detected,
      unresolved,
      rate: doorRows.length === 0 ? 0 : (detected + unresolved) / doorRows.length,
      asDoor,
      asDoorRate: doorRows.length === 0 ? 0 : asDoor / doorRows.length,
      hostCorrect,
      hostRate: doorRows.length === 0 ? 0 : hostCorrect / doorRows.length,
      widthsCompared: widthRows.length,
      widthsWithin,
      widthToleranceM,
      widthsWithinLoose,
      widthToleranceLooseM,
      rows: doorRows,
    },
    rooms: {
      candidateRooms: rooms.length,
      goldRooms: goldRooms.length,
      mapped: mappedRooms,
      goldCovered: goldRooms.filter((g) => [...goldRoomsOf.values()].some((l) => l.includes(g.id))).length,
      goldUncovered: goldRooms.filter((g) => ![...goldRoomsOf.values()].some((l) => l.includes(g.id))).map((g) => g.id),
      merged: mergedRooms,
      mergedRows: [...goldRoomsOf.values()].filter((l) => l.length > 1),
      mergedUnresolved: [...goldRoomsOf.entries()].filter(
        ([id, l]) => l.length > 1 && rooms.find((r) => r.id === id)?.segmentation === 'UNRESOLVED',
      ).length,
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

/**
 * Which candidate region a gold room is, if any.
 *
 * By *area*, not by a point. A centroid test asks one pixel a question about a
 * room, and on a plan the answer is often "that pixel is a wall" — the gold's
 * stairwell centroid lands on the boundary between the corridor and the
 * landing, and the room it obviously is then counts as found by nobody. What
 * is measured instead is how much of the gold room's own polygon each
 * candidate region covers, and the region covering most of it is the region
 * standing for it, provided it covers enough of it to be that room at all.
 *
 * Against the region's *footprint*, never its box: a corridor's box contains
 * most of the rooms off it.
 */
function bestRegionFor(
  g: GoldRoom,
  rooms: ReadonlyArray<{
    id: string
    box: { x0: number; z0: number; x1: number; z1: number }
    footprint: { cellM: number; cols: number; rows: number; filled: string }
  }>,
  alignment: { dx: number; dz: number },
  opts: EvaluationOptions,
): string | null {
  const xs = g.polygon.map((p) => p[0])
  const zs = g.polygon.map((p) => p[1])
  const step = opts.roomSampleM
  const counts = new Map<string, number>()
  let inside = 0
  for (let z = Math.min(...zs) + step / 2; z < Math.max(...zs); z += step) {
    for (let x = Math.min(...xs) + step / 2; x < Math.max(...xs); x += step) {
      if (!insidePolygon({ x, z }, g.polygon)) continue
      inside++
      for (const r of rooms) {
        if (!footprintCovers(r, x - alignment.dx, z - alignment.dz)) continue
        counts.set(r.id, (counts.get(r.id) ?? 0) + 1)
        break
      }
    }
  }
  if (inside === 0) return null
  let best: string | null = null
  let bestN = 0
  for (const [id, n] of counts) {
    if (n > bestN) {
      bestN = n
      best = id
    }
  }
  return bestN / inside >= opts.roomOverlap ? best : null
}

/** Whether a point in candidate metres falls on a region's own footprint. */
const footprintCovers = (
  r: {
    box: { x0: number; z0: number; x1: number; z1: number }
    footprint: { cellM: number; cols: number; rows: number; filled: string }
  },
  x: number,
  z: number,
): boolean => {
  if (x < r.box.x0 || x > r.box.x1 || z < r.box.z0 || z > r.box.z1) return false
  const { cellM, cols, rows, filled } = r.footprint
  if (cols === 0 || rows === 0 || cellM <= 0) return true
  const col = Math.min(cols - 1, Math.max(0, Math.floor((x - r.box.x0) / cellM)))
  const row = Math.min(rows - 1, Math.max(0, Math.floor((z - r.box.z0) / cellM)))
  return filled[row * cols + col] === '1'
}
