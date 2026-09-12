/**
 * Dimension geometry detection (§6).
 *
 * Geometry comes before recognition, and the ordering is the single most
 * important decision in this pipeline. Run a recogniser over a whole
 * architectural plan and it returns hundreds of candidates, most of them
 * furniture outlines, hatching fragments and appliance symbols; the numbers
 * are in there, but nothing says which components belong together or what any
 * of them measures. Find the dimension lines first and the picture inverts: a
 * label zone is a small box at a known place with a known orientation holding
 * exactly one number, whose value the baseline length already predicts.
 *
 * Detected here, all in source-native pixels:
 *
 *   - dimension lines: long thin ink runs, horizontal or vertical;
 *   - end ticks: the slashes that mark where a measurement starts and stops;
 *   - extension lines: the perpendicular strokes the ticks sit on;
 *   - baselines and their segments;
 *   - label zones, one per segment plus one for the chain overall;
 *   - callout markers: a ring holding a stacked width/height pair;
 *   - leader lines from a callout to the feature it labels;
 *   - level markers on a section;
 *   - the drawing's italic slant, measured once from its own text.
 *
 * PORT_DIRECT (Kotlin).
 */
import type { GrayImage } from '../contracts/raster.js'
import type { PixelBox, Point2, TextOrientation } from './contracts.js'

export type DimensionGeometryOptions = {
  /** Ink threshold as a fraction of the page's white level. */
  inkFraction: number
  /** Shortest line, as a fraction of the image's long edge. */
  minLineFraction: number
  /** Thickest run still considered a drafting line, pixels. */
  maxLineThickness: number
  /** Gap in pixels a line may jump (text and ticks interrupt it). */
  maxLineGap: number
  /** Perpendicular reach searched for ticks, pixels. */
  tickReach: number
  /** Minimum perpendicular ink for a tick. */
  minTickExtent: number
  /** Label band depth measured off the baseline, pixels. */
  labelBand: number
  /** Callout ring diameter range, pixels. */
  minCalloutDiameter: number
  maxCalloutDiameter: number
}

export const DEFAULT_DIMENSION_GEOMETRY: DimensionGeometryOptions = {
  inkFraction: 0.82,
  minLineFraction: 0.07,
  maxLineThickness: 3,
  maxLineGap: 6,
  tickReach: 6,
  minTickExtent: 3,
  labelBand: 22,
  minCalloutDiameter: 20,
  maxCalloutDiameter: 60,
}

export type DetectedLine = {
  id: string
  orientation: 'HORIZONTAL' | 'VERTICAL'
  /** Row (horizontal) or column (vertical) the line sits on. */
  position: number
  /** Extent along the line. */
  from: number
  to: number
  /** Mean ink darkness along the run, 0..1 where 1 is black. */
  strength: number
  ticks: number[]
}

export type LabelZone = {
  id: string
  box: PixelBox
  orientation: TextOrientation
  /** Baseline the zone belongs to. */
  lineId: string
  /** Segment index within the line, or -1 for the chain overall. */
  segmentIndex: number
  /** Baseline pixel length this zone's number should describe. */
  lengthPx: number
}

export type CalloutMarker = {
  id: string
  centre: Point2
  radiusPx: number
  /** Upper and lower halves of the ring interior. */
  upper: PixelBox
  lower: PixelBox
  /** Where the leader line ends, if one was traced. */
  leaderEnd: Point2 | null
}

export type LevelMarkerZone = {
  id: string
  box: PixelBox
  /** Row of the level line the text annotates. */
  row: number
}

export type DimensionGeometry = {
  lines: DetectedLine[]
  zones: LabelZone[]
  callouts: CalloutMarker[]
  levels: LevelMarkerZone[]
  /** Italic slant of the drawing's text, radians. Positive leans right. */
  slantRad: number
  inkThreshold: number
  notes: string[]
}

/** Page white level: the 95th percentile of the image, which is the paper. */
function whiteLevel(gray: GrayImage): number {
  const hist = new Int32Array(256)
  for (let i = 0; i < gray.data.length; i++) hist[gray.data[i]]++
  const target = gray.data.length * 0.95
  let acc = 0
  for (let v = 0; v < 256; v++) {
    acc += hist[v]
    if (acc >= target) return v
  }
  return 255
}

