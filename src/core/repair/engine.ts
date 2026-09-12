/**
 * Self-repair engine (§27, §28, §37, §38).
 *
 * The central discipline: an accepted geometry change invalidates the cameras
 * that were fitted to the old geometry, so every proposal is judged by
 * re-fitting the affected cameras and re-scoring all views (§27). Comparing a
 * repaired building against stale cameras is the mistake that makes a visual
 * refinement loop drift — the old camera silently absorbs the change and the
 * score improves for the wrong reason.
 *
 * Acceptance requires all of (§38):
 *   - hard metric constraints still satisfied,
 *   - no higher-authority evidence materially worse,
 *   - affected cameras re-fitted,
 *   - the multi-view score improved beyond a tolerance.
 *
 * Every proposal is logged whether accepted or rejected.
 *
 * PORT_DIRECT (Kotlin).
 */
import type { BuildingHypothesis } from '../contracts/hypotheses.js'
import type { MultiViewScore } from '../contracts/scoring.js'
import type { RepairProposal } from './operations.js'

export type RepairTraceEntry = {
  cycle: number
  proposalId: string
  kind: string
  description: string
  motivation: string
  accepted: boolean
  reason: string
  scoreBefore: number
  scoreAfter: number
  improvement: number
  /** Whether the cameras were re-fitted for this evaluation (§27). */
  camerasRefitted: boolean
  constraintViolations: string[]
  elevationBefore: number
  elevationAfter: number
}

export type RepairOptions = {
  /** Minimum improvement in the multi-view score to accept (§38). */
  tolerance: number
  /** How much the authoritative elevation term may worsen, at most. */
  elevationRegressionLimit: number
  maxCycles: number
  maxProposalsPerCycle: number
}

export const DEFAULT_REPAIR: RepairOptions = {
  tolerance: 0.002,
  elevationRegressionLimit: 0.004,
  maxCycles: 4,
  maxProposalsPerCycle: 12,
}

/**
 * Evaluate a hypothesis end to end. The implementation must re-fit the cameras
 * for the candidate geometry — that is the contract this engine depends on.
 */
export type Evaluator = (h: BuildingHypothesis) => { score: MultiViewScore; camerasRefitted: boolean }

/** Generate the proposals worth trying for the current hypothesis and scores. */
export type ProposalGenerator = (h: BuildingHypothesis, score: MultiViewScore, cycle: number) => RepairProposal[]

export type RepairResult = {
  hypothesis: BuildingHypothesis
  score: MultiViewScore
  trace: RepairTraceEntry[]
  cycles: number
  accepted: number
  rejected: number
}

export function runRepairLoop(
  initial: BuildingHypothesis,
  initialScore: MultiViewScore,
  evaluate: Evaluator,
  generate: ProposalGenerator,
  opts: RepairOptions = DEFAULT_REPAIR,
): RepairResult {
  let current = initial
  let currentScore = initialScore
  const trace: RepairTraceEntry[] = []
  let accepted = 0
  let rejected = 0
  let cycles = 0

  for (let cycle = 1; cycle <= opts.maxCycles; cycle++) {
    cycles = cycle
    const proposals = generate(current, currentScore, cycle).slice(0, opts.maxProposalsPerCycle)
    if (proposals.length === 0) break
    let improvedThisCycle = false

    for (const proposal of proposals) {
      const candidate = proposal.apply(current)
      const { score, camerasRefitted } = evaluate(candidate)

      const violations = score.constraintChecks
        .filter((c) => !c.satisfied)
        .map((c) => `${c.key}: ${c.actual.toFixed(2)} vs ${c.target.toFixed(2)} ±${c.toleranceAbs.toFixed(2)}`)

      const improvement = currentScore.total - score.total
      const elevationRegression = score.elevation - currentScore.elevation

      let acceptedThis = false
      let reason: string
      if (violations.length > 0) {
        reason = `rejected: hard metric constraints violated (${violations.join('; ')})`
      } else if (elevationRegression > opts.elevationRegressionLimit) {
        // §36: the technical elevations outrank the perspective views, so a
        // repair that trades elevation agreement for render agreement is
        // exactly the trade the authority ladder exists to forbid.
        reason =
          `rejected: the authoritative elevation term worsened by ${elevationRegression.toFixed(4)}, ` +
          `beyond the ${opts.elevationRegressionLimit} allowance`
      } else if (improvement <= opts.tolerance) {
        reason = `rejected: multi-view score improved by only ${improvement.toFixed(5)} (tolerance ${opts.tolerance})`
      } else if (!camerasRefitted) {
        reason = 'rejected: cameras were not re-fitted, so the comparison would use stale cameras'
      } else {
        acceptedThis = true
        reason = `accepted: multi-view score improved by ${improvement.toFixed(5)} with cameras re-fitted`
      }

      trace.push({
        cycle,
        proposalId: proposal.id,
        kind: proposal.kind,
        description: proposal.description,
        motivation: proposal.motivation,
        accepted: acceptedThis,
        reason,
        scoreBefore: currentScore.total,
        scoreAfter: score.total,
        improvement,
        camerasRefitted,
        constraintViolations: violations,
        elevationBefore: currentScore.elevation,
        elevationAfter: score.elevation,
      })

      if (acceptedThis) {
        current = candidate
        currentScore = score
        accepted++
        improvedThisCycle = true
      } else {
        rejected++
      }
    }
    if (!improvedThisCycle) break
  }

  return { hypothesis: current, score: currentScore, trace, cycles, accepted, rejected }
}
