import { readFileSync } from 'node:fs'
import { parseArchonPage } from '../src/core/source/archon-parser.js'
import type { ParsedSource } from '../src/core/contracts/source.js'
import type { RasterImage } from '../src/core/contracts/raster.js'
import { makeMask } from '../src/core/contracts/raster.js'
import type { MaskImage } from '../src/core/contracts/raster.js'
import { loadSource } from '../src/node/source-loader.js'
import { PROJECTS } from '../src/node/projects.js'

export const fixturePackage = (slug: string): ParsedSource => {
  const project = PROJECTS.find((p) => p.slug === slug)
  if (!project) throw new Error(`unknown fixture ${slug}`)
  return parseArchonPage(readFileSync(`fixtures/${slug}/page.html`, 'utf8'), project.url)
}

export async function loadFixture(slug: string): Promise<{ pkg: ParsedSource; images: Map<string, RasterImage> }> {
  const project = PROJECTS.find((p) => p.slug === slug)
  if (!project) throw new Error(`unknown fixture ${slug}`)
  const loaded = await loadSource(project.url, {
    cacheDir: `fixtures/${slug}/assets`,
    htmlPath: `fixtures/${slug}/page.html`,
  })
  return { pkg: loaded.pkg, images: loaded.images }
}

/** Synthetic RGBA image from a per-pixel colour function. */
export function synthImage(
  width: number,
  height: number,
  fn: (x: number, y: number) => [number, number, number],
): RasterImage {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = fn(x, y)
      const i = (y * width + x) * 4
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = 255
    }
  }
  return { width, height, data }
}

export function rectMask(width: number, height: number, x0: number, y0: number, x1: number, y1: number): MaskImage {
  const m = makeMask(width, height)
  for (let y = Math.max(0, y0); y <= Math.min(height - 1, y1); y++) {
    for (let x = Math.max(0, x0); x <= Math.min(width - 1, x1); x++) m.data[y * width + x] = 1
  }
  return m
}
