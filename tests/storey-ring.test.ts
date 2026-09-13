/**
 * STAGE WEB-PIVOT-01C — closed storey wall ring.
 *
 * Four walls, each stated only in its own frame, four explicitly owned corners,
 * two hosted openings. The question is not whether any one corner is right —
 * STAGE WEB-PIVOT-01B settled that — but whether four local decisions come out
 * globally consistent, and whether two different but equally valid ownership
 * schedules produce the same building.
 *
 * Every measurement below reads emitted triangles through the oracles in
 * `tests/geometry-oracles.ts`. No test asserts on a junction record, a compiled
 * extent, an ownership schedule or any other thing the compiler wrote down;
 * those appear only where the brief asks for a diagnostic by name.
 */
import { describe, expect, it } from 'vitest'
import type { Vec3 } from '../src/core/contracts/geometry.js'
import { SOLID_PARTS, type CompiledTri, type WallExtent, type WallSpec } from '../src/core/wallspec/contracts.js'
import { compileWalls } from '../src/core/wallspec/compile.js'
import { compileStoreyRing, checkRingTopology } from '../src/core/wallspec/ring.js'
import type { JunctionCompileInput, WallJunctionSpec } from '../src/core/wallspec/junction.js'
import { wallFrame } from '../src/core/wallspec/contracts.js'
import {
  CORNER_FL,
  CORNER_FR,
  CORNER_RL,
  CORNER_RR,
  FRONT_ID,
  FRONT_OPENING,
  FRONT_OPENING_ID,
  GROSS_FACADE_M2,
  INNER_DEPTH_M,
  INNER_WIDTH_M,
  LEFT_ID,
  OPAQUE_FACADE_M2,
  REAR_ID,
  RIGHT_ID,
  RIGHT_OPENING,
  RIGHT_OPENING_ID,
  RING_CORNER_IDS,
  RING_DEPTH_M,
  RING_HEIGHT_M,
  RING_ROTATION,
  RING_SCHEDULES,
  RING_THICKNESS_M,
  RING_TRANSLATION,
  RING_VOLUME_M3,
  RING_VOLUME_NO_OPENINGS_M3,
  RING_WALL_IDS,
  RING_WIDTH_M,
  SCHEDULE_A,
  SCHEDULE_B,
  ringEnvelopePlanes,
  ringFrame,
  ringInput,
  ringJunctions,
  ringOpenings,
  ringGlazing,
  ringWalls,
  type OwnershipSchedule,
} from '../src/core/wallspec/ring-fixtures.js'
import {
  distanceToSurface,
  envelopeFaceArea,
  faceEscapes,
  manifoldReport,
  meshOverlapAlong,
  meshVolume,
  scanMaterial,
  type Interval,
  type NamedMesh,
} from './geometry-oracles.js'

/**
 * Volume tolerance.
 *
 * The oracle sums a few hundred triple products of coordinates of order 10, so
 * accumulated rounding is around 1e-13 m3. A microlitre is far above that and
 * far below anything a drawing could mean, so a failure is a real fault.
 */
const VOL_TOL = 1e-6
/** Length tolerance for scan-line comparisons: a tenth of a micrometre. */
const LEN_TOL = 1e-7

// --------------------------------------------------------------------------
// Helpers. Geometry only — nothing here reads a compiler record.
// --------------------------------------------------------------------------

const solidOf = (tris: readonly CompiledTri[]): CompiledTri[] =>
  tris.filter((t) => SOLID_PARTS.includes(t.part))

/** One closed mesh per wall, which is what the ring actually is. */
const wallMeshes = (tris: readonly CompiledTri[]): NamedMesh[] =>
  RING_WALL_IDS.map((id) => ({ id, tris: solidOf(tris).filter((t) => t.wallId === id) }))

const add = (p: Vec3, v: Vec3, s: number): Vec3 => ({ x: p.x + v.x * s, y: p.y + v.y * s, z: p.z + v.z * s })
const negate = (v: Vec3): Vec3 => ({ x: -v.x, y: -v.y, z: -v.z })

type RingProbe = ReturnType<typeof ringFrame>

/** A point in ring-local coordinates: a along +X, c along +Z, b up. */
const at = (f: RingProbe, a: number, b: number, c: number): Vec3 =>
  add(add(add(f.origin, f.x, a), f.y, b), f.z, c)

/**
 * Material along a scan line, expressed back in ring-local coordinates.
 *
 * The ray starts a metre outside the ring so that `t` minus that metre is the
 * ring-local coordinate, which makes an expected interval list readable as the
 * plan dimensions it is.
 */
const START_BACK_M = 1

function scanAlongX(meshes: readonly NamedMesh[], f: RingProbe, b: number, c: number): Interval[] {
  const origin = at(f, -START_BACK_M, b, c)
  return scanMaterial(meshes, origin, f.x).merged.map((i) => ({
    t0: i.t0 - START_BACK_M,
    t1: i.t1 - START_BACK_M,
  }))
}

function scanAlongZ(meshes: readonly NamedMesh[], f: RingProbe, b: number, a: number): Interval[] {
  const origin = at(f, a, b, -START_BACK_M)
  return scanMaterial(meshes, origin, f.z).merged.map((i) => ({
    t0: i.t0 - START_BACK_M,
    t1: i.t1 - START_BACK_M,
  }))
}

const showIntervals = (list: readonly Interval[]): string =>
  list.map((i) => `[${i.t0.toFixed(3)}, ${i.t1.toFixed(3)}]`).join(' + ') || '(none)'

function expectIntervals(actual: readonly Interval[], expected: readonly [number, number][], what: string): void {
  expect(showIntervals(actual), what).toBe(showIntervals(expected.map(([t0, t1]) => ({ t0, t1 }))))
  actual.forEach((iv, k) => {
    expect(Math.abs(iv.t0 - expected[k][0]), `${what}: interval ${k} start`).toBeLessThan(LEN_TOL)
    expect(Math.abs(iv.t1 - expected[k][1]), `${what}: interval ${k} end`).toBeLessThan(LEN_TOL)
  })
}

/**
 * The material a scan line should meet, from the fixture's plan arithmetic.
 *
 * Independent of everything the compiler does: the ring is the outer rectangle
 * minus the inner one, and at a height inside an opening the strip that opening
 * occupies is missing too.
 */
