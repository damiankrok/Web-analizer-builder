/**
 * STAGE WEB-PIVOT-05A — roof features, and the ten ways they can be wrong.
 *
 * The stage's claim is that the last three source-clear architectural systems
 * are now real geometry: the upper floor plate is one plate rather than two
 * disagreeing outlines, the three rooflights are holes through the roof rather
 * than glass laid on it, and the two chimneys pass through a roof that actually
 * terminates at them.
 *
 * Every assertion is a measurement taken from the emitted triangles by
 * `tests/roof-feature-oracles.ts`. None asks a compiler what it believes it
 * did, and each would fail on a roof that was never cut.
 *
 * ## One convention, twice
 *
 * A hole in a sloped plane is a *vertical* cut, so every probe through one is a
 * vertical ray. Firing along the plane normal instead leaves the hole through
 * its side before reaching the underside — on this 40° roof a 0.2756 m vertical
 * drop displaces a perpendicular projection 0.1771 m down-slope — and reports
 * the roof it then meets as material left in the hole. That is the convention
 * `emitPlane` already uses to find its reveals, and it is the convention here.
 */
import { describe, expect, it } from 'vitest'
import {
  chimneyFootprint,
  finishFloorAreaM2,
  marcowkiGoldScene,
  resolvedFinishFloor,
  resolvedStructuralSlab,
  roofFeaturesGold,
  roofPlaneFrames,
  rooflightOpenings,
  rooflightRoomBelow,
  type MarcowkiGoldOptions,
} from '../src/core/wallspec/marcowki-roof-features-fixture.js'
import { compileRoofs, type RoofOpeningSpec, type RoofPlaneFrame } from '../src/core/wallspec/roof.js'
import {
  chimneyClearanceM,
  chimneyPenetrationReport,
  elementTrisOf,
  openingPlanRect,
  roofOpeningCutReport,
  roomAt,
  type RoofOpeningCutReport,
} from './roof-feature-oracles.js'
import { axisGrid, duplicateVolumeReport } from './facade-oracles.js'
import { materialRuns, meshVolume, type OTri } from './geometry-oracles.js'

const scene = marcowkiGoldScene()
const frames = roofPlaneFrames(scene.spec.building)
const openingsById = new Map((scene.spec.building.roofOpenings ?? []).map((o) => [o.id, o]))
const massesById = new Map((scene.spec.building.masses ?? []).map((m) => [m.id, m]))

const rectOf = (o: RoofOpeningSpec): { u0: number; u1: number; v0: number; v1: number } => {
  const t = o.cutToleranceM ?? 0
  return {
    u0: o.centerUV.u - o.sizeUV.u / 2 - t,
    u1: o.centerUV.u + o.sizeUV.u / 2 + t,
    v0: o.centerUV.v - o.sizeUV.v / 2 - t,
    v1: o.centerUV.v + o.sizeUV.v / 2 + t,
  }
}
const frameOf = (o: RoofOpeningSpec): RoofPlaneFrame => {
  const f = frames.get(o.hostPlaneId)
  if (f === undefined) throw new Error(`no compiled plane ${o.hostPlaneId}`)
  return f
}
const cutOf = (o: RoofOpeningSpec, tris = scene.tris): RoofOpeningCutReport =>
  roofOpeningCutReport(tris, frameOf(o), o.id, rectOf(o))

const ROOFLIGHTS = ['rl_pralnia_w', 'rl_lazienka_w', 'rl_schody_e']
const STACKS = ['chimney_salon', 'chimney_boiler']

