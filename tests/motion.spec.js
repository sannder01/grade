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
