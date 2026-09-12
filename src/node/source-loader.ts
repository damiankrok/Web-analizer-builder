/**
 * Loads a complete, decoded SourcePackage for the Node host: page HTML through
 * the pure ARCHON parser, then bounded asset fetches, then decoding into the
 * portable RasterImage DTO.
 *
 * Assets that metadata could not place fall through to pixel inference here —
 * this is the only place the second-stage classifier of §9 runs.
 */
import { readFile } from 'node:fs/promises'
import type { RasterImage } from '../core/contracts/raster.js'
import type { SourceAsset, SourcePackage } from '../core/contracts/source.js'
import { parseArchonPage } from '../core/source/archon-parser.js'
import { classifyByPixels } from '../core/source/role-classifier.js'
import { toGray } from '../core/raster/gray.js'
import { ARCHON_POLICY } from '../core/source/fetch-policy.js'
import { fetchWithCache, mapConcurrent } from './fetch-adapter.js'
import { decodeImage } from './image-decode.js'

export type LoadedAsset = { asset: SourceAsset; image: RasterImage }

export type LoadedSource = {
  pkg: SourcePackage
  images: Map<string, RasterImage>
  /** Assets that failed to fetch or decode, with the reason. */
  failures: Array<{ assetId: string; url: string; reason: string }>
}

export type LoadOptions = {
  /** Directory used both as an HTTP cache and as the offline fixture store. */
  cacheDir: string
  /** When true, never touch the network; fail if something is not cached. */
  offline?: boolean
  /** Local HTML to parse instead of fetching the page. */
  htmlPath?: string
  maxAssets?: number
}

export async function loadSource(url: string, opts: LoadOptions): Promise<LoadedSource> {
  const html = opts.htmlPath
    ? await readFile(opts.htmlPath, 'utf8')
    : new TextDecoder().decode((await fetchWithCache(url, 'html', opts.cacheDir)).bytes)

  const pkg = parseArchonPage(html, url)
  const limit = Math.min(opts.maxAssets ?? ARCHON_POLICY.maxAssets, ARCHON_POLICY.maxAssets)
  const wanted = pkg.assets.slice(0, limit)

  const failures: LoadedSource['failures'] = []
  const images = new Map<string, RasterImage>()

  const results = await mapConcurrent(wanted, ARCHON_POLICY.concurrency, async (asset) => {
    try {
      const res = await fetchWithCache(asset.url, 'image', opts.cacheDir)
      const image = decodeImage(res.bytes)
      return { asset, image, sha: res.sha256, bytes: res.bytes.byteLength, error: null as string | null }
    } catch (err) {
      return {
        asset,
        image: null,
        sha: '',
        bytes: 0,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  })

  const updated: SourceAsset[] = []
  for (const r of results) {
    if (!r.image) {
      failures.push({ assetId: r.asset.id, url: r.asset.url, reason: r.error ?? 'unknown' })
      updated.push(r.asset)
      continue
    }
    images.set(r.asset.id, r.image)
    let next: SourceAsset = {
      ...r.asset,
      width: r.image.width,
      height: r.image.height,
      byteLength: r.bytes,
      sha256: r.sha,
    }
    if (next.role === 'UNKNOWN_ASSET') {
      const guess = classifyByPixels(toGray(r.image))
      next = {
        ...next,
        role: guess.role,
        roleConfidence: guess.confidence,
        roleEvidence: [...next.roleEvidence, ...guess.evidence],
      }
    }
    updated.push(next)
  }
  // Assets beyond the fetch budget keep their metadata-only classification.
  for (const a of pkg.assets.slice(wanted.length)) updated.push(a)

  return { pkg: { ...pkg, assets: updated }, images, failures }
}