const T = RING_THICKNESS_M
function expectedAlongX(b: number, c: number): [number, number][] {
  const inFrontBand = c > RING_DEPTH_M - T
  const inRearBand = c < T
  if (inFrontBand) {
    // The FRONT opening runs 2.0..4.0 along the wall, sill 0.8, head 2.3.
    const open = b > FRONT_OPENING.sillM && b < FRONT_OPENING.sillM + FRONT_OPENING.heightM
    return open
      ? [
          [0, FRONT_OPENING.offsetM],
          [FRONT_OPENING.offsetM + FRONT_OPENING.widthM, RING_WIDTH_M],
        ]
      : [[0, RING_WIDTH_M]]
  }
  if (inRearBand) return [[0, RING_WIDTH_M]]
  // Between the bands: the two side walls only. The RIGHT opening is a hole in
  // the second of them, at 2.0..3.0 along a wall whose u runs from c = depth
  // downwards, so in ring coordinates it spans depth-3.0 .. depth-2.0.
  const rightOpen =
    b > RIGHT_OPENING.sillM &&
    b < RIGHT_OPENING.sillM + RIGHT_OPENING.heightM &&
    c > RING_DEPTH_M - RIGHT_OPENING.offsetM - RIGHT_OPENING.widthM &&
    c < RING_DEPTH_M - RIGHT_OPENING.offsetM
  return rightOpen ? [[0, T]] : [[0, T], [RING_WIDTH_M - T, RING_WIDTH_M]]
}

function expectedAlongZ(b: number, a: number): [number, number][] {
  const inLeftBand = a < T
  const inRightBand = a > RING_WIDTH_M - T
  if (inRightBand) {
    const open = b > RIGHT_OPENING.sillM && b < RIGHT_OPENING.sillM + RIGHT_OPENING.heightM
    return open
      ? [
          [0, RING_DEPTH_M - RIGHT_OPENING.offsetM - RIGHT_OPENING.widthM],
          [RING_DEPTH_M - RIGHT_OPENING.offsetM, RING_DEPTH_M],
        ]
      : [[0, RING_DEPTH_M]]
  }
  if (inLeftBand) return [[0, RING_DEPTH_M]]
  const frontOpen =
    b > FRONT_OPENING.sillM &&
    b < FRONT_OPENING.sillM + FRONT_OPENING.heightM &&
    a > FRONT_OPENING.offsetM &&
    a < FRONT_OPENING.offsetM + FRONT_OPENING.widthM
  return frontOpen ? [[0, T]] : [[0, T], [RING_DEPTH_M - T, RING_DEPTH_M]]
}

/** Sample positions chosen to sit strictly inside each distinct band. */
const SCAN_C = [0.2, 1.0, 2.4, 3.5, 5.0, 5.8]
const SCAN_A = [0.2, 1.0, 3.0, 5.0, 7.0, 7.8]

/**
 * Where to probe each corner, and what must be true there.
 *
 * `alongZ` scans up the ring inside the corner's own side band; `alongX` scans
 * across it inside the corner's own front or rear band. Both pass through the
 * corner prism, so between them they pin it.
 *
 * Localisation needs care. A scan across the front of the ring passes through
 * *both* front corners, so a fault at one shows up in the other's scan unless
 * the reading is narrowed. Two things narrow it: overlap is only counted
 * between the two walls that actually meet at this corner, and coverage is only
 * required over the corner's own prism rather than the whole scan line. Without
 * that, a missing junction at one corner reports all four as failing, which
 * names nothing.
 */
const CORNER_PROBES: Record<
  string,
  { walls: [string, string]; scanAtA: number; scanAtC: number; prismA: [number, number]; prismC: [number, number] }
> = {
  [CORNER_FL]: {
    walls: [FRONT_ID, LEFT_ID],
    scanAtA: 0.2,
    scanAtC: RING_DEPTH_M - 0.2,
    prismA: [0, RING_THICKNESS_M],
    prismC: [RING_DEPTH_M - RING_THICKNESS_M, RING_DEPTH_M],
  },
  [CORNER_FR]: {
    walls: [FRONT_ID, RIGHT_ID],
    scanAtA: RING_WIDTH_M - 0.2,
    scanAtC: RING_DEPTH_M - 0.2,
    prismA: [RING_WIDTH_M - RING_THICKNESS_M, RING_WIDTH_M],
    prismC: [RING_DEPTH_M - RING_THICKNESS_M, RING_DEPTH_M],
  },
  [CORNER_RR]: {
    walls: [RIGHT_ID, REAR_ID],
    scanAtA: RING_WIDTH_M - 0.2,
    scanAtC: 0.2,
    prismA: [RING_WIDTH_M - RING_THICKNESS_M, RING_WIDTH_M],
    prismC: [0, RING_THICKNESS_M],
  },
  [CORNER_RL]: {
    walls: [REAR_ID, LEFT_ID],
    scanAtA: 0.2,
    scanAtC: 0.2,
    prismA: [0, RING_THICKNESS_M],
    prismC: [0, RING_THICKNESS_M],
  },
}

/** Heights clear of both openings, where the ring must be unbroken all the way round. */
const SOLID_HEIGHTS = [0.4, 2.6]

/** How much of `[lo, hi]` the intervals cover. */
const coveredWithin = (list: readonly Interval[], lo: number, hi: number): number =>
  list.reduce((acc, i) => acc + Math.max(0, Math.min(i.t1, hi) - Math.max(i.t0, lo)), 0)

type CornerReport = {
  corner: string
  overlapM: number
  overlapPair?: string
  gapM: number
  gapWhere?: string
}

