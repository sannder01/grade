import {test,expect} from '@playwright/test'
import {writeFile} from 'node:fs/promises'

test.use({locale:'ru-RU',reducedMotion:'no-preference',launchOptions:{args:['--enable-unsafe-swiftshader','--use-angle=swiftshader']}})
test.skip(({browserName})=>browserName!=='chromium','The framebuffer regressions use deterministic Chromium software WebGL')

const artifacts='[data-title-backdrop]'
const layer='.title-dissolve-layer'
const ready=page=>expect(page.locator('main')).not.toHaveAttribute('aria-busy','true')
const titleName=(id,language='ru')=>language==='en'?`Frame ${id}`:`Кадр ${id}`
const catalogue='/catalog?view=grade&sort=new'

async function fixtures(page,{language='ru',noWebGL=false,failedModule=false,failedImages=false,cors=false,earlyBack=false,pixels=false}={}){
  const audit={errors:[],writes:[],unexpected:[]},gates=new Map()
  const controls={hold(id){let release;const promise=new Promise(resolve=>{release=resolve});gates.set(String(id),{promise,release})},release(id){gates.get(String(id))?.release();gates.delete(String(id))}}
  page.on('pageerror',error=>audit.errors.push(error.message))
  const imageURL=(id,kind)=>`${cors?'https://image.tmdb.org/grade-title-test':'/dissolve-fixtures'}/${kind}-${id}.svg`
  await page.route('**/api/**',async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname
    if(request.method()!=='GET'){
      audit.writes.push(request.method()+' '+path)
      return route.fulfill({status:405,json:{error:'Title dissolve fixtures never write application data'}})
    }
    const english=request.headers()['accept-language']==='en',lang=english?'en':'ru'
    const items=Array.from({length:24},(_,index)=>({id:String(index+1),name:titleName(index+1,lang),kind:'movie',year:2026-index,poster:imageURL(index+1,'poster'),votes:0,average:null}))
    if(path==='/api/me')return route.fulfill({json:{user:null}})
    if(path==='/api/catalog')return route.fulfill({json:{items,total:24,page:1,pages:1,externalSearch:false}})
    if(path==='/api/catalog/discover')return route.fulfill({json:{available:false,items:[],page:1,pages:0}})
    if(/^\/api\/titles\/\d+\/discussion$/.test(path))return route.fulfill({json:{items:[],total:0,page:1,pages:0}})
    if(/^\/api\/titles\/\d+\/(trailer|external-ratings)$/.test(path))return route.fulfill({json:{status:'not_found'}})
    if(/^\/api\/titles\/\d+$/.test(path)){
      const id=path.split('/').at(-1)
      if(gates.has(id))await gates.get(id).promise
      return route.fulfill({json:{...items[Number(id)-1],poster:imageURL(id,'backdrop'),backdrop:imageURL(id,'backdrop'),original_name:`Frame ${id}`,runtime:'100 мин',genres:['Драма'],description:'История из личной коллекции',watched:false,planned:false,my_score:null}})
    }
    audit.unexpected.push(path)
    return route.fulfill({status:404,json:{error:'Unknown dissolve fixture route'}})
  })
  const imageRoute=async route=>{
    if(failedImages)return route.fulfill({status:404,body:'Poster unavailable'})
    const backdrop=new URL(route.request().url()).pathname.includes('/backdrop-')
    // Distinct, real SVG image textures make a spatial dissolve distinguishable
    // from a uniform opacity fade. Dimensions also exercise cover cropping.
    const body=`<svg xmlns="http://www.w3.org/2000/svg" width="${backdrop?1200:300}" height="${backdrop?675:450}"><rect width="100%" height="100%" fill="${backdrop?'#235ccb':'#c43f36'}"/><path d="M0 0H18V1000H0Z" fill="#f3eadb"/></svg>`
    return route.fulfill({contentType:'image/svg+xml',headers:{'cache-control':'no-store',...(cors?{'access-control-allow-origin':'https://unrelated.invalid','vary':'Origin'}:{})},body})
  }
  await page.route('**/dissolve-fixtures/**',imageRoute)
  if(cors)await page.route('https://image.tmdb.org/grade-title-test/**',imageRoute)
  if(failedModule)await page.route('**/title-dissolve.js*',route=>route.abort())
  await page.addInitScript(({language,noWebGL,earlyBack,pixels})=>{
    localStorage.setItem('grade:language',language)
    const probe=window.__dissolveProbe={contexts:[],frames:[],states:[],forbidden:[],violations:[],commits:[],earlyBack,earlyEntry:null,liveReduce:false,reducedRequested:null}
    document.addEventListener('securitypolicyviolation',event=>probe.violations.push({directive:event.effectiveDirective,uri:event.blockedURI}))
    const native=HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext=function(type,...args){
      if(!/^webgl2?$|^experimental-webgl$/.test(type))return native.call(this,type,...args)
      const gl=noWebGL?null:native.call(this,type,...args)
      let entry=probe.contexts.find(entry=>entry.canvas===this)
      if(!entry){entry={canvas:this,gl,attempts:0,bins:new Set()};probe.contexts.push(entry)}
      entry.attempts++;if(gl)entry.gl=gl
      return gl
    }
    const observe=()=>{
      new MutationObserver(records=>{
        for(const record of records)for(const node of record.addedNodes){
          if(!(node instanceof Element))continue
          if(node.matches('.collection-motion-layer,.flying-poster')||node.querySelector('.collection-motion-layer,.flying-poster'))probe.forbidden.push(node.className)
        }
        const heading=document.querySelector('[data-title-heading]')
        if(heading&&probe.commits.at(-1)!==heading.textContent)probe.commits.push(heading.textContent)
        const root=document.querySelector('.title-dissolve-layer')
        if(root&&probe.states.at(-1)!==root.dataset.titleDissolve)probe.states.push(root.dataset.titleDissolve)
      }).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['data-title-dissolve']})
    }
    if(document.body)observe();else document.addEventListener('DOMContentLoaded',observe,{once:true})
    document.addEventListener('grade:title-dissolve-frame',event=>{
      const {gl,canvas,progress,direction,phase}=event.detail
      let entry=probe.contexts.find(entry=>entry.canvas===canvas)
      if(!entry){entry={canvas,gl,attempts:1,bins:new Set()};probe.contexts.push(entry)}
      const root=canvas.closest('.title-dissolve-layer'),state=phase||root?.dataset.titleDissolve||''
      const sample={context:probe.contexts.indexOf(entry),progress,direction,phase:state,wall:performance.now(),width:canvas.width,height:canvas.height,rect:canvas.getBoundingClientRect().toJSON(),pointerEvents:root&&getComputedStyle(root).pointerEvents,hidden:root?.getAttribute('aria-hidden'),scales:[]}
      for(const img of document.querySelectorAll('.poster-placeholder img,[data-title-backdrop]')){
        const css=getComputedStyle(img),matrix=new DOMMatrixReadOnly(css.transform),scale=css.scale==='none'?[1]:css.scale.split(' ').map(Number)
        sample.scales.push(Math.max(Math.abs(Math.hypot(matrix.a,matrix.b)-1),Math.abs(Math.hypot(matrix.c,matrix.d)-1),...scale.map(value=>Math.abs(value-1))))
      }
      // Queue real WebGL2 pixel transfers without waiting for the GPU during
      // the 680 ms animation. Drain the bounded buffers only on its final draw,
      // before the production module releases the context. A synchronous
      // readback on each update would itself skip the useful middle frames.
      const bin=progress<=.001?'initial':progress>=.9999?'final':progress>.08&&progress<.92?'middle:'+Math.floor(progress*8):''
      if(pixels&&direction==='in'&&bin&&!entry.bins.has(bin)){
        entry.bins.add(bin)
        const width=gl.drawingBufferWidth,height=gl.drawingBufferHeight
        const previous=gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING),buffer=gl.createBuffer()
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER,buffer);gl.bufferData(gl.PIXEL_PACK_BUFFER,width*height*4,gl.STREAM_READ)
        gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,0)
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER,previous)
        entry.transferBytes=(entry.transferBytes||0)+width*height*4
        ;(entry.transfers||=[]).push({buffer,width,height,sample})
      }
      if(pixels&&progress>=.9999&&entry.transfers?.length){
        const previous=gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING)
        for(const transfer of entry.transfers){
          const {buffer,width,height,sample:captured}=transfer,pixels=new Uint8Array(width*height*4),grid=[]
          gl.bindBuffer(gl.PIXEL_PACK_BUFFER,buffer);gl.getBufferSubData(gl.PIXEL_PACK_BUFFER,0,pixels)
          for(let y=0;y<36;y++)for(let x=0;x<64;x++){
            const offset=(Math.min(height-1,Math.floor((y+.5)*height/36))*width+Math.min(width-1,Math.floor((x+.5)*width/64)))*4
            grid.push(...pixels.subarray(offset,offset+4))
          }
          captured.pixels=grid;captured.glError=gl.getError();gl.deleteBuffer(buffer)
        }
        entry.transfers=[];gl.bindBuffer(gl.PIXEL_PACK_BUFFER,previous)
      }
      probe.frames.push(sample)
      if(probe.earlyBack&&!probe.earlyEntry&&direction==='in'){
        probe.earlyEntry={progress,phase:state,path:location.pathname}
        queueMicrotask(()=>history.back())
      }
      if(probe.liveReduce&&!probe.reducedRequested&&progress>0&&progress<1&&state==='revealing'){
        probe.reducedRequested={progress,phase:state}
        window.__reduceOnDissolve?.()
      }
    })
  },{language,noWebGL,earlyBack,pixels})
  return {audit,controls}
}

