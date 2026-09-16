/**
 * OWNER VISUAL CHECKPOINT — read-only.
 *
 * This turns an `ArchitecturalSpecCandidate` into triangles so the automatic
 * result can be *looked at* beside the hand-verified gold model. It is a
 * viewer adapter and nothing else:
 *
 *   - it is not imported by the analyzer, the extraction, the CLI or the
 *     browser build, and a test asserts that;
 *   - it reads no gold file, and never fills a gap in the candidate from one;
 *   - it invents no geometry. Where the candidate does not say something, this
 *     says so — through a `resolution` on every element and a list of the
 *     things that could not be drawn at all.
 *
 * ## What the candidate can and cannot be drawn from
 *
 * The candidate is not a solid model. It is three readings that have not been
 * registered to each other, and the honest picture of it is one where that is
 * visible rather than smoothed away:
 *
 *   - **The plans** give walls with two faces and an extent, openings in those
 *     walls, and rooms as a raster of cells. All of that is in the plan's own
 *     metric frame and can be drawn directly.
 *   - **The section** gives levels, so the plan can be extruded; and roof
 *     planes with a pitch, a ridge and an eave, along the section's own
 *     horizontal axis. That axis is *not* registered to the plan's — the
 *     candidate says so itself (`horizontalMethod: UNRESOLVED`) — so the roof
 *     is drawn in the section's own X and tagged `FRAME_UNREGISTERED`. Sliding
 *     it into place would be doing the registration, which is the next stage's
 *     job and not a viewer's.
 *   - **The elevations** give openings with sills and heads, but their
 *     horizontal registration is unresolved too. The ones the candidate
 *     *matched* to a plan wall carry the wall id, so those can be placed
 *     exactly, from the candidate's own match. The rest cannot be placed at
 *     all, and are returned as `undrawable` rather than guessed at.
 *
 * CHECKPOINT_ONLY. Not part of any pipeline. Delete with the checkpoint.
 */

export type Vec3 = { x: number; y: number; z: number }

/** How sure the candidate is that the thing drawn is there and is that shape. */
export type Resolution =
  /** The candidate states it outright. */
  | 'STATED'
  /** Drawn from the candidate, but one of its dimensions is not settled. */
  | 'PARTLY_UNRESOLVED'
  /** The candidate reports it and does not know what it is. */
  | 'UNRESOLVED'
  /** Drawn in a frame the candidate has not registered to the others. */
  | 'FRAME_UNREGISTERED'

export type CheckpointTri = {
  a: Vec3
  b: Vec3
  c: Vec3
  /** Matches the gold scene's vocabulary where it can, so the viewer is one. */
  part: string
  elementId: string
  elementKind: string
  storey: string
  resolution: Resolution
  /** Why, in the candidate's own words, where it had something to say. */
  why?: string
}

export type Undrawable = {
  id: string
  kind: string
  what: string
  why: string
}

export type CheckpointScene = {
  tris: CheckpointTri[]
  undrawable: Undrawable[]
  notes: string[]
}

// --- the shapes this reads, narrowed to what it uses ------------------------

type Opening = {
  fromM: number
  toM: number
  widthM: number
  kind: string
  class?: string
  classConfidence?: number
  why?: string
}

type Wall = {
  id: string
  storey: string
  axis: 'X' | 'Z'
  fromM: number
  toM: number
  nearM: number
  farM: number
  thicknessM: number
  solidM: number
  openings: Opening[]
  confidence: number
}

type Room = {
  id: string
  storey: string
  areaM2: number
  box: { x0: number; z0: number; x1: number; z1: number }
  segmentation?: string
  footprint?: { cellM: number; cols: number; rows: number; filled: string }
}

type Storey = { storey: string; walls: Wall[]; rooms: Room[] }

type Measure = { valueM?: number; value?: number } | number | null | undefined

type Level = { id: string; role: string; level: Measure; status: string; why: string }

type RoofPlane = {
  id: string
  componentId: string
  pitch: { pitchDeg: number | null } | null
  fallsTowards: string | null
  ridgeLevel: Measure
  eaveLevel: Measure
  supportFromM: number | null
  supportToM: number | null
  thickness: Measure
  unresolved: string[]
  confidence: number
}

