/**
 * STAGE WEB-PIVOT-04 — the Marcowki interior, and the eight ways it can be wrong.
 *
 * The claim this file has to earn is the stage's own: that the two floors are
 * represented as real topology rather than as labels. So every assertion is a
 * measurement made by `tests/interior-oracles.ts` on the emitted triangles or
 * the gold transcription, and none of them asks the compiler what it thinks it
 * did.
 *
 * The mutation block at the end is the other half of the same claim. A check
 * that never fails proves nothing, so each of the eight defects §19 names is
 * built here and the test asserts that the corresponding check *does* fail. The
 * mutations live behind options on the fixture and are never the default.
 */
import { describe, expect, it } from 'vitest'
import { compileInterior, polygonArea, polygonOverlapArea, wallFootprint, rectArea } from '../src/core/wallspec/interior.js'
import { gold, marcowkiInteriorSpec, atticSoffitAboveFfl, GROUND_CLEAR_H } from '../src/core/wallspec/marcowki-interior-fixture.js'
import {
  adjacencyGraph,
  alignmentReport,
  areaCheck,
  chainCheck,
  coverageReport,
  openingCut,
  roomTopology,
  slabVoidReport,
  stairReport,
} from './interior-oracles.js'
import { selectPlanAsset } from '../src/core/dimensions/plan-select.js'
import type { SourceAsset } from '../src/core/contracts/source.js'

const spec = marcowkiInteriorSpec()
const compiled = compileInterior(spec)

/** Rooms whose published figure is known to mean something the polygon cannot. */
const SEMANTIC_NOTES: Record<string, string> = {
  g_pantry:
    'the drawing puts the stair soffit over the pantry’s south-east corner; the published gross figure ' +
    'appears to include floor the model gives to the stair, and the published net 1.44 applies a headroom rule',
  u_corridor:
    'the boundary between Korytarz and Schody is not drawn; the published pair 6.17 + 5.63 splits the same ' +
    'space differently from the model, whose split is uw_stair_north’s west end',
  u_stairs:
    'the model’s polygon is the whole stair compartment including the floor void; the published Schody ' +
    'figure is the flight and landing alone',
  u_pokoj_s:
    'the attic plan draws a recess at the room’s north-west corner that the model does not reproduce; ' +
    'the 0.77 m² difference is that recess',
}

describe('STAGE WEB-PIVOT-04 — the interior compiles', () => {
  it('compiles both storeys with no diagnostics at all', () => {
    expect(compiled.diagnostics).toEqual([])
  })

  it('emits interior wall solids, room surfaces, a stair and a slab', () => {
    const kinds = new Set(compiled.tris.map((t) => t.elementKind))
    expect([...kinds].sort()).toEqual(['INTERIOR_WALL', 'ROOM_FLOOR', 'SLAB', 'STAIR'])
    expect(compiled.walls.length).toBe(spec.walls.filter((w) => w.emit).length)
    expect(compiled.rooms.length).toBe(spec.rooms.length)
  })

  it('gives every wall, room and opening a stable semantic id', () => {
    const ids = [...spec.walls, ...spec.rooms, ...spec.openings].map((x) => x.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const t of compiled.tris) expect(t.elementId.length).toBeGreaterThan(0)
    // Every emitted triangle can be traced back to something the spec names.
    const named = new Set([...ids, ...spec.stairs.map((s) => s.id), ...spec.slabs.map((s) => s.id)])
    for (const t of compiled.tris) expect(named.has(t.elementId)).toBe(true)
  })

  it('takes its heights from the exterior shell, not from the plans', () => {
    // A ground partition stops under the floor plate; an attic partition stops
    // under the roof where the roof is the lower of the two.
    const ground = spec.walls.find((w) => w.id === 'gw_kitchen_south')!
    expect(ground.wall.heightM).toBeCloseTo(GROUND_CLEAR_H, 9)
    expect(GROUND_CLEAR_H).toBeCloseTo(2.73, 9)
    const attic = spec.walls.find((w) => w.id === 'uw_pokoj_nw_south')!
    const profile = attic.wall.topProfile
    expect(profile?.kind).toBe('POLYLINE')
    if (profile?.kind !== 'POLYLINE') throw new Error('unreachable')
    // At the west end the roof is low, and the wall follows it exactly.
    expect(profile.points[0].topM).toBeCloseTo(atticSoffitAboveFfl(attic.fromM), 9)
    expect(profile.points[0].topM).toBeLessThan(2.0)
    // Towards the ridge the stated ceiling line is the lower of the two.
    expect(profile.points[profile.points.length - 1].topM).toBeCloseTo(2.6, 9)
    for (const p of profile.points) expect(p.topM).toBeLessThanOrEqual(atticSoffitAboveFfl(attic.fromM + p.u) + 1e-9)
  })
})

