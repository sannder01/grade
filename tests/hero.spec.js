import { test, expect } from '@playwright/test'

test.use({locale:'ru-RU',reducedMotion:'no-preference'})
const ready=page=>expect(page.locator('main')).not.toHaveAttribute('aria-busy','true')
const hero=page=>page.locator('.hero-editorial')

async function fixtures(page,{language='ru',failedFonts=false,failedImages=false}={}) {
  const writes=[],unexpected=[]
  await page.route('**/api/**',async route=>{
    const request=route.request(),path=new URL(request.url()).pathname
    if(request.method()!=='GET') {
      writes.push(request.method()+' '+path)
      return route.fulfill({status:405,json:{error:'Hero tests never write application data'}})
    }
    const english=request.headers()['accept-language']==='en'
    const items=Array.from({length:4},(_,index)=>({id:String(index+1),name:english ? `Frame ${index+1}` : `Кадр ${index+1}`,kind:'movie',year:2026-index,poster:`/hero-fixtures/poster-${index+1}.svg`,votes:0,average:null}))
    if(path==='/api/me') return route.fulfill({json:{user:null}})
    if(path==='/api/catalog') return route.fulfill({json:{items,total:items.length,page:1,pages:1,externalSearch:false}})
    if(path==='/api/catalog/discover') return route.fulfill({json:{available:false,items:[],page:1,pages:0}})
    if(/^\/api\/titles\/\d+\/discussion$/.test(path)) return route.fulfill({json:{items:[],total:0,page:1,pages:0}})
    if(/^\/api\/titles\/\d+\/trailer$/.test(path)) return route.fulfill({json:{status:'not_found'}})
    if(/^\/api\/titles\/\d+\/external-ratings$/.test(path)) return route.fulfill({json:{status:'not_found'}})
    if(/^\/api\/titles\/\d+$/.test(path)) {
      const item=items.find(item=>item.id===path.split('/').at(-1)) || items[0]
      return route.fulfill({json:{...item,original_name:item.name,runtime:'100 мин',genres:['Драма'],description:'История из тестовой коллекции',watched:false,planned:false,my_score:null}})
    }
    unexpected.push(path)
    return route.fulfill({status:404,json:{error:'Unknown hero fixture route'}})
  })
  await page.route('**/hero-fixtures/*.svg',route=>failedImages
    ? route.fulfill({status:404,body:'Image unavailable'})
    : route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450"><rect width="300" height="450" fill="#716f74"/><path d="M0 330 300 100V450H0Z" fill="#49474e"/></svg>'}))
  if(failedFonts) {
    await page.route('https://fonts.googleapis.com/**',route=>route.abort())
    await page.route('https://fonts.gstatic.com/**',route=>route.abort())
  }
  await page.addInitScript(({language})=>{
    try { localStorage.setItem('grade:language',language) } catch {}
    const probe=window.__heroProbe={starts:[],completions:[]}
    const matrix=node=>new DOMMatrixReadOnly(getComputedStyle(node).transform)
    let activeRoot=null,run=null
    function capture(root,entry) {
      const lines=[...root.querySelectorAll('.hero-line')]
      const media=[...root.querySelectorAll('[data-hero-media]')]
      const images=[...root.querySelectorAll('[data-hero-media] img')]
      entry.frames.push({
        at:performance.now(),phase:root.dataset.heroMotion,
        lines:lines.map(node=>({y:matrix(node).f,height:node.getBoundingClientRect().height})),
        masks:[...root.querySelectorAll('.hero-line-mask')].map(node=>getComputedStyle(node).overflow),
        clips:media.map(node=>{const clip=getComputedStyle(node).clipPath;return clip==='none' ? 0 : parseFloat(/^inset\(\s*([\d.]+)/.exec(clip)?.[1] || '0')}),
        imageDeviation:Math.max(0,...images.map(node=>{
          const transform=matrix(node),scale=getComputedStyle(node).scale
          return Math.max(Math.abs(Math.hypot(transform.m11,transform.m12,transform.m13)-1),Math.abs(Math.hypot(transform.m21,transform.m22,transform.m23)-1),...(scale==='none' ? [0] : scale.split(' ').map(value=>Math.abs(Number(value)-1))))
        })),
        wholeHeroY:matrix(root).f,
        contentY:matrix(root.querySelector('.hero-content')).f,
        headingY:matrix(root.querySelector('h1')).f,
        anchorsY:[...root.querySelectorAll('.hero-poster')].map(node=>matrix(node).f),
        mainOpacity:Number(getComputedStyle(document.querySelector('main')).opacity),
      })
    }
    document.addEventListener('grade:hero-start',event=>{
      const root=event.target
      const entry={at:performance.now(),duration:Number(root.dataset.heroMotionDuration),frames:[]}
      probe.starts.push(entry);activeRoot=root;run=entry
      capture(root,entry)
      const tick=()=>{
        if(root!==activeRoot || !root.isConnected || root.dataset.heroMotion==='disposed') return
        capture(root,entry)
        if(root.dataset.heroMotion==='running') requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    document.addEventListener('grade:hero-complete',event=>{
      probe.completions.push({at:performance.now(),phase:event.target.dataset.heroMotion})
      if(event.target===activeRoot && run) { capture(event.target,run);run.completedAt=performance.now() }
    })
  },{language})
  return {writes,unexpected}
}

async function settledHero(page) {
  await ready(page)
  await expect(hero(page)).toHaveAttribute('data-hero-motion',/^(complete|static|reduced)$/)
  await expect(page.locator('.hero-poster')).toHaveCount(4)
  await expect(page.locator('[data-hero-media]')).toHaveCount(4)
  for(const poster of await page.locator('.hero-poster').all()) {
    await expect(poster).toBeVisible()
    await expect(poster.locator('.hero-poster-caption')).toContainText(/\S/)
  }
  await expect(page.locator('.hero-line-mask .hero-line-mask')).toHaveCount(0)
  expect(await hero(page).evaluate(root=>{
    const nodes=[...root.querySelectorAll('.hero-line,[data-hero-media]')]
    return nodes.every(node=>{
      const style=getComputedStyle(node),clip=style.clipPath
      return Math.abs(new DOMMatrixReadOnly(style.transform).f)<.1 && (clip==='none' || Number(/^inset\(\s*([\d.]+)/.exec(clip)?.[1] || 0)<.1)
    })
  })).toBe(true)
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
}

for(const language of ['ru','en']) for(const width of [1440,390]) {
  test(`hero masks reveal real lines and all four unchanged posters in ${language} at ${width}px`,async({page})=>{
    const errors=[];page.on('pageerror',error=>errors.push(error.message))
    const audit=await fixtures(page,{language})
    await page.setViewportSize({width,height:1000})
    await page.goto('/')
    await settledHero(page)
    await expect(page.locator('html')).toHaveAttribute('lang',language)
    await expect(hero(page).locator('h1')).toHaveText(language==='ru' ? /Кино,\s*которое\s*остаётся/ : /Cinema\s*that\s*stays/)
    const probe=await page.evaluate(()=>window.__heroProbe)
    expect(probe.starts).toHaveLength(1)
    const run=probe.starts[0]
    expect(run.duration).toBeGreaterThanOrEqual(1.1)
    expect(run.duration).toBeLessThanOrEqual(1.3)
    expect((run.completedAt-run.at)/1000).toBeGreaterThanOrEqual(1.08)
    expect((run.completedAt-run.at)/1000).toBeLessThan(1.5)
    expect(run.frames.some(frame=>frame.masks.length>1 && frame.masks.every(value=>['hidden','clip'].includes(value)))).toBe(true)
    expect(run.frames.some(frame=>frame.lines.some(line=>line.y>2 && line.y<line.height*.95))).toBe(true)
    for(let index=0;index<4;index++) expect(run.frames.some(frame=>frame.clips[index]>1 && frame.clips[index]<99),`poster ${index+1} has an intermediate clip`).toBe(true)
    expect(Math.max(...run.frames.map(frame=>frame.imageDeviation))).toBeLessThan(.001)
    expect(run.frames.every(frame=>Math.abs(frame.wholeHeroY)<.1 && Math.abs(frame.contentY)<.1 && Math.abs(frame.headingY)<.1 && frame.anchorsY.every(y=>Math.abs(y)<.1))).toBe(true)
    expect(run.frames.every(frame=>frame.mainOpacity>.99)).toBe(true)
    const text=await page.locator('.hero-content').boundingBox()
    const posters=await page.locator('.hero-posters').boundingBox()
    if(width===390) expect(posters.y).toBeGreaterThanOrEqual(text.y+text.height-1)
    else expect(posters.x).toBeGreaterThan(text.x+text.width/2)
    expect(errors).toEqual([])
    expect(audit).toEqual({writes:[],unexpected:[]})
  })
}

test('hero actions work during the intro and Back, search and language changes never replay it',async({page})=>{
  const audit=await fixtures(page)
  await page.goto('/',{waitUntil:'domcontentloaded'})
  await expect(hero(page)).toHaveAttribute('data-hero-motion','running')
  await expect(page.locator('main')).toHaveJSProperty('inert',false)
  const action=page.locator('.hero-actions a[href^="/catalog"]')
  await expect(action).toBeVisible()
  await expect(page.locator('.hero-actions')).toHaveCSS('opacity','1')
  await action.focus()
  expect(await hero(page).getAttribute('data-hero-motion')).toBe('running')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/catalog$/)
  await ready(page)
  await page.goBack()
  await settledHero(page)
  await expect(action).toBeFocused()
  await expect(hero(page)).toHaveAttribute('data-hero-motion','static')
  await expect(hero(page).locator('.hero-line-mask')).toHaveCount(0)
  await page.locator('.search-trigger').click()
  await expect(page.locator('#search')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.locator('#search-tray')).toBeHidden()
  await page.keyboard.press('/')
  await page.locator('#search').fill('Кадр')
  await page.locator('#search').press('Enter')
  await expect(page).toHaveURL(/\/catalog\?q=/)
  await ready(page)
  await page.goBack()
  await settledHero(page)
  await page.locator('.menu-trigger').click()
  await page.locator('#language-switch').click()
  await expect(hero(page).locator('h1')).toContainText('Cinema')
  await page.keyboard.press('Escape')
  await expect(page.locator('#section-menu')).toBeHidden()
  await settledHero(page)
  expect(await page.evaluate(()=>window.__heroProbe.starts.length)).toBe(1)
  await expect(hero(page).locator('.hero-line-mask')).toHaveCount(0)
  expect(audit).toEqual({writes:[],unexpected:[]})
})

test('rapid entry and browser Back dispose the intro and leave no stale masks or transforms',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message))
  const audit=await fixtures(page)
  await page.goto('/',{waitUntil:'domcontentloaded'})
  await expect(hero(page)).toHaveAttribute('data-hero-motion','running')
  for(let index=0;index<3;index++) {
    await page.locator('.hero-poster').first().evaluate(node=>{
      node.click()
      requestAnimationFrame(()=>history.back())
    })
    await expect(page).toHaveURL(/\/$/)
    await expect(hero(page)).toHaveAttribute('data-hero-motion','static')
    await settledHero(page)
  }
  expect(await page.evaluate(()=>window.__heroProbe.starts.length)).toBe(1)
  await expect(hero(page).locator('.hero-line,.hero-line-mask')).toHaveCount(0)
  await expect(page.locator('.collection-motion-layer,.flying-poster')).toHaveCount(0)
  await expect(page.locator('main')).toHaveJSProperty('inert',false)
  expect(errors).toEqual([])
  expect(audit).toEqual({writes:[],unexpected:[]})
})

test('failed fonts and poster images do not gate the intro, and resizing does not replay it',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message))
  const audit=await fixtures(page,{failedFonts:true,failedImages:true})
  await page.goto('/',{waitUntil:'domcontentloaded'})
  await expect(hero(page)).toHaveAttribute('data-hero-motion','running')
  await page.setViewportSize({width:390,height:844})
  await settledHero(page)
  await expect(hero(page).locator('img')).toHaveCount(0)
  for(const media of await page.locator('[data-hero-media]').all()) await expect(media).toContainText('Кадр')
  for(const width of [1440,390]) {
    await page.setViewportSize({width,height:1000})
    await settledHero(page)
  }
  expect(await page.evaluate(()=>window.__heroProbe.starts.length)).toBe(1)
  await expect(hero(page).locator('h1')).toHaveText(/Кино,\s*которое\s*остаётся/)
  expect(errors).toEqual([])
  expect(audit).toEqual({writes:[],unexpected:[]})
})

