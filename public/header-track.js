import { gsap } from './assets/motion-vendor.js'
import { reducedMotion, syncNavigation } from './motion.js'
import { api, esc, icon, poster, kindName } from './ui.js'
import { t, html } from './i18n.js'

const header = document.querySelector('.track-header')
const links = header.querySelector('.track-links')
const form = document.querySelector('#search-form')
const input = document.querySelector('#search')
const searchButton = header.querySelector('.search-trigger')
const searchTray = document.querySelector('#search-tray')
const results = document.querySelector('#search-results')
const status = document.querySelector('#search-status')
const toggle = header.querySelector('.section-toggle')
const menu = document.querySelector('#section-menu')
const connector = document.querySelector('.auth-connector')
const path = connector.querySelector('path')
let searchOpen = false, menuOpen = false, initialized = false, searchTimeline
let timer, controller, request = 0, returnFocus = false
const duration = () => reducedMotion() ? 0 : .45

export function viewerPass(user = null) {
  const content = `<span class="pass-content"><span class="pass-caption">${t('ПРОПУСК ЗРИТЕЛЯ')}</span><span class="pass-name">${esc(user?.name || t('Войти'))}</span></span><span class="pass-stub">${icon('arrow-up-right')}</span>`
  return user
    ? `<a class="viewer-pass account-link" href="/u/${encodeURIComponent(user.username)}" aria-label="${t('Мой профиль')}">${content}</a>`
    : `<button type="button" class="viewer-pass login-button" data-action="login" aria-label="${t('Войти')}">${content}</button>`
}

function routeLabel() {
  const active = header.querySelector('.desktop-nav a.active')
  toggle.querySelector('.current-section').textContent = active?.querySelector('.track-label')?.textContent || t('О проекте')
  toggle.querySelector('.track-index').textContent = active?.querySelector('.track-index')?.textContent || '—'
  toggle.setAttribute('aria-label', `${t('Разделы')}: ${toggle.querySelector('.current-section').textContent}`)
}

function stopSearch() {
  clearTimeout(timer); controller?.abort(); request++
  results.removeAttribute('aria-busy')
}

function renderHint() {
  status.textContent = t('От двух символов')
  results.innerHTML = `<p class="search-hint">${t('Название фильма, аниме или сериала')}</p>`
}

async function findFrames() {
  stopSearch()
  const query = input.value.trim()
  if (!searchOpen) return
  if (query.length < 2) { renderHint(); return }
  const current = ++request
  controller = new AbortController()
  status.textContent = t('Поиск')
  results.setAttribute('aria-busy','true')
  try {
    const data = await api(`/api/catalog?${new URLSearchParams({q:query})}`, {signal:controller.signal})
    if (!searchOpen || current !== request) return
    const items = data.items.slice(0,6)
    status.textContent = `${items.length} / ${data.total}`
    results.innerHTML = items.length
      ? `<div class="frame-results">${items.map(item => `<a class="frame-result" href="/title/${item.id}">${poster(item)}<span><strong>${esc(item.name)}</strong><small>${item.year || '—'} · ${kindName(item.kind)}</small></span>${icon('arrow-up-right')}</a>`).join('')}</div><a class="search-all" href="/catalog?${new URLSearchParams({q:query})}">${t('Все результаты')}${icon('arrow')}</a>`
      : `<p class="search-hint">${t('Ничего не найдено')}</p><a class="search-all" href="/catalog?${new URLSearchParams({q:query})}">${t('Поиск во всём каталоге')}${icon('arrow')}</a>`
    if (!reducedMotion()) gsap.fromTo(results.children, {opacity:.4,y:5}, {opacity:1,y:0,duration:.35,clearProps:'transform,opacity'})
  } catch (error) {
    if (error.name === 'AbortError' || current !== request || !searchOpen) return
    status.textContent = t('Не удалось выполнить запрос')
    results.innerHTML = `<p class="search-hint">${esc(error.message)}</p><button type="button" class="search-all" data-search-retry>${t('Повторить')}${icon('arrow')}</button>`
  } finally {
    if (current === request) results.removeAttribute('aria-busy')
  }
}

export function openHeaderSearch() {
  if (!initialized) return
  setMenu(false)
  returnFocus = false; searchOpen = true
  header.classList.add('search-is-open')
  searchButton.setAttribute('aria-expanded','true')
  form.hidden = false; form.inert = false
  links.inert = true; links.setAttribute('aria-hidden','true')
  searchTray.hidden = false; searchTray.inert = false
  if (reducedMotion()) {
    searchTimeline.progress(1).pause()
    gsap.set(searchTray,{opacity:1,y:0})
  } else {
    searchTimeline.play()
    gsap.to(searchTray,{opacity:1,y:0,duration:.45,overwrite:true})
  }
  input.focus({preventScroll:true})
  findFrames()
}

function closeSearch(focus = false) {
  if (!searchOpen) return
  searchOpen = false; returnFocus = focus; stopSearch()
  searchButton.setAttribute('aria-expanded','false')
  form.inert = true; searchTray.inert = true
  links.inert = false; links.removeAttribute('aria-hidden')
  if (focus) searchButton.focus({preventScroll:true})
  const finish = () => { if (!searchOpen) { searchTray.hidden = true; form.hidden = true; header.classList.remove('search-is-open'); if (returnFocus) searchButton.focus({preventScroll:true}) } }
  if (reducedMotion()) { searchTimeline.progress(0).pause(); finish() }
  else {
    searchTimeline.reverse()
    gsap.to(searchTray,{opacity:0,y:-5,duration:.5,overwrite:true,onComplete:finish})
  }
}

