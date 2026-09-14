/** Print a horizontal scan of RGB classes across an elevation row, in metres. */
import { readFileSync } from 'node:fs'
import { PNG } from 'pngjs'
const [src, X0, S, Y0, rowM, xa, xb] = process.argv.slice(2)
const p = PNG.sync.read(readFileSync(src))
const x0=+X0, s=+S, y0=+Y0
const py = Math.round(y0 - (+rowM) * Math.abs(s))
const at=(x,y)=>{const i=(y*p.width+x)*4;return [p.data[i],p.data[i+1],p.data[i+2]]}
console.log(`row y=${rowM} m -> py ${py}`)
let prev = null, start = +xa
for(let x=+xa;x<=+xb;x++){
  const [r,g,b]=at(x,py)
  const key = `${Math.round(r/6)*6},${Math.round(g/6)*6},${Math.round(b/6)*6}`
  if(prev===null){prev=key;start=x;continue}
  if(key!==prev){
    if(x-start>=3) console.log(`  ${((start-x0)/s).toFixed(3)} .. ${((x-1-x0)/s).toFixed(3)}  px ${start}..${x-1}  rgb ${prev}`)
    prev=key;start=x
  }
}
if(+xb-start>=3) console.log(`  ${((start-x0)/s).toFixed(3)} .. ${((+xb-x0)/s).toFixed(3)}  px ${start}..${xb}  rgb ${prev}`)
