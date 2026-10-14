import assert from 'node:assert/strict'

// Invalid input checks the real registration route without creating public accounts.
for (const origin of (process.env.GRADE_CHECK_ORIGINS || '').split(',').filter(Boolean)) {
  const url = new URL(origin)
  assert.equal(url.protocol, 'https:')
  assert.equal(url.origin, origin)
  const health = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(30000) })
  assert.equal(health.status, 200, `${origin}: health`)
  assert.equal((await health.json()).ok, true)
  const response = await fetch(`${origin}/api/auth/sign-up/email`, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Connectivity check', username: '', email: 'invalid', password: '' }),
    signal: AbortSignal.timeout(30000),
  })
  assert.equal(response.status, 400, `${origin}: registration must reach input validation; ${await response.text()}`)
  const foreign = await fetch(`${origin}/api/auth/sign-up/email`, {
    method: 'POST', headers: { Origin: 'https://untrusted.example', 'Content-Type': 'application/json' },
    body: '{}', signal: AbortSignal.timeout(30000),
  })
  assert.equal(foreign.status, 403, `${origin}: foreign origins must stay blocked`)
  console.log(`${origin}: health OK; registration origin accepted; foreign origin blocked`)
}
