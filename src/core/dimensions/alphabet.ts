/**
 * Learning the drawing's own digit alphabet (§8A).
 *
 * There is no font file here and no trained model, and there does not need to
 * be, because the drawing is a self-labelling dataset. Most printed dimensions
 * annotate a line whose pixel length, divided by the drawing's scale, already
 * predicts the value to within a couple of percent. A label over a 302-pixel
 * baseline on a 37.9 px/m plan is 790 or something very close to it; the glyph
 * sequence it contains is therefore a picture of '7', '9', '0' in that order.
 * Collect enough such labels and every digit gets named.
 *
 * Two things make this work where a first attempt did not.
 *
 * *Clustering is not the bottleneck and must not be trusted as one.* An
 * earlier version clustered first and labelled second, and produced 167
 * prototypes for ten digits, so almost nothing could be named. Here the
 * assignment is solved over *glyphs*, by constraint propagation: each label
 * with a geometric prediction narrows which digit each of its glyph positions
 * can be, and a glyph's similarity to already-named glyphs propagates that
 * narrowing to the rest of the drawing. Clustering only supplies the
 * similarity, and a wrong merge costs a candidate rather than a digit.
 *
 * *Chain arithmetic is a second, independent constraint.* A chain whose parts
 * must sum to its own overall dimension pins values that pixel lengths alone
 * leave ambiguous, and rejects a reading that is individually plausible but
 * arithmetically impossible (§11).
 *
 * PORT_DIRECT (Kotlin).
 */
import type { TextGlyph } from './recognizer.js'
import { profileSimilarity } from './recognizer.js'

export const DIGITS = '0123456789'

export type LabelObservation = {
  id: string
  /** Glyph sequence, left to right. */
  glyphs: TextGlyph[]
  /** Metres the drawing's geometry predicts, or null when it predicts nothing. */
  predictedMetres: number | null
  /** Fractional tolerance on the prediction. */
  tolerance: number
  /** Unit the value is printed in, when the label kind fixes it. */
  scale: 'CENTIMETRES' | 'METRES' | 'UNKNOWN'
  /**
   * The exact integer the chain solver says this label prints, when a chain
   * this label belongs to solved. One value rather than a range is the whole
   * difference between a decisive vote and forty useless ones.
   */
  solvedInteger?: number
}

export type AlphabetOptions = {
  /** Similarity above which two glyphs are the same character. */
  sameGlyph: number
  /** Similarity below which two glyphs are definitely different characters. */
  differentGlyph: number
  /** Minimum votes before a cluster is named. */
  minVotes: number
}

export const DEFAULT_ALPHABET: AlphabetOptions = {
  sameGlyph: 0.72,
  differentGlyph: 0.42,
  minVotes: 2,
}

export type GlyphCluster = {
  id: number
  members: number[]
  /** Medoid profile. */
  prototype: Float32Array
  meanHoles: number
  meanAspect: number
  /** Character the cluster was named, or null. */
  character: string | null
  /** Votes for each candidate character. */
  votes: Record<string, number>
  confidence: number
}

/**
 * Agglomerative clustering of glyphs by profile similarity.
 *
 * Single-linkage would chain `3`→`8`→`6` into one cluster at this resolution,
 * so linkage is to the cluster medoid and a candidate must also agree on hole
 * count — a topological property that survives blur far better than any stroke
 * detail, and the one feature that reliably separates `8` from `3`.
 */
export function clusterGlyphs(glyphs: readonly TextGlyph[], opts: AlphabetOptions = DEFAULT_ALPHABET): GlyphCluster[] {
  const clusters: GlyphCluster[] = []
  for (let i = 0; i < glyphs.length; i++) {
    const g = glyphs[i]
    let best = -1
    let bestSim = -2
    for (let c = 0; c < clusters.length; c++) {
      const cl = clusters[c]
      if (Math.round(cl.meanHoles) !== g.holes) continue
      const sim = profileSimilarity(cl.prototype, g.profile)
      if (sim > bestSim) {
        bestSim = sim
        best = c
      }
    }
    if (best >= 0 && bestSim >= opts.sameGlyph) {
      const cl = clusters[best]
      cl.members.push(i)
      // Running mean profile, renormalised: cheap, stable, and order-dependent
      // only through the mean, which the medoid pass below removes.
      const n = cl.members.length
      let norm = 0
      for (let k = 0; k < cl.prototype.length; k++) {
        cl.prototype[k] = (cl.prototype[k] * (n - 1) + g.profile[k]) / n
        norm += cl.prototype[k] * cl.prototype[k]
      }
      norm = Math.sqrt(norm)
      if (norm > 1e-6) for (let k = 0; k < cl.prototype.length; k++) cl.prototype[k] /= norm
      cl.meanHoles = (cl.meanHoles * (n - 1) + g.holes) / n
      cl.meanAspect = (cl.meanAspect * (n - 1) + g.aspect) / n
      continue
    }
    clusters.push({
      id: clusters.length,
      members: [i],
      prototype: Float32Array.from(g.profile),
      meanHoles: g.holes,
      meanAspect: g.aspect,
      character: null,
      votes: {},
      confidence: 0,
    })
  }
  return clusters
}

