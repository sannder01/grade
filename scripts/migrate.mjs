import { readFile } from 'node:fs/promises'
import { getMigrations } from 'better-auth/db/migration'
import { pool, ensureSchema } from '../server/db.mjs'
import { createAuth } from '../server/auth.mjs'
import { seed } from '../server/seed.mjs'

export async function migrate(auth) {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
  await ensureSchema()
  const client = await pool.connect()
  try {
    await client.query('SELECT pg_advisory_lock(718042601)')
    const { runMigrations } = await getMigrations(auth.options)
    await runMigrations()
    await client.query('BEGIN')
    await client.query(await readFile(new URL('../server/schema.sql', import.meta.url), 'utf8'))
    await seed(client)
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    await client.query('SELECT pg_advisory_unlock(718042601)')
    client.release()
  }
}
if (process.argv[1]?.endsWith('scripts/migrate.mjs')) {
  try { await migrate(createAuth({ validateSchema: false })); console.log('Grade database ready') }
  finally { await pool.end() }
}
