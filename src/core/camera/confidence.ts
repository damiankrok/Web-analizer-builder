/**
 * Camera confidence classes (§25).
 *
 * The class decides how much a view is allowed to influence geometry, so it has
 * to reflect how well-determined the camera actually is rather than how low its
 * pixel cost got. A near-frontal render can reach a very low silhouette cost
 * while leaving distance, field of view and even bearing barely constrained;
 * treating that as a confident camera is exactly how a plausible-looking fit
 * corrupts a source-true model.
 *
 * Thresholds live in config/weights.ts and are frozen before the holdout (§25,
 * §43).
 *
 * PORT_DIRECT (Kotlin).
 */
import type { CameraConfidence } from '../contracts/camera.js'
import type { AmbiguityReport } from './ambiguity.js'

export type ConfidenceInputs = {
  /** Silhouette descriptor cost of the best candidate; lower is better. */
  cost: number
  /** Silhouette IoU of the best candidate. */
  iou: number
  /** Anchors that projected close to a detected image feature. */
  anchorMatches: number
  /** Mean anchor reprojection residual in pixels, or null when none matched. */
  meanAnchorResidualPx: number | null
  ambiguity: AmbiguityReport
  /** Whether the source image gave a genuine vanishing point to fit against. */
  hasVanishingConstraint: boolean
}

export type ConfidenceThresholds = {
  confidentCost: number
  confidentIoU: number
  confidentAnchors: number
  confidentAnchorResidualPx: number
  usableCost: number
  usableIoU: number
  weakCost: number
  weakIoU: number
}

export const DEFAULT_CONFIDENCE: ConfidenceThresholds = {
  confidentCost: 0.035,
  confidentIoU: 0.8,
  confidentAnchors: 6,
  confidentAnchorResidualPx: 12,
  usableCost: 0.055,
  usableIoU: 0.65,
  weakCost: 0.1,
  weakIoU: 0.4,
}

export type ConfidenceVerdict = {
  klass: CameraConfidence
  reasons: string[]
}

export function classifyCamera(
  input: ConfidenceInputs,
  t: ConfidenceThresholds = DEFAULT_CONFIDENCE,
): ConfidenceVerdict {
  const reasons: string[] = []

  if (!Number.isFinite(input.cost) || input.iou <= 0) {
    return { klass: 'CAMERA_UNRESOLVED', reasons: ['no usable fit'] }
  }

  const confidentShape = input.cost <= t.confidentCost && input.iou >= t.confidentIoU
  const confidentAnchors =
    input.anchorMatches >= t.confidentAnchors &&
    input.meanAnchorResidualPx !== null &&
    input.meanAnchorResidualPx <= t.confidentAnchorResidualPx

  if (confidentShape && confidentAnchors && !input.ambiguity.ambiguous) {
    reasons.push(
      `silhouette cost ${input.cost.toFixed(4)} and IoU ${input.iou.toFixed(3)} are both strong, ` +
        `${input.anchorMatches} anchors matched at ${input.meanAnchorResidualPx?.toFixed(1)} px, and the pose is unambiguous`,
    )
    return { klass: 'CAMERA_CONFIDENT', reasons }
  }

  if (input.cost <= t.usableCost && input.iou >= t.usableIoU) {
    if (input.ambiguity.fovDistanceDegenerate) {
      reasons.push('shape fit is good but field of view and distance are degenerate, so the camera cannot refine geometry')
    } else if (!confidentAnchors) {
      reasons.push(
        `shape fit is good but anchor support is thin (${input.anchorMatches} matches` +
          `${input.meanAnchorResidualPx !== null ? ` at ${input.meanAnchorResidualPx.toFixed(1)} px` : ''})`,
      )
    } else {
      reasons.push('pose is well placed but not tight enough to drive geometry refinement')
    }
    if (!input.hasVanishingConstraint) {
      reasons.push('the view is near-frontal, so perspective adds little constraint')
    }
    return { klass: 'CAMERA_USABLE', reasons }
  }

  if (input.cost <= t.weakCost && input.iou >= t.weakIoU) {
    reasons.push(
      `weak fit (cost ${input.cost.toFixed(4)}, IoU ${input.iou.toFixed(3)}): only semantic presence evidence is admissible`,
    )
    return { klass: 'CAMERA_WEAK', reasons }
  }

  reasons.push(`fit rejected (cost ${input.cost.toFixed(4)}, IoU ${input.iou.toFixed(3)})`)
  return { klass: 'CAMERA_UNRESOLVED', reasons }
}

/**
 * How much a view's score may weigh in the multi-view objective (§25, §26).
 * An unresolved camera contributes nothing at all — it must not be able to
 * move geometry by being consistently wrong.
 */
export function viewWeightFor(klass: CameraConfidence): number {
  switch (klass) {
    case 'CAMERA_CONFIDENT':
      return 1
    case 'CAMERA_USABLE':
      return 0.55
    case 'CAMERA_WEAK':
      return 0.15
    case 'CAMERA_UNRESOLVED':
    default:
      return 0
  }
}

/** Whether a camera may drive bounded geometry refinement (§25 CONFIDENT only). */
export const mayRefineGeometry = (klass: CameraConfidence): boolean => klass === 'CAMERA_CONFIDENT'

/** Whether a camera may choose among source-compatible hypotheses (§25 USABLE+). */
export const maySelectHypothesis = (klass: CameraConfidence): boolean =>
  klass === 'CAMERA_CONFIDENT' || klass === 'CAMERA_USABLE'
