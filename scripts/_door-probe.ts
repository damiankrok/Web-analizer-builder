/** Development-only: run the door detector on a plan and list what it found. */
import { loadSource } from '../src/node/source-loader.js'
import { projectByKey } from '../src/node/projects.js'
import { selectPlanAsset, type PlanStorey } from '../src/core/dimensions/plan-select.js'
import { inkChannel } from '../src/core/extract/raster-normalize.js'
import { detectDoorSymbols, DEFAULT_DOOR_SYMBOLS } from '../src/core/extract/door-symbols.js'
import { DEFAULT_WALL_BANDS } from '../src/core/extract/wall-bands.js'

const [key, storey, scaleS] = process.argv.slice(2)
const project = projectByKey(key)!
const loaded = await loadSource(project.url, {
  cacheDir: `fixtures/${project.slug}/assets`,
  htmlPath: `fixtures/${project.slug}/page.html`,
})
const sel = selectPlanAsset(loaded.pkg.assets, storey as PlanStorey)!
const gray = inkChannel(loaded.images.get(sel.asset.id)!)
const t0 = Date.now()
const d = detectDoorSymbols(gray, Number(scaleS), sel.asset.id, DEFAULT_WALL_BANDS.solidFraction, DEFAULT_DOOR_SYMBOLS)
console.log(`${Date.now() - t0} ms`)
for (const n of d.notes) console.log('  ' + n)
const fx = Number(process.argv[5] ?? -999), fy = Number(process.argv[6] ?? -999), fr = Number(process.argv[7] ?? 25)
for (const a of d.arcs) {
  if (Math.hypot(a.centrePx.x - fx, a.centrePx.y - fy) > fr) continue
  console.log(`  ARC centre (${a.centrePx.x},${a.centrePx.y}) r=${a.radiusPx.toFixed(1)} ${a.fromDeg}..${a.toDeg} span ${a.spanDeg}° cov ${(a.coverage*100).toFixed(0)}% res ${a.residualPx.toFixed(2)}`)
}
for (const r of d.rejected) {
  if (Math.hypot(r.atPx.x - fx, r.atPx.y - fy) > fr) continue
  console.log(`  REJECT at (${r.atPx.x.toFixed(1)},${r.atPx.y.toFixed(1)}): ${r.why}`)
}
for (const door of d.doors.sort((a, b) => b.confidence - a.confidence)) {
  console.log(
    `  ${door.id} ${door.classification.padEnd(14)} hinge (${door.hingePx.x.toFixed(0)},${door.hingePx.y.toFixed(0)}) axis ${door.axis} at ${door.atPx.toFixed(1)} ` +
      `${door.fromPx.toFixed(1)}..${door.toPx.toFixed(1)} (${door.widthM.toFixed(2)} m) ` +
      `conf ${door.confidence.toFixed(2)} swing ${door.swingSide > 0 ? '+' : '-'}`,
  )
  for (const e of door.evidence) console.log(`      ${e}`)
}
