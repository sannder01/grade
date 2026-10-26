/*
 * Grade B adapts the camera/viewport mapping and rotating media arrangement of
 * https://github.com/oluwadareseyi/webgl-rotating-image-gallery
 * using official Three.js 0.186.1 CSS3DRenderer and the original Grade DOM links.
 * No demo wheel/touch handlers, shaders, images or additional WebGL renderer.
 * Three.js MIT: /assets/three.LICENSE.txt
 * Original full notice is also retained in /assets/codrops-gallery-LICENSE.txt.
 *
 * MIT License
 * Copyright (c) 2009 - 2024 [Codrops](https://tympanus.net/codrops)
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import { gsap } from './assets/motion-vendor.js'
import { collectionProjection } from './collection-projection.js'

const mounts = new WeakMap()
const clamp = value => Math.max(0,Math.min(1,value))
const poseProperties = ['--gallery-poster-x','--gallery-poster-y','--gallery-poster-z','--gallery-poster-yaw','filter']

export function mountCollectionGallery(root,{onActiveChange} = {}) {
  if (!root) {
    const noop=() => {}; noop.hold=() => {}; noop.ready=Promise.resolve('fallback'); return noop
  }
  mounts.get(root)?.()
  const stage=root.querySelector('[data-gallery-stage]'), host=root.querySelector('[data-gallery-space]')
  const grid=host?.querySelector('.collection-grid')
  const cards=grid ? [...grid.querySelectorAll(':scope>.collection-card')] : []
  const reduced=matchMedia('(prefers-reduced-motion: reduce)'), mobile=matchMedia('(max-width:760px)')
  const life=new AbortController(), initialDpr=devicePixelRatio || 1
  const touchedPosters=new Map()
  let engine, records=[], observer, resizeObserver, sceneObserver, raf=0, hudTween, pendingHudCopy
  let layoutFrame=0, resolveLayout=null
  let disposed=false, held=false, visible=true, loading=true, permanentlyStatic=false, restoringFocus=false
  let progress=0, renderedProgress=0, lastTime=0, frames=0, active=-1, keyboard=false
  let pendingResize=true, lastWidth=0, lastHeight=0, requestedIndex=-1, requestedAt=0
  let resolveReady, readyResolved=false
  const ready=new Promise(resolve => { resolveReady=resolve })
  const hud={title:root.querySelector('[data-gallery-title]'),description:root.querySelector('p[data-gallery-description]'),
    enter:root.querySelector('[data-gallery-enter]'),position:root.querySelector('[data-gallery-position]'),
    previous:root.querySelector('[data-gallery-step="-1"]'),next:root.querySelector('[data-gallery-step="1"]')}
  const enterLabel=hud.enter?.textContent.trim() || ''
  const hudNodes=[hud.title,hud.description].filter(Boolean)

  function status(value,reason='') {
    if (disposed && value!=='disposed') return
    root.dataset.galleryState=value
    if (reason) root.dataset.galleryReason=reason; else delete root.dataset.galleryReason
  }
  function finishReady() {
    if (!readyResolved) { readyResolved=true; resolveReady(root.dataset.galleryState) }
  }
  function nativeRange() {
    const header=parseFloat(getComputedStyle(stage).top) || 0
    return {start:scrollY+root.getBoundingClientRect().top-header,length:Math.max(1,root.offsetHeight-stage.offsetHeight)}
  }
  function readProgress() {
    if (!stage) return 0
    const range=nativeRange()
    progress=clamp((scrollY-range.start)/range.length)
    root.dataset.galleryProgress=progress.toFixed(5)
    return progress
  }
  function zoomed() {
    return Math.abs((window.visualViewport?.scale || 1)-1)>.01 || Math.abs((devicePixelRatio || 1)-initialDpr)>.02
  }
  function gate() {
    if (document.hidden) return 'hidden'
    if (!visible) return 'offscreen'
    if (root.closest('[inert]') || document.querySelector('.scene-panel:not([hidden]),dialog[open]')) return 'scene'
    return ''
  }
  function stop() { cancelAnimationFrame(raf); raf=0; lastTime=0 }
  function settleHud() {
    hudTween?.kill(); hudTween=null
    pendingHudCopy?.(); pendingHudCopy=null
    gsap.set(hudNodes,{clearProps:'opacity,transform'})
  }
  function restorePosterStyles() {
    for (const [node,values] of touchedPosters) poseProperties.forEach((property,index) => {
      if (values[index]) node.style.setProperty(property,values[index]); else node.style.removeProperty(property)
    })
    touchedPosters.clear()
  }
  function ownedFocus() {
    const node=document.activeElement
    return cards.some(card => card===node || card.contains(node)) ? node : null
  }
  function restoreOwnedFocus(node) {
    // CSS3DRenderer moves the original anchor on its first render. Browsers
    // blur that node even though the same connected link is still on screen.
    // Restore only that synchronous blur; never take focus from another owner.
    if (!node?.isConnected || !root.isConnected || document.activeElement!==document.body || node.closest('[inert]')) return
    restoringFocus=true
    try { node.focus({preventScroll:true}) } finally { restoringFocus=false }
  }
  function release() {
    const focused=ownedFocus()
    cancelAnimationFrame(layoutFrame); layoutFrame=0; resolveLayout?.(); resolveLayout=null
    stop(); settleHud(); engine?.projection?.cleanup(); restorePosterStyles()
    // CSS3DObject's official removed event removes its element wherever it is.
    // Remove from Three first; only then put the SAME anchor back in its grid.
    for (const item of records) {
      item.object?.removeFromParent()
      if (item.marker?.parentNode) { item.marker.parentNode.insertBefore(item.card,item.marker); item.marker.remove() }
      if (item.style==null) item.card.removeAttribute('style'); else item.card.setAttribute('style',item.style)
      if (item.draggable==null) item.card.removeAttribute('draggable'); else item.card.setAttribute('draggable',item.draggable)
    }
    records=[]
    engine?.scene.clear(); engine?.renderer.domElement.remove(); engine=null
    delete root.dataset.galleryReady
    restoreOwnedFocus(focused)
  }
  function fallback(reason) {
    if (disposed) return
    loading=false; permanentlyStatic=true; release()
    life.abort(); observer?.disconnect(); resizeObserver?.disconnect(); sceneObserver?.disconnect()
    root.dataset.galleryMode='static'; status(reduced.matches ? 'reduced' : 'fallback',reason)
    finishReady()
  }
  function cleanup() {
    if (disposed) return
    disposed=true; life.abort(); observer?.disconnect(); resizeObserver?.disconnect(); sceneObserver?.disconnect()
    release(); status('disposed'); finishReady()
    if (mounts.get(root)===cleanup) mounts.delete(root)
  }
  cleanup.ready=ready
  cleanup.hold=value => {
    if (disposed || held===!!value) return
    held=!!value
    if (held) { stop(); settleHud(); if (!permanentlyStatic) status('paused','transition') }
    else reconcile()
  }
  mounts.set(root,cleanup)
  root.dataset.galleryFrames='0'; root.dataset.galleryMode='css3d'; status('loading')
  if (!host || !stage || !grid || cards.length<2) { fallback('content'); return cleanup }
  readProgress(); renderedProgress=progress

  function setActive(index) {
    index=Math.max(0,Math.min(cards.length-1,index))
    if (active===index) return
    const previous=active
    active=index
    const card=cards[index], title=card.querySelector('[data-collection-title]')?.textContent.trim() || card.querySelector('h3')?.textContent.trim() || ''
    const slug=card.dataset.collectionSlug, href=card.getAttribute('href')
    root.dataset.galleryActiveIndex=String(index); root.dataset.galleryActiveSlug=slug || ''
    const writeCopy=() => {
      if (hud.title) hud.title.textContent=title
      if (hud.description) hud.description.textContent=card.dataset.collectionDescription || ''
    }
    hudTween?.kill(); pendingHudCopy=writeCopy
    if (previous>=0 && !held && !gate()) {
      // Retarget from the current opacity/offset when scroll reverses mid-swap.
      // The copy never vanishes; only the HUD changes, never the Flip title.
      hudTween=gsap.timeline({onComplete:() => { hudTween=null; gsap.set(hudNodes,{clearProps:'opacity,transform'}) }})
        .to(hudNodes,{opacity:.65,y:-2,duration:.07,ease:'power2.out'})
        .call(() => { writeCopy(); if (pendingHudCopy===writeCopy) pendingHudCopy=null })
        .set(hudNodes,{y:4})
        .to(hudNodes,{opacity:1,y:0,duration:.15,ease:'power3.out'})
    } else { writeCopy(); pendingHudCopy=null; gsap.set(hudNodes,{clearProps:'opacity,transform'}) }
    if (hud.enter) { hud.enter.setAttribute('href',href); hud.enter.setAttribute('aria-label',`${enterLabel}: ${title}`) }
    if (hud.position) hud.position.textContent=`${String(index+1).padStart(2,'0')} / ${String(cards.length).padStart(2,'0')}`
    if (hud.previous) hud.previous.disabled=index===0
    if (hud.next) hud.next.disabled=index===cards.length-1
    onActiveChange?.({index,slug,title,href,progress:renderedProgress})
  }
  function posePosters(card,angle) {
    // Query each time: Flip replaces target placeholders with the original nodes.
    // A cached NodeList would style the discarded placeholders after browser Back.
    const posters=[...card.querySelectorAll('.collection-cover>[data-poster-id]')].slice(0,3)
    posters.forEach((node,index) => {
      if (!touchedPosters.has(node)) touchedPosters.set(node,poseProperties.map(property => node.style.getPropertyValue(property)))
      const side=index-1
      node.style.setProperty('--gallery-poster-x',`${mobile.matches ? -side*80 : 0}px`)
      node.style.setProperty('--gallery-poster-y',`${side===0 ? -12 : 15}px`)
      node.style.setProperty('--gallery-poster-z',`${side===0 ? 55 : mobile.matches ? -65 : -45}px`)
      node.style.setProperty('--gallery-poster-yaw',`${-side*(mobile.matches ? 9 : 8)}deg`)
      const light=.24+.76*Math.exp(-3.2*Math.pow(angle/engine.angle,2))
      node.style.filter=`brightness(${light.toFixed(3)})`
    })
  }
  function configure() {
    if (!engine) return
    const bounds=host.getBoundingClientRect(), width=bounds.width, height=bounds.height
    if (!width || !height) return
    const {renderer,camera}=engine
    renderer.setSize(width,height); camera.aspect=width/height
    camera.setViewOffset(width,height,mobile.matches ? 0 : -width*.18,-height*(mobile.matches ? .045 : .02),width,height)
    camera.updateProjectionMatrix()
    const cardWidth=mobile.matches ? 560 : 760
    const focal=.5*height/Math.tan(camera.fov*Math.PI/360)
    engine.distance=focal*cardWidth/(width*(mobile.matches ? 1.25 : .56))
    engine.radius=mobile.matches ? 720 : 1650; engine.angle=mobile.matches ? .55 : .58
    engine.width=width; engine.height=height; engine.mobile=mobile.matches
    records.forEach((item,index) => {
      const angle=(index-(cards.length-1)/2)*engine.angle
      item.angle=angle; item.card.style.width=`${cardWidth}px`
      item.object.position.set(Math.sin(angle)*engine.radius,0,Math.cos(angle)*engine.radius-engine.radius)
      item.object.rotation.y=angle
    })
    root.style.setProperty('--gallery-card-width',`${cardWidth}px`)
    root.style.setProperty('--gallery-card-height',`${mobile.matches ? 310 : 410}px`)
    pendingResize=false; lastWidth=width; lastHeight=height
  }
  function render() {
    if (!engine || disposed || !engine.width || !engine.height || !Number.isFinite(engine.distance)) return
    const {camera,renderer,scene,radius,distance,angle}=engine
    const phi=(renderedProgress*(cards.length-1)-(cards.length-1)/2)*angle
    camera.position.set(Math.sin(phi)*(radius+distance),Math.sin(phi)*24,Math.cos(phi)*(radius+distance)-radius)
    camera.lookAt(Math.sin(phi)*radius,0,Math.cos(phi)*radius-radius)
    records.forEach(item => posePosters(item.card,item.angle-phi))
    const focused=ownedFocus()
    renderer.render(scene,camera)
    engine.projection?.render()
    restoreOwnedFocus(focused)
    frames++; root.dataset.galleryFrames=String(frames)
    root.dataset.galleryRenderedProgress=renderedProgress.toFixed(5)
    setActive(Math.round(renderedProgress*(cards.length-1)))
    root.dispatchEvent(new CustomEvent('grade:collection-gallery-frame',{bubbles:true,detail:{frame:frames,progress,renderedProgress,index:active,slug:root.dataset.galleryActiveSlug,camera:{x:camera.position.x,y:camera.position.y,z:camera.position.z}}}))
  }
  function tick(now) {
    raf=0
    if (disposed || !engine || held || permanentlyStatic) return
    if (gate()) { reconcile(); return }
    const delta=lastTime ? Math.min(80,now-lastTime) : 16.67; lastTime=now
    readProgress()
    if (pendingResize) configure()
    renderedProgress+=(progress-renderedProgress)*(1-Math.exp(-delta/125))
    if (Math.abs(progress-renderedProgress)<.0001) renderedProgress=progress
    try { render() } catch { fallback('render'); return }
    if (Math.abs(progress-renderedProgress)>.0001) { status('active'); raf=requestAnimationFrame(tick) }
    else { lastTime=0; status('idle') }
  }
  function wake() {
    if (!engine || disposed || permanentlyStatic || held || raf || gate()) return
    raf=requestAnimationFrame(tick)
  }
  function reconcile() {
    if (disposed || permanentlyStatic) return
    if (!root.isConnected) { cleanup(); return }
    if (reduced.matches) { fallback('reduced'); return }
    if (zoomed()) { fallback('zoom'); return }
    if (held) { stop(); status('paused','transition'); return }
    const reason=gate()
    if (reason) { stop(); settleHud(); status('paused',reason); return }
    readProgress()
    if (!loading) { status('active'); wake() }
  }
  function goTo(index,instant=false) {
    if (disposed || permanentlyStatic || !engine) return
    index=Math.max(0,Math.min(cards.length-1,index))
    const range=nativeRange(), target=index/(cards.length-1)
    window.scrollTo({top:range.start+target*range.length,behavior:instant ? 'instant' : 'smooth'})
    readProgress()
    if (instant && !held) {
      if (pendingResize) configure()
      renderedProgress=progress; render(); status('idle')
    } else wake()
  }
  function step(direction) {
    const now=performance.now(), from=requestedIndex>=0 && now-requestedAt<850 ? requestedIndex : Math.max(0,active)
    requestedIndex=Math.max(0,Math.min(cards.length-1,from+direction)); requestedAt=now
    goTo(requestedIndex)
  }
  async function initialize() {
    try {
      const T=await import('./assets/hero-scene-vendor.js')
      if (disposed || permanentlyStatic) return
      if (reduced.matches || zoomed()) { fallback(reduced.matches ? 'reduced' : 'zoom'); return }
      const renderer=new T.CSS3DRenderer(), scene=new T.Scene(), camera=new T.PerspectiveCamera(50,1,1,12000)
      const world=new T.Group(); scene.add(world)
      renderer.domElement.className='collection-gallery-renderer'
      renderer.domElement.style.position='absolute'; renderer.domElement.style.inset='0'; renderer.domElement.style.pointerEvents='none'
      renderer.domElement.firstElementChild.className='collection-gallery-view'
      renderer.domElement.firstElementChild.firstElementChild.className='collection-gallery-camera'
      engine={T,renderer,scene,camera,world}
      records=[]
      for (const card of cards) {
        const marker=document.createComment('Grade collection gallery position')
        card.parentNode.insertBefore(marker,card)
        const item={card,marker,style:card.getAttribute('style'),draggable:card.getAttribute('draggable')}
        records.push(item)
        item.object=new T.CSS3DObject(card); card.style.userSelect='auto'; world.add(item.object)
      }
      host.append(renderer.domElement); loading=false; status('active')
      configure(); readProgress(); renderedProgress=progress; render()
      // Mobile engines can report a zero-sized sticky host during DOM commit.
      // Validate the actual viewport before exposing geometry to shared Flip.
      await new Promise(resolve=>{
        resolveLayout=resolve
        layoutFrame=requestAnimationFrame(()=>{
          layoutFrame=requestAnimationFrame(()=>{layoutFrame=0;resolveLayout=null;resolve()})
        })
      })
      if (disposed || permanentlyStatic || !engine) return
      configure(); readProgress(); renderedProgress=progress; render()
      if (!engine.width || !engine.height) { fallback('layout'); return }
      engine.projection=collectionProjection(root,engine,records)
      engine.projection?.render()
      root.dataset.galleryReady='true'; root.dataset.galleryPosters=String(cards.reduce((sum,card) => sum+card.querySelectorAll('.collection-cover>[data-poster-id]').length,0))
      // The first geometry is always synchronous and current, even if the router
      // requested hold while this import was pending for an incoming shared Flip.
      if (held) status('paused','transition'); else reconcile()
      finishReady()
    } catch { if (!disposed) fallback('load') }
  }

  const signal=life.signal, passive={passive:true,signal}
  window.addEventListener('scroll',() => { readProgress(); wake() },passive)
  window.addEventListener('resize',() => { pendingResize=true; reconcile() },passive)
  window.visualViewport?.addEventListener('resize',reconcile,passive)
  reduced.addEventListener('change',reconcile,{signal})
  mobile.addEventListener('change',() => { pendingResize=true; reconcile() },{signal})
  document.addEventListener('visibilitychange',reconcile,{signal})
  for (const event of ['grade:scene-closed','grade:dialog-open','grade:dialog-close']) document.addEventListener(event,reconcile,{signal})
  document.addEventListener('keydown',event => { if (['Tab','ArrowLeft','ArrowRight'].includes(event.key)) keyboard=true },{capture:true,signal})
  document.addEventListener('pointerdown',() => { keyboard=false },{capture:true,passive:true,signal})
  root.addEventListener('focusin',event => {
    if (held || restoringFocus) return
    const card=event.target.closest('.collection-card'), index=cards.indexOf(card)
    if (index>=0 && (keyboard || event.target.matches?.(':focus-visible'))) goTo(index,true)
  },{signal})
  root.addEventListener('keydown',event => {
    const card=event.target.closest('.collection-card'), index=cards.indexOf(card)
    if (index<0 || !['ArrowLeft','ArrowRight'].includes(event.key)) return
    event.preventDefault()
    const next=Math.max(0,Math.min(cards.length-1,index+(event.key==='ArrowRight' ? 1 : -1)))
    cards[next].focus({preventScroll:true})
  },{signal})
  root.querySelectorAll('[data-gallery-step]').forEach(button => button.addEventListener('click',() => step(Number(button.dataset.galleryStep)),{signal}))
  sceneObserver=new MutationObserver(reconcile)
  for (const node of [root.closest('main'),document.querySelector('.track-header'),...document.querySelectorAll('dialog')].filter(Boolean)) sceneObserver.observe(node,{attributes:true,attributeFilter:['class','inert','open']})
  if (typeof IntersectionObserver!=='undefined') {
    observer=new IntersectionObserver(entries => { visible=entries.some(entry => entry.isIntersecting); reconcile() },{threshold:.01})
    observer.observe(stage)
  }
  if (typeof ResizeObserver!=='undefined') {
    resizeObserver=new ResizeObserver(([entry]) => {
      if (Math.abs(entry.contentRect.width-lastWidth)>.5 || Math.abs(entry.contentRect.height-lastHeight)>.5) { pendingResize=true; reconcile() }
    }); resizeObserver.observe(host)
  }
  const box=stage.getBoundingClientRect(); visible=box.bottom>0 && box.top<innerHeight
  if (reduced.matches || zoomed()) fallback(reduced.matches ? 'reduced' : 'zoom')
  else void initialize()
  return cleanup
}
