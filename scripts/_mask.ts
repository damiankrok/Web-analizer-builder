import { writeFileSync } from 'node:fs'
import { PNG } from 'pngjs'
import { loadSource } from '../src/node/source-loader.js'
import { extractBuildingMask } from '../src/core/raster/mask.js'
const out = process.argv[2]
const r = await loadSource('https://x', { cacheDir: 'fixtures/A-marcowki/assets', htmlPath: 'fixtures/A-marcowki/page.html' })
for (const a of r.pkg.assets) {
  if (!/ELEVATION|RENDER/.test(a.role)) continue
  const img = r.images.get(a.id)!
  const t0 = Date.now()
  const res = extractBuildingMask(img)
  const p = new PNG({ width: img.width, height: img.height })
  const buf = Buffer.alloc(img.width * img.height * 4)
  for (let i = 0; i < img.width * img.height; i++) {
    const on = res.mask.data[i]
    buf[i * 4] = on ? img.data[i * 4] : 255
    buf[i * 4 + 1] = on ? img.data[i * 4 + 1] : 0
    buf[i * 4 + 2] = on ? img.data[i * 4 + 2] : 255
    buf[i * 4 + 3] = 255
  }
  p.data = buf
  writeFileSync(`${out}/MASK_${a.role}.png`, PNG.sync.write(p))
  console.log(a.role.padEnd(16), 'coverage', res.coverage.toFixed(3), 'groundRow', res.groundRow, `${Date.now() - t0}ms`, res.notes.join('; '))
}
