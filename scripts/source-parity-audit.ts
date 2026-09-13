/**
 * CLI / web source parity — STAGE WEB-PIVOT-03 proof, development only.
 *
 *   npx tsx scripts/source-parity-audit.ts [A B ...]
 *
 * Before analyzer outputs can be compared at all, the two paths have to be
 * shown to be looking at the same thing. This script proves that at the level
 * the brief asks for — package hash, asset count, asset ids, asset byte hashes,
 * decoded dimensions, roles and relations — with no "equivalent enough"
 * anywhere in it.
 *
 * Three readers of one package:
 *
 *  1. the **manifest on disk**, which `npm run analyze` consumes;
 *  2. the **manifest embedded in the web bundle**, which the browser consumes;
 *  3. a **fresh build**, which shows the builder is reproducible.
 *
 * The web reader is not a simulation: it is `runStandalone` from
 * `src/web/standalone-worker.ts`, the same module the browser's worker runs,
 * invoked on the same bytes.
 */
import { readPackage, packageExists } from '../src/node/package-store.js'
import { buildSourcePackage } from '../src/node/source-package.js'
import { canonicalPackageView, packageContentHash, packageSealIntact, toParsedSource, type SourceAssetRecord, type SourcePackage } from '../src/core/contracts/source-package.js'
import { canonicalJson } from '../src/core/util/hash.js'
import { projectByKey, type DevProject } from '../src/node/projects.js'
import { BUNDLED_PACKAGES } from '../src/web/bundled/index.js'
import { runStandalone, type StandaloneMessage } from '../src/web/standalone-worker.js'
import { decodeImage } from '../src/node/image-decode.js'
import { readPackageAssets } from '../src/node/package-store.js'
import { assetFileNameFor } from '../src/core/contracts/source-package.js'
import type { RasterImage } from '../src/core/contracts/raster.js'

const keys = process.argv.slice(2).filter((a) => !a.startsWith('--'))
/** Also run the browser's own worker module over the package, end to end. */
const deep = process.argv.includes('--analyze')
const wanted = (keys.length > 0 ? keys : ['A', 'B']).map((k) => {
  const p = projectByKey(k)
  if (!p) throw new Error(`unknown project ${k}`)
  return p
})

