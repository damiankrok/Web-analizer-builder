/**
 * WEB_ONLY / PORT_WITH_ADAPTER: image decoding for the Node development host.
 * Produces the portable RasterImage DTO; nothing downstream knows about these
 * libraries. The browser adapter (src/web/image-decode.ts) and a future Android
 * adapter implement the same one-function contract.
 */
import jpeg from 'jpeg-js'
import { PNG } from 'pngjs'
import { GifReader } from 'omggif'
import type { RasterImage } from '../core/contracts/raster.js'

export function sniffImageType(bytes: Uint8Array): 'jpeg' | 'png' | 'gif' | 'unknown' {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg'
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png'
  if (bytes.length > 3 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'gif'
  return 'unknown'
}

export function decodeImage(bytes: Uint8Array): RasterImage {
  const kind = sniffImageType(bytes)
  switch (kind) {
    case 'jpeg': {
      const r = jpeg.decode(Buffer.from(bytes), { useTArray: true, formatAsRGBA: true })
      return { width: r.width, height: r.height, data: new Uint8ClampedArray(r.data.buffer, r.data.byteOffset, r.data.length) }
    }
    case 'png': {
      const p = PNG.sync.read(Buffer.from(bytes))
      return { width: p.width, height: p.height, data: new Uint8ClampedArray(p.data) }
    }
    case 'gif': {
      const reader = new GifReader(Buffer.from(bytes) as unknown as Uint8Array)
      const w = reader.width
      const h = reader.height
      const out = new Uint8ClampedArray(w * h * 4)
      // Architectural plans are published as single-frame GIFs; frame 0 is the
      // drawing. Later frames, if any, are ignored deliberately.
      reader.decodeAndBlitFrameRGBA(0, out as unknown as number[])
      return { width: w, height: h, data: out }
    }
    default:
      throw new Error(`unsupported image format (magic ${[...bytes.slice(0, 4)].map((b) => b.toString(16)).join(' ')})`)
  }
}
