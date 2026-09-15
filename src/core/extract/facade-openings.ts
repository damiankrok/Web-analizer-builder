/**
 * Openings on a published elevation — §19.
 *
 * ## What these sources are
 *
 * ARCHON does not publish line-art elevations. All four of project A's are
 * orthographic *renders*: real materials, a photographic sky, trees in front of
 * the facade, and no dimension line anywhere on them. They are still perfectly
 * good orthographic evidence about where an opening is — that is why §17 treats
 * them as planar technical drawings — but a detector written for line work does
 * not work on them.
 *
 * The existing `scaffold/openings.ts` builds rectangles out of the facade's
 * dominant straight lines and tests each side for edge support. Measured on
 * project A's four elevations it returns ten rectangles, of which three are
 * bands of roof tile and one is a wall, and it finds one window on the entrance
 * facade. The reason is structural rather than a matter of thresholds: on a
 * render the strongest straight lines are material boundaries, so the roof's
 * edges dominate the line budget and a window frame drawn at a tenth of that
 * strength never gets a candidate line at all.
 *
 * ## What distinguishes an opening on a render
 *
 * Not darkness. This house has an anthracite-rendered garage wing that is
 * darker than several of its windows. What is stable is that an opening is
 * darker **than the wall immediately around it**, on both sides, at its own
 * row — glass in daylight reads darker than any render finish it is set into,
 * whatever that finish is. So the background is estimated locally and per row,
 * and what is kept is the set of regions that stand out from their own
 * surroundings rather than from the image.
 *
 * Three structural filters then do most of the work:
 *
 *   - an opening is **wider than a texture stripe**. This is the one that
 *     decides whether the detector works at all. Project A's gable is clad in
 *     vertical boards, and every shadow line between two boards is darker than
 *     the board beside it, so the raw dark regions of the entrance facade come
 *     back as *one* component three hundred and eighty pixels across that
 *     contains the gable glazing, the entrance, two windows and all the
 *     cladding at once. Removing anything narrower than an opening can be —
 *     which is a length in metres, not a fraction of an image — separates them
 *     again;
 *   - an opening is **interior** to the facade. The roof band is dark and
 *     rectangular and enormous, and it is also part of the silhouette's own
 *     outline; a window never is. Requiring a clear margin between a region and
 *     the silhouette boundary removes every roof band and every plinth without
 *     needing to know where the roof is;
 *   - an opening **fills its own bounding box**. Foliage in front of the
 *     facade is dark and irregular, and a region whose pixels fill barely half
 *     the box they span is not a window.
 *
 * Working in metres rather than in fractions of the frame is what lets one set
 * of bounds mean the same thing on a 1280 px render of a twelve-metre facade
 * and on whatever the next publisher serves. The registration has already
 * established the scale before this runs, and it is an input.
 *
 * ## Two kinds of evidence, because one is not enough
 *
 * Darkness alone finds the glazing set into a white render and misses the
 * garage door, which on this house is a mid-grey panel on an anthracite wall.
 * Framed rectangles alone — the existing `scaffold/openings.ts` test, that a
 * rectangle's four sides are all inked — finds the garage door and misses
 * glazing whose frame is the same colour as the glass. So both are run and
 * their results are merged, each opening carrying which evidence found it.
 *
 * The frame detector needed one change to be usable here, and it is not a
 * threshold: it must be given the *wall band* rather than the whole facade.
 * Its candidate lines are the facade's strongest straight edges, and on a
 * render the strongest straight edges by a wide margin are the roof's, so with
 * the roof in frame the entire line budget goes to roof edges and no window
 * ever gets a candidate line.
 *
 * Nothing here decides what *kind* of opening it is. §19 is explicit that
 * geometry is usable before its semantics are settled, and the classification a
 * detector could offer at this point — from size and position alone — would be
 * a guess dressed as a reading.
 *
 * PORT_DIRECT (Kotlin).
 */
import type { GrayImage, MaskImage } from '../contracts/raster.js'
import { makeMask } from '../contracts/raster.js'
import type { Gradients } from '../raster/filters.js'
import { dilate, erode } from '../raster/filters.js'
import { findOpeningRectangles, DEFAULT_OPENING_DETECT, type OpeningDetectOptions } from '../scaffold/openings.js'

