import { test, expect } from '@playwright/test'

test.use({locale:'ru-RU',reducedMotion:'no-preference',launchOptions:{args:['--enable-unsafe-swiftshader','--use-angle=swiftshader']}})
test.skip(({browserName})=>browserName!=='chromium','The pixel regression uses Chromium with deterministic software WebGL')

const root=page=>page.locator('.hero-editorial')
const media=page=>page.locator('.hero-poster [data-hero-media]').first()
const canvas=page=>page.locator('.hero-flow-canvas')
const texture='<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><defs><pattern id="p" width="24" height="24" patternUnits="userSpaceOnUse"><rect width="24" height="24" fill="#234d75"/><rect width="12" height="12" fill="#e39549"/><rect x="12" y="12" width="12" height="12" fill="#c0c4ad"/></pattern></defs><rect width="640" height="360" fill="url(#p)"/><path d="M0 0H140V360H0Z" fill="#7b3146"/><path d="M510 0H640V360H510Z" fill="#275d3c"/><path d="m0 310 640-180v22L0 332Z" fill="#ece4d4"/></svg>'

async function fixtures(page,{disabledWebGL=false,failedImage=false,corsImage=false}={}) {
  const writes=[],unexpected=[]
  await page.route('**/api/**',route=>{
    const request=route.request(),path=new URL(request.url()).pathname
    if(request.method()!=='GET') {
      writes.push(request.method()+' '+path)
      return route.fulfill({status:405,json:{error:'Flow tests never write application data'}})
    }
    const items=Array.from({length:4},(_,index)=>({id:String(index+1),name:`Кадр ${index+1}`,kind:'movie',year:2026-index,poster:index===0 && corsImage ? 'https://flow-cors.invalid/poster-1.svg' : `/flow-fixtures/poster-${index+1}.svg`,votes:0,average:null}))
    if(path==='/api/me') return route.fulfill({json:{user:null}})
    if(path==='/api/catalog') return route.fulfill({json:{items,total:4,page:1,pages:1,externalSearch:false}})
    if(path==='/api/catalog/discover') return route.fulfill({json:{available:false,items:[],page:1,pages:0}})
    if(/^\/api\/titles\/\d+\/discussion$/.test(path)) return route.fulfill({json:{items:[],total:0,page:1,pages:0}})
    if(/^\/api\/titles\/\d+\/(trailer|external-ratings)$/.test(path)) return route.fulfill({json:{status:'not_found'}})
    if(/^\/api\/titles\/\d+$/.test(path)) {
      const item=items.find(item=>item.id===path.split('/').at(-1)) || items[0]
      return route.fulfill({json:{...item,original_name:item.name,runtime:'100 мин',genres:['Драма'],description:'История из тестовой коллекции',watched:false,planned:false,my_score:null}})
    }
    unexpected.push(path)
    return route.fulfill({status:404,json:{error:'Unknown flow fixture route'}})
  })
  await page.route('**/flow-fixtures/*.svg',route=>failedImage && new URL(route.request().url()).pathname.endsWith('poster-1.svg')
    ? route.fulfill({status:404,body:'Image unavailable'})
    : route.fulfill({contentType:'image/svg+xml',body:texture}))
  // Playwright adds a matching ACAO header to fulfilled cross-origin requests
  // unless one is supplied. An explicit different origin makes Chromium reject
  // the anonymous texture load while its ordinary no-cors <img> still displays.
  if(corsImage) await page.route('https://flow-cors.invalid/**',route=>route.fulfill({contentType:'image/svg+xml',headers:{'access-control-allow-origin':'https://different-origin.invalid','cache-control':'no-store'},body:texture}))
  await page.addInitScript(({disabledWebGL})=>{
    try { localStorage.setItem('grade:language','ru') } catch {}
    const probe=window.__flowProbe={allocations:[],frames:[],errors:[],sequence:0}
    const contexts=new WeakMap(),expected=new WeakMap()
    const native=HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext=function(type,...args) {
      const webgl=['webgl','webgl2','experimental-webgl'].includes(type)
      if(webgl) probe.allocations.push(type)
      const result=disabledWebGL && webgl ? null : native.call(this,type,...args)
      if(webgl && result) contexts.set(this,result)
      return result
    }
    document.addEventListener('grade:hero-flow-frame',event=>{
      const target=event.detail?.canvas || document.querySelector('.hero-flow-canvas')
      const gl=event.detail?.gl || contexts.get(target)
      if(!target || !gl) { probe.errors.push('A frame event must expose its real WebGL context');return }
      try {
        const width=Math.min(96,target.width),height=Math.min(96,target.height)
        const left=Math.floor((target.width-width)/2),bottom=Math.floor((target.height-height)/2)
        const pixels=new Uint8Array(width*height*4)
        gl.readPixels(left,bottom,width,height,gl.RGBA,gl.UNSIGNED_BYTE,pixels)
        const image=(target.parentElement || event.target).querySelector('img')
        let reference=expected.get(target)
        if(image?.complete && image.naturalWidth && (!reference || reference.width!==target.width || reference.height!==target.height)) {
          const flat=document.createElement('canvas');flat.width=target.width;flat.height=target.height
          const context=flat.getContext('2d'),scale=Math.max(flat.width/image.naturalWidth,flat.height/image.naturalHeight)
          context.drawImage(image,(flat.width-image.naturalWidth*scale)/2,(flat.height-image.naturalHeight*scale)/2,image.naturalWidth*scale,image.naturalHeight*scale)
          reference={width:flat.width,height:flat.height,data:context.getImageData(left,flat.height-bottom-height,width,height).data}
          expected.set(target,reference)
        }
        let hash=2166136261,alpha=0,difference=0,samples=0
        for(let y=0;y<height;y+=3) for(let x=0;x<width;x+=3) {
          const position=(y*width+x)*4,referencePosition=((height-1-y)*width+x)*4
          for(let channel=0;channel<3;channel++) {
            hash=Math.imul(hash^pixels[position+channel],16777619)>>>0
            if(reference) difference+=Math.abs(pixels[position+channel]-reference.data[referencePosition+channel])
          }
          alpha+=pixels[position+3];samples++
        }
        const style=image ? getComputedStyle(image) : null
        const matrix=new DOMMatrixReadOnly(style?.transform || 'none')
        probe.frames.push({sequence:++probe.sequence,at:performance.now(),frame:event.detail?.frame,hash,alpha:alpha/samples,meanError:reference ? difference/(samples*3) : null,width:target.width,height:target.height,state:target.closest('.hero-editorial')?.dataset.heroFlow,imageScale:Math.max(Math.abs(Math.hypot(matrix.m11,matrix.m12,matrix.m13)-1),Math.abs(Math.hypot(matrix.m21,matrix.m22,matrix.m23)-1),...(style?.scale && style.scale!=='none' ? style.scale.split(' ').map(value=>Math.abs(Number(value)-1)) : [0]))})
        if(probe.frames.length>600) probe.frames.shift()
      } catch(error) { probe.errors.push(error.message) }
    })
  },{disabledWebGL})
  return {writes,unexpected}
}

