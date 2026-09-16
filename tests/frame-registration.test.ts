/**
 * STAGE WEB-PIVOT-07R §12, §16 — the checks that would have failed the
 * checkpoint screenshots, and twelve ways of breaking them.
 *
 * The screenshots the stage was called for showed a house whose two storeys
 * stood 4.8 m apart, a roof floating over the garden in the section's own
 * coordinate, and wall stubs standing as pillars. Every one of those is a
 * statement about geometry that a test can make, and none of them was being
 * made. These are those tests.
 *
 * The building under test is synthetic, for two reasons. It runs in
 * milliseconds rather than the six minutes the real extraction takes, and it
 * can be broken on purpose: §16's mutations need a building whose correct
 * answer is known exactly, so that a check going red is the mutation and not
 * the noise in a real drawing.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  checkRegisteredBuilding,
  registerBuilding,
  type RegisteredBuilding,
} from '../src/core/extract/register-building.js'
import { classifyStorey } from '../src/core/extract/plan-masses.js'
import { placePoint, placedAxis, type SourceFrameRegistration } from '../src/core/extract/building-frame.js'
import type { ArchitecturalSpecCandidate, CandidateStorey } from '../src/core/extract/spec-candidate.js'
import { syntheticCandidate } from './frame-registration-fixture.js'

const clone = (c: ArchitecturalSpecCandidate): ArchitecturalSpecCandidate => JSON.parse(JSON.stringify(c))
const status = (b: RegisteredBuilding, id: string): string => b.checks.find((c) => c.id === id)?.status ?? 'MISSING'
const recheck = (b: RegisteredBuilding, c: ArchitecturalSpecCandidate, id: string): string =>
  checkRegisteredBuilding(b, c).find((k) => k.id === id)?.status ?? 'MISSING'

/** The upper sheet, turned on the spot: every wall and room moved the same way. */
function turnStorey(storey: CandidateStorey, f: (x: number, z: number) => { x: number; z: number }): void {
  for (const w of storey.walls) {
    const along = w.axis === 'X'
    const a = along ? f(w.fromM, w.nearM) : f(w.nearM, w.fromM)
    const b = along ? f(w.toM, w.farM) : f(w.farM, w.toM)
    const openings = w.openings.map((o) => {
      const p = along ? f(o.fromM, w.nearM) : f(w.nearM, o.fromM)
      const q = along ? f(o.toM, w.nearM) : f(w.nearM, o.toM)
      return { ...o, lo: p, hi: q }
    })
    const newAlongAxis: 'X' | 'Z' = Math.abs(a.x - b.x) >= Math.abs(a.z - b.z) ? 'X' : 'Z'
    const alongOf = (p: { x: number; z: number }): number => (newAlongAxis === 'X' ? p.x : p.z)
    const acrossOf = (p: { x: number; z: number }): number => (newAlongAxis === 'X' ? p.z : p.x)
    w.axis = newAlongAxis
    w.fromM = Math.min(alongOf(a), alongOf(b))
    w.toM = Math.max(alongOf(a), alongOf(b))
    w.nearM = Math.min(acrossOf(a), acrossOf(b))
    w.farM = Math.max(acrossOf(a), acrossOf(b))
    w.thicknessM = w.farM - w.nearM
    w.centreM = (w.nearM + w.farM) / 2
    w.openings = openings.map((o) => {
      const lo = Math.min(alongOf(o.lo), alongOf(o.hi))
      const hi = Math.max(alongOf(o.lo), alongOf(o.hi))
      return { ...o, fromM: lo, toM: hi, widthM: hi - lo }
    })
  }
  for (const r of storey.rooms) {
    const a = f(r.box.x0, r.box.z0)
    const b = f(r.box.x1, r.box.z1)
    const x0 = Math.min(a.x, b.x)
    const x1 = Math.max(a.x, b.x)
    const z0 = Math.min(a.z, b.z)
    const z1 = Math.max(a.z, b.z)
    const cols = Math.max(1, Math.round((x1 - x0) / r.footprint.cellM))
    const rows = Math.max(1, Math.round((z1 - z0) / r.footprint.cellM))
    r.box = { x0, z0, x1, z1 }
    r.centroid = { x: (x0 + x1) / 2, z: (z0 + z1) / 2 }
    r.footprint = { ...r.footprint, cols, rows, filled: '1'.repeat(cols * rows) }
  }
}

