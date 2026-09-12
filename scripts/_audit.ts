import { loadSource } from '../src/node/source-loader.js'
import { analyze, DEFAULT_ANALYZE } from '../src/core/pipeline/analyze.js'
import { projectByKey } from '../src/node/projects.js'
const p = projectByKey(process.argv[2] ?? 'A')!
const r = await loadSource(p.url, { cacheDir: `fixtures/${p.slug}/assets`, htmlPath: `fixtures/${p.slug}/page.html` })
const out = analyze(r.pkg, r.images, { ...DEFAULT_ANALYZE, maxRepairCycles: 0 })
console.log(`=== metric audit: ${p.name}`)
for (const e of out.audit.entries) {
  const v = e.value === null ? 'n/a' : `${e.value.toFixed(2)} ${e.unit}`
  console.log(`  ${e.key.padEnd(20)} ${v.padStart(12)}  ${e.provenance.padEnd(19)} conf ${e.confidence.toFixed(2)}  ${e.source}`)
  for (const c of e.corroboration) console.log(`      corroboration: ${c.source} = ${c.value.toFixed(2)} (Δ${c.deltaAbs.toFixed(2)})`)
  if (e.note) console.log(`      ! ${e.note}`)
}
console.log('summary:', JSON.stringify(out.audit.summary))
console.log('conflicts:', out.audit.conflicts.length)
