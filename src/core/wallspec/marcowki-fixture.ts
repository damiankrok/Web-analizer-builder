/**
 * Fixture B — the Marcowki exterior shell — STAGE WEB-PIVOT-02, development only.
 *
 * Assembles a `BuildingSpec` from the hand-transcribed observations in
 * `research/gold/marcowki-exterior-shell-v1.json`. Every dimension here comes
 * from that file; none is written in this module, and none of it appears in any
 * compiler. If a number in the compiled shell is wrong, it is wrong in the gold
 * spec, where it carries the source it was read from.
 *
 * This is not an analyzer output. It is a manual transcription used to ask one
 * question: given a correct description, does the compiler realise it?
 */
import type { GlazingSpec, OpeningSpec, WallSpec } from './contracts.js'
import type { WallJunctionSpec } from './junction.js'
import type {
  BuildingSpec,
  LevelSpec,
  Provenance,
  RoofSpec,
  SlabSpec,
  SpecStatus,
  StoreyShellSpec,
} from './architectural.js'
import gold from '../../../research/gold/marcowki-exterior-shell-v1.json'

type GoldObservation = {
  key: string
  value: number
  unit: string
  source: string
  locator: string
  interpretation: string
  status: string
  note?: string
}

const OBS = new Map((gold.observations as GoldObservation[]).map((o) => [o.key, o]))

/** One observation, or a loud failure — a missing gold value must never become a default. */
function obs(key: string): GoldObservation {
  const o = OBS.get(key)
  if (!o) throw new Error(`gold spec has no observation "${key}"`)
  return o
}

export const goldValue = (key: string): number => obs(key).value

export function goldProvenance(key: string): Provenance {
  const o = obs(key)
  return {
    source: o.source,
    locator: o.locator,
    interpretation: o.interpretation,
    status: o.status as SpecStatus,
    ...(o.note ? { note: o.note } : {}),
  }
}

// --- The numbers, all of them from the gold file. --------------------------

export const M = {
  overallWidth: goldValue('plan.overallWidthM'),
  mainWidth: goldValue('plan.mainBodyWidthM'),
  garageWidth: goldValue('plan.garageWidthM'),
  overallDepth: goldValue('plan.overallDepthM'),
  garageDepth: goldValue('plan.garageDepthM'),
  rearZoneDepth: goldValue('plan.rearZoneDepthM'),
  wallThickness: goldValue('wall.externalThicknessM'),
  terrain: goldValue('level.terrainM'),
  groundFfl: goldValue('level.groundFflM'),
  upperFfl: goldValue('level.upperFflM'),
  slabThickness: goldValue('slab.upperThicknessM'),
  eave: goldValue('level.eaveM'),
  printedEave: goldValue('level.printedEaveM'),
  ridge: goldValue('level.ridgeM'),
  pitchDeg: goldValue('roof.pitchDeg'),
  buildingHeight: goldValue('building.heightM'),
  publishedFootprint: goldValue('footprint.areaM2'),
  garageClear: goldValue('garage.clearHeightM'),
  flatTop: goldValue('roof.flatTopM'),
  flatThickness: goldValue('roof.flatThicknessM'),
  roofCovering: goldValue('roof.coveringThicknessM'),
  roofBuildUp: goldValue('roof.buildUpDepthM'),
  overhang: goldValue('roof.overhangM'),
  kneeWall: goldValue('wall.kneeWallM'),
  openingWidth: goldValue('opening.gableWidthM'),
  openingHeight: goldValue('opening.gableHeightM'),
  openingOffset: goldValue('opening.gableOffsetM'),
  openingSill: goldValue('opening.gableSillM'),
  openingHeightFar: (gold as { derived: { gableOpeningHeightFarM: number } }).derived.gableOpeningHeightFarM,
} as const

/** Plan rectangles, in the world frame the gold file describes. */
export const MAIN = { minX: 0, maxX: M.mainWidth, minZ: 0, maxZ: M.overallDepth } as const
export const GARAGE = {
  minX: M.mainWidth,
  maxX: M.overallWidth,
  minZ: M.overallDepth - M.garageDepth,
  maxZ: M.overallDepth,
} as const

