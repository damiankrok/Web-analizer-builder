/**
 * Architectural feature solving on orthographic facades (§18, §19, §30).
 *
 * A house is not its footprint extruded. What makes this project recognisable —
 * the recessed upper storey behind the gable with its balcony, the flat canopy
 * running across the front, the large glazing groups, the chimneys, the roof
 * lights — is all visible in the technical elevations, and all of it is
 * orthographic, which means it can be measured rather than guessed.
 *
 * Each detector below answers one question from the facade's own geometry:
 *
 *   bands       where does a strong horizontal line run across the facade, and
 *               how far does it extend? A band that reaches beyond the mass
 *               below it is a canopy or balcony slab, not a shadow line.
 *   protrusions what rises above the roof silhouette? Fitting the roof's own
 *               two slope lines and asking which columns exceed them isolates
 *               chimneys without needing to know where a chimney "should" be.
 *   recess      is the wall below a band set back from the wall above it, or
 *               vice versa? The silhouette says so directly.
 *   openings    delegated to openings.ts, which requires a four-sided frame.
 *
 * Nothing here is specific to one project: every threshold is a fraction of the
 * facade's own size, and every feature is emitted with the evidence that
 * produced it so a reader can see why it exists.
 *
 * PORT_DIRECT (Kotlin).
 */
import type { GrayImage, MaskImage } from '../contracts/raster.js'
import { makeMask } from '../contracts/raster.js'
import type { Gradients } from '../raster/filters.js'
import { cannyEdges } from '../raster/filters.js'
import type { FacadeSide } from '../contracts/hypotheses.js'
import { cluster1D, significantClusters } from './cluster.js'
import { findOpeningRectangles, DEFAULT_OPENING_DETECT, type OpeningRect } from './openings.js'
import { facadeSkyline, type ConditionedSilhouette } from './silhouette.js'

export type FacadeBand = {
  /** Height above the ground line, metres. */
  t: number
  /** Facade-local extent, metres. */
  s0: number
  s1: number
  /** Fraction of the facade width the band covers. */
  coverage: number
  strength: number
}

export type FacadeProtrusion = {
  /** Facade-local centre, metres. */
  s: number
  widthM: number
  /** How far it rises above the fitted roof silhouette, metres. */
  heightM: number
  /** Height of its top above the ground line, metres. */
  topT: number
}

export type RoofOpening = {
  /** Facade-local position of the centre, metres. */
  s: number
  /** Height of the centre above the ground line, metres. */
  t: number
  widthM: number
  heightM: number
}

export type FacadeFeatureSet = {
  facade: FacadeSide
  assetId: string
  /** Facade width as measured on the elevation, metres. */
  widthM: number
  heightM: number
  bands: FacadeBand[]
  protrusions: FacadeProtrusion[]
  roofOpenings: RoofOpening[]
  openings: OpeningRect[]
  /** Glazed gable infill, when this facade shows a gable. */
  gableInfill: GableInfill | null
  /** Facade-local metres per pixel. */
  metresPerPixel: number
  /** Ground-line row in the analysis frame. */
  groundRow: number
  minX: number
  notes: string[]
}

const toMetres = (px: number, mpp: number): number => px * mpp

/**
 * Horizontal bands: rows whose horizontal-edge energy is concentrated, together
 * with how far along the facade that energy actually reaches.
 *
 * Extent matters as much as the row. A slab edge that stops at the main body is
 * a band on that mass; one that continues past it is a canopy, and the
 * difference decides whether a new mass is hypothesised.
 */
