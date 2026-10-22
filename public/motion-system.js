import { gsap, Flip } from './assets/motion-vendor.js'

gsap.registerPlugin(Flip)
const preference = matchMedia('(prefers-reduced-motion: reduce)')
export const reducedMotion = () => preference.matches
const timing = { micro: .2, reveal: .45, page: .65 }
let clearHeroMotion = () => {}
function desktopHeroMotion(main) {
  clearHeroMotion()
  const art = main.querySelector('.hero-cinema')
  if (!art) return
  const footer = document.querySelector('.footer')
  const move = gsap.quickTo(art,'y',{duration:.5,ease:'power2.out'})
  const reveal = gsap.quickTo(footer,'y',{duration:.4,ease:'power2.out'})
  const update = () => {
    const enabled = innerWidth > 760 && !reducedMotion()
    document.body.classList.toggle('parallax-home',enabled)
    if (!enabled) {
      document.body.style.removeProperty('--reveal-footer-height')
      gsap.set([art,footer],{clearProps:'transform'})
      footer.inert = false; footer.removeAttribute('aria-hidden'); return
    }
    const height = footer.offsetHeight
    document.body.style.setProperty('--reveal-footer-height',`${height}px`)
    move(Math.min(scrollY,innerHeight)*.2)
    const remaining = document.documentElement.scrollHeight-innerHeight-scrollY
    reveal(Math.max(0,Math.min(height,remaining)))
    footer.inert = remaining >= height
    if (footer.inert) footer.setAttribute('aria-hidden','true'); else footer.removeAttribute('aria-hidden')
  }
  window.addEventListener('scroll',update,{passive:true})
  window.addEventListener('resize',update,{passive:true})
  preference.addEventListener('change',update)
  update()
  clearHeroMotion = () => {
    window.removeEventListener('scroll',update); window.removeEventListener('resize',update); preference.removeEventListener('change',update)
    gsap.killTweensOf([art,footer]); gsap.set([art,footer],{clearProps:'transform'})
    document.body.classList.remove('parallax-home'); document.body.style.removeProperty('--reveal-footer-height')
    footer.inert = false; footer.removeAttribute('aria-hidden')
  }
}
gsap.defaults({ ease: 'power2.out', overwrite: 'auto' })

// Compatibility for existing toast calls; everything uses the GSAP clock.
export function motion(element, frames, options = {}) {
  if (!element || reducedMotion()) return null
  const normalize = frame => {
    const value = { ...frame }
    delete value.offset
    if (value.translate) {
      const [x, y] = value.translate.split(' ')
      value.x = x; value.y = y || 0; delete value.translate
    }
    return value
  }
  let resolve
  const finished = new Promise(done => { resolve = done })
  const tween = gsap.fromTo(element, normalize(frames[0]), {
    ...normalize(frames.at(-1)), duration: (options.duration || 200) / 1000,
    delay: (options.delay || 0) / 1000, onComplete: resolve, onInterrupt: resolve,
  })
  return { finished, cancel() { tween.kill(); resolve() } }
}

let observer, pageTween, mounted = false, cardState, sameComposition = false
let requestedRoute = '', lastRoute = '', sources = [], floating = [], restoring = []
const cleanFloating = () => {
  floating.forEach(node => { gsap.killTweensOf(node); node.remove() })
  restoring.forEach(node => { node.style.visibility = '' })
  floating = []; restoring = []
}

export function prepareNavigation(link, route) {
  requestedRoute = route.split('?')[0]
  cleanFloating(); sources = []
  if (reducedMotion()) return
  const cover = link?.closest('.collection-card')
  const poster = link?.closest('.title-card')?.querySelector('.poster-placeholder')
  const detail = document.querySelector('.detail-poster .poster-placeholder')
  const candidates = cover ? [...cover.querySelectorAll('[data-poster-id]')] : poster ? [poster] : detail ? [detail] : []
  for (const node of candidates) {
    const bounds = node.getBoundingClientRect()
    if (bounds.width && bounds.bottom > 0 && bounds.top < innerHeight) sources.push({ node, bounds, id: node.dataset.posterId, rotation: parseFloat(getComputedStyle(node).rotate) || 0 })
  }
}

