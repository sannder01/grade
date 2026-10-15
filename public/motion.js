const preference = matchMedia('(prefers-reduced-motion: reduce)')
export const reducedMotion = () => preference.matches
const ease = 'cubic-bezier(.16,1,.3,1)'
export function motion(element, frames, options = {}) {
  if (!element || reducedMotion() || !element.animate) return null
  return element.animate(frames,{ duration:460,easing:ease,...options })
}

// Sample a damped spring once; the browser plays it without a JavaScript frame loop.
function springFrames(frame, duration = 720) {
  const damping = 9, frequency = 17
  return Array.from({ length:49 },(_,index) => {
    const offset = index/48, time = offset*duration/1000
    const displacement = Math.exp(-damping*time)*(Math.cos(frequency*time)+damping/frequency*Math.sin(frequency*time))
    return { ...frame(index === 48 ? 1 : 1-displacement),offset }
  })
}

let observer, pageAnimation, direction = 0, mounted = false
export async function leavePage(main) {
  observer?.disconnect()
  const opacity = getComputedStyle(main).opacity
  pageAnimation?.cancel()
  if (!mounted) return
  pageAnimation = motion(main,[
    { opacity,transform:'translate3d(0,0,0)' },
    { opacity:0,transform:`translate3d(${-direction*10}px,-4px,0)` },
  ],{ duration:120,easing:'ease-out' })
  await pageAnimation?.finished.catch(() => {})
}
export function mountMotion(main) {
  observer?.disconnect()
  pageAnimation?.cancel()
  mounted = true
  pageAnimation = motion(main,[
    { opacity:0,transform:`translate3d(${direction*18}px,${direction ? 0 : 12}px,0)` },
    { opacity:1,transform:'translate3d(0,0,0)' },
  ],{ duration:520 })
  direction = 0
  if (reducedMotion() || !('IntersectionObserver' in window)) return
  let stagger = 0
  observer = new IntersectionObserver(entries => {
    let delay = 0
    for (const entry of entries) if (entry.isIntersecting) {
      entry.target.removeAttribute('data-reveal')
      motion(entry.target,[{ opacity:0,transform:'translate3d(0,16px,0)' },{ opacity:1,transform:'translate3d(0,0,0)' }],{ duration:560,delay:Math.min(delay++*32,128),fill:'backwards' })
      observer.unobserve(entry.target)
    }
  },{ threshold:.04 })
  const viewport = innerHeight
  main.querySelectorAll('.title-card,.profile-review,.discussion-item,.section-heading,.profile-stats,.onboard-card').forEach(element => {
    const bounds = element.getBoundingClientRect()
    if (bounds.top >= viewport) {
      element.dataset.reveal = 'pending'
      observer.observe(element)
    } else if (bounds.bottom > 0 && element.matches('.title-card,.profile-stats,.onboard-card') && stagger < 10) {
      motion(element,[{ opacity:0,translate:'0 14px' },{ opacity:1,translate:'0 0' }],{ duration:540,delay:Math.min(stagger++*28,140),fill:'backwards' })
    }
  })
}

let indicatorAnimation, navFrame
export function syncNavigation() {
  const nav = document.querySelector('.mobile-nav'), indicator = nav?.querySelector('.nav-indicator')
  if (!indicator) return
  const active = nav.querySelector('a.active')
  if (!active || !nav.offsetWidth) {
    nav.removeAttribute('data-ready')
    indicatorAnimation?.cancel()
    return
  }
  const previous = indicator.getBoundingClientRect(), navBounds = nav.getBoundingClientRect()
  const left = active.offsetLeft, width = active.offsetWidth
  const ready = nav.hasAttribute('data-ready')
  indicatorAnimation?.cancel()
  indicator.style.width = width+'px'
  indicator.style.transform = `translate3d(${left}px,0,0)`
  nav.dataset.ready = 'true'
  if (ready) {
    const from = previous.left-navBounds.left-nav.clientLeft
    indicatorAnimation = motion(indicator,springFrames(progress => ({
      transform:`translate3d(${from+(left-from)*progress}px,0,0) scaleX(${(previous.width+(width-previous.width)*progress)/width})`,
    })),{ duration:720,easing:'linear' })
  }
}
function scheduleNavigation() {
  cancelAnimationFrame(navFrame)
  navFrame = requestAnimationFrame(syncNavigation)
}
new ResizeObserver(scheduleNavigation).observe(document.querySelector('.mobile-nav'))
document.fonts?.ready.then(scheduleNavigation)

