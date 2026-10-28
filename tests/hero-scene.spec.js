import {test,expect} from '@playwright/test'
import {writeFile} from 'node:fs/promises'

test.use({locale:'ru-RU',reducedMotion:'no-preference',launchOptions:{args:['--enable-unsafe-swiftshader','--use-angle=swiftshader']}})
test.skip(({browserName})=>browserName!=='chromium','The real GPU regressions use deterministic Chromium software WebGL')

const hero=page=>page.locator('[data-hero-scene]')
const canvas=page=>page.locator('[data-hero-canvas] .hero-scene-canvas')
const ready=page=>expect(page.locator('main')).not.toHaveAttribute('aria-busy','true')

async function fixtures(page,{language='ru',noWebGL=false,noFloat=false,failedResources=false,earlyEntry=false}={}){
  const errors=[],writes=[],unexpected=[]
  page.on('pageerror',error=>errors.push(error.message))
  await page.route('**/api/**',route=>{
    const request=route.request(),path=new URL(request.url()).pathname
    if(request.method()!=='GET'){
      writes.push(request.method()+' '+path)
      return route.fulfill({status:405,json:{error:'Hero scene fixtures never write application data'}})
    }
    const english=request.headers()['accept-language']==='en'
    const items=Array.from({length:4},(_,index)=>({id:String(index+1),name:english?`Frame ${index+1}`:`Кадр ${index+1}`,kind:'movie',year:2026-index,poster:`/scene-fixtures/poster-${index+1}.svg`,votes:0,average:null}))
    if(path==='/api/me')return route.fulfill({json:{user:null}})
    if(path==='/api/catalog')return route.fulfill({json:{items,total:4,page:1,pages:1,externalSearch:false}})
    if(path==='/api/catalog/discover')return route.fulfill({json:{available:false,items:[],page:1,pages:0}})
    if(/^\/api\/titles\/\d+\/discussion$/.test(path))return route.fulfill({json:{items:[],total:0,page:1,pages:0}})
    if(/^\/api\/titles\/\d+\/(trailer|external-ratings)$/.test(path))return route.fulfill({json:{status:'not_found'}})
    if(/^\/api\/titles\/\d+$/.test(path))return route.fulfill({json:{...items[Number(path.split('/').at(-1))-1],original_name:'Frame',runtime:'100 мин',genres:['Драма'],description:'История из коллекции',watched:false,planned:false,my_score:null}})
    unexpected.push(path)
    return route.fulfill({status:404,json:{error:'Unknown scene fixture route'}})
  })
  await page.route('**/scene-fixtures/*.svg',route=>failedResources
    ?route.fulfill({status:404,body:'Image unavailable'})
    :route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450"><rect width="300" height="450" fill="#716f74"/><path d="M0 330 300 100V450H0Z" fill="#49474e"/></svg>'}))
  if(failedResources){
    await page.route('**/assets/hero-scene-vendor.js',route=>route.abort())
    await page.route('https://fonts.googleapis.com/**',route=>route.abort())
    await page.route('https://fonts.gstatic.com/**',route=>route.abort())
    await page.route('**/*.woff2',route=>route.abort())
  }
  const frameMs=Number(process.env.GRADE_PARTICLE_TEST_FRAME_MS||0)
  await page.addInitScript(({language,noWebGL,noFloat,earlyEntry,frameMs})=>{
    if(frameMs>0){
      const nativeRequest=requestAnimationFrame.bind(window),nativeCancel=cancelAnimationFrame.bind(window),queue=new Map()
      let next=0,timer=null,nativeId=null,last=0,flushing=false
      const schedule=()=>{
        if(flushing||timer!==null||nativeId!==null||!queue.size)return
        timer=setTimeout(()=>{
          timer=null
          nativeId=nativeRequest(()=>{
            nativeId=null;last=performance.now();flushing=true
            try{for(const id of [...queue.keys()]){const callback=queue.get(id);if(callback){queue.delete(id);callback(performance.now())}}}
            finally{flushing=false;schedule()}
          })
        },Math.max(0,frameMs-(performance.now()-last)))
      }
      window.requestAnimationFrame=callback=>{const id=++next;queue.set(id,callback);schedule();return id}
      window.cancelAnimationFrame=id=>{
        queue.delete(id)
        if(!queue.size){if(timer!==null)clearTimeout(timer);if(nativeId!==null)nativeCancel(nativeId);timer=nativeId=null}
      }
    }
    localStorage.setItem('grade:language',language)
    const probe=window.__sceneProbe={allocations:[],frames:[],contexts:[],errors:[],simulations:[],samples:[]}
    probe.pointerMoves=0
    document.addEventListener('pointermove',()=>probe.pointerMoves++,{passive:true})
    const native=HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext=function(type,...args){
      if(!/^webgl2?$|^experimental-webgl$/.test(type))return native.call(this,type,...args)
      const context=noWebGL?null:native.call(this,type,...args)
      if(context&&noFloat){const get=context.getExtension.bind(context);context.getExtension=name=>name==='EXT_color_buffer_float'?null:get(name)}
      probe.allocations.push({type,success:Boolean(context)})
      return context
    }
    probe.readSimulation=()=>{
      const s=probe.lastSimulation,entry=probe.simulations.find(entry=>entry.id===s.id)
      const length=s.width*s.height*4
      entry.positions||=new Float32Array(length);entry.velocities||=new Float32Array(length)
      s.renderer.readRenderTargetPixels(s.positionTarget,0,0,s.width,s.height,entry.positions)
      s.renderer.readRenderTargetPixels(s.velocityTarget,0,0,s.width,s.height,entry.velocities)
      const p=entry.positions,v=entry.velocities,home=s.homeTexture.image.data
      const summarize=(start,count,near=false)=>{
        let n=0,error=0,zError=0,energy=0,zEnergy=0,cx=0,cy=0,cz=0,finite=true
        const samples=[],bounds={left:Infinity,right:-Infinity,top:Infinity,bottom:-Infinity}
        const m=s.matrixWorld,q=s.viewProjection,rect=probe.lastCanvas.getBoundingClientRect(),corridor=probe.corridor
        for(let i=start;i<start+count;i++){
          const k=i*4,x=home[k],y=home[k+1],z=home[k+2]
          if(near||i%23===0){
            const wx=m[0]*x+m[4]*y+m[8]*z+m[12],wy=m[1]*x+m[5]*y+m[9]*z+m[13],wz=m[2]*x+m[6]*y+m[10]*z+m[14]
            const w=q[3]*wx+q[7]*wy+q[11]*wz+q[15]
            const sx=rect.left+((q[0]*wx+q[4]*wy+q[8]*wz+q[12])/w*.5+.5)*rect.width
            const sy=rect.top+(1-((q[1]*wx+q[5]*wy+q[9]*wz+q[13])/w*.5+.5))*rect.height
            bounds.left=Math.min(bounds.left,sx);bounds.right=Math.max(bounds.right,sx);bounds.top=Math.min(bounds.top,sy);bounds.bottom=Math.max(bounds.bottom,sy)
            if(near&&corridor&&(sx<corridor.left||sx>corridor.right||Math.abs(sy-corridor.y)>corridor.radius))continue
          }
          n++;cx+=p[k];cy+=p[k+1];cz+=p[k+2]
          error+=(p[k]-x)**2+(p[k+1]-y)**2+(p[k+2]-z)**2;zError+=(p[k+2]-z)**2
          energy+=v[k]**2+v[k+1]**2+v[k+2]**2
          zEnergy+=v[k+2]**2
          finite&&=Number.isFinite(p[k]+p[k+1]+p[k+2]+v[k]+v[k+1]+v[k+2])
          if((i-start)%Math.max(1,Math.floor(count/384))===0)samples.push(p[k],p[k+1],p[k+2])
        }
        return {count:n,rms:Math.sqrt(error/Math.max(1,n)),zRms:Math.sqrt(zError/Math.max(1,n)),energy:energy/Math.max(1,n),zEnergy:zEnergy/Math.max(1,n),center:[cx/n,cy/n,cz/n],finite,samples,bounds}
      }
      return {id:s.id,step:s.step,time:s.time,wall:performance.now(),core:summarize(0,s.coreCount),near:summarize(0,s.coreCount,true),dust:summarize(s.coreCount,s.dustCount),ray:s.ray,pointerActive:s.pointerActive,pointerSpeed:s.pointerSpeed,inputRevision:s.inputRevision,
        positionPool:entry.positionPool.length,velocityPool:entry.velocityPool.length}
    }
    document.addEventListener('grade:hero-scene-frame',event=>{
      const {gl,canvas,frame,assembly,progress,camera,dispersion,pointerStrength}=event.detail
      let entry=probe.contexts.find(entry=>entry.canvas===canvas)
      if(!entry){entry={root:event.target,canvas,gl,id:probe.contexts.length+1};probe.contexts.push(entry)}
      let pixels=null
      // Include the first fully assembled frame independently of periodic sampling.
      if(frame<3||frame%4===0||(assembly===1&&!entry.finalPixels)){
        try{
          const width=Math.min(256,gl.drawingBufferWidth),height=Math.min(256,gl.drawingBufferHeight)
          const mobile=innerWidth<=760
          const body=event.target.querySelector('[data-hero-stage]').getBoundingClientRect(),viewport=canvas.getBoundingClientRect()
          const bodyX=body.left+body.width*(mobile?.53:.72),bodyY=body.top+body.height*.32
          const x=Math.max(0,Math.min(gl.drawingBufferWidth-width,Math.round((bodyX-viewport.left)/viewport.width*gl.drawingBufferWidth-width/2)))
          const y=Math.max(0,Math.min(gl.drawingBufferHeight-height,Math.round((viewport.bottom-bodyY)/viewport.height*gl.drawingBufferHeight-height/2)))
          const data=new Uint8Array(width*height*4)
          gl.readPixels(x,y,width,height,gl.RGBA,gl.UNSIGNED_BYTE,data)
          let hash=2166136261,lit=0,sum=0,cx=0,cy=0,minX=width,maxX=0,minY=height,maxY=0
          for(let index=0;index<data.length;index+=16){
            const value=Math.max(data[index],data[index+1],data[index+2]),px=(index/4)%width,py=Math.floor(index/4/width)
            hash=Math.imul(hash^data[index],16777619);hash=Math.imul(hash^data[index+1],16777619);hash=Math.imul(hash^data[index+2],16777619)
            sum+=value
            if(value>35){lit++;cx+=px;cy+=py;minX=Math.min(minX,px);maxX=Math.max(maxX,px);minY=Math.min(minY,py);maxY=Math.max(maxY,py)}
          }
          pixels={hash:hash>>>0,lit,mean:sum/(data.length/16),cx:lit?cx/lit:0,cy:lit?cy/lit:0,bounds:[minX,minY,maxX,maxY],width,height,error:gl.getError()}
          if(assembly===1)entry.finalPixels=true
        }catch(error){probe.errors.push(error.message)}
      }
      const simulation=event.detail.simulation
      if(simulation){
        probe.lastSimulation=simulation;probe.lastCanvas=canvas
        let current=probe.simulations.find(item=>item.id===simulation.id)
        if(!current){current={id:simulation.id,positionPool:[],velocityPool:[]};probe.simulations.push(current)}
        if(!current.positionPool.includes(simulation.positionTarget))current.positionPool.push(simulation.positionTarget)
        if(!current.velocityPool.includes(simulation.velocityTarget))current.velocityPool.push(simulation.velocityTarget)
        if(probe.monitor&&(probe.monitorEveryStep||simulation.time-(probe.lastSampleTime||0)>.1)){
          try{probe.samples.push(probe.readSimulation());probe.lastSampleTime=simulation.time}catch(error){probe.errors.push(error.message)}
        }
      }
      probe.frames.push({context:entry.id,frame,assembly,progress,camera,dispersion,pointerStrength,pixels,at:performance.now(),cameraFrozen:event.detail.cameraFrozen,
        reflectionMatches:event.detail.positionTexture===event.detail.reflectionTexture,
        simulation:simulation?{id:simulation.id,step:simulation.step,time:simulation.time,ray:simulation.ray,inputRevision:simulation.inputRevision}:null})
      if(probe.headerRequest&&assembly===1){
        const request=probe.headerRequest;probe.headerRequest=null
        const header=document.querySelector('.track-header'),headerBox=header.getBoundingClientRect(),viewport=canvas.getBoundingClientRect()
        const width=gl.drawingBufferWidth,height=Math.min(gl.drawingBufferHeight,Math.round(headerBox.height/viewport.height*gl.drawingBufferHeight))
        const bottom=Math.max(0,Math.min(gl.drawingBufferHeight-height,Math.round((viewport.bottom-headerBox.bottom)/viewport.height*gl.drawingBufferHeight)))
        const data=new Uint8Array(width*height*4)
        gl.readPixels(0,bottom,width,height,gl.RGBA,gl.UNSIGNED_BYTE,data)
        let lit=0,maximum=0
        for(let index=0;index<data.length;index+=4){const value=Math.max(data[index],data[index+1],data[index+2]);maximum=Math.max(maximum,value);if(value>24)lit++}
        const css=getComputedStyle(header),inner=getComputedStyle(header.querySelector('.header-inner'))
        probe.headerBand={label:request.label,frame,progress,simulationId:simulation.id,lit,maximum,error:gl.getError(),width,height,
          canvas:viewport.toJSON(),header:headerBox.toJSON(),background:css.backgroundColor,innerBackground:inner.backgroundColor,
          radius:[css.borderTopLeftRadius,css.borderTopRightRadius,css.borderBottomLeftRadius,css.borderBottomRightRadius],blur:css.backdropFilter||'none',webkitBlur:css.webkitBackdropFilter||css.getPropertyValue('-webkit-backdrop-filter')||'none',
          masks:[...header.querySelectorAll('.brand,.header-control,.header-account')].map(node=>node.getBoundingClientRect().toJSON())}
        probe.headerRaw={data,width,height,cssWidth:headerBox.width,cssHeight:headerBox.height}
        if(request.freeze)queueMicrotask(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'))})
      }
      if(probe.frames.length>1400)probe.frames.splice(0,400)
      if(earlyEntry&&!probe.entry){
        probe.entry={assembly}
        // Act on the first real rendered frame inside the browser. Waiting for
        // several driver round trips could consume the whole wall-clock intro.
        queueMicrotask(()=>{
          const link=event.target.querySelector('a[href="/catalog"]'),bounds=link.getBoundingClientRect(),style=getComputedStyle(link)
          const hit=document.elementFromPoint(bounds.x+bounds.width/2,bounds.y+bounds.height/2)
          probe.entry.hit=hit?.closest('a')===link
          probe.entry.visible=bounds.width>0&&bounds.height>0&&bounds.top>=0&&bounds.bottom<=innerHeight&&style.visibility==='visible'&&Number(style.opacity)===1
          link.focus();probe.entry.focused=document.activeElement===link;link.click()
        })
      }
    })
  },{language,noWebGL,noFloat,earlyEntry,frameMs})
  return {errors,writes,unexpected}
}
async function open(page){
  const response=await page.goto('/')
  expect(response.headers()['content-security-policy']).toContain('img-src')
  await expect(hero(page).locator('h1')).toBeVisible()
  await ready(page)
}
async function gpuReady(page){
  await expect(hero(page)).toHaveAttribute('data-hero-scene-ready','true',{timeout:20000})
  await expect(canvas(page)).toHaveCount(1)
  await expect.poll(()=>page.evaluate(()=>window.__sceneProbe.frames.length)).toBeGreaterThan(0)
}
async function assembled(page){
  await expect(hero(page)).toHaveAttribute('data-hero-scene-assembly','1.0000',{timeout:20000})
  await expect(hero(page)).toHaveAttribute('data-hero-scene-state','running')
  await expect.poll(()=>page.evaluate(()=>{
    const frame=window.__sceneProbe.frames.at(-1),target=Number(document.querySelector('[data-hero-scene]').dataset.heroSceneProgress)
    return Boolean(frame&&(frame.cameraFrozen||Math.abs(frame.progress-target)<.005))
  })).toBe(true)
}
const physical=page=>page.evaluate(()=>window.__sceneProbe.readSimulation())
async function advance(page,seconds){const time=await page.evaluate(()=>window.__sceneProbe.lastSimulation.time);await expect.poll(()=>page.evaluate(()=>window.__sceneProbe.lastSimulation.time),{timeout:20000}).toBeGreaterThan(time+seconds)}
function rmsDifference(a,b){return Math.sqrt(a.reduce((sum,value,index)=>sum+(value-b[index])**2,0)/a.length)}
async function framesStable(page){
  return hero(page).evaluate(async root=>{
    const initial=Number(root.dataset.heroSceneFrames),start=performance.now();let samples=0
    while((performance.now()-start<180||samples<3)&&performance.now()-start<3000){await new Promise(requestAnimationFrame);samples++;if(Number(root.dataset.heroSceneFrames)!==initial)return false}
    return samples>=3
  })
}
async function scrollProgress(page,progress){
  await hero(page).evaluate((root,progress)=>{
    const stage=root.querySelector('[data-hero-stage]'),distance=root.offsetHeight-stage.getBoundingClientRect().height
    scrollTo({top:Math.max(0,root.getBoundingClientRect().top+scrollY+distance*progress),behavior:'instant'})
  },progress)
  await expect.poll(async()=>Math.abs(Number(await hero(page).getAttribute('data-hero-scene-progress'))-progress)).toBeLessThan(.015)
}
async function accessible(page,language='ru'){
  await expect(hero(page).locator('h1')).toHaveText(language==='ru'?/Кино,\s*которое\s*остаётся/:/Cinema\s*that\s*stays/)
  await expect(hero(page).locator('h1')).toHaveCSS('opacity','1')
  await expect(hero(page).locator('a[href="/catalog"]')).toBeVisible()
  await expect(hero(page).locator('a[href="/me"]')).toBeVisible()
  await expect(page.locator('.cinema-film-link')).toHaveCount(4)
  for(const link of await page.locator('.cinema-film-link').all()){
    await expect(link).toHaveAttribute('href',/^\/title\/\d+$/)
    await expect(link.locator('strong')).toContainText(/\S/)
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
}
function clean(audit){expect(audit).toEqual({errors:[],writes:[],unexpected:[]})}

for(const [language,width] of [['ru',1440],['en',390]])test(`the finished static composition keeps real text and film routes in ${language} at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:width===390?844:1000})
  await page.emulateMedia({reducedMotion:'reduce'})
  const audit=await fixtures(page,{language})
  await open(page)
  await expect(hero(page)).toHaveAttribute('data-hero-scene-state','reduced')
  await accessible(page,language)
  await expect(canvas(page)).toHaveCount(0)
  await expect(hero(page).locator('[data-hero-fallback]')).toHaveCSS('opacity','1')
  const typography=await hero(page).locator('h1').evaluate(node=>({family:getComputedStyle(node).fontFamily,size:parseFloat(getComputedStyle(node).fontSize),text:node.childElementCount}))
  expect(typography.family).toContain('Cormorant Garamond')
  expect(typography.size).toBeGreaterThanOrEqual(width===390?46:96)
  expect(typography.text).toBeGreaterThan(0)
  expect(await page.evaluate(()=>window.__sceneProbe.allocations)).toEqual([])
  const film=page.locator('.cinema-film-link').first()
  await film.focus();await page.keyboard.press('Enter');await ready(page)
  await expect(page.locator('.detail-poster')).toBeVisible()
  await page.goBack();await ready(page)
  await expect(film).toBeFocused()
  await expect(hero(page)).toHaveAttribute('data-hero-scene-state','reduced')
  clean(audit)
})

test('unavailable WebGL leaves the sculpted DOM alternative and immediately usable actions',async({page})=>{
  const audit=await fixtures(page,{noWebGL:true})
  await open(page)
  await expect(hero(page)).toHaveAttribute('data-hero-scene-state','fallback')
  await expect(hero(page)).toHaveAttribute('data-hero-scene-reason','webgl')
  await accessible(page)
  await expect(canvas(page)).toHaveCount(0)
  await expect(hero(page).locator('[data-hero-fallback]')).toHaveCSS('opacity','1')
  expect(await page.evaluate(()=>window.__sceneProbe.allocations.every(entry=>!entry.success))).toBe(true)
  await hero(page).locator('a[href="/catalog"]').click();await ready(page)
  await expect(page).toHaveURL(/\/catalog$/)
  clean(audit)
})

test('missing scene vendor, fonts and posters preserve readable content and functional catalog entry',async({page})=>{
  const audit=await fixtures(page,{failedResources:true})
  await open(page)
  await expect(hero(page)).toHaveAttribute('data-hero-scene-state','fallback')
  await expect(canvas(page)).toHaveCount(0)
  await accessible(page)
  await expect(page.locator('.cinema-film-link img')).toHaveCount(0)
  await hero(page).locator('a[href="/catalog"]').focus();await page.keyboard.press('Enter');await ready(page)
  await expect(page.locator('#catalog-sort')).toBeVisible()
  clean(audit)
})

test('real particle pixels assemble, react to the pointer and follow a reversible native camera and dispersion path',async({page})=>{
  const audit=await fixtures(page)
  await open(page);await gpuReady(page)
  await expect(hero(page)).toHaveAttribute('data-hero-scene-mode','desktop')
  expect(Number(await hero(page).getAttribute('data-hero-scene-depth'))).toBeGreaterThan(.8)
  expect(Number(await hero(page).getAttribute('data-hero-scene-particles'))).toBeGreaterThanOrEqual(20000)
  await assembled(page)
  await advance(page,1.2)
  const quiet=await physical(page)
  await advance(page,1.2)
  const alive=await physical(page)
  expect(alive.id).toBe(quiet.id)
  expect(rmsDifference(alive.core.samples,quiet.core.samples)).toBeGreaterThan(.001)
  expect(rmsDifference(alive.dust.samples,quiet.dust.samples)).toBeGreaterThan(.001)
  expect(alive.core.energy).toBeGreaterThan(.00001)
  expect(alive.dust.energy).toBeGreaterThan(.00001)
  expect(alive.core.rms).toBeLessThan(.5)
  expect(alive.core.finite&&alive.dust.finite).toBe(true)
  let frames=await page.evaluate(()=>window.__sceneProbe.frames)
  expect(frames.some(frame=>frame.assembly>.05&&frame.assembly<.95&&frame.pixels)).toBe(true)
  const gathered=frames.filter(frame=>frame.assembly===1&&frame.pixels).at(-1)
  expect(gathered).toBeTruthy()
  expect(gathered.pixels.lit).toBeGreaterThan(12)
  expect(gathered.pixels.bounds[2]-gathered.pixels.bounds[0]).toBeGreaterThan(10)
  expect(new Set(frames.filter(frame=>frame.pixels).map(frame=>frame.pixels.hash)).size).toBeGreaterThan(4)
  const beforePointer=frames.length,box=await page.locator('[data-hero-stage]').boundingBox()
  await page.mouse.move(box.x+box.width*.68,box.y+box.height*.32)
  await page.mouse.move(box.x+box.width*.73,box.y+box.height*.36,{steps:8})
  await expect.poll(()=>page.evaluate(index=>window.__sceneProbe.frames.slice(index).some(frame=>frame.pointerStrength>.05&&frame.pixels),beforePointer)).toBe(true)
  frames=await page.evaluate(()=>window.__sceneProbe.frames)
  expect(frames.slice(beforePointer).some(frame=>frame.pixels&&frame.pixels.hash!==gathered.pixels.hash)).toBe(true)
  await page.mouse.move(0,0);await assembled(page)
  await scrollProgress(page,.68);await assembled(page)
  const forward=await page.evaluate(()=>window.__sceneProbe.frames.filter(frame=>frame.pixels).at(-1))
  expect(forward.progress).toBeGreaterThan(.65)
  expect(forward.camera.z).toBeLessThan(gathered.camera.z-1)
  expect(forward.camera.x).toBeGreaterThan(gathered.camera.x+.7)
  expect(forward.dispersion).toBeGreaterThan(.5)
  expect(forward.pixels.hash).not.toBe(gathered.pixels.hash)
  await scrollProgress(page,0);await assembled(page)
  const returned=await page.evaluate(()=>window.__sceneProbe.frames.at(-1))
  expect(returned.progress).toBeLessThan(.01)
  expect(returned.camera.z).toBeCloseTo(gathered.camera.z,1)
  expect(returned.dispersion).toBeLessThan(.01)
  expect(await page.evaluate(()=>window.__sceneProbe.frames.every(frame=>!frame.pixels||frame.pixels.error===0))).toBe(true)
  expect(await page.evaluate(()=>window.__sceneProbe.errors)).toEqual([])
  clean(audit)
})

test('a touch phone renders a real lower-density volume, resizes correctly and permits native dragging',async({browser})=>{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:3,reducedMotion:'no-preference',locale:'ru-RU'})
  try{
    const page=await context.newPage(),audit=await fixtures(page)
    await open(page);await gpuReady(page);await assembled(page)
    await expect(hero(page)).toHaveAttribute('data-hero-scene-mode','mobile')
    expect(Number(await hero(page).getAttribute('data-hero-scene-particles'))).toBeGreaterThanOrEqual(8000)
    expect(Number(await hero(page).getAttribute('data-hero-scene-particles'))).toBeLessThan(20000)
    expect(Number(await hero(page).getAttribute('data-hero-scene-depth'))).toBeGreaterThan(.8)
    expect(await page.evaluate(()=>navigator.maxTouchPoints)).toBeGreaterThan(0)
    expect(await page.evaluate(()=>window.__sceneProbe.frames.some(frame=>frame.pixels?.lit>10))).toBe(true)
    await page.setViewportSize({width:430,height:932});await assembled(page)
    const bounds=await canvas(page).evaluate(node=>({width:node.width,height:node.height,css:node.getBoundingClientRect().toJSON()}))
    expect(bounds.width/bounds.css.width).toBeLessThanOrEqual(1.251)
    expect(Math.abs(bounds.width/bounds.height-bounds.css.width/bounds.css.height)).toBeLessThan(.01)
    await expect(canvas(page)).toHaveCount(1)
    const cdp=await context.newCDPSession(page)
    await advance(page,1)
    const quiet=await physical(page)
    await page.evaluate(()=>{const probe=window.__sceneProbe;probe.samples=[];probe.monitor=true;probe.monitorEveryStep=true})
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:110,y:300}]})
    for(const x of [140,180,220,260,300]){
      await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:300}]})
      await page.waitForTimeout(30)
    }
    await advance(page,.2)
    expect(await page.evaluate(()=>window.__sceneProbe.lastSimulation.pointerActive)).toBe(1)
    expect(await page.evaluate(()=>Math.max(...window.__sceneProbe.samples.map(sample=>sample.core.energy)))).toBeGreaterThan(quiet.core.energy*1.2)
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
    await page.evaluate(()=>{window.__sceneProbe.monitor=false;window.__sceneProbe.monitorEveryStep=false})
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:210,y:560}]})
    for(const y of [520,450,380,300])await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:210,y}]})
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
    await expect.poll(()=>page.evaluate(()=>scrollY)).toBeGreaterThan(50)
    await expect.poll(async()=>Number(await hero(page).getAttribute('data-hero-scene-progress'))).toBeGreaterThan(.02)
    await cdp.detach()
    clean(audit)
  }finally{await context.close()}
})

test('visible physics stays alive, opaque scenes pause it and a partial auth panel freezes only the camera',async({page})=>{
  const audit=await fixtures(page)
  await open(page);await gpuReady(page);await assembled(page)
  expect(await framesStable(page)).toBe(false)
  await hero(page).evaluate(root=>scrollTo({top:root.getBoundingClientRect().top+scrollY+root.offsetHeight+100,behavior:'instant'}))
  await expect(hero(page)).toHaveAttribute('data-hero-scene-state','paused')
  await expect(hero(page)).toHaveAttribute('data-hero-scene-reason','offscreen')
  expect(await framesStable(page)).toBe(true)
  await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));await assembled(page)
  // Headless tabs stay visible even when another page is brought forward.
  // Change the scheduler's visibility input while real browser RAF keeps ticking.
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>'hidden'});document.dispatchEvent(new Event('visibilitychange'))})
  await expect(hero(page)).toHaveAttribute('data-hero-scene-reason','hidden')
  expect(await framesStable(page)).toBe(true)
  await page.evaluate(()=>{delete document.hidden;delete document.visibilityState;document.dispatchEvent(new Event('visibilitychange'))});await assembled(page)
  for(const [trigger,panel] of [['.menu-trigger','#section-menu'],['.search-trigger','#search-tray']]){
    await page.locator(trigger).click()
    await expect(hero(page)).toHaveAttribute('data-hero-scene-state','paused')
    await expect(hero(page)).toHaveAttribute('data-hero-scene-reason','scene')
    expect(await framesStable(page)).toBe(true)
    await expect.poll(()=>page.locator(panel).evaluate(async node=>{
      const {gsap}=await import('/assets/motion-vendor.js')
      return gsap.getTweensOf(node).some(tween=>tween.isActive())
    })).toBe(false)
    const closing=await page.locator(panel).evaluate(async panel=>{
      const root=document.querySelector('[data-hero-scene]'),frames=root.dataset.heroSceneFrames,start=performance.now()
      panel.querySelector('[data-close-scene],.modal-close').click()
      let samples=0,frozen=true,intermediate=false,stillClosing=true
      while((performance.now()-start<180||samples<3)&&performance.now()-start<3000){
        await new Promise(requestAnimationFrame)
        stillClosing=panel.matches('dialog')?panel.open:!panel.hidden
        if(!stillClosing)break
        samples++
        const phase=parseFloat(getComputedStyle(panel).getPropertyValue('--scene-type-progress'))
        intermediate||=phase>0&&phase<1
        frozen&&=root.dataset.heroSceneFrames===frames&&root.dataset.heroSceneState==='paused'
      }
      return {samples,frozen,intermediate,measured:samples>=3||!stillClosing}
    })
    expect(closing.samples).toBeGreaterThan(0)
    expect(closing.frozen).toBe(true)
    expect(closing.intermediate).toBe(true)
    expect(closing.measured).toBe(true)
    await expect(page.locator(panel)).toBeHidden()
    await assembled(page)
  }
  await page.locator('.login-button').click()
  await expect(hero(page)).toHaveAttribute('data-hero-scene-camera','locked')
  const beforeAuth=await physical(page),camera=await page.evaluate(()=>window.__sceneProbe.frames.at(-1).camera)
  await scrollProgress(page,.35);await advance(page,.5)
  const behindAuth=await physical(page)
  expect(behindAuth.step).toBeGreaterThan(beforeAuth.step)
  expect(rmsDifference(behindAuth.core.samples,beforeAuth.core.samples)).toBeGreaterThan(.001)
  expect(await page.evaluate(()=>window.__sceneProbe.frames.at(-1).camera)).toEqual(camera)
  await page.keyboard.press('Escape');await expect(page.locator('#modal')).toBeHidden();await assembled(page)
  clean(audit)
})

test('GPU velocities produce stronger fast repulsion, depth, inertia and a damped return to the real home shape',async({page},testInfo)=>{
  test.setTimeout(120000)
  const audit=await fixtures(page)
  await open(page);await gpuReady(page);await assembled(page);await advance(page,2.5)
  const initial=await physical(page),bounds=initial.core.bounds
  const path={left:bounds.left-25,right:bounds.right+25,y:(bounds.top+bounds.bottom)/2,radius:(bounds.bottom-bounds.top)*.13}
  await page.evaluate(path=>{window.__sceneProbe.corridor=path},path)
  const baseline=await physical(page)
  expect(baseline.near.count).toBeGreaterThan(20)
  const cpuRate=Number(process.env.GRADE_PARTICLE_TEST_CPU_RATE||1)
  const cpuSession=cpuRate>1?await page.context().newCDPSession(page):null
  if(cpuSession)await cpuSession.send('Emulation.setCPUThrottlingRate',{rate:cpuRate})
  try{
  await page.evaluate(async()=>{
    const input=(await import('/particle-input.js')).getParticleInput(),probe=window.__sceneProbe
    // Registered after the production window handler: observe the actual input
    // event before its speed decays while waiting for a slow GPU/RAF callback.
    window.addEventListener('pointermove',()=>{
      if(probe.inputRecording)probe.gestureEvents.push({speed:input.pointer.speed,x:input.pointer.x,y:input.pointer.y,at:performance.now()})
    },{passive:true})
  })
  async function sweep(duration){
    await page.mouse.move(path.left,path.y)
    await advance(page,.8)
    await page.evaluate(()=>{const probe=window.__sceneProbe;probe.samples=[];probe.gestureEvents=[];probe.inputRecording=true;probe.monitor=true;probe.monitorEveryStep=true;probe.lastSampleTime=0})
    const segments=duration<200?1:12
    for(let index=1;index<=segments;index++){
      await page.mouse.move(path.left+(path.right-path.left)*index/segments,path.y)
      await page.waitForTimeout(duration/segments)
    }
    const lastStep=await page.evaluate(()=>{window.__sceneProbe.inputRecording=false;return window.__sceneProbe.lastSimulation.step})
    await expect.poll(()=>page.evaluate(()=>window.__sceneProbe.lastSimulation.step),{timeout:30000}).toBeGreaterThanOrEqual(lastStep+8)
    await page.evaluate(()=>{window.__sceneProbe.monitor=false;window.__sceneProbe.monitorEveryStep=false})
    return page.evaluate(()=>({events:window.__sceneProbe.gestureEvents,samples:window.__sceneProbe.samples.map(sample=>({energy:sample.near.energy,rms:sample.near.rms,zRms:sample.near.zRms,zEnergy:sample.near.zEnergy,speed:sample.pointerSpeed,time:sample.time,wall:sample.wall,z:sample.near.samples.filter((_,index)=>index%3===2)}))}))
  }
  const slow=await sweep(1000)
  await page.mouse.move(0,0);await advance(page,2)
  const fast=await sweep(80)
  const maximum=(samples,key)=>Math.max(...samples.map(sample=>sample[key]))
  const cadence=fast.samples.slice(1).map((sample,index)=>sample.wall-fast.samples[index].wall).sort((a,b)=>a-b)
  const zMotion=samples=>Math.max(...samples.slice(1).map((sample,index)=>rmsDifference(sample.z,samples[index].z)))
  const zRate=samples=>Math.max(...samples.slice(1).map((sample,index)=>rmsDifference(sample.z,samples[index].z)/(sample.time-samples[index].time)))
  const peak={slowEnergy:maximum(slow.samples,'energy'),fastEnergy:maximum(fast.samples,'energy'),slowSpeed:maximum(slow.events,'speed'),fastSpeed:maximum(fast.events,'speed'),
    sampledSlowSpeed:maximum(slow.samples,'speed'),sampledFastSpeed:maximum(fast.samples,'speed'),slowSamples:slow.samples.length,fastSamples:fast.samples.length,
    fastDepth:maximum(fast.samples,'zRms'),baselineDepth:baseline.near.zRms,fastZEnergy:maximum(fast.samples,'zEnergy'),baselineZEnergy:baseline.near.zEnergy,
    fastZMotion:zMotion(fast.samples),slowZMotion:zMotion(slow.samples),fastZRate:zRate(fast.samples),slowZRate:zRate(slow.samples),
    wallCadenceP95:cadence[Math.floor((cadence.length-1)*.95)],frameMs:Number(process.env.GRADE_PARTICLE_TEST_FRAME_MS||0),cpuRate}
  await testInfo.attach('real-gpu-response',{body:JSON.stringify(peak),contentType:'application/json'})
  expect(peak.fastSpeed).toBeGreaterThan(peak.slowSpeed+.1)
  expect(peak.fastEnergy).toBeGreaterThan(peak.slowEnergy*1.05)
  expect(peak.fastZEnergy).toBeGreaterThan(baseline.near.zEnergy*1.5)
  expect(peak.fastZRate).toBeGreaterThan(peak.slowZRate*1.5)
  const disturbed=await physical(page)
  await page.mouse.move(0,0);await advance(page,.2)
  const inertia=await physical(page)
  expect(inertia.near.energy).toBeGreaterThan(baseline.near.energy*1.1)
  expect(rmsDifference(inertia.core.samples,disturbed.core.samples)).toBeGreaterThan(.001)
  await advance(page,2)
  const returned=await physical(page)
  const metrics={...peak,baselineEnergy:baseline.near.energy,baselineError:baseline.near.rms,disturbedError:disturbed.near.rms,
    inertiaEnergy:inertia.near.energy,returnEnergy:returned.near.energy,returnError:returned.near.rms,
    simulationId:returned.id,simulationTime:returned.time,coreFinite:returned.core.finite,dustFinite:returned.dust.finite}
  const evidence=testInfo.outputPath('real-gpu-response.json')
  await writeFile(evidence,JSON.stringify(metrics,null,2))
  await testInfo.attach('real-gpu-response-complete',{path:evidence,contentType:'application/json'})
  expect(returned.near.rms).toBeLessThan(Math.max(...fast.samples.map(sample=>sample.rms))*.85)
  expect(returned.near.energy).toBeLessThan(peak.fastEnergy*.5)
  expect(returned.core.finite&&returned.dust.finite).toBe(true)
  expect(returned.id).toBe(initial.id)
  clean(audit)
  }finally{if(cpuSession)await cpuSession.detach()}
})

test('a stationary screen pointer keeps its ray current while scrolling the same GPU position and velocity targets',async({page})=>{
  const audit=await fixtures(page)
  await open(page);await gpuReady(page);await assembled(page);await advance(page,.5)
  const baseline=await physical(page),bounds=baseline.core.bounds
  await page.mouse.move((bounds.left+bounds.right)/2,(bounds.top+bounds.bottom)/2)
  await advance(page,.3)
  const before=await physical(page),moves=await page.evaluate(()=>window.__sceneProbe.pointerMoves)
  await page.evaluate(()=>{const s=window.__sceneProbe.lastSimulation;window.__sceneProbe.anchor={renderer:s.renderer,targets:s.targets,home:s.homeTexture}})
  await scrollProgress(page,.45);await assembled(page);await advance(page,.3)
  const forward=await physical(page)
  expect(await page.evaluate(()=>window.__sceneProbe.pointerMoves)).toBe(moves)
  expect(forward.pointerActive).toBe(1)
  expect(rmsDifference(forward.ray,before.ray)).toBeGreaterThan(.001)
  expect(forward.step).toBeGreaterThan(before.step)
  expect(forward.id).toBe(before.id)
  expect(rmsDifference(forward.core.samples,before.core.samples)).toBeGreaterThan(.01)
  expect(await page.evaluate(()=>{const p=window.__sceneProbe,s=p.lastSimulation;return s.renderer===p.anchor.renderer&&s.targets===p.anchor.targets&&s.homeTexture===p.anchor.home})).toBe(true)
  await scrollProgress(page,0);await assembled(page)
  const back=await physical(page)
  expect(back.id).toBe(before.id)
  expect(back.step).toBeGreaterThan(forward.step)
  expect(back.positionPool).toBe(2);expect(back.velocityPool).toBe(2)
  expect(await page.evaluate(()=>window.__sceneProbe.frames.every(frame=>frame.reflectionMatches))).toBe(true)
  clean(audit)
})

test('missing floating-point render targets leave an accessible static shape instead of a broken simulation',async({page})=>{
  const audit=await fixtures(page,{noFloat:true})
  await open(page)
  await expect(hero(page)).toHaveAttribute('data-hero-scene-state','fallback')
  await expect(hero(page)).toHaveAttribute('data-hero-scene-reason','simulation-fbo')
  await expect(canvas(page)).toHaveCount(0)
  await accessible(page)
  await hero(page).locator('a[href="/catalog"]').click();await ready(page)
  await expect(page.locator('#catalog-sort')).toBeVisible()
  clean(audit)
})

test('navigation and Back release old GPU resources, restore one assembled scene and recover from actual context loss',async({page})=>{
  const audit=await fixtures(page,{earlyEntry:true})
  const response=await page.goto('/')
  expect(response.headers()['content-security-policy']).toContain('img-src')
  await expect(page).toHaveURL(/\/catalog$/)
  await expect(page.locator('#catalog-sort')).toBeVisible()
  await ready(page)
  const action=hero(page).locator('a[href="/catalog"]')
  const entry=await page.evaluate(()=>window.__sceneProbe.entry)
  expect(entry.assembly).toBeLessThan(1)
  expect(entry.hit).toBe(true)
  expect(entry.visible).toBe(true)
  expect(entry.focused).toBe(true)
  await expect(canvas(page)).toHaveCount(0)
  expect(await page.evaluate(()=>window.__sceneProbe.contexts[0].root.dataset.heroSceneState)).toBe('disposed')
  await expect.poll(()=>page.evaluate(()=>window.__sceneProbe.contexts[0].gl.isContextLost())).toBe(true)
  await page.goBack();await ready(page);await gpuReady(page);await assembled(page)
  await expect(action).toBeFocused()
  await expect(hero(page)).toHaveAttribute('data-hero-scene-assembly','1.0000')
  const contexts=await page.evaluate(()=>window.__sceneProbe.contexts.map(entry=>({id:entry.id,connected:entry.canvas.isConnected,lost:entry.gl.isContextLost(),assembly:window.__sceneProbe.frames.filter(frame=>frame.context===entry.id).map(frame=>frame.assembly)})))
  expect(contexts.filter(entry=>entry.connected&&!entry.lost)).toHaveLength(1)
  expect(contexts.at(-1).assembly.every(value=>value===1)).toBe(true)
  await page.evaluate(()=>window.__sceneProbe.contexts.at(-1).gl.getExtension('WEBGL_lose_context').loseContext())
  await expect(hero(page)).toHaveAttribute('data-hero-scene-state','fallback')
  await expect(hero(page)).toHaveAttribute('data-hero-scene-reason','context-lost')
  await expect(canvas(page)).toHaveCount(0)
  await expect(hero(page).locator('[data-hero-fallback]')).toHaveCSS('opacity','1')
  await page.locator('.cinema-film-link').first().click();await ready(page)
  await expect(page.locator('.detail-poster')).toBeVisible()
  clean(audit)
})

test('a live reduced-motion preference releases the active GPU and can resume without replaying assembly',async({page})=>{
  const audit=await fixtures(page)
  await open(page);await gpuReady(page)
  await page.emulateMedia({reducedMotion:'reduce'})
  await expect(hero(page)).toHaveAttribute('data-hero-scene-state','reduced')
  await expect(canvas(page)).toHaveCount(0)
  await expect(hero(page).locator('[data-hero-fallback]')).toHaveCSS('opacity','1')
  await accessible(page)
  await expect.poll(()=>page.evaluate(()=>window.__sceneProbe.contexts.every(entry=>entry.gl.isContextLost()))).toBe(true)
  expect(await framesStable(page)).toBe(true)
  await page.emulateMedia({reducedMotion:'no-preference'});await gpuReady(page);await assembled(page)
  await expect(hero(page)).toHaveAttribute('data-hero-scene-assembly','1.0000')
  expect(await page.evaluate(()=>{const probe=window.__sceneProbe,id=probe.contexts.at(-1).id;return probe.frames.filter(frame=>frame.context===id).every(frame=>frame.assembly===1)})).toBe(true)
  await expect(canvas(page)).toHaveCount(1)
  clean(audit)
})

async function legacyBodyProjection(page){
  return page.evaluate(async()=>{
    const T=await import('/assets/hero-scene-vendor.js'),probe=window.__sceneProbe,s=probe.lastSimulation,frame=probe.frames.at(-1)
    const stage=document.querySelector('[data-hero-stage]').getBoundingClientRect(),viewport=probe.lastCanvas.getBoundingClientRect(),mobile=innerWidth<=760
    // The pre-extension composition is the compatibility control: a 40-degree
    // lens over the original body frame, with its existing scroll camera/pose.
    // Project the real sampled sculpture anchors through both compositions.
    const camera=new T.PerspectiveCamera(40,stage.width/stage.height,.1,80)
    camera.position.set(frame.camera.x,frame.camera.y,frame.camera.z)
    camera.lookAt(frame.progress*.45,-frame.progress*.25,0);camera.updateMatrixWorld()
    const model=new T.Group(),viewHeight=2*Math.tan(40*Math.PI/360)*12
    model.scale.setScalar(mobile?.66:1)
    model.position.set(viewHeight*camera.aspect*(mobile?.03:.22),viewHeight*(mobile?.21:.11),0)
    model.rotation.set(.2+frame.progress*.22,-.42+frame.progress*.72,-.1+frame.progress*.1);model.updateMatrixWorld()
    const actualModel=new T.Matrix4().fromArray(s.matrixWorld),actualProjection=new T.Matrix4().fromArray(s.viewProjection),home=s.homeTexture.image.data
    let maxError=0,count=0
    for(let index=0;index<s.coreCount;index+=Math.max(1,Math.floor(s.coreCount/128))){
      const offset=index*4,point=new T.Vector3(home[offset],home[offset+1],home[offset+2])
      const actual=point.clone().applyMatrix4(actualModel).applyMatrix4(actualProjection),expected=point.applyMatrix4(model.matrixWorld).project(camera)
      const ax=viewport.left+(actual.x*.5+.5)*viewport.width,ay=viewport.top+(1-(actual.y*.5+.5))*viewport.height
      const ex=stage.left+(expected.x*.5+.5)*stage.width,ey=stage.top+(1-(expected.y*.5+.5))*stage.height
      maxError=Math.max(maxError,Math.hypot(ax-ex,ay-ey));count++
    }
    const input=(await import('/particle-input.js')).getParticleInput().pointer
    const ray=new T.Vector3((input.x-stage.left)/stage.width*2-1,1-(input.y-stage.top)/stage.height*2,.5).unproject(camera).sub(camera.position).normalize()
    return {count,maxCssError:maxError,rayError:ray.distanceTo(new T.Vector3(...s.ray)),pointerActive:s.pointerActive,
      simulationId:s.id,progress:frame.progress,stage:stage.toJSON(),canvas:viewport.toJSON(),camera:frame.camera}
  })
}
async function captureHeaderBand(page,label,freeze=false){
  await page.evaluate(({label,freeze})=>{window.__sceneProbe.headerRequest={label,freeze}},{label,freeze})
  await expect.poll(()=>page.evaluate(()=>window.__sceneProbe.headerBand?.label)).toBe(label)
  const result=await page.evaluate(()=>window.__sceneProbe.headerBand)
  expect(result.error).toBe(0);expect(result.lit).toBeGreaterThan(10)
  return result
}
async function headerComposite(page,band,testInfo){
  await expect(hero(page)).toHaveAttribute('data-hero-scene-state','paused')
  expect(await framesStable(page)).toBe(true)
  const clip={x:0,y:0,width:band.header.width,height:band.header.height}
  const alphaPath=testInfo.outputPath('header-particles-alpha.png'),opaquePath=testInfo.outputPath('header-particles-opaque.png')
  const alpha=await page.screenshot({path:alphaPath,clip,scale:'css'})
  await page.evaluate(()=>{const header=document.querySelector('.track-header');window.__sceneProbe.savedHeaderBackground=header.style.backgroundColor;header.style.backgroundColor='rgb(9,9,11)'})
  let opaque
  try{opaque=await page.screenshot({path:opaquePath,clip,scale:'css'})}
  finally{await page.evaluate(()=>{document.querySelector('.track-header').style.backgroundColor=window.__sceneProbe.savedHeaderBackground})}
  const proof=await page.evaluate(async({alpha,opaque,masks})=>{
    const decode=async data=>{
      const bitmap=await createImageBitmap(new Blob([Uint8Array.from(atob(data),character=>character.charCodeAt(0))],{type:'image/png'}))
      const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height
      const context=canvas.getContext('2d');context.drawImage(bitmap,0,0);bitmap.close()
      return {data:context.getImageData(0,0,canvas.width,canvas.height).data,width:canvas.width,height:canvas.height}
    }
    const a=await decode(alpha),b=await decode(opaque),raw=window.__sceneProbe.headerRaw
    let compared=0,changed=0,matched=0,rawLit=0,maxDelta=0,opaqueMax=0
    for(let y=1;y<a.height-1;y++)for(let x=1;x<a.width-1;x++){
      if(masks.some(rect=>x>=rect.left-4&&x<=rect.right+4&&y>=rect.top-4&&y<=rect.bottom+4))continue
      const offset=(y*a.width+x)*4,delta=Math.max(...[0,1,2].map(channel=>Math.abs(a.data[offset+channel]-b.data[offset+channel])))
      compared++;maxDelta=Math.max(maxDelta,delta);opaqueMax=Math.max(opaqueMax,b.data[offset],b.data[offset+1],b.data[offset+2])
      if(delta>=2)changed++
      const gx=Math.min(raw.width-1,Math.floor((x+.5)/a.width*raw.width)),gy=Math.min(raw.height-1,Math.floor((1-(y+.5)/a.height)*raw.height))
      let gpuLight=0
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        const px=Math.max(0,Math.min(raw.width-1,gx+dx)),py=Math.max(0,Math.min(raw.height-1,gy+dy)),index=(py*raw.width+px)*4
        gpuLight=Math.max(gpuLight,raw.data[index],raw.data[index+1],raw.data[index+2])
      }
      if(gpuLight>24){rawLit++;if(delta>=2)matched++}
    }
    return {compared,changed,matchedGpuPixels:matched,rawLitOutsideControls:rawLit,maximumDelta:maxDelta,opaqueMaximum:opaqueMax,width:a.width,height:a.height}
  },{alpha:alpha.toString('base64'),opaque:opaque.toString('base64'),masks:band.masks})
  await testInfo.attach('header-alpha',{path:alphaPath,contentType:'image/png'})
  await testInfo.attach('header-opaque-control',{path:opaquePath,contentType:'image/png'})
  expect(proof.compared).toBeGreaterThan(1000)
  expect(proof.opaqueMaximum).toBeLessThanOrEqual(16)
  expect(proof.maximumDelta).toBeGreaterThanOrEqual(2)
  expect(proof.matchedGpuPixels).toBeGreaterThanOrEqual(3)
  return proof
}

for(const [width,height,headerHeight] of [[1440,1000,100],[390,844,82]])test(`real particles composite beneath the plain header while body projection and pointer rays stay unchanged at ${width}px`,async({browser,baseURL},testInfo)=>{
  const context=await browser.newContext({baseURL,viewport:{width,height},deviceScaleFactor:width===390?3:1,reducedMotion:'no-preference',...(width===390?{isMobile:true,hasTouch:true}:{})})
  const page=await context.newPage()
  try{
    const audit=await fixtures(page)
    await open(page);await gpuReady(page);await assembled(page)
    const initial=await legacyBodyProjection(page)
    expect(initial.count).toBeGreaterThan(100);expect(initial.maxCssError).toBeLessThan(.25)
    await scrollProgress(page,.35);await assembled(page)
    const at35=await legacyBodyProjection(page)
    expect(at35.maxCssError).toBeLessThan(.25)
    const band=await captureHeaderBand(page,'scroll-35',true)
    expect(Math.abs(band.header.top)).toBeLessThan(1);expect(band.header.height).toBe(headerHeight)
    expect(Math.abs(band.canvas.top-band.header.top)).toBeLessThan(1)
    expect(Math.abs(band.canvas.height-height)).toBeLessThan(1)
    expect(Number(band.background.match(/[\d.]+/g).at(-1))).toBeCloseTo(.94,3)
    expect(band.radius.every(radius=>parseFloat(radius)===0)).toBe(true)
    expect(band.blur).toBe('none');expect(band.webkitBlur).toBe('none')
    const composite=await headerComposite(page,band,testInfo)
    await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'))})
    await assembled(page)
    await scrollProgress(page,.6);await assembled(page)
    const at60=await legacyBodyProjection(page),band60=await captureHeaderBand(page,'scroll-60')
    expect(at60.maxCssError).toBeLessThan(.25)
    expect(at60.simulationId).toBe(initial.simulationId);expect(band60.simulationId).toBe(initial.simulationId)
    const frame=await page.locator('[data-hero-stage]').boundingBox()
    await page.mouse.move(frame.x+frame.width*.68,frame.y+frame.height*.35);await advance(page,.1)
    const pointed=await legacyBodyProjection(page)
    expect(pointed.pointerActive).toBe(1);expect(pointed.rayError).toBeLessThan(.00001)
    await page.setViewportSize(width===390?{width:430,height:932}:{width:1280,height:900})
    await scrollProgress(page,.35);await assembled(page)
    const resizedFrame=await page.locator('[data-hero-stage]').boundingBox()
    await page.mouse.move(resizedFrame.x+resizedFrame.width*.68,resizedFrame.y+resizedFrame.height*.35);await advance(page,.1)
    const resized=await legacyBodyProjection(page)
    expect(resized.simulationId).toBe(initial.simulationId);expect(resized.pointerActive).toBe(1)
    expect(resized.maxCssError).toBeLessThan(.25);expect(resized.rayError).toBeLessThan(.00001)
    await expect(canvas(page)).toHaveCount(1)
    const proof={width,height,initial,at35,band,composite,at60,band60,pointed,resized}
    const proofPath=testInfo.outputPath('header-particles-proof.json')
    await writeFile(proofPath,JSON.stringify(proof,null,2));await testInfo.attach('header-particles-proof',{path:proofPath,contentType:'application/json'})
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
    expect(await page.evaluate(()=>window.__sceneProbe.errors)).toEqual([]);clean(audit)
  }finally{
    await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));const header=document.querySelector('.track-header');if(header&&window.__sceneProbe?.savedHeaderBackground!==undefined)header.style.backgroundColor=window.__sceneProbe.savedHeaderBackground}).catch(()=>{})
    await context.close()
  }
})
