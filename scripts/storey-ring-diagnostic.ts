/**
 * STAGE WEB-PIVOT-01C diagnostic — development only.
 *
 *   npx tsx scripts/storey-ring-diagnostic.ts [outDir]     (default out/storey-ring)
 *
 * A console report of the whole-ring measurements, and six renders of the
 * triangles the compiler actually emits.
 *
 * The renders are a **programmatic rasterisation of the emitted triangle list**
 * by this repository's own software renderer (`src/core/camera/shade.ts`). No
 * browser is involved and no product UI is touched: this is evidence about the
 * geometry, not about a viewer.
 *
 * Every number printed comes from the independent oracles in
 * `tests/geometry-oracles.ts`, which read triangles and nothing else.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { compileStoreyRing } from '../src/core/wallspec/ring.js'
import { SOLID_PARTS, wallFrame, type CompiledTri } from '../src/core/wallspec/contracts.js'
import {
  CORNER_FL,
  CORNER_FR,
  CORNER_RL,
  CORNER_RR,
  FRONT_ID,
  FRONT_OPENING_ID,
  GROSS_FACADE_M2,
  INNER_DEPTH_M,
  INNER_WIDTH_M,
  LEFT_ID,
  OPAQUE_FACADE_M2,
  REAR_ID,
  RIGHT_ID,
  RIGHT_OPENING_ID,
  RING_CORNER_IDS,
  RING_DEPTH_M,
  RING_HEIGHT_M,
  RING_ROTATION_LEVEL,
  RING_SCHEDULES,
  RING_THICKNESS_M,
  RING_VOLUME_M3,
  RING_VOLUME_NO_OPENINGS_M3,
  RING_WALL_IDS,
  RING_WIDTH_M,
  SCHEDULE_A,
  SCHEDULE_B,
  ringEnvelopePlanes,
  ringFrame,
  ringInput,
  type OwnershipSchedule,
} from '../src/core/wallspec/ring-fixtures.js'
import {
  distanceToSurface,
  envelopeFaceArea,
  faceEscapes,
  manifoldReport,
  meshOverlapAlong,
  meshVolume,
  scanMaterial,
  type NamedMesh,
} from '../tests/geometry-oracles.js'
import type { BuildTri } from '../src/core/hypotheses/solid.js'
import { shadePerspective, DEFAULT_SHADE, STUDY_MATERIALS } from '../src/core/camera/shade.js'
import { lookAt, DEFAULT_NEAR, intrinsicsFromFovY, type CameraView } from '../src/core/camera/projector.js'
import { deg2rad, v3add, type Vec3 } from '../src/core/math/vec.js'

const outDir = process.argv[2] ?? 'out/storey-ring'
mkdirSync(outDir, { recursive: true })
const W = 960
const H = 660

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
  return {
    intrinsics: intrinsicsFromFovY(deg2rad(fovDeg), W, H),
    extrinsics: lookAt(eye, target),
    width: W,
    height: H,
    near: DEFAULT_NEAR,
  }
}

const solidOf = (tris: readonly CompiledTri[]): CompiledTri[] => tris.filter((t) => SOLID_PARTS.includes(t.part))
const asBuild = (t: readonly CompiledTri[]): BuildTri[] => t as unknown as BuildTri[]
const add = (p: Vec3, v: Vec3, s: number): Vec3 => ({ x: p.x + v.x * s, y: p.y + v.y * s, z: p.z + v.z * s })
const negate = (v: Vec3): Vec3 => ({ x: -v.x, y: -v.y, z: -v.z })
const f6 = (x: number): string => x.toFixed(6)

/** Where each corner sits, and which two walls meet there. */
const CORNERS: Record<string, { walls: [string, string]; a: number; c: number }> = {
  [CORNER_FL]: { walls: [FRONT_ID, LEFT_ID], a: 0, c: RING_DEPTH_M },
  [CORNER_FR]: { walls: [FRONT_ID, RIGHT_ID], a: RING_WIDTH_M, c: RING_DEPTH_M },
  [CORNER_RR]: { walls: [RIGHT_ID, REAR_ID], a: RING_WIDTH_M, c: 0 },
  [CORNER_RL]: { walls: [REAR_ID, LEFT_ID], a: 0, c: 0 },
}