describe('STAGE WEB-PIVOT-04 §7 — room topology', () => {
  it('every room polygon is closed, rectilinear, positive and inside its storey', () => {
    for (const room of spec.rooms) {
      const t = roomTopology(spec, compiled.tris, room)
      expect(`${room.id}: ${t.problems.join('; ')}`).toBe(`${room.id}: `)
      expect(t.closed).toBe(true)
      expect(t.rectilinear).toBe(true)
      expect(t.areaM2).toBeGreaterThan(0)
      expect(t.insideEnvelope).toBe(true)
    }
  })

  it('every metre of every room boundary is a wall, a doorway or a declared open edge', () => {
    for (const room of spec.rooms) {
      const t = roomTopology(spec, compiled.tris, room)
      expect(t.unexplainedM).toBeLessThan(1e-6)
      expect(t.supportedM + t.openingM + t.notionalM).toBeGreaterThan(0)
    }
  })

  it('no two rooms on a storey share any plan at all', () => {
    for (let i = 0; i < spec.rooms.length; i++) {
      for (let j = i + 1; j < spec.rooms.length; j++) {
        if (spec.rooms[i].levelId !== spec.rooms[j].levelId) continue
        expect(polygonOverlapArea(spec.rooms[i].polygon, spec.rooms[j].polygon)).toBeLessThan(1e-9)
      }
    }
  })

  it('no room floats: each is bounded by walls the compiler actually emitted', () => {
    for (const room of spec.rooms) {
      const c = compiled.rooms.find((x) => x.roomId === room.id)!
      const walled = c.boundaryWallIds.length > 0
      const onEnvelope = roomTopology(spec, compiled.tris, room).supportedM > 0
      expect(walled || onEnvelope).toBe(true)
    }
  })
})

describe('STAGE WEB-PIVOT-04 §8 — floor partition audit', () => {
  for (const levelId of ['ground', 'upper']) {
    it(`${levelId}: rooms, walls and the stair tile the storey with nothing left over`, () => {
      const c = coverageReport(spec, levelId)
      expect(c.overlapM2).toBeLessThan(1e-9)
      expect(c.uncoveredM2).toBeLessThan(1e-9)
      expect(c.roomM2 + c.wallM2 + c.stairM2).toBeCloseTo(c.envelopeM2, 6)
    })
  }

  it('the interior envelopes are the shell inner faces, not a re-measurement', () => {
    const ground = coverageReport(spec, 'ground')
    // Main body 7.00 x 11.70 plus the garage 3.70 x 6.60.
    expect(ground.envelopeM2).toBeCloseTo(7.0 * 11.7 + 3.7 * 6.6, 6)
    expect(coverageReport(spec, 'upper').envelopeM2).toBeCloseTo(7.0 * 11.7, 6)
  })
})

describe('STAGE WEB-PIVOT-04 §9 — published room areas', () => {
  const checks = spec.rooms.map((r) => areaCheck(r, SEMANTIC_NOTES))

  it('classifies every published room and explains every difference', () => {
    for (const c of checks) {
      expect(c.classification).not.toBe('COMPILER_FAIL')
      if (c.classification === 'SOURCE_SEMANTICS_DIFFER') expect(c.note.length).toBeGreaterThan(20)
    }
  })

  it('most of the house matches the published table once the finish rule is applied', () => {
    const agreeing = checks.filter((c) => c.classification === 'MATCH' || c.classification === 'CLOSE')
    expect(agreeing.length).toBeGreaterThanOrEqual(14)
    expect(checks.filter((c) => c.classification === 'MATCH').length).toBeGreaterThanOrEqual(9)
  })

  it('reproduces the two rooms that identify the convention to the centimetre', () => {
    // Both are simple rectangles with both dimensions printed, so there is no
    // freedom in the polygon: if the rule were wrong these could not land.
    const nw = checks.find((c) => c.roomId === 'u_pokoj_nw')!
    expect(nw.rawM2).toBeCloseTo(3.44 * 4.49, 6)
    expect(nw.finishedM2).toBeCloseTo(15.13, 2)
    const pralnia = checks.find((c) => c.roomId === 'u_pralnia')!
    expect(pralnia.rawM2).toBeCloseTo(3.44 * 2.02, 6)
    expect(pralnia.finishedM2).toBeCloseTo(6.73, 2)
  })

  it('keeps the raw polygon area alongside the published one, never instead of it', () => {
    for (const c of checks) {
      if (c.publishedM2 === undefined) continue
      expect(c.rawM2).toBeGreaterThan(c.finishedM2)
    }
  })
})

