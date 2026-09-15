/**
 * Every tunable the automatic extraction has, in one place — §23.
 *
 * A holdout run is only worth something if nothing moved between choosing the
 * holdout and running it. "Nothing moved" has to be checkable, so every
 * threshold, tolerance and bound the pipeline uses is gathered here and
 * hashed. The freeze records that hash and the commit; the holdout command
 * refuses to run if either has changed.
 *
 * Adding a tunable somewhere else and not adding it here would quietly weaken
 * that promise, so this file lists the defaults by importing them rather than
 * by restating them: a new field in any of those objects changes the hash
 * without anyone remembering to update this file.
 *
 * PORT_DIRECT (Kotlin).
 */
import { DEFAULT_TEXT_REGIONS } from './text-regions.js'
import { DEFAULT_TEXT_CROP } from './text-crops.js'
import { DEFAULT_PLAN_TEXT } from './text-engine.js'
import { DEFAULT_STROKES } from './stroke-lines.js'
import { DEFAULT_DIMENSION_STRUCTURES } from './dimension-structures.js'
import { DEFAULT_CHAIN_FIT } from './chain-fit.js'
import { DEFAULT_OBSERVATIONS } from './dimension-observations.js'
import { DEFAULT_WALL_BANDS } from './wall-bands.js'
import { DEFAULT_PLAN_MODEL } from './plan-model.js'
import { DEFAULT_CANDIDATE } from './spec-candidate.js'

/** The pipeline's configuration, as it stands. */
export const extractionConfig = (): Record<string, unknown> => ({
  textRegions: DEFAULT_TEXT_REGIONS,
  textCrop: DEFAULT_TEXT_CROP,
  planText: DEFAULT_PLAN_TEXT,
  strokes: DEFAULT_STROKES,
  // The structures' own geometry options carry the legacy callout settings;
  // they are part of the configuration whether or not this stage tuned them.
  dimensionStructures: DEFAULT_DIMENSION_STRUCTURES,
  chainFit: DEFAULT_CHAIN_FIT,
  observations: DEFAULT_OBSERVATIONS,
  wallBands: DEFAULT_WALL_BANDS,
  planModel: DEFAULT_PLAN_MODEL,
  candidate: DEFAULT_CANDIDATE,
})

/** Stable JSON: keys sorted at every level, so a hash is of the values. */
export function canonicalise(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalise).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => typeof v !== 'function')
    .sort(([a], [b]) => (a < b ? -1 : 1))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalise(v)}`).join(',')}}`
}
