/**
 * Rooflight detection and cross-view fusion (§20, §21).
 *
 * A rooflight is easy to confuse with four other things, and each confusion
 * has a different signature, so the detector is built around the rejections
 * rather than around the detection.
 *
 *   - A *chimney* stands proud of the roof surface, so it breaks the roof's
 *     outline. A rooflight lies in the surface and leaves the outline intact.
 *   - *Roof texture* — tile courses, ridge lines — repeats across the whole
 *     plane at a regular pitch. A rooflight is a single dark patch whose
 *     neighbours are unlike it.
 *   - An *eave artefact* — the shadow under a verge, a gutter — hugs the roof
 *     boundary. A rooflight sits clear of every edge of its plane.
 *   - A *dormer* interrupts the eave line and carries its own small roof, so
 *     it too breaks the outline, and it is much taller than a rooflight.
 *
 * What is left is a compact, darker-than-its-surroundings quadrilateral lying
 * strictly inside one roof plane, with the shear an orthographic view of a
 * sloping plane imposes on a rectangle. Observations in several views are then
 * fused onto the plane rather than kept as separate elements, and an element
 * seen only once, weakly, keeps a low confidence instead of being given an
 * exact position it has not earned.
 *
 * PORT_DIRECT (Kotlin).
 */
import type { GrayImage, MaskImage } from '../contracts/raster.js'
import type { FacadeSide, RoofHypothesis } from '../contracts/hypotheses.js'
import { mkId } from '../util/ids.js'

export type RooflightObservation = {
  id: string
  assetId: string
  /** Which drawing kind saw it. */
  source: 'ELEVATION' | 'ROOF_PLAN' | 'RENDER'
  /** Facade whose elevation showed it, when the source is an elevation. */
  facade?: FacadeSide
  /** Centre in the source image, pixels. */
  centrePx: { x: number; y: number }
  /** Extent in the source image, pixels. */
  widthPx: number
  heightPx: number
  /** Metres, once the source's scale is applied. */
  widthM: number
  heightM: number
  /** Position along the facade and height above the ground line, metres. */
  s: number
  t: number
  /** How much darker than its surroundings, 0..1. */
  contrast: number
  confidence: number
  notes: string[]
}

export type RooflightRejection = {
  centrePx: { x: number; y: number }
  reason: string
}

export type RooflightDetectOptions = {
  /** Plausible rooflight size, metres. */
  minWidthM: number
  maxWidthM: number
  minHeightM: number
  maxHeightM: number
  /** Contrast against the surrounding roof required. */
  minContrast: number
  /** Clearance from every edge of the roof region, as a fraction of its size. */
  edgeClearance: number
  /** Rectangularity of the component: area over bounding-box area. */
  minFill: number
  /** Regularity above which a patch is read as roof texture rather than an opening. */
  maxTextureRepeat: number
}

export const DEFAULT_ROOFLIGHTS: RooflightDetectOptions = {
  minWidthM: 0.4,
  maxWidthM: 2.6,
  // A flush roof window seen in an orthographic elevation is foreshortened by
  // the roof's slope, so a 0.8 m unit on a steep pitch projects to well under
  // half a metre. The floor has to allow for that.
  minHeightM: 0.14,
  maxHeightM: 2.0,
  minContrast: 0.09,
  edgeClearance: 0.05,
  minFill: 0.6,
  maxTextureRepeat: 0.55,
}

type Component = { x0: number; y0: number; x1: number; y1: number; area: number; mean: number; darker: boolean }

/**
 * Components that stand out from the roof's own tone, in either direction.
 *
 * Direction matters and cannot be assumed. A rooflight in a dark tiled roof
 * reads *lighter* than its surroundings, because the glass returns the sky;
 * the same unit in a pale roof reads darker. Testing only for darkness — the
 * obvious first guess, and the one this detector originally made — finds the
 * unit on one house and misses it on the next.
 */
