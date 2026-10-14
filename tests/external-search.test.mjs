import test from 'node:test'
import assert from 'node:assert/strict'
import { externalSearch } from '../server/catalog.mjs'

test('external search handles real provider shapes, shares cached results and respects title types', async t => {
  const previous = process.env.TMDB_READ_TOKEN
  process.env.TMDB_READ_TOKEN = 'isolated-provider-test-token'
  t.after(() => { if (previous === undefined) delete process.env.TMDB_READ_TOKEN; else process.env.TMDB_READ_TOKEN = previous })
  const fetch = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(new URL(url).searchParams.get('include_adult'), 'false')
    assert.equal(new URL(url).searchParams.get('language'), 'ru-RU')
    assert.equal(options.headers.Authorization, 'Bearer isolated-provider-test-token')
    return Response.json({ results: [
      { id: 10, media_type: 'movie', title: 'Фильм', original_title: 'Movie', release_date: '2024-02-01', poster_path: '/poster.jpg' },
      { id: 11, media_type: 'tv', name: 'Сериал', first_air_date: '2023-01-01' },
      { id: 12, media_type: 'tv', name: 'Аниме', original_language: 'ja', genre_ids: [16] },
      { id: 13, media_type: 'person', name: 'Актёр' },
      { id: 14, media_type: 'movie', title: 'Excluded', adult: true },
    ] })
  })
  const items = await externalSearch('Provider regression')
  assert.deepEqual(items.map(item => item.kind), ['movie', 'series', 'anime'])
  assert.equal(items[0].year, 2024)
  assert.equal(items[0].external_id, 'movie:10')
  assert.equal(items[0].poster, 'https://image.tmdb.org/t/p/w500/poster.jpg')
  assert.equal(items[2].year, null)
  assert.deepEqual((await externalSearch('provider regression', 'anime')).map(item => item.external_id), ['tv:12'])
  assert.equal(fetch.mock.callCount(), 1)
  assert.equal(JSON.stringify(items).includes('isolated-provider-test-token'), false)
})

test('provider failures are retryable and missing configuration stays explicit', async t => {
  const previous = process.env.TMDB_READ_TOKEN
  process.env.TMDB_READ_TOKEN = 'isolated-provider-test-token'
  t.after(() => { if (previous === undefined) delete process.env.TMDB_READ_TOKEN; else process.env.TMDB_READ_TOKEN = previous })
  let attempt = 0
  const fetch = t.mock.method(globalThis, 'fetch', async () => ++attempt === 1 ? new Response('upstream failure', { status: 503 }) : Response.json({ results: [] }))
  await assert.rejects(externalSearch('Retry regression'), error => error.status === 502 && !error.message.includes('upstream failure'))
  assert.deepEqual(await externalSearch('Retry regression'), [])
  assert.equal(fetch.mock.callCount(), 2)
  delete process.env.TMDB_READ_TOKEN
  await assert.rejects(externalSearch('Unconfigured regression'), error => error.status === 503)
})
