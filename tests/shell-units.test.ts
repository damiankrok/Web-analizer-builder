/**
 * STAGE WEB-PIVOT-07 §12, §17, §18, §20, §26, §29 — the rules, one at a time.
 *
 * Everything here is synthetic. The point of these is not that the pipeline
 * gets project A right — the evaluator measures that — but that the rules it
 * is made of are the rules the brief asks for, stated so that breaking one
 * fails a test rather than shifting a number.
 */
import { describe, it, expect } from 'vitest'
import { makeMask } from '../src/core/contracts/raster.js'
import {
  beats,
  fuseMeasures,
  unresolvedMeasure,
  isResolved,
  type CandidateMeasure,
} from '../src/core/extract/candidate-evidence.js'
import { sourceTolerance, printedTolerance } from '../src/core/extract/source-tolerance.js'
import {
  buildFacadeSilhouette,
  registerVertically,
  solveAlongFacade,
} from '../src/core/extract/elevation.js'
import { planFacades, assignFacades, scoreAgainstFacade } from '../src/core/extract/opening-match.js'
import { classifySkyline, classifyRoofTopology, fusePitch } from '../src/core/extract/roof-model.js'
import { analyseSectionRoof } from '../src/core/extract/section-roof.js'
import type { CandidateStorey, CandidateWall } from '../src/core/extract/spec-candidate.js'

const measure = (valueM: number, fidelity: CandidateMeasure['fidelity'], toleranceM: number): CandidateMeasure => ({
  valueM,
  fidelity,
  confidence: 0.8,
  toleranceM,
  evidence: [],
  why: 'test',
})

describe('§12 authority, and what fusing is allowed to do', () => {
  it('orders the routes the way §12 does', () => {
    expect(beats('SOURCE_EXACT', 'SOURCE_RECONCILED')).toBe(true)
    expect(beats('SOURCE_RECONCILED', 'SOURCE_DERIVED')).toBe(true)
    expect(beats('SOURCE_DERIVED', 'RENDER_DERIVED')).toBe(true)
    expect(beats('RENDER_DERIVED', 'GEOMETRIC_INFERENCE')).toBe(true)
    expect(beats('GEOMETRIC_INFERENCE', 'UNRESOLVED')).toBe(true)
    expect(beats('SOURCE_EXACT', 'SOURCE_EXACT')).toBe(false)
  })

  it('does not let an elevation silhouette override a printed section datum', () => {
    const printed = measure(7.95, 'SOURCE_EXACT', 0.005)
    const silhouette = measure(8.2, 'RENDER_DERIVED', 0.05)
    const { fused, status } = fuseMeasures(printed, silhouette)
    expect(fused.valueM).toBe(7.95)
    expect(fused.fidelity).toBe('SOURCE_EXACT')
    expect(status).toBe('CONFLICTED')
    expect(fused.why).toMatch(/does not override it/)
  })

  it('combines two readings of the same kind only when they agree', () => {
    const a = measure(4.0, 'SOURCE_DERIVED', 0.04)
    const b = measure(4.05, 'SOURCE_DERIVED', 0.04)
    const agreeing = fuseMeasures(a, b)
    expect(agreeing.status).toBe('RESOLVED')
    expect(agreeing.fused.valueM).toBeCloseTo(4.025, 3)
    // Fusing buys certainty only where there was agreement to buy it with.
    expect(agreeing.fused.toleranceM).toBeLessThan(0.04)

    const disagreeing = fuseMeasures(a, measure(4.6, 'SOURCE_DERIVED', 0.04))
    expect(disagreeing.status).toBe('CONFLICTED')
    // Never the mean of two values no source states.
    expect(disagreeing.fused.valueM === 4.0 || disagreeing.fused.valueM === 4.6).toBe(true)
  })

  it('treats an unresolved measure as absent rather than as zero', () => {
    const u = unresolvedMeasure('nothing constrains it')
    expect(isResolved(u)).toBe(false)
    expect(fuseMeasures(u, measure(3, 'SOURCE_DERIVED', 0.02)).fused.valueM).toBe(3)
    expect(fuseMeasures(u, u).status).toBe('UNRESOLVED')
  })
})

