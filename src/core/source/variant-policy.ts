/**
 * Best-variant selection — STAGE WEB-PIVOT-03. Pure and deterministic.
 *
 * ## The rule
 *
 * For one logical asset the publisher may offer several copies. Pick the one
 * that carries the most *real* pixels of the same view, and say why.
 *
 * Three words in that sentence are doing work:
 *
 *  - **real.** Decoded pixel counts from bytes that were actually downloaded.
 *    An upscale is not a better source, a width attribute is a layout
 *    instruction rather than a measurement, and neither can reach this function:
 *    it is given decoded sizes or nothing.
 *  - **same view.** A bigger image that is a different crop is a different
 *    asset, not a better copy of this one. Aspect ratio is the cheap test that
 *    catches it, and a candidate that fails it is rejected by name rather than
 *    quietly preferred for being large.
 *  - **why.** Every candidate comes back with a sentence, selected or not, so
 *    a reader can see what was on offer and what the rule did with it.
 *
 * ## Source-neutral
 *
 * Nothing here mentions a filename, a project, a role or a publisher. It sees
 * measured candidates and an ordering over channels. That is what makes it a
 * policy rather than a patch: the historical CLI-versus-web mismatch was a
 * high-resolution section on one path and a thumbnail on the other, and the fix
 * is not to special-case sections.
 *
 * PORT_DIRECT (Kotlin).
 */
import type { DiscoveryChannel } from '../contracts/source-package.js'

/** A candidate copy, already fetched and decoded. */
export type MeasuredVariant = {
  url: string
  channel: DiscoveryChannel
  /** Decoded pixel width. Never a markup attribute. */
  width: number
  /** Decoded pixel height. */
  height: number
  byteLength: number
  contentHash: string
  mediaType: string
}

export type VariantVerdict = {
  url: string
  selected: boolean
  /** Why it won or lost, in one sentence. */
  reason: string
}

export type VariantSelection = {
  selected: MeasuredVariant
  /** Every candidate, selected first, each with its verdict. */
  verdicts: VariantVerdict[]
  /** True when two candidates were equally good on every rule below identity. */
  ambiguous: boolean
}

/**
 * How much a channel is trusted when nothing measurable separates two copies.
 *
 * Higher is better. A structural link the publisher wrote — an anchor to the
 * original, the floor-plan attribute, `og:image` — is a statement about the
 * file. A URL derived from a naming convention is a guess that happened to
 * resolve, so it loses every tie it is in.
 */
const CHANNEL_TRUST: Record<DiscoveryChannel, number> = {
  ANCHOR_HREF: 90,
  FLOOR_PLAN_ATTR: 85,
  OG_IMAGE: 80,
  FANCYBOX_AJAX: 75,
  IMG_SRCSET: 60,
  IMG_SRC: 50,
  IMG_LAZY_ATTR: 45,
  DOCUMENT_LINK: 40,
  VARIANT_CONVENTION: 10,
}

/** Aspect ratios this far apart are different crops, not different resolutions. */
export const ASPECT_TOLERANCE = 0.02

const aspect = (v: MeasuredVariant): number => v.width / v.height
const pixels = (v: MeasuredVariant): number => v.width * v.height

const sameCrop = (a: MeasuredVariant, b: MeasuredVariant): boolean =>
  Math.abs(aspect(a) - aspect(b)) <= ASPECT_TOLERANCE * Math.max(aspect(a), aspect(b))

/**
 * Choose the copy to analyse.
 *
 * Tie-breaks, applied in order and documented because a reader has to be able
 * to predict the answer:
 *
 *  1. **Decoded pixel count**, largest first — but only among candidates whose
 *     aspect ratio matches the reference crop.
 *  2. **Byte-identical duplicates** collapse: the same content at two URLs is
 *     one candidate, and the higher-trust channel names it.
 *  3. **Channel trust**, highest first.
 *  4. **URL**, lexicographically, so the result is a function of the input and
 *     not of iteration order. Reaching this rule means the two copies were
 *     indistinguishable on every ground that matters, which the result reports
 *     as `ambiguous`.
 *
 * The reference crop is the highest-trust candidate rather than the largest:
 * the page's own `<img>` is the copy the descriptive filename and the alt text
 * belong to, so it is the one that defines what this asset *is*. A larger file
 * with a different shape is then a different drawing that happens to be nearby.
 */
