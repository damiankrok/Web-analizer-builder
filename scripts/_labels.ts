import { loadSource } from '../src/node/source-loader.js'
import { projectByKey } from '../src/node/projects.js'
import { extractPlanSpec, DEFAULT_EXTRACTION } from '../src/node/extract-runner.js'
import { CachedEngine } from './_cache-engine.js'
const project = projectByKey(process.argv[2] ?? 'A')!
const loaded = await loadSource(project.url, { cacheDir: `fixtures/${project.slug}/assets`, htmlPath: `fixtures/${project.slug}/page.html` })
const r = extractPlanSpec(loaded.pkg, loaded.images, { ...DEFAULT_EXTRACTION, engine: new CachedEngine(project.slug) }, {})
for (const plan of r.plans) {
  console.log(`=== ${plan.storey}`)
  for (const o of plan.observations) {
    const reg = plan.regions.find((x) => x.id === o.regionId)
    console.log(
      `  ${o.text.padEnd(6)} ${o.owner.kind.padEnd(9)} conf ${o.confidence.toFixed(2)} ` +
        `box ${reg ? `${reg.box.x0},${reg.box.y0}..${reg.box.x1},${reg.box.y1} h=${reg.box.y1 - reg.box.y0}` : '?'} ${reg?.orientation ?? ''}`,
    )
  }
}
