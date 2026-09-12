/**
 * Multi-scale crop pipeline (§7).
 *
 * Every recognition attempt starts from source-native pixels inside a box the
 * geometry stage identified, never from the bounded analysis frame the rest of
 * the pipeline uses. That distinction is the reason WEB-01 read nothing: the
 * structural frame is capped at 640 px on the long edge so that cost does not
 * depend on the publisher's image size (§49), and an 11-pixel digit does not
 * survive being resampled to 8.
 *
 * A crop is then conditioned, not merely cut:
 *
 *   - rotated to upright, because vertical chains print their labels reading
 *     bottom-to-top and a rotated glyph matches nothing;
 *   - stretched to full contrast against its own local paper level, since a
 *     label sits on white in a margin and on grey fill inside a room;
 *   - cleared of the drafting line that runs through it, because a baseline
 *     crossing a digit merges two glyphs into one component;
 *   - thresholded several ways, deterministically, so a stroke that anti-
 *     aliasing thinned below one threshold is still found by another.
 *
 * PORT_DIRECT (Kotlin).
 */
import type { GrayImage } from '../contracts/raster.js'
import type { PixelBox, TextOrientation } from './contracts.js'

export type TextCrop = {
  gray: GrayImage
  /** Where this crop came from in the source image. */
  box: PixelBox
  /** Rotation applied to make the text upright. */
  rotation: 0 | 90 | 270
  /** Ink threshold appropriate to this crop. */
  ink: number
  /** Paper level measured inside the crop. */
  paper: number
}

const makeGray = (width: number, height: number): GrayImage => ({
  width,
  height,
  data: new Uint8ClampedArray(width * height),
})

/** Cut a box out of the source at native resolution, clamped to the image. */
export function cutCrop(gray: GrayImage, box: PixelBox, pad = 1): GrayImage {
  const x0 = Math.max(0, Math.floor(box.x0) - pad)
  const y0 = Math.max(0, Math.floor(box.y0) - pad)
  const x1 = Math.min(gray.width - 1, Math.ceil(box.x1) + pad)
  const y1 = Math.min(gray.height - 1, Math.ceil(box.y1) + pad)
  const w = Math.max(1, x1 - x0 + 1)
  const h = Math.max(1, y1 - y0 + 1)
  const out = makeGray(w, h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) out.data[y * w + x] = gray.data[(y0 + y) * gray.width + x0 + x]
  }
  return out
}

/** Rotate a crop by a right angle. 90 turns bottom-to-top text upright. */
export function rotateGray(src: GrayImage, degrees: 0 | 90 | 270): GrayImage {
  if (degrees === 0) return src
  const out = makeGray(src.height, src.width)
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const v = src.data[y * src.width + x]
      if (degrees === 90) out.data[(src.width - 1 - x) * out.width + y] = v
      else out.data[x * out.width + (src.height - 1 - y)] = v
    }
  }
  return out
}

/**
 * Paper level of a crop: the mode of its upper half-tones.
 *
 * The 90th percentile is used rather than the maximum so a single bright pixel
 * cannot define the background, and rather than the mean so that a crop which
 * is mostly ink still reports the paper it sits on.
 */
export function paperLevel(gray: GrayImage): number {
  const hist = new Int32Array(256)
  for (let i = 0; i < gray.data.length; i++) hist[gray.data[i]]++
  const target = gray.data.length * 0.9
  let acc = 0
  for (let v = 0; v < 256; v++) {
    acc += hist[v]
    if (acc >= target) return v
  }
  return 255
}

/** Stretch a crop so its paper is white and its darkest ink is black. */
export function normaliseContrast(gray: GrayImage): GrayImage {
  const paper = paperLevel(gray)
  let lo = 255
  for (let i = 0; i < gray.data.length; i++) if (gray.data[i] < lo) lo = gray.data[i]
  const span = Math.max(8, paper - lo)
  const out = makeGray(gray.width, gray.height)
  for (let i = 0; i < gray.data.length; i++) {
    const t = (gray.data[i] - lo) / span
    out.data[i] = Math.max(0, Math.min(255, Math.round(t * 255)))
  }
  return out
}

/**
 * Erase a drafting line running through a crop.
 *
 * A full-width row (or column) of ink is a line, not a glyph: no digit spans
 * the whole label. Erasing it before segmentation stops the line from welding
 * every glyph in the label into a single component — and it is safe, because a
 * digit's own stroke never occupies an entire row of the crop.
 */
export function removeRules(gray: GrayImage, ink: number): GrayImage {
  const out = makeGray(gray.width, gray.height)
  out.data.set(gray.data)
  const paper = 255
  for (let y = 0; y < gray.height; y++) {
    let run = 0
    for (let x = 0; x < gray.width; x++) if (gray.data[y * gray.width + x] < ink) run++
    if (run >= gray.width * 0.88) for (let x = 0; x < gray.width; x++) out.data[y * gray.width + x] = paper
  }
  for (let x = 0; x < gray.width; x++) {
    let run = 0
    for (let y = 0; y < gray.height; y++) if (gray.data[y * gray.width + x] < ink) run++
    if (run >= gray.height * 0.88) for (let y = 0; y < gray.height; y++) out.data[y * gray.width + x] = paper
  }
  return out
}

/** Otsu threshold of a crop. */
export function otsu(gray: GrayImage): number {
  const hist = new Float64Array(256)
  for (let i = 0; i < gray.data.length; i++) hist[gray.data[i]]++
  const total = gray.data.length
  let sum = 0
  for (let t = 0; t < 256; t++) sum += t * hist[t]
  let sumB = 0
  let wB = 0
  let best = 128
  let bestVar = -1
  for (let t = 0; t < 256; t++) {
    wB += hist[t]
    if (wB === 0) continue
    const wF = total - wB
    if (wF === 0) break
    sumB += t * hist[t]
    const between = wB * wF * (sumB / wB - (sum - sumB) / wF) ** 2
    if (between > bestVar) {
      bestVar = between
      best = t
    }
  }
  return best
}

/**
 * Conditioned crop plus its deterministic threshold variants.
 *
 * The variants exist because the right threshold is not knowable in advance at
 * this glyph size: too high welds a `4`'s open corner shut, too low breaks a
 * `5`'s thin waist. Trying a fixed, ordered set and keeping the reading that
 * the grammar and the geometry agree with costs three passes over a 16x100
 * box and removes a tuning parameter.
 */
export function prepareCrop(
  source: GrayImage,
  box: PixelBox,
  orientation: TextOrientation,
): { crop: TextCrop; variants: number[] } {
  const rotation: 0 | 90 | 270 = orientation === 'HORIZONTAL' ? 0 : orientation === 'VERTICAL_UP' ? 90 : 270
  const cut = cutCrop(source, box)
  const rotated = rotateGray(cut, rotation)
  const normalised = normaliseContrast(rotated)
  const base = otsu(normalised)
  const cleaned = removeRules(normalised, base)
  const paper = paperLevel(cleaned)
  return {
    crop: { gray: cleaned, box, rotation, ink: base, paper },
    variants: [base, Math.max(24, base - 24), Math.min(232, base + 24)],
  }
}
