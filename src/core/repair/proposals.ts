/**
 * Proposal generation.
 *
 * Proposals target the parameters the sources leave *free* — annex height, roof
 * overhang, projection depth on an undimensioned axis — because those are the
 * ones a view is entitled to inform (§33). A published dimension is never a
 * proposal target; the acceptance test would refuse it anyway, but generating
 * such proposals at all would waste the cycle budget and invite exactly the
 * corruption §51 warns about.
 *
 * PORT_DIRECT (Kotlin).
 */
import type { BuildingHypothesis } from '../contracts/hypotheses.js'
import type { MultiViewScore } from '../contracts/scoring.js'
import type { RepairProposal } from './operations.js'
import { adjustAnnexHeight, adjustProjectionDepth, adjustRoofOverhang, reassignRoofSystem, splitMass } from './operations.js'

export type ProposalOptions = {
  annexHeightSteps: readonly number[]
  overhangSteps: readonly number[]
  depthSteps: readonly number[]
  /** Cycles after which structural proposals (splits) are considered. */
  structuralAfterCycle: number
}

export const DEFAULT_PROPOSALS: ProposalOptions = {
  annexHeightSteps: [-0.4, -0.2, 0.2, 0.4],
  overhangSteps: [-0.2, 0.2, 0.4],
  depthSteps: [-0.5, 0.5],
  structuralAfterCycle: 2,
}

export function generateProposals(
  h: BuildingHypothesis,
  score: MultiViewScore,
  cycle: number,
  opts: ProposalOptions = DEFAULT_PROPOSALS,
): RepairProposal[] {
  const out: RepairProposal[] = []

  // The annex top is the least-constrained dimension in the model, so it is
  // tried first and at every cycle.
  for (const mass of h.masses) {
    if (mass.kind === 'MAIN_BODY') continue
    for (const d of opts.annexHeightSteps) out.push(adjustAnnexHeight(mass.id, d))
  }

  for (const roof of h.roofs) {
    for (const d of opts.overhangSteps) out.push(adjustRoofOverhang(roof.id, d))
  }

  // Only worth proposing when at least one view is actually contributing.
  const anyUsableView = score.viewScores.some((v) => v.viewWeight > 0)
  if (anyUsableView && cycle >= opts.structuralAfterCycle) {
    for (const mass of h.masses) {
      if (mass.kind === 'MAIN_BODY') continue
      for (const d of opts.depthSteps) out.push(adjustProjectionDepth(mass.id, d, 'Z'))
    }
    const flatAnnexRoof = h.roofs.find((r) => r.kind === 'FLAT')
    if (flatAnnexRoof) out.push(reassignRoofSystem(flatAnnexRoof.id, 'MONO_PITCH', 8))
    const main = h.masses.find((m) => m.kind === 'MAIN_BODY')
    if (main && h.masses.length < 4) out.push(splitMass(main.id, 'Z', 0.5, -0.6))
  }

  return out
}
