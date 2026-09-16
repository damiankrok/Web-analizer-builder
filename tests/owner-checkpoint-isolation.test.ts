/**
 * OWNER VISUAL CHECKPOINT — the preview cannot reach into the analyzer, and
 * the analyzer cannot reach into the preview.
 *
 * The checkpoint exists to *look at* the automatic result beside the gold one.
 * That is only worth looking at if the two were never mixed, so the two claims
 * the preview makes about itself are asserted here rather than promised in
 * prose:
 *
 *   - the adapter that draws the candidate reads no gold file, so nothing it
 *     shows as "automatic" can have come from the hand transcription;
 *   - nothing in the pipeline imports the checkpoint, so building the preview
 *     cannot change what the analyzer does.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { candidateToScene } from '../src/checkpoint/candidate-to-scene.js'

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
    expect(files.some((f) => f.includes('candidate-to-scene'))).toBe(true)
  })

  it('reads no gold file and names no gold identifier', () => {
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

  it('draws nothing at all from an empty candidate, rather than a default house', () => {
    const scene = candidateToScene({ storeys: [] })
    expect(scene.tris).toEqual([])
    expect(scene.undrawable).toEqual([])
  })

  it('refuses to extrude a storey the section gave it no levels for', () => {
    const scene = candidateToScene({
      storeys: [
        {
          storey: 'GROUND',
          walls: [
            {
              id: 'w1',
              storey: 'GROUND',
              axis: 'X',
              fromM: 0,
              toM: 4,
              nearM: 0,
              farM: 0.2,
              thicknessM: 0.2,
              solidM: 4,
              openings: [],
              confidence: 0.9,
            },
          ],
          rooms: [],
        },
      ],
      shell: {
        levels: [],
        roofPlanes: [],
        facadeOpenings: [],
        roofOpenings: [],
        chimneys: [],
        facadeFeatures: [],
        unresolved: [],
      },
    })
    expect(scene.tris).toEqual([])
    expect(scene.undrawable).toHaveLength(1)
    expect(scene.undrawable[0].why).toMatch(/no height to extrude/)
  })

  it('keeps an opening out of the wall fabric, the way the candidate reports it', () => {
    const scene = candidateToScene({
      storeys: [
        {
          storey: 'GROUND',
          walls: [
            {
              id: 'w1',
              storey: 'GROUND',
              axis: 'X',
              fromM: 0,
              toM: 4,
              nearM: 0,
              farM: 0.2,
              thicknessM: 0.2,
              solidM: 3,
              openings: [{ fromM: 1, toM: 2, widthM: 1, kind: 'DOORWAY', class: 'DOOR', classConfidence: 0.8 }],
              confidence: 0.9,
            },
          ],
          rooms: [],
        },
      ],
      shell: {
        levels: [
          { id: 'l0', role: 'GROUND_ZERO', level: { valueM: 0 }, status: 'RESOLVED', why: '' },
          { id: 'l1', role: 'STOREY_FLOOR', level: { valueM: 3 }, status: 'RESOLVED', why: '' },
        ],
        roofPlanes: [],
        facadeOpenings: [],
        roofOpenings: [],
        chimneys: [],
        facadeFeatures: [],
        unresolved: [],
      },
    })
    const wall = scene.tris.filter((t) => t.part === 'WALL')
    const opening = scene.tris.filter((t) => t.part === 'AUTO_OPENING')
    expect(opening.length).toBeGreaterThan(0)
    // Two solid pieces either side of the gap, twelve triangles each.
    expect(wall).toHaveLength(24)
    // ...and no wall triangle sits inside the opening's span.
    for (const t of wall) {
      for (const p of [t.a, t.b, t.c]) expect(p.x > 1.001 && p.x < 1.999).toBe(false)
    }
  })

  it('marks an attic drawn to the eave as unresolved, rather than stating it', () => {
    const scene = candidateToScene({
      storeys: [
        {
          storey: 'UPPER_ATTIC',
          walls: [
            {
              id: 'w1',
              storey: 'UPPER_ATTIC',
              axis: 'X',
              fromM: 0,
              toM: 4,
              nearM: 0,
              farM: 0.2,
              thicknessM: 0.2,
              solidM: 4,
              openings: [],
              confidence: 0.9,
            },
          ],
          rooms: [],
        },
      ],
      shell: {
        levels: [
          { id: 'l0', role: 'GROUND_ZERO', level: { valueM: 0 }, status: 'RESOLVED', why: '' },
          { id: 'l1', role: 'STOREY_FLOOR', level: { valueM: 3.06 }, status: 'RESOLVED', why: '' },
          { id: 'l2', role: 'EAVE', level: { valueM: 4.67 }, status: 'RESOLVED', why: '' },
        ],
        roofPlanes: [],
        facadeOpenings: [],
        roofOpenings: [],
        chimneys: [],
        facadeFeatures: [],
        unresolved: [],
      },
    })
    const wall = scene.tris.filter((t) => t.part === 'WALL')
    expect(wall.length).toBeGreaterThan(0)
    expect(wall.every((t) => t.resolution === 'PARTLY_UNRESOLVED')).toBe(true)
    expect(wall[0].why).toMatch(/knee-wall top/)
  })

  it('lists a facade opening it cannot place instead of putting it somewhere', () => {
    const scene = candidateToScene({
      storeys: [],
      shell: {
        levels: [],
        roofPlanes: [],
        facadeOpenings: [
          {
            id: 'fo9',
            view: 'FRONT',
            alongFromM: 1,
            alongToM: 2,
            sillLevelM: 0,
            headLevelM: 2,
            widthM: 1,
            heightM: 2,
            matchStatus: 'UNMATCHED_ON_ELEVATION',
            match: null,
          },
        ],
        roofOpenings: [],
        chimneys: [],
        facadeFeatures: [],
        unresolved: [],
      },
    })
    expect(scene.tris).toEqual([])
    expect(scene.undrawable).toHaveLength(1)
    expect(scene.undrawable[0].why).toMatch(/no plan wall was matched/)
  })
})
