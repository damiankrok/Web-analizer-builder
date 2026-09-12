/** Source package contracts (§8, §9). Produced by the ARCHON adapter. */

export type AssetRole =
  | 'PLAN_GROUND'
  | 'PLAN_UPPER'
  | 'PLAN_OTHER'
  | 'SECTION'
  | 'ELEVATION_FRONT'
  | 'ELEVATION_REAR'
  | 'ELEVATION_LEFT'
  | 'ELEVATION_RIGHT'
  | 'HERO_RENDER'
  | 'GARDEN_RENDER'
  | 'SIDE_RENDER'
  | 'OTHER_RENDER'
  | 'SITE_PLAN'
  | 'UNKNOWN_ASSET'

export const PLAN_ROLES: readonly AssetRole[] = ['PLAN_GROUND', 'PLAN_UPPER', 'PLAN_OTHER']
export const ELEVATION_ROLES: readonly AssetRole[] = [
  'ELEVATION_FRONT',
  'ELEVATION_REAR',
  'ELEVATION_LEFT',
  'ELEVATION_RIGHT',
]
export const RENDER_ROLES: readonly AssetRole[] = [
  'HERO_RENDER',
  'GARDEN_RENDER',
  'SIDE_RENDER',
  'OTHER_RENDER',
]

/** How the role was decided — metadata first, pixels second (§9). */
export type RoleEvidence = 'FILENAME' | 'ALT_TEXT' | 'CAPTION' | 'DOM_CONTEXT' | 'PIXEL_INFERENCE' | 'DEFAULT'

export type SourceAsset = {
  id: string
  url: string
  role: AssetRole
  roleConfidence: number
  roleEvidence: RoleEvidence[]
  /** Raw label as published (alt / caption / filename slug). */
  label: string
  /** Set once the asset is fetched and decoded. */
  width?: number
  height?: number
  byteLength?: number
  contentType?: string
  /** SHA-256 of the asset bytes; makes runs reproducible and cacheable. */
  sha256?: string
}

export type FactUnit = 'm' | 'm2' | 'm3' | 'deg' | 'cm' | 'count' | 'text'

export type PublishedFact = {
  id: string
  /** Canonical machine key, e.g. `footprint_area`, `building_height`. */
  key: string
  /** Label exactly as published (Polish, for provenance). */
  sourceLabel: string
  value: number | null
  text?: string
  unit: FactUnit
  /** Evidence authority; published numeric facts are the strongest source. */
  authority: 'PUBLISHED_EXACT' | 'PUBLISHED_DERIVED' | 'PUBLISHED_TEXT'
}

export type RoomFact = {
  id: string
  storey: 'GROUND' | 'UPPER'
  index: number
  name: string
  areaM2: number
  /** ARCHON publishes a second bracketed area (floor area incl. low headroom). */
  areaGrossM2?: number
}

export type SourceIdentity = {
  projectCode: string
  name: string
  url: string
  vendor: 'ARCHON'
  /** ISO timestamp of the fetch, informational only — excluded from hashes. */
  fetchedAt?: string
}

export type SourcePackage = {
  identity: SourceIdentity
  facts: PublishedFact[]
  rooms: RoomFact[]
  assets: SourceAsset[]
  /** Free-text technology notes, kept for provenance and text-level evidence. */
  notes: Record<string, string>
  /** Non-fatal problems encountered while parsing. */
  warnings: string[]
}

export const factValue = (pkg: SourcePackage, key: string): number | null => {
  const f = pkg.facts.find((x) => x.key === key)
  return f && f.value !== null ? f.value : null
}

export const assetsByRole = (pkg: SourcePackage, roles: readonly AssetRole[]): SourceAsset[] =>
  pkg.assets.filter((a) => roles.includes(a.role))
