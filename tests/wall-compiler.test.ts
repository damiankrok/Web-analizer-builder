/**
 * STAGE WEB-PIVOT-01 — wall-local compiler proof.
 *
 * Two halves:
 *
 *  1. a reproduction of the audit counterexample against the *production*
 *     compiler, kept as a standing diagnostic of RC03;
 *  2. the acceptance checks for the new wall-local compiler, all of which read
 *     emitted triangles through the independent oracles in
 *     `tests/geometry-oracles.ts` rather than trusting the compiler's own
 *     bookkeeping.
 *
 * Production behaviour is not changed by this stage. The first half asserts
 * what the current code *does*, not what it should do.
 */
import { describe, expect, it } from 'vitest'
import { buildSolidModel } from '../src/core/hypotheses/solid.js'
import type { BuildingHypothesis } from '../src/core/contracts/hypotheses.js'
import type { Vec3 } from '../src/core/contracts/geometry.js'
import { rectRing } from '../src/core/contracts/geometry.js'
import { compileWalls } from '../src/core/wallspec/compile.js'
import { SOLID_PARTS, wallFrame, type CompiledTri, type WallSpec } from '../src/core/wallspec/contracts.js'
import {
  AWKWARD_ROTATION,
  AWKWARD_TRANSLATION,
  EXPECTED_VOLUME_M3,
  FLUSH_ORIGIN,
  LOWER_MASS,
  OPENING_HEIGHT_M,
  OPENING_OFFSET_M,
  OPENING_SILL_M,
  OPENING_WIDTH_M,
  PANEL_HEIGHT_M,
  PANEL_LENGTH_M,
  PANEL_THICKNESS_M,
  RECESSED_ORIGIN,
  UPPER_MASS,
  auditGlazing,
  auditOpening,
  auditPanel,
  singlePanelInput,
  transformWall,
} from '../src/core/wallspec/fixtures.js'
import { manifoldReport, meshVolume, rayHits, surfaceCrossings as crossings } from './geometry-oracles.js'

/**
 * Volume tolerance.
 *
 * The oracle sums ~100 triple products of coordinates of order 10, so the
 * accumulated rounding is a few ulps of 1e2 — around 1e-13. A micro-cubic-metre
 * is six orders of magnitude above that and still far below any modelling
 * error worth reporting, so a failure here means a real geometric fault.
 */
const VOLUME_TOL_M3 = 1e-6

const solidOnly = (tris: readonly CompiledTri[]): CompiledTri[] =>
  tris.filter((t) => SOLID_PARTS.includes(t.part))

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

/**
 * Every emitted vertex in wall-local coordinates, to the nanometre, sorted.
 *
 * Rounding to 1e-9 m is what makes this comparable across a rotation: a rigid
 * motion and its inverse do not compose to the identity in floating point, and
 * leave residue around 1e-16 m. Adding zero after rounding collapses -0 onto 0,
 * which otherwise prints as a different string for the same point.
 */
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
// 1. RC03 reproduced against the production compiler.
// --------------------------------------------------------------------------

