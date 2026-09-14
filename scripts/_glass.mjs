/** Blue-ish (glazing/sky-reflecting) runs in the roof band of an elevation. */
import { readFileSync } from 'node:fs'
import { PNG } from 'pngjs'
const [src,X0,S,Y0,ya,yb,base]=process.argv.slice(2)
const p=PNG.sync.read(readFileSync(src))
const x0=+X0,s=+S,y0=+Y0,B=+base
const at=(x,y)=>{const i=(y*p.width+x)*4;return [p.data[i],p.data[i+1],p.data[i+2]]}
const py0=Math.round(y0-(+yb)*Math.abs(s)), py1=Math.round(y0-(+ya)*Math.abs(s))
const cols=[]
for(let x=0;x<p.width;x++){let n=0;for(let y=py0;y<=py1;y++){const[r,g,b]=at(x,y); if(b>r+22&&b>150)n++} cols.push(n)}
let st=-1
for(let x=0;x<=p.width;x++){const on=x<p.width&&cols[x]>=4
  if(on&&st<0)st=x; if(!on&&st>=0){ if(x-st>=5) console.log(`  ${(B+(st-x0)/s).toFixed(3)} .. ${(B+(x-1-x0)/s).toFixed(3)}  px ${st}..${x-1}  peak ${Math.max(...cols.slice(st,x))}`); st=-1}}
