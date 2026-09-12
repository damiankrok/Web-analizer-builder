/**
 * Building hypothesis construction (§29-§32).
 *
 * Turns the metric scaffold into a source-neutral hypothesis: storeys, masses,
 * a roof per mass, and opening groups. Nothing here reads pixels — feature
 * detectors never mutate geometry directly (§29); they produce observations,
 * and this module turns observations into a candidate the scorer can judge.
 *
 * PORT_DIRECT (Kotlin).
 */
import type { MetricScaffold, ElevationAnalysis } from '../contracts/scaffold.js'
import type {
  AppearanceFeature,
  BuildingHypothesis,
  FacadeSide,
  MassHypothesis,
  MetricConstraint,
  OpeningGroupHypothesis,
  OpeningHypothesis,
  OpeningKind,
  RoofHypothesis,
  StoreyHypothesis,
} from '../contracts/hypotheses.js'
import type { Polygon2D, Vec2 } from '../contracts/geometry.js'
import { boundsOf, polygonArea, rectRing } from '../contracts/geometry.js'
import { mkId } from '../util/ids.js'
import { facadeFrame } from './frames.js'
import { solveFeatures, type FeatureContext } from './features.js'
import type { FacadeFeatureSet } from '../scaffold/facade-features.js'

export type BuilderInputs = {
  scaffold: MetricScaffold
  /** Span the pitched roof covers, metres. */
  gableSpanM: number | null
  /** Which plan axis the section cuts across. */
  sectionAxis: 'X' | 'Z' | null
  publishedRoofFamily: string | null
  publishedGarageAreaM2: number | null
  /** Net floor areas per storey, for the storey constraints. */
  storeyNetAreas: { ground: number | null; upper: number | null }
  notch: { corner: string; widthM: number; depthM: number } | null
  /** Per-facade architectural evidence from the orthographic elevations. */
  facadeFeatures: readonly FacadeFeatureSet[]
  /** Facades whose silhouette shows a gable apex. */
  gableFacades: FacadeSide[]
}

const DEFAULT_OVERHANG_GABLE = 0.6
const DEFAULT_OVERHANG_EAVE = 0.4
const DEFAULT_SLAB_THICKNESS = 0.34

/**
 * Split the footprint into masses.
 *
 * The footprint prior is a rectangle with at most one notched corner, so the
 * decomposition is determined: the full-depth (or full-width) part that the
 * notch does not touch is the main body, and the remainder is the annex. Which
 * of the two axes stays full is fixed by the notch corner.
 */
export function decomposeMasses(
  footprint: Polygon2D,
  notch: BuilderInputs['notch'],
  gableSpanM: number | null,
): { main: { ring: Vec2[]; bounds: ReturnType<typeof boundsOf> }; annex: { ring: Vec2[]; bounds: ReturnType<typeof boundsOf> } | null } {
  const b = boundsOf(footprint.outer)
  if (!notch || notch.widthM <= 0.2 || notch.depthM <= 0.2) {
    return { main: { ring: footprint.outer, bounds: b }, annex: null }
  }
  const notchRight = notch.corner.endsWith('RIGHT')
  const notchTop = notch.corner.startsWith('TOP')

  // The main body keeps the full depth on the side away from the notch.
  const splitX = notchRight ? b.maxX - notch.widthM : b.minX + notch.widthM
  const mainRing = notchRight
    ? rectRing(b.minX, b.minZ, splitX, b.maxZ)
    : rectRing(splitX, b.minZ, b.maxX, b.maxZ)
  const annexRing = notchRight
    ? rectRing(splitX, notchTop ? b.minZ + notch.depthM : b.minZ, b.maxX, notchTop ? b.maxZ : b.maxZ - notch.depthM)
    : rectRing(b.minX, notchTop ? b.minZ + notch.depthM : b.minZ, splitX, notchTop ? b.maxZ : b.maxZ - notch.depthM)

  // A gable span measured off the section is a stronger statement about the
  // main body's width than the notch geometry is, so it wins where they differ.
  // The masses partition the footprint, so whatever the main body gives up the
  // annex takes on — otherwise the published footprint area, which the plan
  // stage already matched exactly, would be quietly lost here.
  let mainAdjusted = mainRing
  let annexAdjusted = annexRing
  if (gableSpanM && gableSpanM > 1) {
    const mb = boundsOf(mainRing)
    const ab = boundsOf(annexRing)
    const current = mb.maxX - mb.minX
    if (Math.abs(current - gableSpanM) > 0.05) {
      const boundary = notchRight ? mb.minX + gableSpanM : mb.maxX - gableSpanM
      mainAdjusted = notchRight
        ? rectRing(mb.minX, mb.minZ, boundary, mb.maxZ)
        : rectRing(boundary, mb.minZ, mb.maxX, mb.maxZ)
      annexAdjusted = notchRight
        ? rectRing(boundary, ab.minZ, ab.maxX, ab.maxZ)
        : rectRing(ab.minX, ab.minZ, boundary, ab.maxZ)
    }
  }
  return {
    main: { ring: mainAdjusted, bounds: boundsOf(mainAdjusted) },
    annex: { ring: annexAdjusted, bounds: boundsOf(annexAdjusted) },
  }
}

