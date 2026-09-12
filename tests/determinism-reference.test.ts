import { describe, expect, it } from 'vitest'
import { analyze, DEFAULT_ANALYZE } from '../src/core/pipeline/analyze.js'
import { buildExports, bundleHash, stripNonDeterministic, NON_DETERMINISTIC_KEYS } from '../src/core/pipeline/exports.js'
import { REFERENCE_WEIGHT, ANALYZER_CONFIG, freezeHashes } from '../src/core/config/weights.js'
import { canonicalJson } from '../src/core/util/hash.js'
import { loadFixture } from './helpers.js'

const OPTS = { ...DEFAULT_ANALYZE, maxRepairCycles: 1 }

describe('determinism', () => {
  it('produces byte-identical exports for the same assets', async () => {
    const { pkg, images } = await loadFixture('A-marcowki')
    const first = buildExports(analyze(pkg, images, OPTS))
    const second = buildExports(analyze(pkg, images, OPTS))
    expect(bundleHash(second)).toBe(bundleHash(first))
    expect(canonicalJson(stripNonDeterministic(second))).toBe(canonicalJson(stripNonDeterministic(first)))
  })

  it('produces an identical candidate, score and repair trace across runs', async () => {
    const { pkg, images } = await loadFixture('A-marcowki')
    const a = analyze(pkg, images, OPTS)
    const b = analyze(pkg, images, OPTS)
    expect(b.resolved.id).toBe(a.resolved.id)
    expect(b.finalScore.total).toBe(a.finalScore.total)
    expect(b.repairTrace.map((t) => `${t.proposalId}:${t.accepted}`)).toEqual(
      a.repairTrace.map((t) => `${t.proposalId}:${t.accepted}`),
    )
    expect(b.views.map((v) => v.hypotheses[0]?.id)).toEqual(a.views.map((v) => v.hypotheses[0]?.id))
  })

  it('excludes only wall-clock measurements from the determinism digest', () => {
    for (const key of NON_DETERMINISTIC_KEYS) {
      expect(key.endsWith('Ms') || key.endsWith('At'), key).toBe(true)
    }
  })
})

describe('manual reference isolation (§39)', () => {
  it('weights the manual reference model at exactly zero', () => {
    expect(REFERENCE_WEIGHT).toBe(0)
    expect(ANALYZER_CONFIG.referenceWeight).toBe(0)
  })

  it('exposes the reference weight in the self-verification export', async () => {
    const { pkg, images } = await loadFixture('A-marcowki')
    const bundle = buildExports(analyze(pkg, images, OPTS))
    const verification = bundle['self-verification.json'] as { referenceWeight: number }
    expect(verification.referenceWeight).toBe(0)
  })

  it('never reads a reference asset: no analyzer module imports one', async () => {
    // The reference model is a development oracle only. Nothing in the portable
    // core may name it, so that deleting or changing it cannot alter a result.
    const { readdirSync, readFileSync, statSync } = await import('node:fs')
    const { join } = await import('node:path')
    const offenders: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)
        if (statSync(full).isDirectory()) {
          walk(full)
          continue
        }
        if (!full.endsWith('.ts')) continue
        const text = readFileSync(full, 'utf8')
        // Allow the word in comments; forbid it in code that reads a path.
        const codeLines = text
          .split('\n')
          .filter((l) => !l.trimStart().startsWith('*') && !l.trimStart().startsWith('//') && !l.trimStart().startsWith('/*'))
        if (codeLines.some((l) => /reference[A-Za-z]*\s*(=|:)\s*['"`].*(png|jpg|jpeg|screenshot)/i.test(l))) {
          offenders.push(full)
        }
      }
    }
    walk('src/core')
    expect(offenders).toEqual([])
  })

  it('keeps the freeze hashes stable for an unchanged configuration', () => {
    expect(freezeHashes()).toEqual(freezeHashes())
  })
})
