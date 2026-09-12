/**
 * The technical-text recogniser seam and its deterministic implementation
 * (§5, §8).
 *
 * Architectural dimension text is not a paragraph, and treating it as one is
 * why general OCR does badly here: the vocabulary is ten digits plus a handful
 * of separators, the glyphs are 8 to 14 pixels tall, they lean by a fixed
 * amount set by the CAD text style, and — decisively — the *value* of most
 * labels is already predicted to within a couple of percent by the length of
 * the line they annotate. A recogniser that ignores that prediction throws
 * away the strongest evidence on the page.
 *
 * So this is a two-stage recogniser. First the drawing teaches itself its own
 * alphabet: glyphs are clustered by shape, and the clusters are *named* by
 * matching predicted values against observed glyph sequences, with chain
 * arithmetic breaking the remaining ties. Then the named clusters read the
 * labels geometry cannot predict — opening callouts and level markers — which
 * is exactly the information worth having.
 *
 * The seam is `TechnicalTextRecognizer`. A second implementation (a local OCR
 * library, for instance) can be added behind it without the core learning
 * anything about it; `ensembleCandidates` merges readings from several
 * recognisers and keeps the disagreement visible rather than averaging it.
 *
 * PORT_DIRECT (Kotlin). A library-backed recogniser would be
 * PORT_WITH_ADAPTER or REPLACE_ON_ANDROID; this one has no dependencies.
 */
import type { GrayImage } from '../contracts/raster.js'
import type { PixelBox, TextCandidate, TextRecognitionContext } from './contracts.js'
import type { TextCrop } from './crops.js'

export interface TechnicalTextRecognizer {
  readonly name: string
  recognize(crop: TextCrop, context: TextRecognitionContext): TextCandidate[]
}

export const GLYPH_COLS = 10
export const GLYPH_ROWS = 14
const CELLS = GLYPH_COLS * GLYPH_ROWS

/** A segmented glyph, normalised for matching. */
export type TextGlyph = {
  /** Box inside the crop. */
  box: PixelBox
  /** Box in source-native coordinates. */
  sourceBox: PixelBox
  /** Ink pixel count. */
  area: number
  /** Zero-mean unit-norm grey profile, GLYPH_COLS x GLYPH_ROWS. */
  profile: Float32Array
  /** Aspect ratio, width over height. */
  aspect: number
  /** Enclosed holes: 0 for 1/2/3/5/7, 1 for 0/4/6/9, 2 for 8. */
  holes: number
  /** Height in crop pixels. */
  height: number
}

export type SegmentOptions = {
  /** Smallest glyph height accepted, pixels. */
  minHeight: number
  maxHeight: number
  minArea: number
  /** Widest glyph as a multiple of its own height. */
  maxAspect: number
}

export const DEFAULT_SEGMENT: SegmentOptions = {
  minHeight: 5,
  maxHeight: 40,
  minArea: 5,
  maxAspect: 1.8,
}

/**
 * Segment glyphs from a conditioned crop.
 *
 * Components are taken eight-connected because drafting fonts use diagonal
 * hairlines that break apart under four-connectivity at this size. A component
 * too wide for its height is split at its narrowest interior column rather
 * than discarded: two digits touching is common at 10 pixels tall, and
 * dropping the pair loses a whole label.
 */
