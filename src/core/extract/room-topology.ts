/**
 * Three truths about a doorway, kept apart — STAGE WEB-PIVOT-06A §3, §8-§11.
 *
 * §3 of the brief is the whole design of this file. A doorway creates three
 * different facts and Stage 06 had only one field to put them in, which is why
 * closing the room partition and reporting the wall honestly looked like
 * opposites:
 *
 *   1. **A logical host wall.** The two collinear pieces either side of one
 *      doorway are one wall. It runs the length of both of them and the
 *      opening between them, and it is that whole length that the gold means
 *      by "this wall".
 *
 *   2. **Physical fabric.** There is no wall material *in* the doorway. No
 *      length reported as material may include it, ever, and §13 is explicit
 *      that coverage may not be improved by filling a real opening in.
 *
 *   3. **A room-topology barrier, and an adjacency.** A door separates two
 *      rooms *and* connects them. The thing that stops the flood at a doorway
 *      is not material — it is a separator this file puts there, on the
 *      evidence that a door is drawn in it, and the same evidence is what says
 *      the two rooms are neighbours.
 *
 * So a wall carries its whole extent, its material, and its openings, and each
 * opening carries what the drawing says is in it. A separator is never fabric
 * and fabric is never a separator.
 *
 * ## What an opening is allowed to be
 *
 * §8 forbids forcing every gap to DOOR, and the classifier below reads in one
 * direction only: everything is `UNKNOWN_GAP` until something moves it, and
 * nothing moves it back. A door symbol found hanging in the opening makes it a
 * `DOOR`. Outside on one side of it makes it an `EXTERIOR_OPENING`. Being
 * wider than any door, with no door drawn in it, makes it an `OPEN_PASSAGE` —
 * two rooms that are one space. A door-width hole with nothing drawn in it
 * stays `UNKNOWN_GAP`, because that is what it is: it may be a door whose
 * symbol this pipeline could not read, and saying so is more useful than
 * guessing.
 *
 * ## What the barrier is made of
 *
 * §10 asks for the boundary model to be explicit, and it is: fabric, the
 * exterior boundary, and virtual separators at the openings a room is not
 * continuous through. An `OPEN_PASSAGE` gets no separator, which is how §11's
 * open-plan spaces stay one room rather than being split by an invented wall.
 * An `UNKNOWN_GAP` gets one — keeping the rooms apart is the conservative
 * reading — and the adjacency it produces is marked unresolved, so no
 * confident topology decision is recorded where there is no evidence for one.
 *
 * PORT_DIRECT (Kotlin).
 */
import type { DoorObservation } from './door-symbols.js'
import type { OpeningClass, WallOpening, WallRun } from './plan-model.js'

export type TopologyOptions = {
  /** How far a door's line may sit from a wall run's own line, metres. */
  hostMatchM: number
  /** How far a doorway's end may sit from a wall piece's end, metres. */
  hostReachM: number
  /** Furthest a jamb is followed when a door has to make its own host, metres. */
  jambFollowM: number
  /** An opening wider than this, with no door drawn in it, is a passage. */
  passageM: number
  /** How far outside a wall the classifier looks to see what is there, metres. */
  sideProbeM: number
  /** How far a wall line is carried to the wall it runs into, metres. */
  maxOpeningM: number
}

export const DEFAULT_TOPOLOGY: TopologyOptions = {
  hostMatchM: 0.12,
  hostReachM: 0.35,
  jambFollowM: 1.2,
  passageM: 1.6,
  sideProbeM: 0.1,
  maxOpeningM: 5,
}

/** What became of one door observation. */
export type DoorPlacement = {
  doorId: string
  /** The host wall it was hung on, once there was one. */
  hostWallId: string | null
  /** `MATCHED` an existing wall, `MERGED` two of them, `MADE` one from the jambs. */
  outcome: 'MATCHED' | 'MERGED' | 'MADE' | 'UNPLACED'
  why: string
}

