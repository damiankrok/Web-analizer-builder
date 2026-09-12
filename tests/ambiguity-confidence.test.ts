import { describe, expect, it } from 'vitest'
import { detectAmbiguity } from '../src/core/camera/ambiguity.js'
import { classifyCamera, viewWeightFor, mayRefineGeometry, maySelectHypothesis } from '../src/core/camera/confidence.js'
import type { PoseCandidate } from '../src/core/camera/pose.js'
import { deg2rad } from '../src/core/math/vec.js'

const candidate = (cost: number, fovDeg: number, distance: number, azimuthDeg: number): PoseCandidate => ({
  cost,
  iou: 1 - cost * 4,
  params: {
    azimuth: deg2rad(azimuthDeg),
    elevation: deg2rad(5),
    distance,
    fovY: deg2rad(fovDeg),
    shiftX: 0,
    shiftY: 0,
    targetDy: 0,
  },
  descriptor: { centroidU: 0, centroidV: 0, radii: new Float64Array(4), area: 100, empty: false },
})

describe('FOV-distance ambiguity', () => {
  it('flags the degeneracy when poses agree on bearing but trade FOV against distance', () => {
    const report = detectAmbiguity([
      candidate(0.04, 22, 32, 350),
      candidate(0.041, 38, 18, 351),
      candidate(0.042, 30, 24, 349),
    ], 'asset')
    expect(report.ambiguous).toBe(true)
    expect(report.fovDistanceDegenerate).toBe(true)
    expect(report.fovSpreadDeg).toBeGreaterThan(6)
    expect(report.notes.join(' ')).toContain('trade off')
  })

  it('does not flag a single well-separated solution', () => {
    const report = detectAmbiguity([candidate(0.02, 30, 24, 350), candidate(0.4, 30, 24, 120)], 'asset')
    expect(report.ambiguous).toBe(false)
    expect(report.fovDistanceDegenerate).toBe(false)
  })

  it('reports an unresolved bearing separately from the FOV degeneracy', () => {
    const report = detectAmbiguity([candidate(0.04, 30, 24, 10), candidate(0.041, 30, 24, 190)], 'asset')
    expect(report.ambiguous).toBe(true)
    expect(report.fovDistanceDegenerate).toBe(false)
    expect(report.azimuthSpreadDeg).toBeGreaterThan(100)
    expect(report.notes.join(' ')).toContain('bearing is not resolved')
  })

  it('handles azimuth wrap-around when measuring spread', () => {
    const report = detectAmbiguity([candidate(0.04, 30, 24, 355), candidate(0.041, 30, 24, 5)], 'asset')
    expect(report.azimuthSpreadDeg).toBeLessThan(20)
  })
})

describe('camera confidence classes', () => {
  const unambiguous = detectAmbiguity([candidate(0.02, 30, 24, 350)], 'asset')
  const degenerate = detectAmbiguity([candidate(0.04, 22, 32, 350), candidate(0.041, 38, 18, 351)], 'asset')

  it('grades a tight, well-anchored, unambiguous fit as confident', () => {
    const v = classifyCamera({
      cost: 0.02,
      iou: 0.88,
      anchorMatches: 9,
      meanAnchorResidualPx: 6,
      ambiguity: unambiguous,
      hasVanishingConstraint: true,
    })
    expect(v.klass).toBe('CAMERA_CONFIDENT')
    expect(mayRefineGeometry(v.klass)).toBe(true)
  })

  it('will not call a camera confident while FOV and distance are degenerate', () => {
    const v = classifyCamera({
      cost: 0.02,
      iou: 0.88,
      anchorMatches: 9,
      meanAnchorResidualPx: 6,
      ambiguity: degenerate,
      hasVanishingConstraint: true,
    })
    expect(v.klass).toBe('CAMERA_USABLE')
    expect(mayRefineGeometry(v.klass)).toBe(false)
    expect(maySelectHypothesis(v.klass)).toBe(true)
  })

  it('demotes a good-looking fit with thin anchor support to usable', () => {
    const v = classifyCamera({
      cost: 0.03,
      iou: 0.85,
      anchorMatches: 2,
      meanAnchorResidualPx: 30,
      ambiguity: unambiguous,
      hasVanishingConstraint: false,
    })
    expect(v.klass).toBe('CAMERA_USABLE')
    expect(v.reasons.join(' ')).toContain('near-frontal')
  })

  it('grades a poor fit as weak and an unusable one as unresolved', () => {
    expect(
      classifyCamera({
        cost: 0.08,
        iou: 0.5,
        anchorMatches: 1,
        meanAnchorResidualPx: 40,
        ambiguity: unambiguous,
        hasVanishingConstraint: false,
      }).klass,
    ).toBe('CAMERA_WEAK')
    expect(
      classifyCamera({
        cost: 0.4,
        iou: 0.1,
        anchorMatches: 0,
        meanAnchorResidualPx: null,
        ambiguity: unambiguous,
        hasVanishingConstraint: false,
      }).klass,
    ).toBe('CAMERA_UNRESOLVED')
  })

  it('gives an unresolved camera no influence at all', () => {
    expect(viewWeightFor('CAMERA_UNRESOLVED')).toBe(0)
    expect(viewWeightFor('CAMERA_WEAK')).toBeGreaterThan(0)
    expect(viewWeightFor('CAMERA_CONFIDENT')).toBe(1)
    expect(mayRefineGeometry('CAMERA_WEAK')).toBe(false)
    expect(maySelectHypothesis('CAMERA_WEAK')).toBe(false)
  })
})
