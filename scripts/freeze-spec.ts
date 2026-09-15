/**
 * STAGE WEB-PIVOT-06A §17 — freeze the extraction before the holdout runs.
 *
 *   npx tsx scripts/freeze-spec.ts
 *
 * Writes the commit and the configuration hash. `holdout-spec.ts` refuses to
 * run unless both still match, which is what makes the holdout figure a
 * measurement rather than a result that was tuned towards.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { extractionConfig, canonicalise } from '../src/core/extract/config.js'
import { TesseractEngine } from '../src/node/ocr/tesseract.js'

const config = canonicalise(extractionConfig())
const configHash = createHash('sha256').update(config).digest('hex')
let codeSha = 'unknown'
try {
  codeSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
} catch {
  // A tree without git still freezes; the report says the SHA is unverifiable.
}
const engine = TesseractEngine.available()

const payload = {
  stage: 'STAGE_WEB_PIVOT_06A_DOORWAY_ROOM_TOPOLOGY',
  frozenAt: new Date().toISOString(),
  codeSha,
  configHash,
  engine: { id: engine.engineId, version: engine.version, available: engine.available },
}
mkdirSync('out', { recursive: true })
writeFileSync('out/freeze-web-pivot-06a.json', `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
console.log(JSON.stringify(payload, null, 2))
console.log('\nwrote out/freeze-web-pivot-06a.json')
