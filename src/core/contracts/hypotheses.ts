/** Building hypothesis contracts (§29-§32). Source-neutral by construction. */
import type { Polygon2D, Vec2, Vec3 } from './geometry.js'
import type { Authority } from './evidence.js'

export type MassKind =
  | 'MAIN_BODY'
  | 'GARAGE'
  | 'SIDE_ANNEX'
  | 'FLAT_ROOF_WING'
  | 'FRONT_LOW_MASS'
  | 'COVERED_TERRACE'
  | 'BALCONY_SLAB'
  | 'CANOPY'
  | 'RECESS'
  | 'PROJECTION'

export type RoofKind =
  | 'GABLE'
  | 'HIP'
  | 'MONO_PITCH'
  | 'FLAT'
  | 'GABLE_WITH_DORMER'
  | 'NONE'

/** Compass-ish facade side in the WORLD frame. FRONT faces -Z. */
export type FacadeSide = 'FRONT' | 'REAR' | 'LEFT' | 'RIGHT'

export type RoofHypothesis = {
  id: string
  massId: string
  kind: RoofKind
  /** Pitch in degrees; 0 for FLAT. */
  pitchDeg: number
  /** Eave height above WORLD y=0, metres. */
  eaveY: number
  /** Ridge height above WORLD y=0, metres. NONE/FLAT: equals eaveY. */
  ridgeY: number
  /** Ridge direction in the PLAN frame, unit length. Undefined for FLAT. */
  ridgeDir?: Vec2
  overhangM: number
  authority: Authority
  confidence: number
}

export type MassHypothesis = {
  id: string
  kind: MassKind
  footprint: Polygon2D
  /** Base and top of the walls (not the roof), metres above WORLD y=0. */
  baseY: number
  topY: number
  /** Storeys this mass encloses. */
  storeyIds: string[]
  authority: Authority
  confidence: number
  /** Provenance: which evidence nodes produced or constrain this mass. */
  evidenceIds: string[]
}

export type StoreyHypothesis = {
  id: string
  name: 'GROUND' | 'UPPER' | 'ATTIC'
  /** Finished floor level, metres above WORLD y=0. */
  floorY: number
  /** Structural ceiling / slab top. */
  ceilingY: number
  netAreaM2?: number
  authority: Authority
}

export type OpeningKind =
  | 'WINDOW'
  | 'DOOR'
  | 'GARAGE_GATE'
  | 'SLIDING_GLAZING'
  | 'GABLE_GLAZING'
  | 'ROOFLIGHT'

export type OpeningHypothesis = {
  id: string
  kind: OpeningKind
  facade: FacadeSide
  massId: string
  /** Facade-local: horizontal position of the opening's left edge, metres. */
  s: number
  /** Facade-local: sill height above WORLD y=0, metres. */
  sillY: number
  widthM: number
  heightM: number
  authority: Authority
  confidence: number
  groupId?: string
}

/**
 * An opening group is the structural unit (§32): the outer polygon is
 * structural, mullions are secondary and carried as `panelCount` only.
 */
export type OpeningGroupHypothesis = {
  id: string
  facade: FacadeSide
  massId: string
  kind: OpeningKind
  memberIds: string[]
  s: number
  sillY: number
  widthM: number
  heightM: number
  panelCount: number
  /** Gable/sloped clipping: openings clipped by the roof plane above. */
  clippedByRoof: boolean
  authority: Authority
  confidence: number
}

export type AppearanceFeature = {
  id: string
  kind: 'BAND' | 'PORTAL' | 'RAILING' | 'CHIMNEY' | 'PIER' | 'PLINTH'
  facade?: FacadeSide
  massId?: string
  /** Facade-local box, metres. */
  s?: number
  t?: number
  widthM?: number
  heightM?: number
  /** WORLD position for features that are not facade-bound (chimneys). */
  world?: Vec3
  authority: Authority
  confidence: number
}

export type BuildingHypothesis = {
  id: string
  /** Provenance chain: parent hypothesis id and the repair that produced this. */
  parentId?: string
  producedBy: string
  storeys: StoreyHypothesis[]
  masses: MassHypothesis[]
  roofs: RoofHypothesis[]
  openings: OpeningHypothesis[]
  openingGroups: OpeningGroupHypothesis[]
  appearance: AppearanceFeature[]
  /** Hard metric constraints this hypothesis must keep satisfying (§38). */
  constraints: MetricConstraint[]
}

export type MetricConstraint = {
  id: string
  key: string
  description: string
  target: number
  toleranceAbs: number
  unit: string
  authority: Authority
}

export type ConstraintCheck = {
  constraintId: string
  key: string
  target: number
  actual: number
  deviation: number
  toleranceAbs: number
  satisfied: boolean
}
