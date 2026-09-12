/**
 * Deterministic bounded optimisation helpers.
 *
 * Two strategies, both bounded by construction (§49 forbids an unbounded
 * optimizer):
 *   - `gridSearch`: coarse enumeration of a parameter box, top-K retained.
 *   - `levenbergMarquardt`: local refinement with numeric Jacobian.
 *
 * PORT_DIRECT (Kotlin). The residual callback shape maps to a functional
 * interface; nothing here touches platform APIs.
 */

import { mat, mset, ata, atb, solveSPD } from './linalg.js'

export type ResidualFn = (params: Float64Array) => Float64Array

export type LMOptions = {
  maxIterations: number
  initialDamping: number
  /** Per-parameter finite-difference step. */
  steps: Float64Array
  lower?: Float64Array
  upper?: Float64Array
  /** Stop when relative cost improvement drops below this. */
  tolerance: number
}

export type LMResult = {
  params: Float64Array
  cost: number
  iterations: number
  converged: boolean
}

const cost = (r: Float64Array): number => {
  let s = 0
  for (let i = 0; i < r.length; i++) s += r[i] * r[i]
  return s
}

function clampParams(p: Float64Array, lo?: Float64Array, hi?: Float64Array): void {
  if (!lo && !hi) return
  for (let i = 0; i < p.length; i++) {
    if (lo && p[i] < lo[i]) p[i] = lo[i]
    if (hi && p[i] > hi[i]) p[i] = hi[i]
  }
}

export function levenbergMarquardt(
  residual: ResidualFn,
  start: Float64Array,
  opts: LMOptions,
): LMResult {
  const n = start.length
  let params = Float64Array.from(start)
  clampParams(params, opts.lower, opts.upper)
  let r = residual(params)
  let c = cost(r)
  let lambda = opts.initialDamping
  let iterations = 0
  let converged = false

  for (let it = 0; it < opts.maxIterations; it++) {
    iterations++
    const m = r.length
    const j = mat(m, n)
    // Forward differences: cheaper than central and adequate at this scale.
    for (let k = 0; k < n; k++) {
      const h = opts.steps[k]
      const bumped = Float64Array.from(params)
      bumped[k] += h
      clampParams(bumped, opts.lower, opts.upper)
      const actualH = bumped[k] - params[k]
      if (Math.abs(actualH) < 1e-15) continue
      const rb = residual(bumped)
      for (let i = 0; i < m; i++) mset(j, i, k, (rb[i] - r[i]) / actualH)
    }

    const jtj = ata(j)
    const jtr = atb(j, r)
    for (let i = 0; i < n; i++) jtr[i] = -jtr[i]

    let stepTaken = false
    for (let attempt = 0; attempt < 8; attempt++) {
      const damped = { rows: n, cols: n, data: Float64Array.from(jtj.data) }
      for (let i = 0; i < n; i++) damped.data[i * n + i] += lambda * (1 + damped.data[i * n + i])
      const delta = solveSPD(damped, jtr)
      if (!delta) {
        lambda *= 10
        continue
      }
      const candidate = Float64Array.from(params)
      for (let i = 0; i < n; i++) candidate[i] += delta[i]
      clampParams(candidate, opts.lower, opts.upper)
      const rc = residual(candidate)
      const cc = cost(rc)
      if (cc < c) {
        const improvement = (c - cc) / Math.max(c, 1e-12)
        params = candidate
        r = rc
        c = cc
        lambda = Math.max(lambda * 0.3, 1e-12)
        stepTaken = true
        if (improvement < opts.tolerance) converged = true
        break
      }
      lambda *= 10
    }
    if (!stepTaken || converged) {
      converged = converged || !stepTaken
      break
    }
  }

  return { params, cost: c, iterations, converged }
}

export type GridAxis = { min: number; max: number; steps: number }

/** Enumerate a bounded parameter box. Total evaluations = product of steps. */
export function* gridPoints(axes: readonly GridAxis[]): Generator<Float64Array> {
  const n = axes.length
  const idx = new Array<number>(n).fill(0)
  const total = axes.reduce((a, ax) => a * Math.max(1, ax.steps), 1)
  for (let c = 0; c < total; c++) {
    const p = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      const ax = axes[i]
      p[i] = ax.steps <= 1 ? ax.min : ax.min + ((ax.max - ax.min) * idx[i]) / (ax.steps - 1)
    }
    yield p
    for (let i = n - 1; i >= 0; i--) {
      idx[i]++
      if (idx[i] < Math.max(1, axes[i].steps)) break
      idx[i] = 0
    }
  }
}

export type Scored<T> = { value: T; score: number }

/**
 * Keep the K lowest-scoring items. Ties break on insertion order, so the result
 * is deterministic for a deterministic input order.
 */
export function topK<T>(items: Iterable<Scored<T>>, k: number): Scored<T>[] {
  const all: Array<Scored<T> & { seq: number }> = []
  let seq = 0
  for (const it of items) all.push({ ...it, seq: seq++ })
  all.sort((a, b) => (a.score === b.score ? a.seq - b.seq : a.score - b.score))
  return all.slice(0, k).map(({ value, score }) => ({ value, score }))
}
