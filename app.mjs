import express from 'express'
import { createAuth } from './server/auth.mjs'
import { createApp } from './server/app.mjs'
import { ensureSchema } from './server/db.mjs'
import { migrate } from './scripts/migrate.mjs'

// Vercel's Express entry point. Initialize once on first request, not during build.
const app = express()
let ready
app.use(async (req, res, next) => {
  if (!ready) ready = (async () => {
    await ensureSchema()
    await migrate(createAuth({ validateSchema: false }))
    return createApp(createAuth())
  })().catch((error) => { ready = null; throw error })
  try { (await ready)(req, res, next) }
  catch (error) {
    console.error('[Grade initialization]', error.code || error.name)
    res.status(503).json({ error: 'Сервис временно недоступен. Попробуйте чуть позже.' })
  }
})
export default app