export async function leavePage(main) {
  clearHeroMotion()
  observer?.disconnect(); pageTween?.kill(); gsap.killTweensOf(main)
  sameComposition = mounted && requestedRoute === lastRoute
  const cards = [...main.querySelectorAll('.title-card')]
  cards.forEach(card => { card.dataset.flipId = `card-${card.dataset.title}` })
  cardState = sameComposition && !reducedMotion() ? Flip.getState(cards) : null
  if (!mounted || reducedMotion() || sameComposition) return
  for (const { node, bounds, id, rotation } of sources) {
    if (!node.isConnected) continue
    const clone = node.cloneNode(true)
    clone.removeAttribute('data-flip-id'); clone.classList.add('flying-poster')
    clone.dataset.posterId = id; clone.setAttribute('aria-hidden', 'true')
    const width = node.offsetWidth, height = node.offsetHeight
    Object.assign(clone.style, { position: 'fixed', left: `${bounds.left+(bounds.width-width)/2}px`, top: `${bounds.top+(bounds.height-height)/2}px`, width: `${width}px`, height: `${height}px`, margin: '0', zIndex: '80', pointerEvents: 'none', borderRadius: getComputedStyle(node).borderRadius, transformOrigin: '50% 50%' })
    document.body.append(clone); floating.push(clone)
    gsap.set(clone, { rotation })
    node.style.visibility = 'hidden'; restoring.push(node)
  }
  await new Promise(resolve => {
    pageTween = gsap.to(main, { opacity: 0, duration: .12, onComplete: resolve, onInterrupt: resolve })
  })
}

export function mountMotion(main) {
  desktopHeroMotion(main)
  observer?.disconnect(); pageTween?.kill(); mounted = true
  lastRoute = location.pathname; requestedRoute = location.pathname
  gsap.set(main, { opacity: 1, clearProps: 'transform' })
  const cards = [...main.querySelectorAll('.title-card')]
  cards.forEach(card => { card.dataset.flipId = `card-${card.dataset.title}` })
  if (reducedMotion()) { cleanFloating(); sources = []; cardState = null; syncNavigation(); return }
  if (cardState && sameComposition) {
    Flip.from(cardState, {
      targets: cards, duration: timing.reveal, absolute: true, scale: true,
      onEnter: elements => gsap.fromTo(elements, { opacity: 0 }, { opacity: 1, duration: .25, delay: .08 }),
    })
  } else {
    pageTween = gsap.fromTo(main, { opacity: .45 }, { opacity: 1, duration: .25 })
    const headings = main.querySelectorAll('.hero-kicker,.hero h1,.hero-description,.hero-actions,.hero-note,.page-heading,.title-kicker,.title-info>h1,.original-name,.profile-heading')
    if (headings.length) gsap.from(headings, { y: 14, opacity: 0, duration: timing.reveal, stagger: .03, clearProps: 'transform,opacity' })
    const reveal = main.querySelectorAll('.title-card,.collection-card,.section-heading,.profile-review,.discussion-item,.onboard-card,.archive-note,.personal-collection')
    observer = new IntersectionObserver(entries => {
      let delay = 0
      for (const entry of entries) if (entry.isIntersecting) {
        const node = entry.target; node.removeAttribute('data-reveal')
        gsap.from(node, { y: 16, opacity: 0, duration: timing.reveal, delay: Math.min(delay++ * .03, .12), clearProps: 'transform,opacity' })
        observer.unobserve(node)
      }
    }, { threshold: .03 })
    reveal.forEach(node => { node.dataset.reveal = 'pending'; observer.observe(node) })
  }
  for (const clone of floating) {
    const id = clone.dataset.posterId
    const target = main.querySelector(`.detail-poster [data-poster-id="${CSS.escape(id)}"],.title-card [data-poster-id="${CSS.escape(id)}"]`)
    if (!target) { gsap.to(clone, { opacity: 0, duration: .2, onComplete: () => clone.remove() }); continue }
    target.style.visibility = 'hidden'; restoring.push(target)
    const vars = Flip.fit(clone, target, { getVars: true, scale: true })
    gsap.to(clone, { ...vars, duration: timing.page - .12, overwrite: true,
      onComplete: () => { target.style.visibility = ''; clone.remove() },
    })
  }
  sources = []; cardState = null; syncNavigation()
}

