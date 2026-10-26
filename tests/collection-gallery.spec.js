import {test,expect} from '@playwright/test'

test.use({locale:'ru-RU',reducedMotion:'no-preference',launchOptions:{args:['--enable-unsafe-swiftshader','--use-angle=swiftshader']}})
const gallery=page=>page.locator('[data-collection-gallery]')
const ready=page=>expect(page.locator('main')).not.toHaveAttribute('aria-busy','true')
const slugs=['other-worlds','stays-with-you','drawn-worlds']

async function fixtures(page,{language='ru',failedModule=false,failedImages=false}={}){
  const audit={errors:[],writes:[],unexpected:[]}
  page.on('pageerror',error=>audit.errors.push(error.message))
  await page.route('**/api/**',route=>{
    const request=route.request(),path=new URL(request.url()).pathname
    if(request.method()!=='GET'){
      audit.writes.push(request.method()+' '+path)
      return route.fulfill({status:405,json:{error:'Gallery regressions never write application data'}})
    }
    const english=request.headers()['accept-language']==='en'
    const items=Array.from({length:4},(_,index)=>({id:String(index+1),name:english?`Frame ${index+1}`:`Кадр ${index+1}`,kind:'movie',year:2026-index,poster:`/gallery-fixtures/${index+1}.svg`,votes:0,average:null}))
    if(path==='/api/me')return route.fulfill({json:{user:null}})
    if(path==='/api/catalog')return route.fulfill({json:{items,total:4,page:1,pages:1,externalSearch:false}})
    if(path==='/api/catalog/discover')return route.fulfill({json:{available:false,items:[],page:1,pages:0}})
    audit.unexpected.push(path)
    return route.fulfill({status:404,json:{error:'Unknown gallery fixture route'}})
  })
  await page.route('**/gallery-fixtures/*.svg',route=>failedImages
    ?route.fulfill({status:404,body:'Poster unavailable'})
    :route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450"><rect width="300" height="450" fill="#735c61"/><path d="M0 350 300 80V450H0Z" fill="#b19c83"/></svg>'}))
  if(failedModule)await page.route('**/collection-gallery.js',route=>route.abort())
  await page.addInitScript(language=>{
    localStorage.setItem('grade:language',language)
    const probe=window.__galleryProbe={allocations:[],wheels:[],frames:[]}
    const native=HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext=function(type,...args){
      const result=native.call(this,type,...args)
      if(/^webgl2?$|^experimental-webgl$/.test(type))probe.allocations.push({type,success:Boolean(result)})
      return result
    }
    document.addEventListener('wheel',event=>queueMicrotask(()=>probe.wheels.push({delta:event.deltaY,prevented:event.defaultPrevented})),{capture:true,passive:true})
    document.addEventListener('grade:collection-gallery-frame',event=>{
      const {frame,progress,renderedProgress,index,camera}=event.detail
      probe.frames.push({frame,progress,renderedProgress,index,camera})
      if(probe.frames.length>800)probe.frames.splice(0,200)
    })
  },language)
  return audit
}
async function open(page){
  const response=await page.goto('/')
  expect(response.headers()['content-security-policy']).toContain('img-src')
  await expect(gallery(page)).toBeAttached()
  await ready(page)
}
async function spatial(page){await expect(gallery(page)).toHaveAttribute('data-gallery-ready','true',{timeout:20000})}
async function at(page,progress){
  await spatial(page)
  await gallery(page).evaluate((root,progress)=>{
    const stage=root.querySelector('[data-gallery-stage]'),header=parseFloat(getComputedStyle(stage).top)||0
    scrollTo({top:root.getBoundingClientRect().top+scrollY-header+(root.offsetHeight-stage.offsetHeight)*progress,behavior:'instant'})
  },progress)
  await expect.poll(async()=>Math.abs(Number(await gallery(page).getAttribute('data-gallery-progress'))-progress)).toBeLessThan(.015)
  await expect.poll(async()=>Math.abs(Number(await gallery(page).getAttribute('data-gallery-rendered-progress'))-progress)).toBeLessThan(.015)
  await expect(gallery(page)).toHaveAttribute('data-gallery-state','idle')
}
async function pose(page){return gallery(page).evaluate(root=>{
  const camera=root.querySelector('.collection-gallery-camera'),matrix=new DOMMatrixReadOnly(getComputedStyle(camera).transform)
  return {projection:Math.abs(matrix.m34),camera:[...matrix.toFloat64Array()],
    cards:[...root.querySelectorAll('.collection-card')].map(node=>({rect:node.getBoundingClientRect().toJSON(),transform:getComputedStyle(node).transform})),
    posters:[...root.querySelectorAll('.collection-cover>[data-poster-id]')].map(node=>({rect:node.getBoundingClientRect().toJSON(),light:getComputedStyle(node).filter})),
    imageScale:[...root.querySelectorAll('.collection-cover img')].map(node=>{const matrix=new DOMMatrixReadOnly(getComputedStyle(node).transform);return Math.max(Math.abs(matrix.a-1),Math.abs(matrix.d-1))})}
})}
async function contents(page){
  await expect(gallery(page).locator('.collection-card')).toHaveCount(3)
  await expect(gallery(page).locator('.collection-cover>[data-poster-id]')).toHaveCount(9)
  await expect(gallery(page).locator('canvas')).toHaveCount(0)
  for(const slug of slugs)await expect(gallery(page).locator(`.collection-card[data-collection-slug="${slug}"]`)).toHaveAttribute('href',`/collections/${slug}`)
}
async function stable(page){return gallery(page).evaluate(async root=>{
  const frame=root.dataset.galleryFrames,start=performance.now();let samples=0
  while(performance.now()-start<180){await new Promise(requestAnimationFrame);samples++;if(root.dataset.galleryFrames!==frame)return false}
  return samples>2
})}
async function settled(page){
  await ready(page)
  await expect(page.locator('.collection-motion-layer,.flying-poster')).toHaveCount(0)
  await expect.poll(()=>page.locator('[data-poster-id],[data-collection-title]').evaluateAll(async nodes=>{
    const {Flip}=await import('/assets/motion-vendor.js')
    return nodes.every(node=>!Flip.isFlipping(node))
  })).toBe(true)
}
async function normalGrid(page){
  await contents(page)
  await expect(gallery(page).locator('.collection-gallery-renderer')).toHaveCount(0)
  const layout=await gallery(page).evaluate(root=>{
    const stage=root.querySelector('[data-gallery-stage]')
    return {gap:Math.abs(root.getBoundingClientRect().height-stage.getBoundingClientRect().height),position:getComputedStyle(stage).position,
      transforms:[...root.querySelectorAll('.collection-card')].map(node=>new DOMMatrixReadOnly(getComputedStyle(node).transform).isIdentity)}
  })
  expect(layout.position).not.toBe('sticky')
  expect(layout.gap).toBeLessThan(3)
  expect(layout.transforms.every(Boolean)).toBe(true)
  for(const card of await gallery(page).locator('.collection-card').all()){
    await expect(card).toHaveCSS('opacity','1')
    await expect(card.locator('h3')).toBeVisible()
  }
}
function clean(audit){expect(audit).toEqual({errors:[],writes:[],unexpected:[]})}

for(const [width,language] of [[1440,'ru'],[390,'en']])test(`native camera and nine original covers reverse visibly at ${width}px in ${language}`,async({browser,baseURL})=>{
  const context=await browser.newContext({baseURL,viewport:{width,height:width===390?844:1000},locale:'ru-RU',reducedMotion:'no-preference',...(width===390?{isMobile:true,hasTouch:true}:{})})
  try{
    const page=await context.newPage(),audit=await fixtures(page,{language})
    await open(page);await at(page,.12);await contents(page)
    const nodes=await gallery(page).locator('.collection-cover>[data-poster-id]').elementHandles()
    const early=await pose(page)
    expect(early.projection).toBeGreaterThan(.000001)
    await at(page,.5)
    const middle=await pose(page)
    expect(middle.camera).not.toEqual(early.camera)
    expect(Math.abs(middle.posters[0].rect.x-early.posters[0].rect.x)).toBeGreaterThan(20)
    expect(middle.posters.some((poster,index)=>poster.light!==early.posters[index].light)).toBe(true)
    await expect(gallery(page)).toHaveAttribute('data-gallery-active-slug','stays-with-you')
    await expect(gallery(page).locator('[data-gallery-enter]')).toHaveAttribute('href','/collections/stays-with-you')
    await expect(gallery(page).locator('[data-gallery-title]')).toHaveText(language==='ru'?'Остаётся с тобой':'Stays with you')
    await at(page,.88)
    await expect(gallery(page)).toHaveAttribute('data-gallery-active-slug','drawn-worlds')
    await at(page,.12)
    const back=await pose(page)
    for(let index=0;index<early.posters.length;index++){
      expect(Math.abs(back.posters[index].rect.x-early.posters[index].rect.x)).toBeLessThan(2)
      expect(Math.abs(back.posters[index].rect.width-early.posters[index].rect.width)).toBeLessThan(2)
    }
    expect(await page.evaluate(nodes=>nodes.every(node=>node.isConnected&&Boolean(node.closest('[data-collection-gallery]'))),nodes)).toBe(true)
    expect(Math.max(...back.imageScale)).toBeLessThan(.001)
    const before=await page.evaluate(()=>scrollY)
    await page.mouse.move(8,450);await page.mouse.wheel(0,120)
    await expect.poll(()=>page.evaluate(before=>Math.abs(scrollY-before-120),before)).toBeLessThan(3)
    expect(await page.evaluate(()=>window.__galleryProbe.wheels.length>0&&window.__galleryProbe.wheels.every(event=>!event.prevented))).toBe(true)
    expect(await page.evaluate(()=>window.__galleryProbe.allocations.filter(entry=>entry.success).length)).toBeLessThanOrEqual(1)
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
    if(width===390){
      expect(await page.evaluate(()=>navigator.maxTouchPoints)).toBeGreaterThan(0)
      const cdp=await context.newCDPSession(page),start=await page.evaluate(()=>scrollY)
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:190,y:570}]})
      for(const y of [520,450,380,310])await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:190,y}]})
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
      await expect.poll(()=>page.evaluate(start=>scrollY-start,start)).toBeGreaterThan(50)
      await cdp.detach()
    }
    clean(audit)
  }finally{await context.close()}
})

