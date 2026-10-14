// Use server configuration only; request Host/Origin headers never expand this list.
export function getTrustedOrigins(env = process.env) {
  if (!env.BETTER_AUTH_URL) throw new Error('Set BETTER_AUTH_URL to the public origin')
  const configured = [env.BETTER_AUTH_URL, ...(env.TRUSTED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean)]
  if (env.VERCEL === '1') {
    for (const key of ['VERCEL_URL', 'VERCEL_BRANCH_URL', 'VERCEL_PROJECT_PRODUCTION_URL']) {
      if (env[key]) configured.push(`https://${env[key]}`)
    }
  }
  return [...new Set(configured.map(value => {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
        url.pathname !== '/' || url.search || url.hash || url.hostname.includes('*'))
      throw new Error('Trusted origins must be exact HTTP(S) origins without paths or wildcards')
    return url.origin
  }))]
}
