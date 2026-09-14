/** Vertical scan of one column: runs of similar colour, reported in metres. */
import { readFileSync } from 'node:fs'
import { PNG } from 'pngjs'
const [src, X0, S, Y0, colM, ya, yb] = process.argv.slice(2)
const p = PNG.sync.read(readFileSync(src))
const x0=+X0, s=+S, y0=+Y0
const px = Math.round(x0 + (+colM) * s)
const at=(x,y)=>{const i=(y*p.width+x)*4;return [p.data[i],p.data[i+1],p.data[i+2]]}
console.log(`col ${colM} m -> px ${px}`)
let prev=null,start=+ya
for(let y=+ya;y<=+yb;y++){
  const [r,g,b]=at(px,y)
  const key=`${Math.round(r/8)*8},${Math.round(g/8)*8},${Math.round(b/8)*8}`
  if(prev===null){prev=key;start=y;continue}
  if(key!==prev){ if(y-start>=3) console.log(`  y ${((y0-(y-1))/Math.abs(s)).toFixed(3)} .. ${((y0-start)/Math.abs(s)).toFixed(3)}  py ${start}..${y-1}  rgb ${prev}`); prev=key;start=y }
}
if(+yb-start>=3) console.log(`  y ${((y0-(+yb))/Math.abs(s)).toFixed(3)} .. ${((y0-start)/Math.abs(s)).toFixed(3)}  py ${start}..${yb}  rgb ${prev}`)
