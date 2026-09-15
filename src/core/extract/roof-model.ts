/**
 * Fusing a roof out of what several drawings each say about it — §14, §15, §16.
 *
 * Three rules shape everything here.
 *
 * **Two observations stay two.** A printed `40°` and a slope fitted at 39.95°
 * are not one pitch with a small error; they are two independent readings that
 * happen to agree, and §14 wants the agreement recorded rather than collapsed.
 * When they *disagree* materially the disagreement is the finding, and
 * averaging it away would destroy the only evidence that something is wrong.
 *
 * **Topology is read off the drawings, never off the name.** §15 says so
 * explicitly. A gable and a hip differ in exactly one visible way: seen along
 * the ridge, a gable's roof runs level from end to end and a hip's slopes away
 * at both, so its level top is shorter than the building. That is a
 * measurement on an elevation's own skyline and it is the measurement used.
 *
 * **A plane is not a solid.** §16 asks for roof plane candidates carrying
 * their support, their pitch, their eave, their evidence and their
 * unresolved parts, and stops short of compiling them. Nothing here produces
 * geometry that could be mistaken for a built roof.
 *
 * PORT_DIRECT (Kotlin).
 */
import type { CandidateMeasure, EvidenceRef, ResolutionStatus } from './candidate-evidence.js'
import type { RoofEdgeFit, SectionRoofGeometry } from './section-roof.js'

export type RoofTopology = 'GABLE' | 'HIP' | 'FLAT' | 'SHED' | 'COMPOSITE' | 'UNKNOWN'

/** One reading of a pitch, before anything is fused. */
export type PitchObservation = {
  id: string
  kind: 'PRINTED_CALLOUT' | 'SECTION_EDGE_FIT' | 'ELEVATION_SKYLINE_FIT'
  pitchDeg: number
  confidence: number
  /** How well this reading localises a pitch, degrees. */
  toleranceDeg: number
  evidence: EvidenceRef[]
  why: string
}

export type FusedPitch = {
  observations: PitchObservation[]
  pitchDeg: number
  toleranceDeg: number
  fidelity: 'SOURCE_EXACT' | 'SOURCE_DERIVED' | 'RENDER_DERIVED' | 'UNRESOLVED'
  status: ResolutionStatus
  /** Largest gap between any two observations, degrees. */
  spreadDeg: number
  confidence: number
  why: string
}

/**
 * Fuse pitch observations without letting a label decide alone.
 *
 * A printed callout outranks a fit — it is the designer's number — but only
 * once the fit agrees with it. Where they disagree by more than the fit's own
 * tolerance admits, the result is `CONFLICTED` and carries the printed value
 * with the disagreement attached, because §14 requires the conflict preserved
 * and because the printed value is still the more likely of the two to be what
 * the building is meant to be.
 */
export function fusePitch(observations: readonly PitchObservation[]): FusedPitch {
  const obs = [...observations]
  if (obs.length === 0) {
    return {
      observations: [],
      pitchDeg: Number.NaN,
      toleranceDeg: Number.POSITIVE_INFINITY,
      fidelity: 'UNRESOLVED',
      status: 'UNRESOLVED',
      spreadDeg: Number.NaN,
      confidence: 0,
      why: 'no source states or shows a pitch',
    }
  }
  const values = obs.map((o) => o.pitchDeg)
  const spreadDeg = Math.max(...values) - Math.min(...values)
  const printed = obs.filter((o) => o.kind === 'PRINTED_CALLOUT')
  const fitted = obs.filter((o) => o.kind !== 'PRINTED_CALLOUT')

  if (printed.length > 0) {
    const p = printed[0]
    const worst = fitted.reduce(
      (acc, f) => Math.max(acc, Math.abs(f.pitchDeg - p.pitchDeg)),
      0,
    )
    const admits = fitted.reduce((acc, f) => Math.max(acc, f.toleranceDeg), 0.5) + p.toleranceDeg
    const agrees = fitted.length === 0 || worst <= admits
    return {
      observations: obs,
      pitchDeg: p.pitchDeg,
      toleranceDeg: p.toleranceDeg,
      fidelity: 'SOURCE_EXACT',
      status: agrees ? 'RESOLVED' : 'CONFLICTED',
      spreadDeg,
      confidence: agrees ? Math.min(0.97, 0.7 + 0.25 * p.confidence) : 0.4,
      why:
        fitted.length === 0
          ? `the drawing prints ${p.pitchDeg}° and nothing measures the slope, so the printed value stands alone`
          : agrees
            ? `the drawing prints ${p.pitchDeg}° and ${fitted.length} fitted slope${fitted.length === 1 ? '' : 's'} ` +
              `measure ${fitted.map((f) => f.pitchDeg.toFixed(2)).join(', ')}°, agreeing to ${worst.toFixed(2)}°`
            : `the drawing prints ${p.pitchDeg}° but the slope it is printed against measures ` +
              `${fitted.map((f) => f.pitchDeg.toFixed(2)).join(', ')}°, which is ${worst.toFixed(2)}° away and outside ` +
              `the ${admits.toFixed(2)}° the fit admits. The printed value is carried and the disagreement stands (§14)`,
    }
  }

  // No printed value: fuse the fits by inverse variance, and say that no
  // source states a pitch.
  let wsum = 0
  let vsum = 0
  for (const f of fitted) {
    const w = 1 / Math.max(1e-6, f.toleranceDeg ** 2)
    wsum += w
    vsum += w * f.pitchDeg
  }
  const agrees = spreadDeg <= fitted.reduce((a, f) => Math.max(a, f.toleranceDeg), 0.5) * 2
  const anyRender = fitted.some((f) => f.kind === 'ELEVATION_SKYLINE_FIT')
  const allRender = fitted.every((f) => f.kind === 'ELEVATION_SKYLINE_FIT')
  return {
    observations: obs,
    pitchDeg: vsum / wsum,
    toleranceDeg: 1 / Math.sqrt(wsum),
    fidelity: allRender ? 'RENDER_DERIVED' : 'SOURCE_DERIVED',
    status: agrees ? 'RESOLVED' : 'CONFLICTED',
    spreadDeg,
    confidence: agrees ? (anyRender && !allRender ? 0.8 : 0.7) : 0.35,
    why:
      `no source prints a pitch; ${fitted.length} fitted slope${fitted.length === 1 ? '' : 's'} give ` +
      `${fitted.map((f) => f.pitchDeg.toFixed(2)).join(', ')}°` +
      (agrees ? ', which agree' : `, which differ by ${spreadDeg.toFixed(2)}° and do not`),
  }
}