test('HUD entry transfers the original posters, images and title and Back restores the same camera context',async({page})=>{
  const audit=await fixtures(page)
  await open(page);await at(page,.61)
  const old=await gallery(page).elementHandle(),card=gallery(page).locator('.collection-card[data-collection-slug="stays-with-you"]')
  const posters=await card.locator('.collection-cover>[data-poster-id]').elementHandles(),images=await card.locator('img').elementHandles(),title=await card.locator('[data-collection-title]').elementHandle()
  await expect(card.locator('img')).toHaveCount(3)
  const before=await page.evaluate(()=>scrollY),entry=gallery(page).locator('[data-gallery-enter]')
  await entry.focus();await page.keyboard.press('Enter');await settled(page)
  await expect(page).toHaveURL(/\/collections\/stays-with-you$/)
  expect(await page.evaluate(nodes=>nodes.every(node=>node.isConnected&&Boolean(node.closest('.collection-page .poster-grid'))),posters)).toBe(true)
  expect(await page.evaluate(nodes=>nodes.every(node=>node.isConnected&&Boolean(node.closest('.collection-page .poster-grid'))),images)).toBe(true)
  expect(await title.evaluate(node=>Boolean(node.closest('.collection-page h1')))).toBe(true)
  expect(await old.evaluate(node=>node.dataset.galleryState)).toBe('disposed')
  const stopped=await old.evaluate(async node=>{const frames=node.dataset.galleryFrames;for(let i=0;i<4;i++)await new Promise(requestAnimationFrame);return frames===node.dataset.galleryFrames})
  expect(stopped).toBe(true)
  await page.goBack();await settled(page);await spatial(page)
  await expect(entry).toBeFocused()
  expect(Math.abs(await page.evaluate(()=>scrollY)-before)).toBeLessThan(3)
  expect(Math.abs(Number(await gallery(page).getAttribute('data-gallery-rendered-progress'))-.61)).toBeLessThan(.015)
  expect(await page.evaluate(nodes=>nodes.every(node=>node.isConnected&&node.closest('.collection-card')?.dataset.collectionSlug==='stays-with-you'),posters)).toBe(true)
  expect(await page.evaluate(nodes=>nodes.every(node=>node.isConnected&&node.closest('.collection-card')?.dataset.collectionSlug==='stays-with-you'),images)).toBe(true)
  expect(await title.evaluate(node=>Boolean(node.closest('.collection-card h3')))).toBe(true)
  await contents(page);clean(audit)
})

