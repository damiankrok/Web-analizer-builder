/** Camera contracts (§10, §11, §25). Pure data; Three.js is an adapter only. */
import type { Mat3, Vec3, Pixel } from '../math/vec.js'

export type ProjectionType =
  | 'ORTHOGRAPHIC_TECHNICAL'
  | 'PERSPECTIVE_PINHOLE'
  | 'PERSPECTIVE_SHIFTED'
  | 'PLANAR_DIAGRAM'
  | 'UNKNOWN'

export type CameraConfidence =
  | 'CAMERA_CONFIDENT'
  | 'CAMERA_USABLE'
  | 'CAMERA_WEAK'
  | 'CAMERA_UNRESOLVED'

export type CameraIntrinsics = {
  fx: number
  fy: number
  cx: number
  cy: number
  skew: number
}

export type CameraExtrinsics = {
  /** World -> camera rotation, row-major 3x3. */
  rotation: Mat3
  /** World -> camera translation, metres. */
  translation: Vec3
}

export type AnchorKind =
  | 'MASS_CORNER'
  | 'RIDGE_END'
  | 'EAVE_END'
  | 'GARAGE_CORNER'
  | 'OPENING_GROUP_CORNER'
  | 'OPENING_GROUP_CENTROID'
  | 'BALCONY_CORNER'
  | 'PORTAL_CORNER'
  | 'GROUND_CORNER'

export type AnchorMatch = {
  id: string
  kind: AnchorKind
  /** 3D point in WORLD metres taken from the metric scaffold. */
  world: Vec3
  /** Observed pixel in the asset's IMAGE frame. */
  image: Pixel
  confidence: number
  /** Which source produced the 2D observation. */
  provenance: string
  /** Residual in pixels under the owning camera hypothesis. */
  residualPx?: number
}

export type CameraHypothesis = {
  id: string
  sourceAssetId: string
  projectionType: ProjectionType
  intrinsics: CameraIntrinsics
  extrinsics: CameraExtrinsics
  fovY?: number
  target?: Vec3
  anchorMatches: AnchorMatch[]
  reprojectionResidual: number
  silhouetteScore: number
  edgeScore: number
  visibilityScore: number
  confidenceClass: CameraConfidence
  /** Set when this hypothesis belongs to a FOV/distance ambiguity family (§24). */
  ambiguityGroup?: string
  /** Rank within its asset's top-K list, 0 = best. */
  rank: number
}

export const imageSizeOf = (h: CameraHypothesis, width: number, height: number): { width: number; height: number } => ({
  width,
  height,
})

/** Focal length (px) from vertical FOV (rad) and image height (px). */
export const focalFromFovY = (fovY: number, imageHeight: number): number =>
  imageHeight / (2 * Math.tan(fovY / 2))

/** Vertical FOV (rad) from focal length (px) and image height (px). */
export const fovYFromFocal = (fy: number, imageHeight: number): number =>
  2 * Math.atan(imageHeight / (2 * fy))
