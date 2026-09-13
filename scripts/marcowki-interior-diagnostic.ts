/**
 * STAGE WEB-PIVOT-04 diagnostic — development only.
 *
 *   npx tsx scripts/marcowki-interior-diagnostic.ts [outDir]   (default out/marcowki-interior)
 *
 * Everything this stage claims, printed and drawn.
 *
 * The console half is the audit: the floor partition, the room topology, the
 * published-area cross-check, the printed chains, the doors, the stair and the
 * slab. Every number comes from `tests/interior-oracles.ts`, which reads the
 * emitted triangles and the gold transcription and never asks the compiler what
 * it meant.
 *
 * The drawn half is seven views of the compiled geometry and two plan overlays.
 * The views are a software rasterisation of the triangle list by this
 * repository's own renderer — not a browser screenshot, and no product UI is
 * touched. The overlays put the gold walls and room polygons straight onto the
 * published drawing through `PLAN_CALIBRATIONS`, which is an orthographic
 * mapping of two anchors per axis: there is no perspective fit anywhere in it,
 * and a wall that is in the wrong place lands off the ink.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { compileBuilding, type BuildingTri } from '../src/core/wallspec/building.js'
import { IDS, M, marcowkiBuildingSpec } from '../src/core/wallspec/marcowki-fixture.js'
import { gold, marcowkiInteriorSpec } from '../src/core/wallspec/marcowki-interior-fixture.js'
import {
  compileInterior,
  polygonArea,
  wallFootprint,
  type InteriorTri,
  type PlanPolygon,
} from '../src/core/wallspec/interior.js'
import {
  adjacencyGraph,
  alignmentReport,
  areaCheck,
  chainCheck,
  coverageReport,
  openingCut,
  roomTopology,
  slabVoidReport,
  stairReport,
} from '../tests/interior-oracles.js'
import type { BuildTri } from '../src/core/hypotheses/solid.js'
import { shadePerspective, shadeOrthographic, DEFAULT_SHADE, STUDY_MATERIALS } from '../src/core/camera/shade.js'
import { lookAt, DEFAULT_NEAR, intrinsicsFromFovY, type CameraView, type OrthographicView } from '../src/core/camera/projector.js'
import { deg2rad, v3add, type Vec3 } from '../src/core/math/vec.js'
import { drawText, textWidth } from './plan-font.js'
import { PLAN_CALIBRATIONS } from './plan-calibration.js'
import { readPackage, readPackageAssets } from '../src/node/package-store.js'
import { assetFileNameFor, toParsedSource } from '../src/core/contracts/source-package.js'
import { selectPlanAsset } from '../src/core/dimensions/plan-select.js'
import { decodeImage } from '../src/node/image-decode.js'

const outDir = process.argv[2] ?? 'out/marcowki-interior'
mkdirSync(outDir, { recursive: true })
const W = 1200
const H = 840
const f3 = (x: number): string => x.toFixed(3)

const write = (name: string, img: { width: number; height: number; data: Uint8ClampedArray }): void => {
  const p = new PNG({ width: img.width, height: img.height })
  p.data = Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length)
  writeFileSync(join(outDir, `${name}.png`), PNG.sync.write(p))
}

// --- the model ---------------------------------------------------------------

const spec = marcowkiInteriorSpec()
const interior = compileInterior(spec)
const shell = compileBuilding(marcowkiBuildingSpec())
/**
 * The shell's own floor plate is dropped: this stage emits the same plate with
 * the stair's hole in it, and two plates in the same place would be exactly the
 * duplicate solid §13 forbids.
 */
const shellNoSlab = shell.tris.filter((t) => t.elementId !== IDS.slab)

const asBuild = (t: readonly (BuildingTri | InteriorTri)[]): BuildTri[] => t as unknown as BuildTri[]
/** Interior parts the study shader has no material for, mapped to ones it has. */
const renderable = (t: readonly InteriorTri[]): BuildTri[] =>
  t
    .filter((x) => x.elementKind !== 'ROOM_FLOOR')
    .map((x) => ({ ...x, part: x.part === 'STAIR' ? 'FEATURE' : x.part })) as unknown as BuildTri[]

// --- console audit -----------------------------------------------------------

