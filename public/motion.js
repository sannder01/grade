const preference = matchMedia('(prefers-reduced-motion: reduce)')
export const reducedMotion = () => preference.matches
export function motion(element, frames, options = {}) {
  if (!element || reducedMotion() || !element.animate) return null
  return element.animate(frames,{ duration:240,easing:'cubic-bezier(.2,.7,.2,1)',...options })
}

let observer, lastRoute, direction = 0
export function mountMotion(main) {
  observer?.disconnect()
  const route = location.pathname+location.search
  if (route !== lastRoute) {
    motion(main,[{ opacity:.4,transform:`translate3d(${direction*22}px,${direction ? 0 : 10}px,0)` },{ opacity:1,transform:'none' }])
    lastRoute = route; direction = 0
  }
  if (reducedMotion() || !('IntersectionObserver' in window)) return
  observer = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) {
      entry.target.removeAttribute('data-reveal')
      motion(entry.target,[{ opacity:0,transform:'translateY(14px)' },{ opacity:1,transform:'none' }],{ duration:330 })
      observer.unobserve(entry.target)
    }
  },{ threshold:.05 })
  main.querySelectorAll('.title-card,.profile-review,.discussion-item,.section-heading,.profile-stats').forEach(element => {
    if (element.getBoundingClientRect().top > innerHeight) {
      element.dataset.reveal = 'pending'
      observer.observe(element)
    }
  })
}

preference.addEventListener('change',() => {
  if (!reducedMotion()) return
  observer?.disconnect()
  document.querySelectorAll('[data-reveal]').forEach(element => element.removeAttribute('data-reveal'))
  document.getAnimations().forEach(animation => { try { animation.finish() } catch { animation.cancel() } })
})

// Delegation covers keyboard activation and dynamically rendered controls
document.addEventListener('click',event => {
  const control = event.target.closest('button,a,.photo-select')
  if (!control || control.disabled || control.getAttribute('aria-disabled') === 'true') return
  motion(control,[{ scale:'.97' },{ scale:'1' }],{ duration:180 })
},true)

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