export function selectVariant(candidates: readonly MeasuredVariant[]): VariantSelection | null {
  if (candidates.length === 0) return null

  const byTrust = [...candidates].sort(
    (a, b) => CHANNEL_TRUST[b.channel] - CHANNEL_TRUST[a.channel] || (a.url < b.url ? -1 : 1),
  )
  const reference = byTrust[0]

  const verdicts: VariantVerdict[] = []
  const usable: MeasuredVariant[] = []
  const seenHash = new Map<string, MeasuredVariant>()

  for (const c of [...candidates].sort((a, b) => (a.url < b.url ? -1 : 1))) {
    const twin = seenHash.get(c.contentHash)
    if (twin && twin.url !== c.url) {
      verdicts.push({
        url: c.url,
        selected: false,
        reason: `byte-identical to ${twin.url} (${c.contentHash.slice(0, 12)}); one copy, two addresses`,
      })
      continue
    }
    seenHash.set(c.contentHash, c)
    if (c.width <= 0 || c.height <= 0) {
      verdicts.push({ url: c.url, selected: false, reason: 'decoded to no pixels' })
      continue
    }
    if (c.url !== reference.url && !sameCrop(c, reference)) {
      verdicts.push({
        url: c.url,
        selected: false,
        reason:
          `aspect ${aspect(c).toFixed(3)} against the reference copy's ${aspect(reference).toFixed(3)}: ` +
          'a different crop, not a larger copy of this one',
      })
      continue
    }
    usable.push(c)
  }

  if (usable.length === 0) {
    // Every candidate was rejected. The reference copy still exists, so it is
    // what gets analysed — with the rejections on the record.
    return {
      selected: reference,
      verdicts: [
        { url: reference.url, selected: true, reason: 'the only copy left after every candidate was rejected' },
        ...verdicts.filter((v) => v.url !== reference.url),
      ],
      ambiguous: false,
    }
  }

  const ranked = [...usable].sort(
    (a, b) =>
      pixels(b) - pixels(a) ||
      CHANNEL_TRUST[b.channel] - CHANNEL_TRUST[a.channel] ||
      (a.url < b.url ? -1 : a.url > b.url ? 1 : 0),
  )
  const winner = ranked[0]
  const runnerUp = ranked[1]
  const ambiguous =
    runnerUp !== undefined &&
    pixels(runnerUp) === pixels(winner) &&
    CHANNEL_TRUST[runnerUp.channel] === CHANNEL_TRUST[winner.channel]

  const reasonFor = (v: MeasuredVariant): string => {
    if (v.url === winner.url) {
      const bigger = ranked.length > 1 ? ` (largest of ${ranked.length} usable copies)` : ' (the only copy published)'
      return `${v.width}x${v.height} decoded from ${v.byteLength} B via ${v.channel}${bigger}`
    }
    if (pixels(v) < pixels(winner)) {
      return `${v.width}x${v.height} against the selected ${winner.width}x${winner.height}: fewer real pixels of the same view`
    }
    return `${v.width}x${v.height}, tied on pixels; ${winner.channel} is a stronger channel than ${v.channel}`
  }

  return {
    selected: winner,
    verdicts: [
      { url: winner.url, selected: true, reason: reasonFor(winner) },
      ...ranked.slice(1).map((v) => ({ url: v.url, selected: false, reason: reasonFor(v) })),
      ...verdicts,
    ],
    ambiguous,
  }
}

/** Channel trust, exposed so a report can state the ordering it documented. */
export const channelTrust = (channel: DiscoveryChannel): number => CHANNEL_TRUST[channel]