/**
 * Height of the topmost roof surface over a plan position, or null where no
 * roof covers it. A gable is interpolated across its own span, which is what
 * lets a stack be placed on the slope rather than at the ridge height.
 */
export function roofHeightAt(
  masses: readonly MassHypothesis[],
  roofs: readonly RoofHypothesis[],
  x: number,
  z: number,
): number | null {
  let best: number | null = null
  for (const roof of roofs) {
    const mass = masses.find((m) => m.id === roof.massId)
    if (!mass) continue
    const b = boundsOf(mass.footprint.outer)
    const oh = roof.overhangM
    if (x < b.minX - oh || x > b.maxX + oh || z < b.minZ - oh || z > b.maxZ + oh) continue
    let y: number
    if (roof.kind === 'FLAT' || roof.kind === 'NONE' || roof.pitchDeg <= 0) {
      y = roof.ridgeY
    } else {
      const alongZ = (roof.ridgeDir?.z ?? 1) !== 0
      const centre = alongZ ? (b.minX + b.maxX) / 2 : (b.minZ + b.maxZ) / 2
      const half = alongZ ? (b.maxX - b.minX) / 2 : (b.maxZ - b.minZ) / 2
      const offset = Math.abs((alongZ ? x : z) - centre)
      const t = half <= 0 ? 0 : Math.min(1, offset / half)
      y = roof.ridgeY - (roof.ridgeY - roof.eaveY) * t
    }
    if (best === null || y > best) best = y
  }
  return best
}

const roofKindOf = (family: string | null): RoofHypothesis['kind'] => {
  switch (family) {
    case 'GABLE':
      return 'GABLE'
    case 'HIP':
      return 'HIP'
    case 'MONO_PITCH':
      return 'MONO_PITCH'
    case 'FLAT':
      return 'FLAT'
    default:
      return 'GABLE'
  }
}

/**
 * Does any elevation perpendicular to `facade` show the silhouette stepping
 * outwards at height `t`? A projecting balcony or canopy is visible as a step
 * in the side views; a recessed one is not.
 */
export function showsProjectionAt(sets: readonly FacadeFeatureSet[], facade: FacadeSide, t: number): boolean {
  const perpendicular: FacadeSide[] =
    facade === 'FRONT' || facade === 'REAR' ? ['LEFT', 'RIGHT'] : ['FRONT', 'REAR']

  // Where along the perpendicular facade does the element's own facade plane
  // sit? Checking that a step exists *somewhere* in the side view is not
  // enough: this building steps at the garage, halfway back, which has nothing
  // to do with whether its front balcony projects.
  const nearEnd = (side: FacadeSide): 'START' | 'END' => {
    if (facade === 'FRONT') return side === 'LEFT' ? 'END' : 'START'
    if (facade === 'REAR') return side === 'LEFT' ? 'START' : 'END'
    if (facade === 'LEFT') return side === 'FRONT' ? 'START' : 'END'
    return side === 'FRONT' ? 'END' : 'START'
  }

  for (const side of perpendicular) {
    const set = sets.find((x) => x.facade === side)
    if (!set || set.widthM <= 0) continue
    const end = nearEnd(side)
    const window = Math.max(1.5, set.widthM * 0.15)
    const lo = end === 'START' ? 0 : set.widthM - window
    const hi = end === 'START' ? window : set.widthM
    const stepping = set.bands.some(
      (b) => Math.abs(b.t - t) < 0.45 && b.coverage < 0.9 && b.coverage > 0.08 && b.s0 < hi && b.s1 > lo,
    )
    if (stepping) return true
  }
  return false
}

