/**
 * OWNER VISUAL CHECKPOINT — build the read-only preview bundle.
 *
 *   npx tsx scripts/owner-checkpoint.ts
 *
 * Writes `dist-owner-checkpoint/` : the page, one scene file holding both
 * models, and the source drawings the automatic reading was made from.
 *
 * It changes nothing. It runs no analyzer, tunes nothing, and reads the
 * automatic result from the files the frozen Stage-06A and Stage-07 runs
 * already wrote. The gold model is compiled from the proven fixture exactly as
 * the Stage-05A tests compile it.
 *
 * CHECKPOINT_ONLY.
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { marcowkiGoldScene } from '../src/core/wallspec/marcowki-roof-features-fixture.js'
import { registeredToScene } from '../src/checkpoint/registered-to-scene.js'
import { registerBuilding } from '../src/core/extract/register-building.js'
import type { ArchitecturalSpecCandidate } from '../src/core/extract/spec-candidate.js'
import type { SceneTri } from '../src/core/wallspec/marcowki-facade-fixture.js'
import { assetFileName } from '../src/node/package-store.js'

const OUT = 'dist-owner-checkpoint'
const CANDIDATE = 'out/shell/A-marcowki/spec-candidate.json'
const PLAN_EVAL = 'out/extract/A-marcowki/evaluation.json'
const SHELL_EVAL = 'out/shell/evaluation.json'
const PACKAGE_DIR = 'out/source-packages/A-marcowki'

const round = (n: number): number => Math.round(n * 1000) / 1000

/**
 * Triangles as flat arrays, grouped by the things the viewer switches on.
 *
 * One group per (part, resolution, storey) keeps the file small and lets the
 * page turn a whole class on or off without walking every triangle.
 */
type Group = {
  part: string
  resolution: string
  storey: string
  /** 9 numbers per triangle. */
  positions: number[]
  /** Where each element's triangles sit in `positions`, so the page can label
   * and pick one element without a number per triangle. */
  elements: Array<{ id: string; from: number; count: number }>
  why: string | null
}

function pack(
  tris: ReadonlyArray<{ a: { x: number; y: number; z: number }; b: { x: number; y: number; z: number }; c: { x: number; y: number; z: number }; part: string; resolution?: string; storey?: string; elementId: string; why?: string }>,
): Group[] {
  const groups = new Map<string, Group>()
  for (const t of tris) {
    const resolution = t.resolution ?? 'STATED'
    const storey = t.storey ?? 'ALL'
    const key = `${t.part}|${resolution}|${storey}`
    let g = groups.get(key)
    if (!g) {
      g = { part: t.part, resolution, storey, positions: [], elements: [], why: t.why ?? null }
      groups.set(key, g)
    }
    const at = g.positions.length / 9
    g.positions.push(
      round(t.a.x), round(t.a.y), round(t.a.z),
      round(t.b.x), round(t.b.y), round(t.b.z),
      round(t.c.x), round(t.c.y), round(t.c.z),
    )
    const last = g.elements[g.elements.length - 1]
    if (last && last.id === t.elementId) last.count++
    else g.elements.push({ id: t.elementId, from: at, count: 1 })
  }
  return [...groups.values()]
}

/** The gold scene's own storey vocabulary, from the y each triangle sits at. */
function goldStorey(t: SceneTri): string {
  if (t.layer === 'SHELL' && (t.part.startsWith('ROOF') || t.elementKind === 'MASS')) return 'ROOF'
  const y = Math.max(t.a.y, t.b.y, t.c.y)
  if (y <= 3.07) return 'GROUND'
  return 'UPPER_ATTIC'
}

mkdirSync(join(OUT, 'src'), { recursive: true })

// --- the automatic candidate, exactly as the frozen runs left it
if (!existsSync(CANDIDATE)) throw new Error(`${CANDIDATE} is missing; the Stage-07 run writes it`)
const candidate = JSON.parse(readFileSync(CANDIDATE, 'utf8')) as ArchitecturalSpecCandidate
const registered = registerBuilding(candidate)
const auto = registeredToScene(registered)

// --- the gold model, compiled the way the Stage-05A tests compile it
const gold = marcowkiGoldScene()

type PackTri = Parameters<typeof pack>[0][number]
const goldTris: PackTri[] = gold.tris.map((t) => ({
  a: t.a,
  b: t.b,
  c: t.c,
  part: t.part,
  elementId: t.elementId,
  elementKind: t.elementKind,
  storey: goldStorey(t),
  resolution: 'STATED',
}))

