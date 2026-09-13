/**
 * The immutable source package — STAGE WEB-PIVOT-03.
 *
 * ## Why this exists
 *
 * Up to STAGE WEB-PIVOT-02A there were three places that decided which bytes an
 * analysis would see: the Node loader (which probed for a larger copy of each
 * drawing and used it), the standalone bundler (which re-parsed the page and
 * published whatever the markup named), and the browser worker (which re-parsed
 * the page a third time and matched images by filename). They could and did
 * disagree — the CLI read the 2.3x section original, the hosted build read the
 * page thumbnail — and nothing in either output said so.
 *
 * A `SourcePackage` is the single answer to "what is being analysed". It is
 * built once, by one code path, and every execution path afterwards consumes
 * it: the CLI, the research commands, the standalone bundle and the analyzer
 * worker. It records not only what was chosen but everything that was found and
 * why one variant won, so a disagreement becomes a comparison of two hashes
 * rather than an archaeology exercise.
 *
 * ## What is in the contract and what is not
 *
 * Portable data only: no DOM, no Node stream, no browser global, no React and
 * no Three.js. It serialises to JSON and back without loss, and
 * `packageContentHash` gives it a stable identity that two machines agree on.
 *
 * It is deliberately a *superset* of what the analyzer consumes. Variants are
 * preserved rather than collapsed — a dimensioned floor plan and the same floor
 * with room areas printed on it are one document with two published faces, and
 * a package that kept only one of them would have thrown away the one a later
 * stage needs. `toParsedSource` is the narrowing, and it is the only narrowing.
 *
 * Units: pixels for image dimensions, bytes for lengths. All hashes are
 * SHA-256, lower-case hex, from `core/util/hash.ts` so that Node, the browser
 * and the JVM compute them identically.
 *
 * PORT_DIRECT (Kotlin) — plain data.
 */
import type { ProjectionType } from './camera.js'
import type {
  AssetRole,
  ParsedSource,
  PublishedFact,
  RoleEvidence,
  RoomFact,
  SourceAsset,
  SourceIdentity,
} from './source.js'
import { hashObject } from '../util/hash.js'

/**
 * Schema version of this contract.
 *
 * Bumped whenever a field changes meaning or a hashed field is added or
 * removed, because both of those change what `packageContentHash` means. It is
 * itself hashed, so a package built under an older schema can never collide
 * with one built under a newer.
 */
export const SOURCE_PACKAGE_SCHEMA_VERSION = '3.0.0'

// --------------------------------------------------------------------------
// Roles, in more than one dimension.
// --------------------------------------------------------------------------

/**
 * What kind of document an asset is.
 *
 * Separate from every other question about it, which is the whole point. The
 * single `AssetRole` enum the earlier stages used answered "what is this for"
 * and "which storey" and "which elevation" in one value, so an asset could only
 * ever mean one thing — and a dimensioned upper-floor plan lost its meaning the
 * moment a different upper-floor image was chosen as the primary geometry view.
 */
export type DocumentKind =
  | 'FLOOR_PLAN'
  | 'SECTION'
  | 'ELEVATION'
  | 'PERSPECTIVE_RENDER'
  | 'SITE_PLAN'
  | 'PDF'
  | 'OTHER'

/** Which storey a document describes. `ALL` is a section or an elevation. */
export type StoreyLevel = 'GROUND' | 'UPPER_ATTIC' | 'ALL' | 'UNKNOWN'

/**
 * What the publisher printed on this copy.
 *
 * ARCHON publishes each floor twice: once with dimension chains and once with
 * room names and areas. Both are official, neither is a worse copy of the
 * other, and they are not interchangeable — the first carries metric evidence,
 * the second carries room identity.
 */
export type AnnotationVariant = 'DIMENSIONED' | 'AREA_LABELS' | 'CLEAN' | 'UNKNOWN'

/** Which way the camera or the projection looks. */
export type ViewIdentity = 'FRONT' | 'REAR' | 'LEFT' | 'RIGHT' | 'HERO' | 'GARDEN' | 'UNKNOWN'

