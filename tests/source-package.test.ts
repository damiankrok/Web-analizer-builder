/**
 * STAGE WEB-PIVOT-03 — one source package, consumed identically everywhere.
 *
 * Up to STAGE WEB-PIVOT-02A three code paths decided which bytes an analysis
 * would see: the Node loader probed for larger copies and used them, the
 * standalone bundler re-parsed the page and published what the markup named,
 * and the browser worker re-parsed it a third time and matched images by
 * filename. They disagreed — measured here, on both development projects — and
 * nothing in either output said so.
 *
 * These tests hold the fix in place: one builder, one immutable package, one
 * hash, and two readers that have to agree on every field that matters.
 *
 * The package is built from the local fetch cache, so these tests never touch
 * the network — and one of them proves it by taking `fetch` away.
 */
import { describe, expect, it, beforeAll } from 'vitest'
import { buildSourcePackage } from '../src/node/source-package.js'
import { fetchWithCache, OfflineCacheMissError } from '../src/node/fetch-adapter.js'
import {
  SOURCE_PACKAGE_SCHEMA_VERSION,
  assetFileNameFor,
  canonicalPackageView,
  packageContentHash,
  packageIdFor,
  packageSealIntact,
  sealPackage,
  toParsedSource,
  type SourceAssetRecord,
  type SourcePackage,
} from '../src/core/contracts/source-package.js'
import {
  discoverEndpoints,
  discoverFromPage,
  discoverImages,
  parseSrcset,
  productOrigin,
} from '../src/core/source/discovery.js'
import { selectVariant, channelTrust, type MeasuredVariant } from '../src/core/source/variant-policy.js'
import { roleDimensions, sameDocument } from '../src/core/source/role-dimensions.js'
import { runStandalone, type StandaloneMessage } from '../src/web/standalone-worker.js'
import { canonicalJson } from '../src/core/util/hash.js'
import { PROJECTS } from '../src/node/projects.js'
import { readFileSync } from 'node:fs'

const projectA = PROJECTS.find((p) => p.key === 'A')!
const projectB = PROJECTS.find((p) => p.key === 'B')!

const buildFor = (p: typeof projectA) =>
  buildSourcePackage(p.url, {
    cacheDir: `fixtures/${p.slug}/assets`,
    htmlPath: `fixtures/${p.slug}/page.html`,
    offline: true,
  })

let A: SourcePackage
let B: SourcePackage

beforeAll(async () => {
  A = (await buildFor(projectA)).pkg
  B = (await buildFor(projectB)).pkg
}, 120_000)

const htmlA = readFileSync(`fixtures/${projectA.slug}/page.html`, 'utf8')
const CODE_A = 'm2fa281446a8ca'

const analysable = (pkg: SourcePackage): SourceAssetRecord[] => pkg.assets.filter((a) => a.analysable)
const byRole = (pkg: SourcePackage, role: string): SourceAssetRecord | undefined =>
  pkg.assets.find((a) => a.analysable && a.roles.analyzerRole === role)

// --------------------------------------------------------------------------
// 1. The contract.
// --------------------------------------------------------------------------

