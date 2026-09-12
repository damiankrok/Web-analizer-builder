/**
 * Source resolution upgrades (§4).
 *
 * The analyzer's first WEB-02 finding was that no printed dimension had been
 * read, and the first hypothesis to test was resolution rather than recogniser
 * quality. It was partly resolution: ARCHON publishes each technical drawing
 * twice and the page embeds the small copy.
 *
 * Two mechanisms find the large copy, in this order of trust:
 *
 *  1. *Structural.* The page wraps the small `<img>` in an anchor whose href is
 *     the original. Containment identifies the pair, which matters because the
 *     original's filename carries no view name (see the parser).
 *
 *  2. *Conventional.* Where no anchor exists — the section is embedded with a
 *     script handler instead — the asset path ends `__<variant>.<ext>` and the
 *     large copy is the same path with the variant offset by a fixed block.
 *     This is a guess about a publisher's URL scheme, so it is only ever a
 *     *candidate*: the host fetches it, decodes it, and keeps it solely if it
 *     is a valid image strictly larger than the copy it would replace. An
 *     unverified candidate is discarded, so a wrong guess costs one request and
 *     changes nothing.
 *
 * Upscaling is never an upgrade. Nothing here resamples: a candidate either
 * carries more real pixels or it is dropped.
 *
 * PORT_DIRECT (Kotlin).
 */

/**
 * Variant-id block used by the publisher for full-size copies: a page variant
 * `264` has its original at `11264`. Derived from the anchors the page does
 * expose, then applied to the assets it does not.
 */
export const VARIANT_BLOCK = 11000

/**
 * Candidate higher-resolution URLs for an asset, most likely first.
 *
 * Pure: proposes, never fetches. Returns an empty list when the URL shape
 * gives no basis for a guess — the correct answer for an asset that is already
 * the original (its variant id already sits in the upgraded block).
 */
export function resolutionCandidates(url: string): string[] {
  const m = url.match(/^(.*)__(\d{1,6})(\.[a-z0-9]+)(\?.*)?$/i)
  if (!m) return []
  const [, stem, digits, ext, query = ''] = m
  const variant = Number(digits)
  if (!Number.isFinite(variant) || variant <= 0) return []
  // Already in the upgraded block: this *is* the original.
  if (variant >= VARIANT_BLOCK) return []
  return [`${stem}__${variant + VARIANT_BLOCK}${ext}${query}`]
}

/** Whether a fetched candidate genuinely carries more pixels than the current copy. */
export const isResolutionUpgrade = (
  candidate: { width: number; height: number },
  current: { width: number; height: number },
): boolean =>
  candidate.width * candidate.height > current.width * current.height &&
  candidate.width >= current.width &&
  candidate.height >= current.height
