/**
 * STAGE WEB-PIVOT-05 diagnostic — development only.
 *
 *   npx tsx scripts/marcowki-facade-diagnostic.ts [outDir]   (default out/marcowki-facade)
 *
 * Everything this stage claims, printed and drawn.
 *
 * The console half is the audit: the opening inventory and its cuts, the two
 * recesses measured from outside, the balcony slabs, the balustrades, the
 * portal, the raked gable polygons, the four orthographic elevations against
 * their source anchors, the plan slices against the plan raster, and the room
 * behind every opening. Every number comes from `tests/facade-oracles.ts`,
 * which reads the emitted triangles and never asks a compiler what it meant.
 *
 * The drawn half is the twelve views §24 asks for, rasterised by this
 * repository's own software renderer from the same triangle list. No browser,
 * no product UI and no photographic texture is involved, and the model is the
 * whole house: shell, interior and facade compiled together.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import {
  facadeGold,
  marcowkiFacadeScene,
  type SceneTri,
} from '../src/core/wallspec/marcowki-facade-fixture.js'
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
  anchorCheck,
  axisGrid,
  duplicateVolumeReport,
  facadeDepthMap,
  nearestAt,
  openingCutReport,
  openingRoomTable,
  planScan,
  portalReport,
  railingReport,
  rakedHeadReport,
  recessReport,
  silhouette,
  slabReport,
  type FacadeView,
} from '../tests/facade-oracles.js'
import { materialRuns, type OTri } from '../tests/geometry-oracles.js'

const outDir = process.argv[2] ?? 'out/marcowki-facade'
mkdirSync(outDir, { recursive: true })
const W = 1280
const H = 860
const f3 = (x: number): string => (Number.isFinite(x) ? x.toFixed(3) : '   n/a')

const write = (name: string, img: { width: number; height: number; data: Uint8ClampedArray }): void => {
  const p = new PNG({ width: img.width, height: img.height })
  p.data = Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length)
  writeFileSync(join(outDir, `${name}.png`), PNG.sync.write(p))
}

// --- the model ---------------------------------------------------------------

const scene = marcowkiFacadeScene()
const walls = new Map(scene.spec.building.walls.map((w) => [w.id, w]))
const facade = scene.spec.facade
const exterior = facade.openings.filter((o) => o.exposure === 'EXTERIOR')

/**
 * The study renderer's palette, applied to the three layers' own part names.
 *
 * Only the nine `BuildPart` materials exist, so a facade fill is glass, a door
 * leaf and a garage panel are the feature material and a balustrade is the
 * railing material. §20 asks for exactly this much: solid, glass, frame, panel
 * and a portal material class, and nothing photographic.
 */
const PART_OF: Record<string, BuildPart> = {
  WALL: 'WALL',
  WALL_INNER: 'WALL_INNER',
  REVEAL: 'REVEAL',
  SLAB: 'SLAB',
  ROOF: 'ROOF',
  ROOF_SOFFIT: 'ROOF_SOFFIT',
  GLAZING: 'GLAZING',
  GLASS: 'GLAZING',
  DOOR_PANEL: 'FEATURE',
  GARAGE_PANEL: 'FEATURE',
  FRAME: 'FEATURE',
  RAILING_GLASS: 'RAILING',
  RAILING_RAIL: 'FEATURE',
  STAIR: 'FEATURE',
}

const renderable = (tris: readonly SceneTri[]): BuildTri[] =>
  tris
    .filter((t) => PART_OF[t.part] !== undefined)
    .map((t) => ({ a: t.a, b: t.b, c: t.c, ownerId: t.elementId, part: PART_OF[t.part], massId: t.elementId, storeyId: t.layer }))

/**
 * The exterior views draw the shell and the facade; the roof-off view draws all
 * three layers.
 *
 * Not because the interior is uncertain — `_poke` probes in the audit above
 * compare every interior wall top against the roof underside measured by ray
 * and find nothing above it anywhere — but because this repository's software
 * rasteriser loses depth precision at a 30 m eye distance and paints a handful
 * of attic partitions over the roof they sit half a metre under. That is the
 * renderer, not the model, and the honest way to show it is to draw the
 * exterior in the exterior views and the interior in the view that takes the
 * roof off.
 */
