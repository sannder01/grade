import {test,expect} from '@playwright/test'
test.use({locale:'ru-RU',reducedMotion:'no-preference'})
const ready=page=>expect(page.locator('main')).not.toHaveAttribute('aria-busy','true')
const filters=page=>page.locator('main .category-pills')
async function fixtures(page,{discover=false}={}){
  const issues=[],control={gate:null,failNext:false}
  const all=Array.from({length:36},(_,index)=>({id:String(index+1),name:'Кадр '+(index+1),kind:['movie','anime','series'][index%3],year:1990+index,average:index%10,votes:1}))
  control.hold=match=>{
    let entered,release
    const started=new Promise(resolve=>{entered=resolve}),waiting=new Promise(resolve=>{release=resolve})
    const gate={match,started,entered,waiting,release:()=>{if(control.gate===gate)control.gate=null;release()}}
    control.gate=gate;return gate
  }
  await page.route('**/api/**',async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname
    if(request.method()!=='GET'){issues.push(request.method()+' '+path);return route.fulfill({status:405,json:{error:'Filter fixtures never write data'}})}
    if(path==='/api/me')return route.fulfill({json:{user:null}})
    if(path==='/api/catalog'){
      const gate=control.gate
      if(gate?.match(url)){gate.entered();await gate.waiting}
      if(control.failNext){control.failNext=false;return route.fulfill({status:503,json:{error:'Сервис временно недоступен'}})}
      const kind=url.searchParams.get('kind'),sort=url.searchParams.get('sort')||'popular'
      let items=all.filter(item=>!kind||item.kind===kind)
      if(sort==='new')items=[...items].sort((a,b)=>b.year-a.year)
      if(sort==='rating')items=[...items].sort((a,b)=>b.average-a.average)
      return route.fulfill({json:{items:items.map(item=>({...item,name:sort+' '+item.name})),total:items.length,page:1,pages:1,externalSearch:discover}})
    }
    if(path==='/api/catalog/discover')return route.fulfill({json:{available:discover,items:discover?all.slice(0,8).map(item=>({...item,external_id:'movie:'+item.id})):[],page:1,pages:1}})
    issues.push('Unexpected GET '+path);return route.fulfill({status:404,json:{error:'Unknown filter fixture'}})
  })
  await page.addInitScript(()=>localStorage.setItem('grade:language','ru'))
  return {issues,control}
}
async function open(page,path){
  const response=await page.goto(path)
  expect(response.headers()['content-security-policy']).toContain('img-src')
  await ready(page)
}
async function nativePosition(page,top=120){
  await page.evaluate(top=>scrollTo({top,behavior:'instant'}),top)
  const value=await page.evaluate(()=>scrollY)
  expect(value).toBeGreaterThan(20)
  return value
}
async function sameScroll(page,before){
  await expect.poll(()=>page.evaluate(before=>Math.abs(scrollY-before),before)).toBeLessThan(3)
}
async function drainFrames(page){await page.evaluate(async()=>{for(let i=0;i<4;i++)await new Promise(requestAnimationFrame)})}

for(const width of [1440,390])test('keyboard sort and category filters preserve focus, native scroll and Back at '+width+'px',async({page})=>{
  await page.setViewportSize({width,height:width===390?844:1000})
  const {issues}=await fixtures(page)
  for(const path of ['/collections/other-worlds','/catalog?view=grade']){
    await open(page,path)
    const id=path.startsWith('/collections')?'#collection-sort':'#catalog-sort'
    const sort=page.locator(id)
    await sort.focus()
    const beforeSort=await nativePosition(page)
    await sort.selectOption('new');await ready(page)
    await expect(sort).toHaveValue('new')
    await expect(sort).toBeFocused({timeout:2000})
    await sameScroll(page,beforeSort)
    await page.keyboard.press('Tab')
    await expect(page.locator('main .poster-link').first()).toBeFocused()
    const films=filters(page).getByRole('link',{name:'Фильмы',exact:true})
    await films.focus()
    const beforeFilter=await nativePosition(page)
    const filmHref=await films.getAttribute('href')
    await page.keyboard.press('Enter');await ready(page)
    const selected=page.locator('main .category-pills a.active')
    await expect(selected).toHaveAttribute('href',filmHref)
    await expect(selected).toBeFocused({timeout:2000})
    await expect(selected).toHaveAttribute('aria-current','true')
    await sameScroll(page,beforeFilter)
    for(const value of await page.locator('.card-meta').allTextContents())expect(value).toContain('Фильм')
    await page.keyboard.press('Tab')
    const nextName=path.startsWith('/collections')?'Аниме':'Сериалы'
    await expect(filters(page).getByRole('link',{name:nextName,exact:true})).toBeFocused()
    await page.goBack();await ready(page)
    await expect(sort).toHaveValue('new')
    await expect(films).toBeFocused()
    await sameScroll(page,beforeFilter)
    await page.keyboard.press('Tab')
    await expect(filters(page).getByRole('link',{name:nextName,exact:true})).toBeFocused()
  }
  expect(issues).toEqual([])
})

