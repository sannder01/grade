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
let disposeHero = null, heroSeen = false
let disposeCollectionGallery = null, mountRevision = 0
let titleModulePromise = null, titleSession = null, titleAbort = null, titleSource = null, titleBridge = null
let navigationRevision = 0
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
function mountOptionalHeroScene(hero, animate) {
  let active = true, cleanup = null
  const copy = animate && !reducedMotion() ? gsap.context(() => {
    gsap.fromTo(hero.querySelectorAll('.cinema-title-line'),
      {clipPath:'inset(100% 0% 0% 0%)',y:18},
      {clipPath:'inset(0% 0% 0% 0%)',y:0,duration:1.1,delay:.25,stagger:.12,ease:'power3.inOut',clearProps:'clipPath,transform'})
    gsap.fromTo(hero.querySelector('.cinema-kicker'),{opacity:.45,y:6},{opacity:1,y:0,duration:.75,clearProps:'opacity,transform'})
  },hero) : null
  const settleCopy = () => { if (reducedMotion()) copy?.revert() }
  preference.addEventListener('change',settleCopy)
  // The film collection and its actions remain usable if the optional 3D
  // module cannot load, or if navigation finishes before it is available.
  import('./hero-scene.js').then(({mountHeroScene}) => {
    if (active && hero.isConnected) cleanup = mountHeroScene(hero,{animate})
  }).catch(() => {
    if (active && hero.isConnected) {
      hero.dataset.heroScene = hero.dataset.heroSceneState = 'fallback'
      hero.dataset.heroSceneMode = 'static'
    }
  })
  return () => {
    active = false
    preference.removeEventListener('change',settleCopy)
    copy?.revert(); cleanup?.()
  }
}
function mountOptionalCollectionGallery(root) {
  let active = true, cleanup = null, held = false, resolveReady
  const ready = new Promise(resolve => { resolveReady = resolve })
  import('./collection-gallery.js').then(({mountCollectionGallery}) => {
    if (!active || !root.isConnected) return
    cleanup = mountCollectionGallery(root)
    cleanup.hold?.(held)
    Promise.resolve(cleanup.ready).then(resolveReady)
  }).catch(() => {
    if (active && root.isConnected) {
      root.dataset.galleryState = 'fallback'; root.dataset.galleryMode = 'static'
    }
    resolveReady()
  })
  const dispose = () => { active = false; cleanup?.(); resolveReady() }
  dispose.hold = value => { held = !!value; cleanup?.hold?.(held) }
  dispose.ready = ready
  return dispose
}
function stopPageEffects() {
  mountRevision++
  // Keep the current 3D frame through the route's dissolve. mountMotion owns
  // disposal immediately after DOM replacement, before mounting another scene.
  // The gallery is held too: restoring its grid here would collapse native
  // scroll before the shared poster bridge has completed its measurements.
  observer?.disconnect(); observer = null
  pageTween?.kill(); pageTween = null
  layoutTween?.kill(); layoutTween = null
  pageContext?.revert(); pageContext = null
}
function loadTitleModule() {
  return titleModulePromise ||= import('./title-dissolve.js').catch(() => { titleModulePromise=null; return null })
}
async function readyTitleModule() {
  let timer
  try { return await Promise.race([loadTitleModule(),new Promise(resolve=>{timer=setTimeout(()=>resolve(null),750)})]) }
  finally { clearTimeout(timer) }
}
function imageFrame(image) {
  if (!image?.complete || !image.naturalWidth || !visible(image)) return null
  const rect=image.getBoundingClientRect()
  if (rect.bottom<=0 || rect.top>=innerHeight || rect.right<=0 || rect.left>=innerWidth) return null
  const holder=image.closest('.poster-placeholder,.detail-poster,.scene-atlas-tile') || image
  return {url:image.currentSrc || image.src,rect:{left:rect.left,top:rect.top,width:rect.width,height:rect.height},
    title:image.alt || '',radius:parseFloat(getComputedStyle(holder).borderRadius) || 0,
    objectPosition:getComputedStyle(image).objectPosition,cinema:image.hasAttribute('data-title-backdrop')}
}
function filmDescriptor(root) {
  const film=root.querySelector('.title-film-scene')
  return film ? {id:film.dataset.titleId,poster:film.dataset.titlePoster,url:film.dataset.titleBackdropUrl,title:film.querySelector('h1')?.textContent || ''} : null
}
function primeTitleLink(target) {
  if (reducedMotion()) return
  const link=target?.closest?.('a[href^="/title/"]')
  if (!link || new URL(link.href,location.href).pathname===lastRoute) return
  const card=link.closest('.title-card,.cinema-film-link,.frame-result,.profile-review,.onboard-card')
  const image=link.querySelector('img') || card?.querySelector('img')
  const poster=image?.currentSrc || image?.src
  const backdrop=card?.dataset.titleBackdropUrl
  if (!poster) return
  void loadTitleModule().then(module=>module?.primeTitleImages?.([
    {url:poster,kind:'poster'},...(backdrop ? [{url:backdrop,kind:'backdrop'}] : []),
  ]))
}
for (const event of ['pointerover','focusin','touchstart']) document.addEventListener(event,event=>primeTitleLink(event.target),{passive:true})
export function prepareNavigation(link, route) {
  navigationRevision++
  titleAbort?.abort(); titleAbort=new AbortController()
  titleSession?.cancel(); titleSession=null; titleBridge=null
  const main=document.querySelector('#main')
  const card=link?.closest('.title-card,.cinema-film-link,.frame-result,.profile-review,.onboard-card')
  const searchScene=link?.closest('.search-scene'),id=/^\/title\/(\d+)$/.exec(new URL(route,location.href).pathname)?.[1]
  const clickedImage=link?.querySelector('img') || card?.querySelector('img')
  const image=searchScene ? clickedImage : main?.querySelector('[data-title-backdrop]') || clickedImage
  const preview=searchScene && id && Number(gsap.getProperty(searchScene,'--scene-type-progress'))>=.99
    ? searchScene.querySelector(`[data-scene-preview-title="${escaped(id)}"] img`) : null
  titleSource=imageFrame(preview) || imageFrame(image)
  primeTitleLink(link)
  requestedRoute = new URL(route,location.href).pathname
  pendingLink = link
  if (!reducedMotion() && (titleRoute(requestedRoute) || titleRoute(lastRoute))) void loadTitleModule()
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

export async function leavePage(main,{content,headerCovered=false} = {}) {
  const navigation=navigationRevision, signal=titleAbort?.signal
  sameComposition = mounted && requestedRoute === lastRoute
  filmTransition = !headerCovered && mounted && !sameComposition && (titleRoute(requestedRoute) || titleRoute(lastRoute))
  const outgoingOpacity = Number(getComputedStyle(main).opacity)
  neutralizePosterImages(main)
  // Freeze the actual visible cover positions; measure them before cleanup so
  // the shared posters start their Flip at precisely the clicked location.
  disposeCollectionGallery?.hold?.(true)
  const cards = [...main.querySelectorAll('.title-card')]
  cards.forEach(card => { card.dataset.flipId = `card-${card.dataset.title}` })
  cardState = !headerCovered && sameComposition && !reducedMotion() ? Flip.getState(cards,{kill:false}) : null
  const candidates = !headerCovered && !sameComposition && !reducedMotion() ? sourcesFor(main) : {posters:[]}
  // Measure before stopping an in-flight tween, so repeated clicks start here.
  const nodes = [...candidates.posters,candidates.title].filter(node => node && visible(node))
  const measured = nodes.map(node => {
    const style = getComputedStyle(node)
    return {node,box:node.getBoundingClientRect(),font:style.font,letterSpacing:style.letterSpacing,lineHeight:style.lineHeight,color:style.color,borderRadius:style.borderRadius,id:node.dataset.posterId,title:node.hasAttribute('data-collection-title')}
  })
  stopPageEffects(); clearLayer()
  main.querySelectorAll('[data-reveal]').forEach(node => node.removeAttribute('data-reveal'))
  if (headerCovered) { sameComposition=false; return }
  if (!mounted || reducedMotion() || sameComposition) return
  if (filmTransition) {
    // The optional shader owns a temporary fixed media field. Actual poster
    // nodes and their geometry stay in the catalog; only collections reparent.
    const outgoing=filmDescriptor(main)
    const template=document.createElement('template'); template.innerHTML=content || ''
    const incoming=filmDescriptor(template.content)
    const module=titleSource && await readyTitleModule()
    if (navigation!==navigationRevision || signal?.aborted) return
    if (module && (incoming || outgoing)) {
      const session=module.beginTitleDissolve({
        from:titleSource,to:{url:incoming?.url || outgoing?.poster,title:incoming?.title || outgoing?.title},
        direction:incoming ? 'in' : 'back',signal,
        releaseGPU:() => { disposeHero?.(); disposeHero=null },
      })
      titleSession=session
      const covered=await session.covered
      if (navigation!==navigationRevision || signal?.aborted) { session.cancel(); return }
      if (covered) {
        titleBridge={session,id:incoming?.id || outgoing.id,direction:incoming ? 'in' : 'back'}
        gsap.set(main,{opacity:1}); return
      }
      session.dispose()
      if (titleSession===session) titleSession=null
    }
    if (reducedMotion()) { gsap.set(main,{opacity:1}); return }
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

export async function mountMotion(main) {
  const revision = ++mountRevision
  observer?.disconnect(); pageTween?.kill(); mounted = true
  disposeCollectionGallery?.(); disposeCollectionGallery = null
  disposeHero?.(); disposeHero = null
  const hero = main.querySelector('[data-hero-scene]')
  const bridge=titleBridge
  titleBridge=null
  const startHero=() => {
    if (!hero || revision!==mountRevision || !hero.isConnected) return
    const animate = !heroSeen
    heroSeen = true
    disposeHero = mountOptionalHeroScene(hero,animate)
  }
  if (!bridge) startHero()
  const calmFilm = filmTransition || titleRoute(location.pathname)
  filmTransition = false
  lastRoute = location.pathname; requestedRoute = location.pathname; pendingLink = null
  gsap.set(main,{opacity:1,clearProps:'transform'})
  neutralizePosterImages(main)
  const collectionScene = main.querySelector('[data-collection-gallery]')
  if (collectionScene) {
    disposeCollectionGallery = mountOptionalCollectionGallery(collectionScene)
  }
  const cards = [...main.querySelectorAll('.title-card')]
  cards.forEach(card => { card.dataset.flipId = `card-${card.dataset.title}` })
  if (reducedMotion()) {
    bridge?.session.dispose()
    if (titleSession===bridge?.session) titleSession=null
    if (bridge) startHero()
    clearLayer(); cardState = null
    main.querySelectorAll('[data-reveal]').forEach(node => node.removeAttribute('data-reveal'))
    syncNavigation(); return
  }
  // Set the native-scroll composition before Flip measures its destination,
  // then hold the parent covers until that transfer finishes.
  disposeCollectionGallery?.hold?.(true)
  if (shared.length && disposeCollectionGallery) {
    // Back restores native scroll before mounting. Wait for the same camera
    // layout before Flip measures its destinations; never measure the fallback
    // grid and then move the live posters into a different composition.
    const incomingScene = disposeCollectionGallery
    gsap.set(main,{opacity:0})
    await incomingScene.ready
    if (revision !== mountRevision || incomingScene !== disposeCollectionGallery || !collectionScene.isConnected) return
    gsap.set(main,{opacity:1})
  }
  const transferred = mountShared(main)
  if (transferred.length && layoutTween) {
    const incomingScene = disposeCollectionGallery
    layoutTween.eventCallback('onComplete',() => {
      layoutTween = null
      if (incomingScene === disposeCollectionGallery) incomingScene?.hold?.(false)
    })
  } else disposeCollectionGallery?.hold?.(false)
  const containsShared = node => transferred.some(image => node === image || node.contains(image))
  if (cardState && sameComposition) {
    layoutTween = Flip.from(cardState,{
      targets:cards,duration:.55,ease:'power3.inOut',absolute:true,scale:true,fade:true,
      onEnter:elements => gsap.fromTo(elements,{opacity:0},{opacity:1,duration:.22,delay:.12}),
    })
  } else {
    pageContext = gsap.context(() => {
      if (calmFilm) {
        if (!hero && !bridge) gsap.fromTo(main,{opacity:.55},{opacity:1,duration:timing.film,ease:'power2.out',clearProps:'opacity'})
        const composition = main.querySelectorAll('.title-sidebar,.title-info:not(.title-film-heading),.page-heading,.profile-heading')
        if (composition.length) gsap.from(composition,{y:8,duration:timing.film,ease:'power2.out',stagger:.025,clearProps:'transform'})
        const caption=main.querySelector('.title-film-caption')
        if (caption) gsap.from(caption,{clipPath:'inset(100% 0% 0% 0%)',y:12,opacity:.3,duration:.68,delay:bridge ? .1 : 0,ease:'power3.inOut',clearProps:'clipPath,transform,opacity'})
      } else {
        if (!transferred.length && !hero) gsap.fromTo(main,{opacity:.35},{opacity:1,duration:.5})
        const headings = [...main.querySelectorAll('.page-heading,.title-kicker,.title-info>h1,.original-name,.profile-heading')].filter(node => !containsShared(node))
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
      if (!containsShared(node) && !node.closest('[data-collection-gallery]')) { node.dataset.reveal = 'pending'; observer.observe(node) }
    })
    if (transferred.length) pageContext.add(() => {
      const captions = [...new Set(transferred.map(node => node.closest('.title-card')?.querySelector('.card-info')).filter(Boolean))]
      if (captions.length) gsap.from(captions,{y:8,opacity:0,duration:.55,delay:.3,stagger:.04,clearProps:'transform,opacity'})
    })
  }
  void decodeImages([...main.querySelectorAll('.hero .poster-placeholder,.collection-cover')])
  cardState = null; syncNavigation()
  if (bridge) {
    const target=bridge.direction==='in' ? main.querySelector('[data-title-backdrop]')
      : main.querySelector(`[data-poster-id="${escaped(bridge.id)}"] img`)
    await bridge.session.present({main,target})
    if (titleSession===bridge.session) titleSession=null
    if (revision===mountRevision) startHero()
  }
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
  if (reducedMotion()) { gsap.set(dialog,{'--backdrop-opacity':1,'--scene-type-progress':1}); return }
  const sidePanel = dialog.classList.contains('track-auth')
  const timeline = gsap.timeline({paused:true}).fromTo(dialog,
    {opacity:sidePanel ? 1 : 0,xPercent:sidePanel ? 100 : 0,y:sidePanel ? 0 : 14,'--backdrop-opacity':0},
    {opacity:1,xPercent:0,y:0,'--backdrop-opacity':1,duration:.6,ease:'power3.inOut'})
  // Auth headings are replaced when switching forms. Animate their stable
  // dialog ancestor so fresh text inherits the same reversible playhead.
  if (sidePanel) timeline.fromTo(dialog,{'--scene-type-progress':0},{'--scene-type-progress':1,duration:.46,ease:'power3.inOut'},.12)
  dialogs.set(dialog,{timeline,closing:false}); activeDialogs.add(dialog); timeline.play()
}
export function closeDialog(dialog, after = () => {}) {
  if (!dialog.open) return
  document.dispatchEvent(new CustomEvent('grade:dialog-close',{detail:dialog}))
  const state = dialogs.get(dialog)
  const finish = () => {
    dialog.close(); state?.timeline.kill(); dialogs.delete(dialog); activeDialogs.delete(dialog)
    gsap.set(dialog,{clearProps:'transform,opacity,--backdrop-opacity,--scene-type-progress'}); after()
  }
  // Reversing at time zero cannot cross a boundary or fire onReverseComplete.
  if (reducedMotion() || !state || state.timeline.totalTime() === 0) { finish(); return }
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
