/**
 * Walls as bands with two faces — STAGE WEB-PIVOT-06 §11, §12.
 *
 * §11 says not to assume every dark line is a wall, and the way to honour that
 * is to look for what a wall actually is on a plan: a *band* of solid ink with
 * two parallel faces, a thickness a wall could plausibly have, and a length
 * worth calling a wall. A dimension line has no thickness. A hatch stroke has
 * no length. A furniture outline has neither the thickness nor the solidity. A
 * grey room fill has the area but not the tone — fills are tints and line work
 * is full strength, which is what separates them without knowing any
 * publisher's palette.
 *
 * Thickness is bounded in *metres*, not pixels, once the sheet's scale is
 * known. A wall is 6 cm at the thinnest a partition is drawn and something
 * under a metre at the thickest; stating that in metres is a statement about
 * buildings, where stating it in pixels would be a statement about one
 * publisher's export size.
 *
 * What comes out is a band with two faces and never an axis. §12 is explicit
 * that face-to-face dimensions stay face-to-face, and a centre line is a
 * derived convenience that throws away which side of the wall a room is on.
 * The centre is offered as a field; the faces are the measurement.
 *
 * PORT_DIRECT (Kotlin).
 */
import type { GrayImage } from '../contracts/raster.js'

export type WallBandOptions = {
  /**
   * Ink level a wall must reach, as a fraction of the paper level.
   *
   * Solid line work against tonal fill: a published plan tints its rooms and
   * draws its fabric at full strength, so the gap between the two is wide and
   * the exact fraction does not matter much.
   */
  solidFraction: number
  /** Wall thicknesses admitted, metres. */
  minThicknessM: number
  maxThicknessM: number
  /** Shortest run that counts as a wall, metres. */
  minLengthM: number
  /** How far a band's faces may wander along its length, pixels. */
  faceTolerancePx: number
  /** Gap along a band that may be jumped — a door, a crossing wall. */
  maxGapPx: number
  /** Fraction of a band's length that must actually be solid. */
  minCoverage: number
}

export const DEFAULT_WALL_BANDS: WallBandOptions = {
  solidFraction: 0.45,
  minThicknessM: 0.05,
  maxThicknessM: 0.8,
  minLengthM: 0.2,
  faceTolerancePx: 1.5,
  maxGapPx: 14,
  minCoverage: 0.55,
}

export type WallBand = {
  id: string
  /** The axis the wall runs along. */
  axis: 'X' | 'Y'
  /** Extent along that axis, source-native pixels. */
  fromPx: number
  toPx: number
  /**
   * The two faces, across the wall. `nearPx` is the smaller coordinate: the
   * north face of an east-west wall, the west face of a north-south one.
   */
  nearPx: number
  farPx: number
  thicknessPx: number
  /** Fraction of the band's length that is solid. */
  coverage: number
  /** Convenience only; the faces are the measurement (§12). */
  centrePx: number
}

/** Page white level: the 95th percentile, which is the paper. */
export function paperLevel(gray: GrayImage): number {
  const hist = new Int32Array(256)
  for (let i = 0; i < gray.data.length; i++) hist[gray.data[i]]++
  const target = gray.data.length * 0.95
  let acc = 0
  for (let v = 0; v < 256; v++) {
    acc += hist[v]
    if (acc >= target) return v
  }
  return 255
}

/**
 * The value at which ink stops being a tint and starts being fabric.
 *
 * A published plan tints its rooms and draws its fabric at full strength, so
 * the gap between the two is wide and the fraction chosen inside it does not
 * matter much. What matters is that it is a fraction of the *measured* paper
 * level and not a constant: a plan published as a JPEG has no pure white in it.
 */
export const solidThreshold = (gray: GrayImage, fraction: number): number =>
  Math.max(20, Math.round(paperLevel(gray) * fraction))

/** One solid crossing of a wall, seen on one scanline. */
type Crossing = { at: number; near: number; far: number }

/**
 * Solid runs through one cross-section of a wall.
 *
 * `runsAlong` is the axis the *wall* runs along, so the cut is taken across
 * it: a wall running along X is cut by walking down a column, and one running
 * along Y by walking across a row. `at` indexes the wall's own axis.
 */
