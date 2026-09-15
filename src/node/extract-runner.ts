/**
 * The Stage-06 extraction pipeline, wired together — §3.
 *
 * Source package in, observations out. The order is the one §3 fixes and §7
 * insists on: choose the drawing by its declared role, normalize the raster,
 * find the dimension structures, find the text, attach text to structure, and
 * only then read. A recogniser is reached through the engine seam, so the
 * pipeline does not know which engine it has.
 *
 * NODE_ONLY, because the only local engine available here is process-backed.
 * Everything it calls is portable core.
 */
import type { RasterImage } from '../core/contracts/raster.js'
import type { ParsedSource } from '../core/contracts/source.js'
import { selectPlanAsset, type PlanStorey } from '../core/dimensions/plan-select.js'
import { inkChannel } from '../core/extract/raster-normalize.js'
import { detectTextRegions, type TextRegion } from '../core/extract/text-regions.js'
import { detectDimensionStructures, type DimensionStructures } from '../core/extract/dimension-structures.js'
import { buildTextCrops } from '../core/extract/text-crops.js'
import { DEFAULT_PLAN_TEXT, type PlanTextEngine } from '../core/extract/text-engine.js'
import {
  buildObservations,
  DEFAULT_OBSERVATIONS,
  type DimensionObservation,
  type ObservationResult,
  type ScaleEstimate,
} from '../core/extract/dimension-observations.js'
import type { PlanTextReading } from '../core/extract/text-engine.js'
import { detectWallBands, DEFAULT_WALL_BANDS, type WallBand } from '../core/extract/wall-bands.js'
import { buildPlanModel, type PlanModel } from '../core/extract/plan-model.js'
import { detectDoorSymbols, pairDoubleDoors, inkLayers, DEFAULT_DOOR_SYMBOLS, type DoorDetection } from '../core/extract/door-symbols.js'
import { alignLabelledPlan, findRoomLabels, type LabelAlignment, type RoomLabel } from '../core/extract/room-labels.js'
import { solidThreshold } from '../core/extract/wall-bands.js'
import { buildSpecCandidate, type ArchitecturalSpecCandidate } from '../core/extract/spec-candidate.js'
import { TesseractEngine } from './ocr/tesseract.js'

export type ExtractionOptions = {
  storeys: readonly PlanStorey[]
  /** Built once and shared, so a process-backed engine starts once. */
  engine: PlanTextEngine | null
  /**
   * How much better a plan's own scale must read than the one the rest of the
   * sheet set settled before it is allowed to keep it.
   *
   * A published sheet set is drawn and published at one size: the ground plan
   * and the attic plan of a project are the same drawing seen twice, at the
   * same pixels per metre. So a plan whose own chains are too few to decide —
   * an attic with three readable vertical labels — should be read at the scale
   * its sibling established rather than at whatever its own handful of labels
   * happens to prefer. A plan that reads *materially* better on its own keeps
   * its own, and the disagreement is reported rather than smoothed over.
   */
  ownScaleMargin: number
}

export const DEFAULT_EXTRACTION: ExtractionOptions = {
  storeys: ['GROUND', 'UPPER_ATTIC'],
  engine: null,
  ownScaleMargin: 0.15,
}

export type PlanExtraction = {
  storey: PlanStorey
  assetId: string
  /** Why this published copy and not another. */
  reason: string
  widthPx: number
  heightPx: number
  regions: TextRegion[]
  structures: DimensionStructures
  observations: DimensionObservation[]
  scales: ScaleEstimate[]
  distortion: ObservationResult['distortion']
  walls: WallBand[]
  /** Every door symbol read off this drawing, before any of it is used (§4). */
  doors: DoorDetection
  /** The area-labelled copy of this floor, and what it was read for (§11, §12). */
  labels: { assetId: string | null; alignment: LabelAlignment | null; found: RoomLabel[] }
  model: PlanModel
  /** Milliseconds spent in each stage of this plan (§20). */
  timings: { doorsMs: number; wallsMs: number; topologyMs: number; labelsMs: number }
  notes: string[]
}

export type ExtractionResult = {
  engine: { id: string; version: string; kind: string }
  plans: PlanExtraction[]
  /** What the drawings propose. A candidate, never canonical (§17). */
  candidate: ArchitecturalSpecCandidate
  /** Scale the project's drawings agreed on, when they did. */
  sheetScale: { pxPerCm: number; score: number; adoptedBy: string[] } | null
  notes: string[]
}

