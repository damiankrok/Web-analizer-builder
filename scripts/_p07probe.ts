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
