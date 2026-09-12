import { loadSource } from '../src/node/source-loader.js'
import { prepareAsset } from '../src/core/raster/pipeline.js'
import { classifyProjection } from '../src/core/projection/classifier.js'

const proj = process.argv[2] ?? 'A-marcowki'
const r = await loadSource('https://x', { cacheDir: `fixtures/${proj}/assets`, htmlPath: `fixtures/${proj}/page.html` })
for (const a of r.pkg.assets) {
  const img = r.images.get(a.id)
  if (!img) continue
  const t0 = Date.now()
  const isDrawing = /PLAN|SECTION|SITE/.test(a.role)
  const ras = prepareAsset(img, { lineDrawing: isDrawing })
  const c = classifyProjection({ role: a.role, image: ras.image, gray: ras.gray, segments: ras.segments })
  console.log(
    a.role.padEnd(16), '->', c.type.padEnd(23), c.confidence.toFixed(2),
    '| segs', String(ras.segments.length).padStart(4),
    '| vConv', c.diagnostics.verticalConverges ? 'Y' : 'n',
    'hConv', c.diagnostics.horizontalConverges ? 'Y' : 'n',
    '| cands', c.diagnostics.candidateCount,
    `| ${Date.now() - t0}ms`,
  )
  if (/RENDER|ELEVATION/.test(a.role)) for (const reason of c.reasons) console.log('      ·', reason)
}
