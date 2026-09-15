import { readFileSync, writeFileSync } from 'node:fs'
import { PNG } from 'pngjs'
const [src, x0s, y0s, x1s, y1s, zs, out] = process.argv.slice(2)
const png = PNG.sync.read(readFileSync(src))
const x0 = +x0s, y0 = +y0s, x1 = +x1s, y1 = +y1s, z = +zs
const w = (x1 - x0) * z, h = (y1 - y0) * z
const o = new PNG({ width: w, height: h })
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  const sx = x0 + Math.floor(x / z), sy = y0 + Math.floor(y / z)
  const si = (sy * png.width + sx) * 4, di = (y * w + x) * 4
  for (let k = 0; k < 4; k++) o.data[di + k] = sx >= 0 && sy >= 0 && sx < png.width && sy < png.height ? png.data[si + k] : 255
}
writeFileSync(out, PNG.sync.write(o))
console.log(out, w, h)
