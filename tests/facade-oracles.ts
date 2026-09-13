/**
 * Facade oracles — STAGE WEB-PIVOT-05, development only.
 *
 * Everything here measures the emitted triangles. Not one function reads the
 * compiler's intent, its diagnostics or its own idea of where a surface is: a
 * recess is a set of distances a ray travelled before it met material, an
 * opening is a length of line that found none, and a balustrade is glass that a
 * probe either passed through or did not. That is the point. The facade
 * compiler and the facade gold could agree with each other perfectly and still
 * be wrong about the building; only a measurement taken without either of them
 * can say so.
 *
 * Three defects these are specifically built to catch, because a picture cannot:
 *
 *   - **A painted opening.** `openingCutReport` fires through the middle of
 *     every hole and beside it. A wall with a dark rectangle drawn on it
 *     returns the wall's own thickness through the "opening"; a real hole
 *     returns zero. A hole whose far leaf was left standing returns the far
 *     leaf. None of the three looks different rendered head-on.
 *   - **A flat facade with a dark patch on it.** `recessReport` measures how
 *     far behind the outer plane the material actually starts. A recess that
 *     has been "modelled" with material is zero deep and says so.
 *   - **Floating glass.** `openingCutReport` also asks where the glass is, and
 *     `facadeDepthMap` records the nearest surface across the whole elevation,
 *     so a pane sitting in front of a solid wall is a depth reading, not an
 *     opinion.
 *
 * PORT_DIRECT (Kotlin) — pure functions over triangle lists.
 */
import type { InteriorSpec, RoomSpec } from '../src/core/wallspec/interior.js'
import { pointInPolygon } from '../src/core/wallspec/interior.js'
import type { WallSpec } from '../src/core/wallspec/contracts.js'
import { wallFrame, wallPoint } from '../src/core/wallspec/contracts.js'
import type {
  ExteriorOpeningGroup,
  FacadeRecessSpec,
  PortalSpec,
  RailingSpec,
} from '../src/core/wallspec/facade.js'
import { headAtFraction, railingExtent } from '../src/core/wallspec/facade.js'
import type { SceneTri } from '../src/core/wallspec/marcowki-facade-fixture.js'
import {
  intervalsLength,
  materialRuns,
  meshVolume,
  type Interval,
  type OTri,
  type OVec,
} from './geometry-oracles.js'

export const asOTris = (tris: readonly SceneTri[]): OTri[] => tris.map((t) => ({ a: t.a, b: t.b, c: t.c }))

/** The triangles a ray should treat as material. */
export const solidOf = (tris: readonly SceneTri[]): OTri[] => asOTris(tris.filter((t) => t.solid))

/** The triangles one opening's fills and mullions are made of. */
export const fillsOf = (tris: readonly SceneTri[], openingId: string): OTri[] =>
  asOTris(tris.filter((t) => t.openingId === openingId && t.layer === 'FACADE'))

/** The triangles one named element is made of, whichever layer emitted it. */
export const elementOf = (tris: readonly SceneTri[], elementId: string): OTri[] =>
  asOTris(tris.filter((t) => t.elementId === elementId))

const lengthIn = (runs: readonly Interval[], t0: number, t1: number): number =>
  runs.reduce((acc, r) => acc + Math.max(0, Math.min(r.t1, t1) - Math.max(r.t0, t0)), 0)

// --- openings ---------------------------------------------------------------

export type OpeningLeafCut = {
  /** Which wall this leaf goes through. */
  hostWallId: string
  offsetM: number
  /** Material still standing inside the opening, across the host wall. */
  throughM: number
  /** Material across the same wall a short way to the side of the opening. */
  besideM: number
  /** Material across the same wall just above the head. */
  aboveM: number
}

export type OpeningCutReport = {
  openingId: string
  leaves: OpeningLeafCut[]
  /** Fill material found inside the hole, on the same line. */
  fillM: number
  /** Fill material found outside the hole — glass hanging past its own reveal. */
  strayFillM: number
  /** Emitted reveal surface area for this opening. */
  revealAreaM2: number
  worstThroughM: number
}

const OUT_M = 2.0

/**
 * Is this opening a hole, is it filled, and is it filled only where it is a hole?
 *
 * The probe starts two metres outside the wall's outer face and travels inward
 * along the wall's own normal, so the wall band is a known stretch of the line
 * and a run inside it is wall that should not be there. Every leaf is probed
 * separately, because a door through a party wall is only open if it is open in
 * both of them.
 */
