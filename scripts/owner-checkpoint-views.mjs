/**
 * STAGE WEB-PIVOT-07R §13 — the automatic-only visual acceptance views.
 *
 *   node scripts/owner-checkpoint-views.mjs
 *
 * Six views of the automatic model alone, captured from the page a reader
 * actually opens rather than from a second viewer written to flatter it. The
 * gold model is not switched on: §14 is explicit that gold may only be shown
 * once automatic coherence has passed on its own.
 *
 * CHECKPOINT_ONLY.
 */
import { createServer } from 'node:http'
import { readFile, mkdir } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { chromium } from 'playwright'

const DIR = 'dist-owner-checkpoint'
const OUT = 'out/owner-checkpoint'
const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.png': 'image/png' }

const server = createServer(async (req, res) => {
  const path = (req.url ?? '/').split('?')[0]
  if (path === '/favicon.ico') { res.writeHead(204).end(); return }
  try {
    const file = path === '/' ? 'index.html' : path.slice(1)
    const body = await readFile(join(DIR, file))
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body)
  } catch {
    res.writeHead(404).end('not found')
  }
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}/`

await mkdir(OUT, { recursive: true })
// The container ships Chromium 1194; the pinned Playwright expects another
// build, so the executable is named rather than downloaded.
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--ignore-certificate-errors'],
})
const page = await browser.newPage({ viewport: { width: 1100, height: 1000 }, deviceScaleFactor: 2 })
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
await page.goto(base, { waitUntil: 'networkidle' })
await page.waitForFunction(() => window.__cp !== undefined)
// The page sizes its canvas for a phone. These are acceptance renders, not
// screenshots of the phone layout, so the canvas is given the room a reader
// would give it on a laptop. Nothing about the model changes.
await page.addStyleTag({ content: '.canvas{height:760px !important}' })
await page.waitForTimeout(3900)
await page.evaluate(() => window.__cp.setMode('auto'))

const VIEWS = [
  ['1-front-three-quarter', 'front-three-quarter'],
  ['2-rear-three-quarter', 'rear-three-quarter'],
  ['3-ground-roof-off', 'ground-roof-off'],
  ['4-attic-roof-off', 'attic-roof-off'],
  ['5-side-orthographic', 'side-orthographic'],
  ['6-front-orthographic', 'front-orthographic'],
]
for (const [file, view] of VIEWS) {
  await page.evaluate((v) => window.__cp.view(v), view)
  await page.waitForTimeout(250)
  await page.locator('#canvasHost').screenshot({ path: join(OUT, `auto-${file}.png`) })
  process.stdout.write(`auto-${file}.png\n`)
}
if (errors.length > 0) {
  console.error(`console errors: ${errors.join(' | ')}`)
  process.exitCode = 1
}
await browser.close()
server.close()
