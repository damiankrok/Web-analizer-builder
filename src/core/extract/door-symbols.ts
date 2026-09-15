/**
 * Doors, read from the symbol rather than inferred from a hole — STAGE
 * WEB-PIVOT-06A §4-§8.
 *
 * Stage 06 found doorways only as a by-product: where two wall fragments left
 * a gap of a plausible width, the gap was called a doorway. That gets the easy
 * ones and misses the ones that matter. A 0.8 m door in a 1.1 m partition
 * leaves two stubs of 0.16 m, neither long enough to be claimed as a wall, so
 * there are no fragments, no gap between them, and no doorway — and the two
 * rooms either side come back as one region. §4 is explicit about the fix: look
 * for the door.
 *
 * ## What a door looks like
 *
 * A published plan draws a hinged door as a symbol with three parts that
 * constrain each other:
 *
 *   - a **hinge** on one jamb of the opening;
 *   - a **leaf** — a thin line from the hinge, drawn in the open position, as
 *     long as the opening is wide;
 *   - a **swing arc** from the free end of the leaf back to the other jamb.
 *
 * The three are not independent. The arc's centre *is* the hinge, its radius
 * *is* the leaf's length, and its two ends are the leaf's tip and the far
 * jamb. That redundancy is what makes the symbol findable without a trained
 * model: a hypothesis has to explain all of it at once, and a curved piece of
 * furniture or a decorative flourish does not.
 *
 * ## Why not a Hough transform over the sheet
 *
 * §6 forbids leaning on one global threshold, and the reason is visible on any
 * two projects: the number of votes a real arc collects depends on the export
 * size, the compression and how much of the arc the publisher's line weight
 * survives. A cut chosen on one drawing is a cut chosen on one drawing.
 *
 * What is done instead is propose-then-verify, bounded to one symbol at a
 * time. The thin line work is separated from the wall fabric, split into
 * connected pieces, and only pieces the size of a door are examined. Within
 * one piece a centre is searched for over its own bounding box — a few
 * thousand candidates, not a sheet-wide accumulator — and whatever the search
 * proposes must then survive an explicit geometric test: the radius is a door
 * width in *metres*, the inked points cover a contiguous angular span a swing
 * could be, they sit on the fitted circle rather than near it, and the opening
 * the hypothesis implies is actually free of material. Nothing is accepted for
 * having many votes.
 *
 * ## What it refuses to say
 *
 * Every door found here is evidence *about* an opening, never the opening
 * itself. Nothing in this file decides room topology, merges a wall or moves a
 * face; it produces observations, and §8's classifier decides what, if
 * anything, they mean. Where the evidence is partial the observation says
 * which part is missing, and where there is no evidence there is no door.
 *
 * No remote model of any kind, at runtime or otherwise (§4).
 *
 * PORT_DIRECT (Kotlin).
 */
import type { GrayImage } from '../contracts/raster.js'
import { solidThreshold } from './wall-bands.js'

export type DoorSymbolOptions = {
  /**
   * How much darker than its immediate surroundings a stroke must be, 0..255.
   *
   * The same argument as the dimension-line detector: a hairline drawn over a
   * tinted room is not dark in absolute terms, it is dark *for where it is*.
   */
  thinContrast: number
  /** Half-width of the window a stroke is compared against, pixels. */
  thinRadiusPx: number
  /** Door widths admitted, metres. A swing radius is a door width. */
  minWidthM: number
  maxWidthM: number
  /** Angular span a swing arc must cover, degrees. */
  minArcSpanDeg: number
  maxArcSpanDeg: number
  /** Fraction of the accepted span that must actually carry ink. */
  minArcCoverage: number
  /** How far an arc's points may sit from its own circle, as a fraction of r. */
  arcResidualFraction: number
  /** Line work that may be missing from a swing before it is two arcs, pixels. */
  arcGapPx: number
  /** Fraction of the leaf's length that must carry ink. */
  minLeafCoverage: number
  /** Largest thin-ink piece still worth examining, as a multiple of r². */
  maxPieceArea: number
  /** Points sampled from one piece when searching for a centre. */
  maxSamplePoints: number
  /** Centres verified in full, per piece. */
  verifiedCentres: number
  /** How far a door's own axis may sit from the sheet's axes, degrees. */
  axisToleranceDeg: number
  /** How far the two jambs of one opening may disagree, metres. */
  jambAgreementM: number
  /** How far a hinge may sit from the wall it is hung on, metres. */
  hingeToWallM: number
  /** How far beyond an opening's end a jamb is looked for, metres. */
  jambSearchM: number
  /** How far a jamb must carry on along its own line, metres. */
  minJambRunM: number
  /** Fraction of the floor a leaf sweeps that may carry material. */
  maxSweptBlocked: number
  /** How far the swing and the opening between the jambs may disagree, metres. */
  widthAgreementM: number
  /** How far a leaf's points may sit off its own line, pixels. */
  leafResidualPx: number
  /** How far a bare leaf must lie from its wall's own direction, degrees. */
  minLeafToWallDeg: number
  /** Fraction of the implied opening that may carry material and still open. */
  maxBlockedFraction: number
}

export const DEFAULT_DOOR_SYMBOLS: DoorSymbolOptions = {
  thinContrast: 30,
  thinRadiusPx: 3,
  minWidthM: 0.5,
  maxWidthM: 1.6,
  minArcSpanDeg: 35,
  maxArcSpanDeg: 150,
  minArcCoverage: 0.5,
  arcResidualFraction: 0.06,
  arcGapPx: 4,
  minLeafCoverage: 0.6,
  maxPieceArea: 1.6,
  maxSamplePoints: 400,
  verifiedCentres: 24,
  axisToleranceDeg: 18,
  jambAgreementM: 0.06,
  hingeToWallM: 0.16,
  jambSearchM: 0.14,
  minJambRunM: 0.12,
  maxSweptBlocked: 0.12,
  widthAgreementM: 0.28,
  leafResidualPx: 1.5,
  minLeafToWallDeg: 25,
  maxBlockedFraction: 0.35,
}

export type Point = { x: number; y: number }

/** A swing arc, with everything §6 requires a hypothesis to return. */
export type ArcEvidence = {
  centrePx: Point
  radiusPx: number
  /** Ends of the inked span, degrees, plan-right 0 and plan-down +90. */
  fromDeg: number
  toDeg: number
  spanDeg: number
  /** RMS distance of the inked points from the fitted circle, pixels. */
  residualPx: number
  /** Fraction of the span that carries ink. */
  coverage: number
  confidence: number
}

/** A door leaf, drawn open. */
export type LeafEvidence = {
  hingePx: Point
  tipPx: Point
  lengthPx: number
  directionDeg: number
  coverage: number
  confidence: number
}

export type DoorClassification =
  | 'SINGLE_HINGED'
  | 'DOUBLE_HINGED'
  | 'WEAK_ARC'
  | 'LEAF_ONLY'
  | 'ARC_ONLY'

