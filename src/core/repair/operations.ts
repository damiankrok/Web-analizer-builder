/**
 * Semantic repair operations (§37).
 *
 * Every operation is a named, structural edit to the hypothesis — split a mass,
 * reclassify a roof, adjust a projection depth that no source constrains, add or
 * expand an opening group. None of them move arbitrary vertices (§37), which is
 * the difference between a model that still explains the plans afterwards and a
 * mesh that has been bent until one screenshot matched.
 *
 * Operations are pure: hypothesis in, new hypothesis out, original untouched.
 *
 * PORT_DIRECT (Kotlin).
 */
import type {
  BuildingHypothesis,
  MassHypothesis,
  OpeningGroupHypothesis,
  RoofHypothesis,
} from '../contracts/hypotheses.js'
import { boundsOf, rectRing, rectUnionArea } from '../contracts/geometry.js'

export type RepairKind =
  | 'SPLIT_MASS'
  | 'MERGE_MASS'
  | 'RECLASSIFY_MASS'
  | 'ADJUST_PROJECTION_DEPTH'
  | 'REASSIGN_ROOF_SYSTEM'
  | 'CHANGE_FACADE_MAPPING'
  | 'ADD_OPENING'
  | 'REMOVE_OPENING'
  | 'EXPAND_OPENING_GROUP'
  | 'SELECT_REPEATED_FAMILY'
  | 'ADD_APPEARANCE_FEATURE'
  | 'CHANGE_ROOM_ASSIGNMENT'
  | 'ADJUST_ANNEX_HEIGHT'
  | 'ADJUST_ROOF_OVERHANG'
  | 'ADJUST_RECESS_DEPTH'

export type RepairProposal = {
  id: string
  kind: RepairKind
  description: string
  /** Which evidence prompted it, for the repair trace. */
  motivation: string
  apply: (h: BuildingHypothesis) => BuildingHypothesis
}

const clone = (h: BuildingHypothesis, producedBy: string): BuildingHypothesis => ({
  ...h,
  id: `${h.id}__${producedBy}`,
  parentId: h.id,
  producedBy,
  storeys: h.storeys.map((x) => ({ ...x })),
  masses: h.masses.map((m) => ({ ...m, footprint: { outer: [...m.footprint.outer], holes: [] } })),
  roofs: h.roofs.map((r) => ({ ...r })),
  openings: h.openings.map((o) => ({ ...o })),
  openingGroups: h.openingGroups.map((g) => ({ ...g })),
  appearance: h.appearance.map((a) => ({ ...a })),
  constraints: h.constraints.map((c) => ({ ...c })),
})

/**
 * Change an annex's height. The annex top is the least-constrained dimension in
 * the whole model — a flat-roofed garage wing has no ridge, the published facts
 * say nothing about it, and the section only pins it when the cut passes
 * through — so it is the natural first thing for a view to inform.
 */
export function adjustAnnexHeight(massId: string, deltaM: number): RepairProposal {
  return {
    id: `rep_annex_h_${massId}_${deltaM.toFixed(2)}`,
    kind: 'ADJUST_ANNEX_HEIGHT',
    description: `move the top of ${massId} by ${deltaM >= 0 ? '+' : ''}${deltaM.toFixed(2)} m`,
    motivation: 'annex height is not fixed by any published figure or by the section cut',
    apply: (h) => {
      const next = clone(h, `annex_h${deltaM >= 0 ? '+' : ''}${deltaM.toFixed(2)}`)
      next.masses = next.masses.map((m) => (m.id === massId ? { ...m, topY: m.topY + deltaM } : m))
      next.roofs = next.roofs.map((r) =>
        r.massId === massId ? { ...r, eaveY: r.eaveY + deltaM, ridgeY: r.ridgeY + deltaM } : r,
      )
      return next
    },
  }
}

/**
 * Change how far a mass projects. Depth along the axis a source does not
 * dimension is exactly what §33 lets a render influence.
 */
export function adjustProjectionDepth(massId: string, deltaM: number, axis: 'X' | 'Z'): RepairProposal {
  return {
    id: `rep_depth_${massId}_${axis}_${deltaM.toFixed(2)}`,
    kind: 'ADJUST_PROJECTION_DEPTH',
    description: `change ${massId} extent along ${axis} by ${deltaM >= 0 ? '+' : ''}${deltaM.toFixed(2)} m`,
    motivation: 'projection depth on this axis is not constrained by a dimensioned source',
    apply: (h) => {
      const next = clone(h, `depth_${axis}${deltaM >= 0 ? '+' : ''}${deltaM.toFixed(2)}`)
      next.masses = next.masses.map((m) => {
        if (m.id !== massId) return m
        const b = boundsOf(m.footprint.outer)
        const ring =
          axis === 'X'
            ? rectRing(b.minX, b.minZ, b.maxX + deltaM, b.maxZ)
            : rectRing(b.minX, b.minZ, b.maxX, b.maxZ + deltaM)
        return { ...m, footprint: { outer: ring, holes: [] } }
      })
      return next
    },
  }
}

