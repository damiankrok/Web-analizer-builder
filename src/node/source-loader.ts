/**
 * The analyzer's view of a project, for the research commands.
 *
 * Since STAGE WEB-PIVOT-03 this is a thin adapter and nothing more: it builds
 * the project's `SourcePackage` through the one authoritative builder and
 * narrows it with `toParsedSource`. It used to be a second acquisition path —
 * it parsed the page itself, probed for larger copies and decided which ones to
 * keep — and that is exactly how the CLI and the hosted build came to analyse
 * different copies of the same drawing.
 *
 * The hand-run research scripts (`scripts/dimension-*.ts`, `render-views.ts`)
 * and the test helpers call this, so they see the same bytes the CLI and the
 * browser do, without each of them having to know about packages.
 *
 * NODE_ONLY.
 */
import type { RasterImage } from '../core/contracts/raster.js'
import type { ParsedSource } from '../core/contracts/source.js'
import type { SourcePackage } from '../core/contracts/source-package.js'
import { toParsedSource } from '../core/contracts/source-package.js'
import { buildSourcePackage } from './source-package.js'

export type LoadedSource = {
  pkg: ParsedSource
  images: Map<string, RasterImage>
  /** Assets that failed to fetch or decode, with the reason. */
  failures: Array<{ assetId: string; url: string; reason: string }>
  /** The package the above was narrowed from, for anything that wants the record. */
  source: SourcePackage
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
  const { pkg, images } = await buildSourcePackage(url, {
    cacheDir: opts.cacheDir,
    ...(opts.htmlPath ? { htmlPath: opts.htmlPath } : {}),
    ...(opts.offline ? { offline: true } : {}),
    ...(opts.maxAssets ? { maxFetches: opts.maxAssets * 2 } : {}),
  })
  return {
    pkg: toParsedSource(pkg),
    images,
    failures: pkg.assets
      .filter((a) => a.status === 'FAILED')
      .map((a) => ({ assetId: a.assetId, url: a.selectedUrl, reason: a.error?.message ?? 'unknown' })),
    source: pkg,
  }
}