async function readyFlow(page) {
  await expect(root(page)).toHaveAttribute('data-hero-motion',/^(complete|static)$/)
  await expect(root(page)).toHaveAttribute('data-hero-flow',/^(ready|idle|active)$/)
  await expect(canvas(page)).toHaveCount(1)
  await expect.poll(()=>page.evaluate(()=>window.__flowProbe.frames.length)).toBeGreaterThan(0)
}

async function baseImageVisible(page) {
  await expect(media(page)).toBeVisible()
  await expect(media(page).locator('img')).toBeVisible()
  await expect(media(page).locator('img')).toHaveCSS('opacity','1')
  expect(await media(page).locator('img').evaluate(image=>image.complete && image.naturalWidth>0)).toBe(true)
}

async function activate(page) {
  const box=await media(page).boundingBox()
  await page.mouse.move(0,0)
  await page.mouse.move(box.x+box.width*.45,box.y+box.height*.45,{steps:8})
  await expect(root(page)).toHaveAttribute('data-hero-flow','active')
  return box
}

async function stopped(page,{state='paused',reason}={}) {
  await expect(root(page)).toHaveAttribute('data-hero-flow',state)
  if(reason) await expect(root(page)).toHaveAttribute('data-hero-flow-reason',reason)
  const frames=Number(await root(page).getAttribute('data-hero-flow-frames'))
  // An observation interval verifies that no idle/background RAF remains alive.
  await page.waitForTimeout(320)
  expect(Number(await root(page).getAttribute('data-hero-flow-frames'))).toBe(frames)
}