describe('§29 a tolerance comes from the drawing, not from a constant', () => {
  it('gives a section a finer tolerance than a plan at the same localisation', () => {
    const plan = sourceTolerance(37.8, 2, 0, 'a plan edge')
    const section = sourceTolerance(72.5, 2, 0, 'a section edge')
    expect(section.toleranceM).toBeLessThan(plan.toleranceM)
    expect(section.metresPerPixel).toBeCloseTo(1 / 72.5, 6)
  })

  it('adds the registration residual on top of the raster resolution', () => {
    const clean = sourceTolerance(58.5, 2, 0, 'an elevation edge')
    const registered = sourceTolerance(58.5, 2, 0.08, 'an elevation edge')
    expect(registered.toleranceM).toBeGreaterThan(clean.toleranceM)
    expect(registered.why).toMatch(/registration contributes/)
  })

  it('keeps a printed value numerically distinct from a measured one', () => {
    const printed = printedTolerance('a level')
    expect(printed.metresPerPixel).toBe(0)
    expect(printed.localisationPx).toBe(0)
    expect(printed.toleranceM).toBeLessThan(sourceTolerance(72.5, 1, 0, 'x').toleranceM)
  })
})

describe('§18 the top of a building is not the tallest pixel', () => {
  const facade = (apexY: number, chimney: boolean) => {
    const m = makeMask(600, 500)
    const x0 = 100
    const x1 = 500
    const apexX = 300
    const slope = (200 - apexY) / 200
    for (let x = x0; x <= x1; x++) {
      const top = Math.round(apexY + Math.abs(x - apexX) * slope)
      for (let y = top; y <= 450; y++) m.data[y * 600 + x] = 1
    }
    if (chimney) for (let y = apexY - 40; y <= 300; y++) for (let x = 360; x <= 390; x++) m.data[y * 600 + x] = 1
    return m
  }

  it('takes the crossing of the fitted slopes, not the chimney standing on them', () => {
    const clean = buildFacadeSilhouette('a', 'FRONT', facade(60, false), { minX: 100, maxX: 500, topRow: 60, groundRow: 450 })
    const withStack = buildFacadeSilhouette('a', 'FRONT', facade(60, true), { minX: 100, maxX: 500, topRow: 20, groundRow: 450 })
    expect(clean.roofTopFrom).toBe('GABLE_APEX')
    expect(withStack.roofTopFrom).toBe('GABLE_APEX')
    expect(withStack.roofTopRow).toBeCloseTo(clean.roofTopRow, 0)
    // The raw silhouette top moved by forty pixels and the building did not.
    expect(withStack.roofTopRow).toBeLessThan(80)
    expect(withStack.roofTopRow).toBeGreaterThan(50)
  })

  it('reads a ridge seen along its length as a level top', () => {
    const m = makeMask(600, 500)
    for (let x = 100; x <= 500; x++) for (let y = 80; y <= 450; y++) m.data[y * 600 + x] = 1
    const s = buildFacadeSilhouette('a', 'RIGHT', m, { minX: 100, maxX: 500, topRow: 80, groundRow: 450 })
    expect(s.roofTopFrom).toBe('RIDGE_PLATEAU')
    expect(classifySkyline(s.lines, s.apex, s.widthPx, 'RIGHT').kind).toBe('LEVEL_TOP')
  })
})

