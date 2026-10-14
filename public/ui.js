const icons = {
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/>',
  check: '<path d="m5 12 4 4L19 6"/>', plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>', eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  chat: '<path d="M21 11a8 8 0 0 1-8 8H7l-5 3V11a9 9 0 1 1 19 0Z"/>',
  film: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M7 3v18M17 3v18M3 8h4m10 0h4M3 16h4m10 0h4"/>',
  spark: '<path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z"/>',
  settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
}
export const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.film}</svg>`
export const esc = (value = '') => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c])
export const kindName = (kind) => ({ anime:'Аниме', movie:'Фильм', series:'Сериал' })[kind] || 'Тайтл'
export const avatar = (name = '') => `<span class="avatar" aria-hidden="true">${esc([...name.trim()][0]?.toUpperCase() || 'G')}</span>`
export const poster = (item, lazy = true) => `<div class="poster-placeholder"><span>${esc(item.name)}</span>${item.poster ? `<img src="${esc(item.poster)}" alt="Постер: ${esc(item.name)}" ${lazy ? 'loading="lazy"' : 'fetchpriority="high"'} decoding="async">` : ''}</div>`
export async function api(url, { method = 'GET', body, signal } = {}) {
  let response
  try {
    response = await fetch(url, { method, signal, credentials: 'same-origin', cache:'no-store',
      headers: method === 'GET' ? {} : { 'Content-Type':'application/json' },
      ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }),
    })
  } catch (error) {
    if (error.name === 'AbortError') throw error
    throw new Error('Нет соединения. Проверьте подключение и повторите.')
  }
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    const error = new Error(data?.error?.message || data?.error || data?.message || 'Не удалось выполнить запрос')
    error.status = response.status
    error.code = data?.code
    throw error
  }
  return data
}
let toastTimer
export function toast(message) {
  const element = document.querySelector('#toast')
  element.textContent = message
  element.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { element.hidden = true }, 4000)
}
export function openModal(content) {
  const modal = document.querySelector('#modal')
  document.querySelector('#modal-content').innerHTML = content
  if (!modal.open) modal.showModal()
  return modal
}
export function closeModal() { document.querySelector('#modal').close() }
export function empty(title, description, link = '/catalog', label = 'Открыть каталог') {
  return `<div class="empty-state">${icon('spark')}<h2>${esc(title)}</h2><p>${esc(description)}</p><a class="button primary" href="${esc(link)}">${esc(label)} ${icon('arrow')}</a></div>`
}
export function cards(items) {
  return `<div class="poster-grid">${items.map((item) => `<article class="title-card" data-title="${item.id}">
    <a href="/title/${item.id}" class="poster-link">${poster(item)}<span class="poster-kind">${kindName(item.kind)}</span>${item.watched ? `<span class="watched-badge">${icon('check')} Смотрел</span>` : ''}${item.my_score ? `<span class="personal-score">${icon('star')} ${item.my_score}</span>` : ''}</a>
    <div class="card-info"><a href="/title/${item.id}" class="card-title">${esc(item.name)}</a><div class="card-meta"><span>${item.year || '—'} · ${kindName(item.kind)}</span>${item.votes ? `<span class="community-score">${icon('star')} ${item.average}</span>` : ''}</div>
    <button class="card-watch ${item.watched ? 'selected' : ''}" type="button" data-action="watch" data-id="${item.id}" data-watched="${item.watched ? 'true' : 'false'}">${icon(item.watched ? 'check' : 'plus')} ${item.watched ? 'Смотрел' : 'В просмотренное'}</button></div>
  </article>`).join('')}</div>`
}
export function pager(page, pages, makeUrl) {
  if (pages < 2) return ''
  return `<nav class="pagination" aria-label="Страницы">${page > 1 ? `<a class="button secondary" href="${esc(makeUrl(page - 1))}">Назад</a>` : '<span></span>'}<span>${page} / ${pages}</span>${page < pages ? `<a class="button secondary" href="${esc(makeUrl(page + 1))}">Дальше</a>` : '<span></span>'}</nav>`
}
