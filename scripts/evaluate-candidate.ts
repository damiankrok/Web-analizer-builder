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
const result = extractPlanSpec(loaded.pkg, loaded.images, DEFAULT_EXTRACTION, {
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
      `${e.rooms.mapped} placed inside one, ${e.rooms.merged} covering more than one`,
  )
  console.log(
    `  adjacency  ${e.adjacency.agreed} of ${e.adjacency.goldEdges} gold edges agreed ` +
      `(${(e.adjacency.rate * 100).toFixed(1)}%), ${e.adjacency.merged} merged away, ${e.adjacency.missing} missing`,
  )
  console.log(
    `  doors      ${e.doors.detected} detected + ${e.doors.unresolved} explicitly unresolved of ` +
      `${e.doors.goldDoors} = ${(e.doors.rate * 100).toFixed(1)}%`,
  )
  const worst = e.walls.rows
    .filter((r) => r.goldLengthM >= 0.6)
    .sort((a, b) => a.matchedM / a.goldLengthM - b.matchedM / b.goldLengthM)
    .slice(0, 5)
  console.log('  least-covered gold walls:')
  for (const r of worst) {
    console.log(
      `    ${r.goldId.padEnd(22)} ${r.matchedM.toFixed(2)} of ${r.goldLengthM.toFixed(2)} m ` +
        `(${((r.matchedM / r.goldLengthM) * 100).toFixed(0)}%)`,
    )
  }
}

const outDir = join('out', 'extract', project.slug)
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'evaluation.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
console.log(`\nwrote ${join(outDir, 'evaluation.json')}`)