export function openingCutReport(
  tris: readonly SceneTri[],
  wallsById: ReadonlyMap<string, WallSpec>,
  o: ExteriorOpeningGroup,
): OpeningCutReport {
  const solid = solidOf(tris)
  const fills = fillsOf(tris, o.id)
  const midB = (o.sillM + headAtFraction(o, 0.5)) / 2
  const leaves: OpeningLeafCut[] = []

  const probe = (w: WallSpec, offsetM: number, b: number, u: number): Interval[] => {
    const { n } = wallFrame(w)
    const p = wallPoint(w, u, b, -OUT_M)
    return materialRuns(solid, p, { x: -n.x, y: -n.y, z: -n.z }, 1e-7)
  }

  for (const leaf of [{ hostWallId: o.hostWallId, offsetM: o.offsetM }, ...(o.leaves ?? [])]) {
    const w = wallsById.get(leaf.hostWallId)
    if (w === undefined) continue
    const band: [number, number] = [OUT_M - 1e-6, OUT_M + w.thicknessM + 1e-6]
    const mid = leaf.offsetM + o.widthM / 2
    // Beside: whichever side still has wall on it, so an opening near a wall end
    // is still compared against wall rather than against air.
    const before = leaf.offsetM - 0.12
    const after = leaf.offsetM + o.widthM + 0.12
    const beside = before > 0.25 ? before : after
    const head = Math.max(headAtFraction(o, 0.5), o.headM) + 0.08
    leaves.push({
      hostWallId: leaf.hostWallId,
      offsetM: leaf.offsetM,
      throughM: lengthIn(probe(w, leaf.offsetM, midB, mid), band[0], band[1]),
      besideM: lengthIn(probe(w, leaf.offsetM, midB, beside), band[0], band[1]),
      aboveM: lengthIn(probe(w, leaf.offsetM, head, mid), band[0], band[1]),
    })
  }

  const host = wallsById.get(o.hostWallId)
  const { n } = host ? wallFrame(host) : { n: { x: 0, y: 0, z: 1 } }
  const dir = { x: -n.x, y: -n.y, z: -n.z }
  const fillRuns = host
    ? materialRuns(fills, wallPoint(host, o.offsetM + o.widthM / 2, midB, -OUT_M), dir, 1e-7)
    : []
  const strayRuns = host
    ? materialRuns(fills, wallPoint(host, o.offsetM + o.widthM / 2, o.sillM - 0.15, -OUT_M), dir, 1e-7)
    : []

  const revealAreaM2 = triangleArea(tris.filter((t) => t.openingId === o.id && t.part === 'REVEAL'))

  return {
    openingId: o.id,
    leaves,
    fillM: intervalsLength(fillRuns),
    strayFillM: intervalsLength(strayRuns),
    revealAreaM2,
    worstThroughM: leaves.reduce((m, l) => Math.max(m, l.throughM), 0),
  }
}

function triangleArea(tris: readonly SceneTri[]): number {
  let total = 0
  for (const t of tris) {
    const ux = t.b.x - t.a.x
    const uy = t.b.y - t.a.y
    const uz = t.b.z - t.a.z
    const vx = t.c.x - t.a.x
    const vy = t.c.y - t.a.y
    const vz = t.c.z - t.a.z
    total += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2
  }
  return total / 1
}

// --- recesses ---------------------------------------------------------------

export type RecessSample = {
  atM: number
  heightM: number
  /** Distance from the outer plane to the first material, or null for a clear line. */
  firstMaterialDepthM: number | null
}

export type RecessReport = {
  recessId: string
  statedDepthM: number
  samples: RecessSample[]
  /** Fraction of samples with no material in the outer plane itself. */
  openAtMouth: number
  /** Smallest positive depth found where material was found at all. */
  minDepthM: number
  /** Largest depth found. */
  maxDepthM: number
  /** Depth the back wall actually sits at, over the samples that met it. */
  medianDepthM: number
  /**
   * Samples whose first material sits nearer than the stated depth.
   *
   * This is the number that matters, and the median is not: a rear recess whose
   * back wall is mostly glazing lets a probe run on to the far side of the
   * house, so the depths it collects are long and meaningless. Nothing may be
   * *nearer* than the recess is deep, and that is what is counted here.
   */
  nearerThanStated: number
}

/**
 * How deep the recess really is, measured from outside.
 *
 * A flattened recess puts material in the outer plane and reads zero; a recess
 * whose back wall was moved forward reads short. Neither is visible in an
 * elevation, because in both the wall and the returns are still the same white
 * and the same dark.
 */
