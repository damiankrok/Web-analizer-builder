/**
 * STAGE WEB-PIVOT-01B — wall junction ownership proof.
 *
 * STAGE WEB-PIVOT-01 left one bounded hole: two walls meeting at a corner each
 * claim the corner prism, so compiling them independently emits it twice. This
 * file proves the smallest thing that closes it — an orthogonal BUTT junction
 * with one explicit owner — and proves it by measuring emitted triangles.
 *
 * The oracles in `tests/geometry-oracles.ts` import nothing from
 * `src/core/wallspec/`. Between them they answer four different questions with
 * four different algorithms:
 *
 *   volume      divergence theorem, which measures orientation as well as size
 *   closure     directed-edge pairing, exact vertex comparison
 *   where       Moller-Trumbore intervals along a line, in metres
 *   sight       ray casting through the opening
 *
 * The interval oracle is the one that matters here. Volume alone cannot tell a
 * doubled corner from a corner with a gap beside it — the two errors cancel —
 * so the corner is checked by reading the material out along 160 lines per
 * height and comparing it to the L-shaped cross-section written down in metres.
 */
import { describe, expect, it } from 'vitest'
import type { Mat3, Vec3 } from '../src/core/contracts/geometry.js'
import { mat3apply } from '../src/core/math/vec.js'
import { SOLID_PARTS, wallFrame, type CompiledTri, type WallSpec } from '../src/core/wallspec/contracts.js'
import { compileJunctions, exposedWallAreaM2, type JunctionCompileInput, type WallJunctionSpec } from '../src/core/wallspec/junction.js'
import {
  CORNER_HEIGHT_M,
  CORNER_OPENING_HEIGHT_M,
  CORNER_OPENING_OFFSET_M,
  CORNER_OPENING_SILL_M,
  CORNER_OPENING_WIDTH_M,
  CORNER_POINT,
  CORNER_ROTATION,
  CORNER_THICKNESS_M,
  CORNER_TRANSLATION,
  EXPECTED_CORNER_VOLUME_M3,
  EXPECTED_CORNER_VOLUME_WITH_OPENING_M3,
  INNER_X,
  INNER_Z,
  JUNCTION_ID,
  WALL_A_ID,
  WALL_A_LENGTH_M,
  WALL_B_ID,
  WALL_B_LENGTH_M,
  cornerInput,
  cornerJunction,
  cornerOpening,
  cornerWallA,
  cornerWallB,
  distantWalls,
  nonOwner,
  type CornerOwner,
} from '../src/core/wallspec/junction-fixtures.js'
import {
  intervalsOverlapLength,
  manifoldReport,
  mergeIntervals,
  meshArea,
  meshVolume,
  rayHits,
  rayIntervals,
  surfaceCrossings as crossings,
  type Interval,
} from './geometry-oracles.js'

/** See the note in `wall-compiler.test.ts`: the oracle's own rounding is ~1e-13. */
const VOLUME_TOL_M3 = 1e-6
/** Contact between two closed solids is an interface of zero thickness. */
const CONTACT_TOL_M = 1e-9

const OWNERS: CornerOwner[] = ['A', 'B']
const wallIdOf = (w: CornerOwner): string => (w === 'A' ? WALL_A_ID : WALL_B_ID)

const solidOnly = (tris: readonly CompiledTri[]): CompiledTri[] =>
  tris.filter((t) => SOLID_PARTS.includes(t.part))
const ofWall = (tris: readonly CompiledTri[], id: string): CompiledTri[] =>
  tris.filter((t) => t.wallId === id)

/** World point back into its wall's local (a along u, b along up, c inward). */
function toLocal(w: WallSpec, p: Vec3): { a: number; b: number; c: number } {
  const f = wallFrame(w)
  const d = { x: p.x - w.origin.x, y: p.y - w.origin.y, z: p.z - w.origin.z }
  return {
    a: d.x * f.u.x + d.y * f.u.y + d.z * f.u.z,
    b: d.x * f.up.x + d.y * f.up.y + d.z * f.up.z,
    c: -(d.x * f.n.x + d.y * f.n.y + d.z * f.n.z),
  }
}

/** Every emitted vertex in wall-local coordinates, to the nanometre, sorted. */
function localVertexSignature(w: WallSpec, tris: readonly CompiledTri[]): string[] {
  const nm = (x: number): string => (Number(x.toFixed(9)) + 0).toFixed(9)
  const out = new Set<string>()
  for (const t of tris) {
    for (const p of [t.a, t.b, t.c]) {
      const l = toLocal(w, p)
      out.add(`${nm(l.a)},${nm(l.b)},${nm(l.c)}`)
    }
  }
  return [...out].sort()
}

