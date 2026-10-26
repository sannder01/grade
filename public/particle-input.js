/*
 * Grade shared pointer field and silver input trail.
 * Canvas trail-texture approach adapted from kinmary's Displacement.js:
 * https://github.com/kinmary/cursor-particle-displacement
 * Upstream readme declares MIT; no glow image, debug canvas or controls copied.
 *
 * MIT License — Copyright (c) kinmary
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */
const FIELD_EDGE=256, FIELD_TAU=350, TRAIL_TAU=360, TRAIL_LIFE=1150
const clamp=(value,min=0,max=1)=>Math.max(min,Math.min(max,value))
let singleton=null

function createInput() {
  const canvas=document.createElement('canvas'), context=canvas.getContext('2d',{alpha:false})
  const pointer={x:-1,y:-1,active:false,speed:0,dx:0,dy:0}
  const preference=matchMedia('(prefers-reduced-motion: reduce)')
  const shared={canvas,width:1,height:1,pointer,revision:0,update}
  let viewportWidth=1,viewportHeight=1,overlay=null,trail=null,trailScale=1
  let mounted=false,disposed=false,abort=null,dialogObserver=null,raf=0
  let previous=null,lastMove=0,lastTrail=0,lastUpdate=-1,lastDraw=-1,fieldUntil=0
  let speed=0,directionX=0,directionY=0,seed=73019,queue=[]
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296}
  const now=()=>performance.now()
  const trailAllowed=()=>!preference.matches && !document.hidden && !document.querySelector('dialog[open]')

  function neutral() {
    if(context){context.globalCompositeOperation='source-over';context.globalAlpha=1;context.fillStyle='rgb(0,128,128)';context.fillRect(0,0,canvas.width,canvas.height)}
    shared.revision++
  }
  function clearTrail() {
    if(trail){trail.setTransform(1,0,0,1,0,0);trail.clearRect(0,0,overlay.width,overlay.height);trail.setTransform(trailScale,0,0,trailScale,0,0)}
    lastTrail=0;lastDraw=-1
    if(overlay)overlay.dataset.particleTrail='idle'
  }
  function stop() { if(raf)cancelAnimationFrame(raf);raf=0 }
  function release(hard=false) {
    pointer.active=false;pointer.speed=0;pointer.dx=0;pointer.dy=0
    previous=null;speed=0;directionX=0;directionY=0
    if(hard){queue=[];fieldUntil=0;neutral();clearTrail();stop();lastUpdate=-1}
    else {
      // A stationary field is still live even after the visible trail slept.
      // Give that residual the same decay window when the pointer leaves.
      if(fieldUntil)fieldUntil=Math.max(fieldUntil,now()+1600)
      if(lastTrail)wake()
    }
  }
  function resize() {
    const old=document.createElement('canvas')
    if(context && fieldUntil>now()){old.width=canvas.width;old.height=canvas.height;old.getContext('2d')?.drawImage(canvas,0,0)}
    viewportWidth=Math.max(1,innerWidth);viewportHeight=Math.max(1,innerHeight)
    const ratio=FIELD_EDGE/Math.max(viewportWidth,viewportHeight)
    canvas.width=Math.max(1,Math.round(viewportWidth*ratio));canvas.height=Math.max(1,Math.round(viewportHeight*ratio))
    shared.width=canvas.width;shared.height=canvas.height;neutral()
    if(context && old.width && old.height){context.drawImage(old,0,0,canvas.width,canvas.height);shared.revision++}
    old.width=old.height=0
    if(overlay){
      trailScale=Math.min(devicePixelRatio || 1,1.25,1600/Math.max(viewportWidth,viewportHeight))
      overlay.width=Math.max(1,Math.round(viewportWidth*trailScale));overlay.height=Math.max(1,Math.round(viewportHeight*trailScale))
      trail?.setTransform(trailScale,0,0,trailScale,0,0);clearTrail()
    }
    if(pointer.x<0 || pointer.y<0 || pointer.x>viewportWidth || pointer.y>viewportHeight)release()
    previous=pointer.active?{x:pointer.x,y:pointer.y,time:now()}:null
    lastUpdate=-1
  }
  function stampField(x,y,dx,dy,strength,radius,alpha=0.7) {
    if(!context)return
    const sx=canvas.width/viewportWidth,sy=canvas.height/viewportHeight
    const cx=x*sx,cy=y*sy,r=radius*Math.min(sx,sy)
    const red=Math.round(clamp(strength)*255),green=Math.round(128+clamp(dx,-1,1)*127),blue=Math.round(128+clamp(dy,-1,1)*127)
    const brush=context.createRadialGradient(cx,cy,0,cx,cy,Math.max(1,r))
    brush.addColorStop(0,`rgba(${red},${green},${blue},${alpha})`)
    brush.addColorStop(.28,`rgba(${red},${green},${blue},${alpha*.7})`)
    brush.addColorStop(1,`rgba(${red},${green},${blue},0)`)
    context.fillStyle=brush;context.fillRect(cx-r,cy-r,r*2,r*2)
  }
  function grain(x,y,dx,dy,velocity) {
    const spread=1.1+velocity*1.8,side=(random()-.5)*spread
    const px=x-dy*side,py=y+dx*side,size=Math.max(.55/trailScale,.45+random()*.5)
    trail.fillStyle=`rgba(220,223,231,${.42+random()*.38})`
    trail.beginPath();trail.arc(px,py,size,0,Math.PI*2);trail.fill()
    if(random()>.8){trail.fillStyle='rgba(191,195,207,.2)';trail.fillRect(px+(random()-.5)*5,py+(random()-.5)*5,.65,.65)}
  }
  function fadeTrail(time) {
    if(!trail || lastDraw===time)return
    const dt=lastDraw<0?16:Math.max(0,time-lastDraw);lastDraw=time
    trail.globalCompositeOperation='destination-out';trail.globalAlpha=1-Math.exp(-dt/TRAIL_TAU)
    trail.fillStyle='#000';trail.fillRect(0,0,viewportWidth,viewportHeight)
    trail.globalCompositeOperation='source-over';trail.globalAlpha=1
  }
  function update(time=now()) {
    if(disposed || !Number.isFinite(time) || time<=lastUpdate+.25)return shared
    const dt=lastUpdate<0?16:Math.max(0,time-lastUpdate);lastUpdate=time
    if(preference.matches || document.hidden){if(pointer.active || queue.length || fieldUntil){release(true)}return shared}
    const age=Math.max(0,time-lastMove)
    pointer.speed=pointer.active?speed*Math.exp(-age/130):0
    pointer.dx=pointer.speed>.002?directionX:0;pointer.dy=pointer.speed>.002?directionY:0
    const visible=trailAllowed()
    if(visible && lastTrail)fadeTrail(time)
    if(context && (pointer.active || queue.length || time<fieldUntil)){
      context.globalCompositeOperation='source-over';context.globalAlpha=1-Math.exp(-dt/FIELD_TAU)
      context.fillStyle='rgb(0,128,128)';context.fillRect(0,0,canvas.width,canvas.height);context.globalAlpha=1
      for(const segment of queue){
        const distance=Math.hypot(segment.x1-segment.x0,segment.y1-segment.y0)
        const steps=Math.max(1,Math.min(640,Math.ceil(distance/2.5)))
        for(let i=0;i<=steps;i++){
          const t=i/steps,x=segment.x0+(segment.x1-segment.x0)*t,y=segment.y0+(segment.y1-segment.y0)*t
          if(i%2===0 || i===steps)stampField(x,y,segment.dx,segment.dy,.32+segment.speed*.68,44+segment.speed*24)
          if(visible && trail)grain(x,y,segment.dx,segment.dy,segment.speed)
        }
      }
      if(pointer.active)stampField(pointer.x,pointer.y,0,0,.18,42,1-Math.exp(-dt/90))
      shared.revision++
    }else if(fieldUntil){fieldUntil=0;neutral()}
    queue=[]
    if(!visible){clearTrail();if(overlay)overlay.hidden=true}
    else if(overlay)overlay.hidden=false
    return shared
  }
  function tick(time) {
    raf=0
    if(!mounted || disposed)return
    update(time)
    if(lastTrail && time-lastTrail<TRAIL_LIFE && trailAllowed()){
      if(overlay)overlay.dataset.particleTrail='active'
      raf=requestAnimationFrame(tick)
    }else clearTrail()
  }
  function wake(){if(mounted && !raf && !disposed && trailAllowed())raf=requestAnimationFrame(tick)}
  function sample(event,time) {
    const x=event.clientX,y=event.clientY
    if(!Number.isFinite(x) || !Number.isFinite(y) || x<0 || y<0 || x>viewportWidth || y>viewportHeight)return
    const rawTime=Number(event.timeStamp),sampleTime=Number.isFinite(rawTime)&&Math.abs(rawTime-time)<60000?rawTime:time
    const before=previous || {x,y,time:sampleTime-16}
    const mx=x-before.x,my=y-before.y,distance=Math.hypot(mx,my)
    const elapsed=clamp(sampleTime-before.time,1,120)
    const velocity=clamp(distance/elapsed/1.6)
    const dx=distance>.001?mx/distance:0,dy=distance>.001?my/distance:0
    pointer.x=x;pointer.y=y;pointer.active=true
    speed=velocity;directionX=dx;directionY=dy;lastMove=time
    pointer.speed=speed;pointer.dx=dx;pointer.dy=dy
    queue.push({x0:before.x,y0:before.y,x1:x,y1:y,dx,dy,speed:velocity})
    if(queue.length>256)queue.splice(0,queue.length-256)
    previous={x,y,time:sampleTime};fieldUntil=time+1600
  }
  function move(event) {
    if(preference.matches || document.hidden)return
    if(event.pointerType==='touch'){release(true);return}
    if(event.clientX<0 || event.clientY<0 || event.clientX>viewportWidth || event.clientY>viewportHeight){release();return}
    const time=now(),coalesced=event.getCoalescedEvents?.() || []
    for(const sampleEvent of coalesced)sample(sampleEvent,time)
    if(!coalesced.length || coalesced.at(-1).clientX!==event.clientX || coalesced.at(-1).clientY!==event.clientY)sample(event,time)
    if(trailAllowed()){lastTrail=time;wake()}else update(time)
  }
  function syncVisibility() {
    if(preference.matches || document.hidden){release(true);if(overlay)overlay.hidden=true;return}
    if(!trailAllowed()){clearTrail();stop();if(overlay)overlay.hidden=true}
    else if(overlay)overlay.hidden=false
  }
  function mount() {
    if(mounted)return cleanup
    if(disposed)return ()=>{}
    mounted=true;abort=new AbortController()
    const passive={passive:true,signal:abort.signal}
    overlay=document.createElement('canvas');overlay.className='particle-input-trail';overlay.dataset.particleTrail='idle'
    overlay.setAttribute('aria-hidden','true');overlay.setAttribute('role','presentation');overlay.inert=true
    trail=overlay.getContext('2d');document.body.append(overlay);resize();syncVisibility()
    window.addEventListener('pointermove',move,passive)
    window.addEventListener('pointerdown',event=>{if(event.pointerType==='touch')release(true)},passive)
    document.documentElement.addEventListener('pointerleave',()=>release(),passive)
    window.addEventListener('pointerout',event=>{if(event.relatedTarget===null && event.pointerType!=='touch')release()},passive)
    window.addEventListener('pointercancel',()=>release(),passive)
    window.addEventListener('blur',()=>release(true),passive)
    window.addEventListener('resize',resize,passive)
    window.visualViewport?.addEventListener('resize',resize,passive)
    document.addEventListener('visibilitychange',syncVisibility,{signal:abort.signal})
    preference.addEventListener('change',syncVisibility,{signal:abort.signal})
    for(const name of ['grade:dialog-open','grade:dialog-close'])document.addEventListener(name,syncVisibility,{signal:abort.signal})
    document.addEventListener('close',syncVisibility,{capture:true,signal:abort.signal})
    dialogObserver=new MutationObserver(syncVisibility)
    dialogObserver.observe(document.body,{subtree:true,attributes:true,attributeFilter:['open']})
    return cleanup
  }
  function cleanup(){
    if(disposed)return
    release(true);disposed=true;mounted=false;abort?.abort();dialogObserver?.disconnect()
    overlay?.remove();overlay=null;trail=null;queue=[]
    if(singleton?.shared===shared)singleton=null
  }
  resize()
  return {shared,mount,cleanup}
}

/** The RGB field stays off-DOM; client Y increases downwards, G/B neutral is 128. */
export function getParticleInput(){if(!singleton)singleton=createInput();return singleton.shared}
/** One global passive input source, independent of SPA routes. Cleanup is shutdown only. */
export function mountParticleInput(){if(!singleton)singleton=createInput();return singleton.mount()}