describe('STAGE WEB-PIVOT-05A — the whole house compiles with its roof features', () => {
  it('compiles shell, interior, facade and roof features with no diagnostics at all', () => {
    expect(scene.diagnostics).toEqual([])
  })

  it('carries three roof openings for rooflights and one per chimney', () => {
    const kinds = new Map<string, number>()
    for (const o of scene.spec.building.roofOpenings ?? []) kinds.set(o.kind, (kinds.get(o.kind) ?? 0) + 1)
    expect(kinds.get('ROOFLIGHT')).toBe(3)
    expect(kinds.get('PENETRATION')).toBe(2)
    expect(scene.spec.building.masses?.length).toBe(2)
  })

  it('emits the four roof parts, and glazing is not roof', () => {
    const parts = new Set(scene.tris.filter((t) => t.elementId.startsWith('roof_')).map((t) => t.part))
    for (const p of ['ROOF', 'ROOF_REVEAL', 'ROOF_FRAME', 'ROOF_GLAZING']) expect(parts.has(p)).toBe(true)
    // A pane that counted as roof would make every "is this a hole" check pass
    // on an intact roof, so it must not be solid.
    expect(scene.tris.filter((t) => t.part === 'ROOF_GLAZING').every((t) => !t.solid)).toBe(true)
  })
})

describe('STAGE WEB-PIVOT-05A §5 — the upper floor is one plate, not two outlines', () => {
  const structural = resolvedStructuralSlab()
  const finish = resolvedFinishFloor()

  it('takes the bearing rectangle the section supports, not the interior outline', () => {
    // The section draws the external wall as one 0.45 m fill with no bearing
    // line, so the wall owns that zone and the plate stops at its inner face.
    expect(structural).toEqual({ minX: 0.45, maxX: 7.45, minZ: 0.45, maxZ: 12.15 })
    const conflict = roofFeaturesGold.upperSlab.conflict
    expect(conflict.shellPolygon).toEqual(structural)
    expect(conflict.interiorPolygon).toEqual({ minX: 0, maxX: 7.9, minZ: 0, maxZ: 12.6 })
    expect(roofFeaturesGold.upperSlab.resolution.verdict).toBe('ONE_PLATE_NOT_TWO_LAYERS')
  })

  it('emits exactly one plate, and nothing of it lies inside a wall', () => {
    const plate = elementTrisOf(scene.tris, 'slab_upper_floor')
    expect(plate.length).toBeGreaterThan(0)
    const xs = plate.flatMap((t) => [t.a.x, t.b.x, t.c.x])
    const zs = plate.flatMap((t) => [t.a.z, t.b.z, t.c.z])
    expect(Math.min(...xs)).toBeCloseTo(structural.minX, 6)
    expect(Math.max(...xs)).toBeCloseTo(structural.maxX, 6)
    expect(Math.min(...zs)).toBeCloseTo(structural.minZ, 6)
    expect(Math.max(...zs)).toBeCloseTo(structural.maxZ, 6)
  })

  it('keeps the stair void open through it', () => {
    expect(finish.voids).toContain('stair_main')
    const plate = elementTrisOf(scene.tris, 'slab_upper_floor')
    const stair = { x: (5.37 + 7.45) / 2, z: (6.79 + 8.77) / 2 }
    const through = rayUp(plate, stair.x, stair.z)
    expect(through).toBeLessThan(1e-9)
    // and solid a metre away from it
    expect(rayUp(plate, 2.0, 2.0)).toBeCloseTo(0.33, 6)
  })

  it('separates the walkable floor from the plate only where something stands on it', () => {
    expect(finish.standingOn.sort()).toEqual([...STACKS].sort())
    const plateArea = (structural.maxX - structural.minX) * (structural.maxZ - structural.minZ)
    const stairVoid = { minX: 5.37, maxX: 7.45, minZ: 6.79, maxZ: 8.77 }
    const stacks = STACKS.map((id) => chimneyFootprint(gold(id)))
    const walkable = finishFloorAreaM2(stairVoid, stacks)
    const stairArea = (stairVoid.maxX - stairVoid.minX) * (stairVoid.maxZ - stairVoid.minZ)
    const stackArea = stacks.reduce((a, s) => a + (s.maxX - s.minX) * (s.maxZ - s.minZ), 0)
    expect(walkable).toBeCloseTo(plateArea - stairArea - stackArea, 6)
    expect(stackArea).toBeGreaterThan(0.6)
  })
})

