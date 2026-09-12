/**
 * Serve `dist-standalone/` over plain HTTP.
 *
 * The standalone build is a set of ordinary files with relative references, so
 * any static server will do — this one exists so the owner has a single command
 * that works with nothing installed beyond the repo's own dependencies, and so
 * the port in the documentation is fixed.
 *
 * Set HOST=0.0.0.0 to reach it from a phone on the same network.
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'

const ROOT = 'dist-standalone'
const PORT = Number(process.env.PORT ?? 4173)
const HOST = process.env.HOST ?? '127.0.0.1'

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.png': 'image/png',
  '.json': 'application/json',
}

createServer(async (req, res) => {
  // Strip the query and any attempt to climb out of the build directory.
  const rel = normalize(decodeURIComponent((req.url ?? '/').split('?')[0])).replace(/^(\.\.[/\\])+/, '')
  const path = join(ROOT, rel.endsWith('/') || rel === '.' ? join(rel, 'index.html') : rel)
  try {
    const body = await readFile(path)
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end(`not in ${ROOT}: ${rel}\n`)
  }
}).listen(PORT, HOST, () => {
  console.log(`standalone build on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`)
  if (HOST === '0.0.0.0') console.log('reachable from other devices on this network at http://<this-machine-ip>:' + PORT)
})
