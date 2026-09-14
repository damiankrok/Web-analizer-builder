/**
 * STAGE WEB-PIVOT-05A diagnostic — development only.
 *
 *   npx tsx scripts/marcowki-roof-features-diagnostic.ts [outDir]
 *   (default out/marcowki-roof-features)
 *
 * The console half is the audit: the slab reconciliation, the rooflight
 * inventory and its cuts, the room under each unit, the chimney inventory and
 * its penetrations, the roof-regression readings and the whole-house interface
 * audit. Every number comes from `tests/roof-feature-oracles.ts`, which reads
 * the emitted triangles and never asks a compiler what it meant.
 *
 * The drawn half is the ten views §20 asks for, rasterised by this repository's
 * own software renderer from the same triangle list.
 *
 * One convention runs through all of it: a hole in a sloped plane is a vertical
 * cut, so every probe through one is a vertical ray. See the note at the head
 * of `tests/marcowki-roof-features.test.ts`.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import {
  chimneyFootprint,
  finishFloorAreaM2,
  marcowkiGoldScene,
  resolvedFinishFloor,
  resolvedStructuralSlab,
  roofFeaturesGold,
  roofPlaneFrames,
  rooflightRoomBelow,
} from '../src/core/wallspec/marcowki-roof-features-fixture.js'
import type { SceneTri } from '../src/core/wallspec/marcowki-facade-fixture.js'
import type { RoofOpeningSpec, RoofPlaneFrame } from '../src/core/wallspec/roof.js'
import type { BuildPart, BuildTri } from '../src/core/hypotheses/solid.js'
import { shadePerspective, shadeOrthographic, DEFAULT_SHADE } from '../src/core/camera/shade.js'
import {
  lookAt,
  DEFAULT_NEAR,
  intrinsicsFromFovY,
  projectOrtho,
  type CameraView,
  type OrthographicView,
} from '../src/core/camera/projector.js'
import { deg2rad, v3add, type Vec3 } from '../src/core/math/vec.js'
import { drawText } from './plan-font.js'
import {
  chimneyClearanceM,
  chimneyPenetrationReport,
  elementTrisOf,
  openingPlanRect,
  roofOpeningCutReport,
  roomAt,
} from '../tests/roof-feature-oracles.js'
import { axisGrid, duplicateVolumeReport } from '../tests/facade-oracles.js'
import { materialRuns, type OTri } from '../tests/geometry-oracles.js'

const outDir = process.argv[2] ?? 'out/marcowki-roof-features'
mkdirSync(outDir, { recursive: true })
const W = 1280
const H = 860
const f3 = (x: number): string => (Number.isFinite(x) ? x.toFixed(3) : '   n/a')

const write = (name: string, img: { width: number; height: number; data: Uint8ClampedArray }): void => {
  const p = new PNG({ width: img.width, height: img.height })
  p.data = Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length)
  writeFileSync(join(outDir, `${name}.png`), PNG.sync.write(p))
}

const scene = marcowkiGoldScene()
const before = marcowkiGoldScene({ revertSlabFootprint: true })
const frames = roofPlaneFrames(scene.spec.building)
const openings = scene.spec.building.roofOpenings ?? []
const masses = scene.spec.building.masses ?? []
const rectOf = (o: RoofOpeningSpec) => {
  const t = o.cutToleranceM ?? 0
  return {
    u0: o.centerUV.u - o.sizeUV.u / 2 - t,
    u1: o.centerUV.u + o.sizeUV.u / 2 + t,
    v0: o.centerUV.v - o.sizeUV.v / 2 - t,
    v1: o.centerUV.v + o.sizeUV.v / 2 + t,
  }
}
const frameOf = (o: RoofOpeningSpec): RoofPlaneFrame => frames.get(o.hostPlaneId)!

// --- console audit -----------------------------------------------------------

console.log(`STAGE WEB-PIVOT-05A — Marcowki roof features, from ${roofFeaturesGold.id} (${roofFeaturesGold.schemaVersion})`)
console.log(`${scene.tris.length} triangles; ${scene.diagnostics.length} diagnostics`)
for (const d of scene.diagnostics) console.log(`  ${d.layer} ${d.severity} ${d.code} ${d.message}`)

console.log('\n== §5 upper floor slab ==')
const structural = resolvedStructuralSlab()
const finish = resolvedFinishFloor()
const conflict = roofFeaturesGold.upperSlab.conflict
console.log(`shell polygon     x ${f3(conflict.shellPolygon.minX)}..${f3(conflict.shellPolygon.maxX)}  z ${f3(conflict.shellPolygon.minZ)}..${f3(conflict.shellPolygon.maxZ)}`)
console.log(`interior polygon  x ${f3(conflict.interiorPolygon.minX)}..${f3(conflict.interiorPolygon.maxX)}  z ${f3(conflict.interiorPolygon.minZ)}..${f3(conflict.interiorPolygon.maxZ)}`)
console.log(`accepted plate    x ${f3(structural.minX)}..${f3(structural.maxX)}  z ${f3(structural.minZ)}..${f3(structural.maxZ)}   verdict ${roofFeaturesGold.upperSlab.resolution.verdict}`)
const stacks = roofFeaturesGold.chimneys.stacks.map((s) => chimneyFootprint(s))
const stairVoid = { minX: 5.37, maxX: 7.45, minZ: 6.79, maxZ: 8.77 }
const plateArea = (structural.maxX - structural.minX) * (structural.maxZ - structural.minZ)
console.log(`plate ${f3(plateArea)} m2, walkable floor ${f3(finishFloorAreaM2(stairVoid, stacks))} m2 (less the stair void and ${finish.standingOn.length} stacks)`)
const plate = elementTrisOf(scene.tris, 'slab_upper_floor')
const upAt = (tris: readonly OTri[], x: number, z: number): number =>
  materialRuns(tris, { x, y: -40, z }, { x: 0, y: 1, z: 0 }, 1e-7).reduce((a, r) => a + (r.t1 - r.t0), 0)
console.log(`vertical probe: in the stair void ${f3(upAt(plate, 6.4, 7.8))} m, a metre clear of it ${f3(upAt(plate, 2.0, 2.0))} m`)

console.log('\n== §6/§8 rooflights ==')
console.log('id             plane                       plan x            plan z            through beside  reveals  fill  stray')
for (const o of openings.filter((x) => x.kind === 'ROOFLIGHT')) {
  const r = roofOpeningCutReport(scene.tris, frameOf(o), o.id, rectOf(o))
  const b = openingPlanRect(frameOf(o), rectOf(o))
  console.log(
    `${o.id.padEnd(14)} ${o.hostPlaneId.padEnd(27)} ${f3(b.minX)}..${f3(b.maxX)}  ${f3(b.minZ)}..${f3(b.maxZ)}  ` +
      `${f3(r.throughM).padStart(7)} ${f3(r.besideMinM).padStart(6)} ${String(r.revealTriangles).padStart(7)} ${f3(r.fillM)} ${f3(r.strayFillM)}`,
  )
}

console.log('\n== §9 rooflight -> room below ==')
console.log('rooflight      roof plane                   local UV           room below   found        verdict')
const upperRooms = scene.spec.interior.rooms.filter((r) => r.levelId === 'upper')
for (const row of rooflightRoomBelow()) {
  const o = openings.find((x) => x.id === row.id)!
  const b = openingPlanRect(frameOf(o), rectOf(o))
  const found = roomAt(upperRooms, (b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2)
  console.log(
    `${row.id.padEnd(14)} ${row.planeId.padEnd(28)} u ${f3(o.centerUV.u)} v ${f3(o.centerUV.v)}  ` +
      `${row.roomId.padEnd(12)} ${String(found).padEnd(12)} ${found === row.roomId ? 'MATCH' : 'WRONG_ROOM'}`,
  )
}

console.log('\n== §10/§12 chimneys ==')
for (const m of masses) {
  const r = chimneyPenetrationReport(scene.tris, m.id, m.footprint, m.baseM, m.topM)
  const gaps = (['minX', 'maxX', 'minZ', 'maxZ'] as const).map((s) => chimneyClearanceM(scene.tris, m.id, m.footprint, s))
  console.log(
    `${m.id.padEnd(16)} ${m.kind}  x ${f3(m.footprint.minX)}..${f3(m.footprint.maxX)}  z ${f3(m.footprint.minZ)}..${f3(m.footprint.maxZ)}  ` +
      `y ${f3(m.baseM)}..${f3(m.topM)}  penetrates ${m.penetratesRoofIds.join(', ')}`,
  )
  console.log(
    `   continuous ${r.continuous}, shortest run ${f3(r.minRunM)} m, roof inside ${f3(r.roofInsideM)} m, roof beside ${f3(r.roofBesideM)} m, ` +
      `worst overlap ${f3(Math.max(...r.sections.map((s) => s.overlapM)))} m, clearance ${gaps.map(f3).join(' / ')} m`,
  )
}

console.log('\n== §13 roof regression ==')
const roof = scene.spec.building.roofs.find((r) => r.id === 'roof_main_gable')!
const compiledRoof = scene.building.roofs.find((r) => r.roofId === 'roof_main_gable')!
console.log(
  `declared pitch ${f3(roof.pitchDeg ?? NaN)}, built ${f3(compiledRoof.builtPitchDeg)}, eave ${f3(compiledRoof.eaveM)}, ridge ${f3(compiledRoof.ridgeM)}, ` +
    `overhang ${f3(roof.overhangM)}, thickness ${f3(roof.thicknessM)}, footprint x ${f3(roof.footprint.minX)}..${f3(roof.footprint.maxX)} z ${f3(roof.footprint.minZ)}..${f3(roof.footprint.maxZ)}`,
)
const holes = openings.map((o) => openingPlanRect(frameOf(o), rectOf(o)))
const fabric: OTri[] = scene.tris.filter((t) => t.part === 'ROOF' || t.part === 'ROOF_REVEAL').map((t) => ({ a: t.a, b: t.b, c: t.c }))
let gaps = 0
for (let i = 1; i < 40; i++) {
  for (let j = 1; j < 40; j++) {
    const x = (7.9 * (i + 0.37)) / 40
    const z = -1 + (14.6 * (j + 0.21)) / 40
    if (holes.some((h) => x > h.minX && x < h.maxX && z > h.minZ && z < h.maxZ)) continue
    if (upAt(fabric, x, z) < 0.2) gaps++
  }
}
console.log(`roof continuity away from its registered holes: ${gaps} gap(s) in 1521 vertical probes`)

console.log('\n== §17 whole-house interface audit ==')
const byElement = new Map<string, OTri[]>()
for (const t of scene.tris) {
  if (!t.solid) continue
  const k = `${t.layer}:${t.elementId}`
  const l = byElement.get(k) ?? []
  l.push({ a: t.a, b: t.b, c: t.c })
  byElement.set(k, l)
}
const dup = duplicateVolumeReport(
  [...byElement].map(([id, tris]) => ({ id, tris })),
  axisGrid({ minX: 0, maxX: 12.05, minY: 0, maxY: 8.2, minZ: -1, maxZ: 13.6 }),
)
console.log(`${byElement.size} solid elements, ${dup.length} pairs sharing material`)
for (const d of dup.slice(0, 8)) console.log(`   ${d.a} | ${d.b} = ${f3(d.lengthM)} m`)

console.log('\n== assumptions and unresolved ==')
for (const u of roofFeaturesGold.unresolved) console.log(`  UNRESOLVED  ${u}`)
for (const u of roofFeaturesGold.observedButNotModelled) console.log(`  NOT MODELLED  ${u}`)

// --- the ten views -----------------------------------------------------------

const PART_OF: Record<string, BuildPart> = {
  WALL: 'WALL',
  WALL_INNER: 'WALL_INNER',
  REVEAL: 'REVEAL',
  SLAB: 'SLAB',
  ROOF: 'ROOF',
  ROOF_SOFFIT: 'ROOF_SOFFIT',
  ROOF_REVEAL: 'REVEAL',
  ROOF_FRAME: 'FEATURE',
  ROOF_GLAZING: 'GLAZING',
  GLAZING: 'GLAZING',
  GLASS: 'GLAZING',
  DOOR_PANEL: 'FEATURE',
  GARAGE_PANEL: 'FEATURE',
  FRAME: 'FEATURE',
  RAILING_GLASS: 'RAILING',
  RAILING_RAIL: 'FEATURE',
  STAIR: 'FEATURE',
  MASS: 'FEATURE',
}
const renderable = (tris: readonly SceneTri[]): BuildTri[] =>
  tris
    .filter((t) => PART_OF[t.part] !== undefined)
    .map((t) => ({ a: t.a, b: t.b, c: t.c, ownerId: t.elementId, part: PART_OF[t.part], massId: t.elementId, storeyId: t.layer }))

const exterior = renderable(scene.tris.filter((t) => t.layer !== 'INTERIOR'))
const everything = renderable(scene.tris)
const roofOff = renderable(scene.tris.filter((t) => t.part !== 'ROOF' && t.part !== 'ROOF_SOFFIT' && t.part !== 'ROOF_REVEAL'))
const centre: Vec3 = { x: 6.025, y: 3.6, z: 6.3 }

const view = (azDeg: number, elDeg: number, dist: number, fovDeg = 30, target: Vec3 = centre): CameraView => {
  const az = deg2rad(azDeg)
  const el = deg2rad(elDeg)
  const eye = v3add(target, {
    x: Math.sin(az) * Math.cos(el) * dist,
    y: Math.sin(el) * dist,
    z: Math.cos(az) * Math.cos(el) * dist,
  })
  return { intrinsics: intrinsicsFromFovY(deg2rad(fovDeg), W, H), extrinsics: lookAt(eye, target), width: W, height: H, near: DEFAULT_NEAR }
}

function ortho(right: Vec3, up: Vec3, origin: Vec3, spanAcross: number, spanUp: number): OrthographicView {
  const margin = 0.6
  const scale = Math.min(W / (spanAcross + 2 * margin), H / (spanUp + 2 * margin))
  return { right, up, scale, origin, originU: margin * scale, originV: H - margin * scale, width: W, height: H }
}
const X: Vec3 = { x: 1, y: 0, z: 0 }
const Z: Vec3 = { x: 0, y: 0, z: 1 }
const NZ: Vec3 = { x: 0, y: 0, z: -1 }
const Y: Vec3 = { x: 0, y: 1, z: 0 }
const TOP = ortho(X, NZ, { x: -0.3, y: 30, z: 14.0 }, 12.7, 15.2)
const shade = { ...DEFAULT_SHADE, groundPlane: true }

const label = (img: { width: number; height: number; data: Uint8ClampedArray }, lines: readonly string[], scale = 2): typeof img => {
  const put = (x: number, y: number, r: number, g: number, b: number): void => {
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) return
    const i = (y * img.width + x) * 4
    img.data[i] = r
    img.data[i + 1] = g
    img.data[i + 2] = b
  }
  lines.forEach((l, i) => drawText(put, l.toUpperCase(), 12, 12 + i * (8 * scale), scale, [40, 42, 46]))
  return img
}

function marks(
  img: { width: number; height: number; data: Uint8ClampedArray },
  v: OrthographicView,
  items: ReadonlyArray<{ at: Vec3; text: string }>,
): typeof img {
  const put = (x: number, y: number, r: number, g: number, b: number): void => {
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) return
    const i = (y * img.width + x) * 4
    img.data[i] = r
    img.data[i + 1] = g
    img.data[i + 2] = b
  }
  for (const m of items) {
    const p = projectOrtho(m.at, v)
    for (let d = -4; d <= 4; d++) {
      put(Math.round(p.u) + d, Math.round(p.v), 200, 60, 50)
      put(Math.round(p.u), Math.round(p.v) + d, 200, 60, 50)
    }
    drawText(put, m.text.toUpperCase(), Math.round(p.u) + 7, Math.round(p.v) - 4, 1, [150, 30, 24])
  }
  return img
}

const openingMarks = openings.map((o) => {
  const b = openingPlanRect(frameOf(o), rectOf(o))
  return { at: { x: (b.minX + b.maxX) / 2, y: 8.2, z: (b.minZ + b.maxZ) / 2 }, text: o.id.replace(/_penetration$/, '') }
})

write('01-roof-top-ids', marks(label(shadeOrthographic(exterior, [], TOP, W, H, shade), ['01 roof from above: rooflight and penetration ids']), TOP, openingMarks))
write('02-roof-oblique-west', label(shadePerspective(exterior, [], view(-52, 34, 26), W, H, shade), ['02 west roof oblique: two rooflights over pralnia and lazienka']))
write('03-roof-oblique-east', label(shadePerspective(exterior, [], view(66, 32, 26), W, H, shade), ['03 east roof oblique: one rooflight over the stair, two stacks']))
write('04-attic-underside', label(shadePerspective(roofOff, [], view(24, 52, 28, 32), W, H, shade), ['04 roof off: the attic rooms the units open into']))
write('05-rooflight-closeup', label(shadePerspective(everything, [], view(-64, 26, 9, 32, { x: 1.1, y: 5.2, z: 6.0 }), W, H, shade), ['05 rooflight cut: reveal, frame and pane in a hole', 'through the full roof thickness']))
write('06-chimney-closeup', label(shadePerspective(exterior, [], view(72, 20, 11, 32, { x: 5.8, y: 6.6, z: 4.7 }), W, H, shade), ['06 chimney: the roof terminates at the stack']))
write('07-chimney-section', label(shadePerspective(roofOff, [], view(96, 8, 12, 30, { x: 5.8, y: 5.6, z: 4.7 }), W, H, shade), ['07 chimney with the roof removed: one unbroken shaft', 'from the attic floor to 7.88']))
write('08-slab-before', label(shadePerspective(renderable(before.tris.filter((t) => t.layer !== 'FACADE')), [], view(18, 40, 26, 32), W, H, shade), ['08 upper slab on the interior outline (rejected):', 'the plate runs into the wall head']))
write('09-slab-after', label(shadePerspective(renderable(scene.tris.filter((t) => t.layer !== 'FACADE')), [], view(18, 40, 26, 32), W, H, shade), ['09 upper slab on the bearing rectangle (accepted):', 'plate to the wall inner face, stair void open']))
write('10-front-three-quarter', label(shadePerspective(exterior, [], view(28, 16, 30), W, H, shade), ['10 the finished house, front three-quarter']))
write('11-rear-three-quarter', label(shadePerspective(exterior, [], view(205, 17, 30), W, H, shade), ['11 the finished house, rear three-quarter']))

console.log(`\nwrote 11 views to ${outDir}`)