const overlaps = (a0: number, a1: number, b0: number, b1: number): number =>
  Math.min(a1, b1) - Math.max(a0, b0)

/**
 * Put every door on a host wall, making the host wall where the bands missed
 * it — §9.
 *
 * Three outcomes, and which one happens says something about the drawing.
 *
 * `MATCHED`: a wall run already spans the doorway, and the stretch becomes an
 * opening on it. `MERGED`: two runs stop either side of the doorway, and
 * because a door is drawn in the stretch between them — collinear, compatible
 * thickness, terminating at the same opening — they are one wall with an
 * opening in it, which is §9's test written out. `MADE`: no run reaches the
 * doorway at all, because the pieces either side were too short to be claimed.
 * The door says the wall is there, the jambs say where its material is, and
 * the host is built from those two facts and nothing else.
 *
 * In every case the opening is an opening. None of this adds a millimetre of
 * fabric anywhere (§3.2).
 */
export function placeDoors(
  runs: readonly WallRun[],
  doors: readonly DoorObservation[],
  fabric: Uint8Array,
  width: number,
  height: number,
  pxPerCm: number,
  opts: TopologyOptions = DEFAULT_TOPOLOGY,
): { runs: WallRun[]; placements: DoorPlacement[] } {
  const matchPx = Math.max(1, opts.hostMatchM * 100 * pxPerCm)
  const reachPx = Math.max(2, opts.hostReachM * 100 * pxPerCm)
  const followPx = Math.max(2, opts.jambFollowM * 100 * pxPerCm)
  const out: WallRun[] = runs.map((r) => ({ ...r, solid: [...r.solid], openings: [...r.openings] }))
  const placements: DoorPlacement[] = []
  let made = 0

  const solidAt = (axis: 'X' | 'Y', along: number, across: number): boolean => {
    const x = axis === 'X' ? Math.round(along) : Math.round(across)
    const y = axis === 'X' ? Math.round(across) : Math.round(along)
    return x >= 0 && y >= 0 && x < width && y < height && fabric[y * width + x] === 1
  }

  for (const door of doors) {
    const opening: WallOpening = {
      fromPx: door.fromPx,
      toPx: door.toPx,
      lengthPx: door.toPx - door.fromPx + 1,
      kind: door.widthM <= opts.passageM ? 'DOORWAY' : 'WIDE',
      class: 'DOOR',
      doorId: door.id,
      classConfidence: door.confidence,
      why: `a door symbol is drawn in it: ${door.evidence[0] ?? 'evidence recorded on the observation'}`,
    }
    const online = out.filter((r) => r.axis === door.axis && Math.abs(r.centrePx - door.atPx) <= matchPx)

    // 1. A wall already spans it.
    const spanning = online.find((r) => r.fromPx <= door.fromPx + reachPx && r.toPx >= door.toPx - reachPx)
    if (spanning) {
      const existing = spanning.openings.find(
        (o) => overlaps(o.fromPx, o.toPx, door.fromPx, door.toPx) > 0.4 * opening.lengthPx,
      )
      if (existing) {
        existing.class = 'DOOR'
        existing.doorId = door.id
        existing.classConfidence = door.confidence
        existing.why = opening.why
      } else {
        spanning.openings.push(opening)
        // The material the drawing shows is not touched; what is recorded is
        // that this stretch of the wall is a doorway.
        spanning.solid = spanning.solid.flatMap((p) => {
          const o = overlaps(p.fromPx, p.toPx, door.fromPx, door.toPx)
          if (o <= 0) return [p]
          const pieces: Array<{ fromPx: number; toPx: number }> = []
          if (p.fromPx < door.fromPx) pieces.push({ fromPx: p.fromPx, toPx: door.fromPx - 1 })
          if (p.toPx > door.toPx) pieces.push({ fromPx: door.toPx + 1, toPx: p.toPx })
          return pieces
        })
      }
      placements.push({
        doorId: door.id,
        hostWallId: spanning.id,
        outcome: 'MATCHED',
        why: 'a wall already ran the length of this doorway',
      })
      continue
    }

    // 2. Two walls stop either side of it: §9's collinear, compatible pair.
    const before = online.find((r) => Math.abs(r.toPx - (door.fromPx - 1)) <= reachPx)
    const after = online.find((r) => Math.abs(r.fromPx - (door.toPx + 1)) <= reachPx)
    if (before && after && before !== after) {
      const merged: WallRun = {
        ...before,
        fromPx: Math.min(before.fromPx, after.fromPx),
        toPx: Math.max(before.toPx, after.toPx),
        nearPx: (before.nearPx + after.nearPx) / 2,
        farPx: (before.farPx + after.farPx) / 2,
        thicknessPx: (before.thicknessPx + after.thicknessPx) / 2,
        centrePx: (before.centrePx + after.centrePx) / 2,
        solid: [...before.solid, ...after.solid].sort((a, b) => a.fromPx - b.fromPx),
        openings: [...before.openings, ...after.openings, opening].sort((a, b) => a.fromPx - b.fromPx),
      }
      out.splice(out.indexOf(before), 1, merged)
      out.splice(out.indexOf(after), 1)
      placements.push({
        doorId: door.id,
        hostWallId: merged.id,
        outcome: 'MERGED',
        why: 'two collinear walls of a compatible thickness terminate at this doorway, so they are one wall with an opening',
      })
      continue
    }

    // 3. Nothing reaches it. The jambs say where the material is.
    const follow = (from: number, dir: -1 | 1): { fromPx: number; toPx: number } | null => {
      let end = from
      for (let k = 0; k < followPx; k++) {
        if (!solidAt(door.axis, from + dir * k, door.atPx)) break
        end = from + dir * k
      }
      if (end === from && !solidAt(door.axis, from, door.atPx)) return null
      return dir > 0 ? { fromPx: from, toPx: end } : { fromPx: end, toPx: from }
    }
    const stubBefore = follow(door.fromPx - 1, -1)
    const stubAfter = follow(door.toPx + 1, 1)
    if (!stubBefore && !stubAfter) {
      placements.push({
        doorId: door.id,
        hostWallId: null,
        outcome: 'UNPLACED',
        why: 'no wall run reaches this doorway and no material stands at either jamb',
      })
      continue
    }
    const solid = [stubBefore, stubAfter].filter((p): p is { fromPx: number; toPx: number } => p !== null)
    const host: WallRun = {
      id: `wd${made++}`,
      axis: door.axis,
      fromPx: Math.min(solid[0].fromPx, opening.fromPx),
      toPx: Math.max(solid[solid.length - 1].toPx, opening.toPx),
      nearPx: door.atPx - door.thicknessPx / 2,
      farPx: door.atPx + door.thicknessPx / 2,
      thicknessPx: door.thicknessPx,
      solid,
      openings: [opening],
      centrePx: door.atPx,
    }
    out.push(host)
    placements.push({
      doorId: door.id,
      hostWallId: host.id,
      outcome: 'MADE',
      why:
        'no wall run reached this doorway — the pieces either side were too short to be claimed — so the host ' +
        'wall is the doorway and the material standing at its two jambs, and nothing else',
    })
  }
  return { runs: out, placements }
}