export function recessReport(
  tris: readonly SceneTri[],
  r: FacadeRecessSpec,
  heights: readonly number[],
  columns = 21,
): RecessReport {
  const solid = solidOf(tris)
  const outward = Math.sign(r.outerPlaneM - r.backPlaneM)
  const samples: RecessSample[] = []
  let open = 0
  const depths: number[] = []
  for (let i = 1; i < columns; i++) {
    const at = r.fromM + ((r.toM - r.fromM) * i) / columns
    for (const h of heights) {
      const start = r.outerPlaneM + outward * 6
      const origin: OVec = r.depthAxis === 'Z' ? { x: at, y: h, z: start } : { x: start, y: h, z: at }
      const dir: OVec = r.depthAxis === 'Z' ? { x: 0, y: 0, z: -outward } : { x: -outward, y: 0, z: 0 }
      const runs = materialRuns(solid, origin, dir, 1e-7)
      const first = runs.find((x) => x.t1 > 6 - 1e-6)
      const depth = first === undefined ? null : first.t0 - 6
      samples.push({ atM: at, heightM: h, firstMaterialDepthM: depth })
      if (depth === null || depth > 1e-6) open++
      if (depth !== null) depths.push(depth)
    }
  }
  const sorted = [...depths].sort((a, b) => a - b)
  const stated = Math.abs(r.outerPlaneM - r.backPlaneM)
  return {
    nearerThanStated: depths.filter((d) => d < stated - 1e-4).length,
    recessId: r.id,
    statedDepthM: Math.abs(r.outerPlaneM - r.backPlaneM),
    samples,
    openAtMouth: samples.length === 0 ? 0 : open / samples.length,
    minDepthM: sorted.length === 0 ? Number.NaN : sorted[0],
    maxDepthM: sorted.length === 0 ? Number.NaN : sorted[sorted.length - 1],
    medianDepthM: sorted.length === 0 ? Number.NaN : sorted[Math.floor(sorted.length / 2)],
  }
}

// --- portal -----------------------------------------------------------------

export type PortalReport = {
  portalId: string
  /** Samples inside the stated mouth that met material in the outer plane. */
  blockedSamples: number
  totalSamples: number
  /** Material found in the outer plane just outside each jamb — the frame. */
  jambMaterialM: number[]
  /** Material found in a vertical probe just above the mouth — the head. */
  headMaterialM: number
  /** How far back the mouth actually leads, at its own centre. */
  measuredDepthM: number | null
}

/**
 * Is the mouth open, and is it framed by the elements the spec names?
 *
 * A portal painted on a flat wall passes no ray at all; a portal that is only a
 * gap between two masses has an open mouth and no head. Both are asked here,
 * and the second is why the head probe is a separate number.
 */
export function portalReport(tris: readonly SceneTri[], p: PortalSpec, samplesAcross = 23): PortalReport {
  const solid = solidOf(tris)
  const outward = Math.sign(p.depthM) || 1
  const start = p.outerPlaneM + outward * 6
  const dir: OVec = { x: 0, y: 0, z: -outward }
  let blocked = 0
  let total = 0
  for (let i = 1; i < samplesAcross; i++) {
    const x = p.openingMinM + ((p.openingMaxM - p.openingMinM) * i) / samplesAcross
    for (const y of [0.3, 1.2, p.openingTopM - 0.2]) {
      const runs = materialRuns(solid, { x, y, z: start }, dir, 1e-7)
      if (runs.some((r) => r.t0 < 6 + 1e-6 && r.t1 > 6 - 1e-6)) blocked++
      total++
    }
  }
  // Material in the first `depth` metres behind the outer plane, just outside
  // each jamb. A real jamb fills it; a mouth that is merely the gap between two
  // distant masses leaves it empty.
  const jambMaterialM = [p.openingMinM - 0.2, p.openingMaxM + 0.2].map((x) =>
    lengthIn(materialRuns(solid, { x, y: 1.2, z: start }, dir, 1e-7), 6, 6 + Math.abs(p.depthM)),
  )
  const midX = (p.openingMinM + p.openingMaxM) / 2
  const headRuns = materialRuns(
    solid,
    { x: midX, y: -6, z: p.outerPlaneM - outward * 0.3 },
    { x: 0, y: 1, z: 0 },
    1e-7,
  )
  const headMaterialM = headRuns.reduce(
    (acc, r) => acc + Math.max(0, Math.min(r.t1 - 6, p.openingTopM + 2) - Math.max(r.t0 - 6, p.openingTopM)),
    0,
  )
  const centre = materialRuns(solid, { x: midX, y: 1.2, z: start }, dir, 1e-7)
  const first = centre.find((r) => r.t1 > 6 - 1e-6)
  return {
    portalId: p.id,
    blockedSamples: blocked,
    totalSamples: total,
    jambMaterialM,
    headMaterialM,
    measuredDepthM: first === undefined ? null : first.t0 - 6,
  }
}

