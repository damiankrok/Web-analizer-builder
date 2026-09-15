/**
 * STAGE WEB-PIVOT-07 — run the automatic section/elevation extraction over one
 * project and print what it found.
 *
 *   npm run shell:spec -- A            the primary development project
 *   npm run shell:spec -- B            the regression project
 *
 * The holdout runs through `npm run shell:holdout`, once, after the freeze.
 *
 * Nothing here reads a gold file, and nothing it calls can: `tests/leakage`
 * asserts that no module under src/core/extract or src/node imports anything
 * under research/.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadSource } from '../src/node/source-loader.js'
import { projectByKey } from '../src/node/projects.js'
import { extractPlanSpec, DEFAULT_EXTRACTION } from '../src/node/extract-runner.js'
import { extractShell, DEFAULT_SHELL } from '../src/node/shell-runner.js'

const key = (process.argv[2] ?? 'A').toUpperCase()
const project = projectByKey(key)
if (!project) throw new Error(`unknown project ${key}`)
if (project.role === 'HOLDOUT') throw new Error('the holdout runs only through "npm run shell:holdout", after the freeze (§5, §33)')

const loaded = await loadSource(project.url, {
  cacheDir: `fixtures/${project.slug}/assets`,
  htmlPath: `fixtures/${project.slug}/page.html`,
})
const plan = extractPlanSpec(loaded.pkg, loaded.images, DEFAULT_EXTRACTION, {
  sourcePackageId: loaded.source.packageId,
  sourcePackageHash: loaded.source.contentHash,
})
const result = extractShell(loaded.pkg, loaded.images, plan.candidate, DEFAULT_SHELL)
const candidate = { ...plan.candidate, schemaVersion: 'architectural-spec-candidate-1.1.0' as const, shell: result.shell }

const s = result.shell
console.log(`\n=== ${project.key}: ${project.name}`)
console.log(`  section ${s.section.assetId}: ${s.section.why}`)
console.log(`  ${s.verticalDatums.length} datum markers, ${s.verticalDatums.filter((d) => d.status === 'ACCEPTED').length} accepted, ${s.verticalDatums.filter((d) => d.status === 'RECONCILED').length} reconciled`)
for (const l of s.levels) console.log(`    ${l.role.padEnd(13)} ${l.level.valueM.toFixed(3).padStart(8)} m  ${l.level.fidelity.padEnd(18)} +-${(l.tolerance.toleranceM * 1000).toFixed(0)} mm`)
console.log(`  roof ${s.roofTopology}: ${s.roofComponents.map((c) => `${c.id}=${c.topology}`).join(' ')}`)
console.log(`  pitch ${Number.isFinite(s.pitch.pitchDeg) ? s.pitch.pitchDeg.toFixed(2) : 'none'}° ${s.pitch.fidelity} ${s.pitch.status} — ${s.pitch.why}`)
for (const p of s.roofPlanes) console.log(`    ${p.id} ${p.fallsTowards} high ${p.ridgeLevel.valueM.toFixed(3)} low ${p.eaveLevel.valueM.toFixed(3)} thickness ${p.thickness ? p.thickness.valueM.toFixed(3) : 'unmeasured'}`)
for (const e of s.elevations) {
  console.log(
    `  ${e.declaredView.padEnd(6)} ${e.pixelsPerMetreY.toFixed(2)} px/m, top ${e.silhouette.roofTopFrom}, shape ${e.silhouette.shape.kind}` +
      `${e.footprintCheck ? `, measures ${e.footprintCheck.measuredM.toFixed(2)} m against the plans' ${e.footprintCheck.planM.toFixed(2)} m` : ''}` +
      `, ${e.horizontalMethod}`,
  )
}
const byView = new Map<string, number>()
for (const o of s.facadeOpenings) byView.set(o.view, (byView.get(o.view) ?? 0) + 1)
console.log(`  ${s.facadeOpenings.length} facade openings (${[...byView].map(([v, n]) => `${v}=${n}`).join(' ')}), ${s.facadeOpenings.filter((o) => o.matchStatus === 'MATCHED').length} matched to a plan gap`)
console.log(`  ${s.roofOpenings.length} roof openings, ${s.chimneys.length} stacks, ${s.facadeFeatures.length} facade features`)
const kinds = new Map<string, number>()
for (const c of s.crossSourceConflicts) kinds.set(c.kind, (kinds.get(c.kind) ?? 0) + 1)
console.log(`  ${s.crossSourceConflicts.length} cross-source conflicts: ${[...kinds].map(([k, n]) => `${k}=${n}`).join(' ')}`)
console.log(`  ${s.unresolved.length} unresolved`)
console.log(`  timings ${JSON.stringify(result.timings)}`)

const outDir = join('out', 'shell', project.slug)
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'spec-candidate.json'), `${JSON.stringify(candidate, null, 2)}\n`, 'utf8')
writeFileSync(join(outDir, 'timings.json'), `${JSON.stringify(result.timings, null, 2)}\n`, 'utf8')
console.log(`\nwrote ${join(outDir, 'spec-candidate.json')}`)
