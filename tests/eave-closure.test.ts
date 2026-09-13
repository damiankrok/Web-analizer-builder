/**
 * STAGE WEB-PIVOT-02A — the eave / sloped-soffit wall-top closure.
 *
 * STAGE WEB-PIVOT-02 left a wedge of air along the eaves: a wall top is one
 * height, a soffit is a slope, and the two cannot agree across the thickness of
 * the wall. The measured shortfall was 1.99 m3 on the Marcowki shell.
 *
 * This file proves the correction on round numbers before the gold shell is
 * asked about it at all. Fixture C is one wall under one roof:
 *
 *     length 4.0 m, thickness 0.45 m, outer-face top 3.0 m, soffit at 40 deg
 *
 * so that
 *
 *     dh = 0.45 * tan(40 deg) = 0.377594834029776 m
 *     V  = 0.5 * 0.45 * dh * 4.0 = 0.339835350626798 m3
 *
 * Both numbers come from the definition in `eave-fixture.ts`, not from any
 * mesh. Every geometric assertion below reads emitted triangles through the
 * oracles in `tests/geometry-oracles.ts`, which import nothing from the
 * compiler and contain none of its algorithms.
 */
import { describe, expect, it } from 'vitest'
import { compileWalls } from '../src/core/wallspec/compile.js'
import { compileRoofs } from '../src/core/wallspec/roof.js'
import { SOLID_PARTS, type CompiledTri, type WallSpec } from '../src/core/wallspec/contracts.js'
import {
  EAVE,
  EAVE_DH_M,
  EAVE_FLAT_VOLUME_M3,
  EAVE_IDS,
  EAVE_OPENING,
  EAVE_SLOPE,
  EAVE_WEDGE_M3,
  eaveLevels,
  eaveRoof,
  eaveWall,
  eaveWallInput,
  type EaveFixtureOptions,
} from '../src/core/wallspec/eave-fixture.js'
import {
  compileBuilding,
  isSolidBuildingPart,
  type BuildingCompileResult,
  type BuildingTri,
} from '../src/core/wallspec/building.js'
import type { BuildingSpec } from '../src/core/wallspec/architectural.js'
import { exposedWallAreaM2 } from '../src/core/wallspec/junction.js'
import {
  IDS,
  M,
  MAIN,
  UPPER_RECESS_M,
  marcowkiBuildingSpec,
  type MarcowkiOptions,
} from '../src/core/wallspec/marcowki-fixture.js'
import {
  faceEscapes,
  manifoldReport,
  measureContact,
  measureRoofPlanes,
  meshBounds,
  meshVolume,
  sampleContact,
  type OTri,
} from './geometry-oracles.js'

const UP = { x: 0, y: 1, z: 0 }
/** Far below the fixture, so a ray parameter minus this is a height. */
const BELOW = 1000
/**
 * One nanometre.
 *
 * Fixture C states its wall top and its roof from the same exact constants, so
 * the only thing between the two emitted surfaces is floating-point arithmetic
 * over numbers of order 1. Measured worst case is 2.3e-13 m; the gate is four
 * orders of magnitude looser than that and still 10^6 times tighter than any
 * drawing.
 */
const NM = 1e-9

const wallSolid = (opts: EaveFixtureOptions): CompiledTri[] =>
  compileWalls(eaveWallInput(opts)).tris.filter((t) => SOLID_PARTS.includes(t.part))

const roofSolid = (opts: EaveFixtureOptions = {}): OTri[] =>
  compileRoofs([eaveRoof({ liftM: opts.roofLiftM })], eaveLevels(opts)).tris

/** Lines up through the wall, spread along its length and across its thickness. */
const probeLines = (): Array<{ origin: { x: number; y: number; z: number }; label: string }> => {
  const out: Array<{ origin: { x: number; y: number; z: number }; label: string }> = []
  // Clear of the ends, and clear of the window's jambs at u = 1.0 and 2.2.
  const alongs = [0.3, 0.7, 2.4, 3.1, 3.7]
  const acrosses = [0.01, 0.1, 0.225, 0.35, 0.44]
  for (const a of alongs) {
    for (const c of acrosses) {
      out.push({
        origin: { x: a, y: -BELOW, z: -c },
        label: `u=${a.toFixed(2)} c=${c.toFixed(2)}`,
      })
    }
  }
  return out
}