/**
 * Carry each wall line to the wall it runs into, and call what is between an
 * opening.
 *
 * A wall's line does not stop where its material stops. A garage front is
 * 2.9 m of nothing between the end of the garage's south wall and the east
 * wall it meets; the drawing is perfectly clear that the line carries on, and
 * a boundary model that stops at the material leaves the garage draining into
 * the street. Stage 06 already joined two *collinear* pieces across a gap for
 * the same reason; this is the other half of it, where what closes the gap is
 * a wall crossing rather than more of the same wall.
 *
 * Nothing is asserted about what is in the opening. It is an `UNKNOWN_GAP`
 * like any other until §8 reads it, so an opening between two interior spaces
 * wide enough to be a passage still becomes one and still joins the two rooms
 * — this closes a boundary, it does not build a wall. And it adds no fabric:
 * the material stays exactly what the raster showed.
 */
export function closeAtCrossings(
  runs: readonly WallRun[],
  fabric: Uint8Array,
  width: number,
  height: number,
  pxPerCm: number,
  opts: TopologyOptions = DEFAULT_TOPOLOGY,
): { runs: WallRun[]; closed: number } {
  const maxPx = opts.maxOpeningM * 100 * pxPerCm
  let closed = 0
  const out = runs.map((run) => {
    // A band eighty pixels thick and twenty long is a piece of wall seen along
    // the wrong axis — the same material the perpendicular run already
    // describes. Carrying *its* line across the building would draw a boundary
    // the width of the wall through the middle of a room.
    if (run.toPx - run.fromPx + 1 < run.thicknessPx) return run
    const solidAt = (along: number, across: number): boolean => {
      const x = run.axis === 'X' ? Math.round(along) : Math.round(across)
      const y = run.axis === 'X' ? Math.round(across) : Math.round(along)
      return x >= 0 && y >= 0 && x < width && y < height && fabric[y * width + x] === 1
    }
    /** A wall crossing this line covers the line's whole thickness. */
    const crossesHere = (along: number): boolean => {
      let hit = 0
      let n = 0
      for (let c = Math.floor(run.nearPx); c <= Math.ceil(run.farPx); c++) {
        n++
        if (solidAt(along, c)) hit++
      }
      return n > 0 && hit / n >= 0.6
    }
    let fromPx = run.fromPx
    let toPx = run.toPx
    const openings = [...run.openings]
    const solid = [...run.solid]
    for (const [edge, dir] of [
      [run.fromPx, -1],
      [run.toPx, 1],
    ] as Array<[number, -1 | 1]>) {
      // Walk out from the wall's end. What is passed over first is usually the
      // junction blob where this wall meets another — material, and the band
      // detector's own reason for stopping — so the search cannot give up at
      // the first solid pixel. What is looked for is the next wall *across*
      // this line, with at least some nothing in between.
      const seen: Array<{ at: number; solid: boolean }> = []
      let sawVoid = false
      let found = -1
      for (let k = 1; k <= maxPx; k++) {
        const at = edge + dir * k
        if (at < 0) break
        const here = solidAt(at, run.centrePx)
        if (sawVoid && crossesHere(at)) {
          found = at
          break
        }
        if (!here) sawVoid = true
        seen.push({ at, solid: here })
      }
      if (found < 0) continue
      // Material stays material and nothing else becomes any.
      const runs2: Array<{ from: number; to: number; solid: boolean }> = []
      for (const p of seen) {
        const last = runs2[runs2.length - 1]
        if (last && last.solid === p.solid) {
          last.from = Math.min(last.from, p.at)
          last.to = Math.max(last.to, p.at)
        } else runs2.push({ from: p.at, to: p.at, solid: p.solid })
      }
      for (const r2 of runs2) {
        if (r2.solid) {
          solid.push({ fromPx: r2.from, toPx: r2.to })
          continue
        }
        openings.push({
          fromPx: r2.from,
          toPx: r2.to,
          lengthPx: r2.to - r2.from + 1,
          kind: r2.to - r2.from + 1 <= opts.passageM * 100 * pxPerCm ? 'DOORWAY' : 'WIDE',
          class: 'UNKNOWN_GAP',
          classConfidence: 0,
          why: 'this wall\u2019s line carries on to the wall it runs into, and nothing stands in between',
          carried: true,
        })
      }
      if (dir > 0) toPx = Math.max(toPx, found - 1)
      else fromPx = Math.min(fromPx, found + 1)
      closed++
    }
    if (fromPx === run.fromPx && toPx === run.toPx) return run
    return {
      ...run,
      fromPx,
      toPx,
      solid: solid.sort((a, b) => a.fromPx - b.fromPx),
      openings: openings.sort((a, b) => a.fromPx - b.fromPx),
    }
  })
  return { runs: out, closed }
}

