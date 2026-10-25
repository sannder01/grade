import { test, expect } from '@playwright/test'

test.use({locale:'ru-RU',reducedMotion:'no-preference'})
const ready = page => expect(page.locator('main')).not.toHaveAttribute('aria-busy','true')
const menuButton = page => page.locator('.menu-trigger')
const menu = page => page.locator('#section-menu')

test('the new header keeps its logo and routes readable in the full-screen menu', async ({page}) => {
  const errors=[]; page.on('pageerror',error=>errors.push(error.message))
  await page.goto('/')
  await ready(page)
  await expect(page.locator('.track-header .brand use')).toHaveAttribute('href','/icons.svg#brand')
  await expect(page.locator('.track-line,.viewer-pass,.auth-connector,.brand-caption')).toHaveCount(0)
  await expect(page.locator('.search-trigger')).toContainText('Поиск')
  await expect(menuButton(page)).toContainText('Меню')
  await expect(page.locator('.login-button')).toHaveText('Войти')
  for (const section of ['collections','catalog','home']) {
    await menuButton(page).click()
    await expect(menu(page)).toBeVisible()
    await expect(page.locator('main')).toHaveJSProperty('inert',true)
    await expect(page.locator('.track-header .brand')).toBeVisible()
    await menu(page).locator(`a[data-nav=${section}]`).click()
    await ready(page)
    await expect(menu(page)).toBeHidden()
    await expect(menu(page).locator(`a[data-nav=${section}]`)).toHaveAttribute('aria-current','page')
    await expect(page.locator('main')).toHaveJSProperty('inert',false)
  }
  expect(errors).toEqual([])
})

test('the search scene keeps real results, keyboard navigation and Escape focus', async ({page}) => {
  await page.goto('/')
  await ready(page)
  await page.locator('.search-trigger').click()
  await expect(page.locator('#search')).toBeFocused()
  await expect(page.locator('#search')).toHaveAttribute('placeholder','Название фильма, аниме или сериала')
  await expect(page.locator('#search-results')).toContainText('Название фильма')
  await expect(page.locator('.track-header .brand')).toBeVisible()
  await page.locator('#search').fill('Интерстеллар')
  await expect(page.locator('.frame-result strong').first()).toHaveText('Интерстеллар')
  await expect(page).toHaveURL(/\/$/)
  await page.keyboard.press('ArrowDown')
  await expect(page.locator('.frame-result').first()).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.locator('#search-tray')).toBeHidden()
  await expect(page.locator('.search-trigger')).toBeFocused()
  await expect(page.locator('main')).toHaveJSProperty('inert',false)
  await page.keyboard.press('/')
  await page.keyboard.press('Escape')
  await page.keyboard.press('/')
  await expect(page.locator('#search')).toBeFocused()
  await expect(page.locator('.frame-result').first()).toBeVisible()
  await page.locator('#search').press('Enter')
  await ready(page)
  await expect(page).toHaveURL(/\/catalog\?q=/)
  await expect(page.locator('h1')).toHaveText('Поиск: «Интерстеллар»')
  await expect(page.locator('#search-tray')).toBeHidden()
  await expect(page.locator('main')).toHaveJSProperty('inert',false)
})

test('only the latest search response is displayed and errors can be retried', async ({page}) => {
  let unavailable=true
  await page.route('**/api/catalog?*',async route=>{
    const q=new URL(route.request().url()).searchParams.get('q')
    if (q==='slow') {
      await new Promise(resolve=>setTimeout(resolve,450))
      await route.fulfill({json:{items:[{id:'1',name:'Old result',kind:'movie',year:2020}],total:1}}).catch(()=>{})
    } else if (q==='fast' || (q==='error' && !unavailable)) await route.fulfill({json:{items:[{id:'2',name:'New result',kind:'movie',year:2024}],total:1}})
    else if (q==='error') await route.fulfill({status:503,json:{error:'Сервис временно недоступен'}})
    else await route.continue()
  })
  await page.goto('/')
  await ready(page)
  await page.keyboard.press('/')
  const slowRequest=page.waitForRequest(request=>new URL(request.url()).searchParams.get('q')==='slow')
  await page.locator('#search').fill('slow')
  await slowRequest
  await page.locator('#search').fill('fast')
  await expect(page.locator('.frame-result')).toContainText('New result')
  await expect(page.locator('.frame-result')).not.toContainText('Old result')
  await page.locator('#search').fill('error')
  await expect(page.locator('#search-results')).toContainText('Сервис временно недоступен')
  unavailable=false
  await page.locator('[data-search-retry]').click()
  await expect(page.locator('.frame-result')).toContainText('New result')
})