describe('§4, §10 what on a plan sheet is the building', () => {
  it('leaves the terrace out of the envelope and anchors the frame on structure', () => {
    const candidate = syntheticCandidate()
    const fabric = classifyStorey(candidate.storeys[0])
    const terrace = fabric.runs.filter((r) => r.wallId.includes('terrace'))
    expect(terrace).toHaveLength(2)
    for (const r of terrace) expect(r.role).toBe('OUTSIDE_MASS')
    // The sheet's outermost band is at z = 0; the building starts at z = 5.
    expect(fabric.envelope?.z0).toBeCloseTo(5, 6)
    expect(fabric.envelope?.z1).toBeCloseTo(19, 6)
    expect(fabric.envelope?.x0).toBeCloseTo(0, 6)
    expect(fabric.envelope?.x1).toBeCloseTo(12, 6)
  })

  it('treats two faces within the detector’s own face tolerance as a line, not a wall', () => {
    const candidate = syntheticCandidate()
    const fabric = classifyStorey(candidate.storeys[0])
    const treads = fabric.runs.filter((r) => r.wallId.includes('tread'))
    expect(treads).toHaveLength(3)
    for (const r of treads) {
      expect(r.role).toBe('LINE_ONLY')
      expect(r.why).toMatch(/one line/)
    }
    expect(registerBuilding(candidate).walls.some((w) => w.id.includes('tread'))).toBe(false)
  })

  it('divides the footprint into a two-storey body and a single-storey wing', () => {
    const b = registerBuilding(syntheticCandidate())
    expect(b.masses.map((m) => m.role)).toEqual(['PRIMARY', 'WING'])
    const [body, wing] = b.masses
    expect(body.footprint).toMatchObject({ x0: 0, z0: 0, x1: 8, z1: 12 })
    expect(wing.footprint).toMatchObject({ x0: 8, z0: 5, x1: 12, z1: 14 })
    // §9: the wing's walls stop at its own roof, not at the storey table's
    // nominal top.
    expect(wing.topM).toBeCloseTo(2.8, 6)
    expect(body.topM).toBeCloseTo(4.6, 6)
  })
})

describe('§5, §6 registration', () => {
  it('puts the upper storey on the building frame with no shift left over', () => {
    const b = registerBuilding(syntheticCandidate())
    const upper = b.registrations.find((r) => r.sourceFrameId === 'PLAN:UPPER')!
    expect(upper.status).toBe('RESOLVED')
    expect(upper.rotation90).toBe(0)
    expect(upper.mirrorX).toBe(false)
    expect(upper.translateX).toBeCloseTo(0, 6)
    expect(upper.translateZ).toBeCloseTo(0, 6)
    expect(upper.residualM).toBeLessThan(0.02)
    expect(upper.matched).toBeGreaterThanOrEqual(8)
  })

  it('registers the section onto the axis it cuts across, and the right way round', () => {
    const b = registerBuilding(syntheticCandidate())
    const section = b.registrations.find((r) => r.kind === 'SECTION')!
    expect(section.status).toBe('RESOLVED')
    expect(section.alongAxis).toBe('X')
    expect(section.alongDirection).toBe(1)
    expect(section.translateX).toBeCloseTo(-1.5, 2)
  })

  it('bounds every roof component to the mass it bears on', () => {
    const b = registerBuilding(syntheticCandidate())
    const gable = b.roofs.find((r) => r.id === 'roof0')!
    const flat = b.roofs.find((r) => r.id === 'roof1')!
    expect(gable.hostMassId).toBe('mass0')
    expect(flat.hostMassId).toBe('mass1')
    expect(gable.footprint).toMatchObject({ x0: 0, z0: 0, x1: 8, z1: 12 })
    expect(flat.footprint).toMatchObject({ x0: 8, z0: 5, x1: 12, z1: 14 })
    // The ridge is where the section's own pitch puts it, and it lands on the
    // middle of the mass rather than being assumed there.
    expect(gable.ridgeAxis).toBe('Z')
    expect(gable.ridgeAtM).toBeCloseTo(4, 2)
    expect(gable.overhangM).toBeNull()
  })

  it('draws no wall across an opening', () => {
    const b = registerBuilding(syntheticCandidate())
    for (const w of b.walls) {
      for (const o of w.openings) {
        for (const f of w.fabric) expect(f.fromM >= o.toM - 1e-9 || f.toM <= o.fromM + 1e-9).toBe(true)
      }
    }
  })

  it('passes every oracle it can answer, and says so where it cannot', () => {
    const b = registerBuilding(syntheticCandidate())
    for (const check of b.checks) expect([check.id, check.status]).toEqual([check.id, 'PASS'])
  })
})

