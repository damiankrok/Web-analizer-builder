/** Report dashed-line coverage per column/row in a window, in plan metres. */
import { readFileSync } from 'node:fs'
import { PNG } from 'pngjs'
const [src, X0, Y0, X1, Y1, PLAN] = process.argv.slice(2)
const C = PLAN === 'ground'
  ? { x0Px: 58, x1Px: 513, z0Px: 259, z1Px: 735, widthM: 12.05, depthM: 12.6 }
  : { x0Px: 47, x1Px: 345.2, z0Px: 195.3, z1Px: 670.8, widthM: 7.9, depthM: 12.6 }
const sx = (C.x1Px - C.x0Px) / C.widthM, sz = (C.z1Px - C.z0Px) / C.depthM
const xm = (px) => (px - C.x0Px) / sx, zm = (py) => (py - C.z0Px) / sz
const p = PNG.sync.read(readFileSync(src))
const px = (x, y) => { const i = (y * p.width + x) * 4; return [p.data[i], p.data[i+1], p.data[i+2]] }
const lum = (x, y) => { const [r,g,b] = px(x,y); return 0.299*r + 0.587*g + 0.114*b }
const sat = (x, y) => { const [r,g,b] = px(x,y); return Math.max(r,g,b) - Math.min(r,g,b) }
const isDash = (x, y) => sat(x,y) < 30 && lum(x,y) > 55 && lum(x,y) < 185
const [x0,y0,x1,y1] = [+X0,+Y0,+X1,+Y1]
console.log('columns:')
for (let x = x0; x <= x1; x++) { let n = 0; for (let y = y0; y <= y1; y++) if (isDash(x,y)) n++
  if (n >= (y1-y0+1) * 0.25) console.log(`  px ${x}  x=${xm(x).toFixed(3)} m   ${n}/${y1-y0+1}`) }
console.log('rows:')
for (let y = y0; y <= y1; y++) { let n = 0; for (let x = x0; x <= x1; x++) if (isDash(x,y)) n++
  if (n >= (x1-x0+1) * 0.25) console.log(`  px ${y}  z=${zm(y).toFixed(3)} m   ${n}/${x1-x0+1}`) }