// --- slabs and railings -----------------------------------------------------

export type SlabReport = {
  slabId: string
  volumeM3: number
  /** Top and bottom of the slab on a vertical line through its middle. */
  topM: number | null
  bottomM: number | null
  /** How much of the stated footprint a vertical probe actually finds slab in. */
  coverage: number
}

export function slabReport(
  tris: readonly SceneTri[],
  slabId: string,
  footprint: { minX: number; maxX: number; minZ: number; maxZ: number },
  samples = 7,
): SlabReport {
  const own = elementOf(tris, slabId)
  let hits = 0
  let total = 0
  let topM: number | null = null
  let bottomM: number | null = null
  for (let i = 1; i < samples; i++) {
    for (let j = 1; j < samples; j++) {
      const x = footprint.minX + ((footprint.maxX - footprint.minX) * i) / samples
      const z = footprint.minZ + ((footprint.maxZ - footprint.minZ) * j) / samples
      const runs = materialRuns(own, { x, y: -8, z }, { x: 0, y: 1, z: 0 }, 1e-7)
      total++
      if (runs.length > 0) {
        hits++
        const b = runs[0].t0 - 8
        const t = runs[runs.length - 1].t1 - 8
        bottomM = bottomM === null ? b : Math.min(bottomM, b)
        topM = topM === null ? t : Math.max(topM, t)
      }
    }
  }
  return { slabId, volumeM3: meshVolume(own), topM, bottomM, coverage: total === 0 ? 0 : hits / total }
}

export type RailingReport = {
  railingId: string
  panels: number
  /** Glass a probe found along the run, and the gaps between panels. */
  glassLengthM: number
  gapLengthM: number
  /** Extent the probe actually found material over. */
  measuredFromM: number
  measuredToM: number
  /** Top and bottom of the balustrade on a line through the middle of a panel. */
  topM: number | null
  baseM: number | null
  /** True when every panel a probe met was emitted as glass rather than as wall. */
  allGlass: boolean
}

/**
 * Is the balustrade glass, is it where the plan draws it, and is it panelled?
 *
 * The run is swept along its own axis and the material classed by the part that
 * produced it, so an opaque parapet with the same silhouette reports the same
 * extent and `allGlass` false — which is exactly the substitution §12 forbids.
 */
export function railingReport(tris: readonly SceneTri[], r: RailingSpec, step = 0.02): RailingReport {
  const own = tris.filter((t) => t.ownerId === r.id)
  const glass = asOTris(own.filter((t) => t.part === 'RAILING_GLASS'))
  const anyPanel = asOTris(own.filter((t) => t.elementKind === 'RAILING' && !t.elementId.endsWith('_rail')))
  const ext = railingExtent(r)
  const mid = r.baseM + r.heightM / 2
  let glassLengthM = 0
  let gapLengthM = 0
  let measuredFromM = Number.POSITIVE_INFINITY
  let measuredToM = Number.NEGATIVE_INFINITY
  for (let a = ext.fromM + step / 2; a < ext.toM; a += step) {
    const origin: OVec = r.axis === 'X' ? { x: a, y: mid, z: r.atM - 4 } : { x: r.atM - 4, y: mid, z: a }
    const dir: OVec = r.axis === 'X' ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 }
    const g = intervalsLength(materialRuns(glass, origin, dir, 1e-7))
    const p = intervalsLength(materialRuns(anyPanel, origin, dir, 1e-7))
    if (g > 1e-9) glassLengthM += step
    else if (p < 1e-9) gapLengthM += step
    if (p > 1e-9) {
      measuredFromM = Math.min(measuredFromM, a)
      measuredToM = Math.max(measuredToM, a)
    }
  }
  const p0 = [...r.panels].sort((a, b) => a.fromM - b.fromM)[0]
  const at = p0 === undefined ? ext.fromM : (p0.fromM + p0.toM) / 2
  const vert: OVec = r.axis === 'X' ? { x: at, y: -8, z: r.atM } : { x: r.atM, y: -8, z: at }
  const prof = materialRuns(asOTris(own), vert, { x: 0, y: 1, z: 0 }, 1e-7)
  return {
    railingId: r.id,
    panels: r.panels.length,
    glassLengthM,
    gapLengthM,
    measuredFromM,
    measuredToM,
    topM: prof.length === 0 ? null : prof[prof.length - 1].t1 - 8,
    baseM: prof.length === 0 ? null : prof[0].t0 - 8,
    allGlass: own.some((t) => t.part === 'RAILING_GLASS') && !own.some((t) => t.part === 'SLAB'),
  }
}

// --- orthographic facade oracle ---------------------------------------------

