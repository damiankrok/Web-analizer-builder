/**
 * STAGE WEB-PIVOT-02 diagnostic — development only.
 *
 *   npx tsx scripts/marcowki-shell-diagnostic.ts [outDir]    (default out/marcowki-shell)
 *
 * A console report of the gold shell's measurements against the source, and
 * eight renders of the triangles the compiler actually emits.
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
import {
  ATTIC_EAVE_H,
  ATTIC_RIDGE_H,
  GARAGE,
  IDS,
  M,
  MAIN,
  RIDGE_X,
  UPPER_RECESS_M,
  marcowkiBuildingSpec,
} from '../src/core/wallspec/marcowki-fixture.js'
import {
  manifoldReport,
  materialRuns,
  measureRoofPlanes,
  meshBounds,
  meshVolume,
  type Interval,
} from '../tests/geometry-oracles.js'
import type { BuildTri } from '../src/core/hypotheses/solid.js'
import { shadePerspective, shadeOrthographic, DEFAULT_SHADE, STUDY_MATERIALS } from '../src/core/camera/shade.js'
import { lookAt, DEFAULT_NEAR, intrinsicsFromFovY, type CameraView, type OrthographicView } from '../src/core/camera/projector.js'
import { orthoViewForFacade } from '../src/core/scoring/elevation.js'
import { deg2rad, v3add, type Vec3 } from '../src/core/math/vec.js'

const outDir = process.argv[2] ?? 'out/marcowki-shell'
mkdirSync(outDir, { recursive: true })
const W = 1100
const H = 760
const UP = { x: 0, y: 1, z: 0 }

const write = (name: string, img: { width: number; height: number; data: Uint8ClampedArray }): void => {
  const p = new PNG({ width: img.width, height: img.height })
  p.data = Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length)
  writeFileSync(join(outDir, `${name}.png`), PNG.sync.write(p))
}

const spec = marcowkiBuildingSpec()
const r = compileBuilding(spec)
const solid = r.tris.filter((t: BuildingTri) => isSolidBuildingPart(t.part))
const asBuild = (t: readonly BuildingTri[]): BuildTri[] => t as unknown as BuildTri[]
const f3 = (x: number): string => x.toFixed(3)
const BELOW = 1000
const runsAt = (tris: readonly BuildingTri[], x: number, z: number): Interval[] =>
  materialRuns(tris, { x, y: -BELOW, z }, UP).map((i) => ({ t0: i.t0 - BELOW, t1: i.t1 - BELOW }))
const show = (l: readonly Interval[]): string => l.map((i) => `[${f3(i.t0)}, ${f3(i.t1)}]`).join(' + ') || '(none)'

console.log('STAGE WEB-PIVOT-02 — Marcowki exterior shell, compiled from the gold spec')
console.log(`diagnostics: ${r.diagnostics.length === 0 ? 'none' : r.diagnostics.map((d) => d.code).join(', ')}`)
console.log(`triangles: ${r.tris.length} (${solid.length} solid, ${r.tris.length - solid.length} glazing)`)

console.log('\n--- levels')
for (const l of spec.levels) console.log(`  ${l.kind.padEnd(16)} ${l.id.padEnd(24)} ${l.elevationM.toFixed(5).padStart(9)} m   ${l.provenance.status}`)

console.log('\n--- shells')
for (const s of r.shells) {
  const closedAll = s.wallIds.every((id) => manifoldReport(solid.filter((t) => t.wallId === id)).closed)
  const vol = s.wallIds.reduce((acc, id) => acc + meshVolume(solid.filter((t) => t.wallId === id)), 0)
  console.log(`  ${s.shellId.padEnd(22)} base ${f3(s.baseM)}  top ${f3(s.topM)}  ring closed ${s.ring.closed}  walls closed ${closedAll}  wall volume ${f3(vol)} m3`)
}

console.log('\n--- roofs, measured from the emitted triangles')
for (const rf of r.roofs) {
  const planes = measureRoofPlanes(r.tris.filter((t) => t.elementId === rf.roofId), UP)
  console.log(`  ${rf.roofId} (${rf.kind}), declared pitch ${rf.declaredPitchDeg ?? 'none'}`)
  for (const p of planes) {
    const identity = Math.tan((p.pitchDeg * Math.PI) / 180) * p.horizontalRunM
    console.log(
      `      measured pitch ${p.pitchDeg.toFixed(5)} deg   eave ${f3(p.lowM)}  ridge ${f3(p.highM)}  ` +
        `run ${f3(p.horizontalRunM)}  rise ${f3(p.riseM)}  tan(pitch)*run ${f3(identity)}  area ${f3(p.areaM2)} m2`,
    )
  }
}

console.log('\n--- source-space checks')
const b = meshBounds(solid)
const rows: Array<[string, string, string]> = [
  ['overall width', `${f3(M.overallWidth)} (printed 1205)`, f3(b.max.x - b.min.x)],
  ['overall depth', `${f3(M.overallDepth)} (printed 1260)`, f3(b.max.z - b.min.z)],
  ['main body width', `${f3(M.mainWidth)} (printed 790)`, f3(meshBounds(solid.filter((t) => t.storeyId === IDS.attic)).max.x)],
  ['garage width', `${f3(M.garageWidth)} (printed 415)`, f3(GARAGE.maxX - GARAGE.minX)],
  ['footprint area', `${f3(M.publishedFootprint)} (published)`, f3(M.mainWidth * M.overallDepth + M.garageWidth * M.garageDepth)],
  ['ground FFL', f3(M.groundFfl), f3(runsAt(solid.filter((t) => t.elementKind === 'WALL'), M.wallThickness / 2, 6)[0].t0)],
  ['upper FFL', f3(M.upperFfl), f3(r.slabs[0].topM)],
  ['knee wall top', f3(M.upperFfl + M.kneeWall), f3(meshBounds(solid.filter((t) => t.wallId === 'attic_left')).max.y)],
  ['eave (derived)', `${f3(M.eave)} (printed datum ${f3(M.printedEave)})`, f3(measureRoofPlanes(r.tris.filter((t) => t.elementId === IDS.gableRoof), UP)[0].lowM)],
  ['ridge', f3(M.ridge), f3(measureRoofPlanes(r.tris.filter((t) => t.elementId === IDS.gableRoof), UP)[0].highM)],
  ['roof pitch', `${f3(M.pitchDeg)} deg (printed)`, `${measureRoofPlanes(r.tris.filter((t) => t.elementId === IDS.gableRoof), UP)[0].pitchDeg.toFixed(5)} deg`],
  ['flat roof top', f3(M.flatTop), f3(measureRoofPlanes(r.tris.filter((t) => t.elementId === IDS.flatRoof), UP)[0].lowM)],
  ['building height above terrain', f3(M.buildingHeight), f3(meshBounds(r.tris).max.y - M.terrain)],
  ['upper storey recess', f3(UPPER_RECESS_M), f3(M.overallWidth - meshBounds(solid.filter((t) => t.storeyId === IDS.attic)).max.x)],
]
for (const [what, gold, built] of rows) console.log(`  ${what.padEnd(30)} gold ${gold.padEnd(34)} compiled ${built}`)

console.log('\n--- section through the gable wall (x, then what a vertical line meets)')
const gz = M.overallDepth - M.wallThickness / 2
for (const x of [0.4, 1.5, 3.0, 3.6, 5.29, 6.9, 7.5]) {
  const wall = runsAt(solid.filter((t) => t.wallId === 'attic_front'), x, gz)
  const roof = runsAt(r.tris.filter((t) => t.elementId === IDS.gableRoof), x, gz)
  console.log(`  x=${x.toFixed(2)}  wall ${show(wall).padEnd(34)} roof ${show(roof)}`)
}

console.log('\n--- the eaves wedge, a known limitation')
const side = runsAt(solid.filter((t) => t.wallId === 'attic_left'), M.wallThickness / 2, 6)
const above = runsAt(r.tris.filter((t) => t.elementId === IDS.gableRoof), M.wallThickness / 2, 6)
console.log(`  outer face of the attic left wall: wall ${show(side)}  roof ${show(above)}`)
const inner = runsAt(solid.filter((t) => t.wallId === 'attic_left'), M.wallThickness * 0.95, 6)
const innerRoof = runsAt(r.tris.filter((t) => t.elementId === IDS.gableRoof), M.wallThickness * 0.95, 6)
console.log(`  inner face of the same wall      : wall ${show(inner)}  roof ${show(innerRoof)}`)

// --- renders --------------------------------------------------------------
const centre: Vec3 = { x: M.overallWidth / 2, y: 2.6, z: M.overallDepth / 2 }
const radius = 14
const view = (azDeg: number, elDeg: number, dist: number, fovDeg = 32, target = centre): CameraView => {
  const az = deg2rad(azDeg)
  const el = deg2rad(elDeg)
  const eye = v3add(target, {
    x: Math.sin(az) * Math.cos(el) * dist,
    y: Math.sin(el) * dist,
    z: Math.cos(az) * Math.cos(el) * dist,
  })
  return { intrinsics: intrinsicsFromFovY(deg2rad(fovDeg), W, H), extrinsics: lookAt(eye, target), width: W, height: H, near: DEFAULT_NEAR }
}
const worldMin: Vec3 = { x: -0.2, y: M.terrain, z: -0.2 }
const worldMax: Vec3 = { x: M.overallWidth + 0.2, y: M.ridge, z: M.overallDepth + 0.2 }

/** Looking straight down, with the entrance facade at the bottom of the page. */
function topView(width: number, height: number, marginFraction = 0.06): OrthographicView {
  const spanX = worldMax.x - worldMin.x
  const spanZ = worldMax.z - worldMin.z
  const margin = Math.max(spanX, spanZ) * marginFraction
  const scale = Math.min(width / (spanX + 2 * margin), height / (spanZ + 2 * margin))
  return {
    right: { x: 1, y: 0, z: 0 },
    up: { x: 0, y: 0, z: -1 },
    scale,
    origin: { x: worldMin.x, y: worldMax.y, z: worldMax.z },
    originU: margin * scale,
    originV: height - margin * scale,
    width,
    height,
  }
}

