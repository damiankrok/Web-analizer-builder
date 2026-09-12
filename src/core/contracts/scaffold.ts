/** Metric scaffold contracts (§15-§18). */
import type { Polygon2D, Vec2 } from './geometry.js'
import type { Authority } from './evidence.js'
import type { FacadeSide } from './hypotheses.js'

export type LevelObservation = {
  id: string
  kind: 'GROUND_FLOOR' | 'UPPER_FLOOR' | 'SLAB' | 'EAVE' | 'RIDGE' | 'KNEE_WALL_TOP' | 'PLINTH'
  y: number
  authority: Authority
  confidence: number
  sourceAssetId?: string
}

export type PlanCalibration = {
  assetId: string
  /** Pixels per metre, from the plan's own printed dimensions or area fit. */
  pixelsPerMetre: number
  method: 'DIMENSION_STRING' | 'AREA_FIT' | 'BBOX_FIT' | 'FALLBACK'
  confidence: number
  residual: number
}

export type WallLine = {
  id: string
  a: Vec2
  b: Vec2
  thicknessM: number
  structural: boolean
  confidence: number
}

export type PlanAnalysis = {
  assetId: string
  storey: 'GROUND' | 'UPPER'
  calibration: PlanCalibration
  /** Outline of the built footprint in PLAN metres, origin-normalised. */
  outline: Polygon2D
  outlineAreaM2: number
  walls: WallLine[]
  regions: Polygon2D[]
  confidence: number
  notes: string[]
}

export type SectionAnalysis = {
  assetId: string
  levels: LevelObservation[]
  roofPitchDeg: number | null
  kneeWallM: number | null
  confidence: number
  notes: string[]
}

export type ElevationOpening = {
  id: string
  /** Facade-local metres. */
  s: number
  sillY: number
  widthM: number
  heightM: number
  confidence: number
}

export type ElevationAnalysis = {
  assetId: string
  facade: FacadeSide
  /** Metres per pixel, recovered by fitting the silhouette to known heights. */
  metresPerPixel: number
  silhouette: Vec2[]
  widthM: number
  ridgeY: number | null
  eaveY: number | null
  openings: ElevationOpening[]
  bandLevels: number[]
  confidence: number
  notes: string[]
}

export type MetricScaffold = {
  /** Footprint of the whole building in PLAN metres. */
  footprint: Polygon2D
  footprintAreaM2: number
  widthM: number
  depthM: number
  levels: LevelObservation[]
  roofPitchDeg: number
  kneeWallM: number
  ridgeY: number
  eaveY: number
  buildingHeightM: number
  plans: PlanAnalysis[]
  section: SectionAnalysis | null
  elevations: ElevationAnalysis[]
  /** Confidence that this scaffold is metric enough for camera fitting (§15). */
  confidence: number
  notes: string[]
}
