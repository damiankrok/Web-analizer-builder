/**
 * The Marcowki characteristic facade, from the gold fixture — STAGE WEB-PIVOT-05.
 *
 * Development only. This module turns `research/gold/marcowki-facade-v1.json`
 * into a `FacadeSpec` and into the `BuildingSpec` that carries its structural
 * cuts, and it is the only place those coordinates are read. Nothing in the
 * production analyzer imports it.
 *
 * ## The shell is extended, never edited
 *
 * `marcowkiBuildingSpec()` is left exactly as STAGE WEB-PIVOT-02 proved it, and
 * `marcowkiFacadeBuildingSpec()` derives a *new* spec from it: the same walls
 * with the source-stated openings cut into them, plus the roof that covers the
 * two recesses. Every STAGE WEB-PIVOT-02 and 02A test still runs against the
 * original and still sees the shell it was written for.
 *
 * Two mechanical details the derivation has to get right:
 *
 *   - **Every host wall is given a top profile.** An exterior door's sill *is*
 *     the floor, and the proven rectangular tiling refuses a cut flush with an
 *     edge; the profiled tiling expresses it. A level `POLYLINE` at the wall's
 *     own height is the honest description of a flat top, and it routes the
 *     wall to the path that can carry the openings.
 *   - **The roof is extended rather than moved.** The main roof's footprint in
 *     STAGE WEB-PIVOT-02 is the walled envelope, z 0..12.60. The side
 *     elevations show roof and wall ending together over 14.60 m, so two more
 *     gable pieces cover the recesses. Additive, so the shell's own roof volume
 *     is unchanged. Nothing covers the portal but the portal head itself, which
 *     is a facade slab and not a roof.
 *
 * ## Mutations
 *
 * `MarcowkiFacadeOptions` breaks the facade in the ten ways STAGE WEB-PIVOT-05
 * §26 names. None is ever the default.
 *
 * PORT_DIRECT (Kotlin) — plain data.
 */
import goldJson from '../../../research/gold/marcowki-facade-v1.json' with { type: 'json' }
import type { Vec3 } from '../contracts/geometry.js'
import type { BuildingSpec, Provenance, RoofSpec, SpecStatus } from './architectural.js'
import { compileBuilding, isSolidBuildingPart, type BuildingCompileResult } from './building.js'
import type { OpeningSpec, WallSpec, WallTopProfile } from './contracts.js'
import { compileInterior, isSolidInteriorPart, type InteriorCompileResult, type InteriorSpec } from './interior.js'
import { marcowkiInteriorSpec, type MarcowkiInteriorOptions } from './marcowki-interior-fixture.js'
import { IDS, M, marcowkiBuildingSpec, soffitPlane } from './marcowki-fixture.js'
import {
  compileFacade,
  structuralCuts,
  type CompiledFacade,
  type ExteriorOpeningGroup,
  type FacadeBandSpec,
  type FacadeRecessSpec,
  type FacadeReturnSpec,
  type FacadeSide,
  type FacadeSlabSpec,
  type FacadeSpec,
  type PortalSpec,
  type RailingSpec,
} from './facade.js'

export const facadeGold = goldJson

const prov = (locator: string, status: string, source: string, interpretation: string): Provenance => ({
  source: 'research/gold/marcowki-facade-v1.json',
  locator,
  interpretation,
  status: status as SpecStatus,
  note: source,
})

// --- mutations --------------------------------------------------------------

export type MarcowkiFacadeOptions = {
  /**
   * Fill the recess with material, so the facade is flat at the outer plane.
   *
   * This is the model somebody produces who read the side elevation's 14.60 m
   * as the wall envelope: a box of the right silhouette with the recess painted
   * on. It needs no new compiler path — a return the width of the mouth and the
   * depth of the recess *is* a flat facade — which is the point: the defect is
   * ordinary data that only a measurement distinguishes from the truth.
   */
  flattenRecess?: string
  /** Move only the back wall to the outer plane, leaving the returns behind. */
  backWallToOuterPlane?: string
  /** Take a balcony slab away, or slide it. */
  dropSlab?: string
  moveSlab?: { slabId: string; deltaX?: number; deltaZ?: number }
  /** Replace the glass balustrade with an opaque one, or shorten its run. */
  opaqueRailing?: string
  shortenRailing?: { railingId: string; byM: number }
  /** Emit an opening's fills without cutting its hole. */
  glazingWithoutCut?: string
  /** Re-host an opening on a wall that does not front the room it serves. */
  moveOpening?: { openingId: string; toWallId: string; offsetM: number }
  /** Turn a projecting portal head into a recessed one. */
  reversePortalProjection?: boolean
  /** Level the gable glazing's raked head. */
  levelGableHead?: string
  /** Drop one facade's major opening. */
  dropOpening?: string
  /** Mirror one facade's openings about the building's centre line. */
  mirrorFacade?: FacadeSide
}