// --------------------------------------------------------------------------
// Scanning the assembly.
//
// Scan lines are defined in the fixture's nominal frame and then carried
// through whatever rigid motion the case applies, so the *expected* interval
// set never changes. A rigid motion preserves distance along a ray, which is
// what makes "0.45 m of material here" a frame-independent statement.
// --------------------------------------------------------------------------

type Rigid = { rotation: Mat3; translation: Vec3 }

/** The nominal coordinate a scan starts from, well outside the assembly. */
const SCAN_START = -2

function scanIntervals(
  tris: readonly CompiledTri[],
  axis: 'X' | 'Z',
  across: number,
  y: number,
  rigid?: Rigid,
): Interval[] {
  const origin: Vec3 =
    axis === 'Z' ? { x: across, y, z: SCAN_START } : { x: SCAN_START, y, z: across }
  const dir: Vec3 = axis === 'Z' ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 }
  const o = rigid
    ? (() => {
        const r = mat3apply(rigid.rotation, origin)
        return { x: r.x + rigid.translation.x, y: r.y + rigid.translation.y, z: r.z + rigid.translation.z }
      })()
    : origin
  const d = rigid ? mat3apply(rigid.rotation, dir) : dir
  // Back into the nominal coordinate along the scan axis: t is a distance, and
  // a rigid motion does not change it.
  return rayIntervals(tris, o, d).map((i) => ({ t0: i.t0 + SCAN_START, t1: i.t1 + SCAN_START }))
}

/**
 * Material intervals of the whole assembly, read one closed solid at a time.
 *
 * Not a scan of the combined triangle list. Two solids in contact share a
 * plane, and a combined list reports that plane as a single crossing where
 * there are two surfaces — one leaving the first solid, one entering the
 * second. Reading each solid separately and merging afterwards is both correct
 * and the honest shape of the contract: this stage produces separate closed
 * solids in contact, not one boolean union.
 */
function unionIntervals(
  tris: readonly CompiledTri[],
  axis: 'X' | 'Z',
  across: number,
  y: number,
  rigid?: Rigid,
): Interval[] {
  const byWall = new Map<string, CompiledTri[]>()
  for (const t of tris) {
    const list = byWall.get(t.wallId) ?? []
    list.push(t)
    byWall.set(t.wallId, list)
  }
  return mergeIntervals(
    [...byWall.values()].flatMap((wallTris) => scanIntervals(wallTris, axis, across, y, rigid)),
  )
}

const show = (list: readonly Interval[]): string =>
  list.map((i) => `[${i.t0.toFixed(6)}, ${i.t1.toFixed(6)}]`).join(' ') || '(none)'

/**
 * The L-shaped cross-section, stated in metres rather than computed.
 *
 * Scanning along +Z, a line inboard of the corner meets only wall A's slab;
 * a line within wall B's thickness meets the whole depth of the building.
 * Scanning along +X, the same by symmetry. This is the shape the two walls are
 * *supposed* to occupy, and it is identical for both owner variants — which is
 * the concrete meaning of "the same occupied union geometry".
 */
function expectedL(axis: 'X' | 'Z', across: number): Interval[] {
  const throughThickness = axis === 'Z' ? across > INNER_X : across > INNER_Z
  if (throughThickness) return [{ t0: 0, t1: axis === 'Z' ? WALL_B_LENGTH_M : WALL_A_LENGTH_M }]
  return axis === 'Z'
    ? [{ t0: INNER_Z, t1: WALL_B_LENGTH_M }]
    : [{ t0: INNER_X, t1: WALL_A_LENGTH_M }]
}

/** Scan positions that avoid every face plane and every opening edge. */
const SWEEP: number[] = Array.from({ length: 80 }, (_, i) => 0.025 + i * 0.05)
/** Heights clear of the opening band (0.80..1.80 m). */
const CLEAR_LEVELS = [0.3, 2.5]

const expectIntervals = (actual: readonly Interval[], expected: readonly Interval[], what: string): void => {
  expect(actual.length, `${what}: ${show(actual)} vs ${show(expected)}`).toBe(expected.length)
  for (let i = 0; i < expected.length; i++) {
    expect(actual[i].t0, `${what} start ${i}`).toBeCloseTo(expected[i].t0, 9)
    expect(actual[i].t1, `${what} end ${i}`).toBeCloseTo(expected[i].t1, 9)
  }
}

// --------------------------------------------------------------------------

