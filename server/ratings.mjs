import { query } from './db.mjs'

const jobs = new Map()
let retryAfter = 0
const score = value => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 10 ? value : null
const votes = value => Number.isSafeInteger(value) && value >= 0 ? value : null
export async function fetchRatings(item, fetcher = fetch) {
  if (!/^(movie|tv):\d+$/.test(item.external_id || '')) return { status:'not_found',imdb:null,kinopoisk:null }
  const [type,id] = item.external_id.split(':')
  const idsResponse = await fetcher(`https://api.themoviedb.org/3/${type}/${id}/external_ids`, {
    headers:{ Authorization:`Bearer ${process.env.TMDB_READ_TOKEN}` },signal:AbortSignal.timeout(5000),
  })
  if (!idsResponse.ok) throw new Error('Ratings unavailable')
  const { imdb_id:imdbId } = await idsResponse.json()
  if (!/^tt\d{5,12}$/.test(imdbId || '')) return { status:'not_found',imdb:null,kinopoisk:null }
  const response = await fetcher(`https://kinopoiskapiunofficial.tech/api/v2.2/films?imdbId=${imdbId}`, {
    headers:{ 'X-API-KEY':process.env.KINOPOISK_API_KEY },signal:AbortSignal.timeout(5000),
  })
  if (!response.ok) throw new Error('Ratings unavailable')
  const data = await response.json(), found = data.items?.find(row => row.imdbId === imdbId)
  if (!found) return { status:'not_found',imdb:null,kinopoisk:null }
  const imdbScore = score(found.ratingImdb), kpScore = Number.isSafeInteger(found.kinopoiskId) && found.kinopoiskId > 0 ? score(found.ratingKinopoisk) : null
  return {
    status:imdbScore || kpScore ? 'ok' : 'not_found',
    imdb:imdbScore ? { score:imdbScore,votes:votes(found.ratingImdbVoteCount),url:`https://www.imdb.com/title/${imdbId}/` } : null,
    kinopoisk:kpScore && Number.isSafeInteger(found.kinopoiskId) && found.kinopoiskId > 0 ? {
      score:kpScore,votes:votes(found.ratingKinopoiskVoteCount),url:`https://www.kinopoisk.ru/film/${found.kinopoiskId}/`,
    } : null,
  }
}
export async function ratingsFor(item) {
  const previous = (await query('SELECT data,checked_at FROM external_ratings WHERE title_id=$1',[item.id])).rows[0]
  const saved = previous ? { ...previous.data,updated_at:previous.checked_at } : null
  if (previous && Date.now()-new Date(previous.checked_at).getTime() < 24*60*60*1000) return saved
  if (!process.env.KINOPOISK_API_KEY || !process.env.TMDB_READ_TOKEN) return saved || { status:'not_configured',imdb:null,kinopoisk:null }
  if (Date.now() < retryAfter) return saved ? { ...saved,stale:true } : { status:'unavailable',imdb:null,kinopoisk:null }
  const key = String(item.id)
  if (jobs.has(key)) return jobs.get(key)
  if (jobs.size >= 20) return saved || { status:'unavailable',imdb:null,kinopoisk:null }
  const job = (async () => {
    try {
      const data = await fetchRatings(item)
      const row = (await query(`INSERT INTO external_ratings(title_id,data) VALUES($1,$2)
        ON CONFLICT(title_id) DO UPDATE SET data=EXCLUDED.data,checked_at=NOW() RETURNING checked_at`,[item.id,data])).rows[0]
      return { ...data,updated_at:row.checked_at }
    } catch {
      // Back off on upstream errors and quotas without breaking the title page
      retryAfter = Date.now()+60*1000
      return saved ? { ...saved,stale:true } : { status:'unavailable',imdb:null,kinopoisk:null }
    }
  })()
  jobs.set(key,job)
  try { return await job } finally { jobs.delete(key) }
}