/**
 * How high a return has to reach before the roof soffit clips it.
 *
 * The soffit over the main body runs from 4.36 at either eave to 7.95 at the
 * ridge; a return that starts at ground level and is told to be this tall is
 * cut to the plane everywhere along its 0.61 m thickness, and nowhere stops
 * short of it. It is a working height, not a measurement, which is why it is
 * not in the gold file.
 */
const SOFFIT_REACH_M = 8.5

// --- the facade spec --------------------------------------------------------

type GoldOpening = (typeof goldJson.openings)[number]

/** Which wall each opening is hosted by, after any mutation. */
const hostOf = (o: GoldOpening, opts: MarcowkiFacadeOptions): { wallId: string; offsetM: number } =>
  opts.moveOpening?.openingId === o.id
    ? { wallId: opts.moveOpening.toWallId, offsetM: opts.moveOpening.offsetM }
    : { wallId: o.hostWallId, offsetM: o.offsetM }

/**
 * Mirror an opening's offset about the building's centre line.
 *
 * The walls run nose to tail round the ring, so an offset is measured from one
 * end of the wall and mirroring it is `length - offset - width`. A facade that
 * is mirrored this way keeps every opening's size and its wall, and changes
 * only where along it they sit — which is exactly the defect §26 asks for.
 */
const mirrorOffset = (offsetM: number, widthM: number, wallLengthM: number): number =>
  wallLengthM - offsetM - widthM

