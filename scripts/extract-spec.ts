/**
 * STAGE WEB-PIVOT-06 — run the automatic floor-plan extraction over one
 * project and print what it found.
 *
 *   npm run extract:spec -- A            the primary development project
 *   npm run extract:spec -- B            the regression project
 *
 * The holdout runs through `npm run holdout:spec`, once, after the freeze, and
 * refuses to run before it.
 *
 * Nothing here reads a gold file. The extraction modules cannot: they live
 * under src/core/extract and src/node/ocr, and a test asserts that neither
 * imports anything under research/.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadSource } from '../src/node/source-loader.js'
import { projectByKey } from '../src/node/projects.js'
import { extractPlanSpec, DEFAULT_EXTRACTION } from '../src/node/extract-runner.js'

const key = (process.argv[2] ?? 'A').toUpperCase()
const project = projectByKey(key)
if (!project) throw new Error(`unknown project ${key}`)
if (project.role === 'HOLDOUT') {
  throw new Error('the holdout runs only through "npm run holdout:spec", after the freeze (§4, §23)')
}

const loaded = await loadSource(project.url, {
  cacheDir: `fixtures/${project.slug}/assets`,
  htmlPath: `fixtures/${project.slug}/page.html`,
})

const result = extractPlanSpec(loaded.pkg, loaded.images, DEFAULT_EXTRACTION)

console.log(`\n=== ${project.key}: ${project.name}`)
for (const note of result.notes) console.log(`  ${note}`)
for (const plan of result.plans) {
  console.log(`\n  --- ${plan.storey} ${plan.assetId} (${plan.reason})`)
  for (const note of plan.notes) console.log(`      ${note}`)
  const owned = plan.observations.filter((o) => o.owner.kind === 'INTERVAL')
  const callouts = plan.observations.filter((o) => o.owner.kind === 'CALLOUT')
  const orphans = plan.observations.filter((o) => o.owner.kind === 'NONE')
  console.log(`      on a chain:  ${owned.map((o) => o.text).join(' ') || '(none)'}`)
  console.log(`      in a ring:   ${callouts.map((o) => o.text).join(' ') || '(none)'}`)
  console.log(`      unowned:     ${orphans.map((o) => o.text).join(' ') || '(none)'}`)
}

const outDir = join('out', 'extract', project.slug)
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'observations.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8')
console.log(`\nwrote ${join(outDir, 'observations.json')}`)
