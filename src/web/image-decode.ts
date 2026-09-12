/**
 * Browser image decoding adapter.
 *
 * Same one-function contract as the Node adapter (src/node/image-decode.ts):
 * bytes in, portable RasterImage out. Everything downstream of this point is
 * the same code in both hosts, which is the whole point of keeping the core
 * free of platform types (§6).
 *
 * WEB_ONLY.
 */
import type { RasterImage } from '../core/contracts/raster.js'

export async function decodeImageWeb(bytes: Uint8Array, type?: string): Promise<RasterImage> {
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], type ? { type } : undefined)
  const bitmap = await createImageBitmap(blob)
  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(bitmap.width, bitmap.height)
      : Object.assign(document.createElement('canvas'), { width: bitmap.width, height: bitmap.height })
  const ctx = (canvas as OffscreenCanvas).getContext('2d') as OffscreenCanvasRenderingContext2D | null
  if (!ctx) throw new Error('2D canvas context unavailable')
  // Transparent plan GIFs must land on white, matching the Node adapter.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, bitmap.width, bitmap.height)
  ctx.drawImage(bitmap, 0, 0)
  const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height)
  bitmap.close()
  return { width: data.width, height: data.height, data: new Uint8ClampedArray(data.data) }
}

export async function fetchAndDecode(url: string): Promise<RasterImage> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  const buf = new Uint8Array(await res.arrayBuffer())
  return decodeImageWeb(buf, res.headers.get('content-type') ?? undefined)
}
