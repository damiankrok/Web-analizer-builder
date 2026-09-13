/**
 * Multi-dimensional asset roles — STAGE WEB-PIVOT-03. Pure.
 *
 * ## Why one enum was not enough
 *
 * `AssetRole` answers several questions at once — what kind of drawing, which
 * storey, which elevation — so an asset can only ever be one thing. On the
 * Marcowki page that costs a real source: ARCHON publishes each floor twice,
 * once with dimension chains and once with room names and areas, and the
 * single-enum classifier gives `PLAN_GROUND` to whichever it prefers and
 * demotes the other to `PLAN_OTHER`. The demoted copy is the one carrying the
 * metric evidence, and nothing downstream can tell that it was ever a
 * ground-floor plan.
 *
 * Four independent dimensions fix that without moving a single decision the
 * analyzer makes: a document kind, a storey, an annotation variant and a view
 * identity. The dimensioned ground plan and the area-labelled ground plan then
 * agree on three of the four and differ on exactly the one they actually differ
 * on.
 *
 * ## What this module must not do
 *
 * It does not decide `analyzerRole`. That stays with `classifyByMetadata`,
 * `resolveRoleConflicts`, `preferDimensionedPlans` and `dedupeSameView`,
 * unchanged, because STAGE WEB-PIVOT-03 is a source-acquisition stage: it
 * changes which *bytes* reach the analyzer, not how the analyzer classifies
 * what it is given. The dimensions here sit alongside that value and are
 * derived from the same published text.
 *
 * PORT_DIRECT (Kotlin).
 */
import type { AssetRole, RoleEvidence } from '../contracts/source.js'
import type {
  AnnotationVariant,
  AssetRoles,
  DiscoveryChannel,
  DocumentKind,
  ProjectionClass,
  StoreyLevel,
  ViewIdentity,
} from '../contracts/source-package.js'
import { deaccent } from './role-classifier.js'

export type RoleDimensionInput = {
  /** Filename without its extension. */
  urlSlug: string
  /** Published alt text or caption. */
  label: string
  /** Where the URL was found; the floor-plan attribute is itself evidence. */
  channels: readonly DiscoveryChannel[]
  /** The single-enum role the existing classifier produced for this asset. */
  analyzerRole: AssetRole
  confidence: number
  evidence: readonly RoleEvidence[]
  mediaType: string
}

const has = (text: string, re: RegExp): boolean => re.test(text)

/** Document kind, from the published slug and label. */
export function documentKindOf(text: string, mediaType: string, analyzerRole: AssetRole): DocumentKind {
  if (mediaType === 'application/pdf') return 'PDF'
  if (has(text, /\brzut\b|\bplan\b/)) return 'FLOOR_PLAN'
  if (has(text, /\bprzekroj\b|\bsection\b/)) return 'SECTION'
  if (has(text, /\belewacj\w*/)) return 'ELEVATION'
  if (has(text, /\bsytuacj\w*/)) return 'SITE_PLAN'
  if (has(text, /\bwidok\b|\bwizualizacj\w*/)) return 'PERSPECTIVE_RENDER'
  // Fall back to what the single-enum classifier concluded, so a document kind
  // is never *less* informed than the role the analyzer already had.
  switch (analyzerRole) {
    case 'PLAN_GROUND':
    case 'PLAN_UPPER':
    case 'PLAN_OTHER':
      return 'FLOOR_PLAN'
    case 'SECTION':
      return 'SECTION'
    case 'ELEVATION_FRONT':
    case 'ELEVATION_REAR':
    case 'ELEVATION_LEFT':
    case 'ELEVATION_RIGHT':
      return 'ELEVATION'
    case 'SITE_PLAN':
      return 'SITE_PLAN'
    case 'HERO_RENDER':
    case 'GARDEN_RENDER':
    case 'SIDE_RENDER':
    case 'OTHER_RENDER':
    case 'INTERIOR_RENDER':
      return 'PERSPECTIVE_RENDER'
    default:
      return 'OTHER'
  }
}

/**
 * Storey, from the published text.
 *
 * `parter` is the ground floor and `poddasze` the usable attic; `pietro` is a
 * storey above ground, which on these projects is the attic level. A section or
 * an elevation cuts every storey at once, so it is `ALL` rather than unknown —
 * that distinction matters to anything that later asks "which drawings show the
 * upper floor".
 */