/** Overlap and continuity at one corner, measured on emitted geometry. */
function probeCorner(meshes: readonly NamedMesh[], f: RingProbe, corner: string): CornerReport {
  const p = CORNER_PROBES[corner]
  const report: CornerReport = { corner, overlapM: 0, gapM: 0 }
  const pair = new Set<string>(p.walls)
  for (const b of SOLID_HEIGHTS) {
    for (const [label, origin, dir, prism] of [
      ['alongZ', at(f, p.scanAtA, b, -START_BACK_M), f.z, p.prismC],
      ['alongX', at(f, -START_BACK_M, b, p.scanAtC), f.x, p.prismA],
    ] as const) {
      for (const ov of meshOverlapAlong(meshes, origin, dir)) {
        if (!pair.has(ov.a) || !pair.has(ov.b)) continue
        if (ov.lengthM > report.overlapM) {
          report.overlapM = ov.lengthM
          report.overlapPair = `${ov.a}+${ov.b}`
        }
      }
      // The corner prism must be full: clear of the openings there is no reason
      // for any part of it to be missing.
      const local = scanMaterial(meshes, origin, dir).merged.map((i) => ({
        t0: i.t0 - START_BACK_M,
        t1: i.t1 - START_BACK_M,
      }))
      const missing = prism[1] - prism[0] - coveredWithin(local, prism[0], prism[1])
      if (missing > report.gapM) {
        report.gapM = missing
        report.gapWhere = `${label} at b=${b}, prism ${prism[0]}..${prism[1]}: ${showIntervals(local)}`
      }
    }
  }
  return report
}

/** Emitted opening geometry projected back into its host wall's own frame. */
function openingInHostFrame(
  tris: readonly CompiledTri[],
  walls: readonly WallSpec[],
  openingId: string,
): { u0: number; u1: number; up0: number; up1: number } {
  const mine = tris.filter((t) => t.openingId === openingId)
  expect(mine.length, `triangles for opening ${openingId}`).toBeGreaterThan(0)
  const host = walls.find((w) => w.id === mine[0].wallId)!
  const f = wallFrame(host)
  const us: number[] = []
  const ups: number[] = []
  for (const t of mine) {
    for (const p of [t.a, t.b, t.c]) {
      const d = { x: p.x - host.origin.x, y: p.y - host.origin.y, z: p.z - host.origin.z }
      us.push(d.x * f.u.x + d.y * f.u.y + d.z * f.u.z)
      ups.push(d.x * f.up.x + d.y * f.up.y + d.z * f.up.z)
    }
  }
  return { u0: Math.min(...us), u1: Math.max(...us), up0: Math.min(...ups), up1: Math.max(...ups) }
}

const codesOf = (result: { diagnostics: Array<{ code: string }> }): string[] =>
  result.diagnostics.map((d) => d.code)

// --------------------------------------------------------------------------
// 4, 5. Volume.
// --------------------------------------------------------------------------

describe('closed storey ring — volume', () => {
  it.each(RING_SCHEDULES.map((s) => [s.name, s] as const))(
    'schedule %s: wall material without openings is 35.37 m3',
    (_name, schedule: OwnershipSchedule) => {
      const r = compileStoreyRing(ringInput({ schedule, withOpenings: false }))
      expect(r.diagnostics).toEqual([])
      expect(r.closed).toBe(true)
      const total = wallMeshes(r.tris).reduce((acc, m) => acc + meshVolume(m.tris), 0)
      expect(RING_VOLUME_NO_OPENINGS_M3).toBeCloseTo(35.37, 12)
      expect(total).toBeCloseTo(RING_VOLUME_NO_OPENINGS_M3, 9)
    },
  )

  it.each(RING_SCHEDULES.map((s) => [s.name, s] as const))(
    'schedule %s: wall material with both openings is 33.57 m3',
    (_name, schedule: OwnershipSchedule) => {
      const r = compileStoreyRing(ringInput({ schedule }))
      expect(r.diagnostics).toEqual([])
      const total = wallMeshes(r.tris).reduce((acc, m) => acc + meshVolume(m.tris), 0)
      expect(RING_VOLUME_M3).toBeCloseTo(33.57, 12)
      expect(total).toBeCloseTo(RING_VOLUME_M3, 9)
    },
  )

  it.each(RING_SCHEDULES.map((s) => [s.name, s] as const))(
    'schedule %s: every wall is a closed, consistently wound solid',
    (_name, schedule: OwnershipSchedule) => {
      const r = compileStoreyRing(ringInput({ schedule }))
      for (const m of wallMeshes(r.tris)) {
        const report = manifoldReport(m.tris)
        expect(report.boundaryEdges, `${m.id} boundary edges`).toEqual([])
        expect(report.duplicateEdges, `${m.id} duplicate edges`).toEqual([])
        expect(meshVolume(m.tris), `${m.id} volume sign`).toBeGreaterThan(0)
      }
    },
  )

  it('the two schedules disagree about every corner and about nothing physical', () => {
    // If the schedules happened to assign the same owners, the comparisons
    // through the rest of this file would be comparing a thing with itself.
    const differing = RING_CORNER_IDS.filter((c) => SCHEDULE_A.owners[c] !== SCHEDULE_B.owners[c])
    expect(differing).toEqual([CORNER_FR, CORNER_RL])
    const a = compileStoreyRing(ringInput({ schedule: SCHEDULE_A }))
    const b = compileStoreyRing(ringInput({ schedule: SCHEDULE_B }))
    // Two of four corners change hands, and that is enough to change which wall
    // is cut back everywhere: A runs the long walls through and trims the short
    // ones at both ends, B trims every wall exactly once.
    expect(a.junctions.map((j) => j.trimmedWallId).sort()).toEqual([LEFT_ID, LEFT_ID, RIGHT_ID, RIGHT_ID])
    expect(b.junctions.map((j) => j.trimmedWallId).sort()).toEqual([FRONT_ID, LEFT_ID, REAR_ID, RIGHT_ID])
    expect(a.extents).not.toEqual(b.extents)
    // Physically identical, measured rather than assumed.
    const volA = wallMeshes(a.tris).reduce((acc, m) => acc + meshVolume(m.tris), 0)
    const volB = wallMeshes(b.tris).reduce((acc, m) => acc + meshVolume(m.tris), 0)
    expect(Math.abs(volA - volB)).toBeLessThan(VOL_TOL)
  })
})

// --------------------------------------------------------------------------
// 7. Cross-sections.
// --------------------------------------------------------------------------

