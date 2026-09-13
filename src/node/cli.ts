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
import { buildExports, serialiseBundle, bundleHash, type SourceProvenance } from '../core/pipeline/exports.js'
import { freezeHashes } from '../core/config/weights.js'
import { canonicalJson } from '../core/util/hash.js'
import { toParsedSource, type SourcePackage } from '../core/contracts/source-package.js'
import { buildSourcePackage } from './source-package.js'
import { decodeImage } from './image-decode.js'
import { packageDir, readPackage, readPackageAssets, assetFileName, writePackage, packageExists } from './package-store.js'
import { PROJECTS, projectByKey, type DevProject } from './projects.js'
import type { RasterImage } from '../core/contracts/raster.js'

const FREEZE_FILE = 'out/freeze.json'

const cacheDirFor = (p: DevProject): string => `fixtures/${p.slug}/assets`
const htmlPathFor = (p: DevProject): string => `fixtures/${p.slug}/page.html`

const provenanceOf = (pkg: SourcePackage): SourceProvenance => ({
  sourcePackageId: pkg.packageId,
  sourcePackageSchemaVersion: pkg.schemaVersion,
  sourcePackageHash: pkg.contentHash,
  sourceOrigin: pkg.origin,
})

/**
 * Obtain the project's source package, and say where it came from.
 *
 * A manifest written by `source:package` is preferred and used verbatim: that
 * is what makes "the CLI and the web build analysed the same package" a claim
 * about one file rather than about two code paths that ought to agree. Without
 * one the package is built here, through the same builder, and the caller is
 * told so.
 */
async function obtainPackage(
  project: DevProject,
  opts: { offline: boolean },
): Promise<{ pkg: SourcePackage; images: Map<string, RasterImage>; from: 'MANIFEST' | 'BUILDER' }> {
  if (await packageExists(project.slug)) {
    const pkg = await readPackage(project.slug)
    const bytes = await readPackageAssets(project.slug)
    const images = new Map<string, RasterImage>()
    for (const a of pkg.assets) {
      if (!a.analysable || !a.contentHash) continue
      const data = bytes.get(assetFileName(a.contentHash, a.mediaType))
      if (!data) continue
      try {
        images.set(a.assetId, decodeImage(data))
      } catch {
        // Recorded in the package already; the analyzer reports what it has.
      }
    }
    return { pkg, images, from: 'MANIFEST' }
  }
  const built = await buildSourcePackage(project.url, {
    cacheDir: cacheDirFor(project),
    htmlPath: htmlPathFor(project),
    offline: opts.offline,
  })
  return { ...built, from: 'BUILDER' }
}

async function runProject(project: DevProject, opts: { offline: boolean; outDir: string; repairCycles: number }) {
  const { pkg, images, from } = await obtainPackage(project, opts)
  const result = analyze(toParsedSource(pkg), images, { ...DEFAULT_ANALYZE, maxRepairCycles: opts.repairCycles })
  const bundle = buildExports(result, provenanceOf(pkg))
  const dir = join(opts.outDir, project.slug)
  await mkdir(dir, { recursive: true })
  for (const [name, text] of Object.entries(serialiseBundle(bundle))) {
    await writeFile(join(dir, name), text, 'utf8')
  }
  return { result, bundle, dir, hash: bundleHash(bundle), pkg, from }
}

/** The concise audit §12 of the stage brief asks the package command to print. */
function printPackage(
  project: DevProject,
  pkg: SourcePackage,
  written: { dir: string; assetFiles: number; bytes: number },
): void {
  const analysable = pkg.assets.filter((a) => a.analysable)
  console.log(`\n=== ${project.key}: ${project.name}`)
  console.log(`  package    ${pkg.packageId}  schema ${pkg.schemaVersion}  origin ${pkg.origin}`)
  console.log(`  hash       ${pkg.contentHash}`)
  console.log(`  page       ${pkg.document.byteLength} B, sha ${pkg.document.contentHash.slice(0, 16)}`)
  const channels = new Map<string, number>()
  for (const d of pkg.discovery) channels.set(d.channel, (channels.get(d.channel) ?? 0) + 1)
  console.log(`  discovery  ${pkg.discovery.length} records: ${[...channels].sort().map(([c, n]) => `${c}=${n}`).join(' ')}`)
  console.log(`  assets     ${pkg.assets.length} (${analysable.length} analysed, ${pkg.assets.length - analysable.length} kept as evidence)`)
  const variants = pkg.assets.reduce((n, a) => n + a.variants.length, 0)
  const relations = pkg.assets.reduce((n, a) => n + a.relations.length, 0)
  console.log(`  variants   ${variants} published copies, ${relations} relations between assets`)
  if (pkg.missing.length > 0) {
    console.log(`  missing    ${pkg.missing.length}:`)
    for (const m of pkg.missing) console.log(`               ${m.error.code.padEnd(22)} ${m.what}`)
  } else {
    console.log('  missing    none')
  }
  console.log(`  written    ${written.dir} (${written.assetFiles} asset files, ${(written.bytes / 1e6).toFixed(2)} MB)`)
  console.log('\n  logical source                                selected              decoded    hash      alts')
  for (const a of [...pkg.assets].sort((x, y) => (x.roles.document + x.roles.storey + x.label < y.roles.document + y.roles.storey + y.label ? -1 : 1))) {
    const role = `${a.roles.document}/${a.roles.storey}/${a.roles.annotation}/${a.roles.view}`
    const file = a.selectedUrl.slice(a.selectedUrl.lastIndexOf('/') + 1)
    console.log(
      `  ${a.analysable ? '*' : ' '} ${role.padEnd(44)} ${file.slice(-22).padEnd(23)}` +
        `${String(a.width).padStart(5)}x${String(a.height).padEnd(6)} ${a.contentHash.slice(0, 8)}  ${a.variants.length - 1}`,
    )
  }
  console.log('  (* analysed; the rest are registered as evidence)')
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
  console.log(
    `  source package ${r.pkg.packageId} (${r.pkg.contentHash.slice(0, 16)}), ` +
      `${r.pkg.assets.filter((a) => a.analysable).length}/${r.pkg.assets.length} assets analysed, ` +
      `origin ${r.pkg.origin}, from ${r.from === 'MANIFEST' ? 'out/source-packages' : 'the builder (no manifest on disk)'}`,
  )
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
    case 'fetch':
    case 'source:package':
    case 'package': {
      for (const key of args.length > 0 ? args : ['A', 'B']) {
        const p = projectByKey(key)
        if (!p) throw new Error(`unknown project ${key}`)
        const { pkg } = await buildSourcePackage(p.url, {
          cacheDir: cacheDirFor(p),
          htmlPath: flags.has('--online') ? undefined : htmlPathFor(p),
          offline: !flags.has('--online'),
        })
        const written = await writePackage(p.slug, pkg, cacheDirFor(p))
        printPackage(p, pkg, written)
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
      // The code SHA is part of the freeze (§29): the configuration hashes pin
      // the tunable numbers, and the commit pins the logic that reads them.
      let codeSha = 'unknown'
      try {
        const { execFileSync } = await import('node:child_process')
        codeSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
      } catch {
        // A source tree without git still freezes; the report says so.
      }
      const payload = { frozenAt: new Date().toISOString(), codeSha, ...hashes }
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
      if (frozen.codeSha && frozen.codeSha !== 'unknown') {
        try {
          const { execFileSync } = await import('node:child_process')
          const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
          if (head !== frozen.codeSha) drifted.push('codeSha' as keyof typeof current)
        } catch {
          // Unverifiable rather than drifted; the configuration hashes stand.
        }
      }
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
