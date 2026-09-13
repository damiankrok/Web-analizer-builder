/**
 * Whole-shell solid audit — STAGE WEB-PIVOT-03 pre-flight, development only.
 *
 *   npx tsx scripts/shell-audit.ts
 *
 * Non-mutating. It changes no compiler and no fixture; it asks one question of
 * the geometry STAGE WEB-PIVOT-02A left behind, before this stage starts moving
 * source acquisition around:
 *
 *   does any pair of elements share volume, and is there daylight anywhere two
 *   elements are meant to touch?
 *
 * Method. Every element of the building is its own closed solid, and they
 * touch. A ray through the whole set, depth-counted by `materialRuns`, measures
 * the *union*; the same ray through one element at a time and summed measures
 * the *parts*. The parts can only exceed the union where two solids share
 * space, and the difference is exactly the length of line inside both. That is
 * exact per ray — no grid error enters it — so the scan below reports the worst
 * column rather than an integral of it, and the integral only as a scale.
 *
 * Interior voids are not a defect on their own: the building is hollow, and a
 * line through a room legitimately passes slab, air, roof. So voids are asked
 * about *interfaces* — pairs of elements that are meant to be in contact —
 * using the same signed-gap oracle STAGE WEB-PIVOT-02A introduced.
 */
import { compileBuilding, isSolidBuildingPart, type BuildingTri } from '../src/core/wallspec/building.js'
import { marcowkiBuildingSpec, IDS, M, MAIN, GARAGE } from '../src/core/wallspec/marcowki-fixture.js'
import { materialRuns, intervalsLength, measureContact, meshVolume, manifoldReport } from '../tests/geometry-oracles.js'
import type { Vec3 } from '../src/core/math/vec.js'

const UP: Vec3 = { x: 0, y: 1, z: 0 }
const PLUS_X: Vec3 = { x: 1, y: 0, z: 0 }
const PLUS_Z: Vec3 = { x: 0, y: 0, z: 1 }
const FAR = 1000
const f6 = (x: number): string => x.toFixed(6)

const r = compileBuilding(marcowkiBuildingSpec())
const solid = r.tris.filter((t) => isSolidBuildingPart(t.part))

console.log('STAGE WEB-PIVOT-03 pre-flight — whole-shell solid audit')
console.log(`  diagnostics: ${r.diagnostics.length === 0 ? 'none' : r.diagnostics.map((d) => d.code).join(', ')}`)
console.log(`  solid triangles: ${solid.length}`)

/** Every element that is its own closed solid: each wall, each slab, each roof. */
type Element = { id: string; tris: BuildingTri[] }
const elements: Element[] = []
for (const id of [...new Set(solid.filter((t) => t.elementKind === 'WALL').map((t) => t.wallId))].sort()) {
  elements.push({ id, tris: solid.filter((t) => t.wallId === id) })
}
for (const id of [...new Set(solid.filter((t) => t.elementKind !== 'WALL').map((t) => t.elementId))].sort()) {
  elements.push({ id, tris: solid.filter((t) => t.elementId === id) })
}

/**
 * A compiled element is not always one solid.
 *
 * A gable roof is two slabs that meet on the ridge, and `manifoldReport` run
 * over the pair reports duplicate edges that are not a defect: two coincident
 * faces in contact traverse the same edge twice. `compileRoofs` emits one slab
 * per plane, in order, so a roof of `planeCount` planes splits evenly — which
 * this script states rather than infers, because inferring it from the
 * triangles alone is a harder question than the pre-flight needs answered.
 * Whether the slabs share any volume is a separate question, and the ray scan
 * below is what answers it.
 */
const planesOf = new Map(r.roofs.map((x) => [x.roofId, x.planeCount]))
const parts = (e: Element): BuildingTri[][] => {
  const n = planesOf.get(e.id) ?? 1
  if (n <= 1) return [e.tris]
  const each = e.tris.length / n
  return Array.from({ length: n }, (_, i) => e.tris.slice(i * each, (i + 1) * each))
}