describe('closed storey ring — cross-sections', () => {
  it.each(RING_SCHEDULES.map((s) => [s.name, s] as const))(
    'schedule %s: occupancy at y=0.40, 1.20 and 2.60 matches the plan arithmetic',
    (_name, schedule: OwnershipSchedule) => {
      const r = compileStoreyRing(ringInput({ schedule }))
      const meshes = wallMeshes(r.tris)
      const f = ringFrame()
      for (const b of [0.4, 1.2, 2.6]) {
        for (const c of SCAN_C) {
          expectIntervals(scanAlongX(meshes, f, b, c), expectedAlongX(b, c), `y=${b} scan +X at z=${c}`)
        }
        for (const a of SCAN_A) {
          expectIntervals(scanAlongZ(meshes, f, b, a), expectedAlongZ(b, a), `y=${b} scan +Z at x=${a}`)
        }
      }
    },
  )

  it('both schedules occupy exactly the same union, section for section', () => {
    const f = ringFrame()
    const a = wallMeshes(compileStoreyRing(ringInput({ schedule: SCHEDULE_A })).tris)
    const b = wallMeshes(compileStoreyRing(ringInput({ schedule: SCHEDULE_B })).tris)
    for (const height of [0.4, 1.2, 2.6]) {
      for (const c of SCAN_C) {
        expect(showIntervals(scanAlongX(a, f, height, c)), `y=${height} +X at z=${c}`).toBe(
          showIntervals(scanAlongX(b, f, height, c)),
        )
      }
      for (const x of SCAN_A) {
        expect(showIntervals(scanAlongZ(a, f, height, x)), `y=${height} +Z at x=${x}`).toBe(
          showIntervals(scanAlongZ(b, f, height, x)),
        )
      }
    }
  })

  it('the openings are open only where and while they should be', () => {
    // A section above the FRONT head and below the RIGHT sill must be solid ring
    // even though a section between them is not. This is the check that the
    // three heights in the brief are measuring something that varies.
    const f = ringFrame()
    const meshes = wallMeshes(compileStoreyRing(ringInput({ schedule: SCHEDULE_A })).tris)
    expectIntervals(scanAlongX(meshes, f, 1.2, 5.8), [[0, 2], [4, 8]], 'through the FRONT opening')
    expectIntervals(scanAlongX(meshes, f, 2.4, 5.8), [[0, 8]], 'just above the FRONT head')
    expectIntervals(scanAlongZ(meshes, f, 1.2, 7.8), [[0, 3], [4, 6]], 'through the RIGHT opening')
    expectIntervals(scanAlongZ(meshes, f, 1.9, 7.8), [[0, 6]], 'just above the RIGHT head')
  })
})

// --------------------------------------------------------------------------
// 8. All four corners, both schedules.
// --------------------------------------------------------------------------

describe('closed storey ring — corners', () => {
  it.each(RING_SCHEDULES.map((s) => [s.name, s] as const))(
    'schedule %s: every corner shares zero volume and leaves no crack',
    (_name, schedule: OwnershipSchedule) => {
      const r = compileStoreyRing(ringInput({ schedule }))
      const meshes = wallMeshes(r.tris)
      const f = ringFrame()
      for (const corner of RING_CORNER_IDS) {
        const report = probeCorner(meshes, f, corner)
        expect(report.overlapM, `${corner} overlap (${report.overlapPair ?? 'none'})`).toBeLessThan(LEN_TOL)
        expect(report.gapM, `${corner} gap (${report.gapWhere ?? 'none'})`).toBeLessThan(LEN_TOL)
      }
    },
  )

  it('the exterior corner prism is present, not just the two wall faces', () => {
    // A ring could have continuous scan lines and still be missing the little
    // prism at the outside of each corner. Probe a point 50 mm inside the corner
    // on both axes and require material there.
    const f = ringFrame()
    for (const schedule of RING_SCHEDULES) {
      const solid = solidOf(compileStoreyRing(ringInput({ schedule })).tris)
      for (const [a, c, corner] of [
        [0.05, RING_DEPTH_M - 0.05, CORNER_FL],
        [RING_WIDTH_M - 0.05, RING_DEPTH_M - 0.05, CORNER_FR],
        [RING_WIDTH_M - 0.05, 0.05, CORNER_RR],
        [0.05, 0.05, CORNER_RL],
      ] as const) {
        const origin = at(f, a, 1.5, -START_BACK_M)
        const hits = scanMaterial(wallMeshes(solid), origin, f.z).merged
        const inside = hits.some((i) => i.t0 - START_BACK_M <= c + LEN_TOL && i.t1 - START_BACK_M >= c - LEN_TOL)
        expect(inside, `schedule ${schedule.name}: material at the ${corner} prism`).toBe(true)
      }
    }
  })
})

// --------------------------------------------------------------------------
// 9. Mutations. None of these fixtures is committed as a valid case.
// --------------------------------------------------------------------------

/** Which end of schedule A's owner wall sits at each corner. */
const CORNER_OWNER_ENDS: Record<string, 'START' | 'END'> = {
  [CORNER_FL]: 'START', // FRONT's START
  [CORNER_FR]: 'END', // FRONT's END
  [CORNER_RR]: 'START', // REAR's START
  [CORNER_RL]: 'END', // REAR's END
}

