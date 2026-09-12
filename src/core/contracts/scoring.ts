/** Scoring contracts (§26, §35, §36). All scores are costs: lower is better. */
import type { ConstraintCheck } from './hypotheses.js'

export type ViewScoreBreakdown = {
  assetId: string
  cameraId: string | null
  /** 1 - IoU of the silhouettes. */
  silhouette: number
  /** Symmetric chamfer distance between edge maps, normalised by image diagonal. */
  edge: number
  roofline: number
  massCorner: number
  openingLayout: number
  semanticPresence: number
  visibility: number
  /** Weighted sum of the above. */
  total: number
  /** Weight this view contributes to the aggregate, from camera confidence. */
  viewWeight: number
  /** Features that should have been visible and were not found (§34). */
  missingVisibleFeatures: string[]
  notes: string[]
}

export type ElevationScoreBreakdown = {
  assetId: string
  facade: string
  silhouette: number
  roofline: number
  openingPosition: number
  openingSize: number
  bandLevels: number
  featurePosition: number
  total: number
  notes: string[]
}

export type MultiViewScore = {
  hypothesisId: string
  metric: number
  plan: number
  section: number
  elevation: number
  perspective: number
  /** Weighted total; the single number repairs must improve (§38). */
  total: number
  constraintChecks: ConstraintCheck[]
  hardConstraintsSatisfied: boolean
  elevationScores: ElevationScoreBreakdown[]
  viewScores: ViewScoreBreakdown[]
}
