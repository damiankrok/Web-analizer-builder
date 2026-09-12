/** Read a project's printed dimensions: section first, then the plans. */
import { loadSource } from '../src/node/source-loader.js'
import { toGray, saturationField } from '../src/core/raster/gray.js'
import { prepareAsset } from '../src/core/raster/pipeline.js'
import { analyseSectionGeometry } from '../src/core/scaffold/section.js'
import { wallMask, planExtent, fitFootprint } from '../src/core/scaffold/plan.js'
import { readProjectDimensions, type AssetDimensionInput } from '../src/core/dimensions/project.js'
import { projectByKey } from '../src/node/projects.js'

const project = projectByKey(process.argv[2] ?? 'A')!
const loaded = await loadSource(project.url, {
  cacheDir: `fixtures/${project.slug}/assets`,
  htmlPath: `fixtures/${project.slug}/page.html`,
})
const height = loaded.pkg.facts.find((f) => f.key === 'building_height')?.value ?? null
const area = loaded.pkg.facts.find((f) => f.key === 'footprint_area')?.value ?? null

const inputs: AssetDimensionInput[] = []
let section: Parameters<typeof readProjectDimensions>[1] = null
for (const asset of loaded.pkg.assets) {
  if (!/^(PLAN|SECTION|ELEVATION)/.test(asset.role)) continue
  const img = loaded.images.get(asset.id)
  if (!img) continue
  const gray = toGray(img)
  let ppm: number | null = null
  let tol = 0.05
  if (asset.role === 'SECTION' && height) {
    const raster = prepareAsset(img, { lineDrawing: true, maxEdge: Math.max(img.width, img.height) })
    const geom = analyseSectionGeometry(raster.segments, gray.width, gray.height, height)
    ppm = geom.pixelsPerMetre
    tol = 0.004
    const input: AssetDimensionInput = { assetId: asset.id, role: asset.role, gray, pixelsPerMetre: ppm, scaleTolerance: tol }
    inputs.push(input)
    if (geom.groundFloorRow !== null && ppm) {
      section = {
        input,
        datumRow: geom.groundFloorRow,
        lineRows: [
          ...geom.levels.map((l) => l.position),
          ...(geom.terrainRow !== null ? [geom.terrainRow] : []),
          ...(geom.groundFloorRow !== null ? [geom.groundFloorRow] : []),
          ...(geom.apex ? [geom.apex.v] : []),
        ].sort((a, b) => a - b),
      }
      console.log(`section ${gray.width}x${gray.height} ppm=${ppm.toFixed(2)} datum=${geom.groundFloorRow.toFixed(1)} rows=${section.lineRows.length}`)
    }
    continue
  }
  if (asset.role.startsWith('PLAN')) {
    const extent = planExtent(wallMask(gray, saturationField(img)))
    const fit = fitFootprint(extent, area, null)
    if (fit.widthM > 0) ppm = extent.widthPx / fit.widthM
    tol = 0.08
  }
  inputs.push({ assetId: asset.id, role: asset.role, gray, pixelsPerMetre: ppm, scaleTolerance: tol })
}

const r = readProjectDimensions(inputs, section, loaded.pkg.rooms)
console.log()
for (const n of r.notes) console.log('  ' + n)
console.log(`\nreadings (${r.readings.length}):`)
const roleOf = new Map(loaded.pkg.assets.map((a) => [a.id, a.role]))
for (const x of r.readings) {
  console.log(
    `  ${(roleOf.get(x.assetId) ?? '?').padEnd(15)} ${x.kind.padEnd(5)} "${x.text}" ` +
      `${x.metres === null ? 'unresolved' : x.metres.toFixed(2) + ' m'} len=${x.lengthPx.toFixed(0)}px ` +
      `implied=${x.impliedPixelsPerMetre?.toFixed(1) ?? '-'} conf=${x.confidence.toFixed(2)} ${x.agreesWithGeometry ? 'AGREES' : 'disagrees'}`,
  )
}