/** What one elevation's skyline says about the shape of the top of the building. */
export type SkylineShape = {
  view: string
  /** A gable end shows an apex; a roof seen along its ridge shows a level top. */
  kind: 'APEX' | 'LEVEL_TOP' | 'SLOPED' | 'UNCLEAR'
  /** For a level top: how much of the facade it spans, 0..1. */
  levelSpanFraction: number
  /** Pitches of the two flanks, where there are two. */
  pitches: number[]
}

export function classifySkyline(
  lines: readonly RoofEdgeFit[],
  apex: { x: number; y: number; leftPitchDeg: number; rightPitchDeg: number } | null,
  widthPx: number,
  view: string,
): SkylineShape {
  const flat = lines.filter((l) => l.kind === 'FLAT').sort((a, b) => b.toX - b.fromX - (a.toX - a.fromX))
  const widestFlat = flat[0] ?? null
  const levelSpanFraction = widestFlat ? (widestFlat.toX - widestFlat.fromX) / Math.max(1, widthPx) : 0
  if (apex && (!widestFlat || apex.y < widestFlat.intercept + widestFlat.slope * apex.x - 4)) {
    return { view, kind: 'APEX', levelSpanFraction, pitches: [apex.leftPitchDeg, apex.rightPitchDeg] }
  }
  if (levelSpanFraction >= 0.35) {
    return { view, kind: 'LEVEL_TOP', levelSpanFraction, pitches: [] }
  }
  const pitched = lines.filter((l) => l.kind === 'PITCHED')
  if (pitched.length > 0) return { view, kind: 'SLOPED', levelSpanFraction, pitches: pitched.map((p) => p.pitchDeg) }
  return { view, kind: 'UNCLEAR', levelSpanFraction, pitches: [] }
}

/** One roof component, and what kind of roof it is. */
export type RoofComponent = {
  id: string
  topology: RoofTopology
  /** How many planes it has, where that is known. */
  planes: number
  /** The storey or mass it sits on, in the candidate's own words. */
  host: string
  confidence: number
  evidence: EvidenceRef[]
  why: string
}

export type RoofTopologyResult = {
  overall: RoofTopology
  components: RoofComponent[]
  skylines: SkylineShape[]
  status: ResolutionStatus
  why: string
}

export type TopologyOptions = {
  /**
   * How much of a facade a level top must span before the ridge is judged to
   * run the whole length, which is what makes a roof a gable rather than a hip.
   */
  gableLevelSpan: number
  /** Below this, a level top that short means the ridge stops short: a hip. */
  hipLevelSpan: number
}

export const DEFAULT_TOPOLOGY_OPTIONS: TopologyOptions = {
  gableLevelSpan: 0.8,
  hipLevelSpan: 0.7,
}

/**
 * Classify the roof from the section, the elevations and the plan footprint.
 *
 * The section says how many planes there are and whether any of them is flat.
 * The elevations say whether the ridge runs the whole length of the building.
 * Neither alone is enough and the name of the project is never consulted (§15).
 *
 * Where the section shows both a pitched roof and a flat one over different
 * parts of the plan, that is two components and the building is `COMPOSITE` —
 * which is what project A is, and what a single top-level label would lose.
 */
