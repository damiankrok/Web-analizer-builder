/**
 * The Stage-07 pipeline, wired together — §3, §6, §7, §12.
 *
 * Section and elevations in, `CandidateShell` out. The order is the one the
 * brief fixes and it matters at every step: the section's datums are solved
 * before anything is measured in metres, the roof is fitted before any label
 * near it is read, the elevations are registered from the section's levels
 * rather than from each other, and the facades are assigned to the building's
 * sides by correspondence rather than by what the files are called.
 *
 * It consumes the Stage-06 floor-plan candidate as *evidence* and never
 * rewrites it (§1). Everything it adds lands in `candidate.shell`.
 *
 * NODE_ONLY, because the only local recogniser available here is
 * process-backed. Everything it calls is portable core.
 */
import type { RasterImage } from '../core/contracts/raster.js'
import type { ParsedSource, SourceAsset } from '../core/contracts/source.js'
import { makeMask } from '../core/contracts/raster.js'
import { toGray } from '../core/raster/gray.js'
import { sobel, cannyEdges } from '../core/raster/filters.js'
import { extractBuildingMask } from '../core/raster/mask.js'
import { conditionSilhouette } from '../core/scaffold/silhouette.js'
import { inkChannel } from '../core/extract/raster-normalize.js'
import { buildTextCrops } from '../core/extract/text-crops.js'
import { DEFAULT_PLAN_TEXT, type PlanTextEngine } from '../core/extract/text-engine.js'
import {
  findSectionAnnotations,
  DEFAULT_SECTION_ANNOTATIONS,
  type SectionAnnotation,
} from '../core/extract/section-annotations.js'
import {
  sectionCropRequests,
  groupByAnnotation,
  levelTextOptions,
  pitchTextOptions,
  DEFAULT_SECTION_READ,
} from '../core/extract/section-read.js'
import {
  buildDatumObservations,
  solveVerticalScale,
  reconcileRejected,
  hintSemantics,
  DEFAULT_DATUM_SOLVER,
  type VerticalDatumObservation,
} from '../core/extract/vertical-datums.js'
import {
  analyseSectionRoof,
  sectionMassSpan,
  DEFAULT_SECTION_ROOF,
  type SectionRoofGeometry,
} from '../core/extract/section-roof.js'
import {
  calloutsAlongLine,
  obliqueCalloutCrop,
  parsePitchText,
  DEFAULT_OBLIQUE_TEXT,
} from '../core/extract/oblique-text.js'
import {
  fusePitch,
  classifySkyline,
  classifyRoofTopology,
  DEFAULT_TOPOLOGY_OPTIONS,
  type PitchObservation,
  type RoofPlaneCandidate,
  type SkylineShape,
} from '../core/extract/roof-model.js'
import {
  buildFacadeSilhouette,
  registerVertically,
  DEFAULT_ELEVATION,
  type FacadeSilhouette,
  type FacadeView,
  type AlongPosition,
} from '../core/extract/elevation.js'
import {
  detectFacadeOpenings,
  DEFAULT_FACADE_OPENINGS,
  type FacadeOpening,
} from '../core/extract/facade-openings.js'
import {
  planFacades,
  assignFacades,
  DEFAULT_FACADE_EXTRACTION,
  type FacadeSide,
  type PlanFacade,
} from '../core/extract/opening-match.js'
import {
  findStacks,
  planVoids,
  matchStacks,
  rooflightsFromElevation,
  recessesFromPlan,
  bandsFromOpenings,
  DEFAULT_SHELL_FEATURES,
} from '../core/extract/shell-features.js'
import { sourceTolerance, printedTolerance } from '../core/extract/source-tolerance.js'
import type { EvidenceRef } from '../core/extract/candidate-evidence.js'
import type {
  CandidateChimney,
  CandidateElevation,
  CandidateFacadeFeature,
  CandidateFacadeOpening,
  CandidateLevel,
  CandidateRoofOpening,
  CandidateShell,
  CandidateSlab,
  CrossSourceConflict,
} from '../core/extract/candidate-shell.js'
import type { ArchitecturalSpecCandidate } from '../core/extract/spec-candidate.js'
import { TesseractEngine } from './ocr/tesseract.js'

export type ShellOptions = {
  engine: PlanTextEngine | null
  sectionAnnotations: typeof DEFAULT_SECTION_ANNOTATIONS
  sectionRead: typeof DEFAULT_SECTION_READ
  datumSolver: typeof DEFAULT_DATUM_SOLVER
  sectionRoof: typeof DEFAULT_SECTION_ROOF
  obliqueText: typeof DEFAULT_OBLIQUE_TEXT
  elevation: typeof DEFAULT_ELEVATION
  facadeOpenings: typeof DEFAULT_FACADE_OPENINGS
  facadeExtraction: typeof DEFAULT_FACADE_EXTRACTION
  shellFeatures: typeof DEFAULT_SHELL_FEATURES
  topology: typeof DEFAULT_TOPOLOGY_OPTIONS
  /** How far a matched opening may sit from its plan gap, metres. */
  openingMatchToleranceM: number
  /**
   * How far one elevation's own scale may sit from the set's before the set's
   * is adopted, as a fraction.
   */
  setScaleDrift: number
}

export const DEFAULT_SHELL: ShellOptions = {
  engine: null,
  sectionAnnotations: DEFAULT_SECTION_ANNOTATIONS,
  sectionRead: DEFAULT_SECTION_READ,
  datumSolver: DEFAULT_DATUM_SOLVER,
  sectionRoof: DEFAULT_SECTION_ROOF,
  obliqueText: DEFAULT_OBLIQUE_TEXT,
  elevation: DEFAULT_ELEVATION,
  facadeOpenings: DEFAULT_FACADE_OPENINGS,
  facadeExtraction: DEFAULT_FACADE_EXTRACTION,
  shellFeatures: DEFAULT_SHELL_FEATURES,
  topology: DEFAULT_TOPOLOGY_OPTIONS,
  // A registration good to half a percent over a twelve-metre facade is six
  // centimetres out at the far end, and a plan opening is placed to a pixel of
  // a 37.8 px/m drawing. Thirty-five centimetres is generous against both and
  // still far below the gap between two real openings.
  openingMatchToleranceM: 0.35,
  setScaleDrift: 0.04,
}

export type ShellTimings = {
  sectionAnnotationMs: number
  sectionOcrMs: number
  datumSolveMs: number
  roofFitMs: number
  pitchReadMs: number
  elevationRegisterMs: Record<string, number>
  openingDetectMs: Record<string, number>
  matchMs: number
  featuresMs: number
  totalMs: number
}

export type ShellResult = {
  shell: CandidateShell
  /** Kept for the diagnostics; not part of the candidate. */
  debug: {
    sectionAssetId: string | null
    annotations: SectionAnnotation[]
    roof: SectionRoofGeometry | null
    silhouettes: Map<string, FacadeSilhouette>
    openings: Map<string, FacadeOpening[]>
    facades: PlanFacade[]
  }
  timings: ShellTimings
}

const evidenceOf = (asset: SourceAsset, locator: string): EvidenceRef => ({
  assetId: asset.id,
  role: `${asset.roles?.document ?? 'UNKNOWN'}${asset.roles?.view && asset.roles.view !== 'UNKNOWN' ? `:${asset.roles.view}` : ''}`,
  locator,
})

/**
 * Choose the section to work from, and keep the others as evidence.
 *
 * §6 says all sections are evidence and that incompatible cuts must not be
 * averaged. Nothing here averages anything: one section is analysed — the one
 * with the most pixels, because a datum triangle ten pixels tall cannot be
 * fitted — and the rest are recorded as present and unanalysed.
 */
