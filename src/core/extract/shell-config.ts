/**
 * Every tunable STAGE WEB-PIVOT-07 has, in one place — §33.
 *
 * The same promise Stage 06's `config.ts` makes, for the same reason: a
 * holdout run is only worth something if nothing moved between choosing the
 * holdout and running it, and "nothing moved" has to be checkable. So every
 * threshold, tolerance and bound this stage uses is gathered here and hashed,
 * the freeze records that hash and the commit, and the holdout command refuses
 * to run if either has changed.
 *
 * The defaults are imported rather than restated, so a new field in any of
 * those objects changes the hash without anyone having to remember this file
 * exists.
 *
 * PORT_DIRECT (Kotlin).
 */
import { DEFAULT_SECTION_ANNOTATIONS } from './section-annotations.js'
import { DEFAULT_SECTION_READ } from './section-read.js'
import { DEFAULT_DATUM_SOLVER } from './vertical-datums.js'
import { DEFAULT_SECTION_ROOF } from './section-roof.js'
import { DEFAULT_OBLIQUE_TEXT } from './oblique-text.js'
import { DEFAULT_TOPOLOGY_OPTIONS } from './roof-model.js'
import { DEFAULT_ELEVATION } from './elevation.js'
import { DEFAULT_FACADE_OPENINGS } from './facade-openings.js'
import { DEFAULT_FACADE_EXTRACTION } from './opening-match.js'
import { DEFAULT_SHELL_FEATURES } from './shell-features.js'

/** The Stage-07 configuration, as it stands. */
export const shellConfig = (): Record<string, unknown> => ({
  sectionAnnotations: DEFAULT_SECTION_ANNOTATIONS,
  sectionRead: DEFAULT_SECTION_READ,
  datumSolver: DEFAULT_DATUM_SOLVER,
  sectionRoof: DEFAULT_SECTION_ROOF,
  obliqueText: DEFAULT_OBLIQUE_TEXT,
  topology: DEFAULT_TOPOLOGY_OPTIONS,
  elevation: DEFAULT_ELEVATION,
  facadeOpenings: DEFAULT_FACADE_OPENINGS,
  facadeExtraction: DEFAULT_FACADE_EXTRACTION,
  shellFeatures: DEFAULT_SHELL_FEATURES,
})
