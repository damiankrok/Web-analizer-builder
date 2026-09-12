/**
 * Building-silhouette extraction (§19).
 *
 * ARCHON does not publish line-art elevations: both the technical elevations and
 * the visualisations are rendered onto a photographic backdrop (sky, clouds,
 * trees, lawn, paving). So the mask cannot assume a white page. Instead the
 * background classes are identified positively — sky by blue dominance,
 * vegetation by green dominance, ground by the terrain band at the foot of the
 * image — and the building is what survives.
 *
 * PORT_DIRECT (Kotlin).
 */
import type { GrayImage, MaskImage, RasterImage } from '../contracts/raster.js'
import { makeMask } from '../contracts/raster.js'
import type { Gradients } from './filters.js'
import { cannyEdges, closeMask, dilate, fillHoles, maskArea, openMask, sobel } from './filters.js'
import { toGray } from './gray.js'

export type BackgroundClasses = {
  sky: MaskImage
  vegetation: MaskImage
  ground: MaskImage
  /** Union of everything classified as not-building. */
  background: MaskImage
}

/**
 * Background classification by edge-bounded flood from the image borders.
 *
 * A pure colour rule fails on these sources: the hero renders are lit at dusk,
 * so the sky is pink rather than blue, and a blue-dominance test classifies
 * none of it. What is stable across all of them is that background regions are
 * connected to an image border and vary *smoothly*, while the building is
 * separated from them by a strong edge. So the flood accepts a neighbour when
 * the colour step is small and the neighbour is not sitting on an edge, which
 * follows a sky gradient from zenith to horizon yet stops dead at a roofline.
 */
export function classifyBackground(img: RasterImage, precomputed?: Gradients): BackgroundClasses {
  const w = img.width
  const h = img.height
  const grad = precomputed ?? sobel(toGray(img))
  // A hysteresis contour is a far better barrier than a gradient threshold: a
  // roofline is a closed contour even where it fades into a bright sky, whereas
  // a threshold leaves a gap there and the flood pours through it.
  const barrier = dilate(cannyEdges(grad, 0.80, 0.93), 1)

  const sky = makeMask(w, h)
  const veg = makeMask(w, h)
  const ground = makeMask(w, h)

  for (let i = 0; i < w * h; i++) {
    const r = img.data[i * 4]
    const g = img.data[i * 4 + 1]
    const b = img.data[i * 4 + 2]
    if (g > r + 8 && g > b + 6 && g > 40) veg.data[i] = 1
  }

  const colourStep = 12
  const flood = (seeds: number[], target: MaskImage): void => {
    const queue = new Int32Array(w * h)
    let head = 0
    let tail = 0
    for (const s of seeds) {
      if (!target.data[s] && !barrier.data[s]) {
        target.data[s] = 1
        queue[tail++] = s
      }
    }
    while (head < tail) {
      const i = queue[head++]
      const x = i % w
      const y = (i / w) | 0
      const r = img.data[i * 4]
      const g = img.data[i * 4 + 1]
      const b = img.data[i * 4 + 2]
      const visit = (j: number): void => {
        if (target.data[j]) return
        if (barrier.data[j]) return
        const dr = Math.abs(img.data[j * 4] - r)
        const dg = Math.abs(img.data[j * 4 + 1] - g)
        const db = Math.abs(img.data[j * 4 + 2] - b)
        if (dr + dg + db > colourStep * 3) return
        target.data[j] = 1
        queue[tail++] = j
      }
      if (x > 0) visit(i - 1)
      if (x < w - 1) visit(i + 1)
      if (y > 0) visit(i - w)
      if (y < h - 1) visit(i + w)
    }
  }

  // Sky: seeded from the top border, and additionally from any clearly
  // blue-dominant pixel in the upper half (handles a cropped-in skyline).
  const skySeeds: number[] = []
  for (let x = 0; x < w; x++) skySeeds.push(x)
  for (let i = 0; i < (w * h) / 2; i++) {
    const r = img.data[i * 4]
    const g = img.data[i * 4 + 1]
    const b = img.data[i * 4 + 2]
    if (b > 120 && b - r > 20 && b >= g) skySeeds.push(i)
  }
  flood(skySeeds, sky)

  // Ground: seeded from the bottom border only.
  const groundSeeds: number[] = []
  for (let x = 0; x < w; x++) groundSeeds.push((h - 1) * w + x)
  flood(groundSeeds, ground)

  const bg = makeMask(w, h)
  for (let i = 0; i < w * h; i++) bg.data[i] = sky.data[i] || veg.data[i] || ground.data[i] ? 1 : 0
  return { sky, vegetation: veg, ground, background: bg }
}

