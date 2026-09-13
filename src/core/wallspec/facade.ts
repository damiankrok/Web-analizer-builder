/**
 * Characteristic facade contracts and compiler — STAGE WEB-PIVOT-05.
 *
 * Development only. Nothing in the production analyzer imports this module.
 *
 * ## What this layer adds, and what it refuses to add
 *
 * STAGE WEB-PIVOT-02 built a shell and STAGE WEB-PIVOT-04 put rooms inside it.
 * Both are correct and neither is recognisable: a gable box with the right
 * dimensions is every gable box with the right dimensions. What makes Marcowki
 * Marcowki is a short list of real pieces of building — two one-metre recesses
 * with wall returns down their sides, the balconies and glass balustrades
 * inside them, the dark portal over the entrance and the garage, and twelve
 * openings that are holes rather than pictures of holes.
 *
 * Every one of those is emitted here as geometry a ray can be fired through.
 * There are no painted rectangles, no floating panes and no camera tricks:
 * `tests/facade-oracles.ts` measures each claim by casting into the triangle
 * list, and every check would fail on a flat facade with the same silhouette.
 *
 * ## One structural hole, several fills
 *
 * An `ExteriorOpeningGroup` is one cut through one wall, plus the panels that
 * fill it. A four-panel sliding door is **one** hole with four glass fills and
 * three mullions, not four holes — quantities come off the structural opening,
 * and a compiler that made one hole per pane would report a facade with three
 * extra reveals and the wrong wall area. The cut itself goes through the proven
 * wall compiler as an ordinary `OpeningSpec`; this module only adds what goes
 * in it.
 *
 * ## Nothing here knows it is Marcowki
 *
 * Every type below is generic — a recess is a depth and a span, a return is a
 * wall, a portal is a mouth with named jambs and heads. The building's own
 * numbers live in `marcowki-facade-fixture.ts` and in the gold file it reads.
 *
 * PORT_DIRECT (Kotlin) — plain data and pure functions.
 */
import type { Vec3 } from '../contracts/geometry.js'
import type { OpeningSpec, WallSpec } from './contracts.js'
import { wallFrame, wallPoint } from './contracts.js'
import { compileWalls } from './compile.js'
import type { Provenance } from './architectural.js'

/** Which face of the building a feature belongs to. */
export type FacadeSide = 'FRONT' | 'REAR' | 'EAST' | 'WEST' | 'NORTH_GARAGE'

export type FacadeStatus =
  | 'SOURCE_EXACT'
  | 'SOURCE_CORROBORATED'
  | 'SOURCE_DERIVED'
  | 'VISUAL_DERIVED'
  | 'ASSUMPTION'
  | 'UNRESOLVED'

/** What a panel inside a structural opening is made of. */
export type FillKind = 'GLASS' | 'DOOR_LEAF' | 'GARAGE_PANEL' | 'LOUVRE'

/**
 * One panel filling part of a structural opening.
 *
 * `from` and `to` are fractions of the opening's own width, so a fill knows
 * nothing about where in the building it is and a re-measured opening carries
 * its panels with it.
 */
export type OpeningFill = {
  kind: FillKind
  from: number
  to: number
}

export type ExteriorOpeningKind = 'WINDOW' | 'DOOR' | 'GARAGE_DOOR' | 'GLAZING_GROUP'

/**
 * One structural hole in one wall, and everything that sits in it.
 *
 * The hole is stated in the host wall's own coordinates — the same frame every
 * stage since WEB-PIVOT-01 has used — so a recessed wall hosts an opening
 * exactly as a flush one does and no bounding box is ever consulted.
 */