let failures = 0
const check = (label: string, ok: boolean, detail = ''): void => {
  if (!ok) failures++
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? `  ${detail}` : ''}`)
}

/** The per-asset facts §14 requires to be equal, in a comparable form. */
const assetFacts = (a: SourceAssetRecord) => ({
  assetId: a.assetId,
  selectedUrl: a.selectedUrl,
  canonicalUrl: a.canonicalUrl,
  contentHash: a.contentHash,
  mediaType: a.mediaType,
  width: a.width,
  height: a.height,
  byteLength: a.byteLength,
  analysable: a.analysable,
  roles: a.roles,
  relations: [...a.relations].sort((x, y) => (x.kind + x.assetId < y.kind + y.assetId ? -1 : 1)).map((r) => ({ kind: r.kind, assetId: r.assetId })),
  variants: [...a.variants].sort((x, y) => (x.url < y.url ? -1 : 1)).map((v) => ({ url: v.url, contentHash: v.contentHash ?? null, width: v.width ?? null, height: v.height ?? null })),
})

const factsOf = (pkg: SourcePackage): string =>
  canonicalJson([...pkg.assets].sort((a, b) => (a.assetId < b.assetId ? -1 : 1)).map(assetFacts))

async function audit(project: DevProject): Promise<void> {
  console.log(`\n=== ${project.key}: ${project.name}`)
  if (!(await packageExists(project.slug))) {
    console.log(`  FAIL no package on disk; run "npm run source:package -- ${project.key}"`)
    failures++
    return
  }

  const disk = await readPackage(project.slug)
  console.log(`  package ${disk.packageId}  hash ${disk.contentHash}`)
  check('the manifest matches its own seal', packageSealIntact(disk))

  // 1. Reproducibility: a fresh build of the same cached inputs.
  const { pkg: fresh } = await buildSourcePackage(project.url, {
    cacheDir: `fixtures/${project.slug}/assets`,
    htmlPath: `fixtures/${project.slug}/page.html`,
    offline: true,
  })
  check('a fresh build reproduces the package hash', fresh.contentHash === disk.contentHash, `${fresh.contentHash.slice(0, 16)} vs ${disk.contentHash.slice(0, 16)}`)
  check(
    'the canonical view is identical, field for field',
    canonicalJson(canonicalPackageView(fresh)) === canonicalJson(canonicalPackageView(disk)),
  )

  // 2. Volatile fields are excluded from the hash, and provably so.
  const stamped: SourcePackage = {
    ...disk,
    fetchedAt: new Date().toISOString(),
    origin: 'LIVE_FETCH',
    toolVersions: { node: 'some-other-version' },
  }
  check('a different timestamp, origin and tool set do not move the hash', packageContentHash(stamped) === disk.contentHash)
  const edited: SourcePackage = {
    ...disk,
    assets: disk.assets.map((a, i) => (i === 0 ? { ...a, contentHash: `${a.contentHash.slice(0, -1)}0` } : a)),
  }
  check('changing one asset byte hash does move it', packageContentHash(edited) !== disk.contentHash)

  // 3. The web reader: the bundle's embedded manifest, or the same bytes.
  const bundle = BUNDLED_PACKAGES.find((b) => b.slug === project.slug)
  const webManifest = bundle ? bundle.manifest : canonicalJson({ ...disk, origin: 'PREBUILT_BUNDLE' })
  const web = JSON.parse(webManifest) as SourcePackage
  console.log(`  web reader: ${bundle ? 'the manifest embedded in the standalone bundle' : 'the on-disk manifest (this project is not in the shipped bundle)'}`)
  check('the web manifest matches its own seal', packageSealIntact(web))
  check('package hash', web.contentHash === disk.contentHash, `${web.contentHash.slice(0, 16)} vs ${disk.contentHash.slice(0, 16)}`)
  check('package id', web.packageId === disk.packageId)
  check('schema version', web.schemaVersion === disk.schemaVersion)
  check('asset count', web.assets.length === disk.assets.length, `${web.assets.length} vs ${disk.assets.length}`)
  check('asset ids', canonicalJson(web.assets.map((a) => a.assetId).sort()) === canonicalJson(disk.assets.map((a) => a.assetId).sort()))
  check('asset byte hashes, decoded sizes, roles and relations', factsOf(web) === factsOf(disk))
  check(
    'only the origin differs, as it must: the bundle is prebuilt',
    web.origin === 'PREBUILT_BUNDLE' && canonicalJson({ ...web, origin: disk.origin }) === canonicalJson(disk),
  )

  // 4. What each host hands the analyzer.
  const cliView = toParsedSource(disk)
  const webView = toParsedSource(web)
  check('the analyzer receives the same asset list', canonicalJson(cliView.assets) === canonicalJson(webView.assets))
  check('...and the same published facts', canonicalJson(cliView.facts) === canonicalJson(webView.facts))
  console.log(
    `  analyzer input: ${cliView.assets.length} assets, ` +
      `${cliView.assets.map((a) => `${a.role}=${a.width}x${a.height}`).slice(0, 3).join(' ')} ...`,
  )

  if (!deep) return
  // 5. The browser's own code path, on the same bytes. `runStandalone` is the
  // module the worker runs; calling it here is not a simulation of the web
  // path, it *is* the web path with the DOM parts left out.
  const bytes = await readPackageAssets(project.slug)
  const images: Array<[string, RasterImage]> = []
  for (const a of web.assets) {
    if (!a.analysable || !a.contentHash) continue
    const data = bytes.get(assetFileNameFor(a.contentHash, a.mediaType))
    if (data) images.push([a.assetId, decodeImage(data)])
  }
  let done: { sourcePackage: { packageId: string; contentHash: string; analysedCount: number; decodedCount: number }; exports: Record<string, unknown> } | null = null
  runStandalone({ manifest: webManifest, images, maxRepairCycles: 0 }, (m: StandaloneMessage) => {
    if (m.kind === 'DONE') done = m.payload as typeof done
  })
  const payload = done as unknown as { sourcePackage: { packageId: string; contentHash: string; analysedCount: number; decodedCount: number }; exports: Record<string, { sourcePackage?: { sourcePackageHash?: string } }> } | null
  check('the browser worker module runs against this package', payload !== null)
  if (!payload) return
  check('...and reports the package the CLI used', payload.sourcePackage.contentHash === disk.contentHash)
  check('...and decoded every asset the package selects', payload.sourcePackage.decodedCount === cliView.assets.length, `${payload.sourcePackage.decodedCount} of ${cliView.assets.length}`)
  check(
    '...and stamps that package into its exports',
    payload.exports['benchmark-summary.json']?.sourcePackage?.sourcePackageHash === disk.contentHash,
  )
}

for (const p of wanted) await audit(p)
console.log(`\n${failures === 0 ? 'source parity holds' : `${failures} PARITY CHECK(S) FAILED`}`)
process.exitCode = failures === 0 ? 0 : 1
