/**
 * Polish-locale numeric parsing and the published-label -> canonical-key map.
 *
 * The canonical keys are the analyzer's vocabulary; everything downstream reads
 * `footprint_area`, never "Powierzchnia zabudowy".
 */
import type { FactUnit } from '../contracts/source.js'

/** "131,16" -> 131.16 ; "1 234,5" -> 1234.5 ; "19,05 x 20,6" -> 19.05 (first). */
export function parsePlNumber(raw: string): number | null {
  const cleaned = raw
    .replace(/&nbsp;| /g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const m = cleaned.match(/-?\d[\d ]*(?:[.,]\d+)?/)
  if (!m) return null
  const n = Number(m[0].replace(/ /g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

/** "19,05 x 20,6" -> [19.05, 20.6]. */
export function parsePlPair(raw: string): [number, number] | null {
  const m = raw.replace(/ /g, ' ').match(/(-?\d[\d ]*(?:[.,]\d+)?)\s*[x×]\s*(-?\d[\d ]*(?:[.,]\d+)?)/i)
  if (!m) return null
  const a = Number(m[1].replace(/ /g, '').replace(',', '.'))
  const b = Number(m[2].replace(/ /g, '').replace(',', '.'))
  return Number.isFinite(a) && Number.isFinite(b) ? [a, b] : null
}

export type FactSpec = { key: string; unit: FactUnit }

/**
 * ARCHON publishes each fact under a stable `data-resource` slug. Matching the
 * slug rather than the visible label keeps the adapter robust to copy changes.
 */
export const RESOURCE_SLUG_MAP: Record<string, FactSpec> = {
  'powierzchnia-netto-domu': { key: 'net_area', unit: 'm2' },
  'powierzchnia-uzytkowa': { key: 'usable_area', unit: 'm2' },
  'powierzchnia-garazu': { key: 'garage_area', unit: 'm2' },
  'powierzchnia-kotlowni': { key: 'boiler_room_area', unit: 'm2' },
  'powierzchnia-uzytkowa-bez-schodow': { key: 'usable_area_no_stairs', unit: 'm2' },
  'powierzchnia-zabudowy': { key: 'footprint_area', unit: 'm2' },
  'powierzchnia-podlog': { key: 'floor_area', unit: 'm2' },
  'powierzchnia-calkowita': { key: 'total_area', unit: 'm2' },
  kubatura: { key: 'volume', unit: 'm3' },
  'powierzchnia-dachu': { key: 'roof_area', unit: 'm2' },
  'wysokosc-budynku': { key: 'building_height', unit: 'm' },
  'minimalne-wymiary-dzialki': { key: 'min_plot_dimensions', unit: 'm' },
  'szerokosc-budynku': { key: 'building_width', unit: 'm' },
  'dlugosc-budynku': { key: 'building_length', unit: 'm' },
}

/** Fallback: match on the visible Polish title when the slug is unknown. */
export const TITLE_MAP: Array<{ re: RegExp; spec: FactSpec }> = [
  { re: /powierzchnia\s+zabudowy/i, spec: { key: 'footprint_area', unit: 'm2' } },
  { re: /wysoko[sś][cć]\s+budynku/i, spec: { key: 'building_height', unit: 'm' } },
  { re: /kubatura/i, spec: { key: 'volume', unit: 'm3' } },
  { re: /powierzchnia\s+dachu/i, spec: { key: 'roof_area', unit: 'm2' } },
  { re: /powierzchnia\s+gara[zż]u/i, spec: { key: 'garage_area', unit: 'm2' } },
  { re: /powierzchnia\s+netto/i, spec: { key: 'net_area', unit: 'm2' } },
  { re: /minimalne\s+wymiary\s+dzia[lł]ki/i, spec: { key: 'min_plot_dimensions', unit: 'm' } },
]

export type TechNote = { key: string; text: string }

/**
 * Structured extraction from the free-text technology rows. These carry three
 * of the strongest vertical constraints on the whole model: roof pitch, roof
 * family and knee-wall height.
 */
export function parseTechnology(notes: Record<string, string>): {
  roofPitchDeg: number | null
  roofFamily: string | null
  kneeWallM: number | null
  slabType: string | null
} {
  const roof = notes['dach'] ?? ''
  const knee = notes['ścianka kolankowa'] ?? notes['scianka kolankowa'] ?? ''
  const slab = notes['strop'] ?? null

  const pitchMatch = roof.match(/nachylenie\s*(\d+(?:[.,]\d+)?)\s*(?:st\.?|°|stopni)/i)
  const roofPitchDeg = pitchMatch ? Number(pitchMatch[1].replace(',', '.')) : null

  let roofFamily: string | null = null
  if (/dwuspadow/i.test(roof)) roofFamily = 'GABLE'
  else if (/czterospadow|kopertow/i.test(roof)) roofFamily = 'HIP'
  else if (/jednospadow|pulpitow/i.test(roof)) roofFamily = 'MONO_PITCH'
  else if (/p[lł]aski/i.test(roof)) roofFamily = 'FLAT'
  else if (/wielospadow/i.test(roof)) roofFamily = 'HIP'

  let kneeWallM: number | null = null
  const kneeCm = knee.match(/(\d+(?:[.,]\d+)?)\s*cm/i)
  const kneeM = knee.match(/(\d+(?:[.,]\d+)?)\s*m\b/i)
  if (kneeCm) kneeWallM = Number(kneeCm[1].replace(',', '.')) / 100
  else if (kneeM) kneeWallM = Number(kneeM[1].replace(',', '.'))

  return { roofPitchDeg, roofFamily, kneeWallM, slabType: slab }
}