export type ExteriorOpeningGroup = {
  id: string
  facade: FacadeSide
  storey: string
  hostWallId: string
  /** Distance along the host wall's `u` to the opening's near edge. */
  offsetM: number
  widthM: number
  /** Height above the wall base to the sill. */
  sillM: number
  /** Height above the wall base to the head at the near edge. */
  headM: number
  /** Head at the far edge, when the head is raked. Absent means level. */
  headFarM?: number
  kind: ExteriorOpeningKind
  /**
   * Whether a person outside can see this opening at all.
   *
   * A door in a wall that another mass stands against is a real hole and has to
   * be cut, but it is not part of any facade's opening count: reporting it
   * there would claim an elevation shows something no elevation shows.
   */
  exposure: 'EXTERIOR' | 'CONCEALED'
  /**
   * Further wall leaves the same structural opening passes through.
   *
   * Where two closed rings abut back to back, the wall between two rooms is two
   * walls, and a door through it is one opening through both. Cutting only the
   * near leaf leaves the far one standing in the doorway — which a ray notices
   * and a picture does not. Each leaf carries its own offset, because each wall
   * has its own origin and its own `u`.
   */
  leaves?: readonly { hostWallId: string; offsetM: number }[]
  /** The width/height callout the drawing prints, verbatim, or null. */
  printed: string | null
  /** The room the opening looks into. */
  roomId: string
  /** For a door between two interior spaces, the room on the other side. */
  connectsRoomId?: string
  fills: readonly OpeningFill[]
  /** Fractions of the width at which a mullion stands. */
  mullions: readonly number[]
  provenance: Provenance
}

/**
 * A rectangular bite out of a facade, one metre deep or ten.
 *
 * `outerPlane` is the plane a person outside reads as the facade; `backPlane`
 * is where the wall actually is. Both are stated, because the whole point of
 * the feature is that they are different and a model that collapses them looks
 * like a different house.
 */
export type FacadeRecessSpec = {
  id: string
  facade: FacadeSide
  /** World coordinate of the outer plane, on the axis the recess is cut into. */
  outerPlaneM: number
  /** World coordinate of the back plane. */
  backPlaneM: number
  /** Which world axis the depth runs along. */
  depthAxis: 'X' | 'Z'
  fromM: number
  toM: number
  baseM: number
  topM: number
  provenance: Provenance
}

/**
 * A wall down the side of a recess.
 *
 * It is a wall, so it is a `WallSpec` and it compiles through the wall
 * compiler; what this record adds is which recess it belongs to and, when it
 * dies into the roof, the soffit plane it stops at.
 */
export type FacadeReturnSpec = {
  id: string
  recessId: string
  wall: WallSpec
  provenance: Provenance
}

export type FacadeSlabKind = 'BALCONY' | 'PORTAL_HEAD' | 'CANOPY'

export type FacadeSlabSpec = {
  id: string
  recessId: string
  kind: FacadeSlabKind
  footprint: { minX: number; maxX: number; minZ: number; maxZ: number }
  /** World elevation of the slab's top surface. */
  topM: number
  thicknessM: number
  /** The part a person can stand on, when that is less than the whole slab. */
  usable?: { fromM: number; toM: number }
  provenance: Provenance
}

/**
 * A balustrade: a run of glass on top of a slab.
 *
 * Panels are emitted as separate solids with a gap between them, because that
 * is what the source shows and because a single long pane would hide a wrong
 * extent. The top rail is a thin solid over the whole run.
 */
export type RailingSpec = {
  id: string
  slabId: string
  /** Which world axis the run travels along. */
  axis: 'X' | 'Z'
  /** The other coordinate: the centre line of the glass. */
  atM: number
  thicknessM: number
  baseM: number
  heightM: number
  material: 'GLASS' | 'SOLID'
  /**
   * Where each panel starts and ends along `axis`, in world coordinates.
   *
   * Spans rather than a count, because the source draws the posts and a count
   * would throw away where they are. The gaps between consecutive spans are
   * posts; `postWidthM` is only a cross-check that they are the width the
   * drawing shows.
   */
  panels: readonly { fromM: number; toM: number }[]
  postWidthM: number
  provenance: Provenance
}

/** The whole extent a railing covers, posts included. */
export const railingExtent = (r: RailingSpec): { fromM: number; toM: number } => ({
  fromM: Math.min(...r.panels.map((p) => p.fromM)),
  toM: Math.max(...r.panels.map((p) => p.toM)),
})

/**
 * The mouth of a recess, named so that it can be checked.
 *
 * A portal emits no geometry of its own: its jambs are returns and its head is
 * a slab, all of which are emitted once by their own records. What it adds is
 * the claim — this rectangle in the outer plane is open, those elements frame
 * it — and `portalReport` in the oracles measures whether that is true by
 * firing rays through the mouth and past its edges.
 */
