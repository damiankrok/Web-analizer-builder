/**
 * STAGE WEB-PIVOT-06 §27 — one sheet of everything the extraction saw.
 *
 *   npx tsx scripts/extract-sheet.ts A GROUND
 *
 * A single PNG per drawing: the plan faded behind, the text runs it found,
 * which of them found an owner, the baselines and their anchors, the wall
 * faces, the openings and the rooms. One picture is what makes an audit of a
 * geometry pipeline possible at all — a table of numbers cannot show that a
 * wall is in the wrong place.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { PNG } from 'pngjs'
import { loadSource } from '../src/node/source-loader.js'
import { projectByKey } from '../src/node/projects.js'
import { extractPlanSpec, DEFAULT_EXTRACTION } from '../src/node/extract-runner.js'
import type { PlanStorey } from '../src/core/dimensions/plan-select.js'
import { inkChannel } from '../src/core/extract/raster-normalize.js'

const project = projectByKey(process.argv[2] ?? 'A')!
const only = (process.argv[3] ?? '') as PlanStorey | ''
const outDir = `out/extract/${project.slug}`
mkdirSync(outDir, { recursive: true })

const loaded = await loadSource(project.url, {
  cacheDir: `fixtures/${project.slug}/assets`,
  htmlPath: `fixtures/${project.slug}/page.html`,
})
const result = extractPlanSpec(loaded.pkg, loaded.images, DEFAULT_EXTRACTION, {
  sourcePackageId: loaded.source.packageId,
  sourcePackageHash: loaded.source.contentHash,
})

for (const plan of result.plans) {
  if (only && plan.storey !== only) continue
  const gray = inkChannel(loaded.images.get(plan.assetId)!)
  const png = new PNG({ width: gray.width, height: gray.height })
  for (let i = 0; i < gray.width * gray.height; i++) {
    const v = 255 - Math.round((255 - gray.data[i]) * 0.18)
    png.data[i * 4] = png.data[i * 4 + 1] = png.data[i * 4 + 2] = v
    png.data[i * 4 + 3] = 255
  }
  const dot = (x: number, y: number, c: [number, number, number]): void => {
    const xi = Math.round(x)
    const yi = Math.round(y)
    if (xi < 0 || yi < 0 || xi >= gray.width || yi >= gray.height) return
    const i = (yi * gray.width + xi) * 4
    png.data[i] = c[0]
    png.data[i + 1] = c[1]
    png.data[i + 2] = c[2]
  }
  const rect = (b: { x0: number; y0: number; x1: number; y1: number }, c: [number, number, number]): void => {
    for (let x = b.x0; x <= b.x1; x++) {
      dot(x, b.y0, c)
      dot(x, b.y1, c)
    }
    for (let y = b.y0; y <= b.y1; y++) {
      dot(b.x0, y, c)
      dot(b.x1, y, c)
    }
  }

  // rooms, tinted
  const keep = new Map(plan.model.rooms.map((r, i) => [r.id, i]))
  const hue = (i: number): [number, number, number] => {
    const t = (i * 0.61803398875) % 1
    const k = (n: number): number => Math.round(255 * (0.5 + 0.5 * Math.sin(2 * Math.PI * (t + n / 3))))
    return [k(0), k(1), k(2)]
  }
  for (let i = 0; i < plan.model.labels.length; i++) {
    const id = plan.model.labels[i]
    if (id < 0) continue
    const index = keep.get(`rg${id}`)
    if (index === undefined) continue
    const c = hue(index)
    png.data[i * 4] = Math.round(png.data[i * 4] * 0.6 + c[0] * 0.4)
    png.data[i * 4 + 1] = Math.round(png.data[i * 4 + 1] * 0.6 + c[1] * 0.4)
    png.data[i * 4 + 2] = Math.round(png.data[i * 4 + 2] * 0.6 + c[2] * 0.4)
  }
  // baselines and their anchors
  for (const b of plan.structures.baselines) {
    for (let t = b.from; t <= b.to; t += 3) {
      if (b.axis === 'X') dot(t, b.position, [150, 180, 210])
      else dot(b.position, t, [150, 180, 210])
    }
    for (const a of b.anchors) {
      for (let d = -3; d <= 3; d++) {
        if (b.axis === 'X') dot(a, b.position + d, [255, 160, 40])
        else dot(b.position + d, a, [255, 160, 40])
      }
    }
  }
  // wall faces and openings
  for (const run of plan.model.runs) {
    for (let a = Math.floor(run.fromPx); a <= Math.ceil(run.toPx); a++) {
      const open = run.openings.some((o) => a >= o.fromPx && a <= o.toPx)
      const c: [number, number, number] = open ? [225, 30, 30] : [20, 80, 210]
      if (run.axis === 'X') {
        dot(a, run.nearPx, c)
        dot(a, run.farPx, c)
      } else {
        dot(run.nearPx, a, c)
        dot(run.farPx, a, c)
      }
    }
  }
  // text runs: green where the reading found an owner, red where it did not
  const owned = new Set(
    plan.observations.filter((o) => o.owner.kind !== 'NONE').map((o) => o.regionId),
  )
  const seen = new Set<string>()
  for (const r of plan.regions) {
    if (seen.has(r.regionId)) continue
    seen.add(r.regionId)
    rect(r.box, owned.has(r.regionId) ? [0, 160, 0] : [200, 0, 120])
  }

  const file = `${outDir}/${plan.storey}-sheet.png`
  writeFileSync(file, PNG.sync.write(png))
  console.log(
    `${file}: ${plan.regions.length} text runs (${owned.size} owned), ` +
      `${plan.structures.baselines.length} baselines, ${plan.model.runs.length} wall runs, ` +
      `${plan.model.rooms.length} rooms`,
  )
}
console.log('\nfaded plan; pale blue baselines, orange anchors, blue wall faces, red openings, tinted rooms,')
console.log('green boxes are readings that found an owner and magenta ones are readings that did not.')
