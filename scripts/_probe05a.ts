import { marcowkiGoldScene, roofPlaneFrames } from '../src/core/wallspec/marcowki-roof-features-fixture.js'
import { roofOpeningCutReport, chimneyPenetrationReport, chimneyClearanceM } from '../tests/roof-feature-oracles.js'

const s = marcowkiGoldScene()
const frames = roofPlaneFrames(s.spec.building)
for (const o of s.building.roofOpenings) {
  const f = frames.get(o.planeId)!
  const r = roofOpeningCutReport(s.tris, f, o.openingId, o.cutUV)
  console.log(o.openingId, JSON.stringify({ through: +r.throughM.toFixed(6), beside: +r.besideM.toFixed(4),
    besideMin: +r.besideMinM.toFixed(4), reveals: r.revealTriangles, revealArea: +r.revealAreaM2.toFixed(4),
    fill: +r.fillM.toFixed(4), stray: +r.strayFillM.toFixed(6) }))
}
for (const m of s.building.masses) {
  const spec = (s.spec.building.masses ?? []).find((x) => x.id === m.massId)!
  const r = chimneyPenetrationReport(s.tris, m.massId, spec.footprint, m.baseM, m.topM)
  const worstOverlap = Math.max(...r.sections.map((x) => x.overlapM))
  console.log(m.massId, JSON.stringify({ continuous: r.continuous, minRun: +r.minRunM.toFixed(4),
    roofInside: +r.roofInsideM.toFixed(6), roofBeside: +r.roofBesideM.toFixed(4), worstOverlap: +worstOverlap.toFixed(6) }))
  for (const d of [{x:1,y:0,z:0},{x:-1,y:0,z:0},{x:0,y:0,z:1},{x:0,y:0,z:-1}]) {
    console.log('   clearance at y=6.0 dir', JSON.stringify(d), chimneyClearanceM(s.tris, m.massId, spec.footprint, 6.0, d).toFixed(6))
  }
}
