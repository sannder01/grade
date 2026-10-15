import test from 'node:test'
import assert from 'node:assert/strict'
import { chooseBackdrop, chooseTrailer, trailerFor } from '../server/trailers.mjs'

test('trailer selection prefers a valid Russian trailer and rejects other videos', () => {
  const chosen = chooseTrailer([
    { site:'YouTube',type:'Trailer',key:'english0001',iso_639_1:'en',official:true,name:'English trailer' },
    { site:'YouTube',type:'Trailer',key:'russian0001',iso_639_1:'ru',official:true,name:'Русский трейлер' },
    { site:'YouTube',type:'Teaser',key:'teaser00001',iso_639_1:'ru',official:true },
    { site:'YouTube',type:'Trailer',key:'<bad-key>',iso_639_1:'ru',official:true },
  ])
  assert.deepEqual(chosen, { key:'russian0001',name:'Русский трейлер' })
  assert.equal(chooseTrailer([{site:'Vimeo',type:'Trailer',key:'russian0001'}]), null)
})

test('player artwork uses a wide high-resolution backdrop, never a small portrait', () => {
  assert.equal(chooseBackdrop([
    { file_path:'/portrait.jpg',width:500,height:750,vote_average:10 },
    { file_path:'/small.jpg',width:780,height:440,vote_average:10 },
    { file_path:'/wide.jpg',width:1920,height:1080,vote_average:6 },
    { file_path:'/invalid.svg',width:3840,height:2160,vote_average:10 },
  ]), 'https://image.tmdb.org/t/p/original/wide.jpg')
  assert.equal(chooseBackdrop([{ file_path:'/small.jpg',width:780,height:440 }]), null)
})

test('trailer lookup fetches both locales, caches the result and exposes no token', async t => {
  const previous = process.env.TMDB_READ_TOKEN
  process.env.TMDB_READ_TOKEN = 'isolated-trailer-token'
  t.after(() => { if (previous === undefined) delete process.env.TMDB_READ_TOKEN; else process.env.TMDB_READ_TOKEN = previous })
  const calls = []
  const fetcher = async (url, options) => {
    calls.push(url)
    assert.equal(options.headers.Authorization, 'Bearer isolated-trailer-token')
    if (url.endsWith('/images')) return Response.json({ backdrops:[{ file_path:'/sharp.jpg',width:1920,height:1080 }] })
    return Response.json({ results: new URL(url).searchParams.get('language') === 'ru-RU'
      ? [{ site:'YouTube',type:'Trailer',key:'russian0002',iso_639_1:'ru',name:'Трейлер' }]
      : [{ site:'YouTube',type:'Trailer',key:'english0002',iso_639_1:'en',name:'Trailer' }] })
  }
  const item = { source:'tmdb',external_id:'movie:987654321' }
  const first = await trailerFor(item, fetcher)
  assert.deepEqual(first, { status:'ok',key:'russian0002',name:'Трейлер',backdrop:'https://image.tmdb.org/t/p/original/sharp.jpg' })
  assert.equal((await trailerFor(item, fetcher)).key, 'russian0002')
  assert.equal(calls.length, 3)
  assert.equal(JSON.stringify(first).includes('isolated-trailer-token'), false)
})

test('trailer lookup still works when one locale fails', async t => {
  const previous = process.env.TMDB_READ_TOKEN
  process.env.TMDB_READ_TOKEN = 'isolated-trailer-token'
  t.after(() => { if (previous === undefined) delete process.env.TMDB_READ_TOKEN; else process.env.TMDB_READ_TOKEN = previous })
  const result = await trailerFor({ source:'tmdb',external_id:'tv:987654322' }, async url => {
    if (url.includes('ru-RU')) throw new Error('Regional lookup failed')
    return Response.json({ results:[{ site:'YouTube',type:'Trailer',key:'english0003',iso_639_1:'en' }] })
  })
  assert.equal(result.key, 'english0003')
  assert.equal(result.backdrop, null)
})
