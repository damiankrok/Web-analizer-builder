/**
 * STAGE WEB-PIVOT-06 §6 — measure the built-in recogniser against a local OCR
 * engine on real plan digits.
 *
 *   npx tsx scripts/ocr-benchmark.ts [A|B] [--json out/ocr-benchmark.json]
 *
 * Both arms are given the *same* boxes, chosen by the existing dimension
 * geometry, so what is compared is the recogniser and not the detector. The
 * built-in arm additionally gets everything its design asks for — its own
 * whole-drawing alphabet harvest and a scale estimate — because the question
 * is whether it reads these drawings at its best, not whether it can be
 * starved.
 *
 * Truth is `research/eval/ocr-plan-digits-v1.json`: every printed dimension
 * token on project A's two dimensioned plans, read by eye at magnification.
 * Matching is by multiset of strings and not by position, which flatters both
 * arms equally and is stated in the report. Whether a number reached its right
 * physical owner is a different measurement, made later against the geometry
 * gold.
 *
 * Project B has no hand truth. It is scored the way the source itself allows:
 * a reading set is checked against the arithmetic the drawing prints, so a
 * chain that closes is evidence no transcription was involved.
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { loadSource } from '../src/node/source-loader.js'
import { toGray, saturationField } from '../src/core/raster/gray.js'
import { wallMask, planExtent, fitFootprint } from '../src/core/scaffold/plan.js'
import { detectDimensionGeometry } from '../src/core/dimensions/geometry.js'
import { readPrintedDimensions } from '../src/core/dimensions/reader.js'
import { selectPlanAsset, type PlanStorey } from '../src/core/dimensions/plan-select.js'
import { inkChannel } from '../src/core/extract/raster-normalize.js'
import { buildTextCrops, type TextCropRequest } from '../src/core/extract/text-crops.js'
import { detectTextRegions } from '../src/core/extract/text-regions.js'
import { DEFAULT_PLAN_TEXT } from '../src/core/extract/text-engine.js'
import { TesseractEngine } from '../src/node/ocr/tesseract.js'
import { projectByKey } from '../src/node/projects.js'

const key = (process.argv[2] ?? 'A').toUpperCase()
const jsonFlag = process.argv.indexOf('--json')
const jsonPath = jsonFlag >= 0 ? process.argv[jsonFlag + 1] : 'out/ocr-benchmark.json'
const project = projectByKey(key)
if (!project) throw new Error(`unknown project ${key}`)
if (project.role === 'HOLDOUT') throw new Error('the holdout is not a benchmark project (§4)')

type Truth = {
  plans: Array<{
    storey: PlanStorey
    assetId: string
    chainOverall: string[]
    chainSegments: string[]
    callouts: Array<{ width: string; height: string }>
  }>
}
const truthFile = 'research/eval/ocr-plan-digits-v1.json'
const truth: Truth | null = key === 'A' ? (JSON.parse(readFileSync(truthFile, 'utf8')) as Truth) : null

const tokensOf = (p: Truth['plans'][number]): string[] => [
  ...p.chainOverall,
  ...p.chainSegments,
  ...p.callouts.flatMap((c) => [c.width, c.height]),
]

/** Recall and precision over multisets: a matched truth token is consumed. */
function scoreMultiset(readings: readonly string[], want: readonly string[]) {
  const pool = new Map<string, number>()
  for (const t of want) pool.set(t, (pool.get(t) ?? 0) + 1)
  let matched = 0
  const spurious: string[] = []
  for (const r of readings) {
    const n = pool.get(r) ?? 0
    if (n > 0) {
      pool.set(r, n - 1)
      matched++
    } else spurious.push(r)
  }
  const missed: string[] = []
  for (const [t, n] of pool) for (let i = 0; i < n; i++) missed.push(t)
  return {
    truth: want.length,
    read: readings.length,
    matched,
    recall: want.length === 0 ? 0 : matched / want.length,
    precision: readings.length === 0 ? 0 : matched / readings.length,
    missed: missed.sort(),
    spurious: spurious.sort(),
  }
}

const availability = TesseractEngine.available()
console.log(`tesseract: ${availability.available ? availability.version : `UNAVAILABLE — ${availability.note}`}`)

const loaded = await loadSource(project.url, {
  cacheDir: `fixtures/${project.slug}/assets`,
  htmlPath: `fixtures/${project.slug}/page.html`,
})

/** Readings kept from an engine: at least two digits, and confident enough. */
const MIN_CONFIDENCE = 0.6
const MIN_DIGITS = 2

const report: Record<string, unknown>[] = []

