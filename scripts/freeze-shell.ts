/**
 * STAGE WEB-PIVOT-07 §33 — freeze the shell extraction before the holdout runs.
 *
 *   npm run shell:freeze
 *
 * Writes the commit and the configuration hashes — Stage 06's as well as
 * Stage 07's, because Stage 07 consumes the floor-plan candidate and a change
 * to how a wall is found changes what the facades are matched against.
 * `holdout-shell.ts` refuses to run unless all of it still matches.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { extractionConfig, canonicalise } from '../src/core/extract/config.js'
import { shellConfig } from '../src/core/extract/shell-config.js'
import { DEFAULT_SHELL_RUNNER } from '../src/node/shell-runner.js'
import { TesseractEngine } from '../src/node/ocr/tesseract.js'

const hash = (v: unknown): string => createHash('sha256').update(canonicalise(v)).digest('hex')
let codeSha = 'unknown'
try {
  codeSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
} catch {
  // A tree without git still freezes; the report says the SHA is unverifiable.
}
const engine = TesseractEngine.available()
const payload = {
  stage: 'STAGE_WEB_PIVOT_07_AUTOMATIC_SECTION_ELEVATION_SPEC',
  frozenAt: new Date().toISOString(),
  codeSha,
  planConfigHash: hash(extractionConfig()),
  shellConfigHash: hash({ ...shellConfig(), runner: DEFAULT_SHELL_RUNNER }),
  engine: { id: engine.engineId, version: engine.version, available: engine.available },
}
mkdirSync('out', { recursive: true })
writeFileSync('out/freeze-web-pivot-07.json', `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
console.log(JSON.stringify(payload, null, 2))
console.log('\nwrote out/freeze-web-pivot-07.json')
