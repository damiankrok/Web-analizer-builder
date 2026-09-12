/** Number grammar and chain solving (§33). */
import { describe, expect, it } from 'vitest'
import { interpretToken, parseToken, chooseByExpectation, DEFAULT_GRAMMAR } from '../src/core/dimensions/grammar.js'
import {
  solveChain,
  solveChainIntegers,
  voteScale,
  consensusScale,
  DEFAULT_CHAIN_SOLVE,
} from '../src/core/dimensions/chains.js'
import type { DimensionChain, ValueCandidate } from '../src/core/dimensions/contracts.js'
import { integerCandidateStrings, paddedCandidateStrings, harvestInvariantPositions } from '../src/core/dimensions/templates.js'
import { GLYPH_COLS, GLYPH_ROWS, type TextGlyph } from '../src/core/dimensions/recognizer.js'

describe('dimension grammar', () => {
  it('splits sign, whole and fractional parts', () => {
    expect(parseToken('1205')).toMatchObject({ whole: '1205', fraction: '', hadSeparator: false, hadSign: false })
    expect(parseToken('2,72')).toMatchObject({ whole: '2', fraction: '72', hadSeparator: true })
    expect(parseToken('+3.06')).toMatchObject({ sign: 1, hadSign: true, whole: '3', fraction: '06' })
    expect(parseToken('-0,32')).toMatchObject({ sign: -1, hadSign: true })
    expect(parseToken('±0,00')?.sign).toBe(0)
    expect(parseToken('12a4')).toBeNull()
  })

  it('keeps every plausible reading of a bare integer rather than choosing one', () => {
    const { candidates } = interpretToken('1205', 'CHAIN_SEGMENT')
    const cm = candidates.find((c) => c.interpretation === 'CENTIMETRES')
    const mm = candidates.find((c) => c.interpretation === 'MILLIMETRES')
    expect(cm?.metres).toBeCloseTo(12.05, 6)
    // 1.205 m is a perfectly possible dimension, so millimetres stays on the
    // table: the grammar must not decide what only the geometry can.
    expect(mm?.metres).toBeCloseTo(1.205, 6)
    // Centimetres is the convention on these drawings and carries the higher
    // prior, but it is a prior and not a decision.
    expect(cm!.confidence).toBeGreaterThan(mm!.confidence)
  })

  it('treats a decimal separator as the drawing having chosen metres', () => {
    const { candidates } = interpretToken('2,72', 'CHAIN_SEGMENT')
    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({ interpretation: 'METRES' })
    expect(candidates[0].metres).toBeCloseTo(2.72, 6)
  })

  it('reads a signed token as a level above datum', () => {
    const plus = interpretToken('+7,95', 'LEVEL_MARKER').candidates
    expect(plus[0]).toMatchObject({ interpretation: 'METRES_SIGNED' })
    expect(plus[0].metres).toBeCloseTo(7.95, 6)
    const minus = interpretToken('-0,32', 'LEVEL_MARKER').candidates
    expect(minus[0].metres).toBeCloseTo(-0.32, 6)
  })

  it('rejects a reading outside the plausible band for its kind, with a reason', () => {
    const { candidates, rejections } = interpretToken('9', 'OPENING_CALLOUT_WIDTH', DEFAULT_GRAMMAR)
    expect(candidates.every((c) => c.metres >= DEFAULT_GRAMMAR.minOpeningM)).toBe(true)
    expect(rejections.length).toBeGreaterThan(0)
    expect(rejections.join(' ')).toMatch(/outside/)
    // The same token is fine as a chain segment, where 9 m is ordinary.
    expect(interpretToken('900', 'CHAIN_SEGMENT').candidates.some((c) => c.metres === 9)).toBe(true)
  })

  it('needs an expectation to choose, and refuses when nothing is close', () => {
    const candidates: ValueCandidate[] = [
      { text: '272', metres: 2.72, interpretation: 'CENTIMETRES', confidence: 0.8 },
      { text: '272', metres: 0.272, interpretation: 'MILLIMETRES', confidence: 0.4 },
    ]
    expect(chooseByExpectation(candidates, 2.7, 0.05)?.interpretation).toBe('CENTIMETRES')
    expect(chooseByExpectation(candidates, 9.9, 0.05)).toBeNull()
  })
})

