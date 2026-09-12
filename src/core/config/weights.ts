/**
 * All tunable weights and thresholds in one place, so the freeze required
 * before the holdout run (§43) can hash a single object.
 *
 * Tuned on A and B only (§25, §42). Once frozen, the holdout runs against
 * exactly these numbers and they are not touched again. WEB-02 extended the
 * object to cover the printed-dimension pipeline, the opening identity
 * resolver and the rooflight detector, so a freeze pins those too (§29).
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
import { VARIANT_BLOCK } from '../source/resolution.js'
import { DEFAULT_DIMENSION_GEOMETRY } from '../dimensions/geometry.js'
import { DEFAULT_SEGMENT } from '../dimensions/recognizer.js'
import { DEFAULT_CLASSIFY } from '../dimensions/templates.js'
import { DEFAULT_GRAMMAR } from '../dimensions/grammar.js'
import { DEFAULT_CHAIN_SOLVE } from '../dimensions/chains.js'
import { DEFAULT_RUNS } from '../dimensions/text-runs.js'
import { DEFAULT_SECTION_LEVELS } from '../dimensions/section-levels.js'
import { DEFAULT_DIMENSION_READ } from '../dimensions/reader.js'
import { DEFAULT_IDENTITY } from '../openings/identity.js'
import { DEFAULT_ROOFLIGHTS } from '../roof/rooflights.js'
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
  // WEB-02. Everything the printed-dimension pipeline, the opening identity
  // resolver and the rooflight detector can be tuned by, so the freeze before
  // the new holdout pins them too (§29).
  sourceResolution: { variantBlock: VARIANT_BLOCK },
  dimensionGeometry: DEFAULT_DIMENSION_GEOMETRY,
  glyphSegmentation: DEFAULT_SEGMENT,
  glyphClassification: DEFAULT_CLASSIFY,
  dimensionGrammar: DEFAULT_GRAMMAR,
  chainSolve: DEFAULT_CHAIN_SOLVE,
  textRuns: DEFAULT_RUNS,
  sectionLevels: { maxRowDistance: DEFAULT_SECTION_LEVELS.maxRowDistance, digitWidth: DEFAULT_SECTION_LEVELS.digitWidth },
  dimensionRead: {
    predictionTolerance: DEFAULT_DIMENSION_READ.predictionTolerance,
    minGlyphs: DEFAULT_DIMENSION_READ.minGlyphs,
    maxGlyphs: DEFAULT_DIMENSION_READ.maxGlyphs,
    rounds: DEFAULT_DIMENSION_READ.rounds,
    maxIntegerResidualCm: DEFAULT_DIMENSION_READ.maxIntegerResidualCm,
  },
  openingIdentity: DEFAULT_IDENTITY,
  rooflights: DEFAULT_ROOFLIGHTS,
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
  printedDimension:
    'a token read by the harvested template bank, accepted only where it also agrees with the geometry ' +
    'it annotates: a chain segment within 3% of its own baseline at the drawing\'s settled scale, or a ' +
    'level marker within 6 cm of the reference row it sits above',
  openingIdentity:
    'observations of one opening are those on the same facade whose facade intervals overlap by at least ' +
    'minOverlap of the shorter and whose sills agree, across different sources; within one source only ' +
    'nesting counts, and a nested member is a panel rather than a second opening',
  rooflight:
    'a compact region standing out from its roof plane\'s own tone in either direction, clear of every ' +
    'edge of the plane, not part of a repeating course, and sized like a glazed unit rather than a dormer',
} as const

export type FreezeHashes = {
  weightHash: string
  thresholdHash: string
  metricDefinitionHash: string
  configHash: string
  /** Grammar and recogniser configuration, hashed apart from the rest (§29). */
  grammarHash: string
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
    dimensionGeometry: ANALYZER_CONFIG.dimensionGeometry,
    glyphSegmentation: ANALYZER_CONFIG.glyphSegmentation,
    glyphClassification: ANALYZER_CONFIG.glyphClassification,
    chainSolve: ANALYZER_CONFIG.chainSolve,
    textRuns: ANALYZER_CONFIG.textRuns,
    dimensionRead: ANALYZER_CONFIG.dimensionRead,
    openingIdentity: ANALYZER_CONFIG.openingIdentity,
    rooflights: ANALYZER_CONFIG.rooflights,
  }
  return {
    weightHash: hashObject(weights),
    thresholdHash: hashObject(thresholds),
    metricDefinitionHash: hashObject(METRIC_DEFINITIONS),
    configHash: hashObject(ANALYZER_CONFIG),
    grammarHash: hashObject({
      grammar: ANALYZER_CONFIG.dimensionGrammar,
      sectionLevels: ANALYZER_CONFIG.sectionLevels,
      resolution: ANALYZER_CONFIG.sourceResolution,
      // There is no template file to hash: the bank is harvested from each
      // project's own drawings at run time, so what is frozen is the harvesting
      // rule, not a set of glyph images.
      templates: 'harvested per project from solved chains and section levels',
    }),
  }
}
