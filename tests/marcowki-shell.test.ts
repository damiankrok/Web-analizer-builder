/**
 * STAGE WEB-PIVOT-02 — Fixture B: the Marcowki exterior shell.
 *
 * Fixture A proved the roof arithmetic on invented numbers. This asks the next
 * question: given a hand-transcribed, source-cited description of a real house,
 * does the compiler realise it, and does what comes out agree with the drawings
 * it was read from?
 *
 * Every geometric assertion reads emitted triangles through the oracles in
 * `tests/geometry-oracles.ts`. Where a test names a dimension it takes it from
 * the gold spec, never from a literal written here, so that a number can only
 * be wrong in one place.
 */
import { describe, expect, it } from 'vitest'
import {
  compileBuilding,
  isSolidBuildingPart,
  type BuildingCompileResult,
  type BuildingTri,
} from '../src/core/wallspec/building.js'
import type { BuildingSpec } from '../src/core/wallspec/architectural.js'
import {
  ATTIC_EAVE_H,
  ATTIC_RIDGE_H,
  GARAGE,
  IDS,
  M,
  MAIN,
  RIDGE_X,
  UPPER_RECESS_M,
  goldProvenance,
  marcowkiBuildingSpec,
} from '../src/core/wallspec/marcowki-fixture.js'
import gold from '../research/gold/marcowki-exterior-shell-v1.json'
import {
  manifoldReport,
  measureRoofPlanes,
  meshBounds,
  meshVolume,
  materialRuns,
  rayIntervals,
  type Interval,
  type OTri,
} from './geometry-oracles.js'

const UP = { x: 0, y: 1, z: 0 }
/** Half a millimetre: below any drawing's precision, far above float noise. */
const MM = 5e-4
/**
 * How far the attic walls' stated top plane may sit from the compiled roof's
 * underside — STAGE WEB-PIVOT-02A.
 *
 * Five microns, and the whole of it is the gold file's own rounding. The wall's
 * top plane is stated from `roof.pitchDeg`; the roof's geometry is built from
 * `level.eaveM` and `level.ridgeM`, both recorded to five decimals. Those two
 * statements of the same slope differ by 9e-7, which over the 0.45 m thickness
 * of the wall is 1.7e-6 m. Nothing in the compiler contributes to it: the
 * synthetic fixture, where both sides come from exact numbers, closes to float
 * precision (`tests/eave-closure.test.ts`).
 */
const SOFFIT_TOL = 5e-6

const build = (spec = marcowkiBuildingSpec()): BuildingCompileResult => compileBuilding(spec)
const solidOf = (r: BuildingCompileResult): BuildingTri[] => r.tris.filter((t) => isSolidBuildingPart(t.part))
const wallTris = (r: BuildingCompileResult, wallId: string): OTri[] =>
  solidOf(r).filter((t) => t.wallId === wallId)
const elementTris = (r: BuildingCompileResult, id: string): OTri[] => r.tris.filter((t) => t.elementId === id)
const show = (list: readonly Interval[]): string =>
  list.map((i) => `[${i.t0.toFixed(3)}, ${i.t1.toFixed(3)}]`).join(' + ') || '(none)'

/**
 * What a vertical line at `(x, z)` passes through.
 *
 * Every wall, slab and roof plane is its own closed solid, and they touch: the
 * attic's walls stand on the ground storey's, the roof's underside lands on the
 * attic's. `materialRuns` counts depth rather than pairing crossings, so two
 * solids in contact read as one run of material instead of an odd crossing
 * count, and a real gap still reads as a gap.
 */
const BELOW = 1000
const verticalRuns = (tris: readonly BuildingTri[], x: number, z: number): Interval[] =>
  materialRuns(tris, { x, y: -BELOW, z }, UP).map((i) => ({ t0: i.t0 - BELOW, t1: i.t1 - BELOW }))

// --------------------------------------------------------------------------
// The gold spec itself.
// --------------------------------------------------------------------------