/** Integers with `digits` digits inside a fractional tolerance of `centre`. */
export function candidateIntegers(centre: number, tolerance: number, digits: number): number[] {
  const lo = Math.max(Math.pow(10, digits - 1), Math.ceil(centre * (1 - tolerance)))
  const hi = Math.min(Math.pow(10, digits) - 1, Math.floor(centre * (1 + tolerance)))
  const out: number[] = []
  for (let v = lo; v <= hi; v++) out.push(v)
  return out
}

export type AlphabetResult = {
  clusters: GlyphCluster[]
  /** Cluster id for each glyph index. */
  clusterOf: Int32Array
  /** How many labels contributed a vote. */
  votingLabels: number
  notes: string[]
}

/**
 * Name the clusters from geometric predictions.
 *
 * Each predicted label contributes one vote per glyph position for every value
 * consistent with its prediction, weighted by how tightly the prediction pins
 * that value: a label with a single candidate integer votes decisively, one
 * with twenty votes weakly for each. Summing over the whole drawing lets the
 * confident labels carry the ambiguous ones, and a digit that never appears in
 * a predicted label simply stays unnamed rather than being guessed.
 */
export function learnAlphabet(
  glyphs: readonly TextGlyph[],
  labels: readonly LabelObservation[],
  pixelsPerMetre: number,
  opts: AlphabetOptions = DEFAULT_ALPHABET,
): AlphabetResult {
  const notes: string[] = []
  const clusters = clusterGlyphs(glyphs, opts)
  const clusterOf = new Int32Array(glyphs.length).fill(-1)
  for (const cl of clusters) for (const m of cl.members) clusterOf[m] = cl.id

  const indexOf = new Map<TextGlyph, number>()
  glyphs.forEach((g, i) => indexOf.set(g, i))

  let votingLabels = 0
  for (const label of labels) {
    if (label.glyphs.length === 0) continue
    let candidates: number[]
    if (label.solvedInteger !== undefined) {
      if (String(label.solvedInteger).length !== label.glyphs.length) continue
      candidates = [label.solvedInteger]
    } else {
      if (label.predictedMetres === null) continue
      const unit = label.scale === 'METRES' ? 1 : 100
      candidates = candidateIntegers(label.predictedMetres * unit, label.tolerance, label.glyphs.length)
    }
    if (candidates.length === 0 || candidates.length > 40) continue
    votingLabels++
    const weight = 1 / candidates.length
    for (const value of candidates) {
      const text = String(value)
      if (text.length !== label.glyphs.length) continue
      for (let k = 0; k < label.glyphs.length; k++) {
        const gi = indexOf.get(label.glyphs[k])
        if (gi === undefined) continue
        const cid = clusterOf[gi]
        if (cid < 0) continue
        const ch = text[k]
        clusters[cid].votes[ch] = (clusters[cid].votes[ch] ?? 0) + weight
      }
    }
  }

  // Resolve votes into a naming. A character is claimed by the cluster with
  // the strongest relative support for it, and no character is claimed twice:
  // two clusters reading as the same digit would silently double one stroke
  // shape and corrupt every label containing it.
  type Claim = { cluster: GlyphCluster; ch: string; score: number; share: number }
  const claims: Claim[] = []
  for (const cl of clusters) {
    const total = Object.values(cl.votes).reduce((a, v) => a + v, 0)
    if (total <= 0) continue
    for (const [ch, v] of Object.entries(cl.votes)) claims.push({ cluster: cl, ch, score: v, share: v / total })
  }
  claims.sort((a, b) => b.score * b.share - a.score * a.share)
  const takenChar = new Set<string>()
  for (const c of claims) {
    if (c.cluster.character !== null || takenChar.has(c.ch)) continue
    if (c.score < opts.minVotes * 0.25 || c.share < 0.34) continue
    c.cluster.character = c.ch
    c.cluster.confidence = Math.min(0.95, c.share * Math.min(1, c.score / opts.minVotes))
    takenChar.add(c.ch)
  }

  // Propagate: an unnamed cluster whose prototype is close to a named one is
  // the same character seen under a different threshold or a broken stroke.
  for (const cl of clusters) {
    if (cl.character !== null) continue
    let best: GlyphCluster | null = null
    let bestSim = -2
    for (const other of clusters) {
      if (other.character === null) continue
      if (Math.round(other.meanHoles) !== Math.round(cl.meanHoles)) continue
      const sim = profileSimilarity(other.prototype, cl.prototype)
      if (sim > bestSim) {
        bestSim = sim
        best = other
      }
    }
    if (best && bestSim >= opts.sameGlyph - 0.08) {
      cl.character = best.character
      cl.confidence = Math.max(0, best.confidence * (bestSim - 0.3))
    }
  }

  const named = clusters.filter((c) => c.character !== null)
  const namedChars = [...new Set(named.map((c) => c.character))].sort().join('')
  notes.push(
    `${clusters.length} glyph clusters from ${glyphs.length} glyphs; ${named.length} named ` +
      `covering {${namedChars}} from ${votingLabels} geometrically predicted labels ` +
      `at ${pixelsPerMetre.toFixed(2)} px/m`,
  )
  return { clusters, clusterOf, votingLabels, notes }
}

