/**
 * STAGE WEB-PIVOT-06 §27 — look at what the extraction saw.
 *
 *   npx tsx scripts/extract-diagnostic.ts A GROUND [view]
 *
 * Views:
 *   baselines   every baseline, its anchors and the intervals they cut
 *   regions     every text run, with the candidates that could own it
 *   overlay     a PNG with baselines, anchors and text runs drawn on the plan
 *   walls       the wall bands, with their two faces and thickness
 *   rooms       the wall runs, the regions they enclose and what adjoins what
 *   plan        a PNG of the wall runs, their openings and the rooms
 *   scale       the pairings that voted for the sheet's scale
 *   row N       the ink profile across one row, to see what a detector saw
 *   col N       the ink profile down one column
 *
 * The plan is drawn faded so an overlay can be checked against the drawing it
 * came from.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { PNG } from 'pngjs'
import { loadSource } from '../src/node/source-loader.js'
import { selectPlanAsset, type PlanStorey } from '../src/core/dimensions/plan-select.js'
import { projectByKey } from '../src/node/projects.js'
import { inkChannel } from '../src/core/extract/raster-normalize.js'
import { detectTextRegions } from '../src/core/extract/text-regions.js'
import { detectDimensionStructures } from '../src/core/extract/dimension-structures.js'
import { buildTextCrops } from '../src/core/extract/text-crops.js'
import { DEFAULT_PLAN_TEXT } from '../src/core/extract/text-engine.js'
import { buildObservations } from '../src/core/extract/dimension-observations.js'
import { detectWallBands } from '../src/core/extract/wall-bands.js'
import { buildPlanModel } from '../src/core/extract/plan-model.js'
import { TesseractEngine } from '../src/node/ocr/tesseract.js'

const project = projectByKey(process.argv[2] ?? 'A')!
const storey = (process.argv[3] ?? 'GROUND') as PlanStorey
const view = process.argv[4] ?? 'baselines'
const outDir = `out/extract/${project.slug}`
mkdirSync(outDir, { recursive: true })

const loaded = await loadSource(project.url, {
  cacheDir: `fixtures/${project.slug}/assets`,
  htmlPath: `fixtures/${project.slug}/page.html`,
})
const sel = selectPlanAsset(loaded.pkg.assets, storey)
if (!sel) throw new Error(`${project.key} publishes no ${storey} plan`)
const image = loaded.images.get(sel.asset.id)!
const gray = inkChannel(image)
const regions = detectTextRegions(gray)
const structures = detectDimensionStructures(gray, regions)

console.log(`=== ${project.key} ${storey} ${sel.asset.id} ${gray.width}x${gray.height}`)
for (const n of structures.notes) console.log('  ' + n)

if (view === 'row' || view === 'col') {
  const at = Number(process.argv[5] ?? 0)
  const white = (() => {
    const hist = new Int32Array(256)
    for (let i = 0; i < gray.data.length; i++) hist[gray.data[i]]++
    let acc = 0
    for (let v = 0; v < 256; v++) {
      acc += hist[v]
      if (acc >= gray.data.length * 0.95) return v
    }
    return 255
  })()
  console.log(`  white level ${white}, ink threshold ${Math.max(40, Math.round(white * 0.82))}`)
  const n = view === 'row' ? gray.width : gray.height
  const at_ = Math.max(0, Math.min(view === 'row' ? gray.height - 1 : gray.width - 1, at))
  const values: number[] = []
  for (let t = 0; t < n; t++) values.push(view === 'row' ? gray.data[at_ * gray.width + t] : gray.data[t * gray.width + at_])
  const from = Number(process.argv[6] ?? 0)
  const to = Number(process.argv[7] ?? n)
  console.log(`  ${view} ${at_}, ${from}..${to}:`)
  console.log('   ' + values.slice(from, to).map((v) => String(v).padStart(4)).join(''))
} else if (view === 'baselines') {
  for (const b of structures.baselines.sort((x, y) => (x.axis < y.axis ? -1 : 1) || x.position - y.position)) {
    const gaps = b.anchors.slice(1).map((a, i) => (a - b.anchors[i]).toFixed(0)).join('|')
    console.log(
      `  ${b.id.padEnd(16)} ${b.axis} at ${String(b.position).padStart(4)} span ${String(b.from).padStart(4)}..${String(b.to).padEnd(4)} ` +
        `${b.anchors.length} anchors: ${gaps}`,
    )
  }
} else if (view === 'regions') {
  const byRegion = new Map<string, (typeof regions)[number]>()
  for (const r of regions) if (!byRegion.has(r.regionId)) byRegion.set(r.regionId, r)
  for (const r of byRegion.values()) {
    const reach = structures.reaches.filter((c) => c.regionId === r.regionId)
    console.log(
      `  ${r.regionId.padEnd(8)} ${r.axis} box ${Math.round(r.box.x0)},${Math.round(r.box.y0)}..${Math.round(r.box.x1)},${Math.round(r.box.y1)} ` +
        `glyphs ${r.glyphs} h ${r.glyphHeightPx} -> near ${reach.length} baselines` +
        (reach.length > 0 ? `: ${reach.map((c) => `${c.baselineId}(${c.offsetPx.toFixed(0)}px off)`).join(' ')}` : ''),
    )
  }
} else if (view === 'walls') {
  const crops = buildTextCrops(
    gray,
    regions.map((r) => ({ id: r.id, box: r.box, orientation: r.orientation })),
  )
  const built = buildObservations(new TesseractEngine().readBatch(crops, DEFAULT_PLAN_TEXT), regions, structures)
  const scale = built.scales.find((s) => s.pxPerCm !== null)?.pxPerCm ?? null
  const { bands, notes } = detectWallBands(gray, scale)
  for (const n of notes) console.log('  ' + n)
  for (const b of bands.sort((x, y) => (x.axis < y.axis ? -1 : 1) || x.nearPx - y.nearPx)) {
    const m = (px: number): string => (scale ? (px / scale / 100).toFixed(2) : '?')
    console.log(
      `  ${b.id.padEnd(6)} ${b.axis} faces ${b.nearPx.toFixed(1)}..${b.farPx.toFixed(1)} ` +
        `(${b.thicknessPx.toFixed(1)} px = ${m(b.thicknessPx)} m)  runs ${b.fromPx}..${b.toPx} ` +
        `(${m(b.toPx - b.fromPx)} m)  coverage ${(b.coverage * 100).toFixed(0)}%`,
    )
  }
} else if (view === 'rooms' || view === 'plan') {
  const crops = buildTextCrops(
    gray,
    regions.map((r) => ({ id: r.id, box: r.box, orientation: r.orientation })),
  )
  const built = buildObservations(new TesseractEngine().readBatch(crops, DEFAULT_PLAN_TEXT), regions, structures)
  const scale = built.scales.find((s) => s.pxPerCm !== null)?.pxPerCm ?? null
  const { bands } = detectWallBands(gray, scale)
  const model = buildPlanModel(gray, bands, scale)
  for (const n of model.notes) console.log('  ' + n)
  const m = (px: number): string => (scale ? (px / scale / 100).toFixed(2) : '?')
  if (view === 'rooms') {
    console.log('\n  wall runs:')
    for (const r of model.runs.sort((a, b) => (a.axis < b.axis ? -1 : 1) || a.nearPx - b.nearPx)) {
      const solid = r.solid.reduce((n2, s2) => n2 + (s2.toPx - s2.fromPx), 0)
      console.log(
        `  ${r.id.padEnd(6)} ${r.axis} faces ${m(r.nearPx)}..${m(r.farPx)} m thick ${m(r.thicknessPx)} ` +
          `runs ${m(r.fromPx)}..${m(r.toPx)} m, solid ${m(solid)} m, ` +
          `${r.openings.length} opening${r.openings.length === 1 ? '' : 's'}` +
          (r.openings.length > 0 ? ` (${r.openings.map((o) => `${m(o.lengthPx)} m`).join(', ')})` : ''),
      )
    }
    console.log('\n  rooms:')
    for (const r of model.rooms.sort((a, b) => b.areaPx - a.areaPx)) {
      const areaM2 = scale ? r.areaPx / (100 * scale) ** 2 : 0
      console.log(
        `  ${r.id.padEnd(6)} ${areaM2.toFixed(2)} m\u00b2  box ${m(r.box.x0)},${m(r.box.y0)}..${m(r.box.x1)},${m(r.box.y1)} m`,
      )
    }
    console.log('\n  adjacency:')
    for (const a of model.adjacency.sort((x, y) => y.sharedPx - x.sharedPx)) {
      console.log(
        `  ${a.a} - ${a.b} across ${a.wallRunId}, ${m(a.sharedPx)} m shared` +
          (a.openings.length > 0 ? `, ${a.openings.length} doorway (${a.openings.map((o) => m(o.lengthPx)).join(', ')} m)` : ', no doorway'),
      )
    }
  } else {
    const png = new PNG({ width: gray.width, height: gray.height })
    for (let i = 0; i < gray.width * gray.height; i++) {
      const v = 255 - Math.round((255 - gray.data[i]) * 0.2)
      png.data[i * 4] = png.data[i * 4 + 1] = png.data[i * 4 + 2] = v
      png.data[i * 4 + 3] = 255
    }
    const keep = new Map(model.rooms.map((r, i) => [r.id, i]))
    const hue = (i: number): [number, number, number] => {
      const t = (i * 0.61803398875) % 1
      const k = (n: number): number => Math.round(255 * (0.55 + 0.45 * Math.sin(2 * Math.PI * (t + n / 3))))
      return [k(0), k(1), k(2)]
    }
    for (let i = 0; i < model.labels.length; i++) {
      const id = model.labels[i]
      if (id < 0) continue
      const index = keep.get(`rg${id}`)
      if (index === undefined) continue
      const c = hue(index)
      png.data[i * 4] = Math.round(png.data[i * 4] * 0.55 + c[0] * 0.45)
      png.data[i * 4 + 1] = Math.round(png.data[i * 4 + 1] * 0.55 + c[1] * 0.45)
      png.data[i * 4 + 2] = Math.round(png.data[i * 4 + 2] * 0.55 + c[2] * 0.45)
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
    for (const run of model.runs) {
      for (let a = Math.floor(run.fromPx); a <= Math.ceil(run.toPx); a++) {
        const open = run.openings.some((o) => a >= o.fromPx && a <= o.toPx)
        const c: [number, number, number] = open ? [230, 40, 40] : [20, 90, 220]
        if (run.axis === 'X') {
          dot(a, run.nearPx, c)
          dot(a, run.farPx, c)
        } else {
          dot(run.nearPx, a, c)
          dot(run.farPx, a, c)
        }
      }
    }
    const file = `${outDir}/${storey}-plan.png`
    writeFileSync(file, PNG.sync.write(png))
    console.log(`\n  wrote ${file} — blue wall faces, red openings, rooms tinted`)
  }
} else if (view === 'scale' || view === 'overlay') {
  const crops = buildTextCrops(
    gray,
    regions.map((r) => ({ id: r.id, box: r.box, orientation: r.orientation })),
  )
  const readings = new TesseractEngine().readBatch(crops, DEFAULT_PLAN_TEXT)
  const built = buildObservations(readings, regions, structures)
  for (const n of built.notes) console.log('  ' + n)

  if (view === 'scale') {
    console.log('\n  every scale proposed and tested:')
    for (const t of built.testedScales.sort((a, b) => (a.axis < b.axis ? -1 : 1) || b.score - a.score)) {
      console.log(
        `  ${t.axis} ${t.pxPerCm.toFixed(5)} px/cm  ${String(t.segments).padStart(3)} segments  ` +
          `${t.explainedPx.toFixed(0).padStart(6)} px explained  spread ${(t.spread * 100).toFixed(2)}%  score ${t.score.toFixed(0)}`,
      )
    }
    const owners = new Map(built.observations.map((o) => [o.regionId, o]))
    console.log('\n  every reading, and what the chain fit made of it:')
    for (const o of [...owners.values()].sort((a, b) => (a.regionId < b.regionId ? -1 : 1))) {
      const w = o.owner
      const where =
        w.kind === 'INTERVAL'
          ? `${w.baselineId} ${w.fromPx.toFixed(0)}..${w.toPx.toFixed(0)} (${w.lengthPx.toFixed(0)} px, ${(w.scaleError * 100).toFixed(1)}% off, chain of ${w.chainSegments})`
          : w.kind === 'CALLOUT'
            ? `ring ${w.calloutId} ${w.half}`
            : w.why
      console.log(`  ${o.regionId.padEnd(8)} ${o.text.padEnd(6)} conf ${o.confidence.toFixed(2)}  ${w.kind.padEnd(8)} ${where}`)
      for (const alt of o.alternatives) console.log(`             also read ${alt.text} at ${alt.confidence.toFixed(2)}`)
    }
  } else {
    const png = new PNG({ width: gray.width, height: gray.height })
    for (let i = 0; i < gray.width * gray.height; i++) {
      const v = 255 - Math.round((255 - gray.data[i]) * 0.25)
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
    for (const b of structures.baselines) {
      for (let t = b.from; t <= b.to; t++) {
        if (b.axis === 'X') dot(t, b.position, [0, 150, 255])
        else dot(b.position, t, [0, 150, 255])
      }
      for (const a of b.anchors) {
        for (let d = -4; d <= 4; d++) {
          if (b.axis === 'X') dot(a, b.position + d, [255, 140, 0])
          else dot(b.position + d, a, [255, 140, 0])
        }
      }
    }
    const owned = new Set(
      built.observations.filter((o) => o.owner.kind === 'INTERVAL').map((o) => o.regionId),
    )
    const seen = new Set<string>()
    for (const r of regions) {
      if (seen.has(r.regionId)) continue
      seen.add(r.regionId)
      rect(r.box, owned.has(r.regionId) ? [0, 170, 0] : [220, 0, 0])
    }
    const file = `${outDir}/${storey}-overlay.png`
    writeFileSync(file, PNG.sync.write(png))
    console.log(`\n  wrote ${file} — blue baselines, orange anchors, green owned labels, red unowned`)
  }
}
