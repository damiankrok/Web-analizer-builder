/**
 * STAGE WEB-PIVOT-06A §17 — run the holdout, once, under the freeze.
 *
 *   npx tsx scripts/holdout-spec.ts
 *
 * It refuses if there is no freeze, if the commit has moved, or if any tunable
 * has changed since. Tuning after the freeze would make the holdout figure a
 * development result wearing a holdout's name.
 *
 * It also refuses to run twice: the result file is the record that it has been
 * used, and a holdout is spent the moment its geometry has been looked at.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadSource } from '../src/node/source-loader.js'
import { PROJECTS } from '../src/node/projects.js'
import { extractPlanSpec, DEFAULT_EXTRACTION } from '../src/node/extract-runner.js'
import { extractionConfig, canonicalise } from '../src/core/extract/config.js'

const FREEZE = 'out/freeze-web-pivot-06a.json'
if (!existsSync(FREEZE)) throw new Error(`no freeze at ${FREEZE}; run scripts/freeze-spec.ts first (§17)`)
const frozen = JSON.parse(readFileSync(FREEZE, 'utf8')) as { codeSha: string; configHash: string }

const configHash = createHash('sha256').update(canonicalise(extractionConfig())).digest('hex')
if (configHash !== frozen.configHash) {
  throw new Error(
    `refusing to run the holdout: the extraction configuration changed since the freeze ` +
      `(${frozen.configHash.slice(0, 12)} -> ${configHash.slice(0, 12)}). Tuning after the freeze ` +
      'invalidates the holdout (§17).',
  )
}
if (frozen.codeSha !== 'unknown') {
  try {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
    if (head !== frozen.codeSha) {
      throw new Error(
        `refusing to run the holdout: HEAD moved from ${frozen.codeSha.slice(0, 12)} to ${head.slice(0, 12)} ` +
          'since the freeze (§17).',
      )
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('refusing')) throw err
    // Unverifiable rather than moved; the configuration hash still stands.
  }
}

const project = PROJECTS.find((p) => p.role === 'HOLDOUT')
if (!project) throw new Error('no holdout project is registered')
const outDir = join('out', 'extract', project.slug)
const resultFile = join(outDir, 'holdout-run.json')
if (existsSync(resultFile) && !process.argv.includes('--i-know-it-is-spent')) {
  throw new Error(
    `${resultFile} already exists: this holdout has been run. A holdout is spent once its geometry has ` +
      'been looked at, and running it again does not make it a holdout again (§17).',
  )
}

console.log(`holdout ${project.key}: ${project.name}`)
console.log(`  ${project.url}`)
console.log(`  frozen at ${frozen.codeSha.slice(0, 12)}, config ${frozen.configHash.slice(0, 12)}`)

const loaded = await loadSource(project.url, {
  cacheDir: `fixtures/${project.slug}/assets`,
  htmlPath: `fixtures/${project.slug}/page.html`,
})
const t0 = Date.now()
const result = extractPlanSpec(loaded.pkg, loaded.images, DEFAULT_EXTRACTION, {
  sourcePackageId: loaded.source.packageId,
  sourcePackageHash: loaded.source.contentHash,
})
const ms = Date.now() - t0

const c = result.candidate
console.log(`\n  package ${c.sourcePackageId} ${c.sourcePackageHash.slice(0, 16)}`)
console.log(`  engine ${c.engine.id} ${c.engine.version}`)
console.log(`  frame ${c.frame ? `${c.frame.pxPerCm.toFixed(5)} px/cm` : 'not established'}`)
for (const note of result.notes) console.log(`  ${note}`)
for (const s of c.storeys) {
  const solid = s.walls.reduce((n, w) => n + w.solidM, 0)
  const all = s.walls.flatMap((w) => w.openings)
  const byClass = (k: string): number => all.filter((o) => o.class === k).length
  console.log(
    `  ${s.storey.padEnd(12)} scale ${s.pxPerCm?.toFixed(5) ?? 'none'}, ${s.walls.length} walls ` +
      `(${solid.toFixed(1)} m of fabric, ${all.length} openings), ${s.rooms.length} rooms, ` +
      `${s.adjacency.length} adjacencies, ${s.dimensions.length} owned dimensions, ` +
      `${s.unownedReadings.length} unowned readings`,
  )
  console.log(
    `               openings: ${byClass('DOOR')} door, ${byClass('OPEN_PASSAGE')} open passage, ` +
      `${byClass('EXTERIOR_OPENING')} onto the outside, ${byClass('UNKNOWN_GAP')} unexplained`,
  )
  console.log(
    `               ${s.adjacency.filter((a) => a.doorways.length > 0).length} adjacencies through a doorway; ` +
      `${s.rooms.filter((r) => r.segmentation === 'UNRESOLVED').length} regions carry more than one room label`,
  )
}
for (const plan of result.plans) {
  const t = plan.timings
  console.log(
    `  ${plan.storey.padEnd(12)} ${plan.doors.doors.length} door symbols read; timings walls ${t.wallsMs} ms, ` +
      `doors ${t.doorsMs} ms, labels ${t.labelsMs} ms, topology ${t.topologyMs} ms`,
  )
}
for (const conflict of c.conflicts) console.log(`  conflict ${conflict.kind} (${conflict.confidence.toFixed(2)})`)
console.log(`  ${ms} ms`)

mkdirSync(outDir, { recursive: true })
writeFileSync(
  resultFile,
  `${JSON.stringify({ freeze: frozen, ranAt: new Date().toISOString(), ms, candidate: c }, null, 2)}\n`,
  'utf8',
)
console.log(`\nwrote ${resultFile}`)
console.log('Do not tune on this result (§17).')
