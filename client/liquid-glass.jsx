import React, { Component, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import LiquidGlass from 'liquid-glass-react'

// React owns only this empty decorative layer. Native links, forms and the
// existing router remain outside it, including their keyboard/focus behavior.
class GlassBoundary extends Component {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch() { this.props.host.classList.remove('liquid-glass-ready') }
  render() { return this.state.failed ? null : this.props.children }
}

function Surface({ host, width, height, reduced }) {
  useEffect(() => {
    host.classList.add('liquid-glass-ready')
    return () => host.classList.remove('liquid-glass-ready')
  }, [host])
  const round = host.matches('.hero-feature') ? 22 : 999
  return <LiquidGlass
    key={`${width}:${height}`}
    className="grade-liquid-surface"
    style={{ position: 'absolute', top: '50%', left: '50%', width: '100%', height: '100%' }}
    padding="0"
    cornerRadius={round}
    displacementScale={host.matches('.trailer-play') ? 40 : 28}
    blurAmount={0.18}
    saturation={125}
    aberrationIntensity={0.7}
    elasticity={0}
    mouseContainer={reduced ? null : { current: host }}
    globalMousePos={reduced ? { x: 0, y: 0 } : undefined}
    mouseOffset={reduced ? { x: 0, y: 0 } : undefined}
    mode="standard"
  ><span style={{ display: 'block', width, height }} /></LiquidGlass>
}

export function attachGlass(host) {
  const layer = document.createElement('span')
  layer.className = 'liquid-glass-layer'
  layer.setAttribute('aria-hidden', 'true')
  layer.inert = true
  host.prepend(layer)
  const root = createRoot(layer)
  const preference = matchMedia('(prefers-reduced-motion: reduce)')
  let size = '', disposed = false
  const render = () => {
    if (disposed) return
    const width = Math.round(host.clientWidth), height = Math.round(host.clientHeight)
    const next = `${width}:${height}:${preference.matches}`
    if (!width || !height || next === size) return
    size = next
    root.render(<GlassBoundary host={host}><Surface host={host} width={width} height={height} reduced={preference.matches} /></GlassBoundary>)
  }
  const resize = new ResizeObserver(render)
  resize.observe(host)
  preference.addEventListener('change', render)
  render()
  return () => {
    disposed = true
    resize.disconnect()
    preference.removeEventListener('change', render)
    root.unmount()
    layer.remove()
    host.classList.remove('liquid-glass-ready')
  }
}
