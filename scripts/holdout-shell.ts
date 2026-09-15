/**
 * STAGE WEB-PIVOT-07 §33 — run the holdout, once, under the freeze.
 *
 *   npm run shell:holdout
 *
 * It refuses if there is no freeze, if the commit has moved, or if any tunable
 * has changed since. It also refuses to run twice: the result file is the
 * record that the holdout has been used, and a holdout is spent the moment its
 * geometry has been looked at.
 *
 * §33 says report self-consistency only. There is nothing to compare G to and
 * this prints no accuracy figure, because there is no accuracy figure to print.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadSource } from '../src/node/source-loader.js'
import { PROJECTS } from '../src/node/projects.js'
import { extractPlanSpec, DEFAULT_EXTRACTION } from '../src/node/extract-runner.js'
import { extractShell, DEFAULT_SHELL, DEFAULT_SHELL_RUNNER } from '../src/node/shell-runner.js'
import { extractionConfig, canonicalise } from '../src/core/extract/config.js'
import { shellConfig } from '../src/core/extract/shell-config.js'

const FREEZE = 'out/freeze-web-pivot-07.json'
if (!existsSync(FREEZE)) throw new Error(`no freeze at ${FREEZE}; run scripts/freeze-shell.ts first (§33)`)
const frozen = JSON.parse(readFileSync(FREEZE, 'utf8')) as {
  codeSha: string
  planConfigHash: string
  shellConfigHash: string
}
const hash = (v: unknown): string => createHash('sha256').update(canonicalise(v)).digest('hex')
const planNow = hash(extractionConfig())
const shellNow = hash({ ...shellConfig(), runner: DEFAULT_SHELL_RUNNER })
if (planNow !== frozen.planConfigHash) {
  throw new Error(
    `refusing to run the holdout: the floor-plan configuration changed since the freeze ` +
      `(${frozen.planConfigHash.slice(0, 12)} -> ${planNow.slice(0, 12)}). Stage 07 consumes the plan candidate, so ` +
      'that is a change to what the holdout would measure (§33).',
  )
}
if (shellNow !== frozen.shellConfigHash) {
  throw new Error(
    `refusing to run the holdout: the shell configuration changed since the freeze ` +
      `(${frozen.shellConfigHash.slice(0, 12)} -> ${shellNow.slice(0, 12)}). Tuning after the freeze invalidates it (§33).`,
  )
}
if (frozen.codeSha !== 'unknown') {
  try {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
    if (head !== frozen.codeSha) {
      throw new Error(
        `refusing to run the holdout: HEAD moved from ${frozen.codeSha.slice(0, 12)} to ${head.slice(0, 12)} since the freeze (§33).`,
      )
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('refusing')) throw err
    // Unverifiable rather than moved; the configuration hashes still stand.
  }
}

const project = PROJECTS.find((p) => p.role === 'HOLDOUT')
if (!project) throw new Error('no holdout project is registered')
const outDir = join('out', 'shell', project.slug)
const resultFile = join(outDir, 'holdout-run.json')
if (existsSync(resultFile) && !process.argv.includes('--i-know-it-is-spent')) {
  throw new Error(
    `${resultFile} already exists: this holdout has been run. A holdout is spent once its geometry has been looked at, ` +
      'and running it again does not make it a holdout again (§33).',
  )
}

console.log(`holdout ${project.key}: ${project.name}`)
console.log(`  ${project.url}`)
console.log(`  frozen at ${frozen.codeSha.slice(0, 12)}, plan ${frozen.planConfigHash.slice(0, 12)}, shell ${frozen.shellConfigHash.slice(0, 12)}`)

const loaded = await loadSource(project.url, {
  cacheDir: `fixtures/${project.slug}/assets`,
  htmlPath: `fixtures/${project.slug}/page.html`,
})
const t0 = Date.now()
const plan = extractPlanSpec(loaded.pkg, loaded.images, DEFAULT_EXTRACTION, {
  sourcePackageId: loaded.source.packageId,
  sourcePackageHash: loaded.source.contentHash,
})
const result = extractShell(loaded.pkg, loaded.images, plan.candidate, DEFAULT_SHELL)
const ms = Date.now() - t0
const s = result.shell

console.log(`\n  package ${plan.candidate.sourcePackageId} ${plan.candidate.sourcePackageHash.slice(0, 16)}`)
console.log(`  section ${s.section.assetId ?? 'none'}`)
console.log(`  elevations selected: ${s.elevations.map((e) => `${e.declaredView}(${e.assetId.slice(-6)})`).join(' ') || 'none'}`)
console.log(`  vertical datum markers ${s.verticalDatums.length}; accepted ${s.verticalDatums.filter((d) => d.status === 'ACCEPTED').length}, reconciled ${s.verticalDatums.filter((d) => d.status === 'RECONCILED').length}, rejected ${s.verticalDatums.filter((d) => d.status === 'REJECTED').length}, unread ${s.verticalDatums.filter((d) => d.status === 'UNREAD').length}`)
console.log(`  resolved vertical scale ${s.section.pixelsPerMetre?.toFixed(3) ?? 'none'} px/m, rms ${s.section.rmsResidualM === null ? 'n/a' : `${(s.section.rmsResidualM * 1000).toFixed(1)} mm`}, pairwise spread ${s.section.pairSpread === null ? 'n/a' : `${(s.section.pairSpread * 100).toFixed(2)}%`}`)
console.log(`  levels: ${s.levels.map((l) => `${l.role}=${l.level.valueM.toFixed(2)}`).join(' ') || 'none'}`)
console.log(`  roof topology candidate ${s.roofTopology} (${s.roofComponents.map((c) => c.topology).join('+') || 'none'}); pitch ${Number.isFinite(s.pitch.pitchDeg) ? `${s.pitch.pitchDeg.toFixed(2)}° ${s.pitch.fidelity} ${s.pitch.status}` : 'unresolved'}`)
const byView = new Map<string, number>()
for (const o of s.facadeOpenings) byView.set(o.view, (byView.get(o.view) ?? 0) + 1)
console.log(`  opening counts by facade: ${[...byView].map(([v, n]) => `${v}=${n}`).join(' ') || 'none'}; ${s.facadeOpenings.filter((o) => o.matchStatus === 'MATCHED').length} matched to a plan gap`)
console.log(`  roof openings ${s.roofOpenings.length}, stacks ${s.chimneys.length}, facade features ${s.facadeFeatures.length}`)
const kinds = new Map<string, number>()
for (const c of s.crossSourceConflicts) kinds.set(c.kind, (kinds.get(c.kind) ?? 0) + 1)
console.log(`  cross-source conflicts ${s.crossSourceConflicts.length}: ${[...kinds].map(([k, n]) => `${k}=${n}`).join(' ') || 'none'}`)
console.log(`  unresolved ${s.unresolved.length}`)
// §33: catastrophic means the pipeline produced something that cannot be true
// of any building, rather than something that disagrees with a gold there is
// none of.
const contradictions = s.crossSourceConflicts.filter((c) => c.kind === 'LEVEL_ORDER_CONTRADICTION').length
const catastrophic =
  s.section.pixelsPerMetre === null ||
  contradictions > 0 ||
  s.levels.length === 0 ||
  (s.section.pairSpread !== null && s.section.pairSpread > 0.1)
console.log(`  verdict: ${catastrophic ? 'CATASTROPHIC' : 'NON-CATASTROPHIC'} (self-consistency only; there is nothing to be accurate against)`)
console.log(`  ${ms} ms`)

mkdirSync(outDir, { recursive: true })
writeFileSync(
  resultFile,
  `${JSON.stringify({ freeze: frozen, ranAt: new Date().toISOString(), ms, catastrophic, shell: s, timings: result.timings }, null, 2)}\n`,
  'utf8',
)
console.log(`\nwrote ${resultFile}`)
console.log('Do not tune on this result, and do not run it again (§33).')
