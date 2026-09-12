/**
 * Glyph extraction and self-calibrating digit recognition for architectural
 * drawings.
 *
 * The drawings carry their dimensions as printed numbers, and those numbers are
 * the strongest geometric evidence on the page — an opening callout reading
 * 275/225 is an exact dimension, where a pixel measurement of the same opening
 * is an estimate. They have to be read.
 *
 * Reading them without shipping a font is the interesting part. The approach
 * here needs no trained model and no font file:
 *
 *   1. glyphs are connected components of ink at text scale;
 *   2. glyphs adjacent on a baseline form a number;
 *   3. glyphs are clustered by shape, so the drawing's own repeated digits
 *      collapse into a handful of prototypes;
 *   4. the prototypes are *labelled by geometry*. A dimension label sitting
 *      over a dimension-line segment of known pixel length has a value the
 *      drawing's scale already predicts to within a few percent. Matching the
 *      predicted value's digits against the observed glyph sequence assigns
 *      identities to the clusters.
 *
 * After that the labelled clusters decode the numbers geometry cannot predict —
 * opening callouts, level annotations — which is exactly the information worth
 * having. The drawing teaches the analyzer its own font.
 *
 * PORT_DIRECT (Kotlin).
 */
import type { GrayImage, MaskImage } from '../contracts/raster.js'

export type Glyph = {
  id: number
  x0: number
  y0: number
  x1: number
  y1: number
  /** Ink pixels. */
  area: number
  /** Normalised binary bitmap, GLYPH_W x GLYPH_H. */
  bitmap: Uint8Array
  /**
   * Normalised grayscale sample of the same box, zero-mean and unit-norm.
   *
   * At six to nine pixels tall — the size of an opening callout on these plans
   * — a binary bitmap throws away most of what distinguishes a 3 from an 8: the
   * anti-aliased edge carries the stroke positions that thresholding rounds
   * away. Matching on the grey values instead recovers them.
   */
  profile: Float32Array
  /** Holes in the shape: 0 for 1/2/3/5/7, 1 for 0/4/6/9, 2 for 8. */
  holes: number
}

export const GLYPH_W = 10
export const GLYPH_H = 14

export type GlyphOptions = {
  inkThreshold: number
  minHeight: number
  maxHeight: number
  minArea: number
  maxWidthRatio: number
}

export const DEFAULT_GLYPHS: GlyphOptions = {
  inkThreshold: 150,
  minHeight: 5,
  maxHeight: 22,
  minArea: 6,
  maxWidthRatio: 1.6,
}

/** Connected components of ink whose size is consistent with drawing text. */
export function extractGlyphs(
  gray: GrayImage,
  region: MaskImage | null,
  opts: GlyphOptions = DEFAULT_GLYPHS,
): Glyph[] {
  const w = gray.width
  const h = gray.height
  const ink = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) {
    if (region && !region.data[i]) continue
    ink[i] = gray.data[i] < opts.inkThreshold ? 1 : 0
  }
  const label = new Int32Array(w * h).fill(-1)
  const queue = new Int32Array(w * h)
  const out: Glyph[] = []
  let next = 0

  for (let start = 0; start < w * h; start++) {
    if (!ink[start] || label[start] >= 0) continue
    const id = next++
    let head = 0
    let tail = 0
    queue[tail++] = start
    label[start] = id
    let x0 = w
    let x1 = -1
    let y0 = h
    let y1 = -1
    let area = 0
    const members: number[] = []
    while (head < tail) {
      const i = queue[head++]
      members.push(i)
      area++
      const x = i % w
      const y = (i / w) | 0
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
      // Eight-connected: drafting fonts have diagonal hairlines that break
      // under four-connectivity at this size.
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
          const j = ny * w + nx
          if (ink[j] && label[j] < 0) {
            label[j] = id
            queue[tail++] = j
          }
        }
      }
    }
    const gh = y1 - y0 + 1
    const gw = x1 - x0 + 1
    if (gh < opts.minHeight || gh > opts.maxHeight) continue
    if (area < opts.minArea) continue
    if (gw > gh * opts.maxWidthRatio) continue
      out.push({
      id: out.length,
      x0,
      y0,
      x1,
      y1,
      area,
      bitmap: normalise(members, w, x0, y0, gw, gh),
      profile: greyProfile(gray, x0, y0, gw, gh),
      holes: countHoles(members, w, x0, y0, gw, gh),
    })
  }
  return out
}

/**
 * Resample a glyph's ink to a fixed box so shapes can be compared.
 *
 * Sampling has to run target-to-source, not source-to-target. A 9x13 glyph
 * scattered into a 10x14 grid leaves most cells empty and turns a solid stroke
 * into speckle; asking each target cell which source pixels fall under it, and
 * lighting it when any of them is ink, keeps hairlines intact at this size.
 */