async function open(page,path=catalogue){
  const response=await page.goto(path)
  expect(response.headers()['content-security-policy']).toMatch(/img-src[^;]*https:\/\/image\.tmdb\.org/)
  await ready(page)
  await expect(page.locator('.title-card')).toHaveCount(24)
}
async function select(page,id='18'){
  const link=page.locator(`.poster-link[href="/title/${id}"]`)
  await link.scrollIntoViewIfNeeded()
  await link.evaluate(node=>node.scrollIntoView({block:'center',behavior:'instant'}));await link.focus()
  await expect.poll(()=>link.locator('img').evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true)
  return {link,scroll:await page.evaluate(()=>scrollY),href:`/title/${id}`}
}
async function film(page,id='18',language='ru'){
  await expect(page).toHaveURL(new RegExp(`/title/${id}$`));await ready(page)
  await expect(page.locator('.title-info h1[data-title-heading]')).toHaveText(titleName(id,language))
  await expect(page.locator('.detail-poster')).toBeVisible()
}
async function released(page){
  await expect(page.locator(layer)).toHaveCount(0)
  await expect.poll(()=>page.evaluate(()=>window.__dissolveProbe.contexts.every(entry=>!entry.gl||entry.gl.isContextLost()))).toBe(true)
  await expect(page.locator('main')).toHaveJSProperty('inert',false)
  await expect.poll(()=>page.locator('main').evaluate(main=>Math.abs(Number(getComputedStyle(main).opacity)-1))).toBeLessThan(.001)
}
async function restored(page,origin,path=catalogue){
  await expect(page).toHaveURL(path);await ready(page);await released(page)
  await expect(page.locator(`.poster-link[href="${origin.href}"]`)).toBeFocused()
  expect(Math.abs(await page.evaluate(()=>scrollY)-origin.scroll)).toBeLessThan(3)
}
function clean(audit){expect(audit).toEqual({errors:[],writes:[],unexpected:[]})}
async function noFlyingOrZoom(page){
  const proof=await page.evaluate(()=>({forbidden:window.__dissolveProbe.forbidden,scales:window.__dissolveProbe.frames.flatMap(frame=>frame.scales)}))
  expect(proof.forbidden).toEqual([])
  expect(proof.scales.every(value=>value<.001)).toBe(true)
}
async function pixelProof(page){
  return page.evaluate(()=>{
    const frames=window.__dissolveProbe.frames.filter(frame=>frame.direction==='in'&&frame.pixels)
    const first=frames.find(frame=>frame.progress<=.001),last=frames.findLast(frame=>frame.progress>=.999)
    if(!first||!last)return {endpoints:false,frames:frames.map(({phase,progress})=>({phase,progress}))}
    const colors=pixels=>{
      let red=0,blue=0,opaque=0
      for(let i=0;i<pixels.length;i+=4){const [r,g,b,a]=pixels.slice(i,i+4);if(a>200){opaque++;if(r>70&&r>b*1.8&&r>g*1.5)red++;if(b>40&&b>r*1.8&&b>g*1.3)blue++}}
      return {red,blue,opaque}
    }
    const middle=frames.filter(frame=>frame.progress>.08&&frame.progress<.92).map(frame=>{
      const weights=[]
      for(let i=0;i<first.pixels.length;i+=4){
        let size=0,dot=0
        for(let c=0;c<4;c++){const delta=last.pixels[i+c]-first.pixels[i+c];size+=delta*delta;dot+=(frame.pixels[i+c]-first.pixels[i+c])*delta}
        if(size>40*40)weights.push(Math.max(0,Math.min(1,dot/size)))
      }
      const mean=weights.reduce((sum,value)=>sum+value,0)/Math.max(1,weights.length)
      return {progress:frame.progress,pixels:weights.length,variance:weights.reduce((sum,value)=>sum+(value-mean)**2,0)/Math.max(1,weights.length),source:weights.filter(value=>value<.15).length/Math.max(1,weights.length),target:weights.filter(value=>value>.85).length/Math.max(1,weights.length)}
    })
    return {endpoints:true,first:colors(first.pixels),last:colors(last.pixels),middle,glErrors:frames.map(frame=>frame.glError),readbackBytes:window.__dissolveProbe.contexts.reduce((sum,entry)=>sum+(entry.transferBytes||0),0),frames:window.__dissolveProbe.frames.filter(frame=>frame.direction==='in').map(({phase,progress,wall})=>({phase,progress,wall}))}
  })
}

