/** Topmost non-sky pixel per column, in building coordinates. */
import { readFileSync } from 'node:fs'
import { PNG } from 'pngjs'
const [src, X0, S, Y0, xa, xb, step] = process.argv.slice(2)
const p = PNG.sync.read(readFileSync(src))
const x0=+X0, s=+S, y0=+Y0
const at=(x,y)=>{const i=(y*p.width+x)*4;return [p.data[i],p.data[i+1],p.data[i+2]]}
const isSky=(x,y)=>{const [r,g,b]=at(x,y); return b>r+8 && b>110 && g>r-10}
const isVeg=(x,y)=>{const [r,g,b]=at(x,y); return g>r+10 && g>b+10}
for(let x=+xa;x<=+xb;x+=+(step??1)){
  let y=0
  while(y<p.height && (isSky(x,y)||isVeg(x,y))) y++
  console.log(`px ${x}  Z/X=${((x-x0)/s).toFixed(3)}  topPy=${y}  y=${((y0-y)/Math.abs(s)).toFixed(3)}`)
}
