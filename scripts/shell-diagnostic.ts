/**
 * STAGE WEB-PIVOT-07 §36 — look at what the shell extraction saw.
 *
 *   npx tsx scripts/shell-diagnostic.ts A          every sheet, for A
 *   npx tsx scripts/shell-diagnostic.ts B sheet    one combined sheet, for B
 *
 * Writes the seventeen development outputs §36 asks for, as PNG overlays and
 * as text tables, under `out/shell/<slug>/diag`. Nothing here is part of the
 * pipeline: the diagnostics read what the runner produced and draw it.
 *
 * The drawings are faded under their overlays so a reader can check a fitted
 * line against the ink it was fitted to.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import type { RasterImage } from '../src/core/contracts/raster.js'
import { loadSource } from '../src/node/source-loader.js'
import { projectByKey } from '../src/node/projects.js'
import { extractPlanSpec, DEFAULT_EXTRACTION } from '../src/node/extract-runner.js'
import { extractShell, DEFAULT_SHELL } from '../src/node/shell-runner.js'
import { inkChannel } from '../src/core/extract/raster-normalize.js'
import { existsSync, readFileSync } from 'node:fs'

const project = projectByKey(process.argv[2] ?? 'A')
if (!project) throw new Error(`unknown project ${process.argv[2]}`)
if (project.role === 'HOLDOUT' && !process.argv.includes('--holdout-one-shot')) {
  throw new Error('the holdout is not looked at outside its one run (§33)')
}
const combined = process.argv.includes('sheet')
const outDir = join('out', 'shell', project.slug, 'diag')
mkdirSync(outDir, { recursive: true })

const loaded = await loadSource(project.url, {
  cacheDir: `fixtures/${project.slug}/assets`,
  htmlPath: `fixtures/${project.slug}/page.html`,
})
const plan = extractPlanSpec(loaded.pkg, loaded.images, DEFAULT_EXTRACTION, {
  sourcePackageId: loaded.source.packageId,
  sourcePackageHash: loaded.source.contentHash,
})
const { shell, debug } = extractShell(loaded.pkg, loaded.images, plan.candidate, DEFAULT_SHELL)

// --- drawing helpers ------------------------------------------------------

type Canvas = { png: PNG; w: number; h: number }
const faded = (img: RasterImage, fade = 0.72): Canvas => {
  const png = new PNG({ width: img.width, height: img.height })
  for (let i = 0; i < img.width * img.height; i++) {
    png.data[i * 4] = 255 - (255 - img.data[i * 4]) * (1 - fade)
    png.data[i * 4 + 1] = 255 - (255 - img.data[i * 4 + 1]) * (1 - fade)
    png.data[i * 4 + 2] = 255 - (255 - img.data[i * 4 + 2]) * (1 - fade)
    png.data[i * 4 + 3] = 255
  }
  return { png, w: img.width, h: img.height }
}
const dot = (c: Canvas, x: number, y: number, col: [number, number, number]): void => {
  const xi = Math.round(x)
  const yi = Math.round(y)
  if (xi < 0 || yi < 0 || xi >= c.w || yi >= c.h) return
  const i = (yi * c.w + xi) * 4
  c.png.data[i] = col[0]
  c.png.data[i + 1] = col[1]
  c.png.data[i + 2] = col[2]
}
const line = (c: Canvas, x0: number, y0: number, x1: number, y1: number, col: [number, number, number]): void => {
  const steps = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0)))
  for (let i = 0; i <= steps; i++) dot(c, x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps, col)
}
const rect = (c: Canvas, x0: number, y0: number, x1: number, y1: number, col: [number, number, number]): void => {
  line(c, x0, y0, x1, y0, col)
  line(c, x1, y0, x1, y1, col)
  line(c, x1, y1, x0, y1, col)
  line(c, x0, y1, x0, y0, col)
}
const save = (c: Canvas, name: string): void => {
  writeFileSync(join(outDir, name), PNG.sync.write(c.png))
  console.log(`  ${name}`)
}
const text = (name: string, body: string): void => {
  writeFileSync(join(outDir, name), `${body}\n`, 'utf8')
  console.log(`  ${name}`)
}

const RED: [number, number, number] = [220, 30, 30]
const BLUE: [number, number, number] = [20, 90, 220]
const GREEN: [number, number, number] = [10, 150, 60]
const ORANGE: [number, number, number] = [235, 130, 0]
const PURPLE: [number, number, number] = [150, 40, 190]

console.log(`\ndiagnostics for ${project.key}: ${project.name}`)

// --- 1, 2, 3: the section -------------------------------------------------
const sectionImage = debug.sectionAssetId ? loaded.images.get(debug.sectionAssetId) : undefined
if (sectionImage) {
  const c = faded(sectionImage)
  for (const a of debug.annotations) {
    const col = a.kind === 'LEVEL_MARKER' ? RED : a.kind === 'VERTICAL_DIMENSION' ? BLUE : a.kind === 'PITCH_CALLOUT' ? GREEN : ORANGE
    rect(c, a.box.x0, a.box.y0, a.box.x1, a.box.y1, col)
    if (a.shelf) line(c, a.shelf.fromPx, a.shelf.row, a.shelf.toPx, a.shelf.row, PURPLE)
    if (a.level) {
      line(c, 0, a.level.row, c.w - 1, a.level.row, RED)
      if (a.level.columnPx !== null) for (let d = -4; d <= 4; d++) dot(c, a.level.columnPx + d, a.level.row, GREEN)
    }
    if (a.span) line(c, a.span.columnPx, a.span.fromRow, a.span.columnPx, a.span.toRow, BLUE)
  }
  save(c, '01-section-datum-lines.png')

  text(
    '02-section-ocr-readings.txt',
    [
      'Every figure the section offers, at every conditioning, and what the engine made of it.',
      '',
      ...shell.verticalDatums.flatMap((d) => [
        `${d.id}  row ${d.markerPx.y.toFixed(2)}  ${d.association}  residual ${d.associationResidualPx.toFixed(2)} px  -> ${d.status}`,
        ...d.hypotheses.map((h) => `    "${h.rawText}" (${h.conditioning}, conf ${h.confidence.toFixed(2)}) = ${h.valueM} m  [${h.how}]`),
        `    accepted: ${d.acceptedHypothesis ? `"${d.acceptedHypothesis.rawText}" = ${d.parsedLevelM} m` : 'none'}`,
        `    ${d.why}`,
        '',
      ]),
    ].join('\n'),
  )

  if (debug.roof) {
    const c3 = faded(sectionImage)
    for (let x = 0; x < debug.roof.skyline.length; x++) {
      if (debug.roof.skyline[x] >= 0) dot(c3, x, debug.roof.skyline[x], ORANGE)
    }
    for (const e of debug.roof.edges) {
      line(c3, e.fromX, e.intercept + e.slope * e.fromX, e.toX, e.intercept + e.slope * e.toX, e.kind === 'FLAT' ? BLUE : RED)
    }
    for (const s of debug.roof.soffits) {
      const e = debug.roof.edges.find((x) => x.id === s.edgeId)
      if (e) line(c3, e.fromX, s.intercept + s.slope * e.fromX, e.toX, s.intercept + s.slope * e.toX, GREEN)
    }
    if (debug.roof.ridge) {
      for (let d = -8; d <= 8; d++) {
        dot(c3, debug.roof.ridge.x + d, debug.roof.ridge.y, PURPLE)
        dot(c3, debug.roof.ridge.x, debug.roof.ridge.y + d, PURPLE)
      }
    }
    save(c3, '03-section-roof-edge-fits.png')
  }
}

// --- 4: datum residuals ---------------------------------------------------
text(
  '04-vertical-datum-residuals.txt',
  [
    `section ${shell.section.assetId ?? 'none'}: ${shell.section.why}`,
    `scale ${shell.section.pixelsPerMetre?.toFixed(4) ?? 'none'} px/m, zero at row ${shell.section.datumRow?.toFixed(2) ?? 'none'}`,
    `rms residual ${shell.section.rmsResidualM === null ? 'n/a' : `${(shell.section.rmsResidualM * 1000).toFixed(2)} mm`}, ` +
      `pairwise spread ${shell.section.pairSpread === null ? 'n/a' : `${(shell.section.pairSpread * 100).toFixed(3)}%`}`,
    '',
    'marker              row     printed   predicted   residual   status',
    ...shell.verticalDatums.map(
      (d) =>
        `${d.id.padEnd(18)} ${d.markerPx.y.toFixed(2).padStart(7)} ${(d.parsedLevelM === null ? '—' : d.parsedLevelM.toFixed(3)).padStart(9)} ` +
        `${(d.predictedLevelM === null ? '—' : d.predictedLevelM.toFixed(3)).padStart(11)} ` +
        `${(d.parsedLevelM === null || d.predictedLevelM === null ? '—' : `${((d.parsedLevelM - d.predictedLevelM) * 1000).toFixed(1)}mm`).padStart(10)}   ${d.status}`,
    ),
  ].join('\n'),
)

// --- 5 to 8: one registration/silhouette sheet per elevation --------------
let n = 5
for (const record of shell.elevations) {
  const img = loaded.images.get(record.assetId)
  const sil = debug.silhouettes.get(record.assetId)
  if (!img || !sil) continue
  const c = faded(img)
  for (let x = sil.minX; x <= sil.maxX; x++) if (sil.skyline[x] >= 0) dot(c, x, sil.skyline[x], ORANGE)
  for (const l of sil.lines) {
    line(c, l.fromX, l.intercept + l.slope * l.fromX, l.toX, l.intercept + l.slope * l.toX, l.kind === 'FLAT' ? BLUE : RED)
  }
  line(c, sil.minX, sil.roofTopRow, sil.maxX, sil.roofTopRow, PURPLE)
  line(c, sil.minX, sil.groundRow, sil.maxX, sil.groundRow, PURPLE)
  if (sil.wallSpan) {
    line(c, sil.wallSpan.minX, sil.roofTopRow, sil.wallSpan.minX, sil.groundRow, GREEN)
    line(c, sil.wallSpan.maxX, sil.roofTopRow, sil.wallSpan.maxX, sil.groundRow, GREEN)
  }
  // Every metre of height, so a reader can check the registration by eye.
  for (let m = -1; m <= 12; m++) {
    const row = record.rowAtZero - m * record.pixelsPerMetreY
    if (row < 0 || row >= c.h) continue
    for (let x = sil.minX; x < sil.minX + (m % 5 === 0 ? 40 : 16); x++) dot(c, x, row, BLUE)
  }
  save(c, `${String(n).padStart(2, '0')}-elevation-${record.declaredView.toLowerCase()}-registration.png`)
  n++
}

// --- 9: openings per facade ----------------------------------------------
for (const record of shell.elevations) {
  const img = loaded.images.get(record.assetId)
  const openings = debug.openings.get(record.assetId)
  if (!img || !openings) continue
  const c = faded(img)
  for (const o of openings) {
    rect(c, o.x0, o.y0, o.x1, o.y1, o.evidence.length > 1 ? GREEN : o.evidence[0] === 'DARK_REGION' ? RED : BLUE)
    if (o.rakedTop) line(c, o.x0, o.rakedTop.leftY, o.x1, o.rakedTop.rightY, PURPLE)
  }
  save(c, `09-openings-${record.declaredView.toLowerCase()}.png`)
}

// --- 10: plan to elevation matches ---------------------------------------
text(
  '10-plan-elevation-opening-matches.txt',
  [
    'Every detected opening, where it sits along its facade, and the plan gap it was matched to.',
    '',
    'view    id     along (m)        sill    head   width   match                         residual',
    ...shell.facadeOpenings.map(
      (o) =>
        `${o.view.padEnd(7)} ${o.id.padEnd(6)} ${`${o.alongFromM.toFixed(2)}..${o.alongToM.toFixed(2)}`.padEnd(16)} ` +
        `${o.sillLevelM.toFixed(2).padStart(6)} ${o.headLevelM.toFixed(2).padStart(6)} ${o.widthM.toFixed(2).padStart(6)}   ` +
        `${(o.match ? `${o.match.planWallId}#${o.match.planOpeningIndex}` : o.matchStatus).padEnd(28)} ` +
        `${o.match ? `${(o.match.residualM * 100).toFixed(0)} cm` : ''}`,
    ),
    '',
    'facades as solved:',
    ...shell.elevations.map(
      (e) =>
        `  ${e.declaredView.padEnd(7)} -> ${String(e.solvedSide).padEnd(6)} direction ${String(e.solvedDirection).padStart(2)}  ` +
        `${e.matchedOpenings} opening(s) matched  ${e.horizontalMethod}`,
    ),
  ].join('\n'),
)

// --- 11: roof topology and planes ----------------------------------------
text(
  '11-roof-topology-and-planes.txt',
  [
    `topology ${shell.roofTopology}`,
    ...shell.roofComponents.map((c) => `  ${c.id} ${c.topology} (${c.planes} planes, confidence ${c.confidence.toFixed(2)}) — ${c.why}`),
    '',
    `pitch ${Number.isFinite(shell.pitch.pitchDeg) ? `${shell.pitch.pitchDeg.toFixed(3)}° ±${shell.pitch.toleranceDeg.toFixed(3)}` : 'unresolved'} ` +
      `${shell.pitch.fidelity} ${shell.pitch.status}`,
    ...shell.pitch.observations.map((o) => `  ${o.kind.padEnd(22)} ${o.pitchDeg.toFixed(3)}° ±${o.toleranceDeg.toFixed(3)} — ${o.why}`),
    '',
    'plane    falls    high      low     thickness   support (m)        unresolved',
    ...shell.roofPlanes.map(
      (p) =>
        `${p.id.padEnd(8)} ${p.fallsTowards.padEnd(8)} ${p.ridgeLevel.valueM.toFixed(3).padStart(7)} ${p.eaveLevel.valueM.toFixed(3).padStart(8)} ` +
        `${(p.thickness ? p.thickness.valueM.toFixed(3) : '—').padStart(11)}   ${`${p.supportFromM.toFixed(2)}..${p.supportToM.toFixed(2)}`.padEnd(18)} ${p.unresolved.length}`,
    ),
    '',
    'skyline shapes:',
    ...shell.elevations.map((e) => `  ${e.declaredView.padEnd(7)} ${e.silhouette.shape.kind.padEnd(11)} level span ${(e.silhouette.shape.levelSpanFraction * 100).toFixed(0)}%  pitches ${e.silhouette.shape.pitches.map((x) => x.toFixed(1)).join('/') || '—'}`),
  ].join('\n'),
)

// --- 12: rooflight and chimney evidence ----------------------------------
text(
  '12-rooflight-and-chimney-evidence.txt',
  [
    `${shell.roofOpenings.length} roof openings`,
    ...shell.roofOpenings.map(
      (o) =>
        `  ${o.id}  along ${o.alongPlaneM?.toFixed(2) ?? '—'} m  ${o.widthM?.valueM.toFixed(2) ?? '—'} x ${o.heightM?.valueM.toFixed(2) ?? '—'} m  ` +
        `${o.status}  ${o.why}`,
    ),
    '',
    `${shell.chimneys.length} stacks`,
    ...shell.chimneys.map(
      (c) =>
        `  ${c.id}  ${c.stack ? `${c.stack.view} ${c.stack.alongFromM.toFixed(2)}..${c.stack.alongToM.toFixed(2)} m, top ${c.stack.topLevelM.toFixed(2)} m` : 'no stack'}  ` +
        `${c.crossSource}\n      ${c.why}`,
    ),
  ].join('\n'),
)

// --- 13: recess, balcony and portal evidence -----------------------------
text(
  '13-facade-feature-evidence.txt',
  [
    `${shell.facadeFeatures.length} facade features`,
    ...shell.facadeFeatures.map(
      (f) =>
        `  ${f.kind.padEnd(15)} ${f.view.padEnd(7)} ${f.alongFromM.toFixed(2)}..${f.alongToM.toFixed(2)} m  ` +
        `depth ${f.depth ? `${f.depth.valueM.toFixed(2)} m (${f.depth.fidelity})` : 'UNRESOLVED'}  ${f.status}\n      ${f.why}`,
    ),
  ].join('\n'),
)

// --- 17: the conflict sheet ----------------------------------------------
text(
  '17-cross-source-conflicts.txt',
  [
    `${shell.crossSourceConflicts.length} conflicts`,
    '',
    ...shell.crossSourceConflicts.flatMap((c) => [
      `${c.id}  ${c.kind}  (confidence ${c.confidence.toFixed(2)})`,
      ...c.observations.map((o) => `    saw:  ${o}`),
      `    open: ${c.unresolved}`,
      '',
    ]),
    `${shell.unresolved.length} unresolved:`,
    ...shell.unresolved.map((u) => `    ${u}`),
  ].join('\n'),
)

// --- 14, 15, 16: against the gold, where there is one --------------------
const evalPath = 'out/shell/evaluation.json'
if (!combined && existsSync(evalPath)) {
  const evaluation = JSON.parse(readFileSync(evalPath, 'utf8')) as {
    vertical: Array<Record<string, unknown>>
    roof: Array<Record<string, unknown>>
    facade: Array<Record<string, unknown>>
    characteristic: Array<Record<string, unknown>>
    roofFeatures: Array<Record<string, unknown>>
  }
  const rows = (name: string, list: Array<Record<string, unknown>>): string =>
    [
      name,
      ...list.map(
        (r) =>
          `  ${String(r.field).padEnd(32)} gold ${String(r.expected).padStart(10)}  automatic ${String(r.got).padStart(10)}  ${String(r.status)}`,
      ),
    ].join('\n')
  text('14-automatic-vs-gold-vertical.txt', rows('vertical', evaluation.vertical))
  text('15-automatic-vs-gold-roof.txt', rows('roof', evaluation.roof))
  text(
    '16-automatic-vs-gold-facade.txt',
    `${rows('facade openings', evaluation.facade)}\n\n${rows('characteristic features', evaluation.characteristic)}\n\n${rows('roof features', evaluation.roofFeatures)}`,
  )
}

// --- the single combined sheet, for a regression project -----------------
if (combined) {
  text(
    '00-candidate-sheet.txt',
    [
      `${project.key}: ${project.name}`,
      `section ${shell.section.assetId ?? 'none'} — ${shell.section.why}`,
      `levels: ${shell.levels.map((l) => `${l.role}=${l.level.valueM.toFixed(2)}`).join(' ') || 'none'}`,
      `roof ${shell.roofTopology} (${shell.roofComponents.map((c) => c.topology).join('+') || 'none'}), pitch ${Number.isFinite(shell.pitch.pitchDeg) ? `${shell.pitch.pitchDeg.toFixed(2)}° ${shell.pitch.fidelity}` : 'unresolved'}`,
      `elevations: ${shell.elevations.map((e) => `${e.declaredView}->${e.solvedSide}(${e.matchedOpenings})`).join(' ')}`,
      `openings ${shell.facadeOpenings.length}, matched ${shell.facadeOpenings.filter((o) => o.matchStatus === 'MATCHED').length}`,
      `roof openings ${shell.roofOpenings.length}, stacks ${shell.chimneys.length}, features ${shell.facadeFeatures.length}`,
      `conflicts ${shell.crossSourceConflicts.length}, unresolved ${shell.unresolved.length}`,
    ].join('\n'),
  )
}

console.log(`\nwrote ${outDir}`)
