/**
 * Asset role classification (§9). Metadata/alt/name first, pixel inference
 * second — the pixel path only runs for assets metadata could not place.
 */
import type { AssetRole, RoleEvidence } from '../contracts/source.js'
import type { GrayImage } from '../contracts/raster.js'

export type RoleGuess = { role: AssetRole; confidence: number; evidence: RoleEvidence[] }

/** Strip Polish diacritics so slug and alt text match one vocabulary. */
export function deaccent(s: string): string {
  const from = 'ąćęłńóśźżĄĆĘŁŃÓŚŹŻ'
  const to = 'acelnoszzACELNOSZZ'
  let out = ''
  for (const ch of s) {
    const i = from.indexOf(ch)
    out += i >= 0 ? to[i] : ch
  }
  return out.toLowerCase()
}

type Rule = { re: RegExp; role: AssetRole; confidence: number }

/**
 * Ordered rules over the de-accented filename slug + alt text. First match wins,
 * so the more specific patterns come first.
 */
const METADATA_RULES: Rule[] = [
  { re: /rzut[-_ ]?parter|rzut[-_ ]?przyziemi|parter/, role: 'PLAN_GROUND', confidence: 0.95 },
  { re: /rzut[-_ ]?poddasz|poddasz|pietr[ao]/, role: 'PLAN_UPPER', confidence: 0.95 },
  { re: /rzut/, role: 'PLAN_OTHER', confidence: 0.6 },
  { re: /przekroj|przekrój/, role: 'SECTION', confidence: 0.95 },
  { re: /elewacja[-_ ]?front/, role: 'ELEVATION_FRONT', confidence: 0.95 },
  { re: /elewacja[-_ ]?ogrodow|elewacja[-_ ]?tyln/, role: 'ELEVATION_REAR', confidence: 0.95 },
  { re: /elewacja[-_ ]?lew/, role: 'ELEVATION_LEFT', confidence: 0.9 },
  { re: /elewacja[-_ ]?praw/, role: 'ELEVATION_RIGHT', confidence: 0.9 },
  // "elewacja boczna" is published twice without a side; resolved by ordering.
  { re: /elewacja[-_ ]?boczn/, role: 'ELEVATION_LEFT', confidence: 0.45 },
  { re: /elewacja/, role: 'ELEVATION_FRONT', confidence: 0.35 },
  { re: /sytuacja/, role: 'SITE_PLAN', confidence: 0.9 },
  { re: /widok[-_ ]?1/, role: 'HERO_RENDER', confidence: 0.85 },
  { re: /widok[-_ ]?2/, role: 'GARDEN_RENDER', confidence: 0.7 },
  { re: /widok[-_ ]?[3-9]/, role: 'SIDE_RENDER', confidence: 0.6 },
  { re: /widok|wizualizacj/, role: 'OTHER_RENDER', confidence: 0.5 },
]

/**
 * ARCHON's gallery emits `data-images-modal-link="elevationN"`. The publisher's
 * own ordering is front / side / side / garden, which is the only signal that
 * separates the two "elewacja boczna" images.
 */
const MODAL_LINK_ORDER: Record<string, { role: AssetRole; confidence: number }> = {
  elevation1: { role: 'ELEVATION_FRONT', confidence: 0.9 },
  elevation2: { role: 'ELEVATION_LEFT', confidence: 0.7 },
  elevation3: { role: 'ELEVATION_RIGHT', confidence: 0.7 },
  elevation4: { role: 'ELEVATION_REAR', confidence: 0.9 },
}

