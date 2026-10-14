import pg from 'pg'

export const databaseSchema = process.env.DATABASE_SCHEMA || 'grade'
if (!/^[a-z][a-z0-9_]{0,62}$/.test(databaseSchema))
  throw new Error('DATABASE_SCHEMA must be a lowercase PostgreSQL identifier')

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  options: `-c search_path=${databaseSchema}`,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : false,
  max: 10,
  connectionTimeoutMillis: 10000,
})
export const query = (sql, params = []) => pool.query(sql, params)

export async function ensureSchema() {
  // The identifier is validated above; do not change the database or role defaults.
  await query(`CREATE SCHEMA IF NOT EXISTS "${databaseSchema}"`)
}

export async function transaction(work) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await work(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
}
