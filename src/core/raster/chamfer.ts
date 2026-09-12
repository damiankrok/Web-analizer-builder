/**
 * Chamfer distance transform and symmetric edge distance.
 *
 * Two-pass 3-4 chamfer: cheap, deterministic, and accurate enough for the
 * symmetric edge score of §35 (RGB comparison is forbidden as a primary score).
 *
 * PORT_DIRECT (Kotlin).
 */
import type { FloatImage, MaskImage } from '../contracts/raster.js'
import { makeFloat } from '../contracts/raster.js'

const BIG = 1e9

export function distanceTransform(m: MaskImage): FloatImage {
  const w = m.width
  const h = m.height
  const d = makeFloat(w, h, BIG)
  for (let i = 0; i < w * h; i++) if (m.data[i]) d.data[i] = 0

  const a = 1
  const b = Math.SQRT2
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      let v = d.data[i]
      if (y > 0) {
        v = Math.min(v, d.data[i - w] + a)
        if (x > 0) v = Math.min(v, d.data[i - w - 1] + b)
        if (x < w - 1) v = Math.min(v, d.data[i - w + 1] + b)
      }
      if (x > 0) v = Math.min(v, d.data[i - 1] + a)
      d.data[i] = v
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x
      let v = d.data[i]
      if (y < h - 1) {
        v = Math.min(v, d.data[i + w] + a)
        if (x > 0) v = Math.min(v, d.data[i + w - 1] + b)
        if (x < w - 1) v = Math.min(v, d.data[i + w + 1] + b)
      }
      if (x < w - 1) v = Math.min(v, d.data[i + 1] + a)
      d.data[i] = v
    }
  }
  return d
}

/**
 * Symmetric chamfer distance between two edge maps, normalised by the image
 * diagonal so the result is scale-free and comparable across assets.
 * Returns 1 when either map is empty (maximum penalty, but bounded).
 */
export function symmetricChamfer(a: MaskImage, b: MaskImage): number {
  if (a.width !== b.width || a.height !== b.height) throw new Error('symmetricChamfer: size mismatch')
  const da = distanceTransform(a)
  const db = distanceTransform(b)
  const diag = Math.hypot(a.width, a.height)
  let sumAB = 0
  let nA = 0
  let sumBA = 0
  let nB = 0
  for (let i = 0; i < a.data.length; i++) {
    if (a.data[i]) {
      sumAB += Math.min(db.data[i], diag)
      nA++
    }
    if (b.data[i]) {
      sumBA += Math.min(da.data[i], diag)
      nB++
    }
  }
  if (nA === 0 || nB === 0) return 1
  return (sumAB / nA + sumBA / nB) / (2 * diag)
}

/** Mean distance from a point set to the nearest edge of a distance field. */
export function meanDistanceTo(field: FloatImage, points: readonly { u: number; v: number }[]): number {
  if (points.length === 0) return 0
  let s = 0
  for (const p of points) {
    const x = Math.min(field.width - 1, Math.max(0, Math.round(p.u)))
    const y = Math.min(field.height - 1, Math.max(0, Math.round(p.v)))
    s += field.data[y * field.width + x]
  }
  return s / points.length
}
