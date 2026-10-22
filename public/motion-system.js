import { gsap, Flip } from './assets/motion-vendor.js'

/*
 * Collection reparenting adapts Codrops ContentLayoutTransition (slideshow.js).
 * Copyright (c) 2009 - 2021 Codrops. MIT License.
 * Full notice: /assets/codrops-motion-LICENSE.txt
 * Grade's router replaces the original wheel/touch Observer and scroll resets.
 */
gsap.registerPlugin(Flip)
gsap.defaults({ ease:'power3.inOut', overwrite:'auto' })
const preference = matchMedia('(prefers-reduced-motion: reduce)')
export const reducedMotion = () => preference.matches
const timing = { micro:.22, reveal:.6, page:.6, film:.58, collection:.85 }

export function motion(element, frames, options = {}) {
  if (!element || reducedMotion()) return null
  const normalize = frame => {
    const value = { ...frame }; delete value.offset
    if (value.translate) {
      const [x,y] = value.translate.split(' ')
      value.x = x; value.y = y || 0; delete value.translate
    }
    return value
  }
  let resolve
  const finished = new Promise(done => { resolve = done })
  const tween = gsap.fromTo(element,normalize(frames[0]),{
    ...normalize(frames.at(-1)), duration:(options.duration || 220)/1000,
    delay:(options.delay || 0)/1000, onComplete:resolve, onInterrupt:resolve,
  })
  return { finished, cancel() { tween.kill(); resolve() } }
}

let observer, pageContext, pageTween, layoutTween, cardState, sharedState
let mounted = false, sameComposition = false, requestedRoute = '', lastRoute = ''
let pendingLink = null, shared = [], layer = null
let filmTransition = false
const collectionMemories = new Map()
const visible = node => {
  const box = node?.getBoundingClientRect()
  return !!box?.width && !!box.height
}
const escaped = value => CSS.escape(String(value))
const collectionSlug = route => /^\/collections\/([a-z-]+)$/.exec(route)?.[1]
const titleRoute = route => /^\/title\/\d+$/.test(route)
const decodeImages = nodes => {
  const images = nodes.flatMap(node => node.matches('img') ? [node] : [...node.querySelectorAll('img')])
  // Reuse live image nodes; missing and failed images must never block a route.
  return Promise.allSettled(images.map(img => img.decode?.().catch(() => {}) || Promise.resolve()))
}
function clearLayer() { layer?.remove(); layer = null; shared = []; sharedState = null }
function neutralizePosterImages(main) {
  const images = main.querySelectorAll('.poster-placeholder img')
  gsap.killTweensOf(images)
  gsap.set(images,{clearProps:'transform,translate,scale'})
}
function stopPageEffects() {
  observer?.disconnect(); observer = null
  pageTween?.kill(); pageTween = null
  layoutTween?.kill(); layoutTween = null
  pageContext?.revert(); pageContext = null
}
export function prepareNavigation(link, route) {
  requestedRoute = new URL(route,location.href).pathname
  pendingLink = link
}
function sourcesFor(main) {
  const incomingSlug = collectionSlug(requestedRoute)
  const outgoing = main.querySelector('.collection-page')
  const outgoingSlug = outgoing?.dataset.collectionSlug || collectionSlug(lastRoute)
  const cover = pendingLink?.closest('.collection-card') || (incomingSlug && main.querySelector(`.collection-card[data-collection-slug="${escaped(incomingSlug)}"]`))
  if (cover && incomingSlug) {
    const posters = [...cover.querySelectorAll('.collection-cover [data-poster-id]')].slice(0,5)
    collectionMemories.set(incomingSlug,posters.map(node => node.dataset.posterId))
    return {kind:'collection',slug:incomingSlug,posters,title:cover.querySelector('[data-collection-title]')}
  }
  if (outgoing && outgoingSlug && (requestedRoute === '/' || requestedRoute === '/collections')) {
    const ids = collectionMemories.get(outgoingSlug) || [...outgoing.querySelectorAll('.poster-grid [data-poster-id]')].slice(0,4).map(node => node.dataset.posterId)
    return {
      kind:'collection',slug:outgoingSlug,
      posters:ids.map(id => outgoing.querySelector(`.poster-grid [data-poster-id="${escaped(id)}"]`)).filter(Boolean),
      title:outgoing.querySelector('[data-collection-title]'),
    }
  }
  // A single title uses a quiet dissolve; only collections reparent images.
  return {posters:[]}
}