/** The audit's two-mass building, with the upper mass's front wall at `upperMaxZ`. */
function auditHypothesis(upperMaxZ: number, openingS = 2): BuildingHypothesis {
  return {
    id: 'rc03',
    wallThicknessM: PANEL_THICKNESS_M,
    plinthY: 0,
    producedBy: 'rc03-reproduction',
    storeys: [
      { id: 'g', name: 'GROUND', floorY: LOWER_MASS.baseY, ceilingY: LOWER_MASS.topY, authority: 'PLAN_MEASURED' },
      { id: 'u', name: 'UPPER', floorY: UPPER_MASS.baseY, ceilingY: UPPER_MASS.topY, authority: 'PLAN_MEASURED' },
    ],
    masses: [
      {
        id: 'lower',
        kind: 'MAIN_BODY',
        footprint: { holes: [], outer: rectRing(LOWER_MASS.minX, LOWER_MASS.minZ, LOWER_MASS.maxX, LOWER_MASS.maxZ) },
        baseY: LOWER_MASS.baseY,
        topY: LOWER_MASS.topY,
        storeyIds: ['g'],
        authority: 'PLAN_MEASURED',
        confidence: 1,
        evidenceIds: [],
      },
      {
        id: 'upper',
        kind: 'MAIN_BODY',
        footprint: { holes: [], outer: rectRing(UPPER_MASS.minX, UPPER_MASS.minZ, UPPER_MASS.maxX, upperMaxZ) },
        baseY: UPPER_MASS.baseY,
        topY: UPPER_MASS.topY,
        storeyIds: ['u'],
        authority: 'PLAN_MEASURED',
        confidence: 1,
        evidenceIds: [],
      },
    ],
    roofs: [
      { id: 'roof', massId: 'upper', kind: 'FLAT', pitchDeg: 0, eaveY: UPPER_MASS.topY, ridgeY: UPPER_MASS.topY, overhangM: 0, authority: 'PRIOR', confidence: 1 },
    ],
    openings: [],
    openingGroups: [
      {
        id: 'win',
        facade: 'FRONT',
        massId: 'upper',
        kind: 'WINDOW',
        memberIds: [],
        s: openingS,
        sillY: UPPER_MASS.baseY + OPENING_SILL_M,
        widthM: OPENING_WIDTH_M,
        heightM: OPENING_HEIGHT_M,
        panelCount: 1,
        clippedByRoof: false,
        authority: 'ELEVATION_MEASURED',
        confidence: 1,
      },
    ],
    appearance: [],
    constraints: [],
    notes: [],
  }
}

describe('RC03 — global facade attachment in the production compiler', () => {
  it('drops a valid opening on a recessed wall, and keeps the same opening when the wall is flush', () => {
    const recessed = buildSolidModel(auditHypothesis(UPPER_MASS.maxZ))
    const flush = buildSolidModel(auditHypothesis(LOWER_MASS.maxZ))

    // The counterexample. If this ever fails because the recessed case now
    // produces geometry, RC03 has been fixed in production and this diagnostic
    // should be rewritten as a passing case rather than deleted.
    expect(recessed.quantities.openingCount).toBe(0)
    expect(recessed.tris.filter((t) => t.part === 'GLAZING')).toHaveLength(0)
    expect(recessed.tris.filter((t) => t.part === 'REVEAL')).toHaveLength(0)

    expect(flush.quantities.openingCount).toBe(1)
    expect(flush.tris.filter((t) => t.part === 'GLAZING').length).toBeGreaterThan(0)
  })

  it('switches on the 0.6 m host tolerance, not on anything about the wall', () => {
    // A cliff, not a gradient: the opening is present or absent depending only
    // on how far the host wall sits behind the global facade plane. Raising the
    // constant moves the cliff; it does not make the attachment correct.
    const openingsAt = (z: number): number => buildSolidModel(auditHypothesis(z)).quantities.openingCount
    expect(openingsAt(LOWER_MASS.maxZ - 0.7)).toBe(0)
    expect(openingsAt(LOWER_MASS.maxZ - 0.6)).toBe(1)
  })

  it('measures the along-facade coordinate from the global box, so the same s means different places', () => {
    // Same `s = 2`, same host wall length, different global bounding box: the
    // opening lands at a different position along its own wall. This is why
    // widening the tolerance is the wrong repair — it would make openings
    // reappear in the wrong place rather than not at all.
    const shifted = (upperMinX: number): number => {
      const h = auditHypothesis(LOWER_MASS.maxZ)
      const withInset: BuildingHypothesis = {
        ...h,
        masses: h.masses.map((m) =>
          m.id === 'upper'
            ? { ...m, footprint: { holes: [], outer: rectRing(upperMinX, UPPER_MASS.minZ, UPPER_MASS.maxX, LOWER_MASS.maxZ) } }
            : m,
        ),
      }
      const xs = buildSolidModel(withInset)
        .tris.filter((t) => t.part === 'GLAZING')
        .flatMap((t) => [t.a.x, t.b.x, t.c.x])
      return Math.min(...xs) - upperMinX // offset along the wall's own length
    }
    // Neither the wall's own description nor the opening record changed; only
    // the building's bounding box did. The opening still moves most of two
    // metres along the wall it is supposed to be fixed to.
    expect(shifted(0)).toBeGreaterThan(1.8) // ~the 2.0 m that was asked for
    expect(shifted(0) - shifted(2)).toBeGreaterThan(1.5)
  })

  it('emits a hole whose width disagrees with the opening it was asked for', () => {
    // Even in the flush case that "works": the inner ring is inset in both
    // axes, so it is parametrised over a shorter edge than the outer ring and
    // the cut comes out splayed. The reported quantity is taken from the input
    // record and does not notice.
    const flush = buildSolidModel(auditHypothesis(LOWER_MASS.maxZ))
    const glazing = flush.tris.filter((t) => t.part === 'GLAZING').flatMap((t) => [t.a, t.b, t.c])
    const width = Math.max(...glazing.map((p) => p.x)) - Math.min(...glazing.map((p) => p.x))
    expect(flush.quantities.glazingAreaM2).toBeCloseTo(OPENING_WIDTH_M * OPENING_HEIGHT_M, 6)
    expect(width).toBeLessThan(OPENING_WIDTH_M - 0.05)
  })
})