describe('STAGE WEB-PIVOT-05A §6, §8 — three rooflights, each a real hole', () => {
  it('matches the source count, corroborated on two kinds of drawing', () => {
    expect(roofFeaturesGold.rooflights.units.length).toBe(3)
    expect(roofFeaturesGold.rooflights.countEvidence.verdict).toBe('THREE')
    expect(roofFeaturesGold.rooflights.countEvidence.atticPlanCallouts).toBe(3)
    expect(
      roofFeaturesGold.rooflights.countEvidence.westElevationGlazedPatches +
        roofFeaturesGold.rooflights.countEvidence.eastElevationGlazedPatches,
    ).toBe(3)
  })

  it('uses the printed 78/118 unit on every one of them', () => {
    expect(roofFeaturesGold.rooflights.unitSize.printed).toBe('78/118')
    expect(roofFeaturesGold.rooflights.unitSize.status).toBe('SOURCE_EXACT')
    for (const id of ROOFLIGHTS) {
      const o = openingsById.get(id)!
      expect(o.sizeUV.u).toBeCloseTo(0.78, 6)
      expect(o.sizeUV.v).toBeCloseTo(1.18, 6)
    }
  })

  for (const id of ROOFLIGHTS) {
    it(`${id} is cut through the roof, lined, and filled only inside its own hole`, () => {
      const r = cutOf(openingsById.get(id)!)
      expect(r.throughM).toBeLessThan(1e-9)
      expect(r.besideMinM).toBeGreaterThan(0.1)
      expect(r.revealTriangles).toBeGreaterThanOrEqual(8)
      expect(r.revealAreaM2).toBeGreaterThan(0.5)
      expect(r.fillM).toBeGreaterThan(0.1)
      expect(r.strayFillM).toBeLessThan(1e-9)
    })
  }
})

describe('STAGE WEB-PIVOT-05A §9 — every rooflight is over the room it serves', () => {
  const rooms = scene.spec.interior.rooms.filter((r) => r.levelId === 'upper')
  for (const row of rooflightRoomBelow()) {
    it(`${row.id} sits over ${row.roomId}`, () => {
      const o = openingsById.get(row.id)!
      const box = openingPlanRect(frameOf(o), rectOf(o))
      const found = roomAt(rooms, (box.minX + box.maxX) / 2, (box.minZ + box.maxZ) / 2)
      expect(found).toBe(row.roomId)
      expect(o.hostPlaneId).toBe(row.planeId)
    })
  }

  it('puts the west pair on the minus slope and the east one on the plus slope', () => {
    expect(openingsById.get('rl_pralnia_w')!.hostPlaneId).toMatch(/slope_minus$/)
    expect(openingsById.get('rl_lazienka_w')!.hostPlaneId).toMatch(/slope_minus$/)
    expect(openingsById.get('rl_schody_e')!.hostPlaneId).toMatch(/slope_plus$/)
    // The minus slope is west of the ridge and the plus slope east of it, so a
    // mirrored unit lands on the wrong side of x 3.95 and the plan box says so.
    for (const id of ROOFLIGHTS) {
      const o = openingsById.get(id)!
      const box = openingPlanRect(frameOf(o), rectOf(o))
      const west = o.hostPlaneId.endsWith('slope_minus')
      expect(west ? box.maxX <= 3.95 : box.minX >= 3.95).toBe(true)
    }
  })
})