export type FacadeOpeningOptions = {
  /**
   * Width of the window the local wall level is estimated over, as a fraction
   * of the facade's width. It must comfortably exceed the widest opening, so
   * that the estimate is of wall and not of glass.
   */
  backgroundWidthFraction: number
  /** How much darker than its local wall a pixel must be, in grey levels. */
  minDarkness: number
  /**
   * Narrowest thing kept, metres. Anything thinner is material texture — a
   * cladding board's shadow line, a joint, a downpipe — and is removed before
   * the regions are counted, which is what stops texture welding a facade's
   * openings into one blob.
   */
  textureWidthM: number
  /** Clear margin between a region and the silhouette's edge, metres. */
  interiorMarginM: number
  /** Size bounds for a major opening, metres. */
  minWidthM: number
  minHeightM: number
  maxWidthM: number
  maxHeightM: number
  /** How much of its bounding box a region must fill. */
  minFill: number
  /** Width over height. */
  minAspect: number
  maxAspect: number
  /** Two regions overlapping more than this are one opening. */
  suppressIoU: number
  /** Regions reported per facade, most confident first. */
  maxOpenings: number
  /** Settings for the framed-rectangle pass. */
  frames: OpeningDetectOptions
}

export const DEFAULT_FACADE_OPENINGS: FacadeOpeningOptions = {
  backgroundWidthFraction: 0.22,
  minDarkness: 14,
  // A cladding board is a decimetre and a window is half a metre, so anything
  // under a quarter of a metre across is texture. That is a fact about
  // buildings rather than about any drawing.
  textureWidthM: 0.24,
  interiorMarginM: 0.06,
  minWidthM: 0.35,
  minHeightM: 0.35,
  maxWidthM: 9,
  maxHeightM: 6,
  minFill: 0.55,
  minAspect: 0.1,
  maxAspect: 10,
  suppressIoU: 0.35,
  maxOpenings: 40,
  frames: {
    ...DEFAULT_OPENING_DETECT,
    // More candidate lines than the legacy pass allows, and shorter ones: a
    // window head is a short line, and a facade has many more than fourteen
    // architectural lines on it.
    maxRows: 40,
    maxColumns: 50,
    minRunFraction: 0.03,
    minBorderSupport: 0.55,
    minAreaFraction: 0.0008,
    maxAreaFraction: 0.12,
    borderTolerance: 3,
  },
}

export type FacadeOpening = {
  id: string
  /** Which pass found it. Both, where the two agree. */
  evidence: Array<'DARK_REGION' | 'FRAMED_RECTANGLE'>
  /** Bounding box in the elevation's own pixels. */
  x0: number
  y0: number
  x1: number
  y1: number
  /** The region's own shape over that box, as a coarse grid (see §21). */
  cols: number
  rows: number
  filled: string
  /** How much darker than the local wall, in grey levels. */
  darkness: number
  /** Fraction of the bounding box the region covers. */
  fill: number
  /** How rectangular the region is: 1 for a rectangle, less for a raked top. */
  rectangularity: number
  /** Whether the top edge is sloped, which is what a raked opening is (§21). */
  rakedTop: { leftY: number; rightY: number; slopeDeg: number } | null
  confidence: number
}

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * How dark each pixel is against the wall at its own row.
 *
 * The background level is the median of the facade's pixels in a wide window
 * centred on the pixel, on the same row. A window is a minority of that
 * window's width, so the median is the wall; a wall of a different colour
 * further along the facade does not affect it.
 */
export function localDarkness(
  gray: GrayImage,
  region: MaskImage,
  bounds: { x0: number; x1: number; y0: number; y1: number },
  opts: FacadeOpeningOptions = DEFAULT_FACADE_OPENINGS,
): Float32Array {
  const out = new Float32Array(gray.width * gray.height)
  const half = Math.max(8, Math.round((bounds.x1 - bounds.x0 + 1) * opts.backgroundWidthFraction * 0.5))
  const step = Math.max(1, Math.round(half / 8))
  for (let y = bounds.y0; y <= bounds.y1; y++) {
    // The row's background, sampled at a stride and interpolated between, so
    // the cost does not go with the square of the facade's width.
    const anchors: Array<{ x: number; level: number }> = []
    for (let x = bounds.x0; x <= bounds.x1 + step; x += step) {
      const cx = Math.min(bounds.x1, x)
      const vals: number[] = []
      for (let k = Math.max(bounds.x0, cx - half); k <= Math.min(bounds.x1, cx + half); k++) {
        if (region.data[y * gray.width + k] === 0) continue
        vals.push(gray.data[y * gray.width + k])
      }
      anchors.push({ x: cx, level: vals.length === 0 ? 255 : median(vals) })
    }
    if (anchors.length === 0) continue
    let ai = 0
    for (let x = bounds.x0; x <= bounds.x1; x++) {
      while (ai + 1 < anchors.length && anchors[ai + 1].x < x) ai++
      const a = anchors[ai]
      const b = anchors[Math.min(anchors.length - 1, ai + 1)]
      const t = b.x === a.x ? 0 : (x - a.x) / (b.x - a.x)
      const level = a.level + (b.level - a.level) * Math.max(0, Math.min(1, t))
      if (region.data[y * gray.width + x] === 0) continue
      out[y * gray.width + x] = level - gray.data[y * gray.width + x]
    }
  }
  return out
}

