/**
 * Measure roof features on a published elevation — STAGE WEB-PIVOT-05A, development only.
 *
 *   npx tsx scripts/roof-feature-measure.ts top     <png> <c0> <c1>
 *   npx tsx scripts/roof-feature-measure.ts patches <png> <c0> <c1> <yTopM> <yBotM> <x0px> <originM> <mPerPx> <y0px>
 *   npx tsx scripts/roof-feature-measure.ts silhouette <png> <c0> <c1> <rowTop> <rowBot> <x0px> <originM> <mPerPx>
 *   npx tsx scripts/roof-feature-measure.ts sample  <png> <x> <y>
 *
 * The tool behind this stage's rooflight count, chimney count and the
 * side-elevation vertical origin. Three questions, one calibration convention,
 * and no detection: every anchor is passed in, as in `elevation-measure.ts`.
 *
 *   top      The topmost row at which roof covering appears in a column range.
 *            On a side elevation that row is the ridge, which is what fixes the
 *            view's vertical origin: y0 = row + ridgeM x pxPerM.
 *   patches  Glazed patches in the roof band — the rooflights. Roof tile is
 *            dark and nearly grey; a roof window reflects sky, so it is both
 *            brighter and markedly bluer, and the two separate cleanly at
 *            b - r >= 25 with luminance >= 140. Measured tile on this project's
 *            elevations is b - r 12..20 at luminance 80..105, and a pane is
 *            b - r 38..56 at 184..198.
 *   silhouette  Columns of building material outlined against sky, which is how
 *            the chimneys are counted. It works on the gable views, where a
 *            stack rises past the slope behind it, and deliberately refuses the
 *            job on a side view: there a stack stands on the slope in the same
 *            material, separable only by shading, and a threshold tuned to one
 *            render would be a guess on the next.
 *   sample   The raw colour at one pixel, for checking a threshold before
 *            trusting a scan.
 *
 * `originM` is the world coordinate the anchor pixel `x0px` sits at — 0 for the
 * front elevation, but -1.00 for the west view and 13.60 for the east, whose
 * silhouettes start at the rear and front recess planes. `mPerPx` is signed:
 * the rear and east views look along -Z and -X, so +X and +Z run leftwards and
 * the scale is negative.
 */
import { readFileSync } from 'node:fs'
import { PNG } from 'pngjs'

const [mode, file, ...rest] = process.argv.slice(2)
if (!mode || !file) {
  console.error('usage: roof-feature-measure.ts top|patches|silhouette|sample <png> ...')
  process.exit(1)
}
const p = PNG.sync.read(readFileSync(file))
const at = (x: number, y: number): [number, number, number] => {
  const i = (y * p.width + x) * 4
  return [p.data[i], p.data[i + 1], p.data[i + 2]]
}
const lum = (r: number, g: number, b: number): number => (r + g + b) / 3
const sat = (r: number, g: number, b: number): number => Math.max(r, g, b) - Math.min(r, g, b)
const n = (v: string | undefined, d: number): number => (v === undefined ? d : Number(v))
const f3 = (x: number): string => x.toFixed(3)

/** Contiguous runs of hot columns, merged across small breaks. */
const runsOf = (hot: number[], join = 5, minWidth = 10): Array<[number, number]> => {
  const out: Array<[number, number]> = []
  for (const x of hot.sort((a, b) => a - b)) {
    const last = out[out.length - 1]
    if (last && x - last[1] <= join) last[1] = x
    else out.push([x, x])
  }
  return out.filter(([a, b]) => b - a >= minWidth)
}

