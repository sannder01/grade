import {test,expect} from '@playwright/test'
test.use({locale:'ru-RU',reducedMotion:'no-preference'})
const ready=page=>expect(page.locator('main')).not.toHaveAttribute('aria-busy','true')
async function start(page,width=1440){
  const errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  await page.setViewportSize({width,height:width===390?844:1000})
  await page.route('**/api/**',route=>{
    const request=route.request(),path=new URL(request.url()).pathname
    if(request.method()!=='GET'){errors.push(request.method()+' '+path);return route.fulfill({status:405,json:{error:'No writes in scene fixtures'}})}
    if(path==='/api/me')return route.fulfill({json:{user:null}})
    if(path==='/api/catalog')return route.fulfill({json:{items:Array.from({length:4},(_,i)=>({id:String(i+1),name:'Frame '+(i+1),kind:'movie',year:2026,votes:0})),total:4,page:1,pages:1,externalSearch:false}})
    if(path==='/api/catalog/discover')return route.fulfill({json:{available:false,items:[],page:1,pages:0}})
    errors.push('Unexpected GET '+path);return route.fulfill({status:404,json:{error:'Unknown fixture'}})
  })
  await page.addInitScript(()=>{
    localStorage.setItem('grade:language','ru')
    const read=selector=>{
      const root=document.querySelector(selector)
      return {progress:parseFloat(getComputedStyle(root).getPropertyValue('--scene-type-progress')),hidden:root.hidden,inert:root.inert,
        masks:[...root.querySelectorAll(selector==='#section-menu'?'.track-label':selector==='#search-tray'?'#search-scene-title':'#auth-title')].map(node=>{
          const style=getComputedStyle(node),matrix=new DOMMatrixReadOnly(style.transform)
          return {clip:parseFloat(style.clipPath.replace(/^inset\(/,'')),y:matrix.f,x:matrix.e,sx:matrix.a,sy:matrix.d,children:node.childElementCount}
        })}
    }
    window.__sceneTypeProbe={read,async until(selector,predicate){
      const deadline=performance.now()+3000
      while(performance.now()<deadline){const value=read(selector);if(predicate(value))return value;await new Promise(requestAnimationFrame)}
      throw new Error('Expected scene state missing: '+selector+' '+JSON.stringify(read(selector)))
    }}
  })
  const response=await page.goto('/')
  expect(response.headers()['content-security-policy']).toContain('img-src')
  await ready(page);await page.evaluate(()=>document.fonts.ready)
  return errors
}
const read=(page,root)=>page.evaluate(root=>window.__sceneTypeProbe.read(root),root)
async function finalType(page,root){
  await expect.poll(async()=>{const frame=await read(page,root);return frame.masks.length>0&&frame.masks.every(mask=>Math.abs(mask.y)<.01&&Math.abs(mask.clip)<.01)}).toBe(true)
}
function geometry(frame){
  expect(frame.masks.length).toBeGreaterThan(0)
  for(const mask of frame.masks){
    expect(mask.children).toBe(0);expect(mask.y).toBeGreaterThanOrEqual(-.01);expect(mask.y).toBeLessThanOrEqual(8.01)
    expect(Math.abs(mask.x)).toBeLessThan(.01);expect(mask.sx).toBeCloseTo(1,4);expect(mask.sy).toBeCloseTo(1,4)
    expect(mask.clip).toBeGreaterThanOrEqual(-.01);expect(mask.clip).toBeLessThanOrEqual(100.01)
  }
}
function continuous(a,b){
  expect(b.progress).toBeCloseTo(a.progress,5)
  a.masks.forEach((mask,index)=>{expect(b.masks[index].y).toBeCloseTo(mask.y,3);expect(b.masks[index].clip).toBeCloseTo(mask.clip,3)})
}
const scenes=[{root:'#section-menu',trigger:'.menu-trigger'},{root:'#search-tray',trigger:'.search-trigger'}]

for(const width of [1440,390])test('scene typography reverses continuously without wrappers or zoom at '+width+'px',async({page})=>{
  const errors=await start(page,width)
  for(const {root,trigger} of scenes){
    const result=await page.evaluate(async({root,trigger})=>{
      const probe=window.__sceneTypeProbe,button=document.querySelector(trigger)
      button.focus();button.click()
      const opening=await probe.until(root,value=>value.progress>.25&&value.progress<.8)
      button.click()
      const reversed=probe.read(root),closedFocus=document.activeElement===button
      const closing=await probe.until(root,value=>value.progress<opening.progress-.08)
      button.click()
      const redirected=probe.read(root),final=await probe.until(root,value=>value.progress===1)
      return {opening,reversed,closing,redirected,final,closedFocus,activeHidden:Boolean(document.activeElement.closest('[hidden],[inert]')),mainInert:document.querySelector('main').inert}
    },{root,trigger})
    for(const frame of [result.opening,result.reversed,result.closing,result.redirected,result.final])geometry(frame)
    expect(result.opening.masks.some(mask=>mask.clip>1&&mask.clip<99&&mask.y>.1&&mask.y<7.9)).toBe(true)
    continuous(result.opening,result.reversed);continuous(result.closing,result.redirected)
    expect(result.closing.masks[0].y).toBeGreaterThan(result.opening.masks[0].y)
    expect(result.reversed.inert).toBe(true);expect(result.reversed.hidden).toBe(false)
    expect(result.closedFocus).toBe(true);expect(result.activeHidden).toBe(false);expect(result.mainInert).toBe(true)
    await finalType(page,root)
    if(root==='#section-menu')await expect(page.locator('.scene-nav a[data-nav=collections]')).toHaveAccessibleName('Подборки')
    else {await expect(page.locator('#search')).toBeFocused();await page.locator('#search').fill('Frame');await expect(page.locator('.frame-result')).toHaveCount(4)}
    await page.keyboard.press('Escape');await expect(page.locator(root)).toBeHidden()
    await expect(page.locator(trigger)).toBeFocused();await expect(page.locator('main')).toHaveJSProperty('inert',false)
    // Same JS turn: cancellation must pause the zero-progress opening timeline.
    await page.locator(trigger).evaluate(button=>{button.click();button.click()})
    await expect(page.locator(root)).toBeHidden()
    const stopped=await page.evaluate(async root=>{
      for(let i=0;i<4;i++)await new Promise(requestAnimationFrame)
      const {gsap}=await import('/assets/motion-vendor.js'),panel=document.querySelector(root)
      return {progress:window.__sceneTypeProbe.read(root).progress,hidden:panel.hidden,active:gsap.getTweensOf(panel).some(tween=>tween.isActive())}
    },root)
    expect(stopped).toEqual({progress:0,hidden:true,active:false});await expect(page.locator(trigger)).toBeFocused()
  }
  expect(errors).toEqual([])
})

test('language and auth replacement preserve headings, input focus and the return target',async({page})=>{
  const errors=await start(page)
  await page.evaluate(async()=>{
    document.querySelector('.menu-trigger').click()
    await window.__sceneTypeProbe.until('#section-menu',value=>value.progress>.2&&value.progress<.8)
    document.querySelector('#language-switch').click()
  })
  await expect(page.locator('html')).toHaveAttribute('lang','en')
  await expect(page.locator('.scene-nav a[data-nav=profile]')).toHaveAccessibleName('My collection')
  await finalType(page,'#section-menu');geometry(await read(page,'#section-menu'))
  await page.locator('.search-trigger').click();await expect(page.locator('#search')).toBeFocused()
  await page.locator('#search').fill('Frame');await expect(page.locator('.frame-result')).toHaveCount(4)
  await expect(page.locator('#search-scene-title')).toHaveText('A title on your mind.')
  await finalType(page,'#search-tray');geometry(await read(page,'#search-tray'))
  await page.keyboard.press('Escape');await expect(page.locator('#search-tray')).toBeHidden()
  await page.locator('.login-button').focus()
  const replacement=await page.evaluate(async()=>{
    const probe=window.__sceneTypeProbe
    document.querySelector('.login-button').click()
    const opening=await probe.until('#modal',value=>value.progress>.3&&value.progress<.85),previous=document.querySelector('#auth-title')
    document.querySelector('#modal').dispatchEvent(new Event('cancel',{cancelable:true}))
    const closing=await probe.until('#modal',value=>value.progress<opening.progress-.08)
    document.querySelector('.login-button').click()
    const reopened=probe.read('#modal')
    document.querySelector('[data-action=auth-switch]').click()
    return {closing,reopened,oldDetached:!previous.isConnected,focus:document.activeElement.name}
  })
  continuous(replacement.closing,replacement.reopened);expect(replacement.oldDetached).toBe(true);expect(replacement.focus).toBe('name')
  await expect(page.locator('#modal')).toHaveAccessibleName('Sign up')
  await page.locator('#auth-form [name=name]').fill('Scene viewer');await expect(page.locator('#auth-form [name=name]')).toHaveValue('Scene viewer')
  await finalType(page,'#modal');geometry(await read(page,'#modal'))
  await page.locator('[data-action=auth-switch]').click()
  await expect(page.locator('#modal')).toHaveAccessibleName('Sign in');await expect(page.locator('#auth-form [name=login]')).toBeFocused()
  await page.locator('#auth-form [name=login]').fill('scene_viewer');await expect(page.locator('#auth-form [name=login]')).toHaveValue('scene_viewer')
  geometry(await read(page,'#modal'))
  await page.keyboard.press('Escape');await expect(page.locator('#modal')).toBeHidden();await expect(page.locator('.login-button')).toBeFocused()
  // Pointer activation in WebKit may leave body focused before showModal().
  await page.evaluate(()=>{document.activeElement.blur();document.querySelector('.login-button').click();document.querySelector('#modal').dispatchEvent(new Event('cancel',{cancelable:true}))})
  await expect(page.locator('#modal')).toBeHidden();await expect(page.locator('.login-button')).toBeFocused()
  await page.locator('.menu-trigger').click();await page.locator('#language-switch').click()
  await expect(page.locator('html')).toHaveAttribute('lang','ru')
  await expect(page.locator('.scene-nav a[data-nav=profile]')).toHaveAccessibleName('Моя коллекция')
  await finalType(page,'#section-menu');await page.keyboard.press('Escape');await expect(page.locator('#section-menu')).toBeHidden()
  await ready(page);expect(errors).toEqual([])
})

test('live reduced motion settles masks and subsequent opens remain immediately readable',async({page})=>{
  const errors=await start(page,390)
  await page.evaluate(async()=>{document.querySelector('.menu-trigger').click();await window.__sceneTypeProbe.until('#section-menu',value=>value.progress>.15&&value.progress<.7)})
  await page.emulateMedia({reducedMotion:'reduce'});await finalType(page,'#section-menu')
  await page.keyboard.press('Escape');await expect(page.locator('#section-menu')).toBeHidden()
  for(const {root,trigger} of scenes){
    const value=await page.locator(trigger).evaluate((button,root)=>{document.activeElement.blur();button.click();return window.__sceneTypeProbe.read(root)},root)
    geometry(value);expect(value.progress).toBe(1);expect(value.masks.every(mask=>mask.clip===0&&mask.y===0)).toBe(true)
    await page.keyboard.press('Escape');await expect(page.locator(root)).toBeHidden();await expect(page.locator(trigger)).toBeFocused()
  }
  await page.emulateMedia({reducedMotion:'no-preference'});await page.locator('.login-button').focus()
  await page.evaluate(async()=>{document.querySelector('.login-button').click();await window.__sceneTypeProbe.until('#modal',value=>value.progress>.15&&value.progress<.7)})
  await page.emulateMedia({reducedMotion:'reduce'});await finalType(page,'#modal')
  expect(await page.locator('#modal').evaluate(async dialog=>{const {gsap}=await import('/assets/motion-vendor.js');return gsap.getTweensOf(dialog).some(tween=>tween.isActive())})).toBe(false)
  await page.locator('#auth-form [name=login]').fill('still_usable')
  await page.keyboard.press('Escape');await expect(page.locator('#modal')).toBeHidden();await expect(page.locator('.login-button')).toBeFocused()
  const reopened=await page.locator('.login-button').evaluate(button=>{button.click();return window.__sceneTypeProbe.read('#modal')})
  geometry(reopened);expect(reopened.progress).toBe(1);expect(reopened.masks.every(mask=>mask.clip===0&&mask.y===0)).toBe(true)
  await page.keyboard.press('Escape');await expect(page.locator('#modal')).toBeHidden()
  await expect(page.locator('main')).toHaveJSProperty('inert',false);expect(errors).toEqual([])
})
