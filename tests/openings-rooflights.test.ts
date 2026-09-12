/** Opening identity and rooflight detection (§33). */
import { describe, expect, it } from 'vitest'
import type { GrayImage, MaskImage } from '../src/core/contracts/raster.js'
import { makeMask } from '../src/core/contracts/raster.js'
import {
  resolveOpenings,
  groupObservations,
  DEFAULT_IDENTITY,
  type OpeningObservation,
} from '../src/core/openings/identity.js'
import { detectRooflights, fuseRooflights, DEFAULT_ROOFLIGHTS, type RooflightObservation } from '../src/core/roof/rooflights.js'
import type { RoofHypothesis } from '../src/core/contracts/hypotheses.js'

const obs = (o: Partial<OpeningObservation> & { id: string }): OpeningObservation => ({
  source: 'ELEVATION_RECT',
  assetId: 'elev',
  facade: 'FRONT',
  s: 0,
  widthM: 1.2,
  sillY: 0.9,
  heightM: 1.4,
  authority: 'ELEVATION_MEASURED',
  confidence: 0.7,
  ...o,
})

describe('opening identity', () => {
  it('keeps two openings that merely sit side by side in one elevation', () => {
    const groups = groupObservations([
      obs({ id: 'a', s: 0, widthM: 1.2 }),
      obs({ id: 'b', s: 1.4, widthM: 1.2 }),
    ])
    expect(groups).toHaveLength(2)
  })

  it('does not merge two rectangles from one elevation that merely overlap', () => {
    // A wide bay and a narrow window beside it, overlapping slightly. Within
    // one source these are two openings, not one.
    const groups = groupObservations([
      obs({ id: 'wide', s: 0, widthM: 3 }),
      obs({ id: 'narrow', s: 2.6, widthM: 1 }),
    ])
    expect(groups).toHaveLength(2)
  })

  it('reads a rectangle nested inside another as a panel of it', () => {
    const { openings } = resolveOpenings(
      [obs({ id: 'outer', s: 0, widthM: 3.6 }), obs({ id: 'p1', s: 0.1, widthM: 1.1 }), obs({ id: 'p2', s: 1.3, widthM: 1.1 })],
      () => 'MAIN_BODY',
    )
    expect(openings).toHaveLength(1)
    expect(openings[0].widthM).toBeCloseTo(3.6, 6)
    expect(openings[0].panelCount).toBe(2)
    expect(openings[0].mullions.length).toBe(1)
    // Panels are not disagreements about the structural opening.
    expect(openings[0].conflicts).toHaveLength(0)
  })

  it('merges a plan gap and an elevation rectangle into one opening', () => {
    const { openings, merged } = resolveOpenings(
      [
        obs({ id: 'plan', source: 'PLAN_GAP', assetId: 'plan', s: 1.0, widthM: 1.2, sillY: null, heightM: null, authority: 'PLAN_MEASURED' }),
        obs({ id: 'elev', s: 1.05, widthM: 1.15, sillY: 0.9, heightM: 1.4 }),
      ],
      () => 'MAIN_BODY',
    )
    expect(openings).toHaveLength(1)
    expect(merged).toBe(1)
    // Width from the plan (the stronger authority), height from the elevation
    // (the only source that states it).
    expect(openings[0].provenance.widthM).toBe('PLAN_GAP')
    expect(openings[0].provenance.heightM).toBe('ELEVATION_RECT')
    expect(openings[0].widthM).toBeCloseTo(1.2, 6)
  })

  it('lets a printed callout set the dimensions and keeps the disagreement', () => {
    const { openings } = resolveOpenings(
      [
        obs({ id: 'elev', s: 1.0, widthM: 1.6, heightM: 1.9 }),
        obs({
          id: 'callout',
          source: 'PRINTED_CALLOUT',
          assetId: 'plan',
          s: 1.0,
          widthM: 1.4,
          heightM: 1.4,
          authority: 'PUBLISHED_EXACT',
          confidence: 0.9,
        }),
      ],
      () => 'MAIN_BODY',
    )
    expect(openings).toHaveLength(1)
    expect(openings[0].widthM).toBeCloseTo(1.4, 6)
    expect(openings[0].provenance.widthM).toBe('PRINTED_CALLOUT')
    // The elevation disagreed by 20 cm and 50 cm; both are retained.
    expect(openings[0].conflicts.length).toBeGreaterThan(0)
    expect(openings[0].conflicts.every((c) => /stronger authority stands/.test(c.note))).toBe(true)
  })

  it('never merges observations on different facades', () => {
    const groups = groupObservations([obs({ id: 'f', facade: 'FRONT' }), obs({ id: 'r', facade: 'REAR' })])
    expect(groups).toHaveLength(2)
  })

  it('classifies a wide low opening in a garage as a gate', () => {
    const { openings } = resolveOpenings([obs({ id: 'g', s: 0, widthM: 2.75, heightM: 2.25, sillY: 0.05 })], () => 'GARAGE')
    expect(openings[0].kind).toBe('GARAGE_GATE')
    expect(openings[0].hasDoorLeaf).toBe(true)
  })

  it('raises confidence when independent source kinds agree', () => {
    const single = resolveOpenings([obs({ id: 'a' })], () => 'MAIN_BODY').openings[0]
    const paired = resolveOpenings(
      [obs({ id: 'a' }), obs({ id: 'b', source: 'RENDER_REGION', assetId: 'render', authority: 'RENDER_INFERRED', confidence: 0.5 })],
      () => 'MAIN_BODY',
    ).openings[0]
    expect(paired.confidence).toBeGreaterThan(single.confidence)
  })

  it('carries a gable clip through the merge', () => {
    const { openings } = resolveOpenings(
      [obs({ id: 'a', clippedByRoof: false }), obs({ id: 'b', source: 'RENDER_REGION', assetId: 'r', clippedByRoof: true })],
      () => 'MAIN_BODY',
    )
    expect(openings[0].clippedByRoof).toBe(true)
  })

  it('uses the tolerances it is given', () => {
    const strict = groupObservations(
      [obs({ id: 'a', sillY: 0.9 }), obs({ id: 'b', source: 'PLAN_GAP', assetId: 'p', sillY: 2.4 })],
      { ...DEFAULT_IDENTITY, sillTolerance: 0.3 },
    )
    expect(strict).toHaveLength(2)
  })
})

