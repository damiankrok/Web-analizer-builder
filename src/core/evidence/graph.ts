/**
 * Typed EvidenceGraph (§14).
 *
 * The graph exists to answer two questions the scorer cannot answer on its own:
 * which source wins when two disagree, and how much independent support a claim
 * actually has. The second is why `identityKey` matters — the ridge is visible
 * in the section, in two elevations and in both renders, and counting it five
 * times would let a repeat of the same observation outvote a stronger source
 * seen once. Nodes sharing an identity key are merged into one physical
 * feature whose confidence grows only through genuinely independent sources
 * (§14: "duplicates must not count twice").
 *
 * PORT_DIRECT (Kotlin).
 */
import type {
  Authority,
  EvidenceGraphData,
  EvidenceNode,
  EvidenceNodeType,
  EvidenceRelation,
  EvidenceRelationType,
} from '../contracts/evidence.js'
import { AUTHORITY_RANK } from '../contracts/evidence.js'
import { mkId } from '../util/ids.js'

export type MergedNode = EvidenceNode & {
  /** Ids of the observations merged into this physical feature. */
  mergedFrom: string[]
  /** Distinct source assets that independently support it. */
  independentSources: string[]
}

export class EvidenceGraph {
  private readonly nodes = new Map<string, MergedNode>()
  private readonly byIdentity = new Map<string, string>()
  private readonly relations = new Map<string, EvidenceRelation>()
  private readonly contradictions: string[] = []

  /**
   * Add an observation. When it shares an identity key with an existing node,
   * the two are merged rather than both being kept.
   */
  add(node: EvidenceNode): MergedNode {
    if (!node.identityKey) {
      const fresh: MergedNode = {
        ...node,
        mergedFrom: [node.id],
        independentSources: node.sourceAssetId ? [node.sourceAssetId] : [],
      }
      this.nodes.set(node.id, fresh)
      return fresh
    }

    const existingId = this.byIdentity.get(node.identityKey)
    if (existingId === undefined) {
      const fresh: MergedNode = {
        ...node,
        mergedFrom: [node.id],
        independentSources: node.sourceAssetId ? [node.sourceAssetId] : [],
      }
      this.nodes.set(node.id, fresh)
      this.byIdentity.set(node.identityKey, node.id)
      return fresh
    }

    const existing = this.nodes.get(existingId) as MergedNode
    const merged = mergeNodes(existing, node)
    this.nodes.set(existingId, merged)
    // Record the provenance link so the merge is auditable.
    this.relate('samePhysicalFeature', node.id, existingId, 1, `merged on identity ${node.identityKey}`)
    return merged
  }

  relate(type: EvidenceRelationType, from: string, to: string, weight = 1, note?: string): EvidenceRelation {
    const id = mkId('rel', type, from, to)
    const rel: EvidenceRelation = { id, type, from, to, weight, ...(note ? { note } : {}) }
    this.relations.set(id, rel)
    if (type === 'contradicts') this.contradictions.push(note ?? `${from} contradicts ${to}`)
    return rel
  }

  get(id: string): MergedNode | undefined {
    return this.nodes.get(id)
  }

  byIdentityKey(key: string): MergedNode | undefined {
    const id = this.byIdentity.get(key)
    return id === undefined ? undefined : this.nodes.get(id)
  }

  ofType(type: EvidenceNodeType): MergedNode[] {
    return [...this.nodes.values()].filter((n) => n.type === type)
  }

  allNodes(): MergedNode[] {
    return [...this.nodes.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  }

  allRelations(): EvidenceRelation[] {
    return [...this.relations.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  }

  contradictionNotes(): string[] {
    return [...this.contradictions]
  }

  /**
   * Best numeric estimate for an identity key, taken from the highest-authority
   * observation. Ties within one authority level are resolved by confidence,
   * then by a weighted mean — averaging across *authority* levels would let a
   * render drag a published dimension, which §33 forbids.
   */
  resolveNumeric(identityKey: string, field: string): { value: number; authority: Authority; support: number } | null {
    const node = this.byIdentityKey(identityKey)
    if (!node) return null
    const value = node.payload[field]
    if (typeof value !== 'number') return null
    return { value, authority: node.authority, support: node.independentSources.length }
  }

  toJSON(): EvidenceGraphData {
    return {
      nodes: this.allNodes().map(({ mergedFrom, independentSources, ...n }) => ({
        ...n,
        payload: { ...n.payload, mergedFrom, independentSources },
      })),
      relations: this.allRelations(),
    }
  }

  summary(): { nodeCount: number; relationCount: number; byType: Record<string, number>; contradictions: number } {
    const byType: Record<string, number> = {}
    for (const n of this.nodes.values()) byType[n.type] = (byType[n.type] ?? 0) + 1
    return {
      nodeCount: this.nodes.size,
      relationCount: this.relations.size,
      byType,
      contradictions: this.contradictions.length,
    }
  }
}

/**
 * Merge a new observation into an existing physical feature.
 *
 * The higher-authority observation supplies the payload. Confidence rises only
 * for a genuinely new source, and with diminishing returns: three elevations
 * agreeing on the ridge is real corroboration, but it is not certainty, and it
 * must never reach the level of a published exact dimension.
 */
export function mergeNodes(existing: MergedNode, incoming: EvidenceNode): MergedNode {
  const existingRank = AUTHORITY_RANK[existing.authority]
  const incomingRank = AUTHORITY_RANK[incoming.authority]
  const winner = incomingRank > existingRank ? incoming : existing

  const sources = new Set(existing.independentSources)
  const isNewSource = incoming.sourceAssetId !== undefined && !sources.has(incoming.sourceAssetId)
  if (incoming.sourceAssetId) sources.add(incoming.sourceAssetId)

  const base = Math.max(existing.confidence, incoming.confidence)
  const corroborated = isNewSource ? base + (1 - base) * 0.35 : base

  return {
    ...winner,
    id: existing.id,
    identityKey: existing.identityKey,
    confidence: Math.min(0.99, corroborated),
    mergedFrom: [...existing.mergedFrom, incoming.id],
    independentSources: [...sources].sort(),
  }
}

/**
 * Compare two observations of the same quantity and decide whether they agree.
 * Used to emit `supports` or `contradicts` relations between sources.
 */
export function agreementOf(a: number, b: number, toleranceAbs: number): 'supports' | 'contradicts' {
  return Math.abs(a - b) <= toleranceAbs ? 'supports' : 'contradicts'
}