describe('closed storey ring — mutations the oracles must catch', () => {
  const f = ringFrame()

  // Every corner, under both schedules: drop that one junction and the oracle
  // must name that one corner. Testing a single corner would not show that the
  // reading localises; it would show that it fires.
  const untrimmedCases = RING_SCHEDULES.flatMap((schedule) =>
    RING_CORNER_IDS.map((corner) => [`schedule ${schedule.name}, ${corner}`, schedule, corner] as const),
  )

  it.each(untrimmedCases)('1. %s with no trim overlaps, and the oracle names it', (_what, schedule, corner) => {
    const input = ringInput({ schedule })
    const mutated: JunctionCompileInput = {
      ...input,
      junctions: input.junctions.filter((j) => j.id !== corner),
    }
    const r = compileStoreyRing(mutated)
    const meshes = wallMeshes(r.tris)
    const reports = RING_CORNER_IDS.map((c) => probeCorner(meshes, f, c))
    const failing = reports.filter((x) => x.overlapM > LEN_TOL)
    expect(failing.map((x) => x.corner)).toEqual([corner])
    expect(failing[0].overlapM).toBeCloseTo(RING_THICKNESS_M, 9)
    expect(failing[0].overlapPair).toBeDefined()
    // The volume is over by exactly the corner prism that was emitted twice.
    const total = meshes.reduce((acc, m) => acc + meshVolume(m.tris), 0)
    expect(total - RING_VOLUME_M3).toBeCloseTo(RING_THICKNESS_M * RING_THICKNESS_M * RING_HEIGHT_M, 9)
    // And the topology check says why, before any geometry is measured.
    expect(codesOf(r)).toContain('RING_WALL_END_UNJOINED')
    expect(r.closed).toBe(false)
  })

  it.each(RING_CORNER_IDS.map((c) => [c] as const))(
    '2. %s trimmed twice leaves a gap, and the oracle names it',
    (corner) => {
      // `compileJunctions` will not trim both sides, so the extents are handed
      // to the wall compiler directly: the mutation is of the compiled extent,
      // which is exactly the thing under test. Start from schedule A's own
      // extents and take the owner's side back as well.
      const walls = ringWalls()
      const base = compileStoreyRing(ringInput({ schedule: SCHEDULE_A }))
      const extents = new Map<string, WallExtent>(
        base.extents.map((e) => [e.wallId, { a0: e.a0, a1: e.a1 }]),
      )
      const owner = SCHEDULE_A.owners[corner]
      const ownerWall = walls.find((w) => w.id === owner)!
      const ownerEnd = CORNER_OWNER_ENDS[corner]
      const e = extents.get(owner)!
      extents.set(
        owner,
        ownerEnd === 'START'
          ? { a0: e.a0 + RING_THICKNESS_M, a1: e.a1 }
          : { a0: e.a0, a1: e.a1 - RING_THICKNESS_M },
      )
      expect(ownerWall.lengthM).toBeGreaterThan(RING_THICKNESS_M * 2)

      const r = compileWalls({ walls, openings: ringOpenings(), glazing: ringGlazing() }, extents)
      const meshes = wallMeshes(r.tris)
      const reports = RING_CORNER_IDS.map((c) => probeCorner(meshes, f, c))
      const failing = reports.filter((x) => x.gapM > LEN_TOL)
      expect(failing.map((x) => x.corner)).toEqual([corner])
      expect(failing[0].gapM).toBeCloseTo(RING_THICKNESS_M, 9)
      const total = meshes.reduce((acc, m) => acc + meshVolume(m.tris), 0)
      expect(RING_VOLUME_M3 - total).toBeCloseTo(RING_THICKNESS_M * RING_THICKNESS_M * RING_HEIGHT_M, 9)
    },
  )

  it('3. an inconsistent owner relation is refused rather than resolved', () => {
    const input = ringInput({ schedule: SCHEDULE_A })
    // Two junctions claiming the same wall end.
    const doubleClaim: WallJunctionSpec[] = [
      ...input.junctions,
      { id: 'extra', wallAId: FRONT_ID, wallAEnd: 'END', wallBId: REAR_ID, wallBEnd: 'END', kind: 'BUTT', ownerWallId: FRONT_ID },
    ]
    expect(codesOf(compileStoreyRing({ ...input, junctions: doubleClaim }))).toContain('CONFLICTING_JUNCTION_END')
    // An owner that is not one of the two walls at the corner.
    const strayOwner = input.junctions.map((j) =>
      j.id === CORNER_FR ? { ...j, ownerWallId: REAR_ID } : j,
    )
    expect(codesOf(compileStoreyRing({ ...input, junctions: strayOwner }))).toContain('JUNCTION_OWNER_NOT_A_MEMBER')
  })

  it('4. shortening lengthM instead of the emitted extent is caught', () => {
    // The tempting implementation: make LEFT and RIGHT 5.10 m long and drop
    // their trims. The ring volume comes out right, which is exactly why a
    // volume check alone is not enough — but the walls no longer reach the
    // corners, and the RIGHT opening moves 0.45 m along its own host.
    const shortened: WallSpec[] = ringWalls().map((w) =>
      w.id === LEFT_ID || w.id === RIGHT_ID
        ? { ...w, origin: add(w.origin, w.u, RING_THICKNESS_M), lengthM: w.lengthM - 2 * RING_THICKNESS_M }
        : w,
    )
    const r = compileWalls({ walls: shortened, openings: ringOpenings(), glazing: ringGlazing() })
    expect(r.diagnostics).toEqual([])
    const meshes = wallMeshes(r.tris)
    // Volume still lands on 33.57, so only the other oracles can see the fault.
    const total = meshes.reduce((acc, m) => acc + meshVolume(m.tris), 0)
    expect(total).toBeCloseTo(RING_VOLUME_M3, 9)
    // Host-local opening coordinates have moved, which is the fault that matters.
    const right = openingInHostFrame(r.tris, shortened, RIGHT_OPENING_ID)
    expect(right.u0).toBeCloseTo(RIGHT_OPENING.offsetM, 9)
    const f2 = ringFrame()
    // ...and in the ring, the opening is 0.45 m from where the drawing put it.
    const moved = scanAlongZ(meshes, f2, 1.2, RING_WIDTH_M - 0.2)
    expectIntervals(moved, [[0, 2.55], [3.55, 6]], 'RIGHT opening after shortening lengthM')
    const correct = scanAlongZ(
      wallMeshes(compileStoreyRing(ringInput({ schedule: SCHEDULE_A })).tris),
      f2,
      1.2,
      RING_WIDTH_M - 0.2,
    )
    expect(showIntervals(moved)).not.toBe(showIntervals(correct))
  })
})

// --------------------------------------------------------------------------
// 10. Hosted opening invariance.
// --------------------------------------------------------------------------

