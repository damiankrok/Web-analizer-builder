/**
 * STAGE WEB-PIVOT-06 §1, §25, §26 — the extraction cannot see the answers, and
 * does not fall over when the drawing is not what it hoped for.
 *
 * §1 is the load-bearing claim of the whole stage: an automatic reading is
 * worth nothing if it was allowed to peek at the hand transcription it is
 * being measured against. The guards below are structural rather than
 * behavioural on purpose — "it did not read the gold this time" is an
 * observation, and "it cannot read the gold" is a property.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import type { GrayImage } from '../src/core/contracts/raster.js'
import { detectWallBands } from '../src/core/extract/wall-bands.js'
import { buildPlanModel, mergeWallRuns } from '../src/core/extract/plan-model.js'
import { buildSpecCandidate } from '../src/core/extract/spec-candidate.js'
import { detectTextRegions } from '../src/core/extract/text-regions.js'
import { detectDimensionStructures } from '../src/core/extract/dimension-structures.js'
import { buildObservations } from '../src/core/extract/dimension-observations.js'
import { inkChannel } from '../src/core/extract/raster-normalize.js'

/** Every file the automatic extraction is made of. */
const EXTRACTION_ROOTS = ['src/core/extract', 'src/node/ocr']
const EXTRACTION_FILES = ['src/node/extract-runner.ts']

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...walk(path))
    else if (path.endsWith('.ts')) out.push(path)
  }
  return out
}

const extractionSources = (): string[] => [
  ...EXTRACTION_ROOTS.filter((d) => existsSync(d)).flatMap(walk),
  ...EXTRACTION_FILES.filter((f) => existsSync(f)),
]

describe('§1 the extraction cannot read the answers', () => {
  it('covers a real set of files, so an empty sweep cannot pass by accident', () => {
    const files = extractionSources()
    expect(files.length).toBeGreaterThanOrEqual(8)
    expect(files.some((f) => f.includes('dimension-observations'))).toBe(true)
    expect(files.some((f) => f.includes('ocr/tesseract'))).toBe(true)
    // The 06A modules are in the sweep by name, so a rename that moved one of
    // them out of it would fail here rather than quietly stop being checked.
    for (const name of ['door-symbols', 'room-topology', 'room-labels']) {
      expect(files.some((f) => f.includes(name)), `${name} is not in the sweep`).toBe(true)
    }
  })

  it('imports nothing from research/ or tests/', () => {
    for (const file of extractionSources()) {
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
        expect(match[1], `${file} imports ${match[1]}`).not.toMatch(/research\//)
        expect(match[1], `${file} imports ${match[1]}`).not.toMatch(/(^|\/)tests\//)
      }
    }
  })

  it('never names a research fixture, a gold id or a file under research/', () => {
    // A path or a gold identifier appearing anywhere in the extraction would
    // be a door into the answers even if nothing currently walks through it.
    for (const file of extractionSources()) {
      const source = readFileSync(file, 'utf8')
      expect(source, file).not.toMatch(/research\/gold/)
      expect(source, file).not.toMatch(/research\/eval/)
      expect(source, file).not.toMatch(/\bg[wd]_[a-z]/)
      expect(source, file).not.toMatch(/\buw_[a-z]/)
    }
  })

  it('does not branch on any development project by name, id or slug', () => {
    // §1: generic extraction may not recognise the project it is reading.
    const names = [
      'marcowki',
      'marcówki',
      'bakopach',
      'kosaccach',
      'kruszczykach',
      'wisteriach',
      'malinowkach',
      'malinówkach',
      'A-marcowki',
      'm87928f6e82dd1',
      'm2fa281446a8ca',
      'asset_8fda78f8654c',
    ]
    for (const file of extractionSources()) {
      const source = readFileSync(file, 'utf8').toLowerCase()
      for (const name of names) {
        expect(source, `${file} mentions ${name}`).not.toContain(name.toLowerCase())
      }
    }
  })

  it('carries no gold identifier into what it produces', () => {
    const candidate = JSON.stringify(
      buildSpecCandidate({
        project: 'test',
        sourcePackageId: 'pkg',
        sourcePackageHash: 'hash',
        engine: { id: 'e', version: '0' },
        storeys: [],
      }),
    )
    expect(candidate).not.toMatch(/\bg[wd]_[a-z]/)
    expect(candidate).not.toMatch(/marcowki/i)
  })

  it('takes no gold and no evaluation option through any 06A entry point', () => {
    // §15 as a shape argument rather than a behavioural one: the door
    // detector, the topology and the label reader are given a raster, a scale
    // and the pipeline's own configuration, and there is nowhere in any of
    // their signatures for an answer to be passed in.
    for (const name of ['door-symbols', 'room-topology', 'room-labels']) {
      const file = extractionSources().find((f) => f.includes(name))!
      const source = readFileSync(file, 'utf8')
      expect(source, name).not.toMatch(/\bGold\b|goldWall|goldRoom|goldOpening|evaluate/i)
      expect(source, name).not.toMatch(/notionalEdge|positionTolerance|majorWall/)
    }
  })
})

// --- §26: ten things going wrong, and what should happen instead

const PX_PER_CM = 1
const WALL = 10
const TINT = 150
const paper = (w: number, h: number, v = 250): GrayImage => ({
  width: w,
  height: h,
  data: new Uint8ClampedArray(w * h).fill(v),
})
const fill = (g: GrayImage, x0: number, y0: number, w: number, h: number, v: number): void => {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      if (x >= 0 && y >= 0 && x < g.width && y < g.height) g.data[y * g.width + x] = v
    }
  }
}
const room = (doorWidth = 90): GrayImage => {
  const g = paper(300, 260)
  fill(g, 40, 40, 220, 20, WALL)
  fill(g, 40, 190, 220, 20, WALL)
  fill(g, 40, 40, 20, 170, WALL)
  fill(g, 240, 40, 20, 170, WALL)
  fill(g, 60, 60, 180, 130, TINT)
  if (doorWidth > 0) fill(g, 120, 190, doorWidth, 20, TINT)
  return g
}
const modelOf = (g: GrayImage, pxPerCm: number | null = PX_PER_CM): ReturnType<typeof buildPlanModel> =>
  buildPlanModel(g, detectWallBands(g, pxPerCm).bands, pxPerCm)

