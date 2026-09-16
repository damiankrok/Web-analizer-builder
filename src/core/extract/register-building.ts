/**
 * One building out of several drawings — STAGE WEB-PIVOT-07R §2-§10.
 *
 * Everything this module reads is already in the candidate. It adds no
 * measurement and re-reads no raster: Stage 06's plans, Stage 07's section,
 * levels, roof and facades stand exactly as they were extracted. What it adds
 * is the thing between them that nobody had computed — where each drawing's
 * own frame sits in the building's — and the consequences of knowing that:
 * which mass each roof component bears on, how far each wall actually runs,
 * and where each storey stops.
 *
 * The order is forced by the evidence.
 *
 * 1. Each plan storey is told what on its sheet is the building (§4, §10).
 * 2. The largest structural envelope becomes the building frame's origin, so
 *    the frame is anchored on structure rather than on whatever was furthest
 *    north-west (§3).
 * 3. Every other storey is registered onto it by matching wall faces, solving
 *    a quarter-turn, a mirror and a translation (§5).
 * 4. The section's own horizontal coordinate is registered onto whichever
 *    building axis it cuts across, by matching the ends of what it cuts to
 *    the wall faces those ends must be (§6).
 * 5. The footprint is divided into masses by which storeys stand on them, and
 *    each roof component is given the mass its registered span lands on, and
 *    bounded to it (§7).
 *
 * Nothing is placed without a registration, and a registration that does not
 * fit is `UNRESOLVED` rather than approximate. What cannot be registered is
 * not drawn at the origin: it is reported as unplaced.
 *
 * PORT_DIRECT (Kotlin).
 */
import type { ArchitecturalSpecCandidate, CandidateStorey } from './spec-candidate.js'
import type { OpeningClass } from './plan-model.js'
import type { CandidateLevel } from './candidate-shell.js'
import {
  classifyStorey,
  interiorProbe,
  DEFAULT_PLAN_MASSES,
  type ClassifiedRun,
  type PlanMassOptions,
  type PlanRunRole,
  type StoreyFabric,
} from './plan-masses.js'
import {
  identityRegistration,
  placedAxis,
  placeRect,
  rectArea,
  rectContains,
  rectIntersect,
  type Rect,
  type SourceFrameRegistration,
} from './building-frame.js'

export type RegisterOptions = {
  planMasses: PlanMassOptions
  /**
   * How far two faces may be apart and still be the same face, as a multiple
   * of the occupancy cell the candidate published its rooms at. Two storeys
   * are drawn on two sheets and registered through their own scales; a face
   * that lands within a cell of another is the same wall.
   */
  faceMatchCells: number
  /** Fewest agreeing faces before a registration is more than a coincidence. */
  minMatches: number
}

export const DEFAULT_REGISTER: RegisterOptions = {
  planMasses: DEFAULT_PLAN_MASSES,
  faceMatchCells: 1,
  minMatches: 4,
}

/** A wall, in the building's frame, with what is left of it after §4 and §8. */
export type RegisteredWall = {
  id: string
  storey: string
  role: PlanRunRole
  /** The building axis this wall runs along. */
  axis: 'X' | 'Z'
  /** Its two faces on the other axis, building metres. */
  nearM: number
  farM: number
  thicknessM: number
  /** Stretches of material, building metres along `axis`. Openings are not in them. */
  fabric: Array<{ fromM: number; toM: number }>
  openings: Array<{
    fromM: number
    toM: number
    class: OpeningClass
    kind: 'DOORWAY' | 'WIDE'
    /**
     * Where the opening's head and sill are, when an elevation measured them
     * and the candidate matched that elevation opening to this plan gap. A
     * plan alone gives a gap and no height, so these stay null and the gap
     * runs the whole wall — which is what the drawing says, not a colonnade.
     */
    sillM: number | null
    headM: number | null
    levelsFrom: string | null
    why: string
  }>
  baseM: number
  topM: number
  /** False where no source settles where this wall stops. */
  topSettled: boolean
  massId: string | null
  why: string
}

export type RegisteredRoom = {
  id: string
  storey: string
  box: Rect
  areaM2: number
  labelsInside: number
  segmentation: 'SETTLED' | 'UNRESOLVED'
  footprint: { cellM: number; cols: number; rows: number; filled: string }
  floorM: number
  /**
   * Cells of this region that fell outside the storey's own envelope.
   *
   * A flood that gets through a balcony door carries on into the garden, and
   * the region it returns is partly outside the building. The cells outside
   * are dropped rather than drawn, because a floor cannot be outside the
   * walls; the count is kept so a reader can see it happened.
   */
  clippedCells: number
}

/** A part of the building with its own stack of storeys. */
export type BuildingMass = {
  id: string
  role: 'PRIMARY' | 'WING'
  footprint: Rect
  storeys: string[]
  baseM: number
  topM: number
  topSettled: boolean
  why: string
}

export type RegisteredRoofPlane = {
  id: string
  componentId: string
  /** The plan rectangle this plane covers, bounded to its host mass. */
  footprint: Rect
  /** The building axis the plane falls along, and which way it falls. */
  fallAxis: 'X' | 'Z' | null
  fallDirection: 1 | -1 | 0
  highLevelM: number
  lowLevelM: number
  thicknessM: number | null
  /** What the sources fused for this roof's pitch. */
  statedPitchDeg: number | null
  /** What this plane's own geometry works out at, once bounded to its host. */
  impliedPitchDeg: number | null
  status: 'RESOLVED' | 'PARTLY_UNRESOLVED' | 'UNRESOLVED'
  why: string
}

export type RegisteredRoof = {
  id: string
  topology: string
  hostMassId: string | null
  footprint: Rect | null
  /** For a pitched roof: the axis the ridge runs along and where it sits. */
  ridgeAxis: 'X' | 'Z' | null
  ridgeAtM: number | null
  ridgeLevelM: number | null
  eaveLevelM: number | null
  planes: RegisteredRoofPlane[]
  /** Null where no source settles the overhang, which is not the same as zero. */
  overhangM: number | null
  status: 'RESOLVED' | 'PARTLY_UNRESOLVED' | 'UNRESOLVED'
  why: string
}

export type RegisteredSlab = {
  id: string
  levelM: number
  footprint: Rect
  massId: string
  thicknessM: number | null
  why: string
}

/** A glazed opening the candidate placed itself, in the building frame. */
export type RegisteredGlazing = {
  id: string
  wallId: string
  storey: string
  axis: 'X' | 'Z'
  fromM: number
  toM: number
  nearM: number
  farM: number
  sillM: number
  headM: number
  view: string
  why: string
}

/** Something the sources describe that this registration could not place. */
export type Unplaced = {
  id: string
  kind: string
  what: string
  why: string
}

/** One of §12's hard oracles, measured. */
export type CoherenceCheck = {
  id: string
  title: string
  status: 'PASS' | 'FAIL' | 'UNRESOLVED'
  measured: string
  toleranceM: number | null
}

export type RegisteredBuilding = {
  schemaVersion: 'registered-building-1.0.0'
  kind: 'CANDIDATE'
  notCanonical: true
  project: string
  sourcePackageId: string
  sourcePackageHash: string
  frame: {
    id: 'BUILDING'
    originFrom: string
    axes: 'plan-right is +X, plan-down is +Z, up is +Y, metres'
    note: string
  }
  registrations: SourceFrameRegistration[]
  storeyEnvelopes: Array<{ storey: string; envelope: Rect | null; baseM: number; topM: number; topSettled: boolean }>
  masses: BuildingMass[]
  walls: RegisteredWall[]
  rooms: RegisteredRoom[]
  slabs: RegisteredSlab[]
  roofs: RegisteredRoof[]
  glazing: RegisteredGlazing[]
  levels: CandidateLevel[]
  /**
   * Runs of parallel tread-like lines, placed. An observation about the
   * drawing: a flight of stairs and a tiled floor look the same on one sheet.
   */
  flights: Array<{ storey: string; rect: Rect }>
  /** Flights agreed on by two storeys, which is what makes a void a void. */
  voids: Rect[]
  checks: CoherenceCheck[]
  unplaced: Unplaced[]
  unresolved: string[]
  notes: string[]
}

// ---------------------------------------------------------------- face fitting

type Face = {
  /** The axis this face's value is measured on. */
  faceAxis: 'X' | 'Z'
  at: number
  /** The face's extent along the other axis. */
  fromM: number
  toM: number
  weight: number
}

const facesOf = (fabric: StoreyFabric): Face[] => {
  const out: Face[] = []
  for (const r of fabric.runs) {
    if (r.role === 'OUTSIDE_MASS' || r.role === 'LINE_ONLY' || r.fabric.length === 0) continue
    const weight = r.fabric.reduce((n, f) => n + (f.toM - f.fromM), 0)
    if (weight <= 0) continue
    const fromM = Math.min(...r.fabric.map((f) => f.fromM))
    const toM = Math.max(...r.fabric.map((f) => f.toM))
    const faceAxis: 'X' | 'Z' = r.axis === 'X' ? 'Z' : 'X'
    out.push({ faceAxis, at: r.nearM, fromM, toM, weight })
    out.push({ faceAxis, at: r.farM, fromM, toM, weight })
  }
  return out
}

/** A face after a quarter-turn and a mirror, before any translation. */
function turnFace(f: Face, rotation90: 0 | 1 | 2 | 3, mirrorX: boolean): Face {
  const spin = (axis: 'X' | 'Z', value: number): { axis: 'X' | 'Z'; value: number } => {
    let a = axis
    let v = value * (axis === 'X' && mirrorX ? -1 : 1)
    for (let i = 0; i < rotation90; i++) {
      if (a === 'X') {
        a = 'Z'
      } else {
        a = 'X'
        v = -v
      }
    }
    return { axis: a, value: v }
  }
  const along: 'X' | 'Z' = f.faceAxis === 'X' ? 'Z' : 'X'
  const face = spin(f.faceAxis, f.at)
  const lo = spin(along, f.fromM)
  const hi = spin(along, f.toM)
  return {
    faceAxis: face.axis,
    at: face.value,
    fromM: Math.min(lo.value, hi.value),
    toM: Math.max(lo.value, hi.value),
    weight: f.weight,
  }
}

type AxisFit = { translate: number; score: number; matched: number; residualM: number }

