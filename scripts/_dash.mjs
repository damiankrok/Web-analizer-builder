/** Find dashed-line rectangles: columns/rows in a window with many mid-grey pixels. */
import { readFileSync } from 'node:fs'
import { PNG } from 'pngjs'
const [src, X0, Y0, X1, Y1] = process.argv.slice(2).map((v,i)=> i===0?v:+v)
const p = PNG.sync.read(readFileSync(src))
const lum=(x,y)=>{const i=(y*p.width+x)*4;return 0.299*p.data[i]+0.587*p.data[i+1]+0.114*p.data[i+2]}
const sat=(x,y)=>{const i=(y*p.width+x)*4;const r=p.data[i],g=p.data[i+1],b=p.data[i+2];return Math.max(r,g,b)-Math.min(r,g,b)}
// dashed lines on this drawing are neutral grey, darker than the room fill but lighter than wall ink
const isDash=(x,y)=> sat(x,y)<30 && lum(x,y)>60 && lum(x,y)<175
console.log('cols (x, count of dash px in y range):')
for(let x=X0;x<=X1;x++){let n=0;for(let y=Y0;y<=Y1;y++) if(isDash(x,y)) n++; if(n> (Y1-Y0)*0.30) console.log('  x',x,n)}
console.log('rows (y, count of dash px in x range):')
for(let y=Y0;y<=Y1;y++){let n=0;for(let x=X0;x<=X1;x++) if(isDash(x,y)) n++; if(n> (X1-X0)*0.30) console.log('  y',y,n)}
