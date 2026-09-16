/**
 * The registered building, as triangles — STAGE WEB-PIVOT-07R §11.
 *
 * CHECKPOINT_ONLY. Nothing in `src/core`, `src/node`, `src/web` or `src/ui`
 * imports this file, and a test asserts it. It reads a `RegisteredBuilding`
 * and returns triangles; it decides nothing, measures nothing and corrects
 * nothing.
 *
 * Four rules, and they are the whole of it.
 *
 * **Only what is registered is drawn.** A roof whose section frame did not
 * register has no place to be, so it is listed rather than placed at the
 * origin. Anything unplaced arrives with the reason attached.
 *
 * **Uncertainty is visible, not smoothed.** An attic wall whose knee-wall top
 * no source states is drawn to the eave and carries `PARTLY_UNRESOLVED`, so
 * the viewer can colour it as what it is. The alternative — drawing it at a
 * plausible height and saying nothing — is the thing this whole stage exists
 * to stop.
 *
 * **Openings are holes.** A wall's fabric intervals already exclude its
 * openings, so no box is ever drawn across a doorway.
 *
 * **Nothing is nudged to look better.** Where a drawn thickness is needed and
 * no source measured one, the thickness used is stated in the triangle's own
 * `why` rather than chosen quietly.
 */
import type {
  BuildingMass,
  RegisteredBuilding,
  RegisteredRoof,
  RegisteredRoofPlane,
  RegisteredWall,
} from '../core/extract/register-building.js'

export type Vec3 = { x: number; y: number; z: number }

export type Resolution = 'STATED' | 'PARTLY_UNRESOLVED' | 'UNRESOLVED'

export type CheckpointTri = {
  a: Vec3
  b: Vec3
  c: Vec3
  /** What the viewer groups and toggles by. */
  part: 'WALL' | 'GABLE' | 'SLAB' | 'ROOF' | 'FLOOR' | 'GLASS'
  elementId: string
  elementKind: string
  storey: string
  resolution: Resolution
  why?: string
}

export type Undrawable = { id: string; kind: string; what: string; why: string }

export type CheckpointScene = {
  tris: CheckpointTri[]
  undrawable: Undrawable[]
  notes: string[]
}

/** A slab with no measured thickness is still a slab; this is how thick it is drawn. */
const DRAWN_SLAB_M = 0.06
/** Likewise a roof plane the section did not measure the fabric of. */
const DRAWN_ROOF_M = 0.1

type Emit = (tri: Omit<CheckpointTri, 'a' | 'b' | 'c'> & { a: Vec3; b: Vec3; c: Vec3 }) => void

const quad = (emit: Emit, meta: Omit<CheckpointTri, 'a' | 'b' | 'c'>, p: Vec3, q: Vec3, r: Vec3, s: Vec3): void => {
  emit({ ...meta, a: p, b: q, c: r })
  emit({ ...meta, a: p, b: r, c: s })
}

function box(emit: Emit, meta: Omit<CheckpointTri, 'a' | 'b' | 'c'>, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
  const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z })
  quad(emit, meta, v(x0, y0, z0), v(x1, y0, z0), v(x1, y0, z1), v(x0, y0, z1))
  quad(emit, meta, v(x0, y1, z0), v(x0, y1, z1), v(x1, y1, z1), v(x1, y1, z0))
  quad(emit, meta, v(x0, y0, z0), v(x0, y1, z0), v(x1, y1, z0), v(x1, y0, z0))
  quad(emit, meta, v(x0, y0, z1), v(x1, y0, z1), v(x1, y1, z1), v(x0, y1, z1))
  quad(emit, meta, v(x0, y0, z0), v(x0, y0, z1), v(x0, y1, z1), v(x0, y1, z0))
  quad(emit, meta, v(x1, y0, z0), v(x1, y1, z0), v(x1, y1, z1), v(x1, y0, z1))
}