test('real title textures dissolve spatially on the GPU without flying, image zoom or a blocking overlay',async({page},testInfo)=>{
  await page.setViewportSize({width:1440,height:1000})
  const {audit}=await fixtures(page,{pixels:true})
  await open(page);const origin=await select(page)
  expect(origin.scroll).toBeGreaterThan(0)
  await page.keyboard.press('Enter');await film(page);await released(page)
  const pixels=await pixelProof(page)
  const proofPath=testInfo.outputPath('real-noise-pixels.json')
  await writeFile(proofPath,JSON.stringify(pixels,null,2))
  await testInfo.attach('real-noise-pixels',{path:proofPath,contentType:'application/json'})
  expect(pixels.endpoints,JSON.stringify(pixels)).toBe(true)
  expect(pixels.first.red,JSON.stringify(pixels)).toBeGreaterThan(8)
  expect(pixels.last.blue,JSON.stringify(pixels)).toBeGreaterThan(8)
  expect(pixels.middle.some(frame=>frame.pixels>50&&frame.variance>.045&&frame.source>.1&&frame.target>.1),JSON.stringify(pixels)).toBe(true)
  expect(pixels.glErrors.every(error=>error===0)).toBe(true)
  expect(pixels.readbackBytes).toBeLessThanOrEqual(60000000)
  const overlay=await page.evaluate(()=>window.__dissolveProbe.frames.map(({pointerEvents,hidden})=>({pointerEvents,hidden})))
  expect(overlay.length).toBeGreaterThan(2)
  expect(overlay.every(frame=>frame.pointerEvents==='none'&&frame.hidden==='true')).toBe(true)
  await expect(page.locator(artifacts)).toBeVisible()
  await expect.poll(()=>page.locator(artifacts).evaluate(img=>img.complete&&img.naturalWidth===1200&&getComputedStyle(img).objectFit==='cover')).toBe(true)
  await page.locator('[data-action=rate][data-score="1"]').click();await expect(page.locator('#modal')).toHaveJSProperty('open',true)
  await page.keyboard.press('Escape');await expect(page.locator('#modal')).toHaveJSProperty('open',false)
  await page.goBack();await restored(page,origin)
  await noFlyingOrZoom(page);clean(audit)
})

