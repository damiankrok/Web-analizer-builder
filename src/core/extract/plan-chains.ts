/**
 * What a printed dimension chain says the building is — STAGE WEB-PIVOT-07A §5.
 *
 * A chain is the strongest metric statement a plan makes, and it says more
 * than a list of lengths. Its ticks are the faces the draughtsman is
 * dimensioning, in order, and the gaps between them are what those faces
 * bound. Read that way, one chain answers the question Stage 07R could not:
 *
 *   100 | 1260 | 100
 *
 * down the right-hand side of project A's ground plan is not a 14.60 m
 * building. It is a metre of something, then 12.60 m of something else, then
 * another metre — and which of those is structure is decided by what stands
 * behind each face, not by which number is biggest.
 *
 * So this module reports two extents per axis and keeps them apart:
 *
 * **The structural core.** The longest stretch of the chain whose two ends are
 * both faces with enclosed space behind them. On project A that is the 1260
 * segment, and it agrees with the wall faces to 24 mm.
 *
 * **The full architectural extent.** The whole chain, first tick to last. The
 * difference between the two is the projections — a terrace at one end, an
 * entrance at the other — reported one by one rather than folded into the
 * building's size.
 *
 * Nothing here knows any project's numbers. It reads the chain the candidate
 * carries, and the candidate read it off the sheet.
 *
 * PORT_DIRECT (Kotlin).
 */
import type { CandidateStorey } from './spec-candidate.js'

/** One tick on a printed chain, in the storey's own plan frame. */
export type ChainTick = {
  atM: number
  atPx: number
  /** The dimension segments that meet here. */
  dimensionIds: string[]
}

export type ChainSegment = {
  dimensionId: string
  text: string
  /** What the drawing prints, metres. */
  statedM: number
  /** What the ticks measure, metres. Agreement is the chain's own check. */
  measuredM: number
  fromM: number
  toM: number
}

/**
 * One chain, as printed: its ticks in order and what it says between them.
 *
 * A chain with one segment is still a chain; it simply says less.
 */
export type PlanChain = {
  baselineId: string
  storey: string
  axis: 'X' | 'Z'
  ticks: ChainTick[]
  segments: ChainSegment[]
  /** First tick to last, metres. */
  extentM: number
  /** What the printed figures sum to, metres. Should equal `extentM`. */
  statedSumM: number
  /** Metres of disagreement between the two. */
  residualM: number
}

/** The chains one storey prints, one per baseline and axis. */
export function chainsOf(storey: CandidateStorey): PlanChain[] {
  const byLine = new Map<string, typeof storey.dimensions>()
  for (const d of storey.dimensions) {
    if (!d.span) continue
    const key = `${d.span.baselineId}|${d.span.axis}`
    const list = byLine.get(key) ?? []
    list.push(d)
    byLine.set(key, list)
  }
  const out: PlanChain[] = []
  for (const [key, dims] of byLine) {
    const [baselineId, axis] = key.split('|') as [string, 'X' | 'Z']
    const sorted = [...dims].sort((a, b) => a.span!.fromM - b.span!.fromM)
    const segments: ChainSegment[] = sorted.map((d) => ({
      dimensionId: d.id,
      text: d.text,
      statedM: d.valueM,
      measuredM: d.span!.toM - d.span!.fromM,
      fromM: d.span!.fromM,
      toM: d.span!.toM,
    }))
    // Ticks: every segment end, with ends that land on each other merged. Two
    // segments of one chain share a tick; two chains that happen to share a
    // baseline do not, and the gap between them shows as a tick pair.
    const marks: Array<{ atM: number; atPx: number; ids: string[] }> = []
    const tolM = 0.02
    for (const d of sorted) {
      for (const [atM, atPx] of [
        [d.span!.fromM, d.span!.fromPx],
        [d.span!.toM, d.span!.toPx],
      ] as const) {
        const near = marks.find((m) => Math.abs(m.atM - atM) <= tolM)
        if (near) near.ids.push(d.id)
        else marks.push({ atM, atPx, ids: [d.id] })
      }
    }
    marks.sort((a, b) => a.atM - b.atM)
    const ticks: ChainTick[] = marks.map((m) => ({ atM: m.atM, atPx: m.atPx, dimensionIds: [...new Set(m.ids)] }))
    const extentM = ticks.length >= 2 ? ticks[ticks.length - 1].atM - ticks[0].atM : 0
    const statedSumM = segments.reduce((n, s) => n + s.statedM, 0)
    out.push({
      baselineId,
      storey: storey.storey,
      axis,
      ticks,
      segments,
      extentM,
      statedSumM,
      residualM: Math.abs(extentM - statedSumM),
    })
  }
  return out.sort((a, b) => b.extentM - a.extentM)
}

/**
 * The longest chain on an axis, where one is long enough to be about the
 * building rather than about a cupboard.
 *
 * "Long enough" is relative to what the storey's chains measure: a chain that
 * spans less than half of the longest on its axis is dimensioning a part.
 */
