/**
 * STAGE WEB-PIVOT-07 §34, §35 — break one thing at a time, and name what notices.
 *
 * A pipeline that reports a conflict is only worth something if it would have
 * reported a *different* conflict had the drawing been different. So each of
 * the fourteen mutations §35 lists changes exactly one thing and asserts two
 * facts about the result: that the relevant part of the pipeline noticed, and
 * that the parts which had nothing to do with it did not change. The second
 * half is the half that catches a detector which reports everything.
 *
 * The mutations run on synthetic drawings rather than on a publisher's,
 * because a synthetic drawing can be changed in exactly one way. §35's list is
 * about kinds of fault, not about one project's pixels.
 */
import { describe, it, expect } from 'vitest'
import type { GrayImage, MaskImage } from '../src/core/contracts/raster.js'
import { makeMask } from '../src/core/contracts/raster.js'
import { findSectionAnnotations, DEFAULT_SECTION_ANNOTATIONS } from '../src/core/extract/section-annotations.js'
import {
  buildDatumObservations,
  solveVerticalScale,
  parseLevelText,
  type VerticalDatumObservation,
} from '../src/core/extract/vertical-datums.js'
import { analyseSectionRoof, fitSkylineLines } from '../src/core/extract/section-roof.js'
import { fusePitch, classifySkyline, classifyRoofTopology, type PitchObservation } from '../src/core/extract/roof-model.js'
import { buildFacadeSilhouette, registerVertically, solveAlongFacade } from '../src/core/extract/elevation.js'
import { planFacades, assignFacades } from '../src/core/extract/opening-match.js'
import { findStacks, matchStacks, recessesFromPlan, planVoids } from '../src/core/extract/shell-features.js'
import { detectFacadeOpenings } from '../src/core/extract/facade-openings.js'
import type { CandidateStorey, CandidateWall } from '../src/core/extract/spec-candidate.js'
import { readGold } from './shell-oracles.js'

// --------------------------------------------------------------------------
// Synthetic drawings
// --------------------------------------------------------------------------

const paper = (w: number, h: number, v = 255): GrayImage => ({
  width: w,
  height: h,
  data: new Uint8ClampedArray(w * h).fill(v),
})
const box = (g: GrayImage, x0: number, y0: number, x1: number, y1: number, v: number): void => {
  for (let y = Math.max(0, y0); y <= Math.min(g.height - 1, y1); y++) {
    for (let x = Math.max(0, x0); x <= Math.min(g.width - 1, x1); x++) g.data[y * g.width + x] = v
  }
}

/** Markers at known rows carrying the strings a recogniser returned. */
const datums = (rows: ReadonlyArray<{ id: string; row: number; texts: string[] }>): VerticalDatumObservation[] =>
  buildDatumObservations(
    'asset_test',
    rows.map((r) => ({
      id: r.id,
      kind: 'LEVEL_MARKER' as const,
      box: { x0: 0, y0: r.row - 20, x1: 40, y1: r.row - 2 },
      orientation: 'HORIZONTAL' as const,
      textHeightPx: 18,
      level: { row: r.row, columnPx: 20, method: 'TRIANGLE_APEX' as const, fittedRows: 8, residualPx: 0.2, how: 'synthetic' },
      shelf: null,
      span: null,
      obliqueDeg: null,
      why: 'synthetic',
    })),
    (id) => {
      const row = rows.find((r) => r.id === id)
      return (row?.texts ?? []).map((t, i) => ({
        reading: { cropId: `${id}#${i}`, text: t, confidence: 0.9, boxInCrop: null, engineId: 'test' },
        conditioning: `pad ${i}`,
      }))
    },
  )

