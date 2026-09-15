/**
 * The candidate's vertical structure, roof and facades — §26, §27.
 *
 * Stage 06's candidate is a reading of floor plans: walls with two faces,
 * rooms, openings in plan. This adds what the section and the elevations say,
 * and it adds it in the same spirit — as a *proposal about* a building that
 * carries where every part of it came from and what remains unsettled.
 *
 * Two things are deliberate and both are §26's.
 *
 * **Nothing here is a bare number.** Every measured quantity is a
 * `CandidateMeasure`: a value, the kind of evidence behind it, a tolerance
 * derived from the drawing it was read on, the assets it was read from, and
 * why. A reader who wants to know whether a ridge height is a printed datum or
 * the crossing of two fitted lines can see which, and a reader who wants to
 * know whether an elevation opening was matched to a plan wall or merely
 * hoped to be can see that too.
 *
 * **A conflict is a first-class record.** §27 lists the disagreements this
 * stage must be able to represent — a section ridge against an elevation
 * ridge, a printed pitch against a fitted one, a plan opening against an
 * elevation opening, a chimney's footprint against its stack, a facade depth
 * with nothing to fix it. Each of those is a `CrossSourceConflict` with the
 * observations that produced it, and none of them is resolved by preferring
 * the reading that makes the model tidier.
 *
 * PORT_DIRECT (Kotlin).
 */
import type { CandidateMeasure, EvidenceRef, Fidelity, ResolutionStatus } from './candidate-evidence.js'
import type { VerticalDatumObservation } from './vertical-datums.js'
import type { FusedPitch, RoofComponent, RoofPlaneCandidate, RoofTopology, SkylineShape } from './roof-model.js'
import type { SourceTolerance } from './source-tolerance.js'

/** One height in the building's vertical structure, once the sources are fused. */
export type CandidateLevel = {
  id: string
  /**
   * What this height is. `role` is settled by matching a level against
   * geometry — a slab's top edge, a fitted roof plane's ends — and not by the
   * ordering hint the datum observations carry.
   */
  role: 'TERRAIN' | 'GROUND_ZERO' | 'STOREY_FLOOR' | 'SLAB_TOP' | 'KNEE_WALL_TOP' | 'EAVE' | 'RIDGE' | 'BUILDING_TOP' | 'UNKNOWN'
  level: CandidateMeasure
  tolerance: SourceTolerance
  /** The datum observation this came from, where a printed one did. */
  datumId: string | null
  status: ResolutionStatus
  why: string
}

/** A floor or roof slab the section cuts through. */
export type CandidateSlab = {
  id: string
  topLevel: CandidateMeasure
  bottomLevel: CandidateMeasure | null
  thickness: CandidateMeasure | null
  /** Where the section cuts it, metres along the section's own horizontal axis. */
  fromM: number
  toM: number
  evidence: EvidenceRef[]
  status: ResolutionStatus
}

/** An opening seen on an elevation, and what it was matched to. */
export type CandidateFacadeOpening = {
  id: string
  /** Which facade, as the SourcePackage declares it. */
  view: string
  assetId: string
  /** Outline in the elevation's own pixels, for a reader retracing it. */
  boxPx: { x0: number; y0: number; x1: number; y1: number }
  /**
   * The outline in building metres: along the facade, and in height above the
   * ground datum. A raked opening carries its sloping head separately (§21).
   */
  alongFromM: number
  alongToM: number
  sillLevelM: number
  headLevelM: number
  widthM: number
  heightM: number
  /** For a raked opening: the head at each end, so the polygon is not squared off. */
  rakedHead: { leftLevelM: number; rightLevelM: number; slopeDeg: number } | null
  /** Which storey's band it falls in, where the levels settle it. */
  storeyBand: string | null
  /** Which detector or detectors found it. */
  evidenceKind: string[]
  fidelity: Fidelity
  tolerance: SourceTolerance
  /** The plan opening it was matched to, when one was. */
  match: {
    planWallId: string
    planOpeningIndex: number
    residualM: number
    confidence: number
  } | null
  matchStatus: 'MATCHED' | 'UNMATCHED_ON_ELEVATION' | 'CONFLICT'
  confidence: number
  evidence: EvidenceRef[]
  why: string
}

/** An opening in a roof plane: a rooflight, a roof window, a dormer's glazing. */
export type CandidateRoofOpening = {
  id: string
  /** The roof plane it sits in, where that is settled. */
  roofPlaneId: string | null
  /** Position along the plane's fall and across it, metres, where measurable. */
  alongPlaneM: number | null
  acrossPlaneM: number | null
  widthM: CandidateMeasure | null
  heightM: CandidateMeasure | null
  /** Which drawings show it. Two weak sources are not one strong one. */
  sources: EvidenceRef[]
  status: ResolutionStatus
  confidence: number
  why: string
}

