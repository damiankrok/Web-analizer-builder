/**
 * A candidate with everything STAGE WEB-PIVOT-07R has to survive, and nothing
 * else — a synthetic one, built here rather than read from a run.
 *
 * It is synthetic on purpose. The real project-A candidate takes six minutes
 * of extraction to produce and lives under `out/`, so a test that needed it
 * could not run on a clean checkout. This has the same shape: two storeys on
 * two sheets whose origins disagree, a terrace north of the ground storey that
 * a naive frame would anchor on, a single-storey wing with its own lower roof,
 * tread lines drawn inside a room, and a section in its own horizontal
 * coordinate with a gable over the body and a level run over the wing.
 *
 * The building it describes, in its own metres: a body 8 by 12 with a wing 4
 * by 9 on its east side, floors at 0 and 3, an eave at 4.6 and a ridge at 7.9.
 * TEST_ONLY.
 */
import type {
  ArchitecturalSpecCandidate,
  CandidateDimension,
  CandidateOpening,
  CandidateRoom,
  CandidateStorey,
  CandidateWall,
} from '../src/core/extract/spec-candidate.js'
import type { CandidateShell } from '../src/core/extract/candidate-shell.js'
import type { CandidateMeasure } from '../src/core/extract/candidate-evidence.js'

const PX_PER_CM = 0.4
const CELL = 0.25

const measure = (valueM: number): CandidateMeasure => ({
  valueM,
  fidelity: 'SOURCE_EXACT',
  confidence: 0.9,
  toleranceM: 0.01,
  evidence: [{ assetId: 'section', role: 'SECTION', locator: 'a level marker' }],
  why: 'a printed level marker',
})

type WallSpec = {
  id: string
  axis: 'X' | 'Z'
  from: number
  to: number
  near: number
  far: number
  openings?: Array<{ from: number; to: number }>
}

function wall(storey: string, w: WallSpec): CandidateWall {
  const openings: CandidateOpening[] = (w.openings ?? []).map((o) => ({
    fromM: o.from,
    toM: o.to,
    widthM: o.to - o.from,
    kind: o.to - o.from <= 1.4 ? 'DOORWAY' : 'WIDE',
    class: 'UNKNOWN_GAP',
    classConfidence: 0.4,
    why: 'material stops here',
  }))
  const gaps = openings.reduce((n, o) => n + o.widthM, 0)
  return {
    id: `${storey}:${w.id}`,
    storey,
    axis: w.axis,
    fromM: w.from,
    toM: w.to,
    nearM: w.near,
    farM: w.far,
    thicknessM: w.far - w.near,
    solidM: w.to - w.from - gaps,
    openings,
    centreM: (w.near + w.far) / 2,
    confidence: 0.9,
    provenance: { assetId: `${storey}-plan`, from: 'a wall band' },
  }
}

function chain(
  id: string,
  storey: string,
  text: string,
  valueM: number,
  axis: 'X' | 'Z',
  baselineId: string,
  fromM: number,
  toM: number,
): CandidateDimension {
  return {
    id,
    storey,
    text,
    valueM,
    status: 'SOURCE_EXACT',
    owner: `${axis === 'X' ? 'X' : 'Y'} span of ${((toM - fromM) * 100 * PX_PER_CM).toFixed(1)} px on ${baselineId}`,
    span: {
      baselineId,
      axis,
      fromPx: fromM * 100 * PX_PER_CM,
      toPx: toM * 100 * PX_PER_CM,
      fromM,
      toM,
    },
    confidence: 0.95,
    provenance: { assetId: `${storey}-plan`, from: 'a printed chain segment' },
  }
}

function room(storey: string, id: string, x0: number, z0: number, x1: number, z1: number, labels = 1): CandidateRoom {
  const cols = Math.max(1, Math.round((x1 - x0) / CELL))
  const rows = Math.max(1, Math.round((z1 - z0) / CELL))
  return {
    id: `${storey}:${id}`,
    storey,
    areaM2: (x1 - x0) * (z1 - z0),
    box: { x0, z0, x1, z1 },
    centroid: { x: (x0 + x1) / 2, z: (z0 + z1) / 2 },
    footprint: { cellM: CELL, cols, rows, filled: '1'.repeat(cols * rows) },
    labelsInside: labels,
    segmentation: 'SETTLED',
    confidence: 0.6,
    provenance: { assetId: `${storey}-plan`, from: 'a flooded region' },
  }
}