export function extractPlanSpec(
  pkg: ParsedSource,
  images: Map<string, RasterImage>,
  options: ExtractionOptions = DEFAULT_EXTRACTION,
  provenance: { sourcePackageId?: string; sourcePackageHash?: string } = {},
): ExtractionResult {
  const { sourcePackageId, sourcePackageHash } = provenance
  const engine = options.engine ?? new TesseractEngine()
  const notes: string[] = []

  /** Everything read off one drawing, before any scale has been settled. */
  type Prepared = {
    storey: PlanStorey
    assetId: string
    reason: string
    gray: ReturnType<typeof inkChannel>
    regions: TextRegion[]
    structures: DimensionStructures
    readings: PlanTextReading[]
  }

  const prepared: Prepared[] = []
  for (const storey of options.storeys) {
    const selection = selectPlanAsset(pkg.assets, storey)
    if (!selection) {
      notes.push(`${storey}: no floor plan published`)
      continue
    }
    const image = images.get(selection.asset.id)
    if (!image) {
      notes.push(`${storey}: ${selection.asset.id} did not decode`)
      continue
    }
    const gray = inkChannel(image)
    const regions = detectTextRegions(gray)
    const structures = detectDimensionStructures(gray, regions)
    const crops = buildTextCrops(
      gray,
      regions.map((r) => ({ id: r.id, box: r.box, orientation: r.orientation })),
    )
    prepared.push({
      storey,
      assetId: selection.asset.id,
      reason: selection.reason,
      gray,
      regions,
      structures,
      readings: engine.readBatch(crops, DEFAULT_PLAN_TEXT),
    })
  }

  const build = (p: Prepared, scaleOverride: number | null): ObservationResult =>
    buildObservations(p.readings, p.regions, p.structures, { ...DEFAULT_OBSERVATIONS, scaleOverride })

  // --- what each drawing makes of itself, alone
  const alone = new Map<string, ObservationResult>()
  for (const p of prepared) alone.set(p.assetId, build(p, null))

  const scoreOf = (r: ObservationResult): number => r.scales.reduce((n, s) => n + s.score, 0)

  // --- and what the sheet set makes of itself, together
  let sheetScale: ExtractionResult['sheetScale'] = null
  const final = new Map<string, ObservationResult>(alone)
  if (prepared.length > 1) {
    const candidates = [
      ...new Set(
        prepared.flatMap((p) => (alone.get(p.assetId)!.testedScales ?? []).map((t) => t.pxPerCm)),
      ),
    ]
    let best: { pxPerCm: number; score: number; results: Map<string, ObservationResult> } | null = null
    for (const pxPerCm of candidates) {
      const results = new Map<string, ObservationResult>()
      let score = 0
      for (const p of prepared) {
        const r = build(p, pxPerCm)
        results.set(p.assetId, r)
        score += scoreOf(r)
      }
      if (best === null || score > best.score) best = { pxPerCm, score, results }
    }
    if (best) {
      const adoptedBy: string[] = []
      for (const p of prepared) {
        const own = alone.get(p.assetId)!
        const shared = best.results.get(p.assetId)!
        if (scoreOf(own) > scoreOf(shared) * (1 + options.ownScaleMargin)) {
          notes.push(
            `${p.storey} reads ${((scoreOf(own) / Math.max(1e-6, scoreOf(shared)) - 1) * 100).toFixed(0)}% more labels at its own ` +
              `scale than at the set's ${best.pxPerCm.toFixed(5)} px/cm, so it keeps its own; the drawings disagree about their scale`,
          )
          continue
        }
        final.set(p.assetId, shared)
        adoptedBy.push(p.storey)
      }
      sheetScale = { pxPerCm: best.pxPerCm, score: best.score, adoptedBy }
      notes.push(
        `the sheet set settles on ${best.pxPerCm.toFixed(5)} px/cm, adopted by ${adoptedBy.join(' and ') || 'no drawing'}`,
      )
    }
  }

  /** The area-labelled copy of one floor, aligned onto the dimensioned one. */
  const readRoomLabels = (
    p: Prepared,
    scale: number | null,
  ): PlanExtraction['labels'] => {
    const none = { assetId: null, alignment: null, found: [] }
    if (scale === null || scale <= 0) return none
    const sibling = pkg.assets.find(
      (a) =>
        a.roles?.document === 'FLOOR_PLAN' &&
        a.roles.storey === p.storey &&
        a.roles.annotation === 'AREA_LABELS' &&
        a.id !== p.assetId,
    )
    const image = sibling ? images.get(sibling.id) : undefined
    if (!sibling || !image) return none
    const labelled = inkChannel(image)
    if (labelled.width !== p.gray.width || labelled.height !== p.gray.height) {
      return {
        assetId: sibling.id,
        alignment: {
          dx: 0,
          dy: 0,
          agreement: 0,
          aligned: false,
          why: `the two copies of this floor are ${p.gray.width}x${p.gray.height} and ${labelled.width}x${labelled.height}, which cannot be placed over each other by a shift`,
        },
        found: [],
      }
    }
    const solidHere = solidThreshold(p.gray, DEFAULT_WALL_BANDS.solidFraction)
    const solidThere = solidThreshold(labelled, DEFAULT_WALL_BANDS.solidFraction)
    const here = inkLayers(p.gray, solidHere, DEFAULT_DOOR_SYMBOLS)
    const there = inkLayers(labelled, solidThere, DEFAULT_DOOR_SYMBOLS)
    const alignment = alignLabelledPlan(here.fabric, there.fabric, p.gray.width, p.gray.height)
    return {
      assetId: sibling.id,
      alignment,
      found: findRoomLabels(labelled, here.ink, solidThere, alignment, scale),
    }
  }

  const plans: PlanExtraction[] = prepared.map((p) => {
    const built = final.get(p.assetId)!
    // Walls are measured at the scale the chains established, because their
    // thickness has to be tested in metres to mean anything (§11).
    const scale = built.scales.find((s) => s.pxPerCm !== null)?.pxPerCm ?? null
    const t0 = Date.now()
    const walls = detectWallBands(p.gray, scale)
    const t1 = Date.now()
    // §4: the door symbols are read from the drawing, not inferred from what
    // the band detector happened to keep.
    const detected = detectDoorSymbols(p.gray, scale, p.assetId, DEFAULT_WALL_BANDS.solidFraction, undefined, {
      minThicknessM: DEFAULT_WALL_BANDS.minThicknessM,
      maxThicknessM: DEFAULT_WALL_BANDS.maxThicknessM,
    })
    const doors: DoorDetection =
      scale === null ? detected : { ...detected, doors: pairDoubleDoors(detected.doors, scale) }
    const t2 = Date.now()
    // §11, §12: the area-labelled copy of the same floor says how many spaces
    // the source names. It may not move a wall, and it does not: what is done
    // with it is to record, unresolved, that one region carries two names.
    const labels = readRoomLabels(p, scale)
    const t3 = Date.now()
    const model = buildPlanModel(p.gray, walls.bands, scale, undefined, doors.doors, undefined, labels.found)
    const t4 = Date.now()
    return {
      storey: p.storey,
      assetId: p.assetId,
      reason: p.reason,
      widthPx: p.gray.width,
      heightPx: p.gray.height,
      regions: p.regions,
      structures: p.structures,
      observations: built.observations,
      scales: built.scales,
      distortion: built.distortion,
      walls: walls.bands,
      doors,
      labels,
      model,
      timings: { wallsMs: t1 - t0, doorsMs: t2 - t1, labelsMs: t3 - t2, topologyMs: t4 - t3 },
      notes: [
        `${p.regions.length} text-region readings offered`,
        ...p.structures.notes,
        ...built.notes,
        ...walls.notes,
        ...doors.notes,
        labels.alignment
          ? `the area-labelled copy ${labels.assetId}: ${labels.alignment.why}; ${labels.found.length} labels placed`
          : 'this floor publishes no area-labelled copy, so there is no label evidence about its spaces',
        ...model.notes,
      ],
    }
  })

  const candidate = buildSpecCandidate({
    project: pkg.identity.projectCode,
    sourcePackageId: sourcePackageId ?? 'unknown',
    sourcePackageHash: sourcePackageHash ?? 'unknown',
    engine: { id: engine.id, version: engine.version },
    storeys: plans.map((p) => ({
      storey: p.storey,
      assetId: p.assetId,
      pxPerCm: p.scales.find((s) => s.pxPerCm !== null)?.pxPerCm ?? null,
      model: p.model,
      observations: p.observations,
    })),
  })

  return {
    engine: { id: engine.id, version: engine.version, kind: engine.kind },
    plans,
    candidate,
    sheetScale,
    notes,
  }
}
