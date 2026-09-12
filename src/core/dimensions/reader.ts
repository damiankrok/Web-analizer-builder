/**
 * The printed-dimension reader: geometry, recognition, chains and callouts for
 * one technical drawing (§3).
 *
 * This is the module that turns `high-resolution source asset` into
 * `metric constraint candidates`, in the order the specification lays out. The
 * ordering is load-bearing at two points.
 *
 * Geometry precedes recognition, so a label is a small box at a known place
 * holding exactly one number, rather than one of several hundred ink
 * components on a plan full of furniture. The zones the geometry stage
 * proposes are then filtered by whether they actually contain a text run,
 * which is what separates a dimension line from a kitchen counter without any
 * appeal to where the building is.
 *
 * Recognition precedes interpretation, so the alphabet can be learned from the
 * labels whose values the drawing's own scale predicts, and then applied to
 * the labels it does not predict — the opening callouts and level markers that
 * carry the dimensions nothing else on the page states.
 *
 * PORT_DIRECT (Kotlin).
 */
import type { GrayImage } from '../contracts/raster.js'
import { mkId } from '../util/ids.js'
import type {
  DimensionAnchor,
  DimensionChain,
  DimensionLabelKind,
  DimensionSegment,
  LevelAnnotation,
  OpeningCallout,
  PixelBox,
  TextCandidate,
  TextOrientation,
} from './contracts.js'
import {
  DEFAULT_DIMENSION_GEOMETRY,
  chainFamilies,
  detectDimensionGeometry,
  estimateSlant,
  type ChainFamily,
  type DimensionGeometry,
  type DimensionGeometryOptions,
  type LabelZone,
} from './geometry.js'
import { prepareCrop } from './crops.js'
import { segmentGlyphs, DEFAULT_SEGMENT, type SegmentOptions, type TextGlyph } from './recognizer.js'
import {
  buildTemplates,
  classifyRun,
  labellingCoherence,
  DEFAULT_CLASSIFY,
  type ClassifyOptions,
  type LabelledGlyph,
  type TemplateBank,
} from './templates.js'
import { DEFAULT_GRAMMAR, interpretToken, type GrammarOptions } from './grammar.js'
import {
  DEFAULT_CHAIN_SOLVE,
  solveChain,
  consensusScale,
  solveChainIntegers,
  voteScale,
  type ChainSolveOptions,
  type IntegerChainSolution,
} from './chains.js'

export type DimensionReadOptions = {
  geometry: DimensionGeometryOptions
  segment: SegmentOptions
  classify: ClassifyOptions
  grammar: GrammarOptions
  chain: ChainSolveOptions
  /** Source-native pixels per metre, when the caller already knows it. */
  pixelsPerMetre: number | null
  /** Fractional tolerance on a geometric prediction used for learning. */
  predictionTolerance: number
  /** Glyphs a label must have to be considered text at all. */
  minGlyphs: number
  maxGlyphs: number
  /** Alternations of the scale/recognition loop. */
  rounds: number
  /** Rounding a chain may show and still be treated as drawn to scale, cm. */
  maxIntegerResidualCm: number
}

export const DEFAULT_DIMENSION_READ: DimensionReadOptions = {
  geometry: DEFAULT_DIMENSION_GEOMETRY,
  segment: DEFAULT_SEGMENT,
  classify: DEFAULT_CLASSIFY,
  grammar: DEFAULT_GRAMMAR,
  chain: DEFAULT_CHAIN_SOLVE,
  pixelsPerMetre: null,
  predictionTolerance: 0.06,
  minGlyphs: 1,
  maxGlyphs: 5,
  rounds: 5,
  maxIntegerResidualCm: 0.3,
}

/** One zone with its glyphs, before anything has been read. */
type ZoneReading = {
  zone: LabelZone | null
  kind: DimensionLabelKind
  box: PixelBox
  orientation: TextOrientation
  glyphs: TextGlyph[]
  /** Baseline length this label describes, source-native pixels. */
  lengthPx: number
  /** Callout this zone belongs to, when it is a callout half. */
  calloutId?: string
  /** Level line row, when it is a level marker. */
  levelRow?: number
}

