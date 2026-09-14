/**
 * The Marcówki roof features, from the gold fixture — STAGE WEB-PIVOT-05A.
 *
 * Development only. This module turns `research/gold/marcowki-roof-features-v1.json`
 * into three rooflights, two chimney stacks and the upper-slab reconciliation,
 * and it is the only place those coordinates are read. Nothing in the
 * production analyzer imports it.
 *
 * ## The plane frame is measured, not written down
 *
 * A rooflight's `centerUV` is in its host plane's own 2D frame, and that frame
 * is not in the gold file. The gold carries what the drawings say — a position
 * along the ridge in metres, the printed 78/118, and the fact that the unit's
 * lower edge sits at the wall's inner face — and this module converts that to
 * `u` and `v` through the frame the roof compiler emits. So the conversion asks
 * the compiled roof where its plane is, rather than asserting it; move the
 * ridge and the conversion follows, which is what STAGE WEB-PIVOT-05A §14's
 * ninth mutation is about.
 *
 * ## The chimney and its hole are stated twice, on purpose
 *
 * The stack is a `MassSpec` with a plan rectangle. The hole is a
 * `RoofOpeningSpec` in the plane's frame, derived from the same rectangle by
 * projection. Two records, one number, and a compiler that will not invent
 * either from the other: a stack with no hole is emitted as a solid through
 * intact roof and is caught, which is the whole point of the pairing.
 *
 * PORT_DIRECT (Kotlin) — plain data.
 */
import goldJson from '../../../research/gold/marcowki-roof-features-v1.json' with { type: 'json' }
import type { BuildingSpec, MassSpec, Provenance, SlabSpec, SpecStatus } from './architectural.js'
import type { InteriorSpec } from './interior.js'
import { compileRoofs, planeUVofPlanXZ, type RoofOpeningFillSpec, type RoofOpeningSpec, type RoofPlaneFrame } from './roof.js'
import {
  marcowkiFacadeScene,
  type MarcowkiFacadeOptions,
  type MarcowkiScene,
  type MarcowkiSceneExtension,
} from './marcowki-facade-fixture.js'
import type { MarcowkiInteriorOptions } from './marcowki-interior-fixture.js'

export const roofFeaturesGold = goldJson

/** The interior element STAGE WEB-PIVOT-04 used to carry the salon flue. */
export const INTERIOR_CHIMNEY_WALL_ID = 'uw_chimney'

const prov = (locator: string, status: string, source: string, interpretation: string): Provenance => ({
  source: 'research/gold/marcowki-roof-features-v1.json',
  locator,
  interpretation,
  status: status as SpecStatus,
  note: source,
})

export type PlanRectM = { minX: number; maxX: number; minZ: number; maxZ: number }

// --- mutations --------------------------------------------------------------

export type MarcowkiRoofFeatureOptions = {
  /**
   * Emit a rooflight's frame and pane without cutting its hole.
   *
   * The defect a glass rectangle laid on an intact roof is: it renders
   * correctly from every direction and stops every ray that should pass.
   */
  fillWithoutCut?: string
  /** Put a rooflight on the other slope, as a mirrored elevation would. */
  mirrorRooflight?: string
  /** Slide a rooflight along the ridge, over a different room. */
  shiftRooflight?: { id: string; byM: number }
  /** Cut a rooflight's hole smaller than the unit that fills it. */
  shrinkRoofCut?: { id: string; byM: number }
  /** Emit a chimney stack and leave the roof it passes through intact. */
  chimneyWithoutCut?: string
  /** Move a chimney to another place in plan, leaving its hole where it was. */
  moveChimney?: { id: string; deltaX?: number; deltaZ?: number }
  /** Take the upper slab back to the interior gold's outline, wall zone and all. */
  revertSlabFootprint?: boolean
  /** Raise the ridge, which is the only thing that can change the emitted pitch. */
  moveRidgeM?: number
  /** Cut a chimney's hole wider than the stack, leaving daylight around it. */
  growChimneyCut?: { id: string; byM: number }
  /** Leave STAGE WEB-PIVOT-04's flue wall in place beside the new stack. */
  keepInteriorChimneyWall?: boolean
}

