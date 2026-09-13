/**
 * STAGE WEB-PIVOT-05 — the Marcowki characteristic facade, and the ten ways it can be wrong.
 *
 * The stage's claim is that this model is recognisably *this* house and not a
 * gable box with the right dimensions: a one-metre recess front and back with
 * real wall returns down their sides, the balconies and glass balustrades
 * inside them, the dark portal over the entrance and the garage, and twelve
 * openings that are holes rather than pictures of holes.
 *
 * Every assertion below is a measurement taken from the emitted triangles by
 * `tests/facade-oracles.ts`. None of them asks a compiler what it believes it
 * did, and each one would fail on a flat facade with the same silhouette —
 * which is the only kind of proof that separates this stage's work from a
 * render. The mutation block at the end is the other half of the same claim:
 * each of the ten defects §26 names is built and the corresponding check is
 * asserted to fail.
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import {
  facadeGold,
  marcowkiFacadeScene,
  type MarcowkiFacadeOptions,
} from '../src/core/wallspec/marcowki-facade-fixture.js'
import type { WallSpec } from '../src/core/wallspec/contracts.js'
import type { ExteriorOpeningGroup } from '../src/core/wallspec/facade.js'
import type { OTri } from './geometry-oracles.js'
import {
  anchorCheck,
  axisGrid,
  duplicateVolumeReport,
  facadeDepthMap,
  nearestAt,
  openingCutReport,
  openingRoomTable,
  planScan,
  portalReport,
  railingReport,
  recessReport,
  rakedHeadReport,
  silhouette,
  slabReport,
  type DepthMap,
  type FacadeView,
} from './facade-oracles.js'

const scene = marcowkiFacadeScene()
const walls = new Map(scene.spec.building.walls.map((w) => [w.id, w]))
const levelOf = (o: ExteriorOpeningGroup): string => (o.storey === 'GROUND' ? 'ground' : 'upper')

const VIEW_OF: Record<string, FacadeView> = {
  FRONT: 'FRONT',
  REAR: 'REAR',
  EAST: 'EAST',
  WEST: 'WEST',
  NORTH_GARAGE: 'REAR',
}
const VIEW_BOUNDS = { acrossFromM: -1.5, acrossToM: 14.1, upFromM: -0.5, upToM: 8.5 }
const maps = new Map<FacadeView, DepthMap>()
const mapFor = (v: FacadeView, tris = scene.tris): DepthMap => {
  if (tris !== scene.tris) return facadeDepthMap(tris, v, VIEW_BOUNDS)
  const got = maps.get(v)
  if (got !== undefined) return got
  const made = facadeDepthMap(tris, v, VIEW_BOUNDS)
  maps.set(v, made)
  return made
}

/** The rectangle the source puts an opening in, in its own elevation's axes. */
function anchorRect(
  w: WallSpec,
  o: ExteriorOpeningGroup,
  view: FacadeView,
): { acrossFromM: number; acrossToM: number; upFromM: number; upToM: number; facePlaneM: number } {
  const p0 = { x: w.origin.x + w.u.x * o.offsetM, z: w.origin.z + w.u.z * o.offsetM }
  const p1 = {
    x: w.origin.x + w.u.x * (o.offsetM + o.widthM),
    z: w.origin.z + w.u.z * (o.offsetM + o.widthM),
  }
  const flat = view === 'FRONT' || view === 'REAR'
  return {
    acrossFromM: flat ? Math.min(p0.x, p1.x) : Math.min(p0.z, p1.z),
    acrossToM: flat ? Math.max(p0.x, p1.x) : Math.max(p0.z, p1.z),
    upFromM: w.origin.y + o.sillM,
    // A raked head only guarantees a rectangle up to its lower end; the sloping
    // part is `rakedHeadReport`'s business, not the anchor's.
    upToM: w.origin.y + Math.min(o.headM, o.headFarM ?? o.headM),
    facePlaneM: flat ? w.origin.z : w.origin.x,
  }
}

const exteriorOpenings = scene.spec.facade.openings.filter((o) => o.exposure === 'EXTERIOR')