function report(schedule: OwnershipSchedule): CompiledTri[] {
  const bare = compileStoreyRing(ringInput({ schedule, withOpenings: false }))
  const r = compileStoreyRing(ringInput({ schedule }))
  const solid = solidOf(r.tris)
  const meshes: NamedMesh[] = RING_WALL_IDS.map((id) => ({ id, tris: solid.filter((t) => t.wallId === id) }))
  const fr = ringFrame()

  console.log(`\n=== Schedule ${schedule.name} — ${schedule.description}`)
  console.log(`  ring closes                 : ${r.closed} (${r.order.join(' -> ')})`)
  console.log(`  diagnostics                 : ${r.diagnostics.length === 0 ? 'none' : r.diagnostics.map((d) => d.code).join(', ')}`)
  console.log('  corner ownership            :')
  for (const id of RING_CORNER_IDS) {
    const j = r.junctions.find((x) => x.junctionId === id)!
    console.log(`      ${id.padEnd(20)} owner ${j.ownerWallId.padEnd(12)} trims ${j.trimmedWallId} at ${j.trimmedEnd} by ${j.trimM} m`)
  }
  console.log('  emitted extents             : ' + r.extents.map((e) => `${e.wallId} ${e.a0.toFixed(2)}..${e.a1.toFixed(2)}`).join(' | '))

  const volBare = RING_WALL_IDS.reduce(
    (acc, id) => acc + meshVolume(solidOf(bare.tris).filter((t) => t.wallId === id)),
    0,
  )
  const vol = meshes.reduce((acc, m) => acc + meshVolume(m.tris), 0)
  console.log(`  volume without openings     : ${f6(volBare)} m3   (expected ${f6(RING_VOLUME_NO_OPENINGS_M3)})`)
  console.log(`  volume with both openings   : ${f6(vol)} m3   (expected ${f6(RING_VOLUME_M3)})`)

  const closedAll = meshes.every((m) => manifoldReport(m.tris).closed && manifoldReport(m.tris).orientable)
  console.log(`  every wall a closed solid   : ${closedAll}`)

  const planes = ringEnvelopePlanes()
  console.log(`  gross envelope facade       : ${f6(envelopeFaceArea(solidOf(bare.tris), planes))} m2   (expected ${f6(GROSS_FACADE_M2)})`)
  console.log(`  opaque facade with openings : ${f6(envelopeFaceArea(solid, planes))} m2   (expected ${f6(OPAQUE_FACADE_M2)})`)

  const centre = add(add(add(fr.origin, fr.x, RING_WIDTH_M / 2), fr.y, 0.4), fr.z, RING_DEPTH_M / 2)
  const clearX = distanceToSurface(solid, centre, fr.x) + distanceToSurface(solid, centre, negate(fr.x))
  const clearZ = distanceToSurface(solid, centre, fr.z) + distanceToSurface(solid, centre, negate(fr.z))
  console.log(`  clear interior below sills  : ${f6(clearX)} x ${f6(clearZ)} m   (expected ${f6(INNER_WIDTH_M)} x ${f6(INNER_DEPTH_M)})`)

  console.log('  per corner (overlap / gap)  :')
  for (const id of RING_CORNER_IDS) {
    const cfg = CORNERS[id]
    const pair = new Set(cfg.walls)
    let overlap = 0
    let gap = 0
    for (const b of [0.4, 2.6]) {
      const alongZ = add(add(add(fr.origin, fr.x, cfg.a === 0 ? 0.2 : RING_WIDTH_M - 0.2), fr.y, b), fr.z, -1)
      const alongX = add(add(add(fr.origin, fr.x, -1), fr.y, b), fr.z, cfg.c === 0 ? 0.2 : RING_DEPTH_M - 0.2)
      for (const [origin, dir, lo, hi] of [
        [alongZ, fr.z, cfg.c === 0 ? 0 : RING_DEPTH_M - RING_THICKNESS_M, cfg.c === 0 ? RING_THICKNESS_M : RING_DEPTH_M],
        [alongX, fr.x, cfg.a === 0 ? 0 : RING_WIDTH_M - RING_THICKNESS_M, cfg.a === 0 ? RING_THICKNESS_M : RING_WIDTH_M],
      ] as const) {
        for (const ov of meshOverlapAlong(meshes, origin, dir)) {
          if (pair.has(ov.a) && pair.has(ov.b)) overlap = Math.max(overlap, ov.lengthM)
        }
        const covered = scanMaterial(meshes, origin, dir)
          .merged.map((i) => ({ t0: i.t0 - 1, t1: i.t1 - 1 }))
          .reduce((acc, i) => acc + Math.max(0, Math.min(i.t1, hi) - Math.max(i.t0, lo)), 0)
        gap = Math.max(gap, hi - lo - covered)
      }
    }
    console.log(`      ${id.padEnd(20)} overlap ${f6(overlap)} m   gap ${f6(gap)} m`)
  }

  for (const [openingId, label] of [
    [FRONT_OPENING_ID, 'FRONT'],
    [RIGHT_OPENING_ID, 'RIGHT'],
  ] as const) {
    const mine = r.tris.filter((t) => t.openingId === openingId)
    const host = ringInput({ schedule }).walls.find((w) => w.id === mine[0].wallId)!
    const hf = wallFrame(host)
    const us: number[] = []
    const ups: number[] = []
    for (const t of mine) {
      for (const p of [t.a, t.b, t.c]) {
        const d = { x: p.x - host.origin.x, y: p.y - host.origin.y, z: p.z - host.origin.z }
        us.push(d.x * hf.u.x + d.y * hf.u.y + d.z * hf.u.z)
        ups.push(d.x * hf.up.x + d.y * hf.up.y + d.z * hf.up.z)
      }
    }
    console.log(
      `  ${label} opening in host frame : u ${f6(Math.min(...us))}..${f6(Math.max(...us))}  ` +
        `up ${f6(Math.min(...ups))}..${f6(Math.max(...ups))}`,
    )
  }

  const contact = solid.filter((t) => t.contactId)
  const buried = contact.every((t) => !faceEscapes(solid, t))
  console.log(`  contact faces               : ${contact.length} triangles over ${new Set(contact.map((t) => t.contactId)).size} corners, all buried: ${buried}`)
  return r.tris
}