export type FacadeView = 'FRONT' | 'REAR' | 'EAST' | 'WEST'

export type ViewFrame = {
  /** World axis the eye looks along. */
  dir: OVec
  /** World coordinate the picture's horizontal axis reads. */
  acrossOf: (p: { x: number; y: number; z: number }) => number
  originOf: (across: number, up: number) => OVec
}

/** The four orthographic views, as the axes each one reads. */
export const VIEW_FRAMES: Record<FacadeView, ViewFrame> = {
  FRONT: {
    dir: { x: 0, y: 0, z: -1 },
    acrossOf: (p) => p.x,
    originOf: (across, up) => ({ x: across, y: up, z: 30 }),
  },
  REAR: {
    dir: { x: 0, y: 0, z: 1 },
    acrossOf: (p) => p.x,
    originOf: (across, up) => ({ x: across, y: up, z: -30 }),
  },
  EAST: {
    dir: { x: -1, y: 0, z: 0 },
    acrossOf: (p) => p.z,
    originOf: (across, up) => ({ x: 30, y: up, z: across }),
  },
  WEST: {
    dir: { x: 1, y: 0, z: 0 },
    acrossOf: (p) => p.z,
    originOf: (across, up) => ({ x: -30, y: up, z: across }),
  },
}

export type DepthMap = {
  view: FacadeView
  acrossFromM: number
  acrossToM: number
  upFromM: number
  upToM: number
  columns: number
  rows: number
  /** Distance from the ray origin to the nearest material, or null for sky. */
  depth: Array<number | null>
  /** Distance the eye started at, so a depth is `START - depth` in world terms. */
  startM: number
}

/**
 * The nearest surface across a whole elevation, on a fixed grid.
 *
 * This is the orthographic oracle: a real elevation of the model, sampled, with
 * the depth kept rather than thrown away. Silhouette, opening polygons and the
 * recess outline all fall out of it, and all three fall out of *one* traversal,
 * so they cannot disagree with each other.
 */
export function facadeDepthMap(
  tris: readonly SceneTri[],
  view: FacadeView,
  bounds: { acrossFromM: number; acrossToM: number; upFromM: number; upToM: number },
  columns = 160,
  rows = 110,
): DepthMap {
  const solid = solidOf(tris)
  const f = VIEW_FRAMES[view]
  const depth: Array<number | null> = []
  const START = 30
  for (let j = 0; j < rows; j++) {
    const up = bounds.upFromM + ((bounds.upToM - bounds.upFromM) * (j + 0.5)) / rows
    for (let i = 0; i < columns; i++) {
      const across = bounds.acrossFromM + ((bounds.acrossToM - bounds.acrossFromM) * (i + 0.5)) / columns
      const runs = materialRuns(solid, f.originOf(across, up), f.dir, 1e-7)
      depth.push(runs.length === 0 ? null : runs[0].t0)
    }
  }
  return { view, ...bounds, columns, rows, depth, startM: START }
}

/** World coordinate of the nearest surface at one cell, along the view axis. */
export const depthToWorld = (m: DepthMap, d: number): number => {
  const f = VIEW_FRAMES[m.view]
  const s = f.dir.z !== 0 ? f.originOf(0, 0).z : f.originOf(0, 0).x
  const sign = f.dir.z !== 0 ? f.dir.z : f.dir.x
  return s + sign * d
}

export type AnchorCheck = {
  label: string
  /** Fraction of the anchor rectangle the elevation shows as open. */
  voidInside: number
  /** Fraction of the strips to either side of it the elevation shows as open. */
  voidAround: number
  verdict: 'MATCH' | 'MISSING' | 'SMEARED'
}

/**
 * Does the elevation show a hole exactly where the source puts one?
 *
 * "Open" is not "sky". Looking straight through a window you see the far side
 * of the house, so an opening's cells have a nearest surface like any other —
 * just a further one. The test is therefore whether the nearest surface lies
 * *behind the wall's own outer face*, which is what `facePlaneM` states and
 * what a painted rectangle can never satisfy: paint is on the face.
 *
 * Both numbers are needed and neither is enough. A model with no opening at all
 * has `voidInside` 0; a model whose wall simply stops has `voidInside` 1 and
 * `voidAround` 1 as well, which is not an opening but a missing wall.
 */
