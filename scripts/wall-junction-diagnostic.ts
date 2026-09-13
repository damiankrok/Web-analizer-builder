/**
 * STAGE WEB-PIVOT-01B diagnostic — development only.
 *
 *   npx tsx scripts/wall-junction-diagnostic.ts [outDir]   (default out/wallspec-junction)
 *
 * A console report and five PNGs, both read from the triangles the junction
 * compiler actually emits.
 *
 * The renders are a **programmatic rasterisation of the emitted triangle list**
 * by this repository's own software renderer (`src/core/camera/shade.ts`). No
 * browser is involved and no Three.js view: they are evidence about geometry,
 * not about a viewer.
 *
 * The palette below is a diagnostic palette and is local to this file. The
 * production study materials are near-white by design so that form and shadow
 * carry the reading; here the question is *which wall owns what*, which needs
 * colour to answer. `STUDY_MATERIALS` is not modified and the UI is untouched.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { SOLID_PARTS, type CompiledTri } from '../src/core/wallspec/contracts.js'
import { compileJunctions, endInwardDir, exposedWallAreaM2 } from '../src/core/wallspec/junction.js'
import {
  CORNER_OPENING_HEIGHT_M,
  CORNER_OPENING_OFFSET_M,
  CORNER_OPENING_SILL_M,
  CORNER_OPENING_WIDTH_M,
  CORNER_ROTATION_LEVEL,
  EXPECTED_CORNER_VOLUME_M3,
  EXPECTED_CORNER_VOLUME_WITH_OPENING_M3,
  WALL_A_ID,
  WALL_B_ID,
  cornerInput,
  nonOwner,
  type CornerOwner,
} from '../src/core/wallspec/junction-fixtures.js'
import {
  intervalsOverlapLength,
  manifoldReport,
  meshArea,
  meshBounds,
  meshVolume,
  rayIntervals,
} from '../tests/geometry-oracles.js'
import type { BuildPart, BuildTri } from '../src/core/hypotheses/solid.js'
import { shadePerspective, DEFAULT_SHADE, STUDY_MATERIALS, type Material } from '../src/core/camera/shade.js'
import { lookAt, DEFAULT_NEAR, intrinsicsFromFovY, type CameraView } from '../src/core/camera/projector.js'
import { deg2rad, v3add, type Vec3 } from '../src/core/math/vec.js'

const outDir = process.argv[2] ?? 'out/wallspec-junction'
mkdirSync(outDir, { recursive: true })
const W = 900
const H = 620

const write = (name: string, img: { width: number; height: number; data: Uint8ClampedArray }): void => {
  const p = new PNG({ width: img.width, height: img.height })
  p.data = Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length)
  writeFileSync(join(outDir, `${name}.png`), PNG.sync.write(p))
}

const solidOnly = (tris: readonly CompiledTri[]): CompiledTri[] =>
  tris.filter((t) => SOLID_PARTS.includes(t.part))
const ofWall = (tris: readonly CompiledTri[], id: string): CompiledTri[] =>
  tris.filter((t) => t.wallId === id)

// --------------------------------------------------------------------------
// Console report.
// --------------------------------------------------------------------------

function report(owner: CornerOwner, withOpening: boolean): void {
  const result = compileJunctions(cornerInput({ owner, openingOn: withOpening ? 'NON_OWNER' : 'NONE' }))
  const solid = solidOnly(result.tris)
  const a = ofWall(solid, WALL_A_ID)
  const b = ofWall(solid, WALL_B_ID)
  const j = result.junctions[0]
  const contact = solid.filter((t) => t.contactId)
  const expected = withOpening ? EXPECTED_CORNER_VOLUME_WITH_OPENING_M3 : EXPECTED_CORNER_VOLUME_M3

  // Independent overlap probe: read each closed solid separately along a line
  // that crosses the corner, and measure the shared length.
  let worstOverlap = 0
  for (const y of [0.3, 1.5, 2.7]) {
    for (const x of [3.6, 3.8, 3.95]) {
      const o = { x, y, z: -2 }
      const d = { x: 0, y: 0, z: 1 }
      worstOverlap = Math.max(worstOverlap, intervalsOverlapLength(rayIntervals(a, o, d), rayIntervals(b, o, d)))
    }
  }

  console.log(`\n--- ${owner === 'A' ? 'wall_a' : 'wall_b'} owns the corner${withOpening ? ', opening on the non-owner' : ''}`)
  console.log(`  diagnostics                    : ${result.diagnostics.length === 0 ? 'none' : result.diagnostics.map((d) => d.code).join(', ')}`)
  console.log(`  owner / trimmed                : ${j.ownerWallId} keeps the corner, ${j.trimmedWallId} trimmed ${j.trimM} m at its ${j.trimmedEnd} end`)
  console.log(`  compiled extents               : ${result.extents.map((e) => `${e.wallId} ${e.a0}..${e.a1}`).join('   ')}`)
  console.log(`  nominal lengths (unchanged)    : ${cornerInput({ owner }).walls.slice(0, 2).map((w) => `${w.id} ${w.lengthM}`).join('   ')}`)
  console.log(`  closed / wound outward         : A ${manifoldReport(a).closed && meshVolume(a) > 0}, B ${manifoldReport(b).closed && meshVolume(b) > 0}`)
  console.log(`  volume  A + B                  : ${meshVolume(a).toFixed(9)} + ${meshVolume(b).toFixed(9)} = ${(meshVolume(a) + meshVolume(b)).toFixed(9)} m3   (expected ${expected.toFixed(9)})`)
  console.log(`  corner prism, emitted once     : ${j.cornerVolumeM3.toFixed(9)} m3 by ${j.ownerWallId}`)
  console.log(`  shared material across corner  : ${worstOverlap.toExponential(3)} m of interval (contact only)`)
  console.log(`  contact face                   : ${contact.length} triangles, ${meshArea(contact).toFixed(6)} m2, id ${contact[0]?.contactId ?? '-'}`)
  console.log(`  surface area exposed / total   : ${exposedWallAreaM2(solid).toFixed(6)} / ${meshArea(solid).toFixed(6)} m2`)
}

console.log('STAGE WEB-PIVOT-01B — orthogonal wall junction ownership')
console.log('two 4.0 x 3.0 m walls, 0.45 m thick, one 90-degree exterior BUTT corner')
console.log(`opening ${CORNER_OPENING_WIDTH_M} x ${CORNER_OPENING_HEIGHT_M} m at ${CORNER_OPENING_OFFSET_M} m along, sill ${CORNER_OPENING_SILL_M} m`)

for (const owner of ['A', 'B'] as const) {
  report(owner, false)
  report(owner, true)
}

// Without a junction record: the corner every independent wall claims twice.
const doubled = compileJunctions({ ...cornerInput({ owner: 'A', openingOn: 'NONE' }), junctions: [] })
const dSolid = solidOnly(doubled.tris)
console.log('\n--- no junction record, for comparison')
console.log(`  volume A + B                   : ${(meshVolume(ofWall(dSolid, WALL_A_ID)) + meshVolume(ofWall(dSolid, WALL_B_ID))).toFixed(9)} m3  (the corner counted twice)`)

// --------------------------------------------------------------------------
// Renders.
// --------------------------------------------------------------------------

/**
 * Diagnostic palette. Local to this script; `STUDY_MATERIALS` is untouched.
 *
 * Owner, non-owner, the contact face at the join and the glazing each get a
 * distinguishable colour, because the thing being looked for here is which wall
 * material belongs to — a question a monochrome study model is designed not to
 * answer.
 */
