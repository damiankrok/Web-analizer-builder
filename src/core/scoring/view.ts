/**
 * Perspective view scoring (§35).
 *
 * RGB comparison is forbidden as a primary score (§35) and rightly so: a
 * candidate is an untextured massing model and the source is a lit, furnished,
 * landscaped visualisation, so pixel difference measures rendering style rather
 * than geometry. Every term here is structural instead — silhouette overlap,
 * symmetric edge distance, roofline agreement, mass-corner and opening-group
 * residuals, semantic presence, and visibility consistency.
 *
 * The edge term is what separates poses the silhouette cannot. A gable end
 * looks the same from the front and from the back in outline; the openings,
 * the garage wing and the balcony do not.
 *
 * PORT_DIRECT (Kotlin).
 */
import type { MaskImage } from '../contracts/raster.js'
import type { ViewScoreBreakdown } from '../contracts/scoring.js'
import type { CameraHypothesis } from '../contracts/camera.js'
import type { Tessellation } from '../hypotheses/tessellate.js'
import type { RenderFeatures } from '../scaffold/render-features.js'
import { maskIoU, resampleMask, skylineProfile, maskBounds } from '../raster/mask.js'
import { symmetricChamfer } from '../raster/chamfer.js'
import { renderEdges, renderPerspective, pointVisibility, type RenderTarget } from '../camera/render.js'
import { project, type CameraView } from '../camera/projector.js'
import { viewWeightFor } from '../camera/confidence.js'

export type ViewScoreWeights = {
  silhouette: number
  edge: number
  roofline: number
  massCorner: number
  openingLayout: number
  semanticPresence: number
  visibility: number
}

/**
 * Structural terms carry the weight. The opening terms are deliberately small
 * for *perspective* views: in these visualisations the glazing reflects sky and
 * reads bright rather than dark, so the dark-region detector that works on the
 * technical elevations finds only a handful of regions here. Letting a term
 * that thin carry real weight lets detector noise outvote the silhouette, which
 * is measurably worse — it promoted a visibly wrong pose during development.
 * On elevations the same evidence is reliable and is weighted accordingly
 * (see scoring/elevation.ts).
 */
export const DEFAULT_VIEW_WEIGHTS: ViewScoreWeights = {
  silhouette: 0.34,
  edge: 0.3,
  roofline: 0.18,
  massCorner: 0.1,
  openingLayout: 0.04,
  semanticPresence: 0.02,
  visibility: 0.02,
}

/** Below this many detected regions, the opening terms are treated as absent. */
export const MIN_OBSERVED_OPENINGS = 3

export type ViewScoreInput = {
  assetId: string
  camera: CameraHypothesis
  view: CameraView
  tess: Tessellation
  /** Source silhouette in the analysis frame. */
  sourceMask: MaskImage
  /** Source structural edges in the analysis frame. */
  sourceEdges: MaskImage
  features: RenderFeatures
  scoreSize: number
  weights?: ViewScoreWeights
}

/**
 * Mean absolute difference of two skyline profiles over the columns where both
 * exist, normalised by image height. The roofline is the single most
 * informative contour on an architectural view, so it is scored separately from
 * the silhouette as a whole rather than being diluted into it.
 */
export function rooflineResidual(a: MaskImage, b: MaskImage): { value: number; overlapFraction: number } {
  const sa = skylineProfile(a)
  const sb = skylineProfile(b)
  let sum = 0
  let n = 0
  for (let x = 0; x < Math.min(sa.length, sb.length); x++) {
    if (sa[x] < 0 || sb[x] < 0) continue
    sum += Math.abs(sa[x] - sb[x])
    n++
  }
  const columns = Math.max(1, Math.min(sa.length, sb.length))
  if (n === 0) return { value: 1, overlapFraction: 0 }
  return { value: Math.min(1, sum / n / a.height), overlapFraction: n / columns }
}

/** Normalised distance between the two masks' bounding-box corners. */
export function massCornerResidual(a: MaskImage, b: MaskImage): number {
  const ba = maskBounds(a)
  const bb = maskBounds(b)
  if (ba.empty || bb.empty) return 1
  const diag = Math.hypot(a.width, a.height)
  const d =
    Math.hypot(ba.minX - bb.minX, ba.minY - bb.minY) +
    Math.hypot(ba.maxX - bb.maxX, ba.maxY - bb.maxY) +
    Math.hypot(ba.minX - bb.minX, ba.maxY - bb.maxY) +
    Math.hypot(ba.maxX - bb.maxX, ba.minY - bb.minY)
  return Math.min(1, d / (4 * diag))
}

