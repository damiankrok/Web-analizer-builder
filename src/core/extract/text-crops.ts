/**
 * Turning geometry-chosen boxes into crops an engine can read — §6, §7.
 *
 * The order matters and is the whole point of §7: geometry decides *where* the
 * labels are, and only then is a recogniser asked *what* they say. Nothing in
 * this file looks for text. It is handed boxes and returns pixels.
 *
 * Each box is cut at source-native resolution, rotated upright, contrast-
 * stretched against its own local paper, cleared of the drafting line running
 * through it (all of that is the existing crop pipeline, which is good), and
 * then — new in Stage 06 — padded with paper and enlarged towards a character
 * height a trained recogniser can work at.
 *
 * PORT_DIRECT (Kotlin).
 */
import type { GrayImage } from '../contracts/raster.js'
import type { PixelBox, TextOrientation } from '../dimensions/contracts.js'
import { prepareCrop } from '../dimensions/crops.js'
import { enlarge, padWithPaper, scaleForCropHeight } from './raster-normalize.js'
import type { PlanTextCrop } from './text-engine.js'

export type TextCropOptions = {
  /** Height the whole crop band is enlarged towards, pixels. */
  targetCropPx: number
  /** Hard cap on enlargement. */
  maxScale: number
  /** Paper margin added around the crop, in enlarged pixels. */
  padPx: number
}

export const DEFAULT_TEXT_CROP: TextCropOptions = {
  // 150 px of band height puts an 11 px digit at about 60 px, which is the
  // size trained recognisers are built for. Measured on project A, anything
  // from 100 to 300 reads the same set of labels, so the exact figure is not a
  // tuned one.
  targetCropPx: 150,
  maxScale: 10,
  padPx: 12,
}

/** One box the caller wants read. */
export type TextCropRequest = {
  id: string
  box: PixelBox
  orientation: TextOrientation
}

/**
 * Condition one box for reading.
 *
 * The enlargement factor is chosen from the crop's *height* once upright,
 * because that is the dimension a line of text does not grow along: a label
 * saying `1205` and one saying `90` are the same height and very different
 * widths, so height is the stable proxy for character size.
 */
export function buildTextCrop(
  source: GrayImage,
  request: TextCropRequest,
  opts: TextCropOptions = DEFAULT_TEXT_CROP,
): PlanTextCrop {
  const { crop } = prepareCrop(source, request.box, request.orientation)
  const scale = scaleForCropHeight(crop.gray.height, opts.targetCropPx, opts.maxScale)
  const big = enlarge(crop.gray, scale)
  const padded = padWithPaper(big, opts.padPx, crop.paper)
  return {
    id: request.id,
    gray: padded,
    sourceBox: request.box,
    orientation: request.orientation,
    scale,
  }
}

export function buildTextCrops(
  source: GrayImage,
  requests: readonly TextCropRequest[],
  opts: TextCropOptions = DEFAULT_TEXT_CROP,
): PlanTextCrop[] {
  return requests.map((r) => buildTextCrop(source, r, opts))
}