describe('STAGE WEB-PIVOT-05 — the facade compiles into the house', () => {
  it('compiles shell, interior and facade together with no diagnostics at all', () => {
    expect(scene.diagnostics).toEqual([])
  })

  it('emits the facade elements the gold names, and nothing it does not', () => {
    const kinds = new Set(scene.facade.tris.map((t) => t.elementKind))
    expect([...kinds].sort()).toEqual(['FILL', 'MULLION', 'RAILING', 'RETURN', 'SLAB'])
    const returns = new Set(scene.facade.tris.filter((t) => t.elementKind === 'RETURN').map((t) => t.elementId))
    expect([...returns].sort()).toEqual(facadeGold.returns.map((r) => r.id).sort())
    const slabs = new Set(scene.facade.tris.filter((t) => t.elementKind === 'SLAB').map((t) => t.elementId))
    expect([...slabs].sort()).toEqual(facadeGold.slabs.map((s) => s.id).sort())
  })

  it('hands one structural cut per opening leaf to the wall compiler', () => {
    const leaves = scene.spec.facade.openings.reduce((n, o) => n + 1 + (o.leaves?.length ?? 0), 0)
    expect(scene.facade.cuts.length).toBe(leaves)
    const ids = scene.facade.cuts.map((c) => c.opening.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('shares no volume between any two solid elements of the whole house', () => {
    const byElement = new Map<string, OTri[]>()
    for (const t of scene.tris) {
      if (!t.solid) continue
      const key = `${t.layer}:${t.elementId}`
      const list = byElement.get(key) ?? []
      list.push({ a: t.a, b: t.b, c: t.c })
      byElement.set(key, list)
    }
    const meshes = [...byElement].map(([id, tris]) => ({ id, tris }))
    expect(meshes.length).toBeGreaterThan(30)
    const rows = duplicateVolumeReport(
      meshes,
      axisGrid({ minX: 0, maxX: 12.05, minY: 0, maxY: 8.2, minZ: -1, maxZ: 13.6 }),
    )
    expect(rows.map((r) => `${r.a} | ${r.b} = ${r.lengthM.toFixed(4)}`)).toEqual([])
  })
})

describe('STAGE WEB-PIVOT-05 §5, §7, §14, §15, §16 — every opening is a hole', () => {
  for (const o of scene.spec.facade.openings) {
    it(`${o.id} removes wall material and is filled only inside its own hole`, () => {
      const r = openingCutReport(scene.tris, walls, o)
      expect(r.leaves.length).toBe(1 + (o.leaves?.length ?? 0))
      for (const leaf of r.leaves) {
        const w = walls.get(leaf.hostWallId)
        expect(w).toBeDefined()
        // Nothing across the wall inside the opening, the full thickness beside
        // it and above its head. A picture of a hole fails the first; a hole in
        // the near leaf of a party wall only fails it on the far leaf.
        expect(leaf.throughM).toBeLessThan(1e-6)
        expect(leaf.besideM).toBeCloseTo(w!.thicknessM, 4)
        expect(leaf.aboveM).toBeCloseTo(w!.thicknessM, 4)
      }
      expect(r.fillM).toBeGreaterThan(0.04)
      expect(r.strayFillM).toBeLessThan(1e-9)
      expect(r.revealAreaM2).toBeGreaterThan(1.5)
    })
  }

  it('the kotlownia door is cut through both leaves of the party wall', () => {
    const o = scene.spec.facade.openings.find((x) => x.id === 'og_east_garage_door')!
    expect(o.leaves?.map((l) => l.hostWallId)).toEqual(['garage_left'])
    expect(o.exposure).toBe('CONCEALED')
    const r = openingCutReport(scene.tris, walls, o)
    expect(r.leaves.map((l) => l.hostWallId)).toEqual(['ground_main_right', 'garage_left'])
    expect(r.worstThroughM).toBeLessThan(1e-6)
  })

  it('counts eleven openings on the exterior and one concealed', () => {
    expect(exteriorOpenings.length).toBe(11)
    expect(scene.spec.facade.openings.length - exteriorOpenings.length).toBe(1)
    const perFacade = new Map<string, number>()
    for (const o of exteriorOpenings) perFacade.set(o.facade, (perFacade.get(o.facade) ?? 0) + 1)
    expect([...perFacade].sort()).toEqual([
      ['EAST', 1],
      ['FRONT', 4],
      ['NORTH_GARAGE', 1],
      ['REAR', 3],
      ['WEST', 2],
    ])
  })
})

describe('STAGE WEB-PIVOT-05 §9, §10 — the recesses are a metre of nothing', () => {
  for (const r of scene.spec.facade.recesses) {
    it(`${r.id} is open at its mouth and one metre deep`, () => {
      const rep = recessReport(scene.tris, r, [0.4, 1.2, 2.0])
      expect(rep.statedDepthM).toBeCloseTo(1.0, 9)
      expect(rep.openAtMouth).toBe(1)
      expect(rep.nearerThanStated).toBe(0)
      expect(rep.minDepthM).toBeCloseTo(1.0, 6)
    })
  }

  it('the returns are solid walls that reach the roof soffit exactly', () => {
    // Each return is probed on its own centre line, and the expected top is the
    // soffit plane evaluated there — 4.36 at the eave rising at the printed 40°
    // — not a number the compiler was asked for. `return_east_front` sits on the
    // balcony slab, so the probe reads the two as one run from the slab soffit.
    const TAN40 = Math.tan((40 * Math.PI) / 180)
    const soffit = (x: number): number => 4.36 + TAN40 * Math.min(x, 7.9 - x)
    const expected: Record<string, { x: number; base: number; top: number }> = {
      return_west_front: { x: 0.305, base: 0, top: soffit(0.305) },
      return_west_rear: { x: 0.305, base: 0, top: soffit(0.305) },
      // The east return of the front recess starts on the balcony slab rather
      // than on the ground, which is the difference between the two plans.
      return_east_front: { x: 7.595, base: 2.96, top: soffit(7.595) },
      return_east_rear: { x: 7.595, base: 0, top: soffit(7.595) },
      return_garage_east_front: { x: 11.745, base: 0, top: 3.08 },
    }
    for (const [id, e] of Object.entries(expected)) {
      // Two samples puts one probe on the return's exact centre line, which is
      // where the expected soffit height is evaluated; a wider grid would read
      // the plane a centimetre up the slope and compare it with the centre.
      const rep = slabReport(
        scene.tris,
        id,
        {
          minX: e.x - 0.2,
          maxX: e.x + 0.2,
          minZ: id.endsWith('rear') ? -1 : 12.6,
          maxZ: id.endsWith('rear') ? 0 : 13.6,
        },
        2,
      )
      expect(rep.coverage).toBe(1)
      expect(rep.bottomM!).toBeCloseTo(e.base, 6)
      expect(rep.topM!).toBeCloseTo(e.top, 3)
    }
    // And what it stands on is the balcony slab's top, not thin air.
    const balcony = scene.spec.facade.slabs.find((x) => x.id === 'balcony_front')!
    expect(balcony.topM).toBeCloseTo(expected.return_east_front.base, 9)
    expect(balcony.footprint.maxX).toBeGreaterThanOrEqual(7.9)
  })

  it('the front recess is one metre deep at ground level and only at attic level on the east side', () => {
    const m = mapFor('FRONT')
    // The west return projects at both storeys; the east return only above the
    // balcony. That difference is the whole reason the front is not symmetric,
    // and both plans say so.
    expect(nearestAt(m, 0.3, 1.2)).toBeCloseTo(13.6, 2)
    expect(nearestAt(m, 0.3, 3.5)).toBeCloseTo(13.6, 2)
    expect(nearestAt(m, 7.6, 1.2)).toBeCloseTo(12.6, 2)
    expect(nearestAt(m, 7.6, 3.5)).toBeCloseTo(13.6, 2)
    expect(nearestAt(m, 3.0, 1.2)).toBeCloseTo(12.6, 2)
    expect(nearestAt(m, 11.8, 1.2)).toBeCloseTo(13.6, 2)
  })
})

describe('STAGE WEB-PIVOT-05 §11 — the balcony slabs are solids', () => {
  for (const s of scene.spec.facade.slabs) {
    it(`${s.id} has the volume, the top and the soffit the gold states`, () => {
      const rep = slabReport(scene.tris, s.id, s.footprint)
      const want = (s.footprint.maxX - s.footprint.minX) * (s.footprint.maxZ - s.footprint.minZ) * s.thicknessM
      expect(rep.volumeM3).toBeCloseTo(want, 6)
      expect(rep.volumeM3).toBeGreaterThan(1.0)
      expect(rep.coverage).toBe(1)
      expect(rep.topM!).toBeCloseTo(s.topM, 9)
      expect(rep.bottomM!).toBeCloseTo(s.topM - s.thicknessM, 9)
    })
  }
})

describe('STAGE WEB-PIVOT-05 §12 — the balustrades are panelled glass', () => {
  for (const r of scene.spec.facade.railings) {
    it(`${r.id} is glass, in the panels the attic plan draws, with no daylight between them`, () => {
      const rep = railingReport(scene.tris, r)
      expect(rep.panels).toBe(4)
      expect(rep.allGlass).toBe(true)
      expect(rep.gapLengthM).toBeLessThan(1e-9)
      const ext = r.panels.reduce(
        (acc, p) => ({ from: Math.min(acc.from, p.fromM), to: Math.max(acc.to, p.toM) }),
        { from: Infinity, to: -Infinity },
      )
      expect(rep.measuredFromM).toBeCloseTo(ext.from, 1)
      expect(rep.measuredToM).toBeCloseTo(ext.to, 1)
      expect(rep.baseM!).toBeCloseTo(r.baseM, 9)
      expect(rep.topM!).toBeCloseTo(r.baseM + r.heightM, 9)
      // Glass over most of the run, but not all of it: the posts are real.
      const span = ext.to - ext.from
      expect(rep.glassLengthM).toBeGreaterThan(span * 0.85)
      expect(rep.glassLengthM).toBeLessThan(span * 0.98)
    })
  }

  it('stands on the slab it names', () => {
    for (const r of scene.spec.facade.railings) {
      const slab = scene.spec.facade.slabs.find((s) => s.id === r.slabId)
      expect(slab).toBeDefined()
      expect(r.baseM).toBeCloseTo(slab!.topM, 9)
    }
  })
})

describe('STAGE WEB-PIVOT-05 §13 — the portal is geometry', () => {
  it('its mouth is open, its jambs are solid and its head is over it', () => {
    const p = scene.spec.facade.portals[0]
    const rep = portalReport(scene.tris, p)
    expect(rep.blockedSamples).toBe(0)
    expect(rep.totalSamples).toBeGreaterThan(50)
    for (const j of rep.jambMaterialM) expect(j).toBeCloseTo(Math.abs(p.depthM), 6)
    expect(rep.headMaterialM).toBeGreaterThan(0.4)
    expect(rep.measuredDepthM).toBeCloseTo(Math.abs(p.depthM), 6)
  })

  it('names elements that exist, and is framed by them', () => {
    const p = scene.spec.facade.portals[0]
    const returnIds = new Set(scene.spec.facade.returns.map((r) => r.id))
    const slabIds = new Set(scene.spec.facade.slabs.map((s) => s.id))
    for (const j of p.jambIds) expect(returnIds.has(j)).toBe(true)
    for (const h of p.headIds) expect(slabIds.has(h)).toBe(true)
  })
})

describe('STAGE WEB-PIVOT-05 §17 — the gable openings follow the printed polygon', () => {
  const TAN40 = Math.tan((40 * Math.PI) / 180)
  // Rebuilt from the printed callouts and the printed pitch alone. Nothing here
  // reads a compiled height, so a compiler that agreed with itself about a
  // wrong polygon would still fail.
  const SOURCE: Record<string, (f: number) => number> = {
    og_front_gable_glazing: (f) => 3.2 - f * 2.7 * TAN40,
    og_rear_gable_east: (f) => 3.03 - (1 - f) * 2.34 * TAN40,
    og_rear_gable_west: (f) => 3.03 - f * 2.34 * TAN40,
  }
  for (const [id, head] of Object.entries(SOURCE)) {
    it(`${id} is cut to the rake, closed above, and has no glass outside it`, () => {
      const o = scene.spec.facade.openings.find((x) => x.id === id)!
      const rep = rakedHeadReport(scene.tris, walls.get(o.hostWallId)!, o, head)
      expect(rep.maxHeadErrorM).toBeLessThan(0.005)
      expect(rep.minClosedAboveM).toBeGreaterThan(0.5)
      expect(rep.strayGlassM).toBeLessThan(1e-9)
      // The rake is real: the two ends of the polygon differ by the pitch.
      expect(Math.abs(head(0) - head(1))).toBeCloseTo(o.widthM * TAN40, 3)
    })
  }
})

describe('STAGE WEB-PIVOT-05 §21 — the orthographic elevations agree with the source', () => {
  it('every elevation shows the silhouette the plans measure', () => {
    // The grid samples cell centres, so a bound is read up to one cell short of
    // the truth; the assertions bracket rather than pretend to sub-cell accuracy.
    const cellAcross = (VIEW_BOUNDS.acrossToM - VIEW_BOUNDS.acrossFromM) / 160
    const cellUp = (VIEW_BOUNDS.upToM - VIEW_BOUNDS.upFromM) / 110
    const near = (got: number, want: number, cell: number): void => {
      expect(Math.abs(got - want)).toBeLessThanOrEqual(cell)
    }
    const front = silhouette(mapFor('FRONT'))
    near(front.acrossFromM, 0, cellAcross)
    near(front.acrossToM, 12.05, cellAcross)
    near(front.upToM, 7.95, cellUp)
    near(front.upFromM, 0, cellUp)
    const east = silhouette(mapFor('EAST'))
    // -1.00 to 13.60 is the 14.60 m the side elevations measure and the walled
    // envelope alone cannot produce.
    near(east.acrossFromM, -1.0, cellAcross)
    near(east.acrossToM, 13.6, cellAcross)
    const west = silhouette(mapFor('WEST'))
    near(west.acrossToM - west.acrossFromM, 14.6, 2 * cellAcross)
    const rear = silhouette(mapFor('REAR'))
    near(rear.acrossToM - rear.acrossFromM, 12.05, 2 * cellAcross)
  })

  for (const o of exteriorOpenings) {
    it(`${o.id} appears in the ${VIEW_OF[o.facade]} elevation exactly where the source puts it`, () => {
      const w = walls.get(o.hostWallId)!
      const view = VIEW_OF[o.facade]
      const a = anchorRect(w, o, view)
      const c = anchorCheck(mapFor(view), o.id, a, a.facePlaneM)
      expect(c.voidInside).toBe(1)
      expect(c.voidAround).toBe(0)
      expect(c.verdict).toBe('MATCH')
    })
  }
})

describe('STAGE WEB-PIVOT-05 §22 — the plan oracle reproduces the plan raster', () => {
  it('the returns run the full 14.60 m at the building edges', () => {
    // The ground plan's row scans find ink at x 0.000..0.636 and nothing between
    // the returns; the model, sliced the same way, has to say the same.
    const west = planScan(scene.tris, 'Z', 0.305, 1.2)
    expect(west[0].fromM).toBeCloseTo(-1.0, 6)
    expect(west[west.length - 1].toM).toBeCloseTo(13.6, 6)
    const rear = planScan(scene.tris, 'X', -0.5, 1.2)
    expect(rear.map((r) => [Number(r.fromM.toFixed(3)), Number(r.toM.toFixed(3))])).toEqual([
      [0, 0.61],
      [7.29, 7.9],
    ])
  })

  it('the front recess is empty between its returns at ground level', () => {
    // The ground plan's row scan at z 13.1 finds black ink at x 0.000..0.636 and
    // at 11.441..12.050 and nothing at all between them. So does the model.
    const front = planScan(scene.tris, 'X', 13.1, 1.2)
    expect(front.map((r) => [Number(r.fromM.toFixed(3)), Number(r.toM.toFixed(3))])).toEqual([
      [0, 0.61],
      [11.44, 12.05],
    ])
    const mouth = planScan(scene.tris, 'X', 12.3, 1.2)
    // The front wall, with the room window, the entrance and the garage door in
    // it — the same three gaps the plan's row scan finds.
    expect(mouth.map((r) => [Number(r.fromM.toFixed(3)), Number(r.toM.toFixed(3))])).toEqual([
      [0, 1.397],
      [2.497, 4.176],
      [5.226, 8.556],
      [11.306, 12.05],
    ])
  })

  it('the east return stops at the balcony on the front and runs to the ground on the rear', () => {
    const atGround = planScan(scene.tris, 'Z', 7.595, 1.2)
    expect(atGround[atGround.length - 1].toM).toBeCloseTo(12.6, 6)
    expect(atGround[0].fromM).toBeCloseTo(-1.0, 6)
    const atAttic = planScan(scene.tris, 'Z', 7.595, 3.5)
    expect(atAttic[atAttic.length - 1].toM).toBeCloseTo(13.6, 6)
  })

  it('the garage sits where the plan puts it against the main body', () => {
    const across = planScan(scene.tris, 'X', 6.0, 1.2)
    expect(across.map((r) => [Number(r.fromM.toFixed(3)), Number(r.toM.toFixed(3))])).toEqual([
      [7.45, 8.35],
      [11.6, 12.05],
    ])
  })
})

describe('STAGE WEB-PIVOT-05 §8 — every opening looks into the room it claims', () => {
  const table = openingRoomTable(scene.spec.interior, walls, scene.spec.facade.openings, levelOf)
  it('finds a room behind all twelve, and it is the right one every time', () => {
    expect(table.length).toBe(12)
    expect(table.filter((r) => r.verdict !== 'MATCH')).toEqual([])
  })
  for (const row of table) {
    it(`${row.openingId} opens into ${row.claimedRoomId}`, () => {
      expect(row.foundRoomId).toBe(row.claimedRoomId)
    })
  }
})

describe('STAGE WEB-PIVOT-05 §27 — the facade gold stays out of production', () => {
  it('no module under src/core, src/node or src/ui imports it', () => {
    const offenders: string[] = []
    const walk = (dir: string): void => {
      for (const e of readdirSyncSafe(dir)) {
        const p = `${dir}/${e}`
        if (isDir(p)) walk(p)
        else if (/\.(ts|tsx)$/.test(e) && !/facade|marcowki|interior-fixture/.test(e)) {
          const src = readFileSync(p, 'utf8')
          if (src.includes('marcowki-facade-v1') || src.includes('marcowki-facade-fixture')) offenders.push(p)
        }
      }
    }
    walk('src')
    expect(offenders).toEqual([])
  })
})

function readdirSyncSafe(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}
function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

// --- mutations --------------------------------------------------------------

/**
 * A facade broken one way, with the same oracles run over it.
 *
 * Each block asserts the *specific* check that should notice. A mutation that
 * merely made the compiler unhappy would prove nothing about the oracles, so
 * every one of these still compiles cleanly and still looks plausible from the
 * front; only a measurement separates it from the real building.
 */
const mutant = (opts: MarcowkiFacadeOptions): ReturnType<typeof marcowkiFacadeScene> => marcowkiFacadeScene(opts)

describe('STAGE WEB-PIVOT-05 §26 — ten defects the oracles catch', () => {
  it('1. a recess filled with material reads zero deep and blocks the portal', () => {
    const m = mutant({ flattenRecess: 'recess_front' })
    const r = recessReport(m.tris, m.spec.facade.recesses[0], [0.4, 1.2, 2.0])
    expect(r.openAtMouth).toBe(0)
    expect(r.minDepthM).toBeCloseTo(0, 6)
    expect(r.nearerThanStated).toBe(r.samples.length)
    const p = portalReport(m.tris, m.spec.facade.portals[0])
    expect(p.blockedSamples).toBe(p.totalSamples)
    // And the openings it buries vanish from the elevation.
    const view = mapFor('FRONT', m.tris)
    const o = m.spec.facade.openings.find((x) => x.id === 'og_front_entrance')!
    const a = anchorRect(walls.get(o.hostWallId)!, o, 'FRONT')
    expect(anchorCheck(view, o.id, a, a.facePlaneM).verdict).toBe('MISSING')
  })

  it('2. a back wall pushed out to the facade plane is caught by depth and by room', () => {
    const m = mutant({ backWallToOuterPlane: 'recess_front' })
    const r = recessReport(m.tris, m.spec.facade.recesses[0], [0.4, 1.2, 2.0])
    expect(r.minDepthM).toBeCloseTo(0, 6)
    expect(r.nearerThanStated).toBeGreaterThan(20)
    const table = openingRoomTable(m.spec.interior, new Map(m.spec.building.walls.map((w) => [w.id, w])), m.spec.facade.openings, levelOf)
    expect(table.filter((x) => x.verdict === 'NO_ROOM').map((x) => x.openingId).sort()).toEqual([
      'og_front_entrance',
      'og_front_gable_glazing',
      'og_front_room_window',
      'og_garage_door',
    ])
  })

  it('3. a balcony slab removed, or slid along the facade, is caught by the slab probe', () => {
    const dropped = mutant({ dropSlab: 'balcony_front' })
    const gone = slabReport(dropped.tris, 'balcony_front', { minX: 3.338, maxX: 7.9, minZ: 12.6, maxZ: 13.6 })
    expect(gone.volumeM3).toBe(0)
    expect(gone.coverage).toBe(0)
    // With its head gone, the portal is a hole in the air.
    expect(portalReport(dropped.tris, dropped.spec.facade.portals[0]).headMaterialM).toBeLessThan(1e-9)

    const slid = mutant({ moveSlab: { slabId: 'balcony_front', deltaX: 1.2 } })
    const off = slabReport(slid.tris, 'balcony_front', { minX: 3.338, maxX: 7.9, minZ: 12.6, maxZ: 13.6 })
    expect(off.volumeM3).toBeCloseTo(gone.volumeM3 + 2.5091, 3)
    expect(off.coverage).toBeLessThan(0.9)
  })

  it('4. a balustrade turned opaque, or cut short, is caught by material and by extent', () => {
    const opaque = mutant({ opaqueRailing: 'railing_front' })
    const o = railingReport(opaque.tris, opaque.spec.facade.railings[0])
    expect(o.allGlass).toBe(false)
    expect(o.glassLengthM).toBe(0)

    const short = mutant({ shortenRailing: { railingId: 'railing_front', byM: 1.6 } })
    const s = railingReport(short.tris, short.spec.facade.railings[0])
    expect(s.measuredToM).toBeLessThan(7.134 - 1.4)
    expect(s.panels).toBeLessThan(4)
  })

  it('5. glazing added without cutting the wall is caught by a ray, not by a picture', () => {
    const m = mutant({ glazingWithoutCut: 'og_rear_living_glazing' })
    const o = m.spec.facade.openings.find((x) => x.id === 'og_rear_living_glazing')!
    const r = openingCutReport(m.tris, new Map(m.spec.building.walls.map((w) => [w.id, w])), o)
    // The glass is exactly where it should be, and the wall is still there.
    expect(r.fillM).toBeGreaterThan(0.04)
    expect(r.worstThroughM).toBeCloseTo(0.45, 6)
    const view = mapFor('REAR', m.tris)
    const a = anchorRect(walls.get(o.hostWallId)!, o, 'REAR')
    expect(anchorCheck(view, o.id, a, a.facePlaneM).verdict).toBe('MISSING')
  })

  it('6. a garage door re-hosted onto the wrong wall is caught by the room behind it', () => {
    const m = mutant({ moveOpening: { openingId: 'og_garage_door', toWallId: 'ground_main_rear', offsetM: 0.7 } })
    const table = openingRoomTable(m.spec.interior, new Map(m.spec.building.walls.map((w) => [w.id, w])), m.spec.facade.openings, levelOf)
    const row = table.find((x) => x.openingId === 'og_garage_door')!
    expect(row.verdict).toBe('WRONG_ROOM')
    expect(row.foundRoomId).not.toBe('g_garage')
    // And the source anchor on the front elevation is empty.
    const o = scene.spec.facade.openings.find((x) => x.id === 'og_garage_door')!
    const a = anchorRect(walls.get(o.hostWallId)!, o, 'FRONT')
    expect(anchorCheck(mapFor('FRONT', m.tris), o.id, a, a.facePlaneM).verdict).toBe('MISSING')
  })

  it('7. a portal projection reversed puts the head and the floor inside the house', () => {
    const m = mutant({ reversePortalProjection: true })
    // Nothing is missing and nothing is the wrong size — the slabs are simply on
    // the other side of the wall, which no elevation of the front can show.
    for (const id of ['balcony_front', 'portal_head_front']) {
      const stated = scene.spec.facade.slabs.find((x) => x.id === id)!
      const before = slabReport(scene.tris, id, stated.footprint)
      const after = slabReport(m.tris, id, stated.footprint)
      expect(before.coverage).toBe(1)
      expect(after.coverage).toBe(0)
      expect(after.volumeM3).toBeCloseTo(before.volumeM3, 6)
    }
    expect(m.spec.facade.portals[0].depthM).toBeLessThan(0)
  })

  it('8. a gable head levelled off no longer follows the printed polygon', () => {
    const TAN40 = Math.tan((40 * Math.PI) / 180)
    const m = mutant({ levelGableHead: 'og_front_gable_glazing' })
    const o = m.spec.facade.openings.find((x) => x.id === 'og_front_gable_glazing')!
    expect(o.headFarM).toBeUndefined()
    const rep = rakedHeadReport(m.tris, walls.get(o.hostWallId)!, o, (f) => 3.2 - f * 2.7 * TAN40)
    expect(rep.maxHeadErrorM).toBeGreaterThan(1.5)
  })

  it('9. a rear opening omitted leaves its source anchor solid', () => {
    const m = mutant({ dropOpening: 'og_rear_living_glazing' })
    expect(m.spec.facade.openings.some((x) => x.id === 'og_rear_living_glazing')).toBe(false)
    const o = scene.spec.facade.openings.find((x) => x.id === 'og_rear_living_glazing')!
    const a = anchorRect(walls.get(o.hostWallId)!, o, 'REAR')
    const c = anchorCheck(mapFor('REAR', m.tris), o.id, a, a.facePlaneM)
    expect(c.verdict).toBe('MISSING')
    expect(c.voidInside).toBe(0)
  })

  it('10. a mirrored facade puts every one of its openings somewhere else', () => {
    const m = mutant({ mirrorFacade: 'WEST' })
    const bad: string[] = []
    for (const o of exteriorOpenings) {
      if (o.facade !== 'WEST') continue
      const a = anchorRect(walls.get(o.hostWallId)!, o, 'WEST')
      if (anchorCheck(mapFor('WEST', m.tris), o.id, a, a.facePlaneM).verdict !== 'MATCH') bad.push(o.id)
    }
    expect(bad.sort()).toEqual(['og_west_kitchen_window', 'og_west_living_window'])
    // The other facades are untouched, so a mirrored one is a facade fault and
    // not a whole-model fault.
    const o = scene.spec.facade.openings.find((x) => x.id === 'og_east_living_window')!
    const a = anchorRect(walls.get(o.hostWallId)!, o, 'EAST')
    expect(anchorCheck(mapFor('EAST', m.tris), o.id, a, a.facePlaneM).verdict).toBe('MATCH')
  })
})
