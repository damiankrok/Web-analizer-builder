import { loadSource } from '../src/node/source-loader.js'
import { analyseAssets, buildMetricScaffold, fitCameras } from '../src/core/pipeline/stages.js'
import { EvidenceGraph } from '../src/core/evidence/graph.js'
import { buildHypothesis } from '../src/core/hypotheses/builder.js'
import { tessellate } from '../src/core/hypotheses/tessellate.js'
import { factValue } from '../src/core/contracts/source.js'
import { parseTechnology } from '../src/core/source/facts.js'
import { rad2deg } from '../src/core/math/vec.js'
import { gableSpanFromSection } from '../src/core/scaffold/section.js'

const proj = process.argv[2] ?? 'A-marcowki'
const r = await loadSource('https://x', { cacheDir: `fixtures/${proj}/assets`, htmlPath: `fixtures/${proj}/page.html` })
const analysed = analyseAssets(r.pkg, r.images)
const graph = new EvidenceGraph()
const res = buildMetricScaffold(r.pkg, analysed, r.images, graph)
const tech = parseTechnology(r.pkg.notes)
const gable = res.sectionGeometry ? gableSpanFromSection(res.sectionGeometry) : null
const ground = r.pkg.rooms.filter((x) => x.storey === 'GROUND').reduce((a, b) => a + b.areaM2, 0)
const upper = r.pkg.rooms.filter((x) => x.storey === 'UPPER').reduce((a, b) => a + b.areaM2, 0)
const h = buildHypothesis({
  scaffold: res.scaffold, gableSpanM: gable?.spanM ?? null, sectionAxis: 'X',
  publishedRoofFamily: tech.roofFamily, publishedGarageAreaM2: factValue(r.pkg, 'garage_area'),
  storeyNetAreas: { ground: ground || null, upper: upper || null }, notch: res.footprintFit?.notch ?? null,
})
const tess = tessellate(h)
const t0 = Date.now()
const views = fitCameras(analysed, tess, graph)
console.log(`fitCameras: ${views.length} views in ${Date.now() - t0}ms`)
for (const v of views) {
  const best = v.hypotheses[0]
  console.log(`\n=== ${v.role} (${v.assetId.slice(-6)}) ${v.elapsedMs}ms, ${v.evaluations} evals, ${v.features.features.length} features, ${v.features.openings.length} dark regions`)
  console.log(`  ambiguity: ${v.ambiguity.ambiguous ? 'YES' : 'no'} fovSpread ${v.ambiguity.fovSpreadDeg.toFixed(1)}° distSpread ${v.ambiguity.distanceSpreadM.toFixed(1)}m azSpread ${v.ambiguity.azimuthSpreadDeg.toFixed(1)}° degenerate=${v.ambiguity.fovDistanceDegenerate}`)
  for (const [i, c] of v.hypotheses.entries()) {
    const sc = v.scores[i]
    console.log(`  #${i} ${c.confidenceClass.padEnd(17)} total ${sc.total.toFixed(3)} sil ${sc.silhouette.toFixed(3)} edge ${sc.edge.toFixed(3)} roof ${sc.roofline.toFixed(3)} open ${sc.openingLayout.toFixed(3)} anchors ${c.anchorMatches.length} fov ${rad2deg(c.fovY ?? 0).toFixed(1)}°`)
  }
  console.log(`  anchors matched ${v.anchors.matches.length}, unmatched-but-visible ${v.anchors.unmatchedVisible.length}, not visible ${v.anchors.notVisible.length}, mean residual ${v.anchors.meanResidualPx?.toFixed(1) ?? 'n/a'} px`)
  for (const n of v.notes) console.log('   ·', n)
}
