// Load the optional React island only after the page is usable. CSS glass is
// always available if loading fails or a browser cannot refract backdrops.
const selector = '.desktop-nav,.header-search,.mobile-nav,.hero-feature,.trailer-play'
const surfaces = new Map()
let library, observer

export function mountLiquidGlass() {
  for (const [host, surface] of surfaces) if (!host.isConnected) {
    observer?.unobserve(host)
    surface.dispose?.()
    surfaces.delete(host)
  }
  if (!('IntersectionObserver' in window) || !('ResizeObserver' in window)) return
  observer ||= new IntersectionObserver(entries => {
    for (const { target: host, isIntersecting } of entries) {
      const surface = surfaces.get(host)
      if (!surface) continue
      surface.visible = isIntersecting
      if (!isIntersecting) {
        surface.dispose?.()
        surface.dispose = null
        continue
      }
      library ||= import('./assets/liquid-glass.js').catch(() => null)
      library.then(module => {
        if (module && host.isConnected && surface.visible && !surface.dispose)
          surface.dispose = module.attachGlass(host)
      })
    }
  })
  document.querySelectorAll(selector).forEach(host => {
    if (surfaces.has(host)) return
    surfaces.set(host, { visible: false, dispose: null })
    observer.observe(host)
  })
}