type FacadeOpening = {
  id: string
  view: string
  alongFromM: number
  alongToM: number
  sillLevelM: number | null
  headLevelM: number | null
  widthM: number | null
  heightM: number | null
  matchStatus: string
  match: { planWallId: string; planOpeningIndex: number; residualM: number; confidence: number } | null
  why?: string
}

export type Candidate = {
  storeys: Storey[]
  shell?: {
    levels: Level[]
    roofPlanes: RoofPlane[]
    facadeOpenings: FacadeOpening[]
    roofOpenings: Array<{ id: string; roofPlaneId: string | null; why?: string }>
    chimneys: Array<{ id: string; planFootprint: unknown; crossSource: string; why?: string }>
    facadeFeatures: Array<{ id: string; kind: string; view: string; status: string; why?: string }>
    unresolved: string[]
  }
}

const metres = (m: Measure): number | null => {
  if (m === null || m === undefined) return null
  if (typeof m === 'number') return m
  if (typeof m.valueM === 'number') return m.valueM
  if (typeof m.value === 'number') return m.value
  return null
}

/** Twelve triangles for an axis-aligned box. */
function box(
  min: Vec3,
  max: Vec3,
  meta: Omit<CheckpointTri, 'a' | 'b' | 'c'>,
  into: CheckpointTri[],
): void {
  if (max.x - min.x <= 1e-6 || max.y - min.y <= 1e-6 || max.z - min.z <= 1e-6) return
  const v = [
    { x: min.x, y: min.y, z: min.z },
    { x: max.x, y: min.y, z: min.z },
    { x: max.x, y: min.y, z: max.z },
    { x: min.x, y: min.y, z: max.z },
    { x: min.x, y: max.y, z: min.z },
    { x: max.x, y: max.y, z: min.z },
    { x: max.x, y: max.y, z: max.z },
    { x: min.x, y: max.y, z: max.z },
  ]
  const faces: Array<[number, number, number]> = [
    [0, 2, 1], [0, 3, 2],
    [4, 5, 6], [4, 6, 7],
    [0, 1, 5], [0, 5, 4],
    [1, 2, 6], [1, 6, 5],
    [2, 3, 7], [2, 7, 6],
    [3, 0, 4], [3, 4, 7],
  ]
  for (const [i, j, k] of faces) into.push({ a: v[i], b: v[j], c: v[k], ...meta })
}

/** A quad in the XZ plane at height y. */
function plate(
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  y: number,
  meta: Omit<CheckpointTri, 'a' | 'b' | 'c'>,
  into: CheckpointTri[],
): void {
  if (x1 - x0 <= 1e-6 || z1 - z0 <= 1e-6) return
  const p = (x: number, z: number): Vec3 => ({ x, y, z })
  into.push({ a: p(x0, z0), b: p(x1, z0), c: p(x1, z1), ...meta })
  into.push({ a: p(x0, z0), b: p(x1, z1), c: p(x0, z1), ...meta })
}

/** The solid stretches of a wall: its extent, less every opening in it. */
function solidPieces(w: Wall): Array<{ from: number; to: number }> {
  const from = Math.min(w.fromM, w.toM)
  const to = Math.max(w.fromM, w.toM)
  const cuts = w.openings
    .map((o) => ({ from: Math.min(o.fromM, o.toM), to: Math.max(o.fromM, o.toM) }))
    .sort((a, b) => a.from - b.from)
  const out: Array<{ from: number; to: number }> = []
  let at = from
  for (const cut of cuts) {
    if (cut.from > at) out.push({ from: at, to: Math.min(cut.from, to) })
    at = Math.max(at, cut.to)
  }
  if (at < to) out.push({ from: at, to })
  return out
}

/**
 * The levels each storey is extruded between.
 *
 * Taken from the candidate's own level list and from nothing else. The attic's
 * top is the case worth naming: the candidate reports the knee-wall top as
 * absent — it is the one source-clear level the section reading does not
 * recover — so the attic walls are drawn to the eave the candidate *did* read
 * and every one of them is marked `PARTLY_UNRESOLVED`. Choosing a prettier
 * height would be inventing the level the stage failed to find.
 */
