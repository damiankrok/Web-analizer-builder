/**
 * ARCHON project-page parser (§8). Pure: HTML string in, SourcePackage out.
 * No DOM — the analyzer must parse identically in Node, in a Web Worker and on
 * the JVM, and jsdom is neither portable nor necessary for this markup.
 *
 * The page is highly structured: every published fact sits in a
 * `product-data__item` carrying a stable `data-resource` slug, and every asset
 * is a plain <img> under assets.archon.pl with a descriptive filename slug.
 */
import type {
  PublishedFact,
  RoomFact,
  SourceAsset,
  SourceIdentity,
  SourcePackage,
} from '../contracts/source.js'
import { RESOURCE_SLUG_MAP, TITLE_MAP, parsePlNumber, parsePlPair } from './facts.js'
import { classifyByMetadata, resolveRoleConflicts, deaccent } from './role-classifier.js'
import { mkId } from '../util/ids.js'

const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&sup2;': '²',
  '&sup3;': '³',
  '&oacute;': 'ó',
  '&deg;': '°',
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&[a-z]+\d?;/gi, (m) => ENTITIES[m.toLowerCase()] ?? m)
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, d: string) => String.fromCodePoint(parseInt(d, 16)))
}

const stripTags = (s: string): string => decodeEntities(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()

/** Parse an HTML attribute list into a map. Tolerates unquoted values. */
export function parseAttrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {}
  const re = /([a-zA-Z_:][-\w:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s">]+))/g
  let m: RegExpExecArray | null
  while ((m = re.exec(tag))) {
    out[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '')
  }
  return out
}

/** Remove <script>/<style> bodies so their text never leaks into extraction. */
export function stripScripts(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
}

/** Project code from the canonical URL, e.g. `m2fa281446a8ca`. */
export function extractProjectCode(url: string, html: string): string {
  const fromUrl = url.match(/-(m[0-9a-f]{8,})(?:[/?#]|$)/i)
  if (fromUrl) return fromUrl[1]
  const fromAsset = html.match(/assets\.archon\.pl\/images\/products\/(m[0-9a-f]{8,})\//i)
  if (fromAsset) return fromAsset[1]
  return 'unknown'
}

export function extractName(html: string): string {
  const og = html.match(/<meta[^>]*property="og:title"[^>]*>/i)
  if (og) {
    const attrs = parseAttrs(og[0])
    if (attrs.content) return attrs.content.trim()
  }
  const t = html.match(/<title>([^<]*)<\/title>/i)
  if (t) return decodeEntities(t[1]).replace(/\s*Dane projektu\s*-\s*ARCHON\+?\s*$/i, '').replace(/^Projekt domu\s*/i, '').trim()
  return 'unknown'
}

/** Published numeric facts from `product-data__item[data-resource]` blocks. */
export function extractFacts(html: string): { facts: PublishedFact[]; warnings: string[] } {
  const warnings: string[] = []
  const facts: PublishedFact[] = []
  const seen = new Set<string>()

  // The body capture keeps its own trailing </div> so that the title/value
  // sub-matches below still see a closing tag to stop at.
  const itemRe = /<div[^>]*class="[^"]*product-data__item[^"]*"[^>]*data-resource="([^"]+)"[^>]*>([\s\S]{0,4000}?<\/div>)\s*<\/div>/gi
  let m: RegExpExecArray | null
  while ((m = itemRe.exec(html))) {
    const slug = m[1].trim()
    const body = m[2]
    const titleM = body.match(/class="product-data__title"[^>]*>([\s\S]*?)<\/div>/i)
    const valueM = body.match(/class="product-data__value"[^>]*>([\s\S]*?)<\/div>/i)
    if (!valueM) continue
    const title = titleM ? stripTags(titleM[1]) : slug
    const valueText = stripTags(valueM[1])

    let spec = RESOURCE_SLUG_MAP[slug]
    if (!spec) {
      const byTitle = TITLE_MAP.find((t) => t.re.test(title))
      if (byTitle) spec = byTitle.spec
    }
    if (!spec) {
      warnings.push(`unmapped published fact slug="${slug}" title="${title}"`)
      continue
    }
    if (seen.has(spec.key)) continue
    seen.add(spec.key)

    if (spec.key === 'min_plot_dimensions') {
      const pair = parsePlPair(valueText)
      if (pair) {
        facts.push({
          id: mkId('fact', 'min_plot_width'),
          key: 'min_plot_width',
          sourceLabel: title,
          value: pair[0],
          unit: 'm',
          authority: 'PUBLISHED_EXACT',
          text: valueText,
        })
        facts.push({
          id: mkId('fact', 'min_plot_depth'),
          key: 'min_plot_depth',
          sourceLabel: title,
          value: pair[1],
          unit: 'm',
          authority: 'PUBLISHED_EXACT',
          text: valueText,
        })
      }
      continue
    }

    const value = parsePlNumber(valueText)
    facts.push({
      id: mkId('fact', spec.key),
      key: spec.key,
      sourceLabel: title,
      value,
      unit: spec.unit,
      authority: 'PUBLISHED_EXACT',
      text: valueText,
    })
  }
  return { facts, warnings }
}

/**
 * Technology rows: `<strong>label:</strong> value`. These carry the roof family,
 * roof pitch and knee-wall height — strong vertical constraints that are
 * published as prose rather than as numbered facts.
 */
export function extractTechnologyNotes(html: string): Record<string, string> {
  const notes: Record<string, string> = {}
  const re = /<div[^>]*class="product-data__title"[^>]*>\s*<strong>([^<]{2,60}?):?\s*<\/strong>([\s\S]{0,300}?)<\/div>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const key = decodeEntities(m[1]).trim().toLowerCase().replace(/:$/, '')
    const value = stripTags(m[2])
    if (key && value && !(key in notes)) notes[key] = value
  }
  return notes
}

/** Per-storey room tables. Areas are the only numeric plan facts on the page. */
export function extractRooms(html: string): RoomFact[] {
  const rooms: RoomFact[] = []
  const tableRe = /<table[^>]*>([\s\S]*?)<\/table>/gi
  let t: RegExpExecArray | null
  while ((t = tableRe.exec(html))) {
    const table = t[1]
    const headM = table.match(/<th[^>]*>([\s\S]*?)<\/th>/i)
    if (!headM) continue
    const head = deaccent(stripTags(headM[1]))
    let storey: 'GROUND' | 'UPPER' | null = null
    if (/parter|przyziemie/.test(head)) storey = 'GROUND'
    else if (/poddasze|pietro/.test(head)) storey = 'UPPER'
    if (!storey) continue

    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
    let r: RegExpExecArray | null
    while ((r = rowRe.exec(table))) {
      const cells = [...r[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => stripTags(c[1]))
      if (cells.length < 2) continue
      const nameCell = cells[0]
      const nm = nameCell.match(/^(\d+)\.\s*(.+)$/)
      if (!nm) continue
      const area = parsePlNumber(cells[1])
      if (area === null) continue
      const gross = cells[2] ? parsePlNumber(cells[2]) : null
      rooms.push({
        id: mkId('room', storey, nm[1], nm[2]),
        storey,
        index: Number(nm[1]),
        name: nm[2].trim(),
        areaM2: area,
        ...(gross !== null ? { areaGrossM2: gross } : {}),
      })
    }
  }
  return rooms
}

/**
 * Visual assets. Both `src` and `data-floor-pom-img` are collected: ARCHON puts
 * the plain plan in `src` and the dimensioned "with areas" variant in the data
 * attribute, and the latter is the one worth analysing.
 */
export function extractAssets(html: string, projectCode: string): SourceAsset[] {
  const byUrl = new Map<string, SourceAsset>()
  const imgRe = /<img\b[^>]*>/gi
  let m: RegExpExecArray | null
  const productPath = `/images/products/${projectCode}/`

  const consider = (url: string, alt: string, modalLink: string | undefined, hintW?: string, hintH?: string): void => {
    if (!url || !url.includes(productPath)) return
    const clean = url.split('&')[0]
    if (byUrl.has(clean)) return
    const file = clean.slice(clean.lastIndexOf('/') + 1)
    const slug = file.replace(/\.[a-z0-9]+$/i, '')
    const guess = classifyByMetadata({ urlSlug: slug, alt, modalLink })
    const w = hintW && /^\d+$/.test(hintW) ? Number(hintW) : undefined
    const h = hintH && /^\d+$/.test(hintH) ? Number(hintH) : undefined
    byUrl.set(clean, {
      id: mkId('asset', clean),
      url: clean,
      role: guess.role,
      roleConfidence: guess.confidence,
      roleEvidence: guess.evidence,
      label: alt || slug,
      ...(w ? { width: w } : {}),
      ...(h ? { height: h } : {}),
    })
  }

  while ((m = imgRe.exec(html))) {
    const attrs = parseAttrs(m[0])
    const modal = attrs['data-images-modal-link']
    consider(attrs.src ?? '', attrs.alt ?? '', modal, attrs.width, attrs.height)
    // The dimensioned plan variant lives only in this data attribute.
    consider(attrs['data-floor-pom-img'] ?? '', attrs.alt ?? '', modal)
  }
  // og:image carries the full-resolution hero render.
  for (const tag of html.matchAll(/<meta[^>]*property="og:image"[^>]*>/gi)) {
    const attrs = parseAttrs(tag[0])
    consider(attrs.content ?? '', 'og image', undefined)
  }

  const assets = [...byUrl.values()].sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0))
  const resolved = resolveRoleConflicts(assets)
  return assets.map((a) => {
    const r = resolved.get(a.id)
    return r ? { ...a, role: r.role, roleConfidence: r.confidence } : a
  })
}

/**
 * ARCHON republishes the same view at several resolutions (a gallery thumbnail
 * and a full-size image). They are one physical view and must not be scored
 * twice, so identical (role, slug-family) pairs collapse to the largest.
 */
function dedupeSameView(assets: SourceAsset[], warnings: string[]): SourceAsset[] {
  const family = (url: string): string => {
    const file = url.slice(url.lastIndexOf('/') + 1).replace(/\.[a-z0-9]+$/i, '')
    return file.replace(/-[0-9a-f]{16,}__\d+$/i, '').replace(/__\d+$/, '')
  }
  const area = (a: SourceAsset): number => (a.width ?? 0) * (a.height ?? 0)
  const groups = new Map<string, SourceAsset[]>()
  for (const a of assets) {
    const key = `${a.role}|${family(a.url)}`
    const list = groups.get(key)
    if (list) list.push(a)
    else groups.set(key, [a])
  }
  // Only collapse groups whose filename family actually names a view. A
  // generic family (just the project slug) can cover two genuinely different
  // drawings, and merging those would silently discard a source.
  const descriptive = /^(widok|elewacja|rzut|przekroj|przekrój|sytuacja|wizualizacj)/i
  const keep = new Set<string>()
  for (const [key, list] of groups) {
    if (list.length === 1 || !descriptive.test(key.slice(key.indexOf('|') + 1))) {
      for (const a of list) keep.add(a.id)
      continue
    }
    if (list.length === 1) {
      keep.add(list[0].id)
      continue
    }
    const best = [...list].sort((x, y) => area(y) - area(x) || (x.url < y.url ? -1 : 1))[0]
    keep.add(best.id)
    for (const a of list) {
      if (a.id !== best.id) warnings.push(`dropped duplicate view of ${key}: ${a.url}`)
    }
  }
  return assets.filter((a) => keep.has(a.id))
}

/**
 * Prefer the dimensioned "z-powierzchniami" plan over the plain one when both
 * are published for the same storey — it is the variant carrying room areas.
 */
function preferDimensionedPlans(assets: SourceAsset[]): SourceAsset[] {
  const out = [...assets]
  for (const role of ['PLAN_GROUND', 'PLAN_UPPER'] as const) {
    const candidates = out.filter((a) => a.role === role)
    if (candidates.length < 2) continue
    const dimensioned = candidates.find((a) => /z-powierzchniami/i.test(a.url))
    if (!dimensioned) continue
    for (const c of candidates) {
      if (c.id === dimensioned.id) continue
      const i = out.indexOf(c)
      out[i] = { ...c, role: 'PLAN_OTHER', roleConfidence: c.roleConfidence * 0.5 }
    }
  }
  return out
}

export function parseArchonPage(html: string, url: string): SourcePackage {
  const clean = stripScripts(html)
  const projectCode = extractProjectCode(url, html)
  const { facts, warnings } = extractFacts(clean)
  const notes = extractTechnologyNotes(clean)
  const rooms = extractRooms(clean)
  const assets = dedupeSameView(preferDimensionedPlans(extractAssets(html, projectCode)), warnings)

  const identity: SourceIdentity = {
    projectCode,
    name: extractName(html),
    url,
    vendor: 'ARCHON',
  }

  if (facts.length === 0) warnings.push('no published facts parsed — page layout may have changed')
  if (assets.length === 0) warnings.push('no product assets parsed — page layout may have changed')

  return { identity, facts, rooms, assets, notes, warnings }
}
