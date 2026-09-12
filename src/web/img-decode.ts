/**
 * Image decoding through `<img>` rather than `fetch` + `createImageBitmap`.
 *
 * Same one-function contract as the other two adapters: pixels out, portable
 * `RasterImage` in the portable layout. The reason this variant exists is the
 * hosting environment for the standalone build, which blocks scripted requests
 * to anything it does not recognise but serves the files published beside the
 * page normally. An `<img>` load is a plain image request rather than a
 * scripted one, so it is the channel most likely to be permitted — and a
 * same-origin image does not taint the canvas, so the pixels can still be read
 * back.
 *
 * Transparent plan GIFs are composited onto white, matching both other
 * adapters; the background classifier depends on it.
 *
 * WEB_ONLY.
 */
import type { RasterImage } from '../core/contracts/raster.js'

export function decodeImageElement(img: HTMLImageElement): RasterImage {
  const width = img.naturalWidth
  const height = img.naturalHeight
  if (width === 0 || height === 0) throw new Error('image has no intrinsic size')
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('2D canvas context unavailable')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(img, 0, 0)
  const data = ctx.getImageData(0, 0, width, height)
  return { width, height, data: new Uint8ClampedArray(data.data) }
}

export function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.decoding = 'sync'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`could not load ${src}`))
    img.src = src
  })
}

export async function loadAndDecode(src: string): Promise<RasterImage> {
  return decodeImageElement(await loadImageElement(src))
}