describe('§16 mutations', () => {
  it('1. a ground sheet shifted 4.8 m is registered back, not carried into the scene', () => {
    const plain = registerBuilding(syntheticCandidate())
    const moved = syntheticCandidate()
    for (const w of moved.storeys[0].walls) {
      if (w.axis === 'X') { w.nearM += 4.8; w.farM += 4.8; w.centreM += 4.8 }
      else { w.fromM += 4.8; w.toM += 4.8; for (const o of w.openings) { o.fromM += 4.8; o.toM += 4.8 } }
    }
    for (const r of moved.storeys[0].rooms) { r.box.z0 += 4.8; r.box.z1 += 4.8; r.centroid.z += 4.8 }
    const after = registerBuilding(moved)
    expect(after.masses.map((m) => m.footprint)).toEqual(plain.masses.map((m) => m.footprint))
    expect(after.roofs.map((r) => r.footprint)).toEqual(plain.roofs.map((r) => r.footprint))
  })

  it('1b. a storey placed at the old offset fails the stacking oracle', () => {
    const candidate = syntheticCandidate()
    const b = registerBuilding(candidate)
    const upper = b.storeyEnvelopes.find((s) => s.storey === 'UPPER')!
    upper.envelope = { ...upper.envelope!, z0: upper.envelope!.z0 + 4.8, z1: upper.envelope!.z1 + 4.8 }
    expect(recheck(b, candidate, 'storeys-stack')).toBe('FAIL')
  })

  it('2. a mirrored upper sheet is identified as mirrored rather than accepted as it is', () => {
    const mirrored = syntheticCandidate()
    turnStorey(mirrored.storeys[1], (x, z) => ({ x: 8 - x, z }))
    const reg = registerBuilding(mirrored).registrations.find((r) => r.sourceFrameId === 'PLAN:UPPER')!
    expect(reg.mirrorX || reg.rotation90 !== 0).toBe(true)
    expect(recheck(registerBuilding(mirrored), mirrored, 'storeys-stack')).toBe('PASS')
  })

  it('3. an upper sheet turned a quarter is identified as turned', () => {
    const turned = syntheticCandidate()
    turnStorey(turned.storeys[1], (x, z) => ({ x: -z, z: x }))
    const reg = registerBuilding(turned).registrations.find((r) => r.sourceFrameId === 'PLAN:UPPER')!
    expect(reg.rotation90 === 0 && !reg.mirrorX).toBe(false)
  })

  it('4. a floor opening moved onto a wall fails the void oracle', () => {
    const candidate = syntheticCandidate()
    const b = registerBuilding(candidate)
    expect(b.voids).toHaveLength(1)
    expect(recheck(b, candidate, 'voids-clear-of-fabric')).toBe('PASS')
    b.voids = b.voids.map((v) => ({ ...v, z0: v.z0 + 1, z1: v.z1 + 1 }))
    expect(recheck(b, candidate, 'voids-clear-of-fabric')).toBe('FAIL')
  })

  it('5. a section frame left unregistered leaves the roof unplaced and says so', () => {
    const candidate = syntheticCandidate()
    for (const s of candidate.shell!.slabs) { s.fromM = Number.NaN; s.toM = Number.NaN }
    for (const p of candidate.shell!.roofPlanes) { p.supportFromM = Number.NaN; p.supportToM = Number.NaN }
    const b = registerBuilding(candidate)
    expect(b.registrations.find((r) => r.kind === 'SECTION')!.status).toBe('UNRESOLVED')
    expect(b.roofs.every((r) => r.footprint === null)).toBe(true)
    expect(status(b, 'frames-registered')).toBe('FAIL')
    expect(status(b, 'roof-on-mass')).toBe('FAIL')
    expect(b.unplaced.some((u) => u.kind === 'ROOF_COMPONENT')).toBe(true)
  })

  it('6. a ridge turned onto the wrong axis fails the ridge oracle', () => {
    const candidate = syntheticCandidate()
    const b = registerBuilding(candidate)
    b.roofs[0].ridgeAxis = 'X'
    expect(recheck(b, candidate, 'ridge-on-axis')).toBe('FAIL')
  })

  it('7. a roof moved a metre off its supports fails the support oracle', () => {
    const candidate = syntheticCandidate()
    const b = registerBuilding(candidate)
    const roof = b.roofs[0]
    roof.footprint = { ...roof.footprint!, x0: roof.footprint!.x0 + 1, x1: roof.footprint!.x1 + 1 }
    expect(recheck(b, candidate, 'roof-on-mass')).toBe('FAIL')
  })

  it('8. a roof grown past its host fails the support oracle', () => {
    const candidate = syntheticCandidate()
    const b = registerBuilding(candidate)
    const roof = b.roofs[0]
    roof.footprint = { x0: roof.footprint!.x0 - 2, z0: roof.footprint!.z0 - 2, x1: roof.footprint!.x1 + 2, z1: roof.footprint!.z1 + 2 }
    expect(recheck(b, candidate, 'roof-on-mass')).toBe('FAIL')
  })

  it('9. a terrace edge taken as the envelope fails the origin oracle', () => {
    const candidate = syntheticCandidate()
    const b = registerBuilding(candidate)
    const ground = b.storeyEnvelopes.find((s) => s.storey === 'GROUND')!
    ground.envelope = { ...ground.envelope!, z0: -5 }
    expect(recheck(b, candidate, 'origin-from-structure')).toBe('FAIL')
  })

  it('10. a wall split into disconnected pillars fails the wall oracle', () => {
    const candidate = syntheticCandidate()
    const b = registerBuilding(candidate)
    const west = b.walls.find((w) => w.id === 'GROUND:bodyW')!
    west.fabric = [
      { fromM: 4, toM: 4.2 },
      { fromM: 6, toM: 6.2 },
      { fromM: 8, toM: 8.2 },
    ]
    b.walls = b.walls.filter((w) => w !== west).concat([
      { ...west, id: 'GROUND:bodyW#1', fabric: [{ fromM: 4, toM: 4.2 }] },
      { ...west, id: 'GROUND:bodyW#2', fabric: [{ fromM: 6, toM: 6.2 }] },
      { ...west, id: 'GROUND:bodyW#3', fabric: [{ fromM: 8, toM: 8.2 }] },
    ])
    expect(recheck(b, candidate, 'no-isolated-pillars')).toBe('FAIL')
  })

  it('11. a doorway filled with material fails the opening oracle', () => {
    const candidate = syntheticCandidate()
    const b = registerBuilding(candidate)
    const north = b.walls.find((w) => w.id === 'GROUND:bodyN')!
    expect(north.openings.length).toBeGreaterThan(0)
    north.fabric = [{ fromM: 0, toM: 8 }]
    expect(recheck(b, candidate, 'openings-stay-open')).toBe('FAIL')
  })

  it('12. nothing here can read gold, and two runs agree to the byte', () => {
    for (const file of [
      'src/core/extract/register-building.ts',
      'src/core/extract/plan-masses.ts',
      'src/core/extract/building-frame.ts',
      'src/checkpoint/registered-to-scene.ts',
    ]) {
      const source = readFileSync(file, 'utf8')
      for (const forbidden of ['research/', 'marcowki', 'Marcowki', 'gold']) {
        expect([file, forbidden, source.includes(forbidden)]).toEqual([file, forbidden, false])
      }
    }
    const a = JSON.stringify(registerBuilding(syntheticCandidate()))
    const b = JSON.stringify(registerBuilding(clone(syntheticCandidate())))
    expect(a).toEqual(b)
  })
})