export type DoorObservation = {
  id: string
  /** The drawing this was read from. */
  assetId: string
  hingePx: Point
  /** The axis the host wall runs along. */
  axis: 'X' | 'Y'
  /** The opening, along the host wall's own axis. */
  fromPx: number
  toPx: number
  widthPx: number
  widthM: number
  /** The swing's own radius, which a leaf fills. Evidence, not the opening. */
  swingRadiusM: number
  /** Across-coordinate of the wall line the hinge sits on. */
  atPx: number
  /** Thickness of the host wall, read at the two jambs, pixels. */
  thicknessPx: number
  /**
   * Which way the door opens, as a sign on the across-coordinate: −1 when the
   * leaf is drawn on the smaller side of the wall, +1 on the larger. It names
   * a side of the wall, not a room.
   */
  swingSide: -1 | 1
  arc: ArcEvidence | null
  leaf: LeafEvidence | null
  /** Material found beyond each end of the opening: the two jambs, metres. */
  jambM: { before: number; after: number }
  classification: DoorClassification
  confidence: number
  /** Each cue that was found, and each that was looked for and was not. */
  evidence: string[]
}

export type DoorDetection = {
  doors: DoorObservation[]
  /** Every swing arc the line work supports, door or not (§19). */
  arcs: ArcEvidence[]
  /** Every straight stroke that could be a leaf (§19). */
  leaves: LeafEvidence[]
  /** Every hypothesis that was examined and rejected, with the reason. */
  rejected: Array<{ atPx: Point; why: string }>
  notes: string[]
}

const deg = (rad: number): number => ((rad * 180) / Math.PI + 360) % 360

/** The four ways a wall can run on a drawing whose axes are the sheet's. */
const AXIS_DIRECTIONS: ReadonlyArray<{ axis: 'X' | 'Y'; sign: -1 | 1 }> = [
  { axis: 'X', sign: 1 },
  { axis: 'X', sign: -1 },
  { axis: 'Y', sign: 1 },
  { axis: 'Y', sign: -1 },
]

/** Degrees between two directions, 0..180. */
const angularDistance = (a: number, b: number): number => 180 - Math.abs(Math.abs(a - b) - 180)

/** Whether an inked span covers a direction, or stops within `slack` of it. */
const spanReaches = (fromDeg: number, spanDeg: number, atDeg: number, slack: number): boolean => {
  const offset = (atDeg - fromDeg + 360) % 360
  if (offset <= spanDeg - 1) return true
  return Math.min(offset - (spanDeg - 1), 360 - offset) <= slack
}

/**
 * The line work, separated from the fabric.
 *
 * Two statements, and both are about drawings rather than about one publisher.
 * A stroke is darker than what is immediately beside it — the directional
 * top-hat the dimension stage already relies on, here taken over a disc
 * because an arc has no one direction. And a wall is *thicker* than a stroke:
 * a plan draws its fabric at the thickness the wall has and its annotation at
 * a hairline, so eroding the ink by a hair leaves the fabric and removes the
 * line work, and taking it back out leaves exactly the fabric. A wall's own
 * edge answers the top-hat strongly and is removed with it, which is what
 * stops every wall face becoming a candidate arc.
 */
export type InkLayers = {
  /** Ink of any kind. */
  ink: Uint8Array
  /** Ink thick enough to be a wall: what survives an opening by one pixel. */
  fabric: Uint8Array
  /** The drawn line work: ink that is not fabric and is darker than beside it. */
  thin: Uint8Array
}

export function inkLayers(
  gray: GrayImage,
  solid: number,
  opts: DoorSymbolOptions = DEFAULT_DOOR_SYMBOLS,
): InkLayers {
  const { width, height, data } = gray
  const n = width * height
  const ink = new Uint8Array(n)
  for (let i = 0; i < n; i++) ink[i] = data[i] <= solid ? 1 : 0

  const pass = (src: Uint8Array, erodeIt: boolean): Uint8Array => {
    const out = new Uint8Array(n)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let v = erodeIt ? 1 : 0
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx
            const yy = y + dy
            const s = xx < 0 || yy < 0 || xx >= width || yy >= height ? 0 : src[yy * width + xx]
            if (erodeIt && s === 0) v = 0
            if (!erodeIt && s === 1) v = 1
          }
        }
        out[y * width + x] = v
      }
    }
    return out
  }
  // Opening by one pixel: what survives is a band at least three pixels
  // across, which on any sheet is fabric and not a drawn line.
  const fabric = pass(pass(ink, true), false)

  const r = Math.max(1, Math.round(opts.thinRadiusPx))
  const thin = new Uint8Array(n)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (fabric[i] === 1) continue
      const v = data[i]
      let background = 0
      for (let dy = -r; dy <= r; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= height) continue
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy > r * r) continue
          const xx = x + dx
          if (xx < 0 || xx >= width) continue
          const s = data[yy * width + xx]
          if (s > background) background = s
        }
      }
      if (background - v >= opts.thinContrast) thin[i] = 1
    }
  }
  return { ink, fabric, thin }
}

/** The line work alone; kept as its own entry point for the diagnostics. */
export const thinInkMask = (
  gray: GrayImage,
  solid: number,
  opts: DoorSymbolOptions = DEFAULT_DOOR_SYMBOLS,
): Uint8Array => inkLayers(gray, solid, opts).thin

type Piece = { points: Point[]; x0: number; y0: number; x1: number; y1: number }

/** Eight-connected pieces of the line work. */
function pieces(mask: Uint8Array, width: number, height: number): Piece[] {
  const seen = new Uint8Array(mask.length)
  const out: Piece[] = []
  const stack: number[] = []
  for (let seed = 0; seed < mask.length; seed++) {
    if (mask[seed] === 0 || seen[seed] === 1) continue
    stack.length = 0
    stack.push(seed)
    seen[seed] = 1
    const points: Point[] = []
    let x0 = width
    let y0 = height
    let x1 = -1
    let y1 = -1
    while (stack.length > 0) {
      const i = stack.pop()!
      const x = i % width
      const y = (i - x) / width
      points.push({ x, y })
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
          if (mask[j] === 0 || seen[j] === 1) continue
          seen[j] = 1
          stack.push(j)
        }
      }
    }
    out.push({ points, x0, y0, x1, y1 })
  }
  return out
}

/** At most `limit` points from a piece, chosen evenly so the shape survives. */
function sample(points: readonly Point[], limit: number): Point[] {
  if (points.length <= limit) return [...points]
  const step = points.length / limit
  const out: Point[] = []
  for (let i = 0; i < limit; i++) out.push(points[Math.floor(i * step)])
  return out
}

type ArcFit = {
  centre: Point
  radiusPx: number
  fromDeg: number
  toDeg: number
  spanDeg: number
  residualPx: number
  coverage: number
  inliers: number
}

/**
 * The best circle one piece of line work lies on, and how well it lies on it.
 *
 * The centre is searched for over the piece's own bounding box. That is the
 * bound that keeps this local: a swing arc's centre is its hinge, and the
 * hinge of a door whose leaf is drawn open is a corner of the symbol, so it
 * is inside the box the symbol occupies. Nothing outside one symbol is ever
 * considered, and there is no accumulator shared between symbols.
 */
