/**
 * Raster normalization for technical drawings — STAGE WEB-PIVOT-06 §3.
 *
 * Two problems, both general to published CAD sheets and neither specific to
 * any publisher.
 *
 * **Colour.** Luminance is the wrong ink map here. A saturated red dimension
 * annotation converts to mid-grey, which is the same value as the light
 * furniture hatching it is drawn over, so thresholding on luminance either
 * keeps the furniture or loses the number. The per-pixel channel *minimum*
 * keeps any strongly coloured or black stroke dark and leaves paper and
 * neutral greys light, and it does so without knowing which colour a
 * particular publisher draws dimensions in.
 *
 * **Size.** Plan digits are 8 to 14 pixels tall at the resolutions publishers
 * use. Recognisers — the hand-authored one and every trained one — work at a
 * character height several times that, so the crop must be enlarged before it
 * is read. Enlargement is bilinear rather than nearest so that the anti-aliased
 * stroke edges the publisher's renderer produced survive as edges instead of
 * becoming staircases.
 *
 * Neither function decides what is text. That is the geometry stage's job.
 *
 * PORT_DIRECT (Kotlin).
 */
import type { GrayImage, RasterImage } from '../contracts/raster.js'

/**
 * Ink map for coloured line work: the darkest of the three channels.
 *
 * Ink is dark and paper is light in the result, which is the convention every
 * other module in this codebase already uses for a `GrayImage`.
 */
export function inkChannel(img: RasterImage): GrayImage {
  const data = new Uint8ClampedArray(img.width * img.height)
  for (let i = 0; i < data.length; i++) {
    const r = img.data[i * 4]
    const g = img.data[i * 4 + 1]
    const b = img.data[i * 4 + 2]
    data[i] = r < g ? (r < b ? r : b) : g < b ? g : b
  }
  return { width: img.width, height: img.height, data }
}

/** Bilinear enlargement. `k` is the linear factor and must be >= 1. */
export function enlarge(src: GrayImage, k: number): GrayImage {
  if (k <= 1) return src
  const width = Math.max(1, Math.round(src.width * k))
  const height = Math.max(1, Math.round(src.height * k))
  const data = new Uint8ClampedArray(width * height)
  for (let y = 0; y < height; y++) {
    const sy = Math.min(src.height - 1, Math.max(0, (y + 0.5) / k - 0.5))
    const y0 = Math.floor(sy)
    const y1 = Math.min(src.height - 1, y0 + 1)
    const fy = sy - y0
    for (let x = 0; x < width; x++) {
      const sx = Math.min(src.width - 1, Math.max(0, (x + 0.5) / k - 0.5))
      const x0 = Math.floor(sx)
      const x1 = Math.min(src.width - 1, x0 + 1)
      const fx = sx - x0
      const top = src.data[y0 * src.width + x0] * (1 - fx) + src.data[y0 * src.width + x1] * fx
      const bottom = src.data[y1 * src.width + x0] * (1 - fx) + src.data[y1 * src.width + x1] * fx
      data[y * width + x] = Math.round(top * (1 - fy) + bottom * fy)
    }
  }
  return { width, height, data }
}

/**
 * Surround a crop with paper.
 *
 * Recognisers trained on scanned documents expect a margin around a line of
 * text, and a crop cut to the ink is read as a fragment. The border is filled
 * with the crop's own paper level rather than pure white so a grey-filled room
 * does not gain a bright frame that the binariser then keys on.
 */
export function padWithPaper(src: GrayImage, pad: number, paper: number): GrayImage {
  if (pad <= 0) return src
  const width = src.width + pad * 2
  const height = src.height + pad * 2
  const data = new Uint8ClampedArray(width * height).fill(paper)
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      data[(y + pad) * width + x + pad] = src.data[y * src.width + x]
    }
  }
  return { width, height, data }
}

/**
 * The enlargement that brings a crop to a target height.
 *
 * The crop, not the text: a label zone is a band a few times taller than the
 * digits in it, and the band height is what this function can actually see.
 * The target is therefore set from the band, and the digits land wherever
 * their share of it puts them — which is the right behaviour, because a
 * drawing that prints its bands tighter also prints its digits larger within
 * them.
 *
 * Capped so that a crop which is already large — a lightbox drawing at 2000 px
 * — is not blown up to something that costs seconds to read for no gain.
 */
export function scaleForCropHeight(cropHeightPx: number, targetPx: number, maxScale: number): number {
  if (cropHeightPx <= 0) return 1
  return Math.min(maxScale, Math.max(1, targetPx / cropHeightPx))
}
