/**
 * Room labels as evidence — STAGE WEB-PIVOT-06A §11, §12.
 *
 * A publisher issues each floor twice: once with the dimension chains on it,
 * and once with the room names and areas on it. The second copy knows
 * something the first does not — *how many spaces the source thinks there
 * are* — and that is exactly what is needed to tell an open-plan living room
 * and kitchen from a room the extraction failed to divide.
 *
 * §12 is strict about how far that evidence may go. A label may say that a
 * region the extraction returned holds two named spaces. It may not move a
 * wall, invent one, or decide where a boundary is. So nothing here returns
 * geometry: it returns *where labels are*, and the only thing done with that
 * is to record, as an unresolved question, that one region carries more than
 * one of them. §11 asks for exactly that — semantic subregions or unresolved
 * segmentation, never a wall nobody drew.
 *
 * ## Alignment
 *
 * The two copies are the same drawing, but a publisher lays each out on its
 * own page and they can sit a few pixels apart. The offset is *found*, by
 * sliding one drawing's wall material over the other's and taking the shift
 * that explains the most of it, and it is reported with how well it did. An
 * alignment that explains little is refused, and then there is no label
 * evidence rather than label evidence in the wrong place.
 *
 * PORT_DIRECT (Kotlin).
 */
import type { GrayImage } from '../contracts/raster.js'

export type RoomLabelOptions = {
  /** How far the two copies may sit apart, pixels. */
  maxShiftPx: number
  /** Step of the coarse pass before the shift is refined, pixels. */
  coarseStepPx: number
  /** Fraction of one copy's material the other must explain to be aligned. */
  minAgreement: number
  /** Text this close together is one label, metres. */
  labelGapM: number
  /** Ink runs shorter than this are noise, pixels. */
  minRunPx: number
  /** A label is at least this many separate strokes. */
  minStrokes: number
}

export const DEFAULT_ROOM_LABELS: RoomLabelOptions = {
  maxShiftPx: 24,
  coarseStepPx: 2,
  minAgreement: 0.6,
  labelGapM: 0.55,
  minRunPx: 2,
  minStrokes: 6,
}

export type LabelAlignment = {
  dx: number
  dy: number
  /** Fraction of the labelled copy's material the dimensioned copy explains. */
  agreement: number
  aligned: boolean
  why: string
}

/** A block of printed text on the area-labelled copy, in the *other* copy's pixels. */
export type RoomLabel = {
  id: string
  box: { x0: number; y0: number; x1: number; y1: number }
  centre: { x: number; y: number }
  /** How many separate strokes the block is made of. */
  strokes: number
}

/**
 * The shift that puts the area-labelled copy over the dimensioned one.
 *
 * Matched on *material* rather than on ink: the two copies differ precisely in
 * their annotation, so matching what they are annotated with would be matching
 * the thing that differs. The walls are the same building on both.
 */
export function alignLabelledPlan(
  dimensionedFabric: Uint8Array,
  labelledFabric: Uint8Array,
  width: number,
  height: number,
  opts: RoomLabelOptions = DEFAULT_ROOM_LABELS,
): LabelAlignment {
  const score = (dx: number, dy: number): number => {
    let hit = 0
    let total = 0
    // Every eighth pixel: the material is thousands of pixels and the answer
    // does not need all of them.
    for (let y = 0; y < height; y += 3) {
      for (let x = 0; x < width; x += 3) {
        if (labelledFabric[y * width + x] !== 1) continue
        total++
        const xx = x + dx
        const yy = y + dy
        if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue
        if (dimensionedFabric[yy * width + xx] === 1) hit++
      }
    }
    return total === 0 ? 0 : hit / total
  }
  let best = { dx: 0, dy: 0, agreement: score(0, 0) }
  const step = Math.max(1, opts.coarseStepPx)
  for (let dy = -opts.maxShiftPx; dy <= opts.maxShiftPx; dy += step) {
    for (let dx = -opts.maxShiftPx; dx <= opts.maxShiftPx; dx += step) {
      const a = score(dx, dy)
      if (a > best.agreement) best = { dx, dy, agreement: a }
    }
  }
  for (let dy = best.dy - step; dy <= best.dy + step; dy++) {
    for (let dx = best.dx - step; dx <= best.dx + step; dx++) {
      const a = score(dx, dy)
      if (a > best.agreement) best = { dx, dy, agreement: a }
    }
  }
  const aligned = best.agreement >= opts.minAgreement
  return {
    ...best,
    aligned,
    why: aligned
      ? `the two copies agree about ${(best.agreement * 100).toFixed(0)}% of the building's material at a shift of ${best.dx}, ${best.dy} px`
      : `the two copies agree about only ${(best.agreement * 100).toFixed(0)}% of the building's material at their best shift, which is not enough to place a label`,
  }
}

/**
 * Where the area-labelled copy prints its room labels.
 *
 * A label is a cluster of small strokes. What is *not* asked is what any of
 * them says: a name would need a recogniser with an alphabet this pipeline
 * does not have, and the question being answered — how many spaces the source
 * names inside this region — does not need one.
 */
