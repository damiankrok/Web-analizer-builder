/**
 * Separable blur, Sobel gradients and non-maximum suppression.
 *
 * PORT_DIRECT (Kotlin): flat arrays and integer loops only.
 */
import type { FloatImage, GrayImage, MaskImage } from '../contracts/raster.js'
import { makeFloat, makeGray, makeMask } from '../contracts/raster.js'

const clampIdx = (v: number, hi: number): number => (v < 0 ? 0 : v > hi ? hi : v)

/** Separable Gaussian with a 5-tap kernel; sigma is fixed at ~1.0. */
export function blurGray(g: GrayImage): GrayImage {
  const k = [1, 4, 6, 4, 1]
  const ksum = 16
  const tmp = makeGray(g.width, g.height)
  const out = makeGray(g.width, g.height)
  for (let y = 0; y < g.height; y++) {
    for (let x = 0; x < g.width; x++) {
      let s = 0
      for (let i = -2; i <= 2; i++) s += k[i + 2] * g.data[y * g.width + clampIdx(x + i, g.width - 1)]
      tmp.data[y * g.width + x] = s / ksum
    }
  }
  for (let y = 0; y < g.height; y++) {
    for (let x = 0; x < g.width; x++) {
      let s = 0
      for (let i = -2; i <= 2; i++) s += k[i + 2] * tmp.data[clampIdx(y + i, g.height - 1) * g.width + x]
      out.data[y * g.width + x] = s / ksum
    }
  }
  return out
}

export type Gradients = { mag: FloatImage; dir: FloatImage; gx: FloatImage; gy: FloatImage }

export function sobel(g: GrayImage): Gradients {
  const w = g.width
  const h = g.height
  const gx = makeFloat(w, h)
  const gy = makeFloat(w, h)
  const mag = makeFloat(w, h)
  const dir = makeFloat(w, h)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const a = g.data[i - w - 1]
      const b = g.data[i - w]
      const c = g.data[i - w + 1]
      const d = g.data[i - 1]
      const f = g.data[i + 1]
      const p = g.data[i + w - 1]
      const q = g.data[i + w]
      const r = g.data[i + w + 1]
      const sx = a + 2 * d + p - (c + 2 * f + r)
      const sy = a + 2 * b + c - (p + 2 * q + r)
      gx.data[i] = -sx
      gy.data[i] = -sy
      mag.data[i] = Math.hypot(sx, sy)
      dir.data[i] = Math.atan2(-sy, -sx)
    }
  }
  return { mag, dir, gx, gy }
}

/** Percentile of a float field, computed on a 512-bucket histogram. */
export function percentile(f: FloatImage, p: number): number {
  let max = 0
  for (let i = 0; i < f.data.length; i++) if (f.data[i] > max) max = f.data[i]
  if (max <= 0) return 0
  const bins = new Int32Array(512)
  for (let i = 0; i < f.data.length; i++) bins[Math.min(511, Math.floor((f.data[i] / max) * 511))]++
  const target = p * f.data.length
  let acc = 0
  for (let b = 0; b < 512; b++) {
    acc += bins[b]
    if (acc >= target) return ((b + 0.5) / 512) * max
  }
  return max
}

/**
 * Canny-style edges: non-maximum suppression plus hysteresis. Thresholds are
 * given as percentiles of the gradient magnitude so the same numbers work on a
 * flat line drawing and on a contrasty render.
 */
export function cannyEdges(g: Gradients, lowPct = 0.92, highPct = 0.97): MaskImage {
  const w = g.mag.width
  const h = g.mag.height
  const low = percentile(g.mag, lowPct)
  const high = percentile(g.mag, highPct)
  const nms = makeFloat(w, h)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const m = g.mag.data[i]
      if (m < low) continue
      // Quantise the gradient direction to one of four neighbour pairs.
      const angle = ((g.dir.data[i] * 180) / Math.PI + 180) % 180
      let a: number
      let b: number
      if (angle < 22.5 || angle >= 157.5) {
        a = g.mag.data[i - 1]
        b = g.mag.data[i + 1]
      } else if (angle < 67.5) {
        a = g.mag.data[i - w + 1]
        b = g.mag.data[i + w - 1]
      } else if (angle < 112.5) {
        a = g.mag.data[i - w]
        b = g.mag.data[i + w]
      } else {
        a = g.mag.data[i - w - 1]
        b = g.mag.data[i + w + 1]
      }
      if (m >= a && m >= b) nms.data[i] = m
    }
  }
  const out = makeMask(w, h)
  const stack: number[] = []
  for (let i = 0; i < nms.data.length; i++) {
    if (nms.data[i] >= high) {
      out.data[i] = 1
      stack.push(i)
    }
  }
  while (stack.length) {
    const i = stack.pop() as number
    const x = i % w
    const y = (i / w) | 0
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
        const j = ny * w + nx
        if (out.data[j] === 0 && nms.data[j] >= low) {
          out.data[j] = 1
          stack.push(j)
        }
      }
    }
  }
  return out
}