const all = renderable(scene.tris.filter((t) => t.layer !== 'INTERIOR'))
const roofOff = renderable(scene.tris.filter((t) => t.part !== 'ROOF' && t.part !== 'ROOF_SOFFIT'))

const centre: Vec3 = { x: 6.025, y: 3.6, z: 6.3 }

const view = (azDeg: number, elDeg: number, dist: number, fovDeg = 30, target: Vec3 = centre): CameraView => {
  const az = deg2rad(azDeg)
  const el = deg2rad(elDeg)
  const eye = v3add(target, {
    x: Math.sin(az) * Math.cos(el) * dist,
    y: Math.sin(el) * dist,
    z: Math.cos(az) * Math.cos(el) * dist,
  })
  return {
    intrinsics: intrinsicsFromFovY(deg2rad(fovDeg), W, H),
    extrinsics: lookAt(eye, target),
    width: W,
    height: H,
    near: DEFAULT_NEAR,
  }
}

/** An orthographic elevation: `right` across the page, `up` up it. */
function elevation(right: Vec3, up: Vec3, origin: Vec3, spanAcross: number, spanUp: number): OrthographicView {
  const margin = 0.6
  const scale = Math.min(W / (spanAcross + 2 * margin), H / (spanUp + 2 * margin))
  return { right, up, scale, origin, originU: margin * scale, originV: H - margin * scale, width: W, height: H }
}

const X: Vec3 = { x: 1, y: 0, z: 0 }
const NX: Vec3 = { x: -1, y: 0, z: 0 }
const Z: Vec3 = { x: 0, y: 0, z: 1 }
const NZ: Vec3 = { x: 0, y: 0, z: -1 }
const Y: Vec3 = { x: 0, y: 1, z: 0 }

// A view's origin is the world point that lands at the bottom-left of the page,
// and it is placed *in front of* the model so that every depth is positive.
const FRONT_VIEW = elevation(X, Y, { x: 0, y: -0.4, z: 24 }, 12.05, 8.4)
const REAR_VIEW = elevation(NX, Y, { x: 12.05, y: -0.4, z: -24 }, 12.05, 8.4)
const WEST_VIEW = elevation(Z, Y, { x: -24, y: -0.4, z: -1.0 }, 14.6, 8.4)
const EAST_VIEW = elevation(NZ, Y, { x: 24, y: -0.4, z: 13.6 }, 14.6, 8.4)

const shade = { ...DEFAULT_SHADE, groundPlane: true }

/** The window every depth map is sampled over: the whole site, generously. */
const VIEW_BOUNDS = { acrossFromM: -1.5, acrossToM: 14.1, upFromM: -0.5, upToM: 8.5 }

// --- console audit -----------------------------------------------------------

console.log(`STAGE WEB-PIVOT-05 — Marcowki characteristic facade, from ${facadeGold.id} (${facadeGold.schemaVersion})`)
console.log(
  `${scene.tris.length} triangles (shell ${scene.building.tris.length}, interior ${scene.interior.tris.length}, ` +
    `facade ${scene.facade.tris.length}); ${scene.diagnostics.length} diagnostics`,
)
for (const d of scene.diagnostics) console.log(`  ${d.layer} ${d.severity} ${d.code} ${d.message}`)

console.log('\n== §5/§7 opening inventory and cuts ==')
console.log('opening                    facade        host wall            printed   through  beside   above    fill  reveal m2')
for (const o of facade.openings) {
  const r = openingCutReport(scene.tris, walls, o)
  for (const l of r.leaves) {
    const first = l.hostWallId === o.hostWallId
    console.log(
      `${(first ? o.id : '  (far leaf)').padEnd(26)} ${(first ? `${o.facade}/${o.exposure === 'CONCEALED' ? 'hidden' : 'seen'}` : '').padEnd(13)} ` +
        `${l.hostWallId.padEnd(20)} ${(first ? (o.printed ?? '-') : '').padEnd(9)} ${f3(l.throughM).padStart(7)} ` +
        `${f3(l.besideM).padStart(7)} ${f3(l.aboveM).padStart(7)} ${(first ? f3(r.fillM) : '').padStart(7)} ${(first ? f3(r.revealAreaM2) : '').padStart(9)}`,
    )
  }
}

