/**
 * One frame for the building, and a registration for every frame that is not
 * it — STAGE WEB-PIVOT-07R §3.
 *
 * A candidate is read off several drawings, and each drawing has its own
 * origin. A floor plan's origin is a corner of whatever the wall-band detector
 * found furthest north-west on *that sheet*; a section's is the left edge of
 * its own cut; an elevation's is the left edge of its own silhouette. None of
 * those is the building, and none of them agrees with the others.
 *
 * The rule this module exists to enforce is that no source frame reaches a
 * three-dimensional scene without a registration object saying how it was
 * brought into the building's own frame, how well that fitted, and what the
 * fit was made of. A frame with no registration is not silently placed at the
 * origin: it is `UNRESOLVED`, and what it carries is drawn as unplaced or not
 * drawn at all.
 *
 * The building frame itself is the primary storey's structural envelope: its
 * north-west corner is the origin, plan-right is +X, plan-down is +Z, up is
 * +Y, metres. "Structural envelope" is the load-bearing decision and it is
 * made in `plan-masses.ts` — a terrace edge, an entrance step or a site
 * outline is not the building even when it is the furthest thing north-west
 * on the sheet, which is exactly how project A acquired a 4.8 m offset
 * between its two storeys.
 *
 * PORT_DIRECT (Kotlin).
 */
import type { EvidenceRef } from './candidate-evidence.js'

/** A point in some frame's own metres. */
export type Vec2 = { x: number; z: number }

/** An axis-aligned rectangle in some frame's own metres. */
export type Rect = { x0: number; z0: number; x1: number; z1: number }

export const rectWidth = (r: Rect): number => r.x1 - r.x0
export const rectDepth = (r: Rect): number => r.z1 - r.z0
export const rectArea = (r: Rect): number => Math.max(0, rectWidth(r)) * Math.max(0, rectDepth(r))

export const rectIntersect = (a: Rect, b: Rect): Rect => ({
  x0: Math.max(a.x0, b.x0),
  z0: Math.max(a.z0, b.z0),
  x1: Math.min(a.x1, b.x1),
  z1: Math.min(a.z1, b.z1),
})

export const rectContains = (outer: Rect, inner: Rect, slackM = 0): boolean =>
  inner.x0 >= outer.x0 - slackM &&
  inner.z0 >= outer.z0 - slackM &&
  inner.x1 <= outer.x1 + slackM &&
  inner.z1 <= outer.z1 + slackM

export const rectUnion = (a: Rect, b: Rect): Rect => ({
  x0: Math.min(a.x0, b.x0),
  z0: Math.min(a.z0, b.z0),
  x1: Math.max(a.x1, b.x1),
  z1: Math.max(a.z1, b.z1),
})

/**
 * How one source frame sits in the building frame.
 *
 * A rigid placement: a quarter-turn, an optional mirror, a scale per axis and
 * a translation. Scale is per axis and normally 1 — each source carries its
 * own metric calibration, so registration solves *where* a drawing sits and
 * not how big it is. A scale that is not 1 is a statement that two sources
 * disagree about size, and it is recorded rather than applied silently.
 *
 * `residualM` is what the fit left over: the root-mean-square distance
 * between the source features and the building features they were matched to,
 * weighted by how much material stood behind each. `matched` is how many
 * features agreed. A registration with no matches is `UNRESOLVED` however
 * plausible its numbers look.
 */
export type SourceFrameRegistration = {
  sourceFrameId: string
  targetFrameId: 'BUILDING'
  /** What kind of drawing this frame belongs to. */
  kind: 'PLAN' | 'SECTION' | 'ELEVATION'
  rotation90: 0 | 1 | 2 | 3
  mirrorX: boolean
  scaleX: number
  scaleZ: number
  translateX: number
  translateZ: number
  /**
   * For a section or an elevation, the building axis the drawing's own
   * horizontal coordinate runs along, and which way. Null for a plan, which
   * carries both axes.
   */
  alongAxis: 'X' | 'Z' | null
  alongDirection: 1 | -1 | null
  residualM: number | null
  matched: number
  evidenceRefs: string[]
  evidence: EvidenceRef[]
  status: 'RESOLVED' | 'CONFLICTED' | 'UNRESOLVED'
  why: string
}

/**
 * The identity placement, for the frame the building frame was built on.
 *
 * It still gets a registration object: §3 asks for an explicit transform for
 * every frame used in the scene, and "this one happens to be the reference"
 * is a fact about the fit, not a reason to leave it implicit.
 */
export function identityRegistration(
  sourceFrameId: string,
  kind: SourceFrameRegistration['kind'],
  translateX: number,
  translateZ: number,
  why: string,
  evidence: EvidenceRef[] = [],
): SourceFrameRegistration {
  return {
    sourceFrameId,
    targetFrameId: 'BUILDING',
    kind,
    rotation90: 0,
    mirrorX: false,
    scaleX: 1,
    scaleZ: 1,
    translateX,
    translateZ,
    alongAxis: null,
    alongDirection: null,
    residualM: 0,
    matched: 0,
    evidenceRefs: [],
    evidence,
    status: 'RESOLVED',
    why,
  }
}

/**
 * A point in the source frame, placed in the building frame.
 *
 * Order is scale, then mirror, then the quarter-turn, then the translation —
 * the same order the solver searched in, so a registration read back out of a
 * report reproduces the placement it describes.
 */
export function placePoint(r: SourceFrameRegistration, p: Vec2): Vec2 {
  const sx = p.x * r.scaleX * (r.mirrorX ? -1 : 1)
  const sz = p.z * r.scaleZ
  let x = sx
  let z = sz
  for (let i = 0; i < r.rotation90; i++) {
    const nx = -z
    const nz = x
    x = nx
    z = nz
  }
  return { x: x + r.translateX, z: z + r.translateZ }
}

/** A rectangle placed in the building frame, re-ordered so x0 <= x1. */
export function placeRect(r: SourceFrameRegistration, rect: Rect): Rect {
  const a = placePoint(r, { x: rect.x0, z: rect.z0 })
  const b = placePoint(r, { x: rect.x1, z: rect.z1 })
  return {
    x0: Math.min(a.x, b.x),
    z0: Math.min(a.z, b.z),
    x1: Math.max(a.x, b.x),
    z1: Math.max(a.z, b.z),
  }
}

/**
 * Which building axis a source axis ends up on, and which way it runs.
 *
 * A quarter-turn sends the source's own X to the building's Z and back; a
 * mirror flips the direction without changing the axis. Callers that carry a
 * one-dimensional measurement — an elevation's position along a facade, a
 * section's position across the cut — need this rather than a whole point.
 */
export function placedAxis(r: SourceFrameRegistration, source: 'X' | 'Z'): { axis: 'X' | 'Z'; direction: 1 | -1 } {
  const quarter = r.rotation90 % 4
  const swaps = quarter === 1 || quarter === 3
  const axis: 'X' | 'Z' = swaps ? (source === 'X' ? 'Z' : 'X') : source
  let direction = 1
  if (source === 'X' && r.mirrorX) direction = -direction
  if (quarter === 2) direction = -direction
  else if (quarter === 1 && source === 'Z') direction = -direction
  else if (quarter === 3 && source === 'X') direction = -direction
  return { axis, direction: direction as 1 | -1 }
}