/**
 * The offset that puts the most material on the same lines.
 *
 * Every pairing of a moving face with a fixed one proposes an offset; the one
 * the most material votes for wins. Weighted by the length of wall behind each
 * face and by how much of it overlaps, so a long facade outvotes a cupboard
 * and two walls that merely happen to be collinear do not agree.
 *
 * A face's own line is measured on one axis and its extent runs along the
 * other, so the overlap term cannot be judged until the *other* axis has been
 * fitted too. `extentShift` is that other axis's offset, and the caller fits
 * each axis twice: once without asking for overlap at all, then again with
 * the extents moved into place. Without the second pass a mirrored sheet
 * scores as if none of its walls overlapped anything, and a mirror the
 * drawings plainly show is missed.
 */
function fitAxis(
  moving: readonly Face[],
  fixed: readonly Face[],
  toleranceM: number,
  extentShift: number,
  requireOverlap: boolean,
): AxisFit | null {
  if (moving.length === 0 || fixed.length === 0) return null
  const proposals = new Set<number>()
  for (const m of moving) for (const f of fixed) proposals.add(Math.round((f.at - m.at) * 1000) / 1000)
  let best: AxisFit | null = null
  for (const translate of proposals) {
    let score = 0
    let matched = 0
    let errWeight = 0
    let errSum = 0
    for (const m of moving) {
      let bestPair: { q: number; d: number; w: number } | null = null
      for (const f of fixed) {
        const d = Math.abs(m.at + translate - f.at)
        if (d > toleranceM) continue
        const overlap = Math.min(m.toM + extentShift, f.toM) - Math.max(m.fromM + extentShift, f.fromM)
        if (requireOverlap && overlap <= 0) continue
        const share =
          requireOverlap && Number.isFinite(overlap) ? Math.min(1, overlap / Math.min(m.weight, f.weight)) : 1
        const w = Math.min(m.weight, f.weight) * share
        const q = w * (1 - d / toleranceM)
        if (!bestPair || q > bestPair.q) bestPair = { q, d, w }
      }
      if (!bestPair) continue
      score += bestPair.q
      matched++
      errWeight += bestPair.w
      errSum += bestPair.w * bestPair.d * bestPair.d
    }
    if (matched === 0) continue
    const residualM = errWeight > 0 ? Math.sqrt(errSum / errWeight) : 0
    if (!best || score > best.score) best = { translate, score, matched, residualM }
  }
  return best
}

// ---------------------------------------------------------------- the entry point

export function registerBuilding(
  candidate: ArchitecturalSpecCandidate,
  opts: RegisterOptions = DEFAULT_REGISTER,
): RegisteredBuilding {
  const notes: string[] = []
  const unresolved: string[] = []
  const unplaced: Unplaced[] = []
  const registrations: SourceFrameRegistration[] = []

  const fabrics = new Map<string, StoreyFabric>()
  for (const s of candidate.storeys) {
    const f = classifyStorey(s, opts.planMasses)
    fabrics.set(s.storey, f)
    notes.push(...f.notes)
  }

  // §3: the frame is anchored on the largest structural envelope, which is the
  // storey that carries the most building — not the first sheet in the set.
  const withEnvelope = candidate.storeys.filter((s) => fabrics.get(s.storey)?.envelope)
  if (withEnvelope.length === 0) {
    return empty(candidate, notes, ['no storey published a structural envelope, so there is no building frame to register onto'])
  }
  const primary = [...withEnvelope].sort(
    (a, b) => rectArea(fabrics.get(b.storey)!.envelope!) - rectArea(fabrics.get(a.storey)!.envelope!),
  )[0]
  const primaryFabric = fabrics.get(primary.storey)!
  const primaryEnvelope = primaryFabric.envelope!
  const cellM = primaryFabric.occupancy?.cellM ?? 0.25
  const toleranceM = cellM * opts.faceMatchCells

  registrations.push(
    identityRegistration(
      `PLAN:${primary.storey}`,
      'PLAN',
      -primaryEnvelope.x0,
      -primaryEnvelope.z0,
      `the building frame is this storey's structural envelope: its north-west corner is the origin, at ` +
        `(${primaryEnvelope.x0.toFixed(3)}, ${primaryEnvelope.z0.toFixed(3)}) in the sheet's own plan frame, and the ` +
        `envelope measures ${(primaryEnvelope.x1 - primaryEnvelope.x0).toFixed(2)} by ` +
        `${(primaryEnvelope.z1 - primaryEnvelope.z0).toFixed(2)} m`,
      [{ assetId: primary.assetId, role: 'PLAN', locator: 'the structural envelope faces' }],
    ),
  )

  const primaryFaces = facesOf(primaryFabric).map((f) => ({
    ...f,
    at: f.at - (f.faceAxis === 'X' ? primaryEnvelope.x0 : primaryEnvelope.z0),
    fromM: f.fromM - (f.faceAxis === 'X' ? primaryEnvelope.z0 : primaryEnvelope.x0),
    toM: f.toM - (f.faceAxis === 'X' ? primaryEnvelope.z0 : primaryEnvelope.x0),
  }))

  // §5: every other storey onto it.
  for (const s of candidate.storeys) {
    if (s.storey === primary.storey) continue
    const fabric = fabrics.get(s.storey)
    if (!fabric || !fabric.envelope) {
      registrations.push(unresolvedRegistration(`PLAN:${s.storey}`, 'PLAN', 'this storey published no structural envelope to register'))
      unplaced.push({ id: `PLAN:${s.storey}`, kind: 'STOREY', what: `the ${s.storey} plan`, why: 'no structural envelope was derived for it' })
      continue
    }
    registrations.push(registerStorey(s, fabric, primaryFaces, toleranceM, opts, primary.storey))
  }

  // Everything below is in the building frame.
  const byStorey = new Map<string, SourceFrameRegistration>()
  for (const r of registrations) if (r.kind === 'PLAN') byStorey.set(r.sourceFrameId.slice('PLAN:'.length), r)

  const levels = candidate.shell?.levels ?? []
  const bands = storeyBands(candidate.storeys, levels)

  const storeyEnvelopes = candidate.storeys.map((s) => {
    const reg = byStorey.get(s.storey)
    const fabric = fabrics.get(s.storey)
    const band = bands.get(s.storey)
    return {
      storey: s.storey,
      envelope: reg && reg.status !== 'UNRESOLVED' && fabric?.envelope ? placeRect(reg, fabric.envelope) : null,
      baseM: band?.baseM ?? 0,
      topM: band?.topM ?? 0,
      topSettled: band?.topSettled ?? false,
    }
  })

  // §8: the walls, in the building's own frame. They come before the masses
  // because what stands where is what says which part of the footprint is a
  // wing and which is the body.
  const walls = placeWalls(candidate.storeys, fabrics, byStorey, bands)
  const rooms = placeRooms(candidate.storeys, byStorey, bands, new Map(storeyEnvelopes.map((s) => [s.storey, s.envelope])))

  // §10: masses, by which storeys stand on them.
  const masses = massesOf(storeyEnvelopes, walls, rooms)
  assignMasses(walls, masses)

  // §6: the section, onto the axis it cuts across.
  const sectionReg = registerSection(candidate, walls, masses, toleranceM)
  if (sectionReg) registrations.push(sectionReg)

  // §7, §9: what the section and the levels put on top of the masses.
  const roofs = placeRoofs(candidate, sectionReg, masses, unplaced, toleranceM + (sectionReg?.residualM ?? 0))
  const slabs = placeSlabs(candidate, masses)
  const glazing = placeGlazing(candidate, walls, unplaced)
  const flights = placedFlights(candidate.storeys, fabrics, byStorey)
  const voids = agreedVoids(candidate.storeys, fabrics, byStorey)

  // §9: a mass whose roof bears below its storey's nominal top stops there.
  // A garage is a storey by the level table and a 2.9 m box by its own roof,
  // and the roof is the thing that was measured.
  for (const mass of masses) {
    const roof = roofs.find((r) => r.hostMassId === mass.id)
    if (!roof) continue
    const bearing = Math.min(
      ...roof.planes.map((p) => Math.min(p.lowLevelM, p.highLevelM)).filter((v) => Number.isFinite(v)),
    )
    if (!Number.isFinite(bearing) || bearing >= mass.topM - 1e-6 || bearing <= mass.baseM) continue
    mass.topM = bearing
    mass.topSettled = true
    mass.why += `; its walls stop at ${bearing.toFixed(3)} m, where the roof the section measured bears on them`
  }

  // Walls that top out at a mass's roof rather than at the storey above.
  for (const w of walls) {
    const mass = masses.find((m) => m.id === w.massId)
    if (!mass) continue
    if (mass.topM < w.topM) {
      w.topM = mass.topM
      w.topSettled = w.topSettled && mass.topSettled
      w.why += `; capped at ${mass.topM.toFixed(3)} m, where ${mass.id} stops`
    }
  }

  for (const s of candidate.shell?.unresolved ?? []) unresolved.push(s)
  if (voids.length === 0) {
    unresolved.push(
      'no floor opening is settled: a flight of stairs and a tiled floor are drawn the same way, and the two ' +
        'storeys do not draw a flight in the same place, so no void is cut in the floor slab',
    )
  }

  const checks = runChecks(
    { masses, walls, roofs, slabs, storeyEnvelopes, registrations, rooms, flights, voids },
    toleranceM,
    candidate,
    fabrics,
  )

  notes.push(
    `the building frame is ${primary.storey}'s structural envelope, ` +
      `${(primaryEnvelope.x1 - primaryEnvelope.x0).toFixed(2)} by ${(primaryEnvelope.z1 - primaryEnvelope.z0).toFixed(2)} m; ` +
      `faces match within ${(toleranceM * 1000).toFixed(0)} mm, one occupancy cell`,
  )

  return {
    schemaVersion: 'registered-building-1.0.0',
    kind: 'CANDIDATE',
    notCanonical: true,
    project: candidate.project,
    sourcePackageId: candidate.sourcePackageId,
    sourcePackageHash: candidate.sourcePackageHash,
    frame: {
      id: 'BUILDING',
      originFrom: `PLAN:${primary.storey}`,
      axes: 'plan-right is +X, plan-down is +Z, up is +Y, metres',
      note:
        'the origin is the north-west corner of the primary storey’s structural envelope. A terrace edge, an ' +
        'entrance step or a site outline is not structure, so none of them can move it.',
    },
    registrations,
    storeyEnvelopes,
    masses,
    walls,
    rooms,
    slabs,
    roofs,
    glazing,
    levels,
    flights,
    voids,
    checks,
    unplaced,
    unresolved,
    notes,
  }
}

