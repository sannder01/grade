import { test, expect } from '@playwright/test'

async function swipe(page,selector,dx,dy=0) {
  await page.locator(selector).first().evaluate((element,{dx,dy})=>{
    const touch={identifier:1,target:element,clientX:dx<0?280:100,clientY:240}
    element.dispatchEvent(new TouchEvent('touchstart',{bubbles:true,touches:[new Touch(touch)]}))
    element.dispatchEvent(new TouchEvent('touchend',{bubbles:true,touches:[],changedTouches:[new Touch({...touch,clientX:touch.clientX+dx,clientY:touch.clientY+dy})]}))
  },{dx,dy})
}

test('motion supports mobile navigation, safe swipes, modal closing and reduced motion',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message))
  await page.setViewportSize({width:390,height:950})
  await page.goto('/')
  await expect(page.locator('main')).not.toHaveAttribute('aria-busy','true')
  await swipe(page,'.hero-content',-140)
  await expect(page).toHaveURL(/\/catalog$/)
  await expect(page.locator('main')).not.toHaveAttribute('aria-busy','true')
  await expect(page.locator('.title-card')).not.toHaveCount(0)
  const card=page.locator('.title-card').last()
  await card.scrollIntoViewIfNeeded()
  await expect(card).not.toHaveAttribute('data-reveal','pending')
  await page.locator('.poster-link').first().click()
  await expect(page.locator('main')).not.toHaveAttribute('aria-busy','true')
  await swipe(page,'.title-description',-140)
  await expect(page).toHaveURL(/type=comments/)
  await expect(page.locator('#comment-text')).toBeVisible()
  const before=page.url()
  await swipe(page,'#comment-text',140)
  expect(page.url()).toBe(before)
  await page.getByRole('button',{name:/^Войти/}).click()
  await expect(page.locator('#modal')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('#modal')).not.toBeVisible()
  await page.emulateMedia({reducedMotion:'reduce'})
  await page.goto('/catalog')
  await expect(page.locator('main')).not.toHaveAttribute('aria-busy','true')
  expect(await page.locator('main').evaluate(main=>main.getAnimations({subtree:true}).some(animation=>animation.playState==='running' && animation.effect.getTiming().duration>1))).toBe(false)
  await expect(page.locator('[data-reveal=pending]')).toHaveCount(0)
  const current=page.url()
  await swipe(page,'.page-heading',-140,150)
  expect(page.url()).toBe(current)
  expect(errors).toEqual([])
})

test('glass dock follows routes, profile tabs, history and language changes',async({page})=>{
  await page.setViewportSize({width:390,height:844})
  await page.goto('/')
  const dock = page.locator('.mobile-nav'), active = dock.locator('[aria-current=page]')
  await expect(active).toHaveText('Обзор')
  await dock.getByRole('link',{name:'Каталог',exact:true}).click()
  await expect(page.locator('main')).not.toHaveAttribute('aria-busy','true')
  await expect(active).toHaveText('Каталог')
  await page.locator('.poster-link').first().click()
  await expect(active).toHaveText('Каталог')
  await page.goBack()
  await expect(active).toHaveText('Каталог')
  await dock.getByRole('link',{name:'Профиль',exact:true}).click()
  await expect(active).toHaveText('Профиль')
  await expect(page.getByRole('heading',{name:'Войдите в аккаунт'})).toBeVisible()

  const username = 'motion'+Date.now().toString(36)
  const signup = await page.request.post('/api/auth/sign-up/email',{
    headers:{Origin:'http://127.0.0.1:3100','X-Forwarded-For':'198.51.100.31'},
    data:{name:'Зритель',username,email:username+'@example.test',password:'Motion-Profile-Test-2026'},
  })
  expect(signup.status()).toBe(200)
  await page.goto('/me')
  await expect(page).toHaveURL(new RegExp('/u/'+username+'$'))
  await expect(active).toHaveText('Профиль')
  for (const tab of ['watched','planned','reviews','comments','ratings']) {
    await page.locator(`.profile-tabs a[href$="tab=${tab}"]`).click()
    await expect(page.locator('main')).not.toHaveAttribute('aria-busy','true')
    await expect(active).toHaveText('Профиль')
  }
  await page.locator('#language-switch').click()
  await expect(active).toHaveText('Profile')
  await expect(dock.locator('a')).toHaveCount(3)
  await expect.poll(async()=>{
    const indicator = await dock.locator('.nav-indicator').boundingBox(), link = await active.boundingBox()
    return indicator && link ? Math.abs(indicator.x-link.x)+Math.abs(indicator.width-link.width) : 100
  }).toBeLessThan(2)
  for (const width of [320,390,768,1440]) {
    await page.setViewportSize({width,height:844})
    expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    if (width <= 760) {
      await expect(dock).toBeVisible()
      const bounds = await dock.boundingBox()
      expect(bounds.x).toBeGreaterThan(0)
      expect(bounds.y+bounds.height).toBeLessThan(844)
    } else await expect(dock).not.toBeVisible()
  }
})

