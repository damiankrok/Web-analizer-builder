/**
 * Pixel anchors for the two published Marcowki floor plans — development only.
 *
 * The two floors are published at different offsets: ARCHON scales each plan to
 * fill the same square canvas, and the attic plan is the narrower main body
 * plus a balcony, so its origin is not the ground plan's. The anchors are
 * *stated* rather than detected, because a detector that guessed the
 * calibration would be the one thing in this stage nobody could check.
 *
 * `ground` is anchored on the outermost wall ink in both axes. `upper` is
 * anchored on the west and east wall ink across, and along the building by the
 * partitions the printed chain 449 | 202 | 248 | 235 lands on: the plan's
 * topmost ink there is the roof edge above the balcony, not a wall.
 *
 * The mapping is affine and orthographic — two anchors per axis and nothing
 * else — which is what lets the §16 overlays put the gold geometry straight
 * onto the drawing with no perspective fitting anywhere.
 */
export const PLAN_CALIBRATIONS = {
  ground: { x0Px: 58, x1Px: 513, z0Px: 259, z1Px: 735, widthM: 12.05, depthM: 12.6 },
  upper: { x0Px: 47, x1Px: 345.2, z0Px: 195.3, z1Px: 670.8, widthM: 7.9, depthM: 12.6 },
} as const

export type PlanName = keyof typeof PLAN_CALIBRATIONS

/** Metres to pixels and back, for one plan. */
export function planMapper(name: PlanName): {
  sx: number
  sz: number
  xToM: (px: number) => number
  zToM: (py: number) => number
  mToX: (m: number) => number
  mToZ: (m: number) => number
} {
  const C = PLAN_CALIBRATIONS[name]
  const sx = (C.x1Px - C.x0Px) / C.widthM
  const sz = (C.z1Px - C.z0Px) / C.depthM
  return {
    sx,
    sz,
    xToM: (px) => (px - C.x0Px) / sx,
    zToM: (py) => (py - C.z0Px) / sz,
    mToX: (m) => C.x0Px + m * sx,
    mToZ: (m) => C.z0Px + m * sz,
  }
}
