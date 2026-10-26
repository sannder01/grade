import {test,expect} from '@playwright/test'

test.use({locale:'ru-RU',reducedMotion:'no-preference',launchOptions:{args:['--enable-unsafe-swiftshader','--use-angle=swiftshader']}})
test.skip(({browserName})=>browserName!=='chromium','The real GPU regressions use deterministic Chromium software WebGL')

const hero=page=>page.locator('[data-hero-scene]')
const canvas=page=>page.locator('[data-hero-canvas] .hero-scene-canvas')
const ready=page=>expect(page.locator('main')).not.toHaveAttribute('aria-busy','true')

async function fixtures(page,{language='ru',noWebGL=false,failedResources=false,earlyEntry=false}={}){
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
  await page.addInitScript(({language,noWebGL,earlyEntry})=>{
    localStorage.setItem('grade:language',language)
    const probe=window.__sceneProbe={allocations:[],frames:[],contexts:[],errors:[]}
    const native=HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext=function(type,...args){
      if(!/^webgl2?$|^experimental-webgl$/.test(type))return native.call(this,type,...args)
      const context=noWebGL?null:native.call(this,type,...args)
      probe.allocations.push({type,success:Boolean(context)})
      return context
    }
    document.addEventListener('grade:hero-scene-frame',event=>{
      const {gl,canvas,frame,assembly,progress,camera,dispersion,pointerStrength}=event.detail
      let entry=probe.contexts.find(entry=>entry.canvas===canvas)
      if(!entry){entry={root:event.target,canvas,gl,id:probe.contexts.length+1};probe.contexts.push(entry)}
      let pixels=null
      // The renderer can sleep on the first fully assembled frame. Always
      // sample that milestone even when its number is not a multiple of four.
      if(frame<3||frame%4===0||(assembly===1&&!entry.finalPixels)){
        try{
          const width=Math.min(256,gl.drawingBufferWidth),height=Math.min(256,gl.drawingBufferHeight)
          const mobile=innerWidth<=760
          const x=Math.max(0,Math.min(gl.drawingBufferWidth-width,Math.round(gl.drawingBufferWidth*(mobile?.53:.72)-width/2)))
          const y=Math.max(0,Math.min(gl.drawingBufferHeight-height,Math.round(gl.drawingBufferHeight*.68-height/2)))
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
      probe.frames.push({context:entry.id,frame,assembly,progress,camera,dispersion,pointerStrength,pixels,at:performance.now()})
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
  },{language,noWebGL,earlyEntry})
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
async function idle(page){await expect(hero(page)).toHaveAttribute('data-hero-scene-state','idle',{timeout:20000})}
async function framesStable(page){
  return hero(page).evaluate(async root=>{
    const initial=Number(root.dataset.heroSceneFrames),start=performance.now();let samples=0
    while(performance.now()-start<180){await new Promise(requestAnimationFrame);samples++;if(Number(root.dataset.heroSceneFrames)!==initial)return false}
    return samples>2
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
  await idle(page)
  let frames=await page.evaluate(()=>window.__sceneProbe.frames)
  expect(frames.some(frame=>frame.assembly>.05&&frame.assembly<.95&&frame.pixels)).toBe(true)
  const gathered=frames.filter(frame=>frame.assembly===1&&frame.pixels).at(-1)
  expect(gathered).toBeTruthy()
  expect(gathered.pixels.lit).toBeGreaterThan(12)
  expect(gathered.pixels.bounds[2]-gathered.pixels.bounds[0]).toBeGreaterThan(10)
  expect(new Set(frames.filter(frame=>frame.pixels).map(frame=>frame.pixels.hash)).size).toBeGreaterThan(4)
  const beforePointer=frames.length,box=await page.locator('[data-hero-canvas]').boundingBox()
  await page.mouse.move(box.x+box.width*.68,box.y+box.height*.32)
  await page.mouse.move(box.x+box.width*.73,box.y+box.height*.36,{steps:8})
  await expect.poll(()=>page.evaluate(index=>window.__sceneProbe.frames.slice(index).some(frame=>frame.pointerStrength>.05&&frame.pixels),beforePointer)).toBe(true)
  frames=await page.evaluate(()=>window.__sceneProbe.frames)
  expect(frames.slice(beforePointer).some(frame=>frame.pixels&&frame.pixels.hash!==gathered.pixels.hash)).toBe(true)
  await page.mouse.move(0,0);await idle(page)
  await scrollProgress(page,.68);await idle(page)
  const forward=await page.evaluate(()=>window.__sceneProbe.frames.filter(frame=>frame.pixels).at(-1))
  expect(forward.progress).toBeGreaterThan(.65)
  expect(forward.camera.z).toBeLessThan(gathered.camera.z-1)
  expect(forward.camera.x).toBeGreaterThan(gathered.camera.x+.7)
  expect(forward.dispersion).toBeGreaterThan(.5)
  expect(forward.pixels.hash).not.toBe(gathered.pixels.hash)
  await scrollProgress(page,0);await idle(page)
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
    await open(page);await gpuReady(page);await idle(page)
    await expect(hero(page)).toHaveAttribute('data-hero-scene-mode','mobile')
    expect(Number(await hero(page).getAttribute('data-hero-scene-particles'))).toBeGreaterThanOrEqual(8000)
    expect(Number(await hero(page).getAttribute('data-hero-scene-particles'))).toBeLessThan(20000)
    expect(Number(await hero(page).getAttribute('data-hero-scene-depth'))).toBeGreaterThan(.8)
    expect(await page.evaluate(()=>navigator.maxTouchPoints)).toBeGreaterThan(0)
    expect(await page.evaluate(()=>window.__sceneProbe.frames.some(frame=>frame.pixels?.lit>10))).toBe(true)
    await page.setViewportSize({width:430,height:932});await idle(page)
    const bounds=await canvas(page).evaluate(node=>({width:node.width,height:node.height,css:node.getBoundingClientRect().toJSON()}))
    expect(bounds.width/bounds.css.width).toBeLessThanOrEqual(1.251)
    expect(Math.abs(bounds.width/bounds.height-bounds.css.width/bounds.css.height)).toBeLessThan(.01)
    await expect(canvas(page)).toHaveCount(1)
    const cdp=await context.newCDPSession(page)
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:210,y:560}]})
    for(const y of [520,450,380,300])await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:210,y}]})
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
    await expect.poll(()=>page.evaluate(()=>scrollY)).toBeGreaterThan(50)
    await expect.poll(async()=>Number(await hero(page).getAttribute('data-hero-scene-progress'))).toBeGreaterThan(.02)
    await cdp.detach()
    clean(audit)
  }finally{await context.close()}
})

