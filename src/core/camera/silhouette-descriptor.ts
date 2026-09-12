/**
 * Fixed-length silhouette descriptor used as the camera solver's residual.
 *
 * Pose refinement needs a residual *vector* of constant length whose entries
 * move smoothly with the parameters. Silhouette IoU has neither property: it is
 * one number and it changes in pixel-sized steps, so a numeric Jacobian over it
 * is mostly zeros. Sampling the silhouette's radius along a fixed fan of rays
 * from its centroid gives a vector that is the same length for every pose,
 * varies continuously as the pose moves, and still describes the shape rather
 * than just its size — which is what distinguishes a correct camera from one
 * that merely puts a blob of the right area in the right place.
 *
 * PORT_DIRECT (Kotlin).
 */
import type { MaskImage } from '../contracts/raster.js'

export type SilhouetteDescriptor = {
  centroidU: number
  centroidV: number
  /** Radius along each ray, in pixels; 0 where the ray leaves the silhouette. */
  radii: Float64Array
  area: number
  empty: boolean
}

export function describeSilhouette(mask: MaskImage, rays: number): SilhouetteDescriptor {
  const w = mask.width
  const h = mask.height
  let sumX = 0
  let sumY = 0
  let area = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask.data[y * w + x]) continue
      sumX += x
      sumY += y
      area++
    }
  }
  const radii = new Float64Array(rays)
  if (area === 0) {
    return { centroidU: w / 2, centroidV: h / 2, radii, area: 0, empty: true }
  }
  const cu = sumX / area
  const cv = sumY / area
  const maxR = Math.hypot(w, h)
  const step = 0.5
  for (let k = 0; k < rays; k++) {
    const a = (2 * Math.PI * k) / rays
    const dx = Math.cos(a)
    const dy = Math.sin(a)
    let last = 0
    for (let r = 0; r <= maxR; r += step) {
      const x = Math.round(cu + dx * r)
      const y = Math.round(cv + dy * r)
      if (x < 0 || y < 0 || x >= w || y >= h) break
      if (mask.data[y * w + x]) last = r
    }
    radii[k] = last
  }
  return { centroidU: cu, centroidV: cv, radii, area, empty: false }
}

/**
 * Residual vector comparing a candidate to a reference descriptor, normalised
 * by the image diagonal so the numbers are scale-free.
 */
export function descriptorResidual(
  candidate: SilhouetteDescriptor,
  reference: SilhouetteDescriptor,
  diagonal: number,
): Float64Array {
  const n = reference.radii.length
  const out = new Float64Array(n + 3)
  if (candidate.empty) {
    out.fill(1)
    return out
  }
  for (let k = 0; k < n; k++) out[k] = (candidate.radii[k] - reference.radii[k]) / diagonal
  out[n] = ((candidate.centroidU - reference.centroidU) / diagonal) * 2
  out[n + 1] = ((candidate.centroidV - reference.centroidV) / diagonal) * 2
  // Area term keeps the solver from trading scale against shape.
  const areaRatio = Math.sqrt(candidate.area / Math.max(1, reference.area))
  out[n + 2] = (areaRatio - 1) * 0.8
  return out
}

export function descriptorCost(candidate: SilhouetteDescriptor, reference: SilhouetteDescriptor, diagonal: number): number {
  const r = descriptorResidual(candidate, reference, diagonal)
  let s = 0
  for (let i = 0; i < r.length; i++) s += r[i] * r[i]
  return Math.sqrt(s / r.length)
}
