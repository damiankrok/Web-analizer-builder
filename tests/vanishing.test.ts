import { describe, expect, it } from 'vitest'
import { fitVanishingPoint, groupLineFamilies } from '../src/core/projection/vp-detect.js'
import { detectVanishingPoints } from '../src/core/projection/vp-detect.js'
import { analyseVanishingGeometry, isGenuineConvergence, DEFAULT_VANISHING, focalFromVanishingPair } from '../src/core/projection/vanishing.js'
import type { Segment } from '../src/core/raster/lines.js'

const seg = (x1: number, y1: number, x2: number, y2: number): Segment => ({
  x1,
  y1,
  x2,
  y2,
  angle: ((Math.atan2(y2 - y1, x2 - x1) % Math.PI) + Math.PI) % Math.PI,
  length: Math.hypot(x2 - x1, y2 - y1),
  support: Math.round(Math.hypot(x2 - x1, y2 - y1)),
})

/** Segments radiating from a common point, i.e. a genuine vanishing point. */
function convergentFamily(vpU: number, vpV: number, anchors: [number, number][], length: number): Segment[] {
  return anchors.map(([u, v]) => {
    const dx = vpU - u
    const dy = vpV - v
    const n = Math.hypot(dx, dy)
    return seg(u, v, u + (dx / n) * length, v + (dy / n) * length)
  })
}

const width = 800
const height = 600

describe('line family grouping', () => {
  it('separates verticals, near-horizontals and oblique roof lines', () => {
    const segments = [
      seg(100, 100, 100, 400),
      seg(300, 120, 300, 420),
      seg(100, 100, 500, 108),
      seg(120, 300, 520, 292),
      seg(200, 300, 400, 120), // roof pitch
    ]
    const f = groupLineFamilies(segments)
    expect(f.vertical).toHaveLength(2)
    expect(f.horizontalA.length + f.horizontalB.length).toBe(2)
    expect(f.oblique).toHaveLength(1)
  })
})

describe('vanishing point fitting', () => {
  it('reports a parallel family as parallel, not as a distant point', () => {
    const parallel = [seg(50, 100, 450, 100), seg(60, 200, 460, 200), seg(70, 300, 470, 300), seg(80, 400, 480, 400), seg(90, 500, 490, 500)]
    const vp = fitVanishingPoint(parallel, Math.hypot(width, height))
    expect(vp.model).toBe('PARALLEL')
    expect(vp.finite).toBeNull()
  })

  it('recovers a finite vanishing point from a convergent family', () => {
    const family = convergentFamily(2400, 300, [
      [100, 120],
      [100, 200],
      [100, 280],
      [100, 360],
      [100, 440],
    ], 400)
    const vp = fitVanishingPoint(family, Math.hypot(width, height))
    expect(vp.model).toBe('CONVERGENT')
    expect(vp.finite?.u).toBeCloseTo(2400, -1)
    expect(vp.finite?.v).toBeCloseTo(300, -1)
  })

  it('tolerates noisy lines around a true vanishing point', () => {
    const family = convergentFamily(1800, 320, [
      [120, 140],
      [120, 210],
      [120, 280],
      [120, 350],
      [120, 420],
      [120, 490],
    ], 380).map((s, i) => seg(s.x1, s.y1, s.x2 + (i % 2 === 0 ? 3 : -3), s.y2 + (i % 3 === 0 ? 2 : -2)))
    const vp = fitVanishingPoint(family, Math.hypot(width, height))
    expect(vp.model).toBe('CONVERGENT')
    expect(Math.abs((vp.finite?.u ?? 0) - 1800)).toBeLessThan(600)
  })

  it('declines to decide when evidence is insufficient', () => {
    const vp = fitVanishingPoint([seg(0, 0, 10, 1), seg(0, 20, 10, 21)], Math.hypot(width, height))
    expect(vp.model).toBe('UNDETERMINED')
  })
})

describe('genuine convergence guard', () => {
  it('rejects a pencil of lines meeting at a point inside the image', () => {
    // Short segments radiating from a corner: fits a point beautifully, but the
    // lines are nowhere near parallel, so it is not a vanishing point.
    const pencil = convergentFamily(400, 300, [
      [420, 200],
      [500, 260],
      [520, 340],
      [430, 400],
      [340, 380],
      [330, 240],
    ], 60)
    const candidates = detectVanishingPoints(pencil, width, height)
    const centre = { u: width / 2, v: height / 2 }
    const diag = Math.hypot(width, height)
    for (const c of candidates) {
      expect(isGenuineConvergence(c, DEFAULT_VANISHING, centre, diag), c.id).toBe(false)
    }
  })

  it('accepts a near-parallel family converging far outside the frame', () => {
    const family = convergentFamily(5200, 300, [
      [100, 150],
      [100, 220],
      [100, 290],
      [100, 360],
      [100, 430],
      [100, 500],
    ], 500)
    const geometry = analyseVanishingGeometry(family, width, height)
    expect(geometry.horizontalConverges).toBe(true)
  })
})

describe('focal from an orthogonal vanishing pair', () => {
  it('recovers the focal length used to construct the pair', () => {
    const f = 900
    const principal = { u: 400, v: 300 }
    // Two directions orthogonal in the world: (v1-p)·(v2-p) = -f^2.
    const v1 = { u: principal.u + 1200, v: principal.v }
    const v2 = { u: principal.u - (f * f) / 1200, v: principal.v }
    const mk = (finite: { u: number; v: number }) =>
      ({ finite, model: 'CONVERGENT' }) as unknown as Parameters<typeof focalFromVanishingPair>[0]
    expect(focalFromVanishingPair(mk(v1), mk(v2), principal)).toBeCloseTo(f, 6)
  })

  it('returns null when the geometry admits no real focal', () => {
    const principal = { u: 400, v: 300 }
    const mk = (finite: { u: number; v: number }) =>
      ({ finite, model: 'CONVERGENT' }) as unknown as Parameters<typeof focalFromVanishingPair>[0]
    expect(focalFromVanishingPair(mk({ u: 900, v: 300 }), mk({ u: 1200, v: 300 }), principal)).toBeNull()
  })
})
