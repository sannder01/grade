import test from 'node:test'
import assert from 'node:assert/strict'
import { avatarImage,profileVisibility } from '../server/avatar.mjs'
import { jpeg } from './photo-fixture.mjs'

test('avatar validation accepts JPEGs and strips metadata without accepting active content', () => {
  const metadata = Buffer.from('private GPS metadata')
  const segment = Buffer.alloc(4); segment.writeUInt16BE(0xffe1); segment.writeUInt16BE(metadata.length+2,2)
  const image = avatarImage(Buffer.concat([jpeg.subarray(0,2),segment,metadata,jpeg.subarray(2)]))
  assert.equal(image.includes(metadata),false)
  assert.equal(image.readUInt16BE(0),0xffd8)
  for (const invalid of [Buffer.from('<svg onload="alert(1)"></svg>'),Buffer.alloc(262145),jpeg.subarray(0,jpeg.length-2)])
    assert.throws(() => avatarImage(invalid),error => error.status === 400)
  const huge = Buffer.from(jpeg), frame = huge.indexOf(Buffer.from([0xff,0xc0]))
  assert.ok(frame > 0); huge.writeUInt16BE(4096,frame+5)
  assert.throws(() => avatarImage(huge),error => error.status === 400)
  assert.deepEqual(profileVisibility({ show_ratings:false }),{watched:true,ratings:false,reviews:true,comments:true,planned:true})
})