for (const storey of ['GROUND', 'UPPER_ATTIC'] as const) {
  const sel = selectPlanAsset(loaded.pkg.assets, storey)
  if (!sel) continue
  const img = loaded.images.get(sel.asset.id)
  if (!img) continue

  // The built-in reader works on luminance, which is what it was built for.
  const luma = toGray(img)
  // Stage 06 reads ink as the darkest channel, so coloured annotations survive.
  const ink = inkChannel(img)

  const extent = planExtent(wallMask(luma, saturationField(img)))
  const publishedArea = loaded.pkg.facts.find((f) => f.key === 'footprint_area')?.value ?? null
  const fit = fitFootprint(extent, publishedArea, null)
  const ppm = fit.widthM > 0 ? extent.widthPx / fit.widthM : null

  // --- the boxes both arms are given
  const requests: TextCropRequest[] = []
  // A vertical run is offered in both reading directions; they are alternatives
  // for one label, so only the more confident of the pair may be kept.
  const regionOf = new Map<string, string>()
  if (process.env.OCR_DETECTOR === 'legacy') {
    const geo = detectDimensionGeometry(ink)
    for (const z of geo.zones) requests.push({ id: z.id, box: z.box, orientation: z.orientation })
    for (const c of geo.callouts) {
      requests.push({ id: `${c.id}:u`, box: c.upper, orientation: 'HORIZONTAL' })
      requests.push({ id: `${c.id}:l`, box: c.lower, orientation: 'HORIZONTAL' })
    }
  } else {
    for (const r of detectTextRegions(ink)) {
      requests.push({ id: r.id, box: r.box, orientation: r.orientation })
      regionOf.set(r.id, r.regionId)
    }
  }

  // --- arm 1: the built-in recogniser, at its best
  const t0 = Date.now()
  const builtIn = readPrintedDimensions(sel.asset.id, luma, { pixelsPerMetre: ppm })
  const builtInMs = Date.now() - t0
  const builtInTokens = builtIn.tokens.map((t) => t.text).filter((t) => t.length >= MIN_DIGITS)

  // --- arm 2: the local engine, on the geometry's own crops
  let localTokens: string[] = []
  let localMs = 0
  let localRaw = 0
  if (availability.available) {
    const crops = buildTextCrops(ink, requests)
    const engine = new TesseractEngine()
    const t1 = Date.now()
    const readings = engine.readBatch(crops, DEFAULT_PLAN_TEXT)
    localMs = Date.now() - t1
    localRaw = readings.length
    // One reading per *region*: the most confident. A region is one label, and
    // a vertical label's two reading directions compete for it rather than
    // both surviving as separate numbers.
    const best = new Map<string, { text: string; confidence: number }>()
    for (const r of readings) {
      const key = regionOf.get(r.cropId) ?? r.cropId
      const prev = best.get(key)
      if (!prev || r.confidence > prev.confidence) best.set(key, r)
    }
    localTokens = [...best.values()]
      .filter((r) => r.confidence >= MIN_CONFIDENCE && r.text.length >= MIN_DIGITS)
      .map((r) => r.text)
  }

  const want = truth ? tokensOf(truth.plans.find((p) => p.storey === storey)!) : null
  const row = {
    project: project.key,
    storey,
    assetId: sel.asset.id,
    zonesOffered: requests.length,
    builtIn: {
      engine: 'builtin-glyph-templates',
      ms: builtInMs,
      tokens: builtInTokens,
      unreadZones: builtIn.unreadZones,
      ...(want ? scoreMultiset(builtInTokens, want) : {}),
    },
    local: {
      engine: availability.available ? `tesseract ${availability.version}` : 'UNAVAILABLE',
      ms: localMs,
      rawReadings: localRaw,
      tokens: localTokens,
      ...(want ? scoreMultiset(localTokens, want) : {}),
    },
  }
  report.push(row)

  console.log(`\n=== ${project.key} ${storey} ${sel.asset.id} — ${requests.length} boxes offered to both arms`)
  const show = (name: string, arm: any): void => {
    const s = want ? `  ${arm.matched}/${arm.truth} truth matched, ${arm.read} read, recall ${(arm.recall * 100).toFixed(0)}% precision ${(arm.precision * 100).toFixed(0)}%` : `  ${arm.tokens.length} tokens`
    console.log(`  ${name.padEnd(12)} ${arm.ms} ms`)
    console.log(s)
    console.log(`    read:    ${arm.tokens.join(' ') || '(none)'}`)
    if (want) console.log(`    missed:  ${arm.missed.join(' ') || '(none)'}`)
    if (want && arm.spurious.length) console.log(`    wrong:   ${arm.spurious.join(' ')}`)
  }
  show('built-in', row.builtIn)
  show('tesseract', row.local)
}

// Closure arithmetic: what the drawing proves about a reading set on its own.
// This needs no hand transcription at all, which is why project B — which has
// none — is scored this way and only this way.
const closures = (JSON.parse(readFileSync(truthFile, 'utf8')) as any).closures.checks.filter(
  (c: any) => c.project === project.key,
)
const closureResults: unknown[] = []
if (closures.length > 0) {
  console.log('\n--- printed closures the readings must reproduce (§9)')
  for (const check of closures) {
    const row = report.find((r) => r.storey === check.plan) as any
    if (!row) continue
    for (const arm of ['builtIn', 'local'] as const) {
      const have = new Set<string>(row[arm].tokens)
      const ok = check.parts.every((p: string) => have.has(p)) && have.has(check.total)
      closureResults.push({ plan: check.plan, arm, parts: check.parts, total: check.total, reproduced: ok })
      console.log(
        `  ${check.plan} ${check.parts.join(' + ')} = ${check.total}: ${arm} ${ok ? 'reproduced' : 'not reproduced'}`,
      )
    }
  }
}

mkdirSync(dirname(jsonPath), { recursive: true })
writeFileSync(
  jsonPath,
  `${JSON.stringify({ project: project.key, availability, minConfidence: MIN_CONFIDENCE, minDigits: MIN_DIGITS, plans: report, closures: closureResults }, null, 2)}\n`,
  'utf8',
)
console.log(`\nwrote ${jsonPath}`)
