/*
 * PerlinDissolve by Rich Harris (MIT), adapted for Grade's fixed DOM image rects.
 * https://github.com/gl-transitions/gl-transitions/blob/master/transitions/PerlinDissolve.glsl
 * Copyright (c) 2017-present gl-transitions contributors.
 * Full notice: /assets/gl-transitions.LICENSE.txt. Three.js: /assets/three.LICENSE.txt.
 * No page screenshot, image reparenting, animated rectangle or animated UV scale.
 */
import { gsap } from './assets/motion-vendor.js'

const PREPARE_MS=900, COVER_SECONDS=.14, REVEAL_SECONDS=.68
let activeSession=null
const imageCache=new Map(), IMAGE_CACHE_LIMIT=12
let vendorPromise
const loadVendor=()=>vendorPromise ||= import('./assets/hero-scene-vendor.js')
const vertexShader=/* glsl */`
  varying vec2 vUv;
  void main() { vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }
`
const fragmentShader=/* glsl */`
  uniform sampler2D uFrom;
  uniform sampler2D uTo;
  uniform vec2 uViewport;
  uniform vec2 uFromSize;
  uniform vec2 uToSize;
  uniform vec4 uFromRect;
  uniform vec4 uToRect;
  uniform vec2 uFromPosition;
  uniform vec2 uToPosition;
  uniform float uFromRadius;
  uniform float uToRadius;
  uniform float progress;
  uniform float uFromShade;
  uniform float uToShade;
  uniform float uMobile;
  uniform vec3 uCharcoal;
  varying vec2 vUv;
  // Author: Rich Harris. License: MIT. Original PerlinDissolve noise and mix.
  float random(vec2 co) {
    float dt=dot(co,vec2(12.9898,78.233));
    return fract(sin(mod(dt,3.14))*43758.5453);
  }
  // Upstream 2D noise credit: Morgan McGuire (@morgan3d),
  // https://www.shadertoy.com/view/4dS3Wd
  float noise(vec2 st) {
    vec2 i=floor(st), f=fract(st);
    float a=random(i), b=random(i+vec2(1.0,0.0));
    float c=random(i+vec2(0.0,1.0)), d=random(i+vec2(1.0));
    vec2 u=f*f*(3.0-2.0*f);
    return mix(a,b,u.x)+(c-a)*u.y*(1.0-u.x)+(d-b)*u.x*u.y;
  }
  float imageMask(vec2 pixel,vec4 rect,float radius) {
    if(rect.z<1.0 || rect.w<1.0)return 0.0;
    vec2 d=abs(pixel-rect.xy-rect.zw*.5)-(rect.zw*.5-radius);
    float distance=length(max(d,0.0))+min(max(d.x,d.y),0.0)-radius;
    return 1.0-smoothstep(-.6,.6,distance);
  }
  vec2 imageUV(vec2 pixel,vec4 rect,vec2 size,vec2 objectPosition) {
    vec2 local=(pixel-rect.xy)/max(rect.zw,vec2(1.0));
    float frame=max(rect.z,1.0)/max(rect.w,1.0), image=max(size.x,1.0)/max(size.y,1.0);
    vec2 ratio=vec2(min(frame/image,1.0),min(image/frame,1.0));
    return clamp(local*ratio+(1.0-ratio)*objectPosition,0.0,1.0);
  }
  float filmShade(vec2 pixel,vec4 rect) {
    vec2 p=clamp((pixel-rect.xy)/max(rect.zw,vec2(1.0)),0.0,1.0);
    float vertical;
    float horizontal;
    if(uMobile>.5) {
      vertical=mix(1.0,.909804,clamp(p.y/.19,0.0,1.0));
      vertical=mix(vertical,.411765,clamp((p.y-.19)/.38,0.0,1.0));
      vertical=mix(vertical,.078431,clamp((p.y-.57)/.31,0.0,1.0));
      horizontal=mix(.219608,0.0,clamp(p.x/.82,0.0,1.0));
    } else {
      vertical=mix(1.0,.909804,clamp(p.y/.12,0.0,1.0));
      vertical=mix(vertical,.501961,clamp((p.y-.12)/.32,0.0,1.0));
      vertical=mix(vertical,.078431,clamp((p.y-.44)/.34,0.0,1.0));
      vertical=mix(vertical,.14902,clamp((p.y-.78)/.22,0.0,1.0));
      horizontal=mix(.666667,.25098,clamp(p.x/.44,0.0,1.0));
      horizontal=mix(horizontal,0.0,clamp((p.x-.44)/.32,0.0,1.0));
    }
    return 1.0-(1.0-vertical)*(1.0-horizontal);
  }
  void main() {
    vec2 pixel=vUv*uViewport;
    float sourceMask=imageMask(pixel,uFromRect,uFromRadius);
    vec4 from=vec4(mix(uCharcoal,texture2D(uFrom,imageUV(pixel,uFromRect,uFromSize,uFromPosition)).rgb,sourceMask),1.0);
    float targetMask=imageMask(pixel,uToRect,uToRadius);
    vec4 to=vec4(texture2D(uTo,imageUV(pixel,uToRect,uToSize,uToPosition)).rgb,targetMask);
    float softness=.17;
    float n=noise(vec2(vUv.x*uViewport.x/max(uViewport.y,1.0),vUv.y)*9.0);
    float p=mix(-softness,1.0+softness,progress);
    float amount=1.0-smoothstep(p-softness,p+softness,n);
    if(progress<=0.0)amount=0.0;
    if(progress>=1.0)amount=1.0;
    gl_FragColor=mix(from,to,amount);
    #include <colorspace_fragment>
    float shade=mix(filmShade(pixel,uFromRect)*uFromShade*sourceMask,filmShade(pixel,uToRect)*uToShade*targetMask,amount);
    gl_FragColor.rgb=mix(gl_FragColor.rgb,vec3(9.0,9.0,11.0)/255.0,shade);
  }
`
const rectData=rect => rect && [rect.left,rect.top,rect.width,rect.height].every(Number.isFinite)
  ? {left:rect.left,top:rect.top,width:Math.max(0,rect.width),height:Math.max(0,rect.height)}
  : {left:0,top:0,width:0,height:0}
