/**
 * Closed storey wall ring — STAGE WEB-PIVOT-01C, development only.
 *
 * STAGE WEB-PIVOT-01B proved one corner: two walls, one explicit owner, the
 * corner prism emitted exactly once. A ring is not that four times. Four local
 * decisions have to come out globally consistent, and the two ways that fails
 * are not visible from inside any single junction:
 *
 *   - a corner with **no** junction leaves both walls claiming the same prism,
 *     so the ring interpenetrates and its volume is over;
 *   - a corner trimmed **twice** leaves a hole straight through the fabric to
 *     the interior, and every junction involved still looks correct on its own.
 *
 * Neither is a geometry bug. Both are topology: the set of junctions either
 * describes a single closed loop over every wall or it does not. This module
 * checks that — and only that — before handing the walls to the junction
 * compiler, so a ring that does not close is refused by name rather than
 * compiled into something that merely looks like a room.
 *
 * ## What it does not do
 *
 * It does not infer junctions. A wall end with no junction is reported, never
 * invented, for the same reason STAGE WEB-PIVOT-01B refused to infer ownership:
 * a guessed corner makes every later failure ambiguous between "the junction is
 * wrong" and "the junction was never there".
 *
 * It also does not care what shape the ring is. Nothing here mentions
 * rectangles, facades, compass directions or a bounding box; a ring is a cycle
 * in the junction graph, and the geometry is checked by STAGE WEB-PIVOT-01B's
 * own tests at each corner.
 *
 * PORT_DIRECT (Kotlin) — plain data and pure functions.
 */
import type { WallDiagnostic, WallSpec } from './contracts.js'
import type {
  JunctionCompileInput,
  JunctionCompileResult,
  JunctionDiagnostic,
  WallEnd,
  WallJunctionSpec,
} from './junction.js'
import { compileJunctions } from './junction.js'

export type RingDiagnosticCode =
  /** A wall end that no junction joins: the ring has a corner nobody owns. */
  | 'RING_WALL_END_UNJOINED'
  /** Every end is joined, but the junctions do not form one cycle over all walls. */
  | 'RING_NOT_CLOSED'

export type RingDiagnostic = {
  code: RingDiagnosticCode
  severity: 'ERROR' | 'WARNING'
  message: string
  wallId?: string
  junctionId?: string
  /** The wall end this is about, when it is about one. */
  end?: WallEnd
}

/** Anything this stage can refuse for, in one list. */
export type RingCompileDiagnostic = WallDiagnostic | JunctionDiagnostic | RingDiagnostic

export type StoreyRingResult = Omit<JunctionCompileResult, 'diagnostics'> & {
  /** True when the junctions form one closed cycle visiting every wall once. */
  closed: boolean
  /** The wall ids in ring order, when it closes. Empty otherwise. */
  order: string[]
  ringDiagnostics: RingDiagnostic[]
  diagnostics: RingCompileDiagnostic[]
}

const ENDS: readonly WallEnd[] = ['START', 'END']
const other = (e: WallEnd): WallEnd => (e === 'START' ? 'END' : 'START')

/** The junction at a given wall end, if the input names one. */
function endIndex(junctions: readonly WallJunctionSpec[]): Map<string, WallJunctionSpec> {
  const out = new Map<string, WallJunctionSpec>()
  const seen = new Set<string>()
  for (const j of junctions) {
    if (seen.has(j.id)) continue // the junction compiler reports the duplicate
    seen.add(j.id)
    for (const [wallId, end] of [
      [j.wallAId, j.wallAEnd],
      [j.wallBId, j.wallBEnd],
    ] as const) {
      const key = `${wallId}|${end}`
      // First claim wins, matching the junction compiler: a second claim on the
      // same end is that compiler's CONFLICTING_JUNCTION_END, not a ring fault.
      if (!out.has(key)) out.set(key, j)
    }
  }
  return out
}

/**
 * Ring topology, checked without touching geometry.
 *
 * Two questions, in order, because the second is meaningless until the first is
 * answered: is every wall end joined to something, and do those joins trace one
 * loop through every wall rather than several smaller ones?
 */
export function checkRingTopology(
  walls: readonly WallSpec[],
  junctions: readonly WallJunctionSpec[],
): { diagnostics: RingDiagnostic[]; closed: boolean; order: string[] } {
  const diagnostics: RingDiagnostic[] = []
  if (walls.length === 0) return { diagnostics, closed: false, order: [] }

  const byId = new Map<string, WallSpec>()
  for (const w of walls) if (!byId.has(w.id)) byId.set(w.id, w)
  const unique = [...byId.values()]
  const at = endIndex(junctions)

  for (const w of unique) {
    for (const end of ENDS) {
      if (at.has(`${w.id}|${end}`)) continue
      diagnostics.push({
        code: 'RING_WALL_END_UNJOINED',
        severity: 'ERROR',
        message:
          `the ${end} end of wall ${w.id} is joined by no junction. A closed ring needs one junction ` +
          'per corner; without it both walls at that corner keep the corner material and the ring ' +
          'overlaps itself. The junction is not inferred',
        wallId: w.id,
        end,
      })
    }
  }
  if (diagnostics.length > 0) return { diagnostics, closed: false, order: [] }

  // Walk the loop: leave a wall by one end, arrive at the wall the junction
  // there names, and leave that one by its *other* end.
  const start = unique[0]
  const order: string[] = []
  let wallId = start.id
  let leaveBy: WallEnd = 'END'
  for (let step = 0; step < unique.length; step++) {
    order.push(wallId)
    const j = at.get(`${wallId}|${leaveBy}`)
    if (!j) break
    const arrivedAt = j.wallAId === wallId && j.wallAEnd === leaveBy ? j.wallBId : j.wallAId
    const arrivedEnd = j.wallAId === wallId && j.wallAEnd === leaveBy ? j.wallBEnd : j.wallAEnd
    if (arrivedAt === wallId) break // self-reference; the junction compiler names it
    wallId = arrivedAt
    leaveBy = other(arrivedEnd)
  }

  const closed = order.length === unique.length && wallId === start.id && new Set(order).size === order.length
  if (!closed) {
    diagnostics.push({
      code: 'RING_NOT_CLOSED',
      severity: 'ERROR',
      message:
        `the junctions do not form one closed ring: walking from ${start.id} visited ` +
        `${order.length} of ${unique.length} walls (${order.join(' -> ')}) before returning to ${wallId}. ` +
        'Every wall end is joined, so this is several loops or a loop that misses walls, not a missing junction',
    })
    return { diagnostics, closed: false, order: [] }
  }
  return { diagnostics, closed: true, order }
}

/**
 * Validate the ring's topology, then compile it.
 *
 * The topology check gates nothing: the walls and junctions are compiled either
 * way, so a caller that wants to look at a broken ring's geometry still can.
 * What it does is put the *reason* in the result alongside the triangles,
 * instead of leaving a reader to infer "a junction is missing" from a volume
 * that came out 0.6075 m³ high.
 */
export function compileStoreyRing(input: JunctionCompileInput): StoreyRingResult {
  const ring = checkRingTopology(input.walls, input.junctions)
  const compiled = compileJunctions(input)
  return {
    ...compiled,
    closed: ring.closed,
    order: ring.order,
    ringDiagnostics: ring.diagnostics,
    diagnostics: [...ring.diagnostics, ...compiled.diagnostics],
  }
}
