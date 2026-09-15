/**
 * The candidate, and why it is only ever a candidate — §17, §18, §2.
 *
 * What comes out of an automatic reading of a drawing is a *proposal about* a
 * building, not a building. §17 is explicit that it must not quietly become
 * canonical truth, so the type says so in its name and in a field, every piece
 * of it carries where it came from and how sure the pipeline is, and nothing
 * in this codebase converts one of these into a `BuildingSpec`.
 *
 * Three habits keep that honest rather than decorative.
 *
 * **Faces, not centre lines.** A wall is reported by its two faces, because
 * that is what the drawing shows and what §12 requires; a centre line is
 * offered alongside and is derived.
 *
 * **Openings are not wall.** A run's solid stretches and the gaps between them
 * are separate fields. No length that includes a gap is ever reported as wall,
 * which is what stops a bridged doorway inflating coverage (§21).
 *
 * **Disagreement survives.** Where two observations cannot both be true, the
 * candidate carries a conflict rather than a decision. §2 names the case that
 * matters: a shaft seen on two storeys is two observations, and whether it is
 * one shaft is not something a floor plan can settle. Forcing continuity there
 * is exactly the manual fix the brief forbids, so what is recorded is the
 * ambiguity, with a confidence, and the route is left unresolved.
 *
 * PORT_DIRECT (Kotlin).
 */
import type { DimensionObservation } from './dimension-observations.js'
import type { PlanModel, WallRun, RoomRegion, RoomAdjacency, OpeningClass } from './plan-model.js'

/**
 * The frame a candidate's metres are in.
 *
 * Plan-right is +X and plan-down is +Z, which is how a floor plan is drawn.
 * The origin is the outermost wall faces' corner at the top left of the plan:
 * a corner of the building itself, which needs nothing beyond the walls
 * already read.
 *
 * Each storey gets its own origin in *its own sheet's* pixels, and that is not
 * a detail. A publisher lays each drawing out on its own page, so project A's
 * attic plan sits eleven pixels left and sixty-four pixels above its ground
 * plan; one origin for the set would put every attic room two metres out of
 * place. Aligning each storey on its own outermost corner is what puts them in
 * one building frame — and it assumes the storeys share that corner, which is
 * what a stacked building means and what the candidate says it assumed.
 */
export type CandidateFrame = {
  originPx: { x: number; y: number }
  pxPerCm: number
  axes: 'plan-right is +X, plan-down is +Z, metres'
  note: string
}

export type CandidateProvenance = {
  assetId: string
  /** What in the drawing this was read from. */
  from: string
}

export type CandidateOpening = {
  fromM: number
  toM: number
  widthM: number
  kind: 'DOORWAY' | 'WIDE'
  /**
   * What the drawing says is in the opening. `UNKNOWN_GAP` until evidence
   * moves it, never the other way round (§8).
   */
  class: OpeningClass
  /** The door observation that classified it, when one did. */
  doorId?: string
  classConfidence: number
  why: string
}

export type CandidateWall = {
  id: string
  storey: string
  /** The axis the wall runs along, in the candidate frame. */
  axis: 'X' | 'Z'
  fromM: number
  toM: number
  /** The two faces. §12: the measurement, never converted to an axis. */
  nearM: number
  farM: number
  thicknessM: number
  /** Total length of material. Openings are not included and never are. */
  solidM: number
  openings: CandidateOpening[]
  /** Derived convenience; not a measurement. */
  centreM: number
  confidence: number
  provenance: CandidateProvenance
}

export type CandidateRoom = {
  id: string
  storey: string
  areaM2: number
  box: { x0: number; z0: number; x1: number; z1: number }
  centroid: { x: number; z: number }
  confidence: number
  provenance: CandidateProvenance
}

export type CandidateAdjacency = {
  storey: string
  a: string
  b: string
  wallId: string
  sharedM: number
  doorways: number[]
}

export type CandidateDimension = {
  id: string
  storey: string
  /** The token as printed. */
  text: string
  valueM: number
  /**
   * `SOURCE_EXACT` is a number the drawing prints and this pipeline read.
   * Nothing here is `SOURCE_DERIVED` yet: a value inferred from a chain sum
   * would be, and §9 requires that distinction be kept whichever way it falls.
   */
  status: 'SOURCE_EXACT' | 'SOURCE_DERIVED'
  /** What it measures, when that was established. */
  owner: string
  confidence: number
  provenance: CandidateProvenance
}

export type CandidateConflict = {
  id: string
  kind: string
  /** What was seen, in the words of the thing that saw it. */
  observations: string[]
  /** What cannot be decided from these sources. */
  unresolved: string
  confidence: number
}

export type CandidateStorey = {
  storey: string
  assetId: string
  /** Pixels per centimetre this drawing was read at. */
  pxPerCm: number | null
  /** This drawing's own origin; see `CandidateFrame`. */
  frame: CandidateFrame | null
  walls: CandidateWall[]
  rooms: CandidateRoom[]
  adjacency: CandidateAdjacency[]
  dimensions: CandidateDimension[]
  /** Readings that found no owner, kept as observations and not measurements. */
  unownedReadings: Array<{ text: string; why: string }>
}

