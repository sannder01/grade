export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status }
}
export function text(value, { min = 1, max = 2000, label = 'Текст' } = {}) {
  if (typeof value !== 'string') throw new HttpError(400, `${label}: требуется текст`)
  const result = value.trim()
  if (result.length < min || result.length > max) throw new HttpError(400, `${label}: от ${min} до ${max} символов`)
  return result
}
export function id(value) {
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < 1)
    throw new HttpError(400, 'Некорректный идентификатор')
  return Number(value)
}
export function score(value) {
  if (!Number.isInteger(value) || value < 1 || value > 10) throw new HttpError(400, 'Оценка должна быть целым числом от 1 до 10')
  return value
}
export function boolean(value) {
  if (typeof value !== 'boolean') throw new HttpError(400, 'Некорректное значение')
  return value
}
export function page(value) {
  const result = Number(value || 1)
  if (!Number.isInteger(result) || result < 1 || result > 10000) throw new HttpError(400, 'Некорректная страница')
  return result
}
export function spoilerContent(row, reveal = false) {
  return { ...row, content: row.spoiler && !reveal ? null : row.content }
}