const contact = (opts: EaveFixtureOptions = {}) =>
  measureContact(wallSolid({ top: 'PLANE', ...opts }), roofSolid(opts), probeLines(), UP)

// --------------------------------------------------------------------------
// 1. The arithmetic, before any geometry.
// --------------------------------------------------------------------------

describe('eave wedge — the analytic quantity', () => {
  it('states dh and V from the definition, to the digit', () => {
    expect(EAVE_SLOPE).toBeCloseTo(Math.tan((40 * Math.PI) / 180), 15)
    expect(EAVE_DH_M).toBeCloseTo(0.377594834029776, 15)
    expect(EAVE_WEDGE_M3).toBeCloseTo(0.339835350626798, 15)
    // ...and the same numbers the long way round, so a typo in either shows.
    expect(EAVE_DH_M).toBeCloseTo(EAVE.thicknessM * Math.tan((EAVE.pitchDeg * Math.PI) / 180), 15)
    expect(EAVE_WEDGE_M3).toBeCloseTo(0.5 * EAVE.thicknessM * EAVE_DH_M * EAVE.lengthM, 15)
    expect(EAVE_FLAT_VOLUME_M3).toBeCloseTo(5.4, 12)
  })
})

// --------------------------------------------------------------------------
// 2. The wall itself: still a closed solid, now the right size.
// --------------------------------------------------------------------------

describe('eave wedge — the corrected wall', () => {
  it('compiles both tops without a diagnostic', () => {
    for (const top of ['FLAT', 'PLANE'] as const) {
      expect(compileWalls(eaveWallInput({ top })).diagnostics, top).toEqual([])
    }
  })

  it('is closed and outward-wound with a sloped top', () => {
    const report = manifoldReport(wallSolid({ top: 'PLANE' }))
    expect(report.closed).toBe(true)
    expect(report.orientable).toBe(true)
    expect(report.boundaryEdges).toEqual([])
    expect(meshVolume(wallSolid({ top: 'PLANE' }))).toBeGreaterThan(0)
  })

  it('adds exactly the analytic wedge to the flat-top wall', () => {
    const flat = meshVolume(wallSolid({ top: 'FLAT' }))
    const plane = meshVolume(wallSolid({ top: 'PLANE' }))
    expect(flat).toBeCloseTo(EAVE_FLAT_VOLUME_M3, 12)
    expect(plane - flat).toBeCloseTo(EAVE_WEDGE_M3, 12)
    expect(plane).toBeCloseTo(EAVE_FLAT_VOLUME_M3 + EAVE_WEDGE_M3, 12)
  })

  it('rises by dh across the thickness and by nothing along the length', () => {
    const tris = wallSolid({ top: 'PLANE' })
    const onPlane = (z: number) => (t: OTri): boolean =>
      [t.a, t.b, t.c].every((p) => Math.abs(p.z - z) < 1e-12)
    const outer = tris.filter(onPlane(0))
    const inner = tris.filter(onPlane(-EAVE.thicknessM))
    expect(meshBounds(outer).max.y).toBeCloseTo(EAVE.outerTopM, 12)
    expect(meshBounds(inner).max.y).toBeCloseTo(EAVE.outerTopM + EAVE_DH_M, 12)
    // The soffit runs level along the wall, so the top is the same at both ends.
    const topAt = (x: number, z: number): number =>
      sampleContact(tris, [], { x, y: -BELOW, z }, UP).lowerTopM! - BELOW
    expect(topAt(0.3, -0.3)).toBeCloseTo(topAt(3.7, -0.3), 12)
    expect(topAt(2.0, -0.1) - topAt(2.0, -0.4)).toBeCloseTo(-0.3 * EAVE_SLOPE, 12)
  })

  it('leaves the flat-top wall exactly as STAGE WEB-PIVOT-01 compiled it', () => {
    // No profile, no raked head: the rectangular path, triangle for triangle.
    const box: WallSpec = { ...eaveWall({ top: 'FLAT' }) }
    expect(box.topProfile).toBeUndefined()
    const tris = compileWalls({ walls: [box], openings: [], glazing: [] }).tris
    expect(tris).toHaveLength(12)
    expect(meshVolume(tris)).toBeCloseTo(EAVE_FLAT_VOLUME_M3, 12)
  })
})

// --------------------------------------------------------------------------
// 3. The interface: no void, no overlap, no double filling.
// --------------------------------------------------------------------------