/**
 * The ground sheet. Its own origin is the terrace screen 5 m north of the
 * house, which is exactly the mistake this stage exists to undo — so
 * everything on it is 5 m further down the sheet than the building frame.
 */
function ground(): CandidateStorey {
  const S = 5
  const walls: CandidateWall[] = [
    // The terrace: two screen walls with nothing enclosed either side.
    wall('GROUND', { id: 'terraceA', axis: 'X', from: 0, to: 8, near: 0, far: 0.3 }),
    wall('GROUND', { id: 'terraceB', axis: 'X', from: 0, to: 8, near: 2, far: 2.3 }),
    // The body.
    wall('GROUND', { id: 'bodyN', axis: 'X', from: 0, to: 8, near: S, far: S + 0.3, openings: [{ from: 2, to: 5 }] }),
    wall('GROUND', { id: 'bodyS', axis: 'X', from: 0, to: 8, near: S + 11.7, far: S + 12, openings: [{ from: 3, to: 4 }] }),
    wall('GROUND', { id: 'bodyW', axis: 'Z', from: S, to: S + 12, near: 0, far: 0.3 }),
    wall('GROUND', { id: 'bodyE', axis: 'Z', from: S, to: S + 12, near: 7.7, far: 8, openings: [{ from: S + 6, to: S + 7 }] }),
    // The wing, which reaches further south than the body.
    wall('GROUND', { id: 'wingN', axis: 'X', from: 8, to: 12, near: S + 5, far: S + 5.3 }),
    wall('GROUND', { id: 'wingS', axis: 'X', from: 8, to: 12, near: S + 13.7, far: S + 14, openings: [{ from: 8.5, to: 11.5 }] }),
    wall('GROUND', { id: 'wingE', axis: 'Z', from: S + 5, to: S + 14, near: 11.7, far: 12 }),
    // An internal partition, so the body is not a single box.
    wall('GROUND', { id: 'part1', axis: 'X', from: 0.3, to: 7.7, near: S + 6, far: S + 6.15, openings: [{ from: 3, to: 4 }] }),
    // Off centre on purpose: a symmetric plan cannot tell a mirror from
    // itself, and §16's second mutation needs the sheet to be able to.
    wall('GROUND', { id: 'part2', axis: 'Z', from: S + 0.3, to: S + 6, near: 3, far: 3.15 }),
    // Tread lines drawn on the floor: two faces one pixel apart.
    wall('GROUND', { id: 'tread1', axis: 'X', from: 1, to: 3, near: S + 3, far: S + 3.05 }),
    wall('GROUND', { id: 'tread2', axis: 'X', from: 1, to: 3, near: S + 3.3, far: S + 3.35 }),
    wall('GROUND', { id: 'tread3', axis: 'X', from: 1, to: 3, near: S + 3.6, far: S + 3.65 }),
  ]
  return {
    storey: 'GROUND',
    assetId: 'GROUND-plan',
    pxPerCm: PX_PER_CM,
    frame: { originPx: { x: 0, y: 0 }, pxPerCm: PX_PER_CM, axes: 'plan-right is +X, plan-down is +Z, metres', note: 'synthetic' },
    walls,
    rooms: [
      room('GROUND', 'body1', 0.3, S + 0.3, 7.7, S + 6),
      room('GROUND', 'body2', 0.3, S + 6.15, 7.7, S + 11.7),
      room('GROUND', 'wing', 8.3, S + 5.3, 11.7, S + 13.7),
    ],
    adjacency: [],
    // A printed chain down each side, whose ticks are the faces the drawing
    // dimensions: across the sheet the whole 12 m width, and down it a metre
    // of terrace, the 14 m structural core the wing reaches to, and a metre of
    // entrance beyond it.
    dimensions: [
      chain('d1', 'GROUND', '1200', 12, 'X', 'hl_1', 0, 12),
      chain('d2', 'GROUND', '100', 1, 'Z', 'vl_1', S - 1, S),
      chain('d3', 'GROUND', '1400', 14, 'Z', 'vl_1', S, S + 14),
      chain('d4', 'GROUND', '100', 1, 'Z', 'vl_1', S + 14, S + 15),
    ],
    unownedReadings: [],
  }
}

