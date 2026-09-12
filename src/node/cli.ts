/**
 * Development CLI.
 *
 *   analyze  run the pipeline over one project and write the exports
 *   bench    run A and B and summarise
 *   freeze   write the freeze hashes that gate the holdout run (§43)
 *   holdout  run C, refusing unless a freeze exists and still matches
 *   fetch    populate a project's asset cache
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { analyze, DEFAULT_ANALYZE } from '../core/pipeline/analyze.js'
import { buildExports, serialiseBundle, bundleHash } from '../core/pipeline/exports.js'
import { freezeHashes } from '../core/config/weights.js'
import { canonicalJson } from '../core/util/hash.js'
import { loadSource } from './source-loader.js'
import { PROJECTS, projectByKey, type DevProject } from './projects.js'

const FREEZE_FILE = 'out/freeze.json'

async function runProject(project: DevProject, opts: { offline: boolean; outDir: string; repairCycles: number }) {
  const cacheDir = `fixtures/${project.slug}/assets`
  const htmlPath = `fixtures/${project.slug}/page.html`
  const loaded = await loadSource(project.url, { cacheDir, htmlPath: opts.offline ? htmlPath : undefined })
  const result = analyze(loaded.pkg, loaded.images, { ...DEFAULT_ANALYZE, maxRepairCycles: opts.repairCycles })
  const bundle = buildExports(result)
  const dir = join(opts.outDir, project.slug)
  await mkdir(dir, { recursive: true })
  for (const [name, text] of Object.entries(serialiseBundle(bundle))) {
    await writeFile(join(dir, name), text, 'utf8')
  }
  return { result, bundle, dir, hash: bundleHash(bundle) }
}

function printSummary(project: DevProject, r: Awaited<ReturnType<typeof runProject>>): void {
  const { result } = r
  console.log(`\n=== ${project.key}: ${project.name} (${project.role})`)
  console.log(`  assets ${result.pkg.assets.length}, analysed ${result.analysed.length}`)
  console.log(
    `  footprint ${result.scaffold.widthM.toFixed(2)} x ${result.scaffold.depthM.toFixed(2)} m, ` +
      `area ${result.scaffold.footprintAreaM2.toFixed(2)} m², ridge ${result.scaffold.ridgeY.toFixed(2)} m, ` +
      `eave ${result.scaffold.eaveY.toFixed(2)} m, pitch ${result.scaffold.roofPitchDeg}°`,
  )
  console.log(
    `  score ${result.baseScore.total.toFixed(4)} -> ${result.finalScore.total.toFixed(4)} ` +
      `(elevation ${result.finalScore.elevation.toFixed(3)}, perspective ${result.finalScore.perspective.toFixed(3)})`,
  )
  const violated = result.finalScore.constraintChecks.filter((c) => !c.satisfied)
  console.log(`  hard constraints: ${violated.length === 0 ? 'all satisfied' : violated.map((c) => c.key).join(', ') + ' VIOLATED'}`)
  for (const v of result.views) {
    console.log(
      `  camera ${v.role}: ${v.hypotheses[0]?.confidenceClass ?? 'none'}, ` +
        `${v.hypotheses[0]?.anchorMatches.length ?? 0} anchors, ambiguity ${v.ambiguity.ambiguous ? 'yes' : 'no'}`,
    )
  }
  console.log(`  repair: ${result.repairTrace.filter((t) => t.accepted).length} accepted / ${result.repairTrace.length} proposed`)
  console.log(`  ${result.performance.totalMs} ms, ${result.performance.cameraProjections} camera evaluations`)
  console.log(`  exports -> ${r.dir} (bundle ${r.hash.slice(0, 16)})`)
}

async function main(): Promise<void> {
  const [command = 'analyze', ...rest] = process.argv.slice(2)
  const flags = new Set(rest.filter((a) => a.startsWith('--')))
  const args = rest.filter((a) => !a.startsWith('--'))
  const offline = !flags.has('--online')
  const outDir = 'out'
  const repairCycles = flags.has('--no-repair') ? 0 : 3

  switch (command) {
    case 'fetch': {
      for (const key of args.length > 0 ? args : ['A', 'B', 'C']) {
        const p = projectByKey(key)
        if (!p) throw new Error(`unknown project ${key}`)
        const loaded = await loadSource(p.url, { cacheDir: `fixtures/${p.slug}/assets` })
        console.log(`${p.key}: ${loaded.pkg.assets.length} assets, ${loaded.failures.length} failures`)
      }
      return
    }
    case 'analyze': {
      const key = args[0] ?? 'A'
      const p = projectByKey(key)
      if (!p) throw new Error(`unknown project ${key}`)
      if (p.role === 'HOLDOUT') throw new Error('the holdout project runs only through the "holdout" command')
      printSummary(p, await runProject(p, { offline, outDir, repairCycles }))
      return
    }
    case 'bench': {
      const summaries: unknown[] = []
      for (const p of PROJECTS.filter((x) => x.role !== 'HOLDOUT')) {
        const r = await runProject(p, { offline, outDir, repairCycles })
        printSummary(p, r)
        summaries.push(r.bundle['benchmark-summary.json'])
      }
      await mkdir(outDir, { recursive: true })
      await writeFile(join(outDir, 'benchmark-summary.json'), `${canonicalJson({ projects: summaries })}\n`, 'utf8')
      console.log(`\nwrote ${join(outDir, 'benchmark-summary.json')}`)
      return
    }
    case 'freeze': {
      const hashes = freezeHashes()
      await mkdir(outDir, { recursive: true })
      const payload = { frozenAt: new Date().toISOString(), ...hashes }
      await writeFile(FREEZE_FILE, `${canonicalJson(payload)}\n`, 'utf8')
      console.log('freeze written:', JSON.stringify(hashes, null, 2))
      return
    }
    case 'holdout': {
      // §43: C runs only after the freeze, and only if nothing has moved since.
      let frozen: Record<string, string>
      try {
        frozen = JSON.parse(await readFile(FREEZE_FILE, 'utf8'))
      } catch {
        throw new Error(`no freeze found at ${FREEZE_FILE}; run "npm run freeze" before the holdout (§43)`)
      }
      const current = freezeHashes()
      const drifted = (Object.keys(current) as (keyof typeof current)[]).filter((k) => frozen[k] !== current[k])
      if (drifted.length > 0) {
        throw new Error(
          `refusing to run the holdout: ${drifted.join(', ')} changed since the freeze. ` +
            'Tuning after the freeze invalidates the holdout (§43).',
        )
      }
      const p = PROJECTS.find((x) => x.role === 'HOLDOUT')
      if (!p) throw new Error('no holdout project configured')
      printSummary(p, await runProject(p, { offline, outDir, repairCycles }))
      console.log('\nHoldout complete. Do not tune on these results (§43).')
      return
    }
    default:
      throw new Error(`unknown command ${command}`)
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exitCode = 1
})
