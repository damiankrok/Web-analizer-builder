/**
 * STAGE WEB-PIVOT-01 diagnostic — development only.
 *
 *   npx tsx scripts/wall-compiler-diagnostic.ts [outDir]     (default out/wallspec)
 *
 * Two things, both from the geometry that is actually emitted:
 *
 *  - a console report: measured volume, closed-surface report and ray results
 *    for the recessed and flush panels, beside what the production compiler
 *    does with the same wall;
 *  - PNG renders of those emitted triangles, viewed obliquely so the 0.45 m
 *    thickness and the reveals lining the cut are visible.
 *
 * The renders are a **programmatic rasterisation of the emitted triangle list**
 * by this repository's own software renderer (`src/core/camera/shade.ts`). They
 * are not a browser screenshot and not a Three.js view: no browser is involved.
 * That makes them evidence about the geometry rather than about a viewer.
 *
 * Nothing here touches the production pipeline or the UI.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { compileWalls } from '../src/core/wallspec/compile.js'
import { SOLID_PARTS, wallFrame, type CompiledTri } from '../src/core/wallspec/contracts.js'
import {
  EXPECTED_VOLUME_M3,
  FLUSH_ORIGIN,
  LOWER_MASS,
  OPENING_HEIGHT_M,
  OPENING_OFFSET_M,
  OPENING_SILL_M,
  OPENING_WIDTH_M,
  RECESSED_ORIGIN,
  UPPER_MASS,
  auditGlazing,
  auditOpening,
  auditPanel,
  contextWalls,
  singlePanelInput,
} from '../src/core/wallspec/fixtures.js'
import { manifoldReport, meshVolume, rayHits, surfaceCrossings } from '../tests/geometry-oracles.js'
import type { BuildTri } from '../src/core/hypotheses/solid.js'
import { buildSolidModel } from '../src/core/hypotheses/solid.js'
import type { BuildingHypothesis } from '../src/core/contracts/hypotheses.js'
import { rectRing } from '../src/core/contracts/geometry.js'
import { shadePerspective, DEFAULT_SHADE } from '../src/core/camera/shade.js'
import { lookAt, DEFAULT_NEAR, intrinsicsFromFovY, type CameraView } from '../src/core/camera/projector.js'
import { deg2rad, v3add, type Vec3 } from '../src/core/math/vec.js'

const outDir = process.argv[2] ?? 'out/wallspec'
mkdirSync(outDir, { recursive: true })
const W = 900
const H = 620

const write = (name: string, img: { width: number; height: number; data: Uint8ClampedArray }): void => {
  const p = new PNG({ width: img.width, height: img.height })
  p.data = Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length)
  writeFileSync(join(outDir, `${name}.png`), PNG.sync.write(p))
}

const view = (target: Vec3, azDeg: number, elDeg: number, dist: number, fovDeg = 34): CameraView => {
  const az = deg2rad(azDeg)
  const el = deg2rad(elDeg)
  const eye = v3add(target, {
    x: Math.sin(az) * Math.cos(el) * dist,
    y: Math.sin(el) * dist,
    z: Math.cos(az) * Math.cos(el) * dist,
  })
  return { intrinsics: intrinsicsFromFovY(deg2rad(fovDeg), W, H), extrinsics: lookAt(eye, target), width: W, height: H, near: DEFAULT_NEAR }
}

const solidOnly = (tris: readonly CompiledTri[]): CompiledTri[] => tris.filter((t) => SOLID_PARTS.includes(t.part))

/** Measure one compiled panel with the independent oracles and print it. */
function report(label: string, origin: Vec3): CompiledTri[] {
  const result = compileWalls(singlePanelInput(origin))
  const wall = auditPanel(origin)
  const solid = solidOnly(result.tris)
  const m = manifoldReport(solid)
  const f = wallFrame(wall)
  const inward = { x: -f.n.x, y: -f.n.y, z: -f.n.z }
  const shootAt = (a: number, b: number): Vec3 => ({
    x: wall.origin.x + f.u.x * a + f.up.x * b + f.n.x,
    y: wall.origin.y + f.u.y * a + f.up.y * b + f.n.y,
    z: wall.origin.z + f.u.z * a + f.up.z * b + f.n.z,
  })
  const centreA = OPENING_OFFSET_M + OPENING_WIDTH_M / 2
  const centreB = OPENING_SILL_M + OPENING_HEIGHT_M / 2

  console.log(`\n--- ${label}`)
  console.log(`  wall origin (outer face, base, u=0) : (${origin.x}, ${origin.y}, ${origin.z})`)
  console.log(`  diagnostics                         : ${result.diagnostics.length === 0 ? 'none' : result.diagnostics.map((d) => d.code).join(', ')}`)
  console.log(`  triangles                           : ${result.tris.length} (${solid.length} solid, ${result.tris.length - solid.length} glazing)`)
  console.log(`  closed surface / consistent winding : ${m.closed} / ${m.orientable}  (${m.boundaryEdges.length} boundary, ${m.duplicateEdges.length} duplicate edges)`)
  console.log(`  measured volume                     : ${meshVolume(solid).toFixed(9)} m3   (expected ${EXPECTED_VOLUME_M3.toFixed(9)})`)
  console.log(`  ray through opening centre          : ${surfaceCrossings(rayHits(solid, shootAt(centreA, centreB), inward))} wall surfaces crossed`)
  console.log(`  ray 1.0 m along the wall            : ${surfaceCrossings(rayHits(solid, shootAt(1.0, centreB), inward))} wall surfaces crossed`)
  console.log(`  ray 50 mm outside the jamb          : ${surfaceCrossings(rayHits(solid, shootAt(OPENING_OFFSET_M - 0.05, centreB), inward))} wall surfaces crossed`)
  console.log(`  ray 50 mm inside the jamb           : ${surfaceCrossings(rayHits(solid, shootAt(OPENING_OFFSET_M + 0.05, centreB), inward))} wall surfaces crossed`)
  return result.tris
}

