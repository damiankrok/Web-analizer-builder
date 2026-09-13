/**
 * The printed-dimension stage: one call over a whole source package (§3, §14).
 *
 * Kept separate from the structural pipeline for one reason. Structural
 * analysis runs in a bounded frame — 640 pixels on the long edge, so cost does
 * not depend on the publisher's image size (§49) — and printed text does not
 * survive that. An 11-pixel digit resampled to 8 is unreadable, which is why
 * WEB-01 read nothing at all. This stage therefore works on the source-native
 * rasters and reports its own coordinates in that frame.
 *
 * PORT_DIRECT (Kotlin).
 */
import type { RasterImage } from '../contracts/raster.js'
import type { SourceAsset, ParsedSource } from '../contracts/source.js'
import { toGray, saturationField } from '../raster/gray.js'
import { prepareAsset } from '../raster/pipeline.js'
import { analyseSectionGeometry } from '../scaffold/section.js'
import { wallMask, planExtent, fitFootprint } from '../scaffold/plan.js'
import type { MetricFidelity } from './contracts.js'
import { readProjectDimensions, type AssetDimensionInput, type ProjectDimensionResult } from './project.js'

export type ResolutionAuditRow = {
  assetId: string
  role: string
  /** Size of the copy embedded in the page. */
  pagePx: { width: number; height: number } | null
  /** Size of the copy actually analysed. */
  analysedPx: { width: number; height: number }
  /** Which published variant supplied the pixels. */
  variant: 'PAGE' | 'LIGHTBOX'
  upgraded: boolean
  /** Whether this asset is a source of printed dimensions. */
  usedForText: boolean
}

export type PrintedDimension = {
  id: string
  assetId: string
  role: string
  kind: 'CHAIN_SEGMENT' | 'LEVEL'
  /** The token as read. */
  text: string
  /** Metres, when the reading survived validation. */
  metres: number | null
  fidelity: MetricFidelity
  /** Baseline length the reading was checked against, source-native pixels. */
  lengthPx: number
  box: { x0: number; y0: number; x1: number; y1: number }
  confidence: number
  /** Why the reading was or was not accepted. */
  note: string
}

export type DimensionStageResult = {
  resolution: ResolutionAuditRow[]
  dimensions: PrintedDimension[]
  /** Alphabet the drawings taught the recogniser. */
  alphabet: string
  harvestedPositions: number
  harvestedLabels: number
  /** Scale each drawing was finally read at, source-native px/m. */
  scales: Array<{ assetId: string; role: string; pixelsPerMetre: number }>
  project: ProjectDimensionResult | null
  notes: string[]
}

const TEXT_ROLES = /^(PLAN|SECTION|ELEVATION|SITE)/

