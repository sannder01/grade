import { query } from './db.mjs'
import { HttpError, id, page } from './validation.mjs'

const aggregates = `LEFT JOIN LATERAL (SELECT ROUND(AVG(score),1)::float AS average,COUNT(*)::int AS votes FROM ratings WHERE title_id=t.id) stats ON TRUE`
const columns = `t.*,stats.average,stats.votes,
  EXISTS(SELECT 1 FROM watched WHERE user_id=$1 AND title_id=t.id) AS watched,
  (SELECT score FROM ratings WHERE user_id=$1 AND title_id=t.id) AS my_score`

export async function catalog(params, userId = null) {
  const kind = ['anime','movie','series'].includes(params.kind) ? params.kind : null
  const search = String(params.q || '').trim().slice(0, 100)
  const sort = { popular: 't.popularity DESC,t.id', rating: 'stats.average DESC NULLS LAST,stats.votes DESC,t.id', new: 't.year DESC NULLS LAST,t.id' }[params.sort] || 't.popularity DESC,t.id'
  const current = page(params.page)
  const values = [userId, kind, search, `%${search.replace(/[\\%_]/g, '\\$&')}%`]
  const where = `($2::text IS NULL OR t.kind=$2) AND ($3='' OR t.name ILIKE $4 OR t.original_name ILIKE $4 OR EXISTS(SELECT 1 FROM unnest(t.genres) g WHERE g ILIKE $4))`
  const count = (await query(`SELECT COUNT(*)::int AS total FROM titles t WHERE
    ($1::text IS NULL OR t.kind=$1) AND ($2='' OR t.name ILIKE $3 OR t.original_name ILIKE $3 OR EXISTS(SELECT 1 FROM unnest(t.genres) g WHERE g ILIKE $3))`, values.slice(1))).rows[0].total
  const { rows } = await query(`SELECT ${columns} FROM titles t ${aggregates} WHERE ${where} ORDER BY ${sort} LIMIT 24 OFFSET $5`, [...values, (current - 1) * 24])
  return { items: rows, total: count, page: current, pages: Math.ceil(count / 24), externalSearch: !!process.env.TMDB_READ_TOKEN }
}
export async function titleById(value, userId = null) {
  const { rows } = await query(`SELECT ${columns} FROM titles t ${aggregates} WHERE t.id=$2`, [userId, id(value)])
  if (!rows[0]) throw new HttpError(404, 'Тайтл не найден')
  return rows[0]
}

const externalCache = new Map()
export async function externalSearch(search, kind = null) {
  if (!process.env.TMDB_READ_TOKEN) throw new HttpError(503, 'Внешний каталог ещё не подключён. Поиск по подборке Grade доступен.')
  const cacheKey = search.trim().toLocaleLowerCase()
  let cached = externalCache.get(cacheKey)
  if (!cached || cached.expires < Date.now()) {
    if (externalCache.size >= 100) externalCache.delete(externalCache.keys().next().value)
    cached = { expires: Date.now() + 10 * 60 * 1000, value: fetchExternal(search) }
    externalCache.set(cacheKey, cached)
    cached.value.catch(() => { if (externalCache.get(cacheKey) === cached) externalCache.delete(cacheKey) })
  }
  const items = await cached.value
  return kind ? items.filter(item => item.kind === kind) : items
}
async function fetchExternal(search) {
  const url = new URL('https://api.themoviedb.org/3/search/multi')
  url.search = new URLSearchParams({ query: search, language: 'ru-RU', include_adult: 'false' }).toString()
  let data
  try {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${process.env.TMDB_READ_TOKEN}` }, signal: AbortSignal.timeout(8000) })
    if (!response.ok) throw new Error('Provider unavailable')
    data = await response.json()
    if (!Array.isArray(data.results)) throw new Error('Invalid provider response')
  } catch { throw new HttpError(502, 'Внешний каталог временно недоступен. Попробуйте позже.') }
  return data.results.filter((row) => ['movie','tv'].includes(row.media_type) && !row.adult).map((row) => ({
    external_id: `${row.media_type}:${row.id}`, name: row.title || row.name, original_name: row.original_title || row.original_name,
    kind: row.original_language === 'ja' && row.genre_ids?.includes(16) ? 'anime' : row.media_type === 'tv' ? 'series' : 'movie',
    year: Number((row.release_date || row.first_air_date || '').slice(0, 4)) || null,
    description: row.overview || '', poster: row.poster_path ? `https://image.tmdb.org/t/p/w500${row.poster_path}` : '',
    backdrop: row.backdrop_path ? `https://image.tmdb.org/t/p/original${row.backdrop_path}` : '', popularity: row.popularity || 0,
  }))
}
export async function importTitle(externalId) {
  if (!/^(movie|tv):\d+$/.test(externalId)) throw new HttpError(400, 'Некорректный тайтл')
  const existing = (await query("SELECT id FROM titles WHERE source='tmdb' AND external_id=$1", [externalId])).rows[0]
  if (existing) return existing
  if (!process.env.TMDB_READ_TOKEN) throw new HttpError(503, 'Внешний каталог ещё не подключён')
  const [type, external] = externalId.split(':')
  const response = await fetch(`https://api.themoviedb.org/3/${type}/${external}?language=ru-RU`, { headers: { Authorization: `Bearer ${process.env.TMDB_READ_TOKEN}` }, signal: AbortSignal.timeout(8000) })
  if (!response.ok) throw new HttpError(502, 'Не удалось загрузить тайтл')
  const row = await response.json()
  if (row.adult) throw new HttpError(400, 'Тайтл недоступен')
  const kind = row.original_language === 'ja' && row.genres?.some((g) => g.id === 16) ? 'anime' : type === 'tv' ? 'series' : 'movie'
  return (await query(`INSERT INTO titles(source,external_id,name,original_name,kind,year,description,poster,backdrop,genres,runtime,popularity)
    VALUES('tmdb',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(source,external_id) DO UPDATE SET name=EXCLUDED.name RETURNING id`,
  [externalId, row.title || row.name, row.original_title || row.original_name || '', kind, Number((row.release_date || row.first_air_date || '').slice(0,4)) || null,
    row.overview || '', row.poster_path ? `https://image.tmdb.org/t/p/w500${row.poster_path}` : '', row.backdrop_path ? `https://image.tmdb.org/t/p/original${row.backdrop_path}` : '',
    (row.genres || []).map((g) => g.name), row.runtime ? `${row.runtime} мин` : `${row.number_of_seasons || 1} сез.`, row.popularity || 0])).rows[0]
}