export function registeredToScene(building: RegisteredBuilding): CheckpointScene {
  const tris: CheckpointTri[] = []
  const notes: string[] = []
  const undrawable: Undrawable[] = [...building.unplaced]
  const emit: Emit = (t) => {
    tris.push(t as CheckpointTri)
  }

  for (const wall of building.walls) drawWall(emit, wall)
  for (const slab of building.slabs) {
    // A slab belongs to the storey that stands on it, so the viewer's "ground
    // floor only" and "attic only" switches reach it.
    const standing =
      building.storeyEnvelopes.find((s) => Math.abs(s.baseM - slab.levelM) < 0.05)?.storey ??
      building.storeyEnvelopes[0]?.storey ??
      'GROUND'
    const thickness = slab.thicknessM ?? DRAWN_SLAB_M
    const hole = building.voids.find((v) => v.x0 >= slab.footprint.x0 && v.x1 <= slab.footprint.x1 && v.z0 >= slab.footprint.z0 && v.z1 <= slab.footprint.z1)
    const pieces = hole ? cutRect(slab.footprint, hole) : [slab.footprint]
    for (const piece of pieces) {
      box(
        emit,
        {
          part: 'SLAB',
          elementId: slab.id,
          elementKind: 'SLAB',
          storey: standing,
          resolution: slab.thicknessM === null ? 'PARTLY_UNRESOLVED' : 'STATED',
          why:
            slab.thicknessM === null
              ? `${slab.why}; the section does not measure how thick it is, so it is drawn ${(DRAWN_SLAB_M * 1000).toFixed(0)} mm`
              : slab.why,
        },
        piece.x0,
        slab.levelM - thickness,
        piece.z0,
        piece.x1,
        slab.levelM,
        piece.z1,
      )
    }
  }
  for (const roof of building.roofs) {
    if (roof.footprint === null) continue
    for (const plane of roof.planes) drawRoofPlane(emit, roof, plane)
    drawGableEnds(emit, roof, building.masses)
  }
  for (const room of building.rooms) {
    const { footprint, box: b } = room
    for (let row = 0; row < footprint.rows; row++) {
      for (let col = 0; col < footprint.cols; col++) {
        if (footprint.filled[row * footprint.cols + col] !== '1') continue
        const x0 = b.x0 + col * footprint.cellM
        const z0 = b.z0 + row * footprint.cellM
        const y = room.floorM + 0.01
        quad(
          emit,
          {
            part: 'FLOOR',
            elementId: room.id,
            elementKind: room.segmentation === 'UNRESOLVED' ? 'ROOM_UNRESOLVED' : 'ROOM',
            storey: room.storey,
            resolution: room.segmentation === 'UNRESOLVED' ? 'PARTLY_UNRESOLVED' : 'STATED',
            why:
              room.segmentation === 'UNRESOLVED'
                ? `${room.labelsInside} room labels fall inside this one region, and no wall in the drawing divides them`
                : `${room.areaM2.toFixed(1)} m² as the drawing encloses it`,
          },
          { x: x0, y, z: z0 },
          { x: x0 + footprint.cellM, y, z: z0 },
          { x: x0 + footprint.cellM, y, z: z0 + footprint.cellM },
          { x: x0, y, z: z0 + footprint.cellM },
        )
      }
    }
  }
  for (const g of building.glazing) {
    const mid = (g.nearM + g.farM) / 2
    const meta = {
      part: 'GLASS' as const,
      elementId: g.id,
      elementKind: 'GLAZING',
      storey: g.storey,
      resolution: 'STATED' as const,
      why: g.why,
    }
    if (g.axis === 'X') {
      quad(emit, meta, { x: g.fromM, y: g.sillM, z: mid }, { x: g.toM, y: g.sillM, z: mid }, { x: g.toM, y: g.headM, z: mid }, { x: g.fromM, y: g.headM, z: mid })
    } else {
      quad(emit, meta, { x: mid, y: g.sillM, z: g.fromM }, { x: mid, y: g.sillM, z: g.toM }, { x: mid, y: g.headM, z: g.toM }, { x: mid, y: g.headM, z: g.fromM })
    }
  }

  notes.push(
    `${tris.length} triangles from ${building.walls.length} walls, ${building.roofs.length} roof components, ` +
      `${building.slabs.length} slabs and ${building.glazing.length} glazed openings; ${undrawable.length} things the ` +
      'sources describe could not be placed',
  )
  return { tris, undrawable, notes }
}

function drawWall(emit: Emit, wall: RegisteredWall): void {
  const meta = {
    part: 'WALL' as const,
    elementId: wall.id,
    elementKind: wall.role,
    storey: wall.storey,
    resolution: wall.topSettled ? ('STATED' as const) : ('PARTLY_UNRESOLVED' as const),
    why: wall.topSettled
      ? wall.why
      : `${wall.why}; drawn up to ${wall.topM.toFixed(2)} m because no source states where this storey's wall stops`,
  }
  const put = (from: number, to: number, base: number, top: number, m: Omit<CheckpointTri, 'a' | 'b' | 'c'>): void => {
    if (to - from <= 1e-6 || top - base <= 1e-6) return
    if (wall.axis === 'X') box(emit, m, from, base, wall.nearM, to, top, wall.farM)
    else box(emit, m, wall.nearM, base, from, wall.farM, top, to)
  }
  for (const piece of wall.fabric) put(piece.fromM, piece.toM, wall.baseM, wall.topM, meta)

  // An opening whose head and sill an elevation measured has wall above and
  // below it. One whose head nothing states is left open from floor to
  // ceiling, because that is what a floor plan alone says.
  for (const opening of wall.openings) {
    if (opening.headM === null || opening.sillM === null) continue
    const spandrel = {
      ...meta,
      elementKind: 'LINTEL',
      resolution: meta.resolution,
      why: `the wall over and under an opening the ${opening.levelsFrom} elevation measured at ${opening.sillM.toFixed(2)}..${opening.headM.toFixed(2)} m`,
    }
    put(opening.fromM, opening.toM, Math.max(wall.baseM, opening.headM), wall.topM, spandrel)
    put(opening.fromM, opening.toM, wall.baseM, Math.min(wall.topM, opening.sillM), spandrel)
  }
}