/** A chimney or flue, and whether the plan and the elevation agree about it. */
export type CandidateChimney = {
  id: string
  /** Footprint in plan metres, where a plan shows one. */
  planFootprint: { x0: number; z0: number; x1: number; z1: number } | null
  planStorey: string | null
  /** The stack's silhouette on an elevation, where one shows it. */
  stack: { view: string; alongFromM: number; alongToM: number; topLevelM: number } | null
  /** Level at which it passes through a roof plane, where that is settled. */
  roofPenetrationLevelM: CandidateMeasure | null
  crossSource: 'MATCHED' | 'CONFLICT' | 'UNRESOLVED'
  evidence: EvidenceRef[]
  confidence: number
  why: string
}

/** A recess, balcony, railing or portal the orthographic sources support. */
export type CandidateFacadeFeature = {
  id: string
  kind: 'FACADE_RECESS' | 'BALCONY_SLAB' | 'RAILING' | 'PORTAL_FRAME' | 'PROJECTION'
  view: string
  /** Extent along the facade, metres. */
  alongFromM: number
  alongToM: number
  /** Vertical extent, metres above the ground datum. */
  bottomLevelM: number
  topLevelM: number
  /**
   * How deep it goes. Null where no orthographic source constrains it — which
   * §24 requires to stay null rather than be guessed from a render.
   */
  depth: CandidateMeasure | null
  evidence: EvidenceRef[]
  status: ResolutionStatus
  confidence: number
  why: string
}

/** A disagreement between two sources that the sources do not settle. */
export type CrossSourceConflict = {
  id: string
  kind:
    | 'SECTION_RIDGE_VS_ELEVATION_RIDGE'
    | 'PRINTED_PITCH_VS_FITTED_PITCH'
    | 'PLAN_OPENING_VS_ELEVATION_OPENING'
    | 'ROOFLIGHT_PLAN_VS_ELEVATION'
    | 'CHIMNEY_FOOTPRINT_VS_STACK'
    | 'CHIMNEY_LOWER_SHAFT_UNRESOLVED'
    | 'FACADE_DEPTH_UNRESOLVED'
    | 'ELEVATION_REGISTRATION_VS_PLAN_FOOTPRINT'
    | 'ELEVATION_SCALE_DISAGREES_WITH_SET'
    | 'ELEVATION_VIEW_IDENTITY_UNRESOLVED'
    | 'DATUM_READING_REJECTED'
    | 'LEVEL_ORDER_CONTRADICTION'
  /** What was seen, in the words of whatever saw it. */
  observations: string[]
  /** What cannot be decided from these sources. */
  unresolved: string
  evidence: EvidenceRef[]
  confidence: number
}

/** One elevation, as registered. */
export type CandidateElevation = {
  assetId: string
  /** The view the SourcePackage declares. */
  declaredView: string
  /** Which side of the building it was solved onto, and how many openings settled it. */
  solvedSide: string | null
  matchedOpenings: number
  /** The direction the building's coordinate runs, as solved. */
  solvedDirection: 1 | -1 | null
  directionAgreesWithDeclaredView: boolean
  pixelsPerMetreX: number
  pixelsPerMetreY: number
  anisotropy: number
  rowAtZero: number
  colAtZero: number
  horizontalMethod: string
  footprintCheck: { measuredM: number; planM: number; residualM: number } | null
  silhouette: {
    minX: number
    maxX: number
    roofTopRow: number
    roofTopFrom: string
    groundRow: number
    shape: SkylineShape
  }
  status: ResolutionStatus
  confidence: number
  notes: string[]
}

/**
 * Everything §26 adds to the candidate.
 *
 * A separate object rather than ten loose fields, so that a reader can see at
 * a glance which part of the candidate came from the plans and which from the
 * section and elevations — and so that a candidate built without a section
 * carries `null` here rather than ten empty arrays that look like findings.
 */
export type CandidateShell = {
  /** The section this was read from, and the scale it settled. */
  section: {
    assetId: string | null
    pixelsPerMetre: number | null
    datumRow: number | null
    rmsResidualM: number | null
    pairSpread: number | null
    why: string
  }
  verticalDatums: VerticalDatumObservation[]
  levels: CandidateLevel[]
  slabs: CandidateSlab[]
  roofTopology: RoofTopology
  roofComponents: RoofComponent[]
  roofPlanes: RoofPlaneCandidate[]
  pitch: FusedPitch
  elevations: CandidateElevation[]
  facadeOpenings: CandidateFacadeOpening[]
  roofOpenings: CandidateRoofOpening[]
  chimneys: CandidateChimney[]
  facadeFeatures: CandidateFacadeFeature[]
  crossSourceConflicts: CrossSourceConflict[]
  /** Everything the sources were asked and did not answer. */
  unresolved: string[]
  notes: string[]
}