export function detectBands(
  grad: Gradients,
  region: MaskImage,
  sil: ConditionedSilhouette,
  mpp: number,
  minCoverage = 0.25,
): FacadeBand[] {
  const w = grad.mag.width
  const x0 = sil.minX
  const x1 = sil.maxX
  const y0 = sil.topRow
  const y1 = sil.groundRow
  if (x1 <= x0 || y1 <= y0) return []

  const rowScore = new Float64Array(grad.mag.height)
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * w + x
      if (!region.data[i]) continue
      rowScore[y] += Math.abs(grad.gy.data[i])
    }
  }
  let max = 0
  for (let y = y0; y <= y1; y++) if (rowScore[y] > max) max = rowScore[y]
  if (max <= 0) return []

  const samples: { position: number; weight: number }[] = []
  for (let y = y0; y <= y1; y++) if (rowScore[y] >= max * 0.3) samples.push({ position: y, weight: rowScore[y] })
  const clusters = significantClusters(cluster1D(samples, 3), 0.3)

  const bands: FacadeBand[] = []
  for (const c of clusters) {
    const row = Math.round(c.position)
    // Extent: the longest run of columns where this row carries an edge.
    let bestLo = -1
    let bestHi = -2
    let lo = -1
    let gap = 0
    const gapTolerance = Math.max(3, Math.round((x1 - x0) * 0.03))
    for (let x = x0; x <= x1 + 1; x++) {
      let inked = false
      for (let d = -2; d <= 2 && !inked; d++) {
        const y = row + d
        if (y < 0 || y >= grad.mag.height || x > x1) continue
        const i = y * w + x
        if (region.data[i] && Math.abs(grad.gy.data[i]) >= max / Math.max(1, x1 - x0) * 0.5) inked = true
      }
      if (inked) {
        if (lo < 0) lo = x
        gap = 0
      } else if (lo >= 0) {
        gap++
        if (gap > gapTolerance || x > x1) {
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
    if (bestHi <= bestLo) continue
    const coverage = (bestHi - bestLo) / (x1 - x0)
    if (coverage < minCoverage) continue
    bands.push({
      t: toMetres(y1 - row, mpp),
      s0: toMetres(bestLo - x0, mpp),
      s1: toMetres(bestHi - x0, mpp),
      coverage,
      strength: c.weight / max,
    })
  }
  bands.sort((a, b) => b.t - a.t)
  return bands
}

/**
 * Protrusions above the roof silhouette.
 *
 * The roof's own outline is fitted first — from the apex down each slope — and
 * anything standing proud of that fit by more than a threshold, over a narrow
 * run of columns, is a stack. Fitting the roof rather than assuming a shape is
 * what lets the same code work on a gable, a hip or a mono-pitch.
 */
export function detectProtrusions(
  sil: ConditionedSilhouette,
  mpp: number,
  /** Roof pitch in degrees; 0 or null means the view shows a flat-topped roof. */
  pitchDeg: number | null,
): FacadeProtrusion[] {
  const skyline = facadeSkyline(sil)
  const x0 = sil.minX
  const x1 = sil.maxX
  const groundRow = sil.groundRow
  if (x1 - x0 < 16) return []

  // Expected roof outline, from the apex and the roof's own pitch.
  //
  // A running-maximum baseline cannot do this job: a stack standing beside the
  // ridge merges with the ridge into one wide run, and the run is then rejected
  // for being too wide to be a stack. Predicting where the roof *should* be and
  // asking what stands above it separates the two, because the ridge sits on
  // the predicted line and the stack does not.
  const apexRow = sil.topRow
  const apexX = sil.apexX
  const slopePxPerPx = pitchDeg && pitchDeg > 1 ? Math.tan((pitchDeg * Math.PI) / 180) : 0
  const expected = (x: number): number => apexRow + Math.abs(x - apexX) * slopePxPerPx

  const facadeHeight = groundRow - sil.topRow
  const threshold = Math.max(3, facadeHeight * 0.035)
  const out: FacadeProtrusion[] = []
  let runStart = -1
  for (let x = x0; x <= x1 + 1; x++) {
    const y = x <= x1 ? skyline[x] : -1
    const proud = y >= 0 && expected(x) - y > threshold
    if (proud && runStart < 0) runStart = x
    if (!proud && runStart >= 0) {
      const runBegin = runStart
      const runEnd = x - 1
      const widthPx = runEnd - runBegin + 1
      runStart = -1
      if (widthPx < 2 || widthPx > (x1 - x0) * 0.12) continue

      let peakRow = Number.POSITIVE_INFINITY
      for (let xx = runBegin; xx <= runEnd; xx++) {
        if (skyline[xx] >= 0 && skyline[xx] < peakRow) peakRow = skyline[xx]
      }
      if (!Number.isFinite(peakRow)) continue
      const baseRow = expected((runBegin + runEnd) / 2)
      const rise = baseRow - peakRow
      if (rise <= threshold) continue

      out.push({
        s: toMetres((runBegin + runEnd) / 2 - x0, mpp),
        widthM: toMetres(widthPx, mpp),
        heightM: toMetres(rise, mpp),
        topT: toMetres(groundRow - peakRow, mpp),
      })
    }
  }
  return out
}

/**
 * Openings lying on a roof plane rather than on a wall: roof lights.
 *
 * They are separated from wall openings by position — above the eave line the
 * facade shows roof, not wall — and by shape, since a roof light seen
 * orthographically is a small parallelogram.
 */
export function detectRoofOpenings(rects: readonly OpeningRect[], eaveRow: number, mpp: number, sil: ConditionedSilhouette): RoofOpening[] {
  const out: RoofOpening[] = []
  for (const r of rects) {
    if (r.y1 >= eaveRow) continue
    const widthM = toMetres(r.x1 - r.x0, mpp)
    const heightM = toMetres(r.y1 - r.y0, mpp)
    if (widthM < 0.4 || widthM > 2.4 || heightM < 0.3 || heightM > 2.2) continue
    out.push({
      s: toMetres((r.x0 + r.x1) / 2 - sil.minX, mpp),
      t: toMetres(sil.groundRow - (r.y0 + r.y1) / 2, mpp),
      widthM,
      heightM,
    })
  }
  return out
}

export type GableInfill = {
  /** Facade-local extent of the glazed gable area, metres. */
  s0: number
  s1: number
  /** Height of its base and apex above the ground line, metres. */
  t0: number
  t1: number
  /** Fraction of the sampled gable area that reads as glazing. */
  darkFraction: number
}

/**
 * Glazed infill inside a gable.
 *
 * The characteristic move on a house like this is a gable end largely filled
 * with glass above a balcony, and it defeats the rectangle detector for a good
 * reason: the opening's top is cut by the two roof slopes, so it is not a
 * rectangle and has no fourth side to find. It is, however, unmistakable by
 * area — a large connected region inside the gable triangle that is much darker
 * than the wall around it. Measuring that region's extent gives the opening;
 * the roof planes then clip it during tessellation.
 */
export function detectGableInfill(
  gray: GrayImage,
  region: MaskImage,
  sil: ConditionedSilhouette,
  mpp: number,
  bandT: number,
  minDarkFraction = 0.14,
): GableInfill | null {
  if (mpp <= 0) return null
  const w = gray.width
  const x0 = sil.minX
  const x1 = sil.maxX
  const baseRow = Math.round(sil.groundRow - bandT / mpp)
  const apexRow = sil.topRow
  if (baseRow <= apexRow + 4) return null

  // The roof's own fascia runs dark along both rakes and would otherwise be
  // found as one large connected region spanning the gable. Pulling the search
  // area in from the silhouette boundary leaves the wall and its glazing.
  const margin = Math.max(2, Math.round((sil.groundRow - sil.topRow) * 0.035))
  const interior = new Uint8Array(gray.width * gray.height)
  for (let y = apexRow; y <= baseRow; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * w + x
      if (!region.data[i]) continue
      let ok = true
      for (let dy = -margin; dy <= margin && ok; dy++) {
        for (let dx = -margin; dx <= margin && ok; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= gray.width || ny >= gray.height || !region.data[ny * w + nx]) ok = false
        }
      }
      if (ok) interior[i] = 1
    }
  }

  // Facade median brightness, as the reference the infill must be darker than.
  const samples: number[] = []
  for (let y = apexRow; y <= sil.groundRow; y += 2) {
    for (let x = x0; x <= x1; x += 2) {
      const i = y * w + x
      if (region.data[i]) samples.push(gray.data[i])
    }
  }
  if (samples.length < 50) return null
  samples.sort((a, b) => a - b)
  const median = samples[Math.floor(samples.length / 2)]
  const threshold = median - 34

  // Largest connected dark region, not the bounding box of every dark pixel.
  // The gable also contains dark roof edges and shadow; taking their union
  // would stretch the glazing across the whole triangle.
  const w2 = x1 - x0 + 1
  const h2 = baseRow - apexRow + 1
  const darkMask = new Uint8Array(w2 * h2)
  let dark = 0
  let total = 0
  for (let y = apexRow; y <= baseRow; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * w + x
      if (!interior[i]) continue
      total++
      if (gray.data[i] >= threshold) continue
      dark++
      darkMask[(y - apexRow) * w2 + (x - x0)] = 1
    }
  }
  if (total === 0 || dark === 0) return null
  const darkFraction = dark / total

  const label = new Int32Array(w2 * h2).fill(-1)
  const queue = new Int32Array(w2 * h2)
  let bestSize = 0
  let minU = Number.POSITIVE_INFINITY
  let maxU = -1
  let minV = Number.POSITIVE_INFINITY
  let maxV = -1
  let next = 0
  for (let start = 0; start < w2 * h2; start++) {
    if (!darkMask[start] || label[start] >= 0) continue
    const id = next++
    let head = 0
    let tail = 0
    queue[tail++] = start
    label[start] = id
    let size = 0
    let lo = w2
    let hi = -1
    let top = h2
    let bot = -1
    while (head < tail) {
      const i = queue[head++]
      size++
      const x = i % w2
      const y = (i / w2) | 0
      if (x < lo) lo = x
      if (x > hi) hi = x
      if (y < top) top = y
      if (y > bot) bot = y
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= w2 || ny >= h2) continue
        const j = ny * w2 + nx
        if (darkMask[j] && label[j] < 0) {
          label[j] = id
          queue[tail++] = j
        }
      }
    }
    if (size > bestSize) {
      bestSize = size
      minU = lo + x0
      maxU = hi + x0
      minV = top + apexRow
      maxV = bot + apexRow
    }
  }
  if (maxU < 0) return null
  return {
    s0: toMetres(minU - x0, mpp),
    s1: toMetres(maxU - x0, mpp),
    t0: toMetres(sil.groundRow - maxV, mpp),
    t1: toMetres(sil.groundRow - minV, mpp),
    darkFraction,
  }
}