console.log('\n== §9/§10 recesses, measured from outside ==')
for (const r of facade.recesses) {
  const rep = recessReport(scene.tris, r, [0.4, 1.2, 2.0])
  console.log(
    `${r.id.padEnd(14)} stated ${f3(rep.statedDepthM)} m  open at the mouth ${(100 * rep.openAtMouth).toFixed(0)}%  ` +
      `shallowest ${f3(rep.minDepthM)} m  samples nearer than stated ${rep.nearerThanStated}/${rep.samples.length}`,
  )
}
console.log('front elevation, nearest surface along Z (13.60 is the outer plane, 12.60 the wall):')
for (const x of [0.305, 1.5, 3.0, 5.0, 7.0, 7.595, 9.0, 11.745]) {
  console.log(
    `   x ${f3(x)}   y 1.20 -> ${f3(nearestAt(facadeDepthMap(scene.tris, 'FRONT', VIEW_BOUNDS), x, 1.2) ?? NaN)}` +
      `   y 3.50 -> ${f3(nearestAt(facadeDepthMap(scene.tris, 'FRONT', VIEW_BOUNDS), x, 3.5) ?? NaN)}`,
  )
}

console.log('\n== §11 balcony and portal-head slabs ==')
for (const s of facade.slabs) {
  const rep = slabReport(scene.tris, s.id, s.footprint)
  const want = (s.footprint.maxX - s.footprint.minX) * (s.footprint.maxZ - s.footprint.minZ) * s.thicknessM
  console.log(
    `${s.id.padEnd(20)} ${s.kind.padEnd(12)} volume ${f3(rep.volumeM3)} m3 (stated ${f3(want)})  ` +
      `top ${f3(rep.topM ?? NaN)}  soffit ${f3(rep.bottomM ?? NaN)}  footprint covered ${(100 * rep.coverage).toFixed(0)}%`,
  )
}

console.log('\n== §12 balustrades ==')
for (const r of facade.railings) {
  const rep = railingReport(scene.tris, r)
  console.log(
    `${r.id.padEnd(16)} ${rep.panels} panels  glass ${f3(rep.glassLengthM)} m over ${f3(rep.measuredToM - rep.measuredFromM)} m  ` +
      `daylight between panels ${f3(rep.gapLengthM)} m  base ${f3(rep.baseM ?? NaN)}  top ${f3(rep.topM ?? NaN)}  all glass: ${rep.allGlass}`,
  )
}

console.log('\n== §13 portal ==')
for (const p of facade.portals) {
  const rep = portalReport(scene.tris, p)
  console.log(
    `${p.id}: mouth x ${f3(p.openingMinM)}..${f3(p.openingMaxM)} y ${f3(p.openingBaseM)}..${f3(p.openingTopM)} at z ${f3(p.outerPlaneM)}, ` +
      `${p.depthM} m deep, material class ${p.materialClass}`,
  )
  console.log(
    `   blocked samples ${rep.blockedSamples}/${rep.totalSamples}  jambs ${rep.jambMaterialM.map(f3).join(' / ')} m  ` +
      `head ${f3(rep.headMaterialM)} m  measured depth ${f3(rep.measuredDepthM ?? NaN)} m`,
  )
}

console.log('\n== §17 raked gable openings, against the printed polygon ==')
const TAN40 = Math.tan((40 * Math.PI) / 180)
const SOURCE_HEAD: Record<string, (f: number) => number> = {
  og_front_gable_glazing: (f) => 3.2 - f * 2.7 * TAN40,
  og_rear_gable_east: (f) => 3.03 - (1 - f) * 2.34 * TAN40,
  og_rear_gable_west: (f) => 3.03 - f * 2.34 * TAN40,
}
for (const [id, head] of Object.entries(SOURCE_HEAD)) {
  const o = facade.openings.find((x) => x.id === id)
  if (o === undefined) continue
  const rep = rakedHeadReport(scene.tris, walls.get(o.hostWallId)!, o, head)
  console.log(
    `${id.padEnd(26)} worst head error ${rep.maxHeadErrorM.toExponential(2)} m  least wall above the head ${f3(rep.minClosedAboveM)} m  ` +
      `glass outside the polygon ${f3(rep.strayGlassM)} m`,
  )
}

