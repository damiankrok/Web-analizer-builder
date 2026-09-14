/** Runs of the chimney render tone along a row of an elevation, in building coords. */
import { readFileSync } from 'node:fs'
import { PNG } from 'pngjs'
const [src, X0, S, Y0, rowM, base] = process.argv.slice(2)
const p = PNG.sync.read(readFileSync(src))
const x0=+X0, s=+S, y0=+Y0, B=+base
const py = Math.round(y0 - (+rowM) * Math.abs(s))
const at=(x,y)=>{const i=(y*p.width+x)*4;return [p.data[i],p.data[i+1],p.data[i+2]]}
// The chimney is rendered as plain render: neutral, mid grey, and unlike the
// tiled roof it carries no course lines, so it holds one tone for many pixels.
const isCh=(x)=>{const [r,g,b]=at(x,py); const l=(r+g+b)/3; return Math.max(r,g,b)-Math.min(r,g,b)<22 && l>96 && l<125}
let start=-1
for(let x=0;x<=p.width;x++){
  const on = x<p.width && isCh(x)
  if(on&&start<0) start=x
  if(!on&&start>=0){ if(x-start>=8) console.log(`  ${(B+(start-x0)/s).toFixed(3)} .. ${(B+(x-1-x0)/s).toFixed(3)}  (${Math.abs((x-1-start)/s).toFixed(3)} m)  px ${start}..${x-1}`); start=-1 }
}
