/**
 * How the browser app obtains a source package, and how it runs the analysis.
 *
 * Two hosts, one contract. Under `npm run ui:dev` the cached page and assets
 * are served by Vite straight out of `fixtures/`, which is the closest thing
 * to the CLI's own view of them. In the standalone build there is no dev
 * server and no developer's machine, so the package travels with the bundle.
 *
 * Neither host fetches archon.pl. A browser cannot: ARCHON sends no CORS
 * headers, and the fetch policy of §8 — host allowlist, per-hop redirect
 * revalidation, size caps, bounded concurrency — is enforced by the Node
 * adapter, which is where a live fetch belongs. The browser analyses a cached
 * package; caching a new one is a CLI step.
 *
 * WEB_ONLY.
 */
import type { RasterImage } from '../core/contracts/raster.js'
import { BUNDLED_PROJECTS, bundledFor, type BundledProject } from './bundled/index.js'
import { loadAndDecode } from './img-decode.js'
import { runStandalone, type StandaloneMessage, type StandaloneRequest } from './standalone-worker.js'

export type SourceRef = { url: string; name: string; key: string }

export const availableSources = (): SourceRef[] =>
  BUNDLED_PROJECTS.map((p) => ({ url: p.url, name: p.name, key: p.key }))

export class UnavailableSourceError extends Error {
  constructor(readonly requested: string) {
    super(
      `No cached source package for this URL is bundled with this build.\n\n` +
        `A browser cannot fetch archon.pl directly — the site sends no CORS headers, and the ` +
        `fetch policy (host allowlist, per-hop redirect revalidation, size caps) is enforced by the ` +
        `Node adapter. To analyse a project that is not bundled here, cache it once with the CLI:\n\n` +
        `  npm run fetch -- <A|B|C|D> --online\n` +
        `  npm run analyze -- <A|B|C|D>\n\n` +
        `Bundled here: ${BUNDLED_PROJECTS.map((p) => p.name).join(', ')}.`,
    )
    this.name = 'UnavailableSourceError'
  }
}

export type RunHandle = { cancel: () => void }

/**
 * Decode a bundled package's images and hand the analysis to a worker.
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
): Promise<RunHandle> {
  const project: BundledProject | undefined = bundledFor(requested)
  if (!project) throw new UnavailableSourceError(requested)

  onMessage({ kind: 'PROGRESS', stage: 'decoding source images', detail: `0 / ${project.assets.length}` })
  const images: Array<[string, RasterImage]> = []
  for (const [i, asset] of project.assets.entries()) {
    try {
      images.push([asset.basename, await loadAndDecode(`${assetBase}/${asset.file}`)])
    } catch {
      // A missing asset is not fatal: the analyzer reports what it has, and the
      // self-verification export says how many it saw.
    }
    onMessage({ kind: 'PROGRESS', stage: 'decoding source images', detail: `${i + 1} / ${project.assets.length}` })
  }
  if (images.length === 0) {
    throw new Error(
      `None of the ${project.assets.length} bundled images could be decoded. ` +
        `They are published beside this page under "${assetBase}/"; if they are missing the build is incomplete.`,
    )
  }

  const request: StandaloneRequest = { url: project.url, html: project.html, images, maxRepairCycles }

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