export function anchorCheck(
  m: DepthMap,
  label: string,
  rect: { acrossFromM: number; acrossToM: number; upFromM: number; upToM: number },
  facePlaneM: number,
  marginM = 0.25,
  behindTolM = 0.1,
): AnchorCheck {
  const faceDepth = Math.abs(m.startM * (VIEW_FRAMES[m.view].dir.z !== 0 ? Math.sign(-VIEW_FRAMES[m.view].dir.z) : Math.sign(-VIEW_FRAMES[m.view].dir.x)) - facePlaneM)
  const isOpen = (d: number | null): boolean => d === null || d > faceDepth + behindTolM
  const cellAcross = (m.acrossToM - m.acrossFromM) / m.columns
  const cellUp = (m.upToM - m.upFromM) / m.rows
  const at = (i: number, j: number): number | null => m.depth[j * m.columns + i]
  let inVoid = 0
  let inAll = 0
  let outVoid = 0
  let outAll = 0
  for (let j = 0; j < m.rows; j++) {
    const up = m.upFromM + (m.upToM - m.upFromM) * ((j + 0.5) / m.rows)
    for (let i = 0; i < m.columns; i++) {
      const across = m.acrossFromM + (m.acrossToM - m.acrossFromM) * ((i + 0.5) / m.columns)
      const inside =
        across > rect.acrossFromM + cellAcross &&
        across < rect.acrossToM - cellAcross &&
        up > rect.upFromM + cellUp &&
        up < rect.upToM - cellUp
      // Only the two side strips, at the opening's own height. Below a door's
      // sill is the ground and above a raked head is more opening, so a square
      // frame would count both as "open" and call every real opening smeared.
      const near =
        up >= rect.upFromM &&
        up <= rect.upToM &&
        ((across < rect.acrossFromM && across > rect.acrossFromM - marginM) ||
          (across > rect.acrossToM && across < rect.acrossToM + marginM))
      if (inside) {
        inAll++
        if (isOpen(at(i, j))) inVoid++
      } else if (near) {
        outAll++
        if (isOpen(at(i, j))) outVoid++
      }
    }
  }
  const voidInside = inAll === 0 ? 0 : inVoid / inAll
  const voidAround = outAll === 0 ? 0 : outVoid / outAll
  return {
    label,
    voidInside,
    voidAround,
    verdict: voidInside < 0.9 ? 'MISSING' : voidAround > 0.2 ? 'SMEARED' : 'MATCH',
  }
}

/**
 * World coordinate, along the view axis, of the nearest surface at one point.
 *
 * This is how the recess outline is checked: inside the mouth the answer is the
 * back wall's plane, outside it the returns' plane, and the difference between
 * the two is the projection a flat facade does not have.
 */
export function nearestAt(m: DepthMap, acrossM: number, upM: number): number | null {
  const i = Math.floor(((acrossM - m.acrossFromM) / (m.acrossToM - m.acrossFromM)) * m.columns)
  const j = Math.floor(((upM - m.upFromM) / (m.upToM - m.upFromM)) * m.rows)
  if (i < 0 || j < 0 || i >= m.columns || j >= m.rows) return null
  const d = m.depth[j * m.columns + i]
  return d === null ? null : depthToWorld(m, d)
}

/** Outer bounds of everything the elevation shows, in its own two axes. */
export function silhouette(m: DepthMap): {
  acrossFromM: number
  acrossToM: number
  upFromM: number
  upToM: number
} {
  let a0 = Number.POSITIVE_INFINITY
  let a1 = Number.NEGATIVE_INFINITY
  let u0 = Number.POSITIVE_INFINITY
  let u1 = Number.NEGATIVE_INFINITY
  for (let j = 0; j < m.rows; j++) {
    const up = m.upFromM + (m.upToM - m.upFromM) * ((j + 0.5) / m.rows)
    for (let i = 0; i < m.columns; i++) {
      if (m.depth[j * m.columns + i] === null) continue
      const across = m.acrossFromM + (m.acrossToM - m.acrossFromM) * ((i + 0.5) / m.columns)
      a0 = Math.min(a0, across)
      a1 = Math.max(a1, across)
      u0 = Math.min(u0, up)
      u1 = Math.max(u1, up)
    }
  }
  return { acrossFromM: a0, acrossToM: a1, upFromM: u0, upToM: u1 }
}

// --- plan oracle ------------------------------------------------------------

export type PlanRun = { fromM: number; toM: number }

/**
 * What a plan cut at one height finds along one line, in world coordinates.
 *
 * This is the oracle §22 asks for: the model sliced the way the drawing is
 * sliced, so a recess depth, a wall plane offset or an opening's position can be
 * read off the geometry the same way it was read off the plan raster.
 */