console.log('\n== §21 orthographic elevations ==')
const maps = new Map<FacadeView, ReturnType<typeof facadeDepthMap>>()
for (const v of ['FRONT', 'REAR', 'EAST', 'WEST'] as FacadeView[]) {
  const m = facadeDepthMap(scene.tris, v, VIEW_BOUNDS)
  maps.set(v, m)
  const s = silhouette(m)
  console.log(
    `${v.padEnd(6)} silhouette across ${f3(s.acrossFromM)}..${f3(s.acrossToM)} (${f3(s.acrossToM - s.acrossFromM)} m), ` +
      `up ${f3(s.upFromM)}..${f3(s.upToM)} (${f3(s.upToM - s.upFromM)} m)`,
  )
}
console.log('opening                    view    source rectangle                     open inside  open beside  verdict')
const VIEW_OF: Record<string, FacadeView> = { FRONT: 'FRONT', REAR: 'REAR', EAST: 'EAST', WEST: 'WEST', NORTH_GARAGE: 'REAR' }
for (const o of exterior) {
  const w = walls.get(o.hostWallId)!
  const v = VIEW_OF[o.facade]
  const flat = v === 'FRONT' || v === 'REAR'
  const p0 = { x: w.origin.x + w.u.x * o.offsetM, z: w.origin.z + w.u.z * o.offsetM }
  const p1 = { x: w.origin.x + w.u.x * (o.offsetM + o.widthM), z: w.origin.z + w.u.z * (o.offsetM + o.widthM) }
  const a0 = flat ? Math.min(p0.x, p1.x) : Math.min(p0.z, p1.z)
  const a1 = flat ? Math.max(p0.x, p1.x) : Math.max(p0.z, p1.z)
  const lo = w.origin.y + o.sillM
  const hi = w.origin.y + Math.min(o.headM, o.headFarM ?? o.headM)
  const c = anchorCheck(maps.get(v)!, o.id, { acrossFromM: a0, acrossToM: a1, upFromM: lo, upToM: hi }, flat ? w.origin.z : w.origin.x)
  console.log(
    `${o.id.padEnd(26)} ${v.padEnd(6)}  ${f3(a0)}..${f3(a1)} x ${f3(lo)}..${f3(hi)}   ` +
      `${(100 * c.voidInside).toFixed(0).padStart(10)}%  ${(100 * c.voidAround).toFixed(0).padStart(10)}%  ${c.verdict}`,
  )
}

console.log('\n== §22 plan oracle: the model sliced the way the plans are sliced ==')
const show = (label: string, runs: ReturnType<typeof planScan>): void =>
  console.log(`${label.padEnd(34)} ${runs.map((r) => `${f3(r.fromM)}..${f3(r.toM)}`).join('   ') || '(nothing)'}`)
show('z = 13.10, y = 1.20 (front, ground)', planScan(scene.tris, 'X', 13.1, 1.2))
show('z = 12.30, y = 1.20 (front wall)', planScan(scene.tris, 'X', 12.3, 1.2))
show('z = -0.50, y = 1.20 (rear, ground)', planScan(scene.tris, 'X', -0.5, 1.2))
show('x = 0.305, y = 1.20 (west return)', planScan(scene.tris, 'Z', 0.305, 1.2))
show('x = 7.595, y = 1.20 (east, ground)', planScan(scene.tris, 'Z', 7.595, 1.2))
show('x = 7.595, y = 3.50 (east, attic)', planScan(scene.tris, 'Z', 7.595, 3.5))
show('z = 6.00, y = 1.20 (main / garage)', planScan(scene.tris, 'X', 6.0, 1.2))

console.log('\n== §8 the room behind every opening ==')
console.log('opening                    host wall            claims        found         verdict')
for (const r of openingRoomTable(scene.spec.interior, walls, facade.openings, (o) => (o.storey === 'GROUND' ? 'ground' : 'upper'))) {
  console.log(
    `${r.openingId.padEnd(26)} ${r.hostWallId.padEnd(20)} ${r.claimedRoomId.padEnd(13)} ${String(r.foundRoomId).padEnd(13)} ${r.verdict}`,
  )
}