if (mode === 'top') {
  const c0 = n(rest[0], 0)
  const c1 = n(rest[1], p.width - 1)
  const isRoof = (r: number, g: number, b: number): boolean =>
    lum(r, g, b) > 40 && lum(r, g, b) < 115 && sat(r, g, b) < 26 && b <= r + 10
  for (let y = 0; y < p.height; y++) {
    let run = 0
    let best = 0
    let bestX = -1
    for (let x = c0; x <= c1; x++) {
      if (isRoof(...at(x, y))) {
        run++
        if (run > best) {
          best = run
          bestX = x - run + 1
        }
      } else run = 0
    }
    if (best >= 25) {
      console.log(`${file}: topmost roof row py ${y} (unbroken run of ${best} px from x ${bestX})`)
      console.log(`   a ridge at R metres puts the view's y origin at py ${y} + R x pxPerM`)
      process.exit(0)
    }
  }
  console.log(`${file}: no roof covering found in columns ${c0}..${c1}`)
} else if (mode === 'patches') {
  const [c0, c1, yTop, yBot, x0, originM, mpx, y0] = rest.map((v) => Number(v))
  const glazed = (r: number, g: number, b: number): boolean => b - r >= 25 && lum(r, g, b) >= 140
  const rowOf = (m: number): number => Math.round(y0 - m * Math.abs(mpx))
  const toM = (px: number): number => originM + (px - x0) / mpx
  const cols = new Map<number, number>()
  for (let y = rowOf(yTop); y <= rowOf(yBot); y++) {
    for (let x = c0; x <= c1; x++) if (glazed(...at(x, y))) cols.set(x, (cols.get(x) ?? 0) + 1)
  }
  const hot = [...cols].filter(([, c]) => c >= 6).map(([x]) => x)
  const runs = runsOf(hot, 6, 14)
  console.log(`${file}: ${runs.length} glazed patch(es) between y ${yBot} and ${yTop} m`)
  for (const [a, b] of runs) {
    const m0 = toM(a)
    const m1 = toM(b)
    console.log(`   px ${a}..${b}   ${f3(Math.min(m0, m1))}..${f3(Math.max(m0, m1))} m   centre ${f3((m0 + m1) / 2)}   width ${f3(Math.abs(m1 - m0))} m`)
  }
} else if (mode === 'silhouette') {
  const [c0, c1, rowTop, rowBot, x0, originM, mpx] = rest.map((v) => Number(v))
  // Only meaningful where the background is sky. On the gable views a stack
  // rises past the slope behind it and is outlined against sky, which separates
  // cleanly; on a side view it stands on the slope in the same material and
  // shading alone would have to carry the distinction, so do not ask there.
  const sky = (r: number, g: number, b: number): boolean => b - r >= 30 && lum(r, g, b) >= 115
  const leaf = (r: number, g: number, b: number): boolean => g > r + 8 && g > b + 8
  const solid = (r: number, g: number, b: number): boolean => !sky(r, g, b) && !leaf(r, g, b) && lum(r, g, b) > 35
  const toM = (px: number): number => originM + (px - x0) / mpx
  const cols = new Map<number, number>()
  for (let y = rowTop; y <= rowBot; y++) {
    for (let x = c0; x <= c1; x++) if (solid(...at(x, y))) cols.set(x, (cols.get(x) ?? 0) + 1)
  }
  const need = Math.ceil((rowBot - rowTop + 1) * 0.6)
  const runs = runsOf([...cols].filter(([, c]) => c >= need).map(([x]) => x), 4, 8)
  console.log(`${file}: ${runs.length} silhouette(s) against sky in rows ${rowTop}..${rowBot}`)
  for (const [a, b] of runs) {
    const m0 = toM(a)
    const m1 = toM(b)
    console.log(`   px ${a}..${b}   ${f3(Math.min(m0, m1))}..${f3(Math.max(m0, m1))} m   width ${f3(Math.abs(m1 - m0))} m`)
  }
} else if (mode === 'sample') {
  const x = n(rest[0], 0)
  const y = n(rest[1], 0)
  const [r, g, b] = at(x, y)
  console.log(`${file} px(${x},${y})  rgb ${r},${g},${b}  luminance ${lum(r, g, b).toFixed(0)}  saturation ${sat(r, g, b)}  b-r ${b - r}`)
} else {
  console.error(`unknown mode ${mode}`)
  process.exit(1)
}
