/**
 * The Marcowki interior, from the gold fixture — STAGE WEB-PIVOT-04.
 *
 * Development only. This module turns `research/gold/marcowki-interior-v1.json`
 * — a hand transcription of the two published floor plans — into an
 * `InteriorSpec`. It is the only place those coordinates are read, and nothing
 * in the production analyzer imports it, so the gold interior can never reach
 * the automatic URL -> model flow.
 *
 * ## Where the third dimension comes from
 *
 * The plans are plans: they say where a wall is and how thick, and nothing at
 * all about how tall. The heights come from the exterior gold instead, through
 * `marcowki-fixture.ts`:
 *
 *   - a ground partition runs from the ground finished floor to the underside
 *     of the upper floor slab, which is the upper FFL less the slab thickness;
 *   - an attic partition runs from the upper FFL to the roof's underside where
 *     that is lower than the stated ceiling line, and to the ceiling line where
 *     it is not. The roof's underside is `4.36 + tan(40) * min(x, 7.90 - x)`,
 *     which is exactly the plane STAGE WEB-PIVOT-02A gave the attic side walls.
 *     A partition crosses the slope along its own length when it runs east-west,
 *     so its top is a `POLYLINE`; one that runs north-south is at a single
 *     distance from the eave, so its top is level.
 *
 * Every interior wall is given an explicit top profile even where that profile
 * is level. It costs nothing, it says what the top is instead of leaving it to
 * be inferred from `heightM`, and it is what routes an internal doorway — whose
 * sill *is* the floor — through the compiler path that can express one.
 *
 * ## Mutations
 *
 * `MarcowkiInteriorOptions` breaks the model in eight stated ways, each one a
 * defect a person could plausibly introduce. They exist so that the acceptance
 * tests can show they *fail* on a broken interior rather than passing on
 * anything; none is ever committed as the default.
 *
 * PORT_DIRECT (Kotlin) — plain data.
 */
import goldJson from '../../../research/gold/marcowki-interior-v1.json' with { type: 'json' }
import type { Provenance, SpecStatus } from './architectural.js'
import type { WallTopProfile } from './contracts.js'
import {
  interiorWallSpec,
  type InteriorLevelSpec,
  type InteriorOpeningSpec,
  type InteriorSpec,
  type InteriorWallSpec,
  type PlanPoint,
  type PlanPolygon,
  type RoomSpec,
  type StairSpec,
} from './interior.js'
import { M } from './marcowki-fixture.js'

type GoldLevel = (typeof goldJson.levels)[number]
type GoldWall = (typeof goldJson.walls)[number]
type GoldRoom = (typeof goldJson.rooms)[number]
type GoldOpening = (typeof goldJson.openings)[number]

export const gold = goldJson

/** Provenance for a value the gold file carries, with its own words kept. */
const prov = (locator: string, status: string, source: string, interpretation: string): Provenance => ({
  source: 'research/gold/marcowki-interior-v1.json',
  locator,
  interpretation,
  status: status as SpecStatus,
  note: source,
})

// --- Heights ----------------------------------------------------------------

/** Slope of the roof's underside, per metre of horizontal distance from the eave. */
const K = Math.tan((M.pitchDeg * Math.PI) / 180)
/** Height of the roof's underside above the attic floor, at plan x. */
export const atticSoffitAboveFfl = (x: number): number =>
  M.kneeWall + K * Math.min(Math.max(x, 0), Math.max(M.mainWidth - x, 0))
/** Where the soffit crosses a stated ceiling line, measured from the eave. */
const soffitReaches = (h: number): number => (h - M.kneeWall) / K

export const GROUND_CLEAR_H = M.upperFfl - M.groundFfl - M.slabThickness

/**
 * The top profile of one interior wall, in its own `u` coordinate.
 *
 * For a level top this is two points at the same height, which is the honest
 * description of a flat top rather than a special case of one.
 */