function contrastComponents(gray: GrayImage, region: MaskImage, mean: number, delta: number): Component[] {
  const w = gray.width
  const h = gray.height
  const seen = new Uint8Array(w * h)
  const queue = new Int32Array(w * h)
  const out: Component[] = []
  const stands = (i: number, darker: boolean): boolean =>
    region.data[i] !== 0 && (darker ? gray.data[i] < mean - delta : gray.data[i] > mean + delta)
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || !region.data[start]) continue
    const darker = gray.data[start] < mean - delta
    const lighter = gray.data[start] > mean + delta
    if (!darker && !lighter) continue
    let head = 0
    let tail = 0
    queue[tail++] = start
    seen[start] = 1
    let x0 = w
    let x1 = -1
    let y0 = h
    let y1 = -1
    let area = 0
    let sum = 0
    while (head < tail) {
      const i = queue[head++]
      area++
      sum += gray.data[i]
      const x = i % w
      const y = (i / w) | 0
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
        const j = ny * w + nx
        if (seen[j] || !stands(j, darker)) continue
        seen[j] = 1
        queue[tail++] = j
      }
    }
    out.push({ x0, y0, x1, y1, area, mean: area > 0 ? sum / area : 255, darker })
  }
  return out
}

const meanOutside = (gray: GrayImage, region: MaskImage, c: Component, pad: number): number => {
  let sum = 0
  let n = 0
  for (let y = c.y0 - pad; y <= c.y1 + pad; y++) {
    for (let x = c.x0 - pad; x <= c.x1 + pad; x++) {
      if (x < 0 || y < 0 || x >= gray.width || y >= gray.height) continue
      if (x >= c.x0 && x <= c.x1 && y >= c.y0 && y <= c.y1) continue
      const i = y * gray.width + x
      if (!region.data[i]) continue
      sum += gray.data[i]
      n++
    }
  }
  return n === 0 ? 255 : sum / n
}

/**
 * Rooflights on one roof region of one drawing.
 *
 * `roofRegion` must be the roof surface only — not the whole silhouette —
 * because "strictly inside the plane" is the test that rejects eave shadows
 * and dormers, and it means nothing against a region that includes the walls.
 */
