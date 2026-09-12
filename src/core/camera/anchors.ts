/**
 * 3D-2D anchor derivation (§21).
 *
 * Anchors are recorded *after* a pose is fitted, not required before it.
 * Establishing semantic correspondences from scratch on an architectural render
 * is the hard part of the problem and gets it wrong often; fitting the
 * silhouette first and then asking which anchors the pose actually explains
 * yields the same structure with none of the fragility, and it gives the
 * residual that camera confidence is graded on.
 *
 * The resulting AnchorMatch list is exactly what a future Kotlin/OpenCV
 * implementation would hand to solvePnP for refinement (§23).
 *
 * The manual reference model is never a source of anchors (§21, §39).
 *
 * PORT_DIRECT (Kotlin).
 */
import type { AnchorMatch } from '../contracts/camera.js'
import type { Anchor3D } from '../hypotheses/tessellate.js'
import type { Feature2D } from '../scaffold/render-features.js'
import type { CameraView } from './projector.js'
import { project } from './projector.js'
import { pointVisibility, type RenderTarget } from './render.js'

export type AnchorMatchOptions = {
  /** Search radius as a fraction of the image diagonal. */
  radiusFraction: number
  /** Anchor kinds may only match feature kinds that could plausibly produce them. */
  strictKinds: boolean
}

export const DEFAULT_ANCHOR_MATCH: AnchorMatchOptions = { radiusFraction: 0.04, strictKinds: true }

const COMPATIBLE: Record<string, ReadonlySet<Feature2D['kind']>> = {
  MASS_CORNER: new Set(['OUTLINE_CORNER', 'SKYLINE_STEP', 'SKYLINE_PEAK', 'SEGMENT_END']),
  GARAGE_CORNER: new Set(['OUTLINE_CORNER', 'SKYLINE_STEP', 'SEGMENT_END']),
  RIDGE_END: new Set(['SKYLINE_PEAK', 'SKYLINE_STEP', 'SEGMENT_END']),
  EAVE_END: new Set(['SKYLINE_STEP', 'OUTLINE_CORNER', 'SEGMENT_END']),
  GROUND_CORNER: new Set(['OUTLINE_CORNER', 'SEGMENT_END']),
  OPENING_GROUP_CENTROID: new Set(['OPENING_CENTROID']),
  OPENING_GROUP_CORNER: new Set(['OPENING_CORNER', 'SEGMENT_END']),
  BALCONY_CORNER: new Set(['SEGMENT_END', 'SKYLINE_STEP']),
  PORTAL_CORNER: new Set(['SEGMENT_END', 'OPENING_CORNER']),
}

export type AnchorDerivation = {
  matches: AnchorMatch[]
  /** Anchors that should have been visible but found no feature nearby. */
  unmatchedVisible: string[]
  /** Anchors correctly excluded because they are occluded or out of frame. */
  notVisible: string[]
  meanResidualPx: number | null
}

/**
 * Match projected anchors to detected image features.
 *
 * Only anchors that the visibility engine says should actually appear are
 * eligible (§34). An anchor hidden behind the garage wing or outside the crop
 * failing to match is not evidence against the hypothesis, and counting it as
 * such is how a correct model gets penalised for being correctly occluded.
 */
export function deriveAnchors(
  anchors: readonly Anchor3D[],
  features: readonly Feature2D[],
  view: CameraView,
  target: RenderTarget,
  /** Scale from the render target's frame to the source image frame. */
  featureScale: number,
  opts: AnchorMatchOptions = DEFAULT_ANCHOR_MATCH,
): AnchorDerivation {
  const diagonal = Math.hypot(view.width, view.height)
  const radius = diagonal * opts.radiusFraction
  const matches: AnchorMatch[] = []
  const unmatchedVisible: string[] = []
  const notVisible: string[] = []
  const used = new Set<string>()

  for (const anchor of anchors) {
    const verdict = pointVisibility(anchor.world, view, target)
    if (!verdict.visible) {
      notVisible.push(anchor.id)
      continue
    }
    const p = project(anchor.world, view)
    if (!p.visible) {
      notVisible.push(anchor.id)
      continue
    }
    const allowed = COMPATIBLE[anchor.kind]
    let best: { feature: Feature2D; distance: number } | null = null
    for (const f of features) {
      if (used.has(f.id)) continue
      if (opts.strictKinds && allowed && !allowed.has(f.kind)) continue
      const fu = f.u / featureScale
      const fv = f.v / featureScale
      const d = Math.hypot(fu - p.u, fv - p.v)
      if (d > radius) continue
      if (!best || d < best.distance) best = { feature: f, distance: d }
    }
    if (!best) {
      unmatchedVisible.push(anchor.id)
      continue
    }
    used.add(best.feature.id)
    matches.push({
      id: `${anchor.id}__${best.feature.id}`,
      kind: anchor.kind,
      world: anchor.world,
      image: { u: best.feature.u / featureScale, v: best.feature.v / featureScale },
      confidence: Math.min(0.95, anchor.weight * best.feature.strength * (1 - best.distance / radius)),
      provenance: `${best.feature.kind} from the source image, matched to ${anchor.ownerId}`,
      residualPx: best.distance,
    })
  }

  const meanResidualPx =
    matches.length === 0 ? null : matches.reduce((s, m) => s + (m.residualPx ?? 0), 0) / matches.length
  matches.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return { matches, unmatchedVisible, notVisible, meanResidualPx }
}