export type BuildingMaskResult = {
  mask: MaskImage
  /** Row index of the estimated ground line; -1 when none was found. */
  groundRow: number
  /** Fraction of the image occupied by the building. */
  coverage: number
  notes: string[]
}

export function extractBuildingMask(img: RasterImage): BuildingMaskResult {
  const notes: string[] = []
  const w = img.width
  const h = img.height
  const { background, ground } = classifyBackground(img)

  const fg = makeMask(w, h)
  for (let i = 0; i < w * h; i++) fg.data[i] = background.data[i] ? 0 : 1

  // Publisher watermarks and thin foliage punch holes in the facade; a close
  // followed by hole-filling repairs them without moving the outer boundary.
  const radius = Math.max(2, Math.round(Math.min(w, h) / 120))
  const cleaned = fillHoles(closeMask(openMask(fg, 1), radius))
  const mask = pickBuildingComponent(cleaned, notes)

  // The ground line is simply the foot of the accepted silhouette.
  const bounds = maskBounds(mask)
  const groundRow = bounds.empty ? -1 : bounds.maxY
  let groundTouch = 0
  if (!bounds.empty) {
    for (let x = bounds.minX; x <= bounds.maxX; x++) {
      const y = Math.min(h - 1, bounds.maxY + 1)
      if (ground.data[y * w + x]) groundTouch++
    }
    const span = bounds.maxX - bounds.minX + 1
    if (groundTouch < span * 0.2) notes.push('silhouette foot does not rest on classified ground')
  }

  const coverage = maskArea(mask) / (w * h)
  if (coverage < 0.02) notes.push('building mask suspiciously small')
  if (coverage > 0.85) notes.push('building mask suspiciously large — background classification likely failed')
  return { mask, groundRow, coverage, notes }
}

/**
 * Choose the component that is the building. Largest-by-area alone picks up
 * publisher watermarks and foreground planting, so components are scored by
 * area weighted towards the horizontal centre of the frame, and any component
 * hugging the top border (unbroken sky misread as foreground) is rejected.
 */