describe('eave wedge — the wall/roof interface', () => {
  it('meets the roof underside everywhere, with no daylight and no overlap', () => {
    const r = contact()
    expect(r.missing).toEqual([])
    expect(r.samples).toHaveLength(25)
    expect(r.maxVoidM, `worst at ${r.worstVoid}`).toBeLessThan(NM)
    expect(r.maxOverlapM, `worst at ${r.worstOverlap}`).toBeLessThan(NM)
    expect(r.maxDoubleFilledM).toBeLessThan(NM)
  })

  it('reads as one unbroken run of material from wall base to roof top', () => {
    const r = contact()
    for (const s of r.samples) expect(s.unionRuns, s.label).toBe(1)
  })

  it('still leaves the wedge when the wall top is flat — which is the defect', () => {
    const flat = measureContact(wallSolid({ top: 'FLAT' }), roofSolid(), probeLines(), UP)
    expect(flat.maxOverlapM).toBeLessThan(NM)
    // The gap grows across the thickness and is nothing at the outer face.
    expect(flat.maxVoidM).toBeCloseTo(0.44 * EAVE_SLOPE, 9)
    const atFace = flat.samples.find((s) => s.label.endsWith('c=0.01'))!
    expect(atFace.gapM).toBeCloseTo(0.01 * EAVE_SLOPE, 9)
    for (const s of flat.samples) expect(s.unionRuns, s.label).toBe(2)
  })

  it('measures the same wedge by volume as the section oracle does by ray', () => {
    // The section says the void is a triangle dh tall and t deep; the volume
    // says the corrected wall is that triangle bigger. They are independent
    // measurements of one solid and they have to agree.
    const flat = measureContact(wallSolid({ top: 'FLAT' }), roofSolid(), probeLines(), UP)
    const atInner = flat.samples.find((s) => s.label.endsWith('c=0.44'))!
    const sectionArea = 0.5 * EAVE.thicknessM * (atInner.gapM / 0.44) * EAVE.thicknessM
    expect(sectionArea * EAVE.lengthM).toBeCloseTo(EAVE_WEDGE_M3, 9)
    expect(meshVolume(wallSolid({ top: 'PLANE' })) - meshVolume(wallSolid({ top: 'FLAT' }))).toBeCloseTo(
      sectionArea * EAVE.lengthM,
      9,
    )
  })
})

// --------------------------------------------------------------------------
// 4. Openings under a sloped top.
// --------------------------------------------------------------------------

describe('eave wedge — openings are not touched', () => {
  it('cuts the window at its stated local coordinates, sloped top or not', () => {
    const reveal = (top: 'FLAT' | 'PLANE'): { minU: number; maxU: number; minB: number; maxB: number } => {
      const tris = compileWalls(eaveWallInput({ top, withOpening: true })).tris.filter(
        (t) => t.openingId === EAVE_IDS.opening && t.part === 'REVEAL',
      )
      const b = meshBounds(tris)
      return { minU: b.min.x, maxU: b.max.x, minB: b.min.y, maxB: b.max.y }
    }
    const flat = reveal('FLAT')
    const plane = reveal('PLANE')
    expect(plane).toEqual(flat)
    expect(plane.minU).toBeCloseTo(EAVE_OPENING.offsetM, 12)
    expect(plane.maxU).toBeCloseTo(EAVE_OPENING.offsetM + EAVE_OPENING.widthM, 12)
    expect(plane.minB).toBeCloseTo(EAVE_OPENING.sillM, 12)
    expect(plane.maxB).toBeCloseTo(EAVE_OPENING.sillM + EAVE_OPENING.heightM, 12)
  })

  it('keeps the wall closed and the wedge intact with the window cut', () => {
    const withHole = wallSolid({ top: 'PLANE', withOpening: true })
    expect(manifoldReport(withHole).closed).toBe(true)
    const hole = EAVE_OPENING.widthM * EAVE_OPENING.heightM * EAVE.thicknessM
    expect(meshVolume(withHole)).toBeCloseTo(EAVE_FLAT_VOLUME_M3 + EAVE_WEDGE_M3 - hole, 9)
  })

  it('refuses an opening that reaches the soffit instead of clipping it', () => {
    const tall = { ...EAVE_OPENING, sillM: 0.5, heightM: EAVE.outerTopM - 0.5 }
    const r = compileWalls({
      walls: [eaveWall({ top: 'PLANE' })],
      openings: [tall],
      glazing: [],
    })
    expect(r.diagnostics.map((d) => d.code)).toContain('OPENING_ABOVE_WALL_PROFILE')
    expect(r.tris.some((t) => t.openingId === EAVE_IDS.opening)).toBe(false)
  })
})