export function storeyOf(text: string, kind: DocumentKind, analyzerRole: AssetRole): StoreyLevel {
  if (kind === 'SECTION' || kind === 'ELEVATION') return 'ALL'
  if (kind !== 'FLOOR_PLAN') return 'UNKNOWN'
  if (has(text, /\bparter\w*/)) return 'GROUND'
  if (has(text, /\bpoddasz\w*|\bpietr\w*|\bstrych\w*/)) return 'UPPER_ATTIC'
  if (analyzerRole === 'PLAN_GROUND') return 'GROUND'
  if (analyzerRole === 'PLAN_UPPER') return 'UPPER_ATTIC'
  return 'UNKNOWN'
}

/**
 * Annotation variant.
 *
 * `z powierzchniami` — "with areas" — is the publisher's own name for the copy
 * that prints room names and floor areas. The other published copy of the same
 * floor is the one with the dimension chains, and it carries no distinguishing
 * word at all: it is the default view, so it is identified by the channel that
 * exposed it rather than by its filename.
 */
export function annotationOf(
  text: string,
  kind: DocumentKind,
  channels: readonly DiscoveryChannel[],
): AnnotationVariant {
  if (has(text, /z-powierzchniami|z powierzchniami|\bpowierzchni\w*/)) return 'AREA_LABELS'
  if (kind !== 'FLOOR_PLAN') return 'CLEAN'
  // The floor-plan attribute is how the page publishes the *alternative* copy,
  // so a plan that reached us through `img[src]` and never through that
  // attribute is the default view: the dimensioned one.
  if (channels.includes('IMG_SRC') && !channels.includes('FLOOR_PLAN_ATTR')) return 'DIMENSIONED'
  return 'UNKNOWN'
}

/** View identity: which elevation, or which render. */
export function viewOf(text: string, kind: DocumentKind, analyzerRole: AssetRole): ViewIdentity {
  if (kind === 'ELEVATION') {
    if (has(text, /frontow\w*|\bprzedni\w*/)) return 'FRONT'
    if (has(text, /ogrodow\w*|\btyln\w*/)) return 'REAR'
    // ARCHON names both side elevations `elewacja boczna`; only the gallery
    // order separates them, which `resolveRoleConflicts` already did.
    if (analyzerRole === 'ELEVATION_LEFT') return 'LEFT'
    if (analyzerRole === 'ELEVATION_RIGHT') return 'RIGHT'
    return 'UNKNOWN'
  }
  if (kind === 'PERSPECTIVE_RENDER') {
    if (analyzerRole === 'HERO_RENDER' || has(text, /widok-1\b|\bwidok 1\b/)) return 'HERO'
    if (analyzerRole === 'GARDEN_RENDER' || has(text, /widok-2\b|\bwidok 2\b|ogrod\w*/)) return 'GARDEN'
    return 'UNKNOWN'
  }
  return 'UNKNOWN'
}

/**
 * What the publisher's labelling implies about the projection.
 *
 * An expectation, not a measurement: `core/projection/classifier.ts` measures
 * it from pixels and says so when the two disagree. Recording the expectation
 * is what makes such a disagreement legible.
 */
export function projectionOf(kind: DocumentKind): ProjectionClass {
  switch (kind) {
    case 'ELEVATION':
    case 'SECTION':
      return 'ORTHOGRAPHIC_TECHNICAL'
    case 'FLOOR_PLAN':
    case 'SITE_PLAN':
      return 'PLANAR_DIAGRAM'
    case 'PERSPECTIVE_RENDER':
      return 'PERSPECTIVE_PINHOLE'
    default:
      return 'UNKNOWN'
  }
}

/** All four dimensions, plus the analyzer's own role carried through unchanged. */
export function roleDimensions(input: RoleDimensionInput): AssetRoles {
  const text = `${deaccent(input.urlSlug)} ${deaccent(input.label)}`.toLowerCase()
  const document = documentKindOf(text, input.mediaType, input.analyzerRole)
  return {
    document,
    storey: storeyOf(text, document, input.analyzerRole),
    annotation: annotationOf(text, document, input.channels),
    view: viewOf(text, document, input.analyzerRole),
    projection: projectionOf(document),
    analyzerRole: input.analyzerRole,
    confidence: input.confidence,
    evidence: [...input.evidence],
  }
}

/** Two assets describe the same drawing when every dimension but annotation agrees. */
export const sameDocument = (a: AssetRoles, b: AssetRoles): boolean =>
  a.document === b.document &&
  a.storey === b.storey &&
  a.view === b.view &&
  a.document !== 'OTHER' &&
  !(a.storey === 'UNKNOWN' && a.view === 'UNKNOWN')

/** Two assets show the same view when the document and the view agree. */
export const sameView = (a: AssetRoles, b: AssetRoles): boolean =>
  a.document === b.document && a.view === b.view && a.view !== 'UNKNOWN'