export function classifyByMetadata(input: {
  urlSlug: string
  alt: string
  caption?: string
  modalLink?: string
}): RoleGuess {
  const evidence: RoleEvidence[] = []
  const slug = deaccent(input.urlSlug)
  const alt = deaccent(input.alt ?? '')
  const caption = deaccent(input.caption ?? '')

  let best: RoleGuess | null = null

  for (const rule of METADATA_RULES) {
    if (rule.re.test(slug)) {
      best = { role: rule.role, confidence: rule.confidence, evidence: ['FILENAME'] }
      break
    }
  }
  if (!best) {
    for (const rule of METADATA_RULES) {
      if (rule.re.test(alt)) {
        best = { role: rule.role, confidence: rule.confidence * 0.95, evidence: ['ALT_TEXT'] }
        break
      }
    }
  }
  if (!best && caption) {
    for (const rule of METADATA_RULES) {
      if (rule.re.test(caption)) {
        best = { role: rule.role, confidence: rule.confidence * 0.85, evidence: ['CAPTION'] }
        break
      }
    }
  }

  // Gallery ordering refines the ambiguous side elevations, and only those.
  const modal = input.modalLink ? MODAL_LINK_ORDER[input.modalLink] : undefined
  if (modal) {
    if (!best) return { role: modal.role, confidence: modal.confidence, evidence: ['DOM_CONTEXT'] }
    const ambiguousSide = best.confidence < 0.6 && (best.role === 'ELEVATION_LEFT' || best.role === 'ELEVATION_RIGHT')
    if (ambiguousSide) {
      return {
        role: modal.role,
        confidence: Math.max(best.confidence, modal.confidence),
        evidence: [...best.evidence, 'DOM_CONTEXT'],
      }
    }
    evidence.push('DOM_CONTEXT')
  }

  if (best) return { ...best, evidence: [...best.evidence, ...evidence] }
  return { role: 'UNKNOWN_ASSET', confidence: 0, evidence: ['DEFAULT'] }
}

/**
 * Pixel fallback (§9 "pixel inference second"). Technical drawings are
 * overwhelmingly near-white with thin dark ink; renders carry broad mid-tone
 * colour. Cheap, and only consulted when metadata failed.
 */
export function classifyByPixels(g: GrayImage): RoleGuess {
  let white = 0
  let dark = 0
  let mid = 0
  const n = g.data.length
  for (let i = 0; i < n; i++) {
    const v = g.data[i]
    if (v > 235) white++
    else if (v < 80) dark++
    else mid++
  }
  const whiteFrac = white / n
  const midFrac = mid / n
  if (whiteFrac > 0.6 && midFrac < 0.3) {
    // Drawing-like. Aspect ratio separates a tall section from a wide elevation.
    const aspect = g.width / g.height
    if (aspect > 2.0) return { role: 'ELEVATION_FRONT', confidence: 0.3, evidence: ['PIXEL_INFERENCE'] }
    return { role: 'PLAN_OTHER', confidence: 0.3, evidence: ['PIXEL_INFERENCE'] }
  }
  return { role: 'OTHER_RENDER', confidence: 0.35, evidence: ['PIXEL_INFERENCE'] }
}

/**
 * Post-pass over the whole asset set: a project has at most one of each
 * elevation, so a duplicated side role is demoted rather than silently kept.
 */
export function resolveRoleConflicts(
  assets: Array<{ id: string; role: AssetRole; roleConfidence: number }>,
): Map<string, { role: AssetRole; confidence: number }> {
  const out = new Map<string, { role: AssetRole; confidence: number }>()
  const singleton: AssetRole[] = ['ELEVATION_FRONT', 'ELEVATION_REAR', 'ELEVATION_LEFT', 'ELEVATION_RIGHT', 'SECTION', 'PLAN_GROUND', 'PLAN_UPPER']
  const seen = new Map<AssetRole, { id: string; confidence: number }>()
  for (const a of assets) {
    out.set(a.id, { role: a.role, confidence: a.roleConfidence })
    if (!singleton.includes(a.role)) continue
    const prev = seen.get(a.role)
    if (!prev) {
      seen.set(a.role, { id: a.id, confidence: a.roleConfidence })
      continue
    }
    // Two claims on one singleton role: keep the stronger, demote the weaker.
    const loser =
      prev.confidence >= a.roleConfidence
        ? { id: a.id, confidence: a.roleConfidence }
        : { id: prev.id, confidence: prev.confidence }
    if (prev.confidence < a.roleConfidence) seen.set(a.role, { id: a.id, confidence: a.roleConfidence })
    const demoted: AssetRole =
      a.role === 'ELEVATION_LEFT' ? 'ELEVATION_RIGHT' : a.role === 'ELEVATION_RIGHT' ? 'ELEVATION_LEFT' : 'PLAN_OTHER'
    out.set(loser.id, { role: demoted, confidence: loser.confidence * 0.7 })
  }
  return out
}
