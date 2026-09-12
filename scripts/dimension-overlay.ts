/** Debug overlay for the dimension geometry detector (§24 evidence). */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { loadSource } from '../src/node/source-loader.js'
import { toGray } from '../src/core/raster/gray.js'
import { detectDimensionGeometry } from '../src/core/dimensions/geometry.js'
import { projectByKey } from '../src/node/projects.js'

const project = projectByKey(process.argv[2] ?? 'A')!
const outDir = process.argv[3] ?? `out/dim/${project.key}`
const want = new RegExp(process.argv[4] ?? '^(PLAN|SECTION|ELEVATION)')
mkdirSync(outDir, { recursive: true })

const loaded = await loadSource(project.url, {
  cacheDir: `fixtures/${project.slug}/assets`,
  htmlPath: `fixtures/${project.slug}/page.html`,
})

for (const asset of loaded.pkg.assets) {
  if (!want.test(asset.role)) continue
  const img = loaded.images.get(asset.id)
  if (!img) continue
  const gray = toGray(img)
  const t0 = Date.now()
  const g = detectDimensionGeometry(gray)
  console.log(`\n${asset.role} ${asset.id.slice(-6)} ${gray.width}x${gray.height} (${Date.now() - t0} ms)`)
  for (const n of g.notes) console.log('  ' + n)
  for (const l of g.lines.slice(0, 14)) {
    console.log(`  ${l.orientation[0]} pos=${l.position} ${l.from}..${l.to} ticks=${l.ticks.length} [${l.ticks.slice(0, 10).join(',')}]`)
  }
  for (const c of g.callouts) {
    console.log(`  callout at (${c.centre.x.toFixed(0)},${c.centre.y.toFixed(0)}) r=${c.radiusPx.toFixed(1)} leader=${c.leaderEnd ? `(${c.leaderEnd.x.toFixed(0)},${c.leaderEnd.y.toFixed(0)})` : 'none'}`)
  }

  const png = new PNG({ width: gray.width, height: gray.height })
  for (let i = 0; i < gray.width * gray.height; i++) {
    const v = 255 - Math.round((255 - gray.data[i]) * 0.35)
    png.data[i * 4] = png.data[i * 4 + 1] = png.data[i * 4 + 2] = v
    png.data[i * 4 + 3] = 255
  }
  const put = (x: number, y: number, r: number, gg: number, b: number) => {
    if (x < 0 || y < 0 || x >= gray.width || y >= gray.height) return
    const i = (y * gray.width + x) * 4
    png.data[i] = r
    png.data[i + 1] = gg
    png.data[i + 2] = b
  }
  const rect = (x0: number, y0: number, x1: number, y1: number, c: [number, number, number]) => {
    for (let x = x0; x <= x1; x++) { put(x, y0, ...c); put(x, y1, ...c) }
    for (let y = y0; y <= y1; y++) { put(x0, y, ...c); put(x1, y, ...c) }
  }
  for (const l of g.lines) {
    for (let t = l.from; t <= l.to; t++) {
      if (l.orientation === 'HORIZONTAL') put(t, l.position, 0, 130, 255)
      else put(l.position, t, 0, 130, 255)
    }
    for (const tk of l.ticks) {
      for (let d = -5; d <= 5; d++) {
        if (l.orientation === 'HORIZONTAL') put(tk, l.position + d, 255, 0, 0)
        else put(l.position + d, tk, 255, 0, 0)
      }
    }
  }
  for (const z of g.zones) rect(z.box.x0, z.box.y0, z.box.x1, z.box.y1, z.segmentIndex < 0 ? [200, 0, 200] : [0, 170, 40])
  for (const c of g.callouts) {
    rect(c.upper.x0, c.upper.y0, c.upper.y1 === c.upper.y0 ? c.upper.x1 : c.upper.x1, c.upper.y1, [255, 140, 0])
    rect(c.lower.x0, c.lower.y0, c.lower.x1, c.lower.y1, [255, 200, 0])
    if (c.leaderEnd) rect(c.leaderEnd.x - 2, c.leaderEnd.y - 2, c.leaderEnd.x + 2, c.leaderEnd.y + 2, [0, 0, 255])
  }
  for (const lv of g.levels) rect(lv.box.x0, lv.box.y0, lv.box.x1, lv.box.y1, [0, 200, 200])
  writeFileSync(join(outDir, `${asset.role}_${asset.id.slice(-6)}.png`), PNG.sync.write(png))
}