console.log(`\n--- ${elements.length} elements, checked solid by solid`)
let volumeSum = 0
let bad = 0
let solidCount = 0
for (const e of elements) {
  volumeSum += meshVolume(e.tris)
  const list = parts(e)
  solidCount += list.length
  for (const [i, part] of list.entries()) {
    const m = manifoldReport(part)
    const v = meshVolume(part)
    const label = list.length > 1 ? `${e.id} slab ${i + 1}/${list.length}` : e.id
    const ok = m.closed && m.orientable && v > 0
    if (!ok) bad++
    console.log(`  ${ok ? '  ' : '!!'} ${label.padEnd(28)} closed ${String(m.closed).padEnd(5)} orientable ${String(m.orientable).padEnd(5)} volume ${f6(v)} m3`)
  }
}
console.log(`  ${solidCount} solids, all closed / orientable / positive: ${bad === 0}`)
console.log(`  sum of element volumes: ${f6(volumeSum)} m3`)

/** Sum of per-element run length minus union run length, along one ray. */
function doubleFilled(origin: Vec3, dir: Vec3): { over: number; parts: string[] } {
  const union = intervalsLength(materialRuns(solid, origin, dir))
  let parts = 0
  const hit: string[] = []
  for (const e of elements) {
    const len = intervalsLength(materialRuns(e.tris, origin, dir))
    if (len > 1e-9) {
      parts += len
      hit.push(e.id)
    }
  }
  return { over: parts - union, parts: hit }
}

type Worst = { over: number; where: string; parts: string[] }
const scan = (name: string, rays: Array<{ origin: Vec3; dir: Vec3; where: string }>, cell: number): void => {
  let worst: Worst = { over: 0, where: '(none)', parts: [] }
  let integral = 0
  for (const ray of rays) {
    const d = doubleFilled(ray.origin, ray.dir)
    if (d.over > worst.over) worst = { over: d.over, where: ray.where, parts: d.parts }
    integral += Math.max(0, d.over)
  }
  console.log(
    `  ${name.padEnd(26)} ${rays.length} rays   worst shared length ${worst.over.toExponential(3)} m at ${worst.where}` +
      `   shared volume ~ ${(integral * cell * cell).toExponential(3)} m3`,
  )
  if (worst.over > 1e-6) console.log(`      elements on that ray: ${worst.parts.join(', ')}`)
}

console.log('\n--- shared-volume scan (parts minus union, exact per ray)')
const STEP = 0.10
const OFF = 0.037 // keep rays off element faces and off the 0.05 grid
const vertical: Array<{ origin: Vec3; dir: Vec3; where: string }> = []
for (let x = 0; x < M.overallWidth; x += STEP) {
  for (let z = 0; z < M.overallDepth; z += STEP) {
    vertical.push({ origin: { x: x + OFF, y: -FAR, z: z + OFF }, dir: UP, where: `x=${(x + OFF).toFixed(3)} z=${(z + OFF).toFixed(3)}` })
  }
}
scan('vertical', vertical, STEP)

const alongX: Array<{ origin: Vec3; dir: Vec3; where: string }> = []
for (let y = 0.05; y < M.ridge; y += STEP) {
  for (let z = 0; z < M.overallDepth; z += STEP) {
    alongX.push({ origin: { x: -FAR, y: y + OFF / 3, z: z + OFF }, dir: PLUS_X, where: `y=${(y + OFF / 3).toFixed(3)} z=${(z + OFF).toFixed(3)}` })
  }
}
scan('horizontal along X', alongX, STEP)

const alongZ: Array<{ origin: Vec3; dir: Vec3; where: string }> = []
for (let y = 0.05; y < M.ridge; y += STEP) {
  for (let x = 0; x < M.overallWidth; x += STEP) {
    alongZ.push({ origin: { x: x + OFF, y: y + OFF / 3, z: -FAR }, dir: PLUS_Z, where: `y=${(y + OFF / 3).toFixed(3)} x=${(x + OFF).toFixed(3)}` })
  }
}
scan('horizontal along Z', alongZ, STEP)

/** Contact reports for the interfaces that are meant to be tight. */
const pick = (fn: (t: BuildingTri) => boolean): BuildingTri[] => solid.filter(fn)
const groundMainWalls = pick((t) => t.storeyId === IDS.groundMain && t.elementKind === 'WALL')
const atticWalls = pick((t) => t.storeyId === IDS.attic && t.elementKind === 'WALL')
const garageWalls = pick((t) => t.storeyId === IDS.garage && t.elementKind === 'WALL')
const slab = pick((t) => t.elementId === IDS.slab)
const gableRoof = r.tris.filter((t) => t.elementId === IDS.gableRoof)
const flatRoof = r.tris.filter((t) => t.elementId === IDS.flatRoof)

