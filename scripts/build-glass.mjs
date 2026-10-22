import { build } from 'esbuild'
import { readFile, writeFile } from 'node:fs/promises'

await build({
  entryPoints: ['client/liquid-glass.jsx'],
  outfile: 'public/assets/liquid-glass.js',
  bundle: true,
  minify: true,
  format: 'esm',
  target: ['es2022'],
  define: { 'process.env.NODE_ENV': '"production"' },
  legalComments: 'linked',
  banner: { js: '/*! Third-party notices: /assets/liquid-glass.LICENSE.txt */' },
})
const licenses = await Promise.all(['liquid-glass-react', 'react', 'react-dom', 'scheduler'].map(async name =>
  `${name}\n${(await readFile(`node_modules/${name}/LICENSE`, 'utf8')).replace(/\r\n/g, '\n')}`))
await writeFile('public/assets/liquid-glass.LICENSE.txt', licenses.join('\n\n---\n\n'))
console.log('Built the optional liquid-glass-react island')