test('keyboard and rapid navigation retain usable controls, visible focus and genuine collection targets',async({page})=>{
  const audit=await fixtures(page)
  await page.setViewportSize({width:390,height:844})
  await open(page);await at(page,.5)
  for(const selector of ['#gallery-prev','#gallery-next','#gallery-enter']){
    const box=await gallery(page).locator(selector).boundingBox()
    expect(box.width).toBeGreaterThanOrEqual(44);expect(box.height).toBeGreaterThanOrEqual(44)
  }
  const cards=gallery(page).locator('.collection-card')
  await cards.nth(0).focus();await page.keyboard.press('ArrowRight')
  await expect(cards.nth(1)).toBeFocused()
  await expect(gallery(page)).toHaveAttribute('data-gallery-active-index','1')
  await page.keyboard.press('ArrowRight');await expect(cards.nth(2)).toBeFocused()
  await page.keyboard.press('ArrowLeft');await expect(cards.nth(1)).toBeFocused()
  const previous=page.locator('#gallery-prev')
  await previous.focus()
  await gallery(page).evaluate(root=>{
    root.querySelector('#gallery-next').click();root.querySelector('#gallery-next').click()
    root.querySelector('#gallery-prev').click();root.querySelector('#gallery-next').click()
  })
  await expect(gallery(page)).toHaveAttribute('data-gallery-active-index','2')
  await expect(gallery(page)).toHaveAttribute('data-gallery-state','idle')
  await expect(previous).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(gallery(page)).toHaveAttribute('data-gallery-active-index','1')
  await expect(gallery(page)).toHaveAttribute('data-gallery-state','idle')
  await expect(previous).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.locator('#gallery-next')).toBeFocused()
  expect(await page.evaluate(()=>!document.activeElement.closest('[hidden],[inert]'))).toBe(true)
  await expect(page).toHaveURL(/\/$/)
  clean(audit)
})