console.log(`STAGE WEB-PIVOT-04 — Marcowki interior, from ${gold.id}`)
console.log(`source package ${gold.sourcePackageId}  ${gold.sourcePackageContentHash}`)
console.log(
  `\ncompiled: ${interior.tris.length} triangles, ${interior.walls.length} interior walls, ` +
    `${interior.rooms.length} rooms, ${spec.openings.length} openings, ${spec.stairs.length} stair, ` +
    `${interior.diagnostics.length} diagnostics`,
)
for (const d of interior.diagnostics) console.log(`  ${d.severity} ${d.code} ${d.message}`)

console.log('\n== §8 floor partition audit ==')
console.log('level    envelope     rooms     walls     stair   overlap uncovered')
for (const lv of spec.levels) {
  const c = coverageReport(spec, lv.id)
  console.log(
    `${lv.id.padEnd(8)} ${f3(c.envelopeM2).padStart(8)}  ${f3(c.roomM2).padStart(8)}  ${f3(c.wallM2).padStart(8)}  ` +
      `${f3(c.stairM2).padStart(8)}  ${f3(c.overlapM2).padStart(8)} ${f3(c.uncoveredM2).padStart(9)}`,
  )
  for (const g of c.gaps.slice(0, 4)) console.log(`   gap ${f3(g.areaM2)} m² at x ${g.rect.minX}..${g.rect.maxX} z ${g.rect.minZ}..${g.rect.maxZ}`)
  for (const o of c.overlaps.slice(0, 4)) console.log(`   overlap ${f3(o.areaM2)} m² claimed by ${o.by.join(', ')}`)
}

console.log('\n== §7 room topology ==')
console.log('room                area    walled  doorway  notional  unexplained  problems')
for (const rm of spec.rooms) {
  const t = roomTopology(spec, interior.tris, rm)
  console.log(
    `${rm.id.padEnd(18)} ${f3(t.areaM2).padStart(7)} ${t.supportedM.toFixed(2).padStart(8)} ` +
      `${t.openingM.toFixed(2).padStart(8)} ${t.notionalM.toFixed(2).padStart(9)} ${t.unexplainedM.toFixed(2).padStart(12)}  ${t.problems.join('; ')}`,
  )
}

console.log('\n== §9 published room areas (finished = polygon inset 20 mm) ==')
console.log('room                label                raw  finished  published  delta%  class')
const SEMANTIC_NOTES: Record<string, string> = {
  g_pantry: 'the stair soffit covers its south-east corner; the published gross includes floor the model gives to the stair',
  u_corridor: 'the Korytarz/Schody boundary is not drawn; the published pair splits the same space differently',
  u_stairs: 'the polygon is the whole stair compartment including the void; the published figure is the flight and landing',
  u_pokoj_s: 'the attic plan draws a recess at the room’s north-west corner that the model does not reproduce',
}
for (const rm of spec.rooms) {
  const a = areaCheck(rm, SEMANTIC_NOTES)
  console.log(
    `${rm.id.padEnd(18)} ${rm.label.padEnd(16)} ${f3(a.rawM2).padStart(8)} ${f3(a.finishedM2).padStart(9)} ` +
      `${(a.publishedM2 ?? 0).toFixed(2).padStart(10)} ${(a.deltaPct ?? 0).toFixed(1).padStart(7)}  ${a.classification}`,
  )
  if (a.note) console.log(`                   ${a.note}`)
}

console.log('\n== §10 printed dimension chains ==')
for (const ch of gold.chains) {
  const c = chainCheck(spec, ch)
  console.log(
    `${c.chainId.padEnd(20)} ${ch.printed.join(' | ')} from ${c.fromM} to ${c.toM} → closure ${c.closureM.toExponential(2)} m`,
  )
  for (const l of c.landings) {
    console.log(
      `    boundary at ${f3(l.atM)} → ${l.wallId ?? '(no wall: open-plan split)'}` +
        (l.faceM !== null ? ` face ${f3(l.faceM)} (error ${f3(l.errorM ?? 0)} m)` : ''),
    )
  }
}