/** Change the roof overhang, which no published figure constrains directly. */
export function adjustRoofOverhang(roofId: string, deltaM: number): RepairProposal {
  return {
    id: `rep_overhang_${roofId}_${deltaM.toFixed(2)}`,
    kind: 'ADJUST_ROOF_OVERHANG',
    description: `change ${roofId} overhang by ${deltaM >= 0 ? '+' : ''}${deltaM.toFixed(2)} m`,
    motivation: 'roof overhang is visible in the views but is not a published dimension',
    apply: (h) => {
      const next = clone(h, `overhang${deltaM >= 0 ? '+' : ''}${deltaM.toFixed(2)}`)
      next.roofs = next.roofs.map((r) =>
        r.id === roofId ? { ...r, overhangM: Math.max(0, r.overhangM + deltaM) } : r,
      )
      return next
    },
  }
}

/**
 * Move a set-back storey's facade plane, changing how deep the balcony is.
 *
 * This is the clearest case in the whole model of a dimension the orthographic
 * sources cannot fix and a perspective view can. An elevation sees the recess
 * edge-on and says nothing about its depth; the plan does not draw it, because
 * it is a cut through the storey below. A render sees straight into it. §33
 * lists exactly this — projection and recess depth — among the things a
 * perspective view is entitled to decide.
 */
export function adjustRecessDepth(massId: string, facade: 'FRONT' | 'REAR' | 'LEFT' | 'RIGHT', deltaM: number): RepairProposal {
  return {
    id: `rep_recess_${massId}_${facade}_${deltaM.toFixed(2)}`,
    kind: 'ADJUST_RECESS_DEPTH',
    description: `change the ${facade} set-back of ${massId} by ${deltaM >= 0 ? '+' : ''}${deltaM.toFixed(2)} m`,
    motivation: 'recess depth is invisible to the plan and edge-on in the elevations; the renders see into it',
    apply: (h) => {
      const next = clone(h, `recess_${facade}${deltaM >= 0 ? '+' : ''}${deltaM.toFixed(2)}`)
      next.masses = next.masses.map((m) => {
        if (m.id !== massId) return m
        const b = boundsOf(m.footprint.outer)
        const ring =
          facade === 'FRONT'
            ? rectRing(b.minX, b.minZ, b.maxX, b.maxZ - deltaM)
            : facade === 'REAR'
              ? rectRing(b.minX, b.minZ + deltaM, b.maxX, b.maxZ)
              : facade === 'LEFT'
                ? rectRing(b.minX + deltaM, b.minZ, b.maxX, b.maxZ)
                : rectRing(b.minX, b.minZ, b.maxX - deltaM, b.maxZ)
        return { ...m, footprint: { outer: ring, holes: [] } }
      })
      return next
    },
  }
}

/** Reassign a mass's roof system, e.g. flat to mono-pitch (§31, §37). */
export function reassignRoofSystem(roofId: string, kind: RoofHypothesis['kind'], pitchDeg: number): RepairProposal {
  return {
    id: `rep_roofsys_${roofId}_${kind}`,
    kind: 'REASSIGN_ROOF_SYSTEM',
    description: `reclassify ${roofId} as ${kind} at ${pitchDeg}°`,
    motivation: 'the view suggests a different roof system over this mass',
    apply: (h) => {
      const next = clone(h, `roofsys_${kind}`)
      next.roofs = next.roofs.map((r) => {
        if (r.id !== roofId) return r
        const rise = kind === 'FLAT' ? 0 : Math.tan((pitchDeg * Math.PI) / 180) * 2
        return { ...r, kind, pitchDeg: kind === 'FLAT' ? 0 : pitchDeg, ridgeY: r.eaveY + rise }
      })
      return next
    },
  }
}

/** Reclassify what a mass is, without moving it (§37). */
export function reclassifyMass(massId: string, kind: MassHypothesis['kind']): RepairProposal {
  return {
    id: `rep_reclass_${massId}_${kind}`,
    kind: 'RECLASSIFY_MASS',
    description: `reclassify ${massId} as ${kind}`,
    motivation: 'the mass behaves like a different building element in the views',
    apply: (h) => {
      const next = clone(h, `reclass_${kind}`)
      next.masses = next.masses.map((m) => (m.id === massId ? { ...m, kind } : m))
      return next
    },
  }
}

/**
 * Split a mass along an axis at a fraction of its extent, giving the two parts
 * independent heights. This is how a stepped front mass or a lower side annex
 * gets represented once a view shows the step.
 */
