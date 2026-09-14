/**
 * Minimal ArchitecturalSpec — STAGE WEB-PIVOT-02, development only.
 *
 * Not a BIM schema. This is the smallest description that can carry the real
 * Marcowki exterior shell: two vertical levels, a recessed upper storey, a
 * floor plate between them, a main gable roof and a flat roof over the garage.
 * Anything the shell does not need is absent on purpose, because a field with
 * no test behind it is a field nobody can trust.
 *
 * Two rules shape every type here:
 *
 *   - **Vertical lines are named, not numbered.** A section carries a ground
 *     finished-floor level, an upper finished-floor level, an eave, a ridge and
 *     a terrain datum, and they mean different things. Collapsing them into a
 *     list of slabs throws away the only information that says which one the
 *     roof bears on.
 *   - **Provenance travels with the value.** Every level, shell, slab and roof
 *     names the source observation it came from and how firmly. A number with
 *     no provenance cannot be told apart from a guess once it is geometry.
 *
 * Nothing in the production analyzer imports this file.
 *
 * PORT_DIRECT (Kotlin) — plain data.
 */
import type { Vec3 } from '../contracts/geometry.js'
import type { GlazingSpec, OpeningSpec, WallSpec } from './contracts.js'
import type { WallJunctionSpec } from './junction.js'
import type { RoofOpeningFillSpec, RoofOpeningSpec } from './roof.js'

/**
 * How firmly a value is tied to the official source.
 *
 * The order matters: only `SOURCE_EXACT` and `SOURCE_CORROBORATED` may be
 * reported as agreeing with the source. `SOURCE_DERIVED` is arithmetic on
 * source values and is only as good as the reading behind it; `ASSUMPTION` is
 * the author's, and is never a match against anything.
 */
export type SpecStatus =
  /** Printed on an official drawing or published as a fact, and read directly. */
  | 'SOURCE_EXACT'
  /** Printed once and independently confirmed by a second source or measurement. */
  | 'SOURCE_CORROBORATED'
  /** Computed from source values; the computation is stated. */
  | 'SOURCE_DERIVED'
  /** Not available from the source. Explicitly the author's choice. */
  | 'ASSUMPTION'
  /** Needed by the compiler and not settled. Must not become geometry. */
  | 'UNRESOLVED'

/** Where a value came from, in enough detail for someone else to check it. */
export type Provenance = {
  /** The asset this was read from: an id, a filename or the page URL. */
  source: string
  /** Where on it — a dimension chain, a datum marker, a pixel region. */
  locator: string
  /** What the value means, in words, not in units. */
  interpretation: string
  status: SpecStatus
  /** Anything a reader needs in order to disagree. */
  note?: string
}

export type ProvenancedNumber = {
  value: number
  unit: 'm' | 'deg' | 'm2' | 'm3'
  provenance: Provenance
}

/**
 * A named horizontal datum.
 *
 * `elevationM` is measured from the building's own zero, which `BuildingSpec`
 * names. Keeping the datum explicit is what lets the report say that
 * `7.95 m above the ground finished floor` and `8.27 m above terrain` are the
 * same height described from two places.
 */
export type LevelKind =
  | 'TERRAIN'
  | 'GROUND_FFL'
  | 'UPPER_FFL'
  | 'EAVE'
  | 'RIDGE'
  | 'FLAT_ROOF_TOP'

export type LevelSpec = {
  id: string
  kind: LevelKind
  elevationM: number
  provenance: Provenance
}

/**
 * One storey's wall system: a closed ring of walls with explicit corners.
 *
 * This is STAGE WEB-PIVOT-01C's ring, given a name, a base level and a place in
 * a building. `topLevelId` is what the walls rise to where they are flat; a
 * wall that carries a `topProfile` overrides it, which is how a gable end
 * reaches past the eave to the ridge.
 */
export type StoreyShellSpec = {
  id: string
  baseLevelId: string
  topLevelId: string
  wallIds: string[]
  junctionIds: string[]
  provenance: Provenance
}

/**
 * A horizontal plate.
 *
 * The minimum needed to prove vertical stacking: which level its top sits at,
 * how thick it is, which storey owns it, and the rectangle it covers. The
 * rectangle is stated rather than derived from the walls, so that a plate can
 * be checked against the walls instead of agreeing with them by construction.
 */
export type SlabSpec = {
  id: string
  /** World plan rectangle, outer bounds. */
  footprint: { minX: number; maxX: number; minZ: number; maxZ: number }
  /** Level whose elevation the slab's top sits at. */
  topLevelId: string
  thicknessM: number
  ownerStoreyId: string
  provenance: Provenance
}

export type RoofKind = 'GABLE' | 'FLAT' | 'HIP' | 'MONO_PITCH'

