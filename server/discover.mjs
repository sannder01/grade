import { HttpError, page } from './validation.mjs'

const genres = new Set(['16', '18', '35', '80', '99', '9648', '10751'])
const cache = new Map()
const limit = 20

export function discoverOptions(params = {}) {
  const kind = ['movie', 'series', 'anime'].includes(params.kind) ? params.kind : ''
  const genre = genres.has(String(params.genre || '')) ? String(params.genre) : ''
  const sort = ['popular', 'new', 'rating'].includes(params.sort) ? params.sort : 'popular'
  const from = ['2020', '2010', '2000', '1990'].includes(String(params.from || '')) ? String(params.from) : ''
  return { kind, genre, sort, from, page: Math.min(page(params.page), limit) }
}

function mapTitle(row, type) {
  const media = row.media_type || type
  return {
    external_id: `${media}:${row.id}`,
    name: row.title || row.name || row.original_title || row.original_name || '',
    original_name: row.original_title || row.original_name || '',
    kind: row.original_language === 'ja' && row.genre_ids?.includes(16) ? 'anime' : media === 'tv' ? 'series' : 'movie',
    year: Number((row.release_date || row.first_air_date || '').slice(0, 4)) || null,
    description: row.overview || '',
    poster: /^\/[\w-]+\.(?:jpe?g|png|webp)$/i.test(row.poster_path || '') ? `https://image.tmdb.org/t/p/w500${row.poster_path}` : '',
    popularity: Number(row.popularity) || 0,
    rating: Number(row.vote_average) || 0,
  }
}

async function fetchPage(type, options, providerPage, locale) {
  const url = new URL(`https://api.themoviedb.org/3/discover/${type}`)
  const sort = {
    popular: 'popularity.desc',
    new: type === 'movie' ? 'primary_release_date.desc' : 'first_air_date.desc',
    rating: 'vote_average.desc',
  }[options.sort]
  url.search = new URLSearchParams({
    language: locale === 'en' ? 'en-US' : 'ru-RU', include_adult: 'false', sort_by: sort,
    page: String(providerPage),
    ...(options.sort !== 'new' ? { 'vote_count.gte': options.sort === 'rating' ? '100' : '20' } : {}),
    ...(options.from ? { [type === 'movie' ? 'primary_release_date.gte' : 'first_air_date.gte']: `${options.from}-01-01` } : {}),
    ...(options.sort === 'new' ? { [type === 'movie' ? 'primary_release_date.lte' : 'first_air_date.lte']: new Date().toISOString().slice(0, 10) } : {}),
    ...(options.kind === 'anime' ? { with_original_language: 'ja' } : {}),
    ...(options.genre || options.kind === 'anime' ? { with_genres: [options.kind === 'anime' ? '16' : '', options.genre].filter(Boolean).join(',') } : {}),
  }).toString()
  const response = await fetch(url, { headers: { Authorization: `Bearer ${process.env.TMDB_READ_TOKEN}` }, signal: AbortSignal.timeout(8000) })
  if (!response.ok) throw new Error('Provider unavailable')
  const data = await response.json()
  if (!Array.isArray(data.results) || !Number.isInteger(data.total_pages)) throw new Error('Invalid provider response')
  return { items: data.results.filter(row => row && !row.adult && Number.isSafeInteger(row.id) && row.id > 0)
    .map(row => mapTitle(row, type)).filter(row => row.name), pages: Math.min(data.total_pages, 500) }
}

export async function discover(params = {}, locale = 'ru') {
  const options = discoverOptions(params)
  if (!process.env.TMDB_READ_TOKEN) return { items: [], page: options.page, pages: 0, available: false }
  const key = JSON.stringify([locale, options])
  let entry = cache.get(key)
  if (!entry || entry.expires <= Date.now()) {
    if (cache.size >= 100) cache.delete(cache.keys().next().value)
    entry = { expires: Date.now() + 30 * 60 * 1000, value: (async () => {
      try {
        const types = options.kind === 'movie' ? ['movie'] : options.kind === 'series' ? ['tv'] : ['movie', 'tv']
        const providerPage = types.length === 2 ? Math.ceil(options.page / 2) : options.page
        const results = await Promise.all(types.map(type => fetchPage(type, options, providerPage, locale)))
        const items = results.flatMap(result => result.items).sort((a, b) => {
          if (options.sort === 'new') return (b.year || 0) - (a.year || 0) || b.popularity - a.popularity
          if (options.sort === 'rating') return b.rating - a.rating || b.popularity - a.popularity
          return b.popularity - a.popularity
        })
        const offset = types.length === 2 && options.page % 2 === 0 ? 20 : 0
        return { items: types.length === 2 ? items.slice(offset, offset + 20) : items,
          page: options.page, pages: Math.min(limit, Math.min(...results.map(result => result.pages)) * types.length), available: true }
      } catch { throw new HttpError(502, 'Внешний каталог временно недоступен. Попробуйте позже.') }
    })() }
    cache.set(key, entry)
    entry.value.catch(() => { if (cache.get(key) === entry) cache.delete(key) })
  }
  return entry.value
}