function empty(candidate: ArchitecturalSpecCandidate, notes: string[], unresolved: string[]): RegisteredBuilding {
  return {
    schemaVersion: 'registered-building-1.0.0',
    kind: 'CANDIDATE',
    notCanonical: true,
    project: candidate.project,
    sourcePackageId: candidate.sourcePackageId,
    sourcePackageHash: candidate.sourcePackageHash,
    frame: { id: 'BUILDING', originFrom: 'none', axes: 'plan-right is +X, plan-down is +Z, up is +Y, metres', note: 'no frame was established' },
    registrations: [],
    storeyEnvelopes: [],
    masses: [],
    walls: [],
    rooms: [],
    slabs: [],
    roofs: [],
    glazing: [],
    levels: candidate.shell?.levels ?? [],
    flights: [],
    voids: [],
    checks: [],
    unplaced: [],
    unresolved,
    notes,
  }
}

function unresolvedRegistration(
  sourceFrameId: string,
  kind: SourceFrameRegistration['kind'],
  why: string,
): SourceFrameRegistration {
  return {
    sourceFrameId,
    targetFrameId: 'BUILDING',
    kind,
    rotation90: 0,
    mirrorX: false,
    scaleX: 1,
    scaleZ: 1,
    translateX: 0,
    translateZ: 0,
    alongAxis: null,
    alongDirection: null,
    residualM: null,
    matched: 0,
    evidenceRefs: [],
    evidence: [],
    status: 'UNRESOLVED',
    why,
  }
}

// ---------------------------------------------------------------- §5: storey onto storey

/**
 * One plan storey onto the frame, as a quarter-turn, a mirror and a shift.
 *
 * All eight rigid placements are tried and the one the most wall material
 * agrees with wins. The identity is preferred only to break a tie: a set of
 * plans is normally laid out the same way up, but "normally" is not evidence
 * and does not outvote the walls.
 */
function registerStorey(
  storey: CandidateStorey,
  fabric: StoreyFabric,
  primaryFaces: readonly Face[],
  toleranceM: number,
  opts: RegisterOptions,
  primaryStorey: string,
): SourceFrameRegistration {
  const own = facesOf(fabric)
  type Trial = {
    rotation90: 0 | 1 | 2 | 3
    mirrorX: boolean
    x: AxisFit | null
    z: AxisFit | null
    score: number
  }
  const trials: Trial[] = []
  for (const rotation90 of [0, 1, 2, 3] as const) {
    for (const mirrorX of [false, true]) {
      const turned = own.map((f) => turnFace(f, rotation90, mirrorX))
      const movingX = turned.filter((f) => f.faceAxis === 'X')
      const movingZ = turned.filter((f) => f.faceAxis === 'Z')
      const fixedX = primaryFaces.filter((f) => f.faceAxis === 'X')
      const fixedZ = primaryFaces.filter((f) => f.faceAxis === 'Z')
      // An X face's extent runs along Z and the other way about, so each pass
      // needs the other axis's answer. First without overlap, then with it.
      const roughX = fitAxis(movingX, fixedX, toleranceM, 0, false)
      const roughZ = fitAxis(movingZ, fixedZ, toleranceM, 0, false)
      const x = fitAxis(movingX, fixedX, toleranceM, roughZ?.translate ?? 0, true)
      const z = fitAxis(movingZ, fixedZ, toleranceM, x?.translate ?? roughX?.translate ?? 0, true)
      trials.push({ rotation90, mirrorX, x, z, score: (x?.score ?? 0) + (z?.score ?? 0) })
    }
  }
  trials.sort((a, b) => {
    if (Math.abs(a.score - b.score) > 1e-6) return b.score - a.score
    const plain = (t: Trial): number => (t.rotation90 === 0 ? 0 : 1) + (t.mirrorX ? 1 : 0)
    return plain(a) - plain(b)
  })
  const best = trials[0]
  const runner = trials[1]
  const matched = (best.x?.matched ?? 0) + (best.z?.matched ?? 0)
  const evidence = [{ assetId: storey.assetId, role: 'PLAN', locator: 'the structural wall faces' }]
  if (!best.x || !best.z || matched < opts.minMatches) {
    return {
      ...unresolvedRegistration(`PLAN:${storey.storey}`, 'PLAN', ''),
      evidence,
      matched,
      why:
        `only ${matched} wall faces agree with ${primaryStorey} in the best of the eight rigid placements, ` +
        `fewer than the ${opts.minMatches} this pipeline requires before a placement is more than a coincidence`,
    }
  }
  const residualM = Math.sqrt(
    ((best.x.residualM ** 2) * best.x.matched + (best.z.residualM ** 2) * best.z.matched) / matched,
  )
  const margin = runner && runner.score > 0 ? best.score / runner.score : Infinity
  return {
    sourceFrameId: `PLAN:${storey.storey}`,
    targetFrameId: 'BUILDING',
    kind: 'PLAN',
    rotation90: best.rotation90,
    mirrorX: best.mirrorX,
    scaleX: 1,
    scaleZ: 1,
    translateX: best.x.translate,
    translateZ: best.z.translate,
    alongAxis: null,
    alongDirection: null,
    residualM,
    matched,
    evidenceRefs: [storey.assetId],
    evidence,
    status: 'RESOLVED',
    why:
      `${matched} wall faces agree with ${primaryStorey} at ${(residualM * 1000).toFixed(0)} mm rms after a ` +
      `${best.rotation90 * 90}° turn${best.mirrorX ? ', mirrored,' : ''} and a shift of ` +
      `(${best.x.translate.toFixed(3)}, ${best.z.translate.toFixed(3)}) m; the next best of the eight placements ` +
      `scores ${Number.isFinite(margin) ? `${(1 / margin * 100).toFixed(0)}% of it` : 'nothing'}`,
  }
}

// ---------------------------------------------------------------- §9: the vertical

type Band = { baseM: number; topM: number; topSettled: boolean; why: string }

/**
 * Where each storey starts and stops.
 *
 * The floor levels the section settled, in order, are the storey floors. A
 * storey's top is the next floor up; the topmost storey's top is its knee
 * wall where a source states one, and the eave where none does — which is a
 * statement about the roof and not about the wall, so it is carried as
 * unsettled rather than as a measurement.
 */
function storeyBands(storeys: readonly CandidateStorey[], levels: readonly CandidateLevel[]): Map<string, Band> {
  const out = new Map<string, Band>()
  const floors = levels
    .filter((l) => l.role === 'GROUND_ZERO' || l.role === 'STOREY_FLOOR')
    .map((l) => l.level.valueM)
    .sort((a, b) => a - b)
  const knee = levels.find((l) => l.role === 'KNEE_WALL_TOP')?.level.valueM ?? null
  const eave = levels.find((l) => l.role === 'EAVE')?.level.valueM ?? null
  for (let i = 0; i < storeys.length; i++) {
    const baseM = floors[i] ?? (floors.length > 0 ? floors[floors.length - 1] : 0)
    const next = floors[i + 1]
    if (next !== undefined) {
      out.set(storeys[i].storey, {
        baseM,
        topM: next,
        topSettled: true,
        why: `from the floor level at ${baseM.toFixed(3)} m to the floor above it at ${next.toFixed(3)} m`,
      })
      continue
    }
    if (knee !== null) {
      out.set(storeys[i].storey, {
        baseM,
        topM: knee,
        topSettled: true,
        why: `from ${baseM.toFixed(3)} m to the knee wall at ${knee.toFixed(3)} m`,
      })
      continue
    }
    const topM = eave ?? baseM
    out.set(storeys[i].storey, {
      baseM,
      topM,
      topSettled: false,
      why:
        `from ${baseM.toFixed(3)} m to the eave at ${topM.toFixed(3)} m, because no source states a knee-wall top ` +
        'for this storey — where the wall actually stops is not settled',
    })
  }
  return out
}

// ---------------------------------------------------------------- §4, §8: walls

function placeWalls(
  storeys: readonly CandidateStorey[],
  fabrics: Map<string, StoreyFabric>,
  byStorey: Map<string, SourceFrameRegistration>,
  bands: Map<string, Band>,
): RegisteredWall[] {
  const out: RegisteredWall[] = []
  for (const s of storeys) {
    const fabric = fabrics.get(s.storey)
    const reg = byStorey.get(s.storey)
    const band = bands.get(s.storey)
    if (!fabric || !reg || reg.status === 'UNRESOLVED' || !band) continue
    const openingsByWall = new Map(s.walls.map((w) => [w.id, w.openings]))
    for (const run of fabric.runs) {
      if (run.role === 'OUTSIDE_MASS' || run.role === 'LINE_ONLY' || run.fabric.length === 0) continue
      const placed = placeRun(reg, run)
      const openings = (openingsByWall.get(run.wallId) ?? [])
        .map((o) => {
          const a = placeAlong(reg, run.axis, o.fromM)
          const b = placeAlong(reg, run.axis, o.toM)
          return {
            fromM: Math.min(a, b),
            toM: Math.max(a, b),
            class: o.class,
            kind: o.kind,
            sillM: null as number | null,
            headM: null as number | null,
            levelsFrom: null as string | null,
            why: o.why,
          }
        })
        .filter((o) => o.toM > o.fromM)
      out.push({
        id: run.wallId,
        storey: s.storey,
        role: run.role,
        axis: placed.axis,
        nearM: placed.nearM,
        farM: placed.farM,
        thicknessM: run.thicknessM,
        fabric: placed.fabric,
        openings,
        baseM: band.baseM,
        topM: band.topM,
        topSettled: band.topSettled,
        massId: null,
        why: run.why,
      })
    }
  }
  return out
}

/** One measurement along a run's own axis, placed. */
function placeAlong(reg: SourceFrameRegistration, sourceAxis: 'X' | 'Z', value: number): number {
  const { axis, direction } = placedAxis(reg, sourceAxis)
  return direction * value + (axis === 'X' ? reg.translateX : reg.translateZ)
}