describe('Marcowki gold spec — provenance', () => {
  it('gives every observation a source, a locator, an interpretation and a status', () => {
    expect(gold.observations.length).toBeGreaterThan(25)
    for (const o of gold.observations) {
      expect(o.source.length, o.key).toBeGreaterThan(10)
      expect(o.locator.length, o.key).toBeGreaterThan(10)
      expect(o.interpretation.length, o.key).toBeGreaterThan(15)
      expect(
        ['SOURCE_EXACT', 'SOURCE_CORROBORATED', 'SOURCE_DERIVED', 'ASSUMPTION', 'UNRESOLVED'],
        o.key,
      ).toContain(o.status)
      expect(Number.isFinite(o.value), o.key).toBe(true)
    }
  })

  it('never lets an assumption or an unresolved value into the compiled shell', () => {
    // The strong form of "do not silently turn an unresolved value into exact
    // geometry": no dimension the compiler uses may be weaker than derived.
    const spec = marcowkiBuildingSpec()
    const used = [
      ...spec.levels.map((l) => l.provenance),
      ...spec.shells.map((s) => s.provenance),
      ...spec.slabs.map((s) => s.provenance),
      ...spec.roofs.map((r) => r.provenance),
    ]
    for (const p of used) {
      expect(['SOURCE_EXACT', 'SOURCE_CORROBORATED', 'SOURCE_DERIVED'], p.interpretation).toContain(p.status)
    }
    // ...and the things the source did not settle are still written down.
    expect(spec.unresolved.length).toBeGreaterThan(0)
    for (const u of spec.unresolved) expect(u.why.length).toBeGreaterThan(30)
  })

  it('records what it saw and did not model, rather than leaving it out silently', () => {
    expect(gold.observedButNotModelled.length).toBeGreaterThan(3)
    for (const n of gold.observedButNotModelled) expect(n.why.length).toBeGreaterThan(20)
  })

  it('reconciles the published height with the section datums', () => {
    // 7.95 above the ground floor plus 0.32 of terrain offset is the published
    // 8.27. That the two agree is what settles the datum semantics.
    expect(M.ridge - M.terrain).toBeCloseTo(M.buildingHeight, 9)
    expect(goldProvenance('building.heightM').status).toBe('SOURCE_EXACT')
  })
})

// --------------------------------------------------------------------------
// The shell.
// --------------------------------------------------------------------------

describe('Marcowki shell — compilation', () => {
  it('compiles with no diagnostics and three closed shells', () => {
    const r = build()
    expect(r.diagnostics).toEqual([])
    expect(r.shells.map((s) => s.shellId)).toEqual([IDS.groundMain, IDS.garage, IDS.attic])
    for (const s of r.shells) {
      expect(s.ring.closed, s.shellId).toBe(true)
      expect(s.ring.diagnostics, s.shellId).toEqual([])
    }
    expect(r.roofs.map((x) => x.roofId)).toEqual([IDS.gableRoof, IDS.flatRoof])
    expect(r.slabs.map((x) => x.slabId)).toEqual([IDS.slab])
  })

  it('emits every wall as a closed, consistently wound solid', () => {
    const r = build()
    for (const s of r.shells) {
      for (const id of s.wallIds) {
        const w = wallTris(r, id)
        const m = manifoldReport(w)
        expect(m.boundaryEdges, `${id} boundary`).toEqual([])
        expect(m.duplicateEdges, `${id} duplicate`).toEqual([])
        expect(meshVolume(w), `${id} volume`).toBeGreaterThan(0)
      }
    }
  })

  it('tags every triangle with its element, storey, level and source', () => {
    const r = build()
    for (const t of r.tris) {
      expect(['WALL', 'SLAB', 'ROOF']).toContain(t.elementKind)
      expect(t.elementId.length).toBeGreaterThan(0)
      expect(t.storeyId, t.elementId).toBeDefined()
      expect(t.levelId, t.elementId).toBeDefined()
      expect(t.provenanceSource, t.elementId).toBeDefined()
    }
    // Openings and glazing keep their host and owner too.
    const glass = r.tris.filter((t) => t.part === 'GLAZING')
    expect(glass.length).toBeGreaterThan(0)
    for (const g of glass) {
      expect(g.openingId).toBe(IDS.gableOpening)
      expect(g.wallId).toBe('attic_front')
    }
  })
})

// --------------------------------------------------------------------------
// 8. Stacked storeys.
// --------------------------------------------------------------------------