export type PortalSpec = {
  id: string
  recessId: string
  facade: FacadeSide
  outerPlaneM: number
  /** How far back from the outer plane the mouth leads. */
  depthM: number
  openingMinM: number
  openingMaxM: number
  openingBaseM: number
  openingTopM: number
  jambIds: readonly string[]
  headIds: readonly string[]
  materialClass: string
  provenance: Provenance
}

/** A flush change of cladding. Material only: it has no depth and emits nothing. */
export type FacadeBandSpec = {
  id: string
  facade: FacadeSide
  material: string
  fromM: number
  toM: number
  baseM: number
  topM: number
  provenance: Provenance
}

export type FacadeSpec = {
  id: string
  version: string
  recesses: FacadeRecessSpec[]
  returns: FacadeReturnSpec[]
  slabs: FacadeSlabSpec[]
  railings: RailingSpec[]
  portals: PortalSpec[]
  openings: ExteriorOpeningGroup[]
  bands: FacadeBandSpec[]
  provenance: Provenance
  unresolved: string[]
}

// --- emitted geometry -------------------------------------------------------

export type FacadePart =
  | 'GLASS'
  | 'DOOR_PANEL'
  | 'GARAGE_PANEL'
  | 'FRAME'
  | 'SLAB'
  | 'RAILING_GLASS'
  | 'RAILING_RAIL'
  | 'WALL'
  | 'WALL_INNER'
  | 'REVEAL'
export type FacadeElementKind = 'FILL' | 'MULLION' | 'SLAB' | 'RAILING' | 'RETURN'

export type FacadeTri = {
  a: Vec3
  b: Vec3
  c: Vec3
  part: FacadePart
  elementKind: FacadeElementKind
  elementId: string
  ownerId: string
  /** The opening a fill or mullion belongs to, where it belongs to one. */
  openingId?: string
  facade?: FacadeSide
}

export type FacadeDiagnosticCode =
  | 'DUPLICATE_FACADE_ID'
  | 'UNKNOWN_HOST_WALL'
  | 'UNKNOWN_RECESS'
  | 'UNKNOWN_SLAB'
  | 'FILL_OUTSIDE_OPENING'
  | 'FILLS_OVERLAP'
  | 'INVALID_SLAB'
  | 'INVALID_RAILING'
  | 'PORTAL_FRAME_MISSING'

export type FacadeDiagnostic = {
  code: FacadeDiagnosticCode
  severity: 'ERROR' | 'WARNING'
  message: string
  openingId?: string
  slabId?: string
  portalId?: string
}

export type CompiledFacade = {
  tris: FacadeTri[]
  /** The structural cuts, ready to hand to the wall compiler. */
  cuts: Array<{ hostWallId: string; opening: OpeningSpec }>
  diagnostics: FacadeDiagnostic[]
}

const EPS = 1e-9
const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z })

/** A closed box wound outwards. */
export function facadeBox(
  out: FacadeTri[],
  r: { minX: number; maxX: number; minZ: number; maxZ: number },
  bottomY: number,
  topY: number,
  tag: Omit<FacadeTri, 'a' | 'b' | 'c'>,
): void {
  const add = (p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3): void => {
    out.push({ ...tag, a: p0, b: p1, c: p2 })
    out.push({ ...tag, a: p0, b: p2, c: p3 })
  }
  const { minX, maxX, minZ, maxZ } = r
  const t = topY
  const b = bottomY
  add(v(minX, t, maxZ), v(maxX, t, maxZ), v(maxX, t, minZ), v(minX, t, minZ))
  add(v(minX, b, minZ), v(maxX, b, minZ), v(maxX, b, maxZ), v(minX, b, maxZ))
  add(v(minX, b, maxZ), v(maxX, b, maxZ), v(maxX, t, maxZ), v(minX, t, maxZ))
  add(v(maxX, b, minZ), v(minX, b, minZ), v(minX, t, minZ), v(maxX, t, minZ))
  add(v(maxX, b, maxZ), v(maxX, b, minZ), v(maxX, t, minZ), v(maxX, t, maxZ))
  add(v(minX, b, minZ), v(minX, b, maxZ), v(minX, t, maxZ), v(minX, t, minZ))
}

