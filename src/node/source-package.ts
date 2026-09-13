/**
 * The one authoritative SourcePackage builder — STAGE WEB-PIVOT-03.
 *
 *     ARCHON page  ->  discovery  ->  fetch + decode  ->  variant policy  ->  sealed package
 *
 * Everything that analyses an ARCHON project consumes the output of this
 * function: the CLI, the research commands, the standalone bundler and, through
 * the bundle, the browser worker. Before this stage each of those re-derived
 * its own asset list from raw HTML and they disagreed — the CLI read the 2.3x
 * section original because it probed for one, the hosted build read the page
 * thumbnail because the markup named that. Nothing said so.
 *
 * There is exactly one place in the repository that decides which bytes an
 * analysis sees, and this is it.
 *
 * ## Offline is offline
 *
 * With `offline: true` nothing touches the network. A cache miss throws
 * `OfflineCacheMissError` and lands in the package as an `OFFLINE_CACHE_MISS`
 * record; it is never repaired by a quiet request. An "offline" mode that
 * usually uses the cache but may fetch is not a mode, it is a coincidence, and
 * a reproducibility claim built on one says nothing.
 *
 * NODE_ONLY — it does I/O. The contract, the discovery, the role dimensions and
 * the variant policy are all pure and live in `core/`.
 */
import { readFile } from 'node:fs/promises'
import type { RasterImage } from '../core/contracts/raster.js'
import type { SourceAsset } from '../core/contracts/source.js'
import type {
  AcquisitionStatus,
  AssetRelation,
  DiscoveryChannel,
  PackageOrigin,
  SourceAssetRecord,
  SourceDiscoveryRecord,
  SourceErrorRecord,
  SourceMissingRecord,
  SourcePackage,
  SourceVariantRecord,
} from '../core/contracts/source-package.js'
import { SOURCE_PACKAGE_SCHEMA_VERSION, sealPackage } from '../core/contracts/source-package.js'
import { parseArchonPage, extractProjectCode } from '../core/source/archon-parser.js'
import { discoverFromPage, discoverImages, floorPlanGroups } from '../core/source/discovery.js'
import { roleDimensions, sameDocument, sameView } from '../core/source/role-dimensions.js'
import { selectVariant, type MeasuredVariant } from '../core/source/variant-policy.js'
import { classifyByMetadata, classifyByPixels } from '../core/source/role-classifier.js'
import { toGray } from '../core/raster/gray.js'
import { resolutionCandidates } from '../core/source/resolution.js'
import { ARCHON_POLICY } from '../core/source/fetch-policy.js'
import { fetchWithCache, mapConcurrent, OfflineCacheMissError } from './fetch-adapter.js'
import { decodeImage } from './image-decode.js'
import { mkId } from '../core/util/ids.js'
import { sha256 } from '../core/util/hash.js'

export type BuildPackageOptions = {
  /** Directory used both as an HTTP cache and as the offline store. */
  cacheDir: string
  /** Local HTML to use instead of fetching the page. */
  htmlPath?: string
  /** Refuse the network. A cache miss is then a recorded failure, never a fetch. */
  offline?: boolean
  /** Upper bound on candidate copies fetched. Beyond it, candidates are recorded unfetched. */
  maxFetches?: number
  /** Stamped into the package. Not hashed. */
  toolVersions?: Record<string, string>
}

export type BuiltPackage = {
  pkg: SourcePackage
  /** Decoded rasters for the selected copy of every analysable asset, by assetId. */
  images: Map<string, RasterImage>
}

/** Magic-byte sniff: the fetch cache stores every body under a `.bin` name. */
export function sniffMediaType(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg'
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png'
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return 'image/gif'
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57) return 'image/webp'
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return 'application/pdf'
  return 'application/octet-stream'
}

/** File extension conventionally used for a media type. */
export const extensionFor = (mediaType: string): string =>
  ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'application/pdf': 'pdf' })[
    mediaType
  ] ?? 'bin'

const slugOf = (url: string): string =>
  url.slice(url.lastIndexOf('/') + 1).replace(/\.[a-z0-9]+$/i, '')

