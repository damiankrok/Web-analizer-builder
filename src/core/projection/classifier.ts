/**
 * ProjectionClassifier (§10). Every visual asset gets a projection type before
 * any camera reasoning touches it, because a technical elevation must never be
 * sent through perspective-camera fitting and a perspective render must never
 * be read as metric until its camera is known.
 *
 * Structure: the publisher's own role is the prior, vanishing geometry is the
 * evidence, and the two are reconciled explicitly.
 *
 * Why not geometry alone. A near-frontal visualisation has almost no measurable
 * convergence — the correct answer for it is "perspective, weakly constrained",
 * and geometry alone cannot distinguish that from a true orthographic
 * elevation. Meanwhile ARCHON publishes its technical elevations as *rendered*
 * images on a photographic backdrop, so appearance is no help either: the
 * elevations are photographic, and they are still orthographic.
 *
 * When geometry actively contradicts the role — a declared elevation with a
 * genuine far vanishing point, say — the contradiction is recorded and the
 * confidence drops, rather than the role being silently flipped. The
 * EvidenceGraph is where contradictions belong.
 *
 * PORT_DIRECT (Kotlin).
 */
import type { GrayImage, RasterImage } from '../contracts/raster.js'
import type { ProjectionType } from '../contracts/camera.js'
import type { AssetRole } from '../contracts/source.js'
import type { Segment } from '../raster/lines.js'
import { analyseVanishingGeometry, DEFAULT_VANISHING, type VanishingGeometry, type VanishingOptions } from './vanishing.js'

export type ProjectionClassification = {
  type: ProjectionType
  confidence: number
  /** Human-readable reasons, surfaced in the debug UI and the report. */
  reasons: string[]
  /** Set when the pixels disagree with the publisher's declared role. */
  contradiction: string | null
  geometry: VanishingGeometry
  diagnostics: {
    verticalConverges: boolean
    horizontalConverges: boolean
    verticalSupport: number
    horizontalSupport: number
    candidateCount: number
    inkFraction: number
    /** Distance of the credited horizontal VP from the centre, in diagonals. */
    horizontalVpDistance: number | null
  }
}

/** Fraction of near-black thin ink on near-white paper: a true line drawing. */
export function inkFraction(g: GrayImage): number {
  let dark = 0
  let light = 0
  for (let i = 0; i < g.data.length; i++) {
    const v = g.data[i]
    if (v < 110) dark++
    else if (v > 225) light++
  }
  const n = g.data.length
  const darkFrac = dark / n
  const lightFrac = light / n
  return lightFrac > 0.55 && darkFrac < 0.35 ? darkFrac : 0
}

export type ClassifyInput = {
  role: AssetRole
  image: RasterImage
  gray: GrayImage
  segments: readonly Segment[]
  options?: VanishingOptions
}

const PLAN_ROLES = new Set<AssetRole>(['PLAN_GROUND', 'PLAN_UPPER', 'PLAN_OTHER', 'SITE_PLAN'])
const ORTHO_ROLES = new Set<AssetRole>([
  'SECTION',
  'ELEVATION_FRONT',
  'ELEVATION_REAR',
  'ELEVATION_LEFT',
  'ELEVATION_RIGHT',
])
const RENDER_ROLES = new Set<AssetRole>(['HERO_RENDER', 'GARDEN_RENDER', 'SIDE_RENDER', 'OTHER_RENDER'])

const deg = (rad: number): string => (Number.isFinite(rad) ? `${((rad * 180) / Math.PI).toFixed(2)}°` : 'inf')

