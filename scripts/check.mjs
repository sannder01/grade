import { readdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
const rootCheck = spawnSync(process.execPath, ['--check', 'app.mjs'], { stdio: 'inherit' })
if (rootCheck.status !== 0) process.exit(rootCheck.status || 1)
for (const dir of ['server','scripts','public','tests']) {
  for (const name of await readdir(dir)) {
    if (!/\.(mjs|js)$/.test(name)) continue
    const result = spawnSync(process.execPath, ['--check', `${dir}/${name}`], { stdio: 'inherit' })
    if (result.status !== 0) process.exit(result.status || 1)
  }
}
console.log('JavaScript syntax checks passed')