describe('STAGE WEB-PIVOT-04 §10 — printed dimension chains', () => {
  it('both floors carry a horizontal and a vertical chain that close on the gold geometry', () => {
    const byLevel = new Map<string, Set<string>>()
    for (const ch of gold.chains) {
      const set = byLevel.get(ch.level) ?? new Set<string>()
      set.add(ch.axis)
      byLevel.set(ch.level, set)
    }
    expect([...(byLevel.get('ground') ?? [])].sort()).toEqual(['X', 'Z'])
    expect([...(byLevel.get('upper') ?? [])].sort()).toEqual(['X', 'Z'])
  })

  for (const ch of gold.chains) {
    it(`${ch.id}: the printed segments and the measured wall thicknesses close on the printed total`, () => {
      const c = chainCheck(spec, ch)
      expect(c.closureM).toBeCloseTo(0, 9)
      // Every boundary the chain steps over is a real wall face, except the one
      // the gold file marks as an open-plan split by giving it no thickness.
      for (const l of c.landings) {
        if (l.errorM === null) continue
        expect(`${ch.id}@${l.atM}: ${l.wallId ?? 'nothing'}`).not.toContain('nothing')
        expect(l.errorM).toBeLessThanOrEqual(0.05)
      }
    })
  }
})

describe('STAGE WEB-PIVOT-04 §11 — doors are holes, and the graph they make', () => {
  for (const o of marcowkiInteriorSpec().openings.filter((x) => x.cut)) {
    it(`${o.id} is a real hole through ${o.hostWallId}`, () => {
      const c = openingCut(spec, compiled.tris, o.id)
      expect(c.throughOpeningM).toBeLessThan(1e-9)
      expect(c.besideOpeningM).toBeGreaterThan(0.05)
      expect(c.aboveOpeningM).toBeGreaterThan(0.05)
      expect(c.separatesItsRooms).toBe(true)
    })
  }

  it('every room on each floor is reachable from every other', () => {
    for (const levelId of ['ground', 'upper']) {
      const g = adjacencyGraph(spec, levelId)
      expect(`${levelId}: ${g.components.map((c) => c.join('+')).join(' | ')}`).toBe(
        `${levelId}: ${g.nodes.slice().sort().join('+')}`,
      )
      expect(g.connected).toBe(true)
    }
  })

  it('records the house/garage door without cutting the shell wall that hosts it', () => {
    const garage = spec.openings.find((o) => o.id === 'gd_garage')!
    expect(garage.cut).toBe(false)
    expect(spec.walls.find((w) => w.id === garage.hostWallId)!.emit).toBe(false)
    expect(adjacencyGraph(spec, 'ground').edges.some((e) => e.via === garage.hostWallId)).toBe(true)
  })
})