console.log('\n== §11 doors ==')
console.log('opening            host                 through  beside   above  separates its rooms')
for (const o of spec.openings) {
  if (!o.cut) {
    console.log(`${o.id.padEnd(18)} ${o.hostWallId.padEnd(20)} not cut — its host belongs to the exterior shell`)
    continue
  }
  const c = openingCut(spec, interior.tris, o.id)
  console.log(
    `${o.id.padEnd(18)} ${o.hostWallId.padEnd(20)} ${f3(c.throughOpeningM).padStart(7)} ${f3(c.besideOpeningM).padStart(7)} ` +
      `${f3(c.aboveOpeningM).padStart(7)}  ${c.separatesItsRooms}`,
  )
}
for (const lv of ['ground', 'upper']) {
  const g = adjacencyGraph(spec, lv)
  console.log(`\n${lv} adjacency: ${g.nodes.length} rooms, ${g.edges.length} ways through, ${g.connected ? 'one connected component' : `${g.components.length} components`}`)
  for (const e of g.edges) console.log(`    ${e.a} <-> ${e.b}  via ${e.via} (${e.kind})`)
}

console.log('\n== §12/§13 stair and slab ==')
const st = stairReport(spec, interior.tris, 'stair_main')
const sv = slabVoidReport(spec, interior.tris, 'slab_upper_floor')
console.log(`stair volume ${f3(st.volumeM3)} m³, base ${f3(st.baseM)} m, top ${f3(st.topM)} m, reaches the attic floor: ${st.reachesUpperFloor}`)
console.log(`stair footprint x ${f3(st.footprint.minX)}..${f3(st.footprint.maxX)} z ${f3(st.footprint.minZ)}..${f3(st.footprint.maxZ)}, uncovered ${f3(st.uncoveredFootprintM2)} m²`)
console.log(`stair material shared with walls or the plate: ${st.clashM3.toExponential(2)} m³`)
console.log(`slab volume ${f3(sv.volumeM3)} m³ against ${f3(sv.expectedSolidM3)} m³ with the hole and ${f3(sv.expectedWholeM3)} m³ without it`)
console.log(`vertical line through the void meets ${f3(sv.throughVoidM)} m of plate; 0.20 m outside it, ${f3(sv.besideVoidM)} m`)
console.log(`stair footprint still covered by plate: ${sv.stairFootprintOutsideVoidM2.toExponential(2)} m²`)

console.log('\n== §14 two-floor alignment ==')
const al = alignmentReport(
  spec,
  [
    ['gw_room_east', 'uw_room2_west'],
    ['gw_boiler_north', 'uw_corridor_south'],
  ],
  'u_stairs',
)
for (const e of al.envelopes) console.log(`  ${e.levelId}: x ${e.rect.minX}..${e.rect.maxX} z ${e.rect.minZ}..${e.rect.maxZ}`)
console.log(`  envelopes agree: ${al.envelopesAgree}; the slab void lands inside the attic stair compartment: ${al.voidInsideUpperStair}`)
for (const p of al.structuralPairs) console.log(`  ${p.groundWallId} and ${p.upperWallId} are ${f3(p.offsetM)} m apart`)

// --- renders -----------------------------------------------------------------

const wb = {
  min: { x: 0, y: M.terrain, z: 0 },
  max: { x: M.overallWidth, y: M.ridge, z: M.overallDepth },
}
const centre: Vec3 = { x: M.overallWidth / 2, y: 2.4, z: M.overallDepth / 2 }
const radius = Math.hypot(M.overallWidth, M.overallDepth, M.ridge) / 2

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

/** Straight down, north up, so the render is registered with the plans. */
function topView(width: number, height: number, margin = 0.35): OrthographicView {
  const spanX = wb.max.x - wb.min.x
  const spanZ = wb.max.z - wb.min.z
  const scale = Math.min(width / (spanX + 2 * margin), height / (spanZ + 2 * margin))
  return {
    right: { x: 1, y: 0, z: 0 },
    up: { x: 0, y: 0, z: -1 },
    scale,
    origin: { x: wb.min.x, y: wb.max.y, z: wb.max.z },
    originU: margin * scale,
    originV: height - margin * scale,
    width,
    height,
  }
}

const shade = { ...DEFAULT_SHADE, groundPlane: false }
const interiorMats = {
  ...STUDY_MATERIALS,
  FEATURE: { colour: [206, 176, 140] as [number, number, number], transparency: 0, sheen: 0.05 },
  SLAB: { colour: [196, 200, 206] as [number, number, number], transparency: 0, sheen: 0 },
}