console.log('STAGE WEB-PIVOT-01 — wall-local compiler')
console.log(`panel ${8} x ${3} m, ${0.45} m thick; opening ${OPENING_WIDTH_M} x ${OPENING_HEIGHT_M} m at ${OPENING_OFFSET_M} m, sill ${OPENING_SILL_M} m`)

const recessed = report(`recessed — the upper mass front wall, ${LOWER_MASS.maxZ - UPPER_MASS.maxZ} m behind the building front`, RECESSED_ORIGIN)
const flush = report('flush — the same panel on the building front plane', FLUSH_ORIGIN)

// The same wall through the production compiler, for comparison.
const legacy = (upperMaxZ: number): BuildingHypothesis => ({
  id: 'legacy', wallThicknessM: 0.45, plinthY: 0, producedBy: 'diagnostic',
  storeys: [
    { id: 'g', name: 'GROUND', floorY: 0, ceilingY: 3, authority: 'PLAN_MEASURED' },
    { id: 'u', name: 'UPPER', floorY: 3, ceilingY: 6, authority: 'PLAN_MEASURED' },
  ],
  masses: [
    { id: 'lower', kind: 'MAIN_BODY', footprint: { holes: [], outer: rectRing(0, 0, 8, LOWER_MASS.maxZ) }, baseY: 0, topY: 3, storeyIds: ['g'], authority: 'PLAN_MEASURED', confidence: 1, evidenceIds: [] },
    { id: 'upper', kind: 'MAIN_BODY', footprint: { holes: [], outer: rectRing(0, 0, 8, upperMaxZ) }, baseY: 3, topY: 6, storeyIds: ['u'], authority: 'PLAN_MEASURED', confidence: 1, evidenceIds: [] },
  ],
  roofs: [{ id: 'roof', massId: 'upper', kind: 'FLAT', pitchDeg: 0, eaveY: 6, ridgeY: 6, overhangM: 0, authority: 'PRIOR', confidence: 1 }],
  openings: [],
  openingGroups: [{ id: 'win', facade: 'FRONT', massId: 'upper', kind: 'WINDOW', memberIds: [], s: OPENING_OFFSET_M, sillY: 3 + OPENING_SILL_M, widthM: OPENING_WIDTH_M, heightM: OPENING_HEIGHT_M, panelCount: 1, clippedByRoof: false, authority: 'ELEVATION_MEASURED', confidence: 1 }],
  appearance: [], constraints: [], notes: [],
})
console.log('\n--- production compiler, same two placements (RC03)')
for (const [label, z] of [['recessed upper wall at z = 9 ', UPPER_MASS.maxZ], ['flush upper wall at z = 10   ', LOWER_MASS.maxZ]] as const) {
  const m = buildSolidModel(legacy(z))
  console.log(`  ${label}: openingCount ${m.quantities.openingCount}, glazing triangles ${m.tris.filter((t) => t.part === 'GLAZING').length}, reveal triangles ${m.tris.filter((t) => t.part === 'REVEAL').length}`)
}

// Renders. The context walls show the recess; they carry no openings and are
// never measured — they are there so the eye can see what the panel is behind.
const ctx = compileWalls({ walls: contextWalls(), openings: [], glazing: [] }).tris
const panelOnly = compileWalls({
  walls: [auditPanel(RECESSED_ORIGIN, 'recessed'), auditPanel({ ...FLUSH_ORIGIN, x: FLUSH_ORIGIN.x + 11 }, 'flush')],
  openings: [auditOpening('recessed', 'win_r'), auditOpening('flush', 'win_f')],
  glazing: [auditGlazing('win_r', 'glass_r'), auditGlazing('win_f', 'glass_f')],
}).tris

const shade = { ...DEFAULT_SHADE, groundPlane: true }
const asBuild = (t: readonly CompiledTri[]): BuildTri[] => t as unknown as BuildTri[]

write('01-recessed-in-context', shadePerspective(asBuild([...ctx, ...recessed]), [], view({ x: 4, y: 3.2, z: 7 }, 26, 14, 26), W, H, shade))
write('02-recessed-oblique', shadePerspective(asBuild(recessed), [], view({ x: 4, y: 4.5, z: 9 }, 52, 16, 15), W, H, shade))
write('03-flush-oblique', shadePerspective(asBuild(flush), [], view({ x: 4, y: 4.5, z: 10 }, 52, 16, 15), W, H, shade))
write('04-recessed-and-flush', shadePerspective(asBuild(panelOnly), [], view({ x: 9.5, y: 4.5, z: 9.5 }, 40, 18, 30), W, H, shade))
write('05-reveal-close', shadePerspective(asBuild(recessed), [], view({ x: 3, y: 4.5, z: 9 }, 66, 8, 5.5, 40), W, H, shade))

console.log(`\nwrote 5 renders of the emitted triangles to ${outDir}/`)
console.log('(software rasterisation of the triangle list, not a browser screenshot)')