/** Every wall the candidate would report, for comparing two runs. */
const wallsOf = (g: GrayImage, pxPerCm: number): Array<[string, number, number, number, number]> => {
  const candidate = buildSpecCandidate({
    project: 'test',
    sourcePackageId: 'pkg',
    sourcePackageHash: 'hash',
    engine: { id: 'e', version: '0' },
    storeys: [{ storey: 'GROUND', assetId: 'a', pxPerCm, model: modelOf(g, pxPerCm), observations: [] }],
  })
  return candidate.storeys[0].walls.map((w) => [w.axis, w.fromM, w.toM, w.nearM, w.farM])
}

const shapeOf = (g: GrayImage, pxPerCm: number): string =>
  JSON.stringify(wallsOf(g, pxPerCm).map(([a, ...n]) => [a, ...n.map((v) => (v as number).toFixed(2))]))

/** The same walls to within a tolerance, for comparing across resolutions. */
const sameWalls = (
  a: ReturnType<typeof wallsOf>,
  b: ReturnType<typeof wallsOf>,
  toleranceM: number,
): boolean => {
  if (a.length !== b.length) return false
  return a.every((wa, i) => {
    const wb = b[i]
    if (wa[0] !== wb[0]) return false
    for (let k = 1; k < 5; k++) {
      if (Math.abs((wa[k] as number) - (wb[k] as number)) > toleranceM) return false
    }
    return true
  })
}