describe('closed storey ring — hosted openings', () => {
  const cases: Array<[string, JunctionCompileInput]> = [
    ['schedule A', ringInput({ schedule: SCHEDULE_A })],
    ['schedule B', ringInput({ schedule: SCHEDULE_B })],
    ['translated', ringInput({ schedule: SCHEDULE_A, translation: RING_TRANSLATION })],
    ['rotated and translated', ringInput({ schedule: SCHEDULE_B, rotation: RING_ROTATION, translation: RING_TRANSLATION })],
    ['beside distant geometry', ringInput({ schedule: SCHEDULE_A, distant: true })],
  ]

  it.each(cases)('%s: FRONT reads u 2.0..4.0, up 0.8..2.3 in its own frame', (_what, input) => {
    const r = compileStoreyRing(input)
    const o = openingInHostFrame(r.tris, input.walls, FRONT_OPENING_ID)
    expect(o.u0).toBeCloseTo(2.0, 9)
    expect(o.u1).toBeCloseTo(4.0, 9)
    expect(o.up0).toBeCloseTo(0.8, 9)
    expect(o.up1).toBeCloseTo(2.3, 9)
  })

  it.each(cases)('%s: RIGHT reads u 2.0..3.0, up 0.8..1.8 in its own frame', (_what, input) => {
    const r = compileStoreyRing(input)
    const o = openingInHostFrame(r.tris, input.walls, RIGHT_OPENING_ID)
    expect(o.u0).toBeCloseTo(2.0, 9)
    expect(o.u1).toBeCloseTo(3.0, 9)
    expect(o.up0).toBeCloseTo(0.8, 9)
    expect(o.up1).toBeCloseTo(1.8, 9)
  })

  it('glazing sits inside its opening and is not part of the wall solid', () => {
    const input = ringInput({ schedule: SCHEDULE_B })
    const r = compileStoreyRing(input)
    for (const [openingId, spec] of [
      [FRONT_OPENING_ID, FRONT_OPENING],
      [RIGHT_OPENING_ID, RIGHT_OPENING],
    ] as const) {
      const glass = r.tris.filter((t) => t.part === 'GLAZING' && t.openingId === openingId)
      expect(glass, `glazing for ${openingId}`).toHaveLength(2)
      const host = input.walls.find((w) => w.id === glass[0].wallId)!
      const f = wallFrame(host)
      for (const t of glass) {
        for (const p of [t.a, t.b, t.c]) {
          const d = { x: p.x - host.origin.x, y: p.y - host.origin.y, z: p.z - host.origin.z }
          const u = d.x * f.u.x + d.y * f.u.y + d.z * f.u.z
          const b = d.x * f.up.x + d.y * f.up.y + d.z * f.up.z
          const c = -(d.x * f.n.x + d.y * f.n.y + d.z * f.n.z)
          expect(u).toBeGreaterThanOrEqual(spec.offsetM - 1e-9)
          expect(u).toBeLessThanOrEqual(spec.offsetM + spec.widthM + 1e-9)
          expect(b).toBeGreaterThanOrEqual(spec.sillM - 1e-9)
          expect(b).toBeLessThanOrEqual(spec.sillM + spec.heightM + 1e-9)
          expect(c).toBeCloseTo(RING_THICKNESS_M / 2, 9)
        }
      }
    }
    // The wall volume is measured on the solid parts alone; adding glazing
    // opens the surface, which is the direct statement that it is separate.
    const withGlass = manifoldReport(r.tris.filter((t) => t.wallId === FRONT_ID))
    expect(withGlass.closed).toBe(false)
    expect(manifoldReport(solidOf(r.tris).filter((t) => t.wallId === FRONT_ID)).closed).toBe(true)
  })
})

// --------------------------------------------------------------------------
// 11, 12. Facade area and clear interior.
// --------------------------------------------------------------------------

describe('closed storey ring — facade and interior', () => {
  it.each(RING_SCHEDULES.map((s) => [s.name, s] as const))(
    'schedule %s: 84 m2 of envelope carries 80.0 m2 of opaque facade',
    (_name, schedule: OwnershipSchedule) => {
      const r = compileStoreyRing(ringInput({ schedule }))
      const planes = ringEnvelopePlanes()
      expect(envelopeFaceArea(solidOf(r.tris), planes)).toBeCloseTo(OPAQUE_FACADE_M2, 9)
      expect(OPAQUE_FACADE_M2).toBeCloseTo(80.0, 12)
      // The same ring without openings gives the gross figure, so the 4.0 m2
      // difference is the two openings and not an accounting coincidence.
      const solidRing = compileStoreyRing(ringInput({ schedule, withOpenings: false }))
      expect(envelopeFaceArea(solidOf(solidRing.tris), planes)).toBeCloseTo(GROSS_FACADE_M2, 9)
      expect(GROSS_FACADE_M2).toBeCloseTo(84.0, 12)
    },
  )

  it('facade excludes inner faces, contact faces and glazing by construction', () => {
    const r = compileStoreyRing(ringInput({ schedule: SCHEDULE_A }))
    const planes = ringEnvelopePlanes()
    const solid = solidOf(r.tris)
    // Counting glazing as well would add exactly the two opening areas back.
    const withGlazing = envelopeFaceArea(r.tris, planes)
    expect(withGlazing).toBeCloseTo(OPAQUE_FACADE_M2, 9) // glazing is inset, so not on the envelope
    // No inner face and no contact face lies on the envelope.
    const onEnvelope = (t: CompiledTri): boolean => envelopeFaceArea([t], planes) > 0
    expect(solid.filter((t) => t.part === 'WALL_INNER').some(onEnvelope)).toBe(false)
    expect(solid.filter((t) => t.contactId).some(onEnvelope)).toBe(false)
    expect(solid.filter((t) => t.part === 'REVEAL').some(onEnvelope)).toBe(false)
  })

  it.each(RING_SCHEDULES.map((s) => [s.name, s] as const))(
    'schedule %s: clear interior below the openings is 7.10 x 5.10 m',
    (_name, schedule: OwnershipSchedule) => {
      const solid = solidOf(compileStoreyRing(ringInput({ schedule })).tris)
      const f = ringFrame()
      const centre = at(f, RING_WIDTH_M / 2, 0.4, RING_DEPTH_M / 2)
      const clearX = distanceToSurface(solid, centre, f.x) + distanceToSurface(solid, centre, negate(f.x))
      const clearZ = distanceToSurface(solid, centre, f.z) + distanceToSurface(solid, centre, negate(f.z))
      expect(clearX).toBeCloseTo(INNER_WIDTH_M, 9)
      expect(clearZ).toBeCloseTo(INNER_DEPTH_M, 9)
      expect(INNER_WIDTH_M).toBeCloseTo(7.1, 12)
      expect(INNER_DEPTH_M).toBeCloseTo(5.1, 12)
    },
  )
})

// --------------------------------------------------------------------------
// 13, 14. Rigid motion and global isolation.
// --------------------------------------------------------------------------