// --- source drawings, copied as published
const manifest = JSON.parse(readFileSync(join(PACKAGE_DIR, 'manifest.json'), 'utf8')) as {
  assets: Array<{
    assetId: string
    contentHash: string
    mediaType: string
    width: number
    height: number
    roles: { document: string; storey: string; annotation: string; view: string }
    analysable: boolean
  }>
}
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/png': 'png' }
const drawings: Array<{ assetId: string; file: string; label: string; width: number; height: number; usedFor: string }> = []
const USED: Record<string, string> = {
  'FLOOR_PLAN/GROUND/DIMENSIONED': 'the ground-floor walls, rooms and openings',
  'FLOOR_PLAN/UPPER_ATTIC/DIMENSIONED': 'the attic walls, rooms and openings',
  SECTION: 'the levels, the roof pitch and the roof planes',
  'ELEVATION:FRONT': 'facade openings on the front',
  'ELEVATION:REAR': 'facade openings on the rear',
  'ELEVATION:LEFT': 'facade openings on the left',
  'ELEVATION:RIGHT': 'facade openings on the right',
}
for (const a of manifest.assets) {
  if (!a.analysable) continue
  const doc = a.roles.document
  if (doc === 'PERSPECTIVE_RENDER' || doc === 'SITE_PLAN') continue
  if (doc === 'FLOOR_PLAN' && a.roles.annotation !== 'DIMENSIONED') continue
  const ext = EXT[a.mediaType] ?? 'bin'
  const file = `src/${a.assetId}.${ext}`
  // The package names its files the way the package store names them; asking
  // it rather than reconstructing the name keeps this working if that changes.
  copyFileSync(join(PACKAGE_DIR, 'assets', assetFileName(a.contentHash, a.mediaType)), join(OUT, file))
  const key =
    doc === 'ELEVATION' ? `ELEVATION:${a.roles.view}` : doc === 'SECTION' ? 'SECTION' : `${doc}/${a.roles.storey}/${a.roles.annotation}`
  drawings.push({
    assetId: a.assetId,
    file,
    label:
      doc === 'ELEVATION'
        ? `Elevation — ${a.roles.view.toLowerCase()}`
        : doc === 'SECTION'
          ? 'Section'
          : `Floor plan — ${a.roles.storey === 'GROUND' ? 'ground' : 'attic'} (dimensioned)`,
    width: a.width,
    height: a.height,
    usedFor: USED[key] ?? 'read but not used for geometry',
  })
}

// --- the truth panel, from the evaluations the two stages already wrote
const planEval = JSON.parse(readFileSync(PLAN_EVAL, 'utf8')) as Array<Record<string, any>>
const shellEval = JSON.parse(readFileSync(SHELL_EVAL, 'utf8')) as Record<string, any>
const shell = (candidate as any).shell

const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()

