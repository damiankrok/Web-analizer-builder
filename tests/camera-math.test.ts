import { describe, expect, it } from 'vitest'
import {
  DEFAULT_NEAR,
  cameraCentre,
  intrinsicsFromFovY,
  lookAt,
  project,
  projectPolygon,
  projectSegment,
  toCamera,
  toWorld,
  unproject,
  type CameraView,
} from '../src/core/camera/projector.js'
import { makeTarget, pointVisibility, renderPerspective, type Tri } from '../src/core/camera/render.js'
import { deg2rad, v3dist, v3sub, v3len } from '../src/core/math/vec.js'
import { fovYFromFocal, focalFromFovY } from '../src/core/contracts/camera.js'

const view = (opts: Partial<CameraView> = {}): CameraView => ({
  width: 800,
  height: 600,
  near: DEFAULT_NEAR,
  intrinsics: intrinsicsFromFovY(deg2rad(45), 800, 600),
  extrinsics: lookAt({ x: 0, y: 5, z: -20 }, { x: 0, y: 3, z: 0 }),
  ...opts,
})

describe('projection round-trip', () => {
  it('unprojects a projected point back onto its own ray', () => {
    const v = view()
    const world = { x: 2.5, y: 4, z: 1.5 }
    const p = project(world, v)
    expect(p.inFront).toBe(true)
    expect(p.visible).toBe(true)

    const dir = unproject(p.u, p.v, v)
    const centre = cameraCentre(v.extrinsics)
    // The world point must lie on the ray from the camera centre.
    const toPoint = v3sub(world, centre)
    const dist = v3len(toPoint)
    const onRay = { x: centre.x + dir.x * dist, y: centre.y + dir.y * dist, z: centre.z + dir.z * dist }
    expect(v3dist(onRay, world)).toBeLessThan(1e-6)
  })

  it('round-trips world -> camera -> world', () => {
    const v = view()
    const world = { x: -3, y: 7.25, z: 4 }
    expect(v3dist(toWorld(toCamera(world, v.extrinsics), v.extrinsics), world)).toBeLessThan(1e-9)
  })

  it('recovers the camera centre from the extrinsics', () => {
    const eye = { x: -8, y: 6, z: -14 }
    const e = lookAt(eye, { x: 0, y: 3, z: 0 })
    expect(v3dist(cameraCentre(e), eye)).toBeLessThan(1e-9)
  })
})

describe('known synthetic pose', () => {
  it('puts the look-at target at the principal point', () => {
    const target = { x: 1, y: 3, z: 2 }
    const v = view({ extrinsics: lookAt({ x: 10, y: 4, z: -10 }, target) })
    const p = project(target, v)
    expect(p.u).toBeCloseTo(v.intrinsics.cx, 6)
    expect(p.v).toBeCloseTo(v.intrinsics.cy, 6)
  })

  it('projects a metre grid symmetrically about the axis for a level camera', () => {
    const v = view({ extrinsics: lookAt({ x: 0, y: 2, z: -10 }, { x: 0, y: 2, z: 0 }) })
    const left = project({ x: -2, y: 2, z: 0 }, v)
    const right = project({ x: 2, y: 2, z: 0 }, v)
    expect(left.v).toBeCloseTo(right.v, 9)
    expect(v.intrinsics.cx - left.u).toBeCloseTo(right.u - v.intrinsics.cx, 9)
  })

  it('maps a higher world point to a smaller v (image y points down)', () => {
    const v = view({ extrinsics: lookAt({ x: 0, y: 2, z: -10 }, { x: 0, y: 2, z: 0 }) })
    expect(project({ x: 0, y: 5, z: 0 }, v).v).toBeLessThan(project({ x: 0, y: 1, z: 0 }, v).v)
  })

  it('scales image displacement inversely with depth', () => {
    const v = view({ extrinsics: lookAt({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }) })
    const near = project({ x: 1, y: 0, z: 10 }, v)
    const far = project({ x: 1, y: 0, z: 20 }, v)
    expect(near.u - v.intrinsics.cx).toBeCloseTo(2 * (far.u - v.intrinsics.cx), 6)
  })
})

