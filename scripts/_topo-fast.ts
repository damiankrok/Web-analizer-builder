/**
 * STAGE WEB-PIVOT-06A §19 — look at what the topology stage decided.
 *
 *   npx tsx scripts/topology-diagnostic.ts A GROUND
 *
 * Writes one sheet per storey under `out/extract/<slug>/`:
 *
 *   doors      every swing arc fitted, every leaf, and the doors that were
 *              hung in a wall, with their opening
 *   barrier    the boundary rooms are flooded against: material in grey, and
 *              each separator in the colour of what put it there
 *   rooms      the regions that came out, tinted, with the outside left white
 *
 * Nothing here reads a gold file.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { loadSource } from '../src/node/source-loader.js'
import { projectByKey } from '../src/node/projects.js'
import { extractPlanSpec, DEFAULT_EXTRACTION, type PlanExtraction } from '../src/node/extract-runner.js'
import { CachedEngine } from './_cache-engine.js'
import { inkChannel } from '../src/core/extract/raster-normalize.js'
import { selectPlanAsset, type PlanStorey } from '../src/core/dimensions/plan-select.js'
import type { GrayImage } from '../src/core/contracts/raster.js'

const key = (process.argv[2] ?? 'A').toUpperCase()
const only = process.argv[3]
const project = projectByKey(key)
if (!project) throw new Error(`unknown project ${key}`)
if (project.role === 'HOLDOUT') {
  throw new Error('the holdout runs once, through its own command, after the freeze (§17)')
}

const loaded = await loadSource(project.url, {
  cacheDir: `fixtures/${project.slug}/assets`,
  htmlPath: `fixtures/${project.slug}/page.html`,
})
const result = extractPlanSpec(loaded.pkg, loaded.images, { ...DEFAULT_EXTRACTION, engine: new CachedEngine(project.slug) }, {
  sourcePackageId: loaded.source.packageId,
  sourcePackageHash: loaded.source.contentHash,
})

type RGB = [number, number, number]
const CLASS_COLOUR: Record<string, RGB> = {
  FABRIC: [110, 110, 110],
  DOOR: [220, 40, 40],
  EXTERIOR_OPENING: [30, 110, 220],
  UNKNOWN_GAP: [230, 160, 20],
}

const canvas = (gray: GrayImage): PNG => {
  const png = new PNG({ width: gray.width, height: gray.height })
  for (let i = 0; i < gray.width * gray.height; i++) {
    // The drawing, washed out, so the overlay is what the eye lands on.
    const v = 200 + Math.round((gray.data[i] / 255) * 55)
    png.data[i * 4] = v
    png.data[i * 4 + 1] = v
    png.data[i * 4 + 2] = v
    png.data[i * 4 + 3] = 255
  }
  return png
}
const dot = (png: PNG, x: number, y: number, c: RGB, r = 1): void => {
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const xx = Math.round(x + dx)
      const yy = Math.round(y + dy)
      if (xx < 0 || yy < 0 || xx >= png.width || yy >= png.height) continue
      const i = (yy * png.width + xx) * 4
      png.data[i] = c[0]
      png.data[i + 1] = c[1]
      png.data[i + 2] = c[2]
    }
  }
}
const line = (png: PNG, x0: number, y0: number, x1: number, y1: number, c: RGB): void => {
  const steps = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0)))
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    dot(png, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, c, 0)
  }
}

const outDir = join('out', 'extract', project.slug)
mkdirSync(outDir, { recursive: true })

for (const plan of result.plans as PlanExtraction[]) {
  if (only && plan.storey !== only) continue
  const sel = selectPlanAsset(loaded.pkg.assets, plan.storey as PlanStorey)!
  const gray = inkChannel(loaded.images.get(sel.asset.id)!)
  const model = plan.model

  // --- doors
  {
    const png = canvas(gray)
    for (const a of plan.doors.arcs) {
      for (let d = a.fromDeg; d <= a.fromDeg + a.spanDeg; d += 1) {
        const rad = (d * Math.PI) / 180
        dot(png, a.centrePx.x + a.radiusPx * Math.cos(rad), a.centrePx.y + a.radiusPx * Math.sin(rad), [150, 200, 150], 0)
      }
    }
    for (const l of plan.doors.leaves) line(png, l.hingePx.x, l.hingePx.y, l.tipPx.x, l.tipPx.y, [120, 160, 210])
    for (const d of plan.doors.doors) {
      const c: RGB =
        d.classification === 'SINGLE_HINGED' || d.classification === 'DOUBLE_HINGED'
          ? [200, 20, 20]
          : d.classification === 'WEAK_ARC'
            ? [220, 120, 20]
            : [150, 60, 150]
      for (let a = d.fromPx; a <= d.toPx; a++) {
        if (d.axis === 'X') dot(png, a, d.atPx, c, 1)
        else dot(png, d.atPx, a, c, 1)
      }
      dot(png, d.hingePx.x, d.hingePx.y, [10, 10, 10], 2)
      if (d.arc) {
        for (let k = 0; k <= d.arc.spanDeg; k += 1) {
          const rad = ((d.arc.fromDeg + k) * Math.PI) / 180
          dot(png, d.arc.centrePx.x + d.arc.radiusPx * Math.cos(rad), d.arc.centrePx.y + d.arc.radiusPx * Math.sin(rad), c, 0)
        }
      }
      if (d.leaf) line(png, d.leaf.hingePx.x, d.leaf.hingePx.y, d.leaf.tipPx.x, d.leaf.tipPx.y, c)
    }
    writeFileSync(join(outDir, `doors-${plan.storey}.png`), PNG.sync.write(png))
  }

  // --- the barrier
  {
    const png = canvas(gray)
    for (const s of model.separators) {
      const c = CLASS_COLOUR[s.kind] ?? [0, 0, 0]
      for (let a = Math.floor(s.fromPx); a <= Math.ceil(s.toPx); a++) {
        for (let cc = Math.floor(s.atNearPx); cc <= Math.ceil(s.atFarPx); cc++) {
          if (s.axis === 'X') dot(png, a, cc, c, 0)
          else dot(png, cc, a, c, 0)
        }
      }
    }
    writeFileSync(join(outDir, `barrier-${plan.storey}.png`), PNG.sync.write(png))
  }

  // --- the rooms
  {
    const png = canvas(gray)
    const kept = new Map(model.rooms.map((r, i) => [r.id, i]))
    const palette: RGB[] = [
      [255, 214, 214],
      [214, 235, 255],
      [219, 255, 214],
      [255, 246, 200],
      [235, 214, 255],
      [214, 255, 250],
      [255, 226, 196],
      [226, 226, 255],
      [200, 255, 226],
      [255, 210, 240],
    ]
    for (let i = 0; i < model.labels.length; i++) {
      const id = model.labels[i]
      if (id < 0) continue
      const idx = kept.get(`rg${id}`)
      if (idx === undefined) continue
      const c = palette[idx % palette.length]
      const x = i % model.width
      const y = (i - x) / model.width
      dot(png, x, y, c, 0)
    }
    for (const s of model.separators) {
      if (s.kind === 'FABRIC') continue
      const c = CLASS_COLOUR[s.kind]
      for (let a = Math.floor(s.fromPx); a <= Math.ceil(s.toPx); a++) {
        for (let cc = Math.floor(s.atNearPx); cc <= Math.ceil(s.atFarPx); cc++) {
          if (s.axis === 'X') dot(png, a, cc, c, 0)
          else dot(png, cc, a, c, 0)
        }
      }
    }
    writeFileSync(join(outDir, `rooms-${plan.storey}.png`), PNG.sync.write(png))
  }

  console.log(`\n=== ${project.key} ${plan.storey} (${plan.assetId})`)
  for (const n of plan.doors.notes) console.log(`  ${n}`)
  for (const n of model.notes) console.log(`  ${n}`)
  console.log(
    `  timings: walls ${plan.timings.wallsMs} ms, doors ${plan.timings.doorsMs} ms, topology ${plan.timings.topologyMs} ms`,
  )
  for (const d of model.doors) {
    const p = model.placements.find((x) => x.doorId === d.id)
    console.log(
      `  ${d.id} ${d.classification.padEnd(14)} ${d.axis} at ${d.atPx.toFixed(1)}, ` +
        `${d.fromPx.toFixed(0)}..${d.toPx.toFixed(0)} (${d.widthM.toFixed(2)} m), confidence ${d.confidence.toFixed(2)} ` +
        `-> ${p?.outcome ?? 'UNPLACED'} ${p?.hostWallId ?? ''}`,
    )
  }
  console.log(`  wrote doors-${plan.storey}.png, barrier-${plan.storey}.png, rooms-${plan.storey}.png`)
}