test('the sign-in sidebar preserves the auth contract and links the signed-in profile', async ({page}) => {
  let signedIn=false, payload
  const user={id:'header-fixture',name:'Кинозритель',username:'header_viewer'}
  await page.route('**/api/me',route=>route.fulfill({json:signedIn?{user,visibility:{ratings:true,watched:true,planned:true,reviews:true,comments:true},onboarding_done:true}:{user:null}}))
  await page.route('**/api/auth/sign-in/username',route=>{
    payload=route.request().postDataJSON(); signedIn=true
    return route.fulfill({json:{user}})
  })
  await page.route('**/api/profiles/header_viewer?*',route=>route.fulfill({json:{user,own:true,visibility:{ratings:true,watched:true,planned:true,reviews:true,comments:true},hidden:false,tab:'ratings',stats:{rated:0,watched:0,planned:0,reviews:0,comments:0,average:null},items:[],page:1,pages:0}}))
  await page.goto('/')
  await ready(page)
  await page.locator('.login-button').click()
  await expect(page.locator('#modal')).toBeVisible()
  await expect(page.locator('#auth-title')).toHaveText('Вход')
  await expect(page.locator('.track-header .brand')).toBeVisible()
  await page.getByLabel('Почта или никнейм',{exact:true}).fill('header_viewer')
  await page.getByLabel('Пароль',{exact:true}).fill('Header-test-only-2026')
  await page.locator('#auth-form [type=submit]').click()
  await expect(page.locator('#modal')).toBeHidden()
  await ready(page)
  expect(payload).toEqual({username:'header_viewer',password:'Header-test-only-2026'})
  await expect(page.locator('.account-link')).toContainText('Кинозритель')
  await expect(page.locator('.account-link')).toHaveAttribute('href','/u/header_viewer')
  await page.locator('.account-link').click()
  await ready(page)
  await expect(page.locator('h1')).toHaveText('Кинозритель')
  await page.locator('.profile-actions [data-action=edit-profile]').click()
  await page.getByRole('radio',{name:'Синий',exact:true}).check()
  await expect(page.locator('input[name=avatar_color][value=blue]')).toBeChecked()
})

test('repeated scene toggles reverse cleanly and keep keyboard focus out of hidden content', async ({page}) => {
  const errors=[]; page.on('pageerror',error=>errors.push(error.message))
  await page.goto('/')
  await ready(page)
  await menuButton(page).focus()
  await menuButton(page).evaluate(async button=>{
    button.click(); await new Promise(resolve=>setTimeout(resolve,80))
    button.click(); await new Promise(resolve=>setTimeout(resolve,60))
    button.click()
  })
  await expect(menuButton(page)).toHaveAttribute('aria-expanded','true')
  await expect(menu(page)).toHaveAttribute('aria-hidden','false')
  for (let index=0;index<14;index++) {
    await page.keyboard.press('Tab')
    expect(await page.evaluate(()=>Boolean(document.activeElement.closest('.track-header')))).toBe(true)
  }
  await page.keyboard.press('Escape')
  await expect(menu(page)).toBeHidden()
  await expect(menuButton(page)).toBeFocused()
  await page.locator('.search-trigger').focus()
  await page.locator('.search-trigger').evaluate(async button=>{
    button.click(); await new Promise(resolve=>setTimeout(resolve,80))
    button.click(); await new Promise(resolve=>setTimeout(resolve,60))
    button.click()
  })
  await expect(page.locator('#search')).toBeFocused()
  await expect(page.locator('#section-menu')).toBeHidden()
  await page.locator('.search-close').click()
  await expect(page.locator('#search-tray')).toBeHidden()
  await expect(page.locator('.search-trigger')).toBeFocused()
  await expect(page.locator('main')).toHaveJSProperty('inert',false)
  expect(await page.evaluate(()=>document.documentElement.style.overflow)).not.toBe('hidden')
  expect(errors).toEqual([])
})