function placeRun(
  reg: SourceFrameRegistration,
  run: ClassifiedRun,
): { axis: 'X' | 'Z'; nearM: number; farM: number; fabric: Array<{ fromM: number; toM: number }> } {
  const along = placedAxis(reg, run.axis)
  const acrossSource: 'X' | 'Z' = run.axis === 'X' ? 'Z' : 'X'
  const across = placedAxis(reg, acrossSource)
  const a = across.direction * run.nearM + (across.axis === 'X' ? reg.translateX : reg.translateZ)
  const b = across.direction * run.farM + (across.axis === 'X' ? reg.translateX : reg.translateZ)
  const fabric = run.fabric
    .map((f) => {
      const p = along.direction * f.fromM + (along.axis === 'X' ? reg.translateX : reg.translateZ)
      const q = along.direction * f.toM + (along.axis === 'X' ? reg.translateX : reg.translateZ)
      return { fromM: Math.min(p, q), toM: Math.max(p, q) }
    })
    .sort((m, n) => m.fromM - n.fromM)
  return { axis: along.axis, nearM: Math.min(a, b), farM: Math.max(a, b), fabric }
}

function placeRooms(
  storeys: readonly CandidateStorey[],
  byStorey: Map<string, SourceFrameRegistration>,
  bands: Map<string, Band>,
  envelopes: Map<string, Rect | null>,
): RegisteredRoom[] {
  const out: RegisteredRoom[] = []
  for (const s of storeys) {
    const reg = byStorey.get(s.storey)
    const band = bands.get(s.storey)
    if (!reg || reg.status === 'UNRESOLVED' || !band) continue
    const envelope = envelopes.get(s.storey) ?? null
    for (const r of s.rooms) {
      const box = placeRect(reg, r.box)
      let clippedCells = 0
      let filled = r.footprint.filled
      if (envelope) {
        const cells = filled.split('')
        for (let row = 0; row < r.footprint.rows; row++) {
          for (let col = 0; col < r.footprint.cols; col++) {
            const i = row * r.footprint.cols + col
            if (cells[i] !== '1') continue
            const x = box.x0 + (col + 0.5) * r.footprint.cellM
            const z = box.z0 + (row + 0.5) * r.footprint.cellM
            if (x >= envelope.x0 && x <= envelope.x1 && z >= envelope.z0 && z <= envelope.z1) continue
            cells[i] = '0'
            clippedCells++
          }
        }
        filled = cells.join('')
      }
      out.push({
        id: r.id,
        storey: s.storey,
        box,
        areaM2: r.areaM2,
        labelsInside: r.labelsInside,
        segmentation: r.segmentation,
        footprint: { ...r.footprint, filled },
        floorM: band.baseM,
        clippedCells,
      })
    }
  }
  return out
}

// ---------------------------------------------------------------- §10: masses

/**
 * The footprint, divided by what stands on it.
 *
 * A mass is a part of the plan with its own stack of storeys: the part two
 * storeys stand on is one, and the part only the ground storey stands on —
 * a garage, a single-storey wing — is another. That division is what lets a
 * roof be given something to sit on, and it is read off the storeys rather
 * than off a list of what garages look like.
 *
 * Terraces, balconies and steps are not here at all: §4 removed them before
 * any envelope was taken, which is the whole point of doing it first.
 */
function massesOf(
  storeyEnvelopes: ReadonlyArray<{ storey: string; envelope: Rect | null; baseM: number; topM: number; topSettled: boolean }>,
  walls: readonly RegisteredWall[],
  rooms: readonly RegisteredRoom[],
): BuildingMass[] {
  const placed = storeyEnvelopes.filter((s): s is typeof s & { envelope: Rect } => s.envelope !== null)
  if (placed.length === 0) return []
  const base = [...placed].sort((a, b) => a.baseM - b.baseM)[0]
  const top = [...placed].sort((a, b) => b.baseM - a.baseM)[0]
  const stack = placed.reduce<Rect | null>((acc, s) => (acc === null ? s.envelope : rectIntersect(acc, s.envelope)), null)
  const masses: BuildingMass[] = []
  const allStoreys = placed.map((s) => s.storey)

  if (placed.length === 1 || stack === null || rectArea(stack) <= 0) {
    masses.push({
      id: 'mass0',
      role: 'PRIMARY',
      footprint: base.envelope,
      storeys: [base.storey],
      baseM: base.baseM,
      topM: base.topM,
      topSettled: base.topSettled,
      why: 'one storey published an envelope, so the whole footprint is one mass',
    })
    return masses
  }

  masses.push({
    id: 'mass0',
    role: 'PRIMARY',
    footprint: stack,
    storeys: allStoreys,
    baseM: base.baseM,
    topM: top.topM,
    topSettled: top.topSettled,
    why: `every storey stands here: ${allStoreys.join(', ')}`,
  })

  // What the base storey covers and the stack does not: up to four strips,
  // each shrunk onto the material actually standing in it.
  const strips: Rect[] = [
    { x0: base.envelope.x0, x1: stack.x0, z0: base.envelope.z0, z1: base.envelope.z1 },
    { x0: stack.x1, x1: base.envelope.x1, z0: base.envelope.z0, z1: base.envelope.z1 },
    { x0: stack.x0, x1: stack.x1, z0: base.envelope.z0, z1: stack.z0 },
    { x0: stack.x0, x1: stack.x1, z0: stack.z1, z1: base.envelope.z1 },
  ]
  let n = 1
  for (const strip of strips) {
    if (rectArea(strip) <= 0) continue
    const bounds = fabricBoundsIn(walls, base.storey, strip)
    if (!bounds || rectArea(bounds) < 1) continue
    // A wing is a part of the building people stand in. A stretch of wall
    // with no enclosed space behind it is a corner of the drawing, not a
    // mass, and giving it a roof is how a phantom gets one.
    const enclosed = rooms.some((r) => r.storey === base.storey && rectArea(rectIntersect(r.box, strip)) > 0.5 * rectArea(r.box))
    if (!enclosed) continue
    // Keep the edge the strip shares with the stack, so the masses tile.
    const footprint: Rect = {
      x0: strip.x0 === stack.x1 ? strip.x0 : Math.max(strip.x0, bounds.x0),
      x1: strip.x1 === stack.x0 ? strip.x1 : Math.min(strip.x1, bounds.x1),
      z0: strip.z0 === stack.z1 ? strip.z0 : Math.max(strip.z0, bounds.z0),
      z1: strip.z1 === stack.z0 ? strip.z1 : Math.min(strip.z1, bounds.z1),
    }
    if (rectArea(footprint) < 1) continue
    masses.push({
      id: `mass${n++}`,
      role: 'WING',
      footprint,
      storeys: [base.storey],
      baseM: base.baseM,
      topM: base.topM,
      topSettled: base.topSettled,
      why: `only ${base.storey} stands here, so it is a wing of the primary mass and not part of it`,
    })
  }
  return masses
}

/** The extent of one storey's material inside a rectangle. */
function fabricBoundsIn(walls: readonly RegisteredWall[], storey: string, rect: Rect): Rect | null {
  let x0 = Infinity
  let x1 = -Infinity
  let z0 = Infinity
  let z1 = -Infinity
  let seen = false
  for (const w of walls) {
    if (w.storey !== storey) continue
    for (const f of w.fabric) {
      const box: Rect =
        w.axis === 'X'
          ? { x0: f.fromM, x1: f.toM, z0: w.nearM, z1: w.farM }
          : { x0: w.nearM, x1: w.farM, z0: f.fromM, z1: f.toM }
      const hit = rectIntersect(box, rect)
      if (hit.x1 - hit.x0 <= 0 || hit.z1 - hit.z0 <= 0) continue
      seen = true
      x0 = Math.min(x0, box.x0)
      x1 = Math.max(x1, box.x1)
      z0 = Math.min(z0, box.z0)
      z1 = Math.max(z1, box.z1)
    }
  }
  return seen ? { x0, z0, x1, z1 } : null
}

function assignMasses(walls: RegisteredWall[], masses: readonly BuildingMass[]): void {
  for (const w of walls) {
    const across = (w.nearM + w.farM) / 2
    const alongMid = w.fabric.length > 0 ? (w.fabric[0].fromM + w.fabric[w.fabric.length - 1].toM) / 2 : 0
    const point = w.axis === 'X' ? { x: alongMid, z: across } : { x: across, z: alongMid }
    let best: { id: string; d: number } | null = null
    for (const m of masses) {
      const dx = Math.max(m.footprint.x0 - point.x, 0, point.x - m.footprint.x1)
      const dz = Math.max(m.footprint.z0 - point.z, 0, point.z - m.footprint.z1)
      const d = Math.hypot(dx, dz)
      if (!best || d < best.d) best = { id: m.id, d }
    }
    w.massId = best ? best.id : null
  }
}

// ---------------------------------------------------------------- §6: the section

/** One measurement along the section's own horizontal coordinate, placed. */
export function placeSectionAlong(reg: SourceFrameRegistration, value: number): number {
  const direction = reg.alongDirection ?? 1
  const shift = reg.alongAxis === 'Z' ? reg.translateZ : reg.translateX
  return direction * value + shift
}

/**
 * The section's own horizontal coordinate, onto the axis it cuts across.
 *
 * A section is a cut, and every place its drawn fabric begins or ends is a
 * wall face seen edge-on. Those ends are matched against the plan's wall
 * faces the same way one storey is matched against another: every pairing
 * proposes an offset, the material votes, and the axis and direction that win
 * are the axis and direction the cut runs along.
 *
 * This is where §6's requirement that the roof stop being in section-local X
 * is met. Until it is met the roof is not placed at all.
 */
