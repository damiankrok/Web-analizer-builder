/** Typed EvidenceGraph contracts (§14). */

export type EvidenceNodeType =
  | 'SourceAsset'
  | 'PublishedFact'
  | 'DimensionObservation'
  | 'PlanRegion'
  | 'WallLine'
  | 'RoomRegion'
  | 'Storey'
  | 'FacadePlane'
  | 'OpeningObservation'
  | 'ElevationFeature'
  | 'RenderFeature'
  | 'MassRegion'
  | 'RoofRegion'
  | 'LevelObservation'
  | 'StairObservation'
  | 'AppearanceFeature'
  | 'CameraHypothesis'

export type EvidenceRelationType =
  | 'supports'
  | 'contradicts'
  | 'samePhysicalFeature'
  | 'sameViewAs'
  | 'derivedFrom'
  | 'projectsTo'
  | 'belongsToFacade'
  | 'belongsToStorey'
  | 'adjacentTo'
  | 'repeatedFamily'
  | 'occludedInView'
  | 'constrains'

/**
 * Evidence authority ladder (§33, §36). Higher wins: a perspective render must
 * never override a published exact dimension.
 */
export type Authority =
  | 'PUBLISHED_EXACT' // numeric fact printed on the page
  | 'PLAN_MEASURED' // measured off a dimensioned floor plan
  | 'SECTION_MEASURED' // measured off the building section
  | 'ELEVATION_MEASURED' // measured off an orthographic technical elevation
  | 'RENDER_INFERRED' // inferred from a perspective visualisation
  | 'PRIOR' // typology prior, no source backing

export const AUTHORITY_RANK: Record<Authority, number> = {
  PUBLISHED_EXACT: 100,
  PLAN_MEASURED: 80,
  SECTION_MEASURED: 75,
  ELEVATION_MEASURED: 70,
  RENDER_INFERRED: 30,
  PRIOR: 10,
}

export type EvidenceNode = {
  id: string
  type: EvidenceNodeType
  /** Asset this observation came from, when applicable. */
  sourceAssetId?: string
  authority: Authority
  confidence: number
  /**
   * Physical-identity key. Two nodes carrying the same key describe the same
   * physical feature seen from different sources and must not count twice
   * (§14 "duplicates must not count twice").
   */
  identityKey?: string
  payload: Record<string, unknown>
}

export type EvidenceRelation = {
  id: string
  type: EvidenceRelationType
  from: string
  to: string
  weight: number
  note?: string
}

export type EvidenceGraphData = {
  nodes: EvidenceNode[]
  relations: EvidenceRelation[]
}
