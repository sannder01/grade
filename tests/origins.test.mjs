import test from 'node:test'
import assert from 'node:assert/strict'
import { getTrustedOrigins } from '../server/origins.mjs'

test('trusted origins include exact configured and current Vercel project addresses', () => {
  const origins = getTrustedOrigins({ BETTER_AUTH_URL: 'https://grade.example/',
    TRUSTED_ORIGINS: 'https://short.example, https://grade.example', VERCEL: '1',
    VERCEL_URL: 'grade-deploy.vercel.app', VERCEL_BRANCH_URL: 'grade-git-main.vercel.app',
    VERCEL_PROJECT_PRODUCTION_URL: 'short.example' })
  assert.deepEqual(origins, ['https://grade.example', 'https://short.example',
    'https://grade-deploy.vercel.app', 'https://grade-git-main.vercel.app'])
  for (const foreign of ['https://unrelated.vercel.app', 'https://short.example.attacker.test', 'http://short.example', 'null'])
    assert.equal(origins.includes(foreign), false)
  assert.deepEqual(getTrustedOrigins({ BETTER_AUTH_URL: 'http://localhost:3000', VERCEL_URL: 'ignored.vercel.app' }), ['http://localhost:3000'])
})

test('origin configuration rejects wildcards, credentials and non-origin URLs', () => {
  for (const value of ['https://*.vercel.app', 'https://user:pass@grade.example', 'https://grade.example/path',
    'https://grade.example?redirect=bad', 'https://grade.example#fragment', 'file:///tmp/app', 'null'])
    assert.throws(() => getTrustedOrigins({ BETTER_AUTH_URL: value }))
  assert.throws(() => getTrustedOrigins({}))
})
