/**
 * The text-recognition seam Stage 06 owns — STAGE WEB-PIVOT-06 §6.
 *
 * Stage 06 reads numbers off technical drawings, and the honest finding of the
 * previous stages is that the hand-authored glyph recogniser does not do it:
 * measured on project A's two dimensioned plans it names three tokens on one
 * and two on the other, and none of the five is a number the drawing prints.
 * The response is not more glyph prototypes. It is to put a mature recogniser
 * behind an interface this codebase owns.
 *
 * What the interface is for:
 *
 *   - the portable contracts depend on *this* file and never on a library, so
 *     an Android port swaps the implementation and keeps the pipeline;
 *   - an engine is handed crops the *geometry* chose (§7). It is never asked
 *     what is on the drawing, only what is written in a box something else
 *     decided is a label. An OCR engine is an adapter, not geometry authority;
 *   - engines are batched, because a process-backed engine costs far more per
 *     call than per crop: 145 crops cost 2.6 s in one call and 20 s in 145;
 *   - every reading carries the engine that made it and a confidence, so a
 *     disagreement between two engines stays visible instead of being averaged.
 *
 * No implementation here may reach the network. Remote OCR and remote LLM
 * recognition are forbidden at runtime, whatever the accuracy.
 *
 * PORT_DIRECT (Kotlin) for the interface. Implementations are
 * PORT_WITH_ADAPTER.
 */
import type { GrayImage } from '../contracts/raster.js'
import type { PixelBox, TextOrientation } from '../dimensions/contracts.js'

/** One box the geometry stage wants read, already conditioned and upright. */
export type PlanTextCrop = {
  /** Stable within one call; the engine echoes it back on every reading. */
  id: string
  /** Upright, paper-light/ink-dark pixels. */
  gray: GrayImage
  /** Where the crop came from, in source-native pixels. */
  sourceBox: PixelBox
  /** How the crop was rotated to become upright. */
  orientation: TextOrientation
  /**
   * Scale applied to `gray` relative to `sourceBox`, so a reading's box can be
   * mapped back to the drawing.
   */
  scale: number
}

export type PlanTextReading = {
  cropId: string
  /** The token exactly as the engine returned it, whitespace stripped. */
  text: string
  /** 0..1. Engines that report no confidence must return 0, never 1. */
  confidence: number
  /** Box within the crop's own pixels; null when the engine gives no box. */
  boxInCrop: PixelBox | null
  /** Which engine produced this. */
  engineId: string
}

export type PlanTextOptions = {
  /**
   * Characters the engine may return. Empty means "no restriction".
   *
   * Plan dimension text is digits and a small set of separators, and saying so
   * is not a drawing-specific rule: it is what the *kind* of annotation admits.
   */
  alphabet: string
  /** Treat each crop as one line of text rather than a block. */
  singleLine: boolean
}

export const DEFAULT_PLAN_TEXT: PlanTextOptions = {
  alphabet: '0123456789',
  singleLine: true,
}

export interface PlanTextEngine {
  /** Stable identifier recorded on every reading and in the audit. */
  readonly id: string
  /** `BUILT_IN` needs nothing installed; `LOCAL_LIBRARY` wraps a local engine. */
  readonly kind: 'BUILT_IN' | 'LOCAL_LIBRARY'
  /** Whatever identifies the engine build, for the freeze record. */
  readonly version: string
  /**
   * Read every crop. Implementations must be deterministic for the same input
   * and must never reach the network.
   */
  readBatch(crops: readonly PlanTextCrop[], opts: PlanTextOptions): PlanTextReading[]
}

/** Availability of an engine in this environment, for the audit. */
export type EngineAvailability = {
  engineId: string
  available: boolean
  version: string
  /** Why it is unavailable, when it is. */
  note: string
}
