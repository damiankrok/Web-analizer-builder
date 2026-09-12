/**
 * Reading a whole project's printed dimensions (§3, §13).
 *
 * The order across drawings matters as much as the order within one, and for
 * the same reason: recognition has to start somewhere it can be certain.
 *
 * The section is that place. Its vertical scale is fixed by a *published*
 * fact — the building height, terrain to ridge — so every reference line on it
 * has a known height above the datum before anything is read, and the datum
 * marker itself is exactly zero by definition. Its text is also the largest in
 * the package after the resolution upgrade. So the alphabet is learned there,
 * from the glyph positions those predictions determine beyond doubt.
 *
 * The plans come second. Their scale is *not* published — the page gives an
 * area, not a width — so predicting their labels first is what sent an earlier
 * attempt in a circle: a scale calibrated from the area is a few percent out,
 * a few percent leaves a four-digit label with forty candidate values, and
 * templates trained on those confirm whatever they started from. With the
 * section's bank in hand the plans are *read* instead, and their scale falls
 * out of the values read rather than the other way round.
 *
 * PORT_DIRECT (Kotlin).
 */
import type { GrayImage } from '../contracts/raster.js'
import type { RoomFact } from '../contracts/source.js'
import type { PixelBox } from './contracts.js'
import {
  DEFAULT_DIMENSION_GEOMETRY,
  chainFamilies,
  detectDimensionGeometry,
  labelZonesFor,
  refineLinePosition,
  type DetectedLine,
  type DimensionGeometryOptions,
} from './geometry.js'
import { prepareCrop } from './crops.js'
import { segmentGlyphs, DEFAULT_SEGMENT, type TextGlyph } from './recognizer.js'
import {
  buildTemplates,
  classifyRun,
  harvestInvariantPositions,
  integerCandidateStrings,
  DEFAULT_CLASSIFY,
  type ClassifyOptions,
  type LabelledGlyph,
  type TemplateBank,
} from './templates.js'
import { findSectionLevels, DEFAULT_SECTION_LEVELS, type SectionLevelCandidate } from './section-levels.js'

export type ChainLabel = {
  assetId: string
  /** Baseline length in source-native pixels. */
  lengthPx: number
  glyphs: TextGlyph[]
  box: PixelBox
  lineId: string
  segmentIndex: number
  orientation: 'HORIZONTAL' | 'VERTICAL'
  /** Family this label's line belongs to, for closure checks. */
  familyId: string
  /** True when this label is the family's printed total. */
  isTotal: boolean
}

export type AssetDimensionInput = {
  assetId: string
  role: string
  gray: GrayImage
  /** Source-native pixels per metre, when a published fact fixes it. */
  pixelsPerMetre: number | null
  /** How well that scale is known, as a fraction. */
  scaleTolerance: number
}

/**
 * Locate every chain label on one drawing, at source-native resolution.
 *
 * Returns the labels rather than readings: what a label says depends on a
 * template bank that may not exist yet, and on a scale that may depend on the
 * labels themselves.
 */
export function findChainLabels(
  input: AssetDimensionInput,
  slantRad: number,
  opts: DimensionGeometryOptions = DEFAULT_DIMENSION_GEOMETRY,
): { labels: ChainLabel[]; zoneBoxes: PixelBox[]; lines: DetectedLine[]; inkThreshold: number; notes: string[] } {
  const geometry = detectDimensionGeometry(input.gray, opts)
  const families = chainFamilies(geometry.lines)
  const bounds: PixelBox = { x0: 0, y0: 0, x1: input.gray.width - 1, y1: input.gray.height - 1 }
  const labels: ChainLabel[] = []
  const zoneBoxes: PixelBox[] = []
  for (const family of families) {
    const lines = [...family.parts, ...(family.overall ? [family.overall] : [])]
    for (const line of lines) {
      const isTotal = family.overall !== null && line.id === family.overall.id
      for (const zone of labelZonesFor(line, opts, bounds)) {
        zoneBoxes.push(zone.box)
        const { crop, variants } = prepareCrop(input.gray, zone.box, zone.orientation)
        let best: TextGlyph[] = []
        for (const ink of variants) {
          const glyphs = segmentGlyphs(crop, ink, slantRad, DEFAULT_SEGMENT)
          if (glyphs.length < 2 || glyphs.length > 4) continue
          const heights = glyphs.map((g) => g.height)
          if (Math.max(...heights) > Math.min(...heights) * 1.4) continue
          if (glyphs.length > best.length) best = glyphs
        }
        if (best.length === 0) continue
        labels.push({
          assetId: input.assetId,
          lengthPx: zone.lengthPx,
          glyphs: best,
          box: zone.box,
          lineId: line.id,
          segmentIndex: zone.segmentIndex,
          orientation: line.orientation,
          familyId: family.id,
          isTotal,
        })
      }
    }
  }
  return {
    labels,
    zoneBoxes,
    lines: geometry.lines,
    inkThreshold: geometry.inkThreshold,
    notes: [
      ...geometry.notes,
      `${families.length} chain families, ${labels.length} labels carrying a text run`,
    ],
  }
}

