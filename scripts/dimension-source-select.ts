/**
 * STAGE WEB-PIVOT-04 §2 diagnostic — development only.
 *
 *   npx tsx scripts/dimension-source-select.ts [packageSlug]   (default A-marcowki)
 *
 * What the dimension reader used to be given, and what it is given now.
 *
 * Before STAGE WEB-PIVOT-04 the reader took whichever asset carried the legacy
 * `analyzerRole` PLAN_GROUND / PLAN_UPPER. ARCHON publishes each floor plan
 * twice — once dimensioned and once with area labels — and the legacy role
 * could not tell them apart, so the reader was routinely handed the copy with
 * no dimensions on it. `selectPlanAsset` chooses by the STAGE WEB-PIVOT-03 role
 * dimensions instead: FLOOR_PLAN, the right storey, DIMENSIONED preferred.
 *
 * This script prints both choices and then runs the *unchanged* OCR over each,
 * so the effect of the correction is a measurement rather than a claim. The OCR
 * itself is not touched by this stage.
 */
import { readPackage, readPackageAssets } from '../src/node/package-store.js'
import { assetFileNameFor, toParsedSource } from '../src/core/contracts/source-package.js'
import { selectPlanAsset, type PlanStorey } from '../src/core/dimensions/plan-select.js'
import { decodeImage } from '../src/node/image-decode.js'
import { toGray, saturationField } from '../src/core/raster/gray.js'
import { readDimensions } from '../src/core/scaffold/dimensions.js'
import { wallMask, planExtent, fitFootprint, buildPlanAnalysis } from '../src/core/scaffold/plan.js'
import { factValue, type SourceAsset } from '../src/core/contracts/source.js'

const slug = process.argv[2] ?? 'A-marcowki'
const pkg = await readPackage(slug)
const bytes = await readPackageAssets(slug)
const parsed = toParsedSource(pkg)

console.log(`package ${pkg.packageId}  contentHash ${pkg.contentHash}`)
console.log(`assets ${parsed.assets.length}, of which floor plans ${parsed.assets.filter((a) => a.roles?.document === "FLOOR_PLAN").length}\n`)

const describe = (a: SourceAsset | undefined): string =>
  a
    ? `${a.id}  ${a.width}x${a.height}  ${a.roles?.document ?? '?'}/${a.roles?.storey ?? '?'}/${a.roles?.annotation ?? '?'}  sha ${(a.sha256 ?? '').slice(0, 8)}`
    : '(none)'

const read = (label: string, a: SourceAsset | undefined, storey: PlanStorey): void => {
  if (!a) return
  const data = bytes.get(assetFileNameFor(a.sha256!, a.contentType!))
  if (!data) {
    console.log(`    ${label}: asset bytes not in the package store`)
    return
  }
  const img = decodeImage(data)
  // The pipeline's own calibration, derived exactly as `stages.ts` derives it.
  const extent = planExtent(wallMask(toGray(img), saturationField(img)))
  const fit = fitFootprint(extent, factValue(parsed, 'footprint_area'), null)
  const analysis = buildPlanAnalysis(a.id, storey === 'GROUND' ? 'GROUND' : 'UPPER', extent, fit)
  const ppm = analysis.calibration.pixelsPerMetre
  const r = readDimensions(toGray(img), {
    pixelsPerMetre: ppm,
    predictionTolerance: 0.08,
    chainTolerance: 0.12,
    minGlyphsPerLabel: 2,
  })
  const exact = r.dimensions.filter((d) => d.provenance === 'SOURCE_EXACT').length
  console.log(
    `    ${label}: calibration ${ppm.toFixed(2)} px/m, ` +
      `${r.dimensions.length} dimensions read, ${exact} corroborated against the geometry, ${r.chains.length} chains`,
  )
}

for (const [storey, legacyRole] of [
  ['GROUND', 'PLAN_GROUND'],
  ['UPPER_ATTIC', 'PLAN_UPPER'],
] as const) {
  const before = parsed.assets.find((a) => a.role === legacyRole)
  const after = selectPlanAsset(parsed.assets, storey)
  console.log(`${storey}`)
  console.log(`  before (legacy analyzerRole ${legacyRole}): ${describe(before)}`)
  console.log(`  after  (${after?.by ?? 'none'}): ${describe(after?.asset)}`)
  if (after) console.log(`         reason: ${after.reason}`)
  for (const rj of after?.rejected ?? []) console.log(`         rejected ${rj.assetId} (${rj.annotation}): ${rj.why}`)
  read('before', before, storey)
  read('after ', after?.asset, storey)
  console.log('')
}
