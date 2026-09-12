/**
 * Printed-dimension contracts (§5, §10, §12, §14).
 *
 * The unit of value here is not "a number that was recognised" but "a number
 * whose physical referent is known". Everything in this file exists to keep
 * those two things distinguishable: a `TextCandidate` is a reading, a
 * `DimensionSegment` is a measurement of something, and only a segment that
 * has both a settled value and an association becomes a metric constraint.
 *
 * PORT_DIRECT (Kotlin).
 */

/** Orientation of printed text relative to the image. */
export type TextOrientation = 'HORIZONTAL' | 'VERTICAL_UP' | 'VERTICAL_DOWN'

export type Point2 = { x: number; y: number }
export type Segment2D = { a: Point2; b: Point2 }

/** A rectangle in source-native pixel coordinates. */
export type PixelBox = { x0: number; y0: number; x1: number; y1: number }

/**
 * How a printed number should be read as a length.
 *
 * The drawings mix conventions — a plan chain prints centimetres as a bare
 * integer, a section level prints metres with a decimal comma and a sign — and
 * which one applies is not knowable from the token alone (§9). Both are kept
 * until something decides.
 */
export type UnitInterpretation = 'CENTIMETRES' | 'MILLIMETRES' | 'METRES' | 'METRES_SIGNED'

export type ValueCandidate = {
  /** The token exactly as read. */
  text: string
  /** Metres implied by `interpretation`. */
  metres: number
  interpretation: UnitInterpretation
  /** Product of glyph confidences and grammar plausibility, 0..1. */
  confidence: number
}

/** One recognised text token with everything needed to audit the reading. */
export type TextCandidate = {
  text: string
  /** Per-glyph confidence, same length as `text`. */
  glyphConfidence: number[]
  confidence: number
  /** Boxes of the individual glyphs, in source-native pixels. */
  tokenBoxes: PixelBox[]
  box: PixelBox
  orientation: TextOrientation
  /** Which recogniser produced this. */
  recogniser: string
}

export type TextRecognitionContext = {
  /** Source-native pixels per metre for the asset, when known. */
  pixelsPerMetre: number | null
  orientation: TextOrientation
  /** Value the drawing's geometry predicts for this label, metres. */
  predictedMetres: number | null
  /** Fractional tolerance on `predictedMetres`. */
  predictionTolerance: number
  /** What kind of annotation this is, which constrains the grammar. */
  kind: DimensionLabelKind
  /** Italic slant of the drawing's text, radians; 0 for upright. */
  slantRad: number
}

export type DimensionLabelKind =
  | 'CHAIN_SEGMENT'
  | 'CHAIN_OVERALL'
  | 'ROOM_RUN'
  | 'OPENING_CALLOUT_WIDTH'
  | 'OPENING_CALLOUT_HEIGHT'
  | 'LEVEL_MARKER'
  | 'ANGLE'
  | 'FREE'

/** An anchor a dimension is measured from or to. */
export type DimensionAnchor = {
  id: string
  /** Position along the chain baseline, source-native pixels. */
  at: Point2
  /** How the anchor was found. */
  evidence: 'TICK' | 'EXTENSION_LINE' | 'BASELINE_END'
  /** Physical feature this anchor sits on, once associated (§12). */
  association?: PhysicalAssociation
}

/** What a dimension anchor or value physically refers to (§12). */
export type PhysicalAssociation = {
  kind:
    | 'WALL_FACE'
    | 'WALL_AXIS'
    | 'OPENING_JAMB'
    | 'OPENING'
    | 'MASS_CORNER'
    | 'ROOM_BOUNDARY'
    | 'FLOOR_LEVEL'
    | 'SLAB_LEVEL'
    | 'RIDGE'
    | 'EAVE'
    | 'TERRAIN'
    | 'BALCONY_LEVEL'
  /** Identifier of the referenced element where one exists. */
  targetId?: string
  /** Distance from the anchor to the feature it was matched to, metres. */
  residualM: number
  confidence: number
  note?: string
}

export type DimensionSegment = {
  id: string
  startAnchorId: string
  endAnchorId: string
  /** Baseline length in source-native pixels. */
  lengthPx: number
  /** Every reading offered for this segment's label. */
  candidates: ValueCandidate[]
  /** The reading the solver settled on, metres; null when unresolved. */
  metres: number | null
  fidelity: MetricFidelity
  /** What this segment measures, once associated. */
  association?: PhysicalAssociation
  /** Why a candidate was rejected, for the audit. */
  rejections: string[]
  confidence: number
}

export type DimensionObservation = {
  candidates: ValueCandidate[]
  metres: number | null
  lengthPx: number
  fidelity: MetricFidelity
}

export type DimensionChain = {
  id: string
  orientation: 'HORIZONTAL' | 'VERTICAL' | 'OTHER'
  baseline: Segment2D
  anchors: DimensionAnchor[]
  segments: DimensionSegment[]
  /** The overall dimension printed for the whole chain, where one exists. */
  overall?: DimensionObservation
  sourceAssetId: string
  /** Residual of (sum of segments − overall), metres; null when not checkable. */
  closureResidualM: number | null
  closes: boolean
  confidence: number
}

/**
 * Metric fidelity classes (§14).
 *
 * Only `SOURCE_EXACT` and `SOURCE_CORROBORATED` are allowed to act as exact
 * or hard metric constraints. The gap between those two and `SOURCE_DERIVED`
 * is the whole point of WEB-02: a printed number that was read *and* placed is
 * a different kind of fact from a number a solver reconstructed.
 */
export type MetricFidelity =
  | 'SOURCE_EXACT'
  | 'SOURCE_CORROBORATED'
  | 'SOURCE_DERIVED'
  | 'GEOMETRIC_INFERRED'
  | 'VISUAL_INFERRED'
  | 'ASSUMED'
  | 'UNRESOLVED'

export const FIDELITY_RANK: Record<MetricFidelity, number> = {
  SOURCE_EXACT: 6,
  SOURCE_CORROBORATED: 5,
  SOURCE_DERIVED: 4,
  GEOMETRIC_INFERRED: 3,
  VISUAL_INFERRED: 2,
  ASSUMED: 1,
  UNRESOLVED: 0,
}

/** Fidelity classes that may act as an exact/hard constraint (§14). */
export const EXACT_FIDELITIES: readonly MetricFidelity[] = ['SOURCE_EXACT', 'SOURCE_CORROBORATED']

export const isExactFidelity = (f: MetricFidelity): boolean => EXACT_FIDELITIES.includes(f)

/** An opening dimension read from a plan callout. */
export type OpeningCallout = {
  id: string
  sourceAssetId: string
  /** Centre of the callout marker, source-native pixels. */
  at: Point2
  /** Where the leader line lands, i.e. the opening it labels. */
  leaderEnd: Point2 | null
  widthCandidates: ValueCandidate[]
  heightCandidates: ValueCandidate[]
  widthM: number | null
  heightM: number | null
  fidelity: MetricFidelity
  association?: PhysicalAssociation
  confidence: number
}

/** A signed level annotation read from a section or elevation. */
export type LevelAnnotation = {
  id: string
  sourceAssetId: string
  at: Point2
  candidates: ValueCandidate[]
  /** Metres above the ±0.00 datum. */
  metres: number | null
  fidelity: MetricFidelity
  association?: PhysicalAssociation
  confidence: number
}