/** Interior partitions in a darker grey, so a top-down white model reads. */
const planContrast = (t: readonly InteriorTri[]): BuildTri[] =>
  t
    .filter((x) => x.elementKind !== 'ROOM_FLOOR')
    .map((x) => ({
      ...x,
      part: x.part === 'STAIR' ? 'FEATURE' : x.elementKind === 'INTERIOR_WALL' ? 'ROOF_SOFFIT' : x.part,
    })) as unknown as BuildTri[]
const planMats = {
  ...interiorMats,
  ROOF_SOFFIT: { colour: [150, 154, 162] as [number, number, number], transparency: 0, sheen: 0 },
}

// 1. Ground floor from above, with the attic, the slab and the roofs hidden.
// The roofs are owned by the storey they bear on, so a storey filter alone
// still brings them: §16's plan views want the walls, and a plan with the roof
// on it is a roof plan.
const walls = shellNoSlab.filter((t) => t.elementKind !== 'ROOF')
const groundShell = walls.filter((t) => t.storeyId === IDS.groundMain || t.storeyId === IDS.garage)
const groundInterior = interior.tris.filter((t) => t.levelId === 'ground' && t.elementKind !== 'SLAB')
write(
  '01-ground-plan-top',
  shadeOrthographic([...asBuild(groundShell), ...planContrast(groundInterior)], [], topView(W, H), W, H, { ...shade, materials: planMats }),
)

// 2. The attic from above, with its own roofs hidden.
const atticShell = walls.filter((t) => t.storeyId === IDS.attic)
const atticInterior = interior.tris.filter((t) => t.levelId === 'upper' && t.elementKind !== 'SLAB')
write(
  '02-upper-plan-top',
  shadeOrthographic([...asBuild(atticShell), ...planContrast(atticInterior)], [], topView(W, H), W, H, { ...shade, materials: planMats }),
)

// 3. The two storeys pulled apart vertically, so the stack is visible at once.
const LIFT = 4.0
const lift = <T extends { a: Vec3; b: Vec3; c: Vec3 }>(t: readonly T[], dy: number): T[] =>
  t.map((x) => ({ ...x, a: { ...x.a, y: x.a.y + dy }, b: { ...x.b, y: x.b.y + dy }, c: { ...x.c, y: x.c.y + dy } }))
write(
  '03-exploded-two-floors',
  shadePerspective(
    [
      ...asBuild(groundShell),
      ...renderable(groundInterior),
      ...asBuild(lift(atticShell, LIFT)),
      ...renderable(lift(atticInterior, LIFT)),
      ...renderable(lift(interior.tris.filter((t) => t.elementKind === 'SLAB'), LIFT)),
    ],
    [],
    view(32, 40, radius * 2.4, 32, { x: centre.x, y: centre.y + LIFT / 2, z: centre.z }),
    W,
    H,
    { ...shade, materials: interiorMats },
  ),
)

// 4. Inside, with the roofs and the two exterior walls nearest the camera gone.
const CUT_Z = 12.15
const CUT_X = 7.45
const opened = [
  ...asBuild(
    shellNoSlab.filter(
      (t) =>
        t.elementKind !== 'ROOF' &&
        Math.min(t.a.z, t.b.z, t.c.z) < CUT_Z - 0.01 &&
        Math.min(t.a.x, t.b.x, t.c.x) < CUT_X - 0.01,
    ),
  ),
  ...renderable(interior.tris),
]
write('04-interior-oblique', shadePerspective(opened, [], view(24, 30, radius * 1.9, 34), W, H, { ...shade, materials: interiorMats }))

// 5. The stair and the hole it comes up through, close to.
// Low and from the south-west, so the flight is seen passing through the hole
// rather than the plate being seen from above. Only the stair and the plate are
// drawn: any wall between the camera and the shaft would hide the thing the
// view exists to show.
const stairTarget: Vec3 = { x: 6.2, y: 1.5, z: 7.8 }
const near = renderable(interior.tris.filter((t) => t.elementKind === 'STAIR' || t.elementKind === 'SLAB'))
write(
  '05-stair-and-slab-void',
  shadePerspective(near, [], view(-38, 24, 10.5, 40, stairTarget), W, H, {
    ...shade,
    // The plate is drawn see-through here and nowhere else: the point of the
    // view is the relationship between the flight and the hole, and an opaque
    // plate seen from above hides exactly that.
    materials: { ...interiorMats, SLAB: { colour: [178, 184, 194], transparency: 0.55, sheen: 0.1 } },
  }),
)