/**
 * A roof.
 *
 * Only `GABLE` and `FLAT` compile. `HIP` and `MONO_PITCH` are in the type
 * because the real world has them and a spec that could not name them would
 * push the author into calling one a gable; the compiler refuses them by name.
 *
 * ## The support footprint is explicit, and that is the point
 *
 * `footprint` is the plan rectangle the roof spans. It is **not** derived from
 * the supporting walls. A roof legitimately overhangs a wall, spans across a
 * local recess, and keeps its eaves outside the wall's outer face — so a
 * compiler that shrank the roof whenever a wall moved would be wrong, and
 * quietly. `supportShellId` records which wall system carries it, for the audit
 * trail; the geometry comes from `footprint` and the datums.
 *
 * ## The pitch is declared, and the geometry is built without it
 *
 * `pitchDeg` is what the drawing says. The emitted slabs are built from
 * `eaveLevelId`, `ridgeLevelId` and `footprint` — never from `pitchDeg` — so an
 * oracle that measures the angle off the emitted triangles is asking an
 * independent question, and a stored pitch that disagrees with the geometry is
 * a finding rather than a self-fulfilling prophecy.
 */
export type RoofSpec = {
  id: string
  kind: RoofKind
  /** Plan rectangle the roof spans, before overhang. World coordinates. */
  footprint: { minX: number; maxX: number; minZ: number; maxZ: number }
  /** The wall system this roof bears on. Audit only; it does not shape the roof. */
  supportShellId: string
  /** Level of the eaves. GABLE and FLAT both have one. */
  eaveLevelId: string
  /** Level of the ridge. GABLE only. */
  ridgeLevelId?: string
  /** Which world axis the ridge runs along. GABLE only. */
  ridgeAxis?: 'X' | 'Z'
  /** What the drawing says the pitch is. Never used to build the geometry. */
  pitchDeg?: number
  /** Horizontal projection of the eave overhang, metres. */
  overhangM: number
  /** Depth of the roof build-up, perpendicular to the plane. */
  thicknessM: number
  ownerStoreyId: string
  provenance: Provenance
}

export type MassKind =
  /** A flue stack. */
  | 'CHIMNEY'
  /** Anything else the drawings show as a solid rectangular shaft or block. */
  | 'SHAFT'

/**
 * A generic prismatic architectural solid — STAGE WEB-PIVOT-05A §10.
 *
 * Not a chimney type. A chimney is one `kind` of it, and the compiler knows
 * nothing about flues, caps, flashings or draughts: it extrudes a plan
 * rectangle between two elevations and records which roofs the solid passes
 * through. Everything a chimney needs beyond that is either drawn on a source
 * or is not modelled, which is the rule this stage works to.
 *
 * ## The penetration is stated, not inferred
 *
 * `penetratesRoofIds` names the roofs the solid crosses. It does not cut them
 * — the roof's own `RoofOpeningSpec` does — and that separation is the point:
 * a solid that claims to pass through a roof with no opening to match is a
 * mass pushed through intact material, which is the defect, and naming both
 * independently is what lets an oracle find it instead of a compiler hiding
 * it.
 */
export type MassSpec = {
  id: string
  kind: MassKind
  /** World plan rectangle. */
  footprint: { minX: number; maxX: number; minZ: number; maxZ: number }
  baseM: number
  topM: number
  ownerStoreyId: string
  /** Roofs this solid is stated to pass through. */
  penetratesRoofIds: string[]
  provenance: Provenance
}

/**
 * The whole description.
 *
 * `worldFrame` is spelled out because a spec that travels without its frame is
 * a spec that will be read in the wrong one.
 */
export type BuildingSpec = {
  id: string
  version: string
  units: { length: 'm'; angle: 'deg' }
  worldFrame: {
    description: string
    /** The level whose elevation is world y = 0. */
    datumLevelId: string
    /** Which way the entrance facade looks, for anyone matching a drawing. */
    frontNormal: Vec3
  }
  levels: LevelSpec[]
  shells: StoreyShellSpec[]
  walls: WallSpec[]
  junctions: WallJunctionSpec[]
  openings: OpeningSpec[]
  glazing: GlazingSpec[]
  slabs: SlabSpec[]
  roofs: RoofSpec[]
  /** Openings cut through roof planes. Empty until STAGE WEB-PIVOT-05A. */
  roofOpenings?: RoofOpeningSpec[]
  /** The units that fill those openings. */
  roofOpeningFills?: RoofOpeningFillSpec[]
  /** Prismatic solids: chimneys and shafts. */
  masses?: MassSpec[]
  /** Values the source did not settle, kept where a reader will see them. */
  unresolved: Array<{ field: string; why: string; provenance: Provenance }>
  provenance: Provenance
}