describe('Marcowki shell — stacked storeys', () => {
  it('stands the attic on the ground storey with no gap and no overlap', () => {
    const r = build()
    const ground = r.shells.find((s) => s.shellId === IDS.groundMain)!
    const attic = r.shells.find((s) => s.shellId === IDS.attic)!
    expect(ground.topM).toBeCloseTo(attic.baseM, 12)
    expect(attic.baseM).toBeCloseTo(M.upperFfl, 12)

    // Measured, not assumed: a vertical line through the left wall runs from
    // the ground floor to the underside of the roof without a break, even
    // though that is two storeys of separate solids stacked on each other and
    // then a roof on top.
    //
    // The line is taken at mid-thickness, and since STAGE WEB-PIVOT-02A that is
    // *not* the eave: the soffit above this wall slopes, so the wall's top
    // rises across its own thickness. Where it has to stop is read off the
    // emitted roof, not computed here — which makes this the interface check it
    // always looked like.
    const walls = solidOf(r).filter((t) => t.elementKind === 'WALL')
    const roof = solidOf(r).filter((t) => t.elementId === IDS.gableRoof)
    const at = { x: M.wallThickness / 2, z: M.overallDepth / 2 }
    const soffit = verticalRuns(roof, at.x, at.z)[0].t0
    const column = verticalRuns(walls, at.x, at.z)
    expect(column).toHaveLength(1)
    expect(column[0].t0).toBeCloseTo(M.groundFfl, 9)
    // And no wedge of air between wall and roof: the wall stops where the roof
    // starts, to the gold file's own rounding and no worse.
    expect(Math.abs(column[0].t1 - soffit)).toBeLessThan(SOFFIT_TOL)
  })

  it('puts the floor plate between the two storeys and inside the walls', () => {
    const r = build()
    const slab = r.slabs[0]
    expect(slab.topM).toBeCloseTo(M.upperFfl, 12)
    expect(slab.thicknessM).toBeCloseTo(M.slabThickness, 12)
    const solid = solidOf(r)
    // Above the middle of the room: the plate and nothing else below the roof.
    const runs = verticalRuns(solid, MAIN.maxX / 2, MAIN.maxZ / 2)
    const plate = runs.find((i) => Math.abs(i.t1 - M.upperFfl) < MM)
    expect(plate, `runs were ${show(runs)}`).toBeDefined()
    expect(plate!.t1 - plate!.t0).toBeCloseTo(M.slabThickness, 9)
  })

  it('keeps the upper shell clear of the lower one everywhere', () => {
    const r = build()
    const lower = solidOf(r).filter((t) => t.storeyId === IDS.groundMain || t.storeyId === IDS.garage)
    const upper = solidOf(r).filter((t) => t.storeyId === IDS.attic)
    // Sweep vertical lines through the plan and require the two storeys never
    // to share a run of material.
    for (const x of [0.2, 1.0, 3.6, 6.0, 7.7, 8.2, 11.8]) {
      for (const z of [0.2, 3.0, 6.3, 9.0, 12.4]) {
        const a = verticalRuns(lower, x, z)
        const b = verticalRuns(upper, x, z)
        for (const p of a) {
          for (const q of b) {
            const overlap = Math.min(p.t1, q.t1) - Math.max(p.t0, q.t0)
            expect(overlap, `storeys overlap at (${x}, ${z})`).toBeLessThan(MM)
          }
        }
      }
    }
  })
})

// --------------------------------------------------------------------------
// 8, 12, 22.4. The recessed upper wall.
// --------------------------------------------------------------------------

