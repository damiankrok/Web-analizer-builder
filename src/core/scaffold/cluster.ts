/**
 * Weighted one-dimensional clustering, used to turn a scatter of detected
 * segments into the handful of levels and wall faces a drawing actually
 * contains. Deterministic: sorted input, greedy merge, stable ordering.
 *
 * PORT_DIRECT (Kotlin).
 */

export type Cluster1D = {
  /** Length-weighted mean position. */
  position: number
  weight: number
  count: number
  min: number
  max: number
}

export function cluster1D(
  samples: readonly { position: number; weight: number }[],
  tolerance: number,
): Cluster1D[] {
  if (samples.length === 0) return []
  const sorted = [...samples].sort((a, b) => a.position - b.position || a.weight - b.weight)
  const out: Cluster1D[] = []
  let current: { sum: number; weight: number; count: number; min: number; max: number } | null = null
  for (const s of sorted) {
    if (current && s.position - current.max <= tolerance) {
      current.sum += s.position * s.weight
      current.weight += s.weight
      current.count++
      current.max = Math.max(current.max, s.position)
      continue
    }
    if (current) {
      out.push({
        position: current.sum / Math.max(current.weight, 1e-9),
        weight: current.weight,
        count: current.count,
        min: current.min,
        max: current.max,
      })
    }
    current = { sum: s.position * s.weight, weight: s.weight, count: 1, min: s.position, max: s.position }
  }
  if (current) {
    out.push({
      position: current.sum / Math.max(current.weight, 1e-9),
      weight: current.weight,
      count: current.count,
      min: current.min,
      max: current.max,
    })
  }
  return out
}

/** Keep clusters carrying at least `fraction` of the strongest cluster's weight. */
export function significantClusters(clusters: readonly Cluster1D[], fraction: number): Cluster1D[] {
  const max = clusters.reduce((m, c) => Math.max(m, c.weight), 0)
  if (max <= 0) return []
  return clusters.filter((c) => c.weight >= max * fraction)
}
