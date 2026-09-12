/**
 * All tunable weights and thresholds in one place, so the freeze required
 * before the holdout run (§43) can hash a single object.
 *
 * Tuned on A and B only (§25, §42). Once frozen, C runs against exactly these
 * numbers and they are not touched again.
 */
import { DEFAULT_HOUGH } from '../raster/lines.js'
import { DEFAULT_VANISHING } from '../projection/vanishing.js'
import { DEFAULT_POSE_SEARCH } from '../camera/pose.js'
import { DEFAULT_CONFIDENCE } from '../camera/confidence.js'
import { DEFAULT_AMBIGUITY } from '../camera/ambiguity.js'
import { DEFAULT_VIEW_WEIGHTS } from '../scoring/view.js'
import { DEFAULT_ELEVATION_WEIGHTS } from '../scoring/elevation.js'
import { DEFAULT_MULTIVIEW_WEIGHTS } from '../scoring/multiview.js'
import { DEFAULT_REPAIR } from '../repair/engine.js'
import { DEFAULT_PROPOSALS } from '../repair/proposals.js'
import { DEFAULT_RASTER } from '../raster/pipeline.js'
import { ARCHON_POLICY } from '../source/fetch-policy.js'
import { hashObject } from '../util/hash.js'

/**
 * Weight of the manual reference model in automatic scoring.
 *
 * Zero, always (§39). The reference screenshots are a development oracle for
 * human inspection; nothing automatic may read them. Asserted in tests.
 */
export const REFERENCE_WEIGHT = 0

export const ANALYZER_CONFIG = {
  version: '0.1.0',
  referenceWeight: REFERENCE_WEIGHT,
  raster: { maxEdge: DEFAULT_RASTER.maxEdge, cannyLow: DEFAULT_RASTER.cannyLow, cannyHigh: DEFAULT_RASTER.cannyHigh },
  hough: DEFAULT_HOUGH,
  vanishing: DEFAULT_VANISHING,
  pose: DEFAULT_POSE_SEARCH,
  cameraConfidence: DEFAULT_CONFIDENCE,
  ambiguity: DEFAULT_AMBIGUITY,
  viewWeights: DEFAULT_VIEW_WEIGHTS,
  elevationWeights: DEFAULT_ELEVATION_WEIGHTS,
  multiViewWeights: DEFAULT_MULTIVIEW_WEIGHTS,
  repair: DEFAULT_REPAIR,
  proposals: DEFAULT_PROPOSALS,
  fetchPolicy: { maxAssets: ARCHON_POLICY.maxAssets, concurrency: ARCHON_POLICY.concurrency },
} as const

/** Metric definitions, hashed separately so a scoring change is visible (§43). */
export const METRIC_DEFINITIONS = {
  silhouette: '1 - IoU of candidate and source building masks at the score resolution',
  edge: 'symmetric chamfer distance between candidate and source edge maps, normalised by the image diagonal',
  roofline: 'mean absolute skyline difference over shared columns, normalised by image height',
  massCorner: 'mean bounding-box corner distance, normalised by the image diagonal',
  openingLayout: 'mean distance from each visible opening-group centroid to the nearest detected dark region',
  semanticPresence: 'fraction of visible opening groups with no corroborating region',
  visibility: 'fraction of should-be-visible anchors with no matching image feature',
  multiView: 'weighted sum of metric, plan, section, elevation and confidence-weighted perspective terms',
} as const

export type FreezeHashes = {
  weightHash: string
  thresholdHash: string
  metricDefinitionHash: string
  configHash: string
}

/**
 * Hashes that pin the analyzer's behaviour. Weights and thresholds are hashed
 * separately so a report can say which of the two moved.
 */
export function freezeHashes(): FreezeHashes {
  const weights = {
    view: ANALYZER_CONFIG.viewWeights,
    elevation: ANALYZER_CONFIG.elevationWeights,
    multiView: ANALYZER_CONFIG.multiViewWeights,
  }
  const thresholds = {
    vanishing: ANALYZER_CONFIG.vanishing,
    cameraConfidence: ANALYZER_CONFIG.cameraConfidence,
    ambiguity: ANALYZER_CONFIG.ambiguity,
    repair: ANALYZER_CONFIG.repair,
    hough: ANALYZER_CONFIG.hough,
  }
  return {
    weightHash: hashObject(weights),
    thresholdHash: hashObject(thresholds),
    metricDefinitionHash: hashObject(METRIC_DEFINITIONS),
    configHash: hashObject(ANALYZER_CONFIG),
  }
}