export function findRoomLabels(
  labelled: GrayImage,
  dimensionedInk: Uint8Array,
  solid: number,
  alignment: LabelAlignment,
  pxPerCm: number,
  opts: RoomLabelOptions = DEFAULT_ROOM_LABELS,
): RoomLabel[] {
  if (!alignment.aligned) return []
  const { width, height, data } = labelled
  // The annotation, found by *difference*.
  //
  // The two copies are the same drawing: the same walls, the same joinery, the
  // same car in the same garage. What one has and the other does not is its
  // own annotation — chains on one, room names and areas on the other. So the
  // labels are the labelled copy's ink that the dimensioned copy has nothing
  // at. Asking instead for "ink that is not the building" returns every
  // worktop and every sanitary fitting as well, and they cluster into one
  // enormous block that means nothing.
  const mark = new Uint8Array(width * height)
  const slack = 1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (data[i] > solid) continue
      let shared = false
      for (let dy = -slack; dy <= slack && !shared; dy++) {
        for (let dx = -slack; dx <= slack; dx++) {
          const xx = x + dx + alignment.dx
          const yy = y + dy + alignment.dy
          if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue
          if (dimensionedInk[yy * width + xx] === 1) {
            shared = true
            break
          }
        }
      }
      if (!shared) mark[i] = 1
    }
  }

  // Strokes: eight-connected pieces of it, small enough to be a letter.
  const maxStrokePx = Math.max(4, Math.round(0.22 * 100 * pxPerCm))
  const seen = new Uint8Array(mark.length)
  type Stroke = { x0: number; y0: number; x1: number; y1: number; n: number }
  const strokes: Stroke[] = []
  const stack: number[] = []
  for (let seed = 0; seed < mark.length; seed++) {
    if (mark[seed] === 0 || seen[seed] === 1) continue
    stack.length = 0
    stack.push(seed)
    seen[seed] = 1
    let x0 = width
    let y0 = height
    let x1 = -1
    let y1 = -1
    let n = 0
    while (stack.length > 0) {
      const i = stack.pop()!
      const x = i % width
      const y = (i - x) / width
      n++
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx
          const yy = y + dy
          if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue
          const j = yy * width + xx
          if (mark[j] === 0 || seen[j] === 1) continue
          seen[j] = 1
          stack.push(j)
        }
      }
    }
    if (n < opts.minRunPx) continue
    if (x1 - x0 + 1 > maxStrokePx || y1 - y0 + 1 > maxStrokePx) continue
    strokes.push({ x0, y0, x1, y1, n })
  }

  // Labels: strokes near enough to each other to be one printed block.
  const gapPx = Math.max(3, opts.labelGapM * 100 * pxPerCm)
  const blocks: Array<{ x0: number; y0: number; x1: number; y1: number; strokes: number }> = []
  for (const s of strokes) {
    const near = blocks.find(
      (b) => s.x0 <= b.x1 + gapPx && s.x1 >= b.x0 - gapPx && s.y0 <= b.y1 + gapPx && s.y1 >= b.y0 - gapPx,
    )
    if (near) {
      near.x0 = Math.min(near.x0, s.x0)
      near.y0 = Math.min(near.y0, s.y0)
      near.x1 = Math.max(near.x1, s.x1)
      near.y1 = Math.max(near.y1, s.y1)
      near.strokes++
      continue
    }
    blocks.push({ x0: s.x0, y0: s.y0, x1: s.x1, y1: s.y1, strokes: 1 })
  }
  // Blocks touching each other after growing are one block; one pass of
  // merging is enough for text set on two lines.
  for (let pass = 0; pass < 2; pass++) {
    for (let i = blocks.length - 1; i >= 0; i--) {
      const b = blocks[i]
      const other = blocks.find(
        (o, j) =>
          j !== i && b.x0 <= o.x1 + gapPx && b.x1 >= o.x0 - gapPx && b.y0 <= o.y1 + gapPx && b.y1 >= o.y0 - gapPx,
      )
      if (!other) continue
      other.x0 = Math.min(other.x0, b.x0)
      other.y0 = Math.min(other.y0, b.y0)
      other.x1 = Math.max(other.x1, b.x1)
      other.y1 = Math.max(other.y1, b.y1)
      other.strokes += b.strokes
      blocks.splice(i, 1)
    }
  }

  return blocks
    .filter((b) => b.strokes >= opts.minStrokes)
    .map((b, i) => ({
      id: `lb${i}`,
      // In the *dimensioned* copy's pixels, which is where the geometry is.
      box: {
        x0: b.x0 + alignment.dx,
        y0: b.y0 + alignment.dy,
        x1: b.x1 + alignment.dx,
        y1: b.y1 + alignment.dy,
      },
      centre: {
        x: (b.x0 + b.x1) / 2 + alignment.dx,
        y: (b.y0 + b.y1) / 2 + alignment.dy,
      },
      strokes: b.strokes,
    }))
}
