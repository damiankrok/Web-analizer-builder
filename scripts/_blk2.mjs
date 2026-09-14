/** Per-row and per-column dark runs inside a window, in plan metres. */
import { readFileSync } from 'node:fs'
import { PNG } from 'pngjs'
const [src, X0, Y0, X1, Y1, PLAN, THR] = process.argv.slice(2)
const C = PLAN === 'ground'
  ? { x0Px: 58, x1Px: 513, z0Px: 259, z1Px: 735, widthM: 12.05, depthM: 12.6 }
  : { x0Px: 47, x1Px: 345.2, z0Px: 195.3, z1Px: 670.8, widthM: 7.9, depthM: 12.6 }
const sx=(C.x1Px-C.x0Px)/C.widthM, sz=(C.z1Px-C.z0Px)/C.depthM
const p = PNG.sync.read(readFileSync(src))
const lum=(x,y)=>{const i=(y*p.width+x)*4;return 0.299*p.data[i]+0.587*p.data[i+1]+0.114*p.data[i+2]}
const thr = THR===undefined?60:+THR
const [x0,y0,x1,y1]=[+X0,+Y0,+X1,+Y1]
for(let y=y0;y<=y1;y++){
  const runs=[]; let s=-1
  for(let x=x0;x<=x1+1;x++){ const d = x<=x1 && lum(x,y)<thr
    if(d&&s<0)s=x; if(!d&&s>=0){ if(x-s>=3) runs.push(`${((s-C.x0Px)/sx).toFixed(3)}..${((x-C.x0Px)/sx).toFixed(3)}`); s=-1 } }
  if(runs.length) console.log(`  z=${((y-C.z0Px)/sz).toFixed(3)} (py ${y}):  x ${runs.join('  ')}`)
}