export function marcowkiFacadeSpec(opts: MarcowkiFacadeOptions = {}): FacadeSpec {
  const wallLengths = new Map(marcowkiBuildingSpec().walls.map((w) => [w.id, w.lengthM]))

  // The recess record always states what the source says, mutation or not: it is
  // the claim the oracles measure against, and a mutation that quietly restated
  // the claim would be marking its own homework.
  const recesses: FacadeRecessSpec[] = facadeGold.recesses.map((r) => {
    return {
      id: r.id,
      facade: r.facade as FacadeSide,
      outerPlaneM: r.outerPlaneZ,
      backPlaneM: r.backPlaneZ,
      depthAxis: 'Z',
      fromM: r.fromX,
      toM: r.toX,
      baseM: r.baseM,
      topM: r.topM,
      provenance: prov(`recesses[${r.id}]`, r.status, r.source, `${r.depthM} m deep recess in the ${r.facade} facade`),
    }
  })

  const returns: Array<{ id: string; recessId: string; wall: WallSpec; provenance: Provenance }> = facadeGold.returns.map((r) => {
    const half = r.thicknessM / 2
    const flat = 'flatTopM' in r ? (r.flatTopM as number) : undefined
    const topProfile: WallTopProfile =
      flat !== undefined
        ? { kind: 'POLYLINE', points: [{ u: 0, topM: flat - r.baseM }, { u: r.toM - r.fromM, topM: flat - r.baseM }] }
        : {
            kind: 'PLANE',
            plane: soffitPlane(r.soffitAtX as number, r.soffitRisesTowardsPlusX as boolean),
            sourceRoofId: (r.soffitRoofId as string | undefined) ?? IDS.gableRoof,
          }
    // A return runs along Z at a fixed x. Its `u` is +Z, so its outward normal
    // comes out at -X and the origin sits on the -X face: the same rule every
    // wall in this repository follows, applied to a blade. A POLYLINE top is
    // measured from the wall base, so a return that starts part-way up the
    // building has its flat top stated relative to its own base; a PLANE top is
    // a world plane and needs no such adjustment.
    const wall: WallSpec = {
      id: r.id,
      origin: { x: r.atM - half, y: r.baseM, z: r.fromM },
      u: { x: 0, y: 0, z: 1 },
      up: { x: 0, y: 1, z: 0 },
      lengthM: r.toM - r.fromM,
      heightM: flat === undefined ? SOFFIT_REACH_M - r.baseM : flat - r.baseM,
      thicknessM: r.thicknessM,
      topProfile,
    }
    return {
      id: r.id,
      recessId: r.recessId,
      wall,
      provenance: prov(`returns[${r.id}]`, r.status, r.source, 'a side return of the recess'),
    }
  })

  if (opts.flattenRecess !== undefined) {
    const r = recesses.find((x) => x.id === opts.flattenRecess)
    if (r !== undefined) {
      const depth = Math.abs(r.outerPlaneM - r.backPlaneM) || 1
      returns.push({
        id: `${r.id}__flattened`,
        recessId: r.id,
        wall: {
          id: `${r.id}__flattened`,
          origin: { x: r.fromM, y: r.baseM, z: r.outerPlaneM },
          u: { x: 1, y: 0, z: 0 },
          up: { x: 0, y: 1, z: 0 },
          lengthM: r.toM - r.fromM,
          heightM: 5.18 - r.baseM,
          thicknessM: depth,
        },
        provenance: prov(`recesses[${r.id}]`, 'ASSUMPTION', 'mutation', 'the recess filled in'),
      })
    }
  }

  // A reversed projection puts the head and the floor of the recess *inside* the
  // house instead of in front of it. Mirroring about the back plane is exactly
  // that, and it leaves the silhouette from straight ahead unchanged — which is
  // why a ray fired over the mouth is the thing that notices.
  const mirrorZ = (z: number): number => 2 * facadeGold.recesses[0].backPlaneZ - z
  const reversed = (recessId: string): boolean =>
    opts.reversePortalProjection === true && recessId === facadeGold.recesses[0].id
  if (opts.reversePortalProjection === true) {
    for (const r of returns) {
      if (!reversed(r.recessId)) continue
      const z0 = mirrorZ(r.wall.origin.z + r.wall.lengthM)
      r.wall = { ...r.wall, origin: { ...r.wall.origin, z: z0 } }
    }
  }

  const slabs: FacadeSlabSpec[] = facadeGold.slabs
    .filter((s) => opts.dropSlab !== s.id)
    .map((s) => {
      const dx = opts.moveSlab?.slabId === s.id ? (opts.moveSlab.deltaX ?? 0) : 0
      const flip = reversed(s.recessId)
      const dz = (opts.moveSlab?.slabId === s.id ? (opts.moveSlab.deltaZ ?? 0) : 0) + (flip ? mirrorZ(s.maxZ) - s.minZ : 0)
      return {
        id: s.id,
        recessId: s.recessId,
        kind: s.kind as FacadeSlabSpec['kind'],
        footprint: { minX: s.minX + dx, maxX: s.maxX + dx, minZ: s.minZ + dz, maxZ: s.maxZ + dz },
        topM: s.topM,
        thicknessM: s.thicknessM,
        ...('usableFromX' in s && s.usableFromX !== undefined
          ? { usable: { fromM: (s.usableFromX as number) + dx, toM: (s.usableToX as number) + dx } }
          : {}),
        provenance: prov(`slabs[${s.id}]`, s.status, s.source, `${s.kind} in ${s.recessId}`),
      }
    })

  const railings: RailingSpec[] = facadeGold.railings.map((r) => {
    const cut = opts.shortenRailing?.railingId === r.id ? opts.shortenRailing.byM : 0
    const spans = r.panels.map(([fromM, toM]) => ({ fromM, toM }))
    // Shortening takes the run's far end away, panel by panel and then part of
    // one, which is how a balustrade that stops short of the slab edge actually
    // looks — not a uniformly squeezed set of panels.
    const end = Math.max(...spans.map((p) => p.toM)) - cut
    const kept = spans.filter((p) => p.fromM < end - 1e-9).map((p) => ({ fromM: p.fromM, toM: Math.min(p.toM, end) }))
    return {
      id: r.id,
      slabId: r.slabId,
      axis: r.axis as 'X' | 'Z',
      atM: r.atM,
      thicknessM: r.thicknessM,
      baseM: r.baseM,
      heightM: r.heightM,
      material: opts.opaqueRailing === r.id ? 'SOLID' : (r.material as 'GLASS' | 'SOLID'),
      panels: kept,
      postWidthM: r.postWidthM,
      provenance: prov(`railings[${r.id}]`, r.status, r.source, `${r.material} balustrade on ${r.slabId}`),
    }
  })

  const portals: PortalSpec[] = facadeGold.portals.map((p) => ({
    id: p.id,
    recessId: p.recessId,
    facade: p.facade as FacadeSide,
    outerPlaneM: opts.reversePortalProjection ? p.outerPlaneZ - 2 * p.depthM : p.outerPlaneZ,
    depthM: opts.reversePortalProjection ? -p.depthM : p.depthM,
    openingMinM: p.openingMinX,
    openingMaxM: p.openingMaxX,
    openingBaseM: p.openingBaseM,
    openingTopM: p.openingTopM,
    jambIds: [...p.jambIds],
    headIds: [...p.headIds],
    materialClass: p.materialClass,
    provenance: prov(`portals[${p.id}]`, p.status, p.source, 'the mouth of the front recess'),
  }))

  const openings: ExteriorOpeningGroup[] = facadeGold.openings
    .filter((o) => opts.dropOpening !== o.id)
    .map((o) => {
      const host = hostOf(o, opts)
      let offsetM = host.offsetM
      if (opts.mirrorFacade && o.facade === opts.mirrorFacade) {
        offsetM = mirrorOffset(offsetM, o.widthM, wallLengths.get(host.wallId) ?? 0)
      }
      const levelled = opts.levelGableHead === o.id
      return {
        id: o.id,
        facade: o.facade as FacadeSide,
        storey: o.storey,
        hostWallId: host.wallId,
        offsetM,
        widthM: o.widthM,
        sillM: o.sillM,
        headM: o.headM,
        ...(o.headFarM !== undefined && !levelled ? { headFarM: o.headFarM } : {}),
        kind: o.kind as ExteriorOpeningGroup['kind'],
        exposure: o.exposure as ExteriorOpeningGroup['exposure'],
        ...('leaves' in o && o.leaves ? { leaves: (o.leaves as Array<{ hostWallId: string; offsetM: number }>).map((l) => ({ ...l })) } : {}),
        printed: o.printed,
        roomId: o.roomId,
        ...('connectsRoomId' in o && o.connectsRoomId ? { connectsRoomId: o.connectsRoomId as string } : {}),
        fills: o.fills.map((f) => ({ kind: f.kind as OpeningFillKind, from: f.from, to: f.to })),
        mullions: [...o.mullions],
        provenance: prov(`openings[${o.id}]`, o.status, o.source, `${o.kind} on the ${o.facade} facade`),
      }
    })

  const bands: FacadeBandSpec[] = facadeGold.materialBands.map((b) => ({
    id: b.id,
    facade: b.facade as FacadeSide,
    material: b.material,
    fromM: 'minX' in b && b.minX !== undefined ? (b.minX as number) : (b.minZ as number),
    toM: 'maxX' in b && b.maxX !== undefined ? (b.maxX as number) : (b.maxZ as number),
    baseM: b.baseM,
    topM: b.topM,
    provenance: prov(`materialBands[${b.id}]`, b.status, b.source, `${b.material} cladding, flush`),
  }))

  return {
    id: facadeGold.id,
    version: facadeGold.schemaVersion,
    recesses,
    returns,
    slabs,
    railings,
    portals,
    openings,
    bands,
    provenance: prov('method', 'SOURCE_CORROBORATED', facadeGold.method.note, 'the Marcowki characteristic facade'),
    unresolved: [...facadeGold.unresolved],
  }
}