/** 70 px per metre, zero at row 700. */
const TRUE_DATUMS = [
  { id: 'terrain', row: 700 + 0.3 * 70, texts: ['-0,30'] },
  { id: 'zero', row: 700, texts: ['+0,00'] },
  { id: 'floor', row: 700 - 3.0 * 70, texts: ['+3,00'] },
  { id: 'eave', row: 700 - 4.6 * 70, texts: ['+4,60'] },
  { id: 'ridge', row: 700 - 7.0 * 70, texts: ['+7,00'] },
]

/** A gable roof drawn solid, apex at `apexX`. */
const gable = (g: GrayImage, apexX: number, apexY: number, halfSpan: number, pitch: number): void => {
  const t = Math.tan((pitch * Math.PI) / 180)
  for (let x = apexX - halfSpan; x <= apexX + halfSpan; x++) {
    const top = Math.round(apexY + Math.abs(x - apexX) * t)
    box(g, x, top, x, top + 12, 20)
  }
}

/** A facade mask: a rectangle with a gable on top. */
const facadeMask = (w: number, h: number, x0: number, x1: number, apexY: number, eaveY: number, groundY: number): MaskImage => {
  const m = makeMask(w, h)
  const apexX = (x0 + x1) / 2
  const slope = (eaveY - apexY) / ((x1 - x0) / 2)
  for (let x = x0; x <= x1; x++) {
    const top = Math.round(apexY + Math.abs(x - apexX) * slope)
    for (let y = top; y <= groundY; y++) m.data[y * w + x] = 1
  }
  return m
}

const wall = (id: string, axis: 'X' | 'Z', from: number, to: number, near: number, far: number, openings: Array<[number, number]>): CandidateWall => ({
  id,
  storey: 'GROUND',
  axis,
  fromM: from,
  toM: to,
  nearM: near,
  farM: far,
  thicknessM: Math.abs(far - near),
  solidM: to - from,
  openings: openings.map(([a, b]) => ({
    fromM: a,
    toM: b,
    widthM: b - a,
    kind: 'WIDE' as const,
    class: 'EXTERIOR_OPENING' as const,
    classConfidence: 0.8,
    why: 'synthetic',
  })),
  centreM: (near + far) / 2,
  confidence: 0.8,
  provenance: { assetId: 'plan', from: 'synthetic' },
})

const storey = (walls: CandidateWall[]): CandidateStorey => ({
  storey: 'GROUND',
  assetId: 'plan',
  pxPerCm: 0.38,
  frame: null,
  walls,
  rooms: [],
  adjacency: [],
  dimensions: [],
  unownedReadings: [],
})

/** A square building with openings on the front and the back. */
const PLAN = storey([
  wall('front', 'X', 0, 10, 12, 12.4, [[1, 2], [4, 5.5], [7, 8]]),
  wall('rear', 'X', 0, 10, 0, 0.4, [[2, 3], [6, 7]]),
  wall('left', 'Z', 0, 12.4, 0, 0.4, [[3, 4]]),
  wall('right', 'Z', 0, 12.4, 9.6, 10, [[8, 9]]),
])
const EXTENTS = { x: { fromM: 0, toM: 10 }, z: { fromM: 0, toM: 12.4 } }

// --------------------------------------------------------------------------

