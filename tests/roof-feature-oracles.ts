/**
 * Independent measurement for STAGE WEB-PIVOT-05A.
 *
 * Everything here reads triangles. Nothing reads a `RoofOpeningSpec`, a
 * `MassSpec`, a compiled opening record or any other thing the compiler wrote
 * down — the specs come in only to say *where to look*, never to say what
 * should be found there. A rooflight is a hole because a ray goes through it,
 * not because a record says `kind: 'ROOFLIGHT'`.
 *
 * The two questions this stage turns on are both about absence, which is why
 * they need their own oracles: a rooflight has to have no roof in it, and a
 * chimney has to have no roof in it *and* no daylight around it. A surface
 * count cannot tell those apart and a picture cannot either.
 */
import type { SceneTri } from '../src/core/wallspec/marcowki-facade-fixture.js'
import type { RoofPlaneFrame } from '../src/core/wallspec/roof.js'
import type { OTri, OVec } from './geometry-oracles.js'
import { materialRuns, mergeIntervals, rayHits, type Interval } from './geometry-oracles.js'

export const asO = (tris: readonly SceneTri[]): OTri[] => tris.map((t) => ({ a: t.a, b: t.b, c: t.c }))

/** The roof covering only: no fills, no walls, no masses. */
export const roofFabric = (tris: readonly SceneTri[], roofId?: string): OTri[] =>
  asO(
    tris.filter(
      (t) => (t.part === 'ROOF' || t.part === 'ROOF_REVEAL') && (roofId === undefined || t.elementId === roofId),
    ),
  )

export const partsOf = (tris: readonly SceneTri[], part: string): SceneTri[] => tris.filter((t) => t.part === part)

export const openingTris = (tris: readonly SceneTri[], openingId: string, part?: string): SceneTri[] =>
  tris.filter((t) => t.openingId === openingId && (part === undefined || t.part === part))

export const elementTrisOf = (tris: readonly SceneTri[], elementId: string): OTri[] =>
  asO(tris.filter((t) => t.elementId === elementId))

const add = (p: OVec, d: OVec, k: number): OVec => ({ x: p.x + d.x * k, y: p.y + d.y * k, z: p.z + d.z * k })

/** A point of a plane's top surface, from its local coordinates. Duplicated here on purpose. */
export const planeAt = (f: RoofPlaneFrame, u: number, v: number): OVec => ({
  x: f.originM.x + f.uDir.x * u + f.vDir.x * v,
  y: f.originM.y + f.uDir.y * u + f.vDir.y * v,
  z: f.originM.z + f.uDir.z * u + f.vDir.z * v,
})

const runLength = (list: readonly Interval[]): number => list.reduce((a, i) => a + (i.t1 - i.t0), 0)

/**
 * How much material a line perpendicular to a plane meets at one (u, v).
 *
 * The ray starts a metre clear of the top surface and travels into the roof, so
 * `t` is a depth and the returned length is a thickness measured the way a
 * section measures one.
 */
export function depthThroughPlane(tris: readonly OTri[], f: RoofPlaneFrame, u: number, v: number, standoff = 1): number {
  const p = planeAt(f, u, v)
  const origin = add(p, f.normal, standoff)
  const dir = { x: -f.normal.x, y: -f.normal.y, z: -f.normal.z }
  return runLength(materialRuns(tris, origin, dir, 1e-7).filter((i) => i.t0 < standoff + 3))
}

export type RoofOpeningCutReport = {
  openingId: string
  /** Roof met on lines through the opening. Must be zero for a real hole. */
  throughM: number
  /** Roof met on lines just outside it. Must be the plane's own thickness. */
  besideM: number
  /** Smallest beside-reading, so one thin spot cannot hide in an average. */
  besideMinM: number
  /** Reveal faces the tiling produced at this hole, and their area. */
  revealTriangles: number
  revealAreaM2: number
  /** Fill material met on a line through the centre. */
  fillM: number
  /** Fill found outside the opening's own rectangle. Must be zero. */
  strayFillM: number
}