function topProfileFor(w: GoldWall, level: GoldLevel): { profile: WallTopProfile; heightM: number } {
  const length = w.toM - w.fromM
  const cap = level.clearHeightM
  if (level.topKind === 'FLAT') {
    return {
      profile: { kind: 'POLYLINE', points: [{ u: 0, topM: cap }, { u: length, topM: cap }] },
      heightM: cap,
    }
  }
  if (w.axis === 'Z') {
    // Constant along the wall; the soffit only varies across its thickness, so
    // the wall stops at the lower of its two faces and stays under the roof.
    const half = w.thicknessM / 2
    const top = Math.min(cap, Math.min(atticSoffitAboveFfl(w.atM - half), atticSoffitAboveFfl(w.atM + half)))
    return {
      profile: { kind: 'POLYLINE', points: [{ u: 0, topM: top }, { u: length, topM: top }] },
      heightM: top,
    }
  }
  // An east-west wall crosses the slope along its own length. Break the profile
  // at the ridge and at each point where the soffit meets the ceiling line.
  const d = soffitReaches(cap)
  const us = [0, length]
  for (const x of [d, M.mainWidth / 2, M.mainWidth - d]) {
    const u = x - w.fromM
    if (u > 1e-9 && u < length - 1e-9) us.push(u)
  }
  const points = [...new Set(us)]
    .sort((a, b) => a - b)
    .map((u) => ({ u, topM: Math.min(cap, atticSoffitAboveFfl(w.fromM + u)) }))
  return { profile: { kind: 'POLYLINE', points }, heightM: Math.max(...points.map((p) => p.topM)) }
}

// --- Mutations --------------------------------------------------------------

export type MarcowkiInteriorOptions = {
  /** Slide one internal wall along the axis it is stated on. */
  moveWall?: { wallId: string; deltaM: number }
  /** Grow one room across its neighbour's face, so two room polygons overlap. */
  growRoom?: { roomId: string; edge: 'minX' | 'maxX' | 'minZ' | 'maxZ'; deltaM: number }
  /** Pull one room's edge back, leaving floor that nothing accounts for. */
  shrinkRoom?: { roomId: string; edge: 'minX' | 'maxX' | 'minZ' | 'maxZ'; deltaM: number }
  /** Re-host a door on a wall that does not separate the rooms it claims to join. */
  misrouteDoor?: { openingId: string; toWallId: string }
  /** Leave the slab whole, so the stair runs into it. */
  fillStairVoid?: boolean
  /** Slide the hole in the slab away from the stair below it. */
  misalignStairVoid?: { deltaX?: number; deltaZ?: number }
  /** Reflect the attic layout about the building's own centre line. */
  mirrorUpperPlan?: boolean
  /** Turn the attic layout through 180 degrees about the building's centre. */
  rotateUpperPlan?: boolean
}

const MID_X = M.mainWidth / 2
const MID_Z = M.overallDepth / 2

const mirrorPoint = (p: PlanPoint): PlanPoint => ({ x: 2 * MID_X - p.x, z: p.z })
const rotatePoint = (p: PlanPoint): PlanPoint => ({ x: 2 * MID_X - p.x, z: 2 * MID_Z - p.z })

function transformPolygon(poly: PlanPolygon, f: (p: PlanPoint) => PlanPoint): PlanPolygon {
  // Reflecting reverses the winding; the area oracles take the absolute value,
  // and the triangulator works on the coordinate set, so the order is kept as
  // it comes. A mutation is meant to look plausible until something measures it.
  return poly.map(f)
}

// --- The spec ---------------------------------------------------------------

