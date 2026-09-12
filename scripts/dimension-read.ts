/** Run the printed-dimension reader over a project's technical drawings. */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { loadSource } from '../src/node/source-loader.js'
import { toGray, saturationField } from '../src/core/raster/gray.js'
import { wallMask, planExtent, fitFootprint } from '../src/core/scaffold/plan.js'
import { readPrintedDimensions } from '../src/core/dimensions/reader.js'
import { projectByKey } from '../src/node/projects.js'

const project = projectByKey(process.argv[2] ?? 'A')!
const want = new RegExp(process.argv[3] ?? '^(PLAN|SECTION)')
const outDir = `out/dim/${project.key}`
mkdirSync(outDir, { recursive: true })

const loaded = await loadSource(project.url, {
  cacheDir: `fixtures/${project.slug}/assets`,
  htmlPath: `fixtures/${project.slug}/page.html`,
})
const publishedArea = loaded.pkg.facts.find((f) => f.key === 'footprint_area')?.value ?? null

for (const asset of loaded.pkg.assets) {
  if (!want.test(asset.role)) continue
  const img = loaded.images.get(asset.id)
  if (!img) continue
  const gray = toGray(img)
  // Calibrate from the plan's own fitted footprint where the asset is a plan.
  let ppm: number | null = null
  if (asset.role.startsWith('PLAN')) {
    const extent = planExtent(wallMask(gray, saturationField(img)))
    const fit = fitFootprint(extent, publishedArea, null)
    if (fit.widthM > 0) ppm = extent.widthPx / fit.widthM
  }
  const t0 = Date.now()
  const r = readPrintedDimensions(asset.id, gray, { pixelsPerMetre: ppm })
  console.log(`\n=== ${asset.role} ${asset.id.slice(-6)} ${gray.width}x${gray.height} ppm=${ppm?.toFixed(2) ?? 'n/a'} (${Date.now() - t0} ms)`)
  for (const n of r.notes) console.log('  ' + n)
  for (const c of r.chains) {
    const parts = c.segments.map((s) => (s.metres === null ? '?' : (s.metres * 100).toFixed(0))).join('+')
    const ov = c.overall?.metres === null || c.overall === undefined ? '?' : (c.overall.metres * 100).toFixed(0)
    console.log(
      `  chain ${c.orientation[0]} ${c.segments.length} seg: ${parts} = ${ov}` +
        `  closes=${c.closes} residual=${c.closureResidualM === null ? 'n/a' : (c.closureResidualM * 100).toFixed(1) + 'cm'} conf=${c.confidence.toFixed(2)}`,
    )
    for (const s of c.segments) for (const rej of s.rejections.slice(0, 2)) console.log(`      reject: ${rej}`)
  }
  for (const co of r.callouts) {
    console.log(`  callout ${co.widthM === null ? '?' : (co.widthM * 100).toFixed(0)}/${co.heightM === null ? '?' : (co.heightM * 100).toFixed(0)} at (${co.at.x.toFixed(0)},${co.at.y.toFixed(0)}) ${co.fidelity}`)
  }
  for (const lv of r.levels) console.log(`  level ${lv.metres?.toFixed(2)} at y=${lv.at.y.toFixed(0)}`)
  console.log('  tokens: ' + r.tokens.map((t) => `${t.text}[${t.kind[0]}${t.kind.slice(-1)}]`).join(' '))

  // Token overlay
  const png = new PNG({ width: gray.width, height: gray.height })
  for (let i = 0; i < gray.width * gray.height; i++) {
    const v = 255 - Math.round((255 - gray.data[i]) * 0.3)
    png.data[i * 4] = png.data[i * 4 + 1] = png.data[i * 4 + 2] = v
    png.data[i * 4 + 3] = 255
  }
  const rect = (b: { x0: number; y0: number; x1: number; y1: number }, c: [number, number, number]) => {
    for (let x = Math.max(0, b.x0); x <= Math.min(gray.width - 1, b.x1); x++)
      for (const y of [b.y0, b.y1]) {
        if (y < 0 || y >= gray.height) continue
        const i = (y * gray.width + x) * 4
        png.data[i] = c[0]; png.data[i + 1] = c[1]; png.data[i + 2] = c[2]
      }
    for (let y = Math.max(0, b.y0); y <= Math.min(gray.height - 1, b.y1); y++)
      for (const x of [b.x0, b.x1]) {
        if (x < 0 || x >= gray.width) continue
        const i = (y * gray.width + x) * 4
        png.data[i] = c[0]; png.data[i + 1] = c[1]; png.data[i + 2] = c[2]
      }
  }
  for (const t of r.tokens) {
    const colour: [number, number, number] =
      t.kind === 'LEVEL_MARKER' ? [0, 170, 200] : t.kind.startsWith('OPENING') ? [255, 130, 0] : t.kind === 'CHAIN_OVERALL' ? [200, 0, 200] : [0, 170, 40]
    rect(t.box, colour)
    for (const gb of t.tokenBoxes) rect(gb, [255, 0, 0])
  }
  writeFileSync(join(outDir, `read_${asset.role}_${asset.id.slice(-6)}.png`), PNG.sync.write(png))
}