/** Read a glyph sequence with a learned alphabet. */
export function decodeLabel(
  label: LabelObservation,
  glyphs: readonly TextGlyph[],
  result: AlphabetResult,
): { text: string; glyphConfidence: number[] } | null {
  const indexOf = new Map<TextGlyph, number>()
  glyphs.forEach((g, i) => indexOf.set(g, i))
  let text = ''
  const conf: number[] = []
  for (const g of label.glyphs) {
    const gi = indexOf.get(g)
    if (gi === undefined) return null
    const cid = result.clusterOf[gi]
    if (cid < 0) return null
    const cl = result.clusters[cid]
    if (cl.character === null) return null
    text += cl.character
    conf.push(cl.confidence)
  }
  return { text, glyphConfidence: conf }
}

/**
 * Read a label, allowing unnamed glyphs, and say which positions are unknown.
 *
 * Partial readings are useful rather than noise: a three-glyph label whose
 * first two read `4` and `1` inside a chain that solved to 415 identifies the
 * third glyph as `5`, which names a cluster the geometry alone never reached.
 * That is constraint propagation, and it is how the last few digits of the
 * alphabet get learned (§11).
 */
export function decodePartial(
  label: LabelObservation,
  glyphs: readonly TextGlyph[],
  result: AlphabetResult,
  indexOf: Map<TextGlyph, number>,
): { chars: Array<string | null>; clusterIds: number[]; confidence: number[] } {
  const chars: Array<string | null> = []
  const clusterIds: number[] = []
  const confidence: number[] = []
  for (const g of label.glyphs) {
    const gi = indexOf.get(g)
    const cid = gi === undefined ? -1 : result.clusterOf[gi]
    clusterIds.push(cid)
    if (cid < 0) {
      chars.push(null)
      confidence.push(0)
      continue
    }
    const cl = result.clusters[cid]
    chars.push(cl.character)
    confidence.push(cl.confidence)
  }
  return { chars, clusterIds, confidence }
}

/**
 * Iteratively name the remaining clusters from labels that are almost read.
 *
 * A label whose known glyphs match a solved integer everywhere they are known
 * pins the unknown positions to that integer's digits. Each round can name new
 * clusters, which can complete further labels, so it repeats until nothing
 * changes. Characters already claimed by another cluster are never reassigned:
 * that guard is what stops one confident misreading from cascading.
 */
export function propagateNaming(
  glyphs: readonly TextGlyph[],
  labels: readonly LabelObservation[],
  result: AlphabetResult,
  maxRounds = 6,
): number {
  const indexOf = new Map<TextGlyph, number>()
  glyphs.forEach((g, i) => indexOf.set(g, i))
  let namedTotal = 0
  for (let round = 0; round < maxRounds; round++) {
    const taken = new Set(result.clusters.filter((c) => c.character !== null).map((c) => c.character as string))
    let namedThisRound = 0
    for (const label of labels) {
      if (label.solvedInteger === undefined) continue
      const text = String(label.solvedInteger)
      if (text.length !== label.glyphs.length) continue
      const { chars, clusterIds } = decodePartial(label, glyphs, result, indexOf)
      // Every known position must agree with the solved integer, or this label
      // is not describing that value and must not teach anything.
      let consistent = true
      for (let k = 0; k < chars.length; k++) if (chars[k] !== null && chars[k] !== text[k]) consistent = false
      if (!consistent) continue
      for (let k = 0; k < chars.length; k++) {
        if (chars[k] !== null) continue
        const cid = clusterIds[k]
        if (cid < 0) continue
        const ch = text[k]
        if (taken.has(ch)) continue
        const cl = result.clusters[cid]
        if (cl.character !== null) continue
        cl.character = ch
        cl.confidence = 0.6
        taken.add(ch)
        namedThisRound++
      }
    }
    // Spread each newly named cluster to its near neighbours.
    for (const cl of result.clusters) {
      if (cl.character !== null) continue
      let best: GlyphCluster | null = null
      let bestSim = -2
      for (const other of result.clusters) {
        if (other.character === null) continue
        if (Math.round(other.meanHoles) !== Math.round(cl.meanHoles)) continue
        const sim = profileSimilarity(other.prototype, cl.prototype)
        if (sim > bestSim) {
          bestSim = sim
          best = other
        }
      }
      if (best && bestSim >= 0.62) {
        cl.character = best.character
        cl.confidence = Math.max(0.2, best.confidence * (bestSim - 0.25))
        namedThisRound++
      }
    }
    namedTotal += namedThisRound
    if (namedThisRound === 0) break
  }
  return namedTotal
}
