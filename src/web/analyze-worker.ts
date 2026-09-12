/**
 * Worker entry.
 *
 * The analysis is CPU-bound — thousands of camera projections and several
 * rasterised scores — so it runs off the UI thread (§5). Only JSON-serialisable
 * data crosses the boundary, which the portable DTOs already guarantee.
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
import { fetchAndDecode } from './image-decode.js'

export type WorkerRequest = {
  /** Page URL, used for identity and for resolving relative assets. */
  url: string
  /** Where the cached page and assets are served from. */
  base: string
  maxRepairCycles: number
}

export type WorkerProgress =
  | { kind: 'PROGRESS'; stage: string; detail?: string }
  | { kind: 'ERROR'; message: string }
  | { kind: 'DONE'; payload: unknown }

const post = (m: WorkerProgress): void => {
  ;(self as unknown as Worker).postMessage(m)
}

/** Cached asset filename, matching the Node fetch cache layout. */
const assetPath = (base: string, url: string): string =>
  `${base}/assets/${url.slice(url.lastIndexOf('/') + 1)}`

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { url, base, maxRepairCycles } = event.data
  try {
    post({ kind: 'PROGRESS', stage: 'fetching page' })
    const html = await (await fetch(`${base}/page.html`)).text()

    post({ kind: 'PROGRESS', stage: 'parsing source package' })
    let pkg = parseArchonPage(html, url)

    const images = new Map<string, RasterImage>()
    for (const [i, asset] of pkg.assets.entries()) {
      post({ kind: 'PROGRESS', stage: 'decoding assets', detail: `${i + 1} / ${pkg.assets.length}` })
      try {
        images.set(asset.id, await fetchAndDecode(assetPath(base, asset.url)))
      } catch {
        // A missing cached asset is not fatal: the analyzer reports what it has.
      }
    }
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

    post({ kind: 'PROGRESS', stage: 'analysing', detail: 'scaffold, cameras, scoring, repair' })
    const result = analyze(pkg, images, { ...DEFAULT_ANALYZE, maxRepairCycles })
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
  } catch (err) {
    post({ kind: 'ERROR', message: err instanceof Error ? err.message : String(err) })
  }
}
