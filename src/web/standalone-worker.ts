/**
 * The browser's analysis entry point — STAGE WEB-PIVOT-03.
 *
 * It receives a `SourcePackage` and the decoded rasters of the copies that
 * package selected. It does not parse HTML, does not classify assets and does
 * not choose between variants: every one of those decisions was made once, by
 * the Node builder, and is carried in the package. The worker's only job is to
 * check the package's seal and run the same core pipeline the CLI runs.
 *
 * That is the whole of the parity fix. Before this stage the worker re-parsed
 * the project page and matched images by filename, which is how it came to
 * analyse a 400x300 section while the CLI analysed the 1138x854 original.
 *
 * Decoding still happens on the main thread, because it needs `<img>` — which
 * exists there and not in a worker — and because a host that blocks scripted
 * requests would otherwise stop the worker dead.
 *
 * WEB_ONLY.
 */
import { analyze, DEFAULT_ANALYZE } from '../core/pipeline/analyze.js'
import { buildExports } from '../core/pipeline/exports.js'
import { tessellate } from '../core/hypotheses/tessellate.js'
import { packageSealIntact, sealPackage, toParsedSource, type SourcePackage } from '../core/contracts/source-package.js'
import type { RasterImage } from '../core/contracts/raster.js'

export type StandaloneRequest = {
  /** The sealed package, as canonical JSON. */
  manifest: string
  /** Decoded rasters, keyed by `assetId` — never by filename. */
  images: Array<[string, RasterImage]>
  maxRepairCycles: number
}

export type StandaloneMessage =
  | { kind: 'PROGRESS'; stage: string; detail?: string }
  | { kind: 'ERROR'; message: string }
  | { kind: 'DONE'; payload: unknown }

/** The analysis itself, shared by the worker and the main-thread fallback. */
export function runStandalone(
  request: StandaloneRequest,
  post: (m: StandaloneMessage) => void,
): void {
  post({ kind: 'PROGRESS', stage: 'reading source package' })
  const pkg = JSON.parse(request.manifest) as SourcePackage
  if (!packageSealIntact(pkg)) {
    // The package's own hash is the only thing making "the CLI and this build
    // analysed the same source" checkable. A package that fails its seal has
    // been edited since it was built, and analysing it would make that claim
    // untrue while still printing the id it no longer matches.
    throw new Error(
      `source package ${pkg.packageId} does not match its own hash ` +
        `(manifest says ${pkg.contentHash.slice(0, 16)}, content hashes to ${sealPackage(pkg).contentHash.slice(0, 16)})`,
    )
  }

  const images = new Map<string, RasterImage>(request.images)
  const parsed = toParsedSource(pkg)
  post({
    kind: 'PROGRESS',
    stage: 'analysing',
    detail: `${images.size} of ${parsed.assets.length} assets decoded, package ${pkg.packageId}`,
  })

  const result = analyze(parsed, images, { ...DEFAULT_ANALYZE, maxRepairCycles: request.maxRepairCycles })
  const tess = tessellate(result.resolved)

  post({
    kind: 'DONE',
    payload: {
      exports: buildExports(result, {
        sourcePackageId: pkg.packageId,
        sourcePackageSchemaVersion: pkg.schemaVersion,
        sourcePackageHash: pkg.contentHash,
        sourceOrigin: pkg.origin,
      }),
      sourcePackage: {
        packageId: pkg.packageId,
        schemaVersion: pkg.schemaVersion,
        contentHash: pkg.contentHash,
        origin: pkg.origin,
        assetCount: pkg.assets.length,
        analysedCount: parsed.assets.length,
        decodedCount: images.size,
        assets: pkg.assets.map((a) => ({
          assetId: a.assetId,
          label: a.label,
          mediaType: a.mediaType,
          roles: a.roles,
          selectedUrl: a.selectedUrl,
          width: a.width,
          height: a.height,
          byteLength: a.byteLength,
          contentHash: a.contentHash,
          analysable: a.analysable,
          selectionReason: a.selectionReason,
          variants: a.variants.map((v) => ({ url: v.url, channel: v.channel, width: v.width, height: v.height, note: v.note })),
          relations: a.relations,
        })),
        missing: pkg.missing,
      },
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