type Component = { pixels: number[]; x0: number; y0: number; x1: number; y1: number; sumDark: number }

/** 4-connected components of the darker-than-wall mask, iteratively. */
function components(mask: MaskImage, darkness: Float32Array, limit: number): Component[] {
  const { width, height } = mask
  const seen = new Uint8Array(width * height)
  const queue = new Int32Array(width * height)
  const out: Component[] = []
  for (let start = 0; start < width * height && out.length < limit; start++) {
    if (mask.data[start] === 0 || seen[start]) continue
    let head = 0
    let tail = 0
    queue[tail++] = start
    seen[start] = 1
    const pixels: number[] = []
    let x0 = width
    let y0 = height
    let x1 = -1
    let y1 = -1
    let sumDark = 0
    while (head < tail) {
      const i = queue[head++]
      pixels.push(i)
      const x = i % width
      const y = (i / width) | 0
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
      sumDark += darkness[i]
      if (x > 0 && mask.data[i - 1] && !seen[i - 1]) (seen[i - 1] = 1), (queue[tail++] = i - 1)
      if (x + 1 < width && mask.data[i + 1] && !seen[i + 1]) (seen[i + 1] = 1), (queue[tail++] = i + 1)
      if (y > 0 && mask.data[i - width] && !seen[i - width]) (seen[i - width] = 1), (queue[tail++] = i - width)
      if (y + 1 < height && mask.data[i + width] && !seen[i + width]) (seen[i + width] = 1), (queue[tail++] = i + width)
    }
    out.push({ pixels, x0, y0, x1, y1, sumDark })
  }
  return out
}

const iou = (a: FacadeOpening, b: FacadeOpening): number => {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)
  if (w <= 0 || h <= 0) return 0
  const inter = w * h
  const areaA = (a.x1 - a.x0) * (a.y1 - a.y0)
  const areaB = (b.x1 - b.x0) * (b.y1 - b.y0)
  return inter / Math.max(1e-6, areaA + areaB - inter)
}

/**
 * Every major opening the facade shows, with its own outline.
 *
 * `region` is the conditioned silhouette: the facade and nothing else. The
 * eroded copy of it is what makes a roof band fail — a band of tile is dark,
 * rectangular, well filled and *part of the outline*, and nothing else about it
 * distinguishes it from a very wide window.
 */
