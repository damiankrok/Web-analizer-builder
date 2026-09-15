/** Development-only: write a magnified PNG crop of a plan asset, to look at. */
import { mkdirSync, writeFileSync } from 'node:fs'
import { PNG } from 'pngjs'
import { loadSource } from '../src/node/source-loader.js'
import { projectByKey } from '../src/node/projects.js'
import { selectPlanAsset, type PlanStorey } from '../src/core/dimensions/plan-select.js'
import { inkChannel } from '../src/core/extract/raster-normalize.js'

const [key, storey, x0s, y0s, x1s, y1s, zooms, out] = process.argv.slice(2)
const project = projectByKey(key)!
const loaded = await loadSource(project.url, {
  cacheDir: `fixtures/${project.slug}/assets`,
  htmlPath: `fixtures/${project.slug}/page.html`,
})
const sel = selectPlanAsset(loaded.pkg.assets, storey as PlanStorey)!
const gray = inkChannel(loaded.images.get(sel.asset.id)!)
const x0 = Number(x0s), y0 = Number(y0s), x1 = Number(x1s), y1 = Number(y1s), zoom = Number(zooms)
const w = (x1 - x0) * zoom
const h = (y1 - y0) * zoom
const png = new PNG({ width: w, height: h })
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const sx = x0 + Math.floor(x / zoom)
    const sy = y0 + Math.floor(y / zoom)
    const v = sx >= 0 && sy >= 0 && sx < gray.width && sy < gray.height ? gray.data[sy * gray.width + sx] : 255
    const i = (y * w + x) * 4
    png.data[i] = v
    png.data[i + 1] = v
    png.data[i + 2] = v
    png.data[i + 3] = 255
  }
}
mkdirSync('out/crops', { recursive: true })
writeFileSync(`out/crops/${out}.png`, PNG.sync.write(png))
console.log(`out/crops/${out}.png  ${w}x${h}  source ${gray.width}x${gray.height} asset ${sel.asset.id}`)