describe('Marcowki shell — the recessed upper wall', () => {
  it('sets the attic back 4.15 m from the building own right facade', () => {
    expect(UPPER_RECESS_M).toBeCloseTo(M.overallWidth - M.mainWidth, 12)
    expect(UPPER_RECESS_M).toBeCloseTo(4.15, 9)
    const r = build()
    const attic = solidOf(r).filter((t) => t.storeyId === IDS.attic)
    const whole = solidOf(r)
    expect(meshBounds(attic).max.x).toBeCloseTo(MAIN.maxX, 9)
    expect(meshBounds(whole).max.x).toBeCloseTo(M.overallWidth, 9)
  })

  it('keeps a hosted opening on that wall, which is the RC03 regression', () => {
    // The real building has no window there — the attic plan's 78/118 callouts
    // are roof windows — so this is the stage brief's "dedicated equivalent
    // diagnostic wall", stated as a diagnostic and off by default.
    const r = build(marcowkiBuildingSpec({ diagnosticRecessOpening: true }))
    expect(r.diagnostics).toEqual([])
    const cut = r.tris.filter((t) => t.openingId === 'opening_recess_diagnostic')
    expect(cut.length).toBeGreaterThan(0)
    expect(cut.every((t) => t.wallId === 'attic_right')).toBe(true)

    // Material really is missing: a ray through the opening crosses no wall.
    const wall = wallTris(r, 'attic_right')
    const z = M.overallDepth - 4.5 // 4.0 m along a wall whose u runs -Z from the front
    const through = rayIntervals(wall, { x: MAIN.maxX + 1, y: M.upperFfl + 0.9, z }, { x: -1, y: 0, z: 0 })
    expect(through, `expected a clear line through the opening, got ${show(through)}`).toHaveLength(0)
    const beside = rayIntervals(wall, { x: MAIN.maxX + 1, y: M.upperFfl + 0.9, z: z - 2 }, { x: -1, y: 0, z: 0 })
    expect(beside).toHaveLength(1)
    expect(beside[0].t1 - beside[0].t0).toBeCloseTo(M.wallThickness, 9)
  })

  it('does not move that opening when the wall moves further from the facade', () => {
    // Mutation 4. Push the whole attic 1.5 m further in; the opening must keep
    // its host-local place, which the legacy global-facade attachment could not.
    const base = marcowkiBuildingSpec({ diagnosticRecessOpening: true })
    const moved: BuildingSpec = {
      ...base,
      walls: base.walls.map((w) =>
        w.id.startsWith('attic_') ? { ...w, origin: { ...w.origin, x: w.origin.x - 1.5 } } : w,
      ),
    }
    const here = build(base)
    const there = build(moved)
    expect(there.diagnostics.filter((d) => d.severity === 'ERROR')).toEqual([])
    const local = (r: BuildingCompileResult, originX: number): { u0: number; u1: number } => {
      const tris = r.tris.filter((t) => t.openingId === 'opening_recess_diagnostic')
      // attic_right runs -Z from the front corner, so u is measured back from maxZ.
      const zs = tris.flatMap((t) => [t.a.z, t.b.z, t.c.z])
      void originX
      return { u0: M.overallDepth - Math.max(...zs), u1: M.overallDepth - Math.min(...zs) }
    }
    expect(local(there, -1.5)).toEqual(local(here, 0))
    expect(local(here, 0).u0).toBeCloseTo(4.0, 9)
    expect(local(here, 0).u1).toBeCloseTo(5.0, 9)
  })
})

// --------------------------------------------------------------------------
// 10, 11, 12. Roofs.
// --------------------------------------------------------------------------

