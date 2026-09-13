/**
 * How the browser app obtains a source package, and how it runs the analysis.
 *
 * One path, two places the bytes can come from — STAGE WEB-PIVOT-03.
 *
 *  - **Bundled.** A standalone build carries its packages inside the bundle and
 *    its images beside the page, named by content hash.
 *  - **Development.** Under `npm run ui:dev` the same packages are read from
 *    `out/source-packages/`, written by `npm run source:package`.
 *
 * In both cases what arrives is a `SourcePackage` built by the Node adapter,
 * used verbatim. The browser never parses a project page, never picks between
 * two copies of a drawing and never matches an image by filename — before this
 * stage it did all three, which is how the hosted build came to analyse a
 * 400x300 section while the CLI analysed the 1138x854 original.
 *
 * Neither host fetches archon.pl. A browser cannot: the site sends no CORS
 * headers, and the fetch policy of §8 — host allowlist, per-hop redirect
 * revalidation, size caps, bounded concurrency — is enforced by the Node
 * adapter, which is where a live fetch belongs. The UI says so rather than
 * implying otherwise.
 *
 * WEB_ONLY.
 */
import type { RasterImage } from '../core/contracts/raster.js'
import type { SourcePackage } from '../core/contracts/source-package.js'
import { assetFileNameFor } from '../core/contracts/source-package.js'
import { BUNDLED_PACKAGES, bundledFor, manifestOf, type BundledPackage } from './bundled/index.js'
import { loadAndDecode } from './img-decode.js'
import { runStandalone, type StandaloneMessage, type StandaloneRequest } from './standalone-worker.js'

export type SourceRef = { url: string; name: string; key: string; slug?: string }

/** Where a run's bytes came from — shown in the UI, never guessed at. */
export type SourceOriginKind = 'PREBUILT_BUNDLE' | 'DEV_PACKAGE_DIRECTORY'

export const availableSources = (): SourceRef[] =>
  BUNDLED_PACKAGES.map((p) => ({ url: p.url, name: p.name, key: p.key, slug: p.slug }))

export class UnavailableSourceError extends Error {
  constructor(readonly requested: string) {
    super(
      `No source package for this URL is bundled with this build.\n\n` +
        `A browser cannot fetch archon.pl directly — the site sends no CORS headers, and the ` +
        `fetch policy (host allowlist, per-hop redirect revalidation, size caps) is enforced by the ` +
        `Node adapter. To analyse a project that is not bundled here, build its package once with the CLI:\n\n` +
        `  npm run source:package -- <A|B|C|D> --online\n` +
        `  npm run analyze -- <A|B|C|D>\n\n` +
        `Bundled here: ${BUNDLED_PACKAGES.map((p) => p.name).join(', ') || '(none)'}.`,
    )
    this.name = 'UnavailableSourceError'
  }
}

export type RunHandle = { cancel: () => void }

/** A package plus where to load its asset bytes from. */
type Loaded = {
  manifest: string
  pkg: SourcePackage
  assetBase: string
  fileFor: (assetId: string) => string | undefined
  origin: SourceOriginKind
}

/** The package that travels with a standalone build. */
function fromBundle(p: BundledPackage, assetBase: string): Loaded {
  const files = new Map(p.files)
  return {
    manifest: p.manifest,
    pkg: manifestOf(p),
    assetBase,
    fileFor: (id) => files.get(id),
    origin: 'PREBUILT_BUNDLE',
  }
}

/** The package `npm run source:package` wrote, read by the dev server. */
async function fromPackageDirectory(slug: string): Promise<Loaded> {
  const base = `/out/source-packages/${slug}`
  const res = await fetch(`${base}/manifest.json`)
  if (!res.ok) {
    throw new Error(
      `no source package at ${base}/manifest.json (HTTP ${res.status}). ` +
        `Build it first:\n\n  npm run source:package -- ${slug}\n`,
    )
  }
  const manifest = await res.text()
  const pkg = JSON.parse(manifest) as SourcePackage
  return {
    manifest,
    pkg,
    assetBase: `${base}/assets`,
    fileFor: (id) => {
      const a = pkg.assets.find((x) => x.assetId === id)
      return a ? assetFileNameFor(a.contentHash, a.mediaType) : undefined
    },
    origin: 'DEV_PACKAGE_DIRECTORY',
  }
}

/**
 * Decode a package's images and hand the analysis to a worker.
 *
 * Decoding happens here, on the main thread, because it needs `<img>` — and
 * because doing it here means the worker makes no requests at all, which is
 * what lets it start in a host that blocks scripted ones. If the worker cannot
 * be created the same function runs inline instead: slower and it blocks the
 * UI, but it produces the identical result rather than an apology.
 */
export async function runBundledAnalysis(
  requested: string,
  maxRepairCycles: number,
  onMessage: (m: StandaloneMessage) => void,
  assetBase = 'assets',
  devSlug?: string,
): Promise<RunHandle> {
  const bundle = bundledFor(requested)
  let loaded: Loaded
  if (bundle) loaded = fromBundle(bundle, assetBase)
  else if (devSlug) loaded = await fromPackageDirectory(devSlug)
  else throw new UnavailableSourceError(requested)

  const wanted = loaded.pkg.assets.filter((a) => a.analysable)
  onMessage({
    kind: 'PROGRESS',
    stage: `decoding source images (${loaded.origin === 'PREBUILT_BUNDLE' ? 'package bundled with this page' : 'package from out/source-packages'})`,
    detail: `0 / ${wanted.length}`,
  })
  const images: Array<[string, RasterImage]> = []
  for (const [i, asset] of wanted.entries()) {
    const file = loaded.fileFor(asset.assetId)
    if (file) {
      try {
        images.push([asset.assetId, await loadAndDecode(`${loaded.assetBase}/${file}`)])
      } catch {
        // A missing asset is not fatal: the analyzer reports what it has, and
        // the self-verification export says how many it saw.
      }
    }
    onMessage({ kind: 'PROGRESS', stage: 'decoding source images', detail: `${i + 1} / ${wanted.length}` })
  }
  if (images.length === 0) {
    throw new Error(
      `None of the ${wanted.length} images this package selects could be decoded. ` +
        `They are published under "${loaded.assetBase}/" and named by content hash; if they are missing the build is incomplete.`,
    )
  }

  const request: StandaloneRequest = { manifest: loaded.manifest, images, maxRepairCycles }

  let worker: Worker | null = null
  try {
    // Vite inlines this module as a blob worker, so the standalone build needs
    // no extra request to start it.
    const mod = await import('./standalone-worker.js?worker&inline')
    const Ctor = (mod as unknown as { default: new () => Worker }).default
    worker = new Ctor()
  } catch {
    worker = null
  }

  if (worker) {
    const w = worker
    w.onmessage = (event: MessageEvent<StandaloneMessage>) => onMessage(event.data)
    w.onerror = (event) => {
      onMessage({ kind: 'ERROR', message: `worker failed: ${event.message || 'unknown error'}` })
    }
    w.postMessage(request)
    return { cancel: () => w.terminate() }
  }

  onMessage({
    kind: 'PROGRESS',
    stage: 'analysing on the main thread',
    detail: 'this host does not allow a worker, so the page will be unresponsive for a minute',
  })
  // Let the progress line paint before the synchronous run begins.
  await new Promise((resolve) => setTimeout(resolve, 60))
  try {
    runStandalone(request, onMessage)
  } catch (err) {
    onMessage({ kind: 'ERROR', message: err instanceof Error ? err.message : String(err) })
  }
  return { cancel: () => undefined }
}
