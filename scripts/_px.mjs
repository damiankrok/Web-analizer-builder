import { readFileSync } from 'node:fs'
import { PNG } from 'pngjs'
const [src,X0,Y0,X1,Y1]=process.argv.slice(2)
const p=PNG.sync.read(readFileSync(src))
const lum=(x,y)=>{const i=(y*p.width+x)*4;return Math.round(0.299*p.data[i]+0.587*p.data[i+1]+0.114*p.data[i+2])}
process.stdout.write('      ')
for(let x=+X0;x<=+X1;x++) process.stdout.write(String(x%100).padStart(4))
process.stdout.write('\n')
for(let y=+Y0;y<=+Y1;y++){ process.stdout.write(String(y).padStart(5)+' ')
  for(let x=+X0;x<=+X1;x++) process.stdout.write(String(lum(x,y)).padStart(4))
  process.stdout.write('\n') }