/**
 * Opening-group layout: how far each projected opening-group centroid sits from
 * the nearest detected dark region in the source, normalised by the diagonal.
 * Groups that should not be visible are excluded rather than penalised (§34).
 */
export function openingLayoutResidual(
  input: ViewScoreInput,
  target: RenderTarget,
): { value: number; missing: string[]; checked: number } {
  const centroids = input.tess.anchors.filter((a) => a.kind === 'OPENING_GROUP_CENTROID')
  if (centroids.length === 0) return { value: 0.5, missing: [], checked: 0 }
  const diag = Math.hypot(input.view.width, input.view.height)
  const observed = input.features.openings.map((o) => ({ u: (o.minX + o.maxX) / 2, v: (o.minY + o.maxY) / 2 }))
  // Finding no openings at all in the source is a failure of the detector, not
  // evidence that the building has none. Scoring it as a total miss would let
  // detector noise outvote the silhouette, so the term goes neutral instead.
  if (observed.length < MIN_OBSERVED_OPENINGS) return { value: 0.5, missing: [], checked: 0 }
  const missing: string[] = []
  let sum = 0
  let checked = 0
  for (const a of centroids) {
    const verdict = pointVisibility(a.world, input.view, target)
    if (!verdict.visible) continue
    const p = project(a.world, input.view)
    if (!p.visible) continue
    checked++
    let best = Number.POSITIVE_INFINITY
    for (const o of observed) best = Math.min(best, Math.hypot(o.u - p.u, o.v - p.v))
    const normalised = Math.min(1, best / (diag * 0.12))
    if (normalised >= 0.999) missing.push(a.id)
    sum += normalised
  }
  if (checked === 0) return { value: 0.5, missing, checked }
  return { value: sum / checked, missing, checked }
}

/**
 * Visibility consistency (§34): of the anchors the hypothesis says should be
 * visible in this view, how many the image actually corroborates. A feature
 * that is occluded or outside the crop is not counted against the hypothesis.
 */
export function visibilityResidual(camera: CameraHypothesis): number {
  const matched = camera.anchorMatches.length
  const denominator = matched + Math.max(0, Math.round((1 - camera.visibilityScore) * matched * 2))
  if (denominator === 0) return 1
  return 1 - matched / denominator
}

export function scoreView(input: ViewScoreInput): ViewScoreBreakdown {
  const weights = input.weights ?? DEFAULT_VIEW_WEIGHTS
  const notes: string[] = []
  const w = input.scoreSize
  const h = Math.max(8, Math.round((w * input.view.height) / input.view.width))

  const target = renderPerspective(input.tess.tris, input.view, w, h)
  const candidateMask = target.mask
  const reference = resampleMask(input.sourceMask, w, h)

  const iou = maskIoU(candidateMask, reference)
  const silhouette = 1 - iou

  const candidateEdges = renderEdges(input.tess.edges, input.view, target)
  const referenceEdges = resampleMask(input.sourceEdges, w, h)
  const edge = symmetricChamfer(candidateEdges, referenceEdges)

  const roof = rooflineResidual(candidateMask, reference)
  if (roof.overlapFraction < 0.4) notes.push('roofline comparison covers less than half the columns')

  const massCorner = massCornerResidual(candidateMask, reference)
  const opening = openingLayoutResidual(input, target)
  if (opening.checked === 0) notes.push('no opening group is visible in this view')

  // Semantic presence: fraction of the hypothesis's opening groups that the
  // image corroborates at all, regardless of exact position.
  const semanticPresence =
    opening.checked === 0 ? 0.5 : Math.min(1, opening.missing.length / Math.max(1, opening.checked))

  const visibility = visibilityResidual(input.camera)

  const total =
    weights.silhouette * silhouette +
    weights.edge * edge +
    weights.roofline * roof.value +
    weights.massCorner * massCorner +
    weights.openingLayout * opening.value +
    weights.semanticPresence * semanticPresence +
    weights.visibility * visibility

  return {
    assetId: input.assetId,
    cameraId: input.camera.id,
    silhouette,
    edge,
    roofline: roof.value,
    massCorner,
    openingLayout: opening.value,
    semanticPresence,
    visibility,
    total,
    viewWeight: viewWeightFor(input.camera.confidenceClass),
    missingVisibleFeatures: opening.missing,
    notes,
  }
}