console.log('\n--- interfaces meant to be in contact')
const report = (
  name: string,
  lower: readonly BuildingTri[],
  upper: readonly BuildingTri[],
  origins: Array<{ origin: Vec3; label: string }>,
  dir: Vec3,
): void => {
  const rep = measureContact(lower, upper, origins, dir)
  console.log(
    `  ${name.padEnd(34)} ${rep.samples.length} lines   max void ${rep.maxVoidM.toExponential(3)} m` +
      `   max overlap ${rep.maxOverlapM.toExponential(3)} m   missing ${rep.missing.length}`,
  )
  if (rep.maxVoidM > 1e-5) console.log(`      worst void at ${rep.worstVoid}`)
  if (rep.maxOverlapM > 1e-5) console.log(`      worst overlap at ${rep.worstOverlap}`)
}

const t = M.wallThickness
const vLines = (xs: number[], zs: number[]): Array<{ origin: Vec3; label: string }> =>
  xs.flatMap((x) => zs.map((z) => ({ origin: { x, y: -FAR, z }, label: `x=${x.toFixed(3)} z=${z.toFixed(3)}` })))

// Ground walls under the attic walls: the storey stack.
report('ground wall -> attic wall', groundMainWalls, atticWalls, vLines([t / 2, MAIN.maxX - t / 2], [1.5, 4.0, 6.3, 8.5, 11.1]), UP)
// Attic walls under the main roof: the eave, closed in STAGE WEB-PIVOT-02A.
report('attic wall -> gable roof', atticWalls, gableRoof, vLines([0.02, t / 2, t - 0.02, MAIN.maxX - t + 0.02, MAIN.maxX - t / 2, MAIN.maxX - 0.02], [1.5, 6.3, 11.1]), UP)
// Garage walls under the flat roof.
report('garage wall -> flat roof', garageWalls, flatRoof, vLines([GARAGE.minX + t / 2, GARAGE.maxX - t / 2], [GARAGE.minZ + 1.0, 8.5, GARAGE.maxZ - 1.0]), UP)
// The floor plate sits *inside* the wall ring and the garage wing stands
// *beside* the main body, so neither is above the other: the signed-gap oracle,
// which assumes one solid then the other along the ray, does not apply. What
// does apply is continuity — a horizontal line that crosses both must find one
// unbroken run of material, with the element order it is supposed to have.
const continuity = (
  name: string,
  origins: Array<{ origin: Vec3; label: string }>,
  dir: Vec3,
  expect: { from: number; to: number },
): void => {
  let worstGap = 0
  let where = '(none)'
  for (const o of origins) {
    const runs = materialRuns(solid, o.origin, dir).map((i) => ({ t0: i.t0 - FAR, t1: i.t1 - FAR }))
    const covering = runs.filter((i) => i.t1 > expect.from + 1e-9 && i.t0 < expect.to - 1e-9)
    for (let i = 0; i + 1 < covering.length; i++) {
      const gap = covering[i + 1].t0 - covering[i].t1
      if (gap > worstGap) {
        worstGap = gap
        where = `${o.label} between ${covering[i].t1.toFixed(3)} and ${covering[i + 1].t0.toFixed(3)}`
      }
    }
    if (covering.length === 0) {
      worstGap = Infinity
      where = `${o.label}: no material at all`
    }
  }
  console.log(
    `  ${name.padEnd(34)} ${origins.length} lines   largest break across ${expect.from}..${expect.to} m: ` +
      `${worstGap.toExponential(3)} m${worstGap > 1e-5 ? `  at ${where}` : ''}`,
  )
}

const hLines = (ys: number[], zs: number[]): Array<{ origin: Vec3; label: string }> =>
  ys.flatMap((y) => zs.map((z) => ({ origin: { x: -FAR, y, z }, label: `y=${y.toFixed(3)} z=${z.toFixed(3)}` })))
// Across the main body at the floor plate's own level: left wall, plate, right wall.
continuity('ground walls + floor plate', hLines([M.upperFfl - M.slabThickness / 2], [1.5, 4.0, 6.3, 8.5, 11.1]), PLUS_X, {
  from: MAIN.minX,
  to: MAIN.maxX,
})
// Across both wings at garage-wall height: main ring, then garage ring, no seam.
// Only the seam itself: the rooms either side of it are meant to be empty.
continuity('main body + garage wing seam', hLines([0.5, 1.4, 2.3], [GARAGE.minZ + 1.0, 8.5, GARAGE.maxZ - 1.0]), PLUS_X, {
  from: MAIN.maxX - t,
  to: GARAGE.minX + t,
})

console.log('\ndone — nothing above is a change to any compiler.')
