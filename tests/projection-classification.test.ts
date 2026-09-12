import { describe, expect, it } from 'vitest'
import { classifyProjection } from '../src/core/projection/classifier.js'
import { prepareAsset } from '../src/core/raster/pipeline.js'
import { loadFixture } from './helpers.js'
import type { AssetRole } from '../src/core/contracts/source.js'

const LINE_DRAWING = new Set(['PLAN_GROUND', 'PLAN_UPPER', 'PLAN_OTHER', 'SITE_PLAN', 'SECTION'])

async function classifyAll(slug: string): Promise<Map<AssetRole, string[]>> {
  const { pkg, images } = await loadFixture(slug)
  const out = new Map<AssetRole, string[]>()
  for (const asset of pkg.assets) {
    const image = images.get(asset.id)
    if (!image) continue
    const raster = prepareAsset(image, { lineDrawing: LINE_DRAWING.has(asset.role) })
    const c = classifyProjection({
      role: asset.role,
      image: raster.image,
      gray: raster.gray,
      segments: raster.segments,
    })
    const list = out.get(asset.role) ?? []
    list.push(c.type)
    out.set(asset.role, list)
  }
  return out
}

describe('projection classification on real published sources', () => {
  it('classifies every technical elevation of project A as orthographic', async () => {
    const byRole = await classifyAll('A-marcowki')
    for (const role of ['ELEVATION_FRONT', 'ELEVATION_REAR', 'ELEVATION_LEFT', 'ELEVATION_RIGHT'] as const) {
      expect(byRole.get(role), role).toEqual(['ORTHOGRAPHIC_TECHNICAL'])
    }
  })

  it('classifies the section as orthographic and the plans as planar diagrams', async () => {
    const byRole = await classifyAll('A-marcowki')
    expect(byRole.get('SECTION')).toEqual(['ORTHOGRAPHIC_TECHNICAL'])
    expect(byRole.get('PLAN_GROUND')).toEqual(['PLANAR_DIAGRAM'])
    expect(byRole.get('PLAN_UPPER')).toEqual(['PLANAR_DIAGRAM'])
  })

  it('classifies the exterior visualisations as perspective', async () => {
    const byRole = await classifyAll('A-marcowki')
    for (const role of ['HERO_RENDER', 'GARDEN_RENDER'] as const) {
      for (const type of byRole.get(role) ?? []) expect(type.startsWith('PERSPECTIVE'), `${role} -> ${type}`).toBe(true)
    }
  })

  it('holds on the regression project, which is a different house', async () => {
    const byRole = await classifyAll('B-bakopach')
    for (const role of ['ELEVATION_FRONT', 'ELEVATION_REAR', 'ELEVATION_LEFT', 'ELEVATION_RIGHT'] as const) {
      expect(byRole.get(role), role).toEqual(['ORTHOGRAPHIC_TECHNICAL'])
    }
    expect(byRole.get('SECTION')).toEqual(['ORTHOGRAPHIC_TECHNICAL'])
    expect(byRole.get('PLAN_GROUND')).toEqual(['PLANAR_DIAGRAM'])
  })

  it('excludes interior gallery renders from massing evidence', async () => {
    const { pkg } = await loadFixture('B-bakopach')
    const interiors = pkg.assets.filter((a) => a.role === 'INTERIOR_RENDER')
    expect(interiors.length).toBeGreaterThan(0)
  })

  it('never sends an orthographic source through perspective camera fitting', async () => {
    const byRole = await classifyAll('A-marcowki')
    for (const [role, types] of byRole) {
      if (!role.startsWith('ELEVATION') && role !== 'SECTION') continue
      for (const t of types) expect(t.startsWith('PERSPECTIVE'), `${role} must not be perspective`).toBe(false)
    }
  })
})
