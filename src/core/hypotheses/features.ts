/**
 * Turning facade evidence into building elements (§30, §32, §37).
 *
 * The rule throughout: an element is created only where a source shows it, and
 * the dimension a source does not give is taken from a stated default that the
 * repair loop may later move (§33). Nothing is positioned by hand.
 *
 * PORT_DIRECT (Kotlin).
 */
import type {
  AppearanceFeature,
  FacadeSide,
  MassHypothesis,
  OpeningGroupHypothesis,
  OpeningHypothesis,
  RoofHypothesis,
} from '../contracts/hypotheses.js'
import type { FacadeFeatureSet } from '../scaffold/facade-features.js'
import { rectToFacade } from '../scaffold/facade-features.js'
import { boundsOf, rectRing } from '../contracts/geometry.js'
import { mkId } from '../util/ids.js'
import { facadeFrame, facadePlanPoint } from './frames.js'

export type FeatureContext = {
  bounds: ReturnType<typeof boundsOf>
  masses: MassHypothesis[]
  roofs: RoofHypothesis[]
  eaveY: number
  ridgeY: number
  upperFloorY: number
  annexTopY: number
  /** Facade that shows the gable, from the silhouette's apex. */
  gableFacades: FacadeSide[]
  wallThicknessM: number
  /**
   * Height of the roof surface at a plan position, or null off the roof.
   * Anything detected standing on the roof is snapped to it; a stack floating
   * beside the building is not a stack, and a facade alone cannot tell the
   * difference because it has no depth.
   */
  roofHeightAt: (x: number, z: number) => number | null
  /**
   * Whether any elevation perpendicular to `facade` shows the silhouette
   * stepping outwards at height `t`. This is the cross-source test that tells a
   * projecting element from a recessed one; a single facade cannot.
   */
  showsProjectionAt: (facade: FacadeSide, t: number) => boolean
}

/** Default projection for an element whose depth no source dimensions. */
const DEFAULT_CANOPY_DEPTH_M = 1.5
const DEFAULT_BALCONY_DEPTH_M = 1.4
const RAILING_HEIGHT_M = 1.05
const BAND_HEIGHT_M = 0.22
/** A band is assigned to a level it sits within this distance of. */
const LEVEL_TOLERANCE_M = 0.8
/** Minimum rise for a roof protrusion to count as a stack. */
const MIN_STACK_RISE_M = 0.5
/** How far a detected stack base may sit from the roof surface and still snap. */
const MAX_STACK_SNAP_M = 0.6

/**
 * A storey set back behind the one below it, which is what creates a balcony
 * when the facade shows a slab line but the perpendicular views show nothing
 * projecting.
 */
export type MassRecess = {
  massId: string
  facade: FacadeSide
  /** How far the upper part is set back, metres. */
  depthM: number
  /** Level above which the set-back applies. */
  fromY: number
  /** Facade-local extent of the recess. */
  s0: number
  s1: number
}

export type FeatureResult = {
  masses: MassHypothesis[]
  roofs: RoofHypothesis[]
  appearance: AppearanceFeature[]
  openingGroups: OpeningGroupHypothesis[]
  openings: OpeningHypothesis[]
  recesses: MassRecess[]
  notes: string[]
}

/**
 * Rescale a facade measurement onto the model's facade. An elevation is scaled
 * by the published height and includes whatever overhang that view shows, so
 * its horizontal metres are not the model's until this ratio is applied.
 */
const scaleFor = (set: FacadeFeatureSet, frameWidth: number): number =>
  set.widthM > 0.5 ? frameWidth / set.widthM : 1

