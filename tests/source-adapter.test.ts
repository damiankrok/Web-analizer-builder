import { describe, expect, it } from 'vitest'
import { fixturePackage } from './helpers.js'
import { parsePlNumber, parsePlPair, parseTechnology } from '../src/core/source/facts.js'
import { classifyByMetadata, deaccent, resolveRoleConflicts } from '../src/core/source/role-classifier.js'
import { checkUrl, checkRedirect, checkResponse, ARCHON_POLICY } from '../src/core/source/fetch-policy.js'
import { factValue } from '../src/core/contracts/source.js'

describe('Polish-locale numeric parsing', () => {
  it('parses decimal commas and thousands spaces', () => {
    expect(parsePlNumber('131,16')).toBeCloseTo(131.16, 9)
    expect(parsePlNumber('1 234,5 m²')).toBeCloseTo(1234.5, 9)
    expect(parsePlNumber('8,27')).toBeCloseTo(8.27, 9)
    expect(parsePlNumber('brak')).toBeNull()
  })

  it('parses a dimension pair', () => {
    expect(parsePlPair('19,05 x 20,6')).toEqual([19.05, 20.6])
    expect(parsePlPair('19,05 × 20,6')).toEqual([19.05, 20.6])
    expect(parsePlPair('19,05')).toBeNull()
  })
})

describe('ARCHON page parsing', () => {
  const pkg = fixturePackage('A-marcowki')

  it('identifies the project', () => {
    expect(pkg.identity.projectCode).toBe('m2fa281446a8ca')
    expect(pkg.identity.vendor).toBe('ARCHON')
    expect(pkg.identity.name).toContain('marcówkach')
  })

  it('extracts the published geometric facts', () => {
    expect(factValue(pkg, 'footprint_area')).toBeCloseTo(131.16, 6)
    expect(factValue(pkg, 'building_height')).toBeCloseTo(8.27, 6)
    expect(factValue(pkg, 'garage_area')).toBeCloseTo(24.1, 6)
    expect(factValue(pkg, 'roof_area')).toBeCloseTo(150.57, 6)
    expect(factValue(pkg, 'min_plot_width')).toBeCloseTo(19.05, 6)
    expect(factValue(pkg, 'min_plot_depth')).toBeCloseTo(20.6, 6)
  })

  it('extracts the technology prose that carries vertical constraints', () => {
    const tech = parseTechnology(pkg.notes)
    expect(tech.roofFamily).toBe('GABLE')
    expect(tech.roofPitchDeg).toBe(40)
    expect(tech.kneeWallM).toBeCloseTo(1.3, 9)
  })

  it('extracts both storeys of room tables', () => {
    const ground = pkg.rooms.filter((r) => r.storey === 'GROUND')
    const upper = pkg.rooms.filter((r) => r.storey === 'UPPER')
    expect(ground.length).toBe(9)
    expect(upper.length).toBe(9)
    expect(ground.find((r) => r.name === 'Garaż')?.areaM2).toBeCloseTo(24.1, 6)
    expect(upper.find((r) => r.name === 'Schody')?.areaM2).toBeCloseTo(5.63, 6)
  })

  it('collects the dimensioned plan variants that only appear in a data attribute', () => {
    const plans = pkg.assets.filter((a) => a.role === 'PLAN_GROUND' || a.role === 'PLAN_UPPER')
    expect(plans.length).toBe(2)
    for (const p of plans) expect(p.url).toContain('z-powierzchniami')
  })

  it('classifies one asset per singleton role', () => {
    for (const role of ['ELEVATION_FRONT', 'ELEVATION_REAR', 'ELEVATION_LEFT', 'ELEVATION_RIGHT', 'SECTION'] as const) {
      expect(pkg.assets.filter((a) => a.role === role).length, role).toBe(1)
    }
  })

  it('de-duplicates the same view published at two resolutions', () => {
    expect(pkg.warnings.some((w) => w.includes('dropped duplicate view'))).toBe(true)
    expect(pkg.assets.filter((a) => a.role === 'HERO_RENDER').length).toBe(1)
  })

  it('parses the two other development projects too', () => {
    for (const slug of ['B-bakopach', 'C-holdout']) {
      const other = fixturePackage(slug)
      expect(factValue(other, 'footprint_area')).toBeGreaterThan(0)
      expect(other.assets.length).toBeGreaterThan(5)
      expect(other.rooms.length).toBeGreaterThan(5)
    }
  })
})

