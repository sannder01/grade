import { createAuth } from './auth.mjs'
import { createApp } from './app.mjs'
import { migrate } from '../scripts/migrate.mjs'
import { pool } from './db.mjs'

const auth = createAuth()
await migrate(auth)
const port = Number(process.env.PORT || 3000)
const server = createApp(auth).listen(port, '0.0.0.0', () => console.log(`Grade listening on ${port}`))
const shutdown = () => server.close(async () => { await pool.end(); process.exit(0) })
process.once('SIGTERM', shutdown)
process.once('SIGINT', shutdown)
