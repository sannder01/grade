import { test, expect } from '@playwright/test'

test.use({locale:'ru-RU',reducedMotion:'no-preference'})
const scene=page=>page.locator('[data-collections-scene]')
const ready=page=>expect(page.locator('main')).not.toHaveAttribute('aria-busy','true')

async function fixtures(page,language='ru') {
  const writes=[],unexpected=[]
  await page.route('**/api/**',route=>{
    const request=route.request(),path=new URL(request.url()).pathname
    if(request.method()!=='GET') {
      writes.push(request.method()+' '+path)
      return route.fulfill({status:405,json:{error:'Collection scene tests never write application data'}})
    }
    const english=request.headers()['accept-language']==='en'
    const items=Array.from({length:4},(_,index)=>({id:String(index+1),name:english ? `Frame ${index+1}` : `Кадр ${index+1}`,kind:'movie',year:2026-index,poster:`/collections-scroll-fixtures/poster-${index+1}.svg`,votes:0,average:null}))
    if(path==='/api/me') return route.fulfill({json:{user:null}})
    if(path==='/api/catalog') return route.fulfill({json:{items,total:4,page:1,pages:1,externalSearch:false}})
    if(path==='/api/catalog/discover') return route.fulfill({json:{available:false,items:[],page:1,pages:0}})
    unexpected.push(path)
    return route.fulfill({status:404,json:{error:'Unknown collections scene fixture route'}})
  })
  await page.route('**/collections-scroll-fixtures/*.svg',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450"><rect width="300" height="450" fill="#716f74"/><path d="M0 330 300 100V450H0Z" fill="#49474e"/></svg>'}))
  await page.addInitScript(language=>{
    try { localStorage.setItem('grade:language',language) } catch {}
    window.__collectionsProbe={wheels:[]}
    document.addEventListener('wheel',event=>{
      queueMicrotask(()=>window.__collectionsProbe.wheels.push({delta:event.deltaY,prevented:event.defaultPrevented}))
    },{passive:true,capture:true})
  },language)
  return {writes,unexpected}
}

async function scrollAt(page,progress) {
  await page.evaluate(progress=>{
    const node=document.querySelector('[data-collections-scene]')
    const top=node.getBoundingClientRect().top+scrollY
    scrollTo({top:Math.max(0,top-innerHeight*.9+innerHeight*.57*progress),behavior:'instant'})
  },progress)
  await expect.poll(async()=>Math.abs(Number(await scene(page).getAttribute('data-collections-progress'))-progress)).toBeLessThan(.015)
}

async function snapshot(page) {
  return scene(page).evaluate(root=>{
    const matrix=node=>new DOMMatrixReadOnly(getComputedStyle(node).transform)
    const covers=[...root.querySelectorAll('.collection-cover')]
    const lines=[...root.querySelectorAll('.collections-line')]
    const images=[...root.querySelectorAll('.collection-cover img')]
    return {
      progress:Number(root.dataset.collectionsProgress),state:root.dataset.collectionsMotion,
      covers:covers.map(node=>matrix(node).f),lines:lines.map(node=>matrix(node).f),
      coverScale:Math.max(0,...covers.map(node=>Math.max(Math.abs(matrix(node).a-1),Math.abs(matrix(node).d-1)))),
      imageDeviation:Math.max(0,...images.map(node=>{
        const value=matrix(node),scale=getComputedStyle(node).scale
        return Math.max(Math.abs(Math.hypot(value.m11,value.m12,value.m13)-1),Math.abs(Math.hypot(value.m21,value.m22,value.m23)-1),Math.abs(value.e),Math.abs(value.f),...(scale==='none' ? [0] : scale.split(' ').map(part=>Math.abs(Number(part)-1))))
      })),
    }
  })
}

const magnitude=values=>values.reduce((sum,value)=>sum+Math.abs(value),0)/Math.max(1,values.length)
async function ownTriggers(page) {
  return page.evaluate(async()=>{
    const {ScrollTrigger}=await import('/assets/motion-vendor.js')
    return ScrollTrigger.getAll().filter(trigger=>trigger.trigger?.matches('[data-collections-scene]')).length
  })
}
async function settledFlip(page) {
  await ready(page)
  await expect(page.locator('.collection-motion-layer,.flying-poster')).toHaveCount(0)
  await expect.poll(()=>page.locator('[data-poster-id],[data-collection-title]').evaluateAll(async nodes=>{
    const {Flip}=await import('/assets/motion-vendor.js')
    return nodes.every(node=>!Flip.isFlipping(node))
  })).toBe(true)
}

for(const language of ['ru','en']) for(const width of [1440,390]) {
  test(`collection scroll is native and reversible without scaling images in ${language} at ${width}px`,async({page})=>{
    const errors=[];page.on('pageerror',error=>errors.push(error.message))
    const audit=await fixtures(page,language)
    await page.setViewportSize({width,height:width===390 ? 844 : 1000})
    await page.goto('/')
    await ready(page)
    await expect(scene(page)).toHaveAttribute('data-collections-motion','active')
    await expect(page.locator('html')).toHaveAttribute('lang',language)
    await expect(scene(page).locator('[data-collections-heading]')).toHaveText(language==='ru' ? 'Собрано по настроению' : 'Collected by feeling')
    await expect(scene(page).locator('.collection-card')).toHaveCount(3)
    await expect(scene(page).locator('.collection-cover img')).toHaveCount(12)
    await expect(scene(page).locator('.collections-line')).not.toHaveCount(0)
    await expect(scene(page).locator('.collections-line-mask .collections-line-mask')).toHaveCount(0)
    await expect(scene(page).locator('[data-reveal=pending]')).toHaveCount(0)
    expect(await ownTriggers(page)).toBe(1)
    await scrollAt(page,.15)
    const early=await snapshot(page)
    await scrollAt(page,.75)
    const late=await snapshot(page)
    await scrollAt(page,.3)
    const reverse=await snapshot(page)
    expect(magnitude(early.lines)).toBeGreaterThan(magnitude(late.lines)+1)
    expect(magnitude(reverse.lines)).toBeGreaterThan(magnitude(late.lines)+1)
    expect(magnitude(early.covers)).toBeGreaterThan(magnitude(late.covers)+.5)
    expect(magnitude(reverse.covers)).toBeGreaterThan(magnitude(late.covers)+.5)
    for(const state of [early,late,reverse]) {
      expect(Math.max(...state.covers.map(Math.abs))).toBeLessThanOrEqual(width===390 ? 12.1 : 24.1)
      expect(state.imageDeviation).toBeLessThan(.001)
      expect(state.coverScale).toBeLessThan(.001)
    }
    await scrollAt(page,1)
    const final=await snapshot(page)
    expect(Math.max(...final.covers.map(Math.abs),...final.lines.map(Math.abs))).toBeLessThan(.1)
    for(const card of await scene(page).locator('.collection-card').all()) {
      await expect(card.locator('h3')).toBeVisible()
      await expect(card.locator('p')).toBeVisible()
      await expect(card).toHaveCSS('opacity','1')
      await expect(card).toHaveAttribute('href',/\/collections\/[a-z-]+/)
    }
    await expect(scene(page).locator('.section-heading>.text-link')).toBeVisible()
    await scrollAt(page,.35)
    const before=await page.evaluate(()=>scrollY)
    await page.mouse.move(8,500)
    await page.mouse.wheel(0,120)
    await expect.poll(()=>page.evaluate(expected=>Math.abs(scrollY-expected),before+120)).toBeLessThan(3)
    await expect.poll(async()=>Number(await scene(page).getAttribute('data-collections-progress'))).toBeGreaterThan(.4)
    await page.mouse.wheel(0,-120)
    await expect.poll(()=>page.evaluate(expected=>Math.abs(scrollY-expected),before)).toBeLessThan(3)
    expect(await page.evaluate(()=>window.__collectionsProbe.wheels.every(event=>!event.prevented))).toBe(true)
    expect(await page.evaluate(()=>window.__collectionsProbe.wheels.length)).toBeGreaterThanOrEqual(2)
    await expect(page.locator('.pin-spacer,.collection-motion-layer,.flying-poster')).toHaveCount(0)
    expect(await scene(page).evaluate(node=>!['fixed','sticky'].includes(getComputedStyle(node).position))).toBe(true)
    expect(await page.evaluate(()=>getComputedStyle(document.documentElement).overflowY!=='hidden' && getComputedStyle(document.body).transform==='none' && document.documentElement.scrollWidth<=innerWidth)).toBe(true)
    expect(errors).toEqual([])
    expect(audit).toEqual({writes:[],unexpected:[]})
  })
}

test('resize, keyboard focus and initial or live reduced motion leave a readable static scene',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message))
  const audit=await fixtures(page)
  await page.goto('/')
  await ready(page)
  for(const width of [1440,390,1440]) {
    await page.setViewportSize({width,height:width===390 ? 844 : 1000})
    await scrollAt(page,.4)
    const state=await snapshot(page)
    expect(Math.max(...state.covers.map(Math.abs))).toBeLessThanOrEqual(width===390 ? 12.1 : 24.1)
    expect(state.imageDeviation).toBeLessThan(.001)
    await expect(scene(page).locator('.collections-line-mask .collections-line-mask')).toHaveCount(0)
    expect(await ownTriggers(page)).toBe(1)
  }
  await scene(page).locator('.section-heading>.text-link').focus()
  await page.keyboard.press('Tab')
  await expect(scene(page).locator('.collection-card').first()).toBeFocused()
  await expect(scene(page)).toHaveAttribute('data-collections-focused','true')
  await expect(scene(page)).toHaveAttribute('data-collections-motion','static')
  for(const progress of [.2,.7]) {
    await scrollAt(page,progress)
    const state=await snapshot(page)
    expect(Math.max(...state.covers.map(Math.abs),...state.lines.map(Math.abs))).toBeLessThan(.1)
    expect(state.imageDeviation).toBeLessThan(.001)
  }
  await page.emulateMedia({reducedMotion:'reduce'})
  await expect(scene(page)).toHaveAttribute('data-collections-motion','reduced')
  await scrollAt(page,.4)
  let state=await snapshot(page)
  expect(Math.max(...state.covers.map(Math.abs),...state.lines.map(Math.abs))).toBeLessThan(.1)
  await expect(scene(page).locator('.collections-line,.collections-line-mask')).toHaveCount(0)
  await page.reload()
  await ready(page)
  await expect(scene(page)).toHaveAttribute('data-collections-motion','reduced')
  await scrollAt(page,.55)
  state=await snapshot(page)
  expect(Math.max(...state.covers.map(Math.abs))).toBeLessThan(.1)
  expect(state.imageDeviation).toBeLessThan(.001)
  await expect(scene(page).locator('.collections-line,.collections-line-mask')).toHaveCount(0)
  await expect(page.locator('.pin-spacer,.collection-motion-layer,.flying-poster')).toHaveCount(0)
  expect(errors).toEqual([])
  expect(audit).toEqual({writes:[],unexpected:[]})
})