export type ArchitecturalSpecCandidate = {
  schemaVersion: 'architectural-spec-candidate-1.0.0'
  kind: 'CANDIDATE'
  /**
   * Read this before using anything below. A candidate is a reading of a
   * drawing, not a statement about a building, and nothing promotes it (§17).
   */
  notCanonical: true
  project: string
  sourcePackageId: string
  sourcePackageHash: string
  engine: { id: string; version: string }
  /** The first storey's frame, for a reader who wants one number. */
  frame: CandidateFrame | null
  storeys: CandidateStorey[]
  conflicts: CandidateConflict[]
  notes: string[]
}

export type CandidateInputs = {
  project: string
  sourcePackageId: string
  sourcePackageHash: string
  engine: { id: string; version: string }
  storeys: Array<{
    storey: string
    assetId: string
    pxPerCm: number | null
    model: PlanModel
    observations: readonly DimensionObservation[]
  }>
}

export type CandidateOptions = {
  /** A region at most this big is a shaft-like void rather than a room. */
  shaftMaxAreaM2: number
  /** How much two storeys' voids must overlap to be worth pairing, 0..1. */
  shaftOverlap: number
}

export const DEFAULT_CANDIDATE: CandidateOptions = {
  shaftMaxAreaM2: 2,
  shaftOverlap: 0.4,
}

/**
 * One storey's origin: its own outermost wall faces.
 *
 * The west face is the smallest near-face among the walls running down the
 * sheet, and the north face the smallest among those running across it. Only
 * faces are used — a wall's *extent* along its own axis is where it starts,
 * not where the building does, and mixing the two lets any stray line that
 * reaches further left move the whole frame.
 */
function frameOf(pxPerCm: number | null, runs: readonly WallRun[]): CandidateFrame | null {
  if (pxPerCm === null || pxPerCm <= 0) return null
  let originX = Infinity
  let originY = Infinity
  for (const run of runs) {
    if (run.axis === 'Y') originX = Math.min(originX, run.nearPx)
    else originY = Math.min(originY, run.nearPx)
  }
  if (!Number.isFinite(originX) || !Number.isFinite(originY)) return null
  return {
    originPx: { x: originX, y: originY },
    pxPerCm,
    axes: 'plan-right is +X, plan-down is +Z, metres',
    note:
      'the origin is this drawing\u2019s own north-west outermost wall faces; the storeys are placed in ' +
      'one building frame by assuming they share that corner, which is what a stacked building means',
  }
}

const runConfidence = (run: WallRun): number => {
  // Long and solid reads better than short and gappy; nothing here is certain.
  const length = run.toPx - run.fromPx
  if (length <= 0) return 0.3
  const solid = run.solid.reduce((n, s) => n + (s.toPx - s.fromPx), 0)
  return Math.max(0.3, Math.min(0.95, 0.4 + 0.55 * (solid / length)))
}

