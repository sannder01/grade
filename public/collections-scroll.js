import { gsap, SplitText, ScrollTrigger } from './assets/motion-vendor.js'

/* Native-scroll scrub technique adapted from Codrops ScrollTextMotion:
 * https://github.com/codrops/ScrollTextMotion/blob/main/js/index.js
 * Copyright (c) 2009 - 2025 Codrops. MIT: /assets/scroll-text-motion.LICENSE.txt
 * Grade uses no demo Flip, ScrollSmoother, scramble, pin or scroll interception.
 */
gsap.registerPlugin(SplitText,ScrollTrigger)
const mounted = new WeakMap()
const clamp = value => Math.max(0,Math.min(1,value))

export function mountCollectionsScroll(root) {
  if (!root) { const noop = () => {}; noop.hold = () => {}; return noop }
  mounted.get(root)?.()
  const heading = root.querySelector('[data-collections-heading]')
  const covers = [...root.querySelectorAll('.collection-cover')]
  const originalStyles = new Map(covers.map(node => [node,node.getAttribute('style')]))
  const originalHeading = heading?.innerHTML
  const originalAria = heading?.getAttribute('aria-label')
  const reduced = matchMedia('(prefers-reduced-motion: reduce)')
  const mobile = matchMedia('(max-width: 760px)')
  const listeners = new AbortController()
  let split, timeline, trigger, observer, resizeObserver
  let disposed = false, staticMotion = reduced.matches, focused = false, keyboard = false
  let staticReason = reduced.matches ? 'reduced' : ''
  let held = false, heldProgress = 0, heldStyles = null, paused = '', pausedProgress = 0
  let revision = 0, synchronizing = false

  const nativeProgress = () => clamp((innerHeight*.9-root.getBoundingClientRect().top)/(innerHeight*.57))
  const documentTop = () => root.getBoundingClientRect().top+scrollY
  const writeProgress = () => {
    const value = nativeProgress()
    root.dataset.collectionsProgress = value.toFixed(5)
    return value
  }
  const setState = (value,reason = '') => {
    root.dataset.collectionsMotion = value
    if (reason) root.dataset.collectionsMotionReason = reason
    else delete root.dataset.collectionsMotionReason
  }
  const gate = () => document.hidden ? 'hidden'
    : root.closest('[inert]') || document.querySelector('.scene-panel:not([hidden]),dialog[open]') ? 'scene' : ''
  const restoreCovers = () => covers.forEach(node => {
    const style = originalStyles.get(node)
    if (style == null) node.removeAttribute('style'); else node.setAttribute('style',style)
  })
  const restoreHeld = () => heldStyles?.forEach((style,node) => {
    if (style == null) node.removeAttribute('style'); else node.setAttribute('style',style)
  })
  function stopVisual() {
    trigger?.kill(false,true); trigger = null
    split?.revert(); split = null
    timeline?.revert(); timeline?.kill(); timeline = null
    restoreCovers()
  }
  function cleanup() {
    if (disposed) return
    disposed = true; revision++
    listeners.abort(); observer?.disconnect(); resizeObserver?.disconnect()
    stopVisual(); setState('disposed')
    if (mounted.get(root) === cleanup) mounted.delete(root)
  }
  cleanup.hold = value => {
    if (disposed || held === !!value) return
    held = !!value
    if (held) {
      heldProgress = timeline?.totalProgress() || 0
      heldStyles = new Map(covers.map(node => [node,node.getAttribute('style')]))
      trigger?.disable(false,true)
      if (!staticMotion) setState('paused','transition')
    } else {
      heldStyles = null
      synchronize(true)
    }
  }
  mounted.set(root,cleanup)
  writeProgress()

  function render() {
    if (disposed || held || paused || !timeline) return
    const progress = writeProgress()
    timeline.totalProgress(focused ? 1 : progress,true)
    setState(focused ? 'static' : 'active',focused ? 'focus' : '')
  }
  function synchronize(refresh = false) {
    if (disposed || synchronizing) return
    if (!root.isConnected) { cleanup(); return }
    if (staticMotion) {
      writeProgress(); setState(reduced.matches ? 'reduced' : 'static',staticReason); return
    }
    if (held) { setState('paused','transition'); return }
    const reason = gate()
    if (reason) {
      if (!paused) pausedProgress = timeline?.totalProgress() || 0
      paused = reason; trigger?.disable(false,true); setState('paused',reason); return
    }
    paused = ''; synchronizing = true
    try {
      trigger?.enable(false,false)
      if (refresh) trigger?.refresh()
      trigger?.update()
      render()
    } finally { synchronizing = false }
  }
  function scheduleRefresh() {
    const current = ++revision
    queueMicrotask(() => { if (!disposed && current === revision) synchronize(true) })
  }
  function settleFocus(event) {
    if (disposed || staticMotion || !(keyboard || event.target.matches?.(':focus-visible'))) return
    focused = true; root.dataset.collectionsFocused = 'true'
    if (!held && !paused) render()
  }
  function fallback() {
    stopVisual(); staticMotion = true; staticReason = 'fallback'
    if (heading && !split && heading.querySelector('.collections-line')) heading.innerHTML = originalHeading
    if (heading && originalAria == null) heading.removeAttribute('aria-label')
    else if (heading) heading.setAttribute('aria-label',originalAria)
    writeProgress(); setState('static','fallback')
  }
  function build() {
    if (!heading || !covers.length) { setState('static','content'); return }
    focused = root.contains(document.activeElement) && document.activeElement.matches?.(':focus-visible')
    if (focused) root.dataset.collectionsFocused = 'true'
    try {
      split = SplitText.create(heading,{
        type:'lines',mask:'lines',linesClass:'collections-line',autoSplit:true,
        onSplit(parts) {
          trigger?.kill(false,true); trigger = null
          timeline = gsap.timeline({paused:true})
          if (parts.lines.length) timeline.fromTo(parts.lines,{yPercent:95},
            {yPercent:0,duration:1,stagger:.04,ease:'none'},0)
          timeline.fromTo(covers,{y:() => mobile.matches ? 12 : 24},
            {y:0,duration:.92,stagger:.04,ease:'none'},0)
          trigger = ScrollTrigger.create({
            trigger:root,animation:timeline,scrub:true,invalidateOnRefresh:true,
            // Numeric native coordinates avoid a stale cached scroll value when
            // the router restores Back immediately before mounting this scene.
            start:() => documentTop()-innerHeight*.9,
            end:() => documentTop()-innerHeight*.33,
            onUpdate:render,onRefresh:render,
          })
          const progress = held ? heldProgress : paused ? pausedProgress : focused ? 1 : writeProgress()
          timeline.totalProgress(progress,true)
          if (held) restoreHeld()
          synchronize()
          // SplitText restores its old totalTime after onSplit returns. Correct
          // to the current native range in the same turn, never replay from zero.
          scheduleRefresh()
          return timeline
        },
      })
    } catch { fallback() }
  }

  if (staticMotion) setState('reduced','reduced')
  else build()
  const signal = listeners.signal
  document.addEventListener('keydown',event => {
    if (['Tab','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End'].includes(event.key)) keyboard = true
  },{capture:true,signal})
  document.addEventListener('pointerdown',() => { keyboard = false },{capture:true,passive:true,signal})
  root.addEventListener('focusin',settleFocus,{signal})
  reduced.addEventListener('change',() => {
    if (reduced.matches) { staticMotion = true; staticReason = 'reduced'; revision++; stopVisual() }
    synchronize()
  },{signal})
  mobile.addEventListener('change',scheduleRefresh,{signal})
  window.addEventListener('resize',scheduleRefresh,{passive:true,signal})
  window.addEventListener('scroll',() => { if (staticMotion && !disposed && !held) writeProgress() },{passive:true,signal})
  document.addEventListener('visibilitychange',() => synchronize(true),{signal})
  for (const event of ['grade:scene-closed','grade:dialog-open','grade:dialog-close']) document.addEventListener(event,() => synchronize(true),{signal})
  observer = new MutationObserver(() => synchronize(true))
  for (const node of [root.closest('main'),document.querySelector('.track-header'),...document.querySelectorAll('dialog')].filter(Boolean)) {
    observer.observe(node,{attributes:true,attributeFilter:['class','inert','open']})
  }
  if (typeof ResizeObserver !== 'undefined') {
    let previousWidth = -1, previousHeight = -1
    resizeObserver = new ResizeObserver(([entry]) => {
      const {width,height} = entry.contentRect
      if (Math.abs(width-previousWidth)>.5 || Math.abs(height-previousHeight)>.5) {
        previousWidth = width; previousHeight = height; scheduleRefresh()
      }
    })
    resizeObserver.observe(root)
  }
  synchronize()
  return cleanup
}