export function segmentGlyphs(
  crop: TextCrop,
  ink: number,
  slantRad: number,
  opts: SegmentOptions = DEFAULT_SEGMENT,
): TextGlyph[] {
  const g = crop.gray
  const w = g.width
  const h = g.height
  const label = new Int32Array(w * h).fill(-1)
  const queue = new Int32Array(w * h)
  const raw: Array<{ x0: number; y0: number; x1: number; y1: number; area: number }> = []
  for (let start = 0; start < w * h; start++) {
    if (label[start] >= 0 || g.data[start] >= ink) continue
    const id = raw.length
    let head = 0
    let tail = 0
    queue[tail++] = start
    label[start] = id
    let x0 = w
    let x1 = -1
    let y0 = h
    let y1 = -1
    let area = 0
    while (head < tail) {
      const i = queue[head++]
      area++
      const x = i % w
      const y = (i / w) | 0
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
          const j = ny * w + nx
          if (label[j] < 0 && g.data[j] < ink) {
            label[j] = id
            queue[tail++] = j
          }
        }
      }
    }
    raw.push({ x0, y0, x1, y1, area })
  }

  // Dominant glyph height: the tallest well-populated size class. Digits in
  // one label are all the same height, so this both sets the accept band and
  // rejects the speckle that hatching leaves behind.
  const heights = raw
    .map((r) => r.y1 - r.y0 + 1)
    .filter((v) => v >= opts.minHeight && v <= opts.maxHeight)
    .sort((a, b) => b - a)
  if (heights.length === 0) return []
  const dominant = heights[Math.floor(heights.length * 0.25)]

  const out: TextGlyph[] = []
  for (const r of raw) {
    const gh = r.y1 - r.y0 + 1
    const gw = r.x1 - r.x0 + 1
    if (gh < opts.minHeight || gh > opts.maxHeight) continue
    if (r.area < opts.minArea) continue
    // Same size class as the label's own text.
    if (gh < dominant * 0.6 || gh > dominant * 1.45) continue
    const pieces: Array<{ x0: number; x1: number }> = []
    if (gw > gh * opts.maxAspect) {
      // Split a merged pair at the interior column carrying least ink.
      const parts = Math.max(2, Math.round(gw / (gh * 0.62)))
      for (let p = 0; p < parts; p++) {
        const a = r.x0 + Math.round((gw * p) / parts)
        const b = r.x0 + Math.round((gw * (p + 1)) / parts) - 1
        if (b > a) pieces.push({ x0: a, x1: b })
      }
    } else pieces.push({ x0: r.x0, x1: r.x1 })

    for (const piece of pieces) {
      const box: PixelBox = { x0: piece.x0, y0: r.y0, x1: piece.x1, y1: r.y1 }
      const sourceBox = toSource(crop, box)
      out.push({
        box,
        sourceBox,
        area: r.area,
        height: gh,
        aspect: (piece.x1 - piece.x0 + 1) / gh,
        profile: normaliseGlyph(g, box, ink, slantRad),
        holes: countHoles(g, box, ink),
      })
    }
  }
  return out.sort((a, b) => a.box.x0 - b.box.x0)
}

/** Map a crop-local box back to source-native coordinates. */
function toSource(crop: TextCrop, box: PixelBox): PixelBox {
  const ox = Math.max(0, Math.floor(crop.box.x0) - 1)
  const oy = Math.max(0, Math.floor(crop.box.y0) - 1)
  if (crop.rotation === 0) return { x0: ox + box.x0, y0: oy + box.y0, x1: ox + box.x1, y1: oy + box.y1 }
  // The crop was rotated, so a box in crop space maps back through the inverse.
  const cw = crop.gray.width
  const chh = crop.gray.height
  if (crop.rotation === 90) {
    return {
      x0: ox + box.y0,
      x1: ox + box.y1,
      y0: oy + (cw - 1 - box.x1),
      y1: oy + (cw - 1 - box.x0),
    }
  }
  return {
    x0: ox + (chh - 1 - box.y1),
    x1: ox + (chh - 1 - box.y0),
    y0: oy + box.x0,
    y1: oy + box.x1,
  }
}

/**
 * Normalise a glyph to a fixed grey profile, un-leaning it on the way.
 *
 * Three choices matter at this size. Sampling runs target-to-source, so every
 * output cell is filled — sampling the other way leaves a normalised bitmap
 * full of holes, which is how a first attempt at this turned digits into
 * speckle. Grey values are kept rather than thresholded, because the
 * anti-aliased edge carries the stroke position that binarisation rounds away
 * and that is most of what separates a 3 from an 8. And the measured italic
 * slant is removed first, since a sheared 1 and an upright 7 otherwise occupy
 * nearly the same box.
 */
