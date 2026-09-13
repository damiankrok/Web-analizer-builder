/**
 * Measure a published elevation render in metres — STAGE WEB-PIVOT-05, development only.
 *
 *   npx tsx scripts/elevation-measure.ts row <png> <yM> <x0px> <mPerPx> <y0px> [yScale]
 *   npx tsx scripts/elevation-measure.ts col <png> <xM> <x0px> <mPerPx> <y0px> [yScale]
 *
 * The tool behind every VISUAL_DERIVED figure in
 * `research/gold/marcowki-facade-v1.json`. ARCHON publishes its "elevations" as
 * renders rather than as line drawings, so they carry no dimension lines and
 * nothing can be read off them without a stated registration: two anchors per
 * axis, passed in on the command line, never detected. A detector that guessed
 * the calibration would be the one thing in this file nobody could check.
 *
 * `mPerPx` is signed. The rear and east views look along -Z and -X, so +X and
 * +Z run leftwards in the image and the scale is negative; `yScale` defaults to
 * `|mPerPx|` and is only passed when the two axes differ.
 *
 * What it reports is where each material is, in building coordinates. The
 * classes are deliberately crude — five buckets on luminance, saturation and
 * hue — because the question is only ever "is this wall, glass, timber, tile or
 * sky", and a run of the wrong class is a fact the caller can look at rather
 * than a number to be trusted.
 */
import { readFileSync } from 'node:fs'
import { PNG } from 'pngjs'

const [mode, file, atS, x0S, mpxS, y0S, ysS] = process.argv.slice(2)
if (!mode || !file || atS === undefined) {
  console.error('usage: elevation-measure.ts row|col <png> <atM> <x0px> <mPerPx> <y0px> [yScale]')
  process.exit(1)
}
const p = PNG.sync.read(readFileSync(file))
const X0 = Number(x0S)
const S = Number(mpxS)
const Y0 = Number(y0S)
const SY = ysS === undefined ? Math.abs(S) : Number(ysS)
const toX = (px: number): number => (px - X0) / S
const toY = (py: number): number => (Y0 - py) / SY
const mx = (m: number): number => Math.round(X0 + m * S)
const my = (m: number): number => Math.round(Y0 - m * SY)

const at = (x: number, y: number): [number, number, number] => {
  const i = (y * p.width + x) * 4
  return [p.data[i], p.data[i + 1], p.data[i + 2]]
}

/** W white render, D dark render or tile, T timber, G glass or sky, V planting. */
const cls = (r: number, g: number, b: number): string => {
  const l = (r + g + b) / 3
  const s = Math.max(r, g, b) - Math.min(r, g, b)
  if (l > 195 && s < 14) return 'W'
  if (l < 95 && s < 40) return 'D'
  if (r > g + 18 && g > b + 8 && l > 70) return 'T'
  if (g > r + 10 && g > b + 10) return 'V'
  if (b > r + 12 && l > 110) return 'G'
  return '.'
}

const f3 = (x: number): string => x.toFixed(3)
const n = mode === 'row' ? p.width : p.height
const fixed = mode === 'row' ? my(Number(atS)) : mx(Number(atS))
let out = ''
for (let v = 0; v < n; v++) out += mode === 'row' ? cls(...at(v, fixed)) : cls(...at(fixed, v))
console.log(`${file} ${p.width}x${p.height}  ${mode} at ${atS} m (px ${fixed})`)
let s = 0
for (let v = 1; v <= n; v++) {
  if (v === n || out[v] !== out[s]) {
    if (v - s >= 3) {
      const a = mode === 'row' ? toX(s) : toY(v - 1)
      const b = mode === 'row' ? toX(v - 1) : toY(s)
      console.log(`  ${out[s]}  ${f3(a)} .. ${f3(b)}   (px ${s}..${v - 1})`)
    }
    s = v
  }
}
