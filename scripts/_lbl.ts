import { loadSource } from '../src/node/source-loader.js'
import { projectByKey } from '../src/node/projects.js'
import { extractPlanSpec, DEFAULT_EXTRACTION } from '../src/node/extract-runner.js'
import { CachedEngine } from './_cache-engine.js'
const project = projectByKey(process.argv[2] ?? 'A')!
const loaded = await loadSource(project.url, { cacheDir: `fixtures/${project.slug}/assets`, htmlPath: `fixtures/${project.slug}/page.html` })
const r = extractPlanSpec(loaded.pkg, loaded.images, { ...DEFAULT_EXTRACTION, engine: new CachedEngine(project.slug) }, {})
for (const p of r.plans) {
  console.log(`=== ${p.storey}  label asset ${p.labels.assetId}`)
  console.log(`  alignment ${JSON.stringify(p.labels.alignment)}`)
  for (const l of p.labels.found) console.log(`  ${l.id} box ${l.box.x0},${l.box.y0}..${l.box.x1},${l.box.y1} (${l.box.x1-l.box.x0}x${l.box.y1-l.box.y0}) strokes ${l.strokes}`)
}
