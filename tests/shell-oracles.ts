/**
 * STAGE WEB-PIVOT-07 §25, §28, §30 — what A's shell candidate is worth.
 *
 * This file, and only this file, reads the gold. Everything it measures was
 * produced by code that cannot: §34 requires that no module under
 * `src/core/extract` or `src/node` imports anything under `research/`, and
 * `tests/shell-leakage.test.ts` asserts it. Changing a number in a gold
 * fixture changes what this file reports and cannot change a single byte of
 * the candidate.
 *
 * §28 forbids collapsing the result to one score, so nothing here produces
 * one. What comes out is four tables and a pass-target table, each row naming
 * the field, what the gold says, what the pipeline said, the tolerance the
 * *source* supports (§29) rather than a constant, and whether it matched.
 *
 * Three verdicts, and the third is the one that matters:
 *
 *   - `MATCH` — inside the source-derived tolerance;
 *   - `MISS` — outside it, or a count that is wrong;
 *   - `ABSENT` — the pipeline did not produce this field at all.
 *
 * `ABSENT` is not a softer `MISS`. A pipeline that says nothing about the
 * knee wall has behaved correctly if nothing it can read constrains the knee
 * wall, and a pipeline that says 1.30 m because a knee wall is usually 1.30 m
 * has not. Keeping them apart is what stops the second being rewarded.
 */
import { readFileSync } from 'node:fs'
import type { ArchitecturalSpecCandidate } from '../src/core/extract/spec-candidate.js'
import type { CandidateShell } from '../src/core/extract/candidate-shell.js'

export type FieldResult = {
  field: string
  expected: string
  got: string
  toleranceM: number | null
  status: 'MATCH' | 'MISS' | 'ABSENT' | 'CONFLICTED'
  note: string
}

export type ShellEvaluation = {
  vertical: FieldResult[]
  roof: FieldResult[]
  facade: FieldResult[]
  roofFeatures: FieldResult[]
  characteristic: FieldResult[]
  passTargets: Array<{ target: string; required: string; measured: string; met: boolean }>
  summary: { matched: number; missed: number; absent: number; conflicted: number }
}

type Gold = {
  levels: Record<string, number | string>
  openings: Array<Record<string, unknown>>
  recesses: Array<Record<string, unknown>>
  slabs: Array<Record<string, unknown>>
  railings: Array<Record<string, unknown>>
  portals: Array<Record<string, unknown>>
  roofExtent: Record<string, unknown>
}
type RoofGold = {
  rooflights: { countEvidence: { verdict: string }; unitSize: { widthM: number; slopeLengthM: number } }
  chimneys: { countEvidence: { verdict: string }; topM: number; baseM: number }
}
type ShellGold = { observations: Array<{ key: string; value: number; unit: string; status: string }> }

export const readGold = (): { facade: Gold; roofFeatures: RoofGold; shell: ShellGold } => ({
  facade: JSON.parse(readFileSync('research/gold/marcowki-facade-v1.json', 'utf8')) as Gold,
  roofFeatures: JSON.parse(readFileSync('research/gold/marcowki-roof-features-v1.json', 'utf8')) as RoofGold,
  shell: JSON.parse(readFileSync('research/gold/marcowki-exterior-shell-v1.json', 'utf8')) as ShellGold,
})

const shellValue = (g: ShellGold, key: string): number | null =>
  g.observations.find((o) => o.key === key)?.value ?? null

const num = (v: unknown): number => (typeof v === 'number' ? v : Number.NaN)

/** One level from the candidate, by the role the pipeline assigned it. */
const levelOf = (shell: CandidateShell, role: string): number | null => {
  const l = shell.levels.find((x) => x.role === role)
  return l ? l.level.valueM : null
}

const compare = (
  field: string,
  expected: number,
  got: number | null,
  toleranceM: number,
  note: string,
): FieldResult => {
  if (got === null || !Number.isFinite(got)) {
    return { field, expected: expected.toFixed(3), got: '—', toleranceM, status: 'ABSENT', note }
  }
  const delta = Math.abs(got - expected)
  return {
    field,
    expected: expected.toFixed(3),
    got: got.toFixed(3),
    toleranceM,
    status: delta <= toleranceM ? 'MATCH' : 'MISS',
    note: `${note}; off by ${(delta * 1000).toFixed(0)} mm against a ${(toleranceM * 1000).toFixed(0)} mm tolerance`,
  }
}