describe('Marcowki shell — roofs', () => {
  it('measures the main gable at the printed pitch, from the triangles', () => {
    const r = build()
    const planes = measureRoofPlanes(elementTris(r, IDS.gableRoof), UP)
    expect(planes).toHaveLength(2)
    for (const p of planes) {
      expect(p.pitchDeg, 'measured pitch against the printed 40').toBeCloseTo(M.pitchDeg, 3)
      expect(p.riseM).toBeCloseTo(Math.tan((p.pitchDeg * Math.PI) / 180) * p.horizontalRunM, 9)
      expect(p.lowM).toBeCloseTo(M.eave, 9)
      expect(p.highM).toBeCloseTo(M.ridge, 9)
      expect(p.horizontalRunM).toBeCloseTo(M.mainWidth / 2, 9)
      // No overhang: the roof lands on the outer wall face.
      expect(Math.abs(p.normal.z), 'ridge runs front to back').toBeLessThan(1e-9)
    }
    const built = r.roofs.find((x) => x.roofId === IDS.gableRoof)!
    expect(Math.abs(built.builtPitchDeg - built.declaredPitchDeg!)).toBeLessThan(0.001)
  })

  it('keeps the garage roof flat, separately supported, and not part of the gable', () => {
    const r = build()
    const planes = measureRoofPlanes(elementTris(r, IDS.flatRoof), UP)
    expect(planes).toHaveLength(1)
    expect(planes[0].pitchDeg).toBeCloseTo(0, 12)
    expect(planes[0].lowM).toBeCloseTo(M.flatTop, 12)
    expect(planes[0].areaM2).toBeCloseTo(M.garageWidth * M.garageDepth, 9)
    // It sits over the garage and nowhere else.
    const b = meshBounds(elementTris(r, IDS.flatRoof))
    expect(b.min.x).toBeCloseTo(GARAGE.minX, 9)
    expect(b.max.x).toBeCloseTo(GARAGE.maxX, 9)
    expect(b.min.z).toBeCloseTo(GARAGE.minZ, 9)
    expect(b.max.z).toBeCloseTo(GARAGE.maxZ, 9)
    // ...and its underside lands on the garage walls, so the two meet exactly.
    expect(planes[0].lowM - M.flatThickness).toBeCloseTo(r.shells.find((s) => s.shellId === IDS.garage)!.topM, 9)
  })

  it('does not shrink the main roof when the wall under it shrinks', () => {
    // Mutation 3, and the legacy "a recess changes the whole mass" error. The
    // roof's extent is stated in the RoofSpec; the walls do not vote on it.
    const base = marcowkiBuildingSpec()
    const shrunk: BuildingSpec = {
      ...base,
      walls: base.walls.map((w) => (w.id === 'attic_right' ? { ...w, origin: { ...w.origin, x: w.origin.x - 1.2 } } : w)),
    }
    const before = measureRoofPlanes(elementTris(build(base), IDS.gableRoof), UP)
    const after = measureRoofPlanes(elementTris(build(shrunk), IDS.gableRoof), UP)
    expect(after.map((p) => p.horizontalRunM)).toEqual(before.map((p) => p.horizontalRunM))
    expect(after.map((p) => p.areaM2)).toEqual(before.map((p) => p.areaM2))
    expect(elementTris(build(shrunk), IDS.gableRoof)).toEqual(elementTris(build(base), IDS.gableRoof))
  })

  it('moves the roof only when the RoofSpec says so', () => {
    const base = marcowkiBuildingSpec()
    const widened: BuildingSpec = {
      ...base,
      roofs: base.roofs.map((rf) =>
        rf.id === IDS.gableRoof ? { ...rf, footprint: { ...rf.footprint, maxX: rf.footprint.maxX + 1.0 } } : rf,
      ),
    }
    const after = measureRoofPlanes(elementTris(build(widened), IDS.gableRoof), UP)
    expect(after[0].horizontalRunM).toBeCloseTo(M.mainWidth / 2 + 0.5, 9)
  })
})

// --------------------------------------------------------------------------
// 13, 14. Gable closure and the gable opening.
// --------------------------------------------------------------------------