function registerSection(
  candidate: ArchitecturalSpecCandidate,
  walls: readonly RegisteredWall[],
  masses: readonly BuildingMass[],
  toleranceM: number,
): SourceFrameRegistration | null {
  const shell = candidate.shell
  if (!shell || shell.section.assetId === null) return null
  const assetId = shell.section.assetId
  const edges: Face[] = []
  const add = (fromM: number, toM: number): void => {
    if (!Number.isFinite(fromM) || !Number.isFinite(toM) || toM <= fromM) return
    const weight = toM - fromM
    edges.push({ faceAxis: 'X', at: fromM, fromM: -Infinity, toM: Infinity, weight })
    edges.push({ faceAxis: 'X', at: toM, fromM: -Infinity, toM: Infinity, weight })
  }
  for (const s of shell.slabs) add(s.fromM, s.toM)
  for (const p of shell.roofPlanes) add(p.supportFromM, p.supportToM)
  if (edges.length === 0) {
    return {
      ...unresolvedRegistration('SECTION', 'SECTION', 'the section carries no slab or roof run whose ends could be matched to a wall face'),
      evidence: [{ assetId, role: 'SECTION', locator: 'the cut' }],
      evidenceRefs: [assetId],
    }
  }

  type Trial = { axis: 'X' | 'Z'; direction: 1 | -1; fit: AxisFit; throughM: number }
  const trials: Trial[] = []
  for (const axis of ['X', 'Z'] as const) {
    const fixed: Face[] = []
    for (const w of walls) {
      if (w.fabric.length === 0) continue
      const faceAxis: 'X' | 'Z' = w.axis === 'X' ? 'Z' : 'X'
      if (faceAxis !== axis) continue
      const weight = w.fabric.reduce((n, f) => n + (f.toM - f.fromM), 0)
      fixed.push({ faceAxis: axis, at: w.nearM, fromM: -Infinity, toM: Infinity, weight })
      fixed.push({ faceAxis: axis, at: w.farM, fromM: -Infinity, toM: Infinity, weight })
    }
    for (const direction of [1, -1] as const) {
      const moving = edges.map((e) => ({ ...e, faceAxis: axis, at: e.at * direction }))
      const fit = fitAxis(moving, fixed, toleranceM, 0, false)
      if (fit) trials.push({ axis, direction, fit, throughM: roofThroughStorey(shell, masses, axis, direction, fit.translate) })
    }
  }
  if (trials.length === 0) {
    return {
      ...unresolvedRegistration('SECTION', 'SECTION', 'no offset puts the section’s cut ends on any plan wall face'),
      evidence: [{ assetId, role: 'SECTION', locator: 'the cut' }],
      evidenceRefs: [assetId],
    }
  }
  // A house is nearly symmetric about its own cut, so both directions fit its
  // outer faces about equally well and the offset alone cannot choose between
  // them. What chooses is a fact about buildings: a roof does not pass through
  // the storey standing under it. The placement that leaves the least roof
  // below the walls it covers wins, and only where two are equally physical
  // does the closer fit decide.
  const step = 0.25
  trials.sort((a, b) => {
    const ta = Math.floor(a.throughM / step)
    const tb = Math.floor(b.throughM / step)
    if (ta !== tb) return ta - tb
    return b.fit.score - a.fit.score
  })
  const best = trials[0]
  const runner = trials.find((t) => t.axis !== best.axis || t.direction !== best.direction)
  return {
    sourceFrameId: 'SECTION',
    targetFrameId: 'BUILDING',
    kind: 'SECTION',
    rotation90: 0,
    mirrorX: best.direction === -1,
    scaleX: 1,
    scaleZ: 1,
    translateX: best.axis === 'X' ? best.fit.translate : 0,
    translateZ: best.axis === 'Z' ? best.fit.translate : 0,
    alongAxis: best.axis,
    alongDirection: best.direction,
    residualM: best.fit.residualM,
    matched: best.fit.matched,
    evidenceRefs: [assetId],
    evidence: [{ assetId, role: 'SECTION', locator: 'the ends of the slabs and roof runs the cut shows' }],
    status: 'RESOLVED',
    why:
      `${best.fit.matched} of the cut’s ends land on a plan wall face at ${(best.fit.residualM * 1000).toFixed(0)} mm ` +
      `rms when the section’s own coordinate runs ${best.direction > 0 ? 'with' : 'against'} the building’s ` +
      `${best.axis} and is shifted by ${best.fit.translate.toFixed(3)} m, leaving ` +
      `${(best.throughM * 1000).toFixed(0)} mm of roof below the storey it covers; the next placement, across ` +
      `${runner ? `${runner.axis} ${runner.direction > 0 ? 'forwards' : 'backwards'}, leaves ${(runner.throughM * 1000).toFixed(0)} mm` : 'nothing, is not available'}`,
  }
}

/**
 * How much roof a placement puts below the storey standing under it.
 *
 * Nothing in the offset separates the two directions a section can be read
 * in: a house is nearly symmetric about its own cut, so both fit its outer
 * faces. This does separate them, because a garage's flat roof belongs over
 * the part of the plan with nothing above it, and putting it over the
 * two-storey part buries it inside the first floor.
 */
function roofThroughStorey(
  shell: NonNullable<ArchitecturalSpecCandidate['shell']>,
  masses: readonly BuildingMass[],
  axis: 'X' | 'Z',
  direction: 1 | -1,
  translate: number,
): number {
  let through = 0
  for (const component of shell.roofComponents) {
    const planes = shell.roofPlanes.filter((p) => p.componentId === component.id)
    if (planes.length === 0) continue
    const ends = planes.flatMap((p) => [p.supportFromM, p.supportToM].map((v) => direction * v + translate))
    const host = pickMass(masses, axis, Math.min(...ends), Math.max(...ends))
    if (!host) {
      through += 10
      continue
    }
    through += Math.max(0, host.topM - Math.max(...planes.map((p) => p.ridgeLevel.valueM)))
  }
  return through
}

// ---------------------------------------------------------------- §7: the roof

/**
 * Every roof component, bounded to the mass it bears on.
 *
 * A section shows a roof's *profile*: two slopes and where they stop being
 * supported. It says nothing about the third dimension, and a plane drawn
 * from a profile alone is an infinite sheet — which is what the checkpoint
 * screenshots showed hanging over the garden.
 *
 * What bounds it is the mass underneath. The component's registered span
 * along the cut picks the mass; the mass then supplies the whole footprint,
 * because a roof covers what it sits on. Overhang stays null: the section
 * shows where the plane stops, not where the wall is, and §7 asks for
 * *source-supported* overhang or none.
 */
function placeRoofs(
  candidate: ArchitecturalSpecCandidate,
  sectionReg: SourceFrameRegistration | null,
  masses: readonly BuildingMass[],
  unplaced: Unplaced[],
  snapM: number,
): RegisteredRoof[] {
  const shell = candidate.shell
  if (!shell) return []
  const out: RegisteredRoof[] = []
  const cut = sectionReg?.alongAxis ?? null
  for (const component of shell.roofComponents) {
    const planes = shell.roofPlanes.filter((p) => p.componentId === component.id)
    if (!sectionReg || sectionReg.status === 'UNRESOLVED' || cut === null) {
      unplaced.push({
        id: component.id,
        kind: 'ROOF_COMPONENT',
        what: `the ${component.topology.toLowerCase()} roof the section cuts`,
        why: 'the section’s horizontal coordinate is not registered onto a building axis, so this roof has no place to be',
      })
      out.push({
        id: component.id,
        topology: component.topology,
        hostMassId: null,
        footprint: null,
        ridgeAxis: null,
        ridgeAtM: null,
        ridgeLevelM: null,
        eaveLevelM: null,
        planes: [],
        overhangM: null,
        status: 'UNRESOLVED',
        why: 'unregistered section frame',
      })
      continue
    }
    const spans = planes
      .map((p) => {
        const a = placeSectionAlong(sectionReg, p.supportFromM)
        const b = placeSectionAlong(sectionReg, p.supportToM)
        return { plane: p, lo: Math.min(a, b), hi: Math.max(a, b) }
      })
      .sort((a, b) => a.lo - b.lo)
    if (spans.length === 0) continue
    const lo = Math.min(...spans.map((s) => s.lo))
    const hi = Math.max(...spans.map((s) => s.hi))
    const host = pickMass(masses, cut, lo, hi)
    if (!host) {
      unplaced.push({
        id: component.id,
        kind: 'ROOF_COMPONENT',
        what: `the ${component.topology.toLowerCase()} roof the section cuts at ${lo.toFixed(2)}..${hi.toFixed(2)} m`,
        why: 'its registered span overlaps no mass, so there is nothing for it to bear on',
      })
      continue
    }
    out.push(buildRoof(component.id, component.topology, host, cut, spans, snapM))
  }
  return out
}

function pickMass(masses: readonly BuildingMass[], axis: 'X' | 'Z', lo: number, hi: number): BuildingMass | null {
  let best: { mass: BuildingMass; overlap: number } | null = null
  for (const m of masses) {
    const a = axis === 'X' ? m.footprint.x0 : m.footprint.z0
    const b = axis === 'X' ? m.footprint.x1 : m.footprint.z1
    const overlap = Math.min(hi, b) - Math.max(lo, a)
    if (overlap <= 0) continue
    if (!best || overlap > best.overlap) best = { mass: m, overlap }
  }
  return best ? best.mass : null
}

type PlaneSpan = { plane: ArchitecturalSpecCandidate['shell'] extends null ? never : NonNullable<ArchitecturalSpecCandidate['shell']>['roofPlanes'][number]; lo: number; hi: number }