const shade = { ...DEFAULT_SHADE, groundPlane: true }
const all = asBuild(r.tris)
for (const [name, side] of [
  ['01-ortho-front', 'FRONT'],
  ['02-ortho-rear', 'REAR'],
  ['03-ortho-left', 'LEFT'],
  ['04-ortho-right', 'RIGHT'],
] as const) {
  write(name, shadeOrthographic(all, [], orthoViewForFacade(side, worldMin, worldMax, W, H, 0.06), W, H, { ...shade, groundPlane: false }))
}
write('07-ortho-top', shadeOrthographic(all, [], topView(W, H), W, H, { ...shade, groundPlane: false }))
write('05-front-three-quarter', shadePerspective(all, [], view(28, 14, radius * 1.5), W, H, shade))
write('06-rear-three-quarter', shadePerspective(all, [], view(212, 16, radius * 1.5), W, H, shade))
write('08-roof-off', shadePerspective(asBuild(r.tris.filter((t) => t.elementKind !== 'ROOF')), [], view(34, 34, radius * 1.4), W, H, shade))
// Wall thickness and the storey stack. Everything in front of a cut plane is
// dropped and the camera looks straight into what is left, so the wall band,
// the floor plate between the storeys and the roof build-up are all visible at
// their real depths. Triangles are removed whole, so the cut edge is ragged;
// it is a diagnostic, not a section drawing.
const CUT_Z = 6.4
write(
  '09-cut-away',
  shadePerspective(
    asBuild(r.tris.filter((t) => Math.max(t.a.z, t.b.z, t.c.z) <= CUT_Z + 1e-9)),
    [],
    view(18, 14, radius * 1.15, 30, { x: M.overallWidth / 2, y: 2.2, z: CUT_Z }),
    W,
    H,
    { ...shade, groundPlane: false },
  ),
)
// Elements by colour: roof against wall against slab against glass.
write(
  '10-elements',
  shadePerspective(all, [], view(28, 22, radius * 1.5), W, H, {
    ...shade,
    materials: {
      ...STUDY_MATERIALS,
      ROOF: { colour: [156, 122, 104], transparency: 0, sheen: 0 },
      SLAB: { colour: [150, 165, 176], transparency: 0, sheen: 0 },
      GLAZING: { colour: [104, 150, 186], transparency: 0.5, sheen: 0.4 },
    },
  }),
)

console.log(`\nwrote 10 renders of the emitted triangles to ${outDir}/`)
console.log('(software rasterisation of the triangle list, not a browser screenshot)')
