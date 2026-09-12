/**
 * Decoded image DTO. Image *decoding* is an adapter concern (Node: jpeg-js /
 * pngjs / omggif; Web: createImageBitmap + OffscreenCanvas; Android: Bitmap).
 * Everything downstream of the decoder is portable and operates on this type.
 *
 * PORT_WITH_ADAPTER (Kotlin): `data` becomes a ByteArray/IntArray from Bitmap.
 */
export type RasterImage = {
  width: number
  height: number
  /** RGBA8, row-major, length = width * height * 4. */
  data: Uint8ClampedArray
}

/** Single-channel image in [0,255]. Most analysis runs on this. */
export type GrayImage = {
  width: number
  height: number
  data: Uint8ClampedArray
}

/** Single-channel float field (gradients, distance transforms, scores). */
export type FloatImage = {
  width: number
  height: number
  data: Float32Array
}

/** Binary mask, 0 or 1. */
export type MaskImage = {
  width: number
  height: number
  data: Uint8Array
}

export const grayAt = (g: GrayImage, x: number, y: number): number =>
  x < 0 || y < 0 || x >= g.width || y >= g.height ? 0 : g.data[y * g.width + x]

export const maskAt = (m: MaskImage, x: number, y: number): number =>
  x < 0 || y < 0 || x >= m.width || y >= m.height ? 0 : m.data[y * m.width + x]

export const floatAt = (f: FloatImage, x: number, y: number): number =>
  x < 0 || y < 0 || x >= f.width || y >= f.height ? 0 : f.data[y * f.width + x]

export const makeGray = (w: number, h: number): GrayImage => ({
  width: w,
  height: h,
  data: new Uint8ClampedArray(w * h),
})
export const makeFloat = (w: number, h: number, fill = 0): FloatImage => {
  const d = new Float32Array(w * h)
  if (fill !== 0) d.fill(fill)
  return { width: w, height: h, data: d }
}
export const makeMask = (w: number, h: number): MaskImage => ({
  width: w,
  height: h,
  data: new Uint8Array(w * h),
})
