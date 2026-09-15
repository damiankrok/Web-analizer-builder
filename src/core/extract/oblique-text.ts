/**
 * Reading a callout that is not upright — §9, §14.
 *
 * A pitch callout is printed *along the slope it measures*. Project A's says
 * `40°` and it lies at forty degrees to the sheet, which means the Stage-06
 * text finder — which groups glyphs into runs along X or along Y, because that
 * is what a plan's dimension text does — does not see it at all. Measured on
 * A's section it finds fifteen runs and the pitch callout is none of them.
 *
 * The answer is not a general rotated-text detector. It is to keep doing what
 * §9 says and let the geometry go first: once the roof's slopes have been
 * *fitted*, the direction any callout on them is written at is known before
 * anything is looked for. So this module is handed a line, gathers the glyphs
 * lying in a band alongside it, and cuts a crop rotated into that line's frame
 * — upright text for the same engine, through the same seam, with no second
 * recogniser and no new alphabet machinery (§8).
 *
 * That ordering also gives the honest failure mode. If no slope was fitted
 * there is nothing to read a pitch along, which is correct: a number floating
 * near a roof is not a pitch.
 *
 * PORT_DIRECT (Kotlin).
 */
import type { GrayImage } from '../contracts/raster.js'
import type { PixelBox } from '../dimensions/contracts.js'
import { inkComponents, type TextRegionOptions, type GlyphComponent } from './text-regions.js'
import { paperLevel } from './wall-bands.js'

export type ObliqueTextOptions = {
  /** Glyph components are gathered within this many glyph heights of the line. */
  bandHeights: number
  /** …but no closer than this, so the line's own ink is not read as a glyph. */
  clearanceHeights: number
  /** Gap along the line that separates one callout from the next, in glyph heights. */
  clusterGapHeights: number
  /**
   * Components a callout may have.
   *
   * One is allowed, and has to be: project A prints `40°` in an italic face at
   * a size where the `4` touches the `0` and the `0` touches the degree sign,
   * so connected-component analysis returns the whole callout as a single
   * blob. Requiring two would lose it.
   */
  minGlyphs: number
  maxGlyphs: number
  /**
   * How far a cluster's glyphs may drift *across* the line, as a fraction of
   * their height.
   *
   * This is what distinguishes text written along the slope from text that
   * merely passes near it. A level figure printed upright beside a forty-degree
   * roof climbs away from that roof at forty degrees, and its glyphs' offsets
   * from the line spread by their own height over three characters; a callout
   * written along the roof keeps the same offset all the way.
   */
  maxPerpendicularDrift: number
  /** A callout's length over its height, once placed in the line's frame. */
  minAspect: number
  maxAspect: number
  /** Paper margin around the rotated crop, in source pixels. */
  padPx: number
  /** Crop height the sampler enlarges towards. */
  targetCropPx: number
  maxScale: number
}

export const DEFAULT_OBLIQUE_TEXT: ObliqueTextOptions = {
  bandHeights: 5,
  clearanceHeights: 0.2,
  clusterGapHeights: 1.6,
  minGlyphs: 1,
  maxGlyphs: 6,
  maxPerpendicularDrift: 0.35,
  minAspect: 0.6,
  maxAspect: 6,
  padPx: 4,
  targetCropPx: 150,
  maxScale: 10,
}

/** A run of glyphs lying alongside a line, in that line's own frame. */
export type ObliqueCallout = {
  id: string
  /** Centre of the run, in source pixels. */
  centre: { x: number; y: number }
  /** Direction the text runs, radians, measured from the sheet's +X. */
  angleRad: number
  /** Extent along and across that direction, source pixels. */
  lengthPx: number
  heightPx: number
  glyphs: number
  /** Signed perpendicular offset from the line: positive is below it. */
  offsetPx: number
  /** Axis-aligned hull of the glyphs, for the diagnostics. */
  box: PixelBox
}