function crossingsOn(
  gray: GrayImage,
  runsAlong: 'X' | 'Y',
  at: number,
  solid: number,
  minPx: number,
  maxPx: number,
): Crossing[] {
  const length = runsAlong === 'X' ? gray.height : gray.width
  const value =
    runsAlong === 'X'
      ? (t: number) => gray.data[t * gray.width + at]
      : (t: number) => gray.data[at * gray.width + t]
  const out: Crossing[] = []
  let start = -1
  for (let t = 0; t <= length; t++) {
    const dark = t < length && value(t) <= solid
    if (dark) {
      if (start < 0) start = t
      continue
    }
    if (start >= 0) {
      const width = t - start
      if (width >= minPx && width <= maxPx) out.push({ at, near: start, far: t - 1 })
      start = -1
    }
  }
  return out
}

/**
 * Every wall band on a drawing.
 *
 * `pxPerCm` is the scale the dimension chains established. Without it the
 * thickness bounds cannot be stated in metres, and the caller is told so by
 * getting nothing back rather than by getting a guess.
 */
export function detectWallBands(
  gray: GrayImage,
  pxPerCm: number | null,
  opts: WallBandOptions = DEFAULT_WALL_BANDS,
): { bands: WallBand[]; notes: string[] } {
  if (pxPerCm === null || pxPerCm <= 0) {
    return {
      bands: [],
      notes: ['no scale was established, so no thickness in metres can be tested and no wall is claimed'],
    }
  }
  const solid = solidThreshold(gray, opts.solidFraction)
  const minPx = Math.max(2, Math.round(opts.minThicknessM * 100 * pxPerCm))
  const maxPx = Math.max(minPx + 1, Math.round(opts.maxThicknessM * 100 * pxPerCm))
  const minLengthPx = Math.max(4, Math.round(opts.minLengthM * 100 * pxPerCm))
  const notes = [
    `wall ink <= ${solid}, thickness ${minPx}..${maxPx} px (${opts.minThicknessM}..${opts.maxThicknessM} m), ` +
      `minimum length ${minLengthPx} px`,
  ]

  const bands: WallBand[] = []
  let n = 0
  for (const axis of ['X', 'Y'] as const) {
    // A wall running along X is crossed by scanning down a column, and vice
    // versa; `outer` walks the axis the wall runs along.
    const outer = axis === 'X' ? gray.width : gray.height
    type Open = { nearSum: number; farSum: number; rows: number; from: number; last: number; near: number; far: number }
    const open: Open[] = []
    const closeBand = (b: Open): void => {
      const lengthPx = b.last - b.from + 1
      if (lengthPx < minLengthPx) return
      const coverage = b.rows / lengthPx
      if (coverage < opts.minCoverage) return
      const near = b.nearSum / b.rows
      const far = b.farSum / b.rows
      bands.push({
        id: `wb${n++}`,
        axis,
        fromPx: b.from,
        toPx: b.last,
        nearPx: near,
        farPx: far,
        thicknessPx: far - near + 1,
        coverage,
        centrePx: (near + far) / 2,
      })
    }
    for (let t = 0; t < outer; t++) {
      const crossings = crossingsOn(gray, axis, t, solid, minPx, maxPx)
      const used = new Set<number>()
      for (const c of crossings) {
        let joined = false
        for (const b of open) {
          if (t - b.last > opts.maxGapPx) continue
          if (Math.abs(b.near - c.near) > opts.faceTolerancePx) continue
          if (Math.abs(b.far - c.far) > opts.faceTolerancePx) continue
          b.nearSum += c.near
          b.farSum += c.far
          b.rows++
          b.last = t
          b.near = b.nearSum / b.rows
          b.far = b.farSum / b.rows
          joined = true
          break
        }
        if (!joined) {
          open.push({ nearSum: c.near, farSum: c.far, rows: 1, from: t, last: t, near: c.near, far: c.far })
        }
        used.add(c.near)
      }
      for (let i = open.length - 1; i >= 0; i--) {
        if (t - open[i].last > opts.maxGapPx) {
          closeBand(open[i])
          open.splice(i, 1)
        }
      }
    }
    for (const b of open) closeBand(b)
  }
  notes.push(`${bands.filter((b) => b.axis === 'X').length} bands running across, ${bands.filter((b) => b.axis === 'Y').length} down`)
  return { bands, notes }
}
