/**
 * Worker entry for the standalone build.
 *
 * It differs from `analyze-worker.ts` in one respect: it makes no requests.
 * The page HTML arrives as a string and the images arrive already decoded,
 * because decoding needs `<img>` — which exists on the main thread and not in
 * a worker — and because a hosting environment that blocks scripted requests
 * would otherwise stop the worker dead.
 *
 * Everything after that boundary is the same core pipeline the CLI runs.
 *
 * WEB_ONLY.
 */
import { parseArchonPage } from '../core/source/archon-parser.js'
import { analyze, DEFAULT_ANALYZE } from '../core/pipeline/analyze.js'
import { buildExports } from '../core/pipeline/exports.js'
import { tessellate } from '../core/hypotheses/tessellate.js'
import { classifyByPixels } from '../core/source/role-classifier.js'
import { toGray } from '../core/raster/gray.js'
import type { RasterImage } from '../core/contracts/raster.js'

export type StandaloneRequest = {
  url: string
  html: string
  /** Decoded assets, keyed by the basename of the asset URL. */
  images: Array<[string, RasterImage]>
  maxRepairCycles: number
}

export type StandaloneMessage =
  | { kind: 'PROGRESS'; stage: string; detail?: string }
  | { kind: 'ERROR'; message: string }
  | { kind: 'DONE'; payload: unknown }

const basename = (url: string): string => url.slice(url.lastIndexOf('/') + 1)

/** The analysis itself, shared by the worker and the main-thread fallback. */
export function runStandalone(
  request: StandaloneRequest,
  post: (m: StandaloneMessage) => void,
): void {
  post({ kind: 'PROGRESS', stage: 'parsing source package' })
  let pkg = parseArchonPage(request.html, request.url)

  const byName = new Map(request.images)
  const images = new Map<string, RasterImage>()
  for (const asset of pkg.assets) {
    const image = byName.get(basename(asset.url))
    if (image) images.set(asset.id, image)
  }
  post({ kind: 'PROGRESS', stage: 'classifying assets', detail: `${images.size} of ${pkg.assets.length} decoded` })
  pkg = {
    ...pkg,
    assets: pkg.assets.map((a) => {
      const image = images.get(a.id)
      if (!image) return a
      const next = { ...a, width: image.width, height: image.height }
      if (a.role !== 'UNKNOWN_ASSET') return next
      const guess = classifyByPixels(image, toGray(image))
      return { ...next, role: guess.role, roleConfidence: guess.confidence, roleEvidence: [...a.roleEvidence, ...guess.evidence] }
    }),
  }

  post({ kind: 'PROGRESS', stage: 'analysing', detail: 'dimensions, scaffold, cameras, scoring, repair' })
  const result = analyze(pkg, images, { ...DEFAULT_ANALYZE, maxRepairCycles: request.maxRepairCycles })
  const tess = tessellate(result.resolved)

  post({
    kind: 'DONE',
    payload: {
      exports: buildExports(result),
      audit: result.audit,
      printed: result.printed,
      geometry: {
        tris: tess.tris.map((t) => ({ a: t.a, b: t.b, c: t.c, part: t.part, ownerId: t.ownerId })),
        edges: tess.edges.map((e) => ({ a: e.a, b: e.b, kind: e.kind })),
        quantities: tess.quantities,
      },
      views: result.views.map((v) => ({
        assetId: v.assetId,
        role: v.role,
        ambiguity: v.ambiguity,
        hypotheses: v.hypotheses,
        scores: v.scores,
        notes: v.notes,
      })),
      performance: result.performance,
    },
  })
}

// Worker mode. The same module is imported directly by the main-thread
// fallback, where the handler below is simply never installed because the
// global has a `document`.
const scope = globalThis as unknown as {
  document?: unknown
  postMessage?: (m: unknown) => void
  onmessage?: ((event: MessageEvent<StandaloneRequest>) => void) | null
}
if (scope.document === undefined && typeof scope.postMessage === 'function') {
  const reply = scope.postMessage.bind(scope)
  scope.onmessage = (event: MessageEvent<StandaloneRequest>) => {
    try {
      runStandalone(event.data, reply)
    } catch (err) {
      reply({
        kind: 'ERROR',
        message: err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err),
      })
    }
  }
}