/** Maximal runs of ink along one scanline, tolerating small gaps. */
function inkRuns(
  isInk: (i: number) => boolean,
  length: number,
  minLength: number,
  maxGap: number,
): Array<{ from: number; to: number }> {
  const out: Array<{ from: number; to: number }> = []
  let start = -1
  let gap = 0
  for (let i = 0; i <= length; i++) {
    const on = i < length && isInk(i)
    if (on) {
      if (start < 0) start = i
      gap = 0
    } else if (start >= 0) {
      gap++
      if (gap > maxGap || i === length) {
        const end = i - gap
        if (end - start + 1 >= minLength) out.push({ from: start, to: end })
        start = -1
        gap = 0
      }
    }
  }
  return out
}

/**
 * Long thin ink runs, in both orientations.
 *
 * Thinness is what separates a dimension line from a wall: a drafting line is
 * one or two pixels through, a wall in a plan is a filled band. The test is
 * applied along the run rather than at a single point, because a dimension
 * line passes behind its own ticks and through the occasional glyph.
 */
export function detectLines(gray: GrayImage, opts: DimensionGeometryOptions, ink: number): DetectedLine[] {
  const w = gray.width
  const h = gray.height
  const isInk = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < w && y < h && gray.data[y * w + x] < ink
  const minLen = Math.round(Math.max(w, h) * opts.minLineFraction)
  const out: DetectedLine[] = []

  const thinFraction = (
    orientation: 'HORIZONTAL' | 'VERTICAL',
    position: number,
    from: number,
    to: number,
  ): { thin: number; strength: number } => {
    let thin = 0
    let sum = 0
    let n = 0
    const step = Math.max(1, Math.floor((to - from) / 64))
    for (let t = from; t <= to; t += step) {
      let run = 1
      for (let d = 1; d <= opts.maxLineThickness + 2; d++) {
        if (orientation === 'HORIZONTAL' ? isInk(t, position + d) : isInk(position + d, t)) run++
        else break
      }
      for (let d = 1; d <= opts.maxLineThickness + 2; d++) {
        if (orientation === 'HORIZONTAL' ? isInk(t, position - d) : isInk(position - d, t)) run++
        else break
      }
      if (run <= opts.maxLineThickness) thin++
      const v = orientation === 'HORIZONTAL' ? gray.data[position * w + t] : gray.data[t * w + position]
      sum += 1 - v / 255
      n++
    }
    return { thin: n === 0 ? 0 : thin / n, strength: n === 0 ? 0 : sum / n }
  }

  for (let y = 0; y < h; y++) {
    for (const run of inkRuns((x) => isInk(x, y), w, minLen, opts.maxLineGap)) {
      const { thin, strength } = thinFraction('HORIZONTAL', y, run.from, run.to)
      if (thin < 0.8) continue
      out.push({ id: `hl_${y}_${run.from}`, orientation: 'HORIZONTAL', position: y, from: run.from, to: run.to, strength, ticks: [] })
    }
  }
  for (let x = 0; x < w; x++) {
    for (const run of inkRuns((y) => isInk(x, y), h, minLen, opts.maxLineGap)) {
      const { thin, strength } = thinFraction('VERTICAL', x, run.from, run.to)
      if (thin < 0.8) continue
      out.push({ id: `vl_${x}_${run.from}`, orientation: 'VERTICAL', position: x, from: run.from, to: run.to, strength, ticks: [] })
    }
  }

  // A drafting line two pixels thick is found twice. Collapse neighbours that
  // describe the same stroke, keeping the longer extent.
  const merged: DetectedLine[] = []
  for (const line of out.sort((a, b) =>
    a.orientation === b.orientation ? a.position - b.position || a.from - b.from : a.orientation < b.orientation ? -1 : 1,
  )) {
    const prev = merged[merged.length - 1]
    if (
      prev &&
      prev.orientation === line.orientation &&
      Math.abs(prev.position - line.position) <= opts.maxLineThickness &&
      line.from <= prev.to + opts.maxLineGap &&
      line.to >= prev.from - opts.maxLineGap
    ) {
      prev.from = Math.min(prev.from, line.from)
      prev.to = Math.max(prev.to, line.to)
      prev.strength = Math.max(prev.strength, line.strength)
      continue
    }
    merged.push({ ...line })
  }
  return merged
}

