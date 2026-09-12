/**
 * Cross-source opening identity (§18, §19).
 *
 * One window is one window. It appears in the plan as a gap in a wall, in an
 * elevation as a framed rectangle, in a render as a dark quadrilateral, and —
 * where the recogniser reaches it — in a printed callout as an exact
 * width/height pair. Four observations, one physical feature, and the analyzer
 * has to say so: counted separately they inflate the opening count, split the
 * evidence for each, and let a single window be scored as several missing ones.
 *
 * Identity is decided in the building's own frame, not in any image. Every
 * observation is projected to (facade, position along the facade, sill height),
 * and two observations are the same opening when their intervals overlap
 * substantially and their sills agree. That test is source-agnostic, which is
 * the point — it works between a plan and an elevation, where no pixel
 * correspondence exists at all.
 *
 * The merged result keeps its evidence rather than collapsing it, so the audit
 * can show which sources agreed and which dimension each field came from. Where
 * two sources disagree beyond tolerance the conflict is recorded and the
 * stronger authority wins; exact dimensions are never averaged (§13).
 *
 * PORT_DIRECT (Kotlin).
 */
import type { Authority } from '../contracts/evidence.js'
import { AUTHORITY_RANK } from '../contracts/evidence.js'
import type { FacadeSide, OpeningKind } from '../contracts/hypotheses.js'
import { mkId } from '../util/ids.js'

export type OpeningSourceKind = 'PLAN_GAP' | 'ELEVATION_RECT' | 'RENDER_REGION' | 'PRINTED_CALLOUT'

/** One source's view of one opening, already expressed in the building frame. */
export type OpeningObservation = {
  id: string
  source: OpeningSourceKind
  assetId: string
  facade: FacadeSide
  /** Position of the opening's left jamb along the facade, metres. */
  s: number
  widthM: number
  /** Sill height above the storey's floor, metres. Null when the source cannot say. */
  sillY: number | null
  heightM: number | null
  authority: Authority
  confidence: number
  /** Panels visible in this observation, when it can tell. */
  panelCount?: number
  /** Whether this observation shows the head cut by a roof plane. */
  clippedByRoof?: boolean
}

export type OpeningConflict = {
  field: 'widthM' | 'heightM' | 'sillY'
  a: { source: OpeningSourceKind; value: number }
  b: { source: OpeningSourceKind; value: number }
  deltaAbs: number
  note: string
}

/**
 * A resolved opening: the outer structural hole, its subdivision, and the
 * evidence that produced each number.
 */
export type ResolvedOpening = {
  id: string
  facade: FacadeSide
  kind: OpeningKind
  /** The outer structural opening — what the wall loses (§19). */
  s: number
  widthM: number
  sillY: number
  heightM: number
  /** Panel subdivision inside the structural opening. */
  panelCount: number
  /** A door leaf occupies the full height of its panel. */
  hasDoorLeaf: boolean
  /** Mullion positions along the opening, metres from its left jamb. */
  mullions: number[]
  clippedByRoof: boolean
  observations: OpeningObservation[]
  conflicts: OpeningConflict[]
  /** Provenance of each resolved field. */
  provenance: { widthM: OpeningSourceKind; heightM: OpeningSourceKind; sillY: OpeningSourceKind }
  authority: Authority
  confidence: number
}

export type IdentityOptions = {
  /** Overlap of the two facade intervals, as a fraction of the shorter. */
  minOverlap: number
  /** Sill agreement required, metres. */
  sillTolerance: number
  /** Disagreement beyond which a conflict is recorded, metres. */
  conflictTolerance: number
}

export const DEFAULT_IDENTITY: IdentityOptions = {
  minOverlap: 0.45,
  sillTolerance: 0.55,
  conflictTolerance: 0.2,
}

const overlapFraction = (a: OpeningObservation, b: OpeningObservation): number => {
  const lo = Math.max(a.s, b.s)
  const hi = Math.min(a.s + a.widthM, b.s + b.widthM)
  const inter = hi - lo
  if (inter <= 0) return 0
  return inter / Math.min(a.widthM, b.widthM)
}

/** Does `inner` sit wholly inside `outer` on the facade? */
const nests = (inner: OpeningObservation, outer: OpeningObservation): boolean =>
  inner.s >= outer.s - 0.05 && inner.s + inner.widthM <= outer.s + outer.widthM + 0.05