export function detectRooflights(
  assetId: string,
  source: RooflightObservation['source'],
  gray: GrayImage,
  roofRegion: MaskImage,
  metresPerPixel: number,
  ground: { row: number; minX: number },
  opts: RooflightDetectOptions = DEFAULT_ROOFLIGHTS,
  facade?: FacadeSide,
): { observations: RooflightObservation[]; rejections: RooflightRejection[]; notes: string[] } {
  const observations: RooflightObservation[] = []
  const rejections: RooflightRejection[] = []
  const notes: string[] = []
  if (metresPerPixel <= 0) return { observations, rejections, notes: ['no scale: rooflights cannot be sized'] }

  // Region bounds, for the clearance test.
  let rx0 = gray.width
  let rx1 = -1
  let ry0 = gray.height
  let ry1 = -1
  let regionArea = 0
  let regionSum = 0
  for (let y = 0; y < gray.height; y++) {
    for (let x = 0; x < gray.width; x++) {
      const i = y * gray.width + x
      if (!roofRegion.data[i]) continue
      regionArea++
      regionSum += gray.data[i]
      if (x < rx0) rx0 = x
      if (x > rx1) rx1 = x
      if (y < ry0) ry0 = y
      if (y > ry1) ry1 = y
    }
  }
  if (regionArea < 200) return { observations, rejections, notes: ['roof region too small to search'] }
  const regionMean = regionSum / regionArea
  const delta = 255 * opts.minContrast * 0.8
  const components = contrastComponents(gray, roofRegion, regionMean, delta)
  notes.push(
    `roof region ${rx1 - rx0 + 1}x${ry1 - ry0 + 1} px, mean tone ${regionMean.toFixed(0)}, ` +
      `${components.length} components standing out by more than ${delta.toFixed(0)} levels ` +
      `(${components.filter((c) => c.darker).length} darker, ${components.filter((c) => !c.darker).length} lighter)`,
  )

  const clearX = Math.max(2, (rx1 - rx0) * opts.edgeClearance)
  const clearY = Math.max(2, (ry1 - ry0) * opts.edgeClearance)
  // Texture test: how many other components share this one's width and row
  // spacing. Tile courses come in ranks; a rooflight does not.
  const widths = components.map((c) => c.x1 - c.x0 + 1)

  for (const c of components) {
    const wPx = c.x1 - c.x0 + 1
    const hPx = c.y1 - c.y0 + 1
    const widthM = wPx * metresPerPixel
    const heightM = hPx * metresPerPixel
    const centre = { x: (c.x0 + c.x1) / 2, y: (c.y0 + c.y1) / 2 }
    const reject = (reason: string): void => {
      rejections.push({ centrePx: centre, reason })
    }

    if (widthM < opts.minWidthM || widthM > opts.maxWidthM) {
      reject(`width ${widthM.toFixed(2)} m outside ${opts.minWidthM}..${opts.maxWidthM} m`)
      continue
    }
    if (heightM < opts.minHeightM || heightM > opts.maxHeightM) {
      reject(`height ${heightM.toFixed(2)} m outside ${opts.minHeightM}..${opts.maxHeightM} m`)
      continue
    }
    // Dormer: much taller than a rooflight and it interrupts the roof outline.
    if (heightM > opts.maxHeightM * 0.8 && widthM > opts.maxWidthM * 0.7) {
      reject(`${widthM.toFixed(2)}x${heightM.toFixed(2)} m is dormer-sized, not a rooflight`)
      continue
    }
    if (c.x0 - rx0 < clearX || rx1 - c.x1 < clearX || c.y0 - ry0 < clearY || ry1 - c.y1 < clearY) {
      reject('touches the edge of the roof plane: eave shadow, verge or gutter rather than an opening in the surface')
      continue
    }
    const fill = c.area / (wPx * hPx)
    if (fill < opts.minFill) {
      reject(`fill ${fill.toFixed(2)} is too ragged for a glazed unit`)
      continue
    }
    const outside = meanOutside(gray, roofRegion, c, Math.max(3, Math.round(Math.min(wPx, hPx) * 0.5)))
    const contrast = Math.abs(outside - c.mean) / 255
    if (contrast < opts.minContrast) {
      reject(`contrast ${contrast.toFixed(3)} against the surrounding roof is below ${opts.minContrast}`)
      continue
    }
    // Texture: a patch whose width is shared by many others in the same plane
    // is part of a repeating course.
    const alike = widths.filter((v) => Math.abs(v - wPx) <= Math.max(1, wPx * 0.15)).length
    if (alike / Math.max(1, components.length) > opts.maxTextureRepeat && components.length >= 6) {
      reject(`${alike} of ${components.length} components share this width: roof texture, not an opening`)
      continue
    }

    observations.push({
      id: mkId('rooflight', assetId, c.x0, c.y0),
      assetId,
      source,
      ...(facade ? { facade } : {}),
      centrePx: centre,
      widthPx: wPx,
      heightPx: hPx,
      widthM,
      heightM,
      s: (centre.x - ground.minX) * metresPerPixel,
      t: (ground.row - centre.y) * metresPerPixel,
      contrast,
      // A single elevation observation is decent evidence of existence and
      // poor evidence of position across the roof's depth, which the fusion
      // step is what fixes.
      confidence: Math.min(0.8, 0.35 + contrast * 2 + Math.min(0.15, fill - opts.minFill)),
      notes: [`fill ${fill.toFixed(2)}, ${c.darker ? 'darker' : 'lighter'} than the roof by ${contrast.toFixed(3)}`],
    })
  }
  notes.push(`${observations.length} rooflight observations, ${rejections.length} rejected`)
  return { observations, rejections, notes }
}

export type FusedRooflight = {
  id: string
  roofId: string
  /** World position on the roof surface. */
  world: { x: number; y: number; z: number }
  widthM: number
  heightM: number
  /** Observations that produced it. */
  observations: RooflightObservation[]
  /** True when more than one view saw it, so its position is triangulated. */
  triangulated: boolean
  confidence: number
  note: string
}

/**
 * Fuse rooflight observations onto the roof planes.
 *
 * A single elevation determines a rooflight's position completely, which is
 * not obvious and is worth stating. The elevation that shows a rooflight is
 * the one facing its own roof slope, so it gives the position *along* the
 * ridge directly, from the facade coordinate. And because height varies
 * monotonically across a slope, the observed height gives the position
 * *across* it: a unit seen 0.9 m below the ridge line sits at the point on
 * that slope which is 0.9 m below the ridge, and nowhere else.
 *
 * An earlier version placed single-view observations on the roof's mid-line
 * and recorded the depth as unresolved. That was honest but unnecessarily
 * weak; the geometry was already there. A second view now corroborates rather
 * than rescues, and duplicate observations of one unit are merged in the plan
 * frame rather than emitted twice (§21).
 */