describe('wall junction ownership — the corner is emitted exactly once', () => {
  it('1. compiles both owner variants with no diagnostic, and trims only the non-owner', () => {
    for (const owner of OWNERS) {
      const result = compileJunctions(cornerInput({ owner, openingOn: 'NONE' }))
      expect(result.diagnostics, `owner ${owner}`).toEqual([])
      expect(result.junctions).toHaveLength(1)

      const j = result.junctions[0]
      expect(j.junctionId).toBe(JUNCTION_ID)
      expect(j.ownerWallId).toBe(wallIdOf(owner))
      expect(j.trimmedWallId).toBe(wallIdOf(nonOwner(owner)))
      expect(j.trimM).toBeCloseTo(CORNER_THICKNESS_M, 12)
      expect(j.cornerVolumeM3).toBeCloseTo(CORNER_THICKNESS_M ** 2 * CORNER_HEIGHT_M, 12)
      expect(j.cornerPoint).toEqual(CORNER_POINT)

      // The owner keeps its nominal extent; the non-owner loses exactly the
      // owner's thickness, at the joined end and nowhere else.
      const extent = (id: string) => result.extents.find((e) => e.wallId === id)!
      expect(extent(j.ownerWallId).a0).toBe(0)
      expect(extent(j.ownerWallId).a1).toBe(owner === 'A' ? WALL_A_LENGTH_M : WALL_B_LENGTH_M)
      const trimmed = extent(j.trimmedWallId)
      expect(trimmed.a1 - trimmed.a0).toBeCloseTo(WALL_A_LENGTH_M - CORNER_THICKNESS_M, 12)
      expect(j.trimmedEnd === 'START' ? trimmed.a0ContactId : trimmed.a1ContactId).toBe(JUNCTION_ID)
    }
  })

  it('2. measures 10.1925 m3 without openings and 9.7425 m3 with the hosted opening', () => {
    expect(EXPECTED_CORNER_VOLUME_M3).toBeCloseTo(10.1925, 12)
    expect(EXPECTED_CORNER_VOLUME_WITH_OPENING_M3).toBeCloseTo(9.7425, 12)

    for (const owner of OWNERS) {
      for (const [openingOn, expected] of [
        ['NONE', EXPECTED_CORNER_VOLUME_M3],
        ['NON_OWNER', EXPECTED_CORNER_VOLUME_WITH_OPENING_M3],
      ] as const) {
        const result = compileJunctions(cornerInput({ owner, openingOn }))
        const a = ofWall(solidOnly(result.tris), WALL_A_ID)
        const b = ofWall(solidOnly(result.tris), WALL_B_ID)
        const what = `owner ${owner}, opening ${openingOn}`

        // Each wall is its own closed, outward-wound solid. A global boolean
        // union is not required; two watertight solids in contact are.
        for (const [id, tris] of [['A', a], ['B', b]] as const) {
          const m = manifoldReport(tris)
          expect(m.boundaryEdges, `${what}: wall ${id} boundary`).toEqual([])
          expect(m.duplicateEdges, `${what}: wall ${id} winding`).toEqual([])
          expect(meshVolume(tris), `${what}: wall ${id} orientation`).toBeGreaterThan(0)
        }
        expect(meshVolume(a) + meshVolume(b), what).toBeCloseTo(expected, 9)
      }
    }
  })

  it('3. leaves no positive-volume overlap — the two solids share an interface, not material', () => {
    for (const owner of OWNERS) {
      const result = compileJunctions(cornerInput({ owner }))
      const a = ofWall(solidOnly(result.tris), WALL_A_ID)
      const b = ofWall(solidOnly(result.tris), WALL_B_ID)
      let worst = 0
      for (const y of [...CLEAR_LEVELS, 1.3]) {
        for (const axis of ['X', 'Z'] as const) {
          for (const across of SWEEP) {
            const overlap = intervalsOverlapLength(
              scanIntervals(a, axis, across, y),
              scanIntervals(b, axis, across, y),
            )
            worst = Math.max(worst, overlap)
            expect(overlap, `owner ${owner}, ${axis} scan at ${across}, y ${y}`).toBeLessThan(CONTACT_TOL_M)
          }
        }
      }
      // ...and the walls really do touch, so the check above is not passing
      // because they were pulled apart. Volume additivity says the same thing
      // globally: two solids that shared material would sum to more than the
      // union, and two with a gap between them to less.
      expect(worst).toBeLessThan(CONTACT_TOL_M)
      expect(meshVolume(a) + meshVolume(b)).toBeCloseTo(EXPECTED_CORNER_VOLUME_WITH_OPENING_M3, 9)
    }
  })

  it('4. leaves no gap — every horizontal section is the L, continuous through the corner', () => {
    for (const owner of OWNERS) {
      const solid = solidOnly(compileJunctions(cornerInput({ owner })).tris)
      for (const y of CLEAR_LEVELS) {
        for (const axis of ['X', 'Z'] as const) {
          for (const across of SWEEP) {
            expectIntervals(
              unionIntervals(solid, axis, across, y),
              expectedL(axis, across),
              `owner ${owner}, ${axis} at ${across}, y ${y}`,
            )
          }
        }
      }
    }
  })

  it('4b. is continuous across the corner itself, at 1 mm either side of the inner face', () => {
    // The one place a butt junction can fail quietly: a hairline between the
    // trimmed end and the owner's material. Scanned at 1 mm spacing the union
    // must step from the 0.45 m slab to the full 4 m depth with nothing missing
    // in between.
    for (const owner of OWNERS) {
      const solid = solidOnly(compileJunctions(cornerInput({ owner, openingOn: 'NONE' })).tris)
      for (const y of [0.05, 1.5, 2.95]) {
        for (let d = 1; d <= 20; d++) {
          const before = INNER_X - d * 0.001
          const after = INNER_X + d * 0.001
          expectIntervals(
            unionIntervals(solid, 'Z', before, y),
            [{ t0: INNER_Z, t1: WALL_B_LENGTH_M }],
            `owner ${owner}, ${d} mm inboard of the corner, y ${y}`,
          )
          expectIntervals(
            unionIntervals(solid, 'Z', after, y),
            [{ t0: 0, t1: WALL_B_LENGTH_M }],
            `owner ${owner}, ${d} mm into the corner, y ${y}`,
          )
        }
      }
    }
  })

  it('5. gives both owner variants the same occupied geometry and the same exterior boundary', () => {
    const measure = (owner: CornerOwner) => {
      const result = compileJunctions(cornerInput({ owner, openingOn: 'B' }))
      const solid = solidOnly(result.tris)
      const sections = CLEAR_LEVELS.flatMap((y) =>
        (['X', 'Z'] as const).flatMap((axis) =>
          SWEEP.map((across) => show(unionIntervals(solid, axis, across, y))),
        ),
      )
      return {
        volume: meshVolume(ofWall(solid, WALL_A_ID)) + meshVolume(ofWall(solid, WALL_B_ID)),
        sections,
        exposed: exposedWallAreaM2(solid),
      }
    }
    const a = measure('A')
    const b = measure('B')

    // Same total volume, same exterior boundary, same exposed area. The corner
    // material is assigned to a different wall in each variant and that is the
    // only difference: an ownership variant is a bookkeeping choice, not a
    // different building.
    expect(Math.abs(a.volume - b.volume)).toBeLessThan(VOLUME_TOL_M3)
    expect(a.volume).toBeCloseTo(EXPECTED_CORNER_VOLUME_WITH_OPENING_M3, 9)
    expect(b.sections).toEqual(a.sections)
    expect(b.exposed).toBeCloseTo(a.exposed, 9)

    // ...while the semantic owner genuinely differs.
    const owners = OWNERS.map((o) => compileJunctions(cornerInput({ owner: o })).junctions[0])
    expect(owners[0].ownerWallId).toBe(WALL_A_ID)
    expect(owners[1].ownerWallId).toBe(WALL_B_ID)
    expect(owners[0].trimmedWallId).not.toBe(owners[1].trimmedWallId)
  })

  it('6. keeps the hosted opening at its own wall-local coordinates', () => {
    for (const owner of OWNERS) {
      const host = nonOwner(owner)
      const result = compileJunctions(cornerInput({ owner, openingOn: 'NON_OWNER' }))
      const hostWall = host === 'A' ? cornerWallA() : cornerWallB()
      const opening = result.tris.filter((t) => t.openingId === 'win')
      expect(opening.length, `owner ${owner}`).toBe(10) // 8 reveal + 2 glazing

      const locals = opening.flatMap((t) => [t.a, t.b, t.c]).map((p) => toLocal(hostWall, p))
      const us = locals.map((l) => l.a)
      const ups = locals.map((l) => l.b)
      const what = `owner ${owner}, host ${host}`
      expect(Math.min(...us), what).toBeCloseTo(CORNER_OPENING_OFFSET_M, 9)
      expect(Math.max(...us), what).toBeCloseTo(CORNER_OPENING_OFFSET_M + CORNER_OPENING_WIDTH_M, 9)
      expect(Math.min(...ups), what).toBeCloseTo(CORNER_OPENING_SILL_M, 9)
      expect(Math.max(...ups), what).toBeCloseTo(CORNER_OPENING_SILL_M + CORNER_OPENING_HEIGHT_M, 9)
      // The brief's numbers, written out: u 1.50..2.50, up 0.80..1.80.
      expect([Math.min(...us), Math.max(...us)]).toEqual([1.5, 2.5])
      expect([Math.min(...ups), Math.max(...ups)]).toEqual([0.8, 1.8])
      // Through the full thickness, not renormalised to the trimmed extent.
      expect(Math.min(...locals.map((l) => l.c))).toBeCloseTo(0, 9)
      expect(Math.max(...locals.map((l) => l.c))).toBeCloseTo(CORNER_THICKNESS_M, 9)
    }
  })

  it('6b. does not move the opening when ownership moves under it', () => {
    // The same opening on the same wall, compiled once with that wall owning
    // the corner and once with it trimmed. If the trim were implemented by
    // shortening `lengthM`, the opening would slide by 0.45 m here.
    const signature = (owner: CornerOwner): string[] => {
      const result = compileJunctions(cornerInput({ owner, openingOn: 'B' }))
      return localVertexSignature(cornerWallB(), result.tris.filter((t) => t.openingId === 'win'))
    }
    expect(signature('B')).toEqual(signature('A'))

    // And the input record was not rewritten to make that true.
    const input = cornerInput({ owner: 'A', openingOn: 'B' })
    compileJunctions(input)
    expect(input.openings[0].offsetM).toBe(CORNER_OPENING_OFFSET_M)
    expect(input.walls[1].lengthM).toBe(WALL_B_LENGTH_M)
  })

  it('7. sees through the opening and into material beside it', () => {
    for (const owner of OWNERS) {
      const host = nonOwner(owner)
      const hostWall = host === 'A' ? cornerWallA() : cornerWallB()
      const result = compileJunctions(cornerInput({ owner, openingOn: 'NON_OWNER' }))
      const solid = solidOnly(result.tris)
      const glazing = result.tris.filter((t) => t.part === 'GLAZING')
      const f = wallFrame(hostWall)
      const inward = { x: -f.n.x, y: -f.n.y, z: -f.n.z }
      const shootAt = (a: number, b: number): Vec3 => ({
        x: hostWall.origin.x + f.u.x * a + f.up.x * b + f.n.x,
        y: hostWall.origin.y + f.u.y * a + f.up.y * b + f.n.y,
        z: hostWall.origin.z + f.u.z * a + f.up.z * b + f.n.z,
      })
      const centreA = CORNER_OPENING_OFFSET_M + CORNER_OPENING_WIDTH_M / 2
      const centreB = CORNER_OPENING_SILL_M + CORNER_OPENING_HEIGHT_M / 2
      const what = `owner ${owner}`

      // Through the centre: no wall material at all, and exactly one pane.
      expect(crossings(rayHits(solid, shootAt(centreA, centreB), inward)), what).toBe(0)
      expect(crossings(rayHits(glazing, shootAt(centreA, centreB), inward)), what).toBe(1)

      // Beside, below and above it: in one face and out of the other.
      for (const [a, b, where] of [
        [CORNER_OPENING_OFFSET_M - 0.05, centreB, '50 mm outside the jamb'],
        [CORNER_OPENING_OFFSET_M + CORNER_OPENING_WIDTH_M + 0.05, centreB, '50 mm past the far jamb'],
        [centreA, CORNER_OPENING_SILL_M - 0.05, '50 mm below the sill'],
        [centreA, CORNER_OPENING_SILL_M + CORNER_OPENING_HEIGHT_M + 0.05, '50 mm above the head'],
      ] as Array<[number, number, string]>) {
        expect(crossings(rayHits(solid, shootAt(a, b), inward)), `${what}, ${where}`).toBe(2)
      }
      // ...and 50 mm the other side of the jamb there is nothing.
      expect(crossings(rayHits(solid, shootAt(CORNER_OPENING_OFFSET_M + 0.05, centreB), inward)), what).toBe(0)
    }
  })

  it('7b. interrupts the horizontal section exactly across the opening, and nowhere else', () => {
    // Owner A, opening on wall B. B runs -Z from z = 4, so its opening at
    // u = 1.50..2.50 is at z = 1.50..2.50, a long way from the corner.
    const solid = solidOnly(compileJunctions(cornerInput({ owner: 'A' })).tris)
    const through = 3.8 // inside wall B's thickness
    expectIntervals(
      unionIntervals(solid, 'Z', through, 1.3),
      [{ t0: 0, t1: 1.5 }, { t0: 2.5, t1: WALL_B_LENGTH_M }],
      'at opening mid-height',
    )
    // 1 mm below the sill the wall is whole again.
    expectIntervals(
      unionIntervals(solid, 'Z', through, CORNER_OPENING_SILL_M - 0.001),
      [{ t0: 0, t1: WALL_B_LENGTH_M }],
      'just below the sill',
    )
    // A line across the opening meets nothing at all.
    expect(unionIntervals(solid, 'X', 2.0, 1.3)).toEqual([])
  })

  it('8. survives a rigid rotation and translation with no wall axis left on a world axis', () => {
    const rigid: Rigid = { rotation: CORNER_ROTATION, translation: CORNER_TRANSLATION }
    for (const owner of OWNERS) {
      const here = compileJunctions(cornerInput({ owner }))
      const there = compileJunctions(cornerInput({ owner, ...rigid }))
      const what = `owner ${owner}`

      expect(there.diagnostics, what).toEqual([])
      // Junction semantics unchanged: same owner, same trimmed wall, same trim.
      expect(there.junctions.map((j) => ({ ...j, cornerPoint: undefined }))).toEqual(
        here.junctions.map((j) => ({ ...j, cornerPoint: undefined })),
      )
      expect(there.extents).toEqual(here.extents)

      const solidThere = solidOnly(there.tris)
      const solidHere = solidOnly(here.tris)
      expect(
        meshVolume(ofWall(solidThere, WALL_A_ID)) + meshVolume(ofWall(solidThere, WALL_B_ID)),
        what,
      ).toBeCloseTo(EXPECTED_CORNER_VOLUME_WITH_OPENING_M3, 9)
      expect(meshArea(solidThere), what).toBeCloseTo(meshArea(solidHere), 9)

      // Local geometry unchanged, wall by wall, to the nanometre.
      for (const [id, spec] of [[WALL_A_ID, cornerWallA()], [WALL_B_ID, cornerWallB()]] as const) {
        const moved = cornerInput({ owner, ...rigid }).walls.find((w) => w.id === id)!
        expect(
          localVertexSignature(moved, ofWall(there.tris, id)),
          `${what}, wall ${id}`,
        ).toEqual(localVertexSignature(spec, ofWall(here.tris, id)))
      }

      // The L cross-section is still the L, measured on scan lines carried
      // through the same motion.
      for (const axis of ['X', 'Z'] as const) {
        for (const across of SWEEP) {
          expectIntervals(
            unionIntervals(solidThere, axis, across, 0.3, rigid),
            expectedL(axis, across),
            `${what} rotated, ${axis} at ${across}`,
          )
        }
      }
      // ...and the assembly really did move.
      expect(there.tris[0].a.x).not.toBeCloseTo(here.tris[0].a.x, 3)
    }
  })

  it('9. depends on nothing outside the two walls it joins', () => {
    for (const owner of OWNERS) {
      const alone = compileJunctions(cornerInput({ owner }))
      const crowded = compileJunctions(cornerInput({ owner, extraWalls: distantWalls() }))
      const mine = (r: typeof alone): CompiledTri[] =>
        r.tris.filter((t) => t.wallId === WALL_A_ID || t.wallId === WALL_B_ID)

      // 900 m walls, 500 m away, 40 m high: a bounding box a hundred times the
      // size of the corner. Triangle for triangle, nothing moves.
      expect(mine(crowded), `owner ${owner}`).toEqual(mine(alone))
      expect(crowded.junctions).toEqual(alone.junctions)
      expect(crowded.diagnostics).toEqual([])
      expect(crowded.extents.filter((e) => e.wallId.startsWith('wall_'))).toEqual(alone.extents)
    }
  })

  it('10. does not touch its input, and compiles the same input the same way twice', () => {
    const input = cornerInput({ owner: 'A' })
    const deepFreeze = (v: unknown): void => {
      if (v && typeof v === 'object') {
        Object.freeze(v)
        for (const x of Object.values(v as Record<string, unknown>)) deepFreeze(x)
      }
    }
    deepFreeze(input)
    const before = JSON.stringify(input)
    const first = compileJunctions(input)
    const second = compileJunctions(input)

    expect(JSON.stringify(input)).toBe(before)
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
    expect(second.tris).toEqual(first.tris)
    expect(second.junctions).toEqual(first.junctions)
    expect(second.extents).toEqual(first.extents)
    // Stable semantic identity: the junction is named by its own id, and the
    // contact face carries it.
    expect(first.junctions[0].junctionId).toBe(JUNCTION_ID)
    expect(first.tris.filter((t) => t.contactId).every((t) => t.contactId === JUNCTION_ID)).toBe(true)
  })

  it('11. marks the contact face so exposed-area logic does not read it as facade', () => {
    for (const owner of OWNERS) {
      const result = compileJunctions(cornerInput({ owner, openingOn: 'NONE' }))
      const solid = solidOnly(result.tris)
      const contact = solid.filter((t) => t.contactId === JUNCTION_ID)
      const what = `owner ${owner}`

      expect(contact.length, what).toBe(2) // one face, two triangles
      expect(contact.every((t) => t.wallId === result.junctions[0].trimmedWallId), what).toBe(true)
      // Thickness by height — one whole wall section, pressed against the owner.
      expect(meshArea(contact), what).toBeCloseTo(CORNER_THICKNESS_M * CORNER_HEIGHT_M, 9)
      expect(meshArea(contact), what).toBeCloseTo(result.junctions[0].contactAreaM2, 9)

      // The measure excludes it; the naive total does not. Without the tag a
      // corner would add 1.35 m2 of facade that nobody can see or paint.
      expect(exposedWallAreaM2(solid), what).toBeCloseTo(meshArea(solid) - meshArea(contact), 9)
      expect(meshArea(solid) - exposedWallAreaM2(solid), what).toBeCloseTo(1.35, 9)

      // Nothing else is tagged: the owner's end face at the same corner is real
      // exterior fabric and stays counted.
      const ownerTris = ofWall(solid, result.junctions[0].ownerWallId)
      expect(ownerTris.some((t) => t.contactId), what).toBe(false)
    }
  })
})

