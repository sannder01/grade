import { build } from 'esbuild'
import { readFile, writeFile } from 'node:fs/promises'

const metadata = JSON.parse(await readFile('node_modules/ogl/package.json','utf8'))
await build({
  entryPoints:['client/flow-vendor.js'],outfile:'public/assets/flow-vendor.js',
  bundle:true,minify:true,format:'esm',target:['es2022'],legalComments:'linked',
  banner:{js:`/*! OGL ${metadata.version}; Unlicense. https://github.com/oframe/ogl — see /assets/ogl.LICENSE.txt */`},
})
// Keep multiline GLSL strings free of trailing spaces in the tracked bundle.
const bundle = await readFile('public/assets/flow-vendor.js','utf8')
await writeFile('public/assets/flow-vendor.js',bundle.replace(/[\t ]+$/gm,''))
const readme = await readFile('node_modules/ogl/README.md','utf8')
const notice = readme.slice(readme.indexOf('## Unlicense') + '## '.length)
await writeFile('public/assets/ogl.LICENSE.txt',`OGL ${metadata.version}\nhttps://github.com/oframe/ogl\n\n${notice}`)
console.log(`Built OGL ${metadata.version} Flowmap for the browser`)