test('a collection film entry and its reverse retain the filtered collection, native scroll and logical focus',async({page})=>{
  const {audit}=await fixtures(page),path='/collections/other-worlds?kind=movie&sort=new'
  await open(page,path);const origin=await select(page,'20')
  await page.keyboard.press('Enter');await film(page,'20');await released(page)
  await page.locator('.back-link').click();await restored(page,origin,path)
  await expect(page.locator('#collection-sort')).toHaveValue('new')
  await expect(page.locator('.category-pills a.active')).toHaveAttribute('data-filter-key','kind:movie')
  expect(await page.evaluate(()=>window.__dissolveProbe.frames.some(frame=>frame.direction==='back'))).toBe(true)
  await page.keyboard.press('Tab');await expect(page.locator('.card-title[href="/title/20"]')).toBeFocused()
  await noFlyingOrZoom(page);clean(audit)
})

test('Back on the first real GPU frame and late competing title responses leave only the latest route and no GPU lease',async({page})=>{
  const {audit,controls}=await fixtures(page,{earlyBack:true})
  await open(page);const origin=await select(page)
  await page.keyboard.press('Enter')
  await expect.poll(()=>page.evaluate(()=>window.__dissolveProbe.earlyEntry)).not.toBeNull()
  await restored(page,origin)
  expect((await page.evaluate(()=>window.__dissolveProbe.earlyEntry)).progress).toBeLessThan(1)
  await page.evaluate(()=>{window.__dissolveProbe.earlyBack=false;window.__dissolveProbe.commits=[]})
  controls.hold('18')
  await page.locator('.poster-link[href="/title/18"]').evaluate(node=>node.click())
  await expect(page).toHaveURL(/\/title\/18$/)
  await page.locator('.poster-link[href="/title/19"]').evaluate(node=>{node.click();node.click()})
  await film(page,'19');await released(page)
  const late=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/titles/18')
  controls.release('18');await late
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
  await expect(page).toHaveURL(/\/title\/19$/);await expect(page.locator('[data-title-heading]')).toHaveText(titleName('19'))
  expect(await page.evaluate(()=>window.__dissolveProbe.commits)).not.toContain(titleName('18'))
  const contexts=await page.evaluate(()=>window.__dissolveProbe.contexts.filter(entry=>entry.gl).map(entry=>({lost:entry.gl.isContextLost(),attached:entry.canvas.isConnected})))
  expect(contexts.length).toBeGreaterThan(0);expect(contexts.every(context=>context.lost&&!context.attached)).toBe(true)
  await noFlyingOrZoom(page);clean(audit)
})

