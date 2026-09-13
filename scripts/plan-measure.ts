/**
 * Measure a floor plan in metres — STAGE WEB-PIVOT-04, development only.
 *
 *   npx tsx scripts/plan-measure.ts row  <png> <zM> [thr]
 *   npx tsx scripts/plan-measure.ts col  <png> <xM> [thr]
 *   npx tsx scripts/plan-measure.ts walls <png> rows|cols [thr] [minCoverage]
 *   npx tsx scripts/plan-measure.ts box  <png> [thr]
 *
 * The tool behind every SOURCE_DERIVED figure in
 * `research/gold/marcowki-interior-v1.json`. It does nothing clever: it reports
 * where the ink is, in building coordinates, so that a number transcribed from
 * a drawing can be checked by someone who does not trust the transcription.
 *
 * ## The frame
 *
 * ARCHON draws these plans orthographically, north up, with the entrance
 * facade at the bottom. The building frame STAGE WEB-PIVOT-02 established is
 * `+X` east, `+Y` up, `+Z` south, so plan-right is `+X` and plan-down is `+Z`,
 * and the outer face of the north-west corner is the origin. Two anchors fix
 * the scale: the published overall width and depth against the outermost wall
 * ink. They are passed in rather than detected, because a detector that guessed
 * the calibration would be the one thing in this file nobody could check.
 *
 * Wall ink on these drawings is solid black; furniture, dimension lines and the
 * watermark are lighter, so a luminance threshold separates them. Where it does
 * not, the caller is told the pixel run and can look.
 */
import { readFileSync } from 'node:fs'
import { PNG } from 'pngjs'
import { PLAN_CALIBRATIONS, type PlanName } from './plan-calibration.js'

const planName = (process.env.PLAN as PlanName) ?? 'ground'
const C = PLAN_CALIBRATIONS[planName]
const sx = (C.x1Px - C.x0Px) / C.widthM
const sz = (C.z1Px - C.z0Px) / C.depthM
export const xToM = (px: number): number => (px - C.x0Px) / sx
export const zToM = (py: number): number => (py - C.z0Px) / sz
export const mToX = (m: number): number => C.x0Px + m * sx
export const mToZ = (m: number): number => C.z0Px + m * sz

type Run = { a: number; b: number; px: [number, number] }

function runsAlong(
  p: PNG,
  fixed: number,
  axis: 'row' | 'col',
  thr: number,
  toM: (v: number) => number,
): Run[] {
  const lum = (x: number, y: number): number => {
    const i = (y * p.width + x) * 4
    return 0.299 * p.data[i] + 0.587 * p.data[i + 1] + 0.114 * p.data[i + 2]
  }
  const n = axis === 'row' ? p.width : p.height
  const out: Run[] = []
  let start = -1
  for (let v = 0; v <= n; v++) {
    const dark = v < n && (axis === 'row' ? lum(v, fixed) : lum(fixed, v)) < thr
    if (dark && start < 0) start = v
    if (!dark && start >= 0) {
      out.push({ a: toM(start), b: toM(v - 1), px: [start, v - 1] })
      start = -1
    }
  }
  return out
}

const f2 = (x: number): string => x.toFixed(3)
const [mode, file, ...rest] = process.argv.slice(2)
if (!mode || !file) {
  console.error('usage: plan-measure.ts row|col|walls|box <png> ...')
  process.exit(1)
}
const png = PNG.sync.read(readFileSync(file))