export function marcowkiInteriorSpec(opts: MarcowkiInteriorOptions = {}): InteriorSpec {
  const levels: InteriorLevelSpec[] = gold.levels.map((l) => ({
    id: l.id,
    name: l.name,
    fflM: l.fflM,
    clearHeightM: l.clearHeightM,
    topKind: l.topKind as 'FLAT' | 'ATTIC_SOFFIT',
    envelopes: l.envelopes.map((e) => ({ ...e })),
    provenance: prov(`levels[${l.id}]`, l.status, l.source, 'storey datum and clear height'),
  }))
  const levelById = new Map(gold.levels.map((l) => [l.id, l]))

  const mirroring = opts.mirrorUpperPlan === true
  const rotating = opts.rotateUpperPlan === true
  const pointMap = mirroring ? mirrorPoint : rotating ? rotatePoint : undefined

  const walls: InteriorWallSpec[] = gold.walls.map((g: GoldWall) => {
    const level = levelById.get(g.level)!
    let { axis, atM, fromM, toM } = g as { axis: 'X' | 'Z'; atM: number; fromM: number; toM: number }
    if (opts.moveWall && opts.moveWall.wallId === g.id) atM += opts.moveWall.deltaM
    if (pointMap && g.level === 'upper') {
      // Reflect or rotate the wall's own centre line and span.
      const a = axis === 'X' ? pointMap({ x: fromM, z: atM }) : pointMap({ x: atM, z: fromM })
      const b = axis === 'X' ? pointMap({ x: toM, z: atM }) : pointMap({ x: atM, z: toM })
      if (axis === 'X') {
        atM = a.z
        fromM = Math.min(a.x, b.x)
        toM = Math.max(a.x, b.x)
      } else {
        atM = a.x
        fromM = Math.min(a.z, b.z)
        toM = Math.max(a.z, b.z)
      }
    }
    const { profile, heightM } = topProfileFor({ ...g, atM, fromM, toM } as GoldWall, level)
    return {
      id: g.id,
      levelId: g.level,
      axis,
      atM,
      fromM,
      toM,
      thicknessM: g.thicknessM,
      kind: g.kind as InteriorWallSpec['kind'],
      emit: g.emit,
      wall: interiorWallSpec(g.id, axis, atM, fromM, toM, g.thicknessM, level.fflM, heightM, profile),
      openingIds: gold.openings.filter((o) => o.wallId === g.id).map((o) => o.id),
      provenance: prov(`walls[${g.id}]`, g.status, g.source, `${g.kind} on the ${g.level} floor`),
    }
  })
  const wallById = new Map(walls.map((w) => [w.id, w]))

  const openings: InteriorOpeningSpec[] = gold.openings.map((o: GoldOpening) => {
    const hostId = opts.misrouteDoor?.openingId === o.id ? opts.misrouteDoor.toWallId : o.wallId
    const host = wallById.get(hostId)
    // The opening keeps the position the drawing gives it along the host's own
    // axis. Re-hosting it on a different wall is a mutation, and the offset it
    // lands at there is exactly what makes the mutation detectable.
    const offsetM = (host ? o.fromM - host.fromM : o.fromM)
    return {
      id: o.id,
      levelId: o.level,
      hostWallId: hostId,
      offsetM,
      widthM: o.toM - o.fromM,
      sillM: o.sillM,
      headM: o.headM,
      kind: o.kind as InteriorOpeningSpec['kind'],
      connects: [o.connects[0], o.connects[1]] as const,
      cut: host?.emit === true,
      provenance: prov(`openings[${o.id}]`, o.status, o.source, `${o.kind} between ${o.connects.join(' and ')}`),
    }
  })

  const rooms: RoomSpec[] = gold.rooms.map((r: GoldRoom) => {
    let polygon: PlanPolygon = r.polygon.map(([x, z]) => ({ x, z }))
    if (pointMap && r.level === 'upper') polygon = transformPolygon(polygon, pointMap)
    for (const [m, sign] of [
      [opts.growRoom, 1],
      [opts.shrinkRoom, -1],
    ] as const) {
      if (!m || m.roomId !== r.id) continue
      const rect = {
        minX: Math.min(...polygon.map((p) => p.x)),
        maxX: Math.max(...polygon.map((p) => p.x)),
        minZ: Math.min(...polygon.map((p) => p.z)),
        maxZ: Math.max(...polygon.map((p) => p.z)),
      }
      const d = sign * m.deltaM
      polygon = polygon.map((p) => {
        if (m.edge === 'minX' && Math.abs(p.x - rect.minX) < 1e-9) return { x: p.x - d, z: p.z }
        if (m.edge === 'maxX' && Math.abs(p.x - rect.maxX) < 1e-9) return { x: p.x + d, z: p.z }
        if (m.edge === 'minZ' && Math.abs(p.z - rect.minZ) < 1e-9) return { x: p.x, z: p.z - d }
        if (m.edge === 'maxZ' && Math.abs(p.z - rect.maxZ) < 1e-9) return { x: p.x, z: p.z + d }
        return p
      })
    }
    return {
      id: r.id,
      levelId: r.level,
      envelopeId: r.envelopeId,
      label: r.label,
      ...(r.publishedIndex !== undefined ? { publishedIndex: r.publishedIndex } : {}),
      ...(r.publishedAreaM2 !== undefined ? { publishedAreaM2: r.publishedAreaM2 } : {}),
      ...('publishedGrossAreaM2' in r && r.publishedGrossAreaM2 !== undefined
        ? { publishedGrossAreaM2: r.publishedGrossAreaM2 as number }
        : {}),
      polygon,
      boundaryWallIds: [],
      openingIds: [],
      notionalEdges: (('notionalEdges' in r ? r.notionalEdges : []) as Array<{ from: number[]; to: number[]; toRoomId: string }>).map(
        (e) => ({ from: { x: e.from[0], z: e.from[1] }, to: { x: e.to[0], z: e.to[1] }, toRoomId: e.toRoomId }),
      ),
      provenance: prov(`rooms[${r.id}]`, r.status, r.source, `${r.label}, published index ${r.publishedIndex ?? '-'}`),
    }
  })

  const stairs: StairSpec[] = gold.stairs.map((s) => {
    const dx = opts.misalignStairVoid?.deltaX ?? 0
    const dz = opts.misalignStairVoid?.deltaZ ?? 0
    return {
      id: s.id,
      fromLevelId: s.fromLevel,
      toLevelId: s.toLevel,
      footprint: s.footprint.map(([x, z]) => ({ x, z })),
      slabVoid: s.slabVoid.map(([x, z]) => ({ x: x + dx, z: z + dz })),
      riseFromM: s.riseFromM,
      riseToM: s.riseToM,
      risers: s.risers,
      shape: s.shape,
      flights: s.flights.map((f) => ({
        id: f.id,
        axis: f.axis as 'X' | 'Z',
        direction: f.direction as 1 | -1,
        bandFromM: f.bandFromM,
        bandToM: f.bandToM,
        runFromM: f.runFromM,
        runToM: f.runToM,
        firstRiser: f.firstRiser,
        risers: f.risers,
      })),
      provenance: prov(`stairs[${s.id}]`, s.status, s.source, 'the stair connecting the two storeys'),
      simplification: s.simplification,
    }
  })

  const slabs = gold.slabs.map((sl) => ({
    id: sl.id,
    topLevelId: sl.topLevel,
    thicknessM: sl.thicknessM,
    footprint: sl.footprint.map(([x, z]) => ({ x, z })),
    voidStairIds: opts.fillStairVoid ? [] : [...sl.voids],
    provenance: prov(`slabs[${sl.id}]`, sl.status, sl.source, 'the floor plate between the storeys'),
  }))

  return {
    id: gold.id,
    version: gold.schemaVersion,
    levels,
    walls,
    openings,
    rooms,
    stairs,
    slabs,
    provenance: prov('method', 'SOURCE_CORROBORATED', gold.method.note, 'the Marcowki interior, both storeys'),
    unresolved: [...gold.unresolved],
  }
}