export function detectFacadeOpenings(
  gray: GrayImage,
  region: MaskImage,
  bounds: { x0: number; x1: number; y0: number; y1: number },
  pixelsPerMetre: number,
  frames: { grad: Gradients; edges: MaskImage } | null,
  opts: FacadeOpeningOptions = DEFAULT_FACADE_OPENINGS,
): { openings: FacadeOpening[]; notes: string[] } {
  const facadeW = bounds.x1 - bounds.x0 + 1
  const facadeH = bounds.y1 - bounds.y0 + 1
  if (facadeW <= 0 || facadeH <= 0 || !(pixelsPerMetre > 0)) {
    return { openings: [], notes: ['the facade has no extent or no scale, so nothing is measured on it'] }
  }
  const px = (metres: number): number => metres * pixelsPerMetre

  const darkness = localDarkness(gray, region, bounds, opts)
  const margin = Math.max(2, Math.round(px(opts.interiorMarginM)))
  const interior = erode(region, margin)

  const dark = makeMask(gray.width, gray.height)
  for (let y = bounds.y0; y <= bounds.y1; y++) {
    for (let x = bounds.x0; x <= bounds.x1; x++) {
      const i = y * gray.width + x
      if (interior.data[i] === 0) continue
      if (darkness[i] >= opts.minDarkness) dark.data[i] = 1
    }
  }

  // Texture removal. An opening survives an erosion of half a texture width
  // and a cladding shadow does not; the dilation afterwards puts the opening
  // back to its own size rather than leaving it eroded.
  const textureRadius = Math.max(1, Math.round(px(opts.textureWidthM) / 2))
  const cleaned = dilate(erode(dark, textureRadius), textureRadius)

  const raw = components(cleaned, darkness, 20000)
  const candidates: FacadeOpening[] = []
  for (const c of raw) {
    const w = c.x1 - c.x0 + 1
    const h = c.y1 - c.y0 + 1
    const area = w * h
    if (w < px(opts.minWidthM) || h < px(opts.minHeightM)) continue
    if (w > px(opts.maxWidthM) || h > px(opts.maxHeightM)) continue
    const aspect = w / h
    if (aspect < opts.minAspect || aspect > opts.maxAspect) continue
    const fill = c.pixels.length / area
    if (fill < opts.minFill) continue

    // The region's own shape, as a coarse occupancy grid. §21 needs it: an
    // opening with a raked top is not a rectangle and must not be reported as
    // one, and the grid is what lets a reader see the difference.
    const cols = Math.max(4, Math.min(24, Math.round(w / 8)))
    const rows = Math.max(4, Math.min(24, Math.round(h / 8)))
    const cells = new Uint8Array(cols * rows)
    const counts = new Int32Array(cols * rows)
    for (const i of c.pixels) {
      const px = i % gray.width
      const py = (i / gray.width) | 0
      const cx = Math.min(cols - 1, Math.floor(((px - c.x0) / w) * cols))
      const cy = Math.min(rows - 1, Math.floor(((py - c.y0) / h) * rows))
      counts[cy * cols + cx]++
    }
    const perCell = (w / cols) * (h / rows)
    for (let k = 0; k < cells.length; k++) cells[k] = counts[k] >= perCell * 0.5 ? 1 : 0

    // Top-edge profile: where the region starts in each column.
    const topOf = new Int32Array(w).fill(-1)
    for (const i of c.pixels) {
      const px = (i % gray.width) - c.x0
      const py = ((i / gray.width) | 0) - c.y0
      if (topOf[px] < 0 || py < topOf[px]) topOf[px] = py
    }
    const present = [...topOf].filter((v) => v >= 0)
    const leftY = topOf[0] >= 0 ? topOf[0] : (present[0] ?? 0)
    const rightY = topOf[w - 1] >= 0 ? topOf[w - 1] : (present[present.length - 1] ?? 0)
    const topSpread = present.length === 0 ? 0 : Math.max(...present) - Math.min(...present)
    const raked =
      topSpread > Math.max(4, h * 0.18)
        ? { leftY: c.y0 + leftY, rightY: c.y0 + rightY, slopeDeg: (Math.atan2(rightY - leftY, w) * 180) / Math.PI }
        : null

    candidates.push({
      id: '',
      evidence: ['DARK_REGION'],
      x0: c.x0,
      y0: c.y0,
      x1: c.x1,
      y1: c.y1,
      cols,
      rows,
      filled: Array.from(cells, (v) => (v ? '1' : '0')).join(''),
      darkness: c.sumDark / c.pixels.length,
      fill,
      rectangularity: fill,
      rakedTop: raked,
      confidence: Math.max(0.2, Math.min(0.95, 0.25 + 0.45 * fill + 0.3 * Math.min(1, c.sumDark / c.pixels.length / 60))),
    })
  }

  let framed = 0
  if (frames) {
    for (const rect of findOpeningRectangles(gray, frames.grad, frames.edges, region, bounds, opts.frames)) {
      const w = rect.x1 - rect.x0 + 1
      const h = rect.y1 - rect.y0 + 1
      if (w < px(opts.minWidthM) || h < px(opts.minHeightM)) continue
      if (w > px(opts.maxWidthM) || h > px(opts.maxHeightM)) continue
      const aspect = w / h
      if (aspect < opts.minAspect || aspect > opts.maxAspect) continue
      framed++
      candidates.push({
        id: '',
        evidence: ['FRAMED_RECTANGLE'],
        x0: rect.x0,
        y0: rect.y0,
        x1: rect.x1,
        y1: rect.y1,
        cols: 1,
        rows: 1,
        filled: '1',
        darkness: rect.contrast * 255,
        fill: 1,
        rectangularity: rect.borderSupport,
        rakedTop: null,
        confidence: Math.max(0.2, Math.min(0.95, rect.score)),
      })
    }
  }

  candidates.sort((a, b) => b.confidence - a.confidence || (b.x1 - b.x0) * (b.y1 - b.y0) - (a.x1 - a.x0) * (a.y1 - a.y0))
  const kept: FacadeOpening[] = []
  for (const c of candidates) {
    const same = kept.find((k) => iou(k, c) > opts.suppressIoU)
    if (same) {
      // Both passes seeing the same rectangle is worth more than either
      // seeing it alone, and the record says both saw it.
      for (const e of c.evidence) if (!same.evidence.includes(e)) same.evidence.push(e)
      if (same.evidence.length > 1) same.confidence = Math.min(0.97, same.confidence + 0.08)
      continue
    }
    kept.push({ ...c, id: `op${kept.length}`, evidence: [...c.evidence] })
    if (kept.length >= opts.maxOpenings) break
  }
  return {
    openings: kept,
    notes: [
      `${raw.length} regions survive removal of anything narrower than ${opts.textureWidthM} m and read darker than ` +
        `the wall at their own row; ${framed} framed rectangles were found beside them; ` +
        `${kept.length} openings after merging the two and suppressing overlaps ` +
        `(${kept.filter((k) => k.evidence.length > 1).length} found by both passes)`,
    ],
  }
}