test('delayed filtering respects the current focus owner and only the latest response commits',async({page})=>{
  const {issues,control}=await fixtures(page)
  await open(page,'/catalog?view=grade')
  const sort=page.locator('#catalog-sort')
  let gate=control.hold(url=>url.searchParams.get('sort')==='new')
  await sort.focus();await sort.selectOption('new');await gate.started
  await page.locator('.search-trigger').click()
  await expect(page.locator('#search')).toBeFocused()
  await page.locator('#search').fill('Frame')
  gate.release();await ready(page)
  await expect(sort).toHaveValue('new')
  await expect(page.locator('#search')).toBeFocused()
  await expect(page.locator('#search')).toHaveValue('Frame')
  await expect(page.locator('main')).toHaveJSProperty('inert',true)
  await page.keyboard.press('Escape');await expect(page.locator('#search-tray')).toBeHidden()
  gate=control.hold(url=>url.searchParams.get('sort')==='rating')
  await sort.focus();await sort.selectOption('rating');await gate.started
  const anime=filters(page).getByRole('link',{name:'Аниме',exact:true})
  await anime.focus()
  const before=await nativePosition(page)
  gate.release();await ready(page)
  await expect(sort).toHaveValue('rating')
  await expect(anime).toBeFocused()
  await sameScroll(page,before)
  // A non-filter control chosen while awaiting the response must not refocus sort.
  gate=control.hold(url=>url.searchParams.get('sort')==='popular')
  await sort.focus();await sort.selectOption('popular');await gate.started
  await page.locator('main .poster-link').first().focus()
  gate.release();await ready(page)
  await expect(sort).toHaveValue('popular');await expect(sort).not.toBeFocused()
  gate=control.hold(url=>url.searchParams.get('sort')==='new')
  const stale=page.waitForResponse(response=>{const url=new URL(response.url());return url.pathname==='/api/catalog'&&url.searchParams.get('sort')==='new'})
  await sort.focus();await sort.selectOption('new');await gate.started
  await sort.selectOption('rating');await ready(page)
  await expect(sort).toHaveValue('rating');await expect(sort).toBeFocused()
  gate.release();await stale;await drainFrames(page)
  await expect(sort).toHaveValue('rating');await expect(sort).toBeFocused()
  await expect(page.locator('.card-title').first()).toContainText('rating')
  await expect(page.locator('main')).not.toHaveAttribute('aria-busy','true')
  expect(issues).toEqual([])
})

test('discovery genre and year keep keyboard context while failed renders have a readable fallback',async({page})=>{
  const {issues,control}=await fixtures(page,{discover:true})
  await open(page,'/catalog?view=discover')
  const genre=page.locator('#catalog-genre'),from=page.locator('#catalog-from')
  await genre.focus()
  let before=await nativePosition(page)
  await genre.selectOption('18');await ready(page)
  await expect(genre).toHaveValue('18');await expect(genre).toBeFocused()
  await sameScroll(page,before)
  await page.keyboard.press('Tab');await expect(from).toBeFocused()
  before=await page.evaluate(()=>scrollY)
  await from.selectOption('2020');await ready(page)
  await expect(from).toHaveValue('2020');await expect(from).toBeFocused()
  await sameScroll(page,before)
  await page.goBack();await ready(page)
  await expect(genre).toHaveValue('18');await expect(from).toHaveValue('');await expect(from).toBeFocused()
  await sameScroll(page,before)
  control.failNext=true
  await genre.focus();await genre.selectOption('35');await ready(page)
  await expect(page.locator('.error-page h1')).toHaveText('Не удалось открыть страницу')
  await expect(genre).toHaveCount(0)
  await expect(page.locator('main')).toHaveJSProperty('inert',false)
  expect(await page.evaluate(()=>document.activeElement.isConnected&&!document.activeElement.closest('[inert],[hidden]'))).toBe(true)
  await page.locator('[data-action=retry]').focus();await page.keyboard.press('Enter');await ready(page)
  await expect(genre).toHaveValue('35');await expect(page.locator('.error-page')).toHaveCount(0)
  const gradeView=page.locator('.catalog-views').getByRole('link',{name:'Каталог Grade',exact:true})
  await gradeView.focus();await page.keyboard.press('Enter');await ready(page)
  await expect(gradeView).toBeFocused()
  await expect(gradeView).toHaveAttribute('aria-current','true')
  await expect(page.locator('#catalog-genre')).toHaveCount(0)
  await page.keyboard.press('Tab')
  await expect(filters(page).getByRole('link',{name:'Всё',exact:true})).toBeFocused()
  await page.goBack();await ready(page)
  await expect(gradeView).toBeFocused()
  await expect(genre).toHaveValue('35')
  await expect(page.locator('.catalog-views a.active')).toHaveAttribute('aria-current','true')
  expect(issues).toEqual([])
})
