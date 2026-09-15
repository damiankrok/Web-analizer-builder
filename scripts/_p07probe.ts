import { loadSource } from '../src/node/source-loader.js'
import { inkChannel } from '../src/core/extract/raster-normalize.js'
import { buildTextCrops } from '../src/core/extract/text-crops.js'
import { TesseractEngine } from '../src/node/ocr/tesseract.js'
import { findSectionAnnotations } from '../src/core/extract/section-annotations.js'
import { buildDatumObservations, solveVerticalScale, reconcileRejected, hintSemantics } from '../src/core/extract/vertical-datums.js'
import type { PlanTextReading } from '../src/core/extract/text-engine.js'

const proj = process.argv[2] ?? 'A-marcowki'
const url = process.argv[3] ?? 'https://www.archon.pl/projekty-domow/projekt-dom-w-marcowkach-ge-m2fa281446a8ca'
const r = await loadSource(url, { cacheDir: `fixtures/${proj}/assets`, htmlPath: `fixtures/${proj}/page.html` })
const sec = r.pkg.assets.find((a) => a.roles?.document === 'SECTION')!
const gray = inkChannel(r.images.get(sec.id)!)
const res = findSectionAnnotations(gray)
for (const n of res.notes) console.log(n)
const engine = new TesseractEngine()
const PADS = [0, 0.5, 1.0, 1.5]
const marks = res.annotations.filter((a) => a.kind === 'LEVEL_MARKER')
const per = new Map<string, Array<{ reading: PlanTextReading; conditioning: string }>>()
for (const pad of PADS) {
  const crops = buildTextCrops(gray, marks.map((a) => {
    const m = a.textHeightPx * pad
    return { id: `${a.id}#${pad}`, box: { x0: a.box.x0 - m, y0: a.box.y0 - m * 0.3, x1: a.box.x1 + m, y1: a.box.y1 + m * 0.3 }, orientation: a.orientation }
  }))
  for (const rd of engine.readBatch(crops, { alphabet: '0123456789,.+-±', singleLine: true })) {
    const id = rd.cropId.split('#')[0]
    const list = per.get(id) ?? []
    list.push({ reading: rd, conditioning: `${pad} text-heights of paper` })
    per.set(id, list)
  }
}
const obs = buildDatumObservations(sec.id, marks, (id) => per.get(id) ?? [])
const sol = solveVerticalScale(obs, undefined, gray.height)
console.log('\nSOLUTION:', sol ? sol.why : 'none')
if (sol) {
  console.log(`  ${sol.pixelsPerMetre.toFixed(4)} px/m, datum row ${sol.datumRow.toFixed(2)}, rms ${(sol.rmsResidualM * 1000).toFixed(1)} mm, spread ${(sol.pairSpread * 100).toFixed(2)}%`)
  const nRec = reconcileRejected(obs, sol)
  console.log(`  reconciled ${nRec}`)
  hintSemantics(obs)
  console.log('  pair scales:', sol.pairScales.map((p) => p.pixelsPerMetre.toFixed(2)).join(' '))
  console.log('  residuals:', sol.residualsM.map((x) => `${x.id.slice(-6)}=${(x.residualM * 1000).toFixed(0)}mm`).join(' '))
}
console.log('\nOBSERVATIONS:')
for (const o of obs) {
  console.log(`  ${o.status.padEnd(11)} row ${o.markerPx.y.toFixed(2)} ${o.association.padEnd(14)} value ${o.parsedLevelM === null ? '   none' : o.parsedLevelM.toFixed(3).padStart(7)} pred ${o.predictedLevelM?.toFixed(3) ?? '-'} hint ${o.semanticHint.padEnd(12)} conf ${o.confidence.toFixed(2)}`)
  console.log(`      ${o.why}`)
}

// --- roof
import { analyseSectionRoof } from '../src/core/extract/section-roof.js'
const roof = analyseSectionRoof(gray, res.inkThreshold, sol!.datumRow)
console.log('\nROOF:')
for (const n of roof.notes) console.log('  ' + n)
const lv = (row: number) => ((sol!.datumRow - row) / sol!.pixelsPerMetre).toFixed(3)
for (const e of roof.edges) console.log(`  ${e.id} ${e.kind} ${e.slopeDeg.toFixed(2)}deg x${e.fromX}..${e.toX} y ${(e.intercept + e.slope*e.fromX).toFixed(1)}..${(e.intercept + e.slope*e.toX).toFixed(1)} => ${lv(e.intercept + e.slope*e.fromX)}m..${lv(e.intercept + e.slope*e.toX)}m rms${e.rmsPx.toFixed(2)}`)
if (roof.ridge) console.log(`  RIDGE at x${roof.ridge.x.toFixed(1)} row ${roof.ridge.y.toFixed(2)} => ${lv(roof.ridge.y)} m, pitches ${roof.ridge.leftPitchDeg.toFixed(2)} / ${roof.ridge.rightPitchDeg.toFixed(2)}`)
for (const e of roof.eaves) console.log(`  eave ${e.edgeId} ${e.side} x${e.x.toFixed(0)} row ${e.y.toFixed(1)} => ${lv(e.y)} m`)
for (const s of roof.soffits) console.log(`  soffit ${s.edgeId} thickness ${s.thicknessPx} px = ${(s.thicknessPx / sol!.pixelsPerMetre).toFixed(3)} m, rms ${s.rmsPx.toFixed(2)}`)

// --- pitch callouts
import { calloutsAlongLine, obliqueCalloutCrop, parsePitchText, DEFAULT_OBLIQUE_TEXT } from '../src/core/extract/oblique-text.js'
import { DEFAULT_SECTION_ANNOTATIONS } from '../src/core/extract/section-annotations.js'
import { pitchTextOptions } from '../src/core/extract/section-read.js'
console.log('\nPITCH CALLOUTS:')
for (const e of roof.edges.filter((x) => x.kind === 'PITCHED')) {
  const cs = calloutsAlongLine(gray, e, DEFAULT_SECTION_ANNOTATIONS.regions, DEFAULT_OBLIQUE_TEXT)
  console.log(`  ${e.id} (${e.pitchDeg.toFixed(2)}deg): ${cs.length} callouts`)
  const crops = cs.map((c) => { const { gray: cg, scale } = obliqueCalloutCrop(gray, c); return { id: `${e.id}:${c.id}`, gray: cg, sourceBox: c.box, orientation: 'HORIZONTAL' as const, scale } })
  for (const rd of engine.readBatch(crops, pitchTextOptions())) {
    const c = cs.find((x) => `${e.id}:${x.id}` === rd.cropId)!
    console.log(`    ${rd.cropId} "${rd.text}" c${rd.confidence.toFixed(2)} -> pitch ${parsePitchText(rd.text)} | at ${c.centre.x.toFixed(0)},${c.centre.y.toFixed(0)} off ${c.offsetPx.toFixed(1)} glyphs ${c.glyphs} box ${c.box.x0},${c.box.y0}..${c.box.x1},${c.box.y1}`)
  }
}