/** The ridge runs front-to-back, down the middle of the main body. */
export const RIDGE_X = (MAIN.minX + MAIN.maxX) / 2
/**
 * The attic walls stop at the roof's **underside**, not at its top surface.
 *
 * Stopping them at the eave plane would bury the roof's whole build-up inside
 * the wall — 0.276 m of material emitted twice, which the overlap oracle would
 * find and no render would show. The underside is the eave plane dropped by the
 * build-up measured vertically, and the drawing agrees with that reading twice
 * over: the drop lands exactly on the printed 130 knee wall.
 */
const ROOF_VERTICAL_DROP = M.eave - (M.upperFfl + M.kneeWall)
/** Top of the attic side walls above the attic floor: the printed knee wall. */
export const ATTIC_EAVE_H = M.kneeWall
/** Top of the gable ends above the attic floor: the roof's underside at the ridge. */
export const ATTIC_RIDGE_H = M.ridge - ROOF_VERTICAL_DROP - M.upperFfl
/** How far the attic's right wall sits behind the building's own right facade. */
export const UPPER_RECESS_M = M.overallWidth - M.mainWidth

export const IDS = {
  groundMain: 'shell_ground_main',
  garage: 'shell_ground_garage',
  attic: 'shell_attic',
  slab: 'slab_upper_floor',
  gableRoof: 'roof_main_gable',
  flatRoof: 'roof_garage_flat',
  gableOpening: 'opening_gable_front',
  gableGlazing: 'glazing_gable_front',
} as const

const LEVEL = {
  terrain: 'level_terrain',
  ground: 'level_ground_ffl',
  upper: 'level_upper_ffl',
  eave: 'level_eave',
  ridge: 'level_ridge',
  flat: 'level_flat_roof_top',
  groundTop: 'level_upper_ffl',
  garageTop: 'level_garage_wall_top',
  atticTop: 'level_ridge',
} as const

/**
 * Four walls and four corners around a rectangle, nose to tail.
 *
 * The same arrangement STAGE WEB-PIVOT-01C proved: each wall's `u` is chosen so
 * that `u x up` points away from the enclosure, each wall's END meets the next
 * wall's START, and ownership is stated rather than inferred. The two walls
 * running along X own all four corners, so the walls running along Z are
 * trimmed at both ends — which for the attic is what makes the gable end span
 * the building's full width, as the elevation shows it.
 */
function rectRing(
  prefix: string,
  r: { minX: number; maxX: number; minZ: number; maxZ: number },
  baseY: number,
  heightM: number,
  thicknessM: number,
  profiles?: { alongX?: WallSpec['topProfile']; alongZ?: WallSpec['topProfile'] },
): { walls: WallSpec[]; junctions: WallJunctionSpec[] } {
  const up = { x: 0, y: 1, z: 0 }
  const w = (id: string, origin: WallSpec['origin'], u: WallSpec['u'], lengthM: number, alongX: boolean): WallSpec => ({
    id,
    origin,
    u,
    up,
    lengthM,
    heightM,
    thicknessM,
    ...((alongX ? profiles?.alongX : profiles?.alongZ) ? { topProfile: (alongX ? profiles!.alongX : profiles!.alongZ)! } : {}),
  })
  const width = r.maxX - r.minX
  const depth = r.maxZ - r.minZ
  const front = `${prefix}_front`
  const right = `${prefix}_right`
  const rear = `${prefix}_rear`
  const left = `${prefix}_left`
  const walls = [
    w(front, { x: r.minX, y: baseY, z: r.maxZ }, { x: 1, y: 0, z: 0 }, width, true),
    w(right, { x: r.maxX, y: baseY, z: r.maxZ }, { x: 0, y: 0, z: -1 }, depth, false),
    w(rear, { x: r.maxX, y: baseY, z: r.minZ }, { x: -1, y: 0, z: 0 }, width, true),
    w(left, { x: r.minX, y: baseY, z: r.minZ }, { x: 0, y: 0, z: 1 }, depth, false),
  ]
  const j = (id: string, a: string, aEnd: 'START' | 'END', b: string, bEnd: 'START' | 'END', owner: string): WallJunctionSpec => ({
    id,
    wallAId: a,
    wallAEnd: aEnd,
    wallBId: b,
    wallBEnd: bEnd,
    kind: 'BUTT',
    ownerWallId: owner,
  })
  const junctions = [
    j(`${prefix}_corner_fl`, front, 'START', left, 'END', front),
    j(`${prefix}_corner_fr`, front, 'END', right, 'START', front),
    j(`${prefix}_corner_rr`, right, 'END', rear, 'START', rear),
    j(`${prefix}_corner_rl`, rear, 'END', left, 'START', rear),
  ]
  return { walls, junctions }
}