export function buildHypothesis(inputs: BuilderInputs): BuildingHypothesis {
  const s = inputs.scaffold
  const notes: string[] = []
  const bounds = boundsOf(s.footprint.outer)
  const { main, annex } = decomposeMasses(s.footprint, inputs.notch, inputs.gableSpanM)

  // --- storeys ---------------------------------------------------------
  const slabLevels = s.levels.filter((l) => l.kind === 'SLAB').sort((a, b) => a.y - b.y)
  const upperFloorY = slabLevels.length > 0 ? slabLevels[slabLevels.length - 1].y : Math.max(2.8, s.eaveY - s.kneeWallM)
  const groundCeilingY = slabLevels.length > 1 ? slabLevels[slabLevels.length - 2].y : upperFloorY - DEFAULT_SLAB_THICKNESS

  const storeys: StoreyHypothesis[] = [
    {
      id: 'storey_ground',
      name: 'GROUND',
      floorY: 0,
      ceilingY: groundCeilingY,
      ...(inputs.storeyNetAreas.ground !== null ? { netAreaM2: inputs.storeyNetAreas.ground } : {}),
      authority: 'SECTION_MEASURED',
    },
  ]
  const hasUpper = s.ridgeY - upperFloorY > 1.5 && inputs.storeyNetAreas.upper !== null
  if (hasUpper) {
    storeys.push({
      id: 'storey_upper',
      name: 'UPPER',
      floorY: upperFloorY,
      ceilingY: s.eaveY,
      ...(inputs.storeyNetAreas.upper !== null ? { netAreaM2: inputs.storeyNetAreas.upper } : {}),
      authority: 'SECTION_MEASURED',
    })
  }

  // --- masses ----------------------------------------------------------
  const masses: MassHypothesis[] = [
    {
      id: 'mass_main',
      kind: 'MAIN_BODY',
      footprint: { outer: main.ring, holes: [] },
      baseY: 0,
      topY: s.eaveY,
      storeyIds: storeys.map((x) => x.id),
      authority: 'PLAN_MEASURED',
      confidence: Math.min(0.9, s.confidence + 0.05),
      evidenceIds: [],
    },
  ]

  // The annex's top comes from the section where a level sits below the eave;
  // otherwise from the published garage headroom plus a slab.
  const annexTopCandidates = s.levels
    .filter((l) => l.kind === 'SLAB' && l.y > 1.8 && l.y < s.eaveY - 0.3)
    .sort((a, b) => a.y - b.y)
  const annexTopY = annexTopCandidates.length > 0 ? annexTopCandidates[0].y + DEFAULT_SLAB_THICKNESS : Math.min(3.2, s.eaveY - 1)

  if (annex) {
    masses.push({
      id: 'mass_annex',
      kind: 'GARAGE',
      footprint: { outer: annex.ring, holes: [] },
      baseY: 0,
      topY: annexTopY,
      storeyIds: ['storey_ground'],
      authority: 'PLAN_MEASURED',
      confidence: Math.min(0.85, s.confidence),
      evidenceIds: [],
    })
  }

  // --- roofs -----------------------------------------------------------
  // The ridge runs perpendicular to the axis the section cuts across, because
  // the section shows the gable triangle only when it cuts across the span.
  const ridgeAlongZ = inputs.sectionAxis !== 'Z'
  const roofs: RoofHypothesis[] = [
    {
      id: 'roof_main',
      massId: 'mass_main',
      kind: roofKindOf(inputs.publishedRoofFamily),
      pitchDeg: s.roofPitchDeg,
      eaveY: s.eaveY,
      ridgeY: s.ridgeY,
      ridgeDir: ridgeAlongZ ? { x: 0, z: 1 } : { x: 1, z: 0 },
      overhangM: DEFAULT_OVERHANG_EAVE,
      authority: 'SECTION_MEASURED',
      confidence: 0.85,
    },
  ]
  if (annex) {
    // §31: solve the roof per mass. A low annex beside a pitched main body is
    // flat-roofed here; applying the main gable to it is the exact mistake the
    // rule exists to prevent.
    roofs.push({
      id: 'roof_annex',
      massId: 'mass_annex',
      kind: 'FLAT',
      pitchDeg: 0,
      eaveY: annexTopY,
      ridgeY: annexTopY,
      overhangM: 0.15,
      authority: 'PLAN_MEASURED',
      confidence: 0.6,
    })
  }

  // --- architectural features -----------------------------------------
  // The elevations carry far more than an outline: slab lines, canopies,
  // balconies, glazed gables, stacks. A model built from the footprint alone
  // is an extrusion, not a building, so these are solved before the openings
  // and can introduce masses of their own (§30).
  const featureCtx: FeatureContext = {
    bounds,
    masses,
    roofs,
    eaveY: s.eaveY,
    ridgeY: s.ridgeY,
    upperFloorY,
    annexTopY,
    gableFacades: inputs.gableFacades,
    wallThicknessM: s.wallThicknessM,
    roofHeightAt: (x, z) => roofHeightAt(masses, roofs, x, z),
    showsProjectionAt: (facade, t) => showsProjectionAt(inputs.facadeFeatures, facade, t),
  }
  const features = solveFeatures(inputs.facadeFeatures, featureCtx)
  notes.push(...features.notes)
  masses.push(...features.masses)
  roofs.push(...features.roofs)
  const appearance: AppearanceFeature[] = [...features.appearance]

  // Apply set-backs. All recesses on one mass are applied together and the
  // mass is split once: two facades each showing a balcony describe one upper
  // storey set back on both sides, not two stacked splits, and applying them in
  // sequence would leave a mass whose base sits above its own top.
  const byMass = new Map<string, typeof features.recesses>()
  for (const recess of features.recesses) {
    const list = byMass.get(recess.massId)
    if (list) list.push(recess)
    else byMass.set(recess.massId, [recess])
  }
  for (const [massId, group] of byMass) {
    const target = masses.find((m) => m.id === massId)
    if (!target) continue
    const splitY = Math.min(...group.map((r) => r.fromY))
    if (splitY <= target.baseY + 0.5 || splitY >= target.topY - 0.5) {
      notes.push(`recess on ${massId} at ${splitY.toFixed(2)} m ignored: it does not fall inside the mass`)
      continue
    }
    let tb = boundsOf(target.footprint.outer)
    for (const recess of group) {
      const d = Math.min(recess.depthM, (recess.facade === 'FRONT' || recess.facade === 'REAR' ? tb.maxZ - tb.minZ : tb.maxX - tb.minX) * 0.35)
      tb =
        recess.facade === 'FRONT'
          ? { ...tb, maxZ: tb.maxZ - d }
          : recess.facade === 'REAR'
            ? { ...tb, minZ: tb.minZ + d }
            : recess.facade === 'LEFT'
              ? { ...tb, minX: tb.minX + d }
              : { ...tb, maxX: tb.maxX - d }
    }
    const upperId = `${target.id}_upper`
    masses.push({
      ...target,
      id: upperId,
      footprint: { outer: rectRing(tb.minX, tb.minZ, tb.maxX, tb.maxZ), holes: [] },
      baseY: splitY,
      topY: target.topY,
      storeyIds: target.storeyIds.slice(1),
      confidence: target.confidence * 0.9,
      evidenceIds: group.map((r) => r.massId),
    })
    target.topY = splitY
    for (const roof of roofs) {
      if (roof.massId === target.id) roof.massId = upperId
    }
    notes.push(
      `main body split at ${splitY.toFixed(2)} m; the storey above is set back on ` +
        group.map((r) => `${r.facade} by ${r.depthM.toFixed(2)} m`).join(' and '),
    )
  }

  // --- openings --------------------------------------------------------
  // Feature-solved groups come from framed rectangles and gable infill; the
  // legacy dark-region path still contributes on facades where the frame
  // detector found nothing, which keeps a poorly lit elevation from silently
  // producing a blank wall.
  const legacy = buildOpenings(s.elevations, bounds, masses, annexTopY)
  const facadesWithFeatures = new Set(features.openingGroups.map((g) => g.facade))
  const groups = [
    ...features.openingGroups,
    ...legacy.groups.filter((g) => !facadesWithFeatures.has(g.facade)),
  ]
  const groupIds = new Set(groups.map((g) => g.id))
  const openings = legacy.openings.filter((o) => o.groupId !== undefined && groupIds.has(o.groupId))

  // --- hard constraints ------------------------------------------------
  const constraints: MetricConstraint[] = []
  const footprintArea = Math.abs(polygonArea(s.footprint.outer))
  if (footprintArea > 0) {
    constraints.push({
      id: 'c_footprint_area',
      key: 'footprint_area',
      description: 'footprint area must stay at the published figure',
      target: footprintArea,
      toleranceAbs: Math.max(0.5, footprintArea * 0.01),
      unit: 'm2',
      authority: 'PUBLISHED_EXACT',
    })
  }
  if (s.buildingHeightM > 0) {
    // The published height is measured from terrain, but every level in the
    // model is quoted against the ±0.00 finished floor, so the target has to be
    // shifted by the plinth before the two are comparable.
    constraints.push({
      id: 'c_building_height',
      key: 'building_height',
      description: 'ridge height above the finished floor, equal to the published height measured from terrain',
      target: s.buildingHeightM + s.plinthY,
      toleranceAbs: 0.2,
      unit: 'm',
      authority: 'PUBLISHED_EXACT',
    })
  }
  if (s.roofPitchDeg > 0) {
    constraints.push({
      id: 'c_roof_pitch',
      key: 'roof_pitch',
      description: 'roof pitch must stay at the published figure',
      target: s.roofPitchDeg,
      toleranceAbs: 1.5,
      unit: 'deg',
      authority: 'PUBLISHED_EXACT',
    })
  }
  if (inputs.publishedGarageAreaM2 && annex) {
    // The published garage figure is usable floor area, measured inside the
    // walls; the mass footprint is the exterior. Comparing them directly reads
    // the wall thickness as an error of several square metres.
    constraints.push({
      id: 'c_garage_area',
      key: 'garage_area',
      description: 'garage floor area inside the walls must stay near the published figure',
      target: inputs.publishedGarageAreaM2,
      toleranceAbs: Math.max(2, inputs.publishedGarageAreaM2 * 0.12),
      unit: 'm2',
      authority: 'PUBLISHED_EXACT',
    })
  }

  return {
    id: mkId('bh', 'base', s.widthM.toFixed(2), s.depthM.toFixed(2), s.ridgeY.toFixed(2)),
    producedBy: 'scaffold',
    wallThicknessM: s.wallThicknessM,
    plinthY: s.plinthY,
    storeys,
    masses,
    roofs,
    openings,
    openingGroups: groups,
    appearance,
    constraints,
    notes,
  }
}