test('a keyboard collection entry interrupted by Back retains scroll, selection and originals without stale layouts',async({page})=>{
  const audit=await fixtures(page)
  await open(page);await at(page,.5)
  const card=gallery(page).locator('.collection-card[data-collection-slug="stays-with-you"]')
  await card.focus();await at(page,.62)
  const before=await page.evaluate(()=>scrollY),posters=await card.locator('.collection-cover>[data-poster-id]').elementHandles()
  await page.keyboard.press('Enter');await ready(page)
  await expect(page.locator('.collection-page')).toBeVisible()
  await page.goBack();await settled(page);await spatial(page)
  await expect(card).toBeFocused()
  expect(Math.abs(await page.evaluate(()=>scrollY)-before)).toBeLessThan(3)
  expect(Math.abs(Number(await gallery(page).getAttribute('data-gallery-rendered-progress'))-.62)).toBeLessThan(.015)
  expect(await page.evaluate(nodes=>nodes.every(node=>node.isConnected&&node.closest('.collection-card')?.dataset.collectionSlug==='stays-with-you'),posters)).toBe(true)
  await expect(gallery(page).locator('.collection-gallery-renderer')).toHaveCount(1)
  await expect(page.locator('main')).toHaveJSProperty('inert',false)
  clean(audit)
})