console.log('\n== nothing stands above the roof it is under ==')
{
  const roofTris: OTri[] = scene.tris
    .filter((t) => t.elementId === 'roof_main_gable')
    .map((t) => ({ a: t.a, b: t.b, c: t.c }))
  const byId = new Map<string, OTri[]>()
  for (const t of scene.tris) {
    if (!t.solid || t.layer !== 'INTERIOR') continue
    const l = byId.get(t.elementId) ?? []
    l.push({ a: t.a, b: t.b, c: t.c })
    byId.set(t.elementId, l)
  }
  let worst = { over: -Infinity, id: '', at: '' }
  for (const [id, tris] of byId) {
    const xs = tris.flatMap((t) => [t.a.x, t.b.x, t.c.x])
    const zs = tris.flatMap((t) => [t.a.z, t.b.z, t.c.z])
    const [x0, x1] = [Math.min(...xs), Math.max(...xs)]
    const [z0, z1] = [Math.min(...zs), Math.max(...zs)]
    for (let i = 0; i <= 10; i++) {
      for (let j = 0; j <= 10; j++) {
        const x = x0 + ((x1 - x0) * (i + 0.5)) / 11
        const z = z0 + ((z1 - z0) * (j + 0.5)) / 11
        const w = materialRuns(tris, { x, y: -10, z }, { x: 0, y: 1, z: 0 }, 1e-7)
        const r = materialRuns(roofTris, { x, y: -10, z }, { x: 0, y: 1, z: 0 }, 1e-7)
        if (w.length === 0 || r.length === 0) continue
        const over = w[w.length - 1].t1 - r[0].t0
        if (over > worst.over) worst = { over, id, at: `(${f3(x)}, ${f3(z)})` }
      }
    }
  }
  console.log(
    `worst interior wall top against the roof underside: ${worst.over.toFixed(4)} m ` +
      `(${worst.id} at ${worst.at}) — negative is clearance`,
  )
}

console.log('\n== duplicate volume across every solid element of the house ==')
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
for (const d of dup.slice(0, 10)) console.log(`   ${d.a} | ${d.b} = ${f3(d.lengthM)} m`)

console.log('\n== assumptions and unresolved ==')
for (const u of facadeGold.unresolved) console.log(`  UNRESOLVED  ${u}`)
for (const u of facadeGold.observedButNotModelled) console.log(`  NOT MODELLED  ${u}`)

// --- the twelve views --------------------------------------------------------

const label = (
  img: { width: number; height: number; data: Uint8ClampedArray },
  lines: readonly string[],
  scale = 2,
): typeof img => {
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

write('01-ortho-front', label(shadeOrthographic(all, [], FRONT_VIEW, W, H, shade), ['01 front elevation (+z)', 'recess mouth x 0.61..11.44 at z 13.60, wall at z 12.60']))
write('02-ortho-rear', label(shadeOrthographic(all, [], REAR_VIEW, W, H, shade), ['02 rear elevation (-z)', 'balcony between the returns, two raked gable windows']))
write('03-ortho-left-west', label(shadeOrthographic(all, [], WEST_VIEW, W, H, shade), ['03 west elevation (-x), +z to the right', '14.60 m from z -1.00 to z 13.60']))
write('04-ortho-right-east', label(shadeOrthographic(all, [], EAST_VIEW, W, H, shade), ['04 east elevation (+x), +z to the left', 'garage on the left, 300/230 to the rear']))
write('05-front-three-quarter', label(shadePerspective(all, [], view(28, 14, 30), W, H, shade), ['05 front three-quarter']))
write('06-rear-three-quarter', label(shadePerspective(all, [], view(205, 15, 30), W, H, shade), ['06 rear three-quarter']))
write(
  '07-front-recess-closeup',
  label(shadePerspective(all, [], view(44, 10, 17, 30, { x: 2.8, y: 2.6, z: 11.6 }), W, H, shade), [
    '07 front recess: the west return projects 1.00 m,',
    'the wall behind it does not',
  ]),
)
write(
  '08-balcony-railing-closeup',
  label(shadePerspective(all, [], view(16, 9, 16, 30, { x: 5.4, y: 3.2, z: 11.4 }), W, H, shade), [
    '08 balcony and balustrade: four glass panels on a 0.55 m slab',
  ]),
)
write(
  '09-portal-closeup',
  label(shadePerspective(all, [], view(-18, 13, 22, 30, { x: 8.4, y: 1.6, z: 11.0 }), W, H, shade), [
    '09 entrance and garage portal: jambs are returns,',
    'head is the balcony slab and the portal head',
  ]),
)
write(
  '10-roof-off',
  label(shadePerspective(roofOff, [], view(24, 46, 30, 32), W, H, shade), [
    '10 roof off: rooms, openings and the two recesses',
  ]),
)

/** Ids drawn at the feature they name, projected through the same view. */
function idOverlay(
  img: { width: number; height: number; data: Uint8ClampedArray },
  v: OrthographicView,
  marks: ReadonlyArray<{ at: Vec3; text: string }>,
): typeof img {
  const put = (x: number, y: number, r: number, g: number, b: number): void => {
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) return
    const i = (y * img.width + x) * 4
    img.data[i] = r
    img.data[i + 1] = g
    img.data[i + 2] = b
  }
  for (const m of marks) {
    const p = projectOrtho(m.at, v)
    for (let dx = -3; dx <= 3; dx++) {
      put(Math.round(p.u) + dx, Math.round(p.v), 200, 60, 50)
      put(Math.round(p.u), Math.round(p.v) + dx, 200, 60, 50)
    }
    drawText(put, m.text.toUpperCase(), Math.round(p.u) + 6, Math.round(p.v) - 4, 1, [150, 30, 24])
  }
  return img
}