/** The upper sheet, whose own origin happens to be the building's corner. */
function upper(): CandidateStorey {
  const walls: CandidateWall[] = [
    wall('UPPER', { id: 'atticN', axis: 'X', from: 0, to: 8, near: 0, far: 0.3, openings: [{ from: 1, to: 2 }] }),
    wall('UPPER', { id: 'atticS', axis: 'X', from: 0, to: 8, near: 11.7, far: 12, openings: [{ from: 6, to: 7 }] }),
    wall('UPPER', { id: 'atticW', axis: 'Z', from: 0, to: 12, near: 0, far: 0.3 }),
    wall('UPPER', { id: 'atticE', axis: 'Z', from: 0, to: 12, near: 7.7, far: 8 }),
    // Asymmetric on both axes, so a mirror or a quarter-turn is detectable:
    // the cross wall is a third of the way across rather than halfway, and the
    // ground storey has one on the same line.
    wall('UPPER', { id: 'part1', axis: 'X', from: 0.3, to: 7.7, near: 4, far: 4.15, openings: [{ from: 1, to: 2 }] }),
    wall('UPPER', { id: 'part2', axis: 'Z', from: 0.3, to: 4, near: 3, far: 3.15 }),
    // The same flight the ground storey draws, in the same place: two storeys
    // agreeing is what turns a run of parallel lines into a hole in a floor.
    wall('UPPER', { id: 'tread1', axis: 'X', from: 1, to: 3, near: 3, far: 3.05 }),
    wall('UPPER', { id: 'tread2', axis: 'X', from: 1, to: 3, near: 3.3, far: 3.35 }),
    wall('UPPER', { id: 'tread3', axis: 'X', from: 1, to: 3, near: 3.6, far: 3.65 }),
  ]
  return {
    storey: 'UPPER',
    assetId: 'UPPER-plan',
    pxPerCm: PX_PER_CM,
    frame: { originPx: { x: 0, y: 0 }, pxPerCm: PX_PER_CM, axes: 'plan-right is +X, plan-down is +Z, metres', note: 'synthetic' },
    walls,
    rooms: [
      room('UPPER', 'a', 0.3, 0.3, 3, 4),
      room('UPPER', 'b', 3.15, 0.3, 7.7, 4),
      room('UPPER', 'c', 0.3, 4.15, 7.7, 11.7),
    ],
    adjacency: [],
    dimensions: [],
    unownedReadings: [],
  }
}