const chooseSection = (pkg: ParsedSource): { primary: SourceAsset | null; others: SourceAsset[] } => {
  const sections = pkg.assets.filter((a) => a.roles?.document === 'SECTION')
  if (sections.length === 0) return { primary: null, others: [] }
  const pixels = (a: SourceAsset): number => (a.width ?? 0) * (a.height ?? 0)
  const sorted = [...sections].sort((a, b) => pixels(b) - pixels(a))
  return { primary: sorted[0], others: sorted.slice(1) }
}

export function extractShell(
  pkg: ParsedSource,
  images: Map<string, RasterImage>,
  candidate: ArchitecturalSpecCandidate,
  options: ShellOptions = DEFAULT_SHELL,
): ShellResult {
  const t0 = Date.now()
  const engine = options.engine ?? new TesseractEngine()
  const notes: string[] = []
  const unresolved: string[] = []
  const conflicts: CrossSourceConflict[] = []
  const timings: ShellTimings = {
    sectionAnnotationMs: 0,
    sectionOcrMs: 0,
    datumSolveMs: 0,
    roofFitMs: 0,
    pitchReadMs: 0,
    elevationRegisterMs: {},
    openingDetectMs: {},
    matchMs: 0,
    featuresMs: 0,
    totalMs: 0,
  }

  const empty = (why: string): ShellResult => ({
    shell: {
      section: { assetId: null, pixelsPerMetre: null, datumRow: null, rmsResidualM: null, pairSpread: null, why },
      verticalDatums: [],
      levels: [],
      slabs: [],
      roofTopology: 'UNKNOWN',
      roofComponents: [],
      roofPlanes: [],
      pitch: fusePitch([]),
      elevations: [],
      facadeOpenings: [],
      roofOpenings: [],
      chimneys: [],
      facadeFeatures: [],
      crossSourceConflicts: conflicts,
      unresolved: [why],
      notes,
    },
    debug: { sectionAssetId: null, annotations: [], roof: null, silhouettes: new Map(), openings: new Map(), facades: [] },
    timings: { ...timings, totalMs: Date.now() - t0 },
  })

  // ---- §6: the section
  const { primary: sectionAsset, others: otherSections } = chooseSection(pkg)
  if (!sectionAsset) return empty('the package publishes no section, so there is no vertical datum system to solve')
  const sectionImage = images.get(sectionAsset.id)
  if (!sectionImage) return empty(`the section ${sectionAsset.id} did not decode`)
  for (const o of otherSections) {
    notes.push(
      `${o.id} is a second published section (${o.width}x${o.height}); it is kept as evidence and not analysed, ` +
        'because two cuts through different parts of a building are not one drawing and must not be averaged (§6)',
    )
  }

  const sectionGray = inkChannel(sectionImage)
  const tA = Date.now()
  const found = findSectionAnnotations(sectionGray, options.sectionAnnotations)
  timings.sectionAnnotationMs = Date.now() - tA
  notes.push(...found.notes)

  // ---- §8, §10: read the level figures at every conditioning
  const markers = found.annotations.filter((a) => a.kind === 'LEVEL_MARKER')
  const tB = Date.now()
  const levelCrops = buildTextCrops(sectionGray, sectionCropRequests(markers, options.sectionRead))
  const grouped = groupByAnnotation(engine.readBatch(levelCrops, levelTextOptions(options.sectionRead)))
  timings.sectionOcrMs = Date.now() - tB

  const datums: VerticalDatumObservation[] = buildDatumObservations(sectionAsset.id, markers, (id) => grouped.get(id) ?? [])

  // ---- §11: one vertical scale, by consensus
  const tC = Date.now()
  const solution = solveVerticalScale(datums, options.datumSolver, sectionGray.height)
  timings.datumSolveMs = Date.now() - tC
  if (!solution) {
    return empty(
      `${datums.length} level markers were found on the section but no ${options.datumSolver.minInliers} of them agree ` +
        'on one vertical scale, so nothing on this drawing is placed in metres',
    )
  }
  const reconciled = reconcileRejected(datums, solution)
  hintSemantics(datums)
  notes.push(solution.why)
  if (reconciled > 0) notes.push(`${reconciled} marker(s) reconciled against the solved scale rather than read (§11)`)
  for (const r of solution.rejected) {
    conflicts.push({
      id: `cs${conflicts.length}`,
      kind: 'DATUM_READING_REJECTED',
      observations: [
        `the marker at row ${datums.find((d) => d.id === r.id)?.markerPx.y.toFixed(2) ?? '?'} was read as ${r.rawTexts.join(', ') || '(nothing)'}`,
        `the vertical scale the other markers settle puts that row at ${r.predictedLevelM.toFixed(3)} m`,
      ],
      unresolved: r.why,
      evidence: [evidenceOf(sectionAsset, `level marker ${r.id}`)],
      confidence: 0.5,
    })
  }

  const pxPerMetre = solution.pixelsPerMetre
  const levelAt = (row: number): number => (solution.datumRow - row) / pxPerMetre
  const rowAt = (level: number): number => solution.datumRow - level * pxPerMetre

  // ---- §13: the roof, fitted
  const tD = Date.now()
  const roof = analyseSectionRoof(sectionGray, found.inkThreshold, solution.datumRow, options.sectionRoof)
  timings.roofFitMs = Date.now() - tD
  notes.push(...roof.notes)

  // ---- §14: the printed pitch, read along the slope it is printed on
  const tE = Date.now()
  const pitchObservations: PitchObservation[] = []
  const registrationM = solution.rmsResidualM
  for (const edge of roof.edges) {
    if (edge.kind !== 'PITCHED') continue
    pitchObservations.push({
      id: `fit:${edge.id}`,
      kind: 'SECTION_EDGE_FIT',
      pitchDeg: edge.pitchDeg,
      confidence: Math.min(0.95, 0.6 + 0.3 * Math.min(1, edge.inliers / 150)),
      toleranceDeg: Math.max(0.1, (Math.atan(edge.rmsPx / Math.max(1, (edge.toX - edge.fromX) / 2)) * 180) / Math.PI),
      evidence: [evidenceOf(sectionAsset, `fitted roof edge ${edge.id} over x ${Math.round(edge.fromX)}..${Math.round(edge.toX)} px`)],
      why: `${edge.inliers} skyline samples on one line at ${edge.rmsPx.toFixed(2)} px rms`,
    })
    const callouts = calloutsAlongLine(sectionGray, edge, options.sectionAnnotations.regions, options.obliqueText)
    // A callout that is really a level marker has already been claimed as one.
    const claimed = markers.map((m) => m.box)
    const free = callouts.filter(
      (c) => !claimed.some((b) => c.box.x0 < b.x1 && c.box.x1 > b.x0 && c.box.y0 < b.y1 && c.box.y1 > b.y0),
    )
    const crops = free.map((c) => {
      const { gray, scale } = obliqueCalloutCrop(sectionGray, c, options.obliqueText)
      return { id: `${edge.id}:${c.id}`, gray, sourceBox: c.box, orientation: 'HORIZONTAL' as const, scale }
    })
    for (const reading of engine.readBatch(crops, pitchTextOptions(options.sectionRead))) {
      const value = parsePitchText(reading.text)
      if (value === null || reading.confidence < 0.5) continue
      pitchObservations.push({
        id: `printed:${reading.cropId}`,
        kind: 'PRINTED_CALLOUT',
        pitchDeg: value,
        confidence: reading.confidence,
        toleranceDeg: 0.05,
        evidence: [evidenceOf(sectionAsset, `a callout reading "${reading.text}" written along ${edge.id}`)],
        why: `read as "${reading.text}" at ${reading.confidence.toFixed(2)} from a crop cut in the slope's own frame`,
      })
    }
  }
  timings.pitchReadMs = Date.now() - tE
  const pitch = fusePitch(pitchObservations)
  if (pitch.status === 'CONFLICTED') {
    conflicts.push({
      id: `cs${conflicts.length}`,
      kind: 'PRINTED_PITCH_VS_FITTED_PITCH',
      observations: pitch.observations.map((o) => `${o.kind}: ${o.pitchDeg.toFixed(2)}° — ${o.why}`),
      unresolved: pitch.why,
      evidence: pitch.observations.flatMap((o) => o.evidence),
      confidence: 0.6,
    })
  }

  // ---- §12: what each printed level is, decided by the geometry it sits on
  const ridgeLevelFromGeometry = roof.ridge ? levelAt(roof.ridge.y) : null
  const eaveLevelFromGeometry =
    roof.eaves.length > 0 ? Math.max(...roof.eaves.map((e) => levelAt(e.y))) : null
  const accepted = datums.filter((d) => d.parsedLevelM !== null)
  const sortedLevels = [...accepted].sort((a, b) => (a.parsedLevelM as number) - (b.parsedLevelM as number))

  const nearest = (target: number | null): VerticalDatumObservation | null => {
    if (target === null) return null
    let best: { d: VerticalDatumObservation; gap: number } | null = null
    for (const d of accepted) {
      const gap = Math.abs((d.parsedLevelM as number) - target)
      if (best === null || gap < best.gap) best = { d, gap }
    }
    return best && best.gap <= 0.5 ? best.d : null
  }
  const ridgeDatum = nearest(ridgeLevelFromGeometry)
  const eaveDatum = nearest(eaveLevelFromGeometry)

  const levels: CandidateLevel[] = []
  const levelTol = sourceTolerance(pxPerMetre, 1, registrationM, 'a level read on the section')
  for (const d of sortedLevels) {
    const value = d.parsedLevelM as number
    const role: CandidateLevel['role'] =
      d.id === ridgeDatum?.id
        ? 'RIDGE'
        : d.id === eaveDatum?.id
          ? 'EAVE'
          : Math.abs(value) < 1e-6
            ? 'GROUND_ZERO'
            : value < 0
              ? 'TERRAIN'
              : 'STOREY_FLOOR'
    levels.push({
      id: `lvl${levels.length}`,
      role,
      level: {
        valueM: value,
        fidelity: d.status === 'ACCEPTED' ? 'SOURCE_EXACT' : 'SOURCE_RECONCILED',
        confidence: d.confidence,
        toleranceM: printedTolerance('a printed level').toleranceM,
        evidence: [evidenceOf(sectionAsset, `level marker at row ${d.markerPx.y.toFixed(2)}, ${d.association}`)],
        why: d.why,
      },
      tolerance: printedTolerance(`the printed level ${value.toFixed(2)} m`),
      datumId: d.id,
      status: 'RESOLVED',
      why:
        role === 'RIDGE'
          ? `the fitted roof planes cross at ${(ridgeLevelFromGeometry ?? 0).toFixed(3)} m, which is this marker's level; ` +
            'the printed value is the authority and the geometry is what named it (§12)'
          : role === 'EAVE'
            ? `the fitted roof plane's low end is at ${(eaveLevelFromGeometry ?? 0).toFixed(3)} m, which is this marker's level`
            : role === 'GROUND_ZERO'
              ? 'the drawing prints this one as the zero itself'
              : role === 'TERRAIN'
                ? 'the only printed level below the zero'
                : 'a printed level with no roof geometry at it, so it is a storey level',
    })
  }
  // The geometric ridge, where no printed marker names it.
  if (ridgeLevelFromGeometry !== null && !ridgeDatum) {
    levels.push({
      id: `lvl${levels.length}`,
      role: 'RIDGE',
      level: {
        valueM: ridgeLevelFromGeometry,
        fidelity: 'SOURCE_DERIVED',
        confidence: 0.7,
        toleranceM: levelTol.toleranceM,
        evidence: [evidenceOf(sectionAsset, 'the crossing of the two fitted roof planes')],
        why: 'no printed marker sits at the ridge, so this is the crossing of the two fitted planes through the solved scale',
      },
      tolerance: levelTol,
      datumId: null,
      status: 'RESOLVED',
      why: 'geometry, because no printed level names the ridge',
    })
  }
  // §30: level ordering must not contradict itself.
  for (let i = 1; i < levels.length; i++) {
    if (levels[i].level.valueM < levels[i - 1].level.valueM - 1e-6) {
      conflicts.push({
        id: `cs${conflicts.length}`,
        kind: 'LEVEL_ORDER_CONTRADICTION',
        observations: [`${levels[i - 1].role} at ${levels[i - 1].level.valueM} m`, `${levels[i].role} at ${levels[i].level.valueM} m`],
        unresolved: 'the levels do not increase with height, which cannot be true of one building',
        evidence: [evidenceOf(sectionAsset, 'the level set')],
        confidence: 0.9,
      })
    }
  }

  const ridgeM = levels.find((l) => l.role === 'RIDGE')?.level.valueM ?? ridgeLevelFromGeometry
  const terrainM = levels.find((l) => l.role === 'TERRAIN')?.level.valueM ?? 0
  const eaveM = levels.find((l) => l.role === 'EAVE')?.level.valueM ?? eaveLevelFromGeometry

  // ---- §16: slabs the section draws, at the levels it prints
  const slabs: CandidateSlab[] = []
  for (const l of levels) {
    if (l.role !== 'STOREY_FLOOR' && l.role !== 'GROUND_ZERO') continue
    const row = Math.round(rowAt(l.level.valueM))
    const span = sectionMassSpan(sectionGray, found.inkThreshold, row + 1)
    if (!span) continue
    slabs.push({
      id: `slab${slabs.length}`,
      topLevel: l.level,
      bottomLevel: null,
      thickness: null,
      fromM: span.fromPx / pxPerMetre,
      toM: span.toPx / pxPerMetre,
      evidence: [evidenceOf(sectionAsset, `fabric spanning x ${span.fromPx}..${span.toPx} px just below row ${row}`)],
      status: 'RESOLVED',
    })
  }

  // ---- which of the plan's axes the section's horizontal axis is
  const groundStorey = candidate.storeys[0] ?? null
  /**
   * The building's extent along one plan axis, weighted by wall material.
   *
   * Not the minimum and maximum: a floor-plan sheet carries dimension chains,
   * a site outline and stray marks outside the building, and a wall-band
   * detector picks some of them up. On project A the raw extent along Z is
   * 19.66 m for a building the elevations measure at fourteen and a half,
   * entirely because of a handful of short bands at the edge of the sheet.
   *
   * Weighting each face by the length of wall behind it and cutting the
   * outermost two percent of that material removes them, because a stray band
   * is short and a facade is long.
   */
  const planExtent = (axis: 'X' | 'Z'): { fromM: number; toM: number } | null => {
    const samples: Array<{ at: number; weight: number }> = []
    for (const s of candidate.storeys) {
      for (const w of s.walls) {
        const length = Math.max(0, w.toM - w.fromM)
        if (length <= 0) continue
        const faces = (axis === 'X') === (w.axis === 'X') ? [w.fromM, w.toM] : [w.nearM, w.farM]
        for (const at of faces) samples.push({ at, weight: length })
      }
    }
    if (samples.length === 0) return null
    samples.sort((a, b) => a.at - b.at)
    const total = samples.reduce((n, s2) => n + s2.weight, 0)
    const quantile = (q: number): number => {
      let acc = 0
      for (const s2 of samples) {
        acc += s2.weight
        if (acc >= total * q) return s2.at
      }
      return samples[samples.length - 1].at
    }
    return { fromM: quantile(0.02), toM: quantile(0.98) }
  }
  const extentX = planExtent('X')
  const extentZ = planExtent('Z')
  const midRow = ridgeM !== null && eaveM !== null ? rowAt((eaveM + 0) / 2) : solution.datumRow - pxPerMetre
  const sectionSpan = sectionMassSpan(sectionGray, found.inkThreshold, Math.round(midRow))
  const sectionWidthM = sectionSpan ? sectionSpan.widthPx / pxPerMetre : null
  let sectionAxis: 'X' | 'Z' | null = null
  if (sectionWidthM !== null && extentX && extentZ) {
    const dx = Math.abs(sectionWidthM - (extentX.toM - extentX.fromM))
    const dz = Math.abs(sectionWidthM - (extentZ.toM - extentZ.fromM))
    sectionAxis = dx <= dz ? 'X' : 'Z'
    notes.push(
      `the section measures ${sectionWidthM.toFixed(2)} m across; the plans measure ` +
        `${(extentX.toM - extentX.fromM).toFixed(2)} m along X and ${(extentZ.toM - extentZ.fromM).toFixed(2)} m along Z, ` +
        `so the section is a cut across ${sectionAxis}`,
    )
  }

  // ---- §17, §18, §19: the elevations
  const facades = planFacades(
    candidate.storeys,
    extentX && extentZ ? { x: extentX, z: extentZ } : null,
    options.facadeExtraction,
  )
  const elevationAssets = pkg.assets.filter((a) => a.roles?.document === 'ELEVATION')
  const silhouettes = new Map<string, FacadeSilhouette>()
  const openingsByAsset = new Map<string, FacadeOpening[]>()
  const registrations = new Map<string, { pixelsPerMetreY: number; rowAtZero: number; anchors: null }>()
  const skylineShapes: SkylineShape[] = []
  const elevationRecords: CandidateElevation[] = []
  const alongRaw = new Map<string, AlongPosition[]>()

  // First pass: outline and vertical registration only. Nothing is measured
  // on a facade until the set has agreed what scale it is drawn at.
  type Pass1 = {
    asset: SourceAsset
    view: FacadeView
    image: RasterImage
    mask: ReturnType<typeof extractBuildingMask>['mask']
    silhouette: FacadeSilhouette
    shape: SkylineShape
    ownPixelsPerMetre: number
    rowAtZero: number
  }
  const pass1: Pass1[] = []
  for (const asset of elevationAssets) {
    const image = images.get(asset.id)
    if (!image) {
      notes.push(`${asset.id} is published as an elevation and did not decode`)
      continue
    }
    const view = (asset.roles?.view ?? 'UNKNOWN') as FacadeView
    const tF = Date.now()
    const { mask } = extractBuildingMask(image)
    const conditioned = conditionSilhouette(mask)
    const silhouette = buildFacadeSilhouette(
      asset.id,
      view,
      mask,
      { minX: conditioned.minX, maxX: conditioned.maxX, topRow: conditioned.topRow, groundRow: conditioned.groundRow },
      options.elevation,
    )
    silhouettes.set(asset.id, silhouette)
    const shape = classifySkyline(silhouette.lines, silhouette.apex, silhouette.widthPx, view)
    skylineShapes.push(shape)
    const vertical = ridgeM === null ? null : registerVertically(silhouette, { ridgeM, terrainM })
    timings.elevationRegisterMs[view] = Date.now() - tF
    if (!vertical) {
      notes.push(`${view}: no vertical registration, because the section settled no ridge level to anchor it on`)
      continue
    }
    pass1.push({
      asset,
      view,
      image,
      mask,
      silhouette,
      shape,
      ownPixelsPerMetre: vertical.pixelsPerMetreY,
      rowAtZero: vertical.rowAtZero,
    })
  }

  /**
   * ---- The set's own scale.
   *
   * A publisher renders a project's elevations onto one canvas at one size, so
   * four elevations of one building are four readings of one scale. That
   * redundancy is worth using for the same reason Stage 06 used it across a
   * sheet set: it catches the drawing whose silhouette the background
   * segmentation got wrong.
   *
   * Measured on project A, three elevations register at 58.5, 58.5 and 58.7 px
   * per metre and the fourth at 50.1 — because its gable is white against a
   * white cloud and the flood classified the top of it as sky, so both the
   * height it was registered from and the width it measures are short by the
   * same fraction, consistently, and nothing internal to that drawing can
   * notice. The set can.
   */
  const ownScales = pass1.map((p) => p.ownPixelsPerMetre).sort((a, b) => a - b)
  const setScale =
    ownScales.length === 0
      ? null
      : ownScales.length % 2
        ? ownScales[ownScales.length >> 1]
        : (ownScales[(ownScales.length >> 1) - 1] + ownScales[ownScales.length >> 1]) / 2
  if (setScale !== null) {
    notes.push(
      `the four elevations register at ${ownScales.map((v) => v.toFixed(2)).join(', ')} px per metre; the set settles on ` +
        `${setScale.toFixed(2)}`,
    )
  }

  for (const p of pass1) {
    const asset = p.asset
    const view = p.view
    const image = p.image
    const silhouette = p.silhouette
    const drift = setScale === null ? 0 : Math.abs(p.ownPixelsPerMetre - setScale) / setScale
    const adopted = setScale !== null && drift > options.setScaleDrift
    const pixelsPerMetre = adopted ? (setScale as number) : p.ownPixelsPerMetre
    // Re-anchor on the ridge, which is the anchor that was actually read off
    // this drawing, rather than on the terrain, whose row is the less certain
    // of the two on a render standing in long grass.
    const rowAtZero = adopted
      ? silhouette.roofTopRow + (ridgeM as number) * pixelsPerMetre
      : p.rowAtZero
    if (adopted) {
      conflicts.push({
        id: `cs${conflicts.length}`,
        kind: 'ELEVATION_SCALE_DISAGREES_WITH_SET',
        observations: [
          `${view} registers at ${p.ownPixelsPerMetre.toFixed(2)} px per metre from its own silhouette`,
          `the other elevations of this project settle on ${(setScale as number).toFixed(2)}`,
        ],
        unresolved:
          `${(drift * 100).toFixed(1)}% apart. A set of elevations is rendered at one size, so one of them reading ` +
          'differently means its silhouette is wrong rather than the building being a different size in that view. The ' +
          "set's scale is adopted and this drawing's own is recorded beside it",
        evidence: [evidenceOf(asset, 'the conditioned silhouette')],
        confidence: 0.6,
      })
    }
    registrations.set(asset.id, {
      pixelsPerMetreY: pixelsPerMetre,
      rowAtZero,
      anchors: null,
    })

    const tG = Date.now()
    const x0 = silhouette.wallSpan?.minX ?? silhouette.minX
    const x1 = silhouette.wallSpan?.maxX ?? silhouette.maxX
    const y0 = Math.round(silhouette.roofTopRow)
    const y1 = silhouette.groundRow
    const region = makeMask(image.width, image.height)
    for (let y = Math.max(0, y0); y <= Math.min(image.height - 1, y1); y++) {
      for (let x = Math.max(0, x0); x <= Math.min(image.width - 1, x1); x++) {
        region.data[y * image.width + x] = p.mask.data[y * image.width + x]
      }
    }
    const gray = toGray(image)
    const grad = sobel(gray)
    const detected = detectFacadeOpenings(
      gray,
      region,
      { x0, x1, y0, y1 },
      pixelsPerMetre,
      { grad, edges: cannyEdges(grad, 0.78, 0.9) },
      options.facadeOpenings,
    )
    timings.openingDetectMs[view] = Date.now() - tG
    openingsByAsset.set(asset.id, detected.openings)
    notes.push(`${view}: ${detected.notes.join('; ')}`)

    const centreCol = (x0 + x1) / 2
    alongRaw.set(
      asset.id,
      detected.openings.map((o) => {
        const fromM = (o.x0 - centreCol) / pixelsPerMetre
        const toM = (o.x1 - centreCol) / pixelsPerMetre
        return { id: o.id, fromM, toM, centreM: (fromM + toM) / 2, widthM: Math.abs(toM - fromM) }
      }),
    )

    const measuredM = (x1 - x0 + 1) / pixelsPerMetre
    const planM =
      view === 'FRONT' || view === 'REAR'
        ? extentX
          ? extentX.toM - extentX.fromM
          : Number.NaN
        : extentZ
          ? extentZ.toM - extentZ.fromM
          : Number.NaN
    const footprintCheck = Number.isFinite(planM) ? { measuredM, planM, residualM: measuredM - planM } : null
    if (footprintCheck && Math.abs(footprintCheck.residualM) > planM * options.elevation.footprintToleranceFraction) {
      conflicts.push({
        id: `cs${conflicts.length}`,
        kind: 'ELEVATION_REGISTRATION_VS_PLAN_FOOTPRINT',
        observations: [
          `${view} measures ${measuredM.toFixed(2)} m across at ${pixelsPerMetre.toFixed(2)} px per metre`,
          `the floor plans measure ${planM.toFixed(2)} m along the same axis`,
        ],
        unresolved:
          'either the render is stretched, or its silhouette includes something the plans do not bound, or one of the ' +
          'two is wrong. Neither is corrected against the other: the elevation is registered from the section\u2019s ' +
          'datums and this residual is carried with it (\u00a717)',
        evidence: [evidenceOf(asset, 'the conditioned silhouette')],
        confidence: 0.5,
      })
    }

    elevationRecords.push({
      assetId: asset.id,
      declaredView: view,
      solvedSide: null,
      matchedOpenings: 0,
      solvedDirection: null,
      directionAgreesWithDeclaredView: true,
      pixelsPerMetreX: pixelsPerMetre,
      pixelsPerMetreY: pixelsPerMetre,
      anisotropy: 1,
      rowAtZero,
      colAtZero: centreCol,
      horizontalMethod: 'UNRESOLVED',
      footprintCheck,
      silhouette: {
        minX: silhouette.minX,
        maxX: silhouette.maxX,
        roofTopRow: silhouette.roofTopRow,
        roofTopFrom: silhouette.roofTopFrom,
        groundRow: silhouette.groundRow,
        shape: p.shape,
      },
      status: adopted ? 'CONFLICTED' : 'RESOLVED',
      confidence: adopted ? 0.45 : 0.7,
      notes: [
        ...silhouette.notes,
        adopted
          ? `this drawing's own silhouette gives ${p.ownPixelsPerMetre.toFixed(2)} px per metre, ${(drift * 100).toFixed(1)}% from ` +
            `the set's ${(setScale as number).toFixed(2)}; the set's is adopted and the disagreement is carried (§17)`
          : `registered from the section's own datums: the roofline top is the ${ridgeM?.toFixed(2)} m ridge and the ` +
            `silhouette's foot the ${terrainM.toFixed(2)} m terrain, giving ${pixelsPerMetre.toFixed(3)} px per metre`,
        'the horizontal scale is taken as the vertical one, which is an assumption about an orthographic projection and ' +
          'is stated rather than measured',
      ],
    })
  }

  // ---- §7, §20: assign facades and match openings
  const tH = Date.now()
  /**
   * Which sides each elevation can be of, before its openings are consulted.
   *
   * The section fixes the ridge's axis, and the skyline shape says whether an
   * elevation is looking along that ridge or across it. That is two bits of
   * source evidence and it halves the search — but more to the point it
   * removes the failure where an entrance elevation is assigned to a side wall
   * because seven of its openings could be made to line up there.
   */
  const admissibleFor = (shape: SkylineShape): FacadeSide[] | null => {
    if (sectionAxis === null) return null
    // A gable end is seen looking along the ridge; the ridge runs along the
    // axis the section does *not* cut across, so a gable-end facade's own
    // along-axis is the one the section cuts across.
    if (shape.kind === 'APEX') return sectionAxis === 'X' ? ['MIN_Z', 'MAX_Z'] : ['MIN_X', 'MAX_X']
    if (shape.kind === 'LEVEL_TOP') return sectionAxis === 'X' ? ['MIN_X', 'MAX_X'] : ['MIN_Z', 'MAX_Z']
    return null
  }
  const assignment = assignFacades(
    elevationRecords.map((e) => ({
      assetId: e.assetId,
      declaredView: e.declaredView,
      openings: alongRaw.get(e.assetId) ?? [],
      admissible: admissibleFor(e.silhouette.shape),
    })),
    facades,
    options.openingMatchToleranceM,
  )
  timings.matchMs = Date.now() - tH
  for (const d of assignment.disagreements) {
    conflicts.push({
      id: `cs${conflicts.length}`,
      kind: 'ELEVATION_VIEW_IDENTITY_UNRESOLVED',
      observations: [d],
      unresolved:
        'the facade each elevation is solved onto is decided by which reading lines its openings up with the plans. ' +
        'This assignment is not a consistent set of four faces, so at least one elevation is not the view it is ' +
        'published as, or is mirrored (§7)',
      evidence: elevationRecords.map((e) => ({ assetId: e.assetId, role: `ELEVATION:${e.declaredView}`, locator: 'the solved assignment' })),
      confidence: 0.6,
    })
  }

  const facadeOpenings: CandidateFacadeOpening[] = []
  const roofOpenings: CandidateRoofOpening[] = []
  const facadeFeatures: CandidateFacadeFeature[] = []
  const chimneys: CandidateChimney[] = []
  type StackSighting = {
    match: ReturnType<typeof matchStacks>[number]
    view: string
    axis: 'X' | 'Z' | null
    assetId: string
    fromM: number
    toM: number
  }
  const stackSightings: StackSighting[] = []
  const tI = Date.now()
  const voids = planVoids(candidate.storeys, options.shellFeatures)

  for (const record of elevationRecords) {
    const asset = elevationAssets.find((a) => a.id === record.assetId)
    if (!asset) continue
    const silhouette = silhouettes.get(record.assetId)
    const reg = registrations.get(record.assetId)
    const detected = openingsByAsset.get(record.assetId) ?? []
    const raw = alongRaw.get(record.assetId) ?? []
    if (!silhouette || !reg) continue
    const assigned = assignment.assignments.find((a) => a.assetId === record.assetId)
    const facade = facades.find((f) => f.side === assigned?.side) ?? null
    const corr = assigned?.correspondence ?? null
    record.solvedDirection = corr?.direction ?? null
    record.solvedSide = assigned?.side ?? null
    record.matchedOpenings = corr?.matches.length ?? 0
    record.horizontalMethod = corr ? 'OPENING_CORRESPONDENCE' : 'UNRESOLVED'
    if ((corr?.matches.length ?? 0) < 2) {
      conflicts.push({
        id: `cs${conflicts.length}`,
        kind: 'ELEVATION_VIEW_IDENTITY_UNRESOLVED',
        observations: [
          `${record.declaredView} was placed on the ${assigned?.side ?? 'unknown'} facade with ` +
            `${corr?.matches.length ?? 0} opening(s) lining up with the plans`,
          'the roof orientation admits it and no other elevation wanted that facade',
        ],
        unresolved:
          'this facade was assigned by elimination rather than by evidence. Which of the two remaining sides it is, is ' +
          'not something one or zero matched openings settle (§7)',
        evidence: [evidenceOf(asset, 'the solved assignment')],
        confidence: 0.35,
      })
    }
    if (facade) record.notes.push(`solved onto the ${facade.side} facade${corr ? ` with ${corr.matches.length} openings matched` : ' with no correspondence'}`)

    const toAlong = (m: number): number => (corr ? corr.direction * m * corr.scale + corr.offsetM : m)
    const openingTol = sourceTolerance(
      reg.pixelsPerMetreY,
      2,
      Math.abs(record.footprintCheck?.residualM ?? 0) * 0.5,
      `an opening on the ${record.declaredView} elevation`,
    )

    detected.forEach((o, i) => {
      const r = raw[i]
      const alongFromM = toAlong(r.fromM)
      const alongToM = toAlong(r.toM)
      const sillLevelM = (reg.rowAtZero - o.y1) / reg.pixelsPerMetreY
      const headLevelM = (reg.rowAtZero - o.y0) / reg.pixelsPerMetreY
      const match = corr?.matches.find((m) => m.elevationId === o.id) ?? null
      const hostIndex = match && facade ? facade.openings.findIndex((p) => p.id === match.planId) : -1
      const host = hostIndex >= 0 && facade ? facade.hosts[hostIndex] : null
      const rakedHead = o.rakedTop
        ? {
            leftLevelM: (reg.rowAtZero - o.rakedTop.leftY) / reg.pixelsPerMetreY,
            rightLevelM: (reg.rowAtZero - o.rakedTop.rightY) / reg.pixelsPerMetreY,
            slopeDeg: o.rakedTop.slopeDeg,
          }
        : null
      const storeyBand =
        eaveM !== null && sillLevelM >= eaveM
          ? 'above the eave'
          : levels.filter((l) => l.role === 'STOREY_FLOOR' || l.role === 'GROUND_ZERO').reduce<string | null>((acc, l) => {
              return sillLevelM >= l.level.valueM - 0.3 ? `at or above the ${l.level.valueM.toFixed(2)} m level` : acc
            }, null)
      facadeOpenings.push({
        id: `fo${facadeOpenings.length}`,
        view: record.declaredView,
        assetId: record.assetId,
        boxPx: { x0: o.x0, y0: o.y0, x1: o.x1, y1: o.y1 },
        alongFromM: Math.min(alongFromM, alongToM),
        alongToM: Math.max(alongFromM, alongToM),
        sillLevelM,
        headLevelM,
        widthM: Math.abs(alongToM - alongFromM),
        heightM: headLevelM - sillLevelM,
        rakedHead,
        storeyBand,
        evidenceKind: o.evidence,
        fidelity: 'RENDER_DERIVED',
        tolerance: openingTol,
        match:
          match && host
            ? { planWallId: host.wallId, planOpeningIndex: host.openingIndex, residualM: match.residualM, confidence: 0.7 }
            : null,
        matchStatus: match && host ? 'MATCHED' : 'UNMATCHED_ON_ELEVATION',
        confidence: o.confidence,
        evidence: [evidenceOf(asset, `a ${o.evidence.join(' and ')} at ${o.x0},${o.y0}..${o.x1},${o.y1} px`)],
        why:
          match && host
            ? `matched to a plan gap on ${host.wallId} at ${match.residualM.toFixed(2)} m under the facade's own solved offset`
            : 'no plan gap lies under this opening at the offset the facade as a whole settles, so it stays unmatched (§20)',
      })
    })

    // Plan gaps the elevation does not show.
    if (facade && corr) {
      const matchedPlan = new Set(corr.matches.map((m) => m.planId))
      for (let i = 0; i < facade.openings.length; i++) {
        const p = facade.openings[i]
        if (matchedPlan.has(p.id)) continue
        conflicts.push({
          id: `cs${conflicts.length}`,
          kind: 'PLAN_OPENING_VS_ELEVATION_OPENING',
          observations: [
            `the ${facade.side} facade's plans show a ${p.widthM.toFixed(2)} m gap at ${p.centreM.toFixed(2)} m along it, on ${facade.hosts[i].wallId}`,
            `the ${record.declaredView} elevation shows no opening there`,
          ],
          unresolved:
            'either the elevation does not show it, or the detector did not find it, or the gap in the plan is not an ' +
            'opening. Nothing here decides which',
          evidence: [evidenceOf(asset, 'the detected openings'), { assetId: 'plan', role: 'FLOOR_PLAN', locator: facade.hosts[i].wallId }],
          confidence: 0.4,
        })
      }
    }

    // §22: openings above the eave are in the roof, not the wall.
    if (eaveM !== null) {
      const withMetres = detected.map((o, i) => ({
        ...o,
        alongFromM: toAlong(raw[i].fromM),
        alongToM: toAlong(raw[i].toM),
        sillLevelM: (reg.rowAtZero - o.y1) / reg.pixelsPerMetreY,
        headLevelM: (reg.rowAtZero - o.y0) / reg.pixelsPerMetreY,
      }))
      for (const rl of rooflightsFromElevation(record.assetId, record.declaredView, withMetres, eaveM, () => [], options.shellFeatures)) {
        roofOpenings.push({
          id: `ro${roofOpenings.length}`,
          roofPlaneId: null,
          alongPlaneM: (rl.alongFromM + rl.alongToM) / 2,
          acrossPlaneM: null,
          widthM: {
            valueM: rl.widthM,
            fidelity: 'RENDER_DERIVED',
            confidence: rl.confidence,
            toleranceM: openingTol.toleranceM,
            evidence: [evidenceOf(asset, `roof opening at ${rl.alongFromM.toFixed(2)}..${rl.alongToM.toFixed(2)} m`)],
            why: rl.why,
          },
          heightM: {
            valueM: rl.heightM,
            fidelity: 'RENDER_DERIVED',
            confidence: rl.confidence,
            toleranceM: openingTol.toleranceM,
            evidence: [evidenceOf(asset, 'the same region')],
            why: rl.why,
          },
          sources: [evidenceOf(asset, `${rl.aboveEaveByM.toFixed(2)} m above the eave`)],
          status: rl.status,
          confidence: rl.confidence,
          why: rl.why,
        })
        if (rl.status === 'UNRESOLVED') {
          conflicts.push({
            id: `cs${conflicts.length}`,
            kind: 'ROOFLIGHT_PLAN_VS_ELEVATION',
            observations: [`the ${record.declaredView} elevation shows an opening ${rl.aboveEaveByM.toFixed(2)} m above the eave`],
            unresolved:
              'no plan, section or second elevation shows it, and one weak source is not a confirmation. Whether it is a ' +
              'rooflight, a roof window or glazing in a gable is left open (§22)',
            evidence: [evidenceOf(asset, rl.id)],
            confidence: 0.35,
          })
        }
      }
    }

    // §23: stacks above the fitted roofline, collected now and turned into
    // chimneys once every elevation has been seen.
    const stacks = findStacks(
      record.assetId,
      record.declaredView,
      silhouette.skyline,
      silhouette.lines,
      silhouette.minX,
      silhouette.maxX,
      reg.pixelsPerMetreY,
      reg.rowAtZero,
      eaveM,
      options.shellFeatures,
    )
    const alongOfCol = (px: number): number => toAlong((px - record.colAtZero) / reg.pixelsPerMetreY)
    for (const m of matchStacks(
      stacks,
      voids,
      (v) => (facade?.alongAxis === 'X' ? (v.box.x0 + v.box.x1) / 2 : (v.box.z0 + v.box.z1) / 2),
      (st) => alongOfCol((st.fromPx + st.toPx) / 2),
      options.shellFeatures,
    )) {
      stackSightings.push({
        match: m,
        view: record.declaredView,
        axis: facade?.alongAxis ?? null,
        assetId: record.assetId,
        fromM: Math.min(alongOfCol(m.stack.fromPx), alongOfCol(m.stack.toPx)),
        toM: Math.max(alongOfCol(m.stack.fromPx), alongOfCol(m.stack.toPx)),
      })
    }

    // §24: bands on the facade, and the depth an elevation cannot measure.
    if (facade) {
      const withMetres = detected.map((o, i) => ({
        alongFromM: toAlong(raw[i].fromM),
        alongToM: toAlong(raw[i].toM),
        sillLevelM: (reg.rowAtZero - o.y1) / reg.pixelsPerMetreY,
        headLevelM: (reg.rowAtZero - o.y0) / reg.pixelsPerMetreY,
        confidence: o.confidence,
      }))
      for (const band of bandsFromOpenings(record.declaredView, withMetres)) {
        facadeFeatures.push({
          id: `ff${facadeFeatures.length}`,
          kind: band.kind === 'SLAB_EDGE' ? 'BALCONY_SLAB' : 'RAILING',
          view: record.declaredView,
          alongFromM: band.fromM,
          alongToM: band.toM,
          bottomLevelM: band.bottomLevelM,
          topLevelM: band.topLevelM,
          depth: null,
          evidence: [evidenceOf(asset, band.id)],
          status: 'UNRESOLVED',
          confidence: band.confidence,
          why: band.why,
        })
        conflicts.push({
          id: `cs${conflicts.length}`,
          kind: 'FACADE_DEPTH_UNRESOLVED',
          observations: [`a ${(band.toM - band.fromM).toFixed(2)} m band on the ${record.declaredView} elevation at ${band.bottomLevelM.toFixed(2)} m`],
          unresolved:
            'how far it projects or is recessed is a depth, and no orthographic source here constrains it. §4 forbids ' +
            'reading it off the perspective renders, so it stays unresolved',
          evidence: [evidenceOf(asset, band.id)],
          confidence: 0.4,
        })
      }
    }
  }

  /**
   * ---- §23: one stack seen from three sides is one stack.
   *
   * Each elevation gives a chimney's position along one plan axis and nothing
   * about the other, so two stacks that share a column of x are one silhouette
   * on the entrance elevation and two on the side. Counting sightings would
   * make that four chimneys. What is counted instead is *clusters within one
   * axis*, and the axis that resolves the most of them is the one that says how
   * many there are — which is the same reasoning by which a reader of these
   * drawings arrives at the answer.
   */
  const clusterAxis = (axis: 'X' | 'Z'): StackSighting[][] => {
    const here = stackSightings.filter((s2) => s2.axis === axis).sort((a, b) => a.fromM - b.fromM)
    const out: StackSighting[][] = []
    for (const s2 of here) {
      const last = out[out.length - 1]
      if (last && s2.fromM <= Math.max(...last.map((x) => x.toM)) + 0.5) last.push(s2)
      else out.push([s2])
    }
    return out
  }
  const clustersX = clusterAxis('X')
  const clustersZ = clusterAxis('Z')
  const resolving = clustersZ.length > clustersX.length ? clustersZ : clustersX
  const otherAxis = resolving === clustersZ ? clustersX : clustersZ
  for (const cluster of resolving) {
    const best = cluster.reduce((a, b) => (b.match.stack.topLevelM > a.match.stack.topLevelM ? b : a))
    const matchedVoid = cluster.find((c) => c.match.planVoid !== null)?.match ?? null
    chimneys.push({
      id: `ch${chimneys.length}`,
      planFootprint: matchedVoid?.planVoid ? matchedVoid.planVoid.box : null,
      planStorey: matchedVoid?.planVoid ? matchedVoid.planVoid.storey : null,
      stack: {
        view: best.view,
        alongFromM: best.fromM,
        alongToM: best.toM,
        topLevelM: best.match.stack.topLevelM,
      },
      roofPenetrationLevelM: null,
      crossSource: matchedVoid ? 'MATCHED' : 'UNRESOLVED',
      evidence: cluster.map((c) => ({ assetId: c.assetId, role: `ELEVATION:${c.view}`, locator: c.match.stack.id })),
      confidence: Math.min(0.85, 0.4 + 0.15 * cluster.length + (matchedVoid ? 0.2 : 0)),
      why:
        `seen on ${cluster.length} elevation(s) (${cluster.map((c) => c.view).join(', ')}) at ` +
        `${best.fromM.toFixed(2)}..${best.toM.toFixed(2)} m along the facade, topping out at ${best.match.stack.topLevelM.toFixed(2)} m. ` +
        `${otherAxis.length} cluster(s) on the perpendicular axis; the axis that resolves the most is the one counted. ` +
        (matchedVoid ? matchedVoid.why : 'no plan void lines up with it on this axis'),
    })
    if (!matchedVoid) {
      conflicts.push({
        id: `cs${conflicts.length}`,
        kind: 'CHIMNEY_LOWER_SHAFT_UNRESOLVED',
        observations: [
          `a stack at ${best.fromM.toFixed(2)}..${best.toM.toFixed(2)} m along the ${best.view} facade, topping out at ${best.match.stack.topLevelM.toFixed(2)} m`,
          'no plan void small enough to be its flue lines up under it on this axis',
        ],
        unresolved:
          'whether the shaft continues to a flue the plans draw somewhere else is not something an elevation and a ' +
          'plan can settle between them. Joining them would assert a route no drawing shows (§23)',
        evidence: cluster.map((c) => ({ assetId: c.assetId, role: `ELEVATION:${c.view}`, locator: c.match.stack.id })),
        confidence: 0.45,
      })
    }
  }

  // §24: recesses, which only the plan can measure.
  for (const facade of facades) {
    const inward: 1 | -1 = facade.side === 'MIN_X' || facade.side === 'MIN_Z' ? 1 : -1
    const wallAxis: 'X' | 'Z' = facade.alongAxis === 'X' ? 'X' : 'Z'
    for (const r of recessesFromPlan(candidate.storeys, facade.planeM, facade.side, wallAxis, inward, options.shellFeatures)) {
      facadeFeatures.push({
        id: `ff${facadeFeatures.length}`,
        kind: 'FACADE_RECESS',
        view: facade.side,
        alongFromM: r.fromM,
        alongToM: r.toM,
        bottomLevelM: 0,
        topLevelM: Number.NaN,
        depth: {
          valueM: r.depthM,
          fidelity: 'SOURCE_DERIVED',
          confidence: r.confidence,
          toleranceM: 0.05,
          evidence: [{ assetId: 'plan', role: 'FLOOR_PLAN', locator: r.wallId }],
          why: r.why,
        },
        evidence: [{ assetId: 'plan', role: `FLOOR_PLAN:${r.storey}`, locator: r.wallId }],
        status: 'RESOLVED',
        confidence: r.confidence,
        why: r.why,
      })
    }
  }
  timings.featuresMs = Date.now() - tI

  // ---- §15: topology, from the section and the elevations together
  const topology = classifyRoofTopology(
    roof,
    skylineShapes,
    [evidenceOf(sectionAsset, 'the fitted roof edges')],
    elevationAssets.map((a) => evidenceOf(a, 'the fitted skyline')),
    options.topology,
  )

  // ---- §16: roof plane candidates
  const roofPlanes: RoofPlaneCandidate[] = []
  for (const edge of roof.edges) {
    if (edge.kind !== 'PITCHED') continue
    const soffit = roof.soffits.find((s) => s.edgeId === edge.id) ?? null
    // A fitted plane's support can run a little past the ridge, because the
    // two planes' inliers overlap where they meet. The plane stops at the
    // ridge, so the high end is the crossing where there is one — otherwise a
    // roof reports a high point above its own ridge.
    const partOfRidge = roof.ridge !== null && (roof.ridge.leftId === edge.id || roof.ridge.rightId === edge.id)
    const ends = [edge.intercept + edge.slope * edge.fromX, edge.intercept + edge.slope * edge.toX]
    const highRow = partOfRidge && roof.ridge ? roof.ridge.y : Math.min(...ends)
    const lowRow = Math.max(...ends)
    const tol = sourceTolerance(pxPerMetre, Math.max(1, edge.rmsPx), registrationM, `the ${edge.id} roof plane`)
    roofPlanes.push({
      id: `plane${roofPlanes.length}`,
      componentId: topology.components[0]?.id ?? 'roof0',
      host: sectionAxis ? `the mass the section cuts across ${sectionAxis}` : 'the mass the section cuts through',
      pitch,
      fallsTowards: edge.slope > 0 ? 'RIGHT' : 'LEFT',
      ridgeLevel: {
        valueM: levelAt(highRow),
        fidelity: 'SOURCE_DERIVED',
        confidence: 0.8,
        toleranceM: tol.toleranceM,
        evidence: [evidenceOf(sectionAsset, `the high end of ${edge.id}`)],
        why: `the fitted plane's high end, through the solved vertical scale`,
      },
      eaveLevel: {
        valueM: levelAt(lowRow),
        fidelity: 'SOURCE_DERIVED',
        confidence: 0.75,
        toleranceM: tol.toleranceM,
        evidence: [evidenceOf(sectionAsset, `the low end of ${edge.id}`)],
        why: "the fitted plane's low end, which is its top surface at the eave and not the printed eave datum",
      },
      supportFromM: edge.fromX / pxPerMetre,
      supportToM: edge.toX / pxPerMetre,
      thickness: soffit
        ? {
            // Measured down a column, so the build-up perpendicular to the
            // plane is that times the cosine of the pitch.
            valueM: (soffit.thicknessPx / pxPerMetre) * Math.cos((edge.pitchDeg * Math.PI) / 180),
            fidelity: 'SOURCE_DERIVED',
            confidence: 0.6,
            toleranceM: tol.toleranceM,
            evidence: [evidenceOf(sectionAsset, `the fabric run below ${edge.id}`)],
            why: `${soffit.thicknessPx} px measured vertically through the roof band, taken perpendicular to the plane`,
          }
        : null,
      overhang: null,
      unresolved: [
        soffit ? [] : ['the section does not draw this plane as a solid band, so its build-up is not measured'],
        ['the eave overhang beyond the wall it bears on is not settled: the section shows where the plane stops, not where the wall is'],
      ].flat(),
      evidence: [evidenceOf(sectionAsset, `fitted roof edge ${edge.id}`)],
      confidence: 0.75,
    })
  }
  for (const flat of roof.edges.filter((e) => e.kind === 'FLAT')) {
    const tol = sourceTolerance(pxPerMetre, Math.max(1, flat.rmsPx), registrationM, `the ${flat.id} flat roof`)
    const level = levelAt(flat.intercept + flat.slope * ((flat.fromX + flat.toX) / 2))
    roofPlanes.push({
      id: `plane${roofPlanes.length}`,
      componentId: topology.components.find((c) => c.topology === 'FLAT')?.id ?? 'roof0',
      host: 'the mass under the level run the section cuts',
      pitch: fusePitch([]),
      fallsTowards: 'LEVEL',
      ridgeLevel: {
        valueM: level,
        fidelity: 'SOURCE_DERIVED',
        confidence: 0.75,
        toleranceM: tol.toleranceM,
        evidence: [evidenceOf(sectionAsset, `the level run ${flat.id}`)],
        why: 'a level run of the section’s upper surface, through the solved vertical scale',
      },
      eaveLevel: {
        valueM: level,
        fidelity: 'SOURCE_DERIVED',
        confidence: 0.75,
        toleranceM: tol.toleranceM,
        evidence: [evidenceOf(sectionAsset, `the level run ${flat.id}`)],
        why: 'a flat roof has one level',
      },
      supportFromM: flat.fromX / pxPerMetre,
      supportToM: flat.toX / pxPerMetre,
      thickness: null,
      overhang: null,
      unresolved: ['whether this level run is a roof or a slab the section cuts is not settled by the section alone'],
      evidence: [evidenceOf(sectionAsset, flat.id)],
      confidence: 0.6,
    })
  }

  // §27: the section's ridge against the elevations'.
  for (const record of elevationRecords) {
    const reg = registrations.get(record.assetId)
    const s = silhouettes.get(record.assetId)
    if (!reg || !s || ridgeM === null) continue
    const elevationRidgeM = (reg.rowAtZero - s.roofTopRow) / reg.pixelsPerMetreY
    // The registration was anchored on the ridge, so this is a tautology for
    // the anchor itself and a real check for everything derived from it; it is
    // recorded so that a reader can see the anchor rather than wonder.
    record.notes.push(
      `the ridge this elevation was anchored on reads back as ${elevationRidgeM.toFixed(3)} m against the section's ${ridgeM.toFixed(3)} m`,
    )
  }

  if (ridgeM === null) unresolved.push('no ridge level, so nothing vertical is anchored')
  if (eaveM === null) unresolved.push('no eave level: no printed marker sits at the fitted roof plane’s low end')
  if (facades.length === 0) unresolved.push('the floor-plan candidate has no walls, so there is nothing to match an elevation against')
  for (const p of roofPlanes) unresolved.push(...p.unresolved.map((u) => `${p.id}: ${u}`))

  timings.totalMs = Date.now() - t0
  return {
    shell: {
      section: {
        assetId: sectionAsset.id,
        pixelsPerMetre: pxPerMetre,
        datumRow: solution.datumRow,
        rmsResidualM: solution.rmsResidualM,
        pairSpread: solution.pairSpread,
        why: solution.why,
      },
      verticalDatums: datums,
      levels,
      slabs,
      roofTopology: topology.overall,
      roofComponents: topology.components,
      roofPlanes,
      pitch,
      elevations: elevationRecords,
      facadeOpenings,
      roofOpenings,
      chimneys,
      facadeFeatures,
      crossSourceConflicts: conflicts,
      unresolved,
      notes: [...notes, topology.why, pitch.why],
    },
    debug: {
      sectionAssetId: sectionAsset.id,
      annotations: found.annotations,
      roof,
      silhouettes,
      openings: openingsByAsset,
      facades,
    },
    timings,
  }
}
