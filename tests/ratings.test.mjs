import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchRatings } from '../server/ratings.mjs'

test('external scores use the exact IMDb ID for films and series and keep distinct providers',async () => {
  for (const type of ['movie','tv']) {
    const requests=[]
    const result=await fetchRatings({external_id:`${type}:157336`},async url=>{
      requests.push(url)
      if(url.includes('themoviedb.org')) return Response.json({imdb_id:'tt0816692'})
      assert.equal(new URL(url).searchParams.get('imdbId'),'tt0816692')
      return Response.json({items:[
        {imdbId:'tt0000001',kinopoiskId:1,ratingImdb:1,ratingKinopoisk:1},
        {imdbId:'tt0816692',kinopoiskId:258687,ratingImdb:8.7,ratingKinopoisk:8.6},
      ]})
    })
    assert.match(requests[0],new RegExp(`/${type}/157336/external_ids$`))
    assert.equal(result.imdb.score,8.7);assert.equal(result.kinopoisk.score,8.6)
    assert.equal(result.imdb.url,'https://www.imdb.com/title/tt0816692/')
    assert.equal(result.kinopoisk.url,'https://www.kinopoisk.ru/film/258687/')
  }
})

test('missing, mismatched and invalid ratings never become invented scores',async () => {
  const item={external_id:'movie:1'}
  for(const items of [[],[{imdbId:'tt0000000',kinopoiskId:2,ratingImdb:9}], [{imdbId:'tt0000001',kinopoiskId:2,ratingImdb:0,ratingKinopoisk:999}]]){
    const result=await fetchRatings(item,async url=>Response.json(url.includes('themoviedb.org')?{imdb_id:'tt0000001'}:{items}))
    assert.equal(result.status,'not_found');assert.equal(result.imdb,null);assert.equal(result.kinopoisk,null)
  }
  await assert.rejects(fetchRatings(item,async()=>new Response('Private provider error',{status:429})))
  const missing=await fetchRatings(item,async()=>Response.json({imdb_id:null}))
  assert.equal(missing.status,'not_found')
})