/** Morphological dilation with a square structuring element. */
export function dilate(m: MaskImage, radius: number): MaskImage {
  if (radius <= 0) return m
  const w = m.width
  const h = m.height
  const tmp = makeMask(w, h)
  const out = makeMask(w, h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0
      for (let d = -radius; d <= radius && !v; d++) v = m.data[y * w + clampIdx(x + d, w - 1)]
      tmp.data[y * w + x] = v
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0
      for (let d = -radius; d <= radius && !v; d++) v = tmp.data[clampIdx(y + d, h - 1) * w + x]
      out.data[y * w + x] = v
    }
  }
  return out
}

export function erode(m: MaskImage, radius: number): MaskImage {
  if (radius <= 0) return m
  const inv = makeMask(m.width, m.height)
  for (let i = 0; i < m.data.length; i++) inv.data[i] = m.data[i] ? 0 : 1
  const d = dilate(inv, radius)
  const out = makeMask(m.width, m.height)
  for (let i = 0; i < d.data.length; i++) out.data[i] = d.data[i] ? 0 : 1
  return out
}

export const closeMask = (m: MaskImage, r: number): MaskImage => erode(dilate(m, r), r)
export const openMask = (m: MaskImage, r: number): MaskImage => dilate(erode(m, r), r)

export function maskArea(m: MaskImage): number {
  let n = 0
  for (let i = 0; i < m.data.length; i++) n += m.data[i]
  return n
}

/** Largest 4-connected component; everything else is dropped. */
export function largestComponent(m: MaskImage): MaskImage {
  const w = m.width
  const h = m.height
  const label = new Int32Array(w * h).fill(-1)
  let best = -1
  let bestSize = 0
  let next = 0
  const queue = new Int32Array(w * h)
  for (let start = 0; start < w * h; start++) {
    if (m.data[start] === 0 || label[start] >= 0) continue
    const id = next++
    let head = 0
    let tail = 0
    queue[tail++] = start
    label[start] = id
    let size = 0
    while (head < tail) {
      const i = queue[head++]
      size++
      const x = i % w
      const y = (i / w) | 0
      if (x > 0 && m.data[i - 1] && label[i - 1] < 0) (label[i - 1] = id), (queue[tail++] = i - 1)
      if (x < w - 1 && m.data[i + 1] && label[i + 1] < 0) (label[i + 1] = id), (queue[tail++] = i + 1)
      if (y > 0 && m.data[i - w] && label[i - w] < 0) (label[i - w] = id), (queue[tail++] = i - w)
      if (y < h - 1 && m.data[i + w] && label[i + w] < 0) (label[i + w] = id), (queue[tail++] = i + w)
    }
    if (size > bestSize) {
      bestSize = size
      best = id
    }
  }
  const out = makeMask(w, h)
  if (best < 0) return out
  for (let i = 0; i < w * h; i++) if (label[i] === best) out.data[i] = 1
  return out
}

/** Fill holes: anything not reachable from the border becomes foreground. */
export function fillHoles(m: MaskImage): MaskImage {
  const w = m.width
  const h = m.height
  const seen = new Uint8Array(w * h)
  const queue = new Int32Array(w * h)
  let head = 0
  let tail = 0
  const push = (i: number): void => {
    if (!seen[i] && m.data[i] === 0) {
      seen[i] = 1
      queue[tail++] = i
    }
  }
  for (let x = 0; x < w; x++) {
    push(x)
    push((h - 1) * w + x)
  }
  for (let y = 0; y < h; y++) {
    push(y * w)
    push(y * w + w - 1)
  }
  while (head < tail) {
    const i = queue[head++]
    const x = i % w
    const y = (i / w) | 0
    if (x > 0) push(i - 1)
    if (x < w - 1) push(i + 1)
    if (y > 0) push(i - w)
    if (y < h - 1) push(i + w)
  }
  const out = makeMask(w, h)
  for (let i = 0; i < w * h; i++) out.data[i] = m.data[i] || !seen[i] ? 1 : 0
  return out
}