const classifyOpening = (widthM: number, heightM: number, sillY: number, massKind: string): OpeningKind => {
  if (massKind === 'GARAGE' && widthM > 2.0 && sillY < 0.4) return 'GARAGE_GATE'
  if (widthM >= 2.4 && sillY < 0.5) return 'SLIDING_GLAZING'
  if (sillY < 0.35 && heightM > 1.8) return 'DOOR'
  if (sillY > 3.5) return 'GABLE_GLAZING'
  return 'WINDOW'
}

/**
 * Openings from the elevation observations, grouped per facade.
 *
 * The outer polygon of a group is structural and the mullions are secondary
 * (§32), so adjacent observations that share a sill and a head are merged into
 * one group carrying a panel count rather than being kept as separate holes.
 */
export function buildOpenings(
  elevations: readonly ElevationAnalysis[],
  bounds: ReturnType<typeof boundsOf>,
  masses: readonly MassHypothesis[],
  annexTopY: number,
): { openings: OpeningHypothesis[]; groups: OpeningGroupHypothesis[] } {
  const openings: OpeningHypothesis[] = []
  const groups: OpeningGroupHypothesis[] = []

  for (const e of elevations) {
    const side = e.facade as FacadeSide
    const frame = facadeFrame(side, bounds)

    // The elevation measures the facade in its own frame, which includes any
    // roof overhang visible in that view and is scaled by the published height
    // rather than by the model. Mapping those metres straight onto the model's
    // facade puts openings outside the wall. Rescaling by the ratio of the two
    // widths aligns them; when the ratio is implausible the elevation is not
    // describing this facade and its openings are dropped rather than placed
    // somewhere arbitrary.
    const ratio = e.widthM > 0.5 ? frame.widthM / e.widthM : 1
    if (ratio < 0.5 || ratio > 2) continue
    const sorted = [...e.openings]
      .map((o) => ({ ...o, s: o.s * ratio, widthM: o.widthM * ratio }))
      .filter((o) => o.s >= -0.3 && o.s + o.widthM <= frame.widthM + 0.3 && o.widthM > 0.3 && o.heightM > 0.3)
      .map((o) => ({ ...o, s: Math.max(0, Math.min(o.s, frame.widthM - o.widthM)) }))
      .sort((a, b) => a.s - b.s)

    // Which mass a facade opening belongs to: the one whose plan extent covers
    // the opening's position along the facade.
    const massAt = (s: number): MassHypothesis => {
      const p = { x: frame.origin.x + frame.right.x * s, z: frame.origin.z + frame.right.z * s }
      for (const m of masses) {
        const mb = boundsOf(m.footprint.outer)
        if (p.x >= mb.minX - 0.4 && p.x <= mb.maxX + 0.4 && p.z >= mb.minZ - 0.4 && p.z <= mb.maxZ + 0.4) return m
      }
      return masses[0]
    }

    let pending: typeof sorted = []
    const flush = (): void => {
      if (pending.length === 0) return
      const s0 = Math.min(...pending.map((o) => o.s))
      const s1 = Math.max(...pending.map((o) => o.s + o.widthM))
      const sill = Math.min(...pending.map((o) => o.sillY))
      const head = Math.max(...pending.map((o) => o.sillY + o.heightM))
      const mass = massAt((s0 + s1) / 2)
      const kind = classifyOpening(s1 - s0, head - sill, sill, mass.kind)
      const groupId = mkId('opgroup', side, s0.toFixed(2), sill.toFixed(2))
      const memberIds: string[] = []
      for (const o of pending) {
        const id = mkId('opening', side, o.s.toFixed(2), o.sillY.toFixed(2))
        memberIds.push(id)
        openings.push({
          id,
          kind: classifyOpening(o.widthM, o.heightM, o.sillY, mass.kind),
          facade: side,
          massId: mass.id,
          s: o.s,
          sillY: o.sillY,
          widthM: o.widthM,
          heightM: o.heightM,
          authority: 'ELEVATION_MEASURED',
          confidence: o.confidence,
          groupId,
        })
      }
      groups.push({
        id: groupId,
        facade: side,
        massId: mass.id,
        kind,
        memberIds,
        s: s0,
        sillY: sill,
        widthM: s1 - s0,
        heightM: head - sill,
        panelCount: pending.length,
        clippedByRoof: head > annexTopY && mass.kind !== 'GARAGE' && sill > 2.5,
        authority: 'ELEVATION_MEASURED',
        confidence: Math.min(0.85, pending.reduce((a, o) => a + o.confidence, 0) / pending.length + 0.05),
      })
      pending = []
    }

    for (const o of sorted) {
      if (pending.length === 0) {
        pending.push(o)
        continue
      }
      const last = pending[pending.length - 1]
      const gap = o.s - (last.s + last.widthM)
      const sillAligned = Math.abs(o.sillY - last.sillY) < 0.25
      const headAligned = Math.abs(o.sillY + o.heightM - (last.sillY + last.heightM)) < 0.3
      if (gap < 0.35 && sillAligned && headAligned) pending.push(o)
      else {
        flush()
        pending.push(o)
      }
    }
    flush()
  }
  return { openings, groups }
}