test('a genuine image CORS rejection and missing images preserve real DOM alternatives and usable film routes',async({browser,baseURL})=>{
  // Each independent failure gets a fresh context and performs entry, actions
  // and reverse navigation. Keep the individual readiness assertions strict.
  test.setTimeout(90000)
  for(const failure of ['cors','missing']){
    const context=await browser.newContext({baseURL,viewport:{width:1440,height:1000},reducedMotion:'no-preference'})
    try{
      const page=await context.newPage(),{audit}=await fixtures(page,{cors:failure==='cors',failedImages:failure==='missing'}),failed=[]
      page.on('requestfailed',request=>{if(request.url().startsWith('https://image.tmdb.org/grade-title-test/'))failed.push({url:request.url(),error:request.failure()?.errorText})})
      await open(page)
      const link=page.locator('.poster-link[href="/title/18"]')
      await link.scrollIntoViewIfNeeded();await link.focus()
      const origin={href:'/title/18',scroll:await page.evaluate(()=>scrollY)}
      if(failure==='cors')await expect.poll(()=>link.locator('img').evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true)
      await page.keyboard.press('Enter');await film(page);await released(page)
      if(failure==='cors'){
        await expect.poll(()=>failed.length).toBeGreaterThan(0)
        await expect.poll(()=>page.locator('.detail-poster img').evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true)
        expect(await page.evaluate(()=>window.__dissolveProbe.violations.filter(event=>event.uri.includes('/grade-title-test/')))).toEqual([])
      }else await expect(page.locator('.detail-poster .poster-placeholder')).toContainText(titleName('18'))
      await page.locator('.title-plan').click();await expect(page.locator('#modal')).toHaveJSProperty('open',true)
      await page.keyboard.press('Escape');await expect(page.locator('#modal')).toHaveJSProperty('open',false)
      await page.goBack();await restored(page,origin)
      await noFlyingOrZoom(page);clean(audit)
    }finally{await context.close()}
  }
})

