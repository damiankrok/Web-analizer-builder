import { loadSource } from '../src/node/source-loader.js'
import { prepareAsset } from '../src/core/raster/pipeline.js'
import { detectVanishingPoints } from '../src/core/projection/vp-detect.js'
const proj = process.argv[2], role = process.argv[3]
const r = await loadSource('https://x', { cacheDir: `fixtures/${proj}/assets`, htmlPath: `fixtures/${proj}/page.html` })
for (const a of r.pkg.assets.filter((x) => x.role === role)) {
  const ras = prepareAsset(r.images.get(a.id)!, { lineDrawing: /PLAN|SECTION|SITE/.test(role) })
  const vps = detectVanishingPoints(ras.segments, ras.image.width, ras.image.height)
  console.log(`=== ${proj} ${role} ${ras.image.width}x${ras.image.height} diag=${Math.hypot(ras.image.width, ras.image.height).toFixed(0)} segs=${ras.segments.length}`)
  for (const v of vps) {
    console.log(
      `  ${v.id} ${v.model.padEnd(11)} ori ${((v.meanOrientation * 180) / Math.PI).toFixed(1).padStart(6)}°`,
      `inl ${String(v.inliers.length).padStart(3)} sup ${v.supportLength.toFixed(0).padStart(5)}`,
      `conv ${((v.convergentResidualRad * 180) / Math.PI).toFixed(2)}° par ${((v.parallelResidualRad * 180) / Math.PI).toFixed(2)}°`,
      v.finite ? `@(${v.finite.u.toFixed(0)},${v.finite.v.toFixed(0)}) d=${(Math.hypot(v.finite.u - ras.image.width / 2, v.finite.v - ras.image.height / 2) / Math.hypot(ras.image.width, ras.image.height)).toFixed(1)}` : '@inf',
    )
  }
}