// --------------------------------------------------------------------------
// 2. The wall-local compiler.
// --------------------------------------------------------------------------

describe('wall-local compiler — acceptance', () => {
  it('1. compiles a recessed wall to the same local geometry as a flush one', () => {
    const recessedWall = auditPanel(RECESSED_ORIGIN)
    const flushWall = auditPanel(FLUSH_ORIGIN)
    const recessed = compileWalls(singlePanelInput(RECESSED_ORIGIN))
    const flush = compileWalls(singlePanelInput(FLUSH_ORIGIN))

    expect(recessed.diagnostics).toEqual([])
    expect(flush.diagnostics).toEqual([])
    // Identical local vertices; only the world transform differs.
    expect(localVertexSignature(recessedWall, recessed.tris)).toEqual(
      localVertexSignature(flushWall, flush.tris),
    )
    // ...and the world geometry really is different, so the comparison above
    // is not comparing a thing with itself.
    expect(recessed.tris[0].c.z).not.toBe(flush.tris[0].c.z)
    expect(FLUSH_ORIGIN.z - RECESSED_ORIGIN.z).toBeCloseTo(1, 12)
  })

  it('2. emits a closed, consistently oriented solid of the expected volume', () => {
    const result = compileWalls(singlePanelInput(RECESSED_ORIGIN))
    const solid = solidOnly(result.tris)
    const report = manifoldReport(solid)

    expect(report.boundaryEdges).toEqual([])
    expect(report.duplicateEdges).toEqual([])
    expect(report.closed).toBe(true)
    expect(report.orientable).toBe(true)
    // Positive means the surface is wound outwards, not inside out.
    expect(meshVolume(solid)).toBeGreaterThan(0)
    expect(meshVolume(solid)).toBeCloseTo(EXPECTED_VOLUME_M3, 9)
    expect(EXPECTED_VOLUME_M3).toBeCloseTo(9.45, 12)
  })

  it('2b. lines the cut with reveals that span the wall thickness', () => {
    const wall = auditPanel(RECESSED_ORIGIN)
    const result = compileWalls(singlePanelInput(RECESSED_ORIGIN))
    const reveals = result.tris.filter((t) => t.part === 'REVEAL')
    expect(reveals.length).toBe(8) // four faces, two triangles each
    const cs = reveals.flatMap((t) => [t.a, t.b, t.c]).map((p) => toLocal(wall, p).c)
    expect(Math.min(...cs)).toBeCloseTo(0, 9)
    expect(Math.max(...cs)).toBeCloseTo(PANEL_THICKNESS_M, 9)
    for (const t of reveals) expect(t.openingId).toBe('win')
  })

  it('3. a ray through the opening centre crosses no wall solid; nearby rays do', () => {
    const wall = auditPanel(RECESSED_ORIGIN)
    const result = compileWalls(singlePanelInput(RECESSED_ORIGIN))
    const solid = solidOnly(result.tris)
    const glazing = result.tris.filter((t) => t.part === 'GLAZING')
    const f = wallFrame(wall)
    const inward = { x: -f.n.x, y: -f.n.y, z: -f.n.z }
    // Start a metre outside the wall and fire straight at it.
    const shootAt = (a: number, b: number): { x: number; y: number; z: number } => {
      const p = {
        x: wall.origin.x + f.u.x * a + f.up.x * b + f.n.x,
        y: wall.origin.y + f.u.y * a + f.up.y * b + f.n.y,
        z: wall.origin.z + f.u.z * a + f.up.z * b + f.n.z,
      }
      return p
    }
    const centreA = OPENING_OFFSET_M + OPENING_WIDTH_M / 2
    const centreB = OPENING_SILL_M + OPENING_HEIGHT_M / 2

    // Through the hole: no material at all, and exactly one pane of glass.
    expect(crossings(rayHits(solid, shootAt(centreA, centreB), inward))).toBe(0)
    expect(crossings(rayHits(glazing, shootAt(centreA, centreB), inward))).toBe(1)

    // Through material: in one face and out of the other, every time.
    const material: Array<[number, number, string]> = [
      [1.0, centreB, 'beside the opening, to the left'],
      [6.0, centreB, 'beside the opening, to the right'],
      [centreA, 0.4, 'below the sill'],
      [centreA, 2.6, 'above the head'],
      [OPENING_OFFSET_M - 0.05, centreB, '50 mm outside the jamb'],
    ]
    for (const [a, b, what] of material) {
      expect(crossings(rayHits(solid, shootAt(a, b), inward)), what).toBe(2)
    }

    // ...and 50 mm the other side of the same jamb there is nothing, so the
    // cut is where it was asked for rather than merely somewhere near it.
    expect(crossings(rayHits(solid, shootAt(OPENING_OFFSET_M + 0.05, centreB), inward))).toBe(0)
  })

  it('3b. a horizontal section at sill height is interrupted exactly across the opening', () => {
    // A second, independent reading of the same fact: sweep a ray along the
    // wall at opening mid-height and record where material starts and stops.
    const wall = auditPanel(RECESSED_ORIGIN)
    const solid = solidOnly(compileWalls(singlePanelInput(RECESSED_ORIGIN)).tris)
    const f = wallFrame(wall)
    const inward = { x: -f.n.x, y: -f.n.y, z: -f.n.z }
    const b = OPENING_SILL_M + OPENING_HEIGHT_M / 2
    const step = 0.005
    const gaps: number[] = []
    for (let a = step; a < PANEL_LENGTH_M; a += step) {
      const p = {
        x: wall.origin.x + f.u.x * a + f.up.x * b + f.n.x,
        y: wall.origin.y + f.u.y * a + f.up.y * b + f.n.y,
        z: wall.origin.z + f.u.z * a + f.up.z * b + f.n.z,
      }
      if (rayHits(solid, p, inward).length === 0) gaps.push(a)
    }
    expect(gaps.length).toBeGreaterThan(0)
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(OPENING_OFFSET_M)
    expect(Math.min(...gaps)).toBeLessThan(OPENING_OFFSET_M + step * 2)
    expect(Math.max(...gaps)).toBeLessThanOrEqual(OPENING_OFFSET_M + OPENING_WIDTH_M)
    expect(Math.max(...gaps)).toBeGreaterThan(OPENING_OFFSET_M + OPENING_WIDTH_M - step * 2)
  })

  it('4. keeps glazing separate from the wall solid, inside the opening', () => {
    const wall = auditPanel(RECESSED_ORIGIN)
    const result = compileWalls(singlePanelInput(RECESSED_ORIGIN))
    const glazing = result.tris.filter((t) => t.part === 'GLAZING')
    expect(glazing).toHaveLength(2)
    for (const t of glazing) {
      expect(t.openingId).toBe('win')
      expect(t.ownerId).toBe('glass')
      for (const p of [t.a, t.b, t.c]) {
        const l = toLocal(wall, p)
        expect(l.c).toBeCloseTo(PANEL_THICKNESS_M / 2, 9)
        expect(l.a).toBeGreaterThanOrEqual(OPENING_OFFSET_M - 1e-9)
        expect(l.a).toBeLessThanOrEqual(OPENING_OFFSET_M + OPENING_WIDTH_M + 1e-9)
        expect(l.b).toBeGreaterThanOrEqual(OPENING_SILL_M - 1e-9)
        expect(l.b).toBeLessThanOrEqual(OPENING_SILL_M + OPENING_HEIGHT_M + 1e-9)
      }
    }
    // The glazing is excluded from the volume test because it is not part of
    // the closed surface: adding it opens the mesh.
    expect(manifoldReport(result.tris).closed).toBe(false)
    expect(manifoldReport(solidOnly(result.tris)).closed).toBe(true)
  })

  it('5. is unaffected by a rigid translation and rotation', () => {
    const base = auditPanel(RECESSED_ORIGIN)
    const moved = transformWall(base, AWKWARD_ROTATION, AWKWARD_TRANSLATION)
    const here = compileWalls(singlePanelInput(RECESSED_ORIGIN))
    const there = compileWalls({ walls: [moved], openings: [auditOpening()], glazing: [auditGlazing()] })

    expect(there.diagnostics).toEqual([])
    expect(meshVolume(solidOnly(there.tris))).toBeCloseTo(EXPECTED_VOLUME_M3, 9)
    expect(
      Math.abs(meshVolume(solidOnly(there.tris)) - meshVolume(solidOnly(here.tris))),
    ).toBeLessThan(VOLUME_TOL_M3)
    expect(manifoldReport(solidOnly(there.tris)).closed).toBe(true)
    // The opening is in the same place on its own wall, to nanometres.
    const a = localVertexSignature(base, here.tris)
    const b = localVertexSignature(moved, there.tris)
    expect(b).toEqual(a)
    // The wall really did move.
    expect(there.tris[0].a.x).not.toBeCloseTo(here.tris[0].a.x, 3)
  })

  it('5b. depends on nothing outside the wall being compiled', () => {
    // The same panel, compiled alone and compiled beside four much larger
    // walls. If any global frame were involved, adding neighbours would move
    // something.
    const alone = compileWalls(singlePanelInput(RECESSED_ORIGIN))
    const crowd = compileWalls({
      walls: [
        auditPanel(RECESSED_ORIGIN),
        { ...auditPanel({ x: -400, y: -90, z: -400 }, 'far_a'), lengthM: 900 },
        { ...auditPanel({ x: 400, y: 90, z: 400 }, 'far_b'), lengthM: 900 },
      ],
      openings: [auditOpening()],
      glazing: [auditGlazing()],
    })
    const mine = crowd.tris.filter((t) => t.wallId === 'panel')
    expect(mine).toEqual(alone.tris)
  })

  it('6. reports every rejection explicitly instead of dropping geometry', () => {
    const cases: Array<[string, Parameters<typeof compileWalls>[0], string]> = [
      [
        'missing host',
        { walls: [auditPanel(RECESSED_ORIGIN)], openings: [{ ...auditOpening(), hostWallId: 'nope' }], glazing: [] },
        'UNKNOWN_HOST_WALL',
      ],
      [
        'opening past the end of its host',
        { walls: [auditPanel(RECESSED_ORIGIN)], openings: [{ ...auditOpening(), offsetM: 7.5 }], glazing: [] },
        'OPENING_OUTSIDE_HOST',
      ],
      [
        'opening above the head of its host',
        { walls: [auditPanel(RECESSED_ORIGIN)], openings: [{ ...auditOpening(), sillM: 2.0 }], glazing: [] },
        'OPENING_OUTSIDE_HOST',
      ],
      [
        'opening flush with the wall base',
        { walls: [auditPanel(RECESSED_ORIGIN)], openings: [{ ...auditOpening(), sillM: 0 }], glazing: [] },
        'OPENING_TOUCHES_WALL_EDGE',
      ],
      [
        'duplicate wall id',
        { walls: [auditPanel(RECESSED_ORIGIN), auditPanel(FLUSH_ORIGIN)], openings: [], glazing: [] },
        'DUPLICATE_WALL_ID',
      ],
      [
        'duplicate opening id',
        {
          walls: [auditPanel(RECESSED_ORIGIN)],
          openings: [auditOpening(), { ...auditOpening(), offsetM: 5 }],
          glazing: [],
        },
        'DUPLICATE_OPENING_ID',
      ],
      [
        'non-orthonormal axes',
        { walls: [{ ...auditPanel(RECESSED_ORIGIN), up: { x: 0.3, y: 1, z: 0 } }], openings: [], glazing: [] },
        'NON_ORTHONORMAL_AXES',
      ],
      [
        'zero thickness',
        { walls: [{ ...auditPanel(RECESSED_ORIGIN), thicknessM: 0 }], openings: [], glazing: [] },
        'INVALID_WALL_DIMENSION',
      ],
      [
        'negative opening width',
        { walls: [auditPanel(RECESSED_ORIGIN)], openings: [{ ...auditOpening(), widthM: -1 }], glazing: [] },
        'INVALID_OPENING_DIMENSION',
      ],
      [
        'overlapping openings',
        {
          walls: [auditPanel(RECESSED_ORIGIN)],
          openings: [auditOpening(), { ...auditOpening('panel', 'win2'), offsetM: 3 }],
          glazing: [],
        },
        'OVERLAPPING_OPENINGS',
      ],
      [
        'glazing deeper than the wall',
        {
          walls: [auditPanel(RECESSED_ORIGIN)],
          openings: [auditOpening()],
          glazing: [{ ...auditGlazing(), insetM: 1.2 }],
        },
        'GLAZING_OUTSIDE_THICKNESS',
      ],
      [
        'glazing for an opening that was not compiled',
        { walls: [auditPanel(RECESSED_ORIGIN)], openings: [], glazing: [auditGlazing()] },
        'UNKNOWN_GLAZING_OPENING',
      ],
      [
        'duplicate glazing id',
        {
          walls: [auditPanel(RECESSED_ORIGIN)],
          openings: [auditOpening()],
          glazing: [auditGlazing(), { ...auditGlazing(), insetM: 0.1 }],
        },
        'DUPLICATE_GLAZING_ID',
      ],
    ]
    for (const [what, input, code] of cases) {
      const result = compileWalls(input)
      expect(result.diagnostics.map((d) => d.code), what).toContain(code)
      for (const d of result.diagnostics) expect(d.message.length, what).toBeGreaterThan(10)
    }
  })

  it('6b. still compiles the wall when only its opening is rejected', () => {
    // A refused opening must not take the wall with it: the wall is emitted
    // whole, and the diagnostic says why there is no hole in it.
    const result = compileWalls({
      walls: [auditPanel(RECESSED_ORIGIN)],
      openings: [{ ...auditOpening(), offsetM: 7.5 }],
      glazing: [],
    })
    expect(result.diagnostics.map((d) => d.code)).toEqual(['OPENING_OUTSIDE_HOST'])
    expect(result.walls).toEqual([{ wallId: 'panel', openingIds: [], triCount: result.tris.length }])
    const solid = solidOnly(result.tris)
    expect(manifoldReport(solid).closed).toBe(true)
    expect(meshVolume(solid)).toBeCloseTo(PANEL_LENGTH_M * PANEL_HEIGHT_M * PANEL_THICKNESS_M, 9)
  })

  it('7. does not touch its input, and compiles the same input the same way twice', () => {
    const input = singlePanelInput(RECESSED_ORIGIN)
    const deepFreeze = (v: unknown): void => {
      if (v && typeof v === 'object') {
        Object.freeze(v)
        for (const x of Object.values(v as Record<string, unknown>)) deepFreeze(x)
      }
    }
    deepFreeze(input)
    const before = JSON.stringify(input)
    const first = compileWalls(input)
    const second = compileWalls(input)
    expect(JSON.stringify(input)).toBe(before)
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
    expect(second.tris).toEqual(first.tris)
  })
})
