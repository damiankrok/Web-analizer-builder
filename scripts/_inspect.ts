import { loadSource } from '../src/node/source-loader.js'
import { analyseAssets, buildMetricScaffold } from '../src/core/pipeline/stages.js'
import { EvidenceGraph } from '../src/core/evidence/graph.js'
import { analyze, DEFAULT_ANALYZE } from '../src/core/pipeline/analyze.js'
import { projectByKey } from '../src/node/projects.js'
const p = projectByKey(process.argv[2] ?? 'A')!
const r = await loadSource(p.url, { cacheDir: `fixtures/${p.slug}/assets`, htmlPath: `fixtures/${p.slug}/page.html` })
const analysed = analyseAssets(r.pkg, r.images)
const graph = new EvidenceGraph()
const stage = buildMetricScaffold(r.pkg, analysed, r.images, graph)
console.log('gableFacades:', stage.gableFacades)
for (const set of stage.facadeFeatures) {
  console.log(`--- ${set.facade} ${set.widthM.toFixed(2)}x${set.heightM.toFixed(2)}m`)
  console.log('   bands:', set.bands.map((b) => `${b.t.toFixed(2)}@${b.s0.toFixed(1)}-${b.s1.toFixed(1)}(${(b.coverage*100).toFixed(0)}%)`).join(' '))
  console.log('   gableInfill:', set.gableInfill ? `s ${set.gableInfill.s0.toFixed(2)}-${set.gableInfill.s1.toFixed(2)} t ${set.gableInfill.t0.toFixed(2)}-${set.gableInfill.t1.toFixed(2)} dark ${(set.gableInfill.darkFraction*100).toFixed(0)}%` : 'none')
  console.log('   openings:', set.openings.length, 'protrusions:', set.protrusions.length, 'roofOpenings:', set.roofOpenings.length)
  for (const n of set.notes) console.log('    ·', n)
}
const out = analyze(r.pkg, r.images, { ...DEFAULT_ANALYZE, maxRepairCycles: 0 })
console.log('\n=== resolved')
for (const m of out.resolved.masses) console.log(`  mass ${m.kind.padEnd(14)} base ${m.baseY.toFixed(2)} top ${m.topY.toFixed(2)} ring`, m.footprint.outer.map((q) => `(${q.x.toFixed(1)},${q.z.toFixed(1)})`).join(''))
for (const roof of out.resolved.roofs) console.log(`  roof ${roof.kind.padEnd(8)} mass ${roof.massId} eave ${roof.eaveY.toFixed(2)} ridge ${roof.ridgeY.toFixed(2)} oh ${roof.overhangM}`)
for (const g of out.resolved.openingGroups) console.log(`  opening ${g.kind.padEnd(16)} ${g.facade.padEnd(6)} s ${g.s.toFixed(2)} sill ${g.sillY.toFixed(2)} ${g.widthM.toFixed(2)}x${g.heightM.toFixed(2)} mass ${g.massId}`)
for (const f of out.resolved.appearance) console.log(`  feature ${f.kind.padEnd(10)} ${(f.facade ?? '-').padEnd(6)} s ${(f.s ?? 0).toFixed(2)} t ${(f.t ?? 0).toFixed(2)} ${(f.widthM ?? 0).toFixed(2)}x${(f.heightM ?? 0).toFixed(2)}` + (f.world ? ` world (${f.world.x.toFixed(1)},${f.world.y.toFixed(1)},${f.world.z.toFixed(1)})` : ''))
for (const n of out.resolved.notes) console.log('  note:', n)
console.log('quantities:', JSON.stringify(out.tessellation.quantities))