// --------------------------------------------------------------------------
// 5. The contract refuses what it cannot mean.
// --------------------------------------------------------------------------

describe('eave wedge — invalid top planes', () => {
  const withPlane = (plane: { pointM: { x: number; y: number; z: number }; normal: { x: number; y: number; z: number } }) =>
    compileWalls({
      walls: [{ ...eaveWall({ top: 'PLANE' }), topProfile: { kind: 'PLANE', plane, sourceRoofId: EAVE_IDS.roof } }],
      openings: [],
      glazing: [],
    })

  it('refuses a top plane the wall never reaches', () => {
    // Normal perpendicular to `up`: a vertical soffit, which no wall has a top under.
    const r = withPlane({ pointM: { x: 0, y: 3, z: 0 }, normal: { x: 0, y: 0, z: 1 } })
    expect(r.diagnostics.map((d) => d.code)).toEqual(['WALL_TOP_PLANE_UNCROSSABLE'])
    expect(r.tris).toEqual([])
  })

  it('refuses a degenerate normal', () => {
    const r = withPlane({ pointM: { x: 0, y: 3, z: 0 }, normal: { x: 0, y: 0, z: 0 } })
    expect(r.diagnostics.map((d) => d.code)).toEqual(['INVALID_WALL_PROFILE'])
  })

  it('refuses a top plane that cuts below the wall base', () => {
    const r = withPlane({ pointM: { x: 0, y: -0.2, z: 0 }, normal: { x: 0, y: 1, z: EAVE_SLOPE } })
    expect(r.diagnostics.map((d) => d.code)).toEqual(['WALL_TOP_BELOW_BASE'])
    expect(r.tris).toEqual([])
  })

  it('refuses a PLANE top that names no roof', () => {
    const r = compileWalls({
      walls: [
        {
          ...eaveWall({ top: 'PLANE' }),
          topProfile: {
            kind: 'PLANE',
            plane: { pointM: { x: 0, y: 3, z: 0 }, normal: { x: 0, y: 1, z: EAVE_SLOPE } },
            sourceRoofId: '',
          },
        },
      ],
      openings: [],
      glazing: [],
    })
    expect(r.diagnostics.map((d) => d.code)).toEqual(['INVALID_WALL_PROFILE'])
  })
})

// --------------------------------------------------------------------------
// 6. Semantic tagging of the contact surface.
// --------------------------------------------------------------------------

describe('eave wedge — the soffit contact face', () => {
  it('tags the wall top as roof contact and nothing else', () => {
    const tris = compileWalls(eaveWallInput({ top: 'PLANE' })).tris
    const tagged = tris.filter((t) => t.contactKind === 'ROOF_SOFFIT')
    expect(tagged.length).toBeGreaterThan(0)
    expect(new Set(tagged.map((t) => t.contactId))).toEqual(new Set([EAVE_IDS.roof]))
    // Every tagged triangle is on the soffit plane, and every untagged one is not.
    const onSoffit = (t: OTri): boolean =>
      [t.a, t.b, t.c].every((p) => Math.abs(p.y - (EAVE.outerTopM - EAVE_SLOPE * p.z)) < 1e-12)
    for (const t of tagged) expect(onSoffit(t)).toBe(true)
    for (const t of tris.filter((x) => x.contactKind === undefined)) {
      expect(t.contactId).toBeUndefined()
    }
  })

  it('does not tag a gable end, whose top really is outside', () => {
    const gable: WallSpec = {
      ...eaveWall({ top: 'FLAT' }),
      topProfile: {
        kind: 'POLYLINE',
        points: [
          { u: 0, topM: 2 },
          { u: EAVE.lengthM / 2, topM: 3 },
          { u: EAVE.lengthM, topM: 2 },
        ],
      },
    }
    const tris = compileWalls({ walls: [gable], openings: [], glazing: [] }).tris
    expect(tris.some((t) => t.contactKind !== undefined)).toBe(false)
  })
})

