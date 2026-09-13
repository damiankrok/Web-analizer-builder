/**
 * STAGE WEB-PIVOT-02A diagnostic — development only.
 *
 *   npx tsx scripts/eave-closure-diagnostic.ts [outDir]   (default out/eave-closure)
 *
 * A console report of the eave interface before and after the correction, and
 * seven renders of the triangles the compiler actually emits.
 *
 * Everything printed comes from the independent oracles in
 * `tests/geometry-oracles.ts`, which read triangles and nothing else. The
 * renders are a software rasterisation of that same triangle list by this
 * repository's own renderer — not a browser screenshot, and no product UI is
 * touched.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { compileBuilding, isSolidBuildingPart, type BuildingTri } from '../src/core/wallspec/building.js'
import { compileWalls } from '../src/core/wallspec/compile.js'
import { compileRoofs } from '../src/core/wallspec/roof.js'
import type { CompiledTri } from '../src/core/wallspec/contracts.js'
import {
  EAVE,
  EAVE_DH_M,
  EAVE_FLAT_VOLUME_M3,
  EAVE_IDS,
  EAVE_WEDGE_M3,
  eaveLevels,
  eaveRoof,
  eaveWallInput,
} from '../src/core/wallspec/eave-fixture.js'
import { IDS, M, MAIN, marcowkiBuildingSpec } from '../src/core/wallspec/marcowki-fixture.js'
import {
  measureContact,
  measureRoofPlanes,
  meshVolume,
  materialRuns,
  type Interval,
} from '../tests/geometry-oracles.js'
import type { BuildTri } from '../src/core/hypotheses/solid.js'
import { shadePerspective, shadeOrthographic, DEFAULT_SHADE, STUDY_MATERIALS } from '../src/core/camera/shade.js'
import { lookAt, intrinsicsFromFovY, type CameraView } from '../src/core/camera/projector.js'
import { orthoViewForFacade } from '../src/core/scoring/elevation.js'
import { deg2rad, v3add, type Vec3 } from '../src/core/math/vec.js'

const outDir = process.argv[2] ?? 'out/eave-closure'
mkdirSync(outDir, { recursive: true })
const W = 1100
const H = 760
const UP = { x: 0, y: 1, z: 0 }
const BELOW = 1000
const f3 = (x: number): string => x.toFixed(3)
const f6 = (x: number): string => x.toFixed(6)

const write = (name: string, img: { width: number; height: number; data: Uint8ClampedArray }): void => {
  const p = new PNG({ width: img.width, height: img.height })
  p.data = Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length)
  writeFileSync(join(outDir, `${name}.png`), PNG.sync.write(p))
}

const runsAt = (tris: readonly { a: Vec3; b: Vec3; c: Vec3 }[], x: number, z: number): Interval[] =>
  materialRuns(tris, { x, y: -BELOW, z }, UP).map((i) => ({ t0: i.t0 - BELOW, t1: i.t1 - BELOW }))
const show = (l: readonly Interval[]): string => l.map((i) => `[${f3(i.t0)}, ${f3(i.t1)}]`).join(' + ') || '(none)'

// --------------------------------------------------------------------------
// Fixture C — the synthetic eave.
// --------------------------------------------------------------------------

const SOLID = ['WALL', 'WALL_INNER', 'REVEAL']
const synthWall = (top: 'FLAT' | 'PLANE'): CompiledTri[] =>
  compileWalls(eaveWallInput({ top })).tris.filter((t) => SOLID.includes(t.part))
const synthRoof = compileRoofs([eaveRoof()], eaveLevels()).tris

console.log('STAGE WEB-PIVOT-02A — eave / sloped soffit wall-top closure')
console.log('\n--- Fixture C, the synthetic eave')
console.log(`  wall ${f3(EAVE.lengthM)} m long, ${f3(EAVE.thicknessM)} m thick, outer-face top ${f3(EAVE.outerTopM)} m`)
console.log(`  soffit pitch ${EAVE.pitchDeg} deg`)
console.log(`  dh = t * tan(p)            = ${EAVE_DH_M.toFixed(12)} m`)
console.log(`  V  = 0.5 * t * dh * L      = ${EAVE_WEDGE_M3.toFixed(12)} m3`)
const vFlat = meshVolume(synthWall('FLAT'))
const vPlane = meshVolume(synthWall('PLANE'))
console.log(`  flat-top wall volume       = ${vFlat.toFixed(12)} m3 (L*h*t = ${EAVE_FLAT_VOLUME_M3.toFixed(12)})`)
console.log(`  plane-top wall volume      = ${vPlane.toFixed(12)} m3`)
console.log(`  difference                 = ${(vPlane - vFlat).toFixed(12)} m3`)
console.log(`  difference - analytic V    = ${(vPlane - vFlat - EAVE_WEDGE_M3).toExponential(3)} m`)

const synthProbes: Array<{ origin: Vec3; label: string }> = []
for (const a of [0.3, 0.7, 2.4, 3.1, 3.7]) {
  for (const c of [0.01, 0.1, 0.225, 0.35, 0.44]) {
    synthProbes.push({ origin: { x: a, y: -BELOW, z: -c }, label: `u=${f3(a)} c=${f3(c)}` })
  }
}
for (const top of ['FLAT', 'PLANE'] as const) {
  const rep = measureContact(synthWall(top), synthRoof, synthProbes, UP)
  console.log(
    `  ${top.padEnd(5)} interface: max void ${rep.maxVoidM.toExponential(4)} m  ` +
      `max overlap ${rep.maxOverlapM.toExponential(4)} m  ` +
      `max double-filled ${rep.maxDoubleFilledM.toExponential(4)} m  ` +
      `one-run samples ${rep.samples.filter((s) => s.unionRuns === 1).length}/${rep.samples.length}`,
  )
}

// --------------------------------------------------------------------------
// The Marcowki gold shell, before and after.
// --------------------------------------------------------------------------

const SIDES = ['attic_left', 'attic_right']
const before = compileBuilding(marcowkiBuildingSpec({ flatEaveTops: true }))
const after = compileBuilding(marcowkiBuildingSpec())
const solidOf = (r: typeof after): BuildingTri[] => r.tris.filter((t) => isSolidBuildingPart(t.part))
const sidesOf = (r: typeof after): BuildingTri[] => solidOf(r).filter((t) => SIDES.includes(t.wallId))
const roofOf = (r: typeof after): BuildingTri[] => r.tris.filter((t) => t.elementId === IDS.gableRoof)

const marcProbes: Array<{ origin: Vec3; label: string }> = []
for (const z of [1.0, 3.0, 6.3, 9.0, 11.8]) {
  for (const c of [0.02, 0.15, 0.225, 0.3, 0.43]) {
    marcProbes.push({ origin: { x: MAIN.minX + c, y: -BELOW, z }, label: `left z=${z} c=${c}` })
    marcProbes.push({ origin: { x: MAIN.maxX - c, y: -BELOW, z }, label: `right z=${z} c=${c}` })
  }
}

console.log('\n--- Marcowki gold shell, before and after')
for (const [name, r] of [['before', before], ['after', after]] as const) {
  const rep = measureContact(sidesOf(r), roofOf(r), marcProbes, UP)
  const planes = measureRoofPlanes(roofOf(r), UP)
  console.log(
    `  ${name.padEnd(6)} side-wall volume ${f6(SIDES.reduce((a, id) => a + meshVolume(solidOf(r).filter((t) => t.wallId === id)), 0))} m3   ` +
      `max void ${rep.maxVoidM.toExponential(4)} m   max overlap ${rep.maxOverlapM.toExponential(4)} m   ` +
      `roof pitch ${planes[0].pitchDeg.toFixed(5)} deg   eave ${f6(planes[0].lowM)}   ridge ${f6(planes[0].highM)}`,
  )
}
const wedge =
  2 * 0.5 * M.wallThickness * (M.wallThickness * Math.tan((M.pitchDeg * Math.PI) / 180)) * (M.overallDepth - 2 * M.wallThickness)
const added =
  SIDES.reduce((a, id) => a + meshVolume(solidOf(after).filter((t) => t.wallId === id)), 0) -
  SIDES.reduce((a, id) => a + meshVolume(solidOf(before).filter((t) => t.wallId === id)), 0)
console.log(`  wedge closed: ${f6(added)} m3 against an analytic ${f6(wedge)} m3 (2 walls x 0.5*t*dh*L)`)
console.log(`  roof triangles identical before and after: ${JSON.stringify(roofOf(before)) === JSON.stringify(roofOf(after))}`)

console.log('\n--- a section across the attic left wall at z = 6.3')
for (const c of [0.0001, 0.1, 0.225, 0.35, 0.4499]) {
  const x = MAIN.minX + c
  console.log(
    `  c=${c.toFixed(4)}  before wall ${show(runsAt(sidesOf(before), x, 6.3)).padEnd(20)} ` +
      `after wall ${show(runsAt(sidesOf(after), x, 6.3)).padEnd(20)} roof ${show(runsAt(roofOf(after), x, 6.3))}`,
  )
}

const soffit = solidOf(after).filter((t) => t.contactKind === 'ROOF_SOFFIT')
console.log(`\n--- contact surfaces`)
console.log(`  ROOF_SOFFIT triangles: ${soffit.length} on walls ${[...new Set(soffit.map((t) => t.wallId))].join(', ')}, roof ${[...new Set(soffit.map((t) => t.contactId))].join(', ')}`)
console.log(`  JUNCTION  triangles: ${solidOf(after).filter((t) => t.contactKind === 'JUNCTION').length}`)
console.log(`  before, ROOF_SOFFIT triangles: ${solidOf(before).filter((t) => t.contactKind === 'ROOF_SOFFIT').length}`)

// --------------------------------------------------------------------------
// Renders.
// --------------------------------------------------------------------------

const asBuild = (t: readonly { a: Vec3; b: Vec3; c: Vec3; part: string; contactKind?: string }[]): BuildTri[] =>
  t.map((x) => ({ ...x, part: x.contactKind === 'ROOF_SOFFIT' ? 'ROOF_SOFFIT' : x.part })) as unknown as BuildTri[]

const view = (eye: Vec3, target: Vec3, fovDeg = 34): CameraView => ({
  intrinsics: intrinsicsFromFovY(deg2rad(fovDeg), W, H),
  extrinsics: lookAt(eye, target),
  width: W,
  height: H,
  near: 0.01,
})
const orbit = (target: Vec3, azDeg: number, elDeg: number, dist: number, fovDeg = 34): CameraView => {
  const az = deg2rad(azDeg)
  const el = deg2rad(elDeg)
  return view(
    v3add(target, {
      x: Math.sin(az) * Math.cos(el) * dist,
      y: Math.sin(el) * dist,
      z: Math.cos(az) * Math.cos(el) * dist,
    }),
    target,
    fovDeg,
  )
}

const shade = { ...DEFAULT_SHADE, groundPlane: false, drawEdges: true }
const contrast = {
  ...shade,
  materials: {
    ...STUDY_MATERIALS,
    ROOF: { colour: [170, 128, 106] as [number, number, number], transparency: 0, sheen: 0 },
    ROOF_SOFFIT: { colour: [206, 96, 72] as [number, number, number], transparency: 0, sheen: 0 },
    WALL: { colour: [238, 236, 231] as [number, number, number], transparency: 0, sheen: 0 },
    WALL_INNER: { colour: [214, 210, 203] as [number, number, number], transparency: 0, sheen: 0 },
  },
}

// 1 + 2. The synthetic wall, seen end-on with the roof above it. The camera is
// off the end of the wall, so the wedge is a slot of background between the two.
const synthTarget: Vec3 = { x: 1.7, y: EAVE.outerTopM - 0.05, z: -EAVE.thicknessM / 2 }
for (const [name, top] of [
  ['01-synthetic-flat-gap', 'FLAT'],
  ['02-synthetic-plane-closed', 'PLANE'],
] as const) {
  write(
    name,
    shadePerspective(
      [...asBuild(synthWall(top)), ...asBuild(synthRoof.map((t) => ({ ...t, part: 'ROOF' })))],
      [],
      view({ x: -3.4, y: EAVE.outerTopM + 1.1, z: 2.6 }, synthTarget, 42),
      W,
      H,
      contrast,
    ),
  )
}

// 3. The same pair as a section. An orthographic camera looking straight down
// the wall's length shows its whole thickness at once, which is what a section
// is; the wedge is then a triangle of background rather than a sliver.
const synthSectionMin: Vec3 = { x: 0, y: EAVE.outerTopM - 0.75, z: -1.25 }
const synthSectionMax: Vec3 = { x: EAVE.lengthM, y: EAVE.outerTopM + 0.75, z: 0.25 }
for (const [name, top] of [
  ['03a-section-before', 'FLAT'],
  ['03b-section-after', 'PLANE'],
] as const) {
  write(
    name,
    shadeOrthographic(
      [...asBuild(synthWall(top)), ...asBuild(synthRoof.map((t) => ({ ...t, part: 'ROOF' })))],
      [],
      orthoViewForFacade('RIGHT', synthSectionMin, synthSectionMax, W, H, 0.08),
      W,
      H,
      contrast,
    ),
  )
}

// 4. The Marcowki eave, sectioned the same way: an orthographic camera along
// the ridge, with only the left side wall and the roof in the frame so the
// gable ends in front of them do not hide the interface. Nothing is clipped —
// the section is the projection, and every triangle drawn is one the compiler
// emitted.
const marcSectionMin: Vec3 = { x: MAIN.minX - 0.55, y: 3.95, z: MAIN.minZ }
const marcSectionMax: Vec3 = { x: MAIN.minX + 1.35, y: 5.25, z: MAIN.maxZ }
for (const [name, r] of [
  ['04a-marcowki-eave-before', before],
  ['04b-marcowki-eave-after', after],
] as const) {
  write(
    name,
    shadeOrthographic(
      asBuild([...solidOf(r).filter((t) => t.wallId === 'attic_left'), ...roofOf(r)]),
      [],
      orthoViewForFacade('FRONT', marcSectionMin, marcSectionMax, W, H, 0.08),
      W,
      H,
      contrast,
    ),
  )
}

// 5. The whole shell after the correction, obliquely.
write(
  '05-marcowki-oblique-after',
  shadePerspective(
    asBuild(after.tris),
    [],
    orbit({ x: M.overallWidth / 2, y: 2.6, z: M.overallDepth / 2 }, 28, 18, 21, 32),
    W,
    H,
    { ...shade, groundPlane: true },
  ),
)

console.log(`\nwrote 7 renders of the emitted triangles to ${outDir}/`)
console.log('(software rasterisation of the triangle list, not a browser screenshot)')
