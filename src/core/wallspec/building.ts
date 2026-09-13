/**
 * Building compiler — STAGE WEB-PIVOT-02, development only.
 *
 * Takes a `BuildingSpec` and produces one tagged triangle list. It is an
 * orchestrator, not a geometry engine: the walls go through STAGE
 * WEB-PIVOT-01C's ring compiler unchanged, the roofs through `roof.ts`, and the
 * only geometry written here is the floor plate, which is a box.
 *
 * ## What the tags are for
 *
 * Every triangle carries the element it belongs to, the storey that owns it,
 * the level it is measured from and the source its dimensions came from. A
 * viewer can then colour by element without knowing anything about how the
 * geometry was made, and — more to the point — a reader who does not trust a
 * surface can trace it back to the drawing it came from. The Three.js mesh is
 * an adapter over this; it is never the record.
 *
 * ## Storeys stack; they do not merge
 *
 * Each shell compiles independently from its own walls and its own junctions.
 * The upper shell does not know the lower one exists, which is exactly why a
 * recessed upper wall keeps its openings: nothing ever asks which facade plane
 * it is near. The roofs are attached to a shell by name for the audit trail,
 * but their geometry comes from their own stated footprint, so a wall that
 * moves does not drag a roof with it.
 *
 * PORT_DIRECT (Kotlin).
 */
import type { Vec3 } from '../contracts/geometry.js'
import type { CompiledTri, WallSpec } from './contracts.js'
import type { BuildingSpec, SlabSpec, StoreyShellSpec } from './architectural.js'
import { compileStoreyRing, type RingCompileDiagnostic, type StoreyRingResult } from './ring.js'
import { compileRoofs, type CompiledRoof, type RoofDiagnostic } from './roof.js'

export type ElementKind = 'WALL' | 'SLAB' | 'ROOF'

/**
 * Material semantic of a building triangle.
 *
 * The wall parts STAGE WEB-PIVOT-01 defined, plus the two a whole building
 * needs. `WallPart` itself is left alone so that `SOLID_PARTS` still means what
 * the ring oracles were written against, and the names are the study shader's
 * `BuildPart` names so the renderer needs no adapter.
 */
export type BuildingPart = CompiledTri['part'] | 'SLAB' | 'ROOF'

/** Parts that make up closed solids. Glazing is a surface, not a solid. */
export const SOLID_BUILDING_PARTS: readonly BuildingPart[] = ['WALL', 'WALL_INNER', 'REVEAL', 'SLAB', 'ROOF']

export const isSolidBuildingPart = (p: BuildingPart): boolean => SOLID_BUILDING_PARTS.includes(p)

/** A compiled triangle with everything a consumer needs to interpret it. */
export type BuildingTri = Omit<CompiledTri, 'part'> & {
  part: BuildingPart
  elementKind: ElementKind
  /** The shell, slab or roof this belongs to. */
  elementId: string
  /** The storey that owns it, where one does. */
  storeyId?: string
  /** The datum its heights are measured against, where one applies. */
  levelId?: string
  /** The source asset the element's dimensions were read from. */
  provenanceSource?: string
}

export type BuildingDiagnosticCode =
  | 'UNKNOWN_SHELL_WALL'
  | 'UNKNOWN_SHELL_JUNCTION'
  | 'UNKNOWN_LEVEL'
  | 'DUPLICATE_SHELL_ID'
  | 'INVALID_SLAB'
  | 'WALL_IN_NO_SHELL'
  | 'WALL_TOP_ROOF_UNKNOWN'

export type BuildingDiagnostic = {
  code: BuildingDiagnosticCode
  severity: 'ERROR' | 'WARNING'
  message: string
  shellId?: string
  wallId?: string
  slabId?: string
}

export type CompiledShell = {
  shellId: string
  baseM: number
  topM: number
  wallIds: string[]
  /** The ring compiler's own verdict, unchanged. */
  ring: StoreyRingResult
}

export type CompiledSlab = { slabId: string; topM: number; thicknessM: number; areaM2: number }

export type BuildingCompileResult = {
  tris: BuildingTri[]
  shells: CompiledShell[]
  slabs: CompiledSlab[]
  roofs: CompiledRoof[]
  diagnostics: Array<BuildingDiagnostic | RingCompileDiagnostic | RoofDiagnostic>
}

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z })