export function splitMass(massId: string, axis: 'X' | 'Z', fraction: number, secondTopDelta: number): RepairProposal {
  return {
    id: `rep_split_${massId}_${axis}_${fraction.toFixed(2)}`,
    kind: 'SPLIT_MASS',
    description: `split ${massId} along ${axis} at ${(fraction * 100).toFixed(0)}%, second part ${secondTopDelta >= 0 ? '+' : ''}${secondTopDelta.toFixed(2)} m`,
    motivation: 'a view shows a step in this mass that a single prism cannot express',
    apply: (h) => {
      const next = clone(h, `split_${axis}`)
      const mass = next.masses.find((m) => m.id === massId)
      if (!mass) return next
      const b = boundsOf(mass.footprint.outer)
      const cut = axis === 'X' ? b.minX + (b.maxX - b.minX) * fraction : b.minZ + (b.maxZ - b.minZ) * fraction
      const first = axis === 'X' ? rectRing(b.minX, b.minZ, cut, b.maxZ) : rectRing(b.minX, b.minZ, b.maxX, cut)
      const second = axis === 'X' ? rectRing(cut, b.minZ, b.maxX, b.maxZ) : rectRing(b.minX, cut, b.maxX, b.maxZ)
      const partner: MassHypothesis = {
        ...mass,
        id: `${mass.id}_b`,
        footprint: { outer: second, holes: [] },
        topY: mass.topY + secondTopDelta,
        confidence: mass.confidence * 0.8,
      }
      next.masses = next.masses.map((m) => (m.id === massId ? { ...m, footprint: { outer: first, holes: [] } } : m))
      next.masses.push(partner)
      const roof = next.roofs.find((r) => r.massId === massId)
      if (roof) {
        next.roofs.push({
          ...roof,
          id: `${roof.id}_b`,
          massId: partner.id,
          eaveY: roof.eaveY + secondTopDelta,
          ridgeY: roof.ridgeY + secondTopDelta,
          confidence: roof.confidence * 0.8,
        })
      }
      return next
    },
  }
}

/** Merge two masses back into their common bounding rectangle (§37). */
export function mergeMasses(aId: string, bId: string): RepairProposal {
  return {
    id: `rep_merge_${aId}_${bId}`,
    kind: 'MERGE_MASS',
    description: `merge ${aId} and ${bId}`,
    motivation: 'the two masses are not distinguishable in any source',
    apply: (h) => {
      const next = clone(h, 'merge')
      const a = next.masses.find((m) => m.id === aId)
      const b = next.masses.find((m) => m.id === bId)
      if (!a || !b) return next
      const ba = boundsOf(a.footprint.outer)
      const bb = boundsOf(b.footprint.outer)
      const ring = rectRing(
        Math.min(ba.minX, bb.minX),
        Math.min(ba.minZ, bb.minZ),
        Math.max(ba.maxX, bb.maxX),
        Math.max(ba.maxZ, bb.maxZ),
      )
      a.footprint = { outer: ring, holes: [] }
      a.topY = Math.max(a.topY, b.topY)
      next.masses = next.masses.filter((m) => m.id !== bId)
      next.roofs = next.roofs.filter((r) => r.massId !== bId)
      return next
    },
  }
}

/** Widen an opening group to swallow a neighbour (§32, §37). */
export function expandOpeningGroup(groupId: string, deltaWidthM: number): RepairProposal {
  return {
    id: `rep_expandop_${groupId}_${deltaWidthM.toFixed(2)}`,
    kind: 'EXPAND_OPENING_GROUP',
    description: `widen opening group ${groupId} by ${deltaWidthM.toFixed(2)} m`,
    motivation: 'a view shows continuous glazing where the elevation resolved separate panels',
    apply: (h) => {
      const next = clone(h, 'expand_op')
      next.openingGroups = next.openingGroups.map((g) =>
        g.id === groupId ? { ...g, widthM: Math.max(0.3, g.widthM + deltaWidthM) } : g,
      )
      return next
    },
  }
}

/** Add an opening group a render shows but no elevation resolved (§33, §37). */
export function addOpeningGroup(group: OpeningGroupHypothesis): RepairProposal {
  return {
    id: `rep_addop_${group.id}`,
    kind: 'ADD_OPENING',
    description: `add opening group on ${group.facade} at s=${group.s.toFixed(2)} m`,
    motivation: 'a render shows an opening the technical elevations did not resolve',
    apply: (h) => {
      const next = clone(h, 'add_op')
      next.openingGroups.push({ ...group, authority: 'RENDER_INFERRED', confidence: Math.min(0.5, group.confidence) })
      return next
    },
  }
}

/** Built area at ground level, counting stacked masses once. */
export const footprintAreaOf = (h: BuildingHypothesis): number =>
  rectUnionArea(
    h.masses.filter((m) => m.baseY <= 0.25 && m.kind !== 'BALCONY_SLAB' && m.kind !== 'CANOPY').map((m) => m.footprint.outer),
  )