describe('STAGE WEB-PIVOT-05A §10, §11, §12 — two chimneys through a roof that stops at them', () => {
  it('matches the source count, corroborated on three kinds of drawing', () => {
    expect(roofFeaturesGold.chimneys.stacks.length).toBe(2)
    expect(roofFeaturesGold.chimneys.countEvidence.verdict).toBe('TWO')
    expect(roofFeaturesGold.chimneys.countEvidence.eastElevationStacks).toBe(2)
    expect(roofFeaturesGold.chimneys.countEvidence.atticPlanBlocks).toBe(2)
  })

  it('states the penetration relation and carries a matching cut for each', () => {
    for (const id of STACKS) {
      const m = massesById.get(id)!
      expect(m.kind).toBe('CHIMNEY')
      expect(m.penetratesRoofIds).toEqual(['roof_main_gable'])
      // §11: the claim is not enough — the roof must independently carry it.
      const cut = openingsById.get(`${id}_penetration`)
      expect(cut).toBeDefined()
      expect(cut!.hostRoofId).toBe('roof_main_gable')
      expect(cut!.kind).toBe('PENETRATION')
    }
  })

  for (const id of STACKS) {
    it(`${id} is continuous, shares no volume with the roof, and the roof ends at its face`, () => {
      const m = massesById.get(id)!
      const r = chimneyPenetrationReport(scene.tris, id, m.footprint, m.baseM, m.topM)
      expect(r.continuous).toBe(true)
      expect(r.minRunM).toBeGreaterThan(m.topM - m.baseM - 0.01)
      expect(r.roofInsideM).toBeLessThan(1e-9)
      expect(r.roofBesideM).toBeGreaterThan(0.2)
      for (const s of r.sections) expect(s.overlapM).toBeLessThan(1e-9)
      // §12: no unexplained annular gap. The gold states the clearance as zero
      // because no drawing dimensions one, so the roof must begin at the face.
      for (const side of ['minX', 'maxX', 'minZ', 'maxZ'] as const) {
        expect(chimneyClearanceM(scene.tris, id, m.footprint, side)).toBeCloseTo(0, 3)
      }
    })
  }

  it('stops both stacks below the ridge, as all three elevations measure', () => {
    for (const id of STACKS) expect(massesById.get(id)!.topM).toBeCloseTo(7.88, 6)
    expect(roofFeaturesGold.chimneys.topM).toBeLessThan(7.95)
    expect(roofFeaturesGold.chimneys.topStatus).toBe('VISUAL_DERIVED')
  })

  it('replaces STAGE WEB-PIVOT-04 flue wall with the mass, rather than keeping both', () => {
    const wall = scene.interior.tris.filter((t) => t.elementId === 'uw_chimney')
    expect(wall.length).toBe(0)
    expect(meshVolume(elementTrisOf(scene.tris, 'chimney_salon'))).toBeGreaterThan(1.5)
  })
})

describe('STAGE WEB-PIVOT-05A §13 — the verified roof did not move', () => {
  it('keeps the pitch, ridge, eave, footprint, overhang and thickness', () => {
    const roof = scene.spec.building.roofs.find((r) => r.id === 'roof_main_gable')!
    expect(roof.pitchDeg).toBeCloseTo(40, 9)
    expect(roof.ridgeLevelId).toBe('level_ridge')
    expect(roof.eaveLevelId).toBe('level_eave')
    expect(roof.overhangM).toBe(0)
    expect(roof.footprint).toEqual({ minX: 0, maxX: 7.9, minZ: -1, maxZ: 13.6 })
    const compiled = scene.building.roofs.find((r) => r.roofId === 'roof_main_gable')!
    expect(compiled.builtPitchDeg).toBeCloseTo(40, 4)
  })

  it('leaves the roof continuous everywhere except at its registered holes', () => {
    const holes = (scene.spec.building.roofOpenings ?? []).map((o) => openingPlanRect(frameOf(o), rectOf(o)))
    const inHole = (x: number, z: number): boolean =>
      holes.some((h) => x > h.minX - 1e-9 && x < h.maxX + 1e-9 && z > h.minZ - 1e-9 && z < h.maxZ + 1e-9)
    const fabric = scene.tris.filter((t) => t.part === 'ROOF' || t.part === 'ROOF_REVEAL')
    // The grid is nudged off x 3.95. A vertical ray down the ridge passes
    // exactly through the shared edge of the two slope prisms, where an entry
    // and an exit fall at the same distance and cancel; that is a measure-zero
    // sampling artifact, not a gap, and 3.94 and 3.96 both read the full
    // 0.276 m.
    let missing = 0
    for (let i = 1; i < 40; i++) {
      for (let j = 1; j < 40; j++) {
        const x = (7.9 * (i + 0.37)) / 40
        const z = -1 + (14.6 * (j + 0.21)) / 40
        if (inHole(x, z)) continue
        if (rayUp(fabric.map(asTri), x, z) < 0.2) missing++
      }
    }
    expect(missing).toBe(0)
  })
})