describe('the transform algebra it all rests on', () => {
  const reg = (over: Partial<SourceFrameRegistration>): SourceFrameRegistration => ({
    sourceFrameId: 't', targetFrameId: 'BUILDING', kind: 'PLAN', rotation90: 0, mirrorX: false,
    scaleX: 1, scaleZ: 1, translateX: 0, translateZ: 0, alongAxis: null, alongDirection: null,
    residualM: 0, matched: 0, evidenceRefs: [], evidence: [], status: 'RESOLVED', why: '', ...over,
  })

  it('turns a quarter and keeps the axes it says it keeps', () => {
    expect(placePoint(reg({ rotation90: 1 }), { x: 2, z: 0 })).toMatchObject({ x: 0, z: 2 })
    expect(placedAxis(reg({ rotation90: 1 }), 'X')).toEqual({ axis: 'Z', direction: 1 })
    expect(placedAxis(reg({ rotation90: 1 }), 'Z')).toEqual({ axis: 'X', direction: -1 })
    expect(placedAxis(reg({ mirrorX: true }), 'X')).toEqual({ axis: 'X', direction: -1 })
    expect(placePoint(reg({ rotation90: 2, translateX: 1 }), { x: 3, z: 4 })).toMatchObject({ x: -2, z: -4 })
  })
})
