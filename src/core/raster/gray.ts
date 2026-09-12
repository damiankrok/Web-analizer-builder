/**
 * Colour -> luminance and basic resampling.
 *
 * PORT_DIRECT (Kotlin): loops over a flat byte array.
 */
import type { FloatImage, GrayImage, RasterImage } from '../contracts/raster.js'
import { makeGray } from '../contracts/raster.js'

/** Rec. 601 luma. Chosen over Rec. 709 because architectural line work is
 *  mostly neutral and 601 keeps thin blue dimension lines slightly darker. */
export function toGray(img: RasterImage): GrayImage {
  const out = makeGray(img.width, img.height)
  const n = img.width * img.height
  for (let i = 0; i < n; i++) {
    const r = img.data[i * 4]
    const g = img.data[i * 4 + 1]
    const b = img.data[i * 4 + 2]
    const a = img.data[i * 4 + 3]
    const lum = 0.299 * r + 0.587 * g + 0.114 * b
    // Composite onto white: GIF plans use transparency for the page background.
    out.data[i] = a >= 250 ? lum : (lum * a + 255 * (255 - a)) / 255
  }
  return out
}

/** Per-pixel saturation in [0,1]; separates ink drawings from colour renders. */
export function saturationField(img: RasterImage): FloatImage {
  const out = { width: img.width, height: img.height, data: new Float32Array(img.width * img.height) }
  const n = img.width * img.height
  for (let i = 0; i < n; i++) {
    const r = img.data[i * 4]
    const g = img.data[i * 4 + 1]
    const b = img.data[i * 4 + 2]
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    out.data[i] = max === 0 ? 0 : (max - min) / max
  }
  return out
}

/**
 * Box-filtered downscale to a target long edge. Analysis runs at a bounded
 * resolution (§49) so cost does not depend on the publisher's image size.
 */
export function downscaleGray(g: GrayImage, maxEdge: number): GrayImage {
  const scale = Math.min(1, maxEdge / Math.max(g.width, g.height))
  if (scale >= 1) return g
  const w = Math.max(1, Math.round(g.width * scale))
  const h = Math.max(1, Math.round(g.height * scale))
  const out = makeGray(w, h)
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor((y * g.height) / h)
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * g.height) / h))
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor((x * g.width) / w)
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * g.width) / w))
      let s = 0
      let n = 0
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          s += g.data[yy * g.width + xx]
          n++
        }
      }
      out.data[y * w + x] = n ? s / n : 0
    }
  }
  return out
}

export function downscaleRaster(img: RasterImage, maxEdge: number): RasterImage {
  const scale = Math.min(1, maxEdge / Math.max(img.width, img.height))
  if (scale >= 1) return img
  const w = Math.max(1, Math.round(img.width * scale))
  const h = Math.max(1, Math.round(img.height * scale))
  const out = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor((y * img.height) / h)
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * img.height) / h))
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor((x * img.width) / w)
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * img.width) / w))
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let n = 0
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * img.width + xx) * 4
          r += img.data[i]
          g += img.data[i + 1]
          b += img.data[i + 2]
          a += img.data[i + 3]
          n++
        }
      }
      const o = (y * w + x) * 4
      out[o] = r / n
      out[o + 1] = g / n
      out[o + 2] = b / n
      out[o + 3] = a / n
    }
  }
  return { width: w, height: h, data: out }
}