/**
 * Projection class, bridged to the existing classifier's vocabulary.
 *
 * `ProjectionType` is what `core/projection/classifier.ts` measures from
 * pixels. The package records the *published expectation* — a file called
 * `elewacja-frontowa` is meant to be an orthographic elevation — and leaves the
 * measurement where it already lives. When the two disagree the classifier says
 * so, and that contradiction is a finding, not something to reconcile here.
 */
export type ProjectionClass = ProjectionType

export type AssetRoles = {
  document: DocumentKind
  storey: StoreyLevel
  annotation: AnnotationVariant
  view: ViewIdentity
  /** What the publisher's own labelling implies. Pixels may disagree. */
  projection: ProjectionClass
  /**
   * The single-enum role the existing analyzer consumes.
   *
   * Derived from the same metadata classifier that produced it before this
   * stage, and never authored independently: STAGE WEB-PIVOT-03 changes which
   * *bytes* reach the analyzer, not how it classifies them.
   */
  analyzerRole: AssetRole
  confidence: number
  evidence: RoleEvidence[]
}

// --------------------------------------------------------------------------
// Discovery.
// --------------------------------------------------------------------------

/**
 * Where a candidate URL came from.
 *
 * Recorded per URL because "the page mentioned it" is not provenance: an
 * `og:image` and a lightbox anchor are different claims about the same file,
 * and a URL guessed from a naming convention is a much weaker claim than
 * either. A reader who distrusts an asset needs to know which.
 */
export type DiscoveryChannel =
  | 'IMG_SRC'
  | 'IMG_SRCSET'
  | 'IMG_LAZY_ATTR'
  | 'FLOOR_PLAN_ATTR'
  | 'ANCHOR_HREF'
  | 'OG_IMAGE'
  | 'FANCYBOX_AJAX'
  | 'DOCUMENT_LINK'
  | 'VARIANT_CONVENTION'

export type SourceDiscoveryRecord = {
  url: string
  channel: DiscoveryChannel
  /** The page or endpoint whose markup exposed it. */
  exposedBy: string
  /** The attribute or element it was read from, for a reader retracing it. */
  locator: string
  /** Label as published alongside it, where the channel carried one. */
  label?: string
}

// --------------------------------------------------------------------------
// Acquisition outcomes.
// --------------------------------------------------------------------------

export type AcquisitionStatus =
  /** Fetched, decoded, and usable. */
  | 'OK'
  /** Tried and failed; `error` says why. */
  | 'FAILED'
  /** Discovered but deliberately not fetched — beyond the budget, or a duplicate. */
  | 'NOT_FETCHED'
  /** Known to exist and kept as evidence, but not raster-analysable (a PDF). */
  | 'REGISTERED_ONLY'

/**
 * Structured acquisition failure.
 *
 * A failure is recorded, never papered over. Substituting an unrelated
 * thumbnail for a drawing that would not download is how an analysis comes to
 * be confidently wrong about a building, so the package would rather carry a
 * hole with a reason attached.
 */
export type SourceErrorCode =
  | 'PAGE_UNAVAILABLE'
  | 'DOWNLOAD_FAILED'
  | 'REDIRECT_REJECTED'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'DECODE_FAILED'
  | 'ROLE_MISSING'
  | 'AMBIGUOUS_VARIANT'
  | 'OFFLINE_CACHE_MISS'
  | 'ENDPOINT_CHANGED'

export type SourceErrorRecord = {
  code: SourceErrorCode
  message: string
  url?: string
}

/**
 * One published copy of a logical asset.
 *
 * Dimensions are **decoded** pixel counts from the bytes that were actually
 * downloaded. A width attribute in the markup is a layout instruction, not a
 * measurement, and nothing in this package treats it as one — an upscaled image
 * is not a better source and there is no field here in which it could pretend
 * to be.
 */