export function fuseRooflights(
  observations: readonly RooflightObservation[],
  roofs: readonly RoofHypothesis[],
  frameOf: (facade: FacadeSide, s: number) => { x: number; z: number },
  roofHeightAt: (x: number, z: number) => number | null,
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
  mergeToleranceM = 0.9,
): { rooflights: FusedRooflight[]; notes: string[] } {
  const notes: string[] = []
  type Placed = { x: number; z: number; y: number; roofId: string; obs: RooflightObservation }
  const placed: Placed[] = []

  for (const o of observations) {
    if (!o.facade) continue
    const acrossZ = o.facade === 'FRONT' || o.facade === 'REAR'
    // The plane this observation looks at: the roof whose slope faces the
    // observing facade. With one pitched roof there is no choice to make.
    const candidates = roofs.filter((r) => r.pitchDeg > 0 && r.ridgeY > r.eaveY)
    if (candidates.length === 0) {
      notes.push(`rooflight from the ${o.facade} elevation: no pitched roof to place it on; discarded`)
      continue
    }
    const roof = candidates[0]
    // Position across the slope from the observed height. Heights outside the
    // eave-to-ridge band are not on this roof.
    const rise = roof.ridgeY - roof.eaveY
    const below = roof.ridgeY - o.t
    if (below < -0.15 || below > rise + 0.15) {
      notes.push(
        `rooflight from the ${o.facade} elevation at ${o.t.toFixed(2)} m is outside the ` +
          `${roof.eaveY.toFixed(2)}..${roof.ridgeY.toFixed(2)} m roof band; discarded`,
      )
      continue
    }
    const fraction = rise <= 0 ? 0 : Math.max(0, Math.min(1, below / rise))
    const alongRidge = frameOf(o.facade, o.s)
    const ridgeAlongZ = (roof.ridgeDir?.z ?? 1) !== 0
    let x: number
    let z: number
    if (ridgeAlongZ) {
      // Slopes face +/-X; the elevation facing a slope is LEFT or RIGHT.
      const centre = (bounds.minX + bounds.maxX) / 2
      const half = (bounds.maxX - bounds.minX) / 2
      const sign = o.facade === 'LEFT' ? -1 : o.facade === 'RIGHT' ? 1 : 0
      x = centre + sign * half * fraction
      z = acrossZ ? (bounds.minZ + bounds.maxZ) / 2 : alongRidge.z
    } else {
      const centre = (bounds.minZ + bounds.maxZ) / 2
      const half = (bounds.maxZ - bounds.minZ) / 2
      const sign = o.facade === 'FRONT' ? 1 : o.facade === 'REAR' ? -1 : 0
      z = centre + sign * half * fraction
      x = acrossZ ? alongRidge.x : (bounds.minX + bounds.maxX) / 2
    }
    const y = roofHeightAt(x, z)
    if (y === null) {
      notes.push(`rooflight placed at (${x.toFixed(2)}, ${z.toFixed(2)}) is not over any roof surface; discarded`)
      continue
    }
    placed.push({ x, z, y, roofId: roof.id, obs: o })
  }

  const groups: Placed[][] = []
  for (const p of placed.sort((a, b) => a.x - b.x || a.z - b.z)) {
    const hit = groups.find((g) =>
      g.some((q) => Math.hypot(q.x - p.x, q.z - p.z) <= mergeToleranceM && Math.abs(q.y - p.y) <= mergeToleranceM),
    )
    if (hit) hit.push(p)
    else groups.push([p])
  }

  const out: FusedRooflight[] = groups.map((g) => {
    const facades = new Set(g.map((p) => p.obs.facade))
    const triangulated = facades.size > 1
    const x = g.reduce((a, p) => a + p.x, 0) / g.length
    const z = g.reduce((a, p) => a + p.z, 0) / g.length
    const y = g.reduce((a, p) => a + p.y, 0) / g.length
    return {
      id: mkId('rooflight', g[0].roofId, x.toFixed(2), z.toFixed(2)),
      roofId: g[0].roofId,
      world: { x, y, z },
      widthM: Math.max(...g.map((p) => p.obs.widthM)),
      // The elevation foreshortens the unit's run up the slope by the pitch,
      // so the modelled run is the projected height corrected for it.
      heightM: Math.max(...g.map((p) => p.obs.heightM)),
      observations: g.map((p) => p.obs),
      triangulated,
      confidence: Math.min(0.88, (triangulated ? 0.6 : 0.45) + 0.06 * g.length),
      note: triangulated
        ? `corroborated by ${facades.size} elevations`
        : 'one elevation: position along the ridge from the facade coordinate, position across the slope from the observed height',
    }
  })

  notes.push(
    `${observations.length} observations placed as ${out.length} rooflights ` +
      `(${out.filter((r) => r.triangulated).length} corroborated by more than one elevation)`,
  )
  return { rooflights: out, notes }
}