// --- the plane frames -------------------------------------------------------

/**
 * The frames of a spec's roof planes, measured off a compile with no openings.
 *
 * Compiling twice is deliberate: the frames used to place the openings are the
 * frames the openings are then cut in, so a placement can never disagree with
 * the plane it is placed on.
 */
export function roofPlaneFrames(spec: BuildingSpec): Map<string, RoofPlaneFrame> {
  const bare = compileRoofs(spec.roofs, spec.levels)
  return new Map(bare.roofs.flatMap((r) => r.planes).map((p) => [p.planeId, p]))
}

const frameOf = (frames: Map<string, RoofPlaneFrame>, planeId: string): RoofPlaneFrame => {
  const f = frames.get(planeId)
  if (!f) throw new Error(`gold names roof plane "${planeId}", which the compiled roof does not have`)
  return f
}

/** The other slope of the same roof, for the mirroring mutation. */
const otherPlaneId = (planeId: string): string =>
  planeId.endsWith(':slope_minus') ? planeId.replace(':slope_minus', ':slope_plus') : planeId.replace(':slope_plus', ':slope_minus')

// --- rooflights -------------------------------------------------------------

type GoldUnit = (typeof goldJson.rooflights.units)[number]

/**
 * One rooflight, placed in its plane's frame.
 *
 * `u` is the drawing's position along the ridge measured from the plane's own
 * z-minimum corner, and `v` puts the unit's lower edge the stated plan distance
 * in from the eave — converted through the plane, so the answer is the slope
 * distance and not the plan one.
 */
export function rooflightOpenings(
  spec: BuildingSpec,
  frames: Map<string, RoofPlaneFrame>,
  opts: MarcowkiRoofFeatureOptions = {},
): { openings: RoofOpeningSpec[]; fills: RoofOpeningFillSpec[] } {
  const g = goldJson.rooflights
  const openings: RoofOpeningSpec[] = []
  const fills: RoofOpeningFillSpec[] = []
  for (const u of g.units as GoldUnit[]) {
    const planeId = opts.mirrorRooflight === u.id ? otherPlaneId(u.planeId) : u.planeId
    const frame = frameOf(frames, planeId)
    // Where the eave corner of this plane is in plan, so "0.45 m in from the
    // eave" becomes a distance up the slope rather than across the ground.
    const lowerEdgeV = g.lowerEdge.planOffsetFromEaveM / Math.cos((frame.pitchDeg * Math.PI) / 180)
    const centreU =
      planeUVofPlanXZ(frame, frame.originM.x, u.centreAlongRidgeM + (opts.shiftRooflight?.id === u.id ? opts.shiftRooflight.byM : 0)).u
    const sizeUV = { u: g.unitSize.widthM, v: g.unitSize.slopeLengthM }
    const shrink = opts.shrinkRoofCut?.id === u.id ? -Math.abs(opts.shrinkRoofCut.byM) : g.cutToleranceM
    if (opts.fillWithoutCut !== u.id) {
      openings.push({
        id: u.id,
        hostRoofId: goldJson.roof.hostRoofId,
        hostPlaneId: planeId,
        centerUV: { u: centreU, v: lowerEdgeV + sizeUV.v / 2 },
        sizeUV,
        kind: 'ROOFLIGHT',
        cutToleranceM: shrink,
        sourceRefs: [u.source, g.unitSize.source, g.lowerEdge.source],
        status: u.status as SpecStatus,
      })
    }
    fills.push({ id: `${u.id}_fill`, openingId: u.id, frameWidthM: g.fill.frameWidthM })
  }
  return { openings, fills }
}