const OWNER_C: [number, number, number] = [236, 226, 206] // warm: the wall that keeps the corner
const NON_OWNER_C: [number, number, number] = [206, 220, 232] // cool: the wall that was trimmed
const CONTACT_C: [number, number, number] = [214, 142, 120] // the join face, pressed against the owner
const REVEAL_C: [number, number, number] = [198, 190, 176]

const m = (colour: [number, number, number], transparency = 0, sheen = 0): Material => ({ colour, transparency, sheen })
const PALETTE: Record<BuildPart, Material> = {
  ...STUDY_MATERIALS,
  WALL: m(OWNER_C),
  WALL_INNER: m([220, 211, 193]),
  SLAB: m(NON_OWNER_C), // re-used slot: the non-owner's outer material
  ROOF: m([190, 205, 218]), // re-used slot: the non-owner's inner material
  FEATURE: m(CONTACT_C), // re-used slot: the contact face at the join
  REVEAL: m(REVEAL_C),
  GLAZING: m([150, 184, 204], 0.55, 0.4),
}

/**
 * Recolour by role rather than by element class.
 *
 * The renderer keys its material off `part`, so the role is carried in on that
 * field. Nothing downstream of this function is production code.
 */
function paint(tris: readonly CompiledTri[], ownerWallId: string): BuildTri[] {
  return tris.map((t) => {
    let part: BuildPart = t.part as BuildPart
    if (t.contactId) part = 'FEATURE'
    else if (t.part === 'GLAZING' || t.part === 'REVEAL') part = t.part
    else if (t.wallId !== ownerWallId) part = t.part === 'WALL_INNER' ? 'ROOF' : 'SLAB'
    return { a: t.a, b: t.b, c: t.c, part, ownerId: t.ownerId }
  }) as BuildTri[]
}