export function readSourceDimensions(
  pkg: ParsedSource,
  images: Map<string, RasterImage>,
): DimensionStageResult {
  const notes: string[] = []
  const resolution: ResolutionAuditRow[] = []
  const height = pkg.facts.find((f) => f.key === 'building_height')?.value ?? null
  const area = pkg.facts.find((f) => f.key === 'footprint_area')?.value ?? null

  const inputs: AssetDimensionInput[] = []
  let section: Parameters<typeof readProjectDimensions>[1] = null

  for (const asset of pkg.assets) {
    const img = images.get(asset.id)
    if (!img) continue
    const page = asset.variants?.find((v) => v.kind === 'PAGE')
    const used = asset.variants?.find((v) => v.url === asset.url)
    resolution.push({
      assetId: asset.id,
      role: asset.role,
      pagePx: page?.width && page.height ? { width: page.width, height: page.height } : null,
      analysedPx: { width: img.width, height: img.height },
      variant: used?.kind ?? 'PAGE',
      upgraded: (used?.kind ?? 'PAGE') === 'LIGHTBOX',
      usedForText: TEXT_ROLES.test(asset.role),
    })
    if (!TEXT_ROLES.test(asset.role)) continue

    const gray = toGray(img)
    if (asset.role === 'SECTION' && height) {
      // The section is analysed at its own resolution here: the reference rows
      // its level markers annotate must be known to a pixel, and the bounded
      // structural frame cannot give that.
      const raster = prepareAsset(img, { lineDrawing: true, maxEdge: Math.max(img.width, img.height) })
      const geom = analyseSectionGeometry(raster.segments, gray.width, gray.height, height)
      const input: AssetDimensionInput = {
        assetId: asset.id,
        role: asset.role,
        gray,
        pixelsPerMetre: geom.pixelsPerMetre,
        // The scale rests on a published fact, so it is as good as the row
        // measurements it was derived from.
        scaleTolerance: 0.004,
      }
      inputs.push(input)
      if (geom.groundFloorRow !== null && geom.pixelsPerMetre) {
        section = {
          input,
          datumRow: geom.groundFloorRow,
          lineRows: [
            ...geom.levels.map((l) => l.position),
            ...(geom.terrainRow !== null ? [geom.terrainRow] : []),
            geom.groundFloorRow,
            ...(geom.apex ? [geom.apex.v] : []),
          ].sort((a, b) => a - b),
        }
        notes.push(
          `section read at ${gray.width}x${gray.height} native, ${geom.pixelsPerMetre.toFixed(2)} px/m from the ` +
            `published ${height} m height, ${section.lineRows.length} reference rows`,
        )
      }
      continue
    }

    let ppm: number | null = null
    if (asset.role.startsWith('PLAN')) {
      const extent = planExtent(wallMask(gray, saturationField(img)))
      const fit = fitFootprint(extent, area, null)
      if (fit.widthM > 0) ppm = extent.widthPx / fit.widthM
    }
    inputs.push({ assetId: asset.id, role: asset.role, gray, pixelsPerMetre: ppm, scaleTolerance: 0.08 })
  }

  if (inputs.length === 0) {
    return {
      resolution,
      dimensions: [],
      alphabet: '',
      harvestedPositions: 0,
      harvestedLabels: 0,
      scales: [],
      project: null,
      notes: [...notes, 'no technical drawings to read'],
    }
  }

  const project = readProjectDimensions(inputs, section, pkg.rooms)
  notes.push(...project.notes)

  const roleOf = new Map(pkg.assets.map((a: SourceAsset) => [a.id, a.role]))
  const dimensions: PrintedDimension[] = project.readings.map((r, i) => ({
    id: `pdim_${i}`,
    assetId: r.assetId,
    role: roleOf.get(r.assetId) ?? 'UNKNOWN_ASSET',
    kind: r.kind === 'LEVEL' ? 'LEVEL' : 'CHAIN_SEGMENT',
    text: r.text,
    metres: r.metres,
    // A reading only counts as an exact printed dimension when it also agrees
    // with the geometry it annotates. Agreement is two independent sources
    // saying the same thing, which is what separates `SOURCE_CORROBORATED`
    // from a plausible-looking token (§14).
    fidelity: r.agreesWithGeometry ? 'SOURCE_CORROBORATED' : 'UNRESOLVED',
    lengthPx: r.lengthPx,
    box: r.box,
    confidence: r.confidence,
    note: r.agreesWithGeometry
      ? r.kind === 'LEVEL'
        ? 'read, and within tolerance of the level row it annotates'
        : `read, and its ${r.impliedPixelsPerMetre?.toFixed(1)} px/m matches the drawing's settled scale`
      : r.kind === 'LEVEL'
        ? 'read, but outside tolerance of the level row it annotates; not accepted'
        : `read, but implies ${r.impliedPixelsPerMetre?.toFixed(1)} px/m against the drawing's settled scale; not accepted`,
  }))

  const upgraded = resolution.filter((r) => r.upgraded).length
  notes.push(
    `${upgraded} of ${resolution.length} assets analysed from a higher-resolution published variant; ` +
      `${dimensions.filter((d) => d.fidelity === 'SOURCE_CORROBORATED').length} printed dimensions accepted ` +
      `of ${dimensions.length} read`,
  )

  return {
    resolution,
    dimensions,
    alphabet: project.harvested.alphabet,
    harvestedPositions: project.harvested.positions,
    harvestedLabels: project.harvested.labels,
    scales: [...project.scales.entries()].map(([assetId, pixelsPerMetre]) => ({
      assetId,
      role: roleOf.get(assetId) ?? 'UNKNOWN_ASSET',
      pixelsPerMetre,
    })),
    project,
    notes,
  }
}