type OpeningFillKind = ExteriorOpeningGroup['fills'][number]['kind']

// --- the shell, extended ----------------------------------------------------

/** A level top profile: the honest description of a flat wall top. */
const levelProfile = (lengthM: number, topM: number): WallTopProfile => ({
  kind: 'POLYLINE',
  points: [
    { u: 0, topM },
    { u: lengthM, topM },
  ],
})

/**
 * The STAGE WEB-PIVOT-02 shell with this stage's cuts and roof in it.
 *
 * `withCuts` decides whether the structural holes are applied at all — the
 * `glazingWithoutCut` mutation hands the fills to the compiler while keeping
 * the wall solid, which is the defect §26 item 5 names and which nothing but a
 * ray through the wall would notice.
 */
export function marcowkiFacadeBuildingSpec(opts: MarcowkiFacadeOptions = {}): BuildingSpec {
  const base = marcowkiBuildingSpec()
  const facade = marcowkiFacadeSpec(opts)
  const suppressed = new Set(opts.glazingWithoutCut ? [opts.glazingWithoutCut] : [])
  const cuts: OpeningSpec[] = facade.openings.filter((o) => !suppressed.has(o.id)).flatMap(structuralCuts)
  const hosts = new Set(cuts.map((c) => c.hostWallId))

  const profiled = base.walls.map((w) =>
    hosts.has(w.id) && w.topProfile === undefined ? { ...w, topProfile: levelProfile(w.lengthM, w.heightM) } : w,
  )

  // A back wall pushed out to the outer plane leaves the recess looking like a
  // recess from the side — the returns are still there — and solid from in
  // front. Two oracles catch it and neither is a picture: a probe into the
  // mouth meets material at the outer plane, and an opening's room probe lands
  // a metre outside every room polygon on the storey.
  const flat = facadeGold.recesses.find((r) => r.id === opts.backWallToOuterPlane)
  const walls =
    flat === undefined
      ? profiled
      : profiled.map((w) =>
          Math.abs(w.origin.z - flat.backPlaneZ) < 1e-9 && Math.abs(w.u.z) < 1e-9
            ? { ...w, origin: { ...w.origin, z: flat.outerPlaneZ } }
            : w,
        )

  // The gable opening STAGE WEB-PIVOT-02 already carries is this stage's
  // `og_front_gable_glazing`; taking the shell's copy out keeps one hole per
  // hole rather than two records for the same cut.
  const keptOpenings = base.openings.filter((o) => o.id !== IDS.gableOpening)
  const keptGlazing = base.glazing.filter((g) => g.openingId !== IDS.gableOpening)

  // One roof, longer. The shell's own footprint stops at the walls because that
  // is all STAGE WEB-PIVOT-02 had measured; the side elevations then show roof
  // and wall ending together over 14.60 m, so the same two planes at the same
  // pitch run from z -1.00 to z 13.60. Extending the one roof rather than
  // abutting two more prisms against it matters: the volume and the silhouette
  // would be identical either way, and the seams would not.
  const ext = facadeGold.roofExtent
  const roofs: RoofSpec[] = base.roofs.map((r) =>
    r.id === ext.id
      ? {
          ...r,
          footprint: { ...r.footprint, minZ: ext.minZ, maxZ: ext.maxZ },
          provenance: prov('roofExtent', ext.status, ext.source, 'the main roof, over both recesses'),
        }
      : r,
  )

  return {
    ...base,
    id: `${base.id}_facade`,
    walls,
    openings: [...keptOpenings, ...cuts],
    glazing: keptGlazing,
    roofs,
  }
}

