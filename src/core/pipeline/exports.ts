/**
 * Portable exports (§46).
 *
 * Eight JSON documents, all plain data with no class instances, no NaN and no
 * Infinity, and every float rounded — so a re-run over the same assets produces
 * byte-identical files (§48 determinism) and the JVM port can consume them
 * without a bespoke reader.
 *
 * Schemas are documented in docs/SCHEMAS.md.
 */
import type { AnalyzeResult } from './analyze.js'
import type { EvidenceGraphData } from '../contracts/evidence.js'
import type { BuildingHypothesis } from '../contracts/hypotheses.js'
import { round } from '../math/vec.js'
import { canonicalJson, hashObject } from '../util/hash.js'
import { boundsOf, polygonArea } from '../contracts/geometry.js'
import { REFERENCE_WEIGHT } from '../config/weights.js'

const SCHEMA_VERSION = '1.0.0'

/** Recursively round floats so exports do not carry last-bit noise. */
function clean<T>(value: T, decimals = 5): T {
  const walk = (v: unknown): unknown => {
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) return null
      return round(v, decimals)
    }
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {}
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        out[k] = walk((v as Record<string, unknown>)[k])
      }
      return out
    }
    return v
  }
  return walk(value) as T
}

export type ExportBundle = {
  'source-package.json': unknown
  'evidence-graph.json': EvidenceGraphData
  'camera-hypotheses.json': unknown
  'building-hypotheses.json': unknown
  'resolved-building-geometry.json': unknown
  'self-verification.json': unknown
  'repair-trace.json': unknown
  'benchmark-summary.json': unknown
  'metric-audit.json': unknown
}

/**
 * Resolved geometry: the deliverable. Explicit units and coordinate frames on
 * every field, because a consumer on another platform cannot ask.
 */
export function resolvedGeometry(h: BuildingHypothesis): unknown {
  const bounds = boundsOf(h.masses.flatMap((m) => m.footprint.outer))
  return {
    schemaVersion: SCHEMA_VERSION,
    units: { length: 'metre', angle: 'degree', area: 'square metre' },
    frame: {
      world: 'right-handed, +X east, +Y up, +Z south; origin at the footprint front-left corner at finished floor level',
      plan: 'the world XZ plane; Vec2 fields are named x and z',
      facade: '+s left-to-right seen from outside the facade, +t up',
    },
    plinthY: h.plinthY,
    wallThicknessM: h.wallThicknessM,
    footprintAreaM2: h.masses.reduce((s, m) => s + Math.abs(polygonArea(m.footprint.outer)), 0),
    boundingBox: bounds,
    storeys: h.storeys,
    masses: h.masses.map((m) => ({
      id: m.id,
      kind: m.kind,
      baseY: m.baseY,
      topY: m.topY,
      areaM2: Math.abs(polygonArea(m.footprint.outer)),
      footprint: m.footprint,
      authority: m.authority,
      confidence: m.confidence,
    })),
    roofs: h.roofs,
    openingGroups: h.openingGroups,
    openings: h.openings,
    appearance: h.appearance,
    constraints: h.constraints,
  }
}

