import test from 'node:test'
import assert from 'node:assert/strict'
import { text, id, score, boolean, page, spoilerContent } from '../server/validation.mjs'

test('scores are integers from one to ten', () => {
  for (const n of [1,5,10]) assert.equal(score(n),n)
  for (const n of [0,11,1.5,'8',null,Infinity,NaN]) assert.throws(() => score(n))
})
test('identifiers and pagination reject coercion and overflow', () => {
  assert.equal(id('42'),42)
  for (const value of ['1 OR 1=1',-1,0,'1.2','9007199254740993',null]) assert.throws(() => id(value))
  assert.equal(page(undefined),1)
  assert.throws(() => page('NaN'))
  assert.throws(() => page(-1))
  assert.throws(() => page(10001))
})
test('content length is bounded without interpreting HTML', () => {
  assert.equal(text(' <script>literal text</script> '),'<script>literal text</script>')
  assert.equal(text('',{min:0}),'')
  assert.throws(() => text(''))
  assert.throws(() => text({toString:()=> 'not text'}))
  assert.throws(() => text('a'.repeat(2001)))
  assert.throws(() => boolean('false'))
  assert.equal(boolean(false),false)
})
test('spoiler bodies are absent until explicitly revealed', () => {
  const row={id:1,spoiler:true,content:'THE HIDDEN ENDING',name:'viewer'}
  assert.equal(spoilerContent(row).content,null)
  assert.equal(JSON.stringify(spoilerContent(row)).includes(row.content),false)
  assert.equal(spoilerContent(row,true).content,row.content)
  assert.equal(spoilerContent({...row,spoiler:false}).content,row.content)
  assert.equal(row.content,'THE HIDDEN ENDING')
})