/**
 * Tick positions along a line.
 *
 * A tick is a short stroke crossing the baseline, so it shows as a local
 * excess of perpendicular ink. Extension lines produce the same signature and
 * mark the same anchors, so both are accepted; what is rejected is a broad
 * region of perpendicular ink, which is the drawing itself touching the line.
 */
export function detectTicks(gray: GrayImage, line: DetectedLine, opts: DimensionGeometryOptions, ink: number): number[] {
  const w = gray.width
  const h = gray.height
  const isInk = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < w && y < h && gray.data[y * w + x] < ink
  const n = line.to - line.from + 1
  if (n <= 4) return []
  const extent = new Int32Array(n)
  for (let i = 0; i < n; i++) {
    const t = line.from + i
    let above = 0
    let below = 0
    for (let d = 2; d <= opts.tickReach; d++) {
      if (line.orientation === 'HORIZONTAL') {
        if (isInk(t, line.position - d)) above++
        if (isInk(t, line.position + d)) below++
      } else {
        if (isInk(line.position - d, t)) above++
        if (isInk(line.position + d, t)) below++
      }
    }
    // A tick *crosses* the baseline, so it inks both sides. The label does
    // not: it sits above a horizontal line and left of a vertical one. Scoring
    // the weaker side is what keeps a digit's stem from being read as an
    // anchor — the failure that put five phantom ticks under `1205`.
    extent[i] = Math.min(above, below) * 2
  }
  // Peaks: at least minTickExtent perpendicular ink, and a local maximum in a
  // window narrow enough that two ticks are never merged.
  const ticks: number[] = []
  const win = 3
  for (let i = 0; i < n; i++) {
    if (extent[i] < opts.minTickExtent) continue
    let best = true
    for (let d = -win; d <= win && best; d++) {
      const j = i + d
      if (j < 0 || j >= n || j === i) continue
      if (extent[j] > extent[i] || (extent[j] === extent[i] && j < i)) best = false
    }
    if (!best) continue
    // Reject a broad contact region: if the whole window is inked, this is the
    // drawing crossing the line, not a tick.
    let wide = 0
    for (let d = -6; d <= 6; d++) {
      const j = i + d
      if (j >= 0 && j < n && extent[j] >= opts.minTickExtent) wide++
    }
    if (wide > 9) continue
    ticks.push(line.from + i)
  }
  // A tick is a slash a few pixels wide, so one anchor can peak twice. Collapse
  // neighbours to the ink-weighted centroid of the whole group rather than to
  // the mean of the peaks: the result is sub-pixel, and sub-pixel matters more
  // here than anywhere else in the pipeline. A tick localised to the nearest
  // whole pixel puts a floor of a couple of centimetres on every value the
  // chain solver derives, which is the same order as the centimetre grid the
  // drawing is dimensioned on — enough to drown the signal the solver depends
  // on.
  // The baseline is drawn a little past its outermost ticks, so its ends are
  // anchors only when no tick was found near them. Using them regardless put
  // every end segment several pixels long — a one-percent scale error, which
  // is precisely the accuracy the integer solver lives or dies by.
  const ends: number[] = []
  const nearest = (t: number): number => ticks.reduce((m, v) => Math.min(m, Math.abs(v - t)), Number.POSITIVE_INFINITY)
  const slack = Math.max(opts.tickReach, (line.to - line.from) * 0.02)
  if (ticks.length < 2 || nearest(line.from) > slack) ends.push(line.from)
  if (ticks.length < 2 || nearest(line.to) > slack) ends.push(line.to)
  const all = [...ends, ...ticks].sort((a, b) => a - b)
  const centroid = (group: number[]): number => {
    let num = 0
    let den = 0
    for (const t of group) {
      const i = t - line.from
      const weight = i >= 0 && i < n ? Math.max(0.25, extent[i]) : 0.25
      num += t * weight
      den += weight
    }
    return den > 0 ? num / den : group[0]
  }
  const merged: number[] = []
  let group: number[] = []
  const flush = (): void => {
    if (group.length === 0) return
    merged.push(centroid(group))
    group = []
  }
  for (const v of all) {
    if (group.length > 0 && v - group[group.length - 1] > opts.tickReach) flush()
    group.push(v)
  }
  flush()
  return merged
}