// --- the whole house --------------------------------------------------------

/**
 * One triangle of the assembled house, whichever layer emitted it.
 *
 * Three compilers produce this model — the shell's, STAGE WEB-PIVOT-04's
 * interior, and this stage's facade — and every oracle that asks a question
 * about the *building* rather than about one layer has to see all three at
 * once. `layer` is kept so a report can still say which compiler a surface came
 * from; `solid` is what a ray should count as material, so that glass, room
 * floors and diagram surfaces do not stop a probe that is looking for wall.
 */
export type SceneTri = {
  a: Vec3
  b: Vec3
  c: Vec3
  layer: 'SHELL' | 'INTERIOR' | 'FACADE'
  part: string
  elementKind: string
  elementId: string
  ownerId: string
  solid: boolean
  openingId?: string
  facade?: FacadeSide
}

export type MarcowkiScene = {
  building: BuildingCompileResult
  interior: InteriorCompileResult
  facade: CompiledFacade
  spec: { building: BuildingSpec; interior: InteriorSpec; facade: FacadeSpec }
  tris: SceneTri[]
  /** Every diagnostic any of the three compilers raised, tagged by layer. */
  diagnostics: Array<{ layer: SceneTri['layer']; severity: string; code: string; message: string }>
}

/**
 * Compile the shell, the interior and the facade into one model.
 *
 * Three joins matter and all three are made here rather than inside a compiler:
 *
 *   - **The upper floor slab is emitted once, on the shell's footprint.** Both
 *     gold files describe `slab_upper_floor`, because each is a complete
 *     description of its own layer, and they do not agree: the shell insets it
 *     to the bearing rectangle x 0.45..7.45, z 0.45..12.15 and runs the ground
 *     walls past it to 3.06, while the interior spans the whole 7.90 x 12.60
 *     outline. Taken together that is 0.33 m of slab inside the wall head — the
 *     same material twice. The shell's rectangle is proven and STAGE
 *     WEB-PIVOT-05 §1 forbids regressing it, so the scene keeps the shell's
 *     *footprint* and the interior's *void*: one slab, bearing where the shell
 *     says, with the stair opening STAGE WEB-PIVOT-04 proved still in it. The
 *     disagreement itself is recorded in the report rather than absorbed.
 *   - **The facade's cuts are handed to the shell.** `compileFacade` returns
 *     them rather than applying them, so one compiler owns every hole in every
 *     wall and a fill can never sit in front of uncut material.
 *   - **The facade's returns are compiled against the cut walls**, so an
 *     opening's host wall is the same object both layers see.
 */