// --------------------------------------------------------------------------

describe('wall junction ownership — refusals', () => {
  const withJunction = (j: WallJunctionSpec, walls?: readonly WallSpec[]): JunctionCompileInput => ({
    walls: walls ?? [cornerWallA(), cornerWallB()],
    openings: [],
    glazing: [],
    junctions: [j],
  })

  const cases: Array<[string, JunctionCompileInput, string]> = [
    [
      'missing wall id',
      withJunction({ ...cornerJunction('A'), wallBId: 'nope' }),
      'UNKNOWN_JUNCTION_WALL',
    ],
    [
      'the same wall on both sides',
      withJunction({ ...cornerJunction('A'), wallBId: WALL_A_ID, wallBEnd: 'START' }),
      'JUNCTION_SELF_REFERENCE',
    ],
    [
      'owner is neither wall',
      withJunction({ ...cornerJunction('A'), ownerWallId: 'wall_c' }),
      'JUNCTION_OWNER_NOT_A_MEMBER',
    ],
    [
      'ends a metre apart',
      withJunction(cornerJunction('A'), [
        cornerWallA(),
        { ...cornerWallB(), origin: { x: 4, y: 0, z: 5 } },
      ]),
      'JUNCTION_ENDS_DO_NOT_MEET',
    ],
    [
      'axes at 45 degrees',
      withJunction(cornerJunction('A'), [
        cornerWallA(),
        { ...cornerWallB(), u: { x: -Math.SQRT1_2, y: 0, z: -Math.SQRT1_2 } },
      ]),
      'JUNCTION_NOT_ORTHOGONAL',
    ],
    [
      'a reflex corner, where the walls share no material',
      withJunction({ ...cornerJunction('A'), wallBEnd: 'END' }, [
        cornerWallA(),
        { ...cornerWallB(), origin: { x: 4, y: 0, z: 0 }, u: { x: 0, y: 0, z: 1 } },
      ]),
      'JUNCTION_NOT_EXTERIOR_CORNER',
    ],
    [
      'walls of different heights',
      withJunction(cornerJunction('A'), [cornerWallA(), { ...cornerWallB(), heightM: 2.4 }]),
      'JUNCTION_HEIGHT_MISMATCH',
    ],
    [
      'walls standing on different up axes',
      withJunction(cornerJunction('A'), [
        cornerWallA(),
        { ...cornerWallB(), up: { x: 1, y: 0, z: 0 } },
      ]),
      'JUNCTION_UP_AXES_NOT_ALIGNED',
    ],
    [
      'a corner longer than the wall it trims',
      withJunction(cornerJunction('A'), [cornerWallA(), { ...cornerWallB(), lengthM: 0.3 }]),
      'JUNCTION_TRIM_EXCEEDS_WALL',
    ],
    [
      'a wall whose axes are not orthonormal',
      withJunction(cornerJunction('A'), [
        cornerWallA(),
        { ...cornerWallB(), up: { x: 0.3, y: 1, z: 0 } },
      ]),
      'JUNCTION_WALL_NOT_COMPILABLE',
    ],
    [
      'a kind this stage does not build',
      withJunction({ ...cornerJunction('A'), kind: 'MITRE' as unknown as 'BUTT' }),
      'UNSUPPORTED_JUNCTION_KIND',
    ],
    [
      'the same junction id twice',
      { ...withJunction(cornerJunction('A')), junctions: [cornerJunction('A'), cornerJunction('A')] },
      'DUPLICATE_JUNCTION_ID',
    ],
    [
      'two junctions claiming the same wall end',
      {
        ...withJunction(cornerJunction('A')),
        junctions: [cornerJunction('A'), cornerJunction('B', 'corner_ab_again')],
      },
      'CONFLICTING_JUNCTION_END',
    ],
    [
      'an opening inside the trimmed zone',
      {
        walls: [cornerWallA(), cornerWallB()],
        openings: [{ ...cornerOpening(WALL_B_ID), offsetM: 0.2 }],
        glazing: [],
        junctions: [cornerJunction('A')],
      },
      'OPENING_IN_TRIMMED_ZONE',
    ],
  ]

  it('12. returns a structured diagnostic for every unsupported case, and repairs none of them', () => {
    for (const [what, input, code] of cases) {
      const result = compileJunctions(input)
      expect(result.diagnostics.map((d) => d.code), what).toContain(code)
      for (const d of result.diagnostics) {
        expect(d.message.length, what).toBeGreaterThan(20)
        expect(d.severity, what).toBe('ERROR')
      }
    }
  })

  it('12b. leaves the walls whole and un-trimmed when the junction is refused', () => {
    // A refused junction must not take the geometry with it, and must not
    // half-apply: no trim, no contact face, full nominal volume on both walls.
    const result = compileJunctions(
      withJunction({ ...cornerJunction('A'), ownerWallId: 'wall_c' }),
    )
    expect(result.junctions).toEqual([])
    expect(result.diagnostics.map((d) => d.code)).toEqual(['JUNCTION_OWNER_NOT_A_MEMBER'])
    expect(result.extents).toEqual([
      { wallId: WALL_A_ID, a0: 0, a1: WALL_A_LENGTH_M },
      { wallId: WALL_B_ID, a0: 0, a1: WALL_B_LENGTH_M },
    ])
    expect(result.tris.some((t) => t.contactId)).toBe(false)

    const solid = solidOnly(result.tris)
    const nominal = WALL_A_LENGTH_M * CORNER_HEIGHT_M * CORNER_THICKNESS_M
    expect(meshVolume(ofWall(solid, WALL_A_ID))).toBeCloseTo(nominal, 9)
    expect(meshVolume(ofWall(solid, WALL_B_ID))).toBeCloseTo(nominal, 9)
    // Which is the double-counted corner this stage exists to remove: 10.8 m3
    // against the correct 10.1925.
    expect(meshVolume(ofWall(solid, WALL_A_ID)) + meshVolume(ofWall(solid, WALL_B_ID))).toBeCloseTo(
      EXPECTED_CORNER_VOLUME_M3 + CORNER_THICKNESS_M ** 2 * CORNER_HEIGHT_M,
      9,
    )
  })

  it('12c. refuses an opening in the trim zone by name, without moving or clipping it', () => {
    const input: JunctionCompileInput = {
      walls: [cornerWallA(), cornerWallB()],
      openings: [{ ...cornerOpening(WALL_B_ID), offsetM: 0.2 }],
      glazing: [],
      junctions: [cornerJunction('A')],
    }
    const result = compileJunctions(input)
    expect(result.diagnostics.map((d) => d.code)).toEqual(['OPENING_IN_TRIMMED_ZONE'])
    // No hole, no reveal, no glazing — and the wall is still closed and whole
    // over its trimmed extent rather than partially cut.
    expect(result.tris.filter((t) => t.part === 'REVEAL')).toHaveLength(0)
    expect(result.tris.filter((t) => t.part === 'GLAZING')).toHaveLength(0)
    expect(result.walls.find((w) => w.wallId === WALL_B_ID)!.openingIds).toEqual([])
    const b = ofWall(solidOnly(result.tris), WALL_B_ID)
    expect(manifoldReport(b).closed).toBe(true)
    expect(meshVolume(b)).toBeCloseTo(
      (WALL_B_LENGTH_M - CORNER_THICKNESS_M) * CORNER_HEIGHT_M * CORNER_THICKNESS_M,
      9,
    )
    expect(input.openings[0].offsetM).toBe(0.2)
  })
})
