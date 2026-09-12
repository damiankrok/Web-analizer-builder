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
import { resolutionCandidates, isResolutionUpgrade } from '../core/source/resolution.js'
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
      let image = decodeImage(res.bytes)
      let url = asset.url
      let sha = res.sha256
      let bytes = res.bytes.byteLength
      let variants = asset.variants ?? [{ url: asset.url, kind: 'PAGE' as const }]
      // Probe the conventional original where the page exposed no anchor for
      // it. Verified, not assumed: kept only if it decodes to strictly more
      // pixels (§4). Offline runs simply skip the probe.
      if (!opts.offline && !variants.some((v) => v.kind === 'LIGHTBOX')) {
        for (const candidate of resolutionCandidates(asset.url)) {
          try {
            const alt = await fetchWithCache(candidate, 'image', opts.cacheDir)
            const decoded = decodeImage(alt.bytes)
            if (!isResolutionUpgrade(decoded, image)) continue
            variants = [
              { url: candidate, kind: 'LIGHTBOX', nativeWidth: decoded.width, nativeHeight: decoded.height },
              { ...variants[0], nativeWidth: image.width, nativeHeight: image.height },
            ]
            image = decoded
            url = candidate
            sha = alt.sha256
            bytes = alt.bytes.byteLength
            break
          } catch {
            // A 404 or an undecodable body means the convention does not hold
            // for this asset. Nothing to record; the page copy stands.
          }
        }
      }
      return { asset: { ...asset, url, variants }, image, sha, bytes, error: null as string | null }
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
    const variants = (r.asset.variants ?? []).map((v) =>
      v.url === r.asset.url ? { ...v, nativeWidth: r.image.width, nativeHeight: r.image.height } : v,
    )
    let next: SourceAsset = {
      ...r.asset,
      width: r.image.width,
      height: r.image.height,
      byteLength: r.bytes,
      sha256: r.sha,
      ...(variants.length > 0 ? { variants } : {}),
    }
    if (next.role === 'UNKNOWN_ASSET') {
      const guess = classifyByPixels(r.image, toGray(r.image))
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