/**
 * What a later stage may add to this scene without rewriting it.
 *
 * STAGE WEB-PIVOT-05A needs roof openings, chimney masses and one interior
 * element replaced by a mass, and none of that belongs in a stage that is
 * finished and proved. Two transforms, applied to the specs before anything is
 * compiled, keep the join in the later stage's own file: pass neither and the
 * scene is byte-for-byte the one STAGE WEB-PIVOT-05 measured.
 */
export type MarcowkiSceneExtension = {
  building?: (spec: BuildingSpec) => BuildingSpec
  interior?: (spec: InteriorSpec) => InteriorSpec
}

export function marcowkiFacadeScene(
  opts: MarcowkiFacadeOptions & { interior?: MarcowkiInteriorOptions; extend?: MarcowkiSceneExtension } = {},
): MarcowkiScene {
  const buildingSpec = opts.extend?.building
    ? opts.extend.building(marcowkiFacadeBuildingSpec(opts))
    : marcowkiFacadeBuildingSpec(opts)
  const shellSlab = buildingSpec.slabs.find((s) => s.id === IDS.slab)
  const withoutSlab: BuildingSpec = {
    ...buildingSpec,
    slabs: buildingSpec.slabs.filter((s) => s.id !== IDS.slab),
  }
  const building = compileBuilding(withoutSlab)

  const statedInterior = marcowkiInteriorSpec(opts.interior ?? {})
  const bearing = shellSlab?.footprint
  const interiorSpec: InteriorSpec =
    bearing === undefined
      ? statedInterior
      : {
          ...statedInterior,
          slabs: statedInterior.slabs.map((s) =>
            s.id === IDS.slab
              ? {
                  ...s,
                  footprint: [
                    { x: bearing.minX, z: bearing.minZ },
                    { x: bearing.maxX, z: bearing.minZ },
                    { x: bearing.maxX, z: bearing.maxZ },
                    { x: bearing.minX, z: bearing.maxZ },
                  ],
                }
              : s,
          ),
        }
  const finalInterior = opts.extend?.interior ? opts.extend.interior(interiorSpec) : interiorSpec
  const interior = compileInterior(finalInterior)

  const facadeSpec = marcowkiFacadeSpec(opts)
  const facade = compileFacade(facadeSpec, new Map(withoutSlab.walls.map((w) => [w.id, w])))

  const tris: SceneTri[] = [
    ...building.tris.map((t) => ({
      a: t.a,
      b: t.b,
      c: t.c,
      layer: 'SHELL' as const,
      part: t.part,
      elementKind: t.elementKind,
      elementId: t.elementId,
      ownerId: t.ownerId,
      solid: isSolidBuildingPart(t.part),
      ...(t.openingId === undefined ? {} : { openingId: t.openingId }),
    })),
    ...interior.tris.map((t) => ({
      a: t.a,
      b: t.b,
      c: t.c,
      layer: 'INTERIOR' as const,
      part: t.part,
      elementKind: t.elementKind,
      elementId: t.elementId,
      ownerId: t.ownerId,
      solid: isSolidInteriorPart(t.part),
      ...(t.openingId === undefined ? {} : { openingId: t.openingId }),
    })),
    ...facade.tris.map((t) => ({
      a: t.a,
      b: t.b,
      c: t.c,
      layer: 'FACADE' as const,
      part: t.part,
      elementKind: t.elementKind,
      elementId: t.elementId,
      ownerId: t.ownerId,
      // A fill is not material: the whole point of a hole is that a ray goes
      // through it, and a pane of glass that stopped one would make every
      // opening check pass on a solid wall.
      solid: t.elementKind === 'RETURN' || t.elementKind === 'SLAB',
      ...(t.openingId === undefined ? {} : { openingId: t.openingId }),
      ...(t.facade === undefined ? {} : { facade: t.facade }),
    })),
  ]

  return {
    building,
    interior,
    facade,
    spec: { building: withoutSlab, interior: finalInterior, facade: facadeSpec },
    tris,
    diagnostics: [
      ...building.diagnostics.map((d) => ({ layer: 'SHELL' as const, severity: d.severity, code: d.code, message: d.message })),
      ...interior.diagnostics.map((d) => ({ layer: 'INTERIOR' as const, severity: d.severity, code: d.code, message: d.message })),
      ...facade.diagnostics.map((d) => ({ layer: 'FACADE' as const, severity: d.severity, code: d.code, message: d.message })),
    ],
  }
}