/**
 * Are these two observations of one physical opening?
 *
 * Identity resolution is a *cross-source* operation, and saying so explicitly
 * matters. Two rectangles found in one elevation are two openings: the
 * detector already suppressed overlapping duplicates, so what survives side by
 * side is genuinely side by side. Merging within a source instead collapses a
 * window next to a patio door into one five-metre opening and reports the
 * difference as a conflict — which is how this resolver behaved before the
 * rule was stated.
 *
 * The one within-source relation that *is* identity is nesting: a small
 * rectangle wholly inside a large one is a panel of it, not a second hole in
 * the wall (§19).
 */
const sameOpening = (a: OpeningObservation, b: OpeningObservation, opts: IdentityOptions): boolean => {
  if (a.facade !== b.facade) return false
  const sameSource = a.source === b.source && a.assetId === b.assetId
  if (sameSource && !nests(a, b) && !nests(b, a)) return false
  if (overlapFraction(a, b) < opts.minOverlap) return false
  if (a.sillY !== null && b.sillY !== null && Math.abs(a.sillY - b.sillY) > opts.sillTolerance) return false
  return true
}

const classify = (widthM: number, heightM: number, sillY: number, massKind: string): OpeningKind => {
  if (massKind === 'GARAGE' && widthM > 2.0 && sillY < 0.5) return 'GARAGE_GATE'
  if (widthM >= 2.4 && sillY < 0.6) return 'SLIDING_GLAZING'
  if (sillY < 0.4 && heightM > 1.8) return 'DOOR'
  return 'WINDOW'
}

/**
 * Group observations into physical openings.
 *
 * Grouping is transitive over the `sameOpening` relation, so a plan gap that
 * matches an elevation rectangle which matches a render region forms one
 * opening even when the plan and the render would not have matched each other
 * directly — which is common, since a render sees an opening obliquely and
 * measures its width worst.
 */
export function groupObservations(
  observations: readonly OpeningObservation[],
  opts: IdentityOptions = DEFAULT_IDENTITY,
): OpeningObservation[][] {
  const groups: OpeningObservation[][] = []
  const assigned = new Set<string>()
  // Strongest authority first, so a group is seeded by its best evidence and
  // the weaker sources attach to it rather than defining it.
  const ordered = [...observations].sort(
    (a, b) => AUTHORITY_RANK[b.authority] - AUTHORITY_RANK[a.authority] || b.confidence - a.confidence || a.id.localeCompare(b.id),
  )
  for (const seed of ordered) {
    if (assigned.has(seed.id)) continue
    const group = [seed]
    assigned.add(seed.id)
    let grew = true
    while (grew) {
      grew = false
      for (const other of ordered) {
        if (assigned.has(other.id)) continue
        if (!group.some((m) => sameOpening(m, other, opts))) continue
        group.push(other)
        assigned.add(other.id)
        grew = true
      }
    }
    groups.push(group.sort((a, b) => a.id.localeCompare(b.id)))
  }
  return groups.sort((a, b) => a[0].facade.localeCompare(b[0].facade) || a[0].s - b[0].s)
}

/**
 * Resolve one group of observations into an opening.
 *
 * Each field is taken from the highest-authority observation that states it —
 * a printed callout over an elevation measurement over a plan gap over a
 * render region — and the disagreements are recorded rather than smoothed. The
 * structural opening is what a quantity deduction uses; the panel subdivision
 * is carried alongside it and never substituted for it (§19).
 */