// --- id debug views and plan overlays ---------------------------------------

type Canvas = { png: PNG; put: (x: number, y: number, r: number, g: number, b: number) => void }
const canvas = (w: number, h: number, bg: [number, number, number]): Canvas => {
  const png = new PNG({ width: w, height: h })
  for (let i = 0; i < w * h; i++) {
    png.data[i * 4] = bg[0]
    png.data[i * 4 + 1] = bg[1]
    png.data[i * 4 + 2] = bg[2]
    png.data[i * 4 + 3] = 255
  }
  const put = (x: number, y: number, r: number, g: number, b: number): void => {
    const xi = Math.round(x)
    const yi = Math.round(y)
    if (xi < 0 || yi < 0 || xi >= w || yi >= h) return
    const i = (yi * w + xi) * 4
    png.data[i] = r
    png.data[i + 1] = g
    png.data[i + 2] = b
  }
  return { png, put }
}

const HUE: Array<[number, number, number]> = [
  [214, 118, 96], [122, 156, 196], [140, 172, 118], [196, 162, 96],
  [160, 128, 178], [110, 172, 168], [198, 138, 164], [138, 148, 160], [176, 176, 106],
]

/** Plan projection for the debug views: metres to pixels, north up. */
const planner = (w: number, h: number, pad: number) => {
  const sx = (w - 2 * pad) / M.overallWidth
  const sz = (h - 2 * pad) / M.overallDepth
  const s = Math.min(sx, sz)
  return { s, X: (x: number) => pad + x * s, Z: (z: number) => pad + z * s }
}

function fillPolygon(c: Canvas, poly: PlanPolygon, P: ReturnType<typeof planner>, col: [number, number, number], alpha: number): void {
  const xs = poly.map((p) => P.X(p.x))
  const zs = poly.map((p) => P.Z(p.z))
  const y0 = Math.floor(Math.min(...zs))
  const y1 = Math.ceil(Math.max(...zs))
  for (let y = y0; y <= y1; y++) {
    const cross: number[] = []
    for (let i = 0; i < poly.length; i++) {
      const a = { x: xs[i], y: zs[i] }
      const b = { x: xs[(i + 1) % poly.length], y: zs[(i + 1) % poly.length] }
      if (a.y > y + 0.5 !== b.y > y + 0.5) cross.push(a.x + ((y + 0.5 - a.y) / (b.y - a.y)) * (b.x - a.x))
    }
    cross.sort((p, q) => p - q)
    for (let k = 0; k + 1 < cross.length; k += 2) {
      for (let x = Math.ceil(cross[k]); x <= Math.floor(cross[k + 1]); x++) {
        const i = (y * c.png.width + x) * 4
        if (x < 0 || y < 0 || x >= c.png.width || y >= c.png.height) continue
        c.png.data[i] = Math.round(c.png.data[i] * (1 - alpha) + col[0] * alpha)
        c.png.data[i + 1] = Math.round(c.png.data[i + 1] * (1 - alpha) + col[1] * alpha)
        c.png.data[i + 2] = Math.round(c.png.data[i + 2] * (1 - alpha) + col[2] * alpha)
      }
    }
  }
}

function strokePolygon(c: Canvas, poly: PlanPolygon, P: ReturnType<typeof planner>, col: [number, number, number], wPx = 1): void {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const ax = P.X(a.x)
    const az = P.Z(a.z)
    const bx = P.X(b.x)
    const bz = P.Z(b.z)
    const n = Math.ceil(Math.hypot(bx - ax, bz - az))
    for (let k = 0; k <= n; k++) {
      for (let o = 0; o < wPx; o++) {
        c.put(ax + ((bx - ax) * k) / n + o, az + ((bz - az) * k) / n, ...col)
        c.put(ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n + o, ...col)
      }
    }
  }
}