const triArea = (t: OTri): number => {
  const ux = t.b.x - t.a.x
  const uy = t.b.y - t.a.y
  const uz = t.b.z - t.a.z
  const vx = t.c.x - t.a.x
  const vy = t.c.y - t.a.y
  const vz = t.c.z - t.a.z
  return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2
}

/**
 * Is an opening really a hole?
 *
 * Four numbers answer it and all four are needed. Zero roof *through* the
 * opening says the material was removed; a full thickness *beside* it says only
 * the opening was removed; reveal faces say the solid closed itself around the
 * hole rather than being left open; and fill that appears inside the rectangle
 * and nowhere else says the unit is in the cut rather than laid over it.
 */
export function roofOpeningCutReport(
  tris: readonly SceneTri[],
  f: RoofPlaneFrame,
  openingId: string,
  rect: { u0: number; u1: number; v0: number; v1: number },
  samples = 5,
): RoofOpeningCutReport {
  const fabric = roofFabric(tris)
  // Probed vertically inside the opening's own plan footprint, for the same
  // reason the stray probe below is: the hole is a vertical cut, so a ray along
  // the plane normal leaves it through the side before it reaches the underside
  // and reports the roof it then meets as material left in the hole. A vertical
  // line either passes clean through the void or it does not, whatever the
  // pitch.
  const planRect = openingPlanRect(f, rect)
  let throughM = 0
  for (let i = 1; i <= samples; i++) {
    for (let j = 1; j <= samples; j++) {
      const x = planRect.minX + ((planRect.maxX - planRect.minX) * i) / (samples + 1)
      const z = planRect.minZ + ((planRect.maxZ - planRect.minZ) * j) / (samples + 1)
      throughM += runLength(materialRuns(fabric, { x, y: -40, z }, { x: 0, y: 1, z: 0 }, 1e-7))
    }
  }
  const outside: Array<[number, number]> = []
  const midU = (rect.u0 + rect.u1) / 2
  const midV = (rect.v0 + rect.v1) / 2
  const pad = 0.12
  for (let k = 0; k < samples; k++) {
    const tu = rect.u0 + ((rect.u1 - rect.u0) * (k + 0.5)) / samples
    const tv = rect.v0 + ((rect.v1 - rect.v0) * (k + 0.5)) / samples
    outside.push([tu, rect.v0 - pad], [tu, rect.v1 + pad], [rect.u0 - pad, tv], [rect.u1 + pad, tv])
  }
  const besides = outside.map(([u, v]) => depthThroughPlane(fabric, f, u, v))
  const reveals = openingTris(tris, openingId, 'ROOF_REVEAL')
  const fills = asO(tris.filter((t) => t.openingId === openingId && (t.part === 'ROOF_FRAME' || t.part === 'ROOF_GLAZING')))
  const fillM = depthThroughPlane(fills, f, rect.u0 + (rect.u1 - rect.u0) * 0.06, midV)
  // Fill outside the opening, asked the way the hole is actually defined.
  //
  // The hole is a *vertical* cut through a sloped plane, so the thing that
  // bounds it in plan is a vertical prism, and the fill in it is one too. Probe
  // that with a ray along the plane normal and the answer is wrong by
  // construction: a vertical extrusion of depth `d` on a plane of pitch θ
  // projects perpendicularly to a rectangle `d · sin θ` longer down-slope than
  // the patch it came from — 0.177 m here — so a ring 0.12 m out lands inside
  // the fill's own perpendicular shadow and reports stray material that is not
  // there. Firing vertically at plan positions outside the opening's plan
  // footprint asks about the prism instead of about its shadow, and agrees with
  // the convention `emitPlane` uses to find its reveals.
  const planPad = 0.12
  const planBox = openingPlanRect(f, rect)
  let strayFillM = 0
  for (let k = 0; k < samples; k++) {
    const tx = planBox.minX + ((planBox.maxX - planBox.minX) * (k + 0.5)) / samples
    const tz = planBox.minZ + ((planBox.maxZ - planBox.minZ) * (k + 0.5)) / samples
    for (const [x, z] of [
      [tx, planBox.minZ - planPad],
      [tx, planBox.maxZ + planPad],
      [planBox.minX - planPad, tz],
      [planBox.maxX + planPad, tz],
    ] as Array<[number, number]>) {
      strayFillM += runLength(materialRuns(fills, { x, y: -40, z }, { x: 0, y: 1, z: 0 }, 1e-7))
    }
  }
  return {
    openingId,
    throughM,
    besideM: besides.reduce((a, b) => a + b, 0) / Math.max(1, besides.length),
    besideMinM: besides.length === 0 ? 0 : Math.min(...besides),
    revealTriangles: reveals.length,
    revealAreaM2: asO(reveals).reduce((a, t) => a + triArea(t), 0),
    fillM: fillM + depthThroughPlane(fills, f, midU, midV),
    strayFillM,
  }
}

