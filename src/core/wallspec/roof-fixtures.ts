/**
 * Fixture A — synthetic roof sanity — STAGE WEB-PIVOT-02, development only.
 *
 * Round numbers, no house. Its job is to isolate the roof compiler's arithmetic
 * from the question of whether Marcowki was transcribed correctly: if a pitch
 * comes out wrong here, the compiler is wrong; if it comes out right here and
 * wrong on the gold shell, the spec is.
 *
 * No Marcowki dimension appears in this file, and no dimension from this file
 * appears in the compiler.
 */
import type { LevelSpec, Provenance, RoofSpec } from './architectural.js'

const synthetic = (what: string): Provenance => ({
  source: 'synthetic fixture A',
  locator: 'none — invented for this test',
  interpretation: what,
  status: 'ASSUMPTION',
})

/** A 45 degree gable: half-span 5, rise 5. Chosen so the expected angle is exact. */
export const FIXTURE_A_45 = {
  footprint: { minX: 0, maxX: 10, minZ: 0, maxZ: 6 },
  eaveM: 3,
  ridgeM: 8,
  halfSpanM: 5,
  expectedPitchDeg: 45,
  overhangM: 0.5,
  thicknessM: 0.2,
} as const

/**
 * A 3:4 gable with its ridge along X, to show that 45 was not a special case
 * and that the two ridge axes are not each other's mirror by accident.
 *
 * The ridge runs along X, so the slopes fall along Z and the half-span is half
 * the Z extent: 8 / 2 = 4, against a rise of 3.
 */
export const FIXTURE_A_37 = {
  footprint: { minX: 0, maxX: 5, minZ: 0, maxZ: 8 },
  eaveM: 2,
  ridgeM: 5,
  halfSpanM: 4,
  /** Extent along the ridge, which is what the slope area multiplies by. */
  alongRidgeM: 5,
  expectedPitchDeg: (Math.atan(3 / 4) * 180) / Math.PI,
  overhangM: 0,
  thicknessM: 0.25,
} as const

export const FIXTURE_A_FLAT = {
  footprint: { minX: 0, maxX: 4, minZ: 0, maxZ: 3 },
  topM: 3,
  overhangM: 0.2,
  thicknessM: 0.3,
} as const

export const ROOF_FIXTURE_LEVELS: LevelSpec[] = [
  { id: 'a45_eave', kind: 'EAVE', elevationM: FIXTURE_A_45.eaveM, provenance: synthetic('45 degree gable eave') },
  { id: 'a45_ridge', kind: 'RIDGE', elevationM: FIXTURE_A_45.ridgeM, provenance: synthetic('45 degree gable ridge') },
  { id: 'a37_eave', kind: 'EAVE', elevationM: FIXTURE_A_37.eaveM, provenance: synthetic('3:4 gable eave') },
  { id: 'a37_ridge', kind: 'RIDGE', elevationM: FIXTURE_A_37.ridgeM, provenance: synthetic('3:4 gable ridge') },
  { id: 'aflat_top', kind: 'FLAT_ROOF_TOP', elevationM: FIXTURE_A_FLAT.topM, provenance: synthetic('flat roof top') },
]

export function roofFixtureA(): RoofSpec[] {
  return [
    {
      id: 'gable45',
      kind: 'GABLE',
      footprint: { ...FIXTURE_A_45.footprint },
      supportShellId: 'shell_a',
      eaveLevelId: 'a45_eave',
      ridgeLevelId: 'a45_ridge',
      ridgeAxis: 'Z',
      pitchDeg: FIXTURE_A_45.expectedPitchDeg,
      overhangM: FIXTURE_A_45.overhangM,
      thicknessM: FIXTURE_A_45.thicknessM,
      ownerStoreyId: 'shell_a',
      provenance: synthetic('45 degree gable'),
    },
    {
      id: 'gable37',
      kind: 'GABLE',
      footprint: { ...FIXTURE_A_37.footprint },
      supportShellId: 'shell_b',
      eaveLevelId: 'a37_eave',
      ridgeLevelId: 'a37_ridge',
      ridgeAxis: 'X',
      pitchDeg: FIXTURE_A_37.expectedPitchDeg,
      overhangM: FIXTURE_A_37.overhangM,
      thicknessM: FIXTURE_A_37.thicknessM,
      ownerStoreyId: 'shell_b',
      provenance: synthetic('3:4 gable, ridge the other way round'),
    },
    {
      id: 'flat',
      kind: 'FLAT',
      footprint: { ...FIXTURE_A_FLAT.footprint },
      supportShellId: 'shell_c',
      eaveLevelId: 'aflat_top',
      overhangM: FIXTURE_A_FLAT.overhangM,
      thicknessM: FIXTURE_A_FLAT.thicknessM,
      ownerStoreyId: 'shell_c',
      provenance: synthetic('flat roof'),
    },
  ]
}

/** The same gable, declared as a kind this stage refuses. */
export function unsupportedRoof(kind: 'HIP' | 'MONO_PITCH'): RoofSpec {
  return { ...roofFixtureA()[0], id: `unsupported_${kind.toLowerCase()}`, kind }
}