export function syncNavigation() {
  for (const nav of document.querySelectorAll('.desktop-nav,.mobile-nav')) {
    const active = nav.querySelector('a.active')
    let indicator = nav.querySelector('.nav-indicator')
    if (!indicator) { indicator = document.createElement('span'); indicator.className = 'nav-indicator'; indicator.setAttribute('aria-hidden', 'true'); nav.append(indicator) }
    if (!active || !nav.offsetWidth) { indicator.style.opacity = '0'; continue }
    gsap.to(indicator, { x: active.offsetLeft, y: active.offsetTop, width: active.offsetWidth, height: active.offsetHeight, opacity: 1, duration: reducedMotion() ? 0 : .45 })
    nav.dataset.ready = 'true'
  }
  document.dispatchEvent(new Event('grade:navigation'))
}
const resize = new ResizeObserver(syncNavigation)
document.querySelectorAll('.desktop-nav,.mobile-nav').forEach(nav => resize.observe(nav))
document.fonts?.ready.then(syncNavigation)

// Native dialog focus management is preserved. Closing reverses the same timeline.
const dialogs = new WeakMap()
export function openDialog(dialog) {
  const old = dialogs.get(dialog)
  if (old) { document.dispatchEvent(new CustomEvent('grade:dialog-open', { detail:dialog })); old.timeline.play(); return }
  if (!dialog.open) dialog.showModal()
  document.dispatchEvent(new CustomEvent('grade:dialog-open', { detail:dialog }))
  if (reducedMotion()) return
  const timeline = gsap.timeline({ paused: true })
    .fromTo(dialog, { opacity: 0, y: 18, scale: .985, '--backdrop-opacity': 0 }, { opacity: 1, y: 0, scale: 1, '--backdrop-opacity': 1, duration: .4 })
  dialogs.set(dialog, { timeline }); timeline.play()
}
export function closeDialog(dialog, after = () => {}) {
  if (!dialog.open) return
  document.dispatchEvent(new CustomEvent('grade:dialog-close', { detail:dialog }))
  const state = dialogs.get(dialog)
  const finish = () => { dialog.close(); state?.timeline.kill(); dialogs.delete(dialog); gsap.set(dialog, { clearProps: 'all' }); after() }
  if (reducedMotion() || !state) { finish(); return }
  state.timeline.eventCallback('onReverseComplete', finish).reverse()
}

let pressed = null
function release() {
  if (pressed) gsap.to(pressed.node, { [pressed.property]: 1, duration: reducedMotion() ? 0 : timing.micro, clearProps: pressed.property === 'scale' ? 'transform' : 'opacity' })
  pressed = null
}
document.addEventListener('pointerdown', event => {
  const node = event.target.closest('button,.button')
  if (!node || node.disabled || event.button !== 0 || reducedMotion() || node.closest('.track-header,.track-auth')) return
  const property = event.pointerType === 'touch' ? 'opacity' : 'scale'
  pressed = { node, property }; gsap.to(node, { [property]: property === 'opacity' ? .7 : .975, duration: .15 })
}, { passive: true })
document.addEventListener('pointerup', release, { passive: true })
document.addEventListener('pointercancel', release, { passive: true })
window.addEventListener('blur', release)
function cardInteraction(event, active) {
  const card = event.target.closest('.title-card,.collection-card,.discovery-card')
  if (!card || (event.relatedTarget instanceof Node && card.contains(event.relatedTarget)) || reducedMotion()) return
  const images = card.querySelectorAll('.poster-placeholder img')
  if (images.length) gsap.to(images, { scale: active ? 1.035 : 1, duration: timing.micro })
  const actions = card.querySelector('.card-actions')
  if (actions && matchMedia('(hover: hover)').matches) gsap.to(actions, { opacity: active ? 1 : .8, y: active ? 0 : 3, duration: timing.micro })
}
document.addEventListener('pointerover', event => { if (event.pointerType !== 'touch') cardInteraction(event, true) })
document.addEventListener('pointerout', event => { if (event.pointerType !== 'touch') cardInteraction(event, false) })
document.addEventListener('focusin', event => cardInteraction(event, true))
document.addEventListener('focusout', event => cardInteraction(event, false))
preference.addEventListener('change', () => {
  if (!reducedMotion()) return
  gsap.globalTimeline.getChildren(true, true, true).forEach(animation => { animation.progress(1); animation.kill() })
  observer?.disconnect(); cleanFloating()
  document.querySelectorAll('[data-reveal]').forEach(node => node.removeAttribute('data-reveal'))
  gsap.set('#main', { opacity: 1, clearProps: 'transform' })
})
// Preserve native iPhone scrolling and edge-back gestures without pointer capture.
export function enableGestures() { history.scrollRestoration = 'manual' }