function allowedURL(value) {
  if(typeof value!=='string' || !value.trim())return ''
  try { const url=new URL(value,location.href); return url.origin===location.origin || url.protocol==='https:' && url.hostname==='image.tmdb.org' ? url.href : '' } catch { return '' }
}
function textureURL(value,kind='backdrop') {
  const url=new URL(value)
  // A separate, useful resolution avoids reusing a warmed non-CORS DOM cache.
  // No proxy/fetch/blob or CSP change is needed for these real TMDB images.
  if(url.hostname==='image.tmdb.org')url.pathname=url.pathname.replace(/\/t\/p\/(?:original|w\d+)\//,kind==='poster' ? '/t/p/w780/' : '/t/p/w1280/')
  return url.href
}
function loadImage(value,kind) {
  const original=allowedURL(value)
  if(!original)return Promise.resolve(null)
  const url=textureURL(original,kind), cached=imageCache.get(url)
  if(cached){imageCache.delete(url);imageCache.set(url,cached);return cached.promise}
  const entry={pending:true,cancel:null,promise:null}
  entry.promise=new Promise(resolve => {
    const image=new Image()
    let done=false
    const finish=value => {
      if(done)return
      done=true;entry.pending=false;clearTimeout(timer);image.onload=image.onerror=null
      if(!value && imageCache.get(url)===entry)imageCache.delete(url)
      resolve(value)
    }
    const abort=() => { image.removeAttribute('src');finish(null) }
    const timer=setTimeout(abort,5000)
    entry.cancel=abort
    image.crossOrigin='anonymous'
    image.onload=() => { Promise.resolve(image.decode?.()).catch(()=>{}).then(()=>finish(image.naturalWidth ? image : null)) }
    image.onerror=() => finish(null)
    image.src=url
  })
  imageCache.set(url,entry)
  while(imageCache.size>IMAGE_CACHE_LIMIT){const [key,old]=imageCache.entries().next().value;imageCache.delete(key);if(old.pending)old.cancel()}
  return entry.promise
}
/** Decode real images ahead of navigation. Shared requests outlive a cancelled route. */
export function primeTitleImages(urls=[]) {
  // Intent preloads the same shared runtime too; no renderer/context is created.
  void loadVendor().catch(()=>{})
  return Promise.all(urls.map(item=>typeof item==='string' ? loadImage(item,'poster') : loadImage(item?.url,item?.kind || 'poster')))
}
function objectUV(position='50% 50%') {
  const positions=position.split(' ')
  const fraction=(value,axis) => value?.endsWith('%') ? Math.max(0,Math.min(1,parseFloat(value)/100)) : value===['left','top'][axis] ? 0 : value===['right','bottom'][axis] ? 1 : .5
  return [fraction(positions[0],0),1-fraction(positions[1] || positions[0],1)]
}
function targetInfo(image) {
  if(!image?.isConnected)return null
  const rect=rectData(image.getBoundingClientRect()), style=getComputedStyle(image)
  if(!rect.width || !rect.height || rect.left>=innerWidth || rect.top>=innerHeight || rect.left+rect.width<=0 || rect.top+rect.height<=0 || style.visibility==='hidden' || style.display==='none')return null
  const holder=image.closest('.poster-placeholder,.detail-poster')
  const radius=parseFloat(getComputedStyle(holder || image).borderRadius) || 0
  return {rect,radius,position:objectUV(style.objectPosition)}
}

export function beginTitleDissolve({from={},to={},direction='in',releaseGPU,signal}={}) {
  const previous=activeSession, own=new AbortController(), preference=matchMedia('(prefers-reduced-motion: reduce)')
  const layer=document.createElement('div'); layer.className='title-dissolve-layer'
  layer.setAttribute('aria-hidden','true'); layer.inert=true; layer.dataset.direction=direction
  layer.style.opacity='0'; document.body.append(layer)
  let gpu=null, coverTween, revealTween, cancelTween, disposed=false, cancelling=false, mode='pending', phase='preparing', reason='', progress=0
  let fallbackImage=null, destinationImage=null, target=null, presented=false, coveredDone=false, finishedDone=false
  let resolveCovered,resolveFinished,prepareTimer
  const covered=new Promise(resolve=>{resolveCovered=resolve}), finished=new Promise(resolve=>{resolveFinished=resolve})
  const source={url:allowedURL(from.url),rect:rectData(from.rect),radius:Math.max(0,Number(from.radius) || 0)}
  const destinationURL=allowedURL(to.url)
  const session={covered,finished,present,cancel,dispose}
  activeSession=session
  const oldClosed=previous?.cancel() || Promise.resolve()
  function state(next,why=reason) {
    phase=next;reason=why
    layer.dataset.titleDissolve=mode==='dom' && next!=='disposed' ? 'fallback' : next
    layer.dataset.phase=next;layer.dataset.mode=mode;layer.dataset.progress=progress.toFixed(5)
    if(why)layer.dataset.reason=why;else delete layer.dataset.reason
    layer.dispatchEvent(new CustomEvent('grade:title-dissolve-state',{bubbles:true,detail:{phase:next,mode,reason:why,direction}}))
  }
  function completeCovered(value=mode==='gpu' && !disposed && !cancelling) { if(!coveredDone){coveredDone=true;resolveCovered(value)} }
  function completeFinished(value=phase) { if(!finishedDone){finishedDone=true;resolveFinished(value)} }
  function release() {
    if(!gpu)return
    const current=gpu;gpu=null
    current.canvas.removeEventListener('webglcontextlost',contextLost)
    current.textureFrom?.dispose();current.textureTo?.dispose();current.material?.dispose();current.geometry?.dispose()
    current.scene?.clear();current.renderer?.dispose()
    if(!current.gl.isContextLost()){
      if(current.renderer)current.renderer.forceContextLoss()
      else current.gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
    current.canvas.remove()
  }
  function dispose() {
    if(disposed)return finished
    disposed=true;own.abort();clearTimeout(prepareTimer);coverTween?.kill();revealTween?.kill();cancelTween?.kill()
    preference.removeEventListener('change',preferenceChanged);signal?.removeEventListener('abort',abort)
    window.removeEventListener('resize',resize);document.removeEventListener('visibilitychange',visibilityChanged)
    release();state('disposed');layer.remove();completeCovered(false);completeFinished('disposed')
    if(activeSession===session)activeSession=null
    return finished
  }
  function cancel() {
    if(disposed || cancelling)return finished
    cancelling=true;own.abort();clearTimeout(prepareTimer);coverTween?.kill();revealTween?.kill()
    if(!document.hidden && Number(layer.style.opacity)>.001)cancelTween=gsap.to(layer,{opacity:0,duration:.1,ease:'power2.out',onComplete:dispose})
    else dispose()
    return finished
  }
  function abort(){void cancel()}
  function preferenceChanged(){if(preference.matches)void cancel()}
  function visibilityChanged(){if(document.hidden)void cancel()}
  function imageNode(url,rect,radius=0) {
    const image=document.createElement('img');image.className='title-dissolve-image';image.alt='';image.draggable=false
    image.src=url
    Object.assign(image.style,{left:`${rect.left}px`,top:`${rect.top}px`,width:`${rect.width}px`,height:`${rect.height}px`,borderRadius:`${radius}px`})
    return image
  }
  function fallback(why) {
    release();mode='dom';reason=why
    layer.classList.add('is-dom')
    if(!fallbackImage && source.url && source.rect.width){fallbackImage=imageNode(source.url,source.rect,source.radius);layer.append(fallbackImage)}
    state(phase,why)
  }
  function contextLost(){fallback('context-lost')}
  function resize() {
    if(disposed || cancelling || !gpu)return
    const {renderer,uniforms}=gpu
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1,innerWidth<=760 ? 1.25 : 1.5));renderer.setSize(innerWidth,innerHeight,false)
    uniforms.uViewport.value.set(innerWidth,innerHeight)
    uniforms.uMobile.value=innerWidth<=760 ? 1 : 0
    uniforms.uFromRect.value.set(source.rect.left,innerHeight-source.rect.top-source.rect.height,source.rect.width,source.rect.height)
    if(target){const info=targetInfo(target);if(info)applyTarget(info)}
    draw()
  }
  function applyTarget(info) {
    if(!gpu)return
    gpu.uniforms.uToRect.value.set(info.rect.left,innerHeight-info.rect.top-info.rect.height,info.rect.width,info.rect.height)
    gpu.uniforms.uToPosition.value.set(...info.position);gpu.uniforms.uToRadius.value=info.radius
    gpu.uniforms.uToShade.value=target?.matches('[data-title-backdrop]') ? 1 : 0
  }
  function draw() {
    if(!gpu || disposed)return
    const current=gpu
    current.uniforms.progress.value=progress
    try {
      current.renderer.render(current.scene,current.camera)
      if(current.gl.isContextLost()){fallback('context-lost');return}
      layer.dataset.progress=progress.toFixed(5)
      layer.dispatchEvent(new CustomEvent('grade:title-dissolve-frame',{bubbles:true,detail:{gl:current.gl,canvas:current.canvas,progress,direction,phase}}))
    } catch { fallback('render') }
  }
  function build(T,sourceImage,targetImage) {
    releaseGPU?.()
    if(disposed || cancelling)return
    const canvas=document.createElement('canvas');canvas.className='title-dissolve-canvas';canvas.setAttribute('aria-hidden','true')
    const attributes={alpha:true,antialias:false,depth:false,stencil:false,premultipliedAlpha:false,preserveDrawingBuffer:false,powerPreference:'high-performance'}
    const gl=canvas.getContext('webgl2',attributes)
    if(!gl)throw new Error('webgl')
    gpu={canvas,gl}
    const renderer=new T.WebGLRenderer({canvas,context:gl,...attributes})
    gpu.renderer=renderer
    const textureFrom=new T.Texture(sourceImage),textureTo=new T.Texture(targetImage)
    for(const texture of [textureFrom,textureTo]){texture.colorSpace=T.SRGBColorSpace;texture.minFilter=texture.magFilter=T.LinearFilter;texture.generateMipmaps=false;texture.needsUpdate=true}
    const uniforms={uFrom:{value:textureFrom},uTo:{value:textureTo},uViewport:{value:new T.Vector2()},
      uFromSize:{value:new T.Vector2(sourceImage.naturalWidth,sourceImage.naturalHeight)},uToSize:{value:new T.Vector2(targetImage.naturalWidth,targetImage.naturalHeight)},
      uFromRect:{value:new T.Vector4()},uToRect:{value:new T.Vector4(0,0,0,0)},
      uFromPosition:{value:new T.Vector2(...objectUV(from.objectPosition))},uToPosition:{value:new T.Vector2(.5,.5)},
      uFromShade:{value:from.cinema ? 1 : 0},uToShade:{value:0},uMobile:{value:innerWidth<=760 ? 1 : 0},
      uFromRadius:{value:source.radius},uToRadius:{value:0},progress:{value:0},uCharcoal:{value:new T.Color(0x09090b)}}
    const material=new T.ShaderMaterial({uniforms,vertexShader,fragmentShader,transparent:true,depthWrite:false,depthTest:false})
    const geometry=new T.PlaneGeometry(2,2),scene=new T.Scene(),camera=new T.PerspectiveCamera()
    const quad=new T.Mesh(geometry,material);quad.frustumCulled=false;scene.add(quad)
    renderer.setClearColor(0x09090b,0);renderer.outputColorSpace=T.SRGBColorSpace
    renderer.debug.onShaderError=()=>{throw new Error('shader')}
    gpu={canvas,gl,renderer,textureFrom,textureTo,uniforms,material,geometry,scene,camera};mode='gpu'
    canvas.addEventListener('webglcontextlost',contextLost);layer.prepend(canvas);resize()
  }
  function cover() {
    if(disposed || cancelling)return
    if(mode!=='gpu'){completeCovered(false);return}
    state('covering')
    coverTween=gsap.to(layer,{opacity:1,duration:preference.matches ? 0 : COVER_SECONDS,ease:'power2.out',onComplete:()=>{coverTween=null;state('covered');completeCovered()}})
  }
  async function prepare() {
    if(preference.matches || !source.url || !destinationURL){fallback(preference.matches ? 'reduced' : 'image');cover();return}
    const timeout=new Promise(resolve=>{prepareTimer=setTimeout(()=>resolve(null),PREPARE_MS)})
    const assets=Promise.all([oldClosed,loadVendor().catch(()=>null),loadImage(source.url,from.kind || (from.cinema ? 'backdrop' : 'poster')),loadImage(destinationURL,to.kind || (direction==='in' ? 'backdrop' : 'poster'))])
    const prepared=await Promise.race([assets.catch(()=>null),timeout])
    clearTimeout(prepareTimer)
    if(disposed || cancelling)return
    if(prepared && prepared[1] && prepared[2] && prepared[3]){
      try {build(prepared[1],prepared[2],prepared[3])}catch(error){fallback(error.message==='webgl' ? 'webgl' : 'upload')}
    }else fallback(prepared ? prepared[1] ? 'cors' : 'module' : 'timeout')
    cover()
  }
  async function present({main,target:image}={}) {
    if(presented || disposed)return finished
    presented=true
    await covered
    if(disposed || cancelling)return finished
    // Match the DOM handoff to the exact, already decoded CORS image rather
    // than waiting for a separate original-resolution request behind the field.
    if(gpu && direction==='in' && image?.hasAttribute('data-title-backdrop')){
      const decoded=gpu.textureTo.image
      image.crossOrigin='anonymous';image.src=decoded.currentSrc || decoded.src
    }
    target=image
    const info=targetInfo(image)
    if(!info)fallback('target')
    if(main?.isConnected){main.append(layer);layer.classList.add('is-presented')}
    if(gpu && info){applyTarget(info);draw()}
    if(!gpu){
      if(info && destinationURL){destinationImage=imageNode(destinationURL,info.rect,info.radius);destinationImage.style.objectPosition=getComputedStyle(image).objectPosition;destinationImage.style.opacity='0';layer.append(destinationImage)}
      layer.classList.add('is-revealing')
    }
    state('revealing')
    const clock={value:progress}
    revealTween=gsap.timeline({onComplete:()=>{progress=1;draw();dispose()}})
      // Perlin's threshold distribution and smoothstep already ease the visible
      // dissolve. Easing this clock again rushes its useful middle into a flash.
      .to(clock,{value:1,duration:preference.matches ? 0 : REVEAL_SECONDS,ease:'none',onUpdate:()=>{progress=clock.value;draw();layer.dataset.progress=progress.toFixed(5)}},0)
      .to(layer,{opacity:0,duration:.16,ease:'power2.out'},.56)
    if(!gpu){
      if(fallbackImage)revealTween.to(fallbackImage,{opacity:0,duration:.4,ease:'power2.inOut'},0)
      if(destinationImage)revealTween.to(destinationImage,{opacity:1,duration:.42,ease:'power2.inOut'},.04)
    }
    return finished
  }
  state('preparing')
  signal?.addEventListener('abort',abort,{once:true});preference.addEventListener('change',preferenceChanged)
  window.addEventListener('resize',resize,{passive:true})
  document.addEventListener('visibilitychange',visibilityChanged)
  if(signal?.aborted)dispose();else void prepare()
  return session
}
