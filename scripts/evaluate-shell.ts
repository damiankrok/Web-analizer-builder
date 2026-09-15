/**
 * STAGE WEB-PIVOT-07 §28, §30 — measure A's shell candidate against the gold.
 *
 *   npm run shell:evaluate
 *
 * Reads the candidate `npm run shell:spec -- A` wrote. The evaluator is the
 * only thing in this repository that opens a gold file.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { evaluateShell, type FieldResult } from '../tests/shell-oracles.js'
import type { ArchitecturalSpecCandidate } from '../src/core/extract/spec-candidate.js'

const path = process.argv[2] ?? 'out/shell/A-marcowki/spec-candidate.json'
const candidate = JSON.parse(readFileSync(path, 'utf8')) as ArchitecturalSpecCandidate
const result = evaluateShell(candidate)

const table = (name: string, rows: FieldResult[]): void => {
  console.log(`\n### ${name}`)
  console.log(`  ${'field'.padEnd(34)} ${'gold'.padStart(10)} ${'automatic'.padStart(10)}  ${'tol'.padStart(6)}  status`)
  for (const r of rows) {
    console.log(
      `  ${r.field.padEnd(34)} ${r.expected.padStart(10)} ${r.got.padStart(10)}  ` +
        `${(r.toleranceM === null ? '—' : `${(r.toleranceM * 1000).toFixed(0)}mm`).padStart(6)}  ${r.status}`,
    )
    console.log(`      ${r.note}`)
  }
}
table('vertical (§28)', result.vertical)
table('roof (§28)', result.roof)
table('facade (§28)', result.facade)
table('characteristic A features (§25)', result.characteristic)
table('roof features (§28)', result.roofFeatures)

console.log('\n### §30 pass targets')
for (const t of result.passTargets) {
  console.log(`  [${t.met ? 'MET' : '   '}] ${t.target}`)
  console.log(`         required ${t.required}`)
  console.log(`         measured ${t.measured}`)
}
const met = result.passTargets.filter((t) => t.met).length
console.log(`\n  ${met} of ${result.passTargets.length} pass targets met`)
console.log(`  fields: ${result.summary.matched} match, ${result.summary.missed} miss, ${result.summary.absent} absent, ${result.summary.conflicted} conflicted`)
console.log(`\n  ${met === result.passTargets.length ? 'PASS_STAGE_WEB_PIVOT_07_AUTOMATIC_SECTION_ELEVATION_SPEC' : 'PARTIAL_STAGE_WEB_PIVOT_07_AUTOMATIC_SECTION_ELEVATION_SPEC'}`)

mkdirSync('out/shell', { recursive: true })
writeFileSync('out/shell/evaluation.json', `${JSON.stringify(result, null, 2)}\n`, 'utf8')
console.log('\nwrote out/shell/evaluation.json')