export type FacadeSolveInput = {
  facade: FacadeSide
  assetId: string
  gray: GrayImage
  gradients: Gradients
  silhouette: ConditionedSilhouette
  /** Published building height, which sets the vertical scale. */
  publishedHeightM: number | null
  /** Eave height above the ground line, metres, when the scaffold knows it. */
  eaveHeightM: number | null
  /** Roof pitch, when this facade is a gable end; null for a flat-topped view. */
  roofPitchDeg: number | null
}

export function solveFacadeFeatures(input: FacadeSolveInput): FacadeFeatureSet {
  const notes: string[] = []
  const sil = input.silhouette
  const mpp = input.publishedHeightM && sil.heightPx > 0 ? input.publishedHeightM / sil.heightPx : 0
  if (mpp <= 0) notes.push('no vertical scale: facade features are proportional only')

  const w = input.gray.width
  const region = makeMask(w, input.gray.height)
  for (let y = 0; y < input.gray.height; y++) {
    for (let x = sil.minX; x <= sil.maxX; x++) {
      const i = y * w + x
      region.data[i] = sil.mask.data[i]
    }
  }

  // A denser edge map than the structural one: window frames are real edges but
  // not among the strongest few percent in a rendered image.
  const denseAll = cannyEdges(input.gradients, 0.72, 0.88)
  const dense = makeMask(w, input.gray.height)
  for (let i = 0; i < dense.data.length; i++) dense.data[i] = denseAll.data[i] && region.data[i] ? 1 : 0

  const rects = findOpeningRectangles(
    input.gray,
    input.gradients,
    dense,
    region,
    { x0: sil.minX, x1: sil.maxX, y0: sil.topRow, y1: sil.groundRow },
    { ...DEFAULT_OPENING_DETECT, minBorderSupport: 0.45, maxRows: 22, maxColumns: 26 },
  )

  const bands = mpp > 0 ? detectBands(input.gradients, region, sil, mpp) : []
  const protrusions = mpp > 0 ? detectProtrusions(sil, mpp, input.roofPitchDeg) : []

  // The gable is the part of the facade above the eave; infill is looked for
  // there, based on the highest band that could be its sill.
  const eaveRow2 = 0
  void eaveRow2
  const eaveRow =
    input.eaveHeightM !== null && mpp > 0 ? sil.groundRow - input.eaveHeightM / mpp : sil.topRow + (sil.groundRow - sil.topRow) * 0.45
  const roofOpenings = mpp > 0 ? detectRoofOpenings(rects, eaveRow, mpp, sil) : []
  const wallRects = rects.filter((r) => r.y1 >= eaveRow)

  if (wallRects.length === 0) notes.push('no framed openings found on this facade')
  if (protrusions.length > 0) notes.push(`${protrusions.length} protrusion(s) above the roof silhouette`)

  // The infill's sill is the highest band below the eave, i.e. the balcony or
  // slab line it sits on; without one, the eave itself.
  const sillBand = bands.find((b) => b.t < (input.eaveHeightM ?? Number.POSITIVE_INFINITY) && b.coverage > 0.25)
  const gableInfill =
    sil.apexX > sil.minX && sil.apexX < sil.maxX
      ? detectGableInfill(input.gray, region, sil, mpp, sillBand ? sillBand.t : toMetres(sil.groundRow - eaveRow, mpp))
      : null
  if (gableInfill) {
    notes.push(
      `gable infill spanning ${(gableInfill.s1 - gableInfill.s0).toFixed(2)} m between ` +
        `${gableInfill.t0.toFixed(2)} and ${gableInfill.t1.toFixed(2)} m (${(gableInfill.darkFraction * 100).toFixed(0)}% glazed)`,
    )
  }

  return {
    facade: input.facade,
    assetId: input.assetId,
    gableInfill,
    widthM: toMetres(sil.widthPx, mpp),
    heightM: toMetres(sil.heightPx, mpp),
    bands,
    protrusions,
    roofOpenings,
    openings: wallRects,
    metresPerPixel: mpp,
    groundRow: sil.groundRow,
    minX: sil.minX,
    notes,
  }
}

/** Convert a detected wall rectangle into facade-local metres. */
export const rectToFacade = (
  r: OpeningRect,
  set: FacadeFeatureSet,
): { s: number; sillY: number; widthM: number; heightM: number } => ({
  s: toMetres(r.x0 - set.minX, set.metresPerPixel),
  sillY: toMetres(set.groundRow - r.y1, set.metresPerPixel),
  widthM: toMetres(r.x1 - r.x0, set.metresPerPixel),
  heightM: toMetres(r.y1 - r.y0, set.metresPerPixel),
})