test('the renderer sleeps when settled and pauses offscreen, hidden and throughout menu, search and dialog transitions',async({page})=>{
  const audit=await fixtures(page)
  await open(page);await gpuReady(page);await idle(page)
  expect(await framesStable(page)).toBe(true)
  await hero(page).evaluate(root=>scrollTo({top:root.getBoundingClientRect().top+scrollY+root.offsetHeight+100,behavior:'instant'}))
  await expect(hero(page)).toHaveAttribute('data-hero-scene-state','paused')
  await expect(hero(page)).toHaveAttribute('data-hero-scene-reason','offscreen')
  expect(await framesStable(page)).toBe(true)
  await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));await idle(page)
  // Headless tabs stay visible even when another page is brought forward.
  // Change the scheduler's visibility input while real browser RAF keeps ticking.
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>'hidden'});document.dispatchEvent(new Event('visibilitychange'))})
  await expect(hero(page)).toHaveAttribute('data-hero-scene-reason','hidden')
  expect(await framesStable(page)).toBe(true)
  await page.evaluate(()=>{delete document.hidden;delete document.visibilityState;document.dispatchEvent(new Event('visibilitychange'))});await idle(page)
  for(const [trigger,panel] of [['.menu-trigger','#section-menu'],['.search-trigger','#search-tray'],['.login-button','#modal']]){
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
      let samples=0,frozen=true
      while(performance.now()-start<180){
        await new Promise(requestAnimationFrame);samples++
        frozen&&=root.dataset.heroSceneFrames===frames&&root.dataset.heroSceneState==='paused'
      }
      return {samples,frozen,stillClosing:panel.matches('dialog')?panel.open:!panel.hidden}
    })
    expect(closing.samples).toBeGreaterThan(2)
    expect(closing.frozen).toBe(true)
    expect(closing.stillClosing).toBe(true)
    await expect(page.locator(panel)).toBeHidden()
    await idle(page)
  }
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
  await page.goBack();await ready(page);await gpuReady(page);await idle(page)
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
  await page.emulateMedia({reducedMotion:'no-preference'});await gpuReady(page);await idle(page)
  await expect(hero(page)).toHaveAttribute('data-hero-scene-assembly','1.0000')
  expect(await page.evaluate(()=>{const probe=window.__sceneProbe,id=probe.contexts.at(-1).id;return probe.frames.filter(frame=>frame.context===id).every(frame=>frame.assembly===1)})).toBe(true)
  await expect(canvas(page)).toHaveCount(1)
  clean(audit)
})