/** The room the attic plan puts under each rooflight, as the gold states it. */
export const rooflightRoomBelow = (): Array<{ id: string; roomId: string; planeId: string }> =>
  (goldJson.rooflights.units as GoldUnit[]).map((u) => ({ id: u.id, roomId: u.roomBelow, planeId: u.planeId }))

// --- chimneys ---------------------------------------------------------------

type GoldStack = (typeof goldJson.chimneys.stacks)[number]

export const chimneyFootprint = (s: GoldStack, opts: MarcowkiRoofFeatureOptions = {}): PlanRectM => {
  const dx = opts.moveChimney?.id === s.id ? (opts.moveChimney.deltaX ?? 0) : 0
  const dz = opts.moveChimney?.id === s.id ? (opts.moveChimney.deltaZ ?? 0) : 0
  return {
    minX: s.footprint.minX + dx,
    maxX: s.footprint.maxX + dx,
    minZ: s.footprint.minZ + dz,
    maxZ: s.footprint.maxZ + dz,
  }
}

export function chimneyMasses(opts: MarcowkiRoofFeatureOptions = {}): MassSpec[] {
  const g = goldJson.chimneys
  return (g.stacks as GoldStack[]).map((s) => ({
    id: s.id,
    kind: 'CHIMNEY' as const,
    footprint: chimneyFootprint(s, opts),
    baseM: g.baseM,
    topM: g.topM,
    ownerStoreyId: 'shell_attic',
    penetratesRoofIds: [...s.penetratesRoofIds],
    provenance: prov(`chimneys.stacks[${s.id}]`, s.status, s.source, `the ${s.serves} flue stack`),
  }))
}

/**
 * The hole each stack passes through, in its plane's frame.
 *
 * Derived from the stack's own plan rectangle by projecting its four corners
 * onto the plane. That projection carries no world assumption of its own: turn
 * the building and the rectangle and the plane turn together, so the hole stays
 * under the stack. The mutation that moves a stack deliberately does **not**
 * move its hole, which is what leaves the solid driven through intact roof.
 */
export function chimneyOpenings(
  frames: Map<string, RoofPlaneFrame>,
  opts: MarcowkiRoofFeatureOptions = {},
): RoofOpeningSpec[] {
  const g = goldJson.chimneys
  const out: RoofOpeningSpec[] = []
  for (const s of g.stacks as GoldStack[]) {
    if (opts.chimneyWithoutCut === s.id) continue
    const frame = frameOf(frames, s.hostPlaneId)
    const f = s.footprint
    const corners = [
      planeUVofPlanXZ(frame, f.minX, f.minZ),
      planeUVofPlanXZ(frame, f.maxX, f.minZ),
      planeUVofPlanXZ(frame, f.maxX, f.maxZ),
      planeUVofPlanXZ(frame, f.minX, f.maxZ),
    ]
    const us = corners.map((c) => c.u)
    const vs = corners.map((c) => c.v)
    const grow = opts.growChimneyCut?.id === s.id ? Math.abs(opts.growChimneyCut.byM) : g.cutToleranceM
    out.push({
      id: `${s.id}_penetration`,
      hostRoofId: s.penetratesRoofIds[0],
      hostPlaneId: s.hostPlaneId,
      centerUV: { u: (Math.min(...us) + Math.max(...us)) / 2, v: (Math.min(...vs) + Math.max(...vs)) / 2 },
      sizeUV: { u: Math.max(...us) - Math.min(...us), v: Math.max(...vs) - Math.min(...vs) },
      kind: 'PENETRATION',
      cutToleranceM: grow,
      sourceRefs: [s.source, g.cutToleranceNote],
      status: s.status as SpecStatus,
    })
  }
  return out
}

// --- the upper slab ---------------------------------------------------------

export const upperSlabGold = goldJson.upperSlab