describe('STAGE WEB-PIVOT-05A §17 — whole-house interface audit', () => {
  it('shares no volume between any two solid elements of the finished house', () => {
    const byElement = new Map<string, OTri[]>()
    for (const t of scene.tris) {
      if (!t.solid) continue
      const key = `${t.layer}:${t.elementId}`
      const list = byElement.get(key) ?? []
      list.push({ a: t.a, b: t.b, c: t.c })
      byElement.set(key, list)
    }
    const meshes = [...byElement].map(([id, tris]) => ({ id, tris }))
    expect(meshes.length).toBeGreaterThan(35)
    const rows = duplicateVolumeReport(
      meshes,
      axisGrid({ minX: 0, maxX: 12.05, minY: 0, maxY: 8.2, minZ: -1, maxZ: 13.6 }),
    )
    expect(rows.map((r) => `${r.a} | ${r.b} = ${r.lengthM.toFixed(4)}`)).toEqual([])
  })
})

// --- mutations --------------------------------------------------------------

const mutant = (opts: MarcowkiGoldOptions): ReturnType<typeof marcowkiGoldScene> => marcowkiGoldScene(opts)

describe('STAGE WEB-PIVOT-05A §18 — ten defects the oracles catch', () => {
  it('1. a rooflight filled but never cut is caught by a ray, not by a picture', () => {
    const m = mutant({ fillWithoutCut: 'rl_pralnia_w' })
    const o = openingsById.get('rl_pralnia_w')!
    const r = roofOpeningCutReport(m.tris, frameOf(o), o.id, rectOf(o))
    // The glass is exactly where it should be and the roof is still there.
    expect(r.fillM).toBeGreaterThan(0.1)
    expect(r.throughM).toBeGreaterThan(0.5)
    expect(r.revealTriangles).toBe(0)
  })

  it('2. a rooflight mirrored to the other slope lands on the wrong side of the ridge', () => {
    const m = mutant({ mirrorRooflight: 'rl_schody_e' })
    const o = (m.spec.building.roofOpenings ?? []).find((x) => x.id === 'rl_schody_e')!
    expect(o.hostPlaneId).toMatch(/slope_minus$/)
    const box = openingPlanRect(roofPlaneFrames(m.spec.building).get(o.hostPlaneId)!, rectOf(o))
    expect(box.maxX).toBeLessThanOrEqual(3.95)
    const rooms = m.spec.interior.rooms.filter((r) => r.levelId === 'upper')
    expect(roomAt(rooms, (box.minX + box.maxX) / 2, (box.minZ + box.maxZ) / 2)).not.toBe('u_stairs')
  })

  it('3. a rooflight slid along the ridge ends up over a different room', () => {
    const m = mutant({ shiftRooflight: { id: 'rl_lazienka_w', byM: -2.4 } })
    const o = (m.spec.building.roofOpenings ?? []).find((x) => x.id === 'rl_lazienka_w')!
    const box = openingPlanRect(roofPlaneFrames(m.spec.building).get(o.hostPlaneId)!, rectOf(o))
    const rooms = m.spec.interior.rooms.filter((r) => r.levelId === 'upper')
    const found = roomAt(rooms, (box.minX + box.maxX) / 2, (box.minZ + box.maxZ) / 2)
    expect(found).not.toBe('u_bathroom')
  })

  it('4. a hole cut smaller than its unit leaves the frame inside roof material', () => {
    const m = mutant({ shrinkRoofCut: { id: 'rl_pralnia_w', byM: 0.18 } })
    const o = (m.spec.building.roofOpenings ?? []).find((x) => x.id === 'rl_pralnia_w')!
    const f = roofPlaneFrames(m.spec.building).get(o.hostPlaneId)!
    // The frame is sized from the unit, not from the hole, so shrinking the hole
    // puts frame and roof in the same cubic metres rather than clipping it.
    const frame = m.tris.filter((t) => t.openingId === o.id && t.part === 'ROOF_FRAME').map(asTri)
    const roof = m.tris.filter((t) => t.part === 'ROOF' || t.part === 'ROOF_REVEAL').map(asTri)
    const rows = duplicateVolumeReport(
      [
        { id: 'frame', tris: frame },
        { id: 'roof', tris: roof },
      ],
      axisGrid({ minX: 0, maxX: 7.9, minY: 3, maxY: 8, minZ: 5, maxZ: 7 }, 21, 9),
    )
    expect(rows.length).toBeGreaterThan(0)
    expect(Math.max(...rows.map((r) => r.lengthM))).toBeGreaterThan(0.02)
    void f
  })

  it('5. a chimney with no hole in the roof is caught by the roof inside its footprint', () => {
    const m = mutant({ chimneyWithoutCut: 'chimney_salon' })
    const mass = (m.spec.building.masses ?? []).find((x) => x.id === 'chimney_salon')!
    expect((m.spec.building.roofOpenings ?? []).some((o) => o.id === 'chimney_salon_penetration')).toBe(false)
    const r = chimneyPenetrationReport(m.tris, 'chimney_salon', mass.footprint, mass.baseM, mass.topM)
    expect(r.roofInsideM).toBeGreaterThan(0.2)
    expect(Math.max(...r.sections.map((s) => s.overlapM))).toBeGreaterThan(0.05)
  })

  it('6. a chimney moved in plan leaves its hole behind', () => {
    const m = mutant({ moveChimney: { id: 'chimney_boiler', deltaZ: -1.6 } })
    const mass = (m.spec.building.masses ?? []).find((x) => x.id === 'chimney_boiler')!
    const r = chimneyPenetrationReport(m.tris, 'chimney_boiler', mass.footprint, mass.baseM, mass.topM)
    expect(r.roofInsideM).toBeGreaterThan(0.2)
  })

  it('7. the slab reverted to the interior outline puts plate inside the wall head', () => {
    const m = mutant({ revertSlabFootprint: true })
    const plate = elementTrisOf(m.tris, 'slab_upper_floor')
    const xs = plate.flatMap((t) => [t.a.x, t.b.x, t.c.x])
    expect(Math.min(...xs)).toBeCloseTo(0, 6)
    const byElement = new Map<string, OTri[]>()
    for (const t of m.tris) {
      if (!t.solid) continue
      const k = `${t.layer}:${t.elementId}`
      const l = byElement.get(k) ?? []
      l.push({ a: t.a, b: t.b, c: t.c })
      byElement.set(k, l)
    }
    const rows = duplicateVolumeReport(
      [...byElement].map(([id, tris]) => ({ id, tris })),
      axisGrid({ minX: 0, maxX: 12.05, minY: 0, maxY: 8.2, minZ: -1, maxZ: 13.6 }, 21, 11),
    )
    expect(rows.some((r) => r.a.includes('slab_upper_floor') || r.b.includes('slab_upper_floor'))).toBe(true)
  })

  it('8. a filled stair void closes the floor a stair still runs into', () => {
    const m = mutant({ interior: { fillStairVoid: true } })
    const plate = elementTrisOf(m.tris, 'slab_upper_floor')
    expect(rayUp(plate, (5.37 + 7.45) / 2, (6.79 + 8.77) / 2)).toBeCloseTo(0.33, 6)
  })

  it('9. a ridge moved by integration changes the pitch the roof compiles to', () => {
    const m = mutant({ moveRidgeM: 0.6 })
    const compiled = m.building.roofs.find((r) => r.roofId === 'roof_main_gable')!
    expect(Math.abs(compiled.builtPitchDeg - 40)).toBeGreaterThan(2)
  })

  it('10. a hole cut wider than the stack leaves daylight around it', () => {
    const m = mutant({ growChimneyCut: { id: 'chimney_salon', byM: 0.12 } })
    const mass = (m.spec.building.masses ?? []).find((x) => x.id === 'chimney_salon')!
    const gaps = (['minX', 'maxX', 'minZ', 'maxZ'] as const).map((s) =>
      chimneyClearanceM(m.tris, 'chimney_salon', mass.footprint, s),
    )
    expect(Math.max(...gaps)).toBeGreaterThan(0.08)
  })

  it('11. STAGE WEB-PIVOT-04 flue wall left in place doubles the stack', () => {
    const m = mutant({ keepInteriorChimneyWall: true })
    expect(m.interior.tris.some((t) => t.elementId === 'uw_chimney')).toBe(true)
    const rows = duplicateVolumeReport(
      [
        { id: 'wall', tris: m.tris.filter((t) => t.elementId === 'uw_chimney' && t.solid).map(asTri) },
        { id: 'stack', tris: elementTrisOf(m.tris, 'chimney_salon') },
      ],
      axisGrid({ minX: 4.5, maxX: 7, minY: 3, maxY: 6, minZ: 4, maxZ: 5.5 }, 15, 9),
    )
    expect(rows.length).toBeGreaterThan(0)
  })
})