export type ProjectDimensionResult = {
  bank: TemplateBank
  /** Readings, keyed by asset then label. */
  readings: Array<{
    assetId: string
    box: PixelBox
    text: string
    /** Metres, once the label's kind and scale are settled. */
    metres: number | null
    lengthPx: number
    /** Pixels per metre this reading implies. */
    impliedPixelsPerMetre: number | null
    confidence: number
    kind: 'CHAIN' | 'LEVEL'
    agreesWithGeometry: boolean
  }>
  levels: SectionLevelCandidate[]
  /** Scale each asset was finally read at. */
  scales: Map<string, number>
  harvested: { positions: number; labels: number; alphabet: string }
  notes: string[]
}

/**
 * Learn the alphabet from a drawing whose scale is published, then read the
 * rest of the package with it.
 */
export function readProjectDimensions(
  assets: readonly AssetDimensionInput[],
  section: {
    input: AssetDimensionInput
    datumRow: number
    /** Reference rows on the section, source-native. */
    lineRows: readonly number[]
  } | null,
  rooms: readonly RoomFact[],
  opts: { classify?: ClassifyOptions; slantRad?: number } = {},
): ProjectDimensionResult {
  const notes: string[] = []
  const classify = opts.classify ?? DEFAULT_CLASSIFY
  const slantRad = opts.slantRad ?? 0.05
  void rooms

  const examples: LabelledGlyph[] = []
  let harvestedLabels = 0
  let harvestedPositions = 0
  let levels: SectionLevelCandidate[] = []

  // --- 1. the section: scale published, datum exact ---------------------
  if (section && section.input.pixelsPerMetre && section.input.pixelsPerMetre > 0) {
    const ppm = section.input.pixelsPerMetre
    levels = findSectionLevels(
      section.input.gray,
      section.datumRow,
      ppm,
      { ...DEFAULT_SECTION_LEVELS, slantRad },
      section.lineRows,
    )
    const levelHarvest = harvestInvariantPositions(
      levels.map((l) => ({ glyphs: l.digitGlyphs, candidates: l.candidates })),
    )
    examples.push(...levelHarvest.examples)
    harvestedLabels += levelHarvest.labelsUsed
    harvestedPositions += levelHarvest.positions
    notes.push(
      `section levels: ${levels.length} markers, ${levelHarvest.positions} certain glyph positions ` +
        `from ${levelHarvest.labelsUsed} markers at ${ppm.toFixed(2)} px/m`,
    )

    // The section's own dimension chains are predictable to a pixel at the
    // published scale, so they supervise too.
    const found = findChainLabels(section.input, slantRad)
    const chainHarvest = harvestInvariantPositions(
      found.labels.map((l) => ({
        glyphs: l.glyphs,
        // Both ends of a chain segment are ticks localised to about a pixel,
        // so its length carries roughly three centimetres of uncertainty
        // whatever the scale is known to.
        candidates: integerCandidateStrings(
          (l.lengthPx / ppm) * 100,
          Math.max(3, ((l.lengthPx / ppm) * 100) * section.input.scaleTolerance),
          l.glyphs.length,
        ),
      })),
    )
    examples.push(...chainHarvest.examples)
    harvestedLabels += chainHarvest.labelsUsed
    harvestedPositions += chainHarvest.positions
    notes.push(
      `section chains: ${found.labels.length} labels, ${chainHarvest.positions} certain glyph positions ` +
        `from ${chainHarvest.labelsUsed} labels`,
    )
  } else notes.push('no section with a published scale: nothing can supervise the alphabet')

  let bank = buildTemplates(examples)
  notes.push(...bank.notes)

  // Grow the bank on the supervising drawing itself before leaving it: a label
  // read correctly is more supervision, and it is verifiable here because the
  // reading has to land inside the band its own geometry predicts. A reading
  // outside that band teaches nothing and is discarded rather than trusted.
  if (section && bank.templates.length > 0) {
    const ppm = section.input.pixelsPerMetre ?? 0
    const sectionLabels = [
      ...levels.map((l) => ({ glyphs: l.digitGlyphs, candidates: l.candidates })),
      ...findChainLabels(section.input, slantRad).labels.map((l) => ({
        glyphs: l.glyphs,
        candidates: integerCandidateStrings((l.lengthPx / ppm) * 100, Math.max(3, 0.01 * (l.lengthPx / ppm) * 100), l.glyphs.length),
      })),
    ]
    for (let round = 0; round < 4; round++) {
      const before = bank.examples
      for (const item of sectionLabels) {
        const read = classifyRun(item.glyphs, bank, classify)
        if (read.text === null) continue
        if (!item.candidates.includes(read.text)) continue
        for (let k = 0; k < read.text.length; k++) examples.push({ glyph: item.glyphs[k], character: read.text[k] })
        harvestedPositions += read.text.length
        harvestedLabels++
      }
      bank = buildTemplates(examples)
      if (bank.examples === before) break
    }
    notes.push(`after growth on the section: ${bank.notes[0]}`)
  }

  // --- 2. the other drawings: read, then derive their scale -------------
  //
  // Several passes, because reading is what grows the bank and a bigger bank
  // reads more: a plan read with twelve examples yields a handful of labels
  // whose agreement with their own baselines is then certain supervision, and
  // the next pass over the same plan reads most of it. The loop stops when a
  // pass adds nothing.
  let readings: ProjectDimensionResult['readings'] = []
  const scales = new Map<string, number>()
  const cached = new Map<string, ReturnType<typeof findChainLabels>>()
  for (let pass = 0; pass < 4; pass++) {
  const before = bank.examples
  readings = []
  for (const asset of assets) {
    if (section && asset.assetId === section.input.assetId) continue
    if (bank.templates.length === 0) break
    let found = cached.get(asset.assetId)
    if (!found) {
      found = findChainLabels(asset, slantRad)
      cached.set(asset.assetId, found)
      notes.push(`${asset.role}: ${found.labels.length} chain labels located`)
    }
    const readLabels = found.labels.map((l) => ({ label: l, read: classifyRun(l.glyphs, bank, classify) }))
    const values = readLabels
      .filter((r) => r.read.text !== null && r.label.lengthPx > 4)
      .map((r) => ({ label: r.label, value: Number(r.read.text), read: r.read }))
      .filter((r) => Number.isFinite(r.value) && r.value > 0)

    // The asset's scale is the consensus of the labels that read: each says
    // "this many pixels is that many centimetres". A label whose implied scale
    // disagrees with the consensus is a misreading and is dropped, not averaged.
    const implied = values.map((v) => (v.label.lengthPx / v.value) * 100).sort((a, b) => a - b)
    let scale = asset.pixelsPerMetre
    if (implied.length >= 2) {
      const median = implied[Math.floor(implied.length / 2)]
      const kept = implied.filter((s) => Math.abs(s - median) <= median * 0.03)
      if (kept.length >= 2) {
        scale = kept.reduce((a, b) => a + b, 0) / kept.length
        if (pass === 0 || kept.length > 2) {
          notes.push(
            `${asset.role} pass ${pass + 1}: ${kept.length} of ${implied.length} read labels agree on ` +
              `${scale.toFixed(2)} px/m` +
              (asset.pixelsPerMetre ? ` (area calibration said ${asset.pixelsPerMetre.toFixed(2)})` : ''),
          )
        }
      }
    }
    if (scale && scale > 0) scales.set(asset.assetId, scale)

    for (const v of values) {
      const impliedPpm = (v.label.lengthPx / v.value) * 100
      const agrees = scale !== null && scale > 0 && Math.abs(impliedPpm - scale) <= scale * 0.03
      readings.push({
        assetId: asset.assetId,
        box: v.label.box,
        text: String(v.value),
        metres: agrees ? v.value / 100 : null,
        lengthPx: v.label.lengthPx,
        impliedPixelsPerMetre: impliedPpm,
        confidence: v.read.confidence.reduce((a, c) => Math.min(a, c), 1),
        kind: 'CHAIN',
        agreesWithGeometry: agrees,
      })
    }

    // Labels that read *and* agree with the settled scale are themselves
    // supervision: they extend the alphabet for the next drawing.
    if (scale && scale > 0) {
      const extra = harvestInvariantPositions(
        found.labels.map((l) => ({
          glyphs: l.glyphs,
          candidates: integerCandidateStrings(
            (l.lengthPx / scale) * 100,
            Math.max(1.5, ((l.lengthPx / scale) * 100) * 0.01),
            l.glyphs.length,
          ),
        })),
      )
      if (extra.positions > 0) {
        examples.push(...extra.examples)
        harvestedLabels += extra.labelsUsed
        harvestedPositions += extra.positions
        bank = buildTemplates(examples)
      }
    }
  }
    if (bank.examples === before) break
  }

  for (const level of levels) {
    const read = classifyRun(level.digitGlyphs, bank, classify)
    if (read.text === null) continue
    const metres = Number(read.text) / 100
    const predicted = level.prediction?.metres ?? null
    const agrees = predicted !== null && Math.abs(Math.abs(predicted) - metres) <= 0.06
    readings.push({
      assetId: section?.input.assetId ?? '',
      box: level.box,
      text: read.text,
      metres: agrees ? (predicted !== null && predicted < 0 ? -metres : metres) : null,
      lengthPx: 0,
      impliedPixelsPerMetre: null,
      confidence: read.confidence.reduce((a, c) => Math.min(a, c), 1),
      kind: 'LEVEL',
      agreesWithGeometry: agrees,
    })
  }

  const alphabet = [...new Set(examples.map((e) => e.character))].sort().join('')
  notes.push(
    `project alphabet {${alphabet}} from ${harvestedPositions} certain positions across ${harvestedLabels} labels; ` +
      `${readings.filter((r) => r.agreesWithGeometry).length} of ${readings.length} readings agree with the geometry`,
  )
  return {
    bank,
    readings,
    levels,
    scales,
    harvested: { positions: harvestedPositions, labels: harvestedLabels, alphabet },
    notes,
  }
}

export { refineLinePosition }