export function solveFeatures(sets: readonly FacadeFeatureSet[], ctx: FeatureContext): FeatureResult {
  const masses: MassHypothesis[] = []
  const roofs: RoofHypothesis[] = []
  const appearance: AppearanceFeature[] = []
  const openingGroups: OpeningGroupHypothesis[] = []
  const openings: OpeningHypothesis[] = []
  const recesses: MassRecess[] = []
  const notes: string[] = []

  for (const set of sets) {
    const frame = facadeFrame(set.facade, ctx.bounds)
    const k = scaleFor(set, frame.widthM)
    if (k < 0.5 || k > 2) {
      notes.push(`${set.facade}: elevation width ${set.widthM.toFixed(2)} m does not match the model facade; features skipped`)
      continue
    }
    const isGable = ctx.gableFacades.includes(set.facade)

    // --- bands, canopies and balconies ---------------------------------
    for (const band of set.bands) {
      // Bands at the very foot or at roof level are the plinth and the eave;
      // both are already represented by the masses and the roof.
      if (band.t < 0.5 || band.t > ctx.eaveY - 0.2) continue
      const s0 = band.s0 * k
      const s1 = band.s1 * k
      const widthM = s1 - s0
      if (widthM < frame.widthM * 0.15) continue

      // Which mass sits under the band's midpoint? A band that runs past that
      // mass's own extent is carried by something projecting — a canopy over an
      // entrance, or a balcony slab — rather than being a line on the wall.
      const mid = facadePlanPoint(frame, (s0 + s1) / 2)
      const host = ctx.masses.find((m) => {
        const b = boundsOf(m.footprint.outer)
        return mid.x >= b.minX - 0.5 && mid.x <= b.maxX + 0.5 && mid.z >= b.minZ - 0.5 && mid.z <= b.maxZ + 0.5
      })
      const hostTop = host?.topY ?? ctx.annexTopY
      const nearHostTop = Math.abs(band.t - hostTop) < 0.6

      if (nearHostTop && host && host.kind !== 'MAIN_BODY') {
        // The band is simply that mass's own roof edge.
        appearance.push({
          id: mkId('feat', 'band', set.facade, band.t.toFixed(2)),
          kind: 'BAND',
          facade: set.facade,
          massId: host.id,
          s: s0,
          t: band.t,
          widthM,
          heightM: BAND_HEIGHT_M,
          authority: 'ELEVATION_MEASURED',
          confidence: Math.min(0.8, 0.4 + band.coverage * 0.5),
        })
        continue
      }

      // Which level does the band belong to? A balcony slab sits at a floor
      // level; a canopy continues an annex roof. Testing against the levels the
      // section already established is what separates them — both are simply
      // "a horizontal line partway up the facade" to a line detector.
      // A band can be within tolerance of two levels at once; it belongs to
      // whichever it is closer to, otherwise a canopy at the garage roof line
      // gets built as a balcony one storey up.
      const toFloor = Math.abs(band.t - ctx.upperFloorY)
      const toAnnex = Math.abs(band.t - ctx.annexTopY)
      const atFloorLevel = toFloor < LEVEL_TOLERANCE_M && toFloor <= toAnnex
      const atAnnexLevel = toAnnex < LEVEL_TOLERANCE_M && toAnnex < toFloor
      if (isGable && atFloorLevel && !nearHostTop) {
        // A band at upper-floor level across a gable facade, with glazing above
        // it, is a balcony. Whether it projects or is carved into the storey
        // above is decided by the *perpendicular* elevations: a projecting
        // balcony shows as a step in their silhouettes, a recessed one does
        // not. This house's side elevations are flat there, so the storey is
        // set back — and modelling it as a projection instead would put a slab
        // floating outside the building, which is what a single facade,
        // read on its own, would have concluded.
        const target = ctx.masses.find((m) => m.kind === 'MAIN_BODY') ?? ctx.masses[0]
        if (!target) continue
        const projects = ctx.showsProjectionAt(set.facade, band.t)
        if (projects) {
          const slabId = mkId('mass', 'balcony', set.facade, band.t.toFixed(2))
          masses.push({
            id: slabId,
            kind: 'BALCONY_SLAB',
            footprint: { outer: slabRing(frame, s0, s1, DEFAULT_BALCONY_DEPTH_M, ctx), holes: [] },
            baseY: band.t - 0.22,
            topY: band.t,
            storeyIds: [],
            authority: 'ELEVATION_MEASURED',
            confidence: Math.min(0.7, 0.35 + band.coverage * 0.5),
            evidenceIds: [set.assetId],
          })
          roofs.push({
            id: `${slabId}_top`,
            massId: slabId,
            kind: 'NONE',
            pitchDeg: 0,
            eaveY: band.t,
            ridgeY: band.t,
            overhangM: 0,
            authority: 'ELEVATION_MEASURED',
            confidence: 0.5,
          })
          notes.push(
            `${set.facade}: projecting balcony at ${band.t.toFixed(2)} m spanning ${widthM.toFixed(2)} m; ` +
              'a perpendicular elevation shows the step',
          )
        } else {
          recesses.push({
            massId: target.id,
            facade: set.facade,
            depthM: DEFAULT_BALCONY_DEPTH_M,
            fromY: band.t,
            s0,
            s1,
          })
          notes.push(
            `${set.facade}: storey above ${band.t.toFixed(2)} m set back ${DEFAULT_BALCONY_DEPTH_M.toFixed(2)} m to form a ` +
              `balcony ${widthM.toFixed(2)} m wide; the perpendicular elevations show nothing projecting there`,
          )
        }
        appearance.push({
          id: mkId('feat', 'railing', set.facade, band.t.toFixed(2)),
          kind: 'RAILING',
          facade: set.facade,
          s: s0,
          t: band.t,
          widthM,
          heightM: RAILING_HEIGHT_M,
          authority: 'ELEVATION_MEASURED',
          confidence: 0.55,
        })
        continue
      }

      // Otherwise: a canopy, if it sits at the annex's roof level and reaches
      // materially beyond the mass below it.
      const hostBounds = host ? boundsOf(host.footprint.outer) : null
      const hostWidth = hostBounds
        ? set.facade === 'FRONT' || set.facade === 'REAR'
          ? hostBounds.maxX - hostBounds.minX
          : hostBounds.maxZ - hostBounds.minZ
        : 0
      if (atAnnexLevel && widthM > hostWidth * 1.25 && band.t < ctx.eaveY - 0.5) {
        const canopyId = mkId('mass', 'canopy', set.facade, band.t.toFixed(2))
        masses.push({
          id: canopyId,
          kind: 'CANOPY',
          footprint: { outer: slabRing(frame, s0, s1, DEFAULT_CANOPY_DEPTH_M, ctx), holes: [] },
          baseY: band.t - 0.25,
          topY: band.t,
          storeyIds: [],
          authority: 'ELEVATION_MEASURED',
          confidence: Math.min(0.65, 0.3 + band.coverage * 0.5),
          evidenceIds: [set.assetId],
        })
        roofs.push({
          id: `${canopyId}_top`,
          massId: canopyId,
          kind: 'NONE',
          pitchDeg: 0,
          eaveY: band.t,
          ridgeY: band.t,
          overhangM: 0,
          authority: 'ELEVATION_MEASURED',
          confidence: 0.5,
        })
        notes.push(
          `${set.facade}: canopy at ${band.t.toFixed(2)} m spanning ${widthM.toFixed(2)} m, ` +
            `which reaches past the ${hostWidth.toFixed(2)} m mass below it`,
        )
      } else {
        appearance.push({
          id: mkId('feat', 'band', set.facade, band.t.toFixed(2)),
          kind: 'BAND',
          facade: set.facade,
          s: s0,
          t: band.t,
          widthM,
          heightM: BAND_HEIGHT_M,
          authority: 'ELEVATION_MEASURED',
          confidence: Math.min(0.75, 0.35 + band.coverage * 0.5),
        })
      }
    }

    // --- gable infill ---------------------------------------------------
    if (set.gableInfill && isGable) {
      const g = set.gableInfill
      const s0 = g.s0 * k
      const widthM = (g.s1 - g.s0) * k
      const id = mkId('opgroup', 'gable', set.facade)
      openingGroups.push({
        id,
        facade: set.facade,
        massId: ctx.masses[0]?.id ?? 'mass_main',
        kind: 'GABLE_GLAZING',
        memberIds: [],
        s: s0,
        sillY: g.t0,
        widthM,
        heightM: Math.max(0.6, g.t1 - g.t0),
        panelCount: Math.max(2, Math.round(widthM / 1.1)),
        // The roof planes cut this opening's head, which is exactly why the
        // rectangle detector could not see it (§32 sloped/gable clipping).
        clippedByRoof: true,
        authority: 'ELEVATION_MEASURED',
        confidence: Math.min(0.75, 0.35 + g.darkFraction),
      })
    }

    // --- framed wall openings -------------------------------------------
    for (const rect of set.openings) {
      const f = rectToFacade(rect, set)
      const s = f.s * k
      const widthM = f.widthM * k
      if (widthM < 0.4 || f.heightM < 0.4) continue
      if (s < -0.3 || s + widthM > frame.widthM + 0.3) continue
      const id = mkId('opgroup', set.facade, s.toFixed(2), f.sillY.toFixed(2))
      const host = ctx.masses.find((m) => {
        const b = boundsOf(m.footprint.outer)
        const p = facadePlanPoint(frame, s + widthM / 2)
        return p.x >= b.minX - 0.5 && p.x <= b.maxX + 0.5 && p.z >= b.minZ - 0.5 && p.z <= b.maxZ + 0.5
      })
      const kind = classify(widthM, f.heightM, f.sillY, host?.kind ?? 'MAIN_BODY')
      openingGroups.push({
        id,
        facade: set.facade,
        massId: host?.id ?? ctx.masses[0]?.id ?? 'mass_main',
        kind,
        memberIds: [],
        s: Math.max(0, Math.min(s, frame.widthM - widthM)),
        sillY: Math.max(0, f.sillY),
        widthM,
        heightM: f.heightM,
        panelCount: Math.max(1, Math.round(widthM / 1.2)),
        clippedByRoof: false,
        authority: 'ELEVATION_MEASURED',
        confidence: Math.min(0.85, rect.score),
      })
    }

    // --- roof lights ------------------------------------------------------
    for (const ro of set.roofOpenings) {
      appearance.push({
        id: mkId('feat', 'rooflight', set.facade, ro.s.toFixed(2)),
        kind: 'BAND',
        facade: set.facade,
        s: ro.s * k - (ro.widthM * k) / 2,
        t: ro.t,
        widthM: ro.widthM * k,
        heightM: ro.heightM,
        authority: 'ELEVATION_MEASURED',
        confidence: 0.4,
      })
    }

    // --- chimneys ---------------------------------------------------------
    for (const p of set.protrusions) {
      if (p.heightM < MIN_STACK_RISE_M) continue
      const s = p.s * k
      const plan = facadePlanPoint(frame, s)
      // The facade gives the stack's position across the building but nothing
      // about its depth, so it is placed on the ridge line, which is where a
      // flue emerges on a pitched roof.
      const world = isGable
        ? { x: plan.x, y: 0, z: (ctx.bounds.minZ + ctx.bounds.maxZ) / 2 }
        : { x: (ctx.bounds.minX + ctx.bounds.maxX) / 2, y: 0, z: plan.z }
      const roofY = ctx.roofHeightAt(world.x, world.z)
      if (roofY === null) {
        notes.push(`${set.facade}: protrusion at s=${p.s.toFixed(2)} m is not above any roof; discarded`)
        continue
      }
      const detectedBase = p.topT - p.heightM
      if (Math.abs(detectedBase - roofY) > MAX_STACK_SNAP_M) {
        notes.push(
          `${set.facade}: protrusion at s=${p.s.toFixed(2)} m has its base ${detectedBase.toFixed(2)} m ` +
            `against a roof surface at ${roofY.toFixed(2)} m; treated as a mass step, not a stack`,
        )
        continue
      }
      appearance.push({
        id: mkId('feat', 'chimney', set.facade, p.s.toFixed(2)),
        kind: 'CHIMNEY',
        world: { ...world, y: roofY },
        widthM: Math.max(0.4, Math.min(1.2, p.widthM * k)),
        heightM: Math.max(MIN_STACK_RISE_M, p.topT - roofY),
        authority: 'ELEVATION_MEASURED',
        confidence: 0.5,
      })
    }
  }

  return { masses, roofs, appearance, openingGroups, openings, recesses, notes }
}

