import { t, html, language, errorMessage } from './i18n.js'
import { motion, openDialog, closeDialog } from './motion.js'
const icons = {
  ...Object.fromEntries(['brand','play','arrow-up-right','arrow-left','search','close','reply'].map(name => [name, `<use href="/icons.svg#${name}"/>`])),
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/>',
  check: '<path d="m5 12 4 4L19 6"/>', plus: '<path d="M12 5v14M5 12h14"/>',
  bookmark: '<path d="M6 4h12v17l-6-4-6 4V4Z"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>', eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  chat: '<path d="M21 11a8 8 0 0 1-8 8H7l-5 3V11a9 9 0 1 1 19 0Z"/>',
  film: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M7 3v18M17 3v18M3 8h4m10 0h4M3 16h4m10 0h4"/>',
  spark: '<path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z"/>',
  settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
}
export const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${icons[name] || icons.film}</svg>`
export const esc = (value = '') => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c])
export const kindName = (kind) => ({ anime:t('Аниме'), movie:t('Фильм'), series:t('Сериал') })[kind] || t('Тайтл')
export const avatar = (name = '', color = 'lime', photo = '') => `<span class="avatar" data-color="${['lime','violet','blue','orange','pink','gray'].includes(color) ? color : 'lime'}" aria-hidden="true">${esc([...name.trim()][0]?.toUpperCase() || 'G')}${/^\/api\/avatars\/[a-zA-Z0-9_-]+\/[0-9a-f-]{36}$/.test(photo) ? `<img src="${esc(photo)}" alt="" decoding="async">` : ''}</span>`
export const poster = (item, lazy = true) => `<div class="poster-placeholder" data-poster-id="${esc(item.id || item.external_id || '')}"><span>${esc(item.name)}</span>${item.poster ? html`<img src="${esc(item.poster)}" alt="Постер: ${esc(item.name)}" ${lazy ? 'loading="lazy"' : 'fetchpriority="high"'} decoding="async">` : ''}</div>`
export async function api(url, { method = 'GET', body, signal, raw = false } = {}) {
  let response
  try {
    response = await fetch(url, { method, signal, credentials: 'same-origin', cache:'no-store',
      headers: { 'Accept-Language': language(), ...(method === 'GET' ? {} : { 'Content-Type':raw ? 'image/jpeg' : 'application/json' }) },
      ...(method === 'GET' ? {} : { body:raw ? body : JSON.stringify(body ?? {}) }),
    })
  } catch (error) {
    if (error.name === 'AbortError') throw error
    throw new Error(t('Нет соединения. Проверьте подключение и повторите.'))
  }
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    const error = new Error(errorMessage(data?.error?.message || data?.error || data?.message, data?.code, response.status))
    error.status = response.status
    error.code = data?.code
    throw error
  }
  return data
}
let toastTimer, toastAnimation
export function toast(message) {
  const element = document.querySelector('#toast')
  element.textContent = t(message)
  element.hidden = false
  toastAnimation?.cancel()
  toastAnimation = motion(element,[{ opacity:0,translate:'0 8px' },{ opacity:1,translate:'0 0' }],{ duration:200 })
  clearTimeout(toastTimer)
  toastTimer = setTimeout(async () => {
    const animation = toastAnimation = motion(element,[{ opacity:1,translate:'0 0' },{ opacity:0,translate:'0 8px' }],{ duration:200 })
    await animation?.finished.catch(() => {})
    if (toastAnimation === animation) element.hidden = true
  },4000)
}
let modalReturnFocus = null
export function openModal(content, { kind = 'default' } = {}) {
  const modal = document.querySelector('#modal')
  const alreadyOpen = modal.open
  if (!alreadyOpen) modalReturnFocus = document.activeElement
  modal.classList.toggle('track-auth',kind === 'auth')
  if (kind === 'auth') modal.setAttribute('aria-labelledby','auth-title')
  else modal.removeAttribute('aria-labelledby')
  document.querySelector('#modal-content').innerHTML = content
  modal.querySelector('.modal-close-label').textContent = t('Закрыть')
  openDialog(modal)
  if (alreadyOpen && kind === 'auth') {
    motion(modal.querySelector('#modal-content'),[{opacity:0},{opacity:1}],{duration:220})
    modal.querySelector('#auth-form input:not([type="hidden"]):not(:disabled)')?.focus({preventScroll:true})
  }
  return modal
}
export function closeModal() {
  const modal = document.querySelector('#modal')
  const auth = modal.classList.contains('track-auth')
  closeDialog(modal,() => {
    const available = node => node?.isConnected && node.matches('a[href],button,input,select,textarea,[tabindex],[contenteditable=true]') && !node.disabled && !node.closest('[inert]') && node.getClientRects().length > 0
    const target = available(modalReturnFocus) ? modalReturnFocus : auth ? document.querySelector('#account button,#account a') : null
    if (available(target)) target.focus({preventScroll:true})
    modalReturnFocus = null
  })
}
export function empty(title, description, link = '/catalog', label = t('Каталог')) {
  return `<div class="empty-state">${icon('spark')}<h2>${esc(title)}</h2>${description ? `<p>${esc(description)}</p>` : ''}<a class="button primary" href="${esc(link)}">${esc(label)} ${icon('arrow')}</a></div>`
}
export function cards(items, showWatch = true) {
  return `<div class="poster-grid">${items.map((item) => `<article class="title-card" data-title="${item.id}" data-title-backdrop-url="${esc(item.backdrop || '')}">
    <a href="/title/${item.id}" class="poster-link">${poster(item)}<span class="poster-kind">${kindName(item.kind)}</span>${item.watched ? html`<span class="watched-badge">${icon('check')} Смотрел</span>` : ''}${item.my_score ? `<span class="personal-score">${icon('star')} ${item.my_score}</span>` : ''}</a>
    <div class="card-info"><a href="/title/${item.id}" class="card-title">${esc(item.name)}</a><div class="card-meta"><span>${item.year || '—'} · ${kindName(item.kind)}</span>${item.votes ? `<span class="community-score">${icon('star')} ${item.average}</span>` : ''}</div>
    ${showWatch ? `<div class="card-actions"><button class="card-watch ${item.watched ? 'selected' : ''}" type="button" data-action="watch" data-id="${item.id}" data-watched="${item.watched ? 'true' : 'false'}">${icon(item.watched ? 'check' : 'plus')} ${t('Смотрел')}</button><button class="card-plan ${item.planned ? 'selected' : ''}" type="button" data-action="plan" data-id="${item.id}" data-planned="${!!item.planned}" aria-pressed="${!!item.planned}" aria-label="${item.planned ? t('Убрать из планов') : t('В планы')}" title="${item.planned ? t('Убрать из планов') : t('В планы')}">${icon('bookmark')}</button></div>` : ''}</div>
  </article>`).join('')}</div>`
}
export function pager(page, pages, makeUrl) {
  if (pages < 2) return ''
  return html`<nav class="pagination" aria-label="Страницы">${page > 1 ? html`<a class="button secondary" href="${esc(makeUrl(page - 1))}">Назад</a>` : '<span></span>'}<span>${page} / ${pages}</span>${page < pages ? html`<a class="button secondary" href="${esc(makeUrl(page + 1))}">Дальше</a>` : '<span></span>'}</nav>`
}
