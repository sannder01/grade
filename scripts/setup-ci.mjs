import pg from 'pg'

const url = new URL(process.env.DATABASE_URL)
if (url.hostname !== '127.0.0.1' || url.pathname !== '/grade_test' || process.env.CI !== 'true')
  throw new Error('Isolation fixture is allowed only in the disposable CI database')
const client = new pg.Client({ connectionString: url.toString(), ssl: false })
await client.connect()
try {
  // An unrelated app has a same-named table. Grade must never migrate or write it.
  await client.query('CREATE TABLE public."user"(id TEXT PRIMARY KEY, marker TEXT NOT NULL)')
  await client.query("INSERT INTO public.\"user\" VALUES('other-app','untouched')")
} finally { await client.end() }