/** The reconciled structural plate, as the gold resolves it. */
export const resolvedStructuralSlab = (): PlanRectM => ({ ...goldJson.upperSlab.resolution.structural.footprint })

/** The walkable floor: the plate, less the stair void, less what stands on it. */
export const resolvedFinishFloor = (): { outline: PlanRectM; voids: string[]; standingOn: string[] } => ({
  outline: { ...goldJson.upperSlab.resolution.finish.footprint },
  voids: [...goldJson.upperSlab.resolution.finish.voids],
  standingOn: [...goldJson.upperSlab.resolution.finish.standingOn],
})

/** Plan area of the walkable floor, measured from the resolved polygons. */
export function finishFloorAreaM2(stairVoid: PlanRectM, chimneys: readonly PlanRectM[]): number {
  const area = (r: PlanRectM): number => (r.maxX - r.minX) * (r.maxZ - r.minZ)
  const overlap = (a: PlanRectM, b: PlanRectM): number => {
    const dx = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX)
    const dz = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ)
    return dx > 0 && dz > 0 ? dx * dz : 0
  }
  const plate = resolvedStructuralSlab()
  return area(plate) - overlap(plate, stairVoid) - chimneys.reduce((a, c) => a + overlap(plate, c), 0)
}

// --- the assembled scene ----------------------------------------------------

export type MarcowkiGoldOptions = MarcowkiFacadeOptions &
  MarcowkiRoofFeatureOptions & { interior?: MarcowkiInteriorOptions }

/**
 * Add this stage's elements to a building spec.
 *
 * Exported so a test can hand it a spec it built itself and check that nothing
 * here depends on the one the fixture happens to produce.
 */
export function withRoofFeatures(spec: BuildingSpec, opts: MarcowkiRoofFeatureOptions = {}): BuildingSpec {
  const ridged: BuildingSpec = opts.moveRidgeM
    ? {
        ...spec,
        levels: spec.levels.map((l) => (l.kind === 'RIDGE' ? { ...l, elevationM: l.elevationM + opts.moveRidgeM! } : l)),
      }
    : spec
  const frames = roofPlaneFrames(ridged)
  const rl = rooflightOpenings(ridged, frames, opts)
  const slabs: SlabSpec[] = opts.revertSlabFootprint
    ? ridged.slabs.map((s) =>
        s.id === 'slab_upper_floor' ? { ...s, footprint: { ...goldJson.upperSlab.conflict.interiorPolygon } } : s,
      )
    : ridged.slabs
  return {
    ...ridged,
    slabs,
    roofOpenings: [...rl.openings, ...chimneyOpenings(frames, opts)],
    roofOpeningFills: rl.fills,
    masses: chimneyMasses(opts),
  }
}

/**
 * Drop the interior element the chimney mass replaces.
 *
 * STAGE WEB-PIVOT-04 carried the salon flue as an interior wall because that
 * was the only solid it had; this stage gives the same shaft a mass that runs
 * the whole way to the cap. Keeping both would emit one stack twice, so the
 * join is made here and the STAGE WEB-PIVOT-04 gold is left alone.
 */
export const withoutInteriorChimneyWall = (spec: InteriorSpec): InteriorSpec => ({
  ...spec,
  walls: spec.walls.filter((w) => w.id !== INTERIOR_CHIMNEY_WALL_ID),
})

export const roofFeatureExtension = (opts: MarcowkiRoofFeatureOptions = {}): MarcowkiSceneExtension => ({
  building: (s) => withRoofFeatures(s, opts),
  ...(opts.keepInteriorChimneyWall ? {} : { interior: withoutInteriorChimneyWall }),
})

/** The complete gold building: the STAGE WEB-PIVOT-05 scene with the roof finished. */
export function marcowkiGoldScene(opts: MarcowkiGoldOptions = {}): MarcowkiScene {
  return marcowkiFacadeScene({ ...opts, extend: roofFeatureExtension(opts) })
}