/** Frame a triangle list from a given azimuth and elevation. */
function frame(tris: readonly BuildTri[], azDeg: number, elDeg: number, fill = 2.1, fovDeg = 34): CameraView {
  const b = meshBounds(tris)
  const target: Vec3 = {
    x: (b.min.x + b.max.x) / 2,
    y: (b.min.y + b.max.y) / 2,
    z: (b.min.z + b.max.z) / 2,
  }
  const dist = fill * Math.max(b.size.x, b.size.y, b.size.z)
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

const shade = { ...DEFAULT_SHADE, groundPlane: true, materials: PALETTE }
const render = (name: string, tris: readonly BuildTri[], view: CameraView): void =>
  write(name, shadePerspective(tris, [], view, W, H, shade))

const scene = (owner: CornerOwner, opts: Parameters<typeof cornerInput>[0] = { owner }): BuildTri[] => {
  const r = compileJunctions({ ...cornerInput(opts), junctions: cornerInput({ owner }).junctions })
  return paint(r.tris, r.junctions[0]?.ownerWallId ?? '')
}

// 1 and 2: the same two walls, the corner given to each in turn. The warm wall
// owns it; the cool wall stops short and its end face is the red join.
render('01-owner-wall-a', scene('A', { owner: 'A', openingOn: 'NONE' }), frame(scene('A', { owner: 'A', openingOn: 'NONE' }), 42, 24))
render('02-owner-wall-b', scene('B', { owner: 'B', openingOn: 'NONE' }), frame(scene('B', { owner: 'B', openingOn: 'NONE' }), 42, 24))

// 3: the same assembly under a rigid motion, framed from the camera carried
// through the same rotation. It should be render 01 again — a rigid motion of
// the model and of the eye together is no change at all, and any difference in
// the silhouette would be the compiler reading the world frame. The shading
// does differ: the key light and the ground plane stay where they were.
const ROT_DEG = 37
const rotated = scene('A', { owner: 'A', openingOn: 'NONE', rotation: CORNER_ROTATION_LEVEL })
render('03-rotated-assembly', rotated, frame(rotated, 42 + ROT_DEG, 24))

// 4: the hosted opening on the trimmed wall, well clear of the corner.
const withOpening = scene('A', { owner: 'A', openingOn: 'NON_OWNER' })
render('04-hosted-opening', withOpening, frame(withOpening, 96, 14, 1.9, 40))

// 5: the join, pulled apart.
//
// The contact face is red and, in the assembly as compiled, invisible — which
// is the whole claim being made about it. So the trimmed wall is slid back
// along its own axis for this view only. Nothing is re-compiled: these are the
// same emitted triangles, displaced, and the face that appears is the one the
// exposed-area measure excludes.
const joinResult = compileJunctions(cornerInput({ owner: 'A', openingOn: 'NON_OWNER' }))
const joinJ = joinResult.junctions[0]
const trimmedWall = cornerInput({ owner: 'A' }).walls.find((w) => w.id === joinJ.trimmedWallId)!
const away = endInwardDir(trimmedWall, joinJ.trimmedEnd)
const EXPLODE_M = 0.9
const exploded = paint(
  joinResult.tris.map((t) =>
    t.wallId === joinJ.trimmedWallId
      ? {
          ...t,
          a: v3add(t.a, { x: away.x * EXPLODE_M, y: away.y * EXPLODE_M, z: away.z * EXPLODE_M }),
          b: v3add(t.b, { x: away.x * EXPLODE_M, y: away.y * EXPLODE_M, z: away.z * EXPLODE_M }),
          c: v3add(t.c, { x: away.x * EXPLODE_M, y: away.y * EXPLODE_M, z: away.z * EXPLODE_M }),
        }
      : t,
  ),
  joinJ.ownerWallId,
)
render('05-corner-contact-exploded', exploded, frame(exploded, 28, 22, 1.8, 38))

console.log(`\nwrote 5 renders of the emitted triangles to ${outDir}/`)
console.log('(software rasterisation of the triangle list, not a browser screenshot)')
console.log('warm = owner, cool = trimmed non-owner, red = contact face at the join, blue-grey = glazing')
console.log(`(05 slides the trimmed wall ${EXPLODE_M} m along its own axis so the contact face can be seen at all)`)
