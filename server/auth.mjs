import { betterAuth } from 'better-auth'
import { username } from 'better-auth/plugins'
import { pool } from './db.mjs'

export function createAuth({ validateSchema = true } = {}) {
  if (!process.env.BETTER_AUTH_SECRET || process.env.BETTER_AUTH_SECRET.length < 32)
    throw new Error('Set a random BETTER_AUTH_SECRET of at least 32 characters')
  if (!process.env.BETTER_AUTH_URL) throw new Error('Set BETTER_AUTH_URL to the public origin')
  return betterAuth({
    appName: 'Grade',
    baseURL: process.env.BETTER_AUTH_URL,
    secret: process.env.BETTER_AUTH_SECRET,
    database: pool,
    emailAndPassword: { enabled: true, minPasswordLength: 10, maxPasswordLength: 128 },
    plugins: [username({ minUsernameLength: 3, maxUsernameLength: 24, usernameValidator: (value) => /^[a-zA-Z0-9_]+$/.test(value) })],
    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
    rateLimit: {
      enabled: true, storage: 'database', window: 60, max: 120,
      customRules: { '/sign-up/email': { window: 60, max: 5 }, '/sign-in/email': { window: 60, max: 10 }, '/sign-in/username': { window: 60, max: 10 } },
    },
    trustedOrigins: [new URL(process.env.BETTER_AUTH_URL).origin],
    advanced: { database: { validateSchema }, ipAddress: { ipAddressHeaders: ['x-grade-client-ip'] } },
    user: { changeEmail: { enabled: false } },
  })
}