export function planScan(
  tris: readonly SceneTri[],
  axis: 'X' | 'Z',
  atM: number,
  heightM: number,
  fromM = -6,
  toM = 20,
): PlanRun[] {
  const solid = solidOf(tris)
  const origin: OVec = axis === 'X' ? { x: fromM, y: heightM, z: atM } : { x: atM, y: heightM, z: fromM }
  const dir: OVec = axis === 'X' ? { x: 1, y: 0, z: 0 } : { x: 0, y: 0, z: 1 }
  return materialRuns(solid, origin, dir, 1e-7)
    .filter((r) => r.t1 - r.t0 > 1e-6 && r.t0 < toM - fromM)
    .map((r) => ({ fromM: fromM + r.t0, toM: fromM + r.t1 }))
}

// --- opening to room --------------------------------------------------------

export type OpeningRoomRow = {
  openingId: string
  hostWallId: string
  claimedRoomId: string
  /** The room whose plan polygon contains a point just inside the opening. */
  foundRoomId: string | null
  /** Where that point was taken. */
  probe: { x: number; z: number; y: number }
  verdict: 'MATCH' | 'WRONG_ROOM' | 'NO_ROOM'
}

/**
 * Which room is actually behind each opening.
 *
 * The probe is a point one third of a metre in from the host wall's inner face,
 * at the middle of the opening, and the answer is whichever room polygon on that
 * storey contains it. Nothing consults the opening's own claim until the two are
 * compared, so an opening re-hosted onto a wall that fronts a different room
 * changes the answer rather than the label.
 */
export function openingRoomTable(
  interior: InteriorSpec,
  wallsById: ReadonlyMap<string, WallSpec>,
  openings: readonly ExteriorOpeningGroup[],
  levelOf: (o: ExteriorOpeningGroup) => string,
  insetM = 0.33,
): OpeningRoomRow[] {
  const roomsByLevel = new Map<string, RoomSpec[]>()
  for (const r of interior.rooms) {
    const list = roomsByLevel.get(r.levelId) ?? []
    list.push(r)
    roomsByLevel.set(r.levelId, list)
  }
  return openings.map((o) => {
    const w = wallsById.get(o.hostWallId)
    const level = levelOf(o)
    if (w === undefined) {
      return {
        openingId: o.id,
        hostWallId: o.hostWallId,
        claimedRoomId: o.roomId,
        foundRoomId: null,
        probe: { x: Number.NaN, z: Number.NaN, y: Number.NaN },
        verdict: 'NO_ROOM' as const,
      }
    }
    const p = wallPoint(w, o.offsetM + o.widthM / 2, 0.1, w.thicknessM + insetM)
    const rooms = roomsByLevel.get(level) ?? []
    const found = rooms.find((r) => pointInPolygon({ x: p.x, z: p.z }, r.polygon))
    return {
      openingId: o.id,
      hostWallId: o.hostWallId,
      claimedRoomId: o.roomId,
      foundRoomId: found?.id ?? null,
      probe: { x: p.x, y: p.y, z: p.z },
      verdict: found === undefined ? ('NO_ROOM' as const) : found.id === o.roomId ? ('MATCH' as const) : ('WRONG_ROOM' as const),
    }
  })
}

// --- raked head -------------------------------------------------------------

export type RakedHeadSample = {
  u: number
  /** Head the source polygon puts at this `u`, above the wall base. */
  sourceHeadM: number
  /** Head the geometry actually has, above the wall base. */
  measuredHeadM: number | null
  /** Material above the head at this `u` — the wall has to close over it. */
  closedAboveM: number
}

export type RakedHeadReport = {
  openingId: string
  samples: RakedHeadSample[]
  maxHeadErrorM: number
  minClosedAboveM: number
  /** Glass found above the source polygon: a floating triangle would show here. */
  strayGlassM: number
}

/**
 * Does the cut follow the printed polygon, and does the wall close over it?
 *
 * The source polygon is rebuilt here from the printed width and the two printed
 * heights alone — this function never asks the compiler where it put the head.
 * A rectangular hole with a triangle of glass laid over it fails twice: the
 * measured head is flat where the polygon rakes, and the glass probe finds
 * material where the polygon says wall.
 */
