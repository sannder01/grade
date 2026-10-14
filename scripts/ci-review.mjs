import { readFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'

// Only generated dependency metadata and screenshots of the public landing page.
// This lets a reviewer inspect CI output without access to the CI runner's disk.
const emit = (name, data) => {
  const encoded = data.toString('base64')
  for (let i = 0; i < encoded.length; i += 4000)
    console.log(`GRADE_REVIEW_${name}_${i / 4000}:${encoded.slice(i, i + 4000)}`)
}
try { emit('LOCK', gzipSync(await readFile('package-lock.json'))) } catch { /* Install may have failed. */ }
for (const width of [390, 1440]) {
  try { emit(`IMAGE${width}`, await readFile(`test-results/grade-review-${width}.jpg`)) }
  catch { /* A failed browser startup may not produce a screenshot. */ }
}
