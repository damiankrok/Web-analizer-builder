/**
 * FOV-distance ambiguity detection (§24).
 *
 * Moving a camera back and narrowing its field of view leaves a building's
 * image almost unchanged; only the perspective foreshortening between near and
 * far parts of the object distinguishes them, and on a near-frontal
 * architectural view there is very little of it. The honest response is to keep
 * several hypotheses and say the uncertainty is there — not to report the
 * lowest-cost one as though the search had resolved it.
 *
 * PORT_DIRECT (Kotlin).
 */
import type { PoseCandidate } from './pose.js'
import { rad2deg } from '../math/vec.js'

export type AmbiguityReport = {
  /** Candidates whose cost is statistically indistinguishable from the best. */
  memberIndices: number[]
  /** Spread of the field of view across those, degrees. */
  fovSpreadDeg: number
  /** Spread of the camera distance across those, metres. */
  distanceSpreadM: number
  /** Spread of the azimuth across those, degrees. */
  azimuthSpreadDeg: number
  ambiguous: boolean
  /** Set when the members differ in FOV/distance but agree on bearing. */
  fovDistanceDegenerate: boolean
  groupId: string | null
  notes: string[]
}

export type AmbiguityOptions = {
  /** A candidate within this relative cost of the best is indistinguishable. */
  costTolerance: number
  /** FOV spread beyond this counts as unresolved, degrees. */
  fovSpreadDeg: number
  /** Distance spread beyond this fraction of the best distance counts. */
  distanceSpreadFraction: number
  /** Azimuth agreement below this means the bearing is settled, degrees. */
  azimuthAgreementDeg: number
}

export const DEFAULT_AMBIGUITY: AmbiguityOptions = {
  costTolerance: 0.12,
  fovSpreadDeg: 6,
  distanceSpreadFraction: 0.25,
  azimuthAgreementDeg: 8,
}

const spread = (values: number[]): number => (values.length === 0 ? 0 : Math.max(...values) - Math.min(...values))

/** Circular spread in degrees, handling wrap-around at 360. */
function azimuthSpreadDeg(values: number[]): number {
  if (values.length < 2) return 0
  const degs = values.map((v) => ((rad2deg(v) % 360) + 360) % 360).sort((a, b) => a - b)
  let best = 360
  for (let i = 0; i < degs.length; i++) {
    const rotated = degs.map((d, j) => (j >= i ? d - degs[i] : d + 360 - degs[i]))
    best = Math.min(best, Math.max(...rotated))
  }
  return best
}

export function detectAmbiguity(
  candidates: readonly PoseCandidate[],
  assetId: string,
  opts: AmbiguityOptions = DEFAULT_AMBIGUITY,
): AmbiguityReport {
  const notes: string[] = []
  if (candidates.length === 0) {
    return {
      memberIndices: [],
      fovSpreadDeg: 0,
      distanceSpreadM: 0,
      azimuthSpreadDeg: 0,
      ambiguous: false,
      fovDistanceDegenerate: false,
      groupId: null,
      notes: ['no candidates'],
    }
  }
  const best = candidates[0].cost
  const memberIndices: number[] = []
  for (let i = 0; i < candidates.length; i++) {
    const relative = best <= 1e-9 ? 0 : (candidates[i].cost - best) / best
    if (relative <= opts.costTolerance) memberIndices.push(i)
  }
  const members = memberIndices.map((i) => candidates[i])
  const fovSpreadDegValue = spread(members.map((m) => rad2deg(m.params.fovY)))
  const distanceSpreadM = spread(members.map((m) => m.params.distance))
  const azSpread = azimuthSpreadDeg(members.map((m) => m.params.azimuth))
  const bestDistance = candidates[0].params.distance

  const fovAmbiguous = fovSpreadDegValue > opts.fovSpreadDeg
  const distanceAmbiguous = distanceSpreadM > bestDistance * opts.distanceSpreadFraction
  const bearingSettled = azSpread <= opts.azimuthAgreementDeg
  const fovDistanceDegenerate = members.length > 1 && bearingSettled && (fovAmbiguous || distanceAmbiguous)
  const ambiguous = members.length > 1 && (fovAmbiguous || distanceAmbiguous || !bearingSettled)

  if (fovDistanceDegenerate) {
    notes.push(
      `field of view and distance trade off: ${members.length} poses within ${(opts.costTolerance * 100).toFixed(0)}% ` +
        `of the best cost span ${fovSpreadDegValue.toFixed(1)}° of FOV and ${distanceSpreadM.toFixed(1)} m of distance ` +
        `while agreeing on bearing to ${azSpread.toFixed(1)}°`,
    )
  } else if (ambiguous && !bearingSettled) {
    notes.push(`bearing is not resolved: indistinguishable poses span ${azSpread.toFixed(1)}° of azimuth`)
  }

  return {
    memberIndices,
    fovSpreadDeg: fovSpreadDegValue,
    distanceSpreadM,
    azimuthSpreadDeg: azSpread,
    ambiguous,
    fovDistanceDegenerate,
    groupId: ambiguous ? `amb_${assetId}` : null,
    notes,
  }
}