/**
 * Italic slant of the drawing's text, measured from the drawing itself.
 *
 * Digits here lean right by a fixed amount set by the CAD text style. Removing
 * that lean before a glyph is normalised is worth more than any amount of
 * template tuning, because a sheared `1` and an upright `7` occupy almost the
 * same normalised box. The estimate is a single global number: the shear that
 * minimises the total horizontal spread of small ink components.
 */
export function estimateSlant(gray: GrayImage, boxes: readonly PixelBox[], ink: number): number {
  const w = gray.width
  // Per component, regress the ink centroid of each row against the row index.
  // An upright stroke keeps the same centroid down the glyph; an italic one
  // walks it sideways at a constant rate, and that rate is the slant. Fitting
  // it directly beats searching shear values: it needs one pass, has no
  // resolution limit, and averages cleanly over many small glyphs.
  let sumSlope = 0
  let sumWeight = 0
  for (const b of boxes) {
    const h = b.y1 - b.y0 + 1
    if (h < 6) continue
    const rows: Array<{ y: number; x: number }> = []
    for (let y = b.y0; y <= b.y1; y++) {
      let sx = 0
      let n = 0
      for (let x = b.x0; x <= b.x1; x++) {
        if (gray.data[y * w + x] >= ink) continue
        sx += x
        n++
      }
      if (n >= 1) rows.push({ y, x: sx / n })
    }
    if (rows.length < 5) continue
    const my = rows.reduce((a, r) => a + r.y, 0) / rows.length
    const mx = rows.reduce((a, r) => a + r.x, 0) / rows.length
    let num = 0
    let den = 0
    for (const r of rows) {
      num += (r.y - my) * (r.x - mx)
      den += (r.y - my) * (r.y - my)
    }
    if (den <= 0) continue
    // dx/dy is negative for right-leaning text (x grows as y shrinks); report
    // the positive lean.
    const slope = -num / den
    if (!Number.isFinite(slope) || Math.abs(slope) > 1) continue
    sumSlope += slope * rows.length
    sumWeight += rows.length
  }
  if (sumWeight === 0) return 0
  return Math.atan(sumSlope / sumWeight)
}

/** Whether `inner` lies inside `outer`. */
const inside = (inner: PixelBox, outer: PixelBox): boolean =>
  inner.x0 >= outer.x0 && inner.x1 <= outer.x1 && inner.y0 >= outer.y0 && inner.y1 <= outer.y1

/**
 * Label zones for one line: one per segment, plus the overall.
 *
 * Text sits above a horizontal dimension line and to the left of a vertical
 * one, reading bottom-to-top. The overall dimension of a two-level chain is
 * printed on the upper line over the whole span, which is the same rule applied
 * to a single segment covering the line's full length.
 */
export function labelZonesFor(line: DetectedLine, opts: DimensionGeometryOptions, bounds: PixelBox): LabelZone[] {
  const out: LabelZone[] = []
  const band = opts.labelBand
  const push = (segmentIndex: number, fromF: number, toF: number): void => {
    if (toF - fromF < 6) return
    const from = Math.round(fromF)
    const to = Math.round(toF)
    const box: PixelBox =
      line.orientation === 'HORIZONTAL'
        ? { x0: from, x1: to, y0: line.position - band, y1: line.position - 2 }
        : { x0: line.position - band, x1: line.position - 2, y0: from, y1: to }
    const clipped: PixelBox = {
      x0: Math.max(bounds.x0, box.x0),
      y0: Math.max(bounds.y0, box.y0),
      x1: Math.min(bounds.x1, box.x1),
      y1: Math.min(bounds.y1, box.y1),
    }
    if (clipped.x1 - clipped.x0 < 6 || clipped.y1 - clipped.y0 < 4) return
    out.push({
      id: `${line.id}_z${segmentIndex}`,
      box: clipped,
      orientation: line.orientation === 'HORIZONTAL' ? 'HORIZONTAL' : 'VERTICAL_UP',
      lineId: line.id,
      segmentIndex,
      // Keep the sub-pixel length: the box is drawn on whole pixels but the
      // measurement is not.
      lengthPx: toF - fromF,
    })
  }
  // One zone per interval, and nothing else. A multi-interval line does not
  // print its own total: drafting convention puts the total on a second,
  // outer line with a tick only at each end, and synthesising an "overall"
  // zone over the whole span here just re-reads the part labels side by side.
  // Pairing the two lines is the chain assembler's job (see `chainFamilies`).
  for (let i = 0; i + 1 < line.ticks.length; i++) push(i, line.ticks[i], line.ticks[i + 1])
  return out
}

