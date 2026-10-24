import { gsap, SplitText } from './assets/motion-vendor.js'

// Stage 1, adapted from docs/design/references/hero-mask-starter.mjs using
// the installed GSAP SplitText API: https://gsap.com/docs/v3/Plugins/SplitText/
// GSAP's own license is retained alongside the generated vendor bundle.
gsap.registerPlugin(SplitText)

const activeRoots = new WeakMap()
const duration = 1.2
const closedMask = 'inset(100% 0% 0% 0% round 14px)'
const openMask = 'inset(0% 0% 0% 0% round 14px)'

/** A once-per-visit hero scene. The router decides whether to animate. */
export function mountHeroMask(root, { animate = true, onComplete } = {}) {
  if (!root) return () => {}
  activeRoots.get(root)?.()
  const heading = root.querySelector('[data-hero-heading],h1')
  const frames = [...root.querySelectorAll('[data-hero-media]')].slice(0,4)
  const originalClips = new Map(frames.map(frame => [frame,frame.style.clipPath]))
  const originalHeading = heading?.innerHTML
  const originalAria = heading?.getAttribute('aria-label')
  let media, split, reveal, disposed = false, settled = false, started = false, notified = false
  const restoreFrames = () => frames.forEach(frame => {
    const clip = originalClips.get(frame)
    if (clip) frame.style.clipPath = clip
    else frame.style.removeProperty('clip-path')
  })
  const notify = () => {
    if (notified || disposed) return
    notified = true
    root.dispatchEvent(new CustomEvent('grade:hero-complete',{bubbles:true,detail:{duration}}))
    onComplete?.()
  }
  const finish = () => {
    if (disposed) return
    settled = true
    root.dataset.heroMotion = 'complete'
    restoreFrames()
    notify()
  }
  const cleanup = () => {
    if (disposed) return
    disposed = true
    media?.revert()
    reveal?.revert(); reveal?.kill(); split?.revert()
    restoreFrames()
    root.dataset.heroMotion = 'disposed'
    if (activeRoots.get(root) === cleanup) activeRoots.delete(root)
  }
  activeRoots.set(root,cleanup)
  root.dataset.heroMotion = 'idle'
  root.dataset.heroMotionDuration = duration.toFixed(3)

  // Image/font loading never gates the scene or its links. SplitText autoSplit
  // handles font metrics; failed images keep Grade's existing poster fallback.
  void Promise.allSettled(frames.flatMap(frame => [...frame.querySelectorAll('img')])
    .map(img => img.decode?.().catch(() => {}) || Promise.resolve()))

  if (!heading) {
    settled = true; root.dataset.heroMotion = 'static'; notify()
    return cleanup
  }

  media = gsap.matchMedia()
  media.add({
    reduced:'(prefers-reduced-motion: reduce)',
    motion:'(prefers-reduced-motion: no-preference)',
  }, context => {
    if (disposed) return
    if (context.conditions.reduced || !animate || settled) {
      settled = true
      restoreFrames()
      root.dataset.heroMotion = context.conditions.reduced ? 'reduced' : 'static'
      notify()
      return
    }
    try {
      split = SplitText.create(heading,{
        type:'lines',mask:'lines',linesClass:'hero-line',autoSplit:true,
        onSplit(parts) {
          // Return the complete scene so SplitText can revert it and resume its
          // totalTime during resize/font re-splits, including the poster masks.
          reveal = gsap.timeline({onComplete:finish})
          if (parts.lines.length) reveal.fromTo(parts.lines,
            {yPercent:105},
            {yPercent:0,duration:1,ease:'power3.inOut',stagger:Math.min(.07,.2/Math.max(1,parts.lines.length-1))},0)
          if (frames.length) reveal.fromTo(frames,
            {clipPath:closedMask},
            {clipPath:openMask,duration:.86,stagger:.06,ease:'power3.inOut'},.16)
          if (!started) {
            started = true; root.dataset.heroMotion = 'running'
            root.dispatchEvent(new CustomEvent('grade:hero-start',{bubbles:true,detail:{duration}}))
          }
          // Responsive re-splitting after completion keeps the final composition
          // visible. Toggling reduced motion can never restart this intro.
          if (settled) reveal.progress(1).pause()
          return reveal
        },
      })
    } catch {
      // A font/measurement/plugin failure must leave the full hero usable.
      reveal?.revert(); reveal?.kill(); split?.revert()
      heading.innerHTML = originalHeading
      if (originalAria == null) heading.removeAttribute('aria-label')
      else heading.setAttribute('aria-label',originalAria)
      restoreFrames(); settled = true; root.dataset.heroMotion = 'static'; notify()
    }
    return () => {
      split?.revert(); reveal?.kill(); restoreFrames()
      split = null; reveal = null
    }
  },root)
  return cleanup
}
