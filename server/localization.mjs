// Only catalog metadata is translated here — profile and discussion content stays intact.
export const localeFor = (header = '') => /^en(?:-|,|;|$)/i.test(header) ? 'en' : 'ru'
const clean = value => String(value || '').replace(/\.(?=\s|$)/g, '')
const genres = {
  'Фантастика':'Science Fiction', 'Драма':'Drama', 'Приключения':'Adventure', 'Фэнтези':'Fantasy',
  'Криминал':'Crime', 'Триллер':'Thriller', 'Экшен':'Action', 'Детектив':'Mystery', 'Музыка':'Music',
  'Романтика':'Romance', 'История':'History', 'Комедия':'Comedy', 'Ужасы':'Horror', 'Мультфильм':'Animation',
}
export const catalogSearch = value => Object.entries(genres).find(([, english]) => english.toLowerCase() === value.toLowerCase())?.[0] || value
const descriptions = {
  'movie:157336':'A team of explorers travels beyond the Solar System to find a new home for humanity',
  'movie:693134':'Paul Atreides joins the Fremen as the fate of an empire unfolds on a desert planet',
  'tv:209867':'An elven mage revisits the places of past adventures and learns to understand fleeting human lives',
  'tv:1396':'A chemistry teacher makes a decision that changes his life and his family forever',
  'movie:27205':'A specialist in entering dreams is hired to plant an idea rather than steal one',
  'tv:1429':'Humanity lives behind enormous walls that protect it from Titans until its familiar world falls apart',
  'movie:335984':'Officer K discovers a secret from the past and searches for a man who vanished years ago',
  'tv:13916':'A student finds a notebook that can decide the fate of others, sparking a battle of wits',
  'movie:129':'Chihiro enters a world of spirits and must find her way home',
  'tv:70523':'A child’s disappearance uncovers the tangled history of several families in a small German town',
  'movie:244786':'A young drummer meets a teacher who pushes him to question the limits of his ambition',
  'tv:95479':'Yuji Itadori enters a world of curses and learns to fight a threat invisible to ordinary people',
  'movie:496243':'Two families from different social worlds meet through circumstances that seem like good fortune',
  'tv:66732':'Friends search for a missing boy and discover another world beside their own',
  'movie:372058':'Two teenagers living far apart discover an inexplicable connection between their lives',
  'movie:550':'An office worker meets a charismatic stranger and joins an unusual underground club',
  'tv:87108':'The people at the heart of a disaster face the cost of decisions made in its first days',
  'tv:85937':'Tanjiro sets out to help his sister and become a demon slayer',
  'movie:238':'The youngest son of a powerful family is drawn into the business he hoped to avoid',
  'tv:100088':'Joel and Ellie cross a country transformed by a global catastrophe',
  'tv:37854':'Luffy assembles a crew and sails toward his dream of becoming King of the Pirates',
  'movie:680':'Several stories cross paths on the streets of Los Angeles',
  'movie:278':'A banker sent to prison finds a way to hold on to himself through friendship and hope',
  'tv:1399':'Great houses fight for power as an ancient threat awakens beyond their world',
}
const cache = new Map()
async function englishMetadata(item) {
  if (descriptions[item.external_id]) return {
    name: item.original_name || item.name, description: descriptions[item.external_id],
    genres: item.genres.map(genre => genres[genre] || genre),
    runtime: item.runtime.replace(/мин/g,'min').replace(/серий/g,'episodes').replace(/сезонов|сезона|сез\./g,'seasons').replace(/Сериал/g,'TV series'),
  }
  const fallback = { name: item.original_name || item.name, description: '', genres: [], runtime: '' }
  if (!process.env.TMDB_READ_TOKEN || !/^(movie|tv):\d+$/.test(item.external_id || '')) return fallback
  let entry = cache.get(item.external_id)
  if (!entry || entry.expires < Date.now()) {
    if (cache.size >= 200) cache.delete(cache.keys().next().value)
    const [type, id] = item.external_id.split(':')
    entry = { expires: Date.now() + 6 * 60 * 60 * 1000, value: (async () => {
      const response = await fetch(`https://api.themoviedb.org/3/${type}/${id}?language=en-US`, {
        headers: { Authorization: `Bearer ${process.env.TMDB_READ_TOKEN}` }, signal: AbortSignal.timeout(4000),
      })
      if (!response.ok) throw new Error('Metadata unavailable')
      const row = await response.json()
      return { name: row.title || row.name || fallback.name, description: row.overview || '',
        genres: (row.genres || []).map(genre => genre.name),
        runtime: row.runtime ? `${row.runtime} min` : `${row.number_of_seasons || 1} seasons` }
    })() }
    cache.set(item.external_id, entry)
    entry.value.catch(() => { if (cache.get(item.external_id) === entry) cache.delete(item.external_id) })
  }
  return entry.value.catch(() => fallback)
}
export async function localizeTitles(items, locale) {
  return Promise.all(items.map(async item => {
    const metadata = locale === 'en' ? await englishMetadata(item) : {}
    return { ...item, ...metadata, description: clean(metadata.description ?? item.description) }
  }))
}
