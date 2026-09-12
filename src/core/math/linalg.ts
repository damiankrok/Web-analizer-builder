/**
 * Small dense linear algebra. Deliberately tiny and dependency-free: the camera
 * solver needs symmetric positive-definite solves of at most ~10x10.
 *
 * PORT_DIRECT (Kotlin): flat DoubleArray row-major matrices.
 */

export type Matrix = { rows: number; cols: number; data: Float64Array }

export function mat(rows: number, cols: number): Matrix {
  return { rows, cols, data: new Float64Array(rows * cols) }
}

export const mget = (m: Matrix, r: number, c: number): number => m.data[r * m.cols + c]
export const mset = (m: Matrix, r: number, c: number, v: number): void => {
  m.data[r * m.cols + c] = v
}

/** A^T * A for a tall matrix A. */
export function ata(a: Matrix): Matrix {
  const n = a.cols
  const out = mat(n, n)
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      let s = 0
      for (let k = 0; k < a.rows; k++) s += a.data[k * n + i] * a.data[k * n + j]
      out.data[i * n + j] = s
      out.data[j * n + i] = s
    }
  }
  return out
}

/** A^T * b. */
export function atb(a: Matrix, b: Float64Array): Float64Array {
  const out = new Float64Array(a.cols)
  for (let i = 0; i < a.cols; i++) {
    let s = 0
    for (let k = 0; k < a.rows; k++) s += a.data[k * a.cols + i] * b[k]
    out[i] = s
  }
  return out
}

/**
 * Solve A x = b for a symmetric positive-definite A via Cholesky.
 * Returns null when A is not positive definite (caller bumps LM damping).
 */
export function solveSPD(a: Matrix, b: Float64Array): Float64Array | null {
  const n = a.rows
  const l = new Float64Array(n * n)
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = a.data[i * n + j]
      for (let k = 0; k < j; k++) s -= l[i * n + k] * l[j * n + k]
      if (i === j) {
        if (s <= 1e-14) return null
        l[i * n + i] = Math.sqrt(s)
      } else {
        l[i * n + j] = s / l[j * n + j]
      }
    }
  }
  const y = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    let s = b[i]
    for (let k = 0; k < i; k++) s -= l[i * n + k] * y[k]
    y[i] = s / l[i * n + i]
  }
  const x = new Float64Array(n)
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i]
    for (let k = i + 1; k < n; k++) s -= l[k * n + i] * x[k]
    x[i] = s / l[i * n + i]
  }
  return x
}

/**
 * Unit eigenvector of the smallest eigenvalue of a symmetric 3x3, via inverse
 * power iteration on (M + eps I). Used for total-least-squares line fits and
 * for vanishing-point estimation from line families.
 *
 * Deterministic: fixed start vector, fixed iteration count.
 */
export function smallestEigenvector3(m: readonly number[]): [number, number, number] {
  const trace = m[0] + m[4] + m[8]
  const shift = Math.abs(trace) * 1e-9 + 1e-12
  const a = mat(3, 3)
  for (let i = 0; i < 9; i++) a.data[i] = m[i]
  a.data[0] += shift
  a.data[4] += shift
  a.data[8] += shift

  let v = new Float64Array([0.5773502691896258, 0.5773502691896258, 0.5773502691896258])
  for (let it = 0; it < 64; it++) {
    const solved = solveSPD(a, v)
    if (!solved) break
    const n = Math.hypot(solved[0], solved[1], solved[2])
    if (n < 1e-300 || !Number.isFinite(n)) break
    const next = new Float64Array([solved[0] / n, solved[1] / n, solved[2] / n])
    const delta = Math.hypot(next[0] - v[0], next[1] - v[1], next[2] - v[2])
    const deltaFlip = Math.hypot(next[0] + v[0], next[1] + v[1], next[2] + v[2])
    v = next
    if (Math.min(delta, deltaFlip) < 1e-14) break
  }
  // Canonical sign so the result is byte-stable across runs.
  const i = Math.abs(v[0]) >= Math.abs(v[1]) && Math.abs(v[0]) >= Math.abs(v[2]) ? 0 : Math.abs(v[1]) >= Math.abs(v[2]) ? 1 : 2
  const s = v[i] < 0 ? -1 : 1
  return [v[0] * s, v[1] * s, v[2] * s]
}
