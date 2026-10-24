/*
 * Grade stage 2: a single, quiet poster flowmap using current OGL 1.0.11.
 * Adapted from Robin Delaporte / Codrops' Mouse Flowmap Deformation (2019).
 * https://github.com/robin-dela/flowmap-effect
 * Custom integrated-use terms: /assets/flowmap-effect.LICENSE.txt (not MIT).
 * OGL's separate Unlicense: /assets/ogl.LICENSE.txt.
 */
const MAX_DISPLACEMENT_PX = 2
const SLEEP_AFTER_MS = 900
const FLOW_SIZE = 128
const DPR_CAP = 1.5
let mountedCleanup = null

const vertex = /* glsl */ `
  attribute vec2 uv;
  attribute vec2 position;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 0.0, 1.0);
  }
`
const fragment = /* glsl */ `
  precision highp float;
  uniform sampler2D tImage;
  uniform sampler2D tFlow;
  uniform vec2 uCover;
  uniform vec2 uOffset;
  uniform vec2 uViewport;
  uniform float uStrengthPx;
  varying vec2 vUv;
  void main() {
    vec2 flow = texture2D(tFlow, vUv).xy * 2.4;
    flow /= max(1.0, length(flow));
    vec2 edge = smoothstep(vec2(0.0), vec2(0.12), vUv)
              * smoothstep(vec2(0.0), vec2(0.12), 1.0 - vUv);
    // Object-fit: cover at the DOM image's scale; never enlarge the image.
    // The vector's length is capped at two CSS pixels, with fixed outer edges.
    vec2 shift = flow * (uStrengthPx / uViewport) * edge.x * edge.y;
    vec2 imageUv = (vUv - shift) * uCover + uOffset;
    gl_FragColor = texture2D(tImage, clamp(imageUv, 0.0, 1.0));
  }
`

function textureSource(image) {
  const source = new URL(image.currentSrc || image.src,location.href)
  // A stable CORS cache entry avoids a previous <img>'s cached no-cors response.
  // Only the private texture request changes; Grade's original image stays put.
  if (/^https?:$/.test(source.protocol) && source.origin !== location.origin) source.searchParams.set('grade-flow','1')
  return source.href
}