/** A symmetric gable profile: eave at both ends, ridge at the middle. */
const gableProfile = (lengthM: number, peakU: number): WallSpec['topProfile'] => ({
  points: [
    { u: 0, topM: ATTIC_EAVE_H },
    { u: peakU, topM: ATTIC_RIDGE_H },
    { u: lengthM, topM: ATTIC_EAVE_H },
  ],
})

/** A flat top below the wall's nominal height, so a ring's walls share one height. */
const flatProfile = (lengthM: number, topM: number): WallSpec['topProfile'] => ({
  points: [
    { u: 0, topM },
    { u: lengthM, topM },
  ],
})

export type MarcowkiOptions = {
  /**
   * Put a diagnostic opening on the attic's recessed right wall.
   *
   * The real building has no window there — the three 78/118 callouts on the
   * attic plan are roof windows, which the right elevation shows in the slope.
   * The stage brief allows a dedicated diagnostic wall for the recessed-opening
   * proof, and this is it: a stated, non-source opening on the real recessed
   * wall, off by default so the gold shell stays source-only.
   */
  diagnosticRecessOpening?: boolean
}

export function marcowkiBuildingSpec(opts: MarcowkiOptions = {}): BuildingSpec {
  const t = M.wallThickness
  const ground = rectRing('ground_main', MAIN, M.groundFfl, M.upperFfl - M.groundFfl, t)
  const garageTop = M.flatTop - M.flatThickness
  const garage = rectRing('garage', GARAGE, M.groundFfl, garageTop - M.groundFfl, t)
  const attic = rectRing('attic', MAIN, M.upperFfl, ATTIC_RIDGE_H, t, {
    alongX: gableProfile(M.mainWidth, RIDGE_X - MAIN.minX),
    alongZ: flatProfile(M.overallDepth, ATTIC_EAVE_H),
  })

  const openings: OpeningSpec[] = [
    {
      id: IDS.gableOpening,
      hostWallId: 'attic_front',
      offsetM: M.openingOffset,
      sillM: M.openingSill - M.upperFfl,
      widthM: M.openingWidth,
      heightM: M.openingHeight,
      heightFarM: M.openingHeightFar,
      cut: 'THROUGH',
    },
  ]
  const glazing: GlazingSpec[] = [
    { id: IDS.gableGlazing, openingId: IDS.gableOpening, insetM: t / 2 },
  ]
  if (opts.diagnosticRecessOpening) {
    openings.push({
      id: 'opening_recess_diagnostic',
      hostWallId: 'attic_right',
      offsetM: 4.0,
      sillM: 0.2,
      widthM: 1.0,
      // The attic's side walls are only the knee wall tall, so a diagnostic
      // opening has to fit inside 1.30 m or the compiler refuses it — which it
      // does, by name, rather than clipping it to fit.
      heightM: 0.9,
      cut: 'THROUGH',
    })
    glazing.push({ id: 'glazing_recess_diagnostic', openingId: 'opening_recess_diagnostic', insetM: t / 2 })
  }

  const pv = (key: string): Provenance => goldProvenance(key)

  const levels: LevelSpec[] = [
    { id: LEVEL.terrain, kind: 'TERRAIN', elevationM: M.terrain, provenance: pv('level.terrainM') },
    { id: LEVEL.ground, kind: 'GROUND_FFL', elevationM: M.groundFfl, provenance: pv('level.groundFflM') },
    { id: LEVEL.upper, kind: 'UPPER_FFL', elevationM: M.upperFfl, provenance: pv('level.upperFflM') },
    { id: LEVEL.eave, kind: 'EAVE', elevationM: M.eave, provenance: pv('level.eaveM') },
    { id: LEVEL.ridge, kind: 'RIDGE', elevationM: M.ridge, provenance: pv('level.ridgeM') },
    { id: LEVEL.flat, kind: 'FLAT_ROOF_TOP', elevationM: M.flatTop, provenance: pv('roof.flatTopM') },
    { id: LEVEL.garageTop, kind: 'FLAT_ROOF_TOP', elevationM: garageTop, provenance: pv('garage.clearHeightM') },
  ]

  const shells: StoreyShellSpec[] = [
    {
      id: IDS.groundMain,
      baseLevelId: LEVEL.ground,
      topLevelId: LEVEL.upper,
      wallIds: ground.walls.map((w) => w.id),
      junctionIds: ground.junctions.map((j) => j.id),
      provenance: pv('plan.mainBodyWidthM'),
    },
    {
      id: IDS.garage,
      baseLevelId: LEVEL.ground,
      topLevelId: LEVEL.garageTop,
      wallIds: garage.walls.map((w) => w.id),
      junctionIds: garage.junctions.map((j) => j.id),
      provenance: pv('plan.garageWidthM'),
    },
    {
      id: IDS.attic,
      baseLevelId: LEVEL.upper,
      topLevelId: LEVEL.ridge,
      wallIds: attic.walls.map((w) => w.id),
      junctionIds: attic.junctions.map((j) => j.id),
      provenance: pv('attic.footprintMatchesMainBody'),
    },
  ]

  const slabs: SlabSpec[] = [
    {
      id: IDS.slab,
      footprint: { minX: MAIN.minX + t, maxX: MAIN.maxX - t, minZ: MAIN.minZ + t, maxZ: MAIN.maxZ - t },
      topLevelId: LEVEL.upper,
      thicknessM: M.slabThickness,
      ownerStoreyId: IDS.groundMain,
      provenance: pv('slab.upperThicknessM'),
    },
  ]

  const roofs: RoofSpec[] = [
    {
      id: IDS.gableRoof,
      kind: 'GABLE',
      footprint: { ...MAIN },
      supportShellId: IDS.attic,
      eaveLevelId: LEVEL.eave,
      ridgeLevelId: LEVEL.ridge,
      ridgeAxis: 'Z',
      pitchDeg: M.pitchDeg,
      overhangM: M.overhang,
      thicknessM: M.roofBuildUp,
      ownerStoreyId: IDS.attic,
      provenance: pv('roof.pitchDeg'),
    },
    {
      id: IDS.flatRoof,
      kind: 'FLAT',
      footprint: { ...GARAGE },
      supportShellId: IDS.garage,
      eaveLevelId: LEVEL.flat,
      overhangM: 0,
      thicknessM: M.flatThickness,
      ownerStoreyId: IDS.garage,
      provenance: pv('roof.flatTopM'),
    },
  ]

  return {
    id: gold.id,
    version: gold.version,
    units: { length: 'm', angle: 'deg' },
    worldFrame: {
      description: gold.worldFrame.description,
      datumLevelId: LEVEL.ground,
      frontNormal: { x: 0, y: 0, z: 1 },
    },
    levels,
    shells,
    walls: [...ground.walls, ...garage.walls, ...attic.walls],
    junctions: [...ground.junctions, ...garage.junctions, ...attic.junctions],
    openings,
    glazing,
    slabs,
    roofs,
    unresolved: (gold.unresolved as Array<{ field: string; why: string; status: string }>).map((u) => ({
      field: u.field,
      why: u.why,
      provenance: {
        source: gold.project.url,
        locator: 'not dimensioned on any published drawing',
        interpretation: u.why,
        status: u.status as SpecStatus,
      },
    })),
    provenance: {
      source: gold.project.url,
      locator: 'research/gold/marcowki-exterior-shell-v1.json',
      interpretation: gold.notForProduction,
      status: 'SOURCE_CORROBORATED',
    },
  }
}
