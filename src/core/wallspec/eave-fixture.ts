/**
 * Fixture C — the synthetic eave — STAGE WEB-PIVOT-02A, development only.
 *
 * One wall, one roof, round numbers, no house. Its job is to isolate the
 * wall-top question from the question of whether Marcowki was transcribed
 * correctly: if the wedge does not close here, the compiler is wrong; if it
 * closes here and not on the gold shell, the spec is.
 *
 * ## The wedge, from first principles
 *
 * A wall of thickness `t` under a soffit at pitch `p` has an outer face and an
 * inner face `t` apart across the slope, so the soffit is
 *
 *     dh = t * tan(p)
 *
 * higher at one than at the other. A wall whose top is flat stops at the lower
 * of the two and leaves a prism of air above it: triangular in section, `dh`
 * tall, `t` deep, and as long as the wall. Hence
 *
 *     V = 0.5 * t * dh * L
 *
 * With `t = 0.45`, `p = 40 deg` and `L = 4.0` that is `0.339835351 m3`, and it
 * is what the plane-top wall must add to the flat-top one. The number is
 * computed here from the definition, not measured from any mesh.
 *
 * ## Layout
 *
 * World axes as everywhere else: +X east, +Y up, +Z south. The wall runs along
 * X with its outer face on the plane `z = 0` and its material inward at
 * negative `z`. The roof's ridge runs along X too, at `z = -2`, so its southern
 * slope falls towards `z = 0` and its underside meets the wall's outer-face top
 * exactly at the eave. Nothing about the wall is derived from the roof or the
 * roof from the wall: both are stated, and `tests/eave-closure.test.ts`
 * measures whether the two statements agree by putting rays through the
 * triangles each of them produced.
 *
 * No Marcowki dimension appears in this file, and no dimension from this file
 * appears in any compiler.
 */
import type { Vec3 } from '../contracts/geometry.js'
import type { GlazingSpec, OpeningSpec, WallCompileInput, WallSpec, WallTopProfile } from './contracts.js'
import type { LevelSpec, Provenance, RoofSpec } from './architectural.js'

const synthetic = (what: string): Provenance => ({
  source: 'synthetic fixture C',
  locator: 'none — invented for the eave closure proof',
  interpretation: what,
  status: 'ASSUMPTION',
})

export const EAVE = {
  /** Wall length along X. */
  lengthM: 4.0,
  /** Wall thickness, running inward from the outer face at `z = 0`. */
  thicknessM: 0.45,
  /** Where the soffit crosses the wall's OUTER face, above the wall base. */
  outerTopM: 3.0,
  /** Pitch of the soffit above the wall. */
  pitchDeg: 40,
  /** Roof thickness, perpendicular to its planes. */
  roofThicknessM: 0.2,
  /** Half the roof's span, from ridge to eave. */
  halfSpanM: 2.0,
} as const

/** `tan(40 deg)`, the one trigonometric value the fixture needs. */
export const EAVE_SLOPE = Math.tan((EAVE.pitchDeg * Math.PI) / 180)

/** How much higher the soffit is at the inner face than at the outer: `t * tan(p)`. */
export const EAVE_DH_M = EAVE.thicknessM * EAVE_SLOPE

/** The wedge a flat-topped wall leaves under the soffit: `0.5 * t * dh * L`. */
export const EAVE_WEDGE_M3 = 0.5 * EAVE.thicknessM * EAVE_DH_M * EAVE.lengthM

/** A flat-topped wall of the same footprint: `L * outerTop * t`. */
export const EAVE_FLAT_VOLUME_M3 = EAVE.lengthM * EAVE.outerTopM * EAVE.thicknessM

export const EAVE_IDS = {
  wall: 'eave_wall',
  shell: 'eave_shell',
  roof: 'eave_roof',
  opening: 'eave_window',
  glazing: 'eave_glass',
  eaveLevel: 'eave_level_eave',
  ridgeLevel: 'eave_level_ridge',
  baseLevel: 'eave_level_base',
} as const

/** Roof top surface at the eave: the soffit, plus the roof's own vertical depth. */
const ROOF_VERTICAL_DROP = EAVE.roofThicknessM / Math.cos((EAVE.pitchDeg * Math.PI) / 180)
export const EAVE_ROOF_EAVE_M = EAVE.outerTopM + ROOF_VERTICAL_DROP
export const EAVE_ROOF_RIDGE_M = EAVE_ROOF_EAVE_M + EAVE.halfSpanM * EAVE_SLOPE

/**
 * The soffit, as a world plane.
 *
 * It passes through the wall's outer-face top and rises towards `-z`, which is
 * inward. A point `p` is on it when `(p - point) . normal = 0`; with
 * `normal = (0, 1, tan p)` that reads `y = outerTop - tan(p) * z`, and `z` is
 * negative inside the wall.
 */
export const eaveSoffitPlane = (liftM = 0): { pointM: Vec3; normal: Vec3 } => ({
  pointM: { x: 0, y: EAVE.outerTopM + liftM, z: 0 },
  normal: { x: 0, y: 1, z: EAVE_SLOPE },
})

const planeTop = (opts: { liftM?: number; roofId?: string } = {}): WallTopProfile => ({
  kind: 'PLANE',
  plane: eaveSoffitPlane(opts.liftM ?? 0),
  sourceRoofId: opts.roofId ?? EAVE_IDS.roof,
})