describe('Marcowki shell — the gable', () => {
  it('closes the gable end against the roof with no gap and no double fill', () => {
    const r = build()
    const gable = solidOf(r).filter((t) => t.wallId === 'attic_front')
    const roof = r.tris.filter((t) => t.elementId === IDS.gableRoof)
    for (const x of [0.4, 1.5, 3.0, 3.6, 5.0, 6.9, 7.5]) {
      const z = M.overallDepth - M.wallThickness / 2
      const wall = verticalRuns(gable, x, z)
      const above = verticalRuns(roof, x, z)
      expect(wall.length, `wall at x=${x}`).toBeGreaterThan(0)
      expect(above.length, `roof at x=${x}`).toBe(1)
      const wallTop = Math.max(...wall.map((i) => i.t1))
      // The wall's top meets the roof's underside: no daylight, no shared solid.
      // Five decimals: the gold file records the derived roof build-up to five,
      // so the two sides of this identity can differ by that rounding and no more.
      expect(wallTop, `x=${x}: wall top ${wallTop} vs roof underside ${above[0].t0}`).toBeCloseTo(above[0].t0, 5)
    }
  })

  it('is a wall solid up to the ridge, not a triangular patch', () => {
    const r = build()
    const gable = wallTris(r, 'attic_rear')
    expect(manifoldReport(gable).closed).toBe(true)
    // Its cross-section is a rectangle plus a triangle, times the thickness.
    const area = M.mainWidth * ATTIC_EAVE_H + (M.mainWidth * (ATTIC_RIDGE_H - ATTIC_EAVE_H)) / 2
    expect(meshVolume(gable)).toBeCloseTo(area * M.wallThickness, 6)
    const b = meshBounds(gable)
    expect(b.max.y).toBeCloseTo(M.upperFfl + ATTIC_RIDGE_H, 9)
    expect(b.max.y).toBeLessThan(M.ridge) // under the roof, not through it
  })

  it('cuts one opening that crosses from the rectangular zone into the sloped one', () => {
    const r = build()
    const gable = solidOf(r).filter((t) => t.wallId === 'attic_front')
    const z = M.overallDepth - M.wallThickness / 2
    const eaveY = M.upperFfl + ATTIC_EAVE_H
    const centreX = M.openingOffset + M.openingWidth / 2
    const through = verticalRuns(gable, centreX, z)
    // One run of material, starting above the opening's head.
    expect(through).toHaveLength(1)
    expect(through[0].t0, 'the head is above the eave line').toBeGreaterThan(eaveY)
    expect(through[0].t0).toBeGreaterThan(M.openingSill)
    // The opening reaches the wall base, so there is nothing below it either.
    expect(through[0].t0 - M.openingSill).toBeGreaterThan(1.5)

    // Beside the opening the wall is solid from the floor up.
    const beside = verticalRuns(gable, 1.0, z)
    expect(beside).toHaveLength(1)
    expect(beside[0].t0).toBeCloseTo(M.upperFfl, 9)

    // One structural hole, not one per panel: the wall's volume drops by exactly
    // the trapezoid the opening describes.
    const trapezoid = (M.openingHeight + M.openingHeightFar) / 2 * M.openingWidth
    const solidArea = M.mainWidth * ATTIC_EAVE_H + (M.mainWidth * (ATTIC_RIDGE_H - ATTIC_EAVE_H)) / 2
    expect(meshVolume(gable)).toBeCloseTo((solidArea - trapezoid) * M.wallThickness, 6)
  })

  it('fills the opening with glazing that is not part of the wall solid', () => {
    const r = build()
    const glass = r.tris.filter((t) => t.part === 'GLAZING' && t.openingId === IDS.gableOpening)
    expect(glass).toHaveLength(2)
    const b = meshBounds(glass)
    expect(b.min.x).toBeCloseTo(M.openingOffset, 9)
    expect(b.max.x).toBeCloseTo(M.openingOffset + M.openingWidth, 9)
    expect(b.min.y).toBeCloseTo(M.openingSill, 9)
    expect(b.max.y).toBeCloseTo(M.openingSill + M.openingHeight, 9)
    // Adding it opens the wall's surface, which is how we know it is separate.
    const wall = r.tris.filter((t) => t.wallId === 'attic_front')
    expect(manifoldReport(wall).closed).toBe(false)
    expect(manifoldReport(wallTris(r, 'attic_front')).closed).toBe(true)
  })
})

// --------------------------------------------------------------------------
// 16. Source-space checks.
// --------------------------------------------------------------------------