test('offscreen, hidden and opening or closing overlays freeze the camera and resume the current native scroll',async({page})=>{
  const audit=await fixtures(page)
  await open(page);await at(page,.3)
  expect(await stable(page)).toBe(true)
  await page.locator('.menu-trigger').click()
  await expect(gallery(page)).toHaveAttribute('data-gallery-state','paused')
  await expect(gallery(page)).toHaveAttribute('data-gallery-reason','scene')
  const frozen=(await pose(page)).camera
  await gallery(page).evaluate(root=>{const stage=root.querySelector('[data-gallery-stage]'),header=parseFloat(getComputedStyle(stage).top)||0;scrollTo({top:root.getBoundingClientRect().top+scrollY-header+(root.offsetHeight-stage.offsetHeight)*.7,behavior:'instant'})})
  expect((await pose(page)).camera).toEqual(frozen)
  expect(await stable(page)).toBe(true)
  await expect.poll(()=>page.locator('#section-menu').evaluate(async node=>{const {gsap}=await import('/assets/motion-vendor.js');return gsap.getTweensOf(node).some(tween=>tween.isActive())})).toBe(false)
  const closing=await page.locator('#section-menu [data-close-scene]').evaluate(async button=>{
    const root=document.querySelector('[data-collection-gallery]'),frames=root.dataset.galleryFrames,start=performance.now()
    button.click();let unchanged=true,samples=0
    while(performance.now()-start<180){await new Promise(requestAnimationFrame);samples++;unchanged&&=root.dataset.galleryFrames===frames}
    return {unchanged,samples,open:!document.querySelector('#section-menu').hidden}
  })
  expect(closing).toMatchObject({unchanged:true,open:true});expect(closing.samples).toBeGreaterThan(2)
  await expect(page.locator('#section-menu')).toBeHidden()
  await expect.poll(async()=>Math.abs(Number(await gallery(page).getAttribute('data-gallery-rendered-progress'))-.7)).toBeLessThan(.015)
  await expect(gallery(page)).toHaveAttribute('data-gallery-state','idle')
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>'hidden'});document.dispatchEvent(new Event('visibilitychange'))})
  await expect(gallery(page)).toHaveAttribute('data-gallery-reason','hidden')
  expect(await stable(page)).toBe(true)
  await page.evaluate(()=>{delete document.hidden;delete document.visibilityState;document.dispatchEvent(new Event('visibilitychange'))})
  await at(page,.4)
  for(const [trigger,panel] of [['.search-trigger','#search-tray'],['.login-button','#modal']]){
    await page.locator(trigger).click()
    await expect(gallery(page)).toHaveAttribute('data-gallery-reason','scene')
    expect(await stable(page)).toBe(true)
    await page.keyboard.press('Escape');await expect(page.locator(panel)).toBeHidden()
    await expect(gallery(page)).toHaveAttribute('data-gallery-state','idle')
  }
  await gallery(page).evaluate(root=>scrollTo({top:root.getBoundingClientRect().top+scrollY+root.offsetHeight+150,behavior:'instant'}))
  await expect(gallery(page)).toHaveAttribute('data-gallery-reason','offscreen')
  expect(await stable(page)).toBe(true)
  await at(page,.4);clean(audit)
})