export { whiteLevel, inkRuns, inside }

/**
 * Callout markers: a ring holding a stacked width/height pair.
 *
 * ARCHON plans label every opening this way, and it is the only place the
 * exact width and height of a window are printed. The ring is found as a thin
 * near-circular contour, confirmed by the horizontal divider across its middle
 * that separates the two numbers — a circle without a divider is a
 * north-arrow, a level bubble or a column, and is rejected.
 */
export function detectCallouts(gray: GrayImage, opts: DimensionGeometryOptions, ink: number): CalloutMarker[] {
  const w = gray.width
  const h = gray.height
  const isInk = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < w && y < h && gray.data[y * w + x] < ink

  // Components of ink at ring scale. A ring is hollow, so its own component is
  // a thin annulus: small area for a large bounding box.
  const seen = new Uint8Array(w * h)
  const queue = new Int32Array(w * h)
  const out: CalloutMarker[] = []
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || gray.data[start] >= ink) continue
    let head = 0
    let tail = 0
    queue[tail++] = start
    seen[start] = 1
    let x0 = w
    let x1 = -1
    let y0 = h
    let y1 = -1
    let area = 0
    while (head < tail) {
      const i = queue[head++]
      area++
      const x = i % w
      const y = (i / w) | 0
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
      if (area > opts.maxCalloutDiameter * opts.maxCalloutDiameter) break
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
          const j = ny * w + nx
          if (!seen[j] && gray.data[j] < ink) {
            seen[j] = 1
            queue[tail++] = j
          }
        }
      }
    }
    const bw = x1 - x0 + 1
    const bh = y1 - y0 + 1
    if (bw < opts.minCalloutDiameter || bh < opts.minCalloutDiameter) continue
    if (bw > opts.maxCalloutDiameter || bh > opts.maxCalloutDiameter) continue
    // Round: the box is near-square and the component is a thin annulus.
    if (Math.abs(bw - bh) > Math.max(3, bw * 0.25)) continue
    const fill = area / (bw * bh)
    if (fill > 0.5) continue
    const cx = (x0 + x1) / 2
    const cy = (y0 + y1) / 2
    // Round, not merely square-ish: the component's ink must lie close to one
    // radius. A hollow rectangle — a logo panel, a table, a shower tray —
    // passes a bounding-box test and fails this one.
    {
      const r = (bw + bh) / 4
      let inband = 0
      let total = 0
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          if (gray.data[y * w + x] >= ink) continue
          total++
          const d = Math.hypot(x - cx, y - cy)
          if (Math.abs(d - r) <= Math.max(2, r * 0.22)) inband++
        }
      }
      if (total === 0 || inband / total < 0.55) continue
    }
    // Divider: a horizontal ink run across the middle third of the interior.
    let divider = -1
    for (let y = Math.round(cy - bh * 0.18); y <= Math.round(cy + bh * 0.18); y++) {
      let run = 0
      for (let x = Math.round(x0 + bw * 0.2); x <= Math.round(x1 - bw * 0.2); x++) if (isInk(x, y)) run++
      if (run >= bw * 0.45) {
        divider = y
        break
      }
    }
    if (divider < 0) continue
    const pad = Math.round(bw * 0.16)
    // Both halves must hold ink: a callout is a *pair* of numbers, and a ring
    // with a bar and one number is a level bubble or a section mark.
    const halfInk = (b: PixelBox): number => {
      let c = 0
      for (let y = Math.max(0, b.y0); y <= Math.min(h - 1, b.y1); y++)
        for (let x = Math.max(0, b.x0); x <= Math.min(w - 1, b.x1); x++) if (gray.data[y * w + x] < ink) c++
      return c
    }
    const up: PixelBox = { x0: x0 + pad, x1: x1 - pad, y0: y0 + 1, y1: divider - 1 }
    const lo: PixelBox = { x0: x0 + pad, x1: x1 - pad, y0: divider + 1, y1: y1 - 1 }
    if (halfInk(up) < 6 || halfInk(lo) < 6) continue
    out.push({
      id: `co_${x0}_${y0}`,
      centre: { x: cx, y: cy },
      radiusPx: bw / 2,
      upper: up,
      lower: lo,
      leaderEnd: traceLeader(gray, { x: cx, y: cy }, bw / 2, ink),
    })
  }
  return out
}

