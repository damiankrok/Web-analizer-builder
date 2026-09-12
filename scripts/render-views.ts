/** Render the resolved geometry from the standard audit views (§40 addendum). */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { loadSource } from '../src/node/source-loader.js'
import { analyze, DEFAULT_ANALYZE } from '../src/core/pipeline/analyze.js'
import { tessellate, worldBounds } from '../src/core/hypotheses/tessellate.js'
import { shadePerspective, shadeOrthographic } from '../src/core/camera/shade.js'
import { lookAt, DEFAULT_NEAR, intrinsicsFromFovY, type CameraView } from '../src/core/camera/projector.js'
import { orthoViewForFacade } from '../src/core/scoring/elevation.js'
import { hypothesisBounds } from '../src/core/scoring/multiview.js'
import { deg2rad, v3add } from '../src/core/math/vec.js'
import { projectByKey } from '../src/node/projects.js'

const key = process.argv[2] ?? 'A'
const outDir = process.argv[3] ?? 'out/views'
const project = projectByKey(key)!
const W = 640
const H = 480

const loaded = await loadSource(project.url, {
  cacheDir: `fixtures/${project.slug}/assets`,
  htmlPath: `fixtures/${project.slug}/page.html`,
})
const result = analyze(loaded.pkg, loaded.images, { ...DEFAULT_ANALYZE, maxRepairCycles: 2 })
const tess = tessellate(result.resolved)
const wb = worldBounds(tess)
const hb = hypothesisBounds(result.resolved)
mkdirSync(outDir, { recursive: true })

const write = (name: string, img: { width: number; height: number; data: Uint8ClampedArray }) => {
  const p = new PNG({ width: img.width, height: img.height })
  p.data = Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length)
  writeFileSync(join(outDir, `${name}.png`), PNG.sync.write(p))
}

const persp = (azDeg: number, elDeg: number, fovDeg = 32, dist = wb.radius * 3.4): CameraView => {
  const az = deg2rad(azDeg)
  const el = deg2rad(elDeg)
  const target = { x: wb.centre.x, y: wb.centre.y * 0.9, z: wb.centre.z }
  const eye = v3add(target, {
    x: Math.sin(az) * Math.cos(el) * dist,
    y: Math.sin(el) * dist,
    z: Math.cos(az) * Math.cos(el) * dist,
  })
  return { intrinsics: intrinsicsFromFovY(deg2rad(fovDeg), W, H), extrinsics: lookAt(eye, target), width: W, height: H, near: DEFAULT_NEAR }
}

for (const [name, view] of [
  ['front_34', persp(28, 12)],
  ['rear_34', persp(208, 12)],
  ['left_34', persp(-62, 12)],
  ['top', persp(20, 62, 34, wb.radius * 4.2)],
] as const) {
  write(name, shadePerspective(tess.tris, tess.edges, view, W, H))
}

for (const side of ['FRONT', 'REAR', 'LEFT', 'RIGHT'] as const) {
  const ov = orthoViewForFacade(side, hb.min, hb.max, W, H, 0.08)
  write(`ortho_${side.toLowerCase()}`, shadeOrthographic(tess.tris, tess.edges, ov, W, H))
}

console.log(`rendered ${project.name} -> ${outDir}`)
console.log(`masses ${result.resolved.masses.length}, roofs ${result.resolved.roofs.length}, openingGroups ${result.resolved.openingGroups.length}, appearance ${result.resolved.appearance.length}, tris ${tess.tris.length}`)