export function mountHeroFlow(root) {
  if (!root) return () => {}
  mountedCleanup?.()
  const frame = root.querySelector('[data-hero-media]')
  const image = frame?.querySelector('img')
  const policyQuery = matchMedia('(min-width: 761px) and (hover: hover) and (pointer: fine)')
  const reducedQuery = matchMedia('(prefers-reduced-motion: reduce)')
  const connection = navigator.connection
  const listeners = new AbortController()
  let disposed = false, failed = false, loading = false, epoch = 0
  let gpu = null, raf = 0, cancelImage = null, prepared = null
  let intersection = null, resizeObserver = null, sceneObserver = null
  let onScreen = false, needsReset = true, pendingPointer = false
  let lastPointer = null, lastMotion = 0, lastFrame = 0, frames = 0
  const pointer = {x:-1,y:-1,vx:0,vy:0}

  function state(value,reason = '') {
    if (disposed && value !== 'disposed') return
    root.dataset.heroFlow = value
    if (reason) root.dataset.heroFlowReason = reason
    else delete root.dataset.heroFlowReason
  }
  root.dataset.heroFlowFrames = '0'
  state('static','policy')

  function eligible() {
    return policyQuery.matches && !reducedQuery.matches && !connection?.saveData && !(navigator.maxTouchPoints > 0)
  }
  function introReady() {
    return !root.dataset.heroMotion || ['complete','static','reduced'].includes(root.dataset.heroMotion)
  }
  function pauseReason() {
    if (document.hidden) return 'hidden'
    if (!onScreen) return 'offscreen'
    if (root.closest('[inert]') || document.querySelector('.scene-panel:not([hidden]),dialog[open]')) return 'scene'
    return ''
  }
  function stopRendering() {
    cancelAnimationFrame(raf); raf = 0
    pendingPointer = false; lastPointer = null; needsReset = true
    pointer.vx = pointer.vy = 0
    if (gpu) {
      gpu.canvas.style.opacity = '0'
      gpu.flow?.velocity.set(0)
    }
  }
  function removeProgram(gl,program) {
    if (!program) return
    program.remove()
    if (program.vertexShader) gl.deleteShader(program.vertexShader)
    if (program.fragmentShader) gl.deleteShader(program.fragmentShader)
  }
  function releaseGPU() {
    stopRendering()
    const current = gpu; gpu = null
    if (!current) return
    const {gl,canvas,flow,geometry,program,texture} = current
    canvas.removeEventListener('webglcontextlost',contextLost)
    if (gl && !gl.isContextLost()) {
      geometry?.remove(); flow?.mesh.geometry.remove()
      removeProgram(gl,program); removeProgram(gl,flow?.mesh.program)
      if (texture) gl.deleteTexture(texture.texture)
      for (const target of new Set([flow?.mask.read,flow?.mask.write].filter(Boolean))) {
        target.textures.forEach(item => gl.deleteTexture(item.texture))
        if (target.depthTexture) gl.deleteTexture(target.depthTexture.texture)
        for (const name of ['depthBuffer','stencilBuffer','depthStencilBuffer']) if (target[name]) gl.deleteRenderbuffer(target[name])
        gl.deleteFramebuffer(target.buffer)
      }
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
    canvas.remove()
  }
  function fallback(reason) {
    if (disposed) return
    failed = true; loading = false; epoch++
    cancelImage?.(); cancelImage = null
    releaseGPU(); state('fallback',reason)
  }
  function contextLost() { fallback('context-lost') }
  function cleanup() {
    if (disposed) return
    disposed = true; epoch++; loading = false
    cancelImage?.(); cancelImage = null
    listeners.abort(); intersection?.disconnect(); resizeObserver?.disconnect(); sceneObserver?.disconnect()
    releaseGPU(); prepared = null; state('disposed')
    if (mountedCleanup === cleanup) mountedCleanup = null
  }
  mountedCleanup = cleanup
  if (!frame || !image || !image.getAttribute('src')) { fallback('texture'); return cleanup }

  function loadImage() {
    return new Promise((resolve,reject) => {
      const picture = new Image()
      const timeout = setTimeout(() => finish(new Error('Texture timeout')),8000)
      let done = false
      function finish(error) {
        if (done) return
        done = true; clearTimeout(timeout)
        picture.onload = picture.onerror = null; cancelImage = null
        if (error) { picture.removeAttribute('src'); reject(error) }
        else resolve(picture)
      }
      cancelImage = () => { picture.removeAttribute('src'); finish(new Error('Texture cancelled')) }
      picture.crossOrigin = 'anonymous'
      picture.decoding = 'async'
      picture.onload = () => {
        if (!picture.naturalWidth || !picture.naturalHeight) { finish(new Error('Empty texture')); return }
        const decoded = picture.decode?.() || Promise.resolve()
        decoded.then(() => finish(),finish)
      }
      picture.onerror = () => finish(new Error('Texture unavailable'))
      picture.src = textureSource(image)
    })
  }
  function positionFraction(value) {
    if (value?.endsWith('%')) return Math.max(0,Math.min(1,parseFloat(value)/100))
    return value === 'left' || value === 'top' ? 0 : value === 'right' || value === 'bottom' ? 1 : .5
  }
  function resize() {
    if (!gpu) return
    const bounds = frame.getBoundingClientRect()
    if (!bounds.width || !bounds.height) { stopRendering(); state('paused','offscreen'); return }
    const {renderer,uniforms,picture,flow} = gpu
    renderer.dpr = Math.min(DPR_CAP,devicePixelRatio || 1)
    renderer.setSize(bounds.width,bounds.height)
    const ratio = bounds.width/bounds.height, imageRatio = picture.naturalWidth/picture.naturalHeight
    const x = Math.min(1,ratio/imageRatio), y = Math.min(1,imageRatio/ratio)
    const position = getComputedStyle(image).objectPosition.split(' ')
    uniforms.uCover.value.set(x,y)
    uniforms.uOffset.value.set((1-x)*positionFraction(position[0]),(1-y)*(1-positionFraction(position[1])))
    uniforms.uViewport.value.set(bounds.width,bounds.height)
    flow.aspect = ratio; needsReset = true
  }
  function resetFlow() {
    const {flow} = gpu
    flow.mouse.set(-1); flow.velocity.set(0)
    flow.mesh.program.uniforms.uDissipation.value = 0
    flow.update(); flow.update()
    flow.mesh.program.uniforms.uDissipation.value = .92
    needsReset = false
  }
  function draw(strength) {
    const {renderer,mesh,uniforms,gl,canvas} = gpu
    uniforms.uStrengthPx.value = strength
    renderer.render({scene:mesh,frustumCull:false})
    frames++; root.dataset.heroFlowFrames = String(frames)
    // Synchronous event permits real readPixels QA without preserveDrawingBuffer.
    frame.dispatchEvent(new CustomEvent('grade:hero-flow-frame',{bubbles:true,detail:{frame:frames,gl,canvas,width:canvas.width,height:canvas.height}}))
  }
  function createGPU({vendor,picture}) {
    const {Renderer,Flowmap,Triangle,Texture,Program,Mesh,Vec2} = vendor
    const canvas = document.createElement('canvas')
    canvas.className = 'hero-flow-canvas'; canvas.setAttribute('aria-hidden','true')
    canvas.style.opacity = '0'; canvas.style.pointerEvents = 'none'
    canvas.addEventListener('webglcontextlost',contextLost)
    gpu = {canvas,gl:null,picture}
    const attributes = {alpha:true,depth:false,stencil:false,antialias:false,premultipliedAlpha:false,preserveDrawingBuffer:false,powerPreference:'low-power'}
    const gl = canvas.getContext('webgl2',attributes) || canvas.getContext('webgl',attributes)
    if (!gl) throw new Error('WebGL unavailable')
    gpu.gl = gl
    const renderer = new Renderer({canvas,...attributes,dpr:Math.min(DPR_CAP,devicePixelRatio || 1),webgl:typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext ? 2 : 1})
    gpu.renderer = renderer
    if (renderer.isWebgl2 ? !gl.getExtension('EXT_color_buffer_float') : !gl.getExtension('OES_texture_half_float')) throw new Error('Flow texture unsupported')
    const texture = new Texture(gl,{image:picture,generateMipmaps:false,minFilter:gl.LINEAR,magFilter:gl.LINEAR})
    gpu.texture = texture; texture.update()
    if (gl.getError() !== gl.NO_ERROR) throw new Error('Texture upload failed')
    const flow = new Flowmap(gl,{size:FLOW_SIZE,falloff:.25,alpha:.35,dissipation:.92})
    gpu.flow = flow
    for (const target of [flow.mask.read,flow.mask.write]) {
      renderer.bindFramebuffer(target)
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Flow framebuffer unsupported')
    }
    const uniforms = {
      tImage:{value:texture},tFlow:flow.uniform,uCover:{value:new Vec2(1)},uOffset:{value:new Vec2(0)},
      uViewport:{value:new Vec2(1)},uStrengthPx:{value:0},
    }
    gpu.uniforms = uniforms
    const geometry = new Triangle(gl); gpu.geometry = geometry
    const program = new Program(gl,{vertex,fragment,uniforms,depthTest:false,depthWrite:false,cullFace:null})
    gpu.program = program
    if (!gl.getProgramParameter(program.program,gl.LINK_STATUS) || !gl.getProgramParameter(flow.mesh.program.program,gl.LINK_STATUS)) throw new Error('Flow shader unavailable')
    gpu.mesh = new Mesh(gl,{geometry,program})
    frame.append(canvas); resize(); resetFlow(); draw(0)
    state('ready')
  }
  async function ensureReady() {
    if (disposed || failed || gpu || loading || !eligible() || !introReady() || pauseReason()) return
    loading = true; state('loading')
    const current = epoch
    try {
      if (!prepared) {
        const [vendor,picture] = await Promise.all([import('./assets/flow-vendor.js'),loadImage()])
        if (disposed || current !== epoch) return
        prepared = {vendor,picture}
      }
      loading = false
      if (!eligible()) { state('static','policy'); return }
      const paused = pauseReason()
      if (paused) { state('paused',paused); return }
      createGPU(prepared)
    } catch {
      if (!disposed && current === epoch) fallback(gpu ? 'webgl' : 'texture')
    }
  }
  function reconcile() {
    if (disposed || failed) return
    if (!root.isConnected) { cleanup(); return }
    if (!eligible()) {
      epoch++; loading = false; cancelImage?.(); cancelImage = null
      releaseGPU(); state('static','policy'); return
    }
    if (!introReady()) { stopRendering(); state('static','intro'); return }
    const paused = pauseReason()
    if (paused) { stopRendering(); state('paused',paused); return }
    if (!gpu) void ensureReady()
    else if (root.dataset.heroFlow === 'paused') state('idle')
  }
  function tick(now) {
    raf = 0
    if (disposed || !gpu) return
    if (!eligible() || pauseReason()) { reconcile(); return }
    try {
      const elapsed = Math.min(40,Math.max(8,lastFrame ? now-lastFrame : 16.67)); lastFrame = now
      if (needsReset) resetFlow()
      const {flow} = gpu
      flow.mouse.set(pendingPointer ? pointer.x : -1,pendingPointer ? pointer.y : -1)
      const blend = 1-Math.exp(-elapsed/(pendingPointer ? 45 : 75))
      flow.velocity.x += ((pendingPointer ? pointer.vx : 0)-flow.velocity.x)*blend
      flow.velocity.y += ((pendingPointer ? pointer.vy : 0)-flow.velocity.y)*blend
      flow.mesh.program.uniforms.uDissipation.value = Math.pow(.92,elapsed/16.67)
      flow.update(); pendingPointer = false
      const awake = now-lastMotion < SLEEP_AFTER_MS
      draw(awake ? MAX_DISPLACEMENT_PX : 0)
      if (awake) { gpu.canvas.style.opacity = '1'; state('active'); raf = requestAnimationFrame(tick) }
      else { gpu.canvas.style.opacity = '0'; needsReset = true; lastFrame = 0; state('idle') }
    } catch { fallback('webgl') }
  }
  function move(event) {
    if (event.pointerType !== 'mouse' || !gpu || disposed || !eligible() || pauseReason()) return
    const bounds = frame.getBoundingClientRect(), now = performance.now()
    if (!bounds.width || !bounds.height) return
    const previous = lastPointer || {x:event.clientX,y:event.clientY,time:now-16}
    const delta = Math.max(12,now-previous.time)
    pointer.x = (event.clientX-bounds.left)/bounds.width
    pointer.y = 1-(event.clientY-bounds.top)/bounds.height
    pointer.vx = Math.max(-1,Math.min(1,(event.clientX-previous.x)/delta*.7))
    pointer.vy = Math.max(-1,Math.min(1,(event.clientY-previous.y)/delta*.7))
    lastPointer = {x:event.clientX,y:event.clientY,time:now}; lastMotion = now; pendingPointer = true
    if (!raf) raf = requestAnimationFrame(tick)
  }
  const options = {passive:true,signal:listeners.signal}
  frame.addEventListener('pointermove',move,options)
  frame.addEventListener('pointerleave',() => { lastPointer = null },options)
  for (const query of [policyQuery,reducedQuery]) query.addEventListener('change',reconcile,{signal:listeners.signal})
  connection?.addEventListener?.('change',reconcile,{signal:listeners.signal})
  document.addEventListener('visibilitychange',reconcile,{signal:listeners.signal})
  document.addEventListener('grade:scene-closed',reconcile,{signal:listeners.signal})
  document.addEventListener('grade:dialog-open',reconcile,{signal:listeners.signal})
  document.addEventListener('grade:dialog-close',reconcile,{signal:listeners.signal})
  root.addEventListener('grade:hero-complete',reconcile,{signal:listeners.signal})
  window.addEventListener('resize',() => { resize(); reconcile() },options)
  sceneObserver = new MutationObserver(reconcile)
  for (const target of [document.querySelector('.track-header'),root.closest('main'),...document.querySelectorAll('dialog')].filter(Boolean)) {
    sceneObserver.observe(target,{attributes:true,attributeFilter:['class','inert','open']})
  }
  if (typeof IntersectionObserver === 'undefined' || typeof ResizeObserver === 'undefined') {
    fallback('observers'); return cleanup
  }
  intersection = new IntersectionObserver(entries => {
    onScreen = entries.some(entry => entry.isIntersecting)
    reconcile()
  },{threshold:.01})
  intersection.observe(frame)
  resizeObserver = new ResizeObserver(() => { resize(); reconcile() })
  resizeObserver.observe(frame)
  const bounds = frame.getBoundingClientRect()
  onScreen = bounds.width > 0 && bounds.height > 0 && bounds.bottom > 0 && bounds.top < innerHeight
  reconcile()
  return cleanup
}
