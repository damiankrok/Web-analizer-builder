import { describe, expect, it } from 'vitest'
import { scoreMultiView, checkConstraints, aggregateViews } from '../src/core/scoring/multiview.js'
import { runRepairLoop } from '../src/core/repair/engine.js'
import { adjustAnnexHeight, adjustProjectionDepth } from '../src/core/repair/operations.js'
import type { BuildingHypothesis } from '../src/core/contracts/hypotheses.js'
import type { ViewScoreBreakdown, ElevationScoreBreakdown, MultiViewScore } from '../src/core/contracts/scoring.js'
import { rectRing } from '../src/core/contracts/geometry.js'

const hypothesis = (annexTop = 3, mainW = 8, mainD = 12): BuildingHypothesis => ({
  id: 'h',
  producedBy: 'test',
  wallThicknessM: 0.4,
  plinthY: -0.3,
  storeys: [{ id: 's', name: 'GROUND', floorY: 0, ceilingY: 2.7, authority: 'SECTION_MEASURED' }],
  masses: [
    {
      id: 'mass_main',
      kind: 'MAIN_BODY',
      footprint: { outer: rectRing(0, 0, mainW, mainD), holes: [] },
      baseY: 0,
      topY: 4.6,
      storeyIds: ['s'],
      authority: 'PLAN_MEASURED',
      confidence: 0.8,
      evidenceIds: [],
    },
    {
      id: 'mass_annex',
      kind: 'GARAGE',
      footprint: { outer: rectRing(mainW, 4, mainW + 4, 12), holes: [] },
      baseY: 0,
      topY: annexTop,
      storeyIds: ['s'],
      authority: 'PLAN_MEASURED',
      confidence: 0.7,
      evidenceIds: [],
    },
  ],
  roofs: [
    {
      id: 'roof_main',
      massId: 'mass_main',
      kind: 'GABLE',
      pitchDeg: 40,
      eaveY: 4.6,
      ridgeY: 7.9,
      ridgeDir: { x: 0, z: 1 },
      overhangM: 0.4,
      authority: 'SECTION_MEASURED',
      confidence: 0.85,
    },
    {
      id: 'roof_annex',
      massId: 'mass_annex',
      kind: 'FLAT',
      pitchDeg: 0,
      eaveY: annexTop,
      ridgeY: annexTop,
      overhangM: 0.15,
      authority: 'PLAN_MEASURED',
      confidence: 0.6,
    },
  ],
  openings: [],
  notes: [],
  openingGroups: [],
  appearance: [],
  constraints: [
    {
      id: 'c_area',
      key: 'footprint_area',
      description: 'published footprint area',
      target: 128,
      toleranceAbs: 1.3,
      unit: 'm2',
      authority: 'PUBLISHED_EXACT',
    },
    {
      id: 'c_h',
      key: 'building_height',
      description: 'published height',
      target: 7.9,
      toleranceAbs: 0.2,
      unit: 'm',
      authority: 'PUBLISHED_EXACT',
    },
  ],
})

const view = (total: number, weight: number, assetId = 'v'): ViewScoreBreakdown => ({
  assetId,
  cameraId: 'c',
  silhouette: total,
  edge: total,
  roofline: total,
  massCorner: total,
  openingLayout: total,
  semanticPresence: total,
  visibility: total,
  total,
  viewWeight: weight,
  missingVisibleFeatures: [],
  notes: [],
})

const elevation = (total: number, facade = 'FRONT'): ElevationScoreBreakdown => ({
  assetId: `e_${facade}`,
  facade,
  silhouette: total,
  roofline: total,
  openingPosition: total,
  openingSize: total,
  bandLevels: total,
  featurePosition: total,
  total,
  notes: [],
})

describe('hard metric constraints', () => {
  it('flags a hypothesis whose footprint area drifts off the published figure', () => {
    const checks = checkConstraints(hypothesis(3, 20, 12))
    const area = checks.find((c) => c.key === 'footprint_area')
    expect(area?.satisfied).toBe(false)
  })

  it('accepts a hypothesis that reproduces the published figures', () => {
    const checks = checkConstraints(hypothesis())
    expect(checks.find((c) => c.key === 'footprint_area')?.satisfied).toBe(true)
    expect(checks.find((c) => c.key === 'building_height')?.satisfied).toBe(true)
  })
})

describe('view aggregation by camera confidence', () => {
  it('ignores views whose camera is unresolved', () => {
    const agg = aggregateViews([view(0.1, 1, 'a'), view(0.9, 0, 'b')])
    expect(agg.value).toBeCloseTo(0.1, 9)
    expect(agg.totalWeight).toBe(1)
  })

  it('weights a confident view above a usable one', () => {
    const agg = aggregateViews([view(0.2, 1, 'a'), view(0.6, 0.55, 'b')])
    expect(agg.value).toBeGreaterThan(0.2)
    expect(agg.value).toBeLessThan(0.4)
  })

  it('stays neutral rather than perfect when no camera is usable', () => {
    expect(aggregateViews([view(0.1, 0, 'a')]).value).toBe(0.5)
  })
})