describe('chain solving', () => {
  const chain = (parts: Array<{ lengthPx: number; candidates: ValueCandidate[] }>, overall?: { lengthPx: number; candidates: ValueCandidate[] }): DimensionChain => ({
    id: 'c',
    orientation: 'HORIZONTAL',
    baseline: { a: { x: 0, y: 0 }, b: { x: 100, y: 0 } },
    anchors: [],
    segments: parts.map((p, i) => ({
      id: `s${i}`,
      startAnchorId: '',
      endAnchorId: '',
      lengthPx: p.lengthPx,
      candidates: p.candidates,
      metres: null,
      fidelity: 'UNRESOLVED',
      rejections: [],
      confidence: 0,
    })),
    ...(overall ? { overall: { candidates: overall.candidates, metres: null, lengthPx: overall.lengthPx, fidelity: 'UNRESOLVED' as const } } : {}),
    sourceAssetId: 'a',
    closureResidualM: null,
    closes: false,
    confidence: 0,
  })
  const cm = (text: string): ValueCandidate[] => [
    { text, metres: Number(text) / 100, interpretation: 'CENTIMETRES', confidence: 0.85 },
    { text, metres: Number(text) / 1000, interpretation: 'MILLIMETRES', confidence: 0.3 },
  ]

  it('corroborates every part when the chain closes', () => {
    // 790 + 415 = 1205, drawn at 0.38 px/cm.
    const solved = solveChain(
      chain(
        [
          { lengthPx: 790 * 0.38, candidates: cm('790') },
          { lengthPx: 415 * 0.38, candidates: cm('415') },
        ],
        { lengthPx: 1205 * 0.38, candidates: cm('1205') },
      ),
    )
    expect(solved.closes).toBe(true)
    expect(solved.segments.every((s) => s.fidelity === 'SOURCE_CORROBORATED')).toBe(true)
    expect(solved.closureResidualM).toBeCloseTo(0, 6)
  })

  it('demotes the one segment that disagrees with its own baseline', () => {
    const solved = solveChain(
      chain(
        [
          { lengthPx: 790 * 0.38, candidates: cm('790') },
          // Drawn 415 long but labelled 445: the chain will not close.
          { lengthPx: 415 * 0.38, candidates: cm('445') },
        ],
        { lengthPx: 1205 * 0.38, candidates: cm('1205') },
      ),
      { ...DEFAULT_CHAIN_SOLVE, pixelTolerance: 0.2 },
    )
    expect(solved.closes).toBe(false)
    const demoted = solved.segments.filter((s) => s.fidelity === 'SOURCE_DERIVED')
    expect(demoted).toHaveLength(1)
    expect(demoted[0].rejections.some((r) => /closure/.test(r))).toBe(true)
  })

  it('chooses centimetres over millimetres from the pixel length alone', () => {
    const solved = solveChain(chain([{ lengthPx: 272 * 0.38, candidates: cm('272') }]))
    expect(solved.segments[0].metres).toBeCloseTo(2.72, 6)
    expect(solved.segments[0].rejections.some((r) => /MILLIMETRES/.test(r))).toBe(true)
  })

  it('leaves an unread segment unresolved rather than subtracting it', () => {
    const solved = solveChain(
      chain(
        [
          { lengthPx: 790 * 0.38, candidates: cm('790') },
          { lengthPx: 415 * 0.38, candidates: [] },
        ],
        { lengthPx: 1205 * 0.38, candidates: cm('1205') },
      ),
    )
    expect(solved.segments[1].metres).toBeNull()
    expect(solved.segments[1].fidelity).toBe('UNRESOLVED')
    expect(solved.closes).toBe(false)
  })

  it('solves a chain to integers from its geometry alone', () => {
    const s = 0.38
    // The window matters: pixel lengths are quantised, so a wide search finds
    // other scales that also land on integers. The pipeline searches a couple
    // of percent around a scale it already trusts, and so does this.
    const solution = solveChainIntegers([790 * s, 415 * s], 1205 * s, s * 1.01, 0.02)
    expect(solution).not.toBeNull()
    expect(solution!.values).toEqual([790, 415])
    expect(solution!.overall).toBe(1205)
    expect(solution!.closes).toBe(true)
  })

  it('refuses a degenerate scale where every length divides exactly', () => {
    // At 0.5 px/cm every integer pixel length is an exact integer value, so a
    // unanimous vote across many candidates is evidence against the scale.
    const chains = Array.from({ length: 8 }, (_, i) => ({ lengths: [40 + i, 60 + i, 80 + i], overall: 180 + 3 * i }))
    const vote = voteScale(chains, 0.4, 0.6, 400, 0.16, 0.5)
    if (vote) expect(Math.abs(vote.pixelsPerCm - 0.5)).toBeGreaterThan(1e-6)
  })

  it('reports the scale several chains agree on', () => {
    const s = 0.38
    const built = [
      chain([{ lengthPx: 790 * s, candidates: cm('790') }], { lengthPx: 1205 * s, candidates: cm('1205') }),
      chain([{ lengthPx: 510 * s, candidates: cm('510') }], { lengthPx: 1260 * s, candidates: cm('1260') }),
    ]
    const { pixelsPerMetre, spread } = consensusScale(built)
    expect(pixelsPerMetre).not.toBeNull()
    expect(pixelsPerMetre!).toBeCloseTo(38, 0)
    expect(spread).toBeLessThan(0.05)
  })
})

describe('invariant-position harvesting', () => {
  const glyph = (): TextGlyph => ({
    box: { x0: 0, y0: 0, x1: 5, y1: 9 },
    sourceBox: { x0: 0, y0: 0, x1: 5, y1: 9 },
    area: 20,
    height: 10,
    aspect: 0.6,
    profile: new Float32Array(GLYPH_COLS * GLYPH_ROWS),
    holes: 0,
  })

  it('labels only the positions every candidate agrees on', () => {
    const glyphs = [glyph(), glyph(), glyph()]
    const candidates = integerCandidateStrings(792, 3, 3)
    expect(candidates[0]).toBe('789')
    expect(candidates[candidates.length - 1]).toBe('795')
    const harvest = harvestInvariantPositions([{ glyphs, candidates }])
    // The hundreds digit is 7 throughout; the others vary.
    expect(harvest.positions).toBe(1)
    expect(harvest.examples[0].character).toBe('7')
  })

  it('labels every position when the prediction is exact', () => {
    const glyphs = [glyph(), glyph(), glyph()]
    const harvest = harvestInvariantPositions([{ glyphs, candidates: paddedCandidateStrings(0, 0.4, 3) }])
    expect(harvest.positions).toBe(3)
    expect(harvest.examples.map((e) => e.character).join('')).toBe('000')
  })

  it('teaches nothing when the digit count disagrees with the glyph count', () => {
    const harvest = harvestInvariantPositions([{ glyphs: [glyph(), glyph()], candidates: ['1205'] }])
    expect(harvest.positions).toBe(0)
  })
})