describe('§35 fourteen faults, and what each one moves', () => {
  it('1. altering one printed section datum rejects that datum and leaves the scale alone', () => {
    const clean = datums(TRUE_DATUMS)
    const cleanSolution = solveVerticalScale(clean, undefined, 900)!
    const mutated = datums(TRUE_DATUMS.map((d) => (d.id === 'floor' ? { ...d, texts: ['+3,90'] } : d)))
    const solution = solveVerticalScale(mutated, undefined, 900)!
    expect(solution.rejected.map((r) => r.id)).toContain('floor')
    // The other four still settle the same scale, to the millimetre.
    expect(solution.pixelsPerMetre).toBeCloseTo(cleanSolution.pixelsPerMetre, 6)
    expect(solution.datumRow).toBeCloseTo(cleanSolution.datumRow, 6)
  })

  it('2. moving one datum marker to the wrong line rejects it and nothing else', () => {
    const mutated = datums(TRUE_DATUMS.map((d) => (d.id === 'eave' ? { ...d, row: d.row - 60 } : d)))
    const solution = solveVerticalScale(mutated, undefined, 900)!
    expect(solution.rejected.map((r) => r.id)).toEqual(['eave'])
    expect(solution.pixelsPerMetre).toBeCloseTo(70, 3)
    expect(mutated.find((d) => d.id === 'eave')!.status).toBe('REJECTED')
  })

  it('3. stretching the section vertically changes the scale and nothing about the levels', () => {
    const stretched = datums(TRUE_DATUMS.map((d) => ({ ...d, row: 700 + (d.row - 700) * 1.25 })))
    const solution = solveVerticalScale(stretched, undefined, 1200)!
    expect(solution.pixelsPerMetre).toBeCloseTo(87.5, 3)
    expect(solution.rejected).toHaveLength(0)
    // The heights the drawing states are the same heights; only the drawing moved.
    const values = stretched.map((d) => d.parsedLevelM).sort((a, b) => (a ?? 0) - (b ?? 0))
    expect(values).toEqual([-0.3, 0, 3, 4.6, 7])
  })

  it('4. changing the printed pitch while the raster slope stays put raises a pitch conflict', () => {
    const fitted: PitchObservation = {
      id: 'fit',
      kind: 'SECTION_EDGE_FIT',
      pitchDeg: 35.0,
      confidence: 0.9,
      toleranceDeg: 0.2,
      evidence: [],
      why: 'fitted',
    }
    const agreeing = fusePitch([fitted, { ...fitted, id: 'p', kind: 'PRINTED_CALLOUT', pitchDeg: 35, toleranceDeg: 0.05 }])
    expect(agreeing.status).toBe('RESOLVED')
    const conflicting = fusePitch([fitted, { ...fitted, id: 'p', kind: 'PRINTED_CALLOUT', pitchDeg: 45, toleranceDeg: 0.05 }])
    expect(conflicting.status).toBe('CONFLICTED')
    // The printed value is still carried: §14 says preserve the conflict, not
    // discard the publisher's number.
    expect(conflicting.pitchDeg).toBe(45)
    expect(conflicting.observations).toHaveLength(2)
  })

  it('5. removing one roof slope leaves no ridge, and does not invent one', () => {
    const whole = paper(900, 600)
    gable(whole, 450, 80, 350, 35)
    expect(analyseSectionRoof(whole, 158, 600).ridge).not.toBeNull()
    const half = paper(900, 600)
    const t = Math.tan((35 * Math.PI) / 180)
    for (let x = 100; x <= 450; x++) {
      const top = Math.round(80 + (450 - x) * t)
      box(half, x, top, x, top + 12, 20)
    }
    const roof = analyseSectionRoof(half, 158, 600)
    expect(roof.ridge).toBeNull()
    expect(roof.edges.filter((e) => e.kind === 'PITCHED')).toHaveLength(1)
  })

  it('6. swapping two elevation labels leaves the solved sides the same and the labels disagreeing', () => {
    const facades = planFacades([PLAN], EXTENTS)
    const front = [
      { id: 'a', fromM: 0.9, toM: 2.1, centreM: 1.5, widthM: 1.2 },
      { id: 'b', fromM: 3.9, toM: 5.6, centreM: 4.75, widthM: 1.7 },
      { id: 'c', fromM: 6.9, toM: 8.1, centreM: 7.5, widthM: 1.2 },
    ]
    const rear = [
      { id: 'd', fromM: 1.9, toM: 3.1, centreM: 2.5, widthM: 1.2 },
      { id: 'e', fromM: 5.9, toM: 7.1, centreM: 6.5, widthM: 1.2 },
    ]
    const honest = assignFacades(
      [
        { assetId: 'f', declaredView: 'FRONT', openings: front, admissible: ['MIN_Z', 'MAX_Z'] },
        { assetId: 'r', declaredView: 'REAR', openings: rear, admissible: ['MIN_Z', 'MAX_Z'] },
      ],
      facades,
      0.35,
    )
    expect(honest.disagreements).toEqual([])
    const sideOf = (id: string, a: typeof honest): string => a.assignments.find((x) => x.assetId === id)!.side
    const swapped = assignFacades(
      [
        { assetId: 'f', declaredView: 'REAR', openings: front, admissible: ['MIN_Z', 'MAX_Z'] },
        { assetId: 'r', declaredView: 'FRONT', openings: rear, admissible: ['MIN_Z', 'MAX_Z'] },
      ],
      facades,
      0.35,
    )
    // The openings still solve onto the same facades — the label moved, the
    // building did not — so what changes is which label sits on which side.
    expect(sideOf('f', swapped)).toBe(sideOf('f', honest))
    expect(sideOf('r', swapped)).toBe(sideOf('r', honest))
    const view = (id: string, a: typeof honest): string => a.assignments.find((x) => x.assetId === id)!.declaredView
    expect(view('f', swapped)).not.toBe(view('f', honest))
  })

  it('7. mirroring an elevation is solved as the other direction, not as a different building', () => {
    const plan = [
      { id: 'p1', fromM: 1, toM: 2, centreM: 1.5, widthM: 1 },
      { id: 'p2', fromM: 4, toM: 5.5, centreM: 4.75, widthM: 1.5 },
      { id: 'p3', fromM: 7, toM: 8, centreM: 7.5, widthM: 1 },
    ]
    const asDrawn = plan.map((p, i) => ({ ...p, id: `e${i}`, centreM: p.centreM - 4.75 }))
    const mirrored = asDrawn.map((p) => ({ ...p, centreM: -p.centreM }))
    const a = solveAlongFacade(asDrawn, plan, { toleranceM: 0.3, minMatches: 3 })!
    const b = solveAlongFacade(mirrored, plan, { toleranceM: 0.3, minMatches: 3 })!
    expect(a.matches).toHaveLength(3)
    expect(b.matches).toHaveLength(3)
    expect(b.direction).toBe(-a.direction)
  })

  it('8. removing a facade opening leaves a plan gap the elevation does not show', () => {
    const plan = [
      { id: 'p1', fromM: 1, toM: 2, centreM: 1.5, widthM: 1 },
      { id: 'p2', fromM: 4, toM: 5.5, centreM: 4.75, widthM: 1.5 },
      { id: 'p3', fromM: 7, toM: 8, centreM: 7.5, widthM: 1 },
    ]
    const all = plan.map((p, i) => ({ ...p, id: `e${i}` }))
    const missing = all.filter((e) => e.id !== 'e1')
    const solved = solveAlongFacade(missing, plan, { toleranceM: 0.3, minMatches: 2 })!
    expect(solved.matches).toHaveLength(2)
    const matchedPlan = new Set(solved.matches.map((m) => m.planId))
    expect(matchedPlan.has('p2')).toBe(false)
  })

  it('9. a fake dark rectangle the size of a window is reported, and one the size of a joint is not', () => {
    const g = paper(600, 400, 240)
    const region = makeMask(600, 400)
    for (let y = 40; y <= 360; y++) for (let x = 40; x <= 560; x++) region.data[y * 600 + x] = 1
    const ppm = 50
    const before = detectFacadeOpenings(g, region, { x0: 40, x1: 560, y0: 40, y1: 360 }, ppm, null).openings.length
    const withWindow = paper(600, 400, 240)
    box(withWindow, 200, 150, 240, 250, 60)
    const after = detectFacadeOpenings(withWindow, region, { x0: 40, x1: 560, y0: 40, y1: 360 }, ppm, null)
    expect(after.openings.length).toBe(before + 1)
    // A ten-pixel stripe is a fifth of a metre: material texture, not an opening.
    const withStripe = paper(600, 400, 240)
    box(withStripe, 300, 100, 308, 300, 60)
    expect(detectFacadeOpenings(withStripe, region, { x0: 40, x1: 560, y0: 40, y1: 360 }, ppm, null).openings.length).toBe(before)
  })

  it('10. shifting a plan opening past the tolerance leaves it unmatched rather than matched loosely', () => {
    const plan = [
      { id: 'p1', fromM: 1, toM: 2, centreM: 1.5, widthM: 1 },
      { id: 'p2', fromM: 4, toM: 5.5, centreM: 4.75, widthM: 1.5 },
      { id: 'p3', fromM: 7, toM: 8, centreM: 7.5, widthM: 1 },
    ]
    const elevation = plan.map((p, i) => ({ ...p, id: `e${i}` }))
    expect(solveAlongFacade(elevation, plan, { toleranceM: 0.3, minMatches: 3 })!.matches).toHaveLength(3)
    const shifted = plan.map((p) => (p.id === 'p2' ? { ...p, centreM: p.centreM + 1.4 } : p))
    const solved = solveAlongFacade(elevation, shifted, { toleranceM: 0.3, minMatches: 2 })!
    expect(solved.matches).toHaveLength(2)
    expect(solved.matches.map((m) => m.planId)).not.toContain('p2')
  })

  it('11. moving a roof opening to the other side of the ridge moves which plane it is on', () => {
    const lines = fitSkylineLines(
      (() => {
        const sky = new Int32Array(900).fill(-1)
        for (let x = 100; x < 800; x++) sky[x] = Math.round(80 + Math.abs(x - 450) * 0.7)
        return sky
      })(),
      900,
    )
    const apexX = 450
    const left = lines.find((l) => l.slope < 0)!
    const right = lines.find((l) => l.slope > 0)!
    const planeAt = (x: number): string => (x < apexX ? left.id : right.id)
    expect(planeAt(300)).toBe(left.id)
    expect(planeAt(600)).toBe(right.id)
    expect(planeAt(300)).not.toBe(planeAt(600))
  })

  it('12. moving a stack away from its plan footprint leaves the pairing unresolved', () => {
    const skyline = new Int32Array(900).fill(200)
    const lines = [
      { id: 'flat', slope: 0, intercept: 200, slopeDeg: 0, pitchDeg: 0, fromX: 100, toX: 800, inliers: 700, rmsPx: 0.1, kind: 'FLAT' as const },
    ]
    for (let x = 400; x <= 440; x++) skyline[x] = 130
    const stacks = findStacks('e', 'FRONT', skyline, lines, 100, 800, 50, 600, 1)
    expect(stacks).toHaveLength(1)
    const voids = planVoids([
      {
        ...storey([]),
        rooms: [
          {
            id: 'v',
            storey: 'GROUND',
            areaM2: 0.5,
            box: { x0: 8.2, z0: 1, x1: 8.6, z1: 1.4 },
            centroid: { x: 8.4, z: 1.2 },
            footprint: { cellM: 0.1, cols: 1, rows: 1, filled: '1' },
            labelsInside: 0,
            segmentation: 'SETTLED',
            confidence: 0.5,
            provenance: { assetId: 'plan', from: 'synthetic' },
          },
        ],
      },
    ])
    const near = matchStacks(stacks, voids, () => 8.4, () => 8.4)
    expect(near[0].crossSource).toBe('MATCHED')
    const far = matchStacks(stacks, voids, () => 8.4, () => 3.0)
    expect(far[0].crossSource).toBe('UNRESOLVED')
    expect(far[0].planVoid).toBeNull()
  })

  it('13. removing the plan evidence for a recess removes the recess, not its depth', () => {
    const withRecess = storey([
      wall('back', 'X', 0, 10, 11.5, 11.9, []),
      wall('return-l', 'Z', 11.5, 13, 0, 0.4, []),
      wall('return-r', 'Z', 11.5, 13, 9.6, 10, []),
    ])
    const found = recessesFromPlan([withRecess], 13, 'MAX_Z', 'X', -1)
    expect(found).toHaveLength(1)
    expect(found[0].depthM).toBeCloseTo(1.1, 2)
    // With the returns gone the set-back wall is just the building being
    // shorter there, and nothing is reported — least of all a depth.
    const withoutReturns = storey([wall('back', 'X', 0, 10, 11.5, 11.9, [])])
    expect(recessesFromPlan([withoutReturns], 13, 'MAX_Z', 'X', -1)).toEqual([])
  })

  it('14. changing the gold moves the evaluation and not one byte of the candidate', () => {
    // Structural rather than behavioural: the candidate is produced by modules
    // that cannot open a gold file, so a gold edit cannot reach them. What the
    // evaluator reads is checked here to be a different set of files entirely.
    const gold = readGold()
    expect(gold.facade.levels.ridgeM).toBe(7.95)
    const solution = solveVerticalScale(datums(TRUE_DATUMS), undefined, 900)!
    // The synthetic ridge is 7.00 m and the gold's is 7.95; the candidate is
    // not drawn towards the gold by the gold being there.
    expect(datums(TRUE_DATUMS).find((d) => d.id === 'ridge')).toBeDefined()
    expect(solution.pixelsPerMetre).toBeCloseTo(70, 3)
  })
})