describe('§17 registration is two anchors, and it says which', () => {
  it('registers from the section’s ridge and terrain', () => {
    const m = makeMask(600, 500)
    for (let x = 100; x <= 500; x++) for (let y = 100; y <= 450; y++) m.data[y * 600 + x] = 1
    const s = buildFacadeSilhouette('a', 'RIGHT', m, { minX: 100, maxX: 500, topRow: 100, groundRow: 450 })
    const r = registerVertically(s, { ridgeM: 7.0, terrainM: -0.3 })!
    expect(r.pixelsPerMetreY).toBeCloseTo(350 / 7.3, 3)
    // Zero is where the ground datum is, not where the silhouette stops.
    expect(r.rowAtZero).toBeCloseTo(450 - 0.3 * (350 / 7.3), 3)
    expect(r.anchors).toHaveLength(2)
    expect(r.anchors[0].levelM).toBe(7.0)
  })

  it('refuses to register when the section settled no span', () => {
    const m = makeMask(600, 500)
    for (let x = 100; x <= 500; x++) m.data[450 * 600 + x] = 1
    const s = buildFacadeSilhouette('a', 'RIGHT', m, { minX: 100, maxX: 500, topRow: 450, groundRow: 450 })
    expect(registerVertically(s, { ridgeM: 7, terrainM: -0.3 })).toBeNull()
  })
})

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

describe('§20 host matching, and what it refuses to do', () => {
  const plan = storey([
    wall('front', 'X', 0, 10, 12, 12.4, [[1, 2], [4, 5.5], [7, 8]]),
    wall('rear', 'X', 0, 10, 0, 0.4, [[2, 3], [6, 7]]),
    wall('left', 'Z', 0, 12.4, 0, 0.4, [[3, 4]]),
    wall('right', 'Z', 0, 12.4, 9.6, 10, [[8, 9]]),
  ])
  const extents = { x: { fromM: 0, toM: 10 }, z: { fromM: 0, toM: 12.4 } }

  it('reads a facade’s openings off the wall faces, not off centre lines', () => {
    const facades = planFacades([plan], extents)
    const front = facades.find((f) => f.side === 'MAX_Z')!
    expect(front.openings.map((o) => o.centreM)).toEqual([1.5, 4.75, 7.5])
    expect(front.hosts.every((h) => h.wallId === 'front')).toBe(true)
    expect(front.alongAxis).toBe('X')
  })

  it('solves one offset for the facade rather than a nearest neighbour per opening', () => {
    const facades = planFacades([plan], extents)
    const front = facades.find((f) => f.side === 'MAX_Z')!
    // The elevation's own coordinates are centred on the facade; the offset is
    // what the solve recovers.
    const elevation = front.openings.map((o, i) => ({ ...o, id: `e${i}`, centreM: o.centreM - 5 }))
    const solved = scoreAgainstFacade('a', elevation, front, 0.3)
    expect(solved.length).toBeGreaterThan(0)
    expect(solved[0].matches).toHaveLength(3)
    expect(Math.abs(solved[0].offsetM - 5)).toBeLessThan(0.1)
  })

  it('leaves an opening unmatched rather than stretching the facade to fit it', () => {
    const facades = planFacades([plan], extents)
    const front = facades.find((f) => f.side === 'MAX_Z')!
    const elevation = [
      ...front.openings.map((o, i) => ({ ...o, id: `e${i}`, centreM: o.centreM - 5 })),
      { id: 'ghost', fromM: 0, toM: 1, centreM: -4.6, widthM: 1 },
    ]
    const solved = solveAlongFacade(elevation, front.openings, { toleranceM: 0.3, minMatches: 3 })!
    expect(solved.matches).toHaveLength(3)
    expect(solved.matches.map((m) => m.elevationId)).not.toContain('ghost')
  })

  it('will not put two elevations on one facade', () => {
    const facades = planFacades([plan], extents)
    const front = facades.find((f) => f.side === 'MAX_Z')!
    const same = front.openings.map((o, i) => ({ ...o, id: `e${i}`, centreM: o.centreM - 5 }))
    const assignment = assignFacades(
      [
        { assetId: 'a', declaredView: 'FRONT', openings: same, admissible: null },
        { assetId: 'b', declaredView: 'REAR', openings: same, admissible: null },
      ],
      facades,
      0.3,
    )
    const sides = assignment.assignments.map((x) => x.side)
    expect(new Set(sides).size).toBe(2)
  })

  it('honours an admissible set, so the roof can rule a facade out', () => {
    const facades = planFacades([plan], extents)
    const front = facades.find((f) => f.side === 'MAX_Z')!
    const openings = front.openings.map((o, i) => ({ ...o, id: `e${i}`, centreM: o.centreM - 5 }))
    const assignment = assignFacades(
      [{ assetId: 'a', declaredView: 'FRONT', openings, admissible: ['MIN_X', 'MAX_X'] }],
      facades,
      0.3,
    )
    expect(['MIN_X', 'MAX_X']).toContain(assignment.assignments[0].side)
  })
})