// --- rooflights -------------------------------------------------------

const roofScene = (
  paint: (img: GrayImage, region: MaskImage) => void,
): { gray: GrayImage; region: MaskImage } => {
  const w = 300
  const h = 120
  const gray: GrayImage = { width: w, height: h, data: new Uint8ClampedArray(w * h).fill(255) }
  const region = makeMask(w, h)
  // A rectangular slab of roof, mid-tone.
  for (let y = 20; y < 100; y++) {
    for (let x = 20; x < 280; x++) {
      gray.data[y * w + x] = 110
      region.data[y * w + x] = 1
    }
  }
  paint(gray, region)
  return { gray, region }
}

const fill = (gray: GrayImage, x0: number, y0: number, x1: number, y1: number, v: number): void => {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) gray.data[y * gray.width + x] = v
}

describe('rooflight detection', () => {
  const mpp = 0.04
  const ground = { row: 200, minX: 20 }

  it('finds a unit that reads lighter than the roof around it', () => {
    const { gray, region } = roofScene((g) => fill(g, 120, 50, 150, 70, 210))
    const r = detectRooflights('a', 'ELEVATION', gray, region, mpp, ground, DEFAULT_ROOFLIGHTS, 'LEFT')
    expect(r.observations).toHaveLength(1)
    expect(r.observations[0].widthM).toBeCloseTo(31 * mpp, 5)
    expect(r.observations[0].notes[0]).toMatch(/lighter/)
  })

  it('finds a unit that reads darker than the roof around it', () => {
    const { gray, region } = roofScene((g) => fill(g, 120, 50, 150, 70, 40))
    const r = detectRooflights('a', 'ELEVATION', gray, region, mpp, ground, DEFAULT_ROOFLIGHTS, 'LEFT')
    expect(r.observations).toHaveLength(1)
    expect(r.observations[0].notes[0]).toMatch(/darker/)
  })

  it('rejects a patch touching the edge of the roof plane', () => {
    const { gray, region } = roofScene((g) => fill(g, 20, 92, 55, 99, 210))
    const r = detectRooflights('a', 'ELEVATION', gray, region, mpp, ground, DEFAULT_ROOFLIGHTS, 'LEFT')
    expect(r.observations).toHaveLength(0)
    expect(r.rejections.some((x) => /edge of the roof plane/.test(x.reason))).toBe(true)
  })

  it('rejects repeating roof texture', () => {
    const { gray, region } = roofScene((g) => {
      for (let i = 0; i < 8; i++) fill(g, 40 + i * 28, 40, 40 + i * 28 + 14, 52, 210)
    })
    const r = detectRooflights('a', 'ELEVATION', gray, region, mpp, ground, DEFAULT_ROOFLIGHTS, 'LEFT')
    expect(r.rejections.some((x) => /roof texture/.test(x.reason))).toBe(true)
  })

  it('rejects a dormer-sized patch', () => {
    const { gray, region } = roofScene((g) => fill(g, 100, 40, 160, 85, 210))
    const r = detectRooflights('a', 'ELEVATION', gray, region, mpp, ground, DEFAULT_ROOFLIGHTS, 'LEFT')
    expect(r.observations).toHaveLength(0)
    expect(r.rejections.some((x) => /dormer-sized|outside/.test(x.reason))).toBe(true)
  })

  it('says so rather than guessing when there is no scale', () => {
    const { gray, region } = roofScene((g) => fill(g, 120, 50, 150, 70, 210))
    const r = detectRooflights('a', 'ELEVATION', gray, region, 0, ground, DEFAULT_ROOFLIGHTS, 'LEFT')
    expect(r.observations).toHaveLength(0)
    expect(r.notes.join(' ')).toMatch(/no scale/)
  })
})