/** The level of a sloping plane at a point along the axis it falls on. */
const planeLevel = (plane: RegisteredRoofPlane, at: number): number => {
  const lo = plane.fallAxis === 'X' ? plane.footprint.x0 : plane.footprint.z0
  const hi = plane.fallAxis === 'X' ? plane.footprint.x1 : plane.footprint.z1
  if (plane.fallDirection === 0 || hi - lo <= 0) return plane.highLevelM
  const t = (at - lo) / (hi - lo)
  return plane.fallDirection < 0
    ? plane.lowLevelM + t * (plane.highLevelM - plane.lowLevelM)
    : plane.highLevelM + t * (plane.lowLevelM - plane.highLevelM)
}

function drawRoofPlane(emit: Emit, roof: RegisteredRoof, plane: RegisteredRoofPlane): void {
  const thickness = plane.thicknessM ?? DRAWN_ROOF_M
  const meta = {
    part: 'ROOF' as const,
    elementId: plane.id,
    elementKind: roof.topology,
    storey: 'ROOF',
    resolution: plane.status === 'RESOLVED' ? ('STATED' as const) : ('PARTLY_UNRESOLVED' as const),
    why:
      `${plane.why}. The eave overhang is not settled by any source, so the plane stops at the wall it bears on` +
      (plane.thicknessM === null ? `, and it is drawn ${(DRAWN_ROOF_M * 1000).toFixed(0)} mm thick because the section does not measure it` : ''),
  }
  const f = plane.footprint
  const corners: Array<[number, number]> = [
    [f.x0, f.z0],
    [f.x1, f.z0],
    [f.x1, f.z1],
    [f.x0, f.z1],
  ]
  const top = corners.map(([x, z]) => ({ x, y: planeLevel(plane, plane.fallAxis === 'X' ? x : z), z }))
  const bottom = top.map((p) => ({ x: p.x, y: p.y - thickness, z: p.z }))
  quad(emit, meta, top[0], top[1], top[2], top[3])
  quad(emit, meta, bottom[3], bottom[2], bottom[1], bottom[0])
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4
    quad(emit, meta, top[i], bottom[i], bottom[j], top[j])
  }
}

/**
 * The triangle a gable leaves between its wall and its two slopes.
 *
 * Stage 07 settled the topology: the ridge runs end to end, which is a gable
 * and not a hip, and a gable has ends. The infill is bounded entirely by
 * things already registered — the mass's own face and the two planes meeting
 * over it — so no height is invented. It is still `PARTLY_UNRESOLVED`,
 * because where the wall below it stops is not settled.
 */
function drawGableEnds(emit: Emit, roof: RegisteredRoof, masses: readonly BuildingMass[]): void {
  if (roof.ridgeAxis === null || roof.ridgeAtM === null || roof.ridgeLevelM === null || roof.eaveLevelM === null) return
  const mass = masses.find((m) => m.id === roof.hostMassId)
  if (!mass || roof.footprint === null) return
  const cut: 'X' | 'Z' = roof.ridgeAxis === 'X' ? 'Z' : 'X'
  const lo = cut === 'X' ? roof.footprint.x0 : roof.footprint.z0
  const hi = cut === 'X' ? roof.footprint.x1 : roof.footprint.z1
  const ends = roof.ridgeAxis === 'X' ? [roof.footprint.x0, roof.footprint.x1] : [roof.footprint.z0, roof.footprint.z1]
  const meta = {
    part: 'GABLE' as const,
    elementId: `${roof.id}:gable`,
    elementKind: 'GABLE_END',
    storey: 'ROOF',
    resolution: 'PARTLY_UNRESOLVED' as const,
    why:
      'the end a gable leaves between the wall below and its two slopes. Its outline is the mass face and the two ' +
      'registered planes; the wall under it stops at a level no source states',
  }
  const at = (along: number, level: number, end: number): Vec3 =>
    roof.ridgeAxis === 'X' ? { x: end, y: level, z: along } : { x: along, y: level, z: end }
  for (const end of ends) {
    emit({
      ...meta,
      a: at(lo, roof.eaveLevelM, end),
      b: at(hi, roof.eaveLevelM, end),
      c: at(roof.ridgeAtM, roof.ridgeLevelM, end),
    })
  }
}

/** A rectangle with a rectangle taken out of it, as up to four rectangles. */
function cutRect(outer: { x0: number; z0: number; x1: number; z1: number }, hole: { x0: number; z0: number; x1: number; z1: number }): Array<{ x0: number; z0: number; x1: number; z1: number }> {
  const out = [
    { x0: outer.x0, x1: outer.x1, z0: outer.z0, z1: hole.z0 },
    { x0: outer.x0, x1: outer.x1, z0: hole.z1, z1: outer.z1 },
    { x0: outer.x0, x1: hole.x0, z0: hole.z0, z1: hole.z1 },
    { x0: hole.x1, x1: outer.x1, z0: hole.z0, z1: hole.z1 },
  ]
  return out.filter((r) => r.x1 - r.x0 > 1e-6 && r.z1 - r.z0 > 1e-6)
}
