/** Development-only: the rooms and adjacencies a storey came out with. */
import { readFileSync } from 'node:fs'
import { loadSource } from '../src/node/source-loader.js'
import { projectByKey } from '../src/node/projects.js'
import { extractPlanSpec, DEFAULT_EXTRACTION } from '../src/node/extract-runner.js'
import { alignToGold, type Gold } from '../tests/candidate-evaluator.js'
import { CachedEngine } from './_cache-engine.js'

const key = (process.argv[2] ?? 'A').toUpperCase()
const want = process.argv[3] ?? 'UPPER_ATTIC'
const level = process.argv[4] ?? 'upper'
const project = projectByKey(key)!
const loaded = await loadSource(project.url, { cacheDir: `fixtures/${project.slug}/assets`, htmlPath: `fixtures/${project.slug}/page.html` })
const result = extractPlanSpec(loaded.pkg, loaded.images, { ...DEFAULT_EXTRACTION, engine: new CachedEngine(project.slug) }, {
  sourcePackageId: loaded.source.packageId,
  sourcePackageHash: loaded.source.contentHash,
})
const gold = JSON.parse(readFileSync('research/gold/marcowki-interior-v1.json', 'utf8')) as Gold
const al = alignToGold(result.candidate, gold, level, want)
const s = result.candidate.storeys.find((x) => x.storey === want)!
const goldRooms = gold.rooms.filter((r) => r.level === level)
const inside = (p: { x: number; z: number }, poly: number[][]): boolean => {
  let on = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j]
    if (zi > p.z !== zj > p.z && p.x < ((xj - xi) * (p.z - zi)) / (zj - zi) + xi) on = !on
  }
  return on
}
const nameOf = (id: string): string => {
  const r = s.rooms.find((x) => x.id === id)!
  const p = { x: r.centroid.x + al.dx, z: r.centroid.z + al.dz }
  const hit = goldRooms.find((g) => inside(p, g.polygon))
  return `${id}[${hit?.id ?? '-'} ${r.areaM2.toFixed(1)}m2]`
}
console.log(`aligned dx ${al.dx.toFixed(3)} dz ${al.dz.toFixed(3)}`)
for (const r of s.rooms) console.log('  room ' + nameOf(r.id))
for (const a of s.adjacency) {
  console.log(`  edge ${nameOf(a.a)} -- ${nameOf(a.b)}  ${a.sharedM.toFixed(2)} m via ${a.wallId} doors ${a.doorways.length}`)
}
const plan = result.plans.find((p) => p.storey === want)!
const m = plan.model
const pxPerCm = plan.scales.find((x) => x.pxPerCm !== null)?.pxPerCm ?? 1
const areas = new Map<number, { n: number; edge: boolean; x0: number; y0: number; x1: number; y1: number }>()
for (let i = 0; i < m.labels.length; i++) {
  const id = m.labels[i]
  if (id < 0) continue
  const x = i % m.width, y = (i - x) / m.width
  const e = areas.get(id) ?? { n: 0, edge: false, x0: 1e9, y0: 1e9, x1: -1, y1: -1 }
  e.n++
  if (x === 0 || y === 0 || x === m.width - 1 || y === m.height - 1) e.edge = true
  e.x0 = Math.min(e.x0, x); e.x1 = Math.max(e.x1, x); e.y0 = Math.min(e.y0, y); e.y1 = Math.max(e.y1, y)
  areas.set(id, e)
}
console.log('  --- where each gold room\'s centre lands')
{
  const frame = s.frame!
  for (const g of goldRooms) {
    const cx = g.polygon.reduce((n, q) => n + q[0], 0) / g.polygon.length - al.dx
    const cz = g.polygon.reduce((n, q) => n + q[1], 0) / g.polygon.length - al.dz
    const px = Math.round(cx * 100 * frame.pxPerCm + frame.originPx.x)
    const py = Math.round(cz * 100 * frame.pxPerCm + frame.originPx.y)
    const id = px >= 0 && py >= 0 && px < m.width && py < m.height ? m.labels[py * m.width + px] : -1
    const kept = s.rooms.some((r) => r.id === `${want}:rg${id}`)
    console.log(`    ${g.id.padEnd(18)} centre px ${px},${py} -> ${id < 0 ? 'barrier' : `rg${id}`}${kept ? '' : ' (not kept as a room)'}`)
  }
}
console.log('  --- every enclosed region over 3 m2')
for (const [id, e] of [...areas].sort((a, b) => b[1].n - a[1].n).slice(0, 14)) {
  const m2 = e.n / (100 * pxPerCm) ** 2
  if (m2 < 3) continue
  console.log(`    rg${id} ${m2.toFixed(1)} m2 box ${e.x0}..${e.x1} x ${e.y0}..${e.y1}${e.edge ? '  TOUCHES THE SHEET EDGE' : ''}`)
}
console.log(`  timings walls ${plan.timings.wallsMs} ms, doors ${plan.timings.doorsMs} ms, topology ${plan.timings.topologyMs} ms`)
for (const n of plan.model.notes) console.log('  ' + n)