// One delegated gesture works for controls added by any page or dialog.
const elasticSelector = 'button,a[href],.photo-select'
const returns = new WeakMap()
let held = null, heldFrame = 0, suppressedClick = null
const resist = (delta,limit) => limit*Math.tanh(delta/90)
function paintHeld() {
  heldFrame = 0
  if (!held) return
  const { element,x,y,sx,sy,angle } = held
  element.style.translate = `${x}px ${y}px`
  element.style.scale = `${sx} ${sy}`
  element.style.rotate = angle+'deg'
}
function clearElastic(element) {
  element.removeAttribute('data-elastic')
  for (const property of ['translate','scale','rotate']) element.style.removeProperty(property)
}
function releaseHeld(cancelled = false) {
  if (!held) return
  cancelAnimationFrame(heldFrame); heldFrame = 0
  const current = held
  held = null
  const { element,x,y,sx,sy,angle,pointerId,dragged } = current
  if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId)
  if (dragged && !cancelled) suppressedClick = { pointerId,until:Date.now()+500 }
  clearElastic(element)
  if (!element.isConnected || reducedMotion()) return
  const animation = motion(element,springFrames(progress => {
    const remaining = 1-progress
    return {
      translate:`${x*remaining}px ${y*remaining}px`,
      scale:`${1+(sx-1)*remaining} ${1+(sy-1)*remaining}`,
      rotate:angle*remaining+'deg',
    }
  }),{ duration:720,easing:'linear' })
  if (animation) {
    returns.set(element,animation)
    animation.finished.catch(() => {}).finally(() => {
      if (returns.get(element) === animation) returns.delete(element)
    })
  }
}
document.addEventListener('pointerdown',event => {
  suppressedClick = null
  if (held && event.pointerId !== held.pointerId) { releaseHeld(true); return }
  if (!event.isPrimary || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || reducedMotion()) return
  const element = event.target.closest(elasticSelector)
  if (!element || element.matches(':disabled,[aria-disabled=true]') || element.closest('[inert]') ||
      event.target.closest('input,textarea,select,[contenteditable]') || element.classList.contains('skip-link')) return
  const style = getComputedStyle(element)
  const [x = 0,y = 0] = style.translate.split(' ').map(value => parseFloat(value) || 0)
  const scales = style.scale.split(' ').map(value => parseFloat(value) || 1)
  const angle = parseFloat(style.rotate) || 0
  returns.get(element)?.cancel()
  held = { element,pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,originX:x,originY:y,x,y,sx:scales[0]*.975,sy:(scales[1] || scales[0])*.975,angle,dragged:false }
  element.dataset.elastic = 'held'
  paintHeld()
},true)
document.addEventListener('pointermove',event => {
  if (!held || event.pointerId !== held.pointerId) return
  const dx = event.clientX-held.startX, dy = event.clientY-held.startY
  held.dragged ||= Math.hypot(dx,dy) > 9
  if (held.dragged && !held.element.hasPointerCapture(event.pointerId)) {
    try { held.element.setPointerCapture(event.pointerId) } catch { releaseHeld(true); return }
  }
  held.x = held.originX+resist(dx,30); held.y = held.originY+resist(dy,22)
  const stretch = Math.min(Math.hypot(held.x,held.y)/280,.095)
  held.sx = .965+(Math.abs(dx) >= Math.abs(dy) ? stretch : -stretch*.35)
  held.sy = .965+(Math.abs(dy) > Math.abs(dx) ? stretch : -stretch*.35)
  held.angle = held.x*.08
  if (!heldFrame) heldFrame = requestAnimationFrame(paintHeld)
},{ passive:true })
document.addEventListener('pointerup',event => {
  if (event.pointerId === held?.pointerId) releaseHeld()
},true)
document.addEventListener('pointercancel',event => {
  if (event.pointerId === held?.pointerId) releaseHeld(true)
},true)
document.addEventListener('lostpointercapture',event => {
  if (event.pointerId === held?.pointerId) releaseHeld(true)
},true)
document.addEventListener('dragstart',event => {
  if (held && held.element.contains(event.target)) event.preventDefault()
},true)
window.addEventListener('blur',() => releaseHeld(true))
document.addEventListener('click',event => {
  if (suppressedClick && Date.now() < suppressedClick.until &&
      (event.pointerId === suppressedClick.pointerId || !('pointerId' in event)) && (event.detail > 0 || event.pointerType)) {
    event.preventDefault(); event.stopImmediatePropagation(); suppressedClick = null
    return
  }
  if (event.detail === 0 && !event.pointerType) {
    const control = event.target.closest(elasticSelector)
    if (control && !control.matches(':disabled,[aria-disabled=true]'))
      motion(control,springFrames(progress => ({ scale:String(.95+.05*progress) })),{ duration:720,easing:'linear' })
  }
},true)
preference.addEventListener('change',() => {
  if (!reducedMotion()) return
  releaseHeld(true)
  observer?.disconnect()
  document.querySelectorAll('[data-reveal]').forEach(element => element.removeAttribute('data-reveal'))
  document.getAnimations().forEach(animation => { try { animation.finish() } catch { animation.cancel() } })
})
export function enableGestures(main,navigate) {
  let start = null, suppressUntil = 0
  document.addEventListener('click',event => {
    if (Date.now() < suppressUntil && (event.pointerType === 'touch' || event.sourceCapabilities?.firesTouchEvents)) {
      event.preventDefault(); event.stopImmediatePropagation()
    }
  },true)
  main.addEventListener('touchstart',event => {
    start = null
    const touch = event.touches[0]
    if (event.touches.length !== 1 || innerWidth > 950 || main.inert || document.querySelector('#modal').open ||
        touch.clientX < 28 || touch.clientX > innerWidth-28 ||
        event.target.closest('input,textarea,select,button,label,[contenteditable],.category-pills,.profile-tabs,.discussion-tabs')) return
    // Preserve native horizontal scrolling, selection and browser edge navigation
    for (let node = event.target; node && node !== main; node = node.parentElement)
      if (node.scrollWidth > node.clientWidth+3 && /auto|scroll/.test(getComputedStyle(node).overflowX)) return
    if (getSelection()?.toString()) return
    start = { x:touch.clientX,y:touch.clientY,time:Date.now(),route:location.pathname+location.search }
  },{ passive:true })
  main.addEventListener('touchcancel',() => { start = null },{ passive:true })
  main.addEventListener('touchmove',event => { if (event.touches.length !== 1) start = null },{ passive:true })
  main.addEventListener('touchend',event => {
    const origin = start; start = null
    if (!origin || !event.changedTouches[0] || main.inert || origin.route !== location.pathname+location.search) return
    const touch = event.changedTouches[0], dx = touch.clientX-origin.x, dy = touch.clientY-origin.y
    if (Date.now()-origin.time > 650 || Math.abs(dx) < 85 || Math.abs(dx) < Math.abs(dy)*1.8) return
    const step = dx < 0 ? 1 : -1
    const tabs = [...main.querySelectorAll('.profile-tabs a,.discussion-tabs a')]
    let target
    if (tabs.length) {
      const index = tabs.findIndex(link => link.classList.contains('active'))
      target = tabs[index+step]?.getAttribute('href')
      if (!target && location.pathname.startsWith('/u/')) target = '/catalog'
    } else {
      const routes = ['/','/catalog','/me?tab=planned','/me?tab=watched','/me?tab=ratings']
      const index = location.pathname === '/catalog' ? 1 : routes.indexOf(origin.route)
      if (index >= 0) target = routes[index+step]
    }
    if (target) { suppressUntil = Date.now()+350; direction = step; navigate(target) }
  },{ passive:true })
}