test('elastic controls follow a drag, spring back without clicking, and respect reduced motion',async({page})=>{
  const errors=[]; page.on('pageerror',error=>errors.push(error.message))
  await page.setViewportSize({width:390,height:844})
  await page.goto('/')
  const control = page.locator('.hero-actions .button')
  await control.hover()
  // Hover can start native smooth scrolling while the hero finishes appearing.
  // End that scroll before taking coordinates for the manual pointer gesture.
  await control.evaluate(element => element.scrollIntoView({ behavior:'instant', block:'center' }))
  const box = await control.boundingBox(), x = box.x+box.width/2, y = box.y+box.height/2
  await page.mouse.move(x,y)
  await page.mouse.down()
  await page.mouse.move(x+90,y+18,{steps:8})
  await expect(control).toHaveAttribute('data-elastic','held')
  await expect.poll(()=>control.evaluate(element=>parseFloat(getComputedStyle(element).translate))).toBeGreaterThan(10)
  await page.mouse.up()
  await expect(page).toHaveURL(/\/$/)
  await expect(control).not.toHaveAttribute('data-elastic')
  await expect.poll(()=>control.evaluate(element=>element.getAnimations().some(animation=>animation.playState==='running'))).toBe(false)
  await expect(control).toHaveCSS('translate','none')
  await expect(control).toHaveCSS('scale','none')
  await control.focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/catalog$/)
  await expect(page.locator('main')).not.toHaveAttribute('aria-busy','true')

  await page.emulateMedia({reducedMotion:'reduce'})
  await page.locator('.mobile-nav a[data-nav=profile]').click()
  await expect(page.locator('main')).not.toHaveAttribute('aria-busy','true')
  const login = page.locator('main [data-action=login]')
  await login.hover()
  await page.mouse.down()
  await expect(login).not.toHaveAttribute('data-elastic')
  await page.mouse.up()
  await expect(page.locator('#modal')).toBeVisible()
  expect(await page.evaluate(()=>document.getAnimations().some(animation=>animation.playState==='running' && animation.effect.getTiming().duration>1))).toBe(false)
  await page.keyboard.press('Escape')
  await expect(page.locator('#modal')).not.toBeVisible()
  expect(errors).toEqual([])
})

test('touch drags stretch the dock while vertical gestures keep native page scrolling',async({browser})=>{
  const context = await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true})
  try {
    const page = await context.newPage(), cdp = await context.newCDPSession(page)
    await page.goto('http://127.0.0.1:3100/catalog')
    await expect(page.locator('main')).not.toHaveAttribute('aria-busy','true')
    const profile = page.locator('.mobile-nav a[data-nav=profile]')
    const box = await profile.boundingBox(), x = box.x+box.width/2, y = box.y+box.height/2
    const touch = (type,x,y) => cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x,y}]})
    await touch('touchStart',x,y)
    for (let step=1;step<=8;step++) await touch('touchMove',x-step*9,y)
    await expect(profile).toHaveAttribute('data-elastic','held')
    await expect.poll(()=>profile.evaluate(element=>parseFloat(getComputedStyle(element).translate))).toBeLessThan(-10)
    await touch('touchEnd',x-72,y)
    await expect(page).toHaveURL(/\/catalog$/)
    await expect(profile).not.toHaveAttribute('data-elastic')
    await expect.poll(()=>profile.evaluate(element=>element.getAnimations().some(animation=>animation.playState==='running'))).toBe(false)
    await profile.tap()
    await expect(page).toHaveURL(/\/me$/)
    await page.goto('http://127.0.0.1:3100/catalog')
    await expect.poll(()=>page.locator('main').evaluate(main=>main.getAnimations().some(animation=>animation.playState==='running'))).toBe(false)
    const button = page.locator('.card-watch').first(), bounds = await button.boundingBox()
    const sx = bounds.x+bounds.width/2, sy = bounds.y+bounds.height/2
    await touch('touchStart',sx,sy)
    for (let step=1;step<=10;step++) await touch('touchMove',sx,sy-step*16)
    await touch('touchEnd',sx,sy-160)
    await expect.poll(()=>page.evaluate(()=>scrollY)).toBeGreaterThan(50)
    await expect(page.locator('[data-elastic]')).toHaveCount(0)
    await expect(page.locator('#modal')).not.toBeVisible()
    await expect(page).toHaveURL(/\/catalog$/)
  } finally { await context.close() }
})