function pickBuildingComponent(m: MaskImage, notes: string[]): MaskImage {
  const w = m.width
  const h = m.height
  const label = new Int32Array(w * h).fill(-1)
  const queue = new Int32Array(w * h)
  type Comp = { id: number; size: number; sumX: number; topRow: number; topCount: number }
  const comps: Comp[] = []
  let next = 0
  for (let start = 0; start < w * h; start++) {
    if (m.data[start] === 0 || label[start] >= 0) continue
    const id = next++
    let head = 0
    let tail = 0
    queue[tail++] = start
    label[start] = id
    const comp: Comp = { id, size: 0, sumX: 0, topRow: h, topCount: 0 }
    while (head < tail) {
      const i = queue[head++]
      comp.size++
      const x = i % w
      const y = (i / w) | 0
      comp.sumX += x
      if (y < comp.topRow) comp.topRow = y
      if (y === 0) comp.topCount++
      if (x > 0 && m.data[i - 1] && label[i - 1] < 0) (label[i - 1] = id), (queue[tail++] = i - 1)
      if (x < w - 1 && m.data[i + 1] && label[i + 1] < 0) (label[i + 1] = id), (queue[tail++] = i + 1)
      if (y > 0 && m.data[i - w] && label[i - w] < 0) (label[i - w] = id), (queue[tail++] = i - w)
      if (y < h - 1 && m.data[i + w] && label[i + w] < 0) (label[i + w] = id), (queue[tail++] = i + w)
    }
    comps.push(comp)
  }
  if (comps.length === 0) return makeMask(w, h)

  let best: Comp | null = null
  let bestScore = -1
  for (const c of comps) {
    if (c.topCount > w * 0.5) continue // spans the top border: that is sky
    const cx = c.sumX / c.size
    const centrality = 1 - Math.min(1, Math.abs(cx - w / 2) / (w / 2))
    const score = c.size * (0.35 + 0.65 * centrality)
    if (score > bestScore) {
      bestScore = score
      best = c
    }
  }
  if (!best) {
    notes.push('no plausible building component; falling back to largest')
    best = comps.reduce((a, b) => (b.size > a.size ? b : a))
  }
  const out = makeMask(w, h)
  for (let i = 0; i < w * h; i++) if (label[i] === best.id) out.data[i] = 1
  return out
}

/** Ink mask for true line drawings (section, plans): dark on white paper. */
export function extractInkMask(g: GrayImage, threshold = 150): MaskImage {
  const out = makeMask(g.width, g.height)
  for (let i = 0; i < g.data.length; i++) out.data[i] = g.data[i] < threshold ? 1 : 0
  return out
}

/**
 * Per-column topmost foreground row. This is the silhouette profile used for
 * roofline and ridge/eave matching; -1 marks an empty column.
 */
export function skylineProfile(m: MaskImage): Int32Array {
  const out = new Int32Array(m.width).fill(-1)
  for (let x = 0; x < m.width; x++) {
    for (let y = 0; y < m.height; y++) {
      if (m.data[y * m.width + x]) {
        out[x] = y
        break
      }
    }
  }
  return out
}

/** Per-column bottom-most foreground row. */
export function baselineProfile(m: MaskImage): Int32Array {
  const out = new Int32Array(m.width).fill(-1)
  for (let x = 0; x < m.width; x++) {
    for (let y = m.height - 1; y >= 0; y--) {
      if (m.data[y * m.width + x]) {
        out[x] = y
        break
      }
    }
  }
  return out
}

export type MaskBounds = { minX: number; maxX: number; minY: number; maxY: number; empty: boolean }

export function maskBounds(m: MaskImage): MaskBounds {
  let minX = m.width
  let maxX = -1
  let minY = m.height
  let maxY = -1
  for (let y = 0; y < m.height; y++) {
    for (let x = 0; x < m.width; x++) {
      if (!m.data[y * m.width + x]) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  return { minX, maxX, minY, maxY, empty: maxX < 0 }
}

/** Intersection over union of two masks of equal size. */
export function maskIoU(a: MaskImage, b: MaskImage): number {
  if (a.width !== b.width || a.height !== b.height) throw new Error('maskIoU: size mismatch')
  let inter = 0
  let union = 0
  for (let i = 0; i < a.data.length; i++) {
    const x = a.data[i]
    const y = b.data[i]
    if (x && y) inter++
    if (x || y) union++
  }
  return union === 0 ? 1 : inter / union
}

/** Nearest-neighbour mask resample, used to bring scores to a common grid. */
export function resampleMask(m: MaskImage, w: number, h: number): MaskImage {
  const out = makeMask(w, h)
  for (let y = 0; y < h; y++) {
    const sy = Math.min(m.height - 1, Math.floor((y * m.height) / h))
    for (let x = 0; x < w; x++) {
      const sx = Math.min(m.width - 1, Math.floor((x * m.width) / w))
      out.data[y * w + x] = m.data[sy * m.width + sx]
    }
  }
  return out
}
