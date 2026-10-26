import {test,expect} from '@playwright/test'

test.use({locale:'ru-RU',reducedMotion:'no-preference'})
const trail=page=>page.locator('[data-particle-trail]')
async function fixtures(page){
  const failures=[]
  page.on('pageerror',error=>failures.push(error.message))
  await page.route('**/api/**',route=>{
    const request=route.request(),path=new URL(request.url()).pathname
    if(request.method()!=='GET'){failures.push(request.method()+' '+path);return route.fulfill({status:405,json:{error:'Input tests never write application data'}})}
    if(path==='/api/me')return route.fulfill({json:{user:null}})
    if(path==='/api/catalog')return route.fulfill({json:{items:Array.from({length:4},(_,i)=>({id:String(i+1),name:'Frame '+i,kind:'movie',year:2026,votes:0})),total:4,page:1,pages:1,externalSearch:false}})
    if(path==='/api/catalog/discover')return route.fulfill({json:{available:false,items:[],page:1,pages:0}})
    failures.push('Unexpected GET '+path);return route.fulfill({status:404,json:{error:'Unknown input fixture'}})
  })
  await page.addInitScript(()=>localStorage.setItem('grade:language','ru'))
  return failures
}
async function pixels(page,region={x:0,y:0,width:1100,height:700}){
  return trail(page).evaluate((canvas,region)=>{
    const sx=canvas.width/innerWidth,sy=canvas.height/innerHeight
    const x=Math.max(0,Math.round(region.x*sx)),y=Math.max(0,Math.round(region.y*sy))
    const width=Math.min(canvas.width-x,Math.round(region.width*sx)),height=Math.min(canvas.height-y,Math.round(region.height*sy))
    const data=canvas.getContext('2d').getImageData(x,y,width,height).data,bins=Array(20).fill(0)
    let sum=0,maximum=0
    for(let i=3;i<data.length;i+=4){const alpha=data[i];sum+=alpha;maximum=Math.max(maximum,alpha);if(alpha)bins[Math.min(19,Math.floor(((i-3)/4%width)/width*20))]++}
    return {sum,maximum,coverage:bins.filter(Boolean).length/20}
  },region)
}

test('an interpolated fading trail stays click-through across routes and preserves real selection and search input',async({page})=>{
  const failures=await fixtures(page)
  const response=await page.goto('/about')
  expect(response.headers()['content-security-policy']).toContain('img-src')
  await expect(page.locator('.about-page')).toBeVisible()
  await expect(trail(page)).toHaveCount(1)
  const original=await trail(page).elementHandle()
  await expect(trail(page)).toHaveCSS('pointer-events','none')
  await expect(trail(page)).toHaveAttribute('aria-hidden','true')
  await page.mouse.move(120,180);await page.mouse.move(1050,180)
  const strip={x:160,y:155,width:740,height:50}
  await expect.poll(async()=>(await pixels(page,strip)).coverage).toBeGreaterThan(.75)
  const bright=await pixels(page,strip)
  expect(bright.maximum).toBeGreaterThan(0)
  await page.waitForTimeout(220)
  expect((await pixels(page,strip)).maximum).toBe(0)
  const line=await page.locator('.about-page p').first().evaluate(node=>{const range=document.createRange();range.selectNodeContents(node);return range.getClientRects()[0].toJSON()})
  await page.mouse.move(line.x+2,line.y+line.height/2);await page.mouse.down()
  await page.mouse.move(line.x+Math.min(line.width-2,500),line.y+line.height/2,{steps:8});await page.mouse.up()
  expect(await page.evaluate(()=>getSelection().toString().length)).toBeGreaterThan(4)
  const link=page.locator('.about-page a[href="/catalog"]')
  await link.click();await expect(page.locator('#catalog-sort')).toBeVisible()
  expect(await original.evaluate(node=>node.isConnected)).toBe(true)
  await expect(trail(page)).toHaveCount(1)
  await page.locator('.search-trigger').click();await expect(page.locator('#search')).toBeFocused()
  await page.locator('#search').fill('Frame');await expect(page.locator('.frame-result')).toHaveCount(4)
  await expect(page.locator('#search')).toHaveValue('Frame')
  await page.keyboard.press('Escape');await expect(page.locator('#search-tray')).toBeHidden()
  await page.locator('footer a[href="/about"]').click();await expect(page.locator('.about-page')).toBeVisible()
  expect(await original.evaluate(node=>node.isConnected)).toBe(true)
  await expect(trail(page)).toHaveCount(1)
  await page.evaluate(async()=>{const {mountParticleInput}=await import('/particle-input.js');mountParticleInput();mountParticleInput()})
  await expect(trail(page)).toHaveCount(1)
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'))})
  await expect.poll(async()=>(await pixels(page)).maximum).toBe(0)
  await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'))})
  expect(failures).toEqual([])
})

test('a finger paints a short trail and the shared particle field while native scrolling remains usable',async({browser,baseURL})=>{
  const context=await browser.newContext({baseURL,viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'no-preference'})
  try{
    const page=await context.newPage(),failures=await fixtures(page)
    await page.goto('/about');await expect(page.locator('.about-page')).toBeVisible();await expect(trail(page)).toHaveCount(1)
    const cdp=await context.newCDPSession(page)
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:190,y:620}]})
    for(const y of [560,490,420,340]){
      await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:190,y}]})
      await page.waitForTimeout(25)
    }
    expect(await page.evaluate(async()=>{const {getParticleInput}=await import('/particle-input.js');const input=getParticleInput();return input.pointer.active&&input.pointer.y===340})).toBe(true)
    expect((await pixels(page,{x:0,y:0,width:390,height:844})).maximum).toBeGreaterThan(0)
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
    await expect.poll(()=>page.evaluate(()=>scrollY)).toBeGreaterThan(40)
    await page.waitForTimeout(220)
    expect((await pixels(page,{x:0,y:0,width:390,height:844})).maximum).toBe(0)
    expect(await page.evaluate(async()=>{const {getParticleInput}=await import('/particle-input.js');return getParticleInput().pointer.active})).toBe(false)
    await page.emulateMedia({reducedMotion:'reduce'})
    await page.mouse.move(100,200);await page.mouse.move(300,200)
    expect((await pixels(page,{x:0,y:0,width:390,height:844})).maximum).toBe(0)
    await expect(trail(page)).toHaveCSS('pointer-events','none')
    await cdp.detach();expect(failures).toEqual([])
  }finally{await context.close()}
})