test('unavailable WebGL or optional transition code leaves a complete accessible film and browser Back',async({browser,baseURL})=>{
  test.setTimeout(90000)
  for(const failure of ['webgl','module']){
    const context=await browser.newContext({baseURL,viewport:{width:1440,height:1000},reducedMotion:'no-preference'})
    try{
      const page=await context.newPage(),{audit}=await fixtures(page,{noWebGL:failure==='webgl',failedModule:failure==='module'})
      await open(page);const origin=await select(page)
      await page.keyboard.press('Enter');await film(page);await released(page)
      await expect(page.locator('[data-title-heading]')).toHaveCSS('opacity','1')
      await expect(page.locator('.title-plan')).toBeEnabled()
      expect(await page.evaluate(()=>window.__dissolveProbe.frames)).toEqual([])
      if(failure==='webgl')expect(await page.evaluate(()=>window.__dissolveProbe.contexts.reduce((sum,entry)=>sum+entry.attempts,0))).toBeGreaterThan(0)
      await page.goBack();await restored(page,origin)
      await noFlyingOrZoom(page);clean(audit)
    }finally{await context.close()}
  }
})

test('initial and live reduced motion expose the finished composition and release a running dissolve without losing Back',async({page})=>{
  const {audit}=await fixtures(page)
  await page.emulateMedia({reducedMotion:'reduce'})
  await open(page);let origin=await select(page)
  await page.keyboard.press('Enter');await film(page);await released(page)
  expect(await page.evaluate(()=>window.__dissolveProbe.contexts)).toEqual([])
  await page.goBack();await restored(page,origin)
  await page.emulateMedia({reducedMotion:'no-preference'})
  await page.exposeFunction('__reduceOnDissolve',()=>page.emulateMedia({reducedMotion:'reduce'}))
  origin=await select(page,'19')
  await page.evaluate(()=>{window.__dissolveProbe.liveReduce=true})
  await page.keyboard.press('Enter');await film(page,'19')
  await expect.poll(()=>page.evaluate(()=>window.__dissolveProbe.reducedRequested)).not.toBeNull()
  const interrupted=await page.evaluate(()=>window.__dissolveProbe.reducedRequested)
  expect(interrupted.progress).toBeGreaterThan(0);expect(interrupted.progress).toBeLessThan(1)
  await released(page);await expect(page.locator('[data-title-heading]')).toHaveCSS('opacity','1')
  await page.locator('.title-plan').focus();await expect(page.locator('.title-plan')).toBeFocused()
  await page.goBack();await restored(page,origin)
  await noFlyingOrZoom(page);clean(audit)
})