// --------------------------------------------------------------------------
// 7. The Marcowki gold shell: the wedge this stage exists to close.
// --------------------------------------------------------------------------

/** The two attic walls that run along the ridge and die into the slope. */
const SIDE_WALLS = ['attic_left', 'attic_right'] as const

const marcowki = (opts: MarcowkiOptions = {}): BuildingCompileResult =>
  compileBuilding(marcowkiBuildingSpec(opts))
const mSolid = (r: BuildingCompileResult): BuildingTri[] => r.tris.filter((t) => isSolidBuildingPart(t.part))
const sideWallVolume = (r: BuildingCompileResult): number =>
  SIDE_WALLS.reduce((acc, id) => acc + meshVolume(mSolid(r).filter((t) => t.wallId === id)), 0)
const gableRoof = (r: BuildingCompileResult): BuildingTri[] =>
  r.tris.filter((t) => t.elementId === IDS.gableRoof)

/** Lines up through both attic side walls, spread along and across them. */
const marcowkiProbes = (): Array<{ origin: { x: number; y: number; z: number }; label: string }> => {
  const out: Array<{ origin: { x: number; y: number; z: number }; label: string }> = []
  for (const z of [1.0, 3.0, 6.3, 9.0, 11.8]) {
    for (const c of [0.02, 0.15, 0.225, 0.3, 0.43]) {
      out.push({ origin: { x: MAIN.minX + c, y: -BELOW, z }, label: `left z=${z} c=${c}` })
      out.push({ origin: { x: MAIN.maxX - c, y: -BELOW, z }, label: `right z=${z} c=${c}` })
    }
  }
  return out
}

const marcowkiContact = (r: BuildingCompileResult) =>
  measureContact(
    mSolid(r).filter((t) => (SIDE_WALLS as readonly string[]).includes(t.wallId)),
    gableRoof(r),
    marcowkiProbes(),
    UP,
  )

/**
 * How far the gold shell's stated soffit plane may sit from its compiled roof.
 *
 * Five microns, and all of it is the gold file's own rounding: the wall top is
 * stated from `roof.pitchDeg` and the roof is built from `level.eaveM` and
 * `level.ridgeM`, each recorded to five decimals. Fixture C, where both sides
 * come from exact constants, closes to 2.3e-13 m — so this tolerance measures
 * the transcription, not the compiler.
 */
const GOLD_TOL = 5e-6

