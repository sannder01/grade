import { HttpError } from './validation.mjs'

// Accept small JPEGs only and remove metadata segments before persisting them
export function avatarImage(buffer) {
  const invalid = () => { throw new HttpError(400, 'Выберите корректное фото') }
  if (!Buffer.isBuffer(buffer) || buffer.length < 20 || buffer.length > 262144 ||
      buffer.readUInt16BE(0) !== 0xffd8 || buffer.readUInt16BE(buffer.length - 2) !== 0xffd9) invalid()
  const chunks = [buffer.subarray(0,2)]
  let offset = 2, dimensions = false
  while (offset < buffer.length - 2) {
    const start = offset
    if (buffer[offset++] !== 0xff) invalid()
    while (buffer[offset] === 0xff) offset++
    const marker = buffer[offset++]
    if (offset + 2 > buffer.length || marker === 0 || marker === 0xd8 || marker === 0xd9) invalid()
    const length = buffer.readUInt16BE(offset)
    if (length < 2 || offset + length > buffer.length - 2) invalid()
    if ([0xc0,0xc2].includes(marker)) {
      if (length < 8) invalid()
      const height = buffer.readUInt16BE(offset+3), width = buffer.readUInt16BE(offset+5)
      if (!width || !height || width > 512 || height > 512) invalid()
      dimensions = true
    }
    if (marker === 0xda) {
      if (!dimensions) invalid()
      chunks.push(buffer.subarray(start))
      return Buffer.concat(chunks)
    }
    if (!(marker >= 0xe0 && marker <= 0xef) && marker !== 0xfe) chunks.push(buffer.subarray(start,offset+length))
    offset += length
  }
  invalid()
}
export const avatarUrl = (userId, version) => version ? `/api/avatars/${encodeURIComponent(userId)}/${version}` : ''
export const profileVisibility = profile => Object.fromEntries(['watched','ratings','reviews','comments','planned'].map(key => [key,profile?.[`show_${key}`] !== false]))