describe('§15 topology is read off the drawings', () => {
  const sectionOf = (flat: boolean) => {
    const g = { width: 1000, height: 600, data: new Uint8ClampedArray(1000 * 600).fill(255) }
    const box = (x0: number, y0: number, x1: number, y1: number): void => {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) g.data[y * 1000 + x] = 20
    }
    const t = Math.tan((35 * Math.PI) / 180)
    for (let x = 100; x <= 600; x++) {
      const top = Math.round(80 + Math.abs(x - 350) * t)
      box(x, top, x, top + 12)
    }
    if (flat) box(700, 400, 980, 412)
    return analyseSectionRoof(g, 158, 600)
  }

  it('calls a ridge running end to end a gable, and one that stops short a hip', () => {
    const section = sectionOf(false)
    const gable = classifyRoofTopology(section, [{ view: 'RIGHT', kind: 'LEVEL_TOP', levelSpanFraction: 0.95, pitches: [] }], [], [])
    expect(gable.overall).toBe('GABLE')
    const hip = classifyRoofTopology(section, [{ view: 'RIGHT', kind: 'LEVEL_TOP', levelSpanFraction: 0.5, pitches: [] }], [], [])
    expect(hip.overall).toBe('HIP')
  })

  it('refuses to decide when the ridge span is between the two', () => {
    const between = classifyRoofTopology(sectionOf(false), [{ view: 'RIGHT', kind: 'LEVEL_TOP', levelSpanFraction: 0.75, pitches: [] }], [], [])
    expect(between.overall).toBe('UNKNOWN')
    expect(between.status).toBe('UNRESOLVED')
  })

  it('reports a gable beside a flat roof as COMPOSITE, carrying both', () => {
    const composite = classifyRoofTopology(sectionOf(true), [{ view: 'RIGHT', kind: 'LEVEL_TOP', levelSpanFraction: 0.95, pitches: [] }], [], [])
    expect(composite.overall).toBe('COMPOSITE')
    expect(composite.components.map((c) => c.topology).sort()).toEqual(['FLAT', 'GABLE'])
  })

  it('says nothing about a roof it has no section for', () => {
    const nothing = classifyRoofTopology(null, [], [], [])
    expect(nothing.overall).toBe('UNKNOWN')
    expect(nothing.components).toEqual([])
  })
})

describe('§14 pitch fusion reports the route', () => {
  it('calls a printed pitch SOURCE_EXACT and a fitted one derived', () => {
    const printed = fusePitch([
      { id: 'p', kind: 'PRINTED_CALLOUT', pitchDeg: 40, confidence: 0.9, toleranceDeg: 0.05, evidence: [], why: '' },
    ])
    expect(printed.fidelity).toBe('SOURCE_EXACT')
    const fitted = fusePitch([
      { id: 'f', kind: 'SECTION_EDGE_FIT', pitchDeg: 39.9, confidence: 0.9, toleranceDeg: 0.2, evidence: [], why: '' },
    ])
    expect(fitted.fidelity).toBe('SOURCE_DERIVED')
    const render = fusePitch([
      { id: 'e', kind: 'ELEVATION_SKYLINE_FIT', pitchDeg: 39.5, confidence: 0.7, toleranceDeg: 0.6, evidence: [], why: '' },
    ])
    expect(render.fidelity).toBe('RENDER_DERIVED')
  })

  it('says UNRESOLVED when no source states or shows one', () => {
    const none = fusePitch([])
    expect(none.status).toBe('UNRESOLVED')
    expect(Number.isFinite(none.pitchDeg)).toBe(false)
  })
})