describe('closed storey ring — invariance', () => {
  it('a rigid rotation and translation changes nothing measurable', () => {
    for (const schedule of RING_SCHEDULES) {
      const here = compileStoreyRing(ringInput({ schedule }))
      const there = compileStoreyRing(
        ringInput({ schedule, rotation: RING_ROTATION, translation: RING_TRANSLATION }),
      )
      expect(there.diagnostics).toEqual([])
      expect(there.closed).toBe(true)

      const volHere = wallMeshes(here.tris).reduce((acc, m) => acc + meshVolume(m.tris), 0)
      const volThere = wallMeshes(there.tris).reduce((acc, m) => acc + meshVolume(m.tris), 0)
      expect(volThere).toBeCloseTo(RING_VOLUME_M3, 8)
      expect(Math.abs(volThere - volHere)).toBeLessThan(VOL_TOL)

      expect(
        envelopeFaceArea(solidOf(there.tris), ringEnvelopePlanes(RING_ROTATION, RING_TRANSLATION), {
          distanceTolerance: 1e-9,
          normalTolerance: 1e-12,
        }),
      ).toBeCloseTo(OPAQUE_FACADE_M2, 7)

      const f = ringFrame(RING_ROTATION, RING_TRANSLATION)
      const solid = solidOf(there.tris)
      const centre = at(f, RING_WIDTH_M / 2, 0.4, RING_DEPTH_M / 2)
      expect(
        distanceToSurface(solid, centre, f.x) + distanceToSurface(solid, centre, negate(f.x)),
      ).toBeCloseTo(INNER_WIDTH_M, 8)
      expect(
        distanceToSurface(solid, centre, f.z) + distanceToSurface(solid, centre, negate(f.z)),
      ).toBeCloseTo(INNER_DEPTH_M, 8)

      // Corners still share nothing and leave no crack.
      const meshes = wallMeshes(there.tris)
      for (const corner of RING_CORNER_IDS) {
        const report = probeCorner(meshes, f, corner)
        expect(report.overlapM, `${corner} overlap after motion`).toBeLessThan(1e-6)
        expect(report.gapM, `${corner} gap after motion`).toBeLessThan(1e-6)
      }
      // Semantic identity is untouched by geometry.
      expect(there.junctions.map((j) => `${j.junctionId}:${j.ownerWallId}`)).toEqual(
        here.junctions.map((j) => `${j.junctionId}:${j.ownerWallId}`),
      )
      expect(there.order).toEqual(here.order)
    }
  })

  it('distant geometry changes no ring triangle, and is reported rather than ignored', () => {
    for (const schedule of RING_SCHEDULES) {
      const alone = compileStoreyRing(ringInput({ schedule }))
      const crowded = compileStoreyRing(ringInput({ schedule, distant: true }))
      const ringOnly = (r: { tris: CompiledTri[] }): CompiledTri[] =>
        r.tris.filter((t) => (RING_WALL_IDS as readonly string[]).includes(t.wallId))
      expect(ringOnly(crowded)).toEqual(ringOnly(alone))
      expect(crowded.junctions).toEqual(alone.junctions)
      expect(
        envelopeFaceArea(solidOf(ringOnly(crowded)), ringEnvelopePlanes()),
      ).toBeCloseTo(OPAQUE_FACADE_M2, 9)
      // Unjoined walls are named, not quietly tolerated: a wall with no junction
      // is exactly the fault that makes a ring overlap itself.
      const unjoined = crowded.ringDiagnostics.filter((d) => d.code === 'RING_WALL_END_UNJOINED')
      expect([...new Set(unjoined.map((d) => d.wallId))].sort()).toEqual(['far_north', 'far_south'])
      expect(crowded.closed).toBe(false)
      expect(alone.closed).toBe(true)
    }
  })
})

// --------------------------------------------------------------------------
// 15. Contact-face policy.
// --------------------------------------------------------------------------

describe('closed storey ring — contact faces', () => {
  it('keeps both faces in contact, tags them, and buries every one', () => {
    for (const schedule of RING_SCHEDULES) {
      const r = compileStoreyRing(ringInput({ schedule }))
      const solid = solidOf(r.tris)
      const contact = solid.filter((t) => t.contactId)
      // One trimmed end per junction. The triangle count depends on the break
      // grid — a wall with an opening splits its end face into three bands — so
      // the meaningful measure is area: thickness by height, once per corner.
      expect([...new Set(contact.map((t) => t.contactId))].sort()).toEqual([...RING_CORNER_IDS].sort())
      const contactArea = contact.reduce((acc, t) => {
        const e1 = { x: t.b.x - t.a.x, y: t.b.y - t.a.y, z: t.b.z - t.a.z }
        const e2 = { x: t.c.x - t.a.x, y: t.c.y - t.a.y, z: t.c.z - t.a.z }
        const n = {
          x: e1.y * e2.z - e1.z * e2.y,
          y: e1.z * e2.x - e1.x * e2.z,
          z: e1.x * e2.y - e1.y * e2.x,
        }
        return acc + Math.hypot(n.x, n.y, n.z) / 2
      }, 0)
      expect(contactArea).toBeCloseTo(r.junctions.length * RING_THICKNESS_M * RING_HEIGHT_M, 9)
      // Tagged, not moved: each face is flat against material, so a ray leaving
      // it meets something at once. No epsilon gap has been opened anywhere.
      for (const t of contact) {
        expect(faceEscapes(solid, t), `contact face of ${t.wallId} (${t.contactId})`).toBe(false)
      }
      // And they are load-bearing for the mesh: dropping them opens it.
      for (const id of RING_WALL_IDS) {
        const mine = solid.filter((t) => t.wallId === id)
        if (!mine.some((t) => t.contactId)) continue
        expect(manifoldReport(mine).closed).toBe(true)
        expect(manifoldReport(mine.filter((t) => !t.contactId)).closed).toBe(false)
      }
    }
  })
})

// --------------------------------------------------------------------------
// 16. Determinism and immutability.
// --------------------------------------------------------------------------

describe('closed storey ring — determinism', () => {
  it('does not touch its input and compiles identically twice, on both schedules', () => {
    const deepFreeze = (v: unknown): void => {
      if (v && typeof v === 'object') {
        Object.freeze(v)
        for (const x of Object.values(v as Record<string, unknown>)) deepFreeze(x)
      }
    }
    for (const schedule of RING_SCHEDULES) {
      const input = ringInput({ schedule })
      deepFreeze(input)
      const before = JSON.stringify(input)
      const first = compileStoreyRing(input)
      const second = compileStoreyRing(input)
      expect(JSON.stringify(input)).toBe(before)
      expect(second.tris).toEqual(first.tris)
      expect(second.junctions).toEqual(first.junctions)
      expect(second.extents).toEqual(first.extents)
      expect(second.order).toEqual(first.order)
      expect(JSON.stringify(second.diagnostics)).toBe(JSON.stringify(first.diagnostics))
    }
  })

  it('does not depend on the order walls or junctions arrive in', () => {
    const input = ringInput({ schedule: SCHEDULE_A })
    const reversed = compileStoreyRing({
      ...input,
      walls: [...input.walls].reverse(),
      junctions: [...input.junctions].reverse(),
    })
    const straight = compileStoreyRing(input)
    expect(reversed.diagnostics).toEqual([])
    const key = (t: CompiledTri): string =>
      `${t.wallId}|${t.part}|${t.ownerId}|${JSON.stringify([t.a, t.b, t.c])}`
    expect(reversed.tris.map(key).sort()).toEqual(straight.tris.map(key).sort())
  })
})