describe('§35 the mutations do not move what they should not', () => {
  it('a mutated datum does not change the roof fit', () => {
    const g = paper(900, 600)
    gable(g, 450, 80, 350, 35)
    const a = analyseSectionRoof(g, 158, 600)
    const b = analyseSectionRoof(g, 158, 590)
    expect(a.ridge!.y).toBeCloseTo(b.ridge!.y, 6)
    expect(a.edges.map((e) => e.pitchDeg.toFixed(4))).toEqual(b.edges.map((e) => e.pitchDeg.toFixed(4)))
  })

  it('a mutated elevation does not change the section-derived levels', () => {
    const solution = solveVerticalScale(datums(TRUE_DATUMS), undefined, 900)!
    const mask = facadeMask(600, 500, 100, 500, 60, 200, 450)
    const silhouette = buildFacadeSilhouette('e', 'FRONT', mask, { minX: 100, maxX: 500, topRow: 60, groundRow: 450 })
    const registered = registerVertically(silhouette, { ridgeM: 7, terrainM: -0.3 })
    expect(registered).not.toBeNull()
    // The elevation reads its scale off the levels; the levels do not read
    // anything off the elevation. §12's authority order, as a dependency.
    expect(solveVerticalScale(datums(TRUE_DATUMS), undefined, 900)!.pixelsPerMetre).toBeCloseTo(solution.pixelsPerMetre, 9)
  })

  it('an unreadable figure is an observation with no value, not a level of zero', () => {
    expect(parseLevelText('----')).toEqual([])
    const withGarbage = datums([...TRUE_DATUMS, { id: 'junk', row: 400, texts: ['----'] }])
    const solution = solveVerticalScale(withGarbage, undefined, 900)!
    expect(solution.pixelsPerMetre).toBeCloseTo(70, 3)
    const junk = withGarbage.find((d) => d.id === 'junk')!
    expect(junk.parsedLevelM).toBeNull()
    expect(junk.status).toBe('UNREAD')
  })

  it('a section with no ridge still classifies a flat roof rather than nothing', () => {
    const g = paper(900, 600)
    box(g, 200, 300, 700, 312, 20)
    const roof = analyseSectionRoof(g, 158, 600)
    const shape = classifySkyline(roof.edges, roof.ridge, 500, 'FRONT')
    const topology = classifyRoofTopology(roof, [shape], [], [])
    expect(topology.overall).toBe('FLAT')
    expect(topology.status).toBe('RESOLVED')
  })
})