const classify = (widthM: number, heightM: number, sillY: number, massKind: string): OpeningGroupHypothesis['kind'] => {
  if (massKind === 'GARAGE' && widthM > 2.0 && sillY < 0.5) return 'GARAGE_GATE'
  if (widthM >= 2.4 && sillY < 0.6) return 'SLIDING_GLAZING'
  if (sillY < 0.4 && heightM > 1.8) return 'DOOR'
  return 'WINDOW'
}

/** Plan ring of a slab projecting outwards from a facade. */
function slabRing(
  frame: ReturnType<typeof facadeFrame>,
  s0: number,
  s1: number,
  depth: number,
  ctx: FeatureContext,
): ReturnType<typeof rectRing> {
  const a = facadePlanPoint(frame, s0)
  const b = facadePlanPoint(frame, s1)
  const n = frame.normal
  const outA = { x: a.x + n.x * depth, z: a.z + n.z * depth }
  const outB = { x: b.x + n.x * depth, z: b.z + n.z * depth }
  const minX = Math.min(a.x, b.x, outA.x, outB.x)
  const maxX = Math.max(a.x, b.x, outA.x, outB.x)
  const minZ = Math.min(a.z, b.z, outA.z, outB.z)
  const maxZ = Math.max(a.z, b.z, outA.z, outB.z)
  void ctx
  return rectRing(minX, minZ, maxX, maxZ)
}
