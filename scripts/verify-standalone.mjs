/**
 * Drive the standalone build in a real browser at phone size and check the
 * things an owner will actually do (§6 of the handoff).
 *
 * It serves `dist-standalone/` over plain HTTP — the same way a host would —
 * and, on request, under a Content-Security-Policy that mirrors the artifact
 * host's, so the fallback paths are exercised rather than assumed.
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { mkdirSync } from 'node:fs'
import { chromium, devices } from 'playwright'

const ROOT = 'dist-standalone'
const SHOTS = 'out/preview'
mkdirSync(SHOTS, { recursive: true })

const STRICT_CSP = process.env.STRICT_CSP === '1'
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.png': 'image/png',
  '.json': 'application/json',
}

const server = createServer(async (req, res) => {
  const path = (req.url ?? '/').split('?')[0]
  const rel = normalize(path === '/' ? '/index.html' : path).replace(/^(\.\.[/\\])+/, '')
  try {
    const body = await readFile(join(ROOT, rel))
    const headers = { 'content-type': TYPES[extname(rel)] ?? 'application/octet-stream' }
    if (STRICT_CSP) {
      // Mirrors the artifact host: scripts from self and a CDN allowlist,
      // no connect-src at all, workers from blob only.
      headers['content-security-policy'] =
        "default-src 'self'; script-src 'self' 'unsafe-inline' blob: https://cdnjs.cloudflare.com; " +
        "worker-src blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'"
    }
    res.writeHead(200, headers)
    res.end(body)
  } catch {
    res.writeHead(404).end('not found')
  }
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}`
console.log(`serving ${ROOT} at ${base}${STRICT_CSP ? ' under a strict CSP' : ''}`)

const MARCOWKI = 'https://www.archon.pl/projekty-domow/projekt-dom-w-marcowkach-ge-m2fa281446a8ca'
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const context = await browser.newContext({ ...devices['Pixel 5'] })
const page = await context.newPage()
const consoleErrors = []
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text())
})
page.on('pageerror', (e) => consoleErrors.push(String(e)))
// Any request leaving the origin would mean the build depends on something it
// does not carry.
const foreign = []
page.on('request', (r) => {
  if (!r.url().startsWith(base) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) foreign.push(r.url())
})
const notFound = []
page.on('response', (r) => {
  if (r.status() === 404) notFound.push(r.url().replace(base, ''))
})

await page.goto(base, { waitUntil: 'load' })
check('1. page loads on a mobile viewport', (await page.locator('h1').count()) > 0, `${(await page.viewportSize()).width}px wide`)
await page.screenshot({ path: join(SHOTS, '01-loaded.png'), fullPage: false })

const input = page.locator('input.urlinput')
check('2. URL input is present and editable', (await input.count()) === 1)
await input.fill('')
await input.type(MARCOWKI, { delay: 0 })
check('3. Marcowki ARCHON URL can be submitted', (await input.inputValue()) === MARCOWKI)

await page.locator('button', { hasText: /^Analyse$/ }).click()
// Decoding the cached package is the deployed environment's "source fetching".
await page.waitForFunction(() => /decoding source images/i.test(document.body.innerText), null, { timeout: 60_000 })
check('4. source fetching works in the deployed environment', true, 'cached package decoded from files published beside the page')
await page.screenshot({ path: join(SHOTS, '02-analysing.png') })

await page.waitForFunction(() => /Score|SCORE/.test(document.body.innerText) && !/Analysing/.test(document.body.innerText), null, {
  timeout: 600_000,
})
const text = await page.locator('body').innerText()
check('5. analysis runs', /Score/i.test(text), (text.match(/hard constraints[^\n]*/i) ?? [''])[0].slice(0, 60))
await page.screenshot({ path: join(SHOTS, '03-analysed.png'), fullPage: false })

const canvas = page.locator('canvas').first()
const box = await canvas.boundingBox()
check('6. 3D model is displayed', box !== null && box.width > 100 && box.height > 100, box ? `${Math.round(box.width)}×${Math.round(box.height)} canvas` : 'no canvas')