export async function leavePage(main) {
  sameComposition = mounted && requestedRoute === lastRoute
  filmTransition = mounted && !sameComposition && (titleRoute(requestedRoute) || titleRoute(lastRoute))
  const outgoingOpacity = Number(getComputedStyle(main).opacity)
  neutralizePosterImages(main)
  const cards = [...main.querySelectorAll('.title-card')]
  cards.forEach(card => { card.dataset.flipId = `card-${card.dataset.title}` })
  cardState = sameComposition && !reducedMotion() ? Flip.getState(cards,{kill:false}) : null
  const candidates = !sameComposition && !reducedMotion() ? sourcesFor(main) : {posters:[]}
  // Measure before stopping an in-flight tween, so repeated clicks start here.
  const nodes = [...candidates.posters,candidates.title].filter(node => node && visible(node))
  const measured = nodes.map(node => {
    const style = getComputedStyle(node)
    return {node,box:node.getBoundingClientRect(),font:style.font,letterSpacing:style.letterSpacing,lineHeight:style.lineHeight,color:style.color,borderRadius:style.borderRadius,id:node.dataset.posterId,title:node.hasAttribute('data-collection-title')}
  })
  stopPageEffects(); clearLayer()
  main.querySelectorAll('[data-reveal]').forEach(node => node.removeAttribute('data-reveal'))
  if (!mounted || reducedMotion() || sameComposition) return
  if (filmTransition) {
    // Keep both scenes visible: the title never flies or vanishes into black.
    // Reuse the current opacity if a fast Back interrupts the entrance.
    gsap.set(main,{opacity:outgoingOpacity})
    await new Promise(resolve => {
      pageTween = gsap.to(main,{opacity:.55,duration:.18,ease:'power2.out',onComplete:resolve,onInterrupt:resolve})
    })
    return
  }
  if (measured.length) {
    layer = document.createElement('div'); layer.className = 'collection-motion-layer'
    layer.setAttribute('aria-hidden','true'); layer.inert = true; document.body.append(layer)
    shared = measured.map(({node,box,font,letterSpacing,lineHeight,color,borderRadius,id,title}) => {
      const spacer = node.cloneNode(false)
      for (const name of ['id','data-poster-id','data-collection-title','data-flip-id']) spacer.removeAttribute(name)
      spacer.style.visibility = 'hidden'; spacer.setAttribute('aria-hidden','true')
      node.replaceWith(spacer); layer.append(node); gsap.killTweensOf(node)
      node.dataset.motionOriginalStyle = node.getAttribute('style') || ''
      Object.assign(node.style,{
        position:'fixed',left:`${box.left}px`,top:`${box.top}px`,width:`${box.width}px`,height:`${box.height}px`,margin:'0',
        transform:'none',translate:'none',rotate:'none',scale:'none',maxHeight:'none',maxWidth:'none',minWidth:'0',minHeight:'0',
        font,letterSpacing,lineHeight,color,borderRadius,opacity:'1',zIndex:'1',
      })
      return {node,id,title,slug:candidates.slug,kind:candidates.kind}
    })
    // Codrops' measure -> reparent -> Flip.from pattern, bridged across the router.
    sharedState = Flip.getState(shared.map(item => item.node),{props:'borderRadius,fontSize,lineHeight,letterSpacing',simple:true,kill:false})
    void decodeImages(shared.map(item => item.node))
  }
  await new Promise(resolve => {
    pageTween = gsap.to(main,{opacity:0,duration:.18,onComplete:resolve,onInterrupt:resolve})
  })
}

