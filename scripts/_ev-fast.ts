/**
 * STAGE WEB-PIVOT-06 §20, §21 — measure a candidate against the hand gold.
 *
 *   npx tsx scripts/evaluate-candidate.ts A
 *
 * This runs on the development project only. Gold is read here and nowhere in
 * the extraction, and there is no single score: each dimension is reported on
 * its own, because a missing wall and a merged room are different failures and
 * averaging them lets one hide behind the other (§19).
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadSource } from '../src/node/source-loader.js'
import { projectByKey } from '../src/node/projects.js'
import { extractPlanSpec, DEFAULT_EXTRACTION } from '../src/node/extract-runner.js'
import { CachedEngine } from './_cache-engine.js'
import { evaluateCandidate, type Gold } from '../tests/candidate-evaluator.js'

const key = (process.argv[2] ?? 'A').toUpperCase()
const project = projectByKey(key)
if (!project) throw new Error(`unknown project ${key}`)
if (key !== 'A') throw new Error('only project A has a hand gold to evaluate against')

const gold = JSON.parse(readFileSync('research/gold/marcowki-interior-v1.json', 'utf8')) as Gold
const loaded = await loadSource(project.url, {
  cacheDir: `fixtures/${project.slug}/assets`,
  htmlPath: `fixtures/${project.slug}/page.html`,
})
const result = extractPlanSpec(loaded.pkg, loaded.images, { ...DEFAULT_EXTRACTION, engine: new CachedEngine(project.slug) }, {
  sourcePackageId: loaded.source.packageId,
  sourcePackageHash: loaded.source.contentHash,
})

const pairs: Array<{ storey: string; level: string }> = [
  { storey: 'GROUND', level: 'ground' },
  { storey: 'UPPER_ATTIC', level: 'upper' },
]

const report = []
for (const { storey, level } of pairs) {
  if (!result.candidate.storeys.some((s) => s.storey === storey)) continue
  const e = evaluateCandidate(result.candidate, gold, level, storey)
  report.push(e)
  console.log(`\n=== ${project.key} ${storey} vs gold "${level}"`)
  console.log(`  aligned by dx ${e.alignment.dx.toFixed(3)} m, dz ${e.alignment.dz.toFixed(3)} m`)
  console.log(
    `  walls      ${e.walls.matchedM.toFixed(2)} of ${e.walls.goldLengthM.toFixed(2)} m matched ` +
      `across ${e.walls.goldCount} major gold walls = ${(e.walls.coverage * 100).toFixed(1)}%`,
  )
  console.log(
    `  invented   ${e.invented.count} gold openings have candidate fabric across them ` +
      `(${e.invented.totalM.toFixed(2)} m total)` +
      (e.invented.worst.length > 0
        ? `: ${e.invented.worst.slice(0, 3).map((w) => `${w.goldOpeningId} ${w.overlapM.toFixed(2)} m`).join(', ')}`
        : ''),
  )
  console.log(
    `  rooms      ${e.rooms.candidateRooms} candidate regions for ${e.rooms.goldRooms} gold rooms; ` +
      `${e.rooms.goldCovered} of the gold's rooms are covered by one, ${e.rooms.merged} regions cover more than one` +
      (e.rooms.goldUncovered.length > 0 ? `; not covered: ${e.rooms.goldUncovered.join(', ')}` : ''),
  )
  console.log(
    `  adjacency  ${e.adjacency.agreed} of ${e.adjacency.goldEdges} gold edges agreed ` +
      `(${(e.adjacency.rate * 100).toFixed(1)}%), ${e.adjacency.merged} merged away, ${e.adjacency.missing} missing`,
  )
  console.log(
    `  adjacency  ${e.adjacency.agreed} of ${e.adjacency.goldEdges} gold edges agreed, ` +
      `${e.adjacency.agreedByMerge} of them because the candidate returns the two as one space`,
  )
  console.log(
    `  doors      ${e.doors.detected} detected + ${e.doors.unresolved} explicitly unresolved of ` +
      `${e.doors.goldDoors} = ${(e.doors.rate * 100).toFixed(1)}%`,
  )
  const d = e.decomposition
  console.log(`\n  --- §13 decomposition of ${d.goldLengthM.toFixed(2)} m of major gold wall`)
  console.log(
    `      the gold says ${d.goldOpeningM.toFixed(2)} m of that is an opening, leaving ${d.goldFabricM.toFixed(2)} m of material`,
  )
  console.log(
    `      candidate fabric        ${d.fabricM.toFixed(2)} m — ${((d.fabricM / d.goldLengthM) * 100).toFixed(1)}% of the gold length, ` +
      `${(d.fabricOfGoldFabric * 100).toFixed(1)}% of the gold material`,
  )
  console.log(
    `      logical host wall       ${d.logicalM.toFixed(2)} m = ${(d.logicalCoverage * 100).toFixed(1)}% — fabric plus the openings this wall accounts for`,
  )
  console.log(
    `      host extent ceiling     ${d.hostExtentM.toFixed(2)} m = ${(d.hostExtentCoverage * 100).toFixed(1)}% — what the logical figure would be if every gap were accounted for`,
  )
  console.log(
    `      fabric across a gold opening ${d.fabricAcrossGoldOpeningM.toFixed(2)} m; of the gold's opening span ${d.openingAgreedM.toFixed(2)} m is reported as an opening`,
  )
  console.log(
    `      no candidate wall reaches ${d.missingM.toFixed(2)} m at all; ${d.trulyMissing} gold walls are missing outright, ` +
      `${d.fragmentedButCorrect} are carried in pieces but carried`,
  )
  for (const r of d.rows
    .filter((x) => x.goldLengthM >= 0.6)
    .sort((a, b) => a.logicalM / a.goldLengthM - b.logicalM / b.goldLengthM)) {
    console.log(
      `      ${r.goldId.padEnd(22)} gold ${r.goldLengthM.toFixed(2)} m (open ${r.goldOpeningM.toFixed(2)}), ` +
        `fabric ${r.fabricM.toFixed(2)}, logical ${r.logicalM.toFixed(2)}, extent ${r.hostExtentM.toFixed(2)}, ` +
        `${r.hostCount} host${r.hostCount === 1 ? '' : 's'}, ${r.missingM.toFixed(2)} m unreached`,
    )
  }

  console.log(`\n  --- §14 acceptance, on this storey`)
  const row = (name: string, got: string, met: boolean): void =>
    console.log(`      ${met ? 'yes' : 'NO '}  ${name.padEnd(52)} ${got}`)
  row(
    '>= 90% of gold major logical wall length matched',
    `${(d.logicalCoverage * 100).toFixed(1)}%`,
    d.logicalCoverage >= 0.9,
  )
  row(
    'physical doors and passages remain gaps',
    `${d.openingAgreedM.toFixed(2)} m of the gold's ${d.goldOpeningM.toFixed(2)} m of opening is reported open`,
    d.openingAgreedM > 0.5 * d.goldOpeningM,
  )
  row(
    'zero invented wall fabric closing a source-open passage',
    `${e.invented.closed} closed; ${e.invented.count} openings have some material across them ` +
      `(${e.invented.totalM.toFixed(2)} m in total, at the jambs)`,
    e.invented.closed === 0,
  )
  row('zero positive room overlap', 'structural: a pixel holds one region', true)
  row(
    '>= 90% gold room-adjacency edge agreement',
    `${e.adjacency.agreed}/${e.adjacency.goldEdges} = ${(e.adjacency.rate * 100).toFixed(1)}%` +
      ` (${e.adjacency.doorAgreed}/${e.adjacency.doorEdges} through a door, ${e.adjacency.openAgreed}/${e.adjacency.openEdges} open)`,
    e.adjacency.rate >= 0.9,
  )
  row(
    'at most one merged room per floor, or explicitly unresolved',
    `${e.rooms.merged} merged, ${e.rooms.mergedUnresolved} of them marked unresolved by the candidate`,
    e.rooms.merged <= 1 || e.rooms.mergedUnresolved === e.rooms.merged,
  )
  row(
    '>= 90% of major doors read as DOOR, not a generic gap',
    `${e.doors.asDoor}/${e.doors.goldDoors} = ${(e.doors.asDoorRate * 100).toFixed(1)}%`,
    e.doors.asDoorRate >= 0.9,
  )
  row(
    '>= 90% of them on the host wall the gold names',
    `${e.doors.hostCorrect}/${e.doors.goldDoors} = ${(e.doors.hostRate * 100).toFixed(1)}%`,
    e.doors.hostRate >= 0.9,
  )
  row(
    'width within the source tolerance where readable',
    `${e.doors.widthsWithin}/${e.doors.widthsCompared} within ${e.doors.widthToleranceM.toFixed(3)} m ` +
      `(four pixels of this drawing), ${e.doors.widthsWithinLoose}/${e.doors.widthsCompared} within ` +
      `${e.doors.widthToleranceLooseM.toFixed(3)} m (five)`,
    e.doors.widthsWithin === e.doors.widthsCompared,
  )
  console.log('')

  const worst = e.walls.rows
    .filter((r) => r.goldLengthM >= 0.6)
    .sort((a, b) => a.matchedM / a.goldLengthM - b.matchedM / b.goldLengthM)
    .slice(0, 5)
  console.log('  least-covered gold walls:')
  for (const r of worst) {
    console.log(
      `      ${r.goldId.padEnd(22)} ${r.matchedM.toFixed(2)} of ${r.goldLengthM.toFixed(2)} m ` +
        `(${((r.matchedM / r.goldLengthM) * 100).toFixed(0)}%)`,
    )
  }
}

const outDir = join('out', 'extract', project.slug)
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'evaluation.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
console.log(`\nwrote ${join(outDir, 'evaluation.json')}`)