const errorFrom = (err: unknown, url: string): SourceErrorRecord => {
  if (err instanceof OfflineCacheMissError) {
    return { code: 'OFFLINE_CACHE_MISS', message: err.message, url }
  }
  const message = err instanceof Error ? err.message : String(err)
  if (/fetch policy rejected redirect/i.test(message)) return { code: 'REDIRECT_REJECTED', message, url }
  if (/image type not allowed|content-type/i.test(message)) return { code: 'UNSUPPORTED_MEDIA_TYPE', message, url }
  if (/decode|unsupported image/i.test(message)) return { code: 'DECODE_FAILED', message, url }
  if (/host not on allowlist/i.test(message)) return { code: 'REDIRECT_REJECTED', message, url }
  return { code: 'DOWNLOAD_FAILED', message, url }
}

/** One fetched-and-measured candidate copy. */
type Measured = {
  url: string
  channel: DiscoveryChannel
  bytes: Uint8Array
  mediaType: string
  contentHash: string
  image: RasterImage | null
  error: SourceErrorRecord | null
}

/**
 * Build a package for one project page.
 *
 * The steps are separated so that each one can be read on its own: discover,
 * measure, group, select, relate, seal. The only ordering that matters is that
 * selection happens after measurement — the whole point of the policy is that
 * it chooses on decoded pixels rather than on what a URL looks like.
 */