export function classifyRoofTopology(
  section: SectionRoofGeometry | null,
  skylines: readonly SkylineShape[],
  sectionEvidence: EvidenceRef[],
  elevationEvidence: EvidenceRef[],
  opts: TopologyOptions = DEFAULT_TOPOLOGY_OPTIONS,
): RoofTopologyResult {
  const components: RoofComponent[] = []
  const pitched = section ? section.edges.filter((e) => e.kind === 'PITCHED') : []
  const flat = section ? section.edges.filter((e) => e.kind === 'FLAT') : []

  // How the elevations see the main mass: a ridge running end to end, or one
  // that stops short of both ends.
  const levelTops = skylines.filter((s) => s.kind === 'LEVEL_TOP')
  const apexes = skylines.filter((s) => s.kind === 'APEX')
  const longestLevel = levelTops.reduce((a, s) => Math.max(a, s.levelSpanFraction), 0)

  let main: RoofTopology = 'UNKNOWN'
  let mainWhy = ''
  if (section && section.ridge && pitched.length >= 2) {
    if (levelTops.length === 0) {
      main = 'GABLE'
      mainWhy =
        'the section shows two opposed slopes meeting at a ridge, and no elevation shows the ridge along its ' +
        'length, so nothing contradicts a gable'
    } else if (longestLevel >= opts.gableLevelSpan) {
      main = 'GABLE'
      mainWhy =
        `the section shows two opposed slopes meeting at a ridge, and the ridge runs ` +
        `${Math.round(longestLevel * 100)}% of the facade it is seen along — end to end, which is a gable and not a hip`
    } else if (longestLevel > 0 && longestLevel < opts.hipLevelSpan) {
      main = 'HIP'
      mainWhy =
        `the section shows two opposed slopes meeting at a ridge, but the ridge runs only ` +
        `${Math.round(longestLevel * 100)}% of the facade it is seen along, so it stops short at both ends`
    } else {
      main = 'UNKNOWN'
      mainWhy =
        `the section shows a ridge, but the ${Math.round(longestLevel * 100)}% of the facade it spans is between ` +
        'what a gable and what a hip would give, and the sources do not settle which'
    }
    components.push({
      id: 'roof0',
      topology: main,
      planes: 2,
      host: 'the mass the section cuts through',
      confidence: main === 'UNKNOWN' ? 0.3 : levelTops.length > 0 ? 0.8 : 0.55,
      evidence: [...sectionEvidence, ...elevationEvidence],
      why: mainWhy,
    })
  } else if (section && pitched.length === 1 && flat.length === 0) {
    main = 'SHED'
    mainWhy = 'the section shows one pitched plane and no opposed one'
    components.push({
      id: 'roof0',
      topology: 'SHED',
      planes: 1,
      host: 'the mass the section cuts through',
      confidence: 0.6,
      evidence: sectionEvidence,
      why: mainWhy,
    })
  } else if (section && pitched.length === 0 && flat.length > 0) {
    main = 'FLAT'
    mainWhy = 'the section shows no pitched plane at all, only level ones'
    components.push({
      id: 'roof0',
      topology: 'FLAT',
      planes: flat.length,
      host: 'the mass the section cuts through',
      confidence: 0.6,
      evidence: sectionEvidence,
      why: mainWhy,
    })
  }

  for (const f of flat) {
    if (main === 'FLAT') break
    components.push({
      id: `roof${components.length}`,
      topology: 'FLAT',
      planes: 1,
      host: `a mass the section cuts at x ${Math.round(f.fromX)}..${Math.round(f.toX)} px`,
      confidence: 0.6,
      evidence: sectionEvidence,
      why: `a level run of ${f.inliers} samples at ${f.rmsPx.toFixed(2)} px rms, beside the main roof and at a different height`,
    })
  }

  const overall: RoofTopology =
    components.length === 0
      ? 'UNKNOWN'
      : components.length === 1
        ? components[0].topology
        : 'COMPOSITE'

  return {
    overall,
    components,
    skylines: [...skylines],
    status: overall === 'UNKNOWN' ? 'UNRESOLVED' : 'RESOLVED',
    why:
      components.length === 0
        ? 'no section roof geometry, so no topology'
        : components.length === 1
          ? mainWhy
          : `${components.length} roof components of different kinds — ${components.map((c) => c.topology).join(' and ')} — ` +
            `so the building is COMPOSITE and each is carried separately (§15). ${mainWhy}`,
  }
}

/** One plane of a roof, in building-local metres. §16: a candidate, not a solid. */
export type RoofPlaneCandidate = {
  id: string
  componentId: string
  host: string
  /** Pitch of the plane. */
  pitch: FusedPitch
  /** Which way it falls, in the section's own frame. */
  fallsTowards: 'LEFT' | 'RIGHT' | 'LEVEL'
  /** Level of its high edge and of its low edge. */
  ridgeLevel: CandidateMeasure
  eaveLevel: CandidateMeasure
  /** Horizontal extent of the plane in the section's cut, metres from the plan origin. */
  supportFromM: number
  supportToM: number
  /** Thickness of the build-up measured perpendicular to the plane, where the section draws it. */
  thickness: CandidateMeasure | null
  /** Eave overhang beyond the wall it bears on, where the sources settle it. */
  overhang: CandidateMeasure | null
  /** What is not settled about this plane. */
  unresolved: string[]
  evidence: EvidenceRef[]
  confidence: number
}