function fitArcs(
  piece: Piece,
  rMinPx: number,
  rMaxPx: number,
  opts: DoorSymbolOptions,
): ArcFit[] {
  const pts = sample(piece.points, opts.maxSamplePoints)
  if (pts.length < 8) return []
  // The window a point may sit in and still be on the circle is a property of
  // *that* circle, not of the widest door admitted. Taking it from rMax lets a
  // straight stroke sixty pixels long look like a circle of every radius at
  // once, which is exactly the false positive §5 warns about.
  const windowFor = (r: number): number => Math.max(1, Math.round(r * opts.arcResidualFraction))

  // --- propose: how many of the piece's points lie on *some* circle about c
  type Cand = { cx: number; cy: number; r: number; score: number }
  const cands: Cand[] = []
  const bins = new Int32Array(Math.ceil(rMaxPx) + 2)
  for (let cy = piece.y0 - 2; cy <= piece.y1 + 2; cy++) {
    for (let cx = piece.x0 - 2; cx <= piece.x1 + 2; cx++) {
      bins.fill(0)
      for (const p of pts) {
        const d = Math.hypot(p.x - cx, p.y - cy)
        if (d < rMinPx || d > rMaxPx) continue
        bins[Math.round(d)]++
      }
      let best = 0
      let bestR = 0
      // A point a bin either side is still on the same circle, so the bins are
      // read in a window rather than singly — a window this circle's own size.
      for (let r = Math.ceil(rMinPx); r <= Math.floor(rMaxPx); r++) {
        const w = windowFor(r)
        let n = 0
        for (let k = -w; k <= w; k++) n += bins[r + k] ?? 0
        if (n > best) {
          best = n
          bestR = r
        }
      }
      if (best > 0) cands.push({ cx, cy, r: bestR, score: best })
    }
  }
  if (cands.length === 0) return []
  cands.sort((a, b) => b.score - a.score)

  // --- verify: only the strongest few, and each one geometrically
  const chosen: Cand[] = []
  for (const c of cands) {
    if (chosen.length >= opts.verifiedCentres) break
    // Non-maximum suppression, so the shortlist is several distinct
    // hypotheses rather than one hypothesis eight times.
    if (chosen.some((o) => Math.hypot(o.cx - c.cx, o.cy - c.cy) <= 3)) continue
    chosen.push(c)
  }

  const fits: ArcFit[] = []
  for (const c of chosen) {
    const on: Array<{ d: number; a: number }> = []
    for (const p of pts) {
      const d = Math.hypot(p.x - c.cx, p.y - c.cy)
      if (Math.abs(d - c.r) > windowFor(c.r)) continue
      on.push({ d, a: deg(Math.atan2(p.y - c.cy, p.x - c.cx)) })
    }
    if (on.length < 8) continue
    // The radius the inliers themselves imply, not the bin they fell in.
    const radiusPx = on.reduce((n, p) => n + p.d, 0) / on.length
    const residualPx = Math.sqrt(on.reduce((n, p) => n + (p.d - radiusPx) ** 2, 0) / on.length)
    if (residualPx > Math.max(0.8, radiusPx * opts.arcResidualFraction)) continue

    // The inked angular span, measured in degree bins so that a gap in the
    // line work is visible as a gap rather than averaged away.
    const filled = new Uint8Array(360)
    for (const p of on) filled[Math.round(p.a) % 360] = 1
    // The longest contiguous stretch, wrapping, with small gaps jumped. What
    // may be jumped is a few *pixels* of line work — a tile joint or a hatch
    // stroke crossing the swing — so the bound is stated there and converted,
    // rather than being a number of degrees that means different things on a
    // wide door and a narrow one.
    const maxGap = Math.max(3, Math.round(((opts.arcGapPx / Math.max(1, radiusPx)) * 180) / Math.PI))
    let bestFrom = -1
    let bestSpan = 0
    for (let start = 0; start < 360; start++) {
      if (filled[start] === 1 && filled[(start + 359) % 360] === 1) continue
      let gap = 0
      let span = 0
      for (let k = 0; k < 360; k++) {
        const a = (start + k) % 360
        if (filled[a] === 1) {
          gap = 0
          span = k + 1
          continue
        }
        gap++
        if (gap > maxGap) break
      }
      if (span > bestSpan) {
        bestSpan = span
        bestFrom = start
      }
    }
    if (bestFrom < 0 || bestSpan === 0) continue
    if (bestSpan < opts.minArcSpanDeg || bestSpan > opts.maxArcSpanDeg) continue
    let inked = 0
    for (let k = 0; k < bestSpan; k++) inked += filled[(bestFrom + k) % 360]
    const coverage = inked / bestSpan
    if (coverage < opts.minArcCoverage) continue

    fits.push({
      centre: { x: c.cx, y: c.cy },
      radiusPx,
      fromDeg: bestFrom,
      toDeg: (bestFrom + bestSpan - 1) % 360,
      spanDeg: bestSpan,
      residualPx,
      coverage,
      inliers: on.length,
    })
  }
  // Ordered by how much of a swing each explains. All of them are offered:
  // one piece of line work can hold more than one arc, and which of them is a
  // door is not something the ink alone can settle — the wall decides that.
  return fits.sort((a, b) => b.inliers * b.coverage - a.inliers * a.coverage)
}

/** How much of a straight run from `a` to `b` carries ink. */
function segmentCoverage(
  thin: Uint8Array,
  ink: Uint8Array,
  fabric: Uint8Array,
  width: number,
  height: number,
  a: Point,
  b: Point,
): number {
  const steps = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)))
  let hit = 0
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const x = Math.round(a.x + (b.x - a.x) * t)
    const y = Math.round(a.y + (b.y - a.y) * t)
    let found = false
    for (let dy = -1; dy <= 1 && !found; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx
        const yy = y + dy
        if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue
        const j = yy * width + xx
        // A leaf is a drawn line. Fabric is not a leaf: §18's case where a
        // doorway is filled in with wall must not read as a door that is
        // simply drawn shut.
        if (thin[j] === 1 || (ink[j] === 1 && fabric[j] === 0)) {
          found = true
          break
        }
      }
    }
    if (found) hit++
  }
  return hit / (steps + 1)
}

/** A straight line fitted to a piece, and how straight the piece is. */
function fitSegment(piece: Piece): { a: Point; b: Point; lengthPx: number; residualPx: number } | null {
  const pts = piece.points
  if (pts.length < 6) return null
  let sx = 0
  let sy = 0
  for (const p of pts) {
    sx += p.x
    sy += p.y
  }
  const mx = sx / pts.length
  const my = sy / pts.length
  let sxx = 0
  let syy = 0
  let sxy = 0
  for (const p of pts) {
    sxx += (p.x - mx) ** 2
    syy += (p.y - my) ** 2
    sxy += (p.x - mx) * (p.y - my)
  }
  // Principal direction of the point cloud; the residual across it is how far
  // the piece departs from being a line.
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy)
  const ux = Math.cos(theta)
  const uy = Math.sin(theta)
  let tMin = Infinity
  let tMax = -Infinity
  let across = 0
  for (const p of pts) {
    const t = (p.x - mx) * ux + (p.y - my) * uy
    const n = -(p.x - mx) * uy + (p.y - my) * ux
    across += n * n
    if (t < tMin) tMin = t
    if (t > tMax) tMax = t
  }
  return {
    a: { x: mx + ux * tMin, y: my + uy * tMin },
    b: { x: mx + ux * tMax, y: my + uy * tMax },
    lengthPx: tMax - tMin,
    residualPx: Math.sqrt(across / pts.length),
  }
}