/**
 * The wall itself.
 *
 * `top: 'FLAT'` is the STAGE WEB-PIVOT-02 shape — a plain box that stops at
 * `outerTopM` across its whole thickness, compiled by the rectangular path
 * STAGE WEB-PIVOT-01 proved. `top: 'PLANE'` is the corrected one. Everything
 * else about the two walls is the same record, which is what makes the
 * difference in their volumes mean something.
 */
export function eaveWall(opts: { top: 'FLAT' | 'PLANE'; liftM?: number; roofId?: string }): WallSpec {
  return {
    id: EAVE_IDS.wall,
    origin: { x: 0, y: 0, z: 0 },
    u: { x: 1, y: 0, z: 0 },
    up: { x: 0, y: 1, z: 0 },
    lengthM: EAVE.lengthM,
    heightM: EAVE.outerTopM,
    thicknessM: EAVE.thicknessM,
    ...(opts.top === 'PLANE' ? { topProfile: planeTop(opts) } : {}),
  }
}

/**
 * A window well clear of the soffit.
 *
 * Its head is at 2.1 m, against a soffit that is 3.0 m at the outer face and
 * 3.378 m at the inner. Its four numbers are the wall's own, and STAGE
 * WEB-PIVOT-02A does not touch them: the point of the opening in this fixture
 * is that clipping the wall's top moves nothing about it.
 */
export const EAVE_OPENING: OpeningSpec = {
  id: EAVE_IDS.opening,
  hostWallId: EAVE_IDS.wall,
  offsetM: 1.0,
  sillM: 0.5,
  widthM: 1.2,
  heightM: 1.6,
  cut: 'THROUGH',
}

export const EAVE_GLAZING: GlazingSpec = {
  id: EAVE_IDS.glazing,
  openingId: EAVE_IDS.opening,
  insetM: 0.1,
}

export const EAVE_LEVELS: LevelSpec[] = [
  { id: EAVE_IDS.baseLevel, kind: 'GROUND_FFL', elevationM: 0, provenance: synthetic('wall base') },
  {
    id: EAVE_IDS.eaveLevel,
    kind: 'EAVE',
    elevationM: EAVE_ROOF_EAVE_M,
    provenance: synthetic('roof top surface where it crosses the wall face'),
  },
  {
    id: EAVE_IDS.ridgeLevel,
    kind: 'RIDGE',
    elevationM: EAVE_ROOF_RIDGE_M,
    provenance: synthetic('roof top surface at the ridge'),
  },
]

/** The roof: a gable whose southern slope is the soffit above the wall. */
export function eaveRoof(opts: { liftM?: number } = {}): RoofSpec {
  const lift = opts.liftM ?? 0
  return {
    id: EAVE_IDS.roof,
    kind: 'GABLE',
    footprint: { minX: 0, maxX: EAVE.lengthM, minZ: -2 * EAVE.halfSpanM, maxZ: 0 },
    supportShellId: EAVE_IDS.shell,
    eaveLevelId: EAVE_IDS.eaveLevel,
    ridgeLevelId: EAVE_IDS.ridgeLevel,
    ridgeAxis: 'X',
    pitchDeg: EAVE.pitchDeg,
    overhangM: 0,
    thicknessM: EAVE.roofThicknessM,
    ownerStoreyId: EAVE_IDS.shell,
    provenance: synthetic(`gable at ${EAVE.pitchDeg} degrees, lifted ${lift} m`),
  }
}

export type EaveFixtureOptions = {
  /** `FLAT` is the STAGE WEB-PIVOT-02 shape; `PLANE` the corrected one. */
  top?: 'FLAT' | 'PLANE'
  /** Cut the window. */
  withOpening?: boolean
  /** Raise the wall's stated top plane by this much, without moving the roof. */
  wallLiftM?: number
  /** Raise the roof's two levels by this much, without moving the wall. */
  roofLiftM?: number
  /** Name a roof that is not in the spec. */
  roofId?: string
}

/**
 * The wall and its openings, ready for `compileWalls`.
 *
 * Deliberately not a `BuildingSpec`: one wall is not a closed storey ring, and
 * wrapping it in a shell would make the ring compiler say so — twice, on every
 * run, for a fixture that is not about rings. STAGE WEB-PIVOT-01C's ring is
 * proven on its own fixtures and again on the Marcowki attic, whose PLANE-topped
 * side walls are trimmed at both ends by real junctions.
 */
export function eaveWallInput(opts: EaveFixtureOptions = {}): WallCompileInput {
  return {
    walls: [eaveWall({ top: opts.top ?? 'PLANE', liftM: opts.wallLiftM, roofId: opts.roofId })],
    openings: opts.withOpening ? [EAVE_OPENING] : [],
    glazing: opts.withOpening ? [EAVE_GLAZING] : [],
  }
}

/** The roof's levels, raised together when the mutation calls for it. */
export function eaveLevels(opts: EaveFixtureOptions = {}): LevelSpec[] {
  const lift = opts.roofLiftM ?? 0
  return EAVE_LEVELS.map((l) => (l.kind === 'GROUND_FFL' ? l : { ...l, elevationM: l.elevationM + lift }))
}
