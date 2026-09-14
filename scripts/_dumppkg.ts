import { writeFileSync, mkdirSync } from 'node:fs'
import { PNG } from 'pngjs'
import { readPackage, readPackageAssets } from '../src/node/package-store.js'
import { assetFileNameFor } from '../src/core/contracts/source-package.js'
import { decodeImage } from '../src/node/image-decode.js'

const slug = process.argv[2] ?? 'A-marcowki'
const out = process.argv[3]!
mkdirSync(out, { recursive: true })
const pkg = await readPackage(slug)
const bytes = await readPackageAssets(slug)
for (const a of pkg.assets) {
  if (!a.contentHash) continue
  const data = bytes.get(assetFileNameFor(a.contentHash, a.mediaType))
  if (!data) continue
  const img = decodeImage(data)
  if (!img) continue
  const p = new PNG({ width: img.width, height: img.height })
  p.data = Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length)
  const role = `${a.roles?.document ?? 'X'}_${a.roles?.storey ?? 'X'}_${a.roles?.annotation ?? 'X'}`
  writeFileSync(`${out}/${a.assetId}_${role}.png`, PNG.sync.write(p))
  console.log(a.assetId, role, img.width, 'x', img.height)
}
