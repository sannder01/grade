/*
 * Reversible clip-path timeline adapted from Codrops EaseReverseClipMenu.
 * https://github.com/codrops/EaseReverseClipMenu
 *
 * MIT License
 * Copyright (c) 2009 - 2025 [Codrops](https://codrops.com)
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import { gsap } from './assets/motion-vendor.js'
import { reducedMotion } from './motion.js'
import { api, esc, icon, poster, kindName } from './ui.js'
import { t, language } from './i18n.js'

const header = document.querySelector('.track-header')
const input = document.querySelector('#search')
const searchButton = header.querySelector('.search-trigger')
const menuButton = header.querySelector('.section-toggle')
const results = document.querySelector('#search-results')
const status = document.querySelector('#search-status')
const searchPanel = document.querySelector('#search-tray')
const menuPanel = document.querySelector('#section-menu')
const panels = new Map()
let initialized = false, activePanel = null, timer, controller, request = 0
let savedOverflow = null, previousFocus = null

const label = (ru, en) => language() === 'en' ? en : ru
const focusables = scope => [...scope.querySelectorAll('a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])')]
  .filter(node => !node.disabled && !node.closest('[inert]') && node.getClientRects().length)

export function viewerPass(user = null) {
  const content = `<span class="account-name">${esc(user?.name || t('Войти'))}</span>${icon('arrow-up-right')}`
  return user
    ? `<a class="header-account account-link" href="/u/${encodeURIComponent(user.username)}" aria-label="${t('Мой профиль')}">${content}</a>`
    : `<button type="button" class="header-account login-button" data-action="login">${content}</button>`
}

function stopSearch() {
  clearTimeout(timer)
  controller?.abort()
  request++
  results.removeAttribute('aria-busy')
}

function renderHint() {
  status.textContent = t('От двух символов')
  results.innerHTML = `<p class="search-hint">${t('Название фильма, аниме или сериала')}</p>`
}

async function findFrames() {
  stopSearch()
  const query = input.value.trim()
  if (activePanel !== searchPanel) return
  if (query.length < 2) { renderHint(); return }
  const current = ++request
  controller = new AbortController()
  status.textContent = t('Поиск')
  results.setAttribute('aria-busy','true')
  try {
    const data = await api(`/api/catalog?${new URLSearchParams({q:query})}`, {signal:controller.signal})
    if (activePanel !== searchPanel || current !== request) return
    const items = data.items.slice(0,6)
    status.textContent = `${items.length} / ${data.total}`
    results.innerHTML = items.length
      ? `<div class="frame-results">${items.map(item => `<a class="frame-result" href="/title/${item.id}">${poster(item)}<span><strong>${esc(item.name)}</strong><small>${item.year || '—'} · ${kindName(item.kind)}</small></span>${icon('arrow-up-right')}</a>`).join('')}</div><a class="search-all" href="/catalog?${new URLSearchParams({q:query})}">${t('Все результаты')}${icon('arrow')}</a>`
      : `<p class="search-hint">${t('Ничего не найдено')}</p><a class="search-all" href="/catalog?${new URLSearchParams({q:query})}">${t('Поиск во всём каталоге')}${icon('arrow')}</a>`
    if (!reducedMotion()) gsap.fromTo(results.querySelectorAll('.frame-result,.search-all'), {opacity:0,y:12}, {opacity:1,y:0,duration:.4,ease:'power3.out',stagger:.04,clearProps:'transform,opacity'})
  } catch (error) {
    if (error.name === 'AbortError' || current !== request || activePanel !== searchPanel) return
    status.textContent = t('Не удалось выполнить запрос')
    results.innerHTML = `<p class="search-hint">${esc(error.message)}</p><button type="button" class="search-all" data-search-retry>${t('Повторить')}${icon('arrow')}</button>`
  } finally {
    if (current === request) results.removeAttribute('aria-busy')
  }
}

function setPageInert(inert) {
  for (const node of document.querySelectorAll('#main,.footer')) node.inert = inert
  if (inert && !savedOverflow) {
    savedOverflow = [document.documentElement.style.overflow,document.body.style.overflow]
    document.documentElement.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'
  } else if (!inert && savedOverflow) {
    document.documentElement.style.overflow = savedOverflow[0]
    document.body.style.overflow = savedOverflow[1]
    savedOverflow = null
  }
}

function syncHeaderLabels() {
  searchButton.querySelector('.search-trigger-label').textContent = t('Поиск /')
  menuButton.querySelector('.menu-trigger-label').textContent = label('Меню','Menu')
  menuButton.setAttribute('aria-label',label('Меню разделов','Sections menu'))
  header.querySelectorAll('.scene-close-label').forEach(node => { node.textContent = t('Закрыть') })
  menuPanel.querySelector('.scene-eyebrow').textContent = label('Личная коллекция кино','A personal film collection')
  searchPanel.querySelector('.search-scene-title').textContent = label('Название, которое ищете.','A title on your mind.')
}

function settleClosed(panel) {
  if (activePanel === panel) return
  panel.hidden = true
  panel.inert = true
  if (!activePanel && ![...panels.values()].some(state => state.timeline.progress() > 0)) {
    header.classList.remove('has-scene')
    setPageInert(false)
    document.dispatchEvent(new Event('grade:scene-closed'))
  }
}

// The current progress is retained when direction changes. Reusing a timeline
// keeps interrupted opens and closes continuous, as in the Codrops source.
function createScene(panel, button) {
  gsap.set(panel,{clipPath:'inset(0% 0% 100% 0%)','--scene-type-progress':0})
  // The scalar belongs to the stable panel, so translated labels and replaced
  // text inherit its current position without splitting or rebuilding a tween.
  const parts = [...panel.querySelectorAll('[data-scene-reveal]')]
    .filter(node => !node.matches('.scene-nav a,.search-scene-title'))
  const timeline = gsap.timeline({paused:true,onReverseComplete:() => settleClosed(panel)})
    .to(panel,{clipPath:'inset(0% 0% 0% 0%)',duration:.6,ease:'power3.inOut',easeReverse:true},0)
    .to(panel,{'--scene-type-progress':1,duration:.48,ease:'power3.inOut'},.1)
    .fromTo(parts,{y:22,opacity:0},{y:0,opacity:1,duration:.35,ease:'power3.out',stagger:.035},.08)
  panels.set(panel,{button,timeline})
}

function closeScene(panel, restoreFocus = false, immediate = false) {
  const state = panels.get(panel)
  if (!state) return
  if (activePanel === panel) activePanel = null
  state.button.setAttribute('aria-expanded','false')
  panel.setAttribute('aria-hidden','true')
  panel.inert = true
  if (panel === searchPanel) { stopSearch(); header.classList.remove('search-is-open') }
  if (restoreFocus) {
    const available = previousFocus?.isConnected && previousFocus.matches('a[href],button,input,select,textarea,[tabindex],[contenteditable=true]') && !previousFocus.disabled && !previousFocus.closest('[inert]') && previousFocus.getClientRects().length > 0
    const target = available ? previousFocus : state.button
    target.focus({preventScroll:true})
  }
  if (reducedMotion() || immediate) {
    state.timeline.progress(0).pause()
    settleClosed(panel)
  } else if (state.timeline.progress() === 0) { state.timeline.pause(); settleClosed(panel) }
  else state.timeline.timeScale(1).reverse()
}

function openScene(panel, focus = true) {
  if (!initialized) return
  if (activePanel === panel) return
  const state = panels.get(panel)
  if (!activePanel) previousFocus = document.activeElement
  else closeScene(activePanel)
  activePanel = panel
  panel.hidden = false
  panel.inert = false
  panel.setAttribute('aria-hidden','false')
  state.button.setAttribute('aria-expanded','true')
  header.classList.add('has-scene')
  header.classList.toggle('search-is-open',panel === searchPanel)
  setPageInert(true)
  if (reducedMotion()) state.timeline.progress(1).pause()
  else state.timeline.timeScale(1).play()
  if (focus) (panel === searchPanel ? input : panel.querySelector('a.active') || panel.querySelector('nav a,button'))?.focus({preventScroll:true})
}

export function openHeaderSearch() {
  openScene(searchPanel)
  if (initialized) findFrames()
}

export function closeHeaderPanels({immediate = false} = {}) {
  for (const panel of panels.keys()) closeScene(panel,false,immediate)
  gsap.killTweensOf(results.querySelectorAll('.frame-result,.search-all'))
  if (immediate) {
    activePanel = null
    header.classList.remove('has-scene','search-is-open')
    setPageInert(false)
  }
}

export function initializeHeader() {
  if (initialized) return
  initialized = true
  createScene(menuPanel,menuButton)
  createScene(searchPanel,searchButton)
  searchButton.addEventListener('click',() => activePanel === searchPanel ? closeScene(searchPanel,true) : openHeaderSearch())
  menuButton.addEventListener('click',() => activePanel === menuPanel ? closeScene(menuPanel,true) : openScene(menuPanel))
  header.querySelectorAll('[data-close-scene]').forEach(button => button.addEventListener('click',() => { if (activePanel) closeScene(activePanel,true) }))
  input.addEventListener('input',() => { stopSearch(); timer = setTimeout(findFrames,180) })
  input.addEventListener('keydown',event => {
    if (event.key === 'ArrowDown' && results.querySelector('a')) { event.preventDefault(); results.querySelector('a').focus() }
  })
  results.addEventListener('click',event => { if (event.target.closest('[data-search-retry]')) findFrames() })
  document.addEventListener('keydown',event => {
    if (!activePanel || document.querySelector('dialog[open]')) return
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeScene(activePanel,true); return }
    if (event.key === 'Tab') {
      const controls = focusables(header), index = controls.indexOf(document.activeElement)
      if (event.shiftKey && index <= 0) { event.preventDefault(); controls.at(-1)?.focus() }
      else if (!event.shiftKey && (index === controls.length-1 || index < 0)) { event.preventDefault(); controls[0]?.focus() }
      return
    }
    const nav = event.target.closest('.scene-nav,.frame-results')
    if (!nav || !['ArrowDown','ArrowUp','ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return
    const anchors = [...nav.querySelectorAll('a')], index = anchors.indexOf(document.activeElement)
    if (index < 0) return
    event.preventDefault()
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? anchors.length-1 : (index+(['ArrowDown','ArrowRight'].includes(event.key) ? 1 : -1)+anchors.length)%anchors.length
    anchors[next].focus()
  })
  document.addEventListener('grade:navigation',syncHeaderLabels)
  document.addEventListener('grade:language',() => { syncHeaderLabels(); if (activePanel === searchPanel) findFrames() })
  document.addEventListener('grade:dialog-open',() => closeHeaderPanels({immediate:true}))
  const media = matchMedia('(prefers-reduced-motion: reduce)')
  media.addEventListener('change',() => {
    if (!media.matches) return
    for (const [panel,state] of panels) {
      state.timeline.progress(activePanel === panel ? 1 : 0).pause()
      if (activePanel !== panel) settleClosed(panel)
    }
  })
  syncHeaderLabels()
  renderHint()
}