console.log('STAGE WEB-PIVOT-01C — closed storey wall ring')
console.log(`${RING_WIDTH_M} x ${RING_DEPTH_M} m outside, ${RING_HEIGHT_M} m high, ${RING_THICKNESS_M} m thick; four walls, four owned corners, two openings`)

const trisA = report(SCHEDULE_A)
const trisB = report(SCHEDULE_B)
const rotated = compileStoreyRing(ringInput({ schedule: SCHEDULE_B, rotation: RING_ROTATION_LEVEL })).tris

// --- Renders. -------------------------------------------------------------
const shade = { ...DEFAULT_SHADE, groundPlane: true }
const centreTarget: Vec3 = { x: RING_WIDTH_M / 2, y: RING_HEIGHT_M * 0.45, z: RING_DEPTH_M / 2 }

write('01-ring-schedule-a', shadePerspective(asBuild(trisA), [], view(centreTarget, 34, 22, 20), W, H, shade))
write('02-ring-schedule-b', shadePerspective(asBuild(trisB), [], view(centreTarget, 34, 22, 20), W, H, shade))
// Roofless: the ring has no roof, so a high oblique looks straight into it.
write('03-interior-oblique', shadePerspective(asBuild(trisA), [], view(centreTarget, 128, 46, 15), W, H, shade))
write(
  '04-ring-rotated',
  shadePerspective(
    asBuild(rotated),
    [],
    view(
      {
        x: centreTarget.x * Math.cos(deg2rad(34)) + centreTarget.z * Math.sin(deg2rad(34)),
        y: centreTarget.y,
        z: -centreTarget.x * Math.sin(deg2rad(34)) + centreTarget.z * Math.cos(deg2rad(34)),
      },
      34,
      22,
      20,
    ),
    W,
    H,
    shade,
  ),
)
write(
  '05-opening-detail',
  shadePerspective(asBuild(trisA), [], view({ x: 3, y: 1.55, z: RING_DEPTH_M }, 48, 6, 4.2, 44), W, H, shade),
)

// Contact-face debug. Policy A keeps both faces in contact and tags them, so
// in the complete ring they are visible only as a hairline where they meet the
// owner's material — which is the policy working, and useless as evidence. The
// walls that own corners are therefore left out of this one render, so the
// tagged faces can be seen for what they are: full thickness-by-height end
// faces, flat against where the owner's material was. Nothing is moved and no
// gap is opened; this is a render-time relabel of triangles the compiler
// emitted unchanged.
const OWNERS_A = new Set(Object.values(SCHEDULE_A.owners))
const trimmedOnly: BuildTri[] = asBuild(trisA)
  .filter((t) => !OWNERS_A.has((t as BuildTri & { wallId: string }).wallId))
  .map((t) => ((t as BuildTri & { contactId?: string }).contactId ? { ...t, part: 'FEATURE' } : t))
write(
  '06-contact-faces',
  shadePerspective(trimmedOnly, [], view(centreTarget, 128, 34, 17), W, H, {
    ...shade,
    materials: { ...STUDY_MATERIALS, FEATURE: { colour: [214, 108, 82], transparency: 0, sheen: 0 } },
  }),
)

console.log(`\nwrote 6 renders of the emitted triangles to ${outDir}/`)
console.log('(software rasterisation of the triangle list, not a browser screenshot)')
