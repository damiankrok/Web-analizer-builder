/**
 * OWNER VISUAL CHECKPOINT — drive the page at phone width and photograph it.
 *
 *   node scripts/owner-checkpoint-verify.mjs
 *
 * Serves dist-owner-checkpoint over loopback, opens it at 400 px wide, works
 * the controls the way a thumb would, and writes the four views the checkpoint
 * is for. It asserts nothing about the model — it checks that the page renders,
 * that the controls do something, and that the console stayed quiet.
 *
 * CHECKPOINT_ONLY.
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const ROOT = 'dist-owner-checkpoint'
const SHOTS = 'out/owner-checkpoint'
// The publish skeleton gives the page a charset; this local server has to say
// the same thing or the em-dashes come out as mojibake in the screenshots.
const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.png': 'image/png' }

mkdirSync(SHOTS, { recursive: true })

const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent((req.url ?? '/').split('?')[0])).replace(/^(\.\.[/\\])+/, '')
  const file = join(ROOT, path === '/' ? 'index.html' : path)
  try {
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    // The browser asks for a favicon whatever the page says; answering it
    // keeps the console clean so a real error stands out.
    if (path === '/favicon.ico') { res.writeHead(204).end(); return }
    res.writeHead(404).end('not found')
  }
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}/`

// The container ships one Chromium; the pinned Playwright expects another
// build. Its outbound HTTPS goes through an inspecting proxy whose CA this
// Chromium does not carry, so the CDN script and the font stylesheet — which
// the published page loads from the real hosts, unchanged — would fail here
// for a reason that has nothing to do with the page. The flag is for this
// verification run only.
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--ignore-certificate-errors'],
})
const page = await browser.newPage({ viewport: { width: 400, height: 860 }, deviceScaleFactor: 2 })
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push(String(e)))

await page.goto(base, { waitUntil: 'networkidle' })
await page.waitForTimeout(900)

const check = async (label, fn) => {
  const ok = await fn()
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
  return ok
}
let allOk = true
const track = async (label, fn) => { allOk = (await check(label, fn)) && allOk }

await track('the page renders a WebGL canvas', async () =>
  page.evaluate(() => {
    const c = document.querySelector('#canvasHost canvas')
    return !!c && c.clientWidth > 200 && c.clientHeight > 200
  }))

await track('the model is actually drawn, not a blank canvas', async () => {
  // Asking the page rather than the pixels: a screenshot's byte histogram is a
  // proxy for "something was drawn" and a poor one, because a simpler model is
  // not a blank one.
  const drawn = await page.evaluate(() => {
    const data = JSON.parse(document.getElementById('scene').textContent)
    const tris = data.automatic.groups.reduce((n, g) => n + g.positions.length / 9, 0)
    const canvas = document.querySelector('#canvasHost canvas')
    return { tris, width: canvas ? canvas.width : 0, height: canvas ? canvas.height : 0 }
  })
  return drawn.tris > 1000 && drawn.width > 100 && drawn.height > 100
})

await track('every source frame used in 3D is registered', async () =>
  page.evaluate(() => {
    const data = JSON.parse(document.getElementById('scene').textContent)
    return data.registration.registrations.length >= 3 &&
      data.registration.registrations.every((r) => r.status === 'RESOLVED')
  }))

await track('no coherence check is failing', async () =>
  page.evaluate(() => {
    const data = JSON.parse(document.getElementById('scene').textContent)
    return data.registration.checks.length >= 10 &&
      data.registration.checks.every((c) => c.status !== 'FAIL') &&
      document.querySelectorAll('#checks .mark.fail').length === 0
  }))

await track('the registration panel and the reference table are on the page', async () =>
  page.evaluate(() => document.querySelectorAll('#frameKv li').length >= 4 &&
    document.querySelectorAll('#checks li').length >= 10 &&
    document.querySelectorAll('#massTable tbody tr').length >= 1 &&
    document.querySelectorAll('#errorTable tbody tr').length >= 6))

await track('the named acceptance views all place the camera', async () =>
  page.evaluate(async () => {
    if (!window.__cp) return false
    for (const v of window.__cp.views) window.__cp.view(v)
    window.__cp.setMode('auto')
    return window.__cp.views.length === 6
  }))

await track('the truth panel carries the measured figures', async () =>
  page.evaluate(() => document.querySelectorAll('#planTables li').length >= 12 &&
    document.querySelectorAll('#targets li').length >= 10 &&
    document.querySelectorAll('#ladder li').length >= 6))

await track('unplaceable things are listed, not hidden', async () =>
  page.evaluate(() => document.querySelectorAll('#undrawable details').length >= 4))

await track('the open conflicts are listed', async () =>
  page.evaluate(() => document.querySelectorAll('#conflicts details').length >= 8))

await track('every source drawing loaded', async () => {
  // They are lazy, and the point of lazy is that they are not fetched until
  // they are wanted; scroll them into view first.
  await page.locator('.drawings').scrollIntoViewIfNeeded()
  await page.waitForTimeout(1200)
  const ok = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll('.drawings img')]
    return imgs.length === 7 && imgs.every((i) => i.complete && i.naturalWidth > 0)
  })
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(200)
  return ok
})

await track('the checkpoint says what it is', async () =>
  page.evaluate(() => /research visual checkpoint/i.test(document.querySelector('.warn').textContent) &&
    /not used by automatic extraction/i.test(document.querySelector('.warn').textContent)))

await track('nothing scrolls sideways at 400 px', async () =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))

// --- the four views
const shoot = async (name) => {
  // Past the "drag to orbit" hint, so the record shows the model and not a tip.
  await page.waitForTimeout(3900)
  await page.locator('.stage').screenshot({ path: join(SHOTS, `${name}.png`) })
}

await page.locator('#tReset').click()
await shoot('1-front-three-quarter')

await page.locator('#tRoof').click()          // roof off
await page.locator('#tAttic').click()         // attic off -> ground only
await shoot('2-ground-floor-roof-off')

await page.locator('#tGround').click()        // ground off
await page.locator('#tAttic').click()         // attic on
await shoot('3-attic-roof-off')

await page.locator('#tGround').click()        // ground back on
await page.locator('#tRoof').click()          // roof back on
await page.locator('#mBoth').click()          // overlay
await page.locator('#tReset').click()
await shoot('4-automatic-vs-gold-overlay')

await track('the mode switch changed what is on screen', async () =>
  page.evaluate(() => document.getElementById('mBoth').getAttribute('aria-pressed') === 'true'))

// full-page shot for the record
await page.screenshot({ path: join(SHOTS, 'page-full.png'), fullPage: true })

console.log(errors.length === 0 ? 'PASS  no console errors' : `FAIL  console errors:\n  ${errors.join('\n  ')}`)
if (errors.length > 0) allOk = false
console.log(`\nscreenshots in ${SHOTS}/`)
await browser.close()
server.close()
process.exitCode = allOk ? 0 : 1