describe('focal and field of view', () => {
  it('round-trips fovY <-> focal', () => {
    const f = focalFromFovY(deg2rad(35), 600)
    expect((fovYFromFocal(f, 600) * 180) / Math.PI).toBeCloseTo(35, 9)
  })

  it('a shifted principal point translates the image without changing scale', () => {
    const base = view()
    const shifted = view({ intrinsics: { ...base.intrinsics, cx: base.intrinsics.cx + 60, cy: base.intrinsics.cy - 25 } })
    const a = project({ x: 1, y: 3, z: 1 }, base)
    const b = project({ x: 1, y: 3, z: 1 }, shifted)
    expect(b.u - a.u).toBeCloseTo(60, 9)
    expect(b.v - a.v).toBeCloseTo(-25, 9)
  })
})

describe('near-plane clipping', () => {
  it('clips a segment that crosses behind the camera instead of projecting garbage', () => {
    const v = view({ extrinsics: lookAt({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }) })
    const seg = projectSegment({ x: 0, y: 0, z: 5 }, { x: 0, y: 0, z: -5 }, v)
    expect(seg.valid).toBe(true)
    expect(seg.clipped).toBe(true)
    expect(Number.isFinite(seg.b.u)).toBe(true)
    expect(Number.isFinite(seg.b.v)).toBe(true)
  })

  it('reports a segment entirely behind the camera as invalid', () => {
    const v = view({ extrinsics: lookAt({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }) })
    expect(projectSegment({ x: 0, y: 0, z: -5 }, { x: 1, y: 0, z: -8 }, v).valid).toBe(false)
  })

  it('clips a polygon spanning the near plane to a finite ring', () => {
    const v = view({ extrinsics: lookAt({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }) })
    const ring = projectPolygon(
      [
        { x: -2, y: -2, z: 5 },
        { x: 2, y: -2, z: 5 },
        { x: 2, y: 2, z: -5 },
        { x: -2, y: 2, z: -5 },
      ],
      v,
    )
    expect(ring.length).toBeGreaterThanOrEqual(3)
    for (const p of ring) {
      expect(Number.isFinite(p.u)).toBe(true)
      expect(Number.isFinite(p.v)).toBe(true)
    }
  })
})

describe('visibility engine', () => {
  const quad = (z: number, half: number, ownerId: string): Tri[] => [
    { a: { x: -half, y: -half, z }, b: { x: half, y: -half, z }, c: { x: half, y: half, z }, ownerId },
    { a: { x: -half, y: -half, z }, b: { x: half, y: half, z }, c: { x: -half, y: half, z }, ownerId },
  ]

  const v = view({ extrinsics: lookAt({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }) })

  it('sees a feature on the front surface', () => {
    const target = renderPerspective(quad(10, 3, 'wall'), v, 200, 150)
    const verdict = pointVisibility({ x: 0, y: 0, z: 10 }, v, target)
    expect(verdict.inFrame).toBe(true)
    expect(verdict.visible).toBe(true)
    expect(verdict.occluded).toBe(false)
  })

  it('reports a feature hidden behind nearer geometry as occluded', () => {
    const tris = [...quad(10, 3, 'wall'), ...quad(5, 3, 'annex')]
    const target = renderPerspective(tris, v, 200, 150)
    const verdict = pointVisibility({ x: 0, y: 0, z: 10 }, v, target)
    expect(verdict.inFrame).toBe(true)
    expect(verdict.visible).toBe(false)
    expect(verdict.occluded).toBe(true)
  })

  it('reports a feature outside the frame as cropped, not occluded', () => {
    const target = renderPerspective(quad(10, 3, 'wall'), v, 200, 150)
    const verdict = pointVisibility({ x: 40, y: 0, z: 10 }, v, target)
    expect(verdict.cropped).toBe(true)
    expect(verdict.occluded).toBe(false)
    expect(verdict.visible).toBe(false)
  })

  it('reports a feature behind the camera as cropped', () => {
    const target = renderPerspective(quad(10, 3, 'wall'), v, 200, 150)
    expect(pointVisibility({ x: 0, y: 0, z: -3 }, v, target).cropped).toBe(true)
  })

  it('leaves an empty depth buffer where nothing is drawn', () => {
    const t = makeTarget(10, 10)
    expect([...t.depth].every((d) => d === Number.POSITIVE_INFINITY)).toBe(true)
    expect([...t.mask.data].every((m) => m === 0)).toBe(true)
  })
})