// --- helpers ----------------------------------------------------------------

function asTri(t: { a: OTri['a']; b: OTri['b']; c: OTri['c'] }): OTri {
  return { a: t.a, b: t.b, c: t.c }
}

/** Material a vertical line meets at (x, z), in metres. */
function rayUp(tris: readonly OTri[], x: number, z: number): number {
  const runs = materialRunsLocal(tris, x, z)
  return runs.reduce((a, r) => a + (r.t1 - r.t0), 0)
}

function materialRunsLocal(tris: readonly OTri[], x: number, z: number): Array<{ t0: number; t1: number }> {
  return materialRuns(tris, { x, y: -40, z }, { x: 0, y: 1, z: 0 }, 1e-7)
}

function gold(id: string): (typeof roofFeaturesGold.chimneys.stacks)[number] {
  const s = roofFeaturesGold.chimneys.stacks.find((x) => x.id === id)
  if (s === undefined) throw new Error(`no gold stack ${id}`)
  return s
}

// --- the generic contract, on a synthetic roof -------------------------------

/**
 * §7 asks the roof-opening contract to be generic, and a house cannot show
 * that: Marcówki's ridge runs one way, so anything measured on it could be
 * true only of that orientation. These build a bare gable with one opening and
 * ask the two questions a plane-local contract has to answer — that the same
 * roof rotated a quarter turn compiles to the same plane-local geometry, and
 * that a bad opening is refused by name rather than emitted.
 */