export function principalChain(chains: readonly PlanChain[], axis: 'X' | 'Z'): PlanChain | null {
  const here = chains.filter((c) => c.axis === axis && c.ticks.length >= 2)
  if (here.length === 0) return null
  const longest = here[0]
  return longest.extentM > 0 ? longest : null
}

/** Something the chain measures beyond the structural core. */
export type Projection = {
  /** Which end of the axis it is on. */
  end: 'LOW' | 'HIGH'
  axis: 'X' | 'Z'
  fromM: number
  toM: number
  depthM: number
  /** What the drawing prints for it, where a segment states it. */
  statedM: number | null
  why: string
}

/**
 * The chain read against the faces: which stretch is structure, and what the
 * rest of it is.
 *
 * `coreFromM`/`coreToM` are the outermost ticks that a structural face stands
 * on. Everything outside them, tick by tick, is a projection: a terrace, an
 * entrance, a canopy — the chain measures it and the building does not stop
 * there, and both of those are worth saying.
 */
export type ChainReading = {
  axis: 'X' | 'Z'
  chain: PlanChain
  coreFromM: number
  coreToM: number
  coreM: number
  fullFromM: number
  fullToM: number
  fullM: number
  projections: Projection[]
  /** Faces the chain corroborated, and how far off each was. */
  corroboration: Array<{ faceM: number; tickM: number; residualM: number }>
  why: string
}

/**
 * Read a chain against a set of structural faces.
 *
 * A tick corroborates a face when they land within `toleranceM` of each other.
 * The core is bounded by the outermost corroborated ticks; a face further out
 * than any tick is not the building's, whatever stands behind it, because the
 * drawing dimensioned the building and did not dimension that.
 */
export function readChain(
  chain: PlanChain,
  faces: readonly number[],
  toleranceM: number,
): ChainReading | null {
  if (chain.ticks.length < 2) return null
  const corroboration: Array<{ faceM: number; tickM: number; residualM: number }> = []
  const corroborated: number[] = []
  for (const tick of chain.ticks) {
    let best: { faceM: number; d: number } | null = null
    for (const face of faces) {
      const d = Math.abs(face - tick.atM)
      if (d > toleranceM) continue
      if (!best || d < best.d) best = { faceM: face, d }
    }
    if (!best) continue
    corroborated.push(tick.atM)
    corroboration.push({ faceM: best.faceM, tickM: tick.atM, residualM: best.d })
  }
  if (corroborated.length < 2) return null
  const coreFromM = Math.min(...corroborated)
  const coreToM = Math.max(...corroborated)
  const fullFromM = chain.ticks[0].atM
  const fullToM = chain.ticks[chain.ticks.length - 1].atM
  const projections: Projection[] = []
  for (const tick of chain.ticks) {
    if (tick.atM < coreFromM - 1e-6) {
      const next = chain.ticks.filter((t) => t.atM > tick.atM).sort((a, b) => a.atM - b.atM)[0]
      if (!next) continue
      const segment = chain.segments.find((s) => Math.abs(s.fromM - tick.atM) <= 0.02)
      projections.push({
        end: 'LOW',
        axis: chain.axis,
        fromM: tick.atM,
        toM: next.atM,
        depthM: next.atM - tick.atM,
        statedM: segment?.statedM ?? null,
        why: 'the chain measures this beyond the outermost face with enclosed space behind it',
      })
    } else if (tick.atM > coreToM + 1e-6) {
      const prev = chain.ticks.filter((t) => t.atM < tick.atM).sort((a, b) => b.atM - a.atM)[0]
      if (!prev) continue
      const segment = chain.segments.find((s) => Math.abs(s.toM - tick.atM) <= 0.02)
      projections.push({
        end: 'HIGH',
        axis: chain.axis,
        fromM: prev.atM,
        toM: tick.atM,
        depthM: tick.atM - prev.atM,
        statedM: segment?.statedM ?? null,
        why: 'the chain measures this beyond the outermost face with enclosed space behind it',
      })
    }
  }
  return {
    axis: chain.axis,
    chain,
    coreFromM,
    coreToM,
    coreM: coreToM - coreFromM,
    fullFromM,
    fullToM,
    fullM: fullToM - fullFromM,
    projections,
    corroboration,
    why:
      `${chain.baselineId} prints ${chain.segments.map((s) => s.text).join(' + ')} = ` +
      `${chain.statedSumM.toFixed(2)} m over ${chain.extentM.toFixed(2)} m of sheet; ` +
      `${corroboration.length} of its ${chain.ticks.length} ticks land on a structural face, the ` +
      `outermost at ${coreFromM.toFixed(3)} and ${coreToM.toFixed(3)} m, ` +
      `so the core measures ${(coreToM - coreFromM).toFixed(2)} m and the chain's full extent ` +
      `${(fullToM - fullFromM).toFixed(2)} m`,
  }
}