test('one real WebGL poster changes pixels under the pointer, preserves object-fit on resize and never scales the DOM image',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message))
  const audit=await fixtures(page)
  await page.goto('/')
  await readyFlow(page)
  await expect(page.locator('.hero-poster')).toHaveCount(4)
  await expect(media(page).locator('.hero-flow-canvas')).toHaveCount(1)
  await expect(page.locator('.hero-poster').nth(1).locator('canvas')).toHaveCount(0)
  await expect(page.locator('.hero-poster').nth(2).locator('canvas')).toHaveCount(0)
  await expect(page.locator('.hero-poster').nth(3).locator('canvas')).toHaveCount(0)
  await baseImageVisible(page)
  await expect(media(page).locator('img')).toHaveCSS('object-fit','cover')
  let baseline=await page.evaluate(()=>window.__flowProbe.frames.at(-1))
  expect(baseline.alpha).toBeGreaterThan(250)
  expect(baseline.meanError).not.toBeNull()
  expect(baseline.meanError).toBeLessThan(12)
  const previousSequence=baseline.sequence
  await page.setViewportSize({width:1000,height:1000})
  // Resizing an idle effect need not run a background frame. The first pointer
  // sample has zero velocity and paints the independent cover baseline.
  const resizedBox=await media(page).boundingBox()
  await page.mouse.move(resizedBox.x+resizedBox.width*.5,resizedBox.y+resizedBox.height*.5)
  await expect.poll(()=>page.evaluate(()=>window.__flowProbe.frames.at(-1)?.sequence || 0)).toBeGreaterThan(previousSequence)
  baseline=await page.evaluate(()=>window.__flowProbe.frames.at(-1))
  expect(baseline.meanError).toBeLessThan(12)
  const dimensions=await canvas(page).evaluate(node=>({canvas:node.getBoundingClientRect().toJSON(),media:node.parentElement.getBoundingClientRect().toJSON(),width:node.width,height:node.height}))
  expect(Math.abs(dimensions.canvas.x-dimensions.media.x)).toBeLessThan(1)
  expect(Math.abs(dimensions.canvas.y-dimensions.media.y)).toBeLessThan(1)
  expect(Math.abs(dimensions.canvas.width-dimensions.media.width)).toBeLessThan(1)
  expect(Math.abs(dimensions.canvas.height-dimensions.media.height)).toBeLessThan(1)
  expect(Math.abs(dimensions.width/dimensions.height-dimensions.media.width/dimensions.media.height)).toBeLessThan(.01)
  const box=await activate(page)
  await page.mouse.move(box.x+box.width*.75,box.y+box.height*.65,{steps:12})
  await page.mouse.move(box.x+box.width*.3,box.y+box.height*.3,{steps:12})
  await expect.poll(()=>page.evaluate(sequence=>window.__flowProbe.frames.filter(frame=>frame.sequence>sequence).length,baseline.sequence)).toBeGreaterThan(3)
  const probe=await page.evaluate(()=>window.__flowProbe)
  expect(probe.frames.some(frame=>frame.sequence>baseline.sequence && frame.hash!==baseline.hash)).toBe(true)
  expect(Math.max(...probe.frames.map(frame=>frame.imageScale))).toBeLessThan(.001)
  expect(probe.errors).toEqual([])
  expect(errors).toEqual([])
  expect(audit).toEqual({writes:[],unexpected:[]})
})

test('the WebGL layer preserves click and keyboard routes, and Back owns only one fresh canvas',async({page})=>{
  const audit=await fixtures(page)
  await page.goto('/')
  await readyFlow(page)
  const oldCanvas=await canvas(page).elementHandle()
  const oldRoot=await root(page).elementHandle()
  const link=page.locator('.hero-poster').first(),href=await link.getAttribute('href')
  await link.click()
  await expect(page).toHaveURL(new RegExp(`${href}$`))
  await expect(page.locator('.detail-poster')).toBeVisible()
  await expect(canvas(page)).toHaveCount(0)
  expect(await oldCanvas.evaluate(node=>node.isConnected)).toBe(false)
  await expect.poll(()=>oldRoot.evaluate(node=>node.dataset.heroFlow)).toBe('disposed')
  const sequence=await page.evaluate(()=>window.__flowProbe.sequence)
  await page.waitForTimeout(320)
  expect(await page.evaluate(()=>window.__flowProbe.sequence)).toBe(sequence)
  await page.goBack()
  await readyFlow(page)
  await expect(link).toBeFocused()
  expect(await oldCanvas.evaluate(node=>node.isConnected)).toBe(false)
  await link.focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(new RegExp(`${href}$`))
  await expect(page.locator('.detail-poster')).toBeVisible()
  await expect(canvas(page)).toHaveCount(0)
  await page.goBack()
  await readyFlow(page)
  await expect(link).toBeFocused()
  await expect(page.locator('.hero-poster')).toHaveCount(4)
  expect(await page.evaluate(()=>window.__flowProbe.errors)).toEqual([])
  expect(audit).toEqual({writes:[],unexpected:[]})
})