function buildRoof(
  id: string,
  topology: string,
  host: BuildingMass,
  cut: 'X' | 'Z',
  spans: PlaneSpan[],
  snapM: number,
): RegisteredRoof {
  const massFaceLo = cut === 'X' ? host.footprint.x0 : host.footprint.z0
  const massFaceHi = cut === 'X' ? host.footprint.x1 : host.footprint.z1
  // The section shows where a plane stops being supported, not where the wall
  // is, and the two are a registration residual apart. Where they are that
  // close, the plane belongs on the wall. Where they are metres apart the
  // section is cutting a roof that does not cover the whole mass, and
  // stretching it to the mass face would invent a roof and flatten its pitch.
  const supportLo = Math.min(...spans.map((s) => s.lo))
  const supportHi = Math.max(...spans.map((s) => s.hi))
  const massLo = Math.abs(supportLo - massFaceLo) <= snapM ? massFaceLo : supportLo
  const massHi = Math.abs(supportHi - massFaceHi) <= snapM ? massFaceHi : supportHi
  const pitched = spans.filter((s) => s.plane.fallsTowards !== 'LEVEL')
  const ridgeLevelM = pitched.length > 0 ? Math.max(...pitched.map((s) => s.plane.ridgeLevel.valueM)) : null
  const eaveLevelM = pitched.length > 0 ? Math.min(...pitched.map((s) => s.plane.eaveLevel.valueM)) : null

  // Where the slopes meet. Each plane reaches the ridge a run from its own
  // eave, and the run is the rise over the tangent of the pitch it was fitted
  // at — the section's own numbers, not a symmetry assumption.
  const ridgeVotes: number[] = []
  for (const s of pitched) {
    const pitchDeg = s.plane.pitch.pitchDeg
    const rise = s.plane.ridgeLevel.valueM - s.plane.eaveLevel.valueM
    if (pitchDeg === null || !Number.isFinite(pitchDeg) || pitchDeg <= 0 || pitchDeg >= 90 || rise <= 0) continue
    const run = rise / Math.tan((pitchDeg * Math.PI) / 180)
    // `fallsTowards` is stated in the section's own left-to-right sense; the
    // registered span already carries which way that is in the building.
    ridgeVotes.push(s.plane.fallsTowards === 'LEFT' ? s.lo + run : s.hi - run)
  }
  const ridgeAtM = ridgeVotes.length > 0 ? ridgeVotes.reduce((a, b) => a + b, 0) / ridgeVotes.length : null
  const ridgeAxis: 'X' | 'Z' | null = pitched.length > 0 ? (cut === 'X' ? 'Z' : 'X') : null

  const coverage: Rect =
    cut === 'X'
      ? { x0: massLo, x1: massHi, z0: host.footprint.z0, z1: host.footprint.z1 }
      : { x0: host.footprint.x0, x1: host.footprint.x1, z0: massLo, z1: massHi }
  const planes: RegisteredRoofPlane[] = []
  if (pitched.length >= 2 && ridgeAtM !== null && ridgeLevelM !== null && eaveLevelM !== null) {
    const clampedRidge = Math.min(Math.max(ridgeAtM, massLo), massHi)
    for (const s of pitched) {
      const low = s.plane.fallsTowards === 'LEFT' ? massLo : clampedRidge
      const high = s.plane.fallsTowards === 'LEFT' ? clampedRidge : massHi
      const footprint: Rect =
        cut === 'X'
          ? { x0: low, x1: high, z0: host.footprint.z0, z1: host.footprint.z1 }
          : { x0: host.footprint.x0, x1: host.footprint.x1, z0: low, z1: high }
      const run = high - low
      const rise = s.plane.ridgeLevel.valueM - s.plane.eaveLevel.valueM
      planes.push({
        id: s.plane.id,
        componentId: id,
        footprint,
        fallAxis: cut,
        fallDirection: s.plane.fallsTowards === 'LEFT' ? -1 : 1,
        highLevelM: s.plane.ridgeLevel.valueM,
        lowLevelM: s.plane.eaveLevel.valueM,
        thicknessM: s.plane.thickness?.valueM ?? null,
        statedPitchDeg: s.plane.pitch.pitchDeg,
        impliedPitchDeg: run > 0 ? (Math.atan(rise / run) * 180) / Math.PI : null,
        status: 'RESOLVED',
        why: `bounded to ${host.id}, from its eave at the mass face to the ridge the section's own pitch puts at ${clampedRidge.toFixed(3)} m`,
      })
    }
  } else {
    for (const s of spans) {
      const level = s.plane.ridgeLevel.valueM
      planes.push({
        id: s.plane.id,
        componentId: id,
        footprint: coverage,
        fallAxis: null,
        fallDirection: 0,
        highLevelM: level,
        lowLevelM: s.plane.eaveLevel.valueM,
        thicknessM: s.plane.thickness?.valueM ?? null,
        statedPitchDeg: s.plane.pitch.pitchDeg,
        impliedPitchDeg: null,
        status: s.plane.fallsTowards === 'LEVEL' ? 'RESOLVED' : 'PARTLY_UNRESOLVED',
        why:
          s.plane.fallsTowards === 'LEVEL'
            ? `a level run, bounded to ${host.id}`
            : `only one sloping plane was fitted for this component, so where its ridge falls is not settled; it covers ${host.id}`,
      })
    }
  }

  return {
    id,
    topology,
    hostMassId: host.id,
    footprint: coverage,
    ridgeAxis,
    ridgeAtM: ridgeAtM === null ? null : Math.min(Math.max(ridgeAtM, massLo), massHi),
    ridgeLevelM,
    eaveLevelM,
    planes,
    overhangM: null,
    status: planes.some((p) => p.status !== 'RESOLVED') ? 'PARTLY_UNRESOLVED' : 'RESOLVED',
    why:
      `the section cuts this component at ${Math.min(...spans.map((s) => s.lo)).toFixed(2)}..` +
      `${Math.max(...spans.map((s) => s.hi)).toFixed(2)} m along the building's ${cut}, which lands on ${host.id}; ` +
      `the mass supplies the extent along the ridge; across the cut it runs ${massLo.toFixed(2)}..${massHi.toFixed(2)} m, ` +
      (massLo === massFaceLo && massHi === massFaceHi
        ? 'both ends on the mass faces it bears on'
        : 'where the section still shows it supported \u2014 stretching it to the mass would invent roof') +
      ', and the overhang stays unsettled',
  }
}

// ---------------------------------------------------------------- slabs, glazing, voids

function placeSlabs(candidate: ArchitecturalSpecCandidate, masses: readonly BuildingMass[]): RegisteredSlab[] {
  const shell = candidate.shell
  const out: RegisteredSlab[] = []
  const thicknessAt = (levelM: number): number | null => {
    const slab = shell?.slabs.find((s) => Math.abs(s.topLevel.valueM - levelM) < 0.05)
    return slab?.thickness?.valueM ?? null
  }
  let n = 0
  for (const mass of masses) {
    out.push({
      id: `slab${n++}`,
      levelM: mass.baseM,
      footprint: mass.footprint,
      massId: mass.id,
      thicknessM: thicknessAt(mass.baseM),
      why: `the ground slab of ${mass.id}, at the level its storey starts`,
    })
  }
  // A floor slab wherever a storey stands on another: its level is that
  // storey's own floor, and it covers the mass they share.
  const byLevel = new Map<string, number>()
  for (const level of candidate.shell?.levels ?? []) {
    if (level.role === 'STOREY_FLOOR') byLevel.set(level.id, level.level.valueM)
  }
  for (const mass of masses) {
    if (mass.storeys.length < 2) continue
    for (const levelM of [...byLevel.values()].sort((a, b) => a - b)) {
      if (levelM <= mass.baseM + 1e-6 || levelM >= mass.topM - 1e-6) continue
      out.push({
        id: `slab${n++}`,
        levelM,
        footprint: mass.footprint,
        massId: mass.id,
        thicknessM: thicknessAt(levelM),
        why: `the floor the upper storey of ${mass.id} stands on`,
      })
    }
  }
  return out
}

/**
 * The glazing the candidate placed itself.
 *
 * Only openings the candidate matched to a plan wall on its own evidence
 * reach three dimensions. An elevation opening with no plan match has a
 * height and no depth, and putting it on a guessed wall is exactly the
 * fabrication §11 forbids — so it stays unplaced and says why.
 */
function placeGlazing(candidate: ArchitecturalSpecCandidate, walls: readonly RegisteredWall[], unplaced: Unplaced[]): RegisteredGlazing[] {
  const shell = candidate.shell
  if (!shell) return []
  const wallById = new Map(walls.map((w) => [w.id, w]))
  const planOpenings = new Map<string, Array<{ fromM: number; toM: number }>>()
  for (const s of candidate.storeys) for (const w of s.walls) planOpenings.set(w.id, w.openings.map((o) => ({ fromM: o.fromM, toM: o.toM })))
  const out: RegisteredGlazing[] = []
  for (const fo of shell.facadeOpenings) {
    const match = fo.match
    if (!match) {
      unplaced.push({
        id: fo.id,
        kind: 'FACADE_OPENING',
        what: `${fo.view} opening ${fo.widthM.toFixed(2)} x ${fo.heightM.toFixed(2)} m at ${fo.sillLevelM.toFixed(2)} m`,
        why: 'no plan wall was matched to it, so nothing says which wall it is in or how deep that wall is',
      })
      continue
    }
    const wall = wallById.get(match.planWallId)
    const plan = planOpenings.get(match.planWallId)?.[match.planOpeningIndex]
    if (!wall || !plan) {
      unplaced.push({
        id: fo.id,
        kind: 'FACADE_OPENING',
        what: `${fo.view} opening matched to ${match.planWallId}`,
        why: wall
          ? 'the plan opening it was matched to is no longer there'
          : 'the plan wall it was matched to is not part of the registered building',
      })
      continue
    }
    const hit = wall.openings
      .map((o) => ({ o, d: Math.abs(o.toM - o.fromM - (plan.toM - plan.fromM)) }))
      .sort((a, b) => a.d - b.d)[0]
    if (!hit) continue
    // The elevation measured a head and a sill for this gap. Telling the wall
    // means the wall keeps its lintel and its spandrel instead of being cut
    // from floor to ceiling, and it is the elevation saying so, not a guess.
    hit.o.sillM = fo.sillLevelM
    hit.o.headM = fo.headLevelM
    hit.o.levelsFrom = fo.view
    out.push({
      id: fo.id,
      wallId: wall.id,
      storey: wall.storey,
      axis: wall.axis,
      fromM: hit.o.fromM,
      toM: hit.o.toM,
      nearM: wall.nearM,
      farM: wall.farM,
      sillM: fo.sillLevelM,
      headM: fo.headLevelM,
      view: fo.view,
      why: `the ${fo.view} elevation's opening, matched to ${match.planWallId} at ${(match.residualM * 1000).toFixed(0)} mm`,
    })
  }
  for (const ro of shell.roofOpenings) {
    unplaced.push({
      id: ro.id,
      kind: 'ROOF_OPENING',
      what: 'a rooflight seen on one elevation',
      why: ro.why,
    })
  }
  for (const c of shell.chimneys) {
    if (c.planFootprint === null) unplaced.push({ id: c.id, kind: 'CHIMNEY', what: 'a stack seen on an elevation', why: c.why })
  }
  for (const f of shell.facadeFeatures) {
    if (f.depth === null) unplaced.push({ id: f.id, kind: f.kind, what: `a ${f.kind.toLowerCase().replace(/_/g, ' ')} on ${f.view}`, why: f.why })
  }
  return out
}

/** Every storey's tread clusters, in the building's frame. */
function placedFlights(
  storeys: readonly CandidateStorey[],
  fabrics: Map<string, StoreyFabric>,
  byStorey: Map<string, SourceFrameRegistration>,
): Array<{ storey: string; rect: Rect }> {
  const out: Array<{ storey: string; rect: Rect }> = []
  for (const s of storeys) {
    const reg = byStorey.get(s.storey)
    const fabric = fabrics.get(s.storey)
    if (!reg || reg.status === 'UNRESOLVED' || !fabric) continue
    for (const f of fabric.flights) out.push({ storey: s.storey, rect: placeRect(reg, f) })
  }
  return out
}

/**
 * A hole in a floor is a hole two storeys agree about.
 *
 * One storey's run of parallel lines could be a flight or a tiled floor.
 * Where the storey below draws a flight in the same place, the two together
 * are a stair through the floor between them. Where they do not, nothing is
 * cut: §11 leaves what is unresolved unresolved rather than putting a hole
 * where a bathroom is.
 */