export async function buildSourcePackage(
  canonicalUrl: string,
  opts: BuildPackageOptions,
): Promise<BuiltPackage> {
  const missing: SourceMissingRecord[] = []
  const maxFetches = opts.maxFetches ?? ARCHON_POLICY.maxAssets * 2

  // --- 1. The page -------------------------------------------------------
  let htmlBytes: Uint8Array
  let pageOrigin: PackageOrigin
  if (opts.htmlPath) {
    htmlBytes = new Uint8Array(await readFile(opts.htmlPath))
    pageOrigin = 'LOCAL_CACHE'
  } else {
    const res = await fetchWithCache(canonicalUrl, 'html', opts.cacheDir, { offline: opts.offline })
    htmlBytes = res.bytes
    pageOrigin = res.fromCache ? 'LOCAL_CACHE' : 'LIVE_FETCH'
  }
  const html = new TextDecoder().decode(htmlBytes)
  const parsed = parseArchonPage(html, canonicalUrl)
  const projectCode = extractProjectCode(canonicalUrl, html)

  // --- 2. Discovery ------------------------------------------------------
  const discovery: SourceDiscoveryRecord[] = discoverFromPage(html, canonicalUrl, projectCode)

  // Public AJAX fragments. They expose no larger copies on this publisher, but
  // they state which copies of a drawing belong together, which is the one
  // thing a filename comparison can only guess at.
  const fragments: Array<{ url: string; html: string }> = []
  for (const endpoint of discovery.filter((d) => d.channel === 'FANCYBOX_AJAX')) {
    try {
      const res = await fetchWithCache(endpoint.url, 'html', opts.cacheDir, { offline: opts.offline })
      const text = new TextDecoder().decode(res.bytes)
      fragments.push({ url: endpoint.url, html: text })
      // The caption the page anchor carries wins over the fragment's own alt
      // text. The anchor says what the endpoint shows — "widok 1" — while the
      // fragment echoes the filename back, and echoing a filename is precisely
      // the kind of identification this stage is meant to stop relying on.
      // Carrying the caption across is what lets a 1600x900 copy served by the
      // render lightbox be recognised as the same view as the 800x600 one on
      // the page.
      discovery.push(
        ...discoverImages(text, endpoint.url, projectCode).map((d) => ({
          ...d,
          ...(endpoint.label ? { label: endpoint.label } : d.label ? { label: d.label } : {}),
        })),
      )
    } catch (err) {
      missing.push({ what: `fancybox fragment ${endpoint.url}`, error: errorFrom(err, endpoint.url) })
    }
  }

  // Conventional larger copies. A guess, so it is recorded as one and kept only
  // if it downloads and decodes to strictly more pixels of the same view.
  const known = new Set(discovery.map((d) => d.url))
  for (const url of [...known]) {
    for (const candidate of resolutionCandidates(url)) {
      if (known.has(candidate)) continue
      known.add(candidate)
      discovery.push({
        url: candidate,
        channel: 'VARIANT_CONVENTION',
        exposedBy: url,
        locator: 'variant-id convention __<n> -> __<n+11000>',
      })
    }
  }

  // --- 3. Measure every candidate ---------------------------------------
  const imageUrls = [...new Set(discovery.filter((d) => d.channel !== 'DOCUMENT_LINK' && d.channel !== 'FANCYBOX_AJAX').map((d) => d.url))].sort()
  const budgeted = imageUrls.slice(0, maxFetches)
  for (const url of imageUrls.slice(maxFetches)) {
    missing.push({
      what: `candidate copy ${url}`,
      error: { code: 'DOWNLOAD_FAILED', message: `beyond the ${maxFetches}-fetch budget for one package`, url },
    })
  }

  const channelOf = (url: string): DiscoveryChannel => {
    const records = discovery.filter((d) => d.url === url)
    // The strongest channel a URL was seen in is the claim the package records.
    const order: DiscoveryChannel[] = [
      'ANCHOR_HREF',
      'FLOOR_PLAN_ATTR',
      'OG_IMAGE',
      'FANCYBOX_AJAX',
      'IMG_SRCSET',
      'IMG_SRC',
      'IMG_LAZY_ATTR',
      'DOCUMENT_LINK',
      'VARIANT_CONVENTION',
    ]
    for (const c of order) if (records.some((r) => r.channel === c)) return c
    return 'IMG_SRC'
  }

  let anythingLive = pageOrigin === 'LIVE_FETCH'
  const measured = new Map<string, Measured>()
  const results = await mapConcurrent(budgeted, ARCHON_POLICY.concurrency, async (url): Promise<Measured> => {
    const channel = channelOf(url)
    try {
      const res = await fetchWithCache(url, 'image', opts.cacheDir, { offline: opts.offline })
      if (!res.fromCache) anythingLive = true
      const mediaType = sniffMediaType(res.bytes)
      let image: RasterImage | null = null
      let error: SourceErrorRecord | null = null
      try {
        image = decodeImage(res.bytes)
      } catch (err) {
        error = { code: 'DECODE_FAILED', message: err instanceof Error ? err.message : String(err), url }
      }
      return { url, channel, bytes: res.bytes, mediaType, contentHash: res.sha256, image, error }
    } catch (err) {
      return {
        url,
        channel,
        bytes: new Uint8Array(),
        mediaType: 'application/octet-stream',
        contentHash: '',
        image: null,
        error: errorFrom(err, url),
      }
    }
  })
  for (const m of results) measured.set(m.url, m)

  // --- 4. Group candidates into logical assets --------------------------
  //
  // One logical asset is one drawing, however many resolutions of it the
  // publisher offers. Three things put two URLs in the same class, and none of
  // them is a filename resemblance: the page linked one as the other's
  // lightbox original, one is the other's conventional upgrade, or the two
  // decoded to byte-identical content.
  const group = new Map<string, string>()
  const find = (u: string): string => {
    let x = u
    while (group.get(x) !== x) x = group.get(x) ?? x
    return x
  }
  const link = (a: string, b: string): void => {
    if (!group.has(a)) group.set(a, a)
    if (!group.has(b)) group.set(b, b)
    group.set(find(a), find(b))
  }
  for (const url of budgeted) if (!group.has(url)) group.set(url, url)
  for (const d of discovery) {
    if (d.channel !== 'VARIANT_CONVENTION') continue
    // Linked whether or not the guess resolved. A conventional URL that 404s is
    // a fact about *the asset it was guessed from* — "no larger copy is
    // published" — and belongs on that asset's record as a rejected variant. Let
    // loose it would become a phantom asset of its own, which is how a source
    // inventory comes to list drawings that do not exist.
    if (group.has(d.exposedBy)) link(d.url, d.exposedBy)
  }
  // The parser already worked out which page copy each lightbox original backs.
  for (const a of parsed.assets) {
    const urls = (a.variants ?? []).map((v) => v.url).filter((u) => group.has(u))
    for (let i = 1; i < urls.length; i++) link(urls[0], urls[i])
  }
  // Byte-identical copies are one file at two addresses.
  const byHash = new Map<string, string>()
  for (const url of budgeted) {
    const m = measured.get(url)
    if (!m?.contentHash) continue
    const first = byHash.get(m.contentHash)
    if (first) link(first, url)
    else byHash.set(m.contentHash, url)
  }

  const classes = new Map<string, string[]>()
  for (const url of budgeted) {
    const root = find(url)
    const list = classes.get(root) ?? []
    list.push(url)
    classes.set(root, list)
  }

  // --- 5. Select, classify, record --------------------------------------
  //
  // `analysable` reproduces the parser's own final selection so that the
  // analyzer receives exactly the asset list it received before this stage.
  // Copies the parser set aside stay in the package as evidence, related to the
  // asset that represents them, which is what §9 of the brief asks for and what
  // the old pipeline could not do.
  const parsedByUrl = new Map<string, SourceAsset>()
  for (const a of parsed.assets) {
    parsedByUrl.set(a.url, a)
    for (const v of a.variants ?? []) parsedByUrl.set(v.url, a)
  }

  const assets: SourceAssetRecord[] = []
  const images = new Map<string, RasterImage>()

  for (const [, urls] of [...classes].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const candidates: MeasuredVariant[] = []
    for (const url of urls) {
      const m = measured.get(url)
      if (!m?.image) continue
      candidates.push({
        url,
        channel: m.channel,
        width: m.image.width,
        height: m.image.height,
        byteLength: m.bytes.byteLength,
        contentHash: m.contentHash,
        mediaType: m.mediaType,
      })
    }

    const discoveredUrl = [...urls].sort((a, b) => {
      const ca = discovery.findIndex((d) => d.url === a)
      const cb = discovery.findIndex((d) => d.url === b)
      return (ca < 0 ? 1e9 : ca) - (cb < 0 ? 1e9 : cb)
    })[0]
    const firstRecord = discovery.find((d) => d.url === discoveredUrl)
    const assetId = mkId('asset', `${projectCode}|${discoveredUrl}`)

    const selection = selectVariant(candidates)
    if (!selection) {
      // Nothing in this class decoded. Record the failure rather than drop it.
      const failed = urls.map((u) => measured.get(u)).find((m) => m?.error)
      assets.push({
        assetId,
        projectId: projectCode,
        selectedUrl: discoveredUrl,
        discoveredUrl,
        canonicalUrl: discoveredUrl,
        exposedBy: firstRecord?.exposedBy ?? canonicalUrl,
        channel: firstRecord?.channel ?? 'IMG_SRC',
        label: firstRecord?.label ?? slugOf(discoveredUrl),
        mediaType: failed?.mediaType ?? 'application/octet-stream',
        width: 0,
        height: 0,
        byteLength: failed?.bytes.byteLength ?? 0,
        contentHash: failed?.contentHash ?? '',
        roles: roleDimensions({
          urlSlug: slugOf(discoveredUrl),
          label: firstRecord?.label ?? '',
          channels: [firstRecord?.channel ?? 'IMG_SRC'],
          analyzerRole: 'UNKNOWN_ASSET',
          confidence: 0,
          evidence: ['DEFAULT'],
          mediaType: 'application/octet-stream',
        }),
        analysable: false,
        variants: urls.map((u) => {
          const m = measured.get(u)
          return {
            url: u,
            channel: m?.channel ?? 'IMG_SRC',
            status: 'FAILED' as AcquisitionStatus,
            note: 'not usable',
            ...(m?.error ? { error: m.error } : {}),
          }
        }),
        relations: [],
        selectionReason: 'no copy of this asset could be fetched and decoded',
        status: 'FAILED',
        error: failed?.error ?? { code: 'DOWNLOAD_FAILED', message: 'no copy available', url: discoveredUrl },
      })
      missing.push({
        what: `asset ${slugOf(discoveredUrl)}`,
        error: failed?.error ?? { code: 'DOWNLOAD_FAILED', message: 'no copy available', url: discoveredUrl },
      })
      continue
    }

    const chosen = selection.selected
    const chosenMeasured = measured.get(chosen.url)!
    const parserAsset = urls.map((u) => parsedByUrl.get(u)).find((a) => a !== undefined)
    const analysable = parserAsset !== undefined

    // Roles. The single-enum value is the parser's, unchanged, so the analyzer
    // sees what it always saw; a copy the parser set aside is classified from
    // its own metadata so the package can still say what it is.
    const label = parserAsset?.label ?? firstRecord?.label ?? slugOf(discoveredUrl)
    const fallback = classifyByMetadata({ urlSlug: slugOf(discoveredUrl), alt: label })
    let analyzerRole = parserAsset?.role ?? fallback.role
    let confidence = parserAsset?.roleConfidence ?? fallback.confidence
    let evidence = parserAsset?.roleEvidence ?? fallback.evidence
    // Pixel inference, exactly where the loader used to run it: on assets that
    // metadata could not place, and nowhere else.
    if (analyzerRole === 'UNKNOWN_ASSET' && chosenMeasured.image) {
      const guess = classifyByPixels(chosenMeasured.image, toGray(chosenMeasured.image))
      analyzerRole = guess.role
      confidence = guess.confidence
      evidence = [...evidence, ...guess.evidence]
    }

    const channels = [...new Set(urls.flatMap((u) => discovery.filter((d) => d.url === u).map((d) => d.channel)))]
    const roles = roleDimensions({
      urlSlug: slugOf(discoveredUrl),
      label,
      channels,
      analyzerRole,
      confidence,
      evidence,
      mediaType: chosen.mediaType,
    })

    const variants: SourceVariantRecord[] = selection.verdicts.map((v) => {
      const m = measured.get(v.url)
      return {
        url: v.url,
        channel: m?.channel ?? 'IMG_SRC',
        status: (m?.image ? 'OK' : m?.error ? 'FAILED' : 'NOT_FETCHED') as AcquisitionStatus,
        ...(m?.mediaType ? { mediaType: m.mediaType } : {}),
        ...(m?.image ? { width: m.image.width, height: m.image.height } : {}),
        ...(m ? { byteLength: m.bytes.byteLength } : {}),
        ...(m?.contentHash ? { contentHash: m.contentHash } : {}),
        note: v.reason,
        ...(m?.error ? { error: m.error } : {}),
      }
    })
    // Candidates that never made it into the verdict list because they failed
    // outright still belong on the record. A conventional guess that does not
    // resolve is the evidence for "no larger copy is published", which §8 of
    // the brief asks to be recorded rather than left as a silence.
    for (const u of urls) {
      if (variants.some((v) => v.url === u)) continue
      const m = measured.get(u)
      const conventional = m?.channel === 'VARIANT_CONVENTION'
      variants.push({
        url: u,
        channel: m?.channel ?? 'VARIANT_CONVENTION',
        status: m?.error ? 'FAILED' : 'NOT_FETCHED',
        note: !m?.error
          ? 'discovered but not fetched'
          : conventional
            ? `no larger copy is published at the conventional address (${m.error.code})`
            : `could not be used (${m.error.code})`,
        ...(m?.error ? { error: m.error } : {}),
      })
    }

    // The largest copy known to exist, whether or not it was chosen.
    const largest = [...candidates].sort((a, b) => b.width * b.height - a.width * a.height)[0]

    if (selection.ambiguous) {
      missing.push({
        what: `variant choice for ${slugOf(discoveredUrl)}`,
        error: {
          code: 'AMBIGUOUS_VARIANT',
          message: 'two copies were equal on decoded size and channel trust; the URL order decided',
          url: chosen.url,
        },
      })
    }

    assets.push({
      assetId,
      projectId: projectCode,
      selectedUrl: chosen.url,
      discoveredUrl,
      canonicalUrl: largest?.url ?? chosen.url,
      exposedBy: firstRecord?.exposedBy ?? canonicalUrl,
      channel: chosenMeasured.channel,
      label,
      mediaType: chosen.mediaType,
      width: chosen.width,
      height: chosen.height,
      byteLength: chosen.byteLength,
      contentHash: chosen.contentHash,
      roles,
      analysable,
      variants,
      relations: [],
      selectionReason: selection.verdicts.find((v) => v.selected)?.reason ?? 'only copy',
      status: 'OK',
    })
    if (analysable && chosenMeasured.image) images.set(assetId, chosenMeasured.image)
  }

  // --- 6. Relations ------------------------------------------------------
  const relate = (fromId: string, kind: AssetRelation['kind'], toId: string, why: string): void => {
    const a = assets.find((x) => x.assetId === fromId)
    if (!a || fromId === toId) return
    if (a.relations.some((r) => r.kind === kind && r.assetId === toId)) return
    a.relations.push({ kind, assetId: toId, why })
  }

  for (const a of assets) {
    for (const b of assets) {
      if (a.assetId >= b.assetId) continue
      if (a.contentHash && a.contentHash === b.contentHash) {
        relate(a.assetId, 'DUPLICATE_OF', b.assetId, `identical bytes (${a.contentHash.slice(0, 12)})`)
        relate(b.assetId, 'DUPLICATE_OF', a.assetId, `identical bytes (${a.contentHash.slice(0, 12)})`)
        continue
      }
      if (sameDocument(a.roles, b.roles) && a.roles.annotation !== b.roles.annotation) {
        const why = `same ${a.roles.document.toLowerCase().replace('_', ' ')}, published ${a.roles.annotation} and ${b.roles.annotation}`
        relate(a.assetId, 'SAME_DOCUMENT_AS', b.assetId, why)
        relate(b.assetId, 'SAME_DOCUMENT_AS', a.assetId, why)
      } else if (sameView(a.roles, b.roles)) {
        const why = `same ${a.roles.view.toLowerCase()} view`
        relate(a.assetId, 'SAME_VIEW_AS', b.assetId, why)
        relate(b.assetId, 'SAME_VIEW_AS', a.assetId, why)
      }
    }
  }

  // The publisher's own grouping, from the floor fancybox fragments. Stronger
  // than the filename-derived relation above, so it is recorded even where that
  // one already fired — with its own reason.
  for (const g of floorPlanGroups(fragments, projectCode)) {
    const ids = g.map((u) => assets.find((a) => a.variants.some((v) => v.url === u))?.assetId).filter((x): x is string => !!x)
    for (const a of ids) {
      for (const b of ids) relate(a, 'SAME_DOCUMENT_AS', b, 'published together in the same floor-plan fancybox fragment')
    }
  }

  // A copy the parser set aside is not lost; it points at the one that stands in for it.
  for (const a of assets) {
    if (a.analysable) continue
    const stand = assets.find((b) => b.analysable && (sameView(a.roles, b.roles) || sameDocument(a.roles, b.roles)))
    if (stand) relate(a.assetId, 'VARIANT_OF', stand.assetId, 'kept as evidence; the related asset is the one analysed')
  }

  // --- 7. Documents, expectations, seal ---------------------------------
  for (const d of discovery.filter((x) => x.channel === 'DOCUMENT_LINK')) {
    if (assets.some((a) => a.selectedUrl === d.url)) continue
    assets.push({
      assetId: mkId('asset', `${projectCode}|${d.url}`),
      projectId: projectCode,
      selectedUrl: d.url,
      discoveredUrl: d.url,
      canonicalUrl: d.url,
      exposedBy: d.exposedBy,
      channel: 'DOCUMENT_LINK',
      label: d.label ?? slugOf(d.url),
      mediaType: 'application/pdf',
      width: 0,
      height: 0,
      byteLength: 0,
      contentHash: '',
      roles: roleDimensions({
        urlSlug: slugOf(d.url),
        label: d.label ?? '',
        channels: ['DOCUMENT_LINK'],
        analyzerRole: 'UNKNOWN_ASSET',
        confidence: 0,
        evidence: ['DOM_CONTEXT'],
        mediaType: 'application/pdf',
      }),
      analysable: false,
      variants: [{ url: d.url, channel: 'DOCUMENT_LINK', status: 'REGISTERED_ONLY', note: 'official document, registered as evidence' }],
      relations: [],
      selectionReason: 'a published document, registered rather than rasterised at this stage',
      status: 'REGISTERED_ONLY',
    })
  }

  // Roles the analyzer expects to find. Their absence is a fact about the
  // source, so it is recorded rather than discovered later as a silence.
  for (const want of ['SECTION', 'ELEVATION_FRONT', 'PLAN_GROUND'] as const) {
    if (assets.some((a) => a.analysable && a.roles.analyzerRole === want)) continue
    missing.push({ what: `role ${want}`, error: { code: 'ROLE_MISSING', message: `no analysable asset carries the role ${want}` } })
  }

  const draft: SourcePackage = {
    schemaVersion: SOURCE_PACKAGE_SCHEMA_VERSION,
    packageId: '',
    projectId: projectCode,
    canonicalUrl,
    identity: parsed.identity,
    document: {
      url: canonicalUrl,
      mediaType: 'text/html',
      byteLength: htmlBytes.byteLength,
      contentHash: sha256(htmlBytes),
      status: 'OK',
    },
    assets,
    missing,
    discovery,
    facts: parsed.facts,
    rooms: parsed.rooms,
    notes: parsed.notes,
    warnings: parsed.warnings,
    toolVersions: opts.toolVersions ?? {},
    origin: anythingLive ? 'LIVE_FETCH' : pageOrigin,
    contentHash: '',
  }
  return { pkg: sealPackage(draft), images }
}