const rectPoly = (r: { minX: number; maxX: number; minZ: number; maxZ: number }): PlanPolygon => [
  { x: r.minX, z: r.minZ },
  { x: r.maxX, z: r.minZ },
  { x: r.maxX, z: r.maxZ },
  { x: r.minX, z: r.maxZ },
]

for (const [file, levelId, title] of [
  ['06-room-ids-ground', 'ground', 'GROUND - ROOM IDS, PUBLISHED LABEL AND PLAN AREA'],
  ['06-room-ids-upper', 'upper', 'ATTIC - ROOM IDS, PUBLISHED LABEL AND PLAN AREA'],
] as const) {
  const c = canvas(W, H, [250, 249, 247])
  const P = planner(W, H - 40, 28)
  const rooms = spec.rooms.filter((r) => r.levelId === levelId)
  rooms.forEach((r, i) => {
    fillPolygon(c, r.polygon, P, HUE[i % HUE.length], 0.35)
    strokePolygon(c, r.polygon, P, [70, 72, 78], 2)
  })
  for (const w of spec.walls.filter((x) => x.levelId === levelId && x.emit)) {
    fillPolygon(c, rectPoly(wallFootprint(w)), P, [52, 54, 58], 0.92)
  }
  for (const s of spec.stairs.filter((x) => x.fromLevelId === levelId)) {
    strokePolygon(c, s.footprint, P, [180, 96, 60], 2)
    const sx = s.footprint.reduce((a, p) => a + p.x, 0) / s.footprint.length
    const sz = s.footprint.reduce((a, p) => a + p.z, 0) / s.footprint.length
    drawText(c.put, s.id, P.X(sx) - textWidth(s.id, 2) / 2, P.Z(sz) - 6, 2, [150, 70, 40])
  }
  rooms.forEach((r) => {
    const cx = r.polygon.reduce((s, p) => s + p.x, 0) / r.polygon.length
    const cz = r.polygon.reduce((s, p) => s + p.z, 0) / r.polygon.length
    const lines = [r.id, r.label, `${polygonArea(r.polygon).toFixed(2)} m2`]
    lines.forEach((t, k) => drawText(c.put, t, P.X(cx) - textWidth(t, 2) / 2, P.Z(cz) - 18 + k * 18, 2, [32, 34, 38]))
  })
  drawText(c.put, title, 28, H - 30, 2, [60, 62, 68])
  write(file, { width: c.png.width, height: c.png.height, data: c.png.data as unknown as Uint8ClampedArray })
}

for (const [file, levelId, title] of [
  ['07-wall-opening-ids-ground', 'ground', 'GROUND - WALL AND OPENING IDS'],
  ['07-wall-opening-ids-upper', 'upper', 'ATTIC - WALL AND OPENING IDS'],
] as const) {
  const c = canvas(W, H, [250, 249, 247])
  const P = planner(W, H - 40, 28)
  for (const r of spec.rooms.filter((x) => x.levelId === levelId)) strokePolygon(c, r.polygon, P, [206, 206, 202], 1)
  const walls = spec.walls.filter((x) => x.levelId === levelId)
  for (const w of walls) {
    const f = wallFootprint(w)
    fillPolygon(c, rectPoly(f), P, w.emit ? [52, 54, 58] : [166, 168, 172], 0.92)
    const label = `${w.id} ${w.thicknessM.toFixed(2)}${w.emit ? '' : ' (shell)'}`
    const lx = w.axis === 'X' ? P.X(f.minX) + 4 : P.X(w.atM) + 8
    const lz = w.axis === 'X' ? P.Z(w.atM) - 20 : P.Z(f.minZ) + 4
    drawText(c.put, label, lx, lz, 2, [40, 42, 46])
  }
  for (const o of spec.openings.filter((x) => x.levelId === levelId)) {
    const w = spec.walls.find((x) => x.id === o.hostWallId)!
    const a0 = w.fromM + o.offsetM
    const a1 = a0 + o.widthM
    const half = w.thicknessM / 2
    const r = w.axis === 'X'
      ? { minX: a0, maxX: a1, minZ: w.atM - half, maxZ: w.atM + half }
      : { minX: w.atM - half, maxX: w.atM + half, minZ: a0, maxZ: a1 }
    fillPolygon(c, rectPoly(r), P, o.cut ? [214, 118, 96] : [150, 150, 200], 0.95)
    const text = `${o.id} ${o.widthM.toFixed(2)}`
    drawText(c.put, text, P.X((r.minX + r.maxX) / 2) - textWidth(text, 2) / 2, P.Z((r.minZ + r.maxZ) / 2) + 10, 2, [150, 70, 40])
  }
  drawText(c.put, title, 28, H - 30, 2, [60, 62, 68])
  write(file, { width: c.png.width, height: c.png.height, data: c.png.data as unknown as Uint8ClampedArray })
}