export function classifyProjection(input: ClassifyInput): ProjectionClassification {
  const { image, gray, segments, role } = input
  const opts = input.options ?? DEFAULT_VANISHING
  const diag = Math.hypot(image.width, image.height)
  const geometry = analyseVanishingGeometry(segments, image.width, image.height, opts)
  const ink = inkFraction(gray)
  const reasons: string[] = []

  const credited = geometry.convergentHorizontal
  const horizontalVpDistance =
    credited?.finite != null
      ? Math.hypot(credited.finite.u - image.width / 2, credited.finite.v - image.height / 2) / diag
      : null

  const diagnostics = {
    verticalConverges: geometry.verticalConverges,
    horizontalConverges: geometry.horizontalConverges,
    verticalSupport: geometry.vertical?.supportLength ?? 0,
    horizontalSupport: geometry.horizontals[0]?.supportLength ?? 0,
    candidateCount: geometry.candidates.length,
    inkFraction: ink,
    horizontalVpDistance,
  }

  const describeGeometry = (): void => {
    if (credited?.finite) {
      reasons.push(
        `genuine horizontal vanishing point at (${credited.finite.u.toFixed(0)}, ${credited.finite.v.toFixed(0)}), ` +
          `${horizontalVpDistance?.toFixed(1)} diagonals out, from ${credited.inliers.length} segments: ` +
          `convergent ${deg(credited.convergentResidualRad)} vs parallel ${deg(credited.parallelResidualRad)}`,
      )
    } else {
      const h = geometry.horizontals[0]
      reasons.push(
        'no genuine horizontal vanishing point' +
          (h ? ` (dominant family: convergent ${deg(h.convergentResidualRad)} vs parallel ${deg(h.parallelResidualRad)})` : ''),
      )
    }
    if (geometry.verticalConverges) reasons.push('verticals also converge')
    else reasons.push('verticals are parallel')
  }

  // A plan is a diagram of a horizontal cut. It is not a view of the massing
  // and carries no camera at all.
  if (PLAN_ROLES.has(role)) {
    reasons.push(`role ${role} is a horizontal cut, not a view of the massing`)
    if (ink > 0.01) reasons.push(`ink-on-paper statistics confirm a line diagram (${(ink * 100).toFixed(1)}% ink)`)
    return {
      type: 'PLANAR_DIAGRAM',
      confidence: ink > 0.01 ? 0.95 : 0.8,
      reasons,
      contradiction: null,
      geometry,
      diagnostics,
    }
  }

  if (role === 'INTERIOR_RENDER') {
    reasons.push('interior view: carries no exterior massing evidence')
    return { type: 'UNKNOWN', confidence: 0.5, reasons, contradiction: null, geometry, diagnostics }
  }

  if (ORTHO_ROLES.has(role)) {
    reasons.push(`role ${role} is published as an orthographic source`)
    describeGeometry()
    if (geometry.horizontalConverges) {
      const contradiction =
        `declared orthographic ${role} shows a genuine vanishing point ` +
        `${horizontalVpDistance?.toFixed(1)} diagonals out — treated as orthographic, contradiction recorded`
      reasons.push(contradiction)
      return { type: 'ORTHOGRAPHIC_TECHNICAL', confidence: 0.5, reasons, contradiction, geometry, diagnostics }
    }
    const confidence = geometry.horizontals.length > 0 ? 0.92 : 0.7
    return { type: 'ORTHOGRAPHIC_TECHNICAL', confidence, reasons, contradiction: null, geometry, diagnostics }
  }

  if (RENDER_ROLES.has(role)) {
    reasons.push(`role ${role} is a perspective visualisation`)
    describeGeometry()
    if (geometry.verticalConverges) {
      return { type: 'PERSPECTIVE_PINHOLE', confidence: 0.85, reasons, contradiction: null, geometry, diagnostics }
    }
    if (geometry.horizontalConverges) {
      // Verticals parallel, horizontals converge: the two-point projection
      // architectural renderers use, i.e. a shifted principal point (§12).
      return { type: 'PERSPECTIVE_SHIFTED', confidence: 0.85, reasons, contradiction: null, geometry, diagnostics }
    }
    // Near-frontal view: perspective by construction, but the image gives the
    // camera almost nothing to bite on. Downstream this becomes a weak camera.
    reasons.push('view is near-frontal: convergence is below the noise floor, so the camera will be weakly constrained')
    return { type: 'PERSPECTIVE_SHIFTED', confidence: 0.45, reasons, contradiction: null, geometry, diagnostics }
  }

  // Unknown role: decide from geometry alone.
  describeGeometry()
  if (geometry.candidates.length === 0) {
    reasons.push('no line families recovered')
    return { type: 'UNKNOWN', confidence: 0.15, reasons, contradiction: null, geometry, diagnostics }
  }
  if (geometry.verticalConverges && geometry.horizontalConverges) {
    return { type: 'PERSPECTIVE_PINHOLE', confidence: 0.7, reasons, contradiction: null, geometry, diagnostics }
  }
  if (geometry.horizontalConverges) {
    return { type: 'PERSPECTIVE_SHIFTED', confidence: 0.65, reasons, contradiction: null, geometry, diagnostics }
  }
  if (ink > 0.02) {
    reasons.push(`ink-on-paper statistics indicate a technical drawing (${(ink * 100).toFixed(1)}% ink)`)
    return { type: 'ORTHOGRAPHIC_TECHNICAL', confidence: 0.6, reasons, contradiction: null, geometry, diagnostics }
  }
  return { type: 'UNKNOWN', confidence: 0.3, reasons, contradiction: null, geometry, diagnostics }
}