export type ChimneySection = {
  /** Where the section was taken, in world metres along the stack's own axis. */
  atM: number
  /** The stack's material along the vertical line, merged. */
  stackRuns: Interval[]
  /** Roof fabric along the same line. */
  roofRuns: Interval[]
  /** Positive volume the two share. Must be zero. */
  overlapM: number
  /** Gap between the stack's side and the nearest roof material, in the section plane. */
  gapM: number
}

export type ChimneyPenetrationReport = {
  massId: string
  /** True when the stack is one unbroken run from base to top on every section. */
  continuous: boolean
  /** Smallest run the stack showed, so a break cannot hide in an average. */
  minRunM: number
  sections: ChimneySection[]
  /** Roof met on a vertical line inside the stack's footprint. Must be zero. */
  roofInsideM: number
  /** Roof met just outside it. Must be the full roof thickness. */
  roofBesideM: number
}

/**
 * Does a stack really pass through the roof?
 *
 * Three things have to hold at once and each rules out a different fake. No
 * roof inside the stack's footprint rules out a solid pushed through intact
 * material. A stack that is one unbroken run from base to cap rules out a
 * shaft that stops at the ceiling and starts again above the tiles. And roof
 * at full thickness immediately beside it rules out a hole cut far wider than
 * the stack — the "unexplained gap" of §11 — which no view from below would
 * show.
 */
export function chimneyPenetrationReport(
  tris: readonly SceneTri[],
  massId: string,
  footprint: { minX: number; maxX: number; minZ: number; maxZ: number },
  baseM: number,
  topM: number,
  sectionsAcross = 5,
): ChimneyPenetrationReport {
  const stack = elementTrisOf(tris, massId)
  const fabric = roofFabric(tris)
  const down = { x: 0, y: -1, z: 0 }
  const high = topM + 2
  const sections: ChimneySection[] = []
  let minRunM = Infinity
  let continuous = true
  let roofInsideM = 0
  for (let i = 1; i <= sectionsAcross; i++) {
    for (let j = 1; j <= sectionsAcross; j++) {
      const x = footprint.minX + ((footprint.maxX - footprint.minX) * i) / (sectionsAcross + 1)
      const z = footprint.minZ + ((footprint.maxZ - footprint.minZ) * j) / (sectionsAcross + 1)
      const origin = { x, y: high, z }
      const stackRuns = mergeIntervals(materialRuns(stack, origin, down, 1e-7), 1e-6)
      const roofRuns = mergeIntervals(materialRuns(fabric, origin, down, 1e-7), 1e-6)
      let overlapM = 0
      for (const p of stackRuns) for (const q of roofRuns) overlapM += Math.max(0, Math.min(p.t1, q.t1) - Math.max(p.t0, q.t0))
      roofInsideM += runLength(roofRuns)
      const total = runLength(stackRuns)
      minRunM = Math.min(minRunM, stackRuns.length === 1 ? total : 0)
      if (stackRuns.length !== 1 || Math.abs(total - (topM - baseM)) > 1e-6) continuous = false
      sections.push({ atM: z, stackRuns, roofRuns, overlapM, gapM: 0 })
    }
  }
  // Beside: a ring of vertical lines a hair outside the footprint, where the
  // roof must be at its full thickness if the cut is the stack's own size.
  const pad = 0.05
  const beside: number[] = []
  for (let k = 0; k < sectionsAcross; k++) {
    const tx = footprint.minX + ((footprint.maxX - footprint.minX) * (k + 0.5)) / sectionsAcross
    const tz = footprint.minZ + ((footprint.maxZ - footprint.minZ) * (k + 0.5)) / sectionsAcross
    for (const [x, z] of [
      [tx, footprint.minZ - pad],
      [tx, footprint.maxZ + pad],
      [footprint.minX - pad, tz],
      [footprint.maxX + pad, tz],
    ] as Array<[number, number]>) {
      beside.push(runLength(materialRuns(fabric, { x, y: high, z }, down, 1e-7)))
    }
  }
  return {
    massId,
    continuous,
    minRunM: Number.isFinite(minRunM) ? minRunM : 0,
    sections,
    roofInsideM,
    roofBesideM: beside.length === 0 ? 0 : Math.min(...beside),
  }
}

