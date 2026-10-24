import { build } from 'esbuild'
import { readFile, writeFile } from 'node:fs/promises'
await build({ entryPoints: ['client/motion-vendor.js'], outfile: 'public/assets/motion-vendor.js', bundle: true, minify: true, format: 'esm', target: ['es2022'], legalComments: 'linked' })
const metadata = JSON.parse(await readFile('node_modules/gsap/package.json', 'utf8'))
await writeFile('public/assets/gsap.LICENSE.txt', `GSAP ${metadata.version}\n${metadata.license}\nCopyright GreenSock. See the license URL for full terms.\n`)
console.log('Built GSAP, Flip and SplitText for the browser')
