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
import {
  adjustAnnexHeight,
  adjustProjectionDepth,
  adjustRecessDepth,
  adjustRoofOverhang,
  reassignRoofSystem,
  splitMass,
} from './operations.js'

export type ProposalOptions = {
  annexHeightSteps: readonly number[]
  overhangSteps: readonly number[]
  depthSteps: readonly number[]
  recessSteps: readonly number[]
  /** Cycles after which structural proposals (splits) are considered. */
  structuralAfterCycle: number
}

export const DEFAULT_PROPOSALS: ProposalOptions = {
  annexHeightSteps: [-0.4, -0.2, 0.2, 0.4],
  overhangSteps: [-0.2, 0.2, 0.4],
  depthSteps: [-0.5, 0.5],
  recessSteps: [-0.5, -0.25, 0.25, 0.5],
  structuralAfterCycle: 2,
}

/** Which facades a set-back storey is pulled back from, by comparing footprints. */
function recessedFacades(h: BuildingHypothesis, upperId: string): Array<'FRONT' | 'REAR' | 'LEFT' | 'RIGHT'> {
  const upper = h.masses.find((m) => m.id === upperId)
  const lower = h.masses.find((m) => `${m.id}_upper` === upperId)
  if (!upper || !lower) return []
  const u = bounds(upper.footprint.outer)
  const l = bounds(lower.footprint.outer)
  const out: Array<'FRONT' | 'REAR' | 'LEFT' | 'RIGHT'> = []
  if (l.maxZ - u.maxZ > 0.2) out.push('FRONT')
  if (u.minZ - l.minZ > 0.2) out.push('REAR')
  if (u.minX - l.minX > 0.2) out.push('LEFT')
  if (l.maxX - u.maxX > 0.2) out.push('RIGHT')
  return out
}

const bounds = (ring: readonly { x: number; z: number }[]) => ({
  minX: Math.min(...ring.map((p) => p.x)),
  maxX: Math.max(...ring.map((p) => p.x)),
  minZ: Math.min(...ring.map((p) => p.z)),
  maxZ: Math.max(...ring.map((p) => p.z)),
})

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

  // Recess depth: the dimension the orthographic sources cannot see and the
  // renders can, so it is proposed whenever a render is actually contributing.
  const anyUsableView = score.viewScores.some((v) => v.viewWeight > 0)
  if (anyUsableView) {
    for (const mass of h.masses) {
      if (!mass.id.endsWith('_upper')) continue
      const facades = recessedFacades(h, mass.id)
      for (const facade of facades) {
        for (const d of opts.recessSteps) out.push(adjustRecessDepth(mass.id, facade, d))
      }
    }
  }

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
