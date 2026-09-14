/** Bounds of the solid-ink block inside a window, in plan metres. */
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
console.log('columns with >=60% ink:')
const cs=[]; for(let x=x0;x<=x1;x++){let n=0;for(let y=y0;y<=y1;y++) if(lum(x,y)<thr)n++; if(n>=(y1-y0+1)*0.6) cs.push(x)}
console.log(`  px ${cs[0]}..${cs[cs.length-1]}  x = ${((cs[0]-C.x0Px)/sx).toFixed(3)} .. ${((cs[cs.length-1]+1-C.x0Px)/sx).toFixed(3)} m  (${((cs.length)/sx).toFixed(3)} m)`)
const rs=[]; for(let y=y0;y<=y1;y++){let n=0;for(let x=x0;x<=x1;x++) if(lum(x,y)<thr)n++; if(n>=(x1-x0+1)*0.6) rs.push(y)}
console.log('rows with >=60% ink:')
console.log(`  px ${rs[0]}..${rs[rs.length-1]}  z = ${((rs[0]-C.z0Px)/sz).toFixed(3)} .. ${((rs[rs.length-1]+1-C.z0Px)/sz).toFixed(3)} m  (${((rs.length)/sz).toFixed(3)} m)`)
