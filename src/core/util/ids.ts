/**
 * Deterministic id minting. Ids must be a pure function of content so that two
 * runs over the same assets produce byte-identical exports (§48 determinism).
 */
import { shortHash } from './hash.js'

export const mkId = (prefix: string, ...parts: (string | number)[]): string =>
  `${prefix}_${shortHash(parts.map(String).join('|'), 12)}`

/** Sequential id within a stable, sorted collection. */
export const seqId = (prefix: string, index: number): string =>
  `${prefix}_${String(index).padStart(3, '0')}`