test('initial and live reduced motion and real viewport zoom retain the same posters in a finished normal grid',async({page,context})=>{
  const audit=await fixtures(page)
  await page.emulateMedia({reducedMotion:'reduce'});await open(page)
  await expect(gallery(page)).toHaveAttribute('data-gallery-state','reduced')
  await normalGrid(page)
  await page.emulateMedia({reducedMotion:'no-preference'});await page.reload();await at(page,.5)
  const originals=await gallery(page).locator('.collection-cover>[data-poster-id]').elementHandles()
  await page.emulateMedia({reducedMotion:'reduce'})
  await expect(gallery(page)).toHaveAttribute('data-gallery-state','reduced');await normalGrid(page)
  expect(await page.evaluate(nodes=>nodes.every(node=>node.isConnected&&Boolean(node.closest('.collection-grid'))),originals)).toBe(true)
  await page.emulateMedia({reducedMotion:'no-preference'});await page.reload();await at(page,.5)
  const cdp=await context.newCDPSession(page)
  try{
    await cdp.send('Emulation.setPageScaleFactor',{pageScaleFactor:1.25})
    await expect.poll(()=>page.evaluate(()=>visualViewport.scale)).toBeGreaterThan(1.2)
    await expect(gallery(page)).toHaveAttribute('data-gallery-state','fallback')
    await expect(gallery(page)).toHaveAttribute('data-gallery-reason','zoom')
    await normalGrid(page)
  }finally{await cdp.send('Emulation.setPageScaleFactor',{pageScaleFactor:1});await cdp.detach()}
  clean(audit)
})

test('missing gallery code and images leave three readable collections with functional routes',async({page})=>{
  const audit=await fixtures(page,{failedModule:true,failedImages:true})
  await open(page)
  await expect(gallery(page)).toHaveAttribute('data-gallery-state','fallback')
  await normalGrid(page)
  const card=gallery(page).locator('.collection-card').nth(2)
  await card.scrollIntoViewIfNeeded()
  await expect(gallery(page).locator('img')).toHaveCount(0)
  await card.focus();await page.keyboard.press('Enter');await settled(page)
  await expect(page).toHaveURL(/\/collections\/drawn-worlds$/)
  await expect(page.locator('.collection-page .poster-placeholder')).toHaveCount(4)
  await page.goBack();await settled(page)
  await expect(card).toBeFocused();await normalGrid(page)
  clean(audit)
})

test('measured projection correction retains real geometry, clickable posters and shared Back',async({page})=>{
  const audit=await fixtures(page)
  await page.setViewportSize({width:390,height:844})
  await open(page);await at(page,.5)
  await expect(gallery(page)).toHaveAttribute('data-gallery-projection','native')
  const baseline=(await pose(page)).posters.map(p=>p.rect)
  // Simulate a browser that drops its inherited camera transform. The runtime
  // must detect a real geometry mismatch, rather than sniffing the user agent.
  await page.route('**/collection-gallery.css',async route=>{
    const response=await route.fetch()
    await route.fulfill({response,body:(await response.text())+'\n.collection-gallery:not([data-gallery-projection]) .collection-gallery-camera{transform:none!important}'})
  })
  await page.reload();await at(page,.5)
  await expect(gallery(page)).toHaveAttribute('data-gallery-projection','planes')
  const corrected=(await pose(page)).posters.map(p=>p.rect)
  for(let i=0;i<baseline.length;i++)for(const key of ['x','y','width','height'])expect(Math.abs(corrected[i][key]-baseline[i][key])).toBeLessThan(3)
  const card=gallery(page).locator('.collection-card[data-collection-slug="stays-with-you"]')
  const posters=await card.locator('.collection-cover>[data-poster-id]').elementHandles()
  const poster=card.locator('.poster-placeholder').nth(1)
  await poster.click();await settled(page)
  await expect(page).toHaveURL(/\/collections\/stays-with-you$/)
  expect(await page.evaluate(nodes=>nodes.every(node=>node.isConnected&&Boolean(node.closest('.collection-page .poster-grid'))),posters)).toBe(true)
  await page.goBack();await settled(page);await spatial(page)
  await expect(gallery(page)).toHaveAttribute('data-gallery-projection','planes')
  expect(await page.evaluate(nodes=>nodes.every(node=>node.isConnected&&Boolean(node.closest('.collection-cover'))),posters)).toBe(true)
  const restored=(await pose(page)).posters.map(p=>p.rect)
  for(let i=0;i<corrected.length;i++)for(const key of ['x','y','width','height'])expect(Math.abs(restored[i][key]-corrected[i][key])).toBeLessThan(3)
  await page.emulateMedia({reducedMotion:'reduce'});await normalGrid(page)
  await expect(gallery(page)).not.toHaveAttribute('data-gallery-projection')
  clean(audit)
})