function normalise(members: readonly number[], imageW: number, x0: number, y0: number, gw: number, gh: number): Uint8Array {
  const local = new Uint8Array(gw * gh)
  for (const i of members) {
    const x = (i % imageW) - x0
    const y = ((i / imageW) | 0) - y0
    if (x < 0 || y < 0 || x >= gw || y >= gh) continue
    local[y * gw + x] = 1
  }
  const out = new Uint8Array(GLYPH_W * GLYPH_H)
  for (let by = 0; by < GLYPH_H; by++) {
    const sy0 = Math.floor((by * gh) / GLYPH_H)
    const sy1 = Math.max(sy0 + 1, Math.ceil(((by + 1) * gh) / GLYPH_H))
    for (let bx = 0; bx < GLYPH_W; bx++) {
      const sx0 = Math.floor((bx * gw) / GLYPH_W)
      const sx1 = Math.max(sx0 + 1, Math.ceil(((bx + 1) * gw) / GLYPH_W))
      let on = 0
      for (let y = sy0; y < Math.min(gh, sy1) && !on; y++) {
        for (let x = sx0; x < Math.min(gw, sx1) && !on; x++) {
          if (local[y * gw + x]) on = 1
        }
      }
      out[by * GLYPH_W + bx] = on
    }
  }
  return out
}

/**
 * Area-averaged ink density per cell, contrast-normalised. Zero mean and unit
 * norm make the comparison invariant to how dark a particular label printed.
 */
function greyProfile(gray: GrayImage, x0: number, y0: number, gw: number, gh: number): Float32Array {
  const out = new Float32Array(GLYPH_W * GLYPH_H)
  for (let by = 0; by < GLYPH_H; by++) {
    const sy0 = y0 + (by * gh) / GLYPH_H
    const sy1 = y0 + ((by + 1) * gh) / GLYPH_H
    for (let bx = 0; bx < GLYPH_W; bx++) {
      const sx0 = x0 + (bx * gw) / GLYPH_W
      const sx1 = x0 + ((bx + 1) * gw) / GLYPH_W
      let sum = 0
      let n = 0
      for (let y = Math.floor(sy0); y < Math.max(Math.floor(sy0) + 1, Math.ceil(sy1)); y++) {
        for (let x = Math.floor(sx0); x < Math.max(Math.floor(sx0) + 1, Math.ceil(sx1)); x++) {
          if (x < 0 || y < 0 || x >= gray.width || y >= gray.height) continue
          sum += 255 - gray.data[y * gray.width + x]
          n++
        }
      }
      out[by * GLYPH_W + bx] = n > 0 ? sum / n : 0
    }
  }
  let mean = 0
  for (let i = 0; i < out.length; i++) mean += out[i]
  mean /= out.length
  let norm = 0
  for (let i = 0; i < out.length; i++) {
    out[i] -= mean
    norm += out[i] * out[i]
  }
  norm = Math.sqrt(norm)
  if (norm > 1e-6) for (let i = 0; i < out.length; i++) out[i] /= norm
  return out
}

/** Enclosed background regions inside a glyph's bounding box. */
function countHoles(members: readonly number[], imageW: number, x0: number, y0: number, gw: number, gh: number): number {
  const pad = 1
  const W = gw + pad * 2
  const H = gh + pad * 2
  const filled = new Uint8Array(W * H)
  for (const i of members) {
    const x = (i % imageW) - x0 + pad
    const y = ((i / imageW) | 0) - y0 + pad
    filled[y * W + x] = 1
  }
  const seen = new Uint8Array(W * H)
  const queue = new Int32Array(W * H)
  let head = 0
  let tail = 0
  queue[tail++] = 0
  seen[0] = 1
  while (head < tail) {
    const i = queue[head++]
    const x = i % W
    const y = (i / W) | 0
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
      const j = ny * W + nx
      if (seen[j] || filled[j]) continue
      seen[j] = 1
      queue[tail++] = j
    }
  }
  let holes = 0
  const visited = new Uint8Array(W * H)
  for (let i = 0; i < W * H; i++) {
    if (filled[i] || seen[i] || visited[i]) continue
    holes++
    let h2 = 0
    let t2 = 0
    queue[t2++] = i
    visited[i] = 1
    while (h2 < t2) {
      const k = queue[h2++]
      const x = k % W
      const y = (k / W) | 0
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
        const j = ny * W + nx
        if (visited[j] || filled[j] || seen[j]) continue
        visited[j] = 1
        queue[t2++] = j
      }
    }
  }
  return holes
}

export type GlyphRun = {
  glyphs: Glyph[]
  x0: number
  y0: number
  x1: number
  y1: number
  /** Centre of the run. */
  cx: number
  cy: number
  /** Median glyph height, used to reject mixed-size groupings. */
  glyphHeight: number
}

/**
 * Group glyphs sharing a baseline into numbers. Drafting text is set tight, so
 * the gap test is relative to glyph height rather than absolute.
 */