function agreedVoids(
  storeys: readonly CandidateStorey[],
  fabrics: Map<string, StoreyFabric>,
  byStorey: Map<string, SourceFrameRegistration>,
): Rect[] {
  const placed = storeys
    .map((s) => {
      const reg = byStorey.get(s.storey)
      const fabric = fabrics.get(s.storey)
      if (!reg || reg.status === 'UNRESOLVED' || !fabric) return null
      return { storey: s.storey, flights: fabric.flights.map((f) => placeRect(reg, f)) }
    })
    .filter((x): x is { storey: string; flights: Rect[] } => x !== null)
  const out: Rect[] = []
  for (let i = 1; i < placed.length; i++) {
    for (const above of placed[i].flights) {
      for (const below of placed[i - 1].flights) {
        const hit = rectIntersect(above, below)
        const area = rectArea(hit)
        if (area <= 0) continue
        if (area < 0.3 * Math.min(rectArea(above), rectArea(below))) continue
        out.push(hit)
      }
    }
  }
  return out
}

// ---------------------------------------------------------------- §12: the hard oracles

type CheckInput = {
  masses: readonly BuildingMass[]
  walls: readonly RegisteredWall[]
  roofs: readonly RegisteredRoof[]
  slabs: readonly RegisteredSlab[]
  storeyEnvelopes: ReadonlyArray<{ storey: string; envelope: Rect | null; baseM: number; topM: number; topSettled: boolean }>
  registrations: readonly SourceFrameRegistration[]
  rooms: readonly RegisteredRoom[]
  flights: ReadonlyArray<{ storey: string; rect: Rect }>
  voids: readonly Rect[]
}

/**
 * The checks that would have failed the checkpoint screenshots.
 *
 * Each is measured rather than asserted: a reader is told the number and the
 * tolerance it was compared against, so a PASS can be disbelieved and a FAIL
 * can be understood. A check with nothing to measure is `UNRESOLVED`, which
 * is not a pass.
 */
export function runChecks(
  input: CheckInput,
  toleranceM: number,
  candidate: ArchitecturalSpecCandidate,
  fabrics: Map<string, StoreyFabric>,
): CoherenceCheck[] {
  const out: CoherenceCheck[] = []
  const say = (
    id: string,
    title: string,
    status: CoherenceCheck['status'],
    measured: string,
    tol: number | null = null,
  ): void => {
    out.push({ id, title, status, measured, toleranceM: tol })
  }

  // Every frame that reaches three dimensions is registered.
  const used = input.registrations.filter((r) => r.kind === 'PLAN' || r.kind === 'SECTION')
  const unresolvedFrames = used.filter((r) => r.status === 'UNRESOLVED')
  say(
    'frames-registered',
    'every source frame used in 3D has a resolved registration',
    unresolvedFrames.length === 0 ? 'PASS' : 'FAIL',
    unresolvedFrames.length === 0
      ? `${used.length} frames, all resolved`
      : `${unresolvedFrames.length} of ${used.length} unresolved: ${unresolvedFrames.map((r) => r.sourceFrameId).join(', ')}`,
  )

  // No storey sits at an unexplained offset from the one below it.
  const placed = input.storeyEnvelopes.filter((s): s is typeof s & { envelope: Rect } => s.envelope !== null)
  if (placed.length >= 2) {
    const base = placed[0].envelope
    const worst = placed
      .slice(1)
      .map((s) => ({
        storey: s.storey,
        slack: Math.max(
          base.x0 - s.envelope.x0,
          s.envelope.x1 - base.x1,
          base.z0 - s.envelope.z0,
          s.envelope.z1 - base.z1,
        ),
      }))
      .sort((a, b) => b.slack - a.slack)[0]
    say(
      'storeys-stack',
      'every storey stands inside the one below it',
      worst.slack <= toleranceM ? 'PASS' : 'FAIL',
      `${worst.storey} oversteps by ${(worst.slack * 1000).toFixed(0)} mm`,
      toleranceM,
    )
    const centroid = (r: Rect): { x: number; z: number } => ({ x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 })
    const a = centroid(base)
    const b = centroid(placed[1].envelope)
    const shared = rectIntersect(base, placed[1].envelope)
    const sharedCentroid = centroid(shared)
    const drift = Math.hypot(b.x - sharedCentroid.x, b.z - sharedCentroid.z)
    void a
    say(
      'storey-centroids',
      'the upper storey is centred on the footprint it shares with the ground',
      rectArea(shared) > 0 && drift <= toleranceM ? 'PASS' : rectArea(shared) > 0 ? 'FAIL' : 'UNRESOLVED',
      rectArea(shared) > 0 ? `${(drift * 1000).toFixed(0)} mm` : 'the two storeys share no footprint at all',
      toleranceM,
    )
  } else {
    say('storeys-stack', 'every storey stands inside the one below it', 'UNRESOLVED', 'only one storey is registered')
    say('storey-centroids', 'the upper storey is centred on the footprint it shares with the ground', 'UNRESOLVED', 'only one storey is registered')
  }

  // A roof sits on a mass, covers it, and does not reach past it.
  const roofsPlaced = input.roofs.filter((r) => r.footprint !== null)
  if (roofsPlaced.length === 0) {
    say('roof-on-mass', 'every roof component bears on a mass', 'FAIL', 'no roof component was placed at all')
  } else {
    const strays = roofsPlaced.filter((r) => {
      const mass = input.masses.find((m) => m.id === r.hostMassId)
      return !mass || !rectContains(mass.footprint, r.footprint!, toleranceM)
    })
    say(
      'roof-on-mass',
      'every roof component bears on a mass and stays inside it',
      strays.length === 0 ? 'PASS' : 'FAIL',
      strays.length === 0
        ? `${roofsPlaced.length} components, each inside its host`
        : `${strays.map((r) => r.id).join(', ')} reach past their host`,
      toleranceM,
    )
    const pitched = roofsPlaced.filter((r) => r.ridgeAtM !== null && r.ridgeAxis !== null)
    if (pitched.length === 0) {
      say('ridge-on-axis', 'the ridge runs along the mass it covers', 'UNRESOLVED', 'no pitched component was placed')
    } else {
      const bad = pitched.filter((r) => {
        const mass = input.masses.find((m) => m.id === r.hostMassId)
        if (!mass) return true
        const alongRidge = r.ridgeAxis === 'X' ? mass.footprint.x1 - mass.footprint.x0 : mass.footprint.z1 - mass.footprint.z0
        const acrossRidge = r.ridgeAxis === 'X' ? mass.footprint.z1 - mass.footprint.z0 : mass.footprint.x1 - mass.footprint.x0
        return alongRidge < acrossRidge
      })
      say(
        'ridge-on-axis',
        'the ridge runs along its mass, not across it',
        bad.length === 0 ? 'PASS' : 'FAIL',
        bad.length === 0 ? `${pitched.length} pitched components` : `${bad.map((r) => r.id).join(', ')} run across`,
      )
      // The ridge is derived from the section's own pitch and eave, so it
      // lands where the section puts it — but the eave is then snapped onto
      // the wall it bears on where the two are within a registration
      // residual. This is the check that the snap did not distort the roof:
      // each slope's geometry has to still work out at the pitch the sources
      // state. A registration offset that is wrong by half a metre shows up
      // here as a degree or two of pitch that nobody printed.
      const pitches = pitched.flatMap((r) =>
        r.planes
          .filter((p) => p.impliedPitchDeg !== null && p.statedPitchDeg !== null && Number.isFinite(p.statedPitchDeg))
          .map((p) => ({ id: p.id, d: Math.abs(p.impliedPitchDeg! - p.statedPitchDeg!) })),
      )
      if (pitches.length === 0) {
        say('pitch-agrees', 'each slope works out at the pitch the sources state', 'UNRESOLVED', 'no plane has both a stated and an implied pitch')
      } else {
        const worst = [...pitches].sort((a, b) => b.d - a.d)[0]
        say(
          'pitch-agrees',
          'each slope works out at the pitch the sources state',
          worst.d <= 2 ? 'PASS' : 'FAIL',
          `${worst.id} is ${worst.d.toFixed(2)}\u00b0 from the stated pitch`,
          null,
        )
      }
      const outside = pitched.filter((r) => {
        const mass = input.masses.find((m) => m.id === r.hostMassId)
        if (!mass) return true
        const lo = r.ridgeAxis === 'X' ? mass.footprint.z0 : mass.footprint.x0
        const hi = r.ridgeAxis === 'X' ? mass.footprint.z1 : mass.footprint.x1
        return r.ridgeAtM! < lo - toleranceM || r.ridgeAtM! > hi + toleranceM
      })
      say(
        'ridge-inside-mass',
        'the ridge falls inside the mass it covers',
        outside.length === 0 ? 'PASS' : 'FAIL',
        outside.length === 0 ? `${pitched.length} pitched components` : `${outside.map((r) => r.id).join(', ')} sit outside`,
        toleranceM,
      )
    }
  }

  // How much of each mass the section actually shows a roof over. Less than
  // all of it is not an error: it means the cut does not reach that far, and
  // inventing the rest is what §7 forbids.
  if (input.masses.length > 0 && roofsPlaced.length > 0) {
    const worst = input.masses
      .map((m) => {
        const covered = roofsPlaced
          .filter((r) => r.hostMassId === m.id)
          .reduce((n, r) => n + rectArea(rectIntersect(m.footprint, r.footprint!)), 0)
        return { id: m.id, share: rectArea(m.footprint) > 0 ? covered / rectArea(m.footprint) : 0 }
      })
      .sort((a, b) => a.share - b.share)[0]
    say(
      'roof-covers-mass',
      'the section shows a roof over the whole of every mass',
      worst.share >= 0.95 ? 'PASS' : 'UNRESOLVED',
      `${worst.id} is ${(worst.share * 100).toFixed(0)}% covered`,
      null,
    )
  }

  // No wall stands on its own with nothing to hold it up.
  const isolated = input.walls.filter((w) => {
    const length = w.fabric.reduce((n, f) => n + (f.toM - f.fromM), 0)
    if (length > w.thicknessM * 3) return false
    return !input.walls.some((o) => o !== w && touches(o, w, toleranceM))
  })
  say(
    'no-isolated-pillars',
    'no stub of wall stands with nothing touching it',
    isolated.length === 0 ? 'PASS' : 'FAIL',
    isolated.length === 0 ? `${input.walls.length} walls, none isolated` : `${isolated.length}: ${isolated.slice(0, 6).map((w) => w.id).join(', ')}`,
    toleranceM,
  )

  // The building is at least as big as the drawings say. A plan does not
  // always print an overall, but nothing it prints can be longer than the
  // building it is printed on: that is what a shrunk or clipped envelope
  // looks like from the outside.
  const envelope = input.masses.reduce<Rect | null>(
    (acc, m) => (acc === null ? m.footprint : { x0: Math.min(acc.x0, m.footprint.x0), z0: Math.min(acc.z0, m.footprint.z0), x1: Math.max(acc.x1, m.footprint.x1), z1: Math.max(acc.z1, m.footprint.z1) }),
    null,
  )
  const printed = printedExtents(candidate)
  if (envelope && (printed.X !== null || printed.Z !== null)) {
    const over: string[] = []
    const seen: string[] = []
    for (const axis of ['X', 'Z'] as const) {
      const value = printed[axis]
      if (value === null) continue
      const extent = axis === 'X' ? envelope.x1 - envelope.x0 : envelope.z1 - envelope.z0
      seen.push(`${axis} prints ${value.toFixed(2)} against ${extent.toFixed(2)} m`)
      if (value - extent > 0.3) over.push(`${axis} by ${((value - extent) * 1000).toFixed(0)} mm`)
    }
    say(
      'extent-vs-printed',
      'no dimension the plans print is longer than the building it is printed on',
      over.length === 0 ? 'PASS' : 'FAIL',
      over.length === 0 ? seen.join('; ') : `overrun: ${over.join(', ')}`,
      0.3,
    )
  } else {
    say('extent-vs-printed', 'no dimension the plans print is longer than the building it is printed on', 'UNRESOLVED', 'no dimension was read')
  }

  // Terraces, steps and balconies cannot move the origin, because a face with
  // nothing enclosed behind it is not a face of the building. Recomputed from
  // the candidate's own rooms, so it holds an envelope to account however the
  // envelope was arrived at.
  const loose: string[] = []
  let facesTested = 0
  for (const placedStorey of input.storeyEnvelopes) {
    const e = placedStorey.envelope
    if (!e) continue
    const fabric = fabrics.get(placedStorey.storey)
    const here = input.rooms.filter((r) => r.storey === placedStorey.storey)
    if (here.length === 0) continue
    const stairs = input.flights.filter((f) => f.storey === placedStorey.storey)
    const c = here[0].footprint.cellM
    const probe = {
      cellM: c,
      at: (x: number, z: number): string | null => {
        for (let i = 0; i < stairs.length; i++) {
          const f = stairs[i].rect
          if (x >= f.x0 && x <= f.x1 && z >= f.z0 && z <= f.z1) return `flight${i}`
        }
        for (const r of here) {
          if (x < r.box.x0 || x >= r.box.x1 || z < r.box.z0 || z >= r.box.z1) continue
          const col = Math.floor((x - r.box.x0) / r.footprint.cellM)
          const row = Math.floor((z - r.box.z0) / r.footprint.cellM)
          if (col < 0 || col >= r.footprint.cols || row < 0 || row >= r.footprint.rows) continue
          if (r.footprint.filled[row * r.footprint.cols + col] === '1') return r.id
        }
        return null
      },
    }
    const s = { storey: placedStorey.storey }
    // An envelope face is the *outer* face of a wall, so the enclosed space
    // behind it starts a wall's thickness in. Look that far and no further:
    // the point is that something is enclosed behind this line, not that
    // something is enclosed somewhere on the sheet.
    const reach = Math.max(c, ...(fabric?.runs ?? []).filter((r) => r.fabric.length > 0).map((r) => r.thicknessM)) + c
    const steps = Math.max(2, Math.ceil(reach / c))
    const inward: Array<{ name: string; hit: boolean }> = []
    const scan = (name: string, point: (t: number, depth: number) => { x: number; z: number }): void => {
      let hit = false
      for (let i = 0; i < 64 && !hit; i++) {
        for (let d = 1; d <= steps && !hit; d++) {
          const p = point((i + 0.5) / 64, d * c)
          if (probe.at(p.x, p.z) !== null) hit = true
        }
      }
      inward.push({ name, hit })
    }
    scan(`${s.storey} north`, (t, d) => ({ x: e.x0 + t * (e.x1 - e.x0), z: e.z0 + d }))
    scan(`${s.storey} south`, (t, d) => ({ x: e.x0 + t * (e.x1 - e.x0), z: e.z1 - d }))
    scan(`${s.storey} west`, (t, d) => ({ x: e.x0 + d, z: e.z0 + t * (e.z1 - e.z0) }))
    scan(`${s.storey} east`, (t, d) => ({ x: e.x1 - d, z: e.z0 + t * (e.z1 - e.z0) }))
    facesTested += inward.length
    for (const f of inward) if (!f.hit) loose.push(f.name)
  }
  say(
    'origin-from-structure',
    'every envelope face has the building behind it, so no terrace edge defines it',
    facesTested === 0 ? 'UNRESOLVED' : loose.length === 0 ? 'PASS' : 'FAIL',
    facesTested === 0
      ? 'no storey published an envelope'
      : loose.length === 0
        ? `${facesTested} envelope faces, each with rooms or a drawn flight behind it; ` +
          `${candidate.storeys.reduce((n, s) => n + s.walls.length, 0) - input.walls.length} of ` +
          `${candidate.storeys.reduce((n, s) => n + s.walls.length, 0)} runs were kept out of the building`
        : `nothing is enclosed behind ${loose.join(', ')}`,
  )

  // A doorway is a hole in the fabric, and fabric may not be drawn across it.
  const filled = input.walls.filter((w) =>
    w.openings.some((o) => w.fabric.some((f) => f.fromM < o.toM - 0.02 && f.toM > o.fromM + 0.02)),
  )
  say(
    'openings-stay-open',
    'no stretch of material is drawn across an opening',
    filled.length === 0 ? 'PASS' : 'FAIL',
    filled.length === 0
      ? `${input.walls.reduce((n, w) => n + w.openings.length, 0)} openings, none bridged`
      : `${filled.length}: ${filled.slice(0, 6).map((w) => w.id).join(', ')}`,
  )

  // A void is a hole, and a hole may not be where fabric is.
  if (input.voids.length === 0) {
    say('voids-clear-of-fabric', 'every floor opening is clear of the fabric around it', 'UNRESOLVED', 'no floor opening is settled by two storeys')
  } else {
    const clashes = input.voids.filter((v) =>
      input.walls.some((w) => {
        const box: Rect =
          w.axis === 'X'
            ? { x0: Math.min(...w.fabric.map((f) => f.fromM)), x1: Math.max(...w.fabric.map((f) => f.toM)), z0: w.nearM, z1: w.farM }
            : { x0: w.nearM, x1: w.farM, z0: Math.min(...w.fabric.map((f) => f.fromM)), z1: Math.max(...w.fabric.map((f) => f.toM)) }
        return rectArea(rectIntersect(box, v)) > 0.1 * rectArea(v)
      }),
    )
    say(
      'voids-clear-of-fabric',
      'every floor opening is clear of the fabric around it',
      clashes.length === 0 ? 'PASS' : 'FAIL',
      clashes.length === 0 ? `${input.voids.length} openings, none over a wall` : `${clashes.length} sit over a wall`,
    )
  }

  return out
}