/**
 * Follow the leader line out of a callout to whatever it points at.
 *
 * The leader leaves the ring horizontally on these plans and ends on the
 * opening it labels. Tracing it is what turns "a 90/230 exists somewhere" into
 * "this jamb pair is 0.90 m wide", which is the difference between a token and
 * a constraint (§12).
 */
function traceLeader(gray: GrayImage, centre: Point2, radius: number, ink: number): Point2 | null {
  const w = gray.width
  const h = gray.height
  const isInk = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < w && y < h && gray.data[y * w + x] < ink
  const cy = Math.round(centre.y)
  for (const dir of [1, -1]) {
    const x0 = Math.round(centre.x + dir * (radius + 2))
    // The leader must start at the ring's edge on this side.
    let found = false
    for (let dy = -1; dy <= 1 && !found; dy++) if (isInk(x0, cy + dy)) found = true
    if (!found) continue
    let x = x0
    let y = cy
    let gap = 0
    while (x > 0 && x < w - 1 && gap < 4) {
      let stepped = false
      for (const dy of [0, -1, 1]) {
        if (isInk(x + dir, y + dy)) {
          x += dir
          y += dy
          stepped = true
          break
        }
      }
      if (stepped) gap = 0
      else {
        x += dir
        gap++
      }
    }
    if (Math.abs(x - x0) > radius) return { x: x - dir * gap, y }
  }
  return null
}

/**
 * Level-marker text zones on a section or elevation.
 *
 * A level marker is a signed number sitting just above a horizontal reference
 * line — the only annotation on these drawings that carries a sign, which is
 * what the grammar uses to tell `+3.06` from a plan chain's `306`. The zone is
 * the band above the line, restricted to the short stretch where text actually
 * sits rather than the line's whole length.
 */
export function detectLevelZones(
  lines: readonly DetectedLine[],
  gray: GrayImage,
  opts: DimensionGeometryOptions,
  ink: number,
): LevelMarkerZone[] {
  const w = gray.width
  const out: LevelMarkerZone[] = []
  for (const line of lines) {
    if (line.orientation !== 'HORIZONTAL') continue
    const band = opts.labelBand
    const y0 = Math.max(0, line.position - band)
    const y1 = Math.max(0, line.position - 2)
    if (y1 <= y0) continue
    // Columns in the band that carry ink, clustered into text stretches.
    let runStart = -1
    let gap = 0
    for (let x = line.from; x <= line.to + 1; x++) {
      let on = false
      for (let y = y0; y <= y1 && !on; y++) if (x <= line.to && gray.data[y * w + x] < ink) on = true
      if (on) {
        if (runStart < 0) runStart = x
        gap = 0
      } else if (runStart >= 0) {
        gap++
        if (gap > 4) {
          const end = x - gap
          if (end - runStart >= 8 && end - runStart <= band * 6) {
            out.push({ id: `lv_${line.position}_${runStart}`, box: { x0: runStart, x1: end, y0, y1 }, row: line.position })
          }
          runStart = -1
          gap = 0
        }
      }
    }
  }
  return out
}

/** Everything §6 asks for, in one pass over a source-native drawing. */
export function detectDimensionGeometry(
  gray: GrayImage,
  opts: DimensionGeometryOptions = DEFAULT_DIMENSION_GEOMETRY,
): DimensionGeometry {
  const notes: string[] = []
  const white = whiteLevel(gray)
  const ink = Math.max(40, Math.round(white * opts.inkFraction))
  const bounds: PixelBox = { x0: 0, y0: 0, x1: gray.width - 1, y1: gray.height - 1 }

  const lines = detectLines(gray, opts, ink)
  for (const line of lines) line.ticks = detectTicks(gray, line, opts, ink)
  // A dimension line carries at least one measured interval; a construction or
  // hatching line carries none. One interval is enough: an overall dimension
  // is drawn on its own line with a tick at each end, and requiring three
  // anchors discards exactly the label that pins a chain's total.
  const dimensionLines = lines.filter((l) => l.ticks.length >= 2)
  notes.push(`${lines.length} thin lines, ${dimensionLines.length} carrying ticks`)

  const zones = dimensionLines.flatMap((l) => labelZonesFor(l, opts, bounds))
  const callouts = detectCallouts(gray, opts, ink)
  const levels = detectLevelZones(lines, gray, opts, ink)
  const slantRad = estimateSlant(
    gray,
    [...zones.map((z) => z.box), ...callouts.map((c) => c.upper)],
    ink,
  )
  notes.push(`${zones.length} label zones, ${callouts.length} callouts, ${levels.length} level zones`)
  notes.push(`text slant ${((slantRad * 180) / Math.PI).toFixed(1)}°`)

  return { lines: dimensionLines, zones, callouts, levels, slantRad, inkThreshold: ink, notes }
}