const PROV = {
  source: 'synthetic',
  locator: 'tests/marcowki-roof-features.test.ts',
  interpretation: 'a bare gable used to test the generic contract',
  status: 'ASSUMPTION' as const,
}
const LEVELS = [
  { id: 'e', kind: 'EAVE' as const, elevationM: 3, provenance: PROV },
  { id: 'r', kind: 'RIDGE' as const, elevationM: 6, provenance: PROV },
]
const bareRoof = (ridgeAxis: 'X' | 'Z') => ({
  id: 'r1',
  kind: 'GABLE' as const,
  footprint: ridgeAxis === 'Z' ? { minX: 0, maxX: 6, minZ: 0, maxZ: 10 } : { minX: 0, maxX: 10, minZ: 0, maxZ: 6 },
  supportShellId: 's',
  eaveLevelId: 'e',
  ridgeLevelId: 'r',
  ridgeAxis,
  overhangM: 0,
  thicknessM: 0.2,
  ownerStoreyId: 's',
  provenance: PROV,
})

describe('STAGE WEB-PIVOT-05A §7 — the roof-opening contract is generic', () => {
  it('compiles the same plane-local geometry whichever way the ridge runs', () => {
    const readings = (['Z', 'X'] as const).map((axis) => {
      const opening: RoofOpeningSpec = {
        id: 'o1',
        hostRoofId: 'r1',
        hostPlaneId: 'r1:slope_minus',
        centerUV: { u: 4, v: 1.5 },
        sizeUV: { u: 1, v: 1.2 },
        kind: 'ROOFLIGHT',
        sourceRefs: [],
        status: 'ASSUMPTION',
      }
      const r = compileRoofs([bareRoof(axis)], LEVELS, [opening], [{ id: 'f1', openingId: 'o1', frameWidthM: 0.08 }])
      const plane = r.roofs[0].planes.find((p) => p.planeId === 'r1:slope_minus')!
      const rev = r.tris.filter((t) => t.part === 'ROOF_REVEAL' && t.openingId === 'o1')
      const area = rev.reduce((a, t) => a + triAreaOf(t), 0)
      return {
        diagnostics: r.diagnostics.length,
        pitch: +plane.pitchDeg.toFixed(9),
        lengthU: +plane.lengthU.toFixed(9),
        lengthV: +plane.lengthV.toFixed(9),
        drop: +plane.verticalDropM.toFixed(9),
        reveals: rev.length,
        revealArea: +area.toFixed(9),
        frames: r.tris.filter((t) => t.part === 'ROOF_FRAME').length,
        panes: r.tris.filter((t) => t.part === 'ROOF_GLAZING').length,
      }
    })
    // Every plane-local quantity is identical; only the world coordinates turn.
    expect(readings[0]).toEqual(readings[1])
    expect(readings[0].diagnostics).toBe(0)
    expect(readings[0].reveals).toBeGreaterThan(0)
  })

  it('refuses an invalid opening by name instead of emitting it', () => {
    const bad = (over: Partial<RoofOpeningSpec>): RoofOpeningSpec => ({
      id: 'o1',
      hostRoofId: 'r1',
      hostPlaneId: 'r1:slope_minus',
      centerUV: { u: 3, v: 1.5 },
      sizeUV: { u: 1, v: 1 },
      kind: 'ROOFLIGHT',
      sourceRefs: [],
      status: 'ASSUMPTION',
      ...over,
    })
    const codes = (o: RoofOpeningSpec[], f: Array<{ id: string; openingId: string; frameWidthM: number }> = []) =>
      compileRoofs([bareRoof('Z')], LEVELS, o, f).diagnostics.map((d) => d.code)

    expect(codes([bad({ hostRoofId: 'nope' })])).toContain('ROOF_OPENING_UNKNOWN_ROOF')
    expect(codes([bad({ hostPlaneId: 'r1:nope' })])).toContain('ROOF_OPENING_UNKNOWN_PLANE')
    expect(codes([bad({ centerUV: { u: 40, v: 1.5 } })])).toContain('ROOF_OPENING_OUTSIDE_PLANE')
    expect(codes([bad({ sizeUV: { u: 0, v: 1 } })])).toContain('INVALID_ROOF_OPENING')
    expect(codes([bad({}), bad({ id: 'o1' })])).toContain('DUPLICATE_ROOF_OPENING_ID')
    expect(codes([bad({}), bad({ id: 'o2', centerUV: { u: 3.2, v: 1.6 } })])).toContain('ROOF_OPENINGS_OVERLAP')
    expect(codes([], [{ id: 'f1', openingId: 'ghost', frameWidthM: 0.05 }])).toContain('ROOF_FILL_UNKNOWN_OPENING')
  })

  it('leaves a roof with no openings exactly as earlier stages compiled it', () => {
    const before = compileRoofs([bareRoof('Z')], LEVELS)
    const after = compileRoofs([bareRoof('Z')], LEVELS, [], [])
    expect(after.tris.length).toBe(before.tris.length)
    expect(before.tris.every((t) => t.part === 'ROOF')).toBe(true)
    expect(before.diagnostics).toEqual([])
  })
})

function triAreaOf(t: { a: OTri['a']; b: OTri['b']; c: OTri['c'] }): number {
  const ux = t.b.x - t.a.x
  const uy = t.b.y - t.a.y
  const uz = t.b.z - t.a.z
  const vx = t.c.x - t.a.x
  const vy = t.c.y - t.a.y
  const vz = t.c.z - t.a.z
  return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2
}