/** The section, in its own horizontal coordinate: the building starts at 1.5. */
function shell(): CandidateShell {
  const tol = { metresPerPixel: 1 / 70, localisationPx: 1, registrationM: 0.003, toleranceM: 0.015, why: 'synthetic' }
  const plane = (id: string, componentId: string, falls: 'LEFT' | 'RIGHT' | 'LEVEL', from: number, to: number, ridge: number, eave: number, pitchDeg: number): CandidateShell['roofPlanes'][number] => ({
    id,
    componentId,
    host: 'the mass the section cuts',
    pitch: {
      observations: [],
      pitchDeg,
      toleranceDeg: Number.isFinite(pitchDeg) ? 0.2 : Number.NaN,
      fidelity: Number.isFinite(pitchDeg) ? 'SOURCE_EXACT' : 'UNRESOLVED',
      status: Number.isFinite(pitchDeg) ? 'RESOLVED' : 'UNRESOLVED',
      spreadDeg: 0,
      confidence: Number.isFinite(pitchDeg) ? 0.9 : 0,
      why: Number.isFinite(pitchDeg) ? 'a fitted edge' : 'no source states a pitch',
    },
    fallsTowards: falls,
    ridgeLevel: measure(ridge),
    eaveLevel: measure(eave),
    supportFromM: from,
    supportToM: to,
    thickness: measure(0.1),
    overhang: null,
    unresolved: [],
    evidence: [{ assetId: 'section', role: 'SECTION', locator: 'a fitted roof edge' }],
    confidence: 0.8,
  })
  return {
    section: { assetId: 'section', pixelsPerMetre: 70, datumRow: 600, rmsResidualM: 0.003, pairSpread: 0.004, why: 'synthetic' },
    verticalDatums: [],
    levels: [
      { id: 'l0', role: 'GROUND_ZERO', level: measure(0), tolerance: tol, datumId: null, status: 'RESOLVED', why: 'a printed datum' },
      { id: 'l1', role: 'STOREY_FLOOR', level: measure(3), tolerance: tol, datumId: null, status: 'RESOLVED', why: 'a printed datum' },
      { id: 'l2', role: 'EAVE', level: measure(4.6), tolerance: tol, datumId: null, status: 'RESOLVED', why: 'a printed datum' },
      { id: 'l3', role: 'RIDGE', level: measure(7.9), tolerance: tol, datumId: null, status: 'RESOLVED', why: 'a printed datum' },
    ],
    slabs: [
      { id: 's0', topLevel: measure(0), bottomLevel: null, thickness: null, fromM: 1.4, toM: 13.6, evidence: [], status: 'RESOLVED' },
      { id: 's1', topLevel: measure(3), bottomLevel: null, thickness: null, fromM: 1.5, toM: 13.5, evidence: [], status: 'RESOLVED' },
    ],
    roofTopology: 'COMPOSITE',
    roofComponents: [
      { id: 'roof0', topology: 'GABLE', planes: 2, host: 'the body', confidence: 0.8, evidence: [], why: 'two opposed slopes' },
      { id: 'roof1', topology: 'FLAT', planes: 1, host: 'the wing', confidence: 0.6, evidence: [], why: 'a level run' },
    ],
    roofPlanes: [
      plane('plane0', 'roof0', 'LEFT', 1.5, 5.5, 7.9, 4.6, 39.5),
      plane('plane1', 'roof0', 'RIGHT', 5.5, 9.5, 7.9, 4.6, 39.5),
      plane('plane2', 'roof1', 'LEVEL', 9.5, 13.5, 2.8, 2.8, Number.NaN),
    ],
    pitch: { observations: [], pitchDeg: 39.5, toleranceDeg: 0.2, fidelity: 'SOURCE_EXACT', status: 'RESOLVED', spreadDeg: 0, confidence: 0.9, why: 'a fitted edge' },
    elevations: [],
    facadeOpenings: [],
    roofOpenings: [],
    chimneys: [],
    facadeFeatures: [],
    crossSourceConflicts: [],
    unresolved: [],
    notes: [],
  }
}

export function syntheticCandidate(): ArchitecturalSpecCandidate {
  return {
    schemaVersion: 'architectural-spec-candidate-1.1.0',
    kind: 'CANDIDATE',
    notCanonical: true,
    project: 'synthetic',
    sourcePackageId: 'synthetic',
    sourcePackageHash: '0'.repeat(64),
    engine: { id: 'test', version: '0' },
    frame: null,
    storeys: [ground(), upper()],
    conflicts: [],
    shell: shell(),
    notes: [],
  }
}

/** The same building with the ground sheet's terrace taken away. */
export function withoutTerrace(): ArchitecturalSpecCandidate {
  const c = syntheticCandidate()
  c.storeys[0].walls = c.storeys[0].walls.filter((w) => !w.id.includes('terrace'))
  return c
}

/**
 * The same building with a driveway apron drawn beyond its south wall, and a
 * flood that leaked out through the garage door into it.
 *
 * This is project A's real defect in miniature: a thick band of material a
 * metre past the building, with what looks like enclosed space behind it, and
 * no printed tick anywhere near it. Stage 07R's face rule took it for the
 * building's south wall and made the house 1.5 m too deep.
 */
export function withApron(): ArchitecturalSpecCandidate {
  const c = syntheticCandidate()
  const S = 5
  const ground = c.storeys[0]
  ground.walls.push(wall('GROUND', { id: 'apron', axis: 'X', from: 8, to: 12, near: S + 15.2, far: S + 15.8 }))
  const leaked = ground.rooms.find((r) => r.id === 'GROUND:wing')!
  leaked.box.z1 = S + 15.2
  const rows = Math.max(1, Math.round((leaked.box.z1 - leaked.box.z0) / CELL))
  leaked.footprint = { ...leaked.footprint, rows, filled: '1'.repeat(leaked.footprint.cols * rows) }
  return c
}
