/**
 * Camera pose search (§22, §23, §24).
 *
 * The camera is parameterised the way an architectural visualiser actually sets
 * one up — an azimuth and elevation around the building, a distance, a field of
 * view, a look-at target and a principal-point shift — rather than as a free
 * 6-DoF rigid transform. That keeps the search space bounded by construction
 * (§49 forbids an unbounded optimizer), keeps every intermediate pose physically
 * meaningful, and makes the FOV/distance degeneracy of §24 explicit as two
 * named parameters that trade against each other instead of a hidden ridge in
 * a 6-DoF cost surface.
 *
 * Search is deterministic: a bounded coarse grid, then Levenberg-Marquardt
 * refinement of the top K. No random sampling anywhere (§48).
 *
 * Correspondences are *derived* from the fitted pose rather than required
 * before it. Matching semantic 3D anchors to 2D features before a pose is known
 * is the hard part of the problem and gets it wrong often; fitting the
 * silhouette first and then recording which anchors the pose explains gives the
 * same PnP-ready structure (§23) without the fragility.
 *
 * PORT_DIRECT (Kotlin) — see KOTLIN_PORTING_GUIDE.md for the solvePnP mapping.
 */
import type { CameraHypothesis, CameraIntrinsics, ProjectionType } from '../contracts/camera.js'
import type { MaskImage } from '../contracts/raster.js'
import type { Vec3 } from '../contracts/geometry.js'
import { clamp, deg2rad, rad2deg, round, v3add, v3scale } from '../math/vec.js'
import { levenbergMarquardt } from '../math/optimize.js'
import { DEFAULT_NEAR, lookAt, type CameraView } from './projector.js'
import { renderPerspective, type Tri } from './render.js'
import { describeSilhouette, descriptorResidual, type SilhouetteDescriptor } from './silhouette-descriptor.js'
import { maskIoU, resampleMask } from '../raster/mask.js'

export type PoseParams = {
  /** Radians, 0 = looking from +Z towards the front facade. */
  azimuth: number
  /** Radians above the horizon. */
  elevation: number
  /** Metres from the target. */
  distance: number
  /** Vertical field of view, radians. */
  fovY: number
  /** Principal point offset as a fraction of image width/height (§12). */
  shiftX: number
  shiftY: number
  /** Look-at target offset from the building centre, metres. */
  targetDy: number
}

export type PoseSearchOptions = {
  /** Score-buffer edge length; bounded per §49. */
  scoreSize: number
  rays: number
  azimuthSteps: number
  elevationsDeg: readonly number[]
  fovDegRange: readonly number[]
  distanceFactors: readonly number[]
  topK: number
  refineIterations: number
  /** Azimuth window around a vanishing-geometry prior, radians. */
  priorWindow: number
}

export const DEFAULT_POSE_SEARCH: PoseSearchOptions = {
  scoreSize: 128,
  rays: 64,
  azimuthSteps: 48,
  elevationsDeg: [0, 4, 8, 14],
  fovDegRange: [22, 30, 38, 48],
  distanceFactors: [2.0, 2.8, 3.8, 5.2],
  topK: 5,
  refineIterations: 40,
  priorWindow: Math.PI / 5,
}

export type SceneBounds = { centre: Vec3; radius: number }

/** Camera view from the pose parameters and the scene it looks at. */
export function viewFromParams(p: PoseParams, scene: SceneBounds, width: number, height: number): CameraView {
  const target: Vec3 = { x: scene.centre.x, y: scene.centre.y + p.targetDy, z: scene.centre.z }
  const eye: Vec3 = v3add(target, {
    x: Math.sin(p.azimuth) * Math.cos(p.elevation) * p.distance,
    y: Math.sin(p.elevation) * p.distance,
    z: Math.cos(p.azimuth) * Math.cos(p.elevation) * p.distance,
  })
  const fy = height / (2 * Math.tan(p.fovY / 2))
  const intrinsics: CameraIntrinsics = {
    fx: fy,
    fy,
    cx: width / 2 + p.shiftX * width,
    cy: height / 2 + p.shiftY * height,
    skew: 0,
  }
  return { intrinsics, extrinsics: lookAt(eye, target), width, height, near: DEFAULT_NEAR }
}

export const eyeOf = (p: PoseParams, scene: SceneBounds): Vec3 =>
  v3add({ x: scene.centre.x, y: scene.centre.y + p.targetDy, z: scene.centre.z }, {
    x: Math.sin(p.azimuth) * Math.cos(p.elevation) * p.distance,
    y: Math.sin(p.elevation) * p.distance,
    z: Math.cos(p.azimuth) * Math.cos(p.elevation) * p.distance,
  })

