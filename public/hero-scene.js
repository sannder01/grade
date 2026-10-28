/*
 * Grade's living silver mark. ShaderMaterial point size / view-space depth are
 * adapted from Three.js webgl_custom_attributes_points.html; SVGLoader,
 * ExtrudeGeometry and MeshSurfaceSampler are official, same-version addons.
 * Copyright 2010-2026 three.js authors; MIT: /assets/three.LICENSE.txt.
 * Reference copies: docs/design/references/emotion-v2/three/.
 */
import { createParticleSimulation } from './particle-simulation.js'
import { getParticleInput } from './particle-input.js'

const ASSEMBLY_MS = 2600
let activeCleanup = null
const clamp = value => Math.max(0,Math.min(1,value))
const smooth = value => { const t = clamp(value); return t*t*(3-2*t) }

const vertexShader = /* glsl */ `
  attribute float size;
  attribute vec3 customColor;
  attribute vec2 aSimulationUV;
  attribute vec3 aNormal;
  attribute float aSeed;
  uniform float uAssembly;
  uniform float uDispersion;
  uniform float uTime;
  uniform float uPointScale;
  uniform float uPixelRatio;
  uniform sampler2D uPositions;
  uniform float uReflection;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vDepth;
  void main() {
    float phase = clamp((uAssembly-aSeed*.14)/.86,0.0,1.0);
    float gather = phase*phase*(3.0-2.0*phase);
    vec3 p = texture2D(uPositions,aSimulationUV).xyz;
    vec3 n = normalize(normalMatrix*aNormal);
    float key = pow(max(0.0,dot(n,normalize(vec3(-.55,.8,.75)))),1.4);
    float rim = pow(1.0-abs(n.z),2.0);
    float glint = .94+.06*sin(aSeed*93.0+uTime*.6);
    vColor = customColor*(.4+key*1.22+rim*.78)*glint;
    vAlpha = mix(.2,.86,gather)*(1.0-uDispersion*.28);
    if (uReflection>.5) { vColor *= .6; vAlpha *= .3; }
    vec4 mvPosition = modelViewMatrix*vec4(p,1.0);
    vDepth = -mvPosition.z;
    // The official point example's perspective attenuation, bounded for fill rate.
    gl_PointSize = clamp(size*(uPointScale/-mvPosition.z)*uPixelRatio,1.0,5.0);
    gl_Position = projectionMatrix*mvPosition;
  }
`
const dustVertexShader = /* glsl */ `
  attribute vec2 aSimulationUV;
  uniform sampler2D uPositions;
  uniform float uPixelRatio;
  uniform float uPointScale;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vDepth;
  void main() {
    vec3 p=texture2D(uPositions,aSimulationUV).xyz;
    vec4 mvPosition=modelViewMatrix*vec4(p,1.0);
    vColor=vec3(.56,.58,.62); vAlpha=.42; vDepth=-mvPosition.z;
    gl_PointSize=clamp(.72*uPointScale/max(-mvPosition.z,.1)*uPixelRatio,1.0,2.8);
    gl_Position=projectionMatrix*mvPosition;
  }
`
const fragmentShader = /* glsl */ `
  uniform sampler2D pointTexture;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vDepth;
  void main() {
    float sprite = texture2D(pointTexture,gl_PointCoord).a;
    if (sprite<.025) discard;
    float fog = exp(-.0018*vDepth*vDepth);
    gl_FragColor = vec4(vColor,sprite*vAlpha*fog);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

function randomGenerator(seed = 4103) {
  return () => { seed ^= seed<<13; seed ^= seed>>>17; seed ^= seed<<5; return (seed>>>0)/4294967296 }
}
function spriteTexture(T,raking = false) {
  const size = raking ? 128 : 48, pixels = new Uint8Array(size*size*4)
  for (let y=0;y<size;y++) for (let x=0;x<size;x++) {
    const dx = (x/(size-1)-.5)*2, dy = (y/(size-1)-.5)*2
    const r = Math.sqrt(dx*dx+dy*dy)
    const alpha = raking ? Math.exp(-(dx*dx*.7+dy*dy*7))*Math.max(0,1-r*.55)
      : r<.38 ? 1 : Math.pow(Math.max(0,(1-r)/.62),2)
    const i=(y*size+x)*4
    pixels[i]=pixels[i+1]=pixels[i+2]=255; pixels[i+3]=Math.round(alpha*255)
  }
  const texture = new T.DataTexture(pixels,size,size,T.RGBAFormat,T.UnsignedByteType)
  texture.magFilter=texture.minFilter=T.LinearFilter; texture.needsUpdate=true
  return texture
}

export function mountHeroScene(root,{animate = true} = {}) {
  if (!root) return () => {}
  activeCleanup?.()
  const host = root.querySelector('[data-hero-canvas]')
  const stage = root.querySelector('[data-hero-stage]') || host || root
  const reduced = matchMedia('(prefers-reduced-motion: reduce)')
  const mobile = matchMedia('(max-width: 760px)')
  const life = new AbortController()
  let initAbort, gpu = null, prepared = null, disposed = false, failed = false, loading = false
  let observer, resizeObserver, sceneObserver, raf = 0, epoch = 0
  let visible = true, lastTime = 0, frames = 0, elapsed = animate ? 0 : ASSEMBLY_MS
  let progress = 0, displayedProgress = 0

  function state(value,reason = '') {
    if (disposed && value!=='disposed') return
    root.dataset.heroScene=root.dataset.heroSceneState=value
    if (reason) root.dataset.heroSceneReason=reason; else delete root.dataset.heroSceneReason
  }
  function setProgress() {
    const height=stage.getBoundingClientRect().height || innerHeight
    progress=clamp(-root.getBoundingClientRect().top/Math.max(1,root.offsetHeight-height))
    root.dataset.heroSceneProgress=progress.toFixed(5)
    root.style.setProperty('--hero-scene-progress',String(progress))
  }
  function gate() {
    if (document.hidden) return 'hidden'
    if (!visible) return 'offscreen'
    if (document.querySelector('.scene-panel:not([hidden])')) return 'scene'
    const dialogs=[...document.querySelectorAll('dialog[open]')]
    const partial=dialogs.length && dialogs.every(dialog => dialog.classList.contains('track-auth') && dialog.getBoundingClientRect().width<innerWidth*.95)
    if (dialogs.length && !partial || root.closest('[inert]') && !partial) return 'scene'
    return ''
  }
  function stop() { cancelAnimationFrame(raf); raf=0; lastTime=0 }
  function release() {
    stop()
    if (!gpu) return
    const current=gpu; gpu=null
    current.canvas.removeEventListener('webglcontextlost',contextLost)
    current.simulation?.dispose()
    for (const item of current.resources) item.dispose?.()
    current.scene?.clear()
    current.renderer?.dispose()
    if (!current.gl?.isContextLost()) current.renderer?.forceContextLoss()
    current.canvas.remove()
    delete root.dataset.heroSceneReady
  }
  function fallback(reason) {
    if (disposed) return
    failed=true; loading=false; epoch++; initAbort?.abort(); release()
    life.abort(); observer?.disconnect(); resizeObserver?.disconnect(); sceneObserver?.disconnect()
    root.dataset.heroSceneMode='static'; state('fallback',reason)
  }
  function contextLost() { fallback('context-lost') }
  function cleanup() {
    if (disposed) return
    disposed=true; epoch++; life.abort(); initAbort?.abort()
    observer?.disconnect(); resizeObserver?.disconnect(); sceneObserver?.disconnect()
    release(); prepared=null; state('disposed')
    if (activeCleanup===cleanup) activeCleanup=null
  }
  activeCleanup=cleanup
  root.dataset.heroSceneFrames='0'
  root.dataset.heroSceneAssembly=(elapsed/ASSEMBLY_MS).toFixed(4)
  root.dataset.heroSceneMode=reduced.matches ? 'static' : mobile.matches ? 'mobile' : 'desktop'
  state(reduced.matches ? 'reduced' : 'loading')
  if (!host) { fallback('host'); return cleanup }
  setProgress(); displayedProgress=progress

  function resize() {
    if (!gpu) return
    const bounds=host.getBoundingClientRect()
    if (!bounds.width || !bounds.height) return
    const frame=stage.getBoundingClientRect()
    const frameHeight=frame.height || bounds.height
    const headerInset=Math.max(0,frame.top-bounds.top)
    const {renderer,camera,uniforms}=gpu
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1,mobile.matches ? 1.25 : 1.5))
    renderer.setSize(bounds.width,bounds.height,false)
    // Expose the existing scene above its old frame, beneath the header. An
    // off-axis view preserves the original body pixels instead of zooming or
    // moving the sculpture when the canvas gains those extra rows.
    camera.aspect=bounds.width/frameHeight
    if (headerInset>.5) camera.setViewOffset(bounds.width,frameHeight,0,-headerInset,bounds.width,bounds.height)
    else camera.clearViewOffset()
    uniforms.uPointScale.value=frameHeight*.034
    uniforms.uPixelRatio.value=renderer.getPixelRatio()
    setProgress()
    wake()
  }
  function build(T,svgText) {
    const canvas=document.createElement('canvas')
    canvas.className='hero-scene-canvas'; canvas.setAttribute('aria-hidden','true')
    canvas.style.cssText='display:block;width:100%;height:100%;pointer-events:none'
    canvas.addEventListener('webglcontextlost',contextLost)
    const attributes={alpha:true,antialias:false,depth:true,stencil:false,premultipliedAlpha:false,preserveDrawingBuffer:false,powerPreference:'high-performance'}
    const gl=canvas.getContext('webgl2',attributes)
    if (!gl) { canvas.removeEventListener('webglcontextlost',contextLost); throw new Error('webgl') }
    gpu={T,canvas,gl,resources:new Set()}
    const renderer=new T.WebGLRenderer({canvas,context:gl,...attributes})
    gpu.renderer=renderer
    renderer.setClearColor(0x09090b,1); renderer.outputColorSpace=T.SRGBColorSpace
    renderer.toneMapping=T.ACESFilmicToneMapping; renderer.toneMappingExposure=1.12
    renderer.debug.onShaderError=() => { throw new Error('shader') }
    const scene=new T.Scene(); scene.fog=new T.FogExp2(0x09090b,.04); gpu.scene=scene
    const camera=new T.PerspectiveCamera(40,1,.1,80); camera.position.set(0,0,12); gpu.camera=camera
    const sculpture=new T.Group(), reflection=new T.Group(); scene.add(sculpture,reflection)
    gpu.sculpture=sculpture; gpu.reflection=reflection
    const brand=new DOMParser().parseFromString(svgText,'image/svg+xml').querySelector('symbol#brand path')
    if (!brand) throw new Error('brand')
    const parsed=new T.SVGLoader().parse(`<svg xmlns="http://www.w3.org/2000/svg"><path fill="#ffffff" d="${brand.getAttribute('d')}"/></svg>`)
    const shape=parsed.paths.flatMap(path => path.toShapes())
    const surface=new T.ExtrudeGeometry(shape,{depth:8,steps:1,bevelEnabled:true,bevelThickness:.8,bevelSize:.9,bevelSegments:3,curveSegments:4})
    surface.computeBoundingBox()
    const originalSize=new T.Vector3(); surface.boundingBox.getSize(originalSize)
    const scale=5.8/originalSize.y
    surface.center(); surface.scale(scale,-scale,scale); surface.computeBoundingBox()
    gpu.resources.add(surface)
    const sampleMaterial=new T.MeshBasicMaterial(), sampleMesh=new T.Mesh(surface,sampleMaterial)
    // The official sampler's weight attribute gives broad silver faces enough
    // grain without increasing particle count or making the bevels a wireframe.
    const surfaceNormals=surface.getAttribute('normal'), weights=new Float32Array(surfaceNormals.count)
    for (let i=0;i<weights.length;i++) weights[i]=.65+Math.abs(surfaceNormals.getZ(i))*.9
    surface.setAttribute('sampleWeight',new T.BufferAttribute(weights,1))
    const rand=randomGenerator(), sampler=new T.MeshSurfaceSampler(sampleMesh).setWeightAttribute('sampleWeight').setRandomGenerator(rand).build()
    const count=mobile.matches ? 11000 : navigator.connection?.saveData ? 22000 : 28000
    const positions=new Float32Array(count*3), normals=new Float32Array(count*3), scatter=new Float32Array(count*3)
    const colors=new Float32Array(count*3), sizes=new Float32Array(count), seeds=new Float32Array(count)
    const point=new T.Vector3(), normal=new T.Vector3()
    for (let i=0;i<count;i++) {
      sampler.sample(point,normal); point.toArray(positions,i*3); normal.toArray(normals,i*3)
      scatter[i*3]=(rand()-.5)*23; scatter[i*3+1]=(rand()-.5)*13; scatter[i*3+2]=(rand()-.5)*17
      const silver=.64+rand()*.36
      colors[i*3]=colors[i*3+1]=colors[i*3+2]=silver
      sizes[i]=.62+rand()*.55; seeds[i]=rand()
    }
    sampleMaterial.dispose()
    const dustCount=mobile.matches ? 450 : 1500, dustPositions=new Float32Array(dustCount*3)
    for (let i=0;i<dustCount;i++) { dustPositions[i*3]=(rand()-.5)*30; dustPositions[i*3+1]=(rand()-.5)*17; dustPositions[i*3+2]=-2-rand()*21 }
    gpu.simulation=createParticleSimulation(T,renderer,{positions,scatter,seeds,dustPositions,assembly:elapsed/ASSEMBLY_MS,input:getParticleInput()})
    const geometry=new T.BufferGeometry()
    for (const [name,array,size] of [['position',positions,3],['aNormal',normals,3],['aSimulationUV',gpu.simulation.coreUV,2],['customColor',colors,3],['size',sizes,1],['aSeed',seeds,1]]) geometry.setAttribute(name,new T.BufferAttribute(array,size))
    geometry.boundingSphere=null; gpu.resources.add(geometry)
    const sprite=spriteTexture(T); gpu.resources.add(sprite)
    const uniforms={
      uAssembly:{value:elapsed/ASSEMBLY_MS},uDispersion:{value:0},uTime:{value:0},
      uPointScale:{value:25},uPixelRatio:{value:1},uPositions:gpu.simulation.texture,
      pointTexture:{value:sprite},uReflection:{value:0},
    }
    gpu.uniforms=uniforms
    const material=new T.ShaderMaterial({uniforms,vertexShader,fragmentShader,transparent:true,depthWrite:false,depthTest:true,blending:T.AdditiveBlending})
    gpu.resources.add(material)
    const particles=new T.Points(geometry,material); particles.frustumCulled=false; sculpture.add(particles)
    const mirrorMaterial=new T.ShaderMaterial({uniforms:{...uniforms,uReflection:{value:1}},vertexShader,fragmentShader,transparent:true,depthWrite:false,depthTest:true,blending:T.AdditiveBlending})
    gpu.resources.add(mirrorMaterial)
    const mirrorParticles=new T.Points(geometry,mirrorMaterial); mirrorParticles.frustumCulled=false; reflection.add(mirrorParticles)
    const dustGeometry=new T.BufferGeometry(); dustGeometry.setAttribute('position',new T.BufferAttribute(dustPositions,3))
    dustGeometry.setAttribute('aSimulationUV',new T.BufferAttribute(gpu.simulation.dustUV,2))
    const dustMaterial=new T.ShaderMaterial({uniforms,vertexShader:dustVertexShader,fragmentShader,transparent:true,depthWrite:false,depthTest:true,blending:T.AdditiveBlending})
    const dust=new T.Points(dustGeometry,dustMaterial); dust.frustumCulled=false
    gpu.resources.add(dustGeometry); gpu.resources.add(dustMaterial); scene.add(dust)
    const groundGeometry=new T.PlaneGeometry(45,40), groundMaterial=new T.MeshBasicMaterial({color:0x101114,transparent:true,opacity:.45,depthWrite:false})
    const ground=new T.Mesh(groundGeometry,groundMaterial); ground.rotation.x=-Math.PI/2; ground.position.y=-2.45; scene.add(ground)
    gpu.resources.add(groundGeometry); gpu.resources.add(groundMaterial)
    const lightTexture=spriteTexture(T,true), lightGeometry=new T.PlaneGeometry(17,8)
    const lightMaterial=new T.MeshBasicMaterial({color:0xb7bbc4,map:lightTexture,transparent:true,opacity:.17,depthWrite:false,blending:T.AdditiveBlending})
    const light=new T.Mesh(lightGeometry,lightMaterial); light.rotation.x=-Math.PI/2; light.position.set(2,-2.4,0); scene.add(light)
    gpu.resources.add(lightTexture); gpu.resources.add(lightGeometry); gpu.resources.add(lightMaterial)
    gpu.light=light; gpu.count=count
    root.dataset.heroSceneParticles=String(count)
    root.dataset.heroSceneDepth=(surface.boundingBox.max.z-surface.boundingBox.min.z).toFixed(3)
    root.dataset.heroSceneMode=mobile.matches ? 'mobile' : 'desktop'
    host.append(canvas); resize()
    wake()
  }
  async function ensureReady() {
    if (disposed || failed || loading || gpu || reduced.matches || gate()) return
    const current=++epoch; loading=true; state('loading')
    initAbort=new AbortController()
    try {
      if (!prepared) {
        const [T,response]=await Promise.all([import('./assets/hero-scene-vendor.js'),fetch('/icons.svg',{signal:initAbort.signal})])
        if (!response.ok) throw new Error('brand')
        const svg=await response.text()
        if (disposed || current!==epoch) return
        prepared={T,svg}
      }
      loading=false
      if (reduced.matches || gate()) { reconcile(); return }
      build(prepared.T,prepared.svg)
    } catch (error) { if (!disposed && current===epoch) fallback(['webgl','simulation-fbo'].includes(error.message) ? error.message : 'load') }
  }
  function reconcile() {
    if (disposed || failed) return
    if (!root.isConnected) { cleanup(); return }
    if (reduced.matches) {
      epoch++; loading=false; initAbort?.abort(); elapsed=ASSEMBLY_MS; release()
      root.dataset.heroSceneMode='static'; root.dataset.heroSceneAssembly='1'; state('reduced'); return
    }
    const reason=gate()
    if (reason) { stop(); state('paused',reason); return }
    if (!gpu) void ensureReady(); else wake()
  }
  function draw(now,delta) {
    const {camera,renderer,scene,sculpture,reflection,uniforms,canvas,gl,simulation}=gpu
    const cameraFrozen=!!document.querySelector('dialog.track-auth[open]')
    const damp=1-Math.exp(-delta/130)
    if (!cameraFrozen) {
      displayedProgress+=(progress-displayedProgress)*damp
      if (Math.abs(progress-displayedProgress)<.0001) displayedProgress=progress
    }
    const dispersion=smooth((displayedProgress-.18)/.82)
    if (!cameraFrozen || !gpu.poseInitialized) {
      camera.position.set(displayedProgress*1.4,displayedProgress*.8,12-displayedProgress*2.4)
      camera.lookAt(displayedProgress*.45,-displayedProgress*.25,0)
      const viewHeight=2*Math.tan(camera.fov*Math.PI/360)*12
      const scale=mobile.matches ? .66 : 1
      sculpture.scale.setScalar(scale)
      sculpture.position.set(viewHeight*camera.aspect*(mobile.matches ? .03 : .22),viewHeight*(mobile.matches ? .21 : .11),0)
      sculpture.rotation.set(.2+displayedProgress*.22,-.42+displayedProgress*.72,-.1+displayedProgress*.1)
      reflection.position.set(sculpture.position.x,-3.15,-.5)
      reflection.scale.set(scale,-scale*.27,scale)
      reflection.rotation.set(-sculpture.rotation.x,sculpture.rotation.y,-sculpture.rotation.z)
      gpu.light.position.x=sculpture.position.x; gpu.poseInitialized=true
    }
    uniforms.uAssembly.value=clamp(elapsed/ASSEMBLY_MS); uniforms.uDispersion.value=dispersion
    simulation.update(now,delta,{camera,sculpture,bounds:host.getBoundingClientRect(),assembly:uniforms.uAssembly.value,dispersion})
    const physical=simulation.snapshot()
    uniforms.uTime.value=physical.time
    renderer.render(scene,camera)
    if (gl.isContextLost()) { fallback('context-lost'); return }
    frames++; root.dataset.heroSceneFrames=String(frames)
    root.dataset.heroSceneAssembly=uniforms.uAssembly.value.toFixed(4)
    root.dataset.heroSceneReady='true'
    root.dataset.heroSceneSimulation=String(physical.step); root.dataset.heroSceneCamera=cameraFrozen ? 'locked' : 'free'
    root.dispatchEvent(new CustomEvent('grade:hero-scene-frame',{bubbles:true,detail:{gl,canvas,frame:frames,assembly:uniforms.uAssembly.value,progress:displayedProgress,dispersion,pointerStrength:physical.pointerActive,camera:{x:camera.position.x,y:camera.position.y,z:camera.position.z},cameraFrozen,particleCount:gpu.count,simulation:physical,positionTexture:uniforms.uPositions.value,reflectionTexture:gpu.reflection.children[0].material.uniforms.uPositions.value}}))
  }
  function tick(now) {
    raf=0
    if (disposed || !gpu) return
    if (reduced.matches || gate()) { reconcile(); return }
    const elapsedFrame=lastTime ? Math.max(0,now-lastTime) : 16.67; lastTime=now
    elapsed=Math.min(ASSEMBLY_MS,elapsed+elapsedFrame)
    try { draw(now,Math.min(80,elapsedFrame)) } catch { fallback('render'); return }
    if (!gpu || disposed) return
    // Shader compilation belongs to loading, not to the visible assembly.
    // Start its active clock at the first presented frame on slower devices.
    if (frames===1) lastTime=performance.now()
    state('running'); raf=requestAnimationFrame(tick)
  }
  function wake() {
    if (disposed || !gpu || raf || reduced.matches || gate()) return
    raf=requestAnimationFrame(tick)
  }
  const signal=life.signal, passive={passive:true,signal}
  window.addEventListener('scroll',() => { setProgress(); wake() },passive)
  window.addEventListener('resize',resize,passive)
  reduced.addEventListener('change',reconcile,{signal})
  mobile.addEventListener('change',() => { resize(); reconcile() },{signal})
  document.addEventListener('visibilitychange',reconcile,{signal})
  for (const event of ['grade:scene-closed','grade:dialog-open','grade:dialog-close']) document.addEventListener(event,reconcile,{signal})
  sceneObserver=new MutationObserver(reconcile)
  for (const node of [root.closest('main'),document.querySelector('.track-header'),...document.querySelectorAll('dialog')].filter(Boolean)) sceneObserver.observe(node,{attributes:true,attributeFilter:['class','inert','open']})
  if (typeof IntersectionObserver!=='undefined') {
    observer=new IntersectionObserver(entries => { visible=entries.some(entry => entry.isIntersecting); reconcile() },{threshold:.01})
    observer.observe(stage)
  }
  if (typeof ResizeObserver!=='undefined') { resizeObserver=new ResizeObserver(resize); resizeObserver.observe(host) }
  const bounds=stage.getBoundingClientRect(); visible=bounds.bottom>0 && bounds.top<innerHeight && bounds.width>0
  reconcile()
  return cleanup
}
