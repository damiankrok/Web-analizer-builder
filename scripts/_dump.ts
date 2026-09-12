import { writeFileSync, mkdirSync } from 'node:fs'
import { PNG } from 'pngjs'
import { loadSource } from '../src/node/source-loader.js'
const out = process.argv[2]
const proj = process.argv[3] ?? 'A-marcowki'
const url = process.argv[4] ?? 'https://www.archon.pl/projekty-domow/projekt-dom-w-marcowkach-ge-m2fa281446a8ca'
mkdirSync(out, { recursive: true })
const r = await loadSource(url, { cacheDir: `fixtures/${proj}/assets`, htmlPath: `fixtures/${proj}/page.html` })
for (const a of r.pkg.assets) {
  const img = r.images.get(a.id)
  if (!img) continue
  const p = new PNG({ width: img.width, height: img.height })
  p.data = Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length)
  writeFileSync(`${out}/${a.role}_${a.id.slice(-6)}.png`, PNG.sync.write(p))
}
console.log('dumped to', out)