/**
 * A box in a wall's own frame: `a0..a1` along, `b0..b1` up, `c0..c1` inward.
 *
 * Fills and mullions are placed this way rather than in world coordinates so
 * that they inherit the host wall's frame exactly, and a wall that moves takes
 * its glass with it. Every vertex goes through `wallPoint`, the same function
 * the wall itself is built from.
 */
export function wallLocalBox(
  out: FacadeTri[],
  w: WallSpec,
  a0: number,
  a1: number,
  b0: number,
  b1: number,
  c0: number,
  c1: number,
  tag: Omit<FacadeTri, 'a' | 'b' | 'c'>,
): void {
  const P = (a: number, b: number, c: number): Vec3 => wallPoint(w, a, b, c)
  const add = (p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3): void => {
    out.push({ ...tag, a: p0, b: p1, c: p2 })
    out.push({ ...tag, a: p0, b: p2, c: p3 })
  }
  // `c` runs *inward*, so the outward face is at c0 and winds one way while the
  // face at c1 winds the other. The six faces below are stated in that frame
  // and are correct for any wall orientation, because `wallPoint` carries it.
  add(P(a0, b0, c0), P(a1, b0, c0), P(a1, b1, c0), P(a0, b1, c0)) // outward face
  add(P(a0, b0, c1), P(a0, b1, c1), P(a1, b1, c1), P(a1, b0, c1)) // inward face
  add(P(a0, b0, c0), P(a0, b1, c0), P(a0, b1, c1), P(a0, b0, c1)) // a0 end
  add(P(a1, b0, c0), P(a1, b0, c1), P(a1, b1, c1), P(a1, b1, c0)) // a1 end
  add(P(a0, b1, c0), P(a1, b1, c0), P(a1, b1, c1), P(a0, b1, c1)) // top
  add(P(a0, b0, c0), P(a0, b0, c1), P(a1, b0, c1), P(a1, b0, c0)) // bottom
}

/** Head height of an opening group at a fraction of its own width. */
export const headAtFraction = (o: ExteriorOpeningGroup, f: number): number =>
  o.headFarM === undefined ? o.headM : o.headM + f * (o.headFarM - o.headM)

/** The structural cut an opening group asks the wall compiler for. */
export const structuralCut = (o: ExteriorOpeningGroup): OpeningSpec => ({
  id: o.id,
  hostWallId: o.hostWallId,
  offsetM: o.offsetM,
  sillM: o.sillM,
  widthM: o.widthM,
  heightM: o.headM - o.sillM,
  ...(o.headFarM === undefined ? {} : { heightFarM: o.headFarM - o.sillM }),
  cut: 'THROUGH',
})

/**
 * Every cut one opening group asks for: the host wall's, and each further leaf.
 *
 * The leaves share the group's height, width and sill and differ only in which
 * wall they go through and where along it, so a re-measured opening carries its
 * far leaf with it and the two can never drift apart.
 */
export const structuralCuts = (o: ExteriorOpeningGroup): OpeningSpec[] => [
  structuralCut(o),
  ...(o.leaves ?? []).map((l) => ({
    ...structuralCut(o),
    id: `${o.id}__${l.hostWallId}`,
    hostWallId: l.hostWallId,
    offsetM: l.offsetM,
  })),
]

/** How deep from the outer face a fill sits, and how thick it is. */
export const FILL_INSET_M = 0.06
export const FILL_THICKNESS_M = 0.05
export const MULLION_WIDTH_M = 0.07

const PART_OF: Record<FillKind, FacadePart> = {
  GLASS: 'GLASS',
  DOOR_LEAF: 'DOOR_PANEL',
  GARAGE_PANEL: 'GARAGE_PANEL',
  LOUVRE: 'FRAME',
}

/**
 * Compile the facade layer.
 *
 * The structural cuts are returned rather than applied: they belong to the
 * shell's walls, and the caller hands them to `compileBuilding` so that one
 * compiler owns every hole in the building. What is emitted here is everything
 * that is *not* a hole — the fills, the mullions, the returns' slabs, the
 * balconies and the balustrades.
 */
