/**
 * What the CLI/web source mismatch cost — STAGE WEB-PIVOT-03, development only.
 *
 *   npx tsx scripts/source-mismatch-cost.ts [A]
 *
 * Before this stage the CLI probed for the section original and analysed it at
 * 1138x854, while the standalone bundler published the 400x300 page thumbnail
 * and the browser analysed that. Both were "the section"; they were not the
 * same source, and nothing in either output said so.
 *
 * This runs the analyzer twice over one package, changing exactly one thing —
 * which published copy of the section it selects — so the difference is
 * attributable to the mismatch and to nothing else. It is a measurement, not a
 * mode: it mutates a package in memory and writes nothing.
 */
import { readPackage, readPackageAssets } from '../src/node/package-store.js'
import { assetFileNameFor, type SourcePackage } from '../src/core/contracts/source-package.js'
import { sealPackage } from '../src/core/contracts/source-package.js'
import { decodeImage } from '../src/node/image-decode.js'
import { runStandalone } from '../src/web/standalone-worker.js'
import { canonicalJson } from '../src/core/util/hash.js'
import { fetchWithCache } from '../src/node/fetch-adapter.js'
import { projectByKey } from '../src/node/projects.js'
import type { RasterImage } from '../src/core/contracts/raster.js'

const project = projectByKey(process.argv[2] ?? 'A')!
const cacheDir = `fixtures/${project.slug}/assets`
const pkg = await readPackage(project.slug)
const bytes = await readPackageAssets(project.slug)

const section = pkg.assets.find((a) => a.analysable && a.roles.document === 'SECTION')
if (!section) throw new Error('this package has no analysable section')
const thumbnail = section.variants
  .filter((v) => v.url !== section.selectedUrl && v.width && v.height)
  .sort((a, b) => (a.width ?? 0) * (a.height ?? 0) - (b.width ?? 0) * (b.height ?? 0))[0]
if (!thumbnail) throw new Error('this package publishes only one copy of the section')

/** The same package with the section's smaller published copy selected instead. */
const downgraded: SourcePackage = sealPackage({
  ...pkg,
  assets: pkg.assets.map((a) =>
    a.assetId === section.assetId
      ? {
          ...a,
          selectedUrl: thumbnail.url,
          width: thumbnail.width!,
          height: thumbnail.height!,
          byteLength: thumbnail.byteLength!,
          contentHash: thumbnail.contentHash!,
          mediaType: thumbnail.mediaType ?? a.mediaType,
          selectionReason: 'the copy the pre-STAGE-03 standalone bundler published',
        }
      : a,
  ),
})

const run = async (p: SourcePackage, label: string) => {
  const images: Array<[string, RasterImage]> = []
  for (const a of p.assets) {
    if (!a.analysable || !a.contentHash) continue
    let data = bytes.get(assetFileNameFor(a.contentHash, a.mediaType))
    if (!data) data = (await fetchWithCache(a.selectedUrl, 'image', cacheDir, { offline: true })).bytes
    images.push([a.assetId, decodeImage(data)])
  }
  let out: { exports: Record<string, unknown>; geometry: { quantities: Record<string, number> } } | null = null
  runStandalone({ manifest: canonicalJson(p), images, maxRepairCycles: 3 }, (m) => {
    if (m.kind === 'DONE') out = m.payload as typeof out
  })
  const payload = out as unknown as {
    exports: Record<string, Record<string, unknown>>
    geometry: { quantities: Record<string, number> }
  }
  const sv = payload.exports['self-verification.json'] as { score: Record<string, number> }
  const pd = payload.exports['printed-dimensions.json'] as { accepted: number; dimensions: unknown[]; scales: unknown[] }
  const bh = payload.exports['building-hypotheses.json'] as { resolvedId: string }
  const sec = p.assets.find((a) => a.assetId === section.assetId)!
  console.log(`\n--- ${label}: section ${sec.width}x${sec.height}, ${sec.byteLength} B, sha ${sec.contentHash.slice(0, 8)}`)
  console.log(`  score base ${sv.score.base.toFixed(4)}  final ${sv.score.final.toFixed(4)}  section ${sv.score.section.toFixed(4)}  metric ${sv.score.metric.toFixed(4)}`)
  console.log(`  printed dimensions: ${pd.accepted} corroborated of ${pd.dimensions.length} read, ${pd.scales.length} scales`)
  console.log(`  resolved hypothesis ${bh.resolvedId}`)
  console.log(`  quantities ${canonicalJson(payload.geometry.quantities)}`)
  return { score: sv.score, accepted: pd.accepted, read: pd.dimensions.length, quantities: payload.geometry.quantities }
}

console.log(`${project.key} ${project.name} — package ${pkg.packageId}`)
const before = await run(downgraded, 'the copy the browser used to get')
const after = await run(pkg, 'the copy both hosts get now')
console.log('\n--- difference attributable to the section alone')
for (const k of Object.keys(after.score)) {
  const d = after.score[k] - before.score[k]
  if (Math.abs(d) > 1e-9) console.log(`  score.${k.padEnd(12)} ${before.score[k].toFixed(4)} -> ${after.score[k].toFixed(4)}  (${d > 0 ? '+' : ''}${d.toFixed(4)})`)
}
console.log(`  printed dimensions corroborated ${before.accepted} -> ${after.accepted} (of ${before.read} -> ${after.read} read)`)
for (const k of Object.keys(after.quantities)) {
  const d = after.quantities[k] - before.quantities[k]
  if (Math.abs(d) > 1e-6) console.log(`  ${k.padEnd(18)} ${before.quantities[k].toFixed(3)} -> ${after.quantities[k].toFixed(3)}  (${d > 0 ? '+' : ''}${d.toFixed(3)})`)
}