export function rakedHeadReport(
  tris: readonly SceneTri[],
  w: WallSpec,
  o: ExteriorOpeningGroup,
  sourceHeadAt: (fraction: number) => number,
  samples = 17,
): RakedHeadReport {
  const solid = solidOf(tris)
  const fills = fillsOf(tris, o.id)
  const out: RakedHeadSample[] = []
  let maxHeadErrorM = 0
  let minClosedAboveM = Number.POSITIVE_INFINITY
  let strayGlassM = 0
  const c = w.thicknessM / 2
  for (let i = 1; i < samples; i++) {
    const f = i / samples
    const u = o.offsetM + o.widthM * f
    const sourceHeadM = sourceHeadAt(f)
    // A vertical line through the middle of the wall's thickness, in the wall's
    // own frame: `wallPoint` carries the orientation, so this is the same probe
    // for a wall that runs along X, along Z or at any other angle.
    const p0 = wallPoint(w, u, 0, c)
    const runs = materialRuns(solid, { x: p0.x, y: -20, z: p0.z }, { x: 0, y: 1, z: 0 }, 1e-7)
    const base = w.origin.y
    const above = runs
      .map((r) => ({ t0: r.t0 - 20, t1: r.t1 - 20 }))
      .filter((r) => r.t1 > base + sourceHeadM - 1e-6)
    const measuredHeadM = above.length === 0 ? null : above[0].t0 - base
    const closedAboveM = above.reduce((acc, r) => acc + (r.t1 - Math.max(r.t0, base + sourceHeadM)), 0)
    if (measuredHeadM !== null) maxHeadErrorM = Math.max(maxHeadErrorM, Math.abs(measuredHeadM - sourceHeadM))
    minClosedAboveM = Math.min(minClosedAboveM, closedAboveM)
    const glass = materialRuns(fills, { x: p0.x, y: -20, z: p0.z }, { x: 0, y: 1, z: 0 }, 1e-7)
    strayGlassM += glass.reduce(
      (acc, r) => acc + Math.max(0, r.t1 - 20 - Math.max(r.t0 - 20, base + sourceHeadM + 1e-4)),
      0,
    )
    out.push({ u, sourceHeadM, measuredHeadM, closedAboveM })
  }
  return { openingId: o.id, samples: out, maxHeadErrorM, minClosedAboveM, strayGlassM }
}

// --- duplicate volume -------------------------------------------------------

export type OverlapRow = { a: string; b: string; lengthM: number; at: OVec; dir: OVec }

/**
 * Pairs of elements that share material, measured along a grid of rays.
 *
 * `meshOverlapAlong` in `geometry-oracles.ts` answers the same question for
 * single closed solids and is the right tool there. It cannot be used on a
 * whole house: a gable roof is two planes meeting at a ridge and a stair is
 * seventeen treads in contact, and pairing crossings up on a union like that
 * reports an odd count and refuses. Counting depth instead — the same rule
 * `materialRuns` uses — reads a union as one run and a genuine overlap as two
 * runs that intersect, which is what is wanted.
 *
 * Every row is a defect: two elements occupying the same cubic metres is
 * material paid for twice, and it is invisible in every render.
 */
export function duplicateVolumeReport(
  meshes: ReadonlyArray<{ id: string; tris: readonly OTri[] }>,
  lines: ReadonlyArray<{ origin: OVec; dir: OVec }>,
  tolerance = 1e-6,
): OverlapRow[] {
  const out: OverlapRow[] = []
  for (const line of lines) {
    const runs = meshes.map((m) => ({ id: m.id, runs: materialRuns(m.tris, line.origin, line.dir, tolerance) }))
    for (let i = 0; i < runs.length; i++) {
      for (let j = i + 1; j < runs.length; j++) {
        let lengthM = 0
        for (const p of runs[i].runs) {
          for (const q of runs[j].runs) lengthM += Math.max(0, Math.min(p.t1, q.t1) - Math.max(p.t0, q.t0))
        }
        if (lengthM > tolerance) out.push({ a: runs[i].id, b: runs[j].id, lengthM, at: line.origin, dir: line.dir })
      }
    }
  }
  return out
}

/** A regular grid of rays down each world axis, covering the whole site. */
export function axisGrid(
  bounds: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number },
  columns = 31,
  rows = 16,
): Array<{ origin: OVec; dir: OVec }> {
  const out: Array<{ origin: OVec; dir: OVec }> = []
  const lerp = (a: number, b: number, i: number, n: number): number => a + ((b - a) * (i + 0.5)) / n
  for (let i = 0; i < columns; i++) {
    for (let j = 0; j < rows; j++) {
      out.push({
        origin: { x: bounds.minX - 6, y: lerp(bounds.minY, bounds.maxY, j, rows), z: lerp(bounds.minZ, bounds.maxZ, i, columns) },
        dir: { x: 1, y: 0, z: 0 },
      })
      out.push({
        origin: { x: lerp(bounds.minX, bounds.maxX, i, columns), y: lerp(bounds.minY, bounds.maxY, j, rows), z: bounds.minZ - 6 },
        dir: { x: 0, y: 0, z: 1 },
      })
      out.push({
        origin: { x: lerp(bounds.minX, bounds.maxX, i, columns), y: bounds.minY - 8, z: lerp(bounds.minZ, bounds.maxZ, j, rows) },
        dir: { x: 0, y: 1, z: 0 },
      })
    }
  }
  return out
}