describe('Marcowki shell — against the drawings', () => {
  it('matches the ground plan chains', () => {
    const b = meshBounds(solidOf(build()))
    expect(b.max.x - b.min.x, 'overall width against the printed 1205').toBeCloseTo(M.overallWidth, 9)
    expect(b.max.z - b.min.z, 'overall depth against the printed 1260').toBeCloseTo(M.overallDepth, 9)
    const area = M.mainWidth * M.overallDepth + M.garageWidth * M.garageDepth
    expect(area).toBeCloseTo(130.665, 3)
    expect(Math.abs(area - M.publishedFootprint) / M.publishedFootprint).toBeLessThan(0.005)
  })

  it('matches the upper plan: the attic covers the main body and nothing else', () => {
    const r = build()
    const attic = solidOf(r).filter((t) => t.storeyId === IDS.attic)
    const b = meshBounds(attic)
    expect(b.min.x).toBeCloseTo(MAIN.minX, 9)
    expect(b.max.x).toBeCloseTo(MAIN.maxX, 9)
    expect(b.min.z).toBeCloseTo(MAIN.minZ, 9)
    expect(b.max.z).toBeCloseTo(MAIN.maxZ, 9)
  })

  it('matches the section: levels, eave, ridge and pitch', () => {
    const r = build()
    const solid = solidOf(r)
    // A vertical line just inside the left wall meets the ground storey, then
    // the attic, then the roof, in that order and with no gaps between them.
    const roofTris = solid.filter((t) => t.elementId === IDS.gableRoof)
    const runs = verticalRuns(solid.filter((t) => t.elementKind === 'WALL'), M.wallThickness / 2, 6.0)
    expect(runs).toHaveLength(1)
    expect(runs[0].t0).toBeCloseTo(M.groundFfl, 9)
    // Since STAGE WEB-PIVOT-02A the wall stops at the soffit, which at
    // mid-thickness is above the eave-face knee wall by half a thickness of
    // slope. Read from the roof's own triangles.
    expect(Math.abs(runs[0].t1 - verticalRuns(roofTris, M.wallThickness / 2, 6.0)[0].t0)).toBeLessThan(
      SOFFIT_TOL,
    )
    // The ridge is over the middle of the main body.
    const planes = measureRoofPlanes(elementTris(r, IDS.gableRoof), UP)
    expect(RIDGE_X).toBeCloseTo(M.mainWidth / 2, 12)
    const roofAtRidge = verticalRuns(r.tris.filter((t) => t.elementId === IDS.gableRoof), RIDGE_X - 0.05, 6.0)
    expect(Math.max(...roofAtRidge.map((i) => i.t1))).toBeCloseTo(M.ridge, 1)
    expect(planes[0].lowM).toBeCloseTo(M.eave, 9)
    // The printed eave datum is 3.4 cm above the plane, and we say so.
    expect(Math.abs(M.printedEave - M.eave)).toBeLessThan(0.04)
    expect(Math.abs(M.printedEave - M.eave)).toBeGreaterThan(0.02)
  })

  it('puts the knee wall where the section prints it', () => {
    expect(ATTIC_EAVE_H).toBeCloseTo(M.kneeWall, 12)
    const r = build()
    const side = wallTris(r, 'attic_left')
    // The section prints the knee wall at the *outer face*, which is where the
    // eave datum is taken, so that is where it is measured. Since STAGE
    // WEB-PIVOT-02A the inner face is higher: the wall follows the soffit
    // across its thickness instead of leaving a wedge of air under it.
    const onPlane = (x: number) => (t: OTri): boolean =>
      [t.a, t.b, t.c].every((p) => Math.abs(p.x - x) < 1e-9)
    const outer = side.filter(onPlane(MAIN.minX))
    const inner = side.filter(onPlane(MAIN.minX + M.wallThickness))
    expect(meshBounds(outer).max.y).toBeCloseTo(M.upperFfl + M.kneeWall, 9)
    expect(meshBounds(inner).max.y).toBeCloseTo(
      M.upperFfl + M.kneeWall + M.wallThickness * Math.tan((M.pitchDeg * Math.PI) / 180),
      9,
    )
  })
})

// --------------------------------------------------------------------------
// 22. Mutations. None is committed.
// --------------------------------------------------------------------------