describe('rooflight fusion', () => {
  const roof: RoofHypothesis = {
    id: 'roof_main',
    massId: 'mass_main',
    kind: 'GABLE',
    pitchDeg: 40,
    eaveY: 4.6,
    ridgeY: 7.9,
    ridgeDir: { x: 0, z: 1 },
    overhangM: 0.5,
    authority: 'SECTION_MEASURED',
    confidence: 0.9,
  }
  const bounds = { minX: 0, maxX: 8, minZ: 0, maxZ: 12 }
  const frameOf = (facade: 'FRONT' | 'REAR' | 'LEFT' | 'RIGHT', s: number): { x: number; z: number } =>
    facade === 'LEFT' ? { x: 0, z: s } : facade === 'RIGHT' ? { x: 8, z: 12 - s } : { x: s, z: facade === 'FRONT' ? 0 : 12 }
  const height = (x: number): number => {
    const t = Math.min(1, Math.abs(x - 4) / 4)
    return roof.ridgeY - (roof.ridgeY - roof.eaveY) * t
  }
  const ob = (o: Partial<RooflightObservation> & { id: string }): RooflightObservation => ({
    assetId: 'e',
    source: 'ELEVATION',
    facade: 'LEFT',
    centrePx: { x: 0, y: 0 },
    widthPx: 30,
    heightPx: 16,
    widthM: 1.2,
    heightM: 0.6,
    s: 3,
    t: 6.3,
    contrast: 0.2,
    confidence: 0.6,
    notes: [],
    ...o,
  })

  it('places a single observation fully, from its height across the slope', () => {
    const { rooflights } = fuseRooflights([ob({ id: 'a' })], [roof], frameOf, (x) => height(x), bounds)
    expect(rooflights).toHaveLength(1)
    // Seen from the LEFT elevation, so on the -X slope, and 1.6 m below the
    // ridge on a 3.3 m rise: a little under half way down.
    expect(rooflights[0].world.x).toBeLessThan(4)
    expect(rooflights[0].world.x).toBeGreaterThan(1)
    expect(rooflights[0].world.z).toBeCloseTo(3, 6)
    expect(rooflights[0].triangulated).toBe(false)
  })

  it('merges two elevations seeing the same unit', () => {
    const { rooflights } = fuseRooflights(
      [ob({ id: 'a', facade: 'LEFT', s: 3, t: 6.3 }), ob({ id: 'b', facade: 'LEFT', s: 3.3, t: 6.35 })],
      [roof],
      frameOf,
      (x) => height(x),
      bounds,
    )
    expect(rooflights).toHaveLength(1)
    expect(rooflights[0].observations).toHaveLength(2)
  })

  it('discards an observation outside the eave-to-ridge band', () => {
    const { rooflights, notes } = fuseRooflights([ob({ id: 'a', t: 2.0 })], [roof], frameOf, (x) => height(x), bounds)
    expect(rooflights).toHaveLength(0)
    expect(notes.join(' ')).toMatch(/outside the/)
  })

  it('discards everything when there is no pitched roof to place it on', () => {
    const flat: RoofHypothesis = { ...roof, kind: 'FLAT', pitchDeg: 0, ridgeY: 3, eaveY: 3 }
    const { rooflights, notes } = fuseRooflights([ob({ id: 'a' })], [flat], frameOf, () => 3, bounds)
    expect(rooflights).toHaveLength(0)
    expect(notes.join(' ')).toMatch(/no pitched roof/)
  })
})