describe('source package — contract', () => {
  it('seals itself with a hash that is a pure function of its content', () => {
    expect(A.schemaVersion).toBe(SOURCE_PACKAGE_SCHEMA_VERSION)
    expect(packageSealIntact(A)).toBe(true)
    expect(A.packageId).toBe(packageIdFor(A.contentHash))
    // Sealing is idempotent: sealing a sealed package changes nothing.
    expect(sealPackage(A)).toEqual(A)
  })

  it('serialises and comes back identical', () => {
    const round = JSON.parse(canonicalJson(A)) as SourcePackage
    expect(packageSealIntact(round)).toBe(true)
    expect(round.contentHash).toBe(A.contentHash)
    expect(canonicalJson(canonicalPackageView(round))).toBe(canonicalJson(canonicalPackageView(A)))
    // Plain data only: nothing that JSON would quietly drop or mangle.
    expect(canonicalJson(round)).toBe(canonicalJson(A))
  })

  it('hashes the same content the same way twice', async () => {
    const again = (await buildFor(projectA)).pkg
    expect(again.contentHash).toBe(A.contentHash)
    expect(again.packageId).toBe(A.packageId)
  }, 60_000)

  it('excludes volatile metadata from the hash, and nothing else', () => {
    const volatile: SourcePackage = {
      ...A,
      fetchedAt: '2031-01-01T00:00:00.000Z',
      origin: 'PREBUILT_BUNDLE',
      toolVersions: { node: 'v99.0.0', builder: 'somewhere-else' },
      warnings: [...A.warnings, 'a warning from another machine'],
      discovery: [],
    }
    expect(packageContentHash(volatile)).toBe(A.contentHash)
  })

  it('moves the hash when anything that matters changes', () => {
    const first = A.assets[0]
    const cases: Array<[string, SourcePackage]> = [
      ['schema version', { ...A, schemaVersion: '9.9.9' }],
      ['project id', { ...A, projectId: 'somewhere-else' }],
      ['canonical url', { ...A, canonicalUrl: `${A.canonicalUrl}?x=1` }],
      ['page bytes', { ...A, document: { ...A.document, contentHash: 'deadbeef' } }],
      ['an asset byte hash', { ...A, assets: [{ ...first, contentHash: 'deadbeef' }, ...A.assets.slice(1)] }],
      ['a selected url', { ...A, assets: [{ ...first, selectedUrl: 'https://example.invalid/x.jpg' }, ...A.assets.slice(1)] }],
      ['a decoded size', { ...A, assets: [{ ...first, width: first.width + 1 }, ...A.assets.slice(1)] }],
      ['a logical role', { ...A, assets: [{ ...first, roles: { ...first.roles, storey: 'GROUND' as const } }, ...A.assets.slice(1)] }],
      ['a relation', { ...A, assets: [{ ...first, relations: [...first.relations, { kind: 'DUPLICATE_OF' as const, assetId: 'x', why: 'y' }] }, ...A.assets.slice(1)] }],
      ['an asset dropped', { ...A, assets: A.assets.slice(1) }],
    ]
    for (const [what, mutated] of cases) {
      expect(packageContentHash(mutated), what).not.toBe(A.contentHash)
    }
  })

  it('is order-independent: the same assets listed differently hash the same', () => {
    const reversed: SourcePackage = { ...A, assets: [...A.assets].reverse() }
    expect(packageContentHash(reversed)).toBe(A.contentHash)
  })

  it('identifies every asset by more than a filename', () => {
    for (const a of A.assets) {
      expect(a.assetId, a.selectedUrl).toMatch(/^asset_[0-9a-f]{12}$/)
      expect(a.projectId).toBe(A.projectId)
      expect(a.discoveredUrl.length).toBeGreaterThan(0)
      expect(a.canonicalUrl.length).toBeGreaterThan(0)
      expect(a.exposedBy.length).toBeGreaterThan(0)
      expect(a.selectionReason.length).toBeGreaterThan(10)
      expect(['OK', 'FAILED', 'NOT_FETCHED', 'REGISTERED_ONLY']).toContain(a.status)
      if (a.status === 'OK') {
        expect(a.contentHash).toMatch(/^[0-9a-f]{64}$/)
        expect(a.byteLength).toBeGreaterThan(0)
        expect(a.mediaType).toMatch(/^(image|application)\//)
      }
      if (a.analysable) {
        expect(a.width, a.label).toBeGreaterThan(0)
        expect(a.height, a.label).toBeGreaterThan(0)
      }
      if (a.status === 'FAILED') expect(a.error).toBeDefined()
    }
    // Ids are unique, and they are a function of the project and the URL.
    expect(new Set(A.assets.map((a) => a.assetId)).size).toBe(A.assets.length)
  })
})

// --------------------------------------------------------------------------
// 2. Roles in four dimensions, and variant relations.
// --------------------------------------------------------------------------

describe('source package — roles and relations', () => {
  it('keeps a dimensioned floor plan meaningful even when another plan is the primary view', () => {
    const plans = A.assets.filter((a) => a.roles.document === 'FLOOR_PLAN')
    expect(plans).toHaveLength(4)
    const ground = plans.filter((a) => a.roles.storey === 'GROUND')
    const upper = plans.filter((a) => a.roles.storey === 'UPPER_ATTIC')
    expect(ground).toHaveLength(2)
    expect(upper).toHaveLength(2)
    for (const pair of [ground, upper]) {
      expect(pair.map((a) => a.roles.annotation).sort()).toEqual(['AREA_LABELS', 'DIMENSIONED'])
      // The single-enum role still demotes one of them, exactly as before this
      // stage — and the dimensions no longer let that erase what it is.
      const demoted = pair.find((a) => a.roles.analyzerRole === 'PLAN_OTHER')!
      expect(demoted.roles.document).toBe('FLOOR_PLAN')
      expect(demoted.roles.storey).not.toBe('UNKNOWN')
      expect(demoted.roles.annotation).toBe('DIMENSIONED')
      // ...and they are recorded as one document with two published faces.
      expect(pair[0].relations.some((r) => r.kind === 'SAME_DOCUMENT_AS' && r.assetId === pair[1].assetId)).toBe(true)
      expect(pair[1].relations.some((r) => r.kind === 'SAME_DOCUMENT_AS' && r.assetId === pair[0].assetId)).toBe(true)
    }
  })

  it('separates the four dimensions from each other', () => {
    const front = byRole(A, 'ELEVATION_FRONT')!
    expect(front.roles.document).toBe('ELEVATION')
    expect(front.roles.storey).toBe('ALL')
    expect(front.roles.view).toBe('FRONT')
    expect(front.roles.projection).toBe('ORTHOGRAPHIC_TECHNICAL')
    const section = byRole(A, 'SECTION')!
    expect(section.roles.document).toBe('SECTION')
    expect(section.roles.storey).toBe('ALL')
    const site = byRole(A, 'SITE_PLAN')!
    expect(site.roles.document).toBe('SITE_PLAN')
    expect(site.roles.projection).toBe('PLANAR_DIAGRAM')
  })

  it('relates two published copies of the same view without merging them', () => {
    // ARCHON's render lightbox serves a 1600x900 hero; the page embeds an
    // 800x600 one. Different crops, so they are two assets — and the package
    // says they are the same view rather than silently preferring the larger.
    const heroes = A.assets.filter((a) => a.roles.view === 'HERO')
    expect(heroes.length).toBeGreaterThanOrEqual(2)
    const big = heroes.find((a) => a.width === 1600)
    expect(big, 'the render lightbox copy').toBeDefined()
    expect(big!.analysable).toBe(false)
    const analysed = heroes.find((a) => a.analysable)!
    expect(big!.relations.some((r) => r.kind === 'SAME_VIEW_AS' && r.assetId === analysed.assetId)).toBe(true)
  })

  it('records a copy it keeps only as evidence, and does not hand it to the analyzer', () => {
    const evidence = A.assets.filter((a) => !a.analysable)
    expect(evidence.length).toBeGreaterThan(0)
    const parsed = toParsedSource(A)
    for (const e of evidence) expect(parsed.assets.some((x) => x.id === e.assetId)).toBe(false)
    expect(parsed.assets).toHaveLength(analysable(A).length)
  })

  it('derives the dimensions without deciding the analyzer role', () => {
    const dims = roleDimensions({
      urlSlug: 'rzut-poddasza-z-powierzchniami-projekt-dom-x__11917',
      label: 'gotowy projekt rzut poddasza',
      channels: ['FLOOR_PLAN_ATTR'],
      analyzerRole: 'PLAN_OTHER',
      confidence: 0.4,
      evidence: ['FILENAME'],
      mediaType: 'image/gif',
    })
    expect(dims.document).toBe('FLOOR_PLAN')
    expect(dims.storey).toBe('UPPER_ATTIC')
    expect(dims.annotation).toBe('AREA_LABELS')
    // Carried through untouched: this stage changes bytes, not classification.
    expect(dims.analyzerRole).toBe('PLAN_OTHER')
    expect(dims.confidence).toBe(0.4)
    expect(sameDocument(dims, { ...dims, annotation: 'DIMENSIONED' })).toBe(true)
  })
})

// --------------------------------------------------------------------------
// 3. Discovery.
// --------------------------------------------------------------------------

describe('source package — discovery', () => {
  it('finds every channel the page actually uses, and says which', () => {
    const records = discoverFromPage(htmlA, projectA.url, CODE_A)
    const channels = new Set(records.map((r) => r.channel))
    expect(channels).toContain('IMG_SRC')
    expect(channels).toContain('ANCHOR_HREF')
    expect(channels).toContain('FLOOR_PLAN_ATTR')
    expect(channels).toContain('OG_IMAGE')
    expect(channels).toContain('FANCYBOX_AJAX')
    for (const r of records) {
      expect(r.exposedBy).toBe(projectA.url)
      expect(r.locator.length).toBeGreaterThan(3)
    }
  })

  it('resolves a root-relative product path onto the asset host, not the page host', () => {
    // The lightbox anchor is `/images/products/<code>/<file>.jpg`. Resolved
    // against the page it becomes a www.archon.pl URL that 404s and misses the
    // cache — which is exactly how one asset used to split into two.
    expect(productOrigin(htmlA, CODE_A, projectA.url)).toBe('https://assets.archon.pl')
    const anchors = discoverFromPage(htmlA, projectA.url, CODE_A).filter((r) => r.channel === 'ANCHOR_HREF')
    expect(anchors.length).toBeGreaterThan(0)
    for (const a of anchors) expect(a.url.startsWith('https://assets.archon.pl/')) .toBe(true)
  })

  it('reads a srcset as ordered candidates and nothing more', () => {
    expect(parseSrcset('a.jpg 1x, b.jpg 2x')).toEqual([
      { url: 'a.jpg', descriptor: '1x' },
      { url: 'b.jpg', descriptor: '2x' },
    ])
    expect(parseSrcset('')).toEqual([])
    const html = `<img src="https://assets.archon.pl/images/products/${CODE_A}/a__1.jpg" srcset="https://assets.archon.pl/images/products/${CODE_A}/a__2.jpg 2x">`
    const found = discoverImages(html, projectA.url, CODE_A)
    expect(found.map((f) => f.channel).sort()).toEqual(['IMG_SRC', 'IMG_SRCSET'])
  })

  it('finds the public AJAX endpoints and carries their captions', () => {
    const endpoints = discoverEndpoints(htmlA, projectA.url)
    expect(endpoints.length).toBeGreaterThanOrEqual(3)
    expect(endpoints.some((e) => e.url.includes('/product_fancybox_floor/'))).toBe(true)
    expect(endpoints.some((e) => e.url.includes('/product_fancybox_hotspot/'))).toBe(true)
    for (const e of endpoints) expect(e.label ?? '').toMatch(/marc/i)
  })

  it('keeps every discovered copy of an asset, not just the one it analysed', () => {
    const section = byRole(A, 'SECTION')!
    expect(section.variants.length).toBeGreaterThanOrEqual(2)
    const sizes = section.variants.filter((v) => v.width).map((v) => `${v.width}x${v.height}`)
    expect(sizes).toContain('1138x854')
    expect(sizes).toContain('400x300')
    expect(section.width).toBe(1138)
  })

  it('collapses two addresses for identical bytes into one asset', () => {
    // The site plan is linked as a lightbox original *and* guessed by the
    // variant convention. Same bytes, so one asset with both URLs recorded.
    const site = byRole(A, 'SITE_PLAN')!
    const hashes = site.variants.filter((v) => v.contentHash).map((v) => v.contentHash)
    expect(hashes.length).toBeGreaterThanOrEqual(2)
    expect(site.variants.some((v) => /byte-identical/.test(v.note))).toBe(true)
  })

  it('records that no larger copy exists rather than leaving a silence', () => {
    const hero = byRole(A, 'HERO_RENDER')!
    const guess = hero.variants.find((v) => v.channel === 'VARIANT_CONVENTION')
    expect(guess).toBeDefined()
    expect(guess!.status).toBe('FAILED')
    expect(guess!.note).toMatch(/no larger copy is published/)
  })
})

// --------------------------------------------------------------------------
// 4. The best-variant policy, on its own.
// --------------------------------------------------------------------------

describe('source package — best-variant policy', () => {
  const v = (over: Partial<MeasuredVariant>): MeasuredVariant => ({
    url: 'https://x/a.jpg',
    channel: 'IMG_SRC',
    width: 100,
    height: 100,
    byteLength: 1000,
    contentHash: 'a'.repeat(64),
    mediaType: 'image/jpeg',
    ...over,
  })

  it('prefers more real pixels of the same view', () => {
    const s = selectVariant([
      v({ url: 'https://x/small.jpg', width: 400, height: 300, contentHash: 'b'.repeat(64) }),
      v({ url: 'https://x/big.jpg', width: 1138, height: 854, channel: 'ANCHOR_HREF', contentHash: 'c'.repeat(64) }),
    ])!
    expect(s.selected.url).toBe('https://x/big.jpg')
    expect(s.ambiguous).toBe(false)
    expect(s.verdicts.find((x) => x.selected)!.reason).toMatch(/1138x854/)
  })

  it('refuses a larger image that is a different crop', () => {
    const s = selectVariant([
      v({ url: 'https://x/page.jpg', width: 800, height: 600, channel: 'ANCHOR_HREF', contentHash: 'b'.repeat(64) }),
      v({ url: 'https://x/wide.jpg', width: 1600, height: 900, contentHash: 'c'.repeat(64) }),
    ])!
    expect(s.selected.url).toBe('https://x/page.jpg')
    expect(s.verdicts.find((x) => x.url === 'https://x/wide.jpg')!.reason).toMatch(/different crop/)
  })

  it('treats byte-identical copies as one', () => {
    const s = selectVariant([
      v({ url: 'https://x/one.jpg' }),
      v({ url: 'https://x/two.jpg', channel: 'ANCHOR_HREF' }),
    ])!
    expect(s.verdicts.filter((x) => /byte-identical/.test(x.reason))).toHaveLength(1)
    expect(s.selected.url).toBe('https://x/one.jpg')
  })

  it('breaks a true tie by channel trust, then by URL, and says it was a tie', () => {
    expect(channelTrust('ANCHOR_HREF')).toBeGreaterThan(channelTrust('IMG_SRC'))
    expect(channelTrust('IMG_SRC')).toBeGreaterThan(channelTrust('VARIANT_CONVENTION'))
    const byTrust = selectVariant([
      v({ url: 'https://x/guess.jpg', channel: 'VARIANT_CONVENTION', contentHash: 'b'.repeat(64) }),
      v({ url: 'https://x/linked.jpg', channel: 'ANCHOR_HREF', contentHash: 'c'.repeat(64) }),
    ])!
    expect(byTrust.selected.url).toBe('https://x/linked.jpg')
    expect(byTrust.ambiguous).toBe(false)
    const tied = selectVariant([
      v({ url: 'https://x/zzz.jpg', contentHash: 'b'.repeat(64) }),
      v({ url: 'https://x/aaa.jpg', contentHash: 'c'.repeat(64) }),
    ])!
    expect(tied.selected.url).toBe('https://x/aaa.jpg')
    expect(tied.ambiguous).toBe(true)
  })

  it('is a function of its input, not of the order it is given', () => {
    const list = [
      v({ url: 'https://x/a.jpg', width: 400, height: 300, contentHash: 'b'.repeat(64) }),
      v({ url: 'https://x/b.jpg', width: 1138, height: 854, contentHash: 'c'.repeat(64) }),
      v({ url: 'https://x/c.jpg', width: 800, height: 600, contentHash: 'd'.repeat(64) }),
    ]
    const forward = selectVariant(list)!
    const backward = selectVariant([...list].reverse())!
    expect(backward.selected.url).toBe(forward.selected.url)
    expect(canonicalJson(backward.verdicts.map((x) => x.url).sort())).toBe(canonicalJson(forward.verdicts.map((x) => x.url).sort()))
  })

  it('returns nothing for nothing', () => {
    expect(selectVariant([])).toBeNull()
  })
})

// --------------------------------------------------------------------------
// 5. Offline means offline.
// --------------------------------------------------------------------------

describe('source package — strict offline', () => {
  it('makes no request at all when the cache has what it needs', async () => {
    const real = globalThis.fetch
    let attempts = 0
    globalThis.fetch = (...args: Parameters<typeof fetch>) => {
      attempts++
      throw new Error(`the offline build tried to fetch ${String(args[0])}`)
    }
    try {
      const { pkg } = await buildFor(projectA)
      expect(attempts).toBe(0)
      expect(pkg.contentHash).toBe(A.contentHash)
      expect(pkg.origin).toBe('LOCAL_CACHE')
    } finally {
      globalThis.fetch = real
    }
  }, 60_000)

  it('fails explicitly on a cache miss instead of quietly fetching', async () => {
    const real = globalThis.fetch
    let attempts = 0
    globalThis.fetch = (...args: Parameters<typeof fetch>) => {
      attempts++
      throw new Error(`should not have been called: ${String(args[0])}`)
    }
    try {
      await expect(
        fetchWithCache('https://assets.archon.pl/images/products/nope/nothing__1.jpg', 'image', 'fixtures/A-marcowki/assets', {
          offline: true,
        }),
      ).rejects.toBeInstanceOf(OfflineCacheMissError)
      expect(attempts).toBe(0)
    } finally {
      globalThis.fetch = real
    }
  })

  it('records a cache miss in the package rather than dropping it', async () => {
    const real = globalThis.fetch
    globalThis.fetch = () => {
      throw new Error('offline')
    }
    try {
      const { pkg, images } = await buildSourcePackage(projectA.url, {
        cacheDir: 'out/test-empty-cache',
        htmlPath: `fixtures/${projectA.slug}/page.html`,
        offline: true,
      })
      expect(images.size).toBe(0)
      expect(pkg.missing.length).toBeGreaterThan(0)
      expect(pkg.missing.some((m) => m.error.code === 'OFFLINE_CACHE_MISS')).toBe(true)
      // Expected roles are named as missing, not silently absent.
      expect(pkg.missing.some((m) => m.error.code === 'ROLE_MISSING' && m.what.includes('SECTION'))).toBe(true)
      // And no asset pretends to have bytes it does not have.
      for (const a of pkg.assets) expect(a.analysable && a.width > 0).toBe(false)
    } finally {
      globalThis.fetch = real
    }
  }, 60_000)
})

// --------------------------------------------------------------------------
// 6. Parity: the CLI and the browser worker on one package.
// --------------------------------------------------------------------------

/** The per-asset facts the stage brief requires to be equal across hosts. */
const facts = (pkg: SourcePackage): string =>
  canonicalJson(
    [...pkg.assets]
      .sort((a, b) => (a.assetId < b.assetId ? -1 : 1))
      .map((a) => ({
        assetId: a.assetId,
        selectedUrl: a.selectedUrl,
        contentHash: a.contentHash,
        width: a.width,
        height: a.height,
        byteLength: a.byteLength,
        mediaType: a.mediaType,
        analysable: a.analysable,
        roles: a.roles,
        relations: [...a.relations].sort((x, y) => (x.kind + x.assetId < y.kind + y.assetId ? -1 : 1)),
      })),
  )

describe.each([
  ['A', () => A],
  ['B', () => B],
])('source package — CLI/web parity for project %s', (_key, get) => {
  it('hands both hosts the identical package', () => {
    const pkg = get()
    // The bundler serialises the package with one field changed — the origin,
    // because a bundled copy *is* prebuilt — and nothing else.
    const web = JSON.parse(canonicalJson({ ...pkg, origin: 'PREBUILT_BUNDLE' })) as SourcePackage
    expect(web.contentHash).toBe(pkg.contentHash)
    expect(web.packageId).toBe(pkg.packageId)
    expect(web.schemaVersion).toBe(pkg.schemaVersion)
    expect(web.assets).toHaveLength(pkg.assets.length)
    expect(web.assets.map((a) => a.assetId).sort()).toEqual(pkg.assets.map((a) => a.assetId).sort())
    expect(facts(web)).toBe(facts(pkg))
    expect(packageSealIntact(web)).toBe(true)
  })

  it('narrows to the same analyzer input on both hosts', () => {
    const pkg = get()
    const web = JSON.parse(canonicalJson({ ...pkg, origin: 'PREBUILT_BUNDLE' })) as SourcePackage
    const cliView = toParsedSource(pkg)
    const webView = toParsedSource(web)
    expect(canonicalJson(cliView.assets)).toBe(canonicalJson(webView.assets))
    expect(canonicalJson(cliView.facts)).toBe(canonicalJson(webView.facts))
    expect(canonicalJson(cliView.rooms)).toBe(canonicalJson(webView.rooms))
    // Every analysed asset resolves to a published file name both hosts compute
    // the same way, so nothing anywhere matches on a filename.
    for (const a of pkg.assets) {
      if (!a.analysable) continue
      expect(assetFileNameFor(a.contentHash, a.mediaType)).toMatch(/^[0-9a-f]{32}\.(jpg|png|gif|webp)$/)
    }
  })

  it('refuses a package whose seal has been broken', () => {
    const pkg = get()
    const tampered: SourcePackage = {
      ...pkg,
      assets: pkg.assets.map((a, i) => (i === 0 ? { ...a, selectedUrl: 'https://example.invalid/other.jpg' } : a)),
    }
    expect(packageSealIntact(tampered)).toBe(false)
    const messages: StandaloneMessage[] = []
    expect(() => runStandalone({ manifest: canonicalJson(tampered), images: [], maxRepairCycles: 0 }, (m) => messages.push(m))).toThrow(
      /does not match its own hash/,
    )
  })
})

describe('source package — the historical mismatch', () => {
  it('gives both hosts the high-resolution section, on both projects', () => {
    // The defect this stage exists to remove: the CLI probed for the section
    // original and analysed it at 1138x854, while the bundler published the
    // 400x300 page thumbnail and the browser analysed that. Measured on the
    // pre-stage tree at 1 differing asset out of 12 (A) and 24 (B) — and the
    // one that differed was the section, which carries the level datums.
    for (const pkg of [A, B]) {
      const section = byRole(pkg, 'SECTION')!
      expect(section.width, pkg.projectId).toBe(1138)
      expect(section.height, pkg.projectId).toBe(854)
      expect(section.selectedUrl, pkg.projectId).toMatch(/__11256\.jpg$/)
      // The thumbnail is still on the record, as a rejected variant.
      const page = section.variants.find((v) => /__256\.jpg$/.test(v.url))!
      expect(page.width).toBe(400)
      expect(page.note).toMatch(/fewer real pixels/)
      // And the package says so once, for whoever reads it next.
      expect(section.selectionReason).toMatch(/1138x854/)
    }
  })
})

// --------------------------------------------------------------------------
// 7. The gold compiler stays out of the analyzer.
// --------------------------------------------------------------------------

describe('gold compiler isolation', () => {
  it('is not reachable from any automatic analyzer module', async () => {
    const { readdirSync, statSync } = await import('node:fs')
    const { join } = await import('node:path')
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const p = join(dir, name)
        return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') || p.endsWith('.tsx') ? [p] : []
      })
    // `scripts/` is deliberately out of scope: everything there is a
    // development tool run by hand, and several exist precisely to measure the
    // gold fixture. The claim being made is about the *automatic* pipeline —
    // everything under `src/` that a run of the analyzer can reach.
    const offenders: string[] = []
    for (const file of walk('src')) {
      if (file.startsWith('src/core/wallspec/')) continue
      const text = readFileSync(file, 'utf8')
      if (/marcowki-fixture|research\/gold/.test(text)) offenders.push(file)
    }
    expect(offenders).toEqual([])
  })

  it('keeps the gold numbers out of every analyzer export', async () => {
    // A stronger form: no analyzer module may import the wallspec package at all.
    const { readdirSync, statSync } = await import('node:fs')
    const { join } = await import('node:path')
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const p = join(dir, name)
        return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') || p.endsWith('.tsx') ? [p] : []
      })
    const analyzer = walk('src').filter(
      (f) => !f.startsWith('src/core/wallspec/') && (f.startsWith('src/core/') || f.startsWith('src/node/') || f.startsWith('src/web/')),
    )
    for (const file of analyzer) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/wallspec/)
    }
  })
})