describe('STAGE WEB-PIVOT-04 §12/§13 — the stair and its hole', () => {
  const stair = stairReport(spec, compiled.tris, 'stair_main')
  const slab = slabVoidReport(spec, compiled.tris, 'slab_upper_floor')

  it('climbs from the ground floor to the attic floor', () => {
    expect(stair.baseM).toBeCloseTo(0, 9)
    expect(stair.topM).toBeCloseTo(3.06, 9)
    expect(stair.reachesUpperFloor).toBe(true)
  })

  it('stands where the drawing puts it and fills its stated footprint', () => {
    expect(stair.footprint.minX).toBeCloseTo(5.37, 9)
    expect(stair.footprint.maxX).toBeCloseTo(7.45, 9)
    expect(stair.footprint.minZ).toBeCloseTo(6.79, 9)
    expect(stair.footprint.maxZ).toBeCloseTo(8.77, 9)
    expect(stair.uncoveredFootprintM2).toBeLessThan(1e-9)
  })

  it('occupies no wall and does not run into the floor plate', () => {
    expect(stair.clashM3).toBeLessThan(1e-9)
    expect(slab.stairFootprintOutsideVoidM2).toBeLessThan(1e-9)
  })

  it('the slab has a real hole, not a shaded one', () => {
    expect(slab.throughVoidM).toBeLessThan(1e-9)
    expect(slab.besideVoidM).toBeCloseTo(0.33, 9)
    expect(slab.volumeM3).toBeCloseTo(slab.expectedSolidM3, 6)
    expect(slab.volumeM3).toBeLessThan(slab.expectedWholeM3 - 0.4)
  })

  it('emits the plate once: no duplicate solid through the opening', () => {
    // Four pieces around one rectangular hole, and each of them a closed box.
    const slabTris = compiled.tris.filter((t) => t.elementKind === 'SLAB')
    expect(slabTris.length).toBe(4 * 12)
  })
})

describe('STAGE WEB-PIVOT-04 §14 — the two storeys share one frame', () => {
  const al = alignmentReport(
    spec,
    [
      ['gw_room_east', 'uw_room2_west'],
      ['gw_boiler_north', 'uw_corridor_south'],
    ],
    'u_stairs',
  )

  it('both storeys use the same interior envelope', () => {
    expect(al.envelopesAgree).toBe(true)
  })

  it('the stair arrives inside the attic stair compartment', () => {
    expect(al.voidInsideUpperStair).toBe(true)
  })

  it('the walls the source states as one structural line are one structural line', () => {
    for (const p of al.structuralPairs) expect(p.offsetM).toBeLessThanOrEqual(0.07)
  })
})

// --------------------------------------------------------------------------
// §19 — the mutations. Each is a defect, and each has to be caught.
// --------------------------------------------------------------------------