/** A stretch of one wall line, at pixel resolution, with no material in it. */
export type WallLineGap = {
  axis: 'X' | 'Y'
  /** Across-coordinate of the line. */
  atPx: number
  thicknessPx: number
  /** The open stretch, along the wall's own axis. */
  fromPx: number
  toPx: number
}

/**
 * Every interruption in a wall line, found in the fabric itself.
 *
 * This is deliberately *not* the gap between two detected wall bands, and the
 * difference is the whole of §4's complaint about Stage 06. A band has to be
 * long enough to be claimed as a wall before it exists at all, so a 0.8 m door
 * in a 1.1 m partition — two stubs of 0.16 m — leaves no bands and therefore
 * no gap between them. Here the line is followed a pixel at a time and a stub
 * is as good as a wall for saying *this line carries on past the opening*,
 * which is the only thing being asked.
 *
 * Nothing about a door is decided here. What comes out is a list of places
 * where a wall stops and starts again on the same line at the same thickness;
 * whether a door hangs in any of them is settled by looking for one.
 */
export function wallLineGaps(
  fabric: Uint8Array,
  width: number,
  height: number,
  bounds: { minWallPx: number; maxWallPx: number; minGapPx: number; maxGapPx: number; collinearPx: number },
): WallLineGap[] {
  const out: WallLineGap[] = []
  for (const axis of ['X', 'Y'] as const) {
    const along = axis === 'X' ? width : height
    const across = axis === 'X' ? height : width
    type Line = { centre: number; thickness: number; segments: Array<{ from: number; to: number }> }
    const lines: Line[] = []
    for (let t = 0; t < along; t++) {
      // Cross-sections of the fabric at this position along the wall.
      let start = -1
      for (let c = 0; c <= across; c++) {
        const x = axis === 'X' ? t : c
        const y = axis === 'X' ? c : t
        const solidHere = c < across && fabric[y * width + x] === 1
        if (solidHere) {
          if (start < 0) start = c
          continue
        }
        if (start < 0) continue
        const thickness = c - start
        const centre = (start + c - 1) / 2
        start = -1
        if (thickness < bounds.minWallPx || thickness > bounds.maxWallPx) continue
        let line = lines.find(
          (l) =>
            Math.abs(l.centre - centre) <= bounds.collinearPx &&
            Math.abs(l.thickness - thickness) <= Math.max(2, bounds.collinearPx),
        )
        if (!line) {
          line = { centre, thickness, segments: [] }
          lines.push(line)
        }
        const last = line.segments[line.segments.length - 1]
        if (last && t - last.to <= 1) last.to = t
        else line.segments.push({ from: t, to: t })
      }
    }
    const solidAt = (t: number, c: number): boolean => {
      const x = axis === 'X' ? Math.round(t) : Math.round(c)
      const y = axis === 'X' ? Math.round(c) : Math.round(t)
      return x >= 0 && y >= 0 && x < width && y < height && fabric[y * width + x] === 1
    }
    for (const line of lines) {
      for (let i = 1; i < line.segments.length; i++) {
        const from = line.segments[i - 1].to + 1
        const to = line.segments[i].from - 1
        const length = to - from + 1
        if (length < bounds.minGapPx || length > bounds.maxGapPx) continue
        out.push({ axis, atPx: line.centre, thicknessPx: line.thickness, fromPx: from, toPx: to })
      }
      // A door at the end of a wall has no collinear jamb on its far side: the
      // wall it opens beside is the one crossing at right angles, which is
      // what a doorway beside a corner looks like on every plan. The stretch
      // between the wall's end and that crossing is an interruption too.
      for (const seg of line.segments) {
        for (const [edge, dir] of [
          [seg.from - 1, -1],
          [seg.to + 1, 1],
        ] as Array<[number, -1 | 1]>) {
          for (let k = 0; k <= bounds.maxGapPx; k++) {
            const t = edge + dir * k
            if (t < 0 || t >= along) break
            if (!solidAt(t, line.centre)) continue
            if (k < bounds.minGapPx) break
            const from = dir > 0 ? edge : t + 1
            const to = dir > 0 ? t - 1 : edge
            if (to - from + 1 < bounds.minGapPx) break
            out.push({ axis, atPx: line.centre, thicknessPx: line.thickness, fromPx: from, toPx: to })
            break
          }
        }
      }
    }
  }
  return out
}

/**
 * How much of a swing is actually drawn, starting from the closed position.
 *
 * The sweep begins where the leaf would be when the door is shut — along the
 * wall, towards the far jamb — and turns into the room. That is where a
 * publisher starts the arc, and starting there means the measurement is of
 * *this* door rather than of whatever else the circle passes through.
 */
function sweepArc(
  layers: InkLayers,
  width: number,
  height: number,
  centre: Point,
  radiusPx: number,
  startDeg: number,
  turn: -1 | 1,
  maxSpanDeg: number,
  tolPx: number,
): { spanDeg: number; coverage: number; residualPx: number; endDeg: number } {
  const step = Math.max(1, Math.round((1 / Math.max(1, radiusPx)) * 180 / Math.PI))
  let span = 0
  let inked = 0
  let gap = 0
  let sumSq = 0
  let counted = 0
  const maxGap = Math.max(3, Math.round(((4 / Math.max(1, radiusPx)) * 180) / Math.PI))
  for (let k = 0; k <= maxSpanDeg; k += step) {
    const a = ((startDeg + turn * k) * Math.PI) / 180
    let best: number | null = null
    for (let d = -tolPx; d <= tolPx; d += 0.5) {
      const x = Math.round(centre.x + (radiusPx + d) * Math.cos(a))
      const y = Math.round(centre.y + (radiusPx + d) * Math.sin(a))
      if (x < 0 || y < 0 || x >= width || y >= height) continue
      const i = y * width + x
      // A swing is drawn, not built. Ink that is thick enough to be fabric is
      // a wall, a run of joinery or a stair tread, and counting it as arc
      // would let the drawing's solid parts stand in for a symbol nobody drew.
      if (layers.thin[i] !== 1 && !(layers.ink[i] === 1 && layers.fabric[i] === 0)) continue
      if (best === null || Math.abs(d) < Math.abs(best)) best = d
    }
    if (best === null) {
      gap += step
      if (gap > maxGap) break
      continue
    }
    gap = 0
    span = k
    inked += step
    sumSq += best * best
    counted++
  }
  return {
    spanDeg: span,
    coverage: span === 0 ? 0 : Math.min(1, inked / (span + step)),
    residualPx: counted === 0 ? tolPx : Math.sqrt(sumSq / counted),
    endDeg: (((startDeg + turn * span) % 360) + 360) % 360,
  }
}

/**
 * Every door symbol on one drawing.
 *
 * `pxPerCm` is what the dimension chains established. Without it a radius
 * cannot be tested as a door width in metres, and a radius that cannot be
 * tested in metres is not evidence of a door, so nothing is returned rather
 * than something being guessed.
 */
