import test from 'node:test'
import assert from 'node:assert/strict'
import { t, html, setLanguage, errorMessage } from '../public/i18n.js'
import { localizeTitles, localeFor, catalogSearch } from '../server/localization.mjs'

test('interface translation preserves interpolated user content and numeric punctuation', () => {
  setLanguage('en')
  assert.equal(t('Ваша оценка'), 'Your rating')
  assert.equal(html`<p>Отзыв ${'Аниме. Очень понравилось.'}</p>`, '<p>Review Аниме. Очень понравилось.</p>')
  assert.equal(t('Grade 8.5. Готово.'), 'Grade 8.5 Done')
  assert.equal(errorMessage('Invalid password', 'INVALID_PASSWORD', 400), 'Incorrect current password')
  setLanguage('ru')
  assert.equal(t('Готово.'), 'Готово')
})

test('English catalog metadata keeps identity, rating data and user text unchanged', async () => {
  const item = { id: '42', external_id: 'movie:157336', name: 'Интерстеллар', original_name: 'Interstellar',
    description: 'Описание.', genres: ['Фантастика','Драма'], runtime: '169 мин', content: 'Мой отзыв.',
    my_score: 8, average: 7.5, watched: true }
  const [english] = await localizeTitles([item], 'en')
  assert.equal(english.name, 'Interstellar')
  assert.deepEqual(english.genres, ['Science Fiction','Drama'])
  assert.equal(english.runtime, '169 min')
  assert.equal(english.content, 'Мой отзыв.')
  assert.equal(english.id, '42')
  assert.equal(english.average, 7.5)
  assert.equal(english.my_score, 8)
  assert.equal(english.watched, true)
  assert.doesNotMatch(english.description, /[А-Яа-яЁё]/)
  const [russian] = await localizeTitles([item], 'ru')
  assert.equal(russian.description, 'Описание')
  assert.equal(russian.content, 'Мой отзыв.')
  assert.equal(localeFor('en-US,en;q=0.9'), 'en')
  assert.equal(localeFor('ru-RU,en;q=0.9'), 'ru')
  assert.equal(catalogSearch('Science Fiction'), 'Фантастика')
  assert.equal(catalogSearch('Interstellar'), 'Interstellar')
})