test('mobile header controls and every expanded scene fit 320–760 px', async ({page}) => {
  for (const width of [320,390,760]) {
    await page.setViewportSize({width,height:844})
    await page.goto('/')
    await ready(page)
    for (const selector of ['.track-header .brand','.search-trigger','.menu-trigger','.login-button']) {
      const control=page.locator(selector)
      await expect(control).toBeVisible()
      const bounds=await control.boundingBox()
      expect(bounds.width,selector).toBeGreaterThanOrEqual(44)
      expect(bounds.height,selector).toBeGreaterThanOrEqual(44)
    }
    await menuButton(page).click()
    await menu(page).locator('a[data-nav=collections]').click()
    await ready(page)
    await expect(page).toHaveURL(/\/collections$/)
    await expect(menu(page)).toBeHidden()
    await page.keyboard.press('/')
    await page.locator('#search').fill('Интерстеллар')
    await expect(page.locator('.frame-result').first()).toBeVisible()
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
    await page.keyboard.press('Escape')
    await page.locator('.login-button').click()
    await expect(page.locator('#modal')).toBeVisible()
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
    await page.keyboard.press('Escape')
    await expect(page.locator('#modal')).toBeHidden()
    await expect(page.locator('.login-button')).toBeFocused()
  }
})

test('reduced motion settles scenes immediately while preserving focus and navigation', async ({page}) => {
  await page.emulateMedia({reducedMotion:'reduce'})
  await page.setViewportSize({width:390,height:844})
  await page.goto('/')
  await ready(page)
  expect(await page.evaluate(async()=>(await import('/motion.js')).reducedMotion())).toBe(true)
  await page.locator('.search-trigger').click()
  await expect(page.locator('#search')).toBeFocused()
  expect(await page.locator('#search-tray').evaluate(async panel=>{
    const {gsap}=await import('/assets/motion-vendor.js')
    return gsap.getTweensOf(panel).some(tween=>tween.isActive())
  })).toBe(false)
  await page.keyboard.press('Escape')
  await expect(page.locator('.search-trigger')).toBeFocused()
  await menuButton(page).click()
  await expect(menu(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(menuButton(page)).toBeFocused()
  await page.locator('.login-button').click()
  await expect(page.locator('#auth-form')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('#modal')).toBeHidden()
  await expect(page.locator('.login-button')).toBeFocused()
  await expect(page.locator('main')).toHaveJSProperty('inert',false)
})

test('the sign-in sidebar cancels before its first animation frame and can reopen repeatedly', async ({page}) => {
  const errors=[],writes=[],unexpected=[]
  page.on('pageerror',error=>errors.push(error.message))
  await page.route('**/api/**',route=>{
    const request=route.request(),path=new URL(request.url()).pathname
    if(request.method()!=='GET') {
      writes.push(request.method()+' '+path)
      return route.fulfill({status:405,json:{error:'This dialog regression never writes application data'}})
    }
    if(path==='/api/me') return route.fulfill({json:{user:null}})
    if(path==='/api/catalog') return route.fulfill({json:{items:Array.from({length:4},(_,index)=>({id:String(index+1),name:`Кадр ${index+1}`,kind:'movie',year:2026,votes:0})),total:4,page:1,pages:1,externalSearch:false}})
    if(path==='/api/catalog/discover') return route.fulfill({json:{available:false,items:[],page:1,pages:0}})
    unexpected.push(path)
    return route.fulfill({status:404,json:{error:'Unknown dialog fixture route'}})
  })
  await page.addInitScript(()=>localStorage.setItem('grade:language','ru'))
  await page.goto('/')
  await ready(page)
  const login=page.locator('.login-button'),modal=page.locator('#modal')
  await expect(login).toBeEnabled()
  await login.focus()
  for(let cycle=0;cycle<4;cycle++) {
    // Keep both UI events in one synchronous JS turn: the opening timeline
    // must still be at its start when the cancel handler reverses it.
    const result=await login.evaluate(button=>{
      button.click()
      const dialog=document.querySelector('#modal'),opened=dialog.open
      const cancel=new Event('cancel',{cancelable:true})
      dialog.dispatchEvent(cancel)
      return {opened,cancelPrevented:cancel.defaultPrevented}
    })
    expect(result).toEqual({opened:true,cancelPrevented:true})
    await expect(modal,`cancel cycle ${cycle+1} must remove the dialog from the top layer`).toHaveJSProperty('open',false,{timeout:2000})
    await expect(modal).toBeHidden()
    await expect(login).toBeFocused()
    await expect(page.locator('main')).toHaveJSProperty('inert',false)
    expect(await modal.evaluate(node=>node.style.transform)).toBe('')
  }
  expect(errors).toEqual([])
  expect(writes).toEqual([])
  expect(unexpected).toEqual([])
})