export type DimensionReadResult = {
  assetId: string
  geometry: DimensionGeometry
  chains: DimensionChain[]
  callouts: OpeningCallout[]
  levels: LevelAnnotation[]
  /** Every text token read, for the audit and the debug UI. */
  tokens: Array<TextCandidate & { kind: DimensionLabelKind; zoneId: string }>
  /** Tokens whose zones held glyphs that could not be named. */
  unreadZones: number
  templates: TemplateBank
  /** Scale the chains themselves agree on. */
  pixelsPerMetre: number | null
  scaleSpread: number
  notes: string[]
}

/**
 * Collect the glyphs in every candidate zone, and drop the zones that hold no
 * text.
 *
 * This is the filter that makes geometry-first pay off. A plan yields dozens of
 * long thin lines that are not dimension lines — counter edges, door leaves,
 * paving joints — and every one of them produces a label zone. None of them
 * has digits above it. Requiring a run of same-height components in the band
 * removes them all without a single assumption about the drawing's layout.
 */
function collectZones(
  gray: GrayImage,
  geometry: DimensionGeometry,
  opts: DimensionReadOptions,
  slantRad: number,
): ZoneReading[] {
  const out: ZoneReading[] = []
  const consider = (r: Omit<ZoneReading, 'glyphs'>): void => {
    const { crop, variants } = prepareCrop(gray, r.box, r.orientation)
    let best: TextGlyph[] = []
    // A dimension printed in centimetres on a house plan never has one digit:
    // a single-glyph "label" in a chain band is a dot, a hatch fragment or an
    // appliance symbol, and admitting those is what floods the recogniser.
    const minGlyphs = r.kind === 'CHAIN_SEGMENT' || r.kind === 'CHAIN_OVERALL' ? 2 : r.kind === 'LEVEL_MARKER' ? 3 : 2
    for (const ink of variants) {
      const glyphs = segmentGlyphs(crop, ink, slantRad, opts.segment)
      if (glyphs.length < Math.max(opts.minGlyphs, minGlyphs) || glyphs.length > opts.maxGlyphs) continue
      // Same-height run: digits in one label share a height, and the run must
      // be horizontally contiguous once the crop is upright.
      const heights = glyphs.map((g) => g.height)
      const hMin = Math.min(...heights)
      const hMax = Math.max(...heights)
      if (hMax > hMin * 1.4) continue
      if (glyphs.length > best.length) best = glyphs
    }
    if (best.length === 0) return
    out.push({ ...r, glyphs: best })
  }

  for (const zone of geometry.zones) {
    consider({
      zone,
      kind: zone.segmentIndex < 0 ? 'CHAIN_OVERALL' : 'CHAIN_SEGMENT',
      box: zone.box,
      orientation: zone.orientation,
      lengthPx: zone.lengthPx,
    })
  }
  for (const callout of geometry.callouts) {
    consider({
      zone: null,
      kind: 'OPENING_CALLOUT_WIDTH',
      box: callout.upper,
      orientation: 'HORIZONTAL',
      lengthPx: 0,
      calloutId: callout.id,
    })
    consider({
      zone: null,
      kind: 'OPENING_CALLOUT_HEIGHT',
      box: callout.lower,
      orientation: 'HORIZONTAL',
      lengthPx: 0,
      calloutId: callout.id,
    })
  }
  for (const level of geometry.levels) {
    consider({
      zone: null,
      kind: 'LEVEL_MARKER',
      box: level.box,
      orientation: 'HORIZONTAL',
      lengthPx: 0,
      levelRow: level.row,
    })
  }
  return out
}