describe('Marcowki gold shell — the eave wedge', () => {
  it('closes the 1.99 m3 wedge and adds exactly that much material', () => {
    const before = marcowki({ flatEaveTops: true })
    const after = marcowki()
    expect(before.diagnostics).toEqual([])
    expect(after.diagnostics).toEqual([])

    const added = sideWallVolume(after) - sideWallVolume(before)
    // The analytic quantity, from the wall's own dimensions: two walls, each
    // trimmed by a thickness at both ends by the ring's corner ownership.
    const emittedLength = M.overallDepth - 2 * M.wallThickness
    const dh = M.wallThickness * Math.tan((M.pitchDeg * Math.PI) / 180)
    const wedge = 2 * (0.5 * M.wallThickness * dh * emittedLength)
    expect(wedge).toBeCloseTo(1.988036801, 9)
    expect(added).toBeCloseTo(wedge, 9)
    expect(sideWallVolume(before)).toBeCloseTo(13.689, 9)
    expect(sideWallVolume(after)).toBeCloseTo(15.677036801, 9)
  })

  it('measures the void away: 0.378 m of daylight becomes 1.7 microns', () => {
    const before = marcowkiContact(marcowki({ flatEaveTops: true }))
    const after = marcowkiContact(marcowki())
    expect(before.missing).toEqual([])
    expect(after.missing).toEqual([])
    expect(before.samples).toHaveLength(50)
    // Before: the gap opens across the thickness, up to dh at the inner face.
    expect(before.maxVoidM).toBeCloseTo(0.43 * Math.tan((M.pitchDeg * Math.PI) / 180), 5)
    // After: nothing a drawing could express.
    expect(after.maxVoidM, `worst at ${after.worstVoid}`).toBeLessThan(GOLD_TOL)
    expect(after.maxOverlapM, `worst at ${after.worstOverlap}`).toBeLessThan(GOLD_TOL)
    expect(after.maxDoubleFilledM).toBeLessThan(GOLD_TOL)
    // And neither shape overlaps the roof: the defect was a void, not a clash.
    expect(before.maxOverlapM).toBe(0)
  })

  it('leaves every wall a closed, outward-wound solid', () => {
    const r = marcowki()
    for (const id of [...SIDE_WALLS, 'attic_front', 'attic_rear']) {
      const tris = mSolid(r).filter((t) => t.wallId === id)
      const m = manifoldReport(tris)
      expect(m.closed, id).toBe(true)
      expect(m.orientable, id).toBe(true)
      expect(meshVolume(tris), id).toBeGreaterThan(0)
    }
  })

  it('does not move the roof to fit the wall', () => {
    const before = marcowki({ flatEaveTops: true })
    const after = marcowki()
    // Triangle for triangle, the roof is the one STAGE WEB-PIVOT-02 emitted.
    expect(gableRoof(after)).toEqual(gableRoof(before))
    const planes = measureRoofPlanes(gableRoof(after), UP)
    expect(planes).toHaveLength(2)
    for (const p of planes) expect(p.pitchDeg).toBeCloseTo(M.pitchDeg, 3)
    expect(planes[0].lowM).toBeCloseTo(M.eave, 9)
    expect(planes[0].highM).toBeCloseTo(M.ridge, 9)
    const b = meshBounds(gableRoof(after))
    expect([b.min.x, b.max.x, b.min.z, b.max.z]).toEqual([MAIN.minX, MAIN.maxX, MAIN.minZ, MAIN.maxZ])
    // The flat garage roof is untouched too.
    const flat = (res: BuildingCompileResult): BuildingTri[] =>
      res.tris.filter((t) => t.elementId === IDS.flatRoof)
    expect(flat(after)).toEqual(flat(before))
  })

  it('keeps the hosted gable opening where its host wall put it', () => {
    const bounds = (r: BuildingCompileResult) =>
      meshBounds(r.tris.filter((t) => t.openingId === IDS.gableOpening && t.part === 'REVEAL'))
    const before = bounds(marcowki({ flatEaveTops: true }))
    const after = bounds(marcowki())
    expect(after).toEqual(before)
    // Still on the front facade, still at its stated offset above the attic floor.
    expect(after.min.x).toBeCloseTo(MAIN.minX + M.openingOffset, 9)
    expect(after.max.x).toBeCloseTo(MAIN.minX + M.openingOffset + M.openingWidth, 9)
    expect(after.min.y).toBeCloseTo(M.upperFfl, 9)
    expect(after.max.y).toBeCloseTo(M.upperFfl + M.openingHeight, 9)
    expect(marcowki().tris.some((t) => t.openingId === IDS.gableOpening)).toBe(true)
  })

  it('keeps the recessed upper wall independent of the lower facade', () => {
    const r = marcowki({ diagnosticRecessOpening: true })
    expect(r.diagnostics).toEqual([])
    const recess = r.tris.filter((t) => t.openingId === 'opening_recess_diagnostic')
    expect(recess.length).toBeGreaterThan(0)
    // The attic's right wall stands UPPER_RECESS_M behind the building's own
    // right facade, and the opening is on the wall, not on that facade.
    expect(UPPER_RECESS_M).toBeGreaterThan(4)
    expect(meshBounds(recess).max.x).toBeCloseTo(MAIN.maxX, 9)
    expect(meshBounds(mSolid(r)).max.x).toBeCloseTo(MAIN.maxX + UPPER_RECESS_M, 9)
  })

  it('tags the new contact as roof soffit and keeps it out of the facade', () => {
    const r = marcowki()
    const contact = mSolid(r).filter((t) => t.contactId)
    const soffit = contact.filter((t) => t.contactKind === 'ROOF_SOFFIT')
    const junction = contact.filter((t) => t.contactKind === 'JUNCTION')
    expect(soffit.length + junction.length).toBe(contact.length)
    expect(new Set(soffit.map((t) => t.contactId))).toEqual(new Set([IDS.gableRoof]))
    expect(new Set(soffit.map((t) => t.wallId))).toEqual(new Set(SIDE_WALLS))
    // Before the fix there was no such surface at all, and the junction
    // contacts of the PROFILED walls were going untagged — which is why the
    // attic's trimmed ends used to be counted as facade.
    expect(marcowki({ flatEaveTops: true }).tris.some((t) => t.contactKind === 'ROOF_SOFFIT')).toBe(false)
    expect(junction.filter((t) => (SIDE_WALLS as readonly string[]).includes(t.wallId)).length).toBeGreaterThan(0)
    // Contact faces are buried: not one of them escapes to the outside.
    for (const t of soffit) expect(faceEscapes(mSolid(r), t), `${t.wallId} soffit`).toBe(false)
    // And none is on the building's vertical envelope, so no facade measure sees it.
    expect(exposedWallAreaM2(soffit as unknown as CompiledTri[])).toBe(0)
  })
})

