/**
 * The shared per-asset raster pre-processing chain. Every consumer of an image
 * (projection classifier, elevation analysis, render feature extraction, view
 * scoring) starts from this one result, so an asset is analysed once and the
 * derived layers stay consistent between stages.
 *
 * Analysis runs at a bounded resolution (§49) so cost is independent of the
 * publisher's image size, and every downstream coordinate is expressed in this
 * analysis frame.
 *
 * PORT_DIRECT (Kotlin).
 */
import type { GrayImage, MaskImage, RasterImage } from '../contracts/raster.js'
import { makeMask } from '../contracts/raster.js'
import { downscaleGray, downscaleRaster, toGray } from './gray.js'
import { blurGray, cannyEdges, dilate, sobel, type Gradients } from './filters.js'
import { detectSegments, type Segment, DEFAULT_HOUGH, type HoughOptions } from './lines.js'
import { extractBuildingMask, extractInkMask, type BuildingMaskResult } from './mask.js'

export type AssetRaster = {
  /** Downscaled working image; all segment/mask coordinates are in this frame. */
  image: RasterImage
  gray: GrayImage
  gradients: Gradients
  /** Edges over the whole frame. */
  edges: MaskImage
  /** Edges restricted to the building, used for all structural reasoning. */
  buildingEdges: MaskImage
  building: BuildingMaskResult
  /** Segments from `buildingEdges` — background decoration excluded (§19). */
  segments: Segment[]
  /** Segments from the full frame, kept for diagnostics. */
  allSegments: Segment[]
  /** Scale from the original image to the analysis frame. */
  scale: number
}

export type RasterOptions = {
  maxEdge: number
  hough: HoughOptions
  /** Treat the asset as ink-on-paper rather than a rendered photograph. */
  lineDrawing: boolean
  cannyLow: number
  cannyHigh: number
}

export const DEFAULT_RASTER: RasterOptions = {
  maxEdge: 640,
  hough: DEFAULT_HOUGH,
  lineDrawing: false,
  cannyLow: 0.9,
  cannyHigh: 0.96,
}

export function prepareAsset(source: RasterImage, opts: Partial<RasterOptions> = {}): AssetRaster {
  const o = { ...DEFAULT_RASTER, ...opts }
  const image = downscaleRaster(source, o.maxEdge)
  const scale = image.width / source.width
  const gray = downscaleGray(toGray(source), o.maxEdge)
  const gradients = sobel(blurGray(gray))
  const edges = cannyEdges(gradients, o.cannyLow, o.cannyHigh)

  // Line drawings have no photographic background to separate: the ink itself
  // is the subject, and the "building mask" is simply the inked region.
  const building: BuildingMaskResult = o.lineDrawing
    ? { mask: extractInkMask(gray), groundRow: -1, coverage: 0, notes: ['line drawing: ink mask used as building mask'] }
    : extractBuildingMask(image)

  // A little slack around the silhouette keeps the outer contour itself, which
  // is exactly the roofline and mass boundary the solver cares about.
  const region = o.lineDrawing ? null : dilate(building.mask, Math.max(2, Math.round(Math.min(image.width, image.height) / 100)))
  const buildingEdges = makeMask(image.width, image.height)
  for (let i = 0; i < edges.data.length; i++) {
    buildingEdges.data[i] = edges.data[i] && (!region || region.data[i]) ? 1 : 0
  }

  const segments = detectSegments(buildingEdges, gradients, o.hough)
  const allSegments = o.lineDrawing ? segments : detectSegments(edges, gradients, o.hough)

  return { image, gray, gradients, edges, buildingEdges, building, segments, allSegments, scale }
}