export type SourceVariantRecord = {
  url: string
  channel: DiscoveryChannel
  status: AcquisitionStatus
  mediaType?: string
  width?: number
  height?: number
  byteLength?: number
  contentHash?: string
  /** Why this copy was or was not the one selected. */
  note: string
  error?: SourceErrorRecord
}

/**
 * A relation between two assets.
 *
 * `SAME_DOCUMENT_AS` — the same drawing, published with different annotation
 * (a floor with dimension chains, and the same floor with room areas).
 * `SAME_VIEW_AS` — the same camera or projection, different document.
 * `VARIANT_OF` — a different published resolution of one asset that was kept as
 * its own record rather than folded in.
 * `DERIVED_FROM` — produced from another asset (a crop, a re-render).
 * `DUPLICATE_OF` — byte-identical to another asset, found at a second URL.
 */
export type AssetRelation = {
  kind: 'SAME_DOCUMENT_AS' | 'SAME_VIEW_AS' | 'VARIANT_OF' | 'DERIVED_FROM' | 'DUPLICATE_OF'
  assetId: string
  why: string
}

/**
 * One logical source asset, with everything needed to trace it.
 *
 * An asset is never identified by filename alone. `assetId` is a hash of the
 * project and the URL it was first discovered at, so it is stable across runs
 * and machines and survives a publisher renaming a file's resolution suffix.
 */
export type SourceAssetRecord = {
  assetId: string
  projectId: string
  /** The copy actually analysed. */
  selectedUrl: string
  /** The URL this asset was first seen at, before any variant selection. */
  discoveredUrl: string
  /** The largest official copy known to exist, selected or not. */
  canonicalUrl: string
  /** The page or endpoint whose markup exposed it. */
  exposedBy: string
  channel: DiscoveryChannel
  /** Label as published (alt text, caption, or the filename slug). */
  label: string
  mediaType: string
  /** Decoded pixel width of the selected copy. */
  width: number
  /** Decoded pixel height of the selected copy. */
  height: number
  byteLength: number
  contentHash: string
  roles: AssetRoles
  /**
   * Whether the analyzer can measure this asset.
   *
   * False for a record kept only as evidence — a PDF registered because it
   * exists and is official, a copy retained for its relation to another. Such a
   * record is part of the package and part of its hash; it is simply not a
   * raster anything downstream can put a ray through.
   */
  analysable: boolean
  /** Every published copy found, selected first. */
  variants: SourceVariantRecord[]
  relations: AssetRelation[]
  /** Why `selectedUrl` won, in the policy's own words. */
  selectionReason: string
  status: AcquisitionStatus
  error?: SourceErrorRecord
}

/** Something the package expected and does not have. */
export type SourceMissingRecord = {
  /** What was expected: a role, a named endpoint, a variant. */
  what: string
  error: SourceErrorRecord
}

/** The project page itself. */
export type SourceDocumentRecord = {
  url: string
  mediaType: string
  byteLength: number
  contentHash: string
  status: AcquisitionStatus
  error?: SourceErrorRecord
}

/**
 * Where the bytes in this package came from.
 *
 * Carried so that a preview can say what it did rather than what it wishes it
 * had done. A browser cannot fetch archon.pl — the site sends no CORS headers —
 * so a hosted build analyses a `PREBUILT_BUNDLE`, and claiming otherwise would
 * be a lie told by a progress message.
 */
export type PackageOrigin = 'LIVE_FETCH' | 'LOCAL_CACHE' | 'PREBUILT_BUNDLE'

export type SourcePackage = {
  schemaVersion: string
  /** `pkg_<hash>`; a pure function of the package's canonical content. */
  packageId: string
  /** Vendor project code, e.g. `m2fa281446a8ca`. */
  projectId: string
  canonicalUrl: string
  identity: SourceIdentity
  document: SourceDocumentRecord
  assets: SourceAssetRecord[]
  missing: SourceMissingRecord[]
  discovery: SourceDiscoveryRecord[]
  /** Published numeric facts, parsed from the page. */
  facts: PublishedFact[]
  rooms: RoomFact[]
  notes: Record<string, string>
  warnings: string[]
  /** Versions of the things that produced this package. Not hashed. */
  toolVersions: Record<string, string>
  origin: PackageOrigin
  /** ISO timestamp. Informational; not hashed. */
  fetchedAt?: string
  /** `packageContentHash` of this package. Not itself hashed. */
  contentHash: string
}

