/** Source-resolution acquisition and holdout isolation (§4, §33). */
import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolutionCandidates, isResolutionUpgrade, VARIANT_BLOCK } from '../src/core/source/resolution.js'
import { extractLightboxOriginals, parseArchonPage } from '../src/core/source/archon-parser.js'
import { PROJECTS } from '../src/node/projects.js'

describe('resolution candidates', () => {
  it('proposes the conventional original for a page variant', () => {
    expect(resolutionCandidates('https://h/x/a-b__264.jpg')).toEqual([`https://h/x/a-b__${264 + VARIANT_BLOCK}.jpg`])
  })

  it('proposes nothing for a URL already in the upgraded block', () => {
    expect(resolutionCandidates('https://h/x/a-b__11264.jpg')).toEqual([])
    expect(resolutionCandidates('https://h/x/a-b__11915.gif')).toEqual([])
  })

  it('proposes nothing where the URL shape gives no basis for a guess', () => {
    expect(resolutionCandidates('https://h/x/plain.jpg')).toEqual([])
    expect(resolutionCandidates('https://h/x/a-b__0.jpg')).toEqual([])
  })

  it('preserves a query string', () => {
    expect(resolutionCandidates('https://h/x/a__255.jpg?v=2')).toEqual(['https://h/x/a__11255.jpg?v=2'])
  })

  it('accepts an upgrade only when it carries strictly more pixels in both axes', () => {
    expect(isResolutionUpgrade({ width: 1280, height: 597 }, { width: 550, height: 256 })).toBe(true)
    expect(isResolutionUpgrade({ width: 550, height: 256 }, { width: 550, height: 256 })).toBe(false)
    // More total pixels but narrower: a re-crop, not an upgrade.
    expect(isResolutionUpgrade({ width: 400, height: 2000 }, { width: 550, height: 256 })).toBe(false)
  })
})

describe('lightbox originals in the published page', () => {
  it('pairs each page image with the original behind its anchor', async () => {
    const project = PROJECTS.find((p) => p.key === 'A')!
    const html = await readFile(`fixtures/${project.slug}/page.html`, 'utf8')
    const code = project.url.split('-').pop() as string
    const originals = extractLightboxOriginals(html, code)
    expect(originals.size).toBeGreaterThanOrEqual(4)
    for (const [page, full] of originals) {
      expect(page).not.toBe(full)
      // The original's filename carries no view name, which is exactly why the
      // pairing has to come from containment rather than from the filename.
      expect(full).toMatch(/__1\d{4}\.(jpe?g|png|gif)$/)
    }
  })

  it('keeps one asset per view, pointing at the largest published copy', async () => {
    const project = PROJECTS.find((p) => p.key === 'A')!
    const html = await readFile(`fixtures/${project.slug}/page.html`, 'utf8')
    const pkg = parseArchonPage(html, project.url)
    const elevations = pkg.assets.filter((a) => a.role.startsWith('ELEVATION'))
    expect(elevations).toHaveLength(4)
    for (const a of elevations) {
      const variants = a.variants ?? []
      expect(variants.length).toBe(2)
      // `url` is the lightbox original; the page copy is kept for provenance.
      expect(a.url).toBe(variants.find((v) => v.kind === 'LIGHTBOX')?.url)
      expect(variants.some((v) => v.kind === 'PAGE')).toBe(true)
    }
    // The originals must not also appear as assets of their own: that is how a
    // 1280 px elevation gets classified as an unrelated render.
    const ids = new Set(pkg.assets.map((a) => a.id))
    expect(ids.size).toBe(pkg.assets.length)
    expect(pkg.assets.filter((a) => a.role === 'UNKNOWN_ASSET')).toHaveLength(0)
  })
})

describe('holdout isolation (§28)', () => {
  it('registers exactly one holdout, and it is none of the observed projects', () => {
    const holdouts = PROJECTS.filter((p) => p.role === 'HOLDOUT')
    expect(holdouts).toHaveLength(1)
    expect(holdouts[0].key).toBe('F')
    // A holdout is spent once its extracted geometry has been looked at. C was
    // run under the WEB-01 freeze, D twice under WEB-02 — with its footprint,
    // ridge, eave and pitch reported, and a defect fixed against it — and E
    // once under WEB-PIVOT-06, with its walls, openings, rooms and adjacencies
    // reported per storey. None may be presented as untouched again.
    expect(PROJECTS.find((p) => p.key === 'C')?.role).toBe('HISTORICAL_HOLDOUT_WEB01')
    expect(PROJECTS.find((p) => p.key === 'D')?.role).toBe('HISTORICAL_HOLDOUT_WEB02')
    expect(PROJECTS.find((p) => p.key === 'E')?.role).toBe('HISTORICAL_HOLDOUT_WEB06')
  })

  it('never lets a spent holdout hold the HOLDOUT role again', () => {
    const spent = PROJECTS.filter((p) => p.role.startsWith('HISTORICAL_HOLDOUT'))
    expect(spent.length).toBeGreaterThan(0)
    for (const p of spent) expect(p.role).not.toBe('HOLDOUT')
  })

  it('gives every development project a distinct URL', () => {
    const urls = new Set(PROJECTS.map((p) => p.url))
    expect(urls.size).toBe(PROJECTS.length)
  })
})