export function resolveOpening(
  group: readonly OpeningObservation[],
  massKind: string,
  opts: IdentityOptions = DEFAULT_IDENTITY,
): ResolvedOpening {
  const byAuthority = [...group].sort(
    (a, b) => AUTHORITY_RANK[b.authority] - AUTHORITY_RANK[a.authority] || b.confidence - a.confidence || a.id.localeCompare(b.id),
  )
  const pick = <K extends 'widthM' | 'heightM' | 'sillY'>(
    field: K,
  ): { value: number | null; source: OpeningSourceKind } => {
    for (const o of byAuthority) {
      const v = o[field]
      if (v !== null && v !== undefined && Number.isFinite(v)) return { value: v as number, source: o.source }
    }
    return { value: null, source: byAuthority[0].source }
  }

  const width = pick('widthM')
  const height = pick('heightM')
  const sill = pick('sillY')

  const conflicts: OpeningConflict[] = []
  // Members nested inside the structural opening are its panels, so their
  // smaller dimensions are not disagreements about the same quantity.
  const outer = byAuthority.reduce((widest, o) => (o.widthM > widest.widthM ? o : widest), byAuthority[0])
  const structural = group.filter((o) => o === outer || !nests(o, outer) || o.source !== outer.source)
  for (const field of ['widthM', 'heightM', 'sillY'] as const) {
    const stated = structural.filter((o) => o[field] !== null && o[field] !== undefined)
    for (let i = 0; i < stated.length; i++) {
      for (let j = i + 1; j < stated.length; j++) {
        const a = stated[i][field] as number
        const b = stated[j][field] as number
        const delta = Math.abs(a - b)
        if (delta <= opts.conflictTolerance) continue
        conflicts.push({
          field,
          a: { source: stated[i].source, value: a },
          b: { source: stated[j].source, value: b },
          deltaAbs: delta,
          note: `${stated[i].source} and ${stated[j].source} disagree by ${(delta * 100).toFixed(0)} cm; the stronger authority stands and the disagreement is kept`,
        })
      }
    }
  }

  // Left jamb from the strongest source that gave the width, so position and
  // width describe the same observation.
  const anchor = byAuthority.find((o) => o.source === width.source) ?? byAuthority[0]
  const widthM = width.value ?? anchor.widthM
  const heightM = height.value ?? 1.4
  const sillY = sill.value ?? 0.9
  // Panels: whatever a source counted, or the number of members nested inside
  // the structural opening, whichever is larger.
  const nestedMembers = group.filter((o) => o !== outer && nests(o, outer)).length
  const panelCount = Math.max(1, nestedMembers, ...group.map((o) => o.panelCount ?? 1))
  const kind = classify(widthM, heightM, sillY, massKind)
  // Mullions divide the structural opening evenly when a source counted panels
  // but none placed them: an even division is the drafting default and is
  // marked as inferred by carrying no separate provenance.
  const mullions: number[] = []
  for (let i = 1; i < panelCount; i++) mullions.push((widthM * i) / panelCount)

  return {
    id: mkId('open', anchor.facade, anchor.s.toFixed(3), widthM.toFixed(3)),
    facade: anchor.facade,
    kind,
    s: anchor.s,
    widthM,
    sillY,
    heightM,
    panelCount,
    // A door leaf reaches the floor; a fixed light does not.
    hasDoorLeaf: kind === 'DOOR' || kind === 'GARAGE_GATE' || (kind === 'SLIDING_GLAZING' && sillY < 0.25),
    mullions,
    clippedByRoof: group.some((o) => o.clippedByRoof === true),
    observations: [...group],
    conflicts,
    provenance: { widthM: width.source, heightM: height.source, sillY: sill.source },
    authority: byAuthority[0].authority,
    // Agreement between independent sources raises confidence; a single source
    // cannot exceed its own.
    confidence: Math.min(
      0.97,
      byAuthority[0].confidence * (1 + 0.12 * (new Set(group.map((o) => o.source)).size - 1)) -
        conflicts.length * 0.08,
    ),
  }
}

export type IdentityResult = {
  openings: ResolvedOpening[]
  /** How many observations each source contributed, before merging. */
  bySource: Record<string, number>
  merged: number
  conflicts: number
  notes: string[]
}

export function resolveOpenings(
  observations: readonly OpeningObservation[],
  massKindOf: (facade: FacadeSide, s: number) => string,
  opts: IdentityOptions = DEFAULT_IDENTITY,
): IdentityResult {
  const groups = groupObservations(observations, opts)
  const openings = groups.map((g) => resolveOpening(g, massKindOf(g[0].facade, g[0].s), opts))
  const bySource: Record<string, number> = {}
  for (const o of observations) bySource[o.source] = (bySource[o.source] ?? 0) + 1
  const merged = observations.length - openings.length
  const conflicts = openings.reduce((n, o) => n + o.conflicts.length, 0)
  const notes = [
    `${observations.length} opening observations from ${Object.keys(bySource).length} source kinds ` +
      `resolved into ${openings.length} physical openings (${merged} merged, ${conflicts} conflicts kept)`,
  ]
  const multi = openings.filter((o) => new Set(o.observations.map((x) => x.source)).size > 1).length
  notes.push(`${multi} openings are corroborated by more than one source kind`)
  return { openings, bySource, merged, conflicts, notes }
}