// --------------------------------------------------------------------------
// Canonical hashing.
// --------------------------------------------------------------------------

/**
 * Fields deliberately left out of the canonical hash.
 *
 * Everything here varies between two runs or two machines that are looking at
 * the same published material, so including any of it would mean the same
 * source package failed to be the same source package.
 */
export const VOLATILE_PACKAGE_FIELDS: readonly string[] = [
  'fetchedAt',
  'origin',
  'toolVersions',
  'packageId',
  'contentHash',
  'document.status',
  'assets[].variants[].status',
  'assets[].variants[].note',
  'assets[].selectionReason',
  'assets[].variants[].error',
  'warnings',
  'discovery',
]

/**
 * The projection of a package that its identity is computed over.
 *
 * It covers the schema version, the project, the page's own bytes, and for
 * every asset: its identity, the bytes selected, their decoded size, its roles
 * and its relations — which is the list §13 of the stage brief requires. It
 * also covers the *set* of variants by URL and content hash, because two
 * packages that found different copies of the same drawing are not the same
 * package even when they happened to select the same one.
 *
 * It covers neither timestamps, nor local paths, nor tool versions, nor the
 * free-text reasons attached to a selection: prose is documentation, and a
 * reworded explanation is not a different source.
 */
export function canonicalPackageView(pkg: SourcePackage): unknown {
  return {
    schemaVersion: pkg.schemaVersion,
    projectId: pkg.projectId,
    canonicalUrl: pkg.canonicalUrl,
    identity: { projectCode: pkg.identity.projectCode, name: pkg.identity.name, url: pkg.identity.url, vendor: pkg.identity.vendor },
    document: {
      url: pkg.document.url,
      mediaType: pkg.document.mediaType,
      byteLength: pkg.document.byteLength,
      contentHash: pkg.document.contentHash,
    },
    assets: [...pkg.assets]
      .sort((a, b) => (a.assetId < b.assetId ? -1 : a.assetId > b.assetId ? 1 : 0))
      .map((a) => ({
        assetId: a.assetId,
        projectId: a.projectId,
        selectedUrl: a.selectedUrl,
        discoveredUrl: a.discoveredUrl,
        canonicalUrl: a.canonicalUrl,
        exposedBy: a.exposedBy,
        channel: a.channel,
        label: a.label,
        mediaType: a.mediaType,
        width: a.width,
        height: a.height,
        byteLength: a.byteLength,
        contentHash: a.contentHash,
        analysable: a.analysable,
        status: a.status,
        errorCode: a.error?.code ?? null,
        roles: {
          document: a.roles.document,
          storey: a.roles.storey,
          annotation: a.roles.annotation,
          view: a.roles.view,
          projection: a.roles.projection,
          analyzerRole: a.roles.analyzerRole,
        },
        variants: [...a.variants]
          .sort((x, y) => (x.url < y.url ? -1 : x.url > y.url ? 1 : 0))
          .map((v) => ({
            url: v.url,
            channel: v.channel,
            mediaType: v.mediaType ?? null,
            width: v.width ?? null,
            height: v.height ?? null,
            byteLength: v.byteLength ?? null,
            contentHash: v.contentHash ?? null,
          })),
        relations: [...a.relations]
          .sort((x, y) => (x.kind + x.assetId < y.kind + y.assetId ? -1 : 1))
          .map((rel) => ({ kind: rel.kind, assetId: rel.assetId })),
      })),
    missing: [...pkg.missing]
      .sort((a, b) => (a.what < b.what ? -1 : a.what > b.what ? 1 : 0))
      .map((m) => ({ what: m.what, code: m.error.code })),
    facts: [...pkg.facts]
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
      .map((f) => ({ key: f.key, value: f.value, unit: f.unit, authority: f.authority })),
    rooms: [...pkg.rooms]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((room) => ({ id: room.id, storey: room.storey, index: room.index, name: room.name, areaM2: room.areaM2 })),
  }
}