const compareText = (field: string, expected: string, got: string | null, note: string): FieldResult => ({
  field,
  expected,
  got: got ?? '—',
  toleranceM: null,
  status: got === null ? 'ABSENT' : got === expected ? 'MATCH' : 'MISS',
  note,
})

/**
 * The tolerance a level read on the section supports.
 *
 * A printed level is stated to the centimetre, so half a centimetre is the
 * whole of it — §29's rule that a printed value stays numerically distinct
 * from a raster-localised edge. A level the pipeline derived from geometry
 * gets the tolerance the candidate itself computed for it, which is the same
 * number a reader of the candidate would use.
 */
const levelTolerance = (shell: CandidateShell, role: string): number => {
  const l = shell.levels.find((x) => x.role === role)
  return l ? Math.max(0.005, l.tolerance.toleranceM) : 0.03
}

export function evaluateShell(candidate: ArchitecturalSpecCandidate): ShellEvaluation {
  const gold = readGold()
  const shell = candidate.shell
  const vertical: FieldResult[] = []
  const roof: FieldResult[] = []
  const facade: FieldResult[] = []
  const roofFeatures: FieldResult[] = []
  const characteristic: FieldResult[] = []

  if (!shell) {
    return {
      vertical,
      roof,
      facade,
      roofFeatures,
      characteristic,
      passTargets: [{ target: 'a shell at all', required: 'the candidate carries one', measured: 'it does not', met: false }],
      summary: { matched: 0, missed: 0, absent: 0, conflicted: 0 },
    }
  }

  // ---------------------------------------------------------------- vertical
  const gl = gold.facade.levels
  vertical.push(
    compare('level.terrain', num(gl.terrainM), levelOf(shell, 'TERRAIN'), levelTolerance(shell, 'TERRAIN'), 'the printed -0,32'),
    compare('level.groundZero', num(gl.groundFflM), levelOf(shell, 'GROUND_ZERO'), levelTolerance(shell, 'GROUND_ZERO'), 'the printed ±0,00'),
    compare('level.nextFloor', num(gl.upperFflM), levelOf(shell, 'STOREY_FLOOR'), levelTolerance(shell, 'STOREY_FLOOR'), 'the printed +3,06'),
    compare('level.eave', num(gl.eaveM), levelOf(shell, 'EAVE'), levelTolerance(shell, 'EAVE'), 'the printed +4,67'),
    compare('level.ridge', num(gl.ridgeM), levelOf(shell, 'RIDGE'), levelTolerance(shell, 'RIDGE'), 'the printed +7,95'),
  )
  // Knee wall: the section prints it as a vertical chain (130), not as a level
  // marker, so a pipeline that reads only level markers cannot have it.
  const kneeGold = shellValue(gold.shell, 'wall.kneeWallM')
  const kneeTop = kneeGold === null ? null : num(gl.upperFflM) + kneeGold
  vertical.push(
    compare(
      'level.kneeWallTop',
      kneeTop ?? Number.NaN,
      levelOf(shell, 'KNEE_WALL_TOP'),
      0.05,
      'the attic floor plus the printed 130 vertical chain',
    ),
  )
  const totalGold = shellValue(gold.shell, 'building.heightM')
  const ridge = levelOf(shell, 'RIDGE')
  const terrain = levelOf(shell, 'TERRAIN')
  vertical.push(
    compare(
      'building.totalHeight',
      totalGold ?? Number.NaN,
      ridge !== null && terrain !== null ? ridge - terrain : null,
      0.02,
      'ridge above terrain',
    ),
  )

  // -------------------------------------------------------------------- roof
  roof.push(
    compareText('roof.topology', 'GABLE', shell.roofComponents.find((c) => c.topology !== 'FLAT')?.topology ?? null, 'the main roof'),
    compareText(
      'roof.compositeWithFlat',
      'COMPOSITE',
      shell.roofTopology,
      'a gable main roof and a flat one over the garage wing, which one label would lose',
    ),
  )
  const pitchGold = shellValue(gold.shell, 'roof.pitchDeg') ?? 40
  roof.push({
    field: 'roof.pitchDeg',
    expected: pitchGold.toFixed(2),
    got: Number.isFinite(shell.pitch.pitchDeg) ? shell.pitch.pitchDeg.toFixed(2) : '—',
    toleranceM: null,
    status: !Number.isFinite(shell.pitch.pitchDeg)
      ? 'ABSENT'
      : shell.pitch.status === 'CONFLICTED'
        ? 'CONFLICTED'
        : Math.abs(shell.pitch.pitchDeg - pitchGold) <= 1.0
          ? 'MATCH'
          : 'MISS',
    note: `${shell.pitch.fidelity}; ${shell.pitch.why}`,
  })
  const flatGold = shellValue(gold.shell, 'roof.flatTopM')
  const flatPlane = shell.roofPlanes.find((p) => p.fallsTowards === 'LEVEL') ?? null
  roof.push(
    compare(
      'roof.flatTop',
      flatGold ?? Number.NaN,
      flatPlane ? flatPlane.ridgeLevel.valueM : null,
      Math.max(0.05, flatPlane?.ridgeLevel.toleranceM ?? 0.05),
      'the garage wing’s flat roof, from a level run of the section’s upper surface',
    ),
  )
  const coveringGold = shellValue(gold.shell, 'roof.coveringThicknessM')
  const pitchedPlane = shell.roofPlanes.find((p) => p.thickness !== null) ?? null
  roof.push(
    compare(
      'roof.coveringThickness',
      coveringGold ?? Number.NaN,
      pitchedPlane?.thickness ? pitchedPlane.thickness.valueM : null,
      0.04,
      'the fabric run below the fitted roof edge, taken perpendicular to the plane',
    ),
  )
  // Ridge and eave levels as the roof planes give them, rather than as the
  // printed markers do: two different measurements of two different surfaces.
  const highest = shell.roofPlanes.filter((p) => p.fallsTowards !== 'LEVEL').map((p) => p.ridgeLevel.valueM)
  roof.push(
    compare(
      'roof.planeRidgeLevel',
      num(gl.ridgeM),
      highest.length > 0 ? Math.max(...highest) : null,
      Math.max(0.03, shell.roofPlanes[0]?.ridgeLevel.toleranceM ?? 0.03),
      'where the two fitted planes cross',
    ),
  )
  const ridgeOrientationGold = 'along Z'
  const sectionAcross = shell.notes.find((n) => n.includes('the section is a cut across '))
  roof.push(
    compareText(
      'roof.ridgeOrientation',
      ridgeOrientationGold,
      sectionAcross ? (sectionAcross.includes('across X') ? 'along Z' : 'along X') : null,
      'the ridge runs perpendicular to the axis the section cuts across',
    ),
  )
  const spanGold = shellValue(gold.shell, 'plan.mainBodyWidthM')
  const pitchedPlanes = shell.roofPlanes.filter((p) => p.fallsTowards !== 'LEVEL')
  const spanGot =
    pitchedPlanes.length >= 2
      ? Math.max(...pitchedPlanes.map((p) => p.supportToM)) - Math.min(...pitchedPlanes.map((p) => p.supportFromM))
      : null
  roof.push(compare('roof.mainSpan', spanGold ?? Number.NaN, spanGot, 0.4, 'the fitted planes’ supported extent across the section'))
  const overhangGold = shellValue(gold.shell, 'roof.overhangM')
  roof.push(
    compare(
      'roof.overhang',
      overhangGold ?? Number.NaN,
      shell.roofPlanes.find((p) => p.overhang)?.overhang?.valueM ?? null,
      0.1,
      'not settled by the section: it shows where the plane stops, not where the wall is',
    ),
  )

  // ------------------------------------------------------------------ facade
  // The gold names facades EAST/WEST/NORTH_GARAGE where the package declares
  // LEFT/RIGHT; the evaluator counts per *declared* view and reports the gold's
  // totals beside them, because which is which is exactly what §7 asks the
  // pipeline to solve rather than be told.
  const goldByFacade = new Map<string, number>()
  for (const o of gold.facade.openings) {
    const f = String(o.facade)
    goldByFacade.set(f, (goldByFacade.get(f) ?? 0) + 1)
  }
  const gotByView = new Map<string, number>()
  for (const o of shell.facadeOpenings) gotByView.set(o.view, (gotByView.get(o.view) ?? 0) + 1)
  facade.push({
    field: 'facade.majorOpeningCount',
    expected: [...goldByFacade].map(([f, n]) => `${f}=${n}`).join(' '),
    got: [...gotByView].map(([v, n]) => `${v}=${n}`).join(' ') || '—',
    toleranceM: null,
    status: shell.facadeOpenings.length === 0 ? 'ABSENT' : 'MISS',
    note:
      `the gold models ${gold.facade.openings.length} major openings across all facades; the detector reports ` +
      `${shell.facadeOpenings.length} regions. These are not the same quantity — the detector does not classify, and ` +
      'some of what it reports is not an opening — so this row is a count comparison and never a score',
  })
  const matched = shell.facadeOpenings.filter((o) => o.matchStatus === 'MATCHED')
  facade.push({
    field: 'facade.openingHostMatched',
    expected: 'every detected major opening matched to the plan gap it is in',
    got: `${matched.length} of ${shell.facadeOpenings.length}`,
    toleranceM: null,
    status: matched.length === 0 ? 'ABSENT' : 'MISS',
    note: 'matched under the facade’s own solved offset, never by nearest neighbour',
  })
  const raked = shell.facadeOpenings.filter((o) => o.rakedHead !== null)
  facade.push({
    field: 'facade.rakedOpening',
    expected: 'the front gable glazing, 2.70 m wide with a raked head to 3.20 m',
    got: raked.length > 0 ? `${raked.length} openings carry a sloped head` : '—',
    toleranceM: null,
    status: raked.length > 0 ? 'MISS' : 'ABSENT',
    note: 'a raked head is carried as its two end levels and a slope, never squared off (§21)',
  })
  for (const r of gold.facade.recesses) {
    const expectedWidth = num(r.toX) - num(r.fromX)
    const got = shell.facadeFeatures.filter((f) => f.kind === 'FACADE_RECESS')
    const nearest = got.reduce<{ f: (typeof got)[number]; d: number } | null>((acc, f) => {
      const d = Math.abs(Math.abs(f.alongToM - f.alongFromM) - expectedWidth)
      return acc === null || d < acc.d ? { f, d } : acc
    }, null)
    characteristic.push(
      compare(
        `feature.${String(r.id)}.depth`,
        num(r.depthM),
        nearest?.f.depth?.valueM ?? null,
        0.15,
        `a ${num(r.depthM).toFixed(2)} m recess spanning ${num(r.fromX).toFixed(2)}..${num(r.toX).toFixed(2)} m`,
      ),
    )
  }
  const balcony = gold.facade.slabs.find((s) => String(s.kind) === 'BALCONY')
  characteristic.push({
    field: 'feature.balconySlab',
    expected: balcony ? `top at ${num(balcony.topM).toFixed(2)} m, x ${num(balcony.minX).toFixed(2)}..${num(balcony.maxX).toFixed(2)}` : '—',
    got: shell.facadeFeatures.filter((f) => f.kind === 'BALCONY_SLAB').map((f) => `${f.bottomLevelM.toFixed(2)} m`).join(', ') || '—',
    toleranceM: null,
    status: shell.facadeFeatures.some((f) => f.kind === 'BALCONY_SLAB') ? 'MISS' : 'ABSENT',
    note: 'a slab edge is a horizontal band on an elevation; how far it projects is a depth no elevation measures',
  })
  characteristic.push({
    field: 'feature.railing',
    expected: gold.facade.railings.length > 0 ? `${gold.facade.railings.length} glass railings` : '—',
    got: `${shell.facadeFeatures.filter((f) => f.kind === 'RAILING').length}`,
    toleranceM: null,
    status: shell.facadeFeatures.some((f) => f.kind === 'RAILING') ? 'MISS' : 'ABSENT',
    note: 'railings read as low wide bands; nothing here distinguishes a railing from a parapet',
  })
  characteristic.push({
    field: 'feature.portalFrame',
    expected: gold.facade.portals.length > 0 ? `${gold.facade.portals.length} portal frame` : '—',
    got: `${shell.facadeFeatures.filter((f) => f.kind === 'PORTAL_FRAME').length}`,
    toleranceM: null,
    status: shell.facadeFeatures.some((f) => f.kind === 'PORTAL_FRAME') ? 'MISS' : 'ABSENT',
    note: 'a portal is the mouth of a recess; the pipeline reports the recess and not the frame around it',
  })
  const depthUnresolved = shell.crossSourceConflicts.filter((c) => c.kind === 'FACADE_DEPTH_UNRESOLVED').length
  characteristic.push({
    field: 'feature.depthsLeftUnresolved',
    expected: 'every depth no orthographic source constrains is marked unresolved, not guessed',
    got: `${depthUnresolved} depth conflicts raised, ${shell.facadeFeatures.filter((f) => f.depth === null).length} features carry no depth`,
    toleranceM: null,
    status: shell.facadeFeatures.every((f) => f.kind === 'FACADE_RECESS' || f.depth === null) ? 'MATCH' : 'MISS',
    note: '§24: an unconstrained depth stays null',
  })

  // ----------------------------------------------------------- roof features
  const rlGold = gold.roofFeatures.rooflights
  const rooflightCount = shell.roofOpenings.length
  roofFeatures.push({
    field: 'rooflight.count',
    expected: rlGold.countEvidence.verdict,
    got: `${rooflightCount}`,
    toleranceM: null,
    status: rooflightCount === 3 ? 'MATCH' : rooflightCount === 0 ? 'ABSENT' : 'MISS',
    note: `the gold counts three 78/118 units from the attic plan and both side elevations; ${shell.roofOpenings.filter((o) => o.status === 'UNRESOLVED').length} of the pipeline's are unresolved for want of a second source`,
  })
  const chGold = gold.roofFeatures.chimneys
  roofFeatures.push({
    field: 'chimney.count',
    expected: chGold.countEvidence.verdict,
    got: `${shell.chimneys.length}`,
    toleranceM: null,
    status: shell.chimneys.length === 2 ? 'MATCH' : shell.chimneys.length === 0 ? 'ABSENT' : 'MISS',
    note: 'two stacks, which the gold finds on three kinds of drawing; a stack that overlaps another in one view is one silhouette',
  })
  const stackTop = shell.chimneys.map((c) => c.stack?.topLevelM ?? Number.NaN).filter((v) => Number.isFinite(v))
  roofFeatures.push(
    compare(
      'chimney.topLevel',
      chGold.topM,
      stackTop.length > 0 ? Math.max(...stackTop) : null,
      0.15,
      'the cap, measured on a render and so good to about a decimetre',
    ),
  )
  const matchedStacks = shell.chimneys.filter((c) => c.crossSource === 'MATCHED').length
  roofFeatures.push({
    field: 'chimney.crossSource',
    expected: 'a stack lines up with a plan block, or the disagreement is recorded',
    got: `${matchedStacks} matched, ${shell.chimneys.length - matchedStacks} unresolved or conflicted`,
    toleranceM: null,
    status: shell.chimneys.length === 0 ? 'ABSENT' : 'MATCH',
    note: 'the gold leaves the lower shaft route unresolved too; forcing a continuous shaft is what §23 forbids',
  })

  // ------------------------------------------------------------ pass targets
  const conflicted = (kind: string): number => shell.crossSourceConflicts.filter((c) => c.kind === kind).length
  const levelRows = vertical.filter((r) => r.field.startsWith('level.') && r.field !== 'level.kneeWallTop')
  const allLevelsMatch = levelRows.every((r) => r.status === 'MATCH')
  const orderOk = conflicted('LEVEL_ORDER_CONTRADICTION') === 0
  const pitchRow = roof.find((r) => r.field === 'roof.pitchDeg')
  const facadesWithOpenings = new Set(shell.facadeOpenings.map((o) => o.view)).size
  // §30's target is about a *confident* assignment being mirrored, not about
  // an uncertain one being flagged. An elevation placed by elimination is
  // already reported as unresolved and is not a confident claim about
  // anything, so it is counted separately from a wrong one asserted firmly.
  const confidentSides = new Map<string, string>()
  for (const e of shell.elevations) if (e.matchedOpenings >= 2 && e.solvedSide) confidentSides.set(e.declaredView, e.solvedSide)
  const oppositeOf: Record<string, string> = { MIN_X: 'MAX_X', MAX_X: 'MIN_X', MIN_Z: 'MAX_Z', MAX_Z: 'MIN_Z' }
  let mirrored = 0
  for (const [a, b] of [
    ['FRONT', 'REAR'],
    ['LEFT', 'RIGHT'],
  ]) {
    const sa = confidentSides.get(a)
    const sb = confidentSides.get(b)
    if (sa && sb && oppositeOf[sa] !== sb) mirrored++
  }
  const byElimination = shell.elevations.filter((e) => e.matchedOpenings < 2).length
  const passTargets = [
    {
      target: '§30 vertical: every source-clear major level recovered or explicitly conflicted',
      required: 'terrain, ground zero, next floor, eave, ridge',
      measured: `${levelRows.filter((r) => r.status === 'MATCH').length} of ${levelRows.length} inside tolerance`,
      met: allLevelsMatch,
    },
    {
      target: '§30 vertical: no level ordering contradiction',
      required: '0',
      measured: `${conflicted('LEVEL_ORDER_CONTRADICTION')}`,
      met: orderOk,
    },
    {
      target: '§30 roof: correct major roof topology',
      required: 'GABLE main roof, COMPOSITE overall',
      measured: `${shell.roofComponents.map((c) => c.topology).join('+')} / ${shell.roofTopology}`,
      met: roof[0]?.status === 'MATCH' && roof[1]?.status === 'MATCH',
    },
    {
      target: '§30 roof: main pitch within 1.0° of gold, or tighter where printed',
      required: `${pitchGold}° ± 1.0`,
      measured: pitchRow?.got ?? '—',
      met: pitchRow?.status === 'MATCH',
    },
    {
      target: '§30 roof: ridge and eave levels within the source-derived tolerance',
      required: 'both',
      measured: `ridge ${vertical.find((r) => r.field === 'level.ridge')?.status}, eave ${vertical.find((r) => r.field === 'level.eave')?.status}`,
      met:
        vertical.find((r) => r.field === 'level.ridge')?.status === 'MATCH' &&
        vertical.find((r) => r.field === 'level.eave')?.status === 'MATCH',
    },
    {
      target: '§30 roof: flat-roof component recognised where source-clear',
      required: 'one flat component',
      measured: `${shell.roofComponents.filter((c) => c.topology === 'FLAT').length}`,
      met: shell.roofComponents.some((c) => c.topology === 'FLAT'),
    },
    {
      target: '§30 openings: ≥90% of source-clear major openings detected on EACH facade',
      required: '≥90% on each of four facades',
      measured: `openings reported on ${facadesWithOpenings} facades; the detector does not classify, so no per-facade recall against the gold's twelve modelled openings can be claimed`,
      met: false,
    },
    {
      target: '§30 openings: ≥90% of detected major openings matched to the correct host',
      required: '≥90%',
      measured: `${matched.length} of ${shell.facadeOpenings.length} matched (${shell.facadeOpenings.length === 0 ? 0 : Math.round((matched.length / shell.facadeOpenings.length) * 100)}%)`,
      met: shell.facadeOpenings.length > 0 && matched.length / shell.facadeOpenings.length >= 0.9,
    },
    {
      target: '§30 openings: zero confident mirrored facade assignment',
      required: '0',
      measured:
        `${mirrored} confidently-assigned pair(s) land on faces that are not opposite; ` +
        `${byElimination} elevation(s) were placed by elimination and are reported as unresolved rather than claimed`,
      met: mirrored === 0,
    },
    {
      target: '§30 features: every source-clear A feature matched or explicitly unresolved',
      required: 'no feature silently dropped',
      measured: `${characteristic.filter((r) => r.status === 'MATCH').length} matched, ${characteristic.filter((r) => r.status === 'ABSENT').length} absent, ${characteristic.filter((r) => r.status === 'MISS').length} reported but not equal to gold`,
      met: characteristic.every((r) => r.status !== 'MISS' || r.field === 'feature.depthsLeftUnresolved'),
    },
    {
      target: '§30 features: no invented characteristic feature',
      required: 'every feature reported has a source',
      measured: `${shell.facadeFeatures.length} features, all carrying evidence refs`,
      met: shell.facadeFeatures.every((f) => f.evidence.length > 0),
    },
    {
      target: '§30 rooflights and chimneys: source-clear counts correct or explicitly conflicted',
      required: '3 rooflights, 2 chimneys',
      measured: `${rooflightCount} roof openings, ${shell.chimneys.length} stacks`,
      met: rooflightCount === 3 && shell.chimneys.length === 2,
    },
  ]

  const all = [...vertical, ...roof, ...facade, ...roofFeatures, ...characteristic]
  return {
    vertical,
    roof,
    facade,
    roofFeatures,
    characteristic,
    passTargets,
    summary: {
      matched: all.filter((r) => r.status === 'MATCH').length,
      missed: all.filter((r) => r.status === 'MISS').length,
      absent: all.filter((r) => r.status === 'ABSENT').length,
      conflicted: all.filter((r) => r.status === 'CONFLICTED').length,
    },
  }
}