/**
 * What each opening is — §8.
 *
 * Read in one direction: `UNKNOWN_GAP` is where every opening starts, a door
 * symbol or the outside moves it, and nothing moves it back. An opening the
 * evidence does not explain keeps its unresolved state rather than being given
 * the most likely answer.
 */
export function classifyOpenings(
  runs: readonly WallRun[],
  outside: (x: number, y: number) => boolean,
  pxPerCm: number,
  opts: TopologyOptions = DEFAULT_TOPOLOGY,
): { runs: WallRun[]; counts: Record<OpeningClass, number> } {
  const probePx = Math.max(1, Math.round(opts.sideProbeM * 100 * pxPerCm))
  const passagePx = opts.passageM * 100 * pxPerCm
  const counts: Record<OpeningClass, number> = {
    DOOR: 0,
    OPEN_PASSAGE: 0,
    EXTERIOR_OPENING: 0,
    UNKNOWN_GAP: 0,
  }
  const out = runs.map((run) => ({
    ...run,
    openings: run.openings.map((o) => {
      if (o.class === 'DOOR') {
        counts.DOOR++
        return o
      }
      // What lies on the two sides of the wall along this opening.
      const mid = (o.fromPx + o.toPx) / 2
      const sideOf = (sign: -1 | 1): boolean => {
        const across = sign < 0 ? run.nearPx - probePx : run.farPx + probePx
        return run.axis === 'X' ? outside(mid, across) : outside(across, mid)
      }
      if (sideOf(-1) || sideOf(1)) {
        counts.EXTERIOR_OPENING++
        return {
          ...o,
          class: 'EXTERIOR_OPENING' as const,
          classConfidence: 0.6,
          why: 'one side of this stretch is the space around the building, so what is in it is a window or a way out',
        }
      }
      if (o.lengthPx > passagePx) {
        counts.OPEN_PASSAGE++
        return {
          ...o,
          class: 'OPEN_PASSAGE' as const,
          classConfidence: 0.55,
          why:
            `${(o.lengthPx / pxPerCm / 100).toFixed(2)} m of wall is missing between two interior spaces and no ` +
            'door is drawn in it, which is wider than any door hangs; the two spaces are one space',
        }
      }
      counts.UNKNOWN_GAP++
      return {
        ...o,
        class: 'UNKNOWN_GAP' as const,
        classConfidence: 0,
        why:
          'material stops here and starts again, and nothing in the drawing says why: no door symbol was read ' +
          'in it, it is not wide enough to be a passage, and it is not on the outside',
      }
    }),
  }))
  return { runs: out, counts }
}

