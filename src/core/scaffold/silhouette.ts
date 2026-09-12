/**
 * Silhouette conditioning for orthographic facade sources (§18).
 *
 * The raw building mask of a published elevation is not yet a facade: it also
 * contains the strip of terrain the building is drawn standing on, and that
 * strip runs the full width of the frame, bridging the facade to whatever else
 * touches the ground — foreground planting on one side, the publisher's
 * watermark on the other. Measuring a bounding box over that gives a building
 * half again too wide.
 *
 * Two steps fix it. The terrain band is cut where the silhouette width steps
 * abruptly outwards near the foot of the image, and the facade span is then
 * taken as the dominant run of columns that are both well occupied and standing
 * on the ground, which drops floating watermarks and low planting.
 *
 * PORT_DIRECT (Kotlin).
 */
import type { MaskImage } from '../contracts/raster.js'
import { makeMask } from '../contracts/raster.js'

export type ConditionedSilhouette = {
  mask: MaskImage
  /** Row of the ground line in the analysis frame; -1 if none was found. */
  groundRow: number
  /** Column span of the facade. */
  minX: number
  maxX: number
  /** Row of the highest silhouette point within the span. */
  topRow: number
  widthPx: number
  heightPx: number
  /** Column index of the highest point (the ridge or apex). */
  apexX: number
  confidence: number
  notes: string[]
}

const rowWidths = (m: MaskImage): Int32Array => {
  const out = new Int32Array(m.height)
  for (let y = 0; y < m.height; y++) {
    let n = 0
    for (let x = 0; x < m.width; x++) n += m.data[y * m.width + x]
    out[y] = n
  }
  return out
}

const colHeights = (m: MaskImage): Int32Array => {
  const out = new Int32Array(m.width)
  for (let x = 0; x < m.width; x++) {
    let n = 0
    for (let y = 0; y < m.height; y++) n += m.data[y * m.width + x]
    out[x] = n
  }
  return out
}

/**
 * Find the row where the terrain band begins: scanning up from the foot of the
 * silhouette, the row at which the width steps outwards sharply. A facade that
 * simply widens at a plinth steps by a little; terrain steps to nearly the full
 * frame, so the test is on both the step size and the resulting width.
 */
export function findGroundBand(m: MaskImage, stepFactor = 1.18): number {
  const widths = rowWidths(m)
  let bottom = -1
  let maxW = 0
  for (let y = 0; y < m.height; y++) {
    if (widths[y] > 0) bottom = y
    if (widths[y] > maxW) maxW = widths[y]
  }
  if (bottom < 0 || maxW === 0) return -1

  const limit = Math.max(0, bottom - Math.round(m.height * 0.3))
  const window = Math.max(3, Math.round(m.height * 0.03))
  let cut = -1
  for (let y = bottom; y > limit; y--) {
    const above: number[] = []
    for (let k = y - window; k < y; k++) if (k >= 0 && widths[k] > 0) above.push(widths[k])
    if (above.length < 2) continue
    above.sort((a, b) => a - b)
    const median = above[Math.floor(above.length / 2)]
    if (median <= 0) continue
    if (widths[y] >= median * stepFactor && widths[y] >= maxW * 0.75) cut = y
  }
  return cut
}

export function conditionSilhouette(m: MaskImage, occupancyFraction = 0.25): ConditionedSilhouette {
  const notes: string[] = []
  const width = m.width
  const height = m.height

  const cut = findGroundBand(m)
  const work = makeMask(width, height)
  work.data.set(m.data)
  if (cut > 0) {
    for (let y = cut; y < height; y++) for (let x = 0; x < width; x++) work.data[y * width + x] = 0
    notes.push(`terrain band removed from row ${cut}`)
  } else {
    notes.push('no terrain band detected')
  }

  const cols = colHeights(work)
  let maxCol = 0
  for (const c of cols) if (c > maxCol) maxCol = c
  if (maxCol === 0) {
    return {
      mask: work,
      groundRow: -1,
      minX: 0,
      maxX: -1,
      topRow: -1,
      widthPx: 0,
      heightPx: 0,
      apexX: -1,
      confidence: 0,
      notes: [...notes, 'silhouette is empty'],
    }
  }

  // Foot row of the conditioned silhouette, and which columns reach it.
  let footRow = 0
  for (let y = height - 1; y >= 0; y--) {
    let n = 0
    for (let x = 0; x < width; x++) n += work.data[y * width + x]
    if (n > 0) {
      footRow = y
      break
    }
  }
  const band = Math.max(2, Math.round(height * 0.08))
  const grounded = new Uint8Array(width)
  for (let x = 0; x < width; x++) {
    for (let y = Math.max(0, footRow - band); y <= footRow; y++) {
      if (work.data[y * width + x]) {
        grounded[x] = 1
        break
      }
    }
  }

  // Dominant run of columns that are both well occupied and standing on ground.
  const threshold = maxCol * occupancyFraction
  let bestLo = -1
  let bestHi = -2
  let lo = -1
  const gapTolerance = Math.max(2, Math.round(width * 0.015))
  let gap = 0
  for (let x = 0; x <= width; x++) {
    const on = x < width && cols[x] >= threshold && grounded[x] === 1
    if (on) {
      if (lo < 0) lo = x
      gap = 0
    } else if (lo >= 0) {
      gap++
      if (gap > gapTolerance || x === width) {
        const hi = x - gap
        if (hi - lo > bestHi - bestLo) {
          bestLo = lo
          bestHi = hi
        }
        lo = -1
        gap = 0
      }
    }
  }
  if (bestHi < bestLo) {
    return {
      mask: work,
      groundRow: cut > 0 ? cut - 1 : footRow,
      minX: 0,
      maxX: width - 1,
      topRow: 0,
      widthPx: width,
      heightPx: height,
      apexX: Math.floor(width / 2),
      confidence: 0.1,
      notes: [...notes, 'no dominant facade run; falling back to the full frame'],
    }
  }

  let topRow = height
  let apexX = bestLo
  let bottomRow = 0
  for (let x = bestLo; x <= bestHi; x++) {
    for (let y = 0; y < height; y++) {
      if (!work.data[y * width + x]) continue
      if (y < topRow) {
        topRow = y
        apexX = x
      }
      if (y > bottomRow) bottomRow = y
      break
    }
    for (let y = height - 1; y >= 0; y--) {
      if (work.data[y * width + x]) {
        if (y > bottomRow) bottomRow = y
        break
      }
    }
  }

  const widthPx = bestHi - bestLo + 1
  const heightPx = bottomRow - topRow + 1
  // A facade that fills the whole frame usually means the background model
  // failed, so the measurement is reported with low confidence rather than
  // silently trusted.
  const fillsFrame = widthPx >= width * 0.97
  const confidence = fillsFrame ? 0.35 : cut > 0 ? 0.85 : 0.6
  if (fillsFrame) notes.push('facade spans the entire frame; the image is probably cropped to the building')

  return {
    mask: work,
    groundRow: bottomRow,
    minX: bestLo,
    maxX: bestHi,
    topRow,
    widthPx,
    heightPx,
    apexX,
    confidence,
    notes,
  }
}

/** Per-column top row within the conditioned span; -1 outside the facade. */
export function facadeSkyline(s: ConditionedSilhouette): Int32Array {
  const out = new Int32Array(s.mask.width).fill(-1)
  for (let x = s.minX; x <= s.maxX; x++) {
    for (let y = 0; y < s.mask.height; y++) {
      if (s.mask.data[y * s.mask.width + x]) {
        out[x] = y
        break
      }
    }
  }
  return out
}
