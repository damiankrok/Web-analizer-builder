/**
 * Source discovery — STAGE WEB-PIVOT-03. Pure: markup in, candidate URLs out.
 *
 * ## What this is for
 *
 * The parser in `archon-parser.ts` answers "what assets does this page have",
 * and to do that it has to decide things: which of two copies of a drawing is
 * *the* copy, which of two floor plans is *the* ground-floor plan. Those
 * decisions are the right ones for the analyzer and the wrong ones for a record
 * of what the publisher actually offers, because they throw the alternatives
 * away.
 *
 * This module decides nothing. It enumerates every URL the markup exposes,
 * once per place it exposes it, and says which attribute it came from. A file
 * named in three channels produces three records — the duplication is the
 * point, because "the page links this as a lightbox original *and* names it in
 * og:image" is stronger evidence than either claim alone, and a URL that turns
 * up only as a convention-derived guess is much weaker than both.
 *
 * Selection happens later, in `variant-policy.ts`, over measured bytes.
 *
 * ## Channels
 *
 * Every channel the stage brief lists is implemented, including the two this
 * publisher's markup does not currently use (`srcset` and the lazy-loading
 * attributes). A channel that finds nothing costs one pass over the HTML and
 * records that it found nothing, which is a more useful thing to be able to say
 * than "we never looked".
 *
 * PORT_DIRECT (Kotlin) — string processing only, no DOM.
 */
import type { DiscoveryChannel, SourceDiscoveryRecord } from '../contracts/source-package.js'
import { parseAttrs } from './archon-parser.js'

/** Lazy-loading attributes seen in the wild, checked in order of specificity. */
const LAZY_ATTRS = ['data-src', 'data-original', 'data-lazy-src', 'data-lazy', 'data-echo'] as const

/** Attribute carrying the area-labelled copy of a floor plan. */
const FLOOR_PLAN_ATTR = 'data-floor-pom-img'

const originOf = (url: string): string => url.match(/^https?:\/\/[^/]+/)?.[0] ?? ''

const absolutise = (href: string, base: string): string => {
  if (/^https?:\/\//i.test(href)) return href
  if (href.startsWith('//')) return `https:${href}`
  const origin = originOf(base)
  return origin ? origin + (href.startsWith('/') ? href : `/${href}`) : href
}

/**
 * The host a project's images actually live on.
 *
 * ARCHON serves its pages from `www.archon.pl` and its images from
 * `assets.archon.pl`, and it links a lightbox original with a **root-relative**
 * href — `/images/products/<code>/<file>.jpg`. Resolving that against the page
 * is what a browser would do and is wrong here: the file is on the asset host,
 * and a URL on the page host is a 404 that also misses the cache and splits one
 * asset into two.
 *
 * So the base for a relative product path is taken from a product image the
 * document already names absolutely, which is the rule the parser has always
 * used and which needs no host to be written down anywhere.
 */
export function productOrigin(html: string, projectCode: string, fallbackUrl: string): string {
  const re = new RegExp(`https?://[^"'\\s)]*?/images/products/${projectCode}/`, 'i')
  const m = html.match(re)
  return m ? originOf(m[0]) : originOf(fallbackUrl)
}

/** Strip the tracking suffixes ARCHON appends to share links. */
const cleanUrl = (url: string): string => url.split('&')[0].trim()

const isProductImage = (url: string, projectCode: string): boolean =>
  url.includes(`/images/products/${projectCode}/`) && /\.(jpe?g|png|gif|webp)(\?|$)/i.test(url)

const isDocument = (url: string): boolean => /\.pdf(\?|$)/i.test(url)

/**
 * Every candidate in a `srcset`, largest descriptor first.
 *
 * The descriptors are *claims*, not measurements — they say what the publisher
 * intends each copy to be used for — so they order the candidates and nothing
 * more. Whether a copy really carries more pixels is settled by decoding it.
 */
export function parseSrcset(value: string): Array<{ url: string; descriptor: string }> {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      const bits = part.split(/\s+/)
      return { url: bits[0], descriptor: bits.slice(1).join(' ') }
    })
    .filter((c) => c.url.length > 0)
}

/**
 * Public AJAX endpoints the page links to.
 *
 * ARCHON opens its floor plans and its render gallery through fancybox, which
 * loads a fragment from a public path on the same host. Those fragments are
 * official material about this project, exposed without any access control, and
 * they say which copies of a drawing belong together — which is the one thing a
 * filename cannot be trusted about.
 */