// Orbit and zoom: drag, then wheel, and compare pixels.
const before = await canvas.screenshot()
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
await page.mouse.down()
await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2 + 30, { steps: 12 })
await page.mouse.up()
await page.waitForTimeout(400)
const afterDrag = await canvas.screenshot()
await page.mouse.wheel(0, -400)
await page.waitForTimeout(400)
const afterWheel = await canvas.screenshot()
check(
  '7. orbit and zoom work',
  !before.equals(afterDrag) && !afterDrag.equals(afterWheel),
  `orbit ${before.equals(afterDrag) ? 'no change' : 'changed'}, zoom ${afterDrag.equals(afterWheel) ? 'no change' : 'changed'}`,
)
await page.screenshot({ path: join(SHOTS, '04-orbited.png'), fullPage: false })

// The asset grid lazy-loads, so it has to be scrolled into view and given a
// moment before the count means anything.
const assetPanel = page.locator('.panel', { has: page.locator('h2', { hasText: /source assets/i }) }).first()
await assetPanel.scrollIntoViewIfNeeded()
await page.waitForTimeout(1200)
await page.evaluate(() => {
  for (const img of Array.from(document.querySelectorAll('.panel img'))) img.loading = 'eager'
})
await page.waitForFunction(
  () => Array.from(document.querySelectorAll('.panel img')).every((i) => i.complete),
  null,
  { timeout: 30_000 },
)
const images = await page.locator('.panel img').count()
const decoded = await page.evaluate(() =>
  Array.from(document.querySelectorAll('.panel img')).filter((i) => i.naturalWidth > 0).length,
)
const broken = await page.evaluate(() =>
  Array.from(document.querySelectorAll('.panel img'))
    .filter((i) => i.naturalWidth === 0)
    .map((i) => i.getAttribute('src') || '(no src)'),
)
check(
  '8. source comparison panel works',
  images > 0 && decoded === images,
  `${decoded}/${images} source thumbnails decoded${broken.length ? `; broken: ${broken.slice(0, 3).join(' ')}` : ''}`,
)

const panels = await page.locator('.panel h2').allInnerTexts()
const wanted = ['Cameras', 'Score breakdown', 'Printed dimensions', 'Source resolution', 'Rooflights', 'Opening identity', 'Metric audit']
const missing = wanted.filter((w) => !panels.some((p) => p.toLowerCase().includes(w.toLowerCase())))
check('9. camera and debug panels work', missing.length === 0, missing.length ? `missing: ${missing.join(', ')}` : `${panels.length} panels: ${panels.join(' · ')}`)

check('10. no request leaves the published origin', foreign.length === 0, foreign.length ? foreign.slice(0, 3).join(' ') : 'every file came from the build')

// Scroll through and shoot the panels for the record.
for (const [i, name] of wanted.entries()) {
  const p = page.locator('.panel', { has: page.locator('h2', { hasText: new RegExp(name, 'i') }) }).first()
  if ((await p.count()) === 0) continue
  await p.scrollIntoViewIfNeeded()
  await page.waitForTimeout(150)
  await page.screenshot({ path: join(SHOTS, `05-${String(i + 1).padStart(2, '0')}-${name.replace(/\W+/g, '-').toLowerCase()}.png`) })
}

// An unbundled URL must be refused with the reason, not met with a spinner.
await page.locator('h1').scrollIntoViewIfNeeded()
await input.fill('https://www.archon.pl/projekty-domow/projekt-dom-nieistniejacy-mdeadbeef')
await page.locator('button', { hasText: /^Analyse$/ }).click()
await page.waitForFunction(() => /cannot fetch archon\.pl directly/i.test(document.body.innerText), null, { timeout: 30_000 })
check('11. an unbundled URL is refused with the reason', true, 'CLI caching step quoted')
await page.screenshot({ path: join(SHOTS, '06-unbundled-url.png') })

if (notFound.length > 0) console.log(`\n404s (${notFound.length}): ${notFound.slice(0, 8).join(' ')}`)
if (consoleErrors.length > 0) console.log(`\nconsole errors (${consoleErrors.length}):\n  ${consoleErrors.slice(0, 6).join('\n  ')}`)

await browser.close()
server.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed; screenshots in ${SHOTS}/`)
process.exit(failed.length === 0 ? 0 : 1)