describe('role classification', () => {
  it('strips Polish diacritics before matching', () => {
    expect(deaccent('Przekrój Elewacja Ogrodowa')).toBe('przekroj elewacja ogrodowa')
  })

  it('prefers the filename over the alt text', () => {
    const g = classifyByMetadata({ urlSlug: 'elewacja-frontowa-projekt', alt: 'rzut parteru' })
    expect(g.role).toBe('ELEVATION_FRONT')
    expect(g.evidence).toContain('FILENAME')
  })

  it('resolves the two undifferentiated side elevations by gallery ordering', () => {
    const left = classifyByMetadata({ urlSlug: 'elewacja-boczna-x', alt: '', modalLink: 'elevation2' })
    const right = classifyByMetadata({ urlSlug: 'elewacja-boczna-y', alt: '', modalLink: 'elevation3' })
    expect(left.role).toBe('ELEVATION_LEFT')
    expect(right.role).toBe('ELEVATION_RIGHT')
    expect(left.evidence).toContain('DOM_CONTEXT')
  })

  it('demotes the weaker of two claims on one singleton role', () => {
    const resolved = resolveRoleConflicts([
      { id: 'a', role: 'ELEVATION_FRONT', roleConfidence: 0.95 },
      { id: 'b', role: 'ELEVATION_FRONT', roleConfidence: 0.4 },
    ])
    expect(resolved.get('a')?.role).toBe('ELEVATION_FRONT')
    expect(resolved.get('b')?.role).not.toBe('ELEVATION_FRONT')
  })
})

describe('bounded fetch policy (§8)', () => {
  it('allows only HTTPS URLs on the ARCHON allowlist', () => {
    expect(checkUrl('https://www.archon.pl/x', ARCHON_POLICY).allowed).toBe(true)
    expect(checkUrl('https://assets.archon.pl/x.jpg', ARCHON_POLICY).allowed).toBe(true)
    expect(checkUrl('http://www.archon.pl/x', ARCHON_POLICY).allowed).toBe(false)
    expect(checkUrl('https://evil.example.com/x', ARCHON_POLICY).allowed).toBe(false)
    expect(checkUrl('https://user:pass@www.archon.pl/x', ARCHON_POLICY).allowed).toBe(false)
    expect(checkUrl('not a url', ARCHON_POLICY).allowed).toBe(false)
  })

  it('re-validates every redirect hop, so an allowlisted host cannot bounce elsewhere', () => {
    expect(checkRedirect('https://www.archon.pl/a', 'https://assets.archon.pl/b', ARCHON_POLICY, 1).allowed).toBe(true)
    const off = checkRedirect('https://www.archon.pl/a', 'https://evil.example.com/b', ARCHON_POLICY, 1)
    expect(off.allowed).toBe(false)
    if (!off.allowed) expect(off.reason).toContain('allowlist')
  })

  it('exhausts a redirect budget rather than following forever', () => {
    expect(checkRedirect('https://www.archon.pl/a', 'https://www.archon.pl/b', ARCHON_POLICY, 99).allowed).toBe(false)
  })

  it('caps response sizes and image types', () => {
    expect(checkResponse('image/jpeg', 1000, 'image', ARCHON_POLICY).allowed).toBe(true)
    expect(checkResponse('image/jpeg', 99_000_000, 'image', ARCHON_POLICY).allowed).toBe(false)
    expect(checkResponse('application/zip', 1000, 'image', ARCHON_POLICY).allowed).toBe(false)
    expect(checkResponse('text/html', 1000, 'html', ARCHON_POLICY).allowed).toBe(true)
  })
})