export type ChainFamily = {
  id: string
  orientation: 'HORIZONTAL' | 'VERTICAL'
  /** The line carrying the total, when the drawing printed one. */
  overall: DetectedLine | null
  /** Lines carrying measured intervals. */
  parts: DetectedLine[]
}

/**
 * Group dimension lines into chains.
 *
 * A dimensioned drawing stacks its chains: an inner line divided into
 * intervals, an outer line with a single interval spanning the lot. They are
 * one statement — the parts of this, summed, are that — and reading them
 * separately loses the only arithmetic check available on a printed dimension.
 *
 * Grouping is geometric and convention-free: lines of the same orientation
 * whose positions are within a band and whose spans substantially overlap
 * belong together, and within a family the single-interval line covering the
 * whole span is the total.
 */
export function chainFamilies(lines: readonly DetectedLine[], bandPx = 40, overlapFraction = 0.6): ChainFamily[] {
  const families: ChainFamily[] = []
  const remaining = [...lines].sort((a, b) => b.ticks.length - a.ticks.length || a.position - b.position)
  const used = new Set<string>()
  for (const seed of remaining) {
    if (used.has(seed.id)) continue
    const group = [seed]
    used.add(seed.id)
    for (const other of remaining) {
      if (used.has(other.id) || other.orientation !== seed.orientation) continue
      if (Math.abs(other.position - seed.position) > bandPx) continue
      const lo = Math.max(seed.from, other.from)
      const hi = Math.min(seed.to, other.to)
      const overlap = hi - lo
      const shorter = Math.min(seed.to - seed.from, other.to - other.from)
      if (shorter <= 0 || overlap / shorter < overlapFraction) continue
      group.push(other)
      used.add(other.id)
    }
    const span = (l: DetectedLine): number =>
      l.ticks.length >= 2 ? l.ticks[l.ticks.length - 1] - l.ticks[0] : l.to - l.from
    const widest = Math.max(...group.map(span))
    const totals = group.filter((l) => l.ticks.length === 2 && span(l) >= widest * 0.92)
    const parts = group.filter((l) => !totals.includes(l) && l.ticks.length >= 2)
    if (parts.length === 0 && totals.length > 0) {
      // A lone total is still a dimension: it measures one interval.
      families.push({ id: `fam_${seed.id}`, orientation: seed.orientation, overall: null, parts: [totals[0]] })
      continue
    }
    families.push({
      id: `fam_${seed.id}`,
      orientation: seed.orientation,
      overall: totals.length > 0 ? totals[0] : null,
      parts,
    })
  }
  return families
}

/**
 * Sub-pixel row (or column) of a detected line.
 *
 * The integer `position` a scanline search returns is good to a pixel, and a
 * pixel is 1.4 cm on these drawings — the same order as the centimetre grid
 * the dimensions are printed on, which is exactly the precision the whole
 * prediction chain depends on. The ink-weighted centroid across the line's own
 * thickness recovers the missing fraction.
 */
export function refineLinePosition(gray: GrayImage, line: DetectedLine, ink: number, reach = 3): number {
  const w = gray.width
  const h = gray.height
  let num = 0
  let den = 0
  const step = Math.max(1, Math.floor((line.to - line.from) / 128))
  for (let t = line.from; t <= line.to; t += step) {
    for (let d = -reach; d <= reach; d++) {
      const p = line.position + d
      const x = line.orientation === 'HORIZONTAL' ? t : p
      const y = line.orientation === 'HORIZONTAL' ? p : t
      if (x < 0 || y < 0 || x >= w || y >= h) continue
      const v = gray.data[y * w + x]
      if (v >= ink) continue
      const weight = (ink - v) / ink
      num += p * weight
      den += weight
    }
  }
  return den > 0 ? num / den : line.position
}