// --------------------------------------------------------------------------
// 8. Mutations. None is committed.
// --------------------------------------------------------------------------

describe('eave closure — mutations', () => {
  it('1. reverting to a flat top reopens the void', () => {
    const r = marcowkiContact(marcowki({ flatEaveTops: true }))
    expect(r.maxVoidM).toBeGreaterThan(0.3)
    expect(r.samples.every((s) => s.unionRuns === 2)).toBe(true)
    // The gate the fixed shell passes.
    expect(r.maxVoidM).not.toBeLessThan(GOLD_TOL)
  })

  it('2. over-extending the wall into the roof is an overlap, not a fit', () => {
    const lifted = marcowki({ soffitLiftM: 0.05 })
    expect(lifted.diagnostics).toEqual([])
    const r = marcowkiContact(lifted)
    expect(r.maxOverlapM).toBeCloseTo(0.05, 4)
    expect(r.maxVoidM).toBeLessThan(GOLD_TOL)
    // Double-filled: the same 5 cm of line is inside the wall and the roof.
    expect(r.maxDoubleFilledM).toBeCloseTo(0.05, 4)
    // An oracle that reported |gap| would have called this a perfect interface.
    expect(Math.abs(r.samples[0].gapM)).toBeCloseTo(0.05, 4)
  })

  it('3. naming a roof the spec does not have is refused by name', () => {
    const r = marcowki({ soffitRoofId: 'roof_that_is_not_there' })
    expect(r.diagnostics.map((d) => d.code)).toContain('WALL_TOP_ROOF_UNKNOWN')
    const named = r.diagnostics.filter((d) => d.code === 'WALL_TOP_ROOF_UNKNOWN')
    expect(named).toHaveLength(2)
    expect(new Set(named.map((d) => (d as { wallId?: string }).wallId))).toEqual(new Set(SIDE_WALLS))
  })

  it('4. moving the roof without moving the profile opens the interface', () => {
    const base = marcowkiBuildingSpec()
    const raised: BuildingSpec = {
      ...base,
      levels: base.levels.map((l) =>
        l.kind === 'EAVE' || l.kind === 'RIDGE' ? { ...l, elevationM: l.elevationM + 0.3 } : l,
      ),
    }
    const r = compileBuilding(raised)
    // The roof is still a 40 degree gable — it just is not where the wall is.
    const planes = measureRoofPlanes(gableRoof(r), UP)
    expect(planes[0].pitchDeg).toBeCloseTo(M.pitchDeg, 3)
    expect(planes[0].lowM).toBeCloseTo(M.eave + 0.3, 9)
    const contact = marcowkiContact(r)
    expect(contact.maxVoidM).toBeCloseTo(0.3, 4)
    expect(contact.maxVoidM).not.toBeLessThan(GOLD_TOL)
  })

  it('5. an opening that moves is caught by the host-local gate', () => {
    const shifted = { ...EAVE_OPENING, offsetM: EAVE_OPENING.offsetM + 0.1 }
    const tris = compileWalls({
      walls: [eaveWall({ top: 'PLANE' })],
      openings: [shifted],
      glazing: [],
    }).tris.filter((t) => t.openingId === EAVE_IDS.opening && t.part === 'REVEAL')
    const b = meshBounds(tris)
    // The gate in section 4 pins the reveal to the opening's stated offset.
    expect(b.min.x).not.toBeCloseTo(EAVE_OPENING.offsetM, 6)
    expect(b.min.x).toBeCloseTo(EAVE_OPENING.offsetM + 0.1, 12)
    // Nothing about the wall's top changed, which is the point: a shift would
    // have to come from the opening, and the gate says which.
    const roofSide = wallSolid({ top: 'PLANE' })
    expect(meshBounds(roofSide).max.y).toBeCloseTo(EAVE.outerTopM + EAVE_DH_M, 12)
  })
})