const touches = (a: RegisteredWall, b: RegisteredWall, slackM: number): boolean => {
  const box = (w: RegisteredWall): Rect => {
    const lo = w.fabric.length > 0 ? Math.min(...w.fabric.map((f) => f.fromM)) : 0
    const hi = w.fabric.length > 0 ? Math.max(...w.fabric.map((f) => f.toM)) : 0
    return w.axis === 'X' ? { x0: lo, x1: hi, z0: w.nearM, z1: w.farM } : { x0: w.nearM, x1: w.farM, z0: lo, z1: hi }
  }
  const p = box(a)
  const q = box(b)
  return (
    p.x0 - slackM <= q.x1 && q.x0 - slackM <= p.x1 && p.z0 - slackM <= q.z1 && q.z0 - slackM <= p.z1 &&
    !(a.baseM >= b.topM || b.baseM >= a.topM)
  )
}

/**
 * The longest dimension each plan prints, per building axis.
 *
 * A dimension carries the axis it spans in its own owner field — the pipeline
 * recorded which way the chain it came from runs — so no geometry has to be
 * guessed to know which extent it should be compared against. A plan's own
 * sheet axes are the building's, since a plan registers without a turn on
 * every project this has been run on; where one does turn, the registration
 * carries it and this check is the one that notices.
 */
function printedExtents(candidate: ArchitecturalSpecCandidate): { X: number | null; Z: number | null } {
  let x: number | null = null
  let z: number | null = null
  for (const s of candidate.storeys) {
    for (const d of s.dimensions) {
      if (d.owner.startsWith('X span')) x = Math.max(x ?? 0, d.valueM)
      else if (d.owner.startsWith('Y span')) z = Math.max(z ?? 0, d.valueM)
    }
  }
  return { X: x, Z: z }
}

/**
 * The oracles, run again over a building somebody has changed.
 *
 * §16's mutations need to corrupt a registered building and watch a check go
 * red. Re-deriving the storey classification from the same candidate keeps the
 * oracles honest: they measure the building they are given against the
 * drawings, not against the assumptions that produced it.
 */
export function checkRegisteredBuilding(
  building: RegisteredBuilding,
  candidate: ArchitecturalSpecCandidate,
  opts: RegisterOptions = DEFAULT_REGISTER,
): CoherenceCheck[] {
  const fabrics = new Map<string, StoreyFabric>()
  for (const s of candidate.storeys) fabrics.set(s.storey, classifyStorey(s, opts.planMasses))
  const cellM =
    [...fabrics.values()].map((f) => f.occupancy?.cellM).find((c): c is number => c !== undefined) ?? 0.25
  return runChecks(
    {
      masses: building.masses,
      walls: building.walls,
      roofs: building.roofs,
      slabs: building.slabs,
      storeyEnvelopes: building.storeyEnvelopes,
      registrations: building.registrations,
      rooms: building.rooms,
      flights: building.flights,
      voids: building.voids,
    },
    cellM * opts.faceMatchCells,
    candidate,
    fabrics,
  )
}
