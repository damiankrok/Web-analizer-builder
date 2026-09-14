/** Section scan: ink runs along a row/column, in metres from the section datums. */
import { readFileSync } from 'node:fs'
import { PNG } from 'pngjs'
// datums: y=0.00 at row 642, y=3.06 at row 420  -> 72.549 px/m
const PY0 = 642, SY = (642 - 420) / 3.06
const [mode, src, at, THR] = process.argv.slice(2)
const p = PNG.sync.read(readFileSync(src))
const lum=(x,y)=>{const i=(y*p.width+x)*4;return 0.299*p.data[i]+0.587*p.data[i+1]+0.114*p.data[i+2]}
const thr = THR===undefined?90:+THR
const yM = (py)=> (PY0-py)/SY
if (mode === 'col') {
  const px = Math.round(+at)
  let s=-1
  for(let y=0;y<=p.height;y++){ const d = y<p.height && lum(px,y)<thr
    if(d&&s<0)s=y; if(!d&&s>=0){ if(y-s>=2) console.log(`  y ${yM(y-1).toFixed(3)} .. ${yM(s).toFixed(3)}  (${((y-s)/SY).toFixed(3)} m)  py ${s}..${y-1}`); s=-1 } }
} else {
  const py = Math.round(PY0 - (+at)*SY)
  console.log(`row y=${at} m -> py ${py}`)
  let s=-1
  for(let x=0;x<=p.width;x++){ const d = x<p.width && lum(x,py)<thr
    if(d&&s<0)s=x; if(!d&&s>=0){ if(x-s>=2) console.log(`  px ${s}..${x-1}  (${x-s} px)`); s=-1 } }
}