/** A box, closed and wound outwards. Used for floor plates. */
function box(
  out: BuildingTri[],
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  bottomY: number,
  topY: number,
  part: BuildingPart,
  tag: Omit<BuildingTri, 'a' | 'b' | 'c' | 'part' | 'ownerId' | 'wallId'>,
): void {
  const add = (p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3): void => {
    const base: BuildingTri = { ...tag, part, ownerId: tag.elementId, wallId: tag.elementId, a: p0, b: p1, c: p2 }
    out.push(base)
    out.push({ ...base, a: p0, b: p2, c: p3 })
  }
  const t = topY
  const b = bottomY
  add(v(minX, t, maxZ), v(maxX, t, maxZ), v(maxX, t, minZ), v(minX, t, minZ)) // top, +Y
  add(v(minX, b, minZ), v(maxX, b, minZ), v(maxX, b, maxZ), v(minX, b, maxZ)) // bottom, -Y
  add(v(minX, b, maxZ), v(maxX, b, maxZ), v(maxX, t, maxZ), v(minX, t, maxZ)) // +Z
  add(v(maxX, b, minZ), v(minX, b, minZ), v(minX, t, minZ), v(maxX, t, minZ)) // -Z
  add(v(maxX, b, maxZ), v(maxX, b, minZ), v(maxX, t, minZ), v(maxX, t, maxZ)) // +X
  add(v(minX, b, minZ), v(minX, b, maxZ), v(minX, t, maxZ), v(minX, t, minZ)) // -X
}

