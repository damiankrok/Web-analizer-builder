/**
 * Conditioning a section's annotation for a recogniser — §8.
 *
 * §8 is emphatic that this stage must not start a second OCR project, and it
 * does not: the engine is the Stage-06 `PlanTextEngine` seam, the crop
 * pipeline is Stage 06's `text-crops.ts`, and no glyph prototype is authored
 * anywhere in Stage 07. What is new is only the *preparation*, which §8
 * explicitly allows to differ by source type, and which differs in two ways.
 *
 * **The alphabet.** A plan's dimension chain is digits. A section's level
 * marker is a signed decimal — `+7,95`, `±0,00`, `-0,32` — and a pitch callout
 * carries a degree sign. Reading a level with a digits-only whitelist throws
 * away the sign, which is the difference between a terrace and a basement.
 *
 * **The padding.** A level figure's sign is a short component, and the text
 * grouper that found the run does not always take it in: the run's box can
 * start at the `7` of `+7,95`. Padding the crop recovers it — but the padding
 * that recovers one marker's sign is not the padding that reads another's
 * digits best, and measured on project A no single value reads all five. So
 * the crop is offered at several paddings and every reading is kept. Choosing
 * between them is not this module's business and not the recogniser's: it is
 * the datum solver's, which has the one thing that can actually decide, namely
 * whether a reading fits the rest of the drawing.
 *
 * PORT_DIRECT (Kotlin).
 */
import type { PixelBox } from '../dimensions/contracts.js'
import type { SectionAnnotation } from './section-annotations.js'
import type { TextCropRequest } from './text-crops.js'
import type { PlanTextOptions, PlanTextReading } from './text-engine.js'

export type SectionReadOptions = {
  /**
   * Paddings a figure is offered at, in text heights. Zero is the box the
   * geometry chose; the rest widen it.
   */
  paddingLadder: number[]
  /** How much of the horizontal padding is also applied vertically. */
  verticalPaddingShare: number
  /** Characters a level marker may contain. */
  levelAlphabet: string
  /** Characters a pitch callout may contain. */
  pitchAlphabet: string
  /** Characters a vertical dimension chain may contain. */
  chainAlphabet: string
}

export const DEFAULT_SECTION_READ: SectionReadOptions = {
  paddingLadder: [0, 0.5, 1.0, 1.5],
  verticalPaddingShare: 0.3,
  // `±` is one character in the whitelist and one glyph on the drawing, and it
  // is the only mark that names the datum.
  levelAlphabet: '0123456789,.+-±',
  pitchAlphabet: '0123456789,.°',
  chainAlphabet: '0123456789',
}

/** `<annotationId>#<padding>`; the padding is recovered by `conditioningOf`. */
export const cropIdFor = (annotationId: string, padding: number): string => `${annotationId}#${padding}`

export const annotationIdOf = (cropId: string): string => cropId.slice(0, cropId.lastIndexOf('#'))

export const conditioningOf = (cropId: string): string => {
  const pad = cropId.slice(cropId.lastIndexOf('#') + 1)
  return pad === '0' ? 'the box the geometry chose' : `${pad} text-heights of paper around it`
}

const padBox = (box: PixelBox, padX: number, padY: number): PixelBox => ({
  x0: box.x0 - padX,
  y0: box.y0 - padY,
  x1: box.x1 + padX,
  y1: box.y1 + padY,
})

/** Every crop the ladder asks for, over the annotations of one kind. */
export function sectionCropRequests(
  annotations: readonly SectionAnnotation[],
  opts: SectionReadOptions = DEFAULT_SECTION_READ,
): TextCropRequest[] {
  const out: TextCropRequest[] = []
  for (const a of annotations) {
    for (const pad of opts.paddingLadder) {
      const px = a.textHeightPx * pad
      out.push({
        id: cropIdFor(a.id, pad),
        box: padBox(a.box, px, px * opts.verticalPaddingShare),
        orientation: a.orientation,
      })
    }
  }
  return out
}

/** Readings grouped back onto the annotation they came from. */
export function groupByAnnotation(
  readings: readonly PlanTextReading[],
): Map<string, Array<{ reading: PlanTextReading; conditioning: string }>> {
  const out = new Map<string, Array<{ reading: PlanTextReading; conditioning: string }>>()
  for (const reading of readings) {
    const id = annotationIdOf(reading.cropId)
    const list = out.get(id) ?? []
    list.push({ reading, conditioning: conditioningOf(reading.cropId) })
    out.set(id, list)
  }
  return out
}

export const levelTextOptions = (opts: SectionReadOptions = DEFAULT_SECTION_READ): PlanTextOptions => ({
  alphabet: opts.levelAlphabet,
  singleLine: true,
})
export const pitchTextOptions = (opts: SectionReadOptions = DEFAULT_SECTION_READ): PlanTextOptions => ({
  alphabet: opts.pitchAlphabet,
  singleLine: true,
})
export const chainTextOptions = (opts: SectionReadOptions = DEFAULT_SECTION_READ): PlanTextOptions => ({
  alphabet: opts.chainAlphabet,
  singleLine: true,
})
