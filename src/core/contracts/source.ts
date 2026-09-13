/**
 * What one parsed project page contains — the analyzer's input shape.
 *
 * Originally called `SourcePackage`. STAGE WEB-PIVOT-03 gave that name to the
 * immutable acquisition record in `source-package.ts`, which is a superset of
 * this: it keeps every variant found rather than the one chosen, records where
 * each URL came from and why one won, and carries a content hash that every
 * execution path can be checked against. This type is what a package *narrows
 * to* for the analyzer (`toParsedSource`), and the analyzer's contract is
 * unchanged by that stage.
 */

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
  | 'INTERIOR_RENDER'
  | 'SITE_PLAN'
  | 'UNKNOWN_ASSET'

export const PLAN_ROLES: readonly AssetRole[] = ['PLAN_GROUND', 'PLAN_UPPER', 'PLAN_OTHER']
export const ELEVATION_ROLES: readonly AssetRole[] = [
  'ELEVATION_FRONT',
  'ELEVATION_REAR',
  'ELEVATION_LEFT',
  'ELEVATION_RIGHT',
]
/** Exterior renders: the only renders that carry massing evidence. */
export const RENDER_ROLES: readonly AssetRole[] = [
  'HERO_RENDER',
  'GARDEN_RENDER',
  'SIDE_RENDER',
  'OTHER_RENDER',
]

/** Roles that describe the building's exterior geometry in any way. */
export const GEOMETRY_ROLES: readonly AssetRole[] = [
  ...PLAN_ROLES,
  'SECTION',
  ...ELEVATION_ROLES,
  ...RENDER_ROLES,
]

/** How the role was decided — metadata first, pixels second (§9). */
export type RoleEvidence = 'FILENAME' | 'ALT_TEXT' | 'CAPTION' | 'DOM_CONTEXT' | 'PIXEL_INFERENCE' | 'DEFAULT'

/**
 * One published resolution of a view.
 *
 * ARCHON serves technical drawings twice: a page thumbnail inside an `<img>`
 * and a lightbox original behind the anchor that wraps it. The thumbnail is
 * what the descriptive filename is attached to; the original is 2.3x larger
 * linearly and is the only copy on which printed dimensions are legible. They
 * are the same view and must stay one asset (§4).
 */
export type AssetVariant = {
  url: string
  kind: 'PAGE' | 'LIGHTBOX'
  /** Published width/height attributes, when the markup states them. */
  width?: number
  height?: number
  /** Decoded pixel size, once fetched. */
  nativeWidth?: number
  nativeHeight?: number
}

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
  /**
   * Every published resolution of this view, largest first. `url` is the one
   * actually analysed. Kept so the resolution audit can state what was
   * available as well as what was used.
   */
  variants?: AssetVariant[]
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

export type ParsedSource = {
  identity: SourceIdentity
  facts: PublishedFact[]
  rooms: RoomFact[]
  assets: SourceAsset[]
  /** Free-text technology notes, kept for provenance and text-level evidence. */
  notes: Record<string, string>
  /** Non-fatal problems encountered while parsing. */
  warnings: string[]
}

export const factValue = (pkg: ParsedSource, key: string): number | null => {
  const f = pkg.facts.find((x) => x.key === key)
  return f && f.value !== null ? f.value : null
}

export const assetsByRole = (pkg: ParsedSource, roles: readonly AssetRole[]): SourceAsset[] =>
  pkg.assets.filter((a) => roles.includes(a.role))