export function compileFacade(
  spec: FacadeSpec,
  wallsById: ReadonlyMap<string, WallSpec>,
): CompiledFacade {
  const diagnostics: FacadeDiagnostic[] = []
  const tris: FacadeTri[] = []
  const cuts: CompiledFacade['cuts'] = []
  const seen = new Set<string>()
  const dup = (id: string): void => {
    diagnostics.push({ code: 'DUPLICATE_FACADE_ID', severity: 'ERROR', message: `facade id ${id} appears more than once` })
  }

  const recessIds = new Set(spec.recesses.map((r) => r.id))
  const slabIds = new Set(spec.slabs.map((s) => s.id))

  for (const o of spec.openings) {
    if (seen.has(o.id)) {
      dup(o.id)
      continue
    }
    seen.add(o.id)
    const host = wallsById.get(o.hostWallId)
    if (!host) {
      diagnostics.push({
        code: 'UNKNOWN_HOST_WALL',
        severity: 'ERROR',
        message: `opening ${o.id} names host wall ${o.hostWallId}, which the shell does not have`,
        openingId: o.id,
      })
      continue
    }
    let leavesKnown = true
    for (const l of o.leaves ?? []) {
      if (!wallsById.has(l.hostWallId)) {
        leavesKnown = false
        diagnostics.push({
          code: 'UNKNOWN_HOST_WALL',
          severity: 'ERROR',
          message: `opening ${o.id} names a further leaf on wall ${l.hostWallId}, which the shell does not have`,
          openingId: o.id,
        })
      }
    }
    if (leavesKnown) for (const c of structuralCuts(o)) cuts.push({ hostWallId: c.hostWallId, opening: c })
    else cuts.push({ hostWallId: o.hostWallId, opening: structuralCut(o) })

    const sorted = [...o.fills].sort((a, b) => a.from - b.from)
    for (let i = 0; i < sorted.length; i++) {
      const f = sorted[i]
      if (f.from < -EPS || f.to > 1 + EPS || f.to <= f.from + EPS) {
        diagnostics.push({
          code: 'FILL_OUTSIDE_OPENING',
          severity: 'ERROR',
          message: `fill ${i} of opening ${o.id} spans ${f.from}..${f.to} of its width`,
          openingId: o.id,
        })
        continue
      }
      if (i > 0 && f.from < sorted[i - 1].to - EPS) {
        diagnostics.push({
          code: 'FILLS_OVERLAP',
          severity: 'ERROR',
          message: `fills ${i - 1} and ${i} of opening ${o.id} overlap`,
          openingId: o.id,
        })
        continue
      }
      // The fill stops short of each mullion it meets, so a panel and a mullion
      // never occupy the same material.
      const half = MULLION_WIDTH_M / 2 / o.widthM
      const near = o.mullions.some((m) => Math.abs(m - f.from) < 1e-6) ? f.from + half : f.from
      const far = o.mullions.some((m) => Math.abs(m - f.to) < 1e-6) ? f.to - half : f.to
      const a0 = o.offsetM + near * o.widthM
      const a1 = o.offsetM + far * o.widthM
      // A raked head slopes across the panel; the panel follows it, which is
      // what keeps a gable window's glass inside its own hole.
      const h0 = headAtFraction(o, near)
      const h1 = headAtFraction(o, far)
      const tag = {
        part: PART_OF[f.kind],
        elementKind: 'FILL' as const,
        elementId: `${o.id}_fill_${i}`,
        ownerId: o.id,
        openingId: o.id,
        facade: o.facade,
      }
      if (Math.abs(h0 - h1) <= EPS) {
        wallLocalBox(tris, host, a0, a1, o.sillM, h0, FILL_INSET_M, FILL_INSET_M + FILL_THICKNESS_M, tag)
      } else {
        rakedPanel(tris, host, a0, a1, o.sillM, h0, h1, FILL_INSET_M, FILL_INSET_M + FILL_THICKNESS_M, tag)
      }
    }

    for (const m of o.mullions) {
      const a = o.offsetM + m * o.widthM
      const h = headAtFraction(o, m)
      wallLocalBox(
        tris,
        host,
        a - MULLION_WIDTH_M / 2,
        a + MULLION_WIDTH_M / 2,
        o.sillM,
        h,
        FILL_INSET_M,
        FILL_INSET_M + FILL_THICKNESS_M,
        {
          part: 'FRAME',
          elementKind: 'MULLION',
          elementId: `${o.id}_mullion_${m}`,
          ownerId: o.id,
          openingId: o.id,
          facade: o.facade,
        },
      )
    }
  }

  // The returns are walls, so they compile through STAGE WEB-PIVOT-01's own
  // wall compiler — including the PLANE top that lets them die into the roof
  // over the recess exactly as the attic side walls do. They are compiled here
  // rather than added to a storey shell because they are not part of a closed
  // ring, and a ring compiler asked to close four walls plus five blades would
  // be right to refuse.
  if (spec.returns.length > 0) {
    const r = compileWalls({ walls: spec.returns.map((x) => x.wall), openings: [], glazing: [] })
    for (const d of r.diagnostics) {
      diagnostics.push({
        code: 'INVALID_SLAB',
        severity: d.severity,
        message: `[${d.code}] ${d.message}`,
      })
    }
    const recessOf = new Map(spec.returns.map((x) => [x.wall.id, x.recessId]))
    for (const t of r.tris) {
      tris.push({
        a: t.a,
        b: t.b,
        c: t.c,
        part: t.part as FacadePart,
        elementKind: 'RETURN',
        elementId: t.wallId,
        ownerId: recessOf.get(t.wallId) ?? t.wallId,
      })
    }
  }
  for (const r of spec.returns) {
    if (!recessIds.has(r.recessId)) {
      diagnostics.push({ code: 'UNKNOWN_RECESS', severity: 'ERROR', message: `return ${r.id} names recess ${r.recessId}` })
    }
  }

  for (const s of spec.slabs) {
    if (seen.has(s.id)) {
      dup(s.id)
      continue
    }
    seen.add(s.id)
    if (!recessIds.has(s.recessId)) {
      diagnostics.push({ code: 'UNKNOWN_RECESS', severity: 'ERROR', message: `slab ${s.id} names recess ${s.recessId}`, slabId: s.id })
    }
    const f = s.footprint
    if (!(f.maxX - f.minX > EPS) || !(f.maxZ - f.minZ > EPS) || !(s.thicknessM > EPS)) {
      diagnostics.push({
        code: 'INVALID_SLAB',
        severity: 'ERROR',
        message: `slab ${s.id} spans ${f.minX}..${f.maxX} by ${f.minZ}..${f.maxZ} at ${s.thicknessM} m thick`,
        slabId: s.id,
      })
      continue
    }
    facadeBox(tris, f, s.topM - s.thicknessM, s.topM, {
      part: 'SLAB',
      elementKind: 'SLAB',
      elementId: s.id,
      ownerId: s.id,
    })
  }

  for (const r of spec.railings) {
    if (seen.has(r.id)) {
      dup(r.id)
      continue
    }
    seen.add(r.id)
    if (!slabIds.has(r.slabId)) {
      diagnostics.push({ code: 'UNKNOWN_SLAB', severity: 'ERROR', message: `railing ${r.id} stands on slab ${r.slabId}, which is not in the spec` })
    }
    const sortedPanels = [...r.panels].sort((a, b) => a.fromM - b.fromM)
    const bad =
      r.panels.length < 1 ||
      !(r.heightM > EPS) ||
      sortedPanels.some((p, i) => p.toM <= p.fromM + EPS || (i > 0 && p.fromM < sortedPanels[i - 1].toM - EPS))
    if (bad) {
      diagnostics.push({
        code: 'INVALID_RAILING',
        severity: 'ERROR',
        message: `railing ${r.id} has ${r.panels.length} panels at ${r.heightM} m: ${r.panels
          .map((p) => `${p.fromM}..${p.toM}`)
          .join(', ')}`,
      })
      continue
    }
    const half = r.thicknessM / 2
    const RAIL_M = 0.04
    const across = (a0: number, a1: number): { minX: number; maxX: number; minZ: number; maxZ: number } =>
      r.axis === 'X'
        ? { minX: a0, maxX: a1, minZ: r.atM - half, maxZ: r.atM + half }
        : { minX: r.atM - half, maxX: r.atM + half, minZ: a0, maxZ: a1 }
    sortedPanels.forEach((p, i) => {
      facadeBox(tris, across(p.fromM, p.toM), r.baseM, r.baseM + r.heightM - RAIL_M, {
        part: r.material === 'GLASS' ? 'RAILING_GLASS' : 'SLAB',
        elementKind: 'RAILING',
        elementId: `${r.id}_panel_${i}`,
        ownerId: r.id,
      })
      // The gap to the next panel is a post, and it is emitted as one: leaving
      // it empty would make the run read as separate sheets of glass, and
      // filling it with glass would claim a continuous pane the drawing does
      // not show.
      const next = sortedPanels[i + 1]
      if (next !== undefined && next.fromM > p.toM + EPS) {
        facadeBox(tris, across(p.toM, next.fromM), r.baseM, r.baseM + r.heightM - RAIL_M, {
          part: 'RAILING_RAIL',
          elementKind: 'RAILING',
          elementId: `${r.id}_post_${i}`,
          ownerId: r.id,
        })
      }
    })
    // One rail over the whole run, panels and posts alike.
    const ext = railingExtent(r)
    const railRect =
      r.axis === 'X'
        ? { minX: ext.fromM, maxX: ext.toM, minZ: r.atM - half - 0.01, maxZ: r.atM + half + 0.01 }
        : { minX: r.atM - half - 0.01, maxX: r.atM + half + 0.01, minZ: ext.fromM, maxZ: ext.toM }
    facadeBox(tris, railRect, r.baseM + r.heightM - RAIL_M, r.baseM + r.heightM, {
      part: 'RAILING_RAIL',
      elementKind: 'RAILING',
      elementId: `${r.id}_rail`,
      ownerId: r.id,
    })
  }

  for (const p of spec.portals) {
    if (!recessIds.has(p.recessId)) {
      diagnostics.push({ code: 'UNKNOWN_RECESS', severity: 'ERROR', message: `portal ${p.id} names recess ${p.recessId}`, portalId: p.id })
    }
    const returnIds = new Set(spec.returns.map((r) => r.id))
    for (const j of p.jambIds) {
      if (!returnIds.has(j)) {
        diagnostics.push({
          code: 'PORTAL_FRAME_MISSING',
          severity: 'ERROR',
          message: `portal ${p.id} names jamb ${j}, which is not a return in this spec`,
          portalId: p.id,
        })
      }
    }
    for (const h of p.headIds) {
      if (!slabIds.has(h)) {
        diagnostics.push({
          code: 'PORTAL_FRAME_MISSING',
          severity: 'ERROR',
          message: `portal ${p.id} names head ${h}, which is not a slab in this spec`,
          portalId: p.id,
        })
      }
    }
  }

  return { tris, cuts, diagnostics }
}