describe('§26 the extraction under fault injection', () => {
  it('1. a blank sheet yields no walls, no rooms and no claims', () => {
    const model = modelOf(paper(300, 260))
    expect(model.runs).toEqual([])
    expect(model.rooms).toEqual([])
    expect(model.adjacency).toEqual([])
  })

  it('2. no scale means no geometry, rather than geometry in pixels', () => {
    const model = modelOf(room(), null)
    expect(model.runs).toEqual([])
    expect(model.rooms).toEqual([])
    expect(model.notes.join(' ')).toMatch(/no scale/)
  })

  it('3. the same drawing at twice the resolution is the same building', () => {
    const small = room(0)
    const big = paper(small.width * 2, small.height * 2)
    for (let y = 0; y < big.height; y++) {
      for (let x = 0; x < big.width; x++) {
        big.data[y * big.width + x] = small.data[(y >> 1) * small.width + (x >> 1)]
      }
    }
    // Not to the centimetre: doubling the pixels doubles where a face can
    // land, and a 1 cm difference is that and nothing else.
    expect(sameWalls(wallsOf(big, PX_PER_CM * 2), wallsOf(small, PX_PER_CM), 0.03)).toBe(true)
  })

  it('4. moving the drawing on its sheet does not move the building', () => {
    const base = room(0)
    const moved = paper(base.width + 60, base.height + 40)
    for (let y = 0; y < base.height; y++) {
      for (let x = 0; x < base.width; x++) {
        moved.data[(y + 40) * moved.width + x + 60] = base.data[y * base.width + x]
      }
    }
    // The frame is the building's own corner, so a translated sheet is the
    // same building — which is what makes the frame worth having.
    expect(shapeOf(moved, PX_PER_CM)).toBe(shapeOf(base, PX_PER_CM))
  })

  it('5. a long thin line is not a wall, however long', () => {
    const g = room(0)
    fill(g, 10, 120, 280, 2, WALL)
    const before = modelOf(room(0)).runs.length
    expect(modelOf(g).runs.length).toBe(before)
  })

  it('6. tinting a whole room does not create fabric', () => {
    const g = room(0)
    fill(g, 60, 60, 180, 130, TINT - 20)
    expect(modelOf(g).runs.length).toBe(modelOf(room(0)).runs.length)
    expect(modelOf(g).rooms).toHaveLength(1)
  })

  it('7. widening a doorway past what a wall can span splits the wall', () => {
    const narrow = mergeWallRuns(detectWallBands(room(90), PX_PER_CM).bands, PX_PER_CM)
    const wide = mergeWallRuns(detectWallBands(room(200), PX_PER_CM).bands, PX_PER_CM)
    const southNarrow = narrow.filter((r) => r.axis === 'X' && r.nearPx > 180)
    const southWide = wide.filter((r) => r.axis === 'X' && r.nearPx > 180)
    expect(southNarrow).toHaveLength(1)
    // Two pieces, not one wall with invented fabric across the gap (§21).
    expect(southWide.length).toBeGreaterThanOrEqual(1)
    const invented = southWide.reduce(
      (n, r) => n + r.openings.filter((o) => o.lengthPx > 190).length,
      0,
    )
    expect(invented).toBe(0)
  })

  it('8. a reading the engine never made cannot become a measurement', () => {
    const g = room(0)
    const ink = inkChannel({
      width: g.width,
      height: g.height,
      data: new Uint8ClampedArray(
        [...g.data].flatMap((v) => [v, v, v, 255]),
      ),
    })
    const regions = detectTextRegions(ink)
    const built = buildObservations([], regions, detectDimensionStructures(ink, regions))
    expect(built.observations).toEqual([])
    expect(built.scales.every((s) => s.pxPerCm === null)).toBe(true)
  })

  it('9. a confident reading with nothing to measure stays unowned', () => {
    const g = room(0)
    const regions = [
      {
        id: 'ghost',
        regionId: 'ghost',
        box: { x0: 4, y0: 4, x1: 30, y1: 18 },
        orientation: 'HORIZONTAL' as const,
        glyphs: 3,
        glyphHeightPx: 13,
        axis: 'X' as const,
      },
    ]
    const built = buildObservations(
      [{ cropId: 'ghost', text: '410', confidence: 0.99, boxInCrop: null, engineId: 'test' }],
      regions,
      detectDimensionStructures(g, regions),
    )
    expect(built.observations[0].owner.kind).toBe('NONE')
    expect(built.observations[0].valueCm).toBe(410)
  })

  it('10. two runs over one drawing produce the same candidate', () => {
    expect(shapeOf(room(90), PX_PER_CM)).toBe(shapeOf(room(90), PX_PER_CM))
    const a = modelOf(room(90))
    const b = modelOf(room(90))
    expect(JSON.stringify(a.runs)).toBe(JSON.stringify(b.runs))
    expect(JSON.stringify(a.rooms)).toBe(JSON.stringify(b.rooms))
  })
})
