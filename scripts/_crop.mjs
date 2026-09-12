/** Crop and nearest-neighbour magnify a region of a PNG for visual inspection. */
import { readFileSync, writeFileSync } from 'node:fs'
import { PNG } from 'pngjs'
const [src, out, X, Y, W, H, K] = process.argv.slice(2)
const p = PNG.sync.read(readFileSync(src))
const x = +X, y = +Y, w = +W, h = +H, k = +(K ?? 6)
const q = new PNG({ width: w * k, height: h * k })
for (let j = 0; j < h * k; j++) for (let i = 0; i < w * k; i++) {
  const sx = Math.min(p.width - 1, x + Math.floor(i / k)), sy = Math.min(p.height - 1, y + Math.floor(j / k))
  for (let c = 0; c < 4; c++) q.data[(j * w * k + i) * 4 + c] = p.data[(sy * p.width + sx) * 4 + c]
}
writeFileSync(out, PNG.sync.write(q))
console.log(`${src} [${x},${y} ${w}x${h}] x${k} -> ${out}`)