/**
 * A panel whose head slopes, as a six-faced solid.
 *
 * `wallLocalBox` would give it a level top; a gable window's glass has to
 * follow the same rake its hole does or it stands proud of the reveal at one
 * end and short of it at the other.
 */
function rakedPanel(
  out: FacadeTri[],
  w: WallSpec,
  a0: number,
  a1: number,
  b0: number,
  h0: number,
  h1: number,
  c0: number,
  c1: number,
  tag: Omit<FacadeTri, 'a' | 'b' | 'c'>,
): void {
  const P = (a: number, b: number, c: number): Vec3 => wallPoint(w, a, b, c)
  const add = (p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3): void => {
    out.push({ ...tag, a: p0, b: p1, c: p2 })
    out.push({ ...tag, a: p0, b: p2, c: p3 })
  }
  add(P(a0, b0, c0), P(a1, b0, c0), P(a1, h1, c0), P(a0, h0, c0))
  add(P(a0, b0, c1), P(a0, h0, c1), P(a1, h1, c1), P(a1, b0, c1))
  add(P(a0, b0, c0), P(a0, h0, c0), P(a0, h0, c1), P(a0, b0, c1))
  add(P(a1, b0, c0), P(a1, b0, c1), P(a1, h1, c1), P(a1, h1, c0))
  add(P(a0, h0, c0), P(a1, h1, c0), P(a1, h1, c1), P(a0, h0, c1))
  add(P(a0, b0, c0), P(a0, b0, c1), P(a1, b0, c1), P(a1, b0, c0))
}

/** Parts that make up closed facade solids. All of them, here. */
export const isSolidFacadePart = (): boolean => true

/** The outward normal of a wall, for oracles that need to aim at a facade. */
export const facadeNormal = (w: WallSpec): Vec3 => wallFrame(w).n