// --------------------------------------------------------------------------
// 17. Invalid cases.
// --------------------------------------------------------------------------

describe('closed storey ring — refusals', () => {
  const base = (): JunctionCompileInput => ringInput({ schedule: SCHEDULE_A })

  it('names every invalid case instead of repairing it', () => {
    const withJunctions = (fn: (j: WallJunctionSpec[]) => WallJunctionSpec[]): JunctionCompileInput => {
      const b = base()
      return { ...b, junctions: fn([...b.junctions]) }
    }
    const withWalls = (fn: (w: WallSpec[]) => WallSpec[]): JunctionCompileInput => {
      const b = base()
      return { ...b, walls: fn([...b.walls]) }
    }

    const cases: Array<[string, JunctionCompileInput, string]> = [
      [
        'one of the four junctions missing',
        withJunctions((j) => j.filter((x) => x.id !== CORNER_RR)),
        'RING_WALL_END_UNJOINED',
      ],
      [
        'incompatible claims on the same wall end',
        withJunctions((j) => [
          ...j,
          { id: 'second_claim', wallAId: FRONT_ID, wallAEnd: 'START', wallBId: REAR_ID, wallBEnd: 'START', kind: 'BUTT', ownerWallId: FRONT_ID },
        ]),
        'CONFLICTING_JUNCTION_END',
      ],
      [
        'the ring does not close',
        // Every end is joined, but as two separate two-wall loops rather than
        // one ring — a fault no single junction can see.
        withJunctions(() => [
          { id: 'fl', wallAId: FRONT_ID, wallAEnd: 'START', wallBId: LEFT_ID, wallBEnd: 'END', kind: 'BUTT', ownerWallId: FRONT_ID },
          { id: 'lf', wallAId: LEFT_ID, wallAEnd: 'START', wallBId: FRONT_ID, wallBEnd: 'END', kind: 'BUTT', ownerWallId: FRONT_ID },
          { id: 'rr', wallAId: RIGHT_ID, wallAEnd: 'START', wallBId: REAR_ID, wallBEnd: 'END', kind: 'BUTT', ownerWallId: REAR_ID },
          { id: 'rr2', wallAId: REAR_ID, wallAEnd: 'START', wallBId: RIGHT_ID, wallBEnd: 'END', kind: 'BUTT', ownerWallId: REAR_ID },
        ]),
        'RING_NOT_CLOSED',
      ],
      [
        'a wall end in the wrong place',
        withWalls((w) => w.map((x) => (x.id === RIGHT_ID ? { ...x, lengthM: x.lengthM + 0.3 } : x))),
        'JUNCTION_ENDS_DO_NOT_MEET',
      ],
      [
        'a wall that is not orthogonal to its neighbour',
        withWalls((w) =>
          w.map((x) =>
            x.id === RIGHT_ID
              ? { ...x, u: { x: Math.SQRT1_2, y: 0, z: -Math.SQRT1_2 } }
              : x,
          ),
        ),
        'JUNCTION_NOT_ORTHOGONAL',
      ],
      [
        'an owner that is not at the corner',
        withJunctions((j) => j.map((x) => (x.id === CORNER_FL ? { ...x, ownerWallId: RIGHT_ID } : x))),
        'JUNCTION_OWNER_NOT_A_MEMBER',
      ],
      [
        'a duplicate wall id',
        withWalls((w) => [...w, { ...w[0], origin: { x: 40, y: 0, z: 40 } }]),
        'DUPLICATE_WALL_ID',
      ],
      [
        'a duplicate junction id',
        withJunctions((j) => [...j, { ...j[0] }]),
        'DUPLICATE_JUNCTION_ID',
      ],
    ]

    for (const [what, input, code] of cases) {
      const r = compileStoreyRing(input)
      expect(codesOf(r), what).toContain(code)
      for (const d of r.diagnostics) expect(d.message.length, what).toBeGreaterThan(20)
    }
  })

  it('refuses an opening that falls in a corner another wall owns', () => {
    // RIGHT is trimmed 0.45 m at its START under schedule A, so an opening
    // starting at 0.2 m is inside material that belongs to FRONT. It is neither
    // moved nor clipped.
    const b = base()
    const r = compileStoreyRing({
      ...b,
      openings: b.openings.map((o) => (o.id === RIGHT_OPENING_ID ? { ...o, offsetM: 0.2 } : o)),
    })
    expect(codesOf(r)).toContain('OPENING_IN_TRIMMED_ZONE')
    // The wall is still emitted, whole and closed: one refused opening does not
    // take its host down with it.
    const right = solidOf(r.tris).filter((t) => t.wallId === RIGHT_ID)
    expect(manifoldReport(right).closed).toBe(true)
    expect(r.tris.some((t) => t.openingId === RIGHT_OPENING_ID)).toBe(false)
  })

  it('reports a broken ring before any geometry is measured', () => {
    const b = base()
    const missing = checkRingTopology(b.walls, b.junctions.filter((j) => j.id !== CORNER_FL))
    expect(missing.closed).toBe(false)
    expect(missing.diagnostics.map((d) => d.code)).toEqual([
      'RING_WALL_END_UNJOINED',
      'RING_WALL_END_UNJOINED',
    ])
    expect(missing.diagnostics.map((d) => `${d.wallId}|${d.end}`).sort()).toEqual([
      `${FRONT_ID}|START`,
      `${LEFT_ID}|END`,
    ])
    const whole = checkRingTopology(b.walls, ringJunctions(SCHEDULE_A))
    expect(whole.closed).toBe(true)
    expect(whole.diagnostics).toEqual([])
    expect(whole.order).toHaveLength(4)
  })
})