// --- plan overlays -----------------------------------------------------------

const pkg = await readPackage('A-marcowki')
const bytes = await readPackageAssets('A-marcowki')
const parsed = toParsedSource(pkg)

for (const [file, storey, levelId, cal, title] of [
  ['08-overlay-ground', 'GROUND', 'ground', PLAN_CALIBRATIONS.ground, 'GROUND PLAN - PUBLISHED DRAWING WITH THE GOLD WALLS AND ROOMS'],
  ['09-overlay-upper', 'UPPER_ATTIC', 'upper', PLAN_CALIBRATIONS.upper, 'ATTIC PLAN - PUBLISHED DRAWING WITH THE GOLD WALLS AND ROOMS'],
] as const) {
  const sel = selectPlanAsset(parsed.assets, storey)
  if (!sel) {
    console.log(`\nno ${storey} plan in the package; overlay skipped`)
    continue
  }
  const data = bytes.get(assetFileNameFor(sel.asset.sha256!, sel.asset.contentType!))
  if (!data) {
    console.log(`\n${storey} plan bytes are not in the package store; overlay skipped`)
    continue
  }
  const img = await decodeImage(data)
  const scale = 2
  const c = canvas(img.width * scale, img.height * scale, [255, 255, 255])
  for (let y = 0; y < c.png.height; y++) {
    for (let x = 0; x < c.png.width; x++) {
      const si = (Math.floor(y / scale) * img.width + Math.floor(x / scale)) * 4
      const di = (y * c.png.width + x) * 4
      c.png.data[di] = img.data[si]
      c.png.data[di + 1] = img.data[si + 1]
      c.png.data[di + 2] = img.data[si + 2]
      c.png.data[di + 3] = 255
    }
  }
  // The registration: two anchors per axis, read off the wall ink, and nothing
  // else. It is affine and orthographic by construction.
  const sxp = ((cal.x1Px - cal.x0Px) / cal.widthM) * scale
  const szp = ((cal.z1Px - cal.z0Px) / cal.depthM) * scale
  const P = { s: sxp, X: (x: number) => cal.x0Px * scale + x * sxp, Z: (z: number) => cal.z0Px * scale + z * szp }
  for (const r of spec.rooms.filter((x) => x.levelId === levelId)) {
    strokePolygon(c, r.polygon, P as never, [24, 110, 196], 2)
    const cx = r.polygon.reduce((s, p) => s + p.x, 0) / r.polygon.length
    const cz = r.polygon.reduce((s, p) => s + p.z, 0) / r.polygon.length
    drawText(c.put, r.id, P.X(cx) - textWidth(r.id, 2) / 2, P.Z(cz) + 12, 2, [24, 110, 196])
  }
  for (const w of spec.walls.filter((x) => x.levelId === levelId && x.emit)) {
    strokePolygon(c, rectPoly(wallFootprint(w)), P as never, [200, 40, 40], 2)
  }
  for (const s of spec.stairs.filter((x) => x.fromLevelId === levelId || (levelId === 'upper' && x.toLevelId === 'upper'))) {
    strokePolygon(c, levelId === 'upper' ? s.slabVoid : s.footprint, P as never, [232, 140, 40], 3)
  }
  drawText(c.put, title, 12, 12, 2, [200, 40, 40])
  drawText(c.put, `asset ${sel.asset.id} - ${sel.reason}`, 12, 34, 2, [60, 62, 68])
  write(file, { width: c.png.width, height: c.png.height, data: c.png.data as unknown as Uint8ClampedArray })
}

console.log(`\nwrote the renders and the plan overlays to ${outDir}/`)
console.log('(software rasterisation of the emitted triangle list, and an affine plan registration; no browser, no product UI)')
