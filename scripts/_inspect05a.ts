import { marcowkiGoldScene, roofPlaneFrames, chimneyMasses } from '../src/core/wallspec/marcowki-roof-features-fixture.js'
const s = marcowkiGoldScene()
console.log('diagnostics:', s.diagnostics.length)
for (const d of s.diagnostics) console.log(' ', d.layer, d.severity, d.code, d.message)
console.log('building roofs:', JSON.stringify(s.building.roofs.map(r => ({ id: r.roofId, pitch: r.builtPitchDeg, tri: r.triCount, planes: r.planes.map(p => `${p.planeId} ${p.lengthU.toFixed(3)}x${p.lengthV.toFixed(3)}`) })), null, 1))
console.log('roof openings:')
for (const o of s.building.roofOpenings) console.log(' ', o.openingId, o.planeId, o.kind,
  `u ${o.cutUV.u0.toFixed(3)}..${o.cutUV.u1.toFixed(3)} v ${o.cutUV.v0.toFixed(3)}..${o.cutUV.v1.toFixed(3)}`,
  `area ${o.cutAreaM2.toFixed(4)} removed ${o.removedVolumeM3.toFixed(4)}`)
console.log('masses:', JSON.stringify(s.building.masses, null, 1))
const byPart = new Map<string, number>()
for (const t of s.tris) byPart.set(t.part, (byPart.get(t.part) ?? 0) + 1)
console.log('scene tris by part:', [...byPart].sort())