/** The package's stable identity: SHA-256 over its canonical view. */
export const packageContentHash = (pkg: SourcePackage): string => hashObject(canonicalPackageView(pkg))

/** `pkg_<first 16 hex of the content hash>`. */
export const packageIdFor = (contentHash: string): string => `pkg_${contentHash.slice(0, 16)}`

/** Recompute a package's own identity fields. Idempotent. */
export function sealPackage(pkg: SourcePackage): SourcePackage {
  const contentHash = packageContentHash(pkg)
  return { ...pkg, contentHash, packageId: packageIdFor(contentHash) }
}

/** True when a package's stored identity matches the content it carries. */
export const packageSealIntact = (pkg: SourcePackage): boolean => {
  const h = packageContentHash(pkg)
  return pkg.contentHash === h && pkg.packageId === packageIdFor(h)
}

// --------------------------------------------------------------------------
// The analyzer's view.
// --------------------------------------------------------------------------

/**
 * Narrow a package to the shape the analyzer has always consumed.
 *
 * This is the only narrowing, and it is shared: the CLI and the browser worker
 * both call it, on the same package, and therefore hand the analyzer the same
 * assets in the same order with the same roles. Before this stage each host
 * re-derived that list from raw HTML, which is how they came to disagree.
 *
 * Assets the package holds only as evidence — a registered PDF, a copy kept for
 * its relation to another — are not passed on: the analyzer's contract is
 * raster images it can measure. Nothing is re-classified here.
 */
export function toParsedSource(pkg: SourcePackage): ParsedSource {
  const assets: SourceAsset[] = pkg.assets
    .filter((a) => a.status === 'OK' && a.analysable)
    .map((a) => ({
      id: a.assetId,
      url: a.selectedUrl,
      role: a.roles.analyzerRole,
      roleConfidence: a.roles.confidence,
      roleEvidence: [...a.roles.evidence],
      label: a.label,
      width: a.width,
      height: a.height,
      byteLength: a.byteLength,
      contentType: a.mediaType,
      sha256: a.contentHash,
      roles: {
        document: a.roles.document,
        storey: a.roles.storey,
        annotation: a.roles.annotation,
        view: a.roles.view,
        projection: a.roles.projection,
      },
      variants: a.variants.map((v) => ({
        url: v.url,
        kind: v.channel === 'ANCHOR_HREF' || v.channel === 'VARIANT_CONVENTION' ? ('LIGHTBOX' as const) : ('PAGE' as const),
        ...(v.width !== undefined ? { nativeWidth: v.width } : {}),
        ...(v.height !== undefined ? { nativeHeight: v.height } : {}),
      })),
    }))
  return {
    identity: pkg.identity,
    facts: pkg.facts,
    rooms: pkg.rooms,
    assets,
    notes: pkg.notes,
    warnings: pkg.warnings,
  }
}

/**
 * Published file name for an asset's bytes: its content hash and a real
 * extension.
 *
 * In `core/` rather than beside the Node writer because the browser has to
 * compute the same name to ask for the same file. Naming a published asset
 * after its content is what removes the last filename match from the pipeline.
 */
export function assetFileNameFor(contentHash: string, mediaType: string): string {
  const ext =
    ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'application/pdf': 'pdf' })[
      mediaType
    ] ?? 'bin'
  return `${contentHash.slice(0, 32)}.${ext}`
}

/** Assets carrying a given document kind, in package order. */
export const assetsOfKind = (pkg: SourcePackage, kind: DocumentKind): SourceAssetRecord[] =>
  pkg.assets.filter((a) => a.roles.document === kind)
