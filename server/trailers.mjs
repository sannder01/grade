const cache = new Map()
const lifetime = 6 * 60 * 60 * 1000

export function chooseTrailer(videos = []) {
  const candidates = videos.filter(video => video?.site === 'YouTube' && video.type === 'Trailer' && /^[\w-]{11}$/.test(video.key || ''))
  candidates.sort((a, b) => {
    const priority = video => (video.iso_639_1 === 'ru' ? 4 : video.iso_639_1 === 'en' ? 2 : 0) + (video.official ? 1 : 0)
    return priority(b) - priority(a) || (a.size || 0) - (b.size || 0)
  })
  const chosen = candidates[0]
  return chosen ? { key:chosen.key, name:chosen.name || 'Trailer' } : null
}

export function chooseBackdrop(images = []) {
  const candidates = images.filter(image => /^\/[\w-]+\.(?:jpe?g|png|webp)$/i.test(image?.file_path || '') &&
    Number.isInteger(image.width) && image.width >= 1280 && Number.isInteger(image.height) && image.height >= 700 &&
    image.width / image.height >= 1.6 && image.width / image.height <= 2)
  candidates.sort((a, b) => b.width - a.width || (b.vote_average || 0) - (a.vote_average || 0))
  return candidates[0] ? `https://image.tmdb.org/t/p/original${candidates[0].file_path}` : null
}

export async function trailerFor(item, fetcher = fetch) {
  if (!process.env.TMDB_READ_TOKEN || item.source !== 'tmdb' || !/^(movie|tv):\d+$/.test(item.external_id || '')) return { status:'unavailable' }
  const cacheKey = item.external_id
  const current = cache.get(cacheKey)
  if (current && current.expires > Date.now()) return current.value
  const [kind, id] = cacheKey.split(':')
  const value = (async () => {
    const imagePromise = (async () => {
      const response = await fetcher(`https://api.themoviedb.org/3/${kind}/${id}/images`, {
        headers:{ Authorization:`Bearer ${process.env.TMDB_READ_TOKEN}` }, signal:AbortSignal.timeout(6000),
      })
      return response.ok ? chooseBackdrop((await response.json()).backdrops) : null
    })().catch(() => null)
    const requests = await Promise.allSettled(['ru-RU','en-US'].map(async language => {
      const response = await fetcher(`https://api.themoviedb.org/3/${kind}/${id}/videos?language=${language}`, {
        headers:{ Authorization:`Bearer ${process.env.TMDB_READ_TOKEN}` }, signal:AbortSignal.timeout(6000),
      })
      if (!response.ok) throw new Error('TMDB videos unavailable')
      const data = await response.json()
      if (!Array.isArray(data.results)) throw new Error('Invalid TMDB videos')
      return data.results
    }))
    const videos = requests.filter(result => result.status === 'fulfilled').flatMap(result => result.value)
    if (requests.every(result => result.status === 'rejected')) throw new Error('TMDB videos unavailable')
    const trailer = chooseTrailer(videos)
    if (!trailer) return { status:'not_found' }
    return { status:'ok', ...trailer, backdrop:await imagePromise }
  })()
  if (cache.size >= 200) cache.delete(cache.keys().next().value)
  cache.set(cacheKey, { expires:Date.now() + lifetime, value })
  value.catch(() => { if (cache.get(cacheKey)?.value === value) cache.delete(cacheKey) })
  return value
}