if (mode === 'box') {
  console.log(`${file} ${png.width}x${png.height}  calibration "${planName}"`)
  console.log(`  scale ${sx.toFixed(4)} px/m across, ${sz.toFixed(4)} px/m down (${(100 * Math.abs(sx - sz) / sx).toFixed(2)}% apart)`)
  console.log(`  x: px ${C.x0Px}..${C.x1Px} = 0..${C.widthM} m      z: px ${C.z0Px}..${C.z1Px} = 0..${C.depthM} m`)
} else if (mode === 'row' || mode === 'col') {
  const at = Number(rest[0])
  const thr = rest[1] === undefined ? 110 : Number(rest[1])
  const fixed = Math.round(mode === 'row' ? mToZ(at) : mToX(at))
  const runs = runsAlong(png, fixed, mode === 'row' ? 'row' : 'col', thr, mode === 'row' ? xToM : zToM)
  console.log(`${mode} at ${mode === 'row' ? 'z' : 'x'}=${at} m (px ${fixed}), dark<${thr}:`)
  for (const r of runs) {
    console.log(`  ${f2(r.a)} .. ${f2(r.b)} m   (${(r.b - r.a).toFixed(3)} m wide, px ${r.px[0]}..${r.px[1]})`)
  }
} else if (mode === 'walls') {
  // Scan every line across the building and keep the positions where ink is
  // present on a large fraction of them: that is a wall rather than furniture.
  const axis = rest[0] === 'cols' ? 'cols' : 'rows'
  const thr = rest[1] === undefined ? 110 : Number(rest[1])
  const minCov = rest[2] === undefined ? 0.35 : Number(rest[2])
  const lum = (x: number, y: number): number => {
    const i = (y * png.width + x) * 4
    return 0.299 * png.data[i] + 0.587 * png.data[i + 1] + 0.114 * png.data[i + 2]
  }
  const lo = Math.round(axis === 'cols' ? C.x0Px : C.z0Px)
  const hi = Math.round(axis === 'cols' ? C.x1Px : C.z1Px)
  const sLo = Math.round(axis === 'cols' ? C.z0Px : C.x0Px)
  const sHi = Math.round(axis === 'cols' ? C.z1Px : C.x1Px)
  const cov: number[] = []
  for (let v = lo; v <= hi; v++) {
    let dark = 0
    for (let s = sLo; s <= sHi; s++) {
      const l = axis === 'cols' ? lum(v, s) : lum(s, v)
      if (l < thr) dark++
    }
    cov.push(dark / (sHi - sLo + 1))
  }
  console.log(`${file}: ${axis === 'cols' ? 'vertical' : 'horizontal'} walls, ink on >= ${(minCov * 100).toFixed(0)}% of the crossing lines`)
  let start = -1
  for (let i = 0; i <= cov.length; i++) {
    const on = i < cov.length && cov[i] >= minCov
    if (on && start < 0) start = i
    if (!on && start >= 0) {
      const a = lo + start
      const b = lo + i - 1
      const toM = axis === 'cols' ? xToM : zToM
      const peak = Math.max(...cov.slice(start, i))
      console.log(
        `  ${axis === 'cols' ? 'x' : 'z'} ${f2(toM(a))} .. ${f2(toM(b))} m   ` +
          `thickness ${(toM(b) - toM(a) + 1 / (axis === 'cols' ? sx : sz)).toFixed(3)} m   px ${a}..${b}   peak coverage ${(peak * 100).toFixed(0)}%`,
      )
      start = -1
    }
  }
} else if (mode === 'segments') {
  // Wall segments, enumerated. For every line across the building, the dark
  // runs that are long enough to be wall rather than furniture; then runs that
  // persist across neighbouring lines are merged into one segment.
  //
  // This is how the interior wall list was built. It is deliberately dumb: a
  // cleverer detector would be the one thing in this stage nobody could check
  // against the drawing by eye.
  const axis = rest[0] === 'cols' ? 'cols' : 'rows'
  const minLenM = rest[1] === undefined ? 0.6 : Number(rest[1])
  const thr = rest[2] === undefined ? 100 : Number(rest[2])
  const maxThickM = rest[3] === undefined ? 0.6 : Number(rest[3])
  const lo = Math.round(axis === 'cols' ? C.x0Px : C.z0Px)
  const hi = Math.round(axis === 'cols' ? C.x1Px : C.z1Px)
  const across = axis === 'cols' ? xToM : zToM
  const along = axis === 'cols' ? zToM : xToM
  type Seg = { at: number; a: number; b: number }
  const found: Seg[] = []
  for (let v = lo; v <= hi; v++) {
    const runs = runsAlong(png, v, axis === 'cols' ? 'col' : 'row', thr, along)
    for (const r of runs) if (r.b - r.a >= minLenM) found.push({ at: across(v), a: r.a, b: r.b })
  }
  // Merge across neighbouring lines: same span (within 0.1 m) and adjacent `at`.
  type Group = { a0: number; a1: number; s0: number; s1: number; n: number }
  const groups: Group[] = []
  for (const f of found) {
    const g = groups.find(
      (x) => Math.abs(x.s0 - f.a) < 0.15 && Math.abs(x.s1 - f.b) < 0.15 && f.at - x.a1 < 0.1,
    )
    if (g) {
      g.a1 = Math.max(g.a1, f.at)
      g.s0 = Math.min(g.s0, f.a)
      g.s1 = Math.max(g.s1, f.b)
      g.n++
    } else groups.push({ a0: f.at, a1: f.at, s0: f.a, s1: f.b, n: 1 })
  }
  const label = axis === 'cols' ? ['x', 'z'] : ['z', 'x']
  console.log(`${file}: ${axis === 'cols' ? 'vertical' : 'horizontal'} wall segments at least ${minLenM} m long`)
  for (const g of groups.sort((p1, p2) => p1.a0 - p2.a0)) {
    const thick = g.a1 - g.a0 + 1 / (axis === 'cols' ? sx : sz)
    if (thick > maxThickM) continue
    console.log(
      `  ${label[0]} ${f2(g.a0)}..${f2(g.a1)} (${thick.toFixed(3)} m thick)   ` +
        `${label[1]} ${f2(g.s0)}..${f2(g.s1)} (${(g.s1 - g.s0).toFixed(3)} m long)`,
    )
  }
} else {
  console.error(`unknown mode ${mode}`)
  process.exit(1)
}
