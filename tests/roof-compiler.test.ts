/**
 * STAGE WEB-PIVOT-02 — Fixture A: roof compiler arithmetic, in isolation.
 *
 * No house, no source, no transcription. Round synthetic numbers, so that a
 * failure here means the compiler is wrong rather than that Marcowki was read
 * wrong. Every angle is measured off emitted triangles; nothing reads
 * `RoofSpec.pitchDeg` except the tests that compare it.
 */
import { describe, expect, it } from 'vitest'
import { compileRoofs } from '../src/core/wallspec/roof.js'
import {
  FIXTURE_A_37,
  FIXTURE_A_45,
  FIXTURE_A_FLAT,
  ROOF_FIXTURE_LEVELS,
  roofFixtureA,
  unsupportedRoof,
} from '../src/core/wallspec/roof-fixtures.js'
import { manifoldReport, measureRoofPlanes, meshVolume, type OTri } from './geometry-oracles.js'

const UP = { x: 0, y: 1, z: 0 }
const compile = () => compileRoofs(roofFixtureA(), ROOF_FIXTURE_LEVELS)
const of = (r: ReturnType<typeof compile>, id: string): OTri[] => r.tris.filter((t) => t.ownerId === id)

describe('roof compiler — Fixture A', () => {
  it('measures 45 degrees off the emitted geometry of a 45 degree gable', () => {
    const r = compile()
    expect(r.diagnostics).toEqual([])
    const planes = measureRoofPlanes(of(r, 'gable45'), UP)
    expect(planes).toHaveLength(2)
    for (const p of planes) {
      expect(p.pitchDeg).toBeCloseTo(FIXTURE_A_45.expectedPitchDeg, 9)
      // rise = tan(pitch) x run, with the two sides measured independently.
      expect(p.riseM).toBeCloseTo(Math.tan((p.pitchDeg * Math.PI) / 180) * p.horizontalRunM, 9)
      // Eave and ridge, including the overhang's drop below the eave datum.
      expect(p.highM).toBeCloseTo(FIXTURE_A_45.ridgeM, 9)
      expect(p.lowM).toBeCloseTo(FIXTURE_A_45.eaveM - FIXTURE_A_45.overhangM, 9)
      expect(p.horizontalRunM).toBeCloseTo(FIXTURE_A_45.halfSpanM + FIXTURE_A_45.overhangM, 9)
    }
    // The two slopes face opposite ways across the ridge.
    expect(planes[0].normal.x).toBeCloseTo(-planes[1].normal.x, 9)
    expect(planes[0].normal.z).toBeCloseTo(planes[1].normal.z, 9)
  })

  it('measures a 3:4 gable at its own angle, with the ridge the other way round', () => {
    const r = compile()
    const planes = measureRoofPlanes(of(r, 'gable37'), UP)
    expect(planes).toHaveLength(2)
    for (const p of planes) {
      expect(p.pitchDeg).toBeCloseTo(FIXTURE_A_37.expectedPitchDeg, 9)
      expect(p.riseM).toBeCloseTo(FIXTURE_A_37.ridgeM - FIXTURE_A_37.eaveM, 9)
      expect(p.horizontalRunM).toBeCloseTo(FIXTURE_A_37.halfSpanM, 9)
      // Ridge along X means the slopes fall along Z.
      expect(Math.abs(p.normal.z)).toBeGreaterThan(0.5)
      expect(Math.abs(p.normal.x)).toBeLessThan(1e-9)
    }
  })

  it('keeps a flat roof flat, and at the level it was given', () => {
    const r = compile()
    const planes = measureRoofPlanes(of(r, 'flat'), UP)
    expect(planes).toHaveLength(1)
    expect(planes[0].pitchDeg).toBeCloseTo(0, 12)
    expect(planes[0].riseM).toBeCloseTo(0, 12)
    expect(planes[0].lowM).toBeCloseTo(FIXTURE_A_FLAT.topM, 12)
    expect(planes[0].highM).toBeCloseTo(FIXTURE_A_FLAT.topM, 12)
    const oh = FIXTURE_A_FLAT.overhangM
    const f = FIXTURE_A_FLAT.footprint
    expect(planes[0].areaM2).toBeCloseTo((f.maxX - f.minX + 2 * oh) * (f.maxZ - f.minZ + 2 * oh), 9)
  })

  it('emits each roof plane as a closed solid of the right volume', () => {
    const r = compile()
    for (const [id, expected] of [
      // A gable slope is its sloping area times the perpendicular thickness, and
      // the overhang lengthens it along the slope *and* past both gable ends.
      ['gable45', 2 * Math.hypot(5.5, 5.5) * (6 + 2 * FIXTURE_A_45.overhangM) * FIXTURE_A_45.thicknessM],
      ['gable37', 2 * Math.hypot(FIXTURE_A_37.halfSpanM, 3) * FIXTURE_A_37.alongRidgeM * FIXTURE_A_37.thicknessM],
      ['flat', 4.4 * 3.4 * FIXTURE_A_FLAT.thicknessM],
    ] as const) {
      const tris = of(r, id)
      const half = id === 'flat' ? tris.length : tris.length / 2
      let total = 0
      for (let i = 0; i < tris.length; i += half) {
        const piece = tris.slice(i, i + half)
        const m = manifoldReport(piece)
        expect(m.closed, `${id} piece closed`).toBe(true)
        expect(m.orientable, `${id} piece oriented`).toBe(true)
        total += meshVolume(piece)
      }
      expect(total, id).toBeCloseTo(expected, 9)
    }
  })

  it('refuses a roof kind it cannot build, by name and with no triangles', () => {
    for (const kind of ['HIP', 'MONO_PITCH'] as const) {
      const r = compileRoofs([unsupportedRoof(kind)], ROOF_FIXTURE_LEVELS)
      expect(r.tris).toHaveLength(0)
      expect(r.roofs).toHaveLength(0)
      expect(r.diagnostics.map((d) => d.code)).toEqual(['UNSUPPORTED_ROOF_KIND'])
      expect(r.diagnostics[0].message).toContain(kind)
    }
  })

  it('never reads the declared pitch when building the geometry', () => {
    // The strongest form of the RC04 correction: put a nonsense pitch in the
    // field and the triangles do not move at all.
    const honest = compile()
    const lying = compileRoofs(
      roofFixtureA().map((s) => (s.id === 'gable45' ? { ...s, pitchDeg: 12.5 } : s)),
      ROOF_FIXTURE_LEVELS,
    )
    expect(lying.tris).toEqual(honest.tris)
    // ...and the compiler's own report says the two disagree, so nobody has to
    // discover it from a render.
    const built = lying.roofs.find((r) => r.roofId === 'gable45')!
    expect(built.builtPitchDeg).toBeCloseTo(45, 9)
    expect(built.declaredPitchDeg).toBe(12.5)
    expect(Math.abs(built.builtPitchDeg - built.declaredPitchDeg!)).toBeGreaterThan(30)
  })

  it('moves the geometry when the levels move, and the measured pitch follows', () => {
    const raised = compileRoofs(
      roofFixtureA(),
      ROOF_FIXTURE_LEVELS.map((l) => (l.id === 'a45_ridge' ? { ...l, elevationM: 11 } : l)),
    )
    const planes = measureRoofPlanes(raised.tris.filter((t) => t.ownerId === 'gable45'), UP)
    // Half-span 5, rise 8.
    expect(planes[0].pitchDeg).toBeCloseTo((Math.atan(8 / 5) * 180) / Math.PI, 9)
    expect(planes[0].pitchDeg).not.toBeCloseTo(45, 2)
    const built = raised.roofs.find((r) => r.roofId === 'gable45')!
    expect(built.declaredPitchDeg).toBeCloseTo(45, 9)
    expect(Math.abs(built.builtPitchDeg - built.declaredPitchDeg!)).toBeGreaterThan(2)
  })

  it('refuses the malformed cases by name', () => {
    const base = roofFixtureA()[0]
    const cases: Array<[string, Parameters<typeof compileRoofs>[0], string]> = [
      ['ridge below eave', [{ ...base, ridgeLevelId: 'a45_eave' }], 'ROOF_RIDGE_BELOW_EAVE'],
      ['gable with no ridge', [{ ...base, ridgeLevelId: undefined }], 'ROOF_MISSING_RIDGE'],
      ['unknown level', [{ ...base, eaveLevelId: 'nope' }], 'UNKNOWN_ROOF_LEVEL'],
      ['empty footprint', [{ ...base, footprint: { minX: 1, maxX: 1, minZ: 0, maxZ: 5 } }], 'INVALID_ROOF_FOOTPRINT'],
      ['zero thickness', [{ ...base, thicknessM: 0 }], 'INVALID_ROOF_THICKNESS'],
      ['duplicate id', [base, { ...base }], 'DUPLICATE_ROOF_ID'],
    ]
    for (const [what, roofs, code] of cases) {
      const r = compileRoofs(roofs, ROOF_FIXTURE_LEVELS)
      expect(r.diagnostics.map((d) => d.code), what).toContain(code)
    }
  })

  it('compiles the same input the same way twice and does not touch it', () => {
    const roofs = roofFixtureA()
    const before = JSON.stringify(roofs)
    const first = compileRoofs(roofs, ROOF_FIXTURE_LEVELS)
    const second = compileRoofs(roofs, ROOF_FIXTURE_LEVELS)
    expect(JSON.stringify(roofs)).toBe(before)
    expect(second.tris).toEqual(first.tris)
    expect(second.roofs).toEqual(first.roofs)
  })
})