test('initial reduced motion shows the whole hero immediately and enabling motion does not start an intro',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'})
  const audit=await fixtures(page)
  await page.setViewportSize({width:390,height:844})
  await page.goto('/')
  await settledHero(page)
  await expect(hero(page)).toHaveAttribute('data-hero-motion','reduced')
  await expect(hero(page).locator('.hero-line,.hero-line-mask')).toHaveCount(0)
  await page.emulateMedia({reducedMotion:'no-preference'})
  await settledHero(page)
  expect(await page.evaluate(()=>window.__heroProbe.starts.length)).toBe(0)
  expect(audit).toEqual({writes:[],unexpected:[]})
})

test('a live reduced-motion change settles the running scene without hiding content or replaying it',async({page})=>{
  const audit=await fixtures(page)
  await page.goto('/',{waitUntil:'domcontentloaded'})
  await expect(hero(page)).toHaveAttribute('data-hero-motion','running')
  await page.emulateMedia({reducedMotion:'reduce'})
  await settledHero(page)
  await expect(hero(page)).toHaveAttribute('data-hero-motion','reduced')
  await expect(hero(page).locator('.hero-line,.hero-line-mask')).toHaveCount(0)
  await expect(page.locator('main')).toHaveJSProperty('inert',false)
  await page.emulateMedia({reducedMotion:'no-preference'})
  await settledHero(page)
  expect(await page.evaluate(()=>window.__heroProbe.starts.length)).toBe(1)
  expect(audit).toEqual({writes:[],unexpected:[]})
})