export function detectDoorSymbols(
  gray: GrayImage,
  pxPerCm: number | null,
  assetId: string,
  solidFraction: number,
  opts: DoorSymbolOptions = DEFAULT_DOOR_SYMBOLS,
  wall: { minThicknessM: number; maxThicknessM: number } = { minThicknessM: 0.05, maxThicknessM: 0.8 },
): DoorDetection {
  if (pxPerCm === null || pxPerCm <= 0) {
    return {
      doors: [],
      arcs: [],
      leaves: [],
      rejected: [],
      notes: ['no scale was established, so no swing radius can be tested as a door width and no door is claimed'],
    }
  }
  const { width, height } = gray
  const solid = solidThreshold(gray, solidFraction)
  const { thin, fabric, ink } = inkLayers(gray, solid, opts)
  const rMinPx = opts.minWidthM * 100 * pxPerCm
  const rMaxPx = opts.maxWidthM * 100 * pxPerCm
  const minWallPx = Math.max(2, wall.minThicknessM * 100 * pxPerCm)
  const maxWallPx = Math.max(minWallPx + 1, wall.maxThicknessM * 100 * pxPerCm)
  const hingeReachPx = Math.max(2, Math.round(opts.hingeToWallM * 100 * pxPerCm))
  const collinearPx = Math.max(1.5, opts.jambAgreementM * 100 * pxPerCm)
  const jambSearchPx = Math.max(2, Math.round(opts.jambSearchM * 100 * pxPerCm))
  const minJambRunPx = Math.max(2, Math.round(opts.minJambRunM * 100 * pxPerCm))

  const at = (x: number, y: number, m: Uint8Array): boolean =>
    x >= 0 && y >= 0 && x < width && y < height && m[y * width + x] === 1

  /**
   * The wall a door would be hung in, read across the line just beyond the
   * opening.
   *
   * This is the cue that separates a swing from a garden table, a planting
   * circle, a stair nosing or the round part of a letter. All of those are
   * arcs of a door's radius drawn in open space; none of them has a *band of
   * fabric* carrying on past both ends of the stretch it would imply. Reading
   * it as fabric rather than as any ink is what makes it a wall and not a
   * line: a stair tread is a stroke, and a jamb is a piece of the building.
   */
  const jambBand = (
    axis: 'X' | 'Y',
    along: number,
    across: number,
  ): { near: number; far: number; thickness: number; centre: number } | null => {
    const sampleAt = (a: number, c: number): boolean =>
      axis === 'X' ? at(Math.round(a), Math.round(c), fabric) : at(Math.round(c), Math.round(a), fabric)
    // The nearest fabric to the door's own line. A hinge is *on* its wall, so
    // the search is bounded by how far a hinge may sit from one rather than by
    // how thick the thickest wall is.
    let seed: number | null = null
    for (let k = 0; k <= hingeReachPx; k++) {
      if (sampleAt(along, across + k)) {
        seed = across + k
        break
      }
      if (sampleAt(along, across - k)) {
        seed = across - k
        break
      }
    }
    if (seed === null) return null
    let near = seed
    let far = seed
    while (near - 1 >= 0 && sampleAt(along, near - 1) && far - near + 1 <= maxWallPx + 2) near--
    while (far + 1 < Math.max(width, height) && sampleAt(along, far + 1) && far - near + 1 <= maxWallPx + 2) far++
    const thickness = far - near + 1
    if (thickness < minWallPx || thickness > maxWallPx) return null
    return { near, far, thickness, centre: (near + far) / 2 }
  }

  const all = pieces(thin, width, height)
  const rejected: DoorDetection['rejected'] = []
  const allArcs: ArcEvidence[] = []
  const allLeaves: LeafEvidence[] = []
  let examined = 0

  /** An accepted reading of one symbol, before duplicates are resolved. */
  type Candidate = Omit<DoorObservation, 'id'> & { score: number }
  const candidates: Candidate[] = []

  /** Build a door from a hinge, a radius and the direction of the opening. */
  const propose = (
    hinge: Point,
    radiusPx: number,
    along: { axis: 'X' | 'Y'; sign: -1 | 1 },
    leafDeg: number | null,
    arcEvidence: ArcEvidence | null,
    leafEvidence: LeafEvidence | null,
    classification: DoorClassification,
    evidence: string[],
  ): boolean => {
    const widthM = radiusPx / pxPerCm / 100
    if (widthM < opts.minWidthM || widthM > opts.maxWidthM) {
      rejected.push({ atPx: hinge, why: `a ${widthM.toFixed(2)} m swing is not a door width` })
      return false
    }
    const axis = along.axis
    const hingeAlong = axis === 'X' ? hinge.x : hinge.y
    const hingeAcross = axis === 'X' ? hinge.y : hinge.x
    const far = hingeAlong + along.sign * radiusPx
    const fromPx = Math.min(hingeAlong, far)
    const toPx = Math.max(hingeAlong, far)

    // A door hangs in a wall, so the opening has a jamb at each end: the same
    // wall, carrying on past where the door is.
    //
    // The jamb is looked for over a short stretch rather than at one pixel. A
    // fitted centre is a fitted centre — a pixel or two from where the
    // publisher put the hinge — and a single-pixel probe that lands on the
    // one antialiased row where the wall reads a shade light would answer
    // "there is no wall here" about a wall that is plainly there.
    type Jamb = { band: NonNullable<ReturnType<typeof jambBand>> | null; innerPx: number; collinear: boolean; runPx: number }
    const findJamb = (edge: number, dir: -1 | 1): Jamb | null => {
      for (let k = 1; k <= jambSearchPx; k++) {
        const band = jambBand(axis, edge + dir * k, hingeAcross)
        if (!band) continue
        // Walk back towards the opening for as long as the wall is still
        // there: where it stops is the jamb, and the opening starts there.
        //
        // Followed in *ink* rather than in fabric. Fabric is ink that survives
        // an opening by a pixel, which is the right question for "is this a
        // wall" and the wrong one for "where does this wall end": a published
        // edge is antialiased, so the last row or two of a jamb is ink that
        // an opening removes, and measuring to the fabric reports a doorway a
        // few centimetres wider at each jamb than the one that is drawn.
        const inkOn = (t: number): boolean =>
          axis === 'X'
            ? at(Math.round(t), Math.round(band.centre), ink)
            : at(Math.round(band.centre), Math.round(t), ink)
        let inner = edge + dir * k
        while (jambBand(axis, inner - dir, hingeAcross) || inkOn(inner - dir)) inner -= dir
        // And away from it, to see whether this is a wall carrying on or a
        // crumb of something else that happened to be the right thickness.
        // What is followed is the *material*, not a band of one thickness: a
        // jamb three pixels past the opening often runs straight into the
        // junction blob where two walls meet, and a wall that ends in another
        // wall has not stopped being a wall.
        const solidOn = (t: number): boolean =>
          axis === 'X'
            ? at(Math.round(t), Math.round(band.centre), fabric)
            : at(Math.round(band.centre), Math.round(t), fabric)
        let outer = edge + dir * k
        while (solidOn(outer + dir) && Math.abs(outer - inner) < jambSearchPx * 8) outer += dir
        return { band, innerPx: inner, collinear: true, runPx: Math.abs(outer - inner) + 1 }
      }
      // A doorway beside a corner has no collinear jamb on that side. What
      // closes it is the wall crossing at right angles, and that is a jamb
      // too — it just cannot be asked to agree about a thickness it does not
      // share.
      const solidHere = (t: number): boolean =>
        axis === 'X'
          ? at(Math.round(t), Math.round(hingeAcross), fabric)
          : at(Math.round(hingeAcross), Math.round(t), fabric)
      for (let k = 1; k <= jambSearchPx; k++) {
        if (!solidHere(edge + dir * k)) continue
        let inner = edge + dir * k
        while (solidHere(inner - dir)) inner -= dir
        return { band: null, innerPx: inner, collinear: false, runPx: 0 }
      }
      return null
    }
    const before = findJamb(fromPx, -1)
    const after = findJamb(toPx, 1)
    if (!before || !after) {
      rejected.push({
        atPx: hinge,
        why: `nothing solid closes ${before ? 'the far' : 'the near'} end of the stretch, so this arc is not hung in anything`,
      })
      return false
    }
    if (!before.collinear && !after.collinear) {
      rejected.push({
        atPx: hinge,
        why: 'neither end of the stretch is a wall of a plausible thickness carrying on along this line',
      })
      return false
    }
    // A jamb is a piece of wall, not a crumb of ink that happens to be the
    // right thickness. Requiring it to carry on along its own line is what
    // separates a doorway from the gap between two planters.
    if (Math.max(before.runPx, after.runPx) < minJambRunPx) {
      rejected.push({
        atPx: hinge,
        why: `the wall at the ends of the stretch carries on for only ${(Math.max(before.runPx, after.runPx) / pxPerCm / 100).toFixed(2)} m, which is not a wall`,
      })
      return false
    }
    // §9's test, applied to the two sides of one doorway before anything is
    // merged: the same line and a compatible thickness, or they are two walls
    // that happen to face each other.
    if (before.band && after.band) {
      // Both sides are the same line, so §9's test applies before anything is
      // merged: one line and a compatible thickness, or they are two walls
      // that happen to face each other.
      if (Math.abs(before.band.centre - after.band.centre) > collinearPx) {
        rejected.push({
          atPx: hinge,
          why: `the walls at the two ends of the stretch are ${Math.abs(before.band.centre - after.band.centre).toFixed(1)} px apart across, so they are not one wall`,
        })
        return false
      }
      if (Math.abs(before.band.thickness - after.band.thickness) > Math.max(2, collinearPx)) {
        rejected.push({
          atPx: hinge,
          why: `the walls at the two ends are ${before.band.thickness.toFixed(1)} and ${after.band.thickness.toFixed(1)} px thick, which is not one wall`,
        })
        return false
      }
    }
    const host = before.band ?? after.band!
    const atPx = before.band && after.band ? (before.band.centre + after.band.centre) / 2 : host.centre
    // The opening is what the two jambs leave between them, not what the
    // fitted radius implies. The radius says a door of about this width hangs
    // here; the jambs say where it stops, and §14 asks for the width the
    // source can be read to give.
    const jambFrom = before.innerPx + 1
    const jambTo = after.innerPx - 1
    const jambWidthPx = jambTo - jambFrom + 1
    if (jambWidthPx < opts.minWidthM * 100 * pxPerCm || jambWidthPx > opts.maxWidthM * 100 * pxPerCm) {
      rejected.push({
        atPx: hinge,
        why: `the jambs leave ${(jambWidthPx / pxPerCm / 100).toFixed(2)} m between them, which is not a door width`,
      })
      return false
    }
    if (Math.abs(jambWidthPx - radiusPx) > opts.widthAgreementM * 100 * pxPerCm) {
      rejected.push({
        atPx: hinge,
        why:
          `the swing is ${(radiusPx / pxPerCm / 100).toFixed(2)} m but the jambs leave ` +
          `${(jambWidthPx / pxPerCm / 100).toFixed(2)} m, and a leaf fills its own opening`,
      })
      return false
    }
    const openFrom = jambFrom
    const openTo = jambTo
    const openWidthPx = jambWidthPx

    // The opening a door hangs in is free of material. If it is not, the
    // hypothesis is describing something else — §18's "fill the doorway with
    // wall fabric" has to fail here and not later.
    let blocked = 0
    let samples = 0
    for (let a = Math.ceil(openFrom); a <= Math.floor(openTo); a++) {
      samples++
      const x = axis === 'X' ? a : Math.round(atPx)
      const y = axis === 'X' ? Math.round(atPx) : a
      if (at(x, y, fabric)) blocked++
    }
    if (samples > 0 && blocked / samples > opts.maxBlockedFraction) {
      rejected.push({
        atPx: hinge,
        why: `the stretch the swing implies is ${((blocked / samples) * 100).toFixed(0)}% material, so nothing opens through it`,
      })
      return false
    }

    // A leaf sweeps a floor. What it sweeps has to be floor: a swing crossed
    // by material is describing a stair tread, a hatch or a run of joinery,
    // not a door. §5's furniture-arc refusal lands here as well as at the jamb.
    if (arcEvidence !== null) {
      let sweptSamples = 0
      let sweptBlocked = 0
      const step = Math.max(2, Math.round(600 / Math.max(1, arcEvidence.radiusPx)))
      for (let k = step; k < arcEvidence.spanDeg; k += step) {
        const a = ((arcEvidence.fromDeg + k) * Math.PI) / 180
        for (const f of [0.35, 0.6, 0.85]) {
          const x = Math.round(hinge.x + arcEvidence.radiusPx * f * Math.cos(a))
          const y = Math.round(hinge.y + arcEvidence.radiusPx * f * Math.sin(a))
          sweptSamples++
          if (at(x, y, fabric)) sweptBlocked++
        }
      }
      if (sweptSamples > 0 && sweptBlocked / sweptSamples > opts.maxSweptBlocked) {
        rejected.push({
          atPx: hinge,
          why: `the floor this swing would cross is ${((sweptBlocked / sweptSamples) * 100).toFixed(0)}% material, so no leaf turns through it`,
        })
        return false
      }
    }

    const swingSide: -1 | 1 =
      leafDeg === null
        ? 1
        : (axis === 'X' ? Math.sin((leafDeg * Math.PI) / 180) : Math.cos((leafDeg * Math.PI) / 180)) >= 0
          ? 1
          : -1
    const confidence = Math.max(
      0.2,
      Math.min(
        0.95,
        (arcEvidence ? 0.4 * arcEvidence.coverage + 0.2 * Math.min(1, arcEvidence.spanDeg / 90) : 0) +
          (leafEvidence ? 0.25 * leafEvidence.coverage : 0) +
          0.15,
      ),
    )
    candidates.push({
      assetId,
      hingePx: hinge,
      axis,
      fromPx: openFrom,
      toPx: openTo,
      widthPx: openWidthPx,
      widthM: openWidthPx / pxPerCm / 100,
      swingRadiusM: widthM,
      atPx,
      thicknessPx: host.thickness,
      swingSide,
      arc: arcEvidence,
      leaf: leafEvidence,
      jambM: {
        before: (before.band?.thickness ?? host.thickness) / pxPerCm / 100,
        after: (after.band?.thickness ?? host.thickness) / pxPerCm / 100,
      },
      classification,
      confidence,
      evidence: [
        ...evidence,
        before.band && after.band
          ? `a wall ${before.band.thickness.toFixed(1)} px thick carries on before the opening and ` +
            `${after.band.thickness.toFixed(1)} px after it, on the same line`
          : `a wall ${host.thickness.toFixed(1)} px thick carries on past ${before.band ? 'the near' : 'the far'} end; ` +
            `the other end is closed by a wall crossing this line`,
        `the jambs leave ${(openWidthPx / pxPerCm / 100).toFixed(2)} m between them, for a ${widthM.toFixed(2)} m swing`,
      ],
      // Arc evidence outranks a bare leaf, and a swing that lands squarely on
      // the wall outranks one that had to be bent to reach it.
      score:
        (arcEvidence ? arcEvidence.coverage * Math.min(1, arcEvidence.spanDeg / 90) + 1 : 0) +
        (leafEvidence ? leafEvidence.coverage : 0),
    })
    return true
  }

  // --- the wall's own account: every interruption in a line of fabric
  //
  // §4 is explicit that a gap between two *detected wall bands* is not enough,
  // because the bands that matter are the ones a doorway made too short to
  // claim. These gaps are read from the fabric a pixel at a time, so a 0.16 m
  // stub counts, and each is then asked whether a door is drawn in it rather
  // than assumed to be one.
  const gaps = wallLineGaps(fabric, width, height, {
    minWallPx,
    maxWallPx,
    minGapPx: rMinPx,
    maxGapPx: rMaxPx,
    collinearPx,
  })
  let gapsWithADoor = 0
  for (const gap of gaps) {
    const radiusPx = gap.toPx - gap.fromPx + 1
    let found = false
    // Either jamb could be the hinge, and the door could swing either way.
    for (const hingeAtStart of [true, false]) {
      const hingeAlong = hingeAtStart ? gap.fromPx : gap.toPx
      const closedDeg =
        gap.axis === 'X' ? (hingeAtStart ? 0 : 180) : hingeAtStart ? 90 : 270
      const along: { axis: 'X' | 'Y'; sign: -1 | 1 } = {
        axis: gap.axis,
        sign: hingeAtStart ? 1 : -1,
      }
      const hinge: Point =
        gap.axis === 'X' ? { x: hingeAlong, y: gap.atPx } : { x: gap.atPx, y: hingeAlong }
      for (const turn of [1, -1] as const) {
        const swept = sweepArc(
          { ink, fabric, thin },
          width,
          height,
          hinge,
          radiusPx,
          closedDeg,
          turn,
          opts.maxArcSpanDeg,
          Math.max(1.5, radiusPx * opts.arcResidualFraction),
        )
        const leafDeg = swept.endDeg
        const tip = {
          x: hinge.x + radiusPx * Math.cos((leafDeg * Math.PI) / 180),
          y: hinge.y + radiusPx * Math.sin((leafDeg * Math.PI) / 180),
        }
        const leafCoverage =
          swept.spanDeg >= opts.minLeafToWallDeg
            ? segmentCoverage(thin, ink, fabric, width, height, hinge, tip)
            : 0
        const hasArc = swept.spanDeg >= opts.minArcSpanDeg && swept.coverage >= opts.minArcCoverage
        const hasLeaf = leafCoverage >= opts.minLeafCoverage
        if (!hasArc && !hasLeaf) continue
        const arcEvidence: ArcEvidence | null = hasArc
          ? {
              centrePx: hinge,
              radiusPx,
              fromDeg: turn > 0 ? closedDeg : swept.endDeg,
              toDeg: turn > 0 ? swept.endDeg : closedDeg,
              spanDeg: swept.spanDeg,
              residualPx: swept.residualPx,
              coverage: swept.coverage,
              confidence: Math.min(0.95, 0.4 + 0.5 * swept.coverage),
            }
          : null
        if (arcEvidence) allArcs.push(arcEvidence)
        const leafEvidence: LeafEvidence | null = hasLeaf
          ? {
              hingePx: hinge,
              tipPx: tip,
              lengthPx: radiusPx,
              directionDeg: leafDeg,
              coverage: leafCoverage,
              confidence: Math.min(0.95, 0.35 + 0.6 * leafCoverage),
            }
          : null
        if (leafEvidence) allLeaves.push(leafEvidence)
        if (
          propose(
            hinge,
            radiusPx,
            along,
            hasLeaf ? leafDeg : null,
            arcEvidence,
            leafEvidence,
            hasArc ? (hasLeaf && swept.coverage >= 0.75 ? 'SINGLE_HINGED' : 'WEAK_ARC') : 'LEAF_ONLY',
            [
              `a wall ${gap.thicknessPx.toFixed(1)} px thick is interrupted for ` +
                `${(radiusPx / pxPerCm / 100).toFixed(2)} m on the same line`,
              hasArc
                ? `a swing of ${swept.spanDeg.toFixed(0)}° from the closed position, ` +
                  `${(swept.coverage * 100).toFixed(0)}% inked, residual ${swept.residualPx.toFixed(2)} px`
                : `no swing is drawn in this opening (${swept.spanDeg.toFixed(0)}° of arc found)`,
              hasLeaf
                ? `a leaf from the hinge at ${leafDeg.toFixed(0)}°, ${(leafCoverage * 100).toFixed(0)}% inked`
                : 'no leaf is drawn in this opening',
            ],
          )
        ) {
          found = true
        }
      }
    }
    if (found) gapsWithADoor++
  }

  for (const piece of all) {
    const w = piece.x1 - piece.x0 + 1
    const h = piece.y1 - piece.y0 + 1
    // A door symbol occupies about a square of its own radius. Pieces much
    // smaller carry no arc and pieces much larger are not one symbol.
    if (Math.max(w, h) < rMinPx * 0.5) continue
    if (Math.max(w, h) > rMaxPx * 1.35) continue
    if (piece.points.length > rMaxPx * rMaxPx * opts.maxPieceArea) continue
    examined++

    const arcs = fitArcs(piece, rMinPx, rMaxPx, opts)
    const segment = fitSegment(piece)

    // Every arc the piece holds is offered to the wall, and every reading of
    // every arc. Which of them is a door is not something the ink can settle,
    // so none of them is allowed to win by being looked at first.
    let any = false
    for (const arc of arcs) {
      const arcEvidence: ArcEvidence = {
        centrePx: arc.centre,
        radiusPx: arc.radiusPx,
        fromDeg: arc.fromDeg,
        toDeg: arc.toDeg,
        spanDeg: arc.spanDeg,
        residualPx: arc.residualPx,
        coverage: arc.coverage,
        confidence: Math.min(0.95, 0.4 + 0.5 * arc.coverage),
      }
      allArcs.push(arcEvidence)
      // Which way the opening runs is not read off the arc's own end. A
      // published arc is crossed by hatching and tile joints and stops a few
      // degrees early or late, and a wall that is decided by a noisy endpoint
      // is decided by noise. The four directions a wall can run are each
      // offered to the drawing instead, and the jambs answer.
      for (const along of AXIS_DIRECTIONS) {
        const alongDeg = along.axis === 'X' ? (along.sign > 0 ? 0 : 180) : along.sign > 0 ? 90 : 270
        // The swing has to reach the wall: either the inked span covers the
        // closed position or it stops within a few degrees of it.
        if (!spanReaches(arc.fromDeg, arc.spanDeg, alongDeg, opts.axisToleranceDeg)) continue
        // The leaf is at the end of the swing furthest from the closed
        // position, which is where a door drawn part-open puts it.
        const leafDeg = angularDistance(arc.fromDeg, alongDeg) >= angularDistance(arc.toDeg, alongDeg) ? arc.fromDeg : arc.toDeg
        const tip = {
          x: arc.centre.x + arc.radiusPx * Math.cos((leafDeg * Math.PI) / 180),
          y: arc.centre.y + arc.radiusPx * Math.sin((leafDeg * Math.PI) / 180),
        }
        const coverage = segmentCoverage(thin, ink, fabric, width, height, arc.centre, tip)
        const leafEvidence: LeafEvidence | null =
          coverage >= opts.minLeafCoverage
            ? {
                hingePx: arc.centre,
                tipPx: tip,
                lengthPx: arc.radiusPx,
                directionDeg: leafDeg,
                coverage,
                confidence: Math.min(0.95, 0.35 + 0.6 * coverage),
              }
            : null
        if (leafEvidence) allLeaves.push(leafEvidence)
        const evidence = [
          `a swing of ${arc.spanDeg.toFixed(0)}° at radius ${arc.radiusPx.toFixed(1)} px, ` +
            `${(arc.coverage * 100).toFixed(0)}% inked, residual ${arc.residualPx.toFixed(2)} px`,
          leafEvidence
            ? `a leaf from the hinge, ${(coverage * 100).toFixed(0)}% inked`
            : `no leaf was found along the ${leafDeg.toFixed(0)}° end of the swing (${(coverage * 100).toFixed(0)}% inked)`,
        ]
        if (
          propose(
            arc.centre,
            arc.radiusPx,
            along,
            leafEvidence ? leafDeg : null,
            arcEvidence,
            leafEvidence,
            leafEvidence ? (arc.coverage >= 0.75 ? 'SINGLE_HINGED' : 'WEAK_ARC') : 'ARC_ONLY',
            evidence,
          )
        ) {
          any = true
        }
      }
    }
    if (any) continue

    // No arc was hung in anything. A leaf on its own is still evidence — §5
    // asks for the door whose arc the publisher drew faintly or not at all —
    // but it is weaker, and which of its two ends is the hinge has to be read
    // off the drawing rather than assumed.
    if (!segment) continue
    const lengthM = segment.lengthPx / pxPerCm / 100
    if (lengthM < opts.minWidthM || lengthM > opts.maxWidthM) continue
    if (segment.residualPx > opts.leafResidualPx) continue
    const dirAB = deg(Math.atan2(segment.b.y - segment.a.y, segment.b.x - segment.a.x))
    for (const [hinge, tip, leafDeg] of [
      [segment.a, segment.b, dirAB],
      [segment.b, segment.a, (dirAB + 180) % 360],
    ] as Array<[Point, Point, number]>) {
      for (const along of AXIS_DIRECTIONS) {
        const alongDeg = along.axis === 'X' ? (along.sign > 0 ? 0 : 180) : along.sign > 0 ? 90 : 270
        // A leaf is drawn away from its wall, so a stroke lying along the
        // opening is not one.
        if (angularDistance(leafDeg, alongDeg) < opts.minLeafToWallDeg) continue
        propose(
          hinge,
          segment.lengthPx,
          along,
          leafDeg,
          null,
          {
            hingePx: hinge,
            tipPx: tip,
            lengthPx: segment.lengthPx,
            directionDeg: leafDeg,
            coverage: 1,
            confidence: 0.4,
          },
          'LEAF_ONLY',
          [
            'no swing arc was found for this leaf',
            `a straight stroke ${lengthM.toFixed(2)} m long, residual ${segment.residualPx.toFixed(2)} px`,
          ],
        )
      }
    }
  }

  // --- one door per opening
  //
  // The same doorway is often read several ways: two arcs of a double door,
  // an arc and its own leaf taken as separate symbols, two centres a pixel
  // apart. Readings that describe the same stretch of the same wall are one
  // door, and the best-evidenced of them is the one kept.
  const sorted = [...candidates].sort((a, b) => b.score - a.score || a.fromPx - b.fromPx)
  const kept: Candidate[] = []
  for (const c of sorted) {
    const clash = kept.find(
      (k) =>
        k.axis === c.axis &&
        Math.abs(k.atPx - c.atPx) <= collinearPx * 2 &&
        Math.min(k.toPx, c.toPx) - Math.max(k.fromPx, c.fromPx) > 0.4 * Math.min(k.toPx - k.fromPx, c.toPx - c.fromPx),
    )
    if (clash) continue
    kept.push(c)
  }
  const doors: DoorObservation[] = kept
    .sort((a, b) => (a.axis === b.axis ? a.atPx - b.atPx || a.fromPx - b.fromPx : a.axis < b.axis ? -1 : 1))
    .map(({ score, ...rest }, i) => ({ id: `dr${i}`, ...rest }))

  return {
    doors,
    arcs: allArcs,
    leaves: allLeaves,
    rejected,
    notes: [
      `${gaps.length} interruptions in a wall line, ${gapsWithADoor} with a door drawn in them`,
      `${all.length} pieces of line work, ${examined} the size of a door symbol`,
      `${allArcs.length} swing arcs fitted, ${allLeaves.length} leaves found along one of their ends`,
      `${candidates.length} readings hung in a wall, resolved to ${doors.length} doors; ${rejected.length} hypotheses rejected`,
      `swing radius admitted ${rMinPx.toFixed(1)}..${rMaxPx.toFixed(1)} px (${opts.minWidthM}..${opts.maxWidthM} m), ` +
        `host wall ${minWallPx.toFixed(1)}..${maxWallPx.toFixed(1)} px`,
    ],
  }
}

