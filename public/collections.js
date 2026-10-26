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
  return `<div class="collection-grid">${collections.map(collection => html`<a class="collection-card" data-collection-slug="${collection.slug}" href="/collections/${collection.slug}"><div class="collection-cover">${collection.items.slice(0,4).map(item => poster(item)).join('')}</div><div class="collection-card-heading"><h3><span data-collection-title="${collection.slug}">${esc(t(collection.name))}</span></h3>${icon('arrow-up-right')}</div><p>${collection.items.length} ${t('тайтлов')}<span>${t('Подборка Grade')}</span></p></a>`).join('')}</div>`
}

// The gallery keeps the same real anchors and poster nodes as the collection
// archive. Its optional camera enhances this usable, server-data-backed grid.
export function collectionGallery(collections) {
  if (!collections.length) return ''
  const first = collections[0]
  return html`<section class="collection-gallery" data-collection-gallery data-gallery-state="loading" aria-labelledby="collection-gallery-heading">
    <div class="collection-gallery-stage" data-gallery-stage>
      <header class="collection-gallery-heading"><p class="eyebrow">01 / СВЯЗИ МЕЖДУ ИСТОРИЯМИ</p><h2 id="collection-gallery-heading">У каждого настроения — своя орбита.</h2></header>
      <div class="collection-gallery-space" data-gallery-space><div class="collection-grid">${collections.map((collection,index) => html`<a class="collection-card" data-gallery-index="${index}" data-collection-slug="${collection.slug}" data-collection-description="${esc(t(collection.description))}" aria-label="${esc(t(collection.name))}" href="/collections/${collection.slug}"><div class="collection-cover">${collection.items.slice(0,3).map(item => poster(item)).join('')}</div><div class="collection-card-heading"><h3><span data-collection-title="${collection.slug}">${esc(t(collection.name))}</span></h3>${icon('arrow-up-right')}</div><p>${collection.items.length} ${t('тайтлов')}<span>${t('Подборка Grade')}</span></p></a>`).join('')}</div></div>
      <div class="collection-gallery-caption"><h3 data-gallery-title aria-live="polite" aria-atomic="true">${esc(t(first.name))}</h3><p data-gallery-description>${esc(t(first.description))}</p></div>
      <div class="collection-gallery-footer"><a id="gallery-enter" class="text-link" data-gallery-enter href="/collections/${first.slug}">Открыть подборку ${icon('arrow-up-right')}</a><div class="collection-gallery-controls" aria-label="${t('Навигация по подборкам')}"><span data-gallery-position>01 / ${String(collections.length).padStart(2,'0')}</span><button id="gallery-prev" class="gallery-step" data-gallery-step="-1" type="button" aria-label="${t('Предыдущая подборка')}">${icon('arrow-left')}</button><button id="gallery-next" class="gallery-step" data-gallery-step="1" type="button" aria-label="${t('Следующая подборка')}">${icon('arrow')}</button></div><a class="text-link gallery-all" href="/collections">Все подборки ${icon('arrow-up-right')}</a></div>
    </div>
  </section>`
}