export function normaliseGlyph(gray: GrayImage, box: PixelBox, ink: number, slantRad: number): Float32Array {
  const bw = box.x1 - box.x0 + 1
  const bh = box.y1 - box.y0 + 1
  const shear = Math.tan(slantRad)
  const out = new Float32Array(CELLS)
  const paper = 255
  // Bilinear, not nearest-neighbour. At ten pixels tall a normalised cell
  // straddles source pixels, and rounding to the nearest one aliases the
  // stroke edge by up to half a pixel — enough to move a digit's waist a whole
  // cell and make two instances of the same character disagree more than two
  // different characters do.
  const sample = (sx: number, sy: number): number => {
    const x0 = Math.floor(sx)
    const y0 = Math.floor(sy)
    const fx = sx - x0
    const fy = sy - y0
    const at = (x: number, y: number): number =>
      x < 0 || y < 0 || x >= gray.width || y >= gray.height ? paper : gray.data[y * gray.width + x]
    const top = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx
    const bottom = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx
    return top * (1 - fy) + bottom * fy
  }
  for (let j = 0; j < GLYPH_ROWS; j++) {
    for (let i = 0; i < GLYPH_COLS; i++) {
      // Centre of this output cell, in the glyph's own unit box.
      const u = (i + 0.5) / GLYPH_COLS
      const v = (j + 0.5) / GLYPH_ROWS
      // Re-apply the lean when sampling: the output is upright, so the source
      // position for an upright cell sits further right the higher it is.
      const sx = box.x0 + u * bw + shear * (1 - v) * bh
      const sy = box.y0 + v * bh
      const value = sample(sx, sy)
      // Ink-ness, so the profile is positive where the stroke is.
      out[j * GLYPH_COLS + i] = Math.max(0, (ink - value) / Math.max(1, ink))
    }
  }
  let mean = 0
  for (let i = 0; i < CELLS; i++) mean += out[i]
  mean /= CELLS
  let norm = 0
  for (let i = 0; i < CELLS; i++) {
    out[i] -= mean
    norm += out[i] * out[i]
  }
  norm = Math.sqrt(norm)
  if (norm > 1e-6) for (let i = 0; i < CELLS; i++) out[i] /= norm
  return out
}

/** Enclosed background regions inside a glyph box. */
export function countHoles(gray: GrayImage, box: PixelBox, ink: number): number {
  const bw = box.x1 - box.x0 + 1
  const bh = box.y1 - box.y0 + 1
  if (bw <= 2 || bh <= 2) return 0
  const seen = new Uint8Array(bw * bh)
  const stack: number[] = []
  // Flood the background from the border: what is left enclosed is a hole.
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      if (x !== 0 && y !== 0 && x !== bw - 1 && y !== bh - 1) continue
      const i = y * bw + x
      if (seen[i] || gray.data[(box.y0 + y) * gray.width + box.x0 + x] < ink) continue
      seen[i] = 1
      stack.push(i)
    }
  }
  while (stack.length > 0) {
    const i = stack.pop() as number
    const x = i % bw
    const y = (i / bw) | 0
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue
      const j = ny * bw + nx
      if (seen[j] || gray.data[(box.y0 + ny) * gray.width + box.x0 + nx] < ink) continue
      seen[j] = 1
      stack.push(j)
    }
  }
  let holes = 0
  const visited = new Uint8Array(bw * bh)
  for (let y = 1; y < bh - 1; y++) {
    for (let x = 1; x < bw - 1; x++) {
      const i = y * bw + x
      if (seen[i] || visited[i] || gray.data[(box.y0 + y) * gray.width + box.x0 + x] < ink) continue
      let size = 0
      const s = [i]
      visited[i] = 1
      while (s.length > 0) {
        const k = s.pop() as number
        size++
        const kx = k % bw
        const ky = (k / bw) | 0
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const nx = kx + dx
          const ny = ky + dy
          if (nx < 1 || ny < 1 || nx >= bw - 1 || ny >= bh - 1) continue
          const j = ny * bw + nx
          if (visited[j] || seen[j] || gray.data[(box.y0 + ny) * gray.width + box.x0 + nx] < ink) continue
          visited[j] = 1
          s.push(j)
        }
      }
      if (size >= 2) holes++
    }
  }
  return Math.min(2, holes)
}

/** Cosine similarity of two unit-norm profiles. */
export const profileSimilarity = (a: Float32Array, b: Float32Array): number => {
  let dot = 0
  for (let i = 0; i < CELLS; i++) dot += a[i] * b[i]
  return dot
}
