import { loadSource } from '../src/node/source-loader.js'
import { projectByKey } from '../src/node/projects.js'
import { selectPlanAsset, type PlanStorey } from '../src/core/dimensions/plan-select.js'
import { inkChannel } from '../src/core/extract/raster-normalize.js'
import { solidThreshold, DEFAULT_WALL_BANDS } from '../src/core/extract/wall-bands.js'
import { inkLayers } from '../src/core/extract/door-symbols.js'
const [key, storey, x0s, y0s, x1s, y1s] = process.argv.slice(2)
const project = projectByKey(key)!
const loaded = await loadSource(project.url, { cacheDir: `fixtures/${project.slug}/assets`, htmlPath: `fixtures/${project.slug}/page.html` })
const sel = selectPlanAsset(loaded.pkg.assets, storey as PlanStorey)!
const gray = inkChannel(loaded.images.get(sel.asset.id)!)
const solid = solidThreshold(gray, DEFAULT_WALL_BANDS.solidFraction)
const L = inkLayers(gray, solid)
console.log(`solid<=${solid}   . paper  i ink  F fabric`)
process.stdout.write('      ')
for (let x = +x0s; x <= +x1s; x++) process.stdout.write(String(x % 100).padStart(4))
process.stdout.write('\n')
for (let y = +y0s; y <= +y1s; y++) {
  process.stdout.write(String(y).padStart(5) + ' ')
  for (let x = +x0s; x <= +x1s; x++) {
    const i = y * gray.width + x
    const m = L.fabric[i] ? 'F' : L.ink[i] ? 'i' : L.thin[i] ? 't' : '.'
    process.stdout.write((m + gray.data[i]).padStart(4))
  }
  process.stdout.write('\n')
}