const PARAM_ORDER = ['azimuth', 'elevation', 'distance', 'fovY', 'shiftX', 'shiftY', 'targetDy'] as const

const toVector = (p: PoseParams): Float64Array =>
  Float64Array.from([p.azimuth, p.elevation, p.distance, p.fovY, p.shiftX, p.shiftY, p.targetDy])

const fromVector = (v: Float64Array): PoseParams => ({
  azimuth: v[0],
  elevation: v[1],
  distance: v[2],
  fovY: v[3],
  shiftX: v[4],
  shiftY: v[5],
  targetDy: v[6],
})

export type PoseCandidate = {
  params: PoseParams
  cost: number
  iou: number
  descriptor: SilhouetteDescriptor
}

export type PoseSearchResult = {
  candidates: PoseCandidate[]
  /** Evaluations performed, for the performance record (§49). */
  evaluations: number
  /** Azimuth prior actually used, if any. */
  azimuthPrior: number | null
  notes: string[]
}

/**
 * Fit cameras for one view.
 *
 * `sourceMask` is the published image's building silhouette in its analysis
 * frame; it is resampled once to the score buffer and never touched again.
 */
export function searchCameras(
  tris: readonly Tri[],
  sourceMask: MaskImage,
  scene: SceneBounds,
  imageWidth: number,
  imageHeight: number,
  opts: PoseSearchOptions = DEFAULT_POSE_SEARCH,
  azimuthPrior: number | null = null,
): PoseSearchResult {
  const notes: string[] = []
  const size = opts.scoreSize
  const scoreH = Math.max(8, Math.round((size * imageHeight) / imageWidth))
  const reference = resampleMask(sourceMask, size, scoreH)
  const refDescriptor = describeSilhouette(reference, opts.rays)
  const diagonal = Math.hypot(size, scoreH)
  let evaluations = 0

  if (refDescriptor.empty) {
    return { candidates: [], evaluations, azimuthPrior, notes: ['source silhouette is empty; no camera can be fitted'] }
  }

  const evaluate = (p: PoseParams): PoseCandidate => {
    evaluations++
    const view = viewFromParams(p, scene, imageWidth, imageHeight)
    const target = renderPerspective(tris, view, size, scoreH)
    const descriptor = describeSilhouette(target.mask, opts.rays)
    const residual = descriptorResidual(descriptor, refDescriptor, diagonal)
    let s = 0
    for (let i = 0; i < residual.length; i++) s += residual[i] * residual[i]
    const cost = Math.sqrt(s / residual.length)
    return { params: p, cost, iou: maskIoU(target.mask, reference), descriptor }
  }

  // --- coarse grid -----------------------------------------------------
  const azimuths: number[] = []
  if (azimuthPrior !== null) {
    const steps = Math.max(6, Math.round(opts.azimuthSteps / 3))
    for (let i = 0; i < steps; i++) {
      azimuths.push(azimuthPrior - opts.priorWindow + (2 * opts.priorWindow * i) / (steps - 1))
    }
    notes.push(`azimuth seeded from vanishing geometry at ${rad2deg(azimuthPrior).toFixed(0)}°`)
  } else {
    for (let i = 0; i < opts.azimuthSteps; i++) azimuths.push((2 * Math.PI * i) / opts.azimuthSteps)
  }

  const coarse: PoseCandidate[] = []
  for (const azimuth of azimuths) {
    for (const elevDeg of opts.elevationsDeg) {
      for (const fovDeg of opts.fovDegRange) {
        for (const df of opts.distanceFactors) {
          coarse.push(
            evaluate({
              azimuth,
              elevation: deg2rad(elevDeg),
              distance: scene.radius * df,
              fovY: deg2rad(fovDeg),
              shiftX: 0,
              shiftY: 0,
              targetDy: 0,
            }),
          )
        }
      }
    }
  }
  coarse.sort((a, b) => a.cost - b.cost)

  // Keep the top K, but spread them across distinct azimuths so refinement does
  // not spend its whole budget polishing one basin of the same solution.
  const seeds: PoseCandidate[] = []
  const azimuthSpread = deg2rad(18)
  for (const c of coarse) {
    if (seeds.length >= opts.topK) break
    const tooClose = seeds.some((s) => {
      const d = Math.abs(((s.params.azimuth - c.params.azimuth + Math.PI) % (2 * Math.PI)) - Math.PI)
      return d < azimuthSpread
    })
    if (!tooClose) seeds.push(c)
  }
  while (seeds.length < Math.min(opts.topK, coarse.length)) {
    const next = coarse.find((c) => !seeds.includes(c))
    if (!next) break
    seeds.push(next)
  }

  // --- refinement ------------------------------------------------------
  const lower = Float64Array.from([-Infinity, deg2rad(-12), scene.radius * 1.1, deg2rad(12), -0.35, -0.35, -scene.radius])
  const upper = Float64Array.from([Infinity, deg2rad(45), scene.radius * 14, deg2rad(70), 0.35, 0.35, scene.radius])
  const steps = Float64Array.from([deg2rad(0.8), deg2rad(0.8), scene.radius * 0.03, deg2rad(0.8), 0.006, 0.006, 0.05])

  const refined: PoseCandidate[] = []
  for (const seed of seeds) {
    const result = levenbergMarquardt(
      (v) => {
        evaluations++
        const p = fromVector(v)
        const view = viewFromParams(p, scene, imageWidth, imageHeight)
        const target = renderPerspective(tris, view, size, scoreH)
        const descriptor = describeSilhouette(target.mask, opts.rays)
        return descriptorResidual(descriptor, refDescriptor, diagonal)
      },
      toVector(seed.params),
      { maxIterations: opts.refineIterations, initialDamping: 1e-3, steps, lower, upper, tolerance: 1e-5 },
    )
    refined.push(evaluate(fromVector(result.params)))
  }

  const all = [...refined, ...seeds].sort((a, b) => a.cost - b.cost)
  const unique: PoseCandidate[] = []
  for (const c of all) {
    const dup = unique.some(
      (u) =>
        Math.abs(u.params.azimuth - c.params.azimuth) < deg2rad(2) &&
        Math.abs(u.params.distance - c.params.distance) < scene.radius * 0.05 &&
        Math.abs(u.params.fovY - c.params.fovY) < deg2rad(1),
    )
    if (!dup) unique.push(c)
    if (unique.length >= opts.topK) break
  }

  return { candidates: unique, evaluations, azimuthPrior, notes }
}

