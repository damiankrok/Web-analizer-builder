/**
 * Metric audit.
 *
 * Every dimension the model depends on, with where it came from. The point is
 * accountability: a reader should be able to see at a glance which numbers are
 * the publisher's, which were measured off a drawing, which were inferred from
 * proportion, and which the analyzer could not establish at all — and the
 * analyzer must never present the last category as though it were the first.
 *
 * PORT_DIRECT (Kotlin).
 */
import type { DimensionProvenance } from './dimensions.js'

export type AuditEntry = {
  key: string
  label: string
  unit: 'm' | 'm2' | 'm3' | 'deg' | 'count'
  value: number | null
  provenance: DimensionProvenance
  /** Where it came from, in words. */
  source: string
  /** Independent corroborations, with the value each gave. */
  corroboration: Array<{ source: string; value: number; deltaAbs: number }>
  confidence: number
  note?: string
}

export type MetricAudit = {
  entries: AuditEntry[]
  summary: Record<DimensionProvenance, number>
  /** Items where independent sources disagree beyond tolerance. */
  conflicts: Array<{ key: string; a: string; b: string; deltaAbs: number }>
}

export type AuditInput = {
  key: string
  label: string
  unit: AuditEntry['unit']
  candidates: Array<{ source: string; value: number | null; provenance: DimensionProvenance; confidence: number }>
  /** Absolute tolerance for calling two candidates corroborating. */
  toleranceAbs: number
}

const RANK: Record<DimensionProvenance, number> = {
  SOURCE_EXACT: 100,
  SOURCE_DERIVED: 80,
  GEOMETRIC_INFERRED: 55,
  VISUAL_INFERRED: 30,
  UNRESOLVED: 0,
}

/**
 * Choose the value to report for one quantity.
 *
 * The strongest provenance wins outright; equal provenances break on
 * confidence. Values are never averaged across provenance classes — averaging a
 * published dimension with a pixel measurement produces a number that is
 * neither, and quietly degrades the one piece of evidence that was exact.
 */
export function auditItem(input: AuditInput): AuditEntry {
  const usable = input.candidates.filter((c) => c.value !== null && Number.isFinite(c.value))
  if (usable.length === 0) {
    return {
      key: input.key,
      label: input.label,
      unit: input.unit,
      value: null,
      provenance: 'UNRESOLVED',
      source: 'no source established this quantity',
      corroboration: [],
      confidence: 0,
    }
  }
  const best = usable.reduce((a, b) =>
    RANK[b.provenance] > RANK[a.provenance] || (RANK[b.provenance] === RANK[a.provenance] && b.confidence > a.confidence)
      ? b
      : a,
  )
  const value = best.value as number
  const corroboration = usable
    .filter((c) => c !== best)
    .map((c) => ({ source: c.source, value: c.value as number, deltaAbs: Math.abs((c.value as number) - value) }))
    .sort((a, b) => a.deltaAbs - b.deltaAbs)

  const agreeing = corroboration.filter((c) => c.deltaAbs <= input.toleranceAbs).length
  const confidence = Math.min(0.99, best.confidence + agreeing * 0.06)

  return {
    key: input.key,
    label: input.label,
    unit: input.unit,
    value,
    provenance: best.provenance,
    source: best.source,
    corroboration,
    confidence,
    ...(corroboration.some((c) => c.deltaAbs > input.toleranceAbs)
      ? { note: 'an independent source disagrees beyond tolerance; the conflict is kept rather than averaged away' }
      : {}),
  }
}

export function buildAudit(inputs: readonly AuditInput[]): MetricAudit {
  const entries = inputs.map(auditItem)
  const summary: Record<DimensionProvenance, number> = {
    SOURCE_EXACT: 0,
    SOURCE_DERIVED: 0,
    GEOMETRIC_INFERRED: 0,
    VISUAL_INFERRED: 0,
    UNRESOLVED: 0,
  }
  for (const e of entries) summary[e.provenance]++

  const conflicts: MetricAudit['conflicts'] = []
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    const tolerance = inputs[i].toleranceAbs
    for (const c of e.corroboration) {
      if (c.deltaAbs > tolerance) conflicts.push({ key: e.key, a: e.source, b: c.source, deltaAbs: c.deltaAbs })
    }
  }
  return { entries, summary, conflicts }
}
