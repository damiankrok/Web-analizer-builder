/**
 * OWNER VISUAL CHECKPOINT — the preview cannot reach into the analyzer, and
 * the analyzer cannot reach into the preview.
 *
 * The checkpoint exists to *look at* the automatic result beside the
 * development reference. That is only worth looking at if the two were never
 * mixed, so the claims the preview makes about itself are asserted here
 * rather than promised in prose:
 *
 *   - the adapter that draws the registered candidate reads no reference file
 *     and names no reference identifier, so nothing it shows as "automatic"
 *     can have come from the hand transcription;
 *   - nothing in the pipeline imports the checkpoint, so building the preview
 *     cannot change what the analyzer does;
 *   - what the candidate leaves unsettled is drawn as unsettled, or not drawn.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { registeredToScene } from '../src/checkpoint/registered-to-scene.js'
import { registerBuilding } from '../src/core/extract/register-building.js'
import { syntheticCandidate } from './frame-registration-fixture.js'

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...walk(path))
    else if (path.endsWith('.ts') || path.endsWith('.tsx')) out.push(path)
  }
  return out
}

const CHECKPOINT = ['src/checkpoint']
const PRODUCTION = ['src/core', 'src/node', 'src/web', 'src/ui']

const importsOf = (file: string): string[] =>
  [...readFileSync(file, 'utf8').matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1])

describe('the checkpoint is a viewer, not a participant', () => {
  it('has files to check, so an empty sweep cannot pass', () => {
    const files = CHECKPOINT.flatMap(walk)
    expect(files.length).toBeGreaterThan(0)
    expect(files.some((f) => f.includes('registered-to-scene'))).toBe(true)
  })

  it('reads no reference file and names no reference identifier', () => {
    for (const file of CHECKPOINT.flatMap(walk)) {
      const source = readFileSync(file, 'utf8')
      expect(source, file).not.toMatch(/research\/gold/)
      expect(source, file).not.toMatch(/\bg[wd]_[a-z]/)
      expect(source, file).not.toMatch(/\buw_[a-z]/)
      for (const spec of importsOf(file)) {
        expect(spec, `${file} imports ${spec}`).not.toMatch(/research\//)
        expect(spec, `${file} imports ${spec}`).not.toMatch(/marcowki/i)
      }
    }
  })

  it('is imported by nothing the analyzer runs', () => {
    for (const dir of PRODUCTION) {
      if (!existsSync(dir)) continue
      for (const file of walk(dir)) {
        for (const spec of importsOf(file)) {
          expect(spec, `${file} imports ${spec}`).not.toMatch(/checkpoint/)
        }
      }
    }
  })
})

describe('what the adapter draws, and what it refuses to', () => {
  const scene = registeredToScene(registerBuilding(syntheticCandidate()))

  it('draws nothing at all from a building with nothing in it', () => {
    const empty = syntheticCandidate()
    empty.storeys = []
    empty.shell = null
    const nothing = registeredToScene(registerBuilding(empty))
    expect(nothing.tris).toEqual([])
    expect(nothing.undrawable).toEqual([])
  })

  it('draws no material across an opening', () => {
    const north = scene.tris.filter((t) => t.elementId === 'GROUND:bodyN' && t.elementKind !== 'LINTEL')
    expect(north.length).toBeGreaterThan(0)
    // The opening runs x 2..5 and no wall triangle reaches inside it.
    for (const t of north) {
      for (const p of [t.a, t.b, t.c]) expect(p.x > 2.001 && p.x < 4.999).toBe(false)
    }
  })

  it('marks an attic drawn to the eave as unresolved, rather than stating it', () => {
    const attic = scene.tris.filter((t) => t.part === 'WALL' && t.storey === 'UPPER')
    expect(attic.length).toBeGreaterThan(0)
    expect(attic.every((t) => t.resolution === 'PARTLY_UNRESOLVED')).toBe(true)
    expect(attic[0].why).toMatch(/no source states where this storey's wall stops/)
  })

  it('states the ground storey, whose two levels the section settled', () => {
    const ground = scene.tris.filter((t) => t.part === 'WALL' && t.storey === 'GROUND')
    expect(ground.length).toBeGreaterThan(0)
    expect(ground.every((t) => t.resolution === 'STATED')).toBe(true)
  })

  it('lists what it cannot place instead of putting it somewhere', () => {
    const candidate = syntheticCandidate()
    candidate.shell!.facadeOpenings = [
      {
        id: 'fo9', view: 'FRONT', assetId: 'front', boxPx: { x0: 0, y0: 0, x1: 10, y1: 10 },
        alongFromM: 1, alongToM: 2, sillLevelM: 0.9, headLevelM: 2.2, widthM: 1, heightM: 1.3,
        rakedHead: null, storeyBand: null, evidenceKind: ['REGION'], fidelity: 'SOURCE_DERIVED',
        tolerance: { metresPerPixel: 0.02, localisationPx: 1, registrationM: 0.01, toleranceM: 0.03, why: 'x' },
        match: null, matchStatus: 'UNMATCHED_ON_ELEVATION', confidence: 0.4, evidence: [],
        why: 'no plan gap lines up with it',
      },
    ]
    const out = registeredToScene(registerBuilding(candidate))
    expect(out.tris.some((t) => t.part === 'GLASS')).toBe(false)
    const listed = out.undrawable.find((u) => u.id === 'fo9')
    expect(listed).toBeDefined()
    expect(listed!.why).toMatch(/no plan wall was matched/)
  })

  it('bounds the roof to the mass it bears on, and never past it', () => {
    const roof = scene.tris.filter((t) => t.part === 'ROOF')
    expect(roof.length).toBeGreaterThan(0)
    for (const t of roof) {
      for (const p of [t.a, t.b, t.c]) {
        expect(p.x >= -0.001 && p.x <= 12.001).toBe(true)
        expect(p.z >= -0.001 && p.z <= 14.001).toBe(true)
      }
    }
  })
})
