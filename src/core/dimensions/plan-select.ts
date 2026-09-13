/**
 * Which floor plan the dimension reader should read — STAGE WEB-PIVOT-04. Pure.
 *
 * ## The defect
 *
 * ARCHON publishes each floor twice: once with the dimension chains printed on
 * it, and once with room names and areas printed on it instead. They are the
 * same drawing with two different overlays, and only one of them carries
 * numbers a dimension reader can read.
 *
 * Up to STAGE WEB-PIVOT-03 the reader picked its plan by the single-enum
 * `AssetRole`, and that enum is decided by filename: `rzut-parteru-z-
 * powierzchniami` — "ground floor with areas" — names the storey, so it wins
 * `PLAN_GROUND`, and the copy with the chains on it (whose filename names
 * nothing at all) is demoted to `PLAN_OTHER`. The reader was therefore pointed
 * at the one published copy of the ground floor with no dimensions on it, and
 * read 12 tokens of which none corroborated anything.
 *
 * STAGE WEB-PIVOT-03 gave every asset four independent role dimensions.
 * Selection now uses them: the document kind says it is a floor plan, the
 * storey says which floor, and the annotation variant breaks the tie towards
 * the copy that has the chains.
 *
 * ## What this is not
 *
 * It is not an OCR change. Nothing here touches the recogniser, its thresholds
 * or its grammar; it changes which image they are given. If the reader is still
 * weak on the right drawing, that is a finding about the reader, and this stage
 * reports it rather than tuning around it.
 *
 * PORT_DIRECT (Kotlin).
 */
import type { SourceAsset } from '../contracts/source.js'

export type PlanStorey = 'GROUND' | 'UPPER_ATTIC'

export type PlanSelection = {
  asset: SourceAsset
  /** Why this asset was chosen, for the audit. */
  reason: string
  /** How it was found: by role dimensions, or by the legacy single enum. */
  by: 'ROLE_DIMENSIONS' | 'LEGACY_ROLE'
  /** Copies of the same floor that were not chosen. */
  rejected: Array<{ assetId: string; annotation: string; why: string }>
}

/** The legacy single-enum role for a storey, used only as a fallback. */
const LEGACY_ROLE: Record<PlanStorey, string> = {
  GROUND: 'PLAN_GROUND',
  UPPER_ATTIC: 'PLAN_UPPER',
}

/**
 * Rank the annotation variants for a dimension reader.
 *
 * `DIMENSIONED` first, because it is the copy with the chains. `CLEAN` and
 * `UNKNOWN` next: they may carry chains that nobody labelled. `AREA_LABELS`
 * last — it is a real source of room identity and a poor source of dimensions,
 * and picking it by accident is the defect this module exists to stop.
 */
const ANNOTATION_RANK: Record<string, number> = {
  DIMENSIONED: 0,
  CLEAN: 1,
  UNKNOWN: 2,
  AREA_LABELS: 3,
}

/**
 * The plan of one storey that a dimension reader should be given.
 *
 * Deterministic: among the candidates it prefers the best annotation variant,
 * then the larger decoded image, then the lower asset id — so the answer is a
 * function of the package and not of the order the assets happen to be in.
 */
export function selectPlanAsset(
  assets: readonly SourceAsset[],
  storey: PlanStorey,
): PlanSelection | null {
  const dimensioned = assets.filter(
    (a) => a.roles?.document === 'FLOOR_PLAN' && a.roles.storey === storey,
  )
  if (dimensioned.length > 0) {
    const ranked = [...dimensioned].sort(
      (a, b) =>
        (ANNOTATION_RANK[a.roles!.annotation] ?? 9) - (ANNOTATION_RANK[b.roles!.annotation] ?? 9) ||
        (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0) ||
        (a.id < b.id ? -1 : 1),
    )
    const best = ranked[0]
    return {
      asset: best,
      by: 'ROLE_DIMENSIONS',
      reason:
        `FLOOR_PLAN / ${storey} / ${best.roles!.annotation}` +
        (ranked.length > 1 ? `, preferred over ${ranked.length - 1} other published copy of the same floor` : ', the only published copy of this floor'),
      rejected: ranked.slice(1).map((a) => ({
        assetId: a.id,
        annotation: a.roles!.annotation,
        why: `same floor, annotation ${a.roles!.annotation} ranks below ${best.roles!.annotation} for reading dimensions`,
      })),
    }
  }
  // No role dimensions in this package: fall back to what the reader did
  // before, so a hand-built `ParsedSource` still works.
  const legacy = assets.find((a) => a.role === LEGACY_ROLE[storey])
  if (!legacy) return null
  return {
    asset: legacy,
    by: 'LEGACY_ROLE',
    reason: `${LEGACY_ROLE[storey]} by the single-enum role; this package carries no role dimensions`,
    rejected: [],
  }
}