describe('STAGE WEB-PIVOT-04 §19 — mutations', () => {
  it('1. an internal wall moved off a printed chain is caught by the chain', () => {
    const m = marcowkiInteriorSpec({ moveWall: { wallId: 'uw_pokoj_nw_south', deltaM: 0.3 } })
    const ch = gold.chains.find((c) => c.id === 'chain_upper_z_west')!
    const before = chainCheck(spec, ch)
    const after = chainCheck(m, ch)
    expect(before.landings.every((l) => l.errorM === null || l.errorM < 1e-9)).toBe(true)
    expect(before.landings.every((l) => l.errorM === null || l.wallId !== null)).toBe(true)
    // The boundary the chain states is no longer on any wall face.
    expect(after.landings.some((l) => l.wallId === null && l.errorM !== null)).toBe(true)
    expect(Math.max(...after.landings.map((l) => l.errorM ?? 0))).toBeGreaterThan(0.06)
  })

  it('2. overlapping room polygons are caught by the compiler and by the coverage audit', () => {
    const m = marcowkiInteriorSpec({ growRoom: { roomId: 'g_bathroom', edge: 'maxX', deltaM: 0.5 } })
    expect(compileInterior(m).diagnostics.some((d) => d.code === 'ROOM_OVERLAP')).toBe(true)
    expect(coverageReport(m, 'ground').overlapM2).toBeGreaterThan(0.1)
  })

  it('3. a room pulled back from its wall leaves an unexplained gap', () => {
    const m = marcowkiInteriorSpec({ shrinkRoom: { roomId: 'g_room', edge: 'maxX', deltaM: 0.4 } })
    const c = coverageReport(m, 'ground')
    expect(c.uncoveredM2).toBeCloseTo(0.4 * 3.25, 6)
    expect(c.gaps[0].areaM2).toBeGreaterThan(0.5)
  })

  it('4. a door re-hosted on a wall that does not separate its rooms is caught', () => {
    const m = marcowkiInteriorSpec({ misrouteDoor: { openingId: 'ud_pokoj_s', toWallId: 'uw_corridor_west' } })
    const c = compileInterior(m)
    expect(openingCut(m, c.tris, 'ud_pokoj_s').separatesItsRooms).toBe(false)
    // And the wall it was moved onto already has a door there, which the wall
    // compiler refuses rather than cutting one hole across two.
    expect(c.diagnostics.some((d) => d.message.includes('OVERLAPPING_OPENINGS'))).toBe(true)
    // The room it used to serve now has a stretch of boundary with no way in.
    const south = m.rooms.find((r) => r.id === 'u_pokoj_s')!
    const t = roomTopology(m, c.tris, south)
    expect(t.unexplainedM + t.openingM).toBeGreaterThan(0)
  })

  it('5. a stair void filled by the slab is caught by a ray and by the volume', () => {
    const m = marcowkiInteriorSpec({ fillStairVoid: true })
    const c = compileInterior(m)
    const slab = slabVoidReport(m, c.tris, 'slab_upper_floor')
    expect(slab.throughVoidM).toBeCloseTo(0.33, 9)
    expect(slab.volumeM3).toBeCloseTo(slab.expectedWholeM3, 6)
    expect(slab.stairFootprintOutsideVoidM2).toBeCloseTo(2.08 * 1.98, 2)
  })

  it('6. a void slid away from the stair below it is caught by the clash', () => {
    const m = marcowkiInteriorSpec({ misalignStairVoid: { deltaZ: -1.2 } })
    const c = compileInterior(m)
    const slab = slabVoidReport(m, c.tris, 'slab_upper_floor')
    // The hole is still there and still the right size; it is over the wrong
    // part of the house, so the flight comes up under solid plate.
    expect(slab.volumeM3).toBeCloseTo(slab.expectedSolidM3, 6)
    expect(slab.stairFootprintOutsideVoidM2).toBeGreaterThan(1.0)
  })

  it('7a. a mirrored attic plan is caught by the stair and by the structural line', () => {
    const m = marcowkiInteriorSpec({ mirrorUpperPlan: true })
    const al = alignmentReport(m, [['gw_room_east', 'uw_room2_west']], 'u_stairs')
    expect(al.voidInsideUpperStair).toBe(false)
    expect(al.structuralPairs[0].offsetM).toBeGreaterThan(1.0)
  })

  it('7b. an attic plan turned through 180 degrees is caught the same way', () => {
    const m = marcowkiInteriorSpec({ rotateUpperPlan: true })
    const al = alignmentReport(m, [['gw_room_east', 'uw_room2_west']], 'u_stairs')
    expect(al.voidInsideUpperStair).toBe(false)
    expect(al.structuralPairs[0].offsetM).toBeGreaterThan(1.0)
  })

  it('8. the AREA_LABELS copy of a floor plan is never chosen over the DIMENSIONED one', () => {
    const asset = (id: string, annotation: string, storey: string): SourceAsset =>
      ({
        id,
        url: `https://assets.archon.pl/${id}.gif`,
        role: 'PLAN_GROUND',
        width: 853,
        height: 853,
        roles: {
          document: 'FLOOR_PLAN',
          storey,
          annotation,
          view: 'UNKNOWN',
          projection: 'PLANAR_DIAGRAM',
          analyzerRole: 'PLAN_GROUND',
          confidence: 0.6,
          evidence: ['ALT_TEXT'],
        },
      }) as unknown as SourceAsset
    const assets = [asset('a_labels', 'AREA_LABELS', 'GROUND'), asset('a_dims', 'DIMENSIONED', 'GROUND')]
    expect(selectPlanAsset(assets, 'GROUND')!.asset.id).toBe('a_dims')
    // Order must not decide it either.
    expect(selectPlanAsset([...assets].reverse(), 'GROUND')!.asset.id).toBe('a_dims')
    // And the mutation — dropping the role dimensions so only the legacy role
    // is left — is exactly the behaviour the correction replaced.
    const legacyOnly = assets.map((a) => ({ ...a, roles: undefined }) as SourceAsset)
    const chosen = selectPlanAsset(legacyOnly, 'GROUND')
    expect(chosen?.by).toBe('LEGACY_ROLE')
    expect(chosen?.asset.id).toBe('a_labels')
  })
})

describe('STAGE WEB-PIVOT-04 §20 — production isolation', () => {
  it('the gold interior is development-only and carries a footprint of walls, not of masses', () => {
    expect(gold.notForProduction.length).toBeGreaterThan(20)
    const wallArea = spec.walls
      .filter((w) => w.emit)
      .reduce((s, w) => s + rectArea(wallFootprint(w)), 0)
    expect(wallArea).toBeGreaterThan(6)
    expect(polygonArea(spec.stairs[0].footprint)).toBeCloseTo(2.08 * 1.98, 6)
  })
})
