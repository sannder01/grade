import test from 'node:test'
import assert from 'node:assert/strict'
import { discover, discoverOptions } from '../server/discover.mjs'

test('discovery loads fresh provider pages, filters them and caches each page', async t => {
  const previous = process.env.TMDB_READ_TOKEN
  process.env.TMDB_READ_TOKEN = 'isolated-discovery-token'
  t.after(() => { if (previous === undefined) delete process.env.TMDB_READ_TOKEN; else process.env.TMDB_READ_TOKEN = previous })
  const requests = []
  t.mock.method(globalThis, 'fetch', async (input, options) => {
    const url = new URL(input)
    requests.push(url)
    assert.equal(options.headers.Authorization, 'Bearer isolated-discovery-token')
    assert.equal(url.searchParams.get('include_adult'), 'false')
    const type = url.pathname.endsWith('/movie') ? 'movie' : 'tv'
    return Response.json({ total_pages: 3, results: Array.from({ length: 20 }, (_, index) => ({
      id: (type === 'movie' ? 100 : 200) + index, title: type === 'movie' ? `Фильм ${index}` : undefined,
      name: type === 'tv' ? `Сериал ${index}` : undefined, popularity: 40 - index,
      poster_path: '/poster.jpg', genre_ids: [18], release_date: '2025-01-02', first_air_date: '2024-01-02',
    })) })
  })
  const first = await discover({ sort: 'popular', page: 1 }, 'ru')
  const second = await discover({ sort: 'popular', page: 2 }, 'ru')
  assert.equal(first.available, true)
  assert.equal(first.pages, 6)
  assert.equal(first.items.length, 20)
  assert.equal(second.items.length, 20)
  assert.equal(new Set([...first.items, ...second.items].map(item => item.external_id)).size, 40)
  assert.equal(requests.length, 4)
  await discover({ sort: 'popular', page: 1 }, 'ru')
  assert.equal(requests.length, 4)
  assert.equal(requests[0].searchParams.get('language'), 'ru-RU')
})

test('anime discovery applies language, genre and year filters without exposing the token', async t => {
  const previous = process.env.TMDB_READ_TOKEN
  process.env.TMDB_READ_TOKEN = 'isolated-discovery-token'
  t.after(() => { if (previous === undefined) delete process.env.TMDB_READ_TOKEN; else process.env.TMDB_READ_TOKEN = previous })
  const fetch = t.mock.method(globalThis, 'fetch', async input => {
    const url = new URL(input)
    assert.match(url.pathname, /\/discover\/(movie|tv)$/)
    assert.equal(url.searchParams.get('with_original_language'), 'ja')
    assert.equal(url.searchParams.get('with_genres'), '16,18')
    assert.equal(url.searchParams.get(url.pathname.endsWith('/tv') ? 'first_air_date.gte' : 'primary_release_date.gte'), '2020-01-01')
    assert.equal(url.searchParams.get('language'), 'en-US')
    return Response.json({ total_pages: 1, results: [
      { id: url.pathname.endsWith('/tv') ? 777 : 779, name: 'Anime title', original_language: 'ja', genre_ids: [16,18], first_air_date: '2024-02-03', poster_path: '/good.jpg' },
      { id: 778, name: 'Adult', adult: true },
    ] })
  })
  const result = await discover({ kind: 'anime', genre: '18', from: '2020', page: 1 }, 'en')
  assert.equal(fetch.mock.callCount(), 2)
  assert.equal(result.items[0].kind, 'anime')
  assert.equal(result.items[0].poster, 'https://image.tmdb.org/t/p/w500/good.jpg')
  assert.equal(result.items.length, 2)
  assert.equal(JSON.stringify(result).includes('isolated-discovery-token'), false)
  assert.deepEqual(discoverOptions({ kind: 'invalid', genre: '42', from: '1800', page: 999 }),
    { kind: '', genre: '', sort: 'popular', from: '', page: 20 })
})

test('discovery reports missing credentials and retries provider failures', async t => {
  const previous = process.env.TMDB_READ_TOKEN
  t.after(() => { if (previous === undefined) delete process.env.TMDB_READ_TOKEN; else process.env.TMDB_READ_TOKEN = previous })
  delete process.env.TMDB_READ_TOKEN
  assert.deepEqual(await discover({ kind: 'movie' }), { items: [], page: 1, pages: 0, available: false })
  process.env.TMDB_READ_TOKEN = 'isolated-discovery-token'
  let attempts = 0
  t.mock.method(globalThis, 'fetch', async () => ++attempts === 1
    ? new Response('provider secret', { status: 503 }) : Response.json({ total_pages: 0, results: [] }))
  await assert.rejects(discover({ kind: 'movie', genre: '80' }), error => error.status === 502 && !error.message.includes('provider secret'))
  assert.equal((await discover({ kind: 'movie', genre: '80' })).available, true)
  assert.equal(attempts, 2)
})