describe('Marcowki shell — mutations', () => {
  const base = marcowkiBuildingSpec()

  it('1. a declared pitch that lies changes no geometry, and is reported', () => {
    const lying: BuildingSpec = {
      ...base,
      roofs: base.roofs.map((rf) => (rf.id === IDS.gableRoof ? { ...rf, pitchDeg: 22 } : rf)),
    }
    const r = build(lying)
    expect(elementTris(r, IDS.gableRoof)).toEqual(elementTris(build(base), IDS.gableRoof))
    const measured = measureRoofPlanes(elementTris(r, IDS.gableRoof), UP)[0].pitchDeg
    expect(measured).toBeCloseTo(M.pitchDeg, 3)
    const built = r.roofs.find((x) => x.roofId === IDS.gableRoof)!
    expect(Math.abs(built.builtPitchDeg - built.declaredPitchDeg!)).toBeGreaterThan(17)
  })

  it('2. moving the ridge changes the measured pitch and breaks the section', () => {
    const raised: BuildingSpec = {
      ...base,
      levels: base.levels.map((l) => (l.kind === 'RIDGE' ? { ...l, elevationM: l.elevationM + 1.5 } : l)),
    }
    const r = build(raised)
    const measured = measureRoofPlanes(elementTris(r, IDS.gableRoof), UP)[0]
    expect(Math.abs(measured.pitchDeg - M.pitchDeg)).toBeGreaterThan(8)
    expect(measured.highM).toBeCloseTo(M.ridge + 1.5, 9)
    // ...and the gable wall no longer reaches the roof, which the closure
    // oracle sees as daylight between them.
    const wall = verticalRuns(solidOf(r).filter((t) => t.wallId === 'attic_front'), 3.0, M.overallDepth - M.wallThickness / 2)
    const roof = verticalRuns(r.tris.filter((t) => t.elementId === IDS.gableRoof), 3.0, M.overallDepth - M.wallThickness / 2)
    expect(roof[0].t0 - Math.max(...wall.map((i) => i.t1))).toBeGreaterThan(0.5)
  })

  it('5. a gable turned into a hip or a mono pitch is refused, not re-used', () => {
    for (const kind of ['HIP', 'MONO_PITCH'] as const) {
      const swapped: BuildingSpec = {
        ...base,
        roofs: base.roofs.map((rf) => (rf.id === IDS.gableRoof ? { ...rf, kind } : rf)),
      }
      const r = build(swapped)
      expect(r.diagnostics.map((d) => d.code)).toContain('UNSUPPORTED_ROOF_KIND')
      expect(elementTris(r, IDS.gableRoof)).toHaveLength(0)
      expect(r.roofs.map((x) => x.roofId)).toEqual([IDS.flatRoof])
    }
  })

  it('6. removing a junction breaks the shell topology by name', () => {
    const broken: BuildingSpec = {
      ...base,
      shells: base.shells.map((s) =>
        s.id === IDS.attic ? { ...s, junctionIds: s.junctionIds.filter((j) => !j.endsWith('_fr')) } : s,
      ),
    }
    const r = build(broken)
    expect(r.diagnostics.map((d) => d.code)).toContain('RING_WALL_END_UNJOINED')
    expect(r.shells.find((s) => s.shellId === IDS.attic)!.ring.closed).toBe(false)
    // The corner is now claimed twice, so the attic's volume is over.
    const over = (res: BuildingCompileResult): number =>
      res.shells
        .find((s) => s.shellId === IDS.attic)!
        .wallIds.reduce((acc, id) => acc + meshVolume(wallTris(res, id)), 0)
    expect(over(r) - over(build(base))).toBeGreaterThan(0.2)
  })

  it('refuses a spec that names things it does not have', () => {
    const cases: Array<[string, BuildingSpec, string]> = [
      [
        'unknown wall',
        { ...base, shells: base.shells.map((s) => (s.id === IDS.attic ? { ...s, wallIds: [...s.wallIds, 'nope'] } : s)) },
        'UNKNOWN_SHELL_WALL',
      ],
      [
        'unknown level',
        { ...base, shells: base.shells.map((s) => (s.id === IDS.attic ? { ...s, baseLevelId: 'nope' } : s)) },
        'UNKNOWN_LEVEL',
      ],
      [
        'roof on a level that is not there',
        { ...base, roofs: base.roofs.map((rf) => ({ ...rf, eaveLevelId: 'nope' })) },
        'UNKNOWN_ROOF_LEVEL',
      ],
      ['wall in no shell', { ...base, shells: base.shells.filter((s) => s.id !== IDS.garage) }, 'WALL_IN_NO_SHELL'],
    ]
    for (const [what, spec, code] of cases) {
      expect(build(spec).diagnostics.map((d) => d.code), what).toContain(code)
    }
  })
})

describe('Marcowki shell — determinism', () => {
  it('does not touch its input and compiles identically twice', () => {
    const spec = marcowkiBuildingSpec()
    const deepFreeze = (v: unknown): void => {
      if (v && typeof v === 'object') {
        Object.freeze(v)
        for (const x of Object.values(v as Record<string, unknown>)) deepFreeze(x)
      }
    }
    deepFreeze(spec)
    const before = JSON.stringify(spec)
    const a = compileBuilding(spec)
    const b = compileBuilding(spec)
    expect(JSON.stringify(spec)).toBe(before)
    expect(b.tris).toEqual(a.tris)
    expect(b.roofs).toEqual(a.roofs)
    expect(JSON.stringify(b.diagnostics)).toBe(JSON.stringify(a.diagnostics))
  })
})