export function readPrintedDimensions(
  assetId: string,
  gray: GrayImage,
  options: Partial<DimensionReadOptions> = {},
): DimensionReadResult {
  const opts: DimensionReadOptions = { ...DEFAULT_DIMENSION_READ, ...options }
  const notes: string[] = []
  const geometry = detectDimensionGeometry(gray, opts.geometry)
  notes.push(...geometry.notes)

  // First pass with no slant correction, purely to find the glyphs the slant
  // is then measured from. The drawing's lean is a property of its text, so it
  // cannot be measured before the text has been located.
  const probe = collectZones(gray, geometry, opts, 0)
  const slantRad = estimateSlant(
    gray,
    probe.flatMap((z) => z.glyphs.map((g) => g.sourceBox)),
    geometry.inkThreshold,
  )
  notes.push(`text slant re-measured from ${probe.length} located labels: ${((slantRad * 180) / Math.PI).toFixed(1)}°`)
  const zones = collectZones(gray, geometry, opts, slantRad)
  notes.push(`${zones.length} of ${geometry.zones.length + geometry.callouts.length * 2 + geometry.levels.length} candidate zones hold a text run`)

  const glyphs = zones.flatMap((z) => z.glyphs)
  const learnScale = opts.pixelsPerMetre

  // Solve each candidate chain's integers from its geometry before reading a
  // single glyph. A chain of segments drawn to one unknown scale, with values
  // that are whole centimetres and parts that sum to the whole, is far more
  // constrained than any individual label: the scale that makes every segment
  // land on an integer is essentially unique. The result is one predicted
  // value per label instead of a range, which is what turns the recogniser
  // from guessing into voting.
  // --- learning the alphabet, then reading with it ----------------------
  //
  // Recognition and scale are coupled: a good scale makes the chain solver
  // predict exact values, exact values supervise the templates, and templates
  // read labels whose values then measure the scale better than any
  // calibration. So the two are estimated together, alternately, from a
  // deliberately loose start.
  //
  // The loop is short and monotone by construction — each round keeps the
  // scale that the labels it actually read imply, and a round that reads
  // nothing changes nothing.
  // One entry per chain family: the intervals of its inner line plus, where
  // the drawing printed one, the total on its outer line.
  const families = chainFamilies(geometry.lines)
  const zonesOf = (lineId: string): Array<{ z: (typeof zones)[number]; i: number }> =>
    zones
      .map((z, i) => ({ z, i }))
      .filter((e) => e.z.zone?.lineId === lineId)
      .sort((a, b) => (a.z.zone?.segmentIndex ?? 0) - (b.z.zone?.segmentIndex ?? 0))

  const chainGeometry = families.flatMap((family: ChainFamily) =>
    family.parts.map((line) => {
      const parts = zonesOf(line.id)
      const overallZones = family.overall && family.overall.id !== line.id ? zonesOf(family.overall.id) : []
      const overallEntry = overallZones.length === 1 ? overallZones[0] : undefined
      return {
        family,
        line,
        parts,
        overallEntry,
        lengths: parts.map((p) => p.z.lengthPx),
        overall: overallEntry?.z.lengthPx ?? null,
      }
    }),
  )
  notes.push(
    `${families.length} chain families from ${geometry.lines.length} dimension lines; ` +
      `${chainGeometry.filter((c) => c.overall !== null).length} have a printed total`,
  )

  const hint = opts.pixelsPerMetre !== null && opts.pixelsPerMetre > 0 ? opts.pixelsPerMetre / 100 : null

  /** Predict every chain label's integer value at one candidate scale. */
  const predictAt = (
    pixelsPerCm: number,
    window: number,
  ): { solved: Map<number, number>; solutions: Map<string, IntegerChainSolution> } => {
    const solved = new Map<number, number>()
    const solutions = new Map<string, IntegerChainSolution>()
    for (const cg of chainGeometry) {
      if (cg.parts.length === 0) continue
      const solution = solveChainIntegers(cg.lengths, cg.overall, pixelsPerCm, window)
      if (!solution) continue
      if (solution.residualCm > opts.maxIntegerResidualCm) continue
      let agree = 0
      cg.parts.forEach((p, k) => {
        if (String(solution.values[k]).length === p.z.glyphs.length) agree++
      })
      if (agree < Math.max(1, Math.ceil(cg.parts.length * 0.5))) continue
      solutions.set(cg.line.id, solution)
      cg.parts.forEach((p, k) => {
        if (String(solution.values[k]).length === p.z.glyphs.length) solved.set(p.i, solution.values[k])
      })
      if (
        cg.overallEntry &&
        solution.overall !== null &&
        String(solution.overall).length === cg.overallEntry.z.glyphs.length
      ) {
        solved.set(cg.overallEntry.i, solution.overall)
      }
    }
    return { solved, solutions }
  }

  const harvestAt = (solved: Map<number, number>): LabelledGlyph[] => {
    const out: LabelledGlyph[] = []
    for (const [i, value] of solved) {
      const text = String(value)
      if (text.length !== zones[i].glyphs.length) continue
      for (let k = 0; k < text.length; k++) out.push({ glyph: zones[i].glyphs[k], character: text[k] })
    }
    return out
  }

  // Choose the scale by how coherently it labels the drawing's own glyphs,
  // not by rounding residual. Rounding is satisfied by many scales once tick
  // positions carry a pixel of noise; coherence is satisfied by one, because
  // only the true scale gives the same stroke shape the same name everywhere.
  let bestScale: number | null = null
  let bestCoherence = 0
  let bestReport = ''
  if (hint !== null) {
    const lo = hint * 0.78
    const hi = hint * 1.12
    const steps = 340
    for (let i = 0; i <= steps; i++) {
      const s = lo + ((hi - lo) * i) / steps
      const { solved } = predictAt(s, 0.012)
      if (solved.size < 3) continue
      const coherence = labellingCoherence(harvestAt(solved))
      if (coherence.score > bestCoherence) {
        bestCoherence = coherence.score
        bestScale = s
        bestReport =
          `${(s * 100).toFixed(2)} px/m: ${solved.size} labels, ${coherence.examples} glyphs over ` +
          `${coherence.classes} characters, margin ${coherence.margin.toFixed(3)}, score ${coherence.score.toFixed(3)}`
      }
    }
  }
  if (bestScale !== null) notes.push(`scale by labelling coherence -> ${bestReport}`)
  else {
    const vote = hint ? voteScale(chainGeometry, hint * 0.9, hint * 1.1, 4000, 0.16, hint) : null
    if (vote) {
      bestScale = vote.pixelsPerCm
      notes.push(
        `scale vote fallback: ${(vote.pixelsPerCm * 100).toFixed(2)} px/m supported by ${vote.support} of ${vote.chains} chains`,
      )
    }
  }

  const chainSolutions = new Map<string, IntegerChainSolution>()
  let solvedFor = new Map<number, number>()
  let templates: TemplateBank = { templates: [], alphabet: '', examples: 0, labels: 0, notes: [] }
  let decoded = new Map<number, { text: string; glyphConfidence: number[] }>()
  let rejectionsByZone = new Map<number, string[]>()
  let scalePxPerCm = bestScale ?? hint
  let learnScaleUsed = scalePxPerCm !== null ? scalePxPerCm * 100 : null

  for (let round = 0; round < opts.rounds; round++) {
    if (scalePxPerCm === null || scalePxPerCm <= 0) break
    // Solve every candidate chain's integers at the current scale, then harvest
    // supervision from them. Nothing has been recognised at this point: the
    // labels come from arithmetic, not from reading.
    const prediction = predictAt(scalePxPerCm, round === 0 ? 0.012 : 0.008)
    solvedFor = prediction.solved
    chainSolutions.clear()
    for (const [k, v] of prediction.solutions) chainSolutions.set(k, v)
    const examples = harvestAt(solvedFor)
    if (examples.length === 0) break
    templates = buildTemplates(examples)
    templates.labels = solvedFor.size

    // Read every label the bank can read.
    decoded = new Map()
    rejectionsByZone = new Map()
    zones.forEach((z, i) => {
      const read = classifyRun(z.glyphs, templates, opts.classify)
      if (read.reasons.length > 0) rejectionsByZone.set(i, read.reasons)
      if (read.text !== null) decoded.set(i, { text: read.text, glyphConfidence: read.confidence })
    })

    // Re-estimate the scale from the labels that read, using only chain
    // segments (they have a baseline to compare against) whose reading is
    // within a few percent of their own pixel length. This is the step that
    // makes the loop self-correcting: the scale stops depending on the
    // published-area calibration as soon as two labels have been read.
    const ratios: number[] = []
    for (const cg of chainGeometry) {
      for (const p of cg.parts) {
        const read = decoded.get(p.i)
        if (!read) continue
        const value = Number(read.text)
        if (!Number.isFinite(value) || value <= 0) continue
        const implied = p.z.lengthPx / value
        if (Math.abs(implied - scalePxPerCm) > scalePxPerCm * 0.06) continue
        ratios.push(implied)
      }
      if (cg.overallEntry) {
        const read = decoded.get(cg.overallEntry.i)
        const length = cg.overall
        if (read && length !== null && length > 0) {
          const value = Number(read.text)
          if (Number.isFinite(value) && value > 0) {
            const implied = length / value
            if (Math.abs(implied - scalePxPerCm) <= scalePxPerCm * 0.06) {
              // An overall dimension spans the most pixels, so it measures the
              // scale best; count it several times.
              ratios.push(implied, implied, implied)
            }
          }
        }
      }
    }
    if (ratios.length === 0) break
    ratios.sort((a, b) => a - b)
    const next = ratios[Math.floor(ratios.length / 2)]
    const moved = Math.abs(next - scalePxPerCm) / scalePxPerCm
    scalePxPerCm = next
    learnScaleUsed = next * 100
    notes.push(
      `round ${round + 1}: ${solvedFor.size} labels predicted, ${templates.examples} examples over ` +
        `{${templates.alphabet}}, ${decoded.size} labels read, scale ${(next * 100).toFixed(2)} px/m ` +
        `(moved ${(moved * 100).toFixed(2)}%)`,
    )
    if (moved < 0.0005) break
  }
  notes.push(...templates.notes)

  const tokens: DimensionReadResult['tokens'] = []
  let unreadZones = 0
  zones.forEach((z, i) => {
    const read = decoded.get(i)
    if (!read) {
      unreadZones++
      return
    }
    const box = z.glyphs.reduce<PixelBox>(
      (acc, g) => ({
        x0: Math.min(acc.x0, g.sourceBox.x0),
        y0: Math.min(acc.y0, g.sourceBox.y0),
        x1: Math.max(acc.x1, g.sourceBox.x1),
        y1: Math.max(acc.y1, g.sourceBox.y1),
      }),
      { x0: Number.POSITIVE_INFINITY, y0: Number.POSITIVE_INFINITY, x1: -1, y1: -1 },
    )
    tokens.push({
      text: read.text,
      glyphConfidence: read.glyphConfidence,
      confidence: read.glyphConfidence.reduce((a, v) => Math.min(a, v), 1),
      tokenBoxes: z.glyphs.map((g) => g.sourceBox),
      box,
      orientation: z.orientation,
      recogniser: 'template/harvested',
      kind: z.kind,
      zoneId: z.zone?.id ?? z.calloutId ?? `lv_${z.levelRow ?? 0}`,
    })
  })

  // --- chains ---------------------------------------------------------
  const chains: DimensionChain[] = []
  for (const cg of chainGeometry) {
    if (cg.parts.length === 0) continue
    const line = cg.line
    const anchors: DimensionAnchor[] = line.ticks.map((t, k) => ({
      id: mkId('danchor', assetId, line.id, k),
      at: line.orientation === 'HORIZONTAL' ? { x: t, y: line.position } : { x: line.position, y: t },
      evidence: k === 0 || k === line.ticks.length - 1 ? 'BASELINE_END' : 'TICK',
    }))
    const segments: DimensionSegment[] = cg.parts.map(({ z, i }) => {
      const idx = z.zone?.segmentIndex ?? 0
      const read = decoded.get(i)
      const interpreted = read
        ? interpretToken(read.text, z.kind, opts.grammar)
        : { candidates: [], rejections: rejectionsByZone.get(i) ?? ['label not read'] }
      return {
        id: mkId('dseg', assetId, line.id, idx),
        startAnchorId: anchors[idx]?.id ?? '',
        endAnchorId: anchors[idx + 1]?.id ?? '',
        lengthPx: z.lengthPx,
        candidates: interpreted.candidates,
        metres: null,
        fidelity: 'UNRESOLVED' as const,
        rejections: interpreted.rejections,
        confidence: 0,
      }
    })
    const overallRead = cg.overallEntry ? decoded.get(cg.overallEntry.i) : undefined
    const overallInterp = overallRead ? interpretToken(overallRead.text, 'CHAIN_OVERALL', opts.grammar) : null
    const raw: DimensionChain = {
      id: mkId('dchain', assetId, line.id),
      orientation: line.orientation,
      baseline:
        line.orientation === 'HORIZONTAL'
          ? { a: { x: line.from, y: line.position }, b: { x: line.to, y: line.position } }
          : { a: { x: line.position, y: line.from }, b: { x: line.position, y: line.to } },
      anchors,
      segments,
      ...(cg.overallEntry && overallInterp
        ? {
            overall: {
              candidates: overallInterp.candidates,
              metres: null,
              lengthPx: cg.overall ?? 0,
              fidelity: 'UNRESOLVED' as const,
            },
          }
        : {}),
      sourceAssetId: assetId,
      closureResidualM: null,
      closes: false,
      confidence: 0,
    }
    chains.push(solveChain(raw, opts.chain))
  }

  const { pixelsPerMetre, spread } = consensusScale(
    chains.filter((c) => c.segments.some((sg) => sg.fidelity === 'SOURCE_EXACT' || sg.fidelity === 'SOURCE_CORROBORATED')),
  )
  if (pixelsPerMetre !== null) {
    notes.push(
      `${chains.length} chains imply ${pixelsPerMetre.toFixed(2)} px/m (spread ${(spread * 100).toFixed(1)}%)` +
        (opts.pixelsPerMetre ? `, calibrated ${opts.pixelsPerMetre.toFixed(2)} px/m` : ''),
    )
  }

  // --- callouts -------------------------------------------------------
  const callouts: OpeningCallout[] = []
  for (const marker of geometry.callouts) {
    const upper = zones.findIndex((z) => z.calloutId === marker.id && z.kind === 'OPENING_CALLOUT_WIDTH')
    const lower = zones.findIndex((z) => z.calloutId === marker.id && z.kind === 'OPENING_CALLOUT_HEIGHT')
    const wRead = upper >= 0 ? decoded.get(upper) : undefined
    const hRead = lower >= 0 ? decoded.get(lower) : undefined
    const wInt = wRead ? interpretToken(wRead.text, 'OPENING_CALLOUT_WIDTH', opts.grammar) : null
    const hInt = hRead ? interpretToken(hRead.text, 'OPENING_CALLOUT_HEIGHT', opts.grammar) : null
    const widthM = wInt?.candidates[0]?.metres ?? null
    const heightM = hInt?.candidates[0]?.metres ?? null
    callouts.push({
      id: mkId('callout', assetId, marker.id),
      sourceAssetId: assetId,
      at: marker.centre,
      leaderEnd: marker.leaderEnd,
      widthCandidates: wInt?.candidates ?? [],
      heightCandidates: hInt?.candidates ?? [],
      widthM,
      heightM,
      // A callout is only exact once *both* numbers read: a width without a
      // height cannot be checked against anything and is not a dimension pair.
      fidelity: widthM !== null && heightM !== null ? 'SOURCE_EXACT' : 'UNRESOLVED',
      confidence: widthM !== null && heightM !== null ? 0.8 : 0,
    })
  }

  // --- levels ---------------------------------------------------------
  const levels: LevelAnnotation[] = []
  zones.forEach((z, i) => {
    if (z.kind !== 'LEVEL_MARKER') return
    const read = decoded.get(i)
    if (!read) return
    const interpreted = interpretToken(read.text, 'LEVEL_MARKER', opts.grammar)
    const signed = interpreted.candidates.find((c) => c.interpretation === 'METRES_SIGNED')
    if (!signed) return
    levels.push({
      id: mkId('level', assetId, z.levelRow ?? 0, z.box.x0),
      sourceAssetId: assetId,
      at: { x: (z.box.x0 + z.box.x1) / 2, y: z.levelRow ?? z.box.y1 },
      candidates: interpreted.candidates,
      metres: signed.metres,
      fidelity: 'SOURCE_EXACT',
      confidence: signed.confidence,
    })
  })

  const exactSegments = chains.reduce(
    (n, c) => n + c.segments.filter((s) => s.fidelity === 'SOURCE_EXACT' || s.fidelity === 'SOURCE_CORROBORATED').length,
    0,
  )
  notes.push(
    `read ${tokens.length} tokens (${unreadZones} zones unreadable): ` +
      `${exactSegments} exact chain segments, ${callouts.filter((c) => c.fidelity === 'SOURCE_EXACT').length} opening callouts, ` +
      `${levels.length} level markers`,
  )

  return {
    assetId,
    geometry,
    chains,
    callouts,
    levels,
    tokens,
    unreadZones,
    templates,
    pixelsPerMetre,
    scaleSpread: spread,
    notes,
  }
}