/**
 * Sample a rectangle of the source rotated into `angleRad`, upright.
 *
 * Bilinear, for the same reason `raster-normalize.ts` enlarges bilinearly: the
 * anti-aliased stroke edges the publisher's renderer produced are what a
 * recogniser keys on, and nearest-neighbour sampling of a rotated glyph
 * replaces them with staircases.
 */
export function obliqueCrop(
  gray: GrayImage,
  centre: { x: number; y: number },
  angleRad: number,
  halfLengthPx: number,
  halfHeightPx: number,
  scale: number,
  paper: number,
): GrayImage {
  const cos = Math.cos(angleRad)
  const sin = Math.sin(angleRad)
  const width = Math.max(1, Math.round(2 * halfLengthPx * scale))
  const height = Math.max(1, Math.round(2 * halfHeightPx * scale))
  const data = new Uint8ClampedArray(width * height).fill(paper)
  for (let j = 0; j < height; j++) {
    const v = (j + 0.5) / scale - halfHeightPx
    for (let i = 0; i < width; i++) {
      const u = (i + 0.5) / scale - halfLengthPx
      const sx = centre.x + u * cos - v * sin
      const sy = centre.y + u * sin + v * cos
      if (sx < 0 || sy < 0 || sx > gray.width - 1 || sy > gray.height - 1) continue
      const x0 = Math.floor(sx)
      const y0 = Math.floor(sy)
      const x1 = Math.min(gray.width - 1, x0 + 1)
      const y1 = Math.min(gray.height - 1, y0 + 1)
      const fx = sx - x0
      const fy = sy - y0
      const top = gray.data[y0 * gray.width + x0] * (1 - fx) + gray.data[y0 * gray.width + x1] * fx
      const bottom = gray.data[y1 * gray.width + x0] * (1 - fx) + gray.data[y1 * gray.width + x1] * fx
      data[j * width + i] = Math.round(top * (1 - fy) + bottom * fy)
    }
  }
  return { width, height, data }
}

/**
 * Callouts lying alongside a fitted line.
 *
 * The line is given as `y = intercept + slope * x` over `fromX..toX`, which is
 * what `section-roof.ts` fits. Glyph components are placed in the line's frame,
 * kept if they sit in the band beside it, and clustered by their position
 * along it.
 */