/** Two single doors hung on the same opening, meeting in the middle. */
export function pairDoubleDoors(doors: readonly DoorObservation[], pxPerCm: number): DoorObservation[] {
  const tol = 0.1 * 100 * pxPerCm
  const out = doors.map((d) => ({ ...d }))
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length; j++) {
      const a = out[i]
      const b = out[j]
      if (a.axis !== b.axis) continue
      if (Math.abs(a.atPx - b.atPx) > tol) continue
      if (Math.abs(a.widthPx - b.widthPx) > tol * 2) continue
      // They meet where their leaves meet: the far end of one is the far end
      // of the other, and their hinges are at opposite jambs.
      const aFar = a.hingePx[a.axis === 'X' ? 'x' : 'y'] === a.fromPx ? a.toPx : a.fromPx
      const bFar = b.hingePx[b.axis === 'X' ? 'x' : 'y'] === b.fromPx ? b.toPx : b.fromPx
      if (Math.abs(aFar - bFar) > tol) continue
      a.classification = 'DOUBLE_HINGED'
      b.classification = 'DOUBLE_HINGED'
      a.evidence = [...a.evidence, `a second leaf meets this one at the middle of the opening (${b.id})`]
      b.evidence = [...b.evidence, `a second leaf meets this one at the middle of the opening (${a.id})`]
    }
  }
  return out
}