export function buildSpecCandidate(
  inputs: CandidateInputs,
  opts: CandidateOptions = DEFAULT_CANDIDATE,
): ArchitecturalSpecCandidate {
  const notes: string[] = []
  const conflicts: CandidateConflict[] = []
  const storeys: CandidateStorey[] = []
  let sheetFrame: CandidateFrame | null = null

  for (const s of inputs.storeys) {
    const frame = frameOf(s.pxPerCm, s.model.runs)
    sheetFrame ??= frame
    if (!frame) {
      notes.push(`${s.storey}: no scale or no walls, so nothing is reported in metres for it`)
    }
    const toM = (px: number): number => (frame ? px / frame.pxPerCm / 100 : 0)
    const xM = (px: number): number => (frame ? (px - frame.originPx.x) / frame.pxPerCm / 100 : 0)
    const zM = (px: number): number => (frame ? (px - frame.originPx.y) / frame.pxPerCm / 100 : 0)
    const provenance = (from: string): CandidateProvenance => ({ assetId: s.assetId, from })
    const walls: CandidateWall[] = frame
      ? s.model.runs.map((run) => {
          const along = run.axis === 'X' ? xM : zM
          const across = run.axis === 'X' ? zM : xM
          const solidM = run.solid.reduce((n, p) => n + toM(p.toPx - p.fromPx), 0)
          return {
            id: `${s.storey}:${run.id}`,
            storey: s.storey,
            axis: run.axis === 'X' ? 'X' : 'Z',
            fromM: along(run.fromPx),
            toM: along(run.toPx),
            nearM: across(run.nearPx),
            farM: across(run.farPx),
            thicknessM: toM(run.thicknessPx),
            solidM,
            openings: run.openings.map((o) => ({
              fromM: along(o.fromPx),
              toM: along(o.toPx),
              widthM: toM(o.lengthPx),
              kind: o.kind,
              class: o.class,
              ...(o.doorId === undefined ? {} : { doorId: o.doorId }),
              classConfidence: o.classConfidence,
              why: o.why,
            })),
            centreM: across(run.centrePx),
            confidence: runConfidence(run),
            provenance: provenance('a band of solid fabric with two parallel faces'),
          }
        })
      : []

    const areaM2 = (r: RoomRegion): number =>
      frame ? r.areaPx / (100 * frame.pxPerCm) ** 2 : 0
    const rooms: CandidateRoom[] = frame
      ? s.model.rooms.map((r) => ({
          id: `${s.storey}:${r.id}`,
          storey: s.storey,
          areaM2: areaM2(r),
          box: { x0: xM(r.box.x0), z0: zM(r.box.y0), x1: xM(r.box.x1), z1: zM(r.box.y1) },
          centroid: { x: xM(r.centroid.x), z: zM(r.centroid.y) },
          // A region is as sure as its boundary: one that is entirely bounded
          // by walls this pipeline also found is worth more than one leaning
          // on the sheet edge.
          confidence: 0.6,
          provenance: provenance('an enclosed region of the space between the walls'),
        }))
      : []

    const adjacency: CandidateAdjacency[] = s.model.adjacency.map((a: RoomAdjacency) => ({
      storey: s.storey,
      a: `${s.storey}:${a.a}`,
      b: `${s.storey}:${a.b}`,
      wallId: `${s.storey}:${a.wallRunId}`,
      sharedM: toM(a.sharedPx),
      doorways: a.openings.filter((o) => o.kind === 'DOORWAY').map((o) => toM(o.lengthPx)),
    }))

    const dimensions: CandidateDimension[] = s.observations
      .filter((o) => o.owner.kind === 'INTERVAL' && o.valueCm !== null)
      .map((o) => ({
        id: `${s.storey}:${o.id}`,
        storey: s.storey,
        text: o.text,
        valueM: (o.valueCm ?? 0) / 100,
        status: 'SOURCE_EXACT' as const,
        owner:
          o.owner.kind === 'INTERVAL'
            ? `${o.owner.axis} span of ${o.owner.lengthPx.toFixed(1)} px on ${o.owner.baselineId}`
            : '',
        confidence: o.confidence,
        provenance: provenance('a printed chain segment'),
      }))

    const unownedReadings = s.observations
      .filter((o) => o.owner.kind === 'NONE')
      .map((o) => ({ text: o.text, why: o.owner.kind === 'NONE' ? o.owner.why : '' }))

    storeys.push({
      storey: s.storey,
      assetId: s.assetId,
      pxPerCm: s.pxPerCm,
      frame,
      walls,
      rooms,
      adjacency,
      dimensions,
      unownedReadings,
    })
  }

  // --- §2: a void seen on two storeys is two observations, not one shaft
  if (storeys.length > 1) {
    const voidsOf = (s: CandidateStorey): CandidateRoom[] =>
      s.rooms.filter((r) => r.areaM2 <= opts.shaftMaxAreaM2)
    for (let i = 0; i < storeys.length; i++) {
      for (let j = i + 1; j < storeys.length; j++) {
        for (const a of voidsOf(storeys[i])) {
          for (const b of voidsOf(storeys[j])) {
            const ox = Math.min(a.box.x1, b.box.x1) - Math.max(a.box.x0, b.box.x0)
            const oz = Math.min(a.box.z1, b.box.z1) - Math.max(a.box.z0, b.box.z0)
            if (ox <= 0 || oz <= 0) continue
            const overlap = (ox * oz) / Math.min(a.areaM2, b.areaM2)
            if (overlap < opts.shaftOverlap) continue
            conflicts.push({
              id: `cf${conflicts.length}`,
              kind: 'VERTICAL_CONTINUITY_UNRESOLVED',
              observations: [
                `${a.storey} has a ${a.areaM2.toFixed(2)} m² enclosed void at ` +
                  `x ${a.box.x0.toFixed(2)}..${a.box.x1.toFixed(2)}, z ${a.box.z0.toFixed(2)}..${a.box.z1.toFixed(2)}`,
                `${b.storey} has a ${b.areaM2.toFixed(2)} m² enclosed void at ` +
                  `x ${b.box.x0.toFixed(2)}..${b.box.x1.toFixed(2)}, z ${b.box.z0.toFixed(2)}..${b.box.z1.toFixed(2)}`,
              ],
              unresolved:
                'whether these are one shaft running between the storeys or two unrelated voids. A floor ' +
                'plan cannot say: it shows what is cut at one level and nothing about what passes through. ' +
                'Joining them would be asserting a route no source shows, so no route is asserted (§2).',
              confidence: Math.min(0.5, overlap / 2),
            })
          }
        }
      }
    }
    notes.push(
      `${conflicts.length} vertical-continuity questions left open between storeys; none is resolved here`,
    )
  }

  return {
    schemaVersion: 'architectural-spec-candidate-1.0.0',
    kind: 'CANDIDATE',
    notCanonical: true,
    project: inputs.project,
    sourcePackageId: inputs.sourcePackageId,
    sourcePackageHash: inputs.sourcePackageHash,
    engine: inputs.engine,
    frame: sheetFrame,
    storeys,
    conflicts,
    notes,
  }
}
