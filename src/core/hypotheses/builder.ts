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
  let mainAdjusted = mainRing
  if (gableSpanM && gableSpanM > 1) {
    const mb = boundsOf(mainRing)
    const current = mb.maxX - mb.minX
    if (Math.abs(current - gableSpanM) > 0.05) {
      mainAdjusted = notchRight
        ? rectRing(mb.minX, mb.minZ, mb.minX + gableSpanM, mb.maxZ)
        : rectRing(mb.maxX - gableSpanM, mb.minZ, mb.maxX, mb.maxZ)
    }
  }
  return {
    main: { ring: mainAdjusted, bounds: boundsOf(mainAdjusted) },
    annex: { ring: annexRing, bounds: boundsOf(annexRing) },
  }
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

export function buildHypothesis(inputs: BuilderInputs): BuildingHypothesis {
  const s = inputs.scaffold
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

  // --- openings --------------------------------------------------------
  const { openings, groups } = buildOpenings(s.elevations, bounds, masses, annexTopY)

  const appearance: AppearanceFeature[] = []

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
    constraints.push({
      id: 'c_building_height',
      key: 'building_height',
      description: 'ridge height above terrain must stay at the published figure',
      target: s.buildingHeightM,
      toleranceAbs: 0.15,
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
    constraints.push({
      id: 'c_garage_area',
      key: 'garage_area',
      description: 'garage floor area must stay near the published figure',
      target: inputs.publishedGarageAreaM2,
      toleranceAbs: Math.max(2, inputs.publishedGarageAreaM2 * 0.12),
      unit: 'm2',
      authority: 'PUBLISHED_EXACT',
    })
  }

  return {
    id: mkId('bh', 'base', s.widthM.toFixed(2), s.depthM.toFixed(2), s.ridgeY.toFixed(2)),
    producedBy: 'scaffold',
    storeys,
    masses,
    roofs,
    openings,
    openingGroups: groups,
    appearance,
    constraints,
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
    const sorted = [...e.openings].sort((a, b) => a.s - b.s)

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