/**
 * The gap between a stack's side and the roof, measured in the roof surface.
 *
 * A horizontal ray fired outwards from just inside the stack, at the height
 * where the roof's top surface crosses that side, travels through the stack's
 * own wall and then through air until it meets roof. With the minimal
 * penetration §11 asks for, that air is nothing.
 */
/**
 * The annular gap between a stack and the hole it passes through, in plan.
 *
 * Measured on a vertical line, not a horizontal one, and that is the whole of
 * it. A horizontal ray at some chosen height either misses the roof entirely —
 * the roof is above it at that `x` — or crosses it far from the penetration, so
 * the number it returns is about the slope's position, not about the gap. A
 * chimney and its hole are both vertical prisms, so the gap between them is a
 * plan-space quantity: step out from the stack's face in plan and ask how far
 * you must go before a vertical line meets roof again.
 *
 * Returns 0 when the roof begins at the stack's own face — a hole cut exactly
 * to the stack — and the gap in metres otherwise. `NaN` means no roof was found
 * within `maxM`, which is a missing-roof fault rather than a clearance reading.
 */
export function chimneyClearanceM(
  tris: readonly SceneTri[],
  _massId: string,
  footprint: { minX: number; maxX: number; minZ: number; maxZ: number },
  side: 'minX' | 'maxX' | 'minZ' | 'maxZ',
  maxM = 0.6,
  stepM = 0.005,
): number {
  const fabric = roofFabric(tris)
  const cx = (footprint.minX + footprint.maxX) / 2
  const cz = (footprint.minZ + footprint.maxZ) / 2
  const hitsRoof = (x: number, z: number): boolean =>
    materialRuns(fabric, { x, y: -40, z }, { x: 0, y: 1, z: 0 }, 1e-7).length > 0
  for (let d = 0; d <= maxM; d += stepM) {
    const x = side === 'minX' ? footprint.minX - d : side === 'maxX' ? footprint.maxX + d : cx
    const z = side === 'minZ' ? footprint.minZ - d : side === 'maxZ' ? footprint.maxZ + d : cz
    if (hitsRoof(x, z)) return d
  }
  return Number.NaN
}

/** Which room polygon a point in plan falls in, if any. */
export function roomAt(
  rooms: ReadonlyArray<{ id: string; polygon: ReadonlyArray<{ x: number; z: number }> }>,
  x: number,
  z: number,
): string | null {
  for (const r of rooms) {
    let inside = false
    const p = r.polygon
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      if (p[i].z > z !== p[j].z > z && x < ((p[j].x - p[i].x) * (z - p[i].z)) / (p[j].z - p[i].z) + p[i].x) inside = !inside
    }
    if (inside) return r.id
  }
  return null
}

/** The plan rectangle an opening's cut covers, by projecting its corners down. */
export function openingPlanRect(
  f: RoofPlaneFrame,
  rect: { u0: number; u1: number; v0: number; v1: number },
): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const pts = [
    planeAt(f, rect.u0, rect.v0),
    planeAt(f, rect.u1, rect.v0),
    planeAt(f, rect.u1, rect.v1),
    planeAt(f, rect.u0, rect.v1),
  ]
  return {
    minX: Math.min(...pts.map((p) => p.x)),
    maxX: Math.max(...pts.map((p) => p.x)),
    minZ: Math.min(...pts.map((p) => p.z)),
    maxZ: Math.max(...pts.map((p) => p.z)),
  }
}