function mountShared(main) {
  const incomingSlug = collectionSlug(location.pathname), transferred = []
  // The router has now restored/reset native scroll. Recapture the fixed bridge
  // against this scroll position before reparenting, avoiding a document-offset jump.
  if (shared.length) sharedState = Flip.getState(shared.map(item => item.node),{props:'borderRadius,fontSize,lineHeight,letterSpacing',simple:true,kill:false})
  for (const item of shared) {
    const {node,id,title,slug,kind} = item
    const scope = kind === 'collection'
      ? incomingSlug ? main.querySelector('.collection-page') : main.querySelector(`.collection-card[data-collection-slug="${escaped(slug)}"]`)
      : main
    const target = title
      ? scope?.querySelector(`[data-collection-title="${escaped(slug)}"]`)
      : scope?.querySelector(kind === 'collection' ? `[data-poster-id="${escaped(id)}"]` : `.detail-poster [data-poster-id="${escaped(id)}"],.hero-poster [data-poster-id="${escaped(id)}"],.title-card [data-poster-id="${escaped(id)}"]`)
    if (!target || !visible(target)) { node.remove(); continue }
    const layoutStyle = target.getAttribute('style'); delete node.dataset.motionOriginalStyle
    if (layoutStyle) node.setAttribute('style',layoutStyle); else node.removeAttribute('style')
    gsap.set(node,{clearProps:'transform,translate,rotate,scale,opacity,width,height,position,top,left,minWidth,minHeight,maxWidth,maxHeight'})
    target.replaceWith(node); transferred.push(node)
  }
  const state = sharedState, collection = shared.some(item => item.kind === 'collection')
  layer?.remove(); layer = null; shared = []; sharedState = null
  if (transferred.length && state) {
    const titles = transferred.filter(node => node.hasAttribute('data-collection-title'))
    const posters = transferred.filter(node => !node.hasAttribute('data-collection-title'))
    const common = {duration:collection ? timing.collection : timing.page,ease:collection ? 'expo.inOut' : 'power3.inOut',nested:true,prune:true}
    layoutTween = gsap.timeline({onComplete:() => { layoutTween = null }})
    if (posters.length) layoutTween.add(Flip.from(state,{...common,targets:posters,props:'borderRadius',scale:true,stagger:collection ? .035 : 0}),0)
    // Typography changes its real size/line width; letters never stretch like an image.
    if (titles.length) layoutTween.add(Flip.from(state,{...common,targets:titles,props:'fontSize,lineHeight,letterSpacing',scale:false}),0)
  }
  return transferred
}

export function mountMotion(main) {
  observer?.disconnect(); pageTween?.kill(); mounted = true
  const calmFilm = filmTransition || titleRoute(location.pathname)
  filmTransition = false
  lastRoute = location.pathname; requestedRoute = location.pathname; pendingLink = null
  gsap.set(main,{opacity:1,clearProps:'transform'})
  neutralizePosterImages(main)
  const cards = [...main.querySelectorAll('.title-card')]
  cards.forEach(card => { card.dataset.flipId = `card-${card.dataset.title}` })
  if (reducedMotion()) {
    clearLayer(); cardState = null
    main.querySelectorAll('[data-reveal]').forEach(node => node.removeAttribute('data-reveal'))
    syncNavigation(); return
  }
  const transferred = mountShared(main)
  const containsShared = node => transferred.some(image => node === image || node.contains(image))
  if (cardState && sameComposition) {
    layoutTween = Flip.from(cardState,{
      targets:cards,duration:.55,ease:'power3.inOut',absolute:true,scale:true,fade:true,
      onEnter:elements => gsap.fromTo(elements,{opacity:0},{opacity:1,duration:.22,delay:.12}),
    })
  } else {
    pageContext = gsap.context(() => {
      if (calmFilm) {
        gsap.fromTo(main,{opacity:.55},{opacity:1,duration:timing.film,ease:'power2.out',clearProps:'opacity'})
        const composition = main.querySelectorAll('.title-sidebar,.title-info,.page-heading,.hero-content,.hero-posters,.profile-heading')
        if (composition.length) gsap.from(composition,{y:8,duration:timing.film,ease:'power2.out',stagger:.025,clearProps:'transform'})
      } else {
        if (!transferred.length) gsap.fromTo(main,{opacity:.35},{opacity:1,duration:.5})
        const headings = [...main.querySelectorAll('.hero-kicker,.hero h1,.hero-description,.hero-actions,.hero-note,.hero-posters .hero-poster,.page-heading,.title-kicker,.title-info>h1,.original-name,.profile-heading')].filter(node => !containsShared(node))
        if (headings.length) gsap.from(headings,{y:18,opacity:0,duration:timing.reveal,stagger:.04,clearProps:'transform,opacity'})
      }
    },main)
    observer = new IntersectionObserver(entries => {
      let delay = 0
      for (const entry of entries) if (entry.isIntersecting) {
        const node = entry.target; node.removeAttribute('data-reveal')
        pageContext?.add(() => gsap.from(node,{y:calmFilm ? 8 : 16,opacity:0,duration:calmFilm ? timing.film : timing.reveal,ease:calmFilm ? 'power2.out' : 'power3.inOut',delay:Math.min(delay++*.04,.16),clearProps:'transform,opacity'}))
        observer?.unobserve(node)
      }
    },{threshold:.03})
    main.querySelectorAll('.title-card,.collection-card,.section-heading,.profile-review,.discussion-item,.onboard-card,.archive-note,.personal-collection').forEach(node => {
      if (!containsShared(node)) { node.dataset.reveal = 'pending'; observer.observe(node) }
    })
    if (transferred.length) pageContext.add(() => {
      const captions = [...new Set(transferred.map(node => node.closest('.title-card')?.querySelector('.card-info')).filter(Boolean))]
      if (captions.length) gsap.from(captions,{y:8,opacity:0,duration:.55,delay:.3,stagger:.04,clearProps:'transform,opacity'})
    })
  }
  void decodeImages([...main.querySelectorAll('.hero .poster-placeholder,.collection-cover')])
  cardState = null; syncNavigation()
}