test('the render loop sleeps when idle, offscreen, hidden, or covered by a menu, search or dialog',async({page})=>{
  const audit=await fixtures(page)
  await page.goto('/')
  await readyFlow(page)
  await activate(page)
  await stopped(page,{state:'idle'})
  await activate(page)
  await page.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight))
  await stopped(page,{reason:'offscreen'})
  await page.evaluate(()=>scrollTo(0,0))
  await expect(root(page)).toHaveAttribute('data-hero-flow',/^(ready|idle|active)$/)
  await activate(page)
  // Headless Chromium reports both background tabs as visible. Supply the DOM
  // visibility input while real RAF/WebGL keep running, so the guard is tested.
  await page.evaluate(()=>{
    Object.defineProperty(document,'hidden',{configurable:true,get:()=>true})
    Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'})
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await stopped(page,{reason:'hidden'})
  await page.evaluate(()=>{
    delete document.hidden;delete document.visibilityState
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(root(page)).toHaveAttribute('data-hero-flow',/^(ready|idle|active)$/)
  for(const [button,panel] of [['.menu-trigger','#section-menu'],['.search-trigger','#search-tray'],['.login-button','#modal']]) {
    await activate(page)
    await page.locator(button).click()
    await expect(page.locator(panel)).toBeVisible()
    await stopped(page,{reason:'scene'})
    await baseImageVisible(page)
    await page.keyboard.press('Escape')
    await expect(page.locator(panel)).toBeHidden()
    await expect(root(page)).toHaveAttribute('data-hero-flow',/^(ready|idle|active)$/)
  }
  expect(await page.evaluate(()=>window.__flowProbe.errors)).toEqual([])
  expect(audit).toEqual({writes:[],unexpected:[]})
})

test('touch keeps four static posters and never attempts to allocate a WebGL context',async({browser})=>{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'no-preference'})
  try {
    const page=await context.newPage(),audit=await fixtures(page)
    await page.goto('/')
    await expect(root(page)).toHaveAttribute('data-hero-motion','complete')
    await expect(root(page)).toHaveAttribute('data-hero-flow','static')
    await expect(canvas(page)).toHaveCount(0)
    await expect(page.locator('.hero-poster')).toHaveCount(4)
    for(const poster of await page.locator('.hero-poster').all()) await expect(poster).toBeVisible()
    await baseImageVisible(page)
    expect(await page.evaluate(()=>window.__flowProbe.allocations)).toEqual([])
    await page.mouse.move(200,500,{steps:8})
    expect(await page.evaluate(()=>window.__flowProbe.allocations)).toEqual([])
    expect(audit).toEqual({writes:[],unexpected:[]})
  } finally { await context.close() }
})

test('initial reduced motion keeps the base image without allocating WebGL',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'})
  const audit=await fixtures(page)
  await page.goto('/')
  await expect(root(page)).toHaveAttribute('data-hero-motion','reduced')
  await expect(root(page)).toHaveAttribute('data-hero-flow','static')
  await expect(canvas(page)).toHaveCount(0)
  await baseImageVisible(page)
  expect(await page.evaluate(()=>window.__flowProbe.allocations)).toEqual([])
  expect(audit).toEqual({writes:[],unexpected:[]})
})

test('a live reduced-motion change disposes the active effect and leaves a usable unscaled poster',async({page})=>{
  const audit=await fixtures(page)
  await page.goto('/')
  await readyFlow(page)
  await activate(page)
  await page.emulateMedia({reducedMotion:'reduce'})
  await expect(canvas(page)).toHaveCount(0)
  await expect(root(page)).toHaveAttribute('data-hero-flow','static')
  await baseImageVisible(page)
  await expect(media(page).locator('img')).toHaveCSS('transform','none')
  const sequence=await page.evaluate(()=>window.__flowProbe.sequence)
  await page.waitForTimeout(320)
  expect(await page.evaluate(()=>window.__flowProbe.sequence)).toBe(sequence)
  expect(audit).toEqual({writes:[],unexpected:[]})
})

for(const failure of ['disabledWebGL','failedImage','corsImage']) {
  test(`${failure} falls back without an unusable canvas or blocked poster link`,async({page})=>{
    const errors=[];page.on('pageerror',error=>errors.push(error.message))
    const corsFailures=[]
    page.on('requestfailed',request=>{
      const url=new URL(request.url())
      if(url.hostname==='flow-cors.invalid' && url.searchParams.has('grade-flow')) corsFailures.push(request.failure()?.errorText)
    })
    const audit=await fixtures(page,{[failure]:true})
    await page.goto('/')
    await expect(root(page)).toHaveAttribute('data-hero-motion','complete')
    await expect(root(page)).toHaveAttribute('data-hero-flow','fallback')
    await expect(canvas(page)).toHaveCount(0)
    if(failure==='failedImage') {
      await expect(media(page)).toBeVisible()
      await expect(media(page)).toContainText('Кадр 1')
      await expect(media(page).locator('img')).toHaveCount(0)
    } else await baseImageVisible(page)
    if(failure==='corsImage') expect(corsFailures.some(error=>/ERR_FAILED|CORS/.test(error || ''))).toBe(true)
    const link=page.locator('.hero-poster').first(),href=await link.getAttribute('href')
    await link.focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(new RegExp(`${href}$`))
    await expect(page.locator('.detail-poster')).toBeVisible()
    expect(errors).toEqual([])
    expect(audit).toEqual({writes:[],unexpected:[]})
  })
}
