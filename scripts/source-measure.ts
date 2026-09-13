/**
 * Measure a source drawing — development only.
 *
 * The tool behind every SOURCE_DERIVED figure in
 * `research/gold/marcowki-exterior-shell-v1.json`. It does nothing clever: it
 * reports where the ink is, so that a number transcribed from a drawing can be
 * checked by someone who does not trust the transcription.
 *
 *   npx tsx scripts/source-measure.ts bands  <png> rows|cols [thr] [minRun] [x0 x1 y0 y1]
 *   npx tsx scripts/source-measure.ts line   <png> row|col <index> [thr]
 *   npx tsx scripts/source-measure.ts slope  <png> <y0> <y1> <x0> <x1> left|right [thr]
 *
 *   bands   rows or columns whose longest dark run reaches `minRun`, for
 *           finding walls, slabs and dimension lines.
 *   line    the dark segments along one row or column, for reading a wall's
 *           thickness or an opening's width off the drawing.
 *   slope   least-squares fit of a straight ink edge, reported as an angle from
 *           horizontal, for checking a printed roof pitch against the geometry.
 *
 * Decode a project's assets first with `npx tsx scripts/_dump.ts <dir>`.
 */
import { readFileSync } from 'node:fs'
import { PNG } from 'pngjs'

const [mode, file, ...rest] = process.argv.slice(2)
if (!mode || !file) {
  console.error('usage: source-measure.ts bands|line|slope <png> ...')
  process.exit(1)
}
const p = PNG.sync.read(readFileSync(file))
const lum = (x: number, y: number): number => {
  const i = (y * p.width + x) * 4
  return 0.299 * p.data[i] + 0.587 * p.data[i + 1] + 0.114 * p.data[i + 2]
}
const num = (v: string | undefined, fallback: number): number => (v === undefined ? fallback : Number(v))

if (mode === 'bands') {
  const [axis, thrS, minRunS, x0s, x1s, y0s, y1s] = rest
  const thr = num(thrS, 100)
  const minRun = num(minRunS, 40)
  const x0 = num(x0s, 0)
  const x1 = num(x1s, p.width)
  const y0 = num(y0s, 0)
  const y1 = num(y1s, p.height)
  console.log(`${file} ${p.width}x${p.height}  ${axis}  dark<${thr}  longest run >= ${minRun}`)
  const scan = (lo: number, hi: number, get: (v: number) => number) => {
    let best = 0
    let bestAt = -1
    let run = 0
    let runStart = -1
    let total = 0
    for (let v = lo; v < hi; v++) {
      if (get(v) < thr) {
        total++
        if (run === 0) runStart = v
        run++
        if (run > best) {
          best = run
          bestAt = runStart
        }
      } else run = 0
    }
    return { best, bestAt, total }
  }
  if (axis === 'rows') {
    for (let y = y0; y < y1; y++) {
      const r = scan(x0, x1, (x) => lum(x, y))
      if (r.best >= minRun) console.log(`  y=${y}  longestRun=${r.best} from x=${r.bestAt}  ink=${r.total}`)
    }
  } else {
    for (let x = x0; x < x1; x++) {
      const r = scan(y0, y1, (y) => lum(x, y))
      if (r.best >= minRun) console.log(`  x=${x}  longestRun=${r.best} from y=${r.bestAt}  ink=${r.total}`)
    }
  }
} else if (mode === 'line') {
  const [axis, idxS, thrS] = rest
  const idx = Number(idxS)
  const thr = num(thrS, 100)
  const n = axis === 'row' ? p.width : p.height
  const segs: string[] = []
  let start = -1
  for (let v = 0; v <= n; v++) {
    const dark = v < n && (axis === 'row' ? lum(v, idx) : lum(idx, v)) < thr
    if (dark && start < 0) start = v
    else if (!dark && start >= 0) {
      segs.push(`${start}..${v - 1}(${v - start})`)
      start = -1
    }
  }
  console.log(`${file} ${axis} ${idx}: ${segs.join('  ') || '(no ink)'}`)
} else if (mode === 'slope') {
  const [y0s, y1s, x0s, x1s, side, thrS] = rest
  const y0 = Number(y0s)
  const y1 = Number(y1s)
  const x0 = Number(x0s)
  const x1 = Number(x1s)
  const thr = num(thrS, 100)
  const pts: Array<{ x: number; y: number }> = []
  for (let y = y0; y <= y1; y++) {
    let found = -1
    if (side === 'left') {
      for (let x = x0; x <= x1; x++)
        if (lum(x, y) < thr) {
          found = x
          break
        }
    } else {
      for (let x = x1; x >= x0; x--)
        if (lum(x, y) < thr) {
          found = x
          break
        }
    }
    if (found >= 0) pts.push({ x: found, y })
  }
  if (pts.length < 8) {
    console.log(`only ${pts.length} points; widen the window`)
    process.exit(1)
  }
  const n = pts.length
  const my = pts.reduce((a, q) => a + q.y, 0) / n
  const mx = pts.reduce((a, q) => a + q.x, 0) / n
  let cov = 0
  let varY = 0
  for (const q of pts) {
    cov += (q.y - my) * (q.x - mx)
    varY += (q.y - my) ** 2
  }
  const m = cov / varY
  const b = mx - m * my
  let maxRes = 0
  for (const q of pts) maxRes = Math.max(maxRes, Math.abs(q.x - (m * q.y + b)))
  console.log(`${pts.length} points, y ${pts[0].y}..${pts[n - 1].y}, x ${pts[0].x}..${pts[n - 1].x}`)
  console.log(`  rise/run = ${(1 / Math.abs(m)).toFixed(5)}   angle = ${((Math.atan(1 / Math.abs(m)) * 180) / Math.PI).toFixed(3)} deg`)
  console.log(`  max residual ${maxRes.toFixed(2)} px`)
} else {
  console.error(`unknown mode ${mode}`)
  process.exit(1)
}