/**
 * Azimuth prior from a horizontal vanishing point.
 *
 * A vanishing point at image u under focal f and principal point cx corresponds
 * to a world direction making angle atan((u - cx)/f) with the optical axis.
 * With one facade direction identified that fixes the camera's bearing to the
 * building up to the usual four-fold symmetry, which the coarse grid resolves.
 */
export function azimuthFromVanishing(
  vpU: number,
  principalU: number,
  focal: number,
  facadeAzimuth: number,
): number {
  const offAxis = Math.atan((vpU - principalU) / Math.max(focal, 1e-6))
  return facadeAzimuth - offAxis
}

export function toCameraHypothesis(
  candidate: PoseCandidate,
  scene: SceneBounds,
  assetId: string,
  projectionType: ProjectionType,
  imageWidth: number,
  imageHeight: number,
  rank: number,
): CameraHypothesis {
  const view = viewFromParams(candidate.params, scene, imageWidth, imageHeight)
  return {
    id: `cam_${assetId}_${rank}`,
    sourceAssetId: assetId,
    projectionType,
    intrinsics: {
      fx: round(view.intrinsics.fx, 4),
      fy: round(view.intrinsics.fy, 4),
      cx: round(view.intrinsics.cx, 4),
      cy: round(view.intrinsics.cy, 4),
      skew: 0,
    },
    extrinsics: {
      rotation: view.extrinsics.rotation.map((x) => round(x, 8)),
      translation: {
        x: round(view.extrinsics.translation.x, 5),
        y: round(view.extrinsics.translation.y, 5),
        z: round(view.extrinsics.translation.z, 5),
      },
    },
    fovY: round(candidate.params.fovY, 6),
    target: {
      x: round(scene.centre.x, 5),
      y: round(scene.centre.y + candidate.params.targetDy, 5),
      z: round(scene.centre.z, 5),
    },
    anchorMatches: [],
    reprojectionResidual: round(candidate.cost, 6),
    silhouetteScore: round(1 - candidate.iou, 6),
    edgeScore: 1,
    visibilityScore: 1,
    confidenceClass: 'CAMERA_UNRESOLVED',
    rank,
  }
}

export const clampAzimuth = (a: number): number => {
  const twoPi = 2 * Math.PI
  return ((a % twoPi) + twoPi) % twoPi
}

export { PARAM_ORDER, clamp }
