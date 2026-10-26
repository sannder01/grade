import { build } from 'esbuild'
import { readFile, writeFile } from 'node:fs/promises'

const metadata = JSON.parse(await readFile('node_modules/three/package.json','utf8'))
await build({
  entryPoints:['client/hero-scene-vendor.js'],outfile:'public/assets/hero-scene-vendor.js',
  bundle:true,minify:true,format:'esm',target:['es2022'],legalComments:'linked',
  banner:{js:`/*! Three.js ${metadata.version}; MIT. https://threejs.org — /assets/three.LICENSE.txt */`},
})
const bundle = await readFile('public/assets/hero-scene-vendor.js','utf8')
// Three's embedded GLSL contains mixed indentation. Normalize whitespace only
// so the checked-in browser build is identical and clean on Windows and CI.
await writeFile('public/assets/hero-scene-vendor.js',bundle
  .replace(/^[\t ]+/gm,indent=>indent.replace(/\t/g,'  '))
  .replace(/[\t ]+$/gm,''))
await writeFile('public/assets/three.LICENSE.txt',await readFile('node_modules/three/LICENSE','utf8'))
console.log(`Built Three.js ${metadata.version}, SVGLoader, MeshSurfaceSampler and CSS3DRenderer`)