// The fullscreen header owns its animation; preserve the router's event/API.
export function syncNavigation() { document.dispatchEvent(new Event('grade:navigation')) }
document.fonts?.ready.then(syncNavigation)

const dialogs = new WeakMap(), activeDialogs = new Set()
export function openDialog(dialog) {
  const old = dialogs.get(dialog)
  if (!dialog.open) dialog.showModal()
  document.dispatchEvent(new CustomEvent('grade:dialog-open',{detail:dialog}))
  if (old) { old.closing = false; old.timeline.eventCallback('onReverseComplete',null).play(); return }
  if (reducedMotion()) { gsap.set(dialog,{'--backdrop-opacity':1}); return }
  const sidePanel = dialog.classList.contains('track-auth')
  const timeline = gsap.timeline({paused:true}).fromTo(dialog,
    {opacity:sidePanel ? 1 : 0,xPercent:sidePanel ? 100 : 0,y:sidePanel ? 0 : 14,'--backdrop-opacity':0},
    {opacity:1,xPercent:0,y:0,'--backdrop-opacity':1,duration:.6,ease:'power3.inOut'})
  dialogs.set(dialog,{timeline,closing:false}); activeDialogs.add(dialog); timeline.play()
}
export function closeDialog(dialog, after = () => {}) {
  if (!dialog.open) return
  document.dispatchEvent(new CustomEvent('grade:dialog-close',{detail:dialog}))
  const state = dialogs.get(dialog)
  const finish = () => {
    dialog.close(); state?.timeline.kill(); dialogs.delete(dialog); activeDialogs.delete(dialog)
    gsap.set(dialog,{clearProps:'transform,opacity,--backdrop-opacity'}); after()
  }
  if (reducedMotion() || !state) { finish(); return }
  state.closing = true; state.finish = finish
  state.timeline.eventCallback('onReverseComplete',finish).reverse()
}

let pressed = null
function release() {
  if (pressed) gsap.to(pressed,{opacity:1,duration:reducedMotion() ? 0 : timing.micro,clearProps:'opacity'})
  pressed = null
}
document.addEventListener('pointerdown',event => {
  const node = event.target.closest('button,.button')
  if (!node || node.disabled || event.button !== 0 || reducedMotion() || node.closest('.track-header')) return
  release(); pressed = node; gsap.to(node,{opacity:.62,duration:.18})
},{passive:true})
document.addEventListener('pointerup',release,{passive:true})
document.addEventListener('pointercancel',release,{passive:true})
window.addEventListener('blur',release)
preference.addEventListener('change',() => {
  if (!reducedMotion()) return
  layoutTween?.progress(1); pageTween?.progress(1); pageContext?.revert(); pageContext = null
  observer?.disconnect(); observer = null
  document.querySelectorAll('[data-reveal]').forEach(node => node.removeAttribute('data-reveal'))
  gsap.set(document.querySelectorAll('.poster-placeholder img,.card-actions'),{clearProps:'transform,opacity'})
  for (const dialog of activeDialogs) {
    const state = dialogs.get(dialog)
    if (state?.closing) state.finish(); else state?.timeline.progress(1)
  }
})
// Keep native iPhone scrolling and edge-back gestures, without pointer capture.
export function enableGestures() { history.scrollRestoration = 'manual' }
