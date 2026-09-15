/** Development-only: the §16 evaluation with the OCR readings cached. */
import { readFileSync } from 'node:fs'
import { loadSource } from '../src/node/source-loader.js'
import { projectByKey } from '../src/node/projects.js'
import { extractPlanSpec, DEFAULT_EXTRACTION } from '../src/node/extract-runner.js'
import { evaluateCandidate, type Gold } from '../tests/candidate-evaluator.js'
import { CachedEngine } from './_cache-engine.js'

const project = projectByKey('A')!
const gold = JSON.parse(readFileSync('research/gold/marcowki-interior-v1.json', 'utf8')) as Gold
const loaded = await loadSource(project.url, {
  cacheDir: `fixtures/${project.slug}/assets`,
  htmlPath: `fixtures/${project.slug}/page.html`,
})
const engine = new CachedEngine(project.slug)
const t0 = Date.now()
const result = extractPlanSpec(loaded.pkg, loaded.images, { ...DEFAULT_EXTRACTION, engine }, {
  sourcePackageId: loaded.source.packageId,
  sourcePackageHash: loaded.source.contentHash,
})
console.log(`ocr cache: ${engine.hits} hits, ${engine.misses} misses; ${Date.now() - t0} ms`)

for (const { storey, level } of [
  { storey: 'GROUND', level: 'ground' },
  { storey: 'UPPER_ATTIC', level: 'upper' },
]) {
  const e = evaluateCandidate(result.candidate, gold, level, storey)
  console.log(`\n=== ${storey}  aligned dx ${e.alignment.dx.toFixed(3)} dz ${e.alignment.dz.toFixed(3)}`)
  console.log(`  walls      ${e.walls.matchedM.toFixed(2)}/${e.walls.goldLengthM.toFixed(2)} m = ${(e.walls.coverage * 100).toFixed(1)}%`)
  console.log(`  invented   ${e.invented.count} openings, ${e.invented.totalM.toFixed(2)} m`)
  console.log(`  rooms      ${e.rooms.candidateRooms} regions, ${e.rooms.mapped} mapped, ${e.rooms.merged} merged`)
  console.log(`  adjacency  ${e.adjacency.agreed}/${e.adjacency.goldEdges} = ${(e.adjacency.rate * 100).toFixed(1)}% (merged ${e.adjacency.merged}, missing ${e.adjacency.missing})`)
  console.log(`  doors      ${e.doors.detected} detected + ${e.doors.unresolved} unresolved of ${e.doors.goldDoors}`)
  const d = e.decomposition
  console.log(`  --- decomposition of ${d.goldLengthM.toFixed(2)} m of major gold wall`)
  console.log(`      gold says open        ${d.goldOpeningM.toFixed(2)} m; gold fabric ${d.goldFabricM.toFixed(2)} m`)
  console.log(`      candidate fabric      ${d.fabricM.toFixed(2)} m (${((d.fabricM / d.goldLengthM) * 100).toFixed(1)}% of gold length, ${(d.fabricOfGoldFabric * 100).toFixed(1)}% of gold fabric)`)
  console.log(`      logical host          ${d.logicalM.toFixed(2)} m = ${(d.logicalCoverage * 100).toFixed(1)}%`)
  console.log(`      host extent ceiling   ${d.hostExtentM.toFixed(2)} m = ${(d.hostExtentCoverage * 100).toFixed(1)}%`)
  console.log(`      fabric across a gold opening ${d.fabricAcrossGoldOpeningM.toFixed(2)} m; opening agreed ${d.openingAgreedM.toFixed(2)} m`)
  console.log(`      no candidate wall at all     ${d.missingM.toFixed(2)} m; truly missing walls ${d.trulyMissing}; fragmented but correct ${d.fragmentedButCorrect}`)
  for (const r of d.rows.filter((x) => x.goldLengthM >= 0.6).sort((a, b) => a.logicalM / a.goldLengthM - b.logicalM / b.goldLengthM)) {
    console.log(
      `      ${r.goldId.padEnd(22)} gold ${r.goldLengthM.toFixed(2)} (open ${r.goldOpeningM.toFixed(2)}) ` +
        `fabric ${r.fabricM.toFixed(2)} logical ${r.logicalM.toFixed(2)} extent ${r.hostExtentM.toFixed(2)} ` +
        `hosts ${r.hostCount} missing ${r.missingM.toFixed(2)}`,
    )
  }
  for (const r of e.walls.rows.filter((x) => x.goldLengthM >= 0.6).sort((a, b) => a.matchedM / a.goldLengthM - b.matchedM / b.goldLengthM)) {
    console.log(`    ${r.goldId.padEnd(22)} ${r.matchedM.toFixed(2)}/${r.goldLengthM.toFixed(2)} m (${((r.matchedM / r.goldLengthM) * 100).toFixed(0)}%)`)
  }
  for (const r of e.doors.rows) console.log(`    door ${r.goldId.padEnd(16)} ${r.outcome} ${r.foundClass} gold ${r.goldWidthM.toFixed(2)} found ${(r.foundWidthM ?? 0).toFixed(2)}`)
  console.log(`    gold rooms covered ${e.rooms.goldCovered}/${e.rooms.goldRooms}; not covered: ${e.rooms.goldUncovered.join(', ') || 'none'}; merged regions ${e.rooms.mergedRows.map((r) => r.join('+')).join(' | ') || 'none'} (${e.rooms.mergedUnresolved} of ${e.rooms.merged} marked unresolved by the candidate)`)
  console.log(`    door edges ${e.adjacency.doorAgreed}/${e.adjacency.doorEdges}, open edges ${e.adjacency.openAgreed}/${e.adjacency.openEdges}`)
  for (const r of e.adjacency.rows) console.log(`    edge ${r.edge.padEnd(34)} ${r.kind.padEnd(5)} ${r.outcome}`)
  console.log(`    as DOOR ${e.doors.asDoor}/${e.doors.goldDoors}, host ${e.doors.hostCorrect}/${e.doors.goldDoors}, widths ${e.doors.widthsWithin}/${e.doors.widthsCompared} within ${e.doors.widthToleranceM.toFixed(3)} m`)
}