export function discoverEndpoints(html: string, pageUrl: string): SourceDiscoveryRecord[] {
  const out: SourceDiscoveryRecord[] = []
  const seen = new Set<string>()
  for (const m of html.matchAll(/<a\b[^>]*>/gi)) {
    const attrs = parseAttrs(m[0])
    const src = attrs['data-src'] ?? ''
    if (!/^\/product_fancybox_[a-z_]+\//i.test(src)) continue
    const url = absolutise(src, pageUrl)
    if (seen.has(url)) continue
    seen.add(url)
    out.push({
      url,
      channel: 'FANCYBOX_AJAX',
      exposedBy: pageUrl,
      locator: 'a[data-src^="/product_fancybox_"]',
      ...(attrs['data-caption'] ? { label: attrs['data-caption'] } : {}),
    })
  }
  return out
}

/**
 * Every product-image URL the markup exposes, with its channel.
 *
 * `exposedBy` is the document this was read from, so the same function serves
 * the project page and the AJAX fragments it links to — and a URL found in both
 * produces one record per document, which is how corroboration is recorded.
 */
export function discoverImages(html: string, documentUrl: string, projectCode: string): SourceDiscoveryRecord[] {
  const out: SourceDiscoveryRecord[] = []
  const assetBase = productOrigin(html, projectCode, documentUrl)
  const add = (rawUrl: string, channel: DiscoveryChannel, locator: string, label?: string): void => {
    if (!rawUrl) return
    const trimmed = cleanUrl(rawUrl)
    // A root-relative product path belongs to the asset host, not the page host.
    const base = !/^https?:\/\//i.test(trimmed) && trimmed.includes(`/images/products/${projectCode}/`) ? assetBase : documentUrl
    const url = absolutise(trimmed, base)
    if (!isProductImage(url, projectCode)) return
    out.push({ url, channel, exposedBy: documentUrl, locator, ...(label ? { label } : {}) })
  }

  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const attrs = parseAttrs(m[0])
    const label = attrs.alt ?? ''
    add(attrs.src ?? '', 'IMG_SRC', 'img[src]', label)
    add(attrs[FLOOR_PLAN_ATTR] ?? '', 'FLOOR_PLAN_ATTR', `img[${FLOOR_PLAN_ATTR}]`, label)
    for (const attr of LAZY_ATTRS) add(attrs[attr] ?? '', 'IMG_LAZY_ATTR', `img[${attr}]`, label)
    for (const c of parseSrcset(attrs.srcset ?? '')) {
      add(c.url, 'IMG_SRCSET', `img[srcset] "${c.descriptor || '1x'}"`, label)
    }
  }

  for (const m of html.matchAll(/<source\b[^>]*>/gi)) {
    const attrs = parseAttrs(m[0])
    for (const c of parseSrcset(attrs.srcset ?? '')) {
      add(c.url, 'IMG_SRCSET', `source[srcset] "${c.descriptor || '1x'}"`)
    }
  }

  for (const m of html.matchAll(/<a\b[^>]*>/gi)) {
    const attrs = parseAttrs(m[0])
    add(attrs.href ?? '', 'ANCHOR_HREF', 'a[href]', attrs.title ?? attrs['data-caption'])
  }

  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = parseAttrs(m[0])
    const prop = (attrs.property ?? attrs.name ?? '').toLowerCase()
    if (prop !== 'og:image' && prop !== 'twitter:image') continue
    add(attrs.content ?? '', 'OG_IMAGE', `meta[${prop}]`)
  }

  return out
}

/** Official document links (PDF and the like) exposed publicly on the page. */
export function discoverDocuments(html: string, documentUrl: string): SourceDiscoveryRecord[] {
  const out: SourceDiscoveryRecord[] = []
  const seen = new Set<string>()
  for (const m of html.matchAll(/<a\b[^>]*>/gi)) {
    const attrs = parseAttrs(m[0])
    const href = cleanUrl(attrs.href ?? '')
    if (!href || !isDocument(href)) continue
    const url = absolutise(href, documentUrl)
    if (seen.has(url)) continue
    seen.add(url)
    out.push({
      url,
      channel: 'DOCUMENT_LINK',
      exposedBy: documentUrl,
      locator: 'a[href$=".pdf"]',
      ...(attrs.title ? { label: attrs.title } : {}),
    })
  }
  return out
}

/**
 * Which floor-plan copies a fancybox fragment shows together.
 *
 * One fragment is one floor. Every product image inside it is a published face
 * of that same floor, which is the publisher's own statement that the
 * dimensioned copy and the area-labelled copy are one document — evidence a
 * filename comparison can only guess at.
 */
export function floorPlanGroups(fragments: Array<{ url: string; html: string }>, projectCode: string): string[][] {
  const groups: string[][] = []
  for (const f of fragments) {
    if (!/\/product_fancybox_floor\//i.test(f.url)) continue
    const urls = [...new Set(discoverImages(f.html, f.url, projectCode).map((d) => d.url))]
    if (urls.length > 1) groups.push(urls.sort())
  }
  return groups
}

/** All page-level discovery in one call, in a stable order. */
export function discoverFromPage(html: string, pageUrl: string, projectCode: string): SourceDiscoveryRecord[] {
  return [
    ...discoverImages(html, pageUrl, projectCode),
    ...discoverDocuments(html, pageUrl),
    ...discoverEndpoints(html, pageUrl),
  ]
}

/** Distinct URLs in a discovery list, in first-seen order. */
export const discoveredUrls = (records: readonly SourceDiscoveryRecord[]): string[] => [
  ...new Set(records.map((r) => r.url)),
]

/** Every channel a URL was seen in. */
export function channelsFor(records: readonly SourceDiscoveryRecord[], url: string): DiscoveryChannel[] {
  return [...new Set(records.filter((r) => r.url === url).map((r) => r.channel))]
}