test('a touch phone uses a real dissolve at its current size and keeps native scrolling, taps and reverse navigation',async({browser,baseURL},testInfo)=>{
  const context=await browser.newContext({baseURL,viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true,reducedMotion:'no-preference'})
  let page
  try{
    page=await context.newPage()
    const {audit}=await fixtures(page,{language:'en'})
    await page.addInitScript(()=>{
      const probe=window.__nativeTouchProbe={touchEnd:0,scrollEnd:0,lastScroll:0,lastTouchActivity:0,scrollEndSupported:'onscrollend' in document||'onscrollend' in window,events:[]}
      const record=event=>{
        const type=event.type
        const time=performance.now()
        if(type.startsWith('touch'))probe.lastTouchActivity=time
        if(type==='touchend')probe.touchEnd=time
        if(type==='scroll')probe.lastScroll=time
        if(type==='scrollend')probe.scrollEnd=time
        probe.events.push({type,time,scroll:scrollY,href:event.target.closest?.('a[href]')?.getAttribute('href')||'',trusted:event.isTrusted})
      }
      for(const type of ['pointerdown','pointerup','pointercancel','touchstart','touchmove','touchend','touchcancel','click','scroll','scrollend'])document.addEventListener(type,record,{capture:true,passive:true})
      window.addEventListener('scrollend',record,{passive:true})
    })
    await open(page);const client=await context.newCDPSession(page)
    await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:180,y:690}]})
    for(const y of [620,530,440,350])await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:180,y}]})
    // Stop the finger before lifting it, as a completed drag rather than a
    // fling. A tap during a native fling correctly stops it without a click.
    await page.evaluate(async()=>{
      const start=performance.now();let samples=0
      while(performance.now()-start<180||samples<3){await new Promise(requestAnimationFrame);samples++}
      window.__nativeTouchProbe.fingerHold={duration:performance.now()-start,sampleCount:samples,scroll:scrollY}
    })
    await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:180,y:350}]})
    await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
    await expect.poll(()=>page.evaluate(()=>scrollY)).toBeGreaterThan(80)
    // A fling may consume the next tap even after a programmatic scroll jump.
    // CDP touch can omit scrollend, so also require a real, bounded interval of
    // presented frames with no further touch/scroll activity or position change.
    const settled=await page.evaluate(async()=>{
      const probe=window.__nativeTouchProbe,start=performance.now()
      let stableSince=start,previous=scrollY,samples=0
      while(performance.now()-start<10000){
        await new Promise(requestAnimationFrame)
        const now=performance.now(),current=scrollY
        if(Math.abs(current-previous)>.1||probe.lastScroll>stableSince||probe.lastTouchActivity>stableSince){stableSince=now;samples=0}
        else samples++
        previous=current
        const completed=probe.touchEnd
        if(completed>0&&now-stableSince>=180&&samples>=3){
          probe.stable={method:probe.scrollEnd>=completed?'scrollend+stable':'completed-touch+raf-stable',duration:now-stableSince,sampleCount:samples,elapsed:now-start,scroll:current}
          return probe.stable
        }
      }
      throw new Error('Native touch did not settle: '+JSON.stringify(probe))
    })
    expect(settled.duration).toBeGreaterThanOrEqual(180)
    expect(settled.sampleCount).toBeGreaterThanOrEqual(3)
    const origin=await select(page,'18')
    // The newly visible row has a delayed entrance. Geometry alone reports it
    // stable while it is still fully transparent, before that tween starts.
    const painted=origin.link.locator('..')
    await expect(painted).toHaveCSS('opacity','1')
    await expect.poll(()=>painted.evaluate(node=>new DOMMatrixReadOnly(getComputedStyle(node).transform).isIdentity)).toBe(true)
    await origin.link.tap();await film(page,'18','en');await released(page)
    expect(await page.evaluate(()=>window.__nativeTouchProbe.events.some(event=>event.type==='click'&&event.href==='/title/18'&&event.trusted))).toBe(true)
    expect(await page.evaluate(()=>window.__dissolveProbe.frames.some(frame=>frame.direction==='in'&&frame.progress>0&&frame.progress<1))).toBe(true)
    await expect(page.locator(artifacts)).toBeVisible()
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
    await page.setViewportSize({width:430,height:844})
    await page.locator('.back-link').tap();await expect(page).toHaveURL(catalogue);await ready(page);await released(page)
    await expect(page.locator('.poster-link[href="/title/18"]')).toBeFocused()
    const reverse=await page.evaluate(()=>window.__dissolveProbe.frames.filter(frame=>frame.direction==='back'))
    expect(reverse.length).toBeGreaterThan(0)
    expect(reverse.every(frame=>Math.abs(frame.rect.width-430)<2&&frame.width>0&&frame.height>0)).toBe(true)
    const before=await page.evaluate(()=>scrollY)
    await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:210,y:650}]})
    for(const y of [590,510,430,350])await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:210,y}]})
    await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
    await expect.poll(()=>page.evaluate(()=>scrollY)).toBeGreaterThan(before+40)
    await client.detach();await noFlyingOrZoom(page);clean(audit)
  }finally{
    if(page&&!page.isClosed()){
      const path=testInfo.outputPath('native-touch-events.json')
      const evidence=await page.evaluate(()=>window.__nativeTouchProbe).catch(error=>({error:error.message}))
      await writeFile(path,JSON.stringify(evidence,null,2))
      await testInfo.attach('native-touch-events',{path,contentType:'application/json'})
    }
    await context.close()
  }
})