/** A stretch of a wall line that stops a room, and what put it there. */
export type Separator = {
  wallRunId: string
  axis: 'X' | 'Y'
  atNearPx: number
  atFarPx: number
  fromPx: number
  toPx: number
  /** `FABRIC` is material; the rest are this file's, and are never material. */
  kind: 'FABRIC' | 'DOOR' | 'EXTERIOR_OPENING' | 'UNKNOWN_GAP'
  why: string
}

/**
 * The barrier a room is flooded against — §10.
 *
 * Material, and then a separator at each opening a room is not continuous
 * through. An `OPEN_PASSAGE` gets none, so the spaces either side of it come
 * back as one region, which is what §11 asks for and what stops an open-plan
 * kitchen and living room being split by a wall nobody drew.
 */
export function separatorsOf(runs: readonly WallRun[]): Separator[] {
  const out: Separator[] = []
  for (const run of runs) {
    // The whole of the wall, whatever its recorded ends say. A host wall built
    // from one jamb because the other had no material records a doorway that
    // starts where its material ends, and a walk bounded by the material would
    // step straight over the doorway and leave the two rooms as one.
    const from = Math.floor(
      Math.min(run.fromPx, ...run.solid.map((p) => p.fromPx), ...run.openings.map((o) => o.fromPx)),
    )
    const to = Math.ceil(
      Math.max(run.toPx, ...run.solid.map((p) => p.toPx), ...run.openings.map((o) => o.toPx)),
    )
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) continue
    const covers = (o: WallOpening, a: number): boolean => a >= o.fromPx && a <= o.toPx
    /** What, if anything, stops a room at this point of the wall's line. */
    const kindAt = (a: number): { kind: Separator['kind']; why: string } | null => {
      if (run.solid.some((p) => a >= p.fromPx && a <= p.toPx)) {
        return { kind: 'FABRIC', why: 'the drawing has material here' }
      }
      const here = run.openings.filter((x) => covers(x, a))
      const o =
        here.find((x) => x.class === 'DOOR') ??
        here.find((x) => x.class === 'EXTERIOR_OPENING') ??
        here.find((x) => x.carried !== true) ??
        here[0]
      if (o?.class === 'OPEN_PASSAGE') return null
      // A carried stretch is where a wall's line goes, not a hole in anything.
      // It may keep the outside out; it may not cut a room in two on nothing
      // more than the fact that a wall stopped there.
      if (o?.carried === true && o.class !== 'EXTERIOR_OPENING' && o.class !== 'DOOR') return null
      if (o?.class === 'DOOR') {
        return {
          kind: 'DOOR',
          why: 'a door is drawn here: it stops one room becoming the next, and it is not material',
        }
      }
      if (o?.class === 'EXTERIOR_OPENING') {
        return {
          kind: 'EXTERIOR_OPENING',
          why: 'the outside is on one side of this, so a room does not continue through it',
        }
      }
      return {
        kind: 'UNKNOWN_GAP',
        why: 'nothing says what is here, and keeping the rooms apart is the reading that asserts least',
      }
    }
    // The whole line is walked, so a pixel that belongs to neither a solid
    // piece nor a recorded opening — the reveal a publisher draws inside a
    // doorway, a rounding at a junction — is still boundary. A hole in the
    // barrier is a room draining into the garden, and one pixel is enough.
    let open: { from: number; kind: Separator['kind']; why: string } | null = null
    const flush = (at: number): void => {
      if (!open) return
      out.push({
        wallRunId: run.id,
        axis: run.axis,
        atNearPx: run.nearPx,
        atFarPx: run.farPx,
        fromPx: open.from,
        toPx: at,
        kind: open.kind,
        why: open.why,
      })
      open = null
    }
    for (let a = from; a <= to; a++) {
      const here = kindAt(a)
      if (!here) {
        flush(a - 1)
        continue
      }
      if (open && open.kind === here.kind) continue
      flush(a - 1)
      open = { from: a, kind: here.kind, why: here.why }
    }
    flush(to)
  }
  return out
}

/** Paint a barrier into a mask. */
export function paintSeparators(
  mask: Uint8Array,
  separators: readonly Separator[],
  width: number,
  height: number,
): void {
  for (const s of separators) {
    const near = Math.floor(s.atNearPx)
    const far = Math.ceil(s.atFarPx)
    for (let a = Math.floor(s.fromPx); a <= Math.ceil(s.toPx); a++) {
      for (let c = near; c <= far; c++) {
        const x = s.axis === 'X' ? a : c
        const y = s.axis === 'X' ? c : a
        if (x < 0 || y < 0 || x >= width || y >= height) continue
        mask[y * width + x] = 1
      }
    }
  }
}