export function calloutsAlongLine(
  gray: GrayImage,
  line: { slope: number; intercept: number; fromX: number; toX: number },
  regionOpts: TextRegionOptions,
  opts: ObliqueTextOptions = DEFAULT_OBLIQUE_TEXT,
  components?: readonly GlyphComponent[],
): ObliqueCallout[] {
  const parts = components ?? inkComponents(gray, regionOpts)
  const angleRad = Math.atan(line.slope)
  const cos = Math.cos(angleRad)
  const sin = Math.sin(angleRad)
  // A point on the line, used as the frame's origin.
  const ox = (line.fromX + line.toX) / 2
  const oy = line.intercept + line.slope * ox

  const toU = (x: number, y: number): number => (x - ox) * cos + (y - oy) * sin
  const toV = (x: number, y: number): number => -(x - ox) * sin + (y - oy) * cos

  type Placed = { c: GlyphComponent; u: number; v: number; h: number; u0: number; u1: number; v0: number; v1: number }
  const placed: Placed[] = []
  const halfSpan = ((line.toX - line.fromX) / 2) / Math.max(1e-6, cos)
  for (const c of parts) {
    const longer = Math.max(c.width, c.height)
    if (longer < regionOpts.minGlyphPx || longer > regionOpts.maxGlyphPx) continue
    const corners: Array<[number, number]> = [
      [c.box.x0, c.box.y0],
      [c.box.x1, c.box.y0],
      [c.box.x0, c.box.y1],
      [c.box.x1, c.box.y1],
    ]
    const us = corners.map(([x, y]) => toU(x, y))
    const vs = corners.map(([x, y]) => toV(x, y))
    const u0 = Math.min(...us)
    const u1 = Math.max(...us)
    const v0 = Math.min(...vs)
    const v1 = Math.max(...vs)
    const u = (u0 + u1) / 2
    const v = (v0 + v1) / 2
    if (Math.abs(u) > halfSpan) continue
    // Height measured across the line, which is the dimension a line of text
    // does not grow along.
    const h = Math.max(1, v1 - v0)
    if (Math.abs(v) < h * opts.clearanceHeights || Math.abs(v) > h * opts.bandHeights) continue
    placed.push({ c, u, v, h, u0, u1, v0, v1 })
  }
  if (placed.length === 0) return []

  // Cluster along the line, and within a cluster require the glyphs to sit on
  // one side of it: text above a slope and text below it are two callouts.
  placed.sort((a, b) => a.u - b.u)
  const clusters: Placed[][] = []
  for (const p of placed) {
    const last = clusters[clusters.length - 1]
    const prev = last?.[last.length - 1]
    if (
      prev &&
      p.u0 - prev.u1 <= p.h * opts.clusterGapHeights &&
      Math.sign(p.v) === Math.sign(prev.v) &&
      Math.abs(p.v - prev.v) <= p.h * opts.maxPerpendicularDrift
    ) {
      last.push(p)
      continue
    }
    clusters.push([p])
  }

  const out: ObliqueCallout[] = []
  for (const cluster of clusters) {
    if (cluster.length < opts.minGlyphs || cluster.length > opts.maxGlyphs) continue
    const hs = cluster.map((p) => p.h).sort((a, b) => a - b)
    const h = hs[hs.length >> 1]
    const drift = Math.max(...cluster.map((p) => p.v)) - Math.min(...cluster.map((p) => p.v))
    if (drift > h * opts.maxPerpendicularDrift) continue
    const pad = h * 0.25
    const u0 = Math.min(...cluster.map((p) => p.u0)) - pad
    const u1 = Math.max(...cluster.map((p) => p.u1)) + pad
    const v0 = Math.min(...cluster.map((p) => p.v0)) - pad
    const v1 = Math.max(...cluster.map((p) => p.v1)) + pad
    const aspect = (u1 - u0) / Math.max(1e-6, v1 - v0)
    if (aspect < opts.minAspect || aspect > opts.maxAspect) continue
    const cu = (u0 + u1) / 2
    const cv = (v0 + v1) / 2
    const x0 = Math.min(...cluster.map((p) => p.c.box.x0))
    const y0 = Math.min(...cluster.map((p) => p.c.box.y0))
    const x1 = Math.max(...cluster.map((p) => p.c.box.x1))
    const y1 = Math.max(...cluster.map((p) => p.c.box.y1))
    out.push({
      id: `callout${out.length}`,
      centre: { x: ox + cu * cos - cv * sin, y: oy + cu * sin + cv * cos },
      angleRad,
      lengthPx: u1 - u0,
      heightPx: v1 - v0,
      glyphs: cluster.length,
      offsetPx: cv,
      box: { x0, y0, x1, y1 },
    })
  }
  return out
}

/** The crop for one callout, already upright and enlarged. */
export function obliqueCalloutCrop(
  gray: GrayImage,
  callout: ObliqueCallout,
  opts: ObliqueTextOptions = DEFAULT_OBLIQUE_TEXT,
): { gray: GrayImage; scale: number } {
  const paper = paperLevel(gray)
  const halfLength = callout.lengthPx / 2 + opts.padPx
  const halfHeight = callout.heightPx / 2 + opts.padPx
  const scale = Math.min(opts.maxScale, Math.max(1, opts.targetCropPx / Math.max(1, 2 * halfHeight)))
  return {
    gray: obliqueCrop(gray, callout.centre, callout.angleRad, halfLength, halfHeight, scale, paper),
    scale,
  }
}

/**
 * The pitch a callout states, if it states one.
 *
 * A pitch is printed as whole or one-decimal degrees. A reading with no digits
 * in it, or one that would make a roof steeper than a wall, is not a pitch and
 * gets nothing rather than a number.
 */
export function parsePitchText(raw: string): number | null {
  const digits = raw.replace(/[^0-9,.]/g, '').replace(',', '.')
  if (digits === '') return null
  const value = Number(digits)
  if (!Number.isFinite(value) || value <= 0 || value >= 90) return null
  return value
}