export function groupRuns(glyphs: readonly Glyph[], maxGapRatio = 0.75, baselineTolerance = 0.45): GlyphRun[] {
  const sorted = [...glyphs].sort((a, b) => a.x0 - b.x0 || a.y0 - b.y0)
  const used = new Set<number>()
  const runs: GlyphRun[] = []
  for (const g of sorted) {
    if (used.has(g.id)) continue
    const members = [g]
    used.add(g.id)
    let cursor = g
    for (;;) {
      const h = cursor.y1 - cursor.y0 + 1
      const candidate = sorted.find(
        (c) =>
          !used.has(c.id) &&
          c.x0 >= cursor.x1 - 1 &&
          c.x0 - cursor.x1 <= h * maxGapRatio &&
          Math.abs((c.y0 + c.y1) / 2 - (cursor.y0 + cursor.y1) / 2) <= h * baselineTolerance &&
          Math.abs(c.y1 - c.y0 - (cursor.y1 - cursor.y0)) <= h * 0.5,
      )
      if (!candidate) break
      used.add(candidate.id)
      members.push(candidate)
      cursor = candidate
    }
    const heights = members.map((m) => m.y1 - m.y0 + 1).sort((a, b) => a - b)
    runs.push({
      glyphs: members,
      x0: Math.min(...members.map((m) => m.x0)),
      x1: Math.max(...members.map((m) => m.x1)),
      y0: Math.min(...members.map((m) => m.y0)),
      y1: Math.max(...members.map((m) => m.y1)),
      cx: (Math.min(...members.map((m) => m.x0)) + Math.max(...members.map((m) => m.x1))) / 2,
      cy: (Math.min(...members.map((m) => m.y0)) + Math.max(...members.map((m) => m.y1))) / 2,
      glyphHeight: heights[Math.floor(heights.length / 2)],
    })
  }
  return runs
}

export type GlyphCluster = {
  id: number
  prototype: Uint8Array
  /** Mean grey profile of the members, re-normalised. */
  profile: Float32Array
  holes: number
  members: Glyph[]
  /** Digit assigned by the geometric bootstrap; null until identified. */
  digit: number | null
  /** Votes per digit from the bootstrap, for the confidence report. */
  votes: Map<number, number>
}

/** Cosine distance between two normalised grey profiles, in [0, 2]. */
const profileDistance = (a: Float32Array, b: Float32Array): number => {
  let dot = 0
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i]
  return 1 - dot
}

/**
 * Cluster glyphs by shape. Digits repeat many times across a drawing, so a
 * simple agglomerative pass with a shape-distance threshold recovers one
 * cluster per digit without knowing how many there are.
 */
export function clusterGlyphs(glyphs: readonly Glyph[], threshold = 0.3): GlyphCluster[] {
  const clusters: GlyphCluster[] = []
  // Largest glyphs first: they give the cleanest prototypes, and the small,
  // noisier ones then attach to a prototype rather than founding their own.
  const ordered = [...glyphs].sort((a, b) => b.area - a.area || a.id - b.id)
  for (const g of ordered) {
    let best: GlyphCluster | null = null
    let bestD = Number.POSITIVE_INFINITY
    for (const c of clusters) {
      const d = profileDistance(c.profile, g.profile)
      if (d < bestD) {
        bestD = d
        best = c
      }
    }
    if (best && bestD <= threshold) {
      best.members.push(g)
      // Running mean keeps the prototype representative as members accumulate.
      const n = best.members.length
      for (let i = 0; i < best.profile.length; i++) best.profile[i] += (g.profile[i] - best.profile[i]) / n
      continue
    }
    clusters.push({
      id: clusters.length,
      prototype: g.bitmap,
      profile: Float32Array.from(g.profile),
      holes: g.holes,
      members: [g],
      digit: null,
      votes: new Map(),
    })
  }
  for (const c of clusters) {
    const acc = new Float32Array(GLYPH_W * GLYPH_H)
    for (const m of c.members) for (let i = 0; i < acc.length; i++) acc[i] += m.bitmap[i]
    const proto = new Uint8Array(GLYPH_W * GLYPH_H)
    for (let i = 0; i < proto.length; i++) proto[i] = acc[i] > c.members.length / 2 ? 1 : 0
    c.prototype = proto
    let norm = 0
    for (let i = 0; i < c.profile.length; i++) norm += c.profile[i] * c.profile[i]
    norm = Math.sqrt(norm)
    if (norm > 1e-6) for (let i = 0; i < c.profile.length; i++) c.profile[i] /= norm
  }
  return clusters.sort((a, b) => b.members.length - a.members.length)
}

export const clusterOf = (clusters: readonly GlyphCluster[], glyph: Glyph): GlyphCluster | undefined =>
  clusters.find((c) => c.members.some((m) => m.id === glyph.id))

/** Decode a run once the clusters carry digits. Returns null if any is unknown. */
export function decodeRun(run: GlyphRun, clusters: readonly GlyphCluster[]): number | null {
  let text = ''
  for (const g of run.glyphs) {
    const c = clusterOf(clusters, g)
    if (!c || c.digit === null) return null
    text += String(c.digit)
  }
  if (text.length === 0) return null
  const value = Number(text)
  return Number.isFinite(value) ? value : null
}
