/**
 * Multi-view objective (§26).
 *
 *   score(building) = metric + plan + section + elevation + aggregated views
 *
 * One geometry, many cameras. The aggregate is deliberately *not* a plain mean
 * over views: each view enters weighted by its camera's confidence class (§25),
 * so a view whose camera is unresolved contributes nothing and cannot move
 * geometry by being consistently wrong, and a repair has to improve overall
 * source consistency rather than one selected screenshot (§26).
 *
 * Hard metric constraints are checked separately and gate acceptance entirely
 * (§38) rather than being traded off against pixel terms — that is what stops
 * visual repair from corrupting exact dimensions (§51).
 *
 * PORT_DIRECT (Kotlin).
 */
import type { ConstraintCheck, BuildingHypothesis } from '../contracts/hypotheses.js'
import type { ElevationScoreBreakdown, MultiViewScore, ViewScoreBreakdown } from '../contracts/scoring.js'
import { boundsOf, polygonArea } from '../contracts/geometry.js'

export type MultiViewWeights = {
  metric: number
  plan: number
  section: number
  elevation: number
  perspective: number
}

export const DEFAULT_MULTIVIEW_WEIGHTS: MultiViewWeights = {
  metric: 0.3,
  plan: 0.1,
  section: 0.12,
  elevation: 0.33,
  perspective: 0.15,
}

/**
 * Check the hypothesis against its own hard constraints. These come from
 * published exact figures, so a violation is not a worse score — it disqualifies
 * the hypothesis (§38).
 */
export function checkConstraints(h: BuildingHypothesis): ConstraintCheck[] {
  const out: ConstraintCheck[] = []
  for (const c of h.constraints) {
    let actual: number | null = null
    switch (c.key) {
      case 'footprint_area':
        actual = h.masses.reduce((sum, m) => sum + Math.abs(polygonArea(m.footprint.outer)), 0)
        break
      case 'building_height': {
        const ridge = Math.max(...h.roofs.map((r) => r.ridgeY), 0)
        const plinth = 0
        actual = ridge - plinth
        break
      }
      case 'roof_pitch': {
        const main = h.roofs.find((r) => r.kind !== 'FLAT')
        actual = main ? main.pitchDeg : 0
        break
      }
      case 'garage_area': {
        const garage = h.masses.find((m) => m.kind === 'GARAGE')
        actual = garage ? Math.abs(polygonArea(garage.footprint.outer)) : 0
        break
      }
      default:
        actual = null
    }
    if (actual === null) continue
    const deviation = actual - c.target
    out.push({
      constraintId: c.id,
      key: c.key,
      target: c.target,
      actual,
      deviation,
      toleranceAbs: c.toleranceAbs,
      satisfied: Math.abs(deviation) <= c.toleranceAbs,
    })
  }
  return out
}

export type MultiViewInput = {
  hypothesis: BuildingHypothesis
  /** Residual of the published scalar facts the geometry must reproduce. */
  metricResidual: number
  planResidual: number
  sectionResidual: number
  elevationScores: ElevationScoreBreakdown[]
  viewScores: ViewScoreBreakdown[]
  weights?: MultiViewWeights
}

/**
 * Confidence-weighted aggregate of the perspective views. With no usable
 * camera the perspective term is neutral rather than zero: a view that could
 * not be solved is missing evidence, not evidence of a good fit.
 */
export function aggregateViews(views: readonly ViewScoreBreakdown[]): { value: number; totalWeight: number } {
  let sum = 0
  let weight = 0
  for (const v of views) {
    if (v.viewWeight <= 0) continue
    sum += v.total * v.viewWeight
    weight += v.viewWeight
  }
  if (weight === 0) return { value: 0.5, totalWeight: 0 }
  return { value: sum / weight, totalWeight: weight }
}

export function scoreMultiView(input: MultiViewInput): MultiViewScore {
  const weights = input.weights ?? DEFAULT_MULTIVIEW_WEIGHTS
  const constraintChecks = checkConstraints(input.hypothesis)
  const hardConstraintsSatisfied = constraintChecks.every((c) => c.satisfied)

  const elevation =
    input.elevationScores.length === 0
      ? 0.5
      : input.elevationScores.reduce((s, e) => s + e.total, 0) / input.elevationScores.length
  const perspective = aggregateViews(input.viewScores).value

  const total =
    weights.metric * input.metricResidual +
    weights.plan * input.planResidual +
    weights.section * input.sectionResidual +
    weights.elevation * elevation +
    weights.perspective * perspective

  return {
    hypothesisId: input.hypothesis.id,
    metric: input.metricResidual,
    plan: input.planResidual,
    section: input.sectionResidual,
    elevation,
    perspective,
    total,
    constraintChecks,
    hardConstraintsSatisfied,
    elevationScores: input.elevationScores,
    viewScores: input.viewScores,
  }
}

/** Bounding box of every mass in a hypothesis, used to frame orthographic views. */
export function hypothesisBounds(h: BuildingHypothesis): { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } {
  const ring = h.masses.flatMap((m) => m.footprint.outer)
  const b = ring.length > 0 ? boundsOf(ring) : { minX: 0, maxX: 1, minZ: 0, maxZ: 1 }
  const maxY = Math.max(...h.roofs.map((r) => r.ridgeY), ...h.masses.map((m) => m.topY), 1)
  const minY = Math.min(...h.masses.map((m) => m.baseY), 0)
  return { min: { x: b.minX, y: minY, z: b.minZ }, max: { x: b.maxX, y: maxY, z: b.maxZ } }
}