export function compileBuilding(spec: BuildingSpec): BuildingCompileResult {
  const diagnostics: Array<BuildingDiagnostic | RingCompileDiagnostic | RoofDiagnostic> = []
  const tris: BuildingTri[] = []
  const shells: CompiledShell[] = []
  const slabs: CompiledSlab[] = []

  const levelAt = new Map(spec.levels.map((l) => [l.id, l.elevationM]))
  const wallById = new Map(spec.walls.map((w) => [w.id, w]))
  const junctionById = new Map(spec.junctions.map((j) => [j.id, j]))

  const seenShell = new Set<string>()
  const wallsUsed = new Set<string>()

  // A wall that dies into a roof soffit names the roof. The name is checked
  // here, where the roofs are known, and nowhere inside the wall compiler: a
  // wall must not have to see a roof to compile, and a roof must not become
  // reachable from wall-local code. What this cannot check is whether the
  // stated plane really is that roof's underside — that is a geometric fact
  // about two emitted surfaces, and it is measured as one, by the interface
  // oracle in `tests/eave-closure.test.ts`.
  const roofIds = new Set(spec.roofs.map((r) => r.id))
  for (const w of spec.walls) {
    if (w.topProfile?.kind !== 'PLANE') continue
    if (roofIds.has(w.topProfile.sourceRoofId)) continue
    diagnostics.push({
      code: 'WALL_TOP_ROOF_UNKNOWN',
      severity: 'ERROR',
      message:
        `wall ${w.id} stops against the underside of roof ${w.topProfile.sourceRoofId}, ` +
        'which is not in the spec',
      wallId: w.id,
    })
  }

  for (const shell of spec.shells) {
    if (seenShell.has(shell.id)) {
      diagnostics.push({
        code: 'DUPLICATE_SHELL_ID',
        severity: 'ERROR',
        message: `shell id ${shell.id} appears more than once; the later one was not compiled`,
        shellId: shell.id,
      })
      continue
    }
    seenShell.add(shell.id)

    const base = levelAt.get(shell.baseLevelId)
    const top = levelAt.get(shell.topLevelId)
    if (base === undefined || top === undefined) {
      diagnostics.push({
        code: 'UNKNOWN_LEVEL',
        severity: 'ERROR',
        message:
          `shell ${shell.id} names levels ${shell.baseLevelId} / ${shell.topLevelId}, and at least one ` +
          'is not in the spec',
        shellId: shell.id,
      })
      continue
    }

    const walls: WallSpec[] = []
    for (const id of shell.wallIds) {
      const w = wallById.get(id)
      if (!w) {
        diagnostics.push({
          code: 'UNKNOWN_SHELL_WALL',
          severity: 'ERROR',
          message: `shell ${shell.id} names wall ${id}, which is not in the spec`,
          shellId: shell.id,
          wallId: id,
        })
        continue
      }
      walls.push(w)
      wallsUsed.add(id)
    }
    const junctions = []
    for (const id of shell.junctionIds) {
      const j = junctionById.get(id)
      if (!j) {
        diagnostics.push({
          code: 'UNKNOWN_SHELL_JUNCTION',
          severity: 'ERROR',
          message: `shell ${shell.id} names junction ${id}, which is not in the spec`,
          shellId: shell.id,
        })
        continue
      }
      junctions.push(j)
    }

    const wallIdSet = new Set(walls.map((w) => w.id))
    const openings = spec.openings.filter((o) => wallIdSet.has(o.hostWallId))
    const openingIds = new Set(openings.map((o) => o.id))
    const glazing = spec.glazing.filter((g) => openingIds.has(g.openingId))

    const ring = compileStoreyRing({ walls, openings, glazing, junctions })
    diagnostics.push(...ring.diagnostics)
    for (const t of ring.tris) {
      tris.push({
        ...t,
        elementKind: 'WALL',
        elementId: shell.id,
        storeyId: shell.id,
        levelId: shell.baseLevelId,
        provenanceSource: shell.provenance.source,
      })
    }
    shells.push({ shellId: shell.id, baseM: base, topM: top, wallIds: walls.map((w) => w.id), ring })
  }

  for (const w of spec.walls) {
    if (wallsUsed.has(w.id)) continue
    diagnostics.push({
      code: 'WALL_IN_NO_SHELL',
      severity: 'WARNING',
      message: `wall ${w.id} belongs to no shell, so nothing compiled it`,
      wallId: w.id,
    })
  }

  for (const s of spec.slabs) {
    const top = levelAt.get(s.topLevelId)
    if (top === undefined) {
      diagnostics.push({
        code: 'UNKNOWN_LEVEL',
        severity: 'ERROR',
        message: `slab ${s.id} names level ${s.topLevelId}, which is not in the spec`,
        slabId: s.id,
      })
      continue
    }
    const f = s.footprint
    if (!(f.maxX - f.minX > 1e-9) || !(f.maxZ - f.minZ > 1e-9) || !(s.thicknessM > 1e-9)) {
      diagnostics.push({
        code: 'INVALID_SLAB',
        severity: 'ERROR',
        message: `slab ${s.id} spans ${f.minX}..${f.maxX} by ${f.minZ}..${f.maxZ} at ${s.thicknessM} m thick`,
        slabId: s.id,
      })
      continue
    }
    box(tris, f.minX, f.maxX, f.minZ, f.maxZ, top - s.thicknessM, top, 'SLAB', {
      elementKind: 'SLAB',
      elementId: s.id,
      storeyId: s.ownerStoreyId,
      levelId: s.topLevelId,
      provenanceSource: s.provenance.source,
    })
    slabs.push({
      slabId: s.id,
      topM: top,
      thicknessM: s.thicknessM,
      areaM2: (f.maxX - f.minX) * (f.maxZ - f.minZ),
    })
  }

  const roofResult = compileRoofs(spec.roofs, spec.levels)
  diagnostics.push(...roofResult.diagnostics)
  const roofSpecById = new Map(spec.roofs.map((r) => [r.id, r]))
  for (const t of roofResult.tris) {
    const rs = roofSpecById.get(t.ownerId)
    tris.push({
      ...t,
      part: 'ROOF',
      elementKind: 'ROOF',
      elementId: t.ownerId,
      storeyId: rs?.ownerStoreyId,
      levelId: rs?.eaveLevelId,
      provenanceSource: rs?.provenance.source,
    })
  }

  return { tris, shells, slabs, roofs: roofResult.roofs, diagnostics }
}

/** Every triangle of one element, for per-element oracles. */
export const elementTris = (tris: readonly BuildingTri[], elementId: string): BuildingTri[] =>
  tris.filter((t) => t.elementId === elementId)