test('opening a collection mid-scroll preserves original nodes and Back restores progress, focus and cleanup',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message))
  const audit=await fixtures(page)
  const visiblePoint=async poster=>{
    const box=await poster.boundingBox(),header=await page.locator('.track-header').boundingBox(),viewport=page.viewportSize()
    expect(box).not.toBeNull()
    const top=Math.max(box.y,header.y+header.height+2),bottom=Math.min(box.y+box.height,viewport.height-3)
    const left=Math.max(box.x,3),right=Math.min(box.x+box.width,viewport.width-3)
    expect(bottom-top,'the poster has a real visible vertical intersection').toBeGreaterThan(2)
    expect(right-left,'the poster has a real visible horizontal intersection').toBeGreaterThan(2)
    return {x:(left+right)/2,y:(top+bottom)/2}
  }
  await page.goto('/')
  await ready(page)
  await scrollAt(page,.5)
  const outgoing=await scene(page).elementHandle()
  const card=scene(page).locator('.collection-card').first()
  const href=await card.getAttribute('href'),name=await card.locator('h3').innerText()
  const posters=await card.locator('.collection-cover [data-poster-id]').elementHandles()
  const images=await card.locator('.collection-cover img').elementHandles()
  const title=await card.locator('[data-collection-title]').elementHandle()
  const before=await page.evaluate(()=>scrollY),beforeState=await snapshot(page)
  const point=await visiblePoint(card.locator('.poster-placeholder').first())
  await page.mouse.click(point.x,point.y)
  await expect(page).toHaveURL(new RegExp(`${href}$`))
  await settledFlip(page)
  await expect(page.locator('h1')).toHaveText(name)
  expect(await page.evaluate(nodes=>nodes.every(node=>node.isConnected && Boolean(node.closest('.collection-page .poster-grid'))),posters)).toBe(true)
  expect(await page.evaluate(nodes=>nodes.every(node=>node.isConnected && Boolean(node.closest('.collection-page .poster-grid'))),images)).toBe(true)
  expect(await title.evaluate(node=>Boolean(node.closest('.collection-page h1')))).toBe(true)
  expect(await outgoing.evaluate(node=>node.dataset.collectionsMotion)).toBe('disposed')
  expect(await ownTriggers(page)).toBe(0)
  await page.goBack()
  await settledFlip(page)
  await expect(scene(page).locator(`.collection-card[href="${href}"]`)).toBeFocused()
  expect(Math.abs(await page.evaluate(()=>scrollY)-before)).toBeLessThan(3)
  const restored=await snapshot(page)
  expect(Math.abs(restored.progress-beforeState.progress)).toBeLessThan(.015)
  expect(await page.evaluate(nodes=>nodes.every(node=>node.isConnected && Boolean(node.closest('.collection-cover'))),posters)).toBe(true)
  expect(await page.evaluate(nodes=>nodes.every(node=>node.isConnected && Boolean(node.closest('.collection-cover'))),images)).toBe(true)
  expect(await title.evaluate(node=>Boolean(node.closest('.collection-card h3')))).toBe(true)
  expect(restored.imageDeviation).toBeLessThan(.001)
  expect(await ownTriggers(page)).toBe(1)
  const second=await visiblePoint(scene(page).locator('.collection-card').first().locator('.poster-placeholder').first())
  await page.mouse.click(second.x,second.y)
  await ready(page)
  await expect(page.locator('.collection-page')).toBeVisible()
  await page.goBack()
  await settledFlip(page)
  expect(Math.abs(await page.evaluate(()=>scrollY)-before)).toBeLessThan(3)
  expect(Math.abs((await snapshot(page)).progress-beforeState.progress)).toBeLessThan(.015)
  expect(await ownTriggers(page)).toBe(1)
  await expect(page.locator('.pin-spacer,.collection-motion-layer,.flying-poster')).toHaveCount(0)
  await expect(page.locator('main')).toHaveJSProperty('inert',false)
  expect(errors).toEqual([])
  expect(audit).toEqual({writes:[],unexpected:[]})
})

