import { api, esc, icon, poster } from './ui.js'
import { t, html } from './i18n.js'

const definitions = [
  { slug:'other-worlds', index:'01', name:'За пределами привычного', description:'Другие миры, большие вопросы и немного бесконечности.', query:{q:'Фантастика'} },
  { slug:'stays-with-you', index:'02', name:'Остаётся с тобой', description:'Истории о людях. И обо всём, что делает нас людьми.', query:{kind:'movie',q:'Драма'} },
  { slug:'drawn-worlds', index:'03', name:'Миры, нарисованные вручную', description:'Когда воображение становится местом, в которое хочется вернуться.', query:{kind:'anime'} },
]
export const loadCollections = () => Promise.all(definitions.map(async definition => {
  const result = await api(`/api/catalog?${new URLSearchParams(definition.query)}`)
  // Complete the collection using the existing paginated API, including large catalogs.
  const rest = await Promise.all(Array.from({ length: Math.max(0,result.pages-1) },(_,i) => api(`/api/catalog?${new URLSearchParams({...definition.query,page:i+2})}`)))
  return { ...definition, items:[...result.items,...rest.flatMap(page => page.items)] }
}))
export const collectionBySlug = (collections, slug) => collections.find(collection => collection.slug === slug)
export function collectionCards(collections) {
  return `<div class="collection-grid">${collections.map(collection => html`<a class="collection-card" href="/collections/${collection.slug}"><div class="collection-cover">${collection.items.slice(0,4).map(item => poster(item)).join('')}<span class="cover-index">${collection.index}</span></div><div class="collection-card-heading"><h3>${esc(t(collection.name))}</h3>${icon('arrow-up-right')}</div><p>${collection.items.length} ${t('тайтлов')}<span>${t('Подборка Grade')}</span></p></a>`).join('')}</div>`
}
