/**
 * Technical elevation scoring (§36).
 *
 * Elevations outrank perspective views because there is no camera to solve: the
 * projection is orthographic and known, so a disagreement here is a
 * disagreement about the building rather than about where someone stood. That
 * is why these scores enter the multi-view objective with the largest weight
 * and why a repair that improves a render at an elevation's expense is refused.
 *
 * PORT_DIRECT (Kotlin).
 */
import type { MaskImage } from '../contracts/raster.js'
import type { ElevationScoreBreakdown } from '../contracts/scoring.js'
import type { ElevationAnalysis } from '../contracts/scaffold.js'
import type { FacadeSide } from '../contracts/hypotheses.js'
import type { Tessellation } from '../hypotheses/tessellate.js'
import type { Vec3 } from '../contracts/geometry.js'
import { maskIoU, resampleMask } from '../raster/mask.js'
import { renderOrthographic } from '../camera/render.js'
import type { OrthographicView } from '../camera/projector.js'
import { rooflineResidual, massCornerResidual } from './view.js'

export type ElevationScoreWeights = {
  silhouette: number
  roofline: number
  openingPosition: number
  openingSize: number
  bandLevels: number
  featurePosition: number
}

export const DEFAULT_ELEVATION_WEIGHTS: ElevationScoreWeights = {
  silhouette: 0.35,
  roofline: 0.25,
  openingPosition: 0.15,
  openingSize: 0.1,
  bandLevels: 0.1,
  featurePosition: 0.05,
}

/**
 * Orthographic view onto one facade, framed to the building's own extent.
 * There is no pose to fit — the projection follows from the facade's normal and
 * the scale the published height already fixed.
 */
export function orthoViewForFacade(
  side: FacadeSide,
  worldMin: Vec3,
  worldMax: Vec3,
  width: number,
  height: number,
  marginFraction = 0.06,
): OrthographicView {
  const spanX = worldMax.x - worldMin.x
  const spanZ = worldMax.z - worldMin.z
  const spanY = worldMax.y - worldMin.y
  const horizontalSpan = side === 'FRONT' || side === 'REAR' ? spanX : spanZ
  const margin = Math.max(horizontalSpan, spanY) * marginFraction
  const scale = Math.min(width / (horizontalSpan + 2 * margin), height / (spanY + 2 * margin))

  const right: Vec3 =
    side === 'FRONT'
      ? { x: 1, y: 0, z: 0 }
      : side === 'REAR'
        ? { x: -1, y: 0, z: 0 }
        : side === 'LEFT'
          ? { x: 0, y: 0, z: 1 }
          : { x: 0, y: 0, z: -1 }
  const up: Vec3 = { x: 0, y: 1, z: 0 }
  const origin: Vec3 =
    side === 'FRONT'
      ? { x: worldMin.x, y: worldMin.y, z: worldMax.z }
      : side === 'REAR'
        ? { x: worldMax.x, y: worldMin.y, z: worldMin.z }
        : side === 'LEFT'
          ? { x: worldMin.x, y: worldMin.y, z: worldMin.z }
          : { x: worldMax.x, y: worldMin.y, z: worldMax.z }

  return {
    right,
    up,
    scale,
    origin,
    originU: margin * scale,
    originV: height - margin * scale,
    width,
    height,
  }
}

export type ElevationScoreInput = {
  assetId: string
  facade: FacadeSide
  tess: Tessellation
  worldMin: Vec3
  worldMax: Vec3
  sourceMask: MaskImage
  analysis: ElevationAnalysis
  /** Opening groups of the hypothesis on this facade, in facade metres. */
  hypothesisOpenings: Array<{ s: number; sillY: number; widthM: number; heightM: number }>
  /** Band levels the hypothesis predicts on this facade, metres. */
  hypothesisBands: number[]
  scoreSize: number
  weights?: ElevationScoreWeights
}

const meanNearestDistance = (a: readonly number[], b: readonly number[], scale: number): number => {
  if (a.length === 0 || b.length === 0) return 0.5
  let sum = 0
  for (const x of a) {
    let best = Number.POSITIVE_INFINITY
    for (const y of b) best = Math.min(best, Math.abs(x - y))
    sum += Math.min(1, best / scale)
  }
  return sum / a.length
}

export function scoreElevation(input: ElevationScoreInput): ElevationScoreBreakdown {
  const weights = input.weights ?? DEFAULT_ELEVATION_WEIGHTS
  const notes: string[] = []
  const w = input.scoreSize
  const h = Math.max(8, Math.round((w * input.sourceMask.height) / input.sourceMask.width))

  const view = orthoViewForFacade(input.facade, input.worldMin, input.worldMax, w, h)
  const target = renderOrthographic(input.tess.tris, view, w, h)
  const reference = resampleMask(input.sourceMask, w, h)

  const silhouette = 1 - maskIoU(target.mask, reference)
  const roof = rooflineResidual(target.mask, reference)
  const featurePosition = massCornerResidual(target.mask, reference)

  // Openings: compare facade-local positions and sizes in metres, so the score
  // is in building units rather than in pixels of whatever size ARCHON chose.
  const observedS = input.analysis.openings.map((o) => o.s + o.widthM / 2)
  const predictedS = input.hypothesisOpenings.map((o) => o.s + o.widthM / 2)
  const scaleM = Math.max(1, (input.worldMax.x - input.worldMin.x) * 0.15)
  const openingPosition =
    observedS.length === 0 && predictedS.length === 0 ? 0 : meanNearestDistance(predictedS, observedS, scaleM)

  const observedW = input.analysis.openings.map((o) => o.widthM)
  const predictedW = input.hypothesisOpenings.map((o) => o.widthM)
  const openingSize =
    observedW.length === 0 && predictedW.length === 0 ? 0 : meanNearestDistance(predictedW, observedW, 1.5)

  const bandLevels = meanNearestDistance(input.hypothesisBands, input.analysis.bandLevels, 0.8)

  if (input.analysis.openings.length === 0) notes.push('no openings detected on this elevation')

  const total =
    weights.silhouette * silhouette +
    weights.roofline * roof.value +
    weights.openingPosition * openingPosition +
    weights.openingSize * openingSize +
    weights.bandLevels * bandLevels +
    weights.featurePosition * featurePosition

  return {
    assetId: input.assetId,
    facade: input.facade,
    silhouette,
    roofline: roof.value,
    openingPosition,
    openingSize,
    bandLevels,
    featurePosition,
    total,
    notes,
  }
}