test('menu closing and document visibility pause the scroll scene until native progress can resume',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message))
  const audit=await fixtures(page)
  await page.setViewportSize({width:1440,height:1000})
  await page.goto('/')
  await ready(page)
  await page.evaluate(()=>document.fonts.ready)
  const nativeScroll=async progress=>page.evaluate(progress=>{
    const node=document.querySelector('[data-collections-scene]')
    const target=node.getBoundingClientRect().top+scrollY-innerHeight*.9+innerHeight*.57*progress
    scrollTo({top:target,behavior:'instant'})
    return {target,actual:scrollY}
  },progress)
  const recordFrozen=()=>page.evaluate(async()=>{
    const root=document.querySelector('[data-collections-scene]'),frames=[],start=performance.now()
    while(performance.now()-start<180) {
      frames.push({values:[...root.querySelectorAll('.collections-line,.collection-cover')].map(node=>new DOMMatrixReadOnly(getComputedStyle(node).transform).f),panelHidden:document.querySelector('#section-menu').hidden})
      await new Promise(requestAnimationFrame)
    }
    return frames
  })
  const positions=()=>scene(page).evaluate(root=>[...root.querySelectorAll('.collections-line,.collection-cover')].map(node=>new DOMMatrixReadOnly(getComputedStyle(node).transform).f))
  const expectFrozen=(frames,before)=>{
    expect(frames.length).toBeGreaterThan(2)
    for(const frame of frames) {
      expect(frame.values).toHaveLength(before.length)
      for(let index=0;index<before.length;index++) expect(Math.abs(frame.values[index]-before[index])).toBeLessThan(.02)
    }
  }
  await scrollAt(page,.35)
  await page.locator('.menu-trigger').click()
  const panel=page.locator('#section-menu')
  await expect(scene(page)).toHaveAttribute('data-collections-motion','paused')
  await expect(scene(page)).toHaveAttribute('data-collections-motion-reason','scene')
  // Start closing from a fully open mask, leaving a real closing interval.
  await expect.poll(()=>panel.evaluate(node=>{
    const values=getComputedStyle(node).clipPath.match(/-?[\d.]+/g) || []
    return values.length>=1 && values.every(value=>Math.abs(Number(value))<.001)
  })).toBe(true)
  const paused=await positions()
  const menuFrames=recordFrozen()
  const scrolled=await nativeScroll(.65)
  expect(Math.abs(scrolled.actual-scrolled.target)).toBeLessThan(2)
  expectFrozen(await menuFrames,paused)
  await page.keyboard.press('Escape')
  await expect(panel).toHaveAttribute('aria-hidden','true')
  await expect(scene(page)).toHaveAttribute('data-collections-motion','paused')
  const closingFrames=await recordFrozen()
  expect(closingFrames.every(frame=>!frame.panelHidden)).toBe(true)
  expectFrozen(closingFrames,paused)
  await expect(panel).toBeHidden()
  await expect(scene(page)).toHaveAttribute('data-collections-motion','active')
  await expect.poll(async()=>Math.abs(Number(await scene(page).getAttribute('data-collections-progress'))-.65)).toBeLessThan(.015)
  const resumed=await snapshot(page)
  expect(magnitude(resumed.covers)).toBeLessThan(magnitude(paused.slice(-3))-.5)

  // Headless tabs stay visible. Supply only the standard visibility input;
  // real RAF continues, allowing stale scroll-driven updates to be detected.
  await page.evaluate(()=>{
    Object.defineProperty(document,'hidden',{configurable:true,get:()=>true})
    Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'})
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(scene(page)).toHaveAttribute('data-collections-motion','paused')
  await expect(scene(page)).toHaveAttribute('data-collections-motion-reason','hidden')
  const hiddenPositions=await positions(),hiddenFrames=recordFrozen()
  await nativeScroll(.2)
  expectFrozen(await hiddenFrames,hiddenPositions)
  await page.evaluate(()=>{
    delete document.hidden;delete document.visibilityState
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(scene(page)).toHaveAttribute('data-collections-motion','active')
  await expect.poll(async()=>Math.abs(Number(await scene(page).getAttribute('data-collections-progress'))-.2)).toBeLessThan(.015)
  const visible=await snapshot(page)
  expect(magnitude(visible.covers)).toBeGreaterThan(magnitude(resumed.covers)+.5)
  expect(visible.imageDeviation).toBeLessThan(.001)
  expect(await ownTriggers(page)).toBe(1)
  await expect(page.locator('.pin-spacer,.collection-motion-layer,.flying-poster')).toHaveCount(0)
  expect(errors).toEqual([])
  expect(audit).toEqual({writes:[],unexpected:[]})
})