describe('authority: an exact published dimension beats a render fit', () => {
  const evaluate = (h: BuildingHypothesis): { score: MultiViewScore; camerasRefitted: boolean } => {
    const checks = checkConstraints(h)
    // A repair that breaks the footprint also makes every render fit perfectly,
    // which is precisely the trade the authority ladder must refuse.
    const breaksArea = checks.some((c) => !c.satisfied)
    return {
      score: scoreMultiView({
        hypothesis: h,
        metricResidual: breaksArea ? 0 : 0.2,
        planResidual: 0.1,
        sectionResidual: 0.1,
        elevationScores: [elevation(breaksArea ? 0.05 : 0.4)],
        viewScores: [view(breaksArea ? 0.01 : 0.5, 1)],
      }),
      camerasRefitted: true,
    }
  }

  it('refuses a repair that violates a published dimension even when every view improves', () => {
    const start = hypothesis()
    const startScore = evaluate(start).score
    const result = runRepairLoop(
      start,
      startScore,
      evaluate,
      () => [adjustProjectionDepth('mass_annex', 30, 'X')],
      { tolerance: 0.001, elevationRegressionLimit: 0.01, maxCycles: 1, maxProposalsPerCycle: 4 },
    )
    expect(result.accepted).toBe(0)
    expect(result.trace[0].accepted).toBe(false)
    expect(result.trace[0].reason).toContain('hard metric constraints violated')
    expect(result.hypothesis.id).toBe(start.id)
  })

  it('refuses a repair that trades authoritative elevation agreement for render agreement', () => {
    const start = hypothesis()
    const startScore = scoreMultiView({
      hypothesis: start,
      metricResidual: 0.1,
      planResidual: 0.1,
      sectionResidual: 0.1,
      elevationScores: [elevation(0.2)],
      viewScores: [view(0.5, 1)],
    })
    const result = runRepairLoop(
      start,
      startScore,
      (h) => ({
        score: scoreMultiView({
          hypothesis: h,
          metricResidual: 0.1,
          planResidual: 0.1,
          sectionResidual: 0.1,
          // Elevations get materially worse, renders get much better, and the
          // weighted total improves. It must still be refused (§36, §38).
          elevationScores: [elevation(0.35)],
          viewScores: [view(0.01, 1)],
        }),
        camerasRefitted: true,
      }),
      () => [adjustAnnexHeight('mass_annex', 0.3)],
      { tolerance: 0.0001, elevationRegressionLimit: 0.004, maxCycles: 1, maxProposalsPerCycle: 4 },
    )
    expect(result.accepted).toBe(0)
    expect(result.trace[0].reason).toContain('elevation term worsened')
  })

  it('refuses to accept a repair evaluated against stale cameras', () => {
    const start = hypothesis()
    const startScore = evaluate(start).score
    const result = runRepairLoop(
      start,
      startScore,
      (h) => ({
        score: scoreMultiView({
          hypothesis: h,
          metricResidual: 0,
          planResidual: 0,
          sectionResidual: 0,
          elevationScores: [elevation(0.01)],
          viewScores: [view(0.01, 1)],
        }),
        camerasRefitted: false,
      }),
      () => [adjustAnnexHeight('mass_annex', 0.2)],
      { tolerance: 0.001, elevationRegressionLimit: 0.05, maxCycles: 1, maxProposalsPerCycle: 4 },
    )
    expect(result.accepted).toBe(0)
    expect(result.trace[0].reason).toContain('stale cameras')
  })

  it('accepts a repair that improves the whole objective with constraints intact', () => {
    const start = hypothesis(2.2)
    const startScore = scoreMultiView({
      hypothesis: start,
      metricResidual: 0.1,
      planResidual: 0.1,
      sectionResidual: 0.1,
      elevationScores: [elevation(0.4)],
      viewScores: [view(0.6, 1)],
    })
    const result = runRepairLoop(
      start,
      startScore,
      (h) => {
        const annex = h.masses.find((m) => m.id === 'mass_annex')
        // The closer the annex top gets to 3 m, the better everything fits.
        const err = Math.abs((annex?.topY ?? 0) - 3)
        return {
          score: scoreMultiView({
            hypothesis: h,
            metricResidual: 0.1,
            planResidual: 0.1,
            sectionResidual: 0.1,
            elevationScores: [elevation(0.2 + err * 0.2)],
            viewScores: [view(0.2 + err * 0.5, 1)],
          }),
          camerasRefitted: true,
        }
      },
      () => [adjustAnnexHeight('mass_annex', 0.4), adjustAnnexHeight('mass_annex', -0.4)],
      { tolerance: 0.001, elevationRegressionLimit: 0.01, maxCycles: 2, maxProposalsPerCycle: 4 },
    )
    expect(result.accepted).toBeGreaterThan(0)
    const annex = result.hypothesis.masses.find((m) => m.id === 'mass_annex')
    expect(annex?.topY).toBeGreaterThan(2.2)
    expect(result.trace.some((t) => t.accepted && t.camerasRefitted)).toBe(true)
  })
})