function setMenu(open, focus = false) {
  menuOpen = open
  toggle.setAttribute('aria-expanded',String(open))
  menu.inert = !open
  if (open) {
    closeSearch()
    menu.hidden = false
    syncNavigation()
    gsap.to(menu,{opacity:1,y:0,duration:duration(),overwrite:true})
    if (focus) menu.querySelector('a.active,a')?.focus({preventScroll:true})
  } else {
    gsap.to(menu,{opacity:0,y:-5,duration:duration(),overwrite:true,onComplete:() => { if (!menuOpen) menu.hidden = true }})
    if (focus) toggle.focus({preventScroll:true})
  }
}

export function closeHeaderPanels() { closeSearch(); setMenu(false) }

function connectPass() {
  const dialog = document.querySelector('#modal')
  if (!dialog.open || !dialog.classList.contains('track-auth')) return
  const pass = header.querySelector('.viewer-pass')
  if (!pass) return
  const bounds = pass.getBoundingClientRect(), line = header.querySelector('.track-line').getBoundingClientRect()
  const x = bounds.left+bounds.width/2, y = line.top
  const endX = innerWidth/2, endY = Math.max(header.getBoundingClientRect().bottom+12,(innerHeight-dialog.offsetHeight)/2)
  const bendY = Math.min(y+28,endY-12)
  connector.setAttribute('viewBox',`0 0 ${innerWidth} ${innerHeight}`)
  path.setAttribute('d',`M ${x} ${y} V ${bendY} H ${endX} V ${endY}`)
  const length = path.getTotalLength()
  if (connector.hasAttribute('hidden')) {
    gsap.set(path,{strokeDasharray:length,strokeDashoffset:length})
    gsap.set(connector,{opacity:0})
  } else path.style.strokeDasharray = String(length)
  connector.removeAttribute('hidden')
  gsap.to(connector,{opacity:1,duration:duration(),overwrite:true})
  gsap.to(path,{strokeDashoffset:0,duration:duration(),overwrite:true})
}

export function initializeHeader() {
  initialized = true
  gsap.set(form,{opacity:0,y:6})
  gsap.set([searchTray,menu],{opacity:0,y:-5})
  searchTimeline = gsap.timeline({paused:true})
    .to(links,{opacity:0,y:-5,duration:.25},0)
    .to(form,{opacity:1,y:0,duration:.4},.08)
  searchButton.addEventListener('click',openHeaderSearch)
  header.querySelector('.search-close').addEventListener('click',() => closeSearch(true))
  toggle.addEventListener('click',() => setMenu(!menuOpen))
  toggle.addEventListener('keydown',event => { if (event.key === 'ArrowDown') { event.preventDefault(); setMenu(true,true) } })
  input.addEventListener('input',() => { stopSearch(); timer = setTimeout(findFrames,180) })
  input.addEventListener('keydown',event => {
    if (event.key === 'ArrowDown' && results.querySelector('a')) { event.preventDefault(); results.querySelector('a').focus() }
  })
  results.addEventListener('click',event => { if (event.target.closest('[data-search-retry]')) findFrames() })
  document.addEventListener('keydown',event => {
    if (event.key === 'Escape' && !document.querySelector('dialog[open]')) {
      if (searchOpen) { event.preventDefault(); event.stopPropagation(); closeSearch(true) }
      else if (menuOpen) { event.preventDefault(); setMenu(false,true) }
    }
    const nav = event.target.closest('.mobile-nav,.desktop-nav,.frame-results')
    if (!nav || !['ArrowDown','ArrowUp','ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return
    const anchors = [...nav.querySelectorAll('a')], index = anchors.indexOf(document.activeElement)
    if (index < 0) return
    event.preventDefault()
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? anchors.length-1 : (index+(['ArrowDown','ArrowRight'].includes(event.key) ? 1 : -1)+anchors.length)%anchors.length
    anchors[next].focus()
  })
  document.addEventListener('click',event => { if (!header.contains(event.target)) closeHeaderPanels() })
  document.addEventListener('grade:navigation',routeLabel)
  document.addEventListener('grade:language',() => { routeLabel(); if (searchOpen) findFrames() })
  document.addEventListener('grade:dialog-open',event => { if (event.detail.classList.contains('track-auth')) connectPass() })
  document.addEventListener('grade:dialog-close',event => {
    if (!event.detail.classList.contains('track-auth')) return
    gsap.to(path,{strokeDashoffset:path.getTotalLength(),duration:duration(),overwrite:true})
    gsap.to(connector,{opacity:0,duration:duration(),overwrite:true,onComplete:() => { if (!document.querySelector('#modal').open) connector.setAttribute('hidden','') }})
  })
  new ResizeObserver(() => {
    if (innerWidth > 760 && menuOpen) setMenu(false)
    connectPass()
  }).observe(header)
  window.addEventListener('resize',connectPass)
  new MutationObserver(() => {
    const content = header.querySelector('.pass-content')
    if (content && !reducedMotion()) gsap.fromTo(content,{opacity:0},{opacity:1,duration:.4})
  }).observe(document.querySelector('#account'),{childList:true})
  routeLabel()
  const desktopNav = header.querySelector('.desktop-nav')
  const previewMark = event => {
    const link = event.target.closest('a'), frame = desktopNav.querySelector('.nav-indicator')
    if (link && frame) gsap.to(frame,{x:link.offsetLeft,y:link.offsetTop,width:link.offsetWidth,height:link.offsetHeight,opacity:1,duration:duration(),overwrite:true})
  }
  desktopNav.addEventListener('pointerover',previewMark)
  desktopNav.addEventListener('focusin',previewMark)
  desktopNav.addEventListener('pointerleave',syncNavigation)
  desktopNav.addEventListener('focusout',event => { if (!desktopNav.contains(event.relatedTarget)) syncNavigation() })
}