const bundle = {
  generatedAt: new Date().toISOString(),
  commit: head,
  project: { key: 'A', name: 'Dom w marcówkach (GE)', id: (candidate as any).project },
  sourcePackage: {
    id: (candidate as any).sourcePackageId,
    hash: (candidate as any).sourcePackageHash,
  },
  automatic: {
    groups: pack(auto.tris),
    undrawable: auto.undrawable,
    notes: [...auto.notes, ...registered.notes],
  },
  registration: {
    frame: registered.frame,
    registrations: registered.registrations.map((r) => ({
      sourceFrameId: r.sourceFrameId,
      kind: r.kind,
      status: r.status,
      rotation90: r.rotation90,
      mirrorX: r.mirrorX,
      translateX: r.translateX,
      translateZ: r.translateZ,
      alongAxis: r.alongAxis,
      alongDirection: r.alongDirection,
      residualM: r.residualM,
      matched: r.matched,
      why: r.why,
    })),
    masses: registered.masses,
    storeyEnvelopes: registered.storeyEnvelopes,
    roofs: registered.roofs.map((r) => ({
      id: r.id,
      topology: r.topology,
      hostMassId: r.hostMassId,
      footprint: r.footprint,
      ridgeAxis: r.ridgeAxis,
      ridgeAtM: r.ridgeAtM,
      ridgeLevelM: r.ridgeLevelM,
      eaveLevelM: r.eaveLevelM,
      overhangM: r.overhangM,
      status: r.status,
      planes: r.planes.map((p) => ({ id: p.id, statedPitchDeg: p.statedPitchDeg, impliedPitchDeg: p.impliedPitchDeg, status: p.status })),
      why: r.why,
    })),
    checks: registered.checks,
    unresolved: registered.unresolved,
  },
  gold: { groups: pack(goldTris) },
  drawings,
  truth: {
    floorPlan: planEval.map((s) => ({
      storey: s.storey,
      wallCoverage: s.walls.coverage,
      wallMatchedM: s.walls.matchedM,
      wallGoldM: s.walls.goldLengthM,
      logicalCoverage: s.decomposition?.logicalCoverage ?? null,
      adjacencyRate: s.adjacency.rate,
      adjacencyAgreed: s.adjacency.agreed,
      adjacencyEdges: s.adjacency.goldEdges,
      doorsDetected: s.doors.detected,
      doorsTotal: s.doors.goldDoors,
      doorHostRate: s.doors.hostRate ?? null,
      rooms: s.rooms,
      inventedM: s.invented.totalM,
      alignment: s.alignment,
    })),
    levels: (shell.levels as any[]).map((l) => ({
      role: l.role,
      valueM: l.level?.valueM ?? null,
      fidelity: l.level?.fidelity ?? null,
      status: l.status,
    })),
    kneeWallTop: (shellEval.vertical as any[]).find((r) => r.field === 'level.kneeWallTop') ?? null,
    roof: {
      topology: shell.roofTopology,
      pitchDeg: shell.pitch?.pitchDeg ?? null,
      components: shell.roofComponents.length,
      planes: shell.roofPlanes.length,
    },
    facadeOpenings: {
      detected: shell.facadeOpenings.length,
      matched: shell.facadeOpenings.filter((o: any) => o.matchStatus === 'MATCHED').length,
      byView: shell.facadeOpenings.reduce((acc: Record<string, number>, o: any) => {
        acc[o.view] = (acc[o.view] ?? 0) + 1
        return acc
      }, {}),
    },
    roofOpenings: shell.roofOpenings.length,
    chimneys: shell.chimneys.length,
    facadeFeatures: shell.facadeFeatures.length,
    conflicts: (shell.crossSourceConflicts as any[]).map((c) => ({
      id: c.id,
      kind: c.kind,
      observations: c.observations,
      unresolved: c.unresolved,
      confidence: c.confidence,
    })),
    shellUnresolved: shell.unresolved,
    candidateConflicts: ((candidate as any).conflicts ?? []).map((c: any) => ({
      id: c.id,
      kind: c.kind,
      observations: c.observations,
      unresolved: c.unresolved,
    })),
    passTargets: shellEval.passTargets,
    shellSummary: shellEval.summary,
    stageTokens: [
      { stage: 'WEB-PIVOT-06', token: 'PARTIAL_STAGE_WEB_PIVOT_06_AUTOMATIC_FLOORPLAN_SPEC' },
      { stage: 'WEB-PIVOT-06A', token: 'PARTIAL_STAGE_WEB_PIVOT_06A_DOORWAY_ROOM_TOPOLOGY' },
      { stage: 'WEB-PIVOT-07', token: 'PARTIAL_STAGE_WEB_PIVOT_07_AUTOMATIC_SECTION_ELEVATION_SPEC' },
    ],
  },
}

const sceneJson = JSON.stringify(bundle)
writeFileSync(join(OUT, 'scene.json'), sceneJson, 'utf8')

// The page carries its own data. A published artifact serves its supporting
// files next to the page, but a JSON fetch is one more thing that can fail on
// a phone for no useful reason, and 0.7 MB inlined costs nothing against the
// 16 MB a page may be.
const template = readFileSync('src/checkpoint/page.html', 'utf8')
if (!template.includes('/*__SCENE__*/')) throw new Error('the page template lost its scene placeholder')
writeFileSync(
  join(OUT, 'index.html'),
  template.replace('/*__SCENE__*/', sceneJson.replace(/<\//g, '<\\/')),
  'utf8',
)

const autoTris = bundle.automatic.groups.reduce((n, g) => n + g.positions.length / 9, 0)
const goldCount = bundle.gold.groups.reduce((n, g) => n + g.positions.length / 9, 0)
const bytes = readFileSync(join(OUT, 'scene.json')).byteLength
console.log(`commit ${head}`)
const autoElems = bundle.automatic.groups.reduce((n, g) => n + g.elements.length, 0)
console.log(`automatic: ${autoTris} triangles, ${autoElems} elements in ${bundle.automatic.groups.length} groups, ${auto.undrawable.length} things not placeable`)
console.log(`gold:      ${goldCount} triangles in ${bundle.gold.groups.length} groups`)
console.log(`drawings:  ${drawings.length}`)
console.log(`scene.json ${(bytes / 1e6).toFixed(2)} MB`)
console.log(`index.html ${(readFileSync(join(OUT, 'index.html')).byteLength / 1e6).toFixed(2)} MB`)
for (const n of auto.notes) console.log(`  ${n}`)