export function buildExports(result: AnalyzeResult): ExportBundle {
  const sourcePackage = {
    schemaVersion: SCHEMA_VERSION,
    identity: result.pkg.identity,
    facts: result.pkg.facts,
    rooms: result.pkg.rooms,
    assets: result.pkg.assets.map((a) => ({
      ...a,
      projection: result.analysed.find((x) => x.asset.id === a.id)?.projection.type ?? 'UNKNOWN',
      projectionConfidence: result.analysed.find((x) => x.asset.id === a.id)?.projection.confidence ?? 0,
      projectionContradiction: result.analysed.find((x) => x.asset.id === a.id)?.projection.contradiction ?? null,
    })),
    notes: result.pkg.notes,
    warnings: result.pkg.warnings,
  }

  const cameraHypotheses = {
    schemaVersion: SCHEMA_VERSION,
    views: result.views.map((v) => ({
      assetId: v.assetId,
      role: v.role,
      ambiguity: {
        ambiguous: v.ambiguity.ambiguous,
        fovDistanceDegenerate: v.ambiguity.fovDistanceDegenerate,
        fovSpreadDeg: v.ambiguity.fovSpreadDeg,
        distanceSpreadM: v.ambiguity.distanceSpreadM,
        azimuthSpreadDeg: v.ambiguity.azimuthSpreadDeg,
        groupId: v.ambiguity.groupId,
        notes: v.ambiguity.notes,
      },
      evaluations: v.evaluations,
      elapsedMs: 0,
      hypotheses: v.hypotheses,
      notes: v.notes,
    })),
  }

  const buildingHypotheses = {
    schemaVersion: SCHEMA_VERSION,
    base: result.baseHypothesis,
    resolvedId: result.resolved.id,
    scaffold: {
      footprint: result.scaffold.footprint,
      footprintAreaM2: result.scaffold.footprintAreaM2,
      widthM: result.scaffold.widthM,
      depthM: result.scaffold.depthM,
      ridgeY: result.scaffold.ridgeY,
      eaveY: result.scaffold.eaveY,
      plinthY: result.scaffold.plinthY,
      roofPitchDeg: result.scaffold.roofPitchDeg,
      kneeWallM: result.scaffold.kneeWallM,
      wallThicknessM: result.scaffold.wallThicknessM,
      levels: result.scaffold.levels,
      confidence: result.scaffold.confidence,
      notes: result.scaffold.notes,
    },
  }

  const selfVerification = {
    schemaVersion: SCHEMA_VERSION,
    referenceWeight: REFERENCE_WEIGHT,
    freeze: result.freeze,
    hardConstraintsSatisfied: result.finalScore.hardConstraintsSatisfied,
    constraintChecks: result.finalScore.constraintChecks,
    score: {
      base: result.baseScore.total,
      final: result.finalScore.total,
      metric: result.finalScore.metric,
      plan: result.finalScore.plan,
      section: result.finalScore.section,
      elevation: result.finalScore.elevation,
      perspective: result.finalScore.perspective,
    },
    elevationScores: result.finalScore.elevationScores,
    viewScores: result.finalScore.viewScores,
    cameraConfidence: result.views.map((v) => ({
      assetId: v.assetId,
      role: v.role,
      best: v.hypotheses[0]?.confidenceClass ?? 'CAMERA_UNRESOLVED',
      anchorMatches: v.hypotheses[0]?.anchorMatches.length ?? 0,
      meanAnchorResidualPx: v.anchors.meanResidualPx,
      unmatchedVisible: v.anchors.unmatchedVisible.length,
      notVisible: v.anchors.notVisible.length,
    })),
    evidence: result.graph.summary(),
    notes: result.notes,
  }

  const repairTrace = {
    schemaVersion: SCHEMA_VERSION,
    entries: result.repairTrace,
    accepted: result.repairTrace.filter((t) => t.accepted).length,
    rejected: result.repairTrace.filter((t) => !t.accepted).length,
  }

  const benchmarkSummary = {
    schemaVersion: SCHEMA_VERSION,
    project: result.pkg.identity.projectCode,
    name: result.pkg.identity.name,
    performance: result.performance,
    assetCount: result.pkg.assets.length,
    analysedCount: result.analysed.length,
    scores: {
      base: result.baseScore.total,
      final: result.finalScore.total,
      elevation: result.finalScore.elevation,
      perspective: result.finalScore.perspective,
    },
    freeze: result.freeze,
  }

  const metricAudit = {
    schemaVersion: SCHEMA_VERSION,
    entries: result.audit.entries,
    summary: result.audit.summary,
    conflicts: result.audit.conflicts,
    printedDimensions: [...result.dimensionReadings.entries()].map(([assetId, reading]) => ({
      assetId,
      solvedScalePxPerM: reading.solvedScale,
      identifiedDigits: reading.identifiedDigits,
      dimensions: reading.dimensions,
      chains: reading.chains.map((c) => ({
        axis: c.axis,
        positionPx: c.positionPx,
        sumM: c.sumM,
        overallM: c.overallM,
        closes: c.closes,
        partCount: c.parts.length,
      })),
      callouts: reading.callouts,
      notes: reading.notes,
    })),
  }

  return clean({
    'source-package.json': sourcePackage,
    'evidence-graph.json': result.graph.toJSON(),
    'camera-hypotheses.json': cameraHypotheses,
    'building-hypotheses.json': buildingHypotheses,
    'resolved-building-geometry.json': resolvedGeometry(result.resolved),
    'self-verification.json': selfVerification,
    'repair-trace.json': repairTrace,
    'benchmark-summary.json': benchmarkSummary,
    'metric-audit.json': metricAudit,
  })
}

/**
 * Fields that legitimately differ between two runs over identical assets:
 * wall-clock measurements. Everything else must be byte-identical (§48).
 */
export const NON_DETERMINISTIC_KEYS: ReadonlySet<string> = new Set([
  'totalMs',
  'assetAnalysisMs',
  'scaffoldMs',
  'cameraFitMs',
  'repairMs',
  'elapsedMs',
  'fetchedAt',
  'frozenAt',
])

/** Strip timing fields so two runs can be compared for determinism. */
export function stripNonDeterministic<T>(value: T): T {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {}
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        if (NON_DETERMINISTIC_KEYS.has(k)) continue
        out[k] = walk((v as Record<string, unknown>)[k])
      }
      return out
    }
    return v
  }
  return walk(value) as T
}

/**
 * Stable digest of an export bundle, used by the determinism test. Timing
 * fields are excluded — they measure the machine, not the analysis.
 */
export const bundleHash = (bundle: ExportBundle): string => hashObject(stripNonDeterministic(bundle))

export const serialiseBundle = (bundle: ExportBundle): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(bundle)) out[name] = `${canonicalJson(value)}\n`
  return out
}