const openingMarks = (side: 'FRONT' | 'REAR'): Array<{ at: Vec3; text: string }> =>
  exterior
    .filter((o) => VIEW_OF[o.facade] === side || (side === 'FRONT' && o.facade === 'EAST') || (side === 'REAR' && o.facade === 'WEST'))
    .map((o) => {
      const w = walls.get(o.hostWallId)!
      const mid = o.offsetM + o.widthM / 2
      return {
        at: {
          x: w.origin.x + w.u.x * mid,
          y: w.origin.y + (o.sillM + Math.min(o.headM, o.headFarM ?? o.headM)) / 2,
          z: w.origin.z + w.u.z * mid,
        },
        text: o.id.replace(/^og_/, ''),
      }
    })

write(
  '11-opening-ids-front',
  idOverlay(
    label(shadeOrthographic(all, [], FRONT_VIEW, W, H, shade), ['11 opening ids, front and east']),
    FRONT_VIEW,
    openingMarks('FRONT'),
  ),
)
write(
  '12-feature-ids-front',
  idOverlay(
    label(shadeOrthographic(all, [], FRONT_VIEW, W, H, shade), ['12 facade feature ids']),
    FRONT_VIEW,
    // Only what this elevation actually sees. A front view projects the rear
    // balcony onto the front one, and two labels on one mark say less than one.
    [
      ...facade.returns
        .filter((r) => r.wall.origin.z > 6.3)
        .map((r) => ({
          at: { x: r.wall.origin.x + r.wall.thicknessM / 2, y: r.wall.origin.y + 1.2, z: r.wall.origin.z },
          text: r.id.replace(/^return_/, 'ret_'),
        })),
      ...facade.slabs
        .filter((s) => s.footprint.maxZ > 6.3)
        .map((s) => ({
          at: { x: (s.footprint.minX + s.footprint.maxX) / 2, y: s.topM - s.thicknessM / 2, z: s.footprint.maxZ },
          text: s.id,
        })),
      ...facade.railings
        .filter((r) => r.atM > 6.3)
        .map((r) => ({
          at: { x: (r.panels[0].fromM + r.panels[r.panels.length - 1].toM) / 2, y: r.baseM + r.heightM / 2, z: r.atM },
          text: r.id,
        })),
      ...facade.portals.map((p) => ({
        at: { x: (p.openingMinM + p.openingMaxM) / 2, y: p.openingTopM / 2, z: p.outerPlaneM },
        text: p.id,
      })),
    ],
  ),
)

console.log(`\nwrote 12 views to ${outDir}`)