function storeyBands(levels: readonly Level[]): Map<string, { base: number; top: number; topSettled: boolean }> {
  const at = (role: string): number | null => {
    const l = levels.find((x) => x.role === role)
    return l ? metres(l.level) : null
  }
  const ground = at('GROUND_ZERO') ?? 0
  const upper = at('STOREY_FLOOR')
  const knee = at('KNEE_WALL_TOP')
  const eave = at('EAVE')
  const bands = new Map<string, { base: number; top: number; topSettled: boolean }>()
  if (upper !== null) bands.set('GROUND', { base: ground, top: upper, topSettled: true })
  if (upper !== null && (knee !== null || eave !== null)) {
    bands.set('UPPER_ATTIC', {
      base: upper,
      top: knee ?? (eave as number),
      topSettled: knee !== null,
    })
  }
  return bands
}

export function candidateToScene(candidate: Candidate): CheckpointScene {
  const tris: CheckpointTri[] = []
  const undrawable: Undrawable[] = []
  const notes: string[] = []
  const shell = candidate.shell
  const bands = storeyBands(shell?.levels ?? [])

  // --- plan walls, extruded between the section's levels
  for (const storey of candidate.storeys) {
    const band = bands.get(storey.storey)
    if (!band) {
      undrawable.push({
        id: storey.storey,
        kind: 'STOREY',
        what: `the ${storey.storey} plan`,
        why: 'the section reading settled no pair of levels for this storey, so there is no height to extrude it between',
      })
      continue
    }
    const resolution: Resolution = band.topSettled ? 'STATED' : 'PARTLY_UNRESOLVED'
    const why = band.topSettled
      ? undefined
      : 'the knee-wall top is the one source-clear level the automatic section reading does not recover, so this wall is drawn to the eave it did read'

    for (const w of storey.walls) {
      const across: [number, number] = [Math.min(w.nearM, w.farM), Math.max(w.nearM, w.farM)]
      for (const piece of solidPieces(w)) {
        const min: Vec3 =
          w.axis === 'X'
            ? { x: piece.from, y: band.base, z: across[0] }
            : { x: across[0], y: band.base, z: piece.from }
        const max: Vec3 =
          w.axis === 'X'
            ? { x: piece.to, y: band.top, z: across[1] }
            : { x: across[1], y: band.top, z: piece.to }
        box(min, max, {
          part: 'WALL',
          elementId: w.id,
          elementKind: 'PLAN_WALL',
          storey: storey.storey,
          resolution,
          ...(why ? { why } : {}),
        }, tris)
      }

      // Openings: drawn as what fills the gap, coloured by what the candidate
      // decided the gap is. A gap it could not classify is drawn and marked,
      // never quietly left as wall or quietly left as air.
      for (const o of w.openings) {
        const cls = o.class ?? 'UNKNOWN_GAP'
        const unresolved = cls === 'UNKNOWN_GAP' || (o.classConfidence ?? 0) <= 0
        const head = Math.min(band.top, band.base + 2.1)
        const sill = cls === 'EXTERIOR_OPENING' ? band.base + 0.0 : band.base
        const min: Vec3 =
          w.axis === 'X'
            ? { x: Math.min(o.fromM, o.toM), y: sill, z: across[0] }
            : { x: across[0], y: sill, z: Math.min(o.fromM, o.toM) }
        const max: Vec3 =
          w.axis === 'X'
            ? { x: Math.max(o.fromM, o.toM), y: head, z: across[1] }
            : { x: across[1], y: head, z: Math.max(o.fromM, o.toM) }
        box(min, max, {
          part: unresolved ? 'AUTO_UNKNOWN_GAP' : 'AUTO_OPENING',
          elementId: `${w.id}#${cls}`,
          elementKind: cls,
          storey: storey.storey,
          resolution: unresolved ? 'UNRESOLVED' : 'STATED',
          ...(o.why ? { why: o.why } : {}),
        }, tris)
      }
    }

    // --- rooms, from the candidate's own raster of cells
    for (const r of storey.rooms) {
      const unresolved = (r.segmentation ?? 'UNRESOLVED') !== 'SETTLED'
      const meta = {
        part: unresolved ? 'AUTO_ROOM_UNRESOLVED' : 'AUTO_ROOM',
        elementId: r.id,
        elementKind: 'PLAN_ROOM',
        storey: storey.storey,
        resolution: unresolved ? ('UNRESOLVED' as Resolution) : ('STATED' as Resolution),
        ...(unresolved
          ? { why: 'the candidate reports this region as one room it could not divide further' }
          : {}),
      }
      const y = band.base + 0.02
      const f = r.footprint
      if (f && f.filled.length >= f.cols * f.rows) {
        for (let row = 0; row < f.rows; row++) {
          for (let col = 0; col < f.cols; col++) {
            if (f.filled[row * f.cols + col] !== '1') continue
            plate(
              r.box.x0 + col * f.cellM,
              r.box.z0 + row * f.cellM,
              r.box.x0 + (col + 1) * f.cellM,
              r.box.z0 + (row + 1) * f.cellM,
              y,
              meta,
              tris,
            )
          }
        }
      } else {
        plate(r.box.x0, r.box.z0, r.box.x1, r.box.z1, y, meta, tris)
      }
    }
  }

  // --- the roof, in the section's own horizontal frame
  if (shell) {
    // The across-axis extent of a roof plane is not something a section can
    // state: a section is one cut, and it says nothing about how far the
    // building runs behind it. The upper storey's own plan extent is borrowed
    // — it is the storey the roof bears on — and the borrowing is carried on
    // every triangle rather than left for a reader to assume.
    const bearing =
      candidate.storeys.find((s) => s.storey === 'UPPER_ATTIC') ?? candidate.storeys[0]
    let z0 = Infinity
    let z1 = -Infinity
    for (const w of bearing?.walls ?? []) {
      const zs = w.axis === 'X' ? [w.nearM, w.farM] : [w.fromM, w.toM]
      z0 = Math.min(z0, ...zs)
      z1 = Math.max(z1, ...zs)
    }
    if (!Number.isFinite(z0) || !Number.isFinite(z1)) {
      z0 = 0
      z1 = 1
    }

    for (const p of shell.roofPlanes) {
      const from = p.supportFromM
      const to = p.supportToM
      const ridge = metres(p.ridgeLevel)
      const eave = metres(p.eaveLevel)
      if (from === null || to === null || ridge === null || eave === null) {
        undrawable.push({
          id: p.id,
          kind: 'ROOF_PLANE',
          what: `roof plane ${p.id}`,
          why: 'the section reading did not settle both its ends and both its levels',
        })
        continue
      }
      const thick = metres(p.thickness) ?? 0.1
      // Falls LEFT means the high end is at the right of the section's axis.
      const highAtFrom = p.fallsTowards === 'LEFT'
      const yAt = (x: number): number => {
        if (p.fallsTowards === 'LEVEL' || Math.abs(to - from) < 1e-6) return ridge
        const t = (x - from) / (to - from)
        return highAtFrom ? ridge + (eave - ridge) * t : eave + (ridge - eave) * t
      }
      const meta = {
        part: 'AUTO_ROOF',
        elementId: p.id,
        elementKind: p.fallsTowards === 'LEVEL' ? 'ROOF_FLAT' : 'ROOF_SLOPE',
        storey: 'ROOF',
        resolution: 'FRAME_UNREGISTERED' as Resolution,
        why:
          'drawn in the section’s own horizontal frame, which the candidate has not registered to the plans’ ' +
          '(the elevations report horizontalMethod UNRESOLVED). Its depth across the building is borrowed from the plans’ own extent.' +
          (p.unresolved.length > 0 ? ` Also: ${p.unresolved.join('; ')}` : ''),
      }
      const yFrom = yAt(from)
      const yTo = yAt(to)
      const quad = (dy: number): Vec3[] => [
        { x: from, y: yFrom + dy, z: z0 },
        { x: to, y: yTo + dy, z: z0 },
        { x: to, y: yTo + dy, z: z1 },
        { x: from, y: yFrom + dy, z: z1 },
      ]
      const lower = quad(-thick)
      const upper = quad(0)
      const push = (a: Vec3, b: Vec3, c: Vec3): void => {
        tris.push({ a, b, c, ...meta })
      }
      push(upper[0], upper[1], upper[2])
      push(upper[0], upper[2], upper[3])
      push(lower[0], lower[2], lower[1])
      push(lower[0], lower[3], lower[2])
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4
        push(upper[i], lower[i], lower[j])
        push(upper[i], lower[j], upper[j])
      }
    }

    // --- facade openings, but only the ones the candidate matched itself
    const wallById = new Map<string, { wall: Wall; storey: string }>()
    for (const storey of candidate.storeys) {
      for (const w of storey.walls) wallById.set(w.id, { wall: w, storey: storey.storey })
    }
    for (const fo of shell.facadeOpenings) {
      const matched = fo.match ? wallById.get(fo.match.planWallId) : undefined
      const sill = fo.sillLevelM
      const head = fo.headLevelM
      if (!fo.match || !matched || sill === null || head === null) {
        undrawable.push({
          id: fo.id,
          kind: 'FACADE_OPENING',
          what: `an opening ${fo.widthM?.toFixed(2) ?? '?'} m wide on the ${fo.view} elevation`,
          why:
            fo.matchStatus === 'MATCHED'
              ? 'matched, but without both a sill and a head level there is nothing to draw'
              : 'no plan wall was matched to it, and the elevation’s horizontal registration to the plans is unresolved, so there is no place to put it',
        })
        continue
      }
      const w = matched.wall
      const o = w.openings[fo.match.planOpeningIndex]
      if (!o) {
        undrawable.push({
          id: fo.id,
          kind: 'FACADE_OPENING',
          what: `an opening on the ${fo.view} elevation matched to ${fo.match.planWallId}`,
          why: 'the matched opening index is not in that wall’s opening list',
        })
        continue
      }
      const across: [number, number] = [Math.min(w.nearM, w.farM), Math.max(w.nearM, w.farM)]
      const min: Vec3 =
        w.axis === 'X'
          ? { x: Math.min(o.fromM, o.toM), y: sill, z: across[0] }
          : { x: across[0], y: sill, z: Math.min(o.fromM, o.toM) }
      const max: Vec3 =
        w.axis === 'X'
          ? { x: Math.max(o.fromM, o.toM), y: head, z: across[1] }
          : { x: across[1], y: head, z: Math.max(o.fromM, o.toM) }
      box(min, max, {
        part: 'AUTO_GLASS',
        elementId: fo.id,
        elementKind: 'FACADE_OPENING',
        storey: matched.storey,
        resolution: 'STATED',
        why: `matched to ${fo.match.planWallId} at ${fo.match.residualM.toFixed(3)} m residual; the sill and head are the ${fo.view} elevation’s`,
      }, tris)
    }

    for (const ro of shell.roofOpenings) {
      undrawable.push({
        id: ro.id,
        kind: 'ROOFLIGHT',
        what: 'a rooflight seen on an elevation',
        why: ro.roofPlaneId
          ? 'no across-plane position was settled, so it cannot be placed on the plane'
          : 'it was not assigned to a roof plane, and no across-plane position was settled',
      })
    }
    for (const ch of shell.chimneys) {
      undrawable.push({
        id: ch.id,
        kind: 'CHIMNEY',
        what: 'a stack seen above the roof line',
        why: ch.planFootprint
          ? 'the stack and the plan footprint are not reconciled'
          : 'no plan footprint was matched to it, so it has a height and a width but no place in plan',
      })
    }
    for (const ff of shell.facadeFeatures) {
      undrawable.push({
        id: ff.id,
        kind: ff.kind,
        what: `a ${ff.kind.toLowerCase()} on the ${ff.view} elevation`,
        why: ff.why ?? 'its depth from the facade is not settled, so it has no position in plan',
      })
    }
  }

  notes.push(`${tris.length} triangles drawn from the candidate`)
  notes.push(`${undrawable.length} things the candidate reports that cannot be placed in 3D from it`)
  return { tris, undrawable, notes }
}
