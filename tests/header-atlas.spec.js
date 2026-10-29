import {test,expect} from '@playwright/test'
import {writeFile} from 'node:fs/promises'

test.use({locale:'ru-RU',reducedMotion:'no-preference'})
const origin='/catalog?view=grade&sort=new'
const panel=(page,kind='menu')=>page.locator(kind==='menu'?'#section-menu':'#search-tray')
const atlas=(page,kind='menu')=>page.locator(`[data-scene-atlas="${kind}"]`)
const ready=page=>expect(page.locator('main')).not.toHaveAttribute('aria-busy','true')
const curtain=page=>page.locator('body > .scene-atlas-curtain')

async function fixtures(page){
  const audit={errors:[],writes:[],unexpected:[]},control={failModule:false,failCSS:false,failImages:false,holdCollections:false},pending=[]
  control.release=()=>{control.holdCollections=false;for(const resolve of pending.splice(0))resolve()}
  page.on('pageerror',error=>audit.errors.push(error.message))
  // Remote font availability belongs to visual QA; these semantic fixtures also
  // verify the real fallback typography without an Internet-dependent wait.
  await page.route('https://fonts.googleapis.com/**',route=>route.abort())
  await page.route('https://fonts.gstatic.com/**',route=>route.abort())
  await page.route('**/api/**',async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname
    if(request.method()!=='GET'){audit.writes.push(request.method()+' '+path);return route.fulfill({status:405,json:{error:'Atlas fixtures never write data'}})}
    const english=request.headers()['accept-language']==='en'
    const items=Array.from({length:24},(_,index)=>({id:String(index+1),name:english?`Frame ${index+1}`:`Кадр ${index+1}`,kind:'movie',year:2026-index,
      poster:`/atlas-fixtures/poster-${index+1}.svg`,backdrop:`/atlas-fixtures/backdrop-${index+1}.svg`,votes:0,average:null}))
    if(path==='/api/me')return route.fulfill({json:{user:null}})
    if(path==='/api/catalog'){
      if(control.holdCollections&&(['Фантастика','Драма'].includes(url.searchParams.get('q'))||url.searchParams.get('kind')==='anime'))await new Promise(resolve=>pending.push(resolve))
      return route.fulfill({json:{items,total:24,page:1,pages:1,externalSearch:false}}).catch(()=>{})
    }
    if(path==='/api/catalog/discover')return route.fulfill({json:{available:false,items:[],page:1,pages:0}})
    if(/^\/api\/titles\/\d+\/discussion$/.test(path))return route.fulfill({json:{items:[],total:0,page:1,pages:0}})
    if(/^\/api\/titles\/\d+\/(trailer|external-ratings)$/.test(path))return route.fulfill({json:{status:'not_found'}})
    if(/^\/api\/titles\/\d+$/.test(path)){
      const item=items[Number(path.split('/').at(-1))-1]
      return route.fulfill({json:{...item,original_name:'Frame',runtime:'100 мин',genres:['Драма'],description:'История из коллекции',watched:false,planned:false,my_score:null}})
    }
    audit.unexpected.push(path);return route.fulfill({status:404,json:{error:'Unknown atlas fixture'}})
  })
  await page.route('**/atlas-fixtures/*.svg',route=>{
    if(control.failImages)return route.fulfill({status:404,body:'Poster unavailable'})
    const index=Number(new URL(route.request().url()).pathname.match(/(\d+)\.svg$/)[1]),backdrop=route.request().url().includes('backdrop')
    const colors=['#903e40','#34657a','#b39351','#526c55','#695c91','#9b6b47']
    return route.fulfill({contentType:'image/svg+xml',body:`<svg xmlns="http://www.w3.org/2000/svg" width="${backdrop?1200:300}" height="${backdrop?675:450}"><rect width="100%" height="100%" fill="${colors[index%6]}"/><path d="M0 300 300 50V450H0Z" fill="#eee7db"/><text x="25" y="70" font-size="36">${index}</text></svg>`})
  })
  await page.route('**/header-atlas.js*',route=>control.failModule?route.abort():route.continue())
  await page.route('**/header-scenes.css*',route=>control.failCSS?route.abort():route.continue())
  await page.addInitScript(()=>{
    localStorage.setItem('grade:language','ru')
    const native=HTMLCanvasElement.prototype.getContext
    // D is a DOM/Flip enhancement. Existing title-dissolve.spec.js owns real GPU
    // image acceptance; these semantic cases exercise its ordinary DOM fallback.
    HTMLCanvasElement.prototype.getContext=function(type,...args){return /^webgl2?$|^experimental-webgl$/.test(type)?null:native.call(this,type,...args)}
    const probe=window.__atlasProbe={states:[],frames:[],commits:[],peakLayers:0,original:null,tracked:false,scanning:false}
    const scales=node=>{
      const style=getComputedStyle(node),matrix=new DOMMatrixReadOnly(style.transform),individual=style.scale==='none'?[1]:style.scale.split(' ').map(Number)
      return Math.max(Math.abs(Math.hypot(matrix.a,matrix.b)-1),Math.abs(Math.hypot(matrix.c,matrix.d)-1),...individual.map(n=>Math.abs(n-1)))
    }
    probe.snapshot=kind=>{
      const host=document.querySelector(`[data-scene-atlas="${kind}"]`)
      probe.original={host,nodes:[...host.querySelectorAll('.scene-atlas-tile')],images:[...host.querySelectorAll('.scene-atlas-tile img')]}
      probe.states=[];probe.frames=[];probe.commits=[];probe.tracked=true
    }
    probe.restored=()=>{
      const original=probe.original;if(!original)return false
      const nodes=[...original.host.querySelectorAll('.scene-atlas-tile')]
      return nodes.length===6&&nodes.every((node,index)=>node===original.nodes[index]&&node.querySelector('img')===original.images[index]&&node.isConnected)
    }
    const scan=()=>{
      const layer=document.querySelector('body > .scene-atlas-curtain')
      if(!layer){probe.scanning=false;return}
      const original=probe.original,first=layer.querySelector('.scene-atlas-tile'),box=first?.getBoundingClientRect()
      probe.frames.push({phase:layer.dataset.atlasState,at:performance.now(),box:box?.toJSON(),same:!!original&&original.nodes.every(node=>layer.contains(node)),
        imageScale:Math.max(0,...[...layer.querySelectorAll('img')].map(scales)),mainInert:document.querySelector('main').inert})
      if(probe.frames.length<240)requestAnimationFrame(scan);else probe.scanning=false
    }
    document.addEventListener('grade:atlas-state',event=>{
      const node=event.target;if(!node.matches('.scene-atlas-curtain'))return
      const original=probe.original
      probe.states.push({phase:node.dataset.atlasState,route:node.dataset.atlasRoute,at:performance.now(),same:!!original&&original.nodes.every(item=>node.contains(item)),
        count:node.querySelectorAll('.scene-atlas-tile').length,reason:node.dataset.atlasReason})
      if(!probe.scanning&&node.isConnected){probe.scanning=true;requestAnimationFrame(scan)}
    })
    const observe=()=>new MutationObserver(records=>{
      probe.peakLayers=Math.max(probe.peakLayers,document.querySelectorAll('body > .scene-atlas-curtain').length)
      if(probe.tracked&&records.some(record=>record.target===document.querySelector('main')&&record.type==='childList')){
        probe.commits.push({at:performance.now(),heading:document.querySelector('main h1')?.textContent,phase:document.querySelector('.scene-atlas-curtain')?.dataset.atlasState})
      }
    }).observe(document.body,{subtree:true,childList:true})
    if(document.body)observe();else document.addEventListener('DOMContentLoaded',observe,{once:true})
  })
  return {audit,control}
}
async function open(page,path=origin){
  const response=await page.goto(path)
  expect(response.headers()['content-security-policy']).toMatch(/img-src[^;]*https:\/\/image\.tmdb\.org/)
  await ready(page);await page.evaluate(()=>Promise.race([document.fonts.ready,new Promise(resolve=>setTimeout(resolve,2000))]))
}
async function physicalClick(page,locator){
  const box=await locator.boundingBox(),size=page.viewportSize()
  expect(box).not.toBeNull()
  const left=Math.max(1,box.x),right=Math.min(size.width-1,box.x+box.width),top=Math.max(1,box.y),bottom=Math.min(size.height-1,box.y+box.height)
  expect(right-left).toBeGreaterThan(2);expect(bottom-top).toBeGreaterThan(2)
  await page.mouse.click((left+right)/2,(top+bottom)/2)
}
async function menu(page){
  await physicalClick(page,page.locator('.menu-trigger'));await expect(panel(page)).toBeVisible()
  await expect.poll(()=>panel(page).evaluate(node=>{
    const clip=getComputedStyle(node).clipPath,values=clip.match(/-?[\d.]+/g)||[]
    return clip==='none'||values.length>0&&values.every(value=>Math.abs(Number(value))<.01)
  })).toBe(true)
}
async function decoded(page,kind='menu',section){
  const host=atlas(page,kind)
  if(section)await expect(host).toHaveAttribute('data-atlas-section',section)
  await expect(host).toHaveAttribute('data-atlas-state','ready')
  await expect(host.locator('.scene-atlas-tile')).toHaveCount(6)
  await expect.poll(()=>host.locator('.scene-atlas-tile img').evaluateAll(images=>images.length===6&&images.every(img=>img.complete&&img.naturalWidth>0))).toBe(true)
  // Observe actual stable frames, not an assumed CSS animation duration.
  await host.evaluate(async root=>{
    let previous=null,stable=0;const end=performance.now()+3000
    while(performance.now()<end){
      await new Promise(requestAnimationFrame)
      const boxes=[...root.querySelectorAll('.scene-atlas-tile')].map(node=>{const b=node.getBoundingClientRect();return[b.x,b.y,b.width,b.height]})
      stable=previous&&boxes.every((box,i)=>box.every((value,j)=>Math.abs(value-previous[i][j])<.01))?stable+1:0
      if(stable>=3)return;previous=boxes
    }
    throw new Error('Poster preview never reached stable geometry')
  })
}
async function geometry(page,kind='menu'){
  return atlas(page,kind).evaluate(host=>({host:host.getBoundingClientRect().toJSON(),tiles:[...host.querySelectorAll('.scene-atlas-tile')].map(node=>{
    const image=node.querySelector('img'),css=getComputedStyle(image),m=new DOMMatrixReadOnly(css.transform)
    return{box:node.getBoundingClientRect().toJSON(),scale:[Math.hypot(m.a,m.b),Math.hypot(m.c,m.d)],individual:css.scale,focusable:node.tabIndex>=0||image.tabIndex>=0}
  })}))
}
async function released(page){
  await expect(curtain(page)).toHaveCount(0);await ready(page)
  await expect(page.locator('main')).toHaveJSProperty('inert',false)
  await expect.poll(()=>page.locator('main').evaluate(node=>Math.abs(Number(getComputedStyle(node).opacity)-1))).toBeLessThan(.001)
  expect(await page.evaluate(()=>Boolean(document.activeElement.closest('[hidden],[inert]')))).toBe(false)
  expect(await page.evaluate(()=>document.documentElement.style.overflow)).not.toBe('hidden')
}
async function savedProof(page,testInfo,name){
  const proof=await page.evaluate(()=>({states:window.__atlasProbe.states,frames:window.__atlasProbe.frames,commits:window.__atlasProbe.commits,peakLayers:window.__atlasProbe.peakLayers,restored:window.__atlasProbe.restored()}))
  const path=testInfo.outputPath(name+'.json');await writeFile(path,JSON.stringify(proof,null,2));await testInfo.attach(name,{path,contentType:'application/json'});return proof
}
const clean=audit=>expect(audit).toEqual({errors:[],writes:[],unexpected:[]})

test('six decoded poster previews follow pointer and keyboard selection without zoom or moving the layout',async({page})=>{
  const {audit}=await fixtures(page);await open(page);await menu(page);await decoded(page)
  const before=await geometry(page)
  await page.locator('.scene-nav a[data-nav=collections]').hover();await decoded(page,'menu','collections')
  await page.locator('.scene-nav a[data-nav=collections]').focus();await page.keyboard.press('ArrowRight')
  await expect(page.locator('.scene-nav a[data-nav=catalog]')).toBeFocused();await decoded(page,'menu','catalog')
  const after=await geometry(page)
  for(let i=0;i<6;i++){
    for(const key of ['x','y','width','height'])expect(after.tiles[i].box[key]).toBeCloseTo(before.tiles[i].box[key],1)
    expect(after.tiles[i].scale).toEqual([1,1]);expect(after.tiles[i].individual).toBe('none');expect(after.tiles[i].focusable).toBe(false)
  }
  expect(await atlas(page).getAttribute('aria-hidden')).toBe('true')
  await page.keyboard.press('Escape');await expect(panel(page)).toBeHidden();await expect(page.locator('.menu-trigger')).toBeFocused();await released(page);clean(audit)
})

test('the same six real poster and image nodes cover a route, reveal it and return to their original header positions',async({page},testInfo)=>{
  const {audit}=await fixtures(page);await open(page)
  await page.evaluate(()=>scrollTo({top:430,behavior:'instant'}));const scroll=await page.evaluate(()=>scrollY)
  await menu(page)
  const headerGeometry=await page.evaluate(()=>({
    header:document.querySelector('.track-header').getBoundingClientRect().toJSON(),
    inner:document.querySelector('.header-inner').getBoundingClientRect().toJSON(),
    controls:[...document.querySelectorAll('.search-trigger,.menu-trigger,.login-button')].map(node=>node.getBoundingClientRect().toJSON())
  }))
  expect(headerGeometry.header.y).toBeCloseTo(0,1);expect(headerGeometry.inner.y).toBeCloseTo(0,1)
  for(const box of headerGeometry.controls){expect(box.top).toBeGreaterThanOrEqual(0);expect(box.bottom).toBeLessThanOrEqual(headerGeometry.header.bottom+1)}
  expect(Math.abs(await page.evaluate(()=>scrollY)-scroll)).toBeLessThan(3)
  await decoded(page);await page.evaluate(()=>window.__atlasProbe.snapshot('menu'))
  await physicalClick(page,page.locator('.scene-nav a[data-nav=collections]'))
  await expect(page).toHaveURL('/collections');await released(page)
  const proof=await savedProof(page,testInfo,'actual-atlas-node-handoff')
  expect(proof.states.map(state=>state.phase)).toEqual(expect.arrayContaining(['covering','covered','revealing','disposed']))
  expect(proof.states.filter(state=>['covering','covered','revealing'].includes(state.phase)).every(state=>state.same&&state.count===6)).toBe(true)
  expect(proof.restored).toBe(true);expect(proof.peakLayers).toBe(1)
  const covering=proof.frames.filter(frame=>frame.phase==='covering')
  expect(covering.length).toBeGreaterThan(2)
  expect(Math.max(...covering.map(frame=>frame.box.width))-Math.min(...covering.map(frame=>frame.box.width))).toBeGreaterThan(20)
  expect(proof.frames.every(frame=>frame.same&&frame.mainInert&&frame.imageScale<.001&&frame.box.width>0&&Number.isFinite(frame.box.x+frame.box.y))).toBe(true)
  const covered=proof.states.find(state=>state.phase==='covered')
  expect(proof.commits.some(commit=>commit.at>=covered.at)).toBe(true)
  await page.goBack();await ready(page);await expect(page).toHaveURL(origin);await expect(panel(page)).toBeVisible()
  await expect(page.locator('.scene-nav a[data-nav=collections]')).toBeFocused()
  expect(Math.abs(await page.evaluate(()=>scrollY)-scroll)).toBeLessThan(3)
  expect(await page.evaluate(()=>window.__atlasProbe.restored())).toBe(true)
  await page.keyboard.press('Escape');await expect(panel(page)).toBeHidden();await released(page);clean(audit)
})

test('competing route clicks, early Back and Escape leave one latest page with no curtain or focus leak',async({page},testInfo)=>{
  const {audit,control}=await fixtures(page);await open(page);await menu(page);await decoded(page)
  await page.evaluate(()=>window.__atlasProbe.snapshot('menu'))
  await physicalClick(page,page.locator('.scene-nav a[data-nav=collections]'))
  await expect(curtain(page)).toHaveAttribute('data-atlas-state','covering')
  await physicalClick(page,page.locator('.scene-nav a[data-nav=catalog]'))
  await expect(page).toHaveURL('/catalog');await released(page)
  expect(await page.evaluate(()=>window.__atlasProbe.restored())).toBe(true)
  control.holdCollections=true
  try{
    await menu(page);await decoded(page)
    await physicalClick(page,page.locator('.scene-nav a[data-nav=collections]'))
    await expect(curtain(page)).toHaveAttribute('data-atlas-state','covering')
    await page.goBack();await expect(page).toHaveURL('/catalog');await ready(page)
    control.release()
    await expect(panel(page)).toBeVisible();await page.keyboard.press('Escape');await expect(panel(page)).toBeHidden();await released(page)
    await menu(page);await decoded(page)
    await physicalClick(page,page.locator('.scene-nav a[data-nav=collections]'))
    await expect(curtain(page)).toHaveAttribute('data-atlas-state','covering');await page.keyboard.press('Escape')
    await expect(page).toHaveURL('/collections');await expect(panel(page)).toBeHidden();await released(page)
    await expect(page.locator('.menu-trigger')).toBeFocused()
    const proof=await savedProof(page,testInfo,'cancelled-atlas-handoffs')
    expect(proof.states.some(state=>state.phase==='cancelling')).toBe(true);expect(proof.restored).toBe(true);expect(proof.peakLayers).toBeLessThanOrEqual(1)
    clean(audit)
  }finally{control.release()}
})

test('opening a search film and browser Back restores its query, result focus and scene scroll',async({page},testInfo)=>{
  await page.setViewportSize({width:1440,height:760})
  const {audit}=await fixtures(page);await open(page);await page.evaluate(()=>scrollTo({top:350,behavior:'instant'}));const scroll=await page.evaluate(()=>scrollY)
  await physicalClick(page,page.locator('.search-trigger'));await expect(page.locator('#search')).toBeFocused()
  await page.locator('#search').fill('личный кадр');await expect(page.locator('.frame-result')).toHaveCount(6);await decoded(page,'search')
  await page.locator('#search').press('ArrowDown');for(let i=0;i<4;i++)await page.keyboard.press('ArrowDown')
  const result=page.locator('.frame-result[href="/title/5"]');await expect(result).toBeFocused()
  await decoded(page,'search');await expect(atlas(page,'search')).toHaveAttribute('data-atlas-title','5')
  const sceneScroll=await panel(page,'search').evaluate(node=>node.scrollTop);expect(sceneScroll).toBeGreaterThan(0)
  await page.evaluate(()=>window.__atlasProbe.snapshot('search'));await page.keyboard.press('Enter')
  await expect(page).toHaveURL('/title/5');await ready(page);await released(page);await expect(page.locator('[data-title-heading]')).toHaveText('Кадр 5')
  expect(await page.evaluate(()=>window.__atlasProbe.states.filter(state=>state.phase==='covering').length)).toBe(0)
  await expect(page.locator('[data-title-backdrop]')).toBeVisible();await page.goBack();await ready(page)
  await expect(page).toHaveURL(origin);await expect(panel(page,'search')).toBeVisible();await expect(page.locator('#search')).toHaveValue('личный кадр');await expect(result).toBeFocused()
  expect(Math.abs(await panel(page,'search').evaluate(node=>node.scrollTop)-sceneScroll)).toBeLessThan(3)
  expect(Math.abs(await page.evaluate(()=>scrollY)-scroll)).toBeLessThan(3)
  await page.keyboard.press('Escape');await expect(panel(page,'search')).toBeHidden();await released(page);clean(audit)
  await savedProof(page,testInfo,'restored-search-context')
})

test('390 and English 320 scenes stay sequential and usable with reduced motion and optional-resource failures',async({page})=>{
  test.setTimeout(90000)
  const {audit,control}=await fixtures(page);await page.setViewportSize({width:390,height:844});await open(page);await menu(page);await decoded(page)
  for(const width of [390,320]){
    await page.setViewportSize({width,height:844})
    if(width===320){await page.locator('#language-switch').focus();await page.keyboard.press('Enter');await expect(page.locator('html')).toHaveAttribute('lang','en');await ready(page);await expect(panel(page)).toBeVisible();await decoded(page)}
    const layout=await page.evaluate(()=>{
      const panel=document.querySelector('#section-menu'),nav=panel.querySelector('.scene-nav').getBoundingClientRect(),preview=panel.querySelector('.scene-atlas').getBoundingClientRect()
      return {nav:nav.toJSON(),preview:preview.toJSON(),overflow:panel.scrollWidth-panel.clientWidth,controls:[...document.querySelectorAll('.search-trigger,.menu-trigger,.login-button,#section-menu .scene-close,#section-menu .scene-nav a')].map(node=>node.getBoundingClientRect().toJSON())}
    })
    expect(layout.overflow).toBeLessThanOrEqual(1);expect(layout.preview.top).toBeGreaterThanOrEqual(layout.nav.bottom-1)
    for(const box of layout.controls){expect(box.width).toBeGreaterThanOrEqual(44);expect(box.height).toBeGreaterThanOrEqual(44)}
    await page.locator('#language-switch').focus();expect(await panel(page).evaluate(node=>node.scrollTop)).toBeGreaterThan(0)
  }
  await page.keyboard.press('Escape');await expect(panel(page)).toBeHidden();await released(page)
  await page.emulateMedia({reducedMotion:'reduce'});await menu(page);await decoded(page)
  await page.locator('.scene-nav a[data-nav=collections]').focus();await page.keyboard.press('Enter');await expect(page).toHaveURL('/collections');await released(page)
  expect(await page.evaluate(()=>window.__atlasProbe.states.some(state=>state.phase==='covering'))).toBe(false)
  await page.emulateMedia({reducedMotion:'no-preference'});await menu(page);await decoded(page)
  await page.locator('.scene-nav a[data-nav=catalog]').focus();await page.keyboard.press('Enter');await expect(curtain(page)).toHaveAttribute('data-atlas-state','covering')
  await page.emulateMedia({reducedMotion:'reduce'});await expect(page).toHaveURL('/catalog');await released(page)
  for(const failure of ['failModule','failCSS','failImages']){
    control[failure]=true;await page.emulateMedia({reducedMotion:'no-preference'});await open(page);await menu(page)
    if(failure==='failImages'){await expect(atlas(page)).toHaveAttribute('data-atlas-state','empty');await expect(atlas(page).locator('.scene-atlas-tile[data-missing=true]')).toHaveCount(6)}
    else await expect(atlas(page).locator('.scene-atlas-tile')).toHaveCount(0)
    await page.locator('.scene-nav a[data-nav=collections]').focus();await page.keyboard.press('Enter');await expect(page).toHaveURL('/collections');await released(page)
    await physicalClick(page,page.locator('.search-trigger'));await page.locator('#search').fill('Frame');await expect(page.locator('.frame-result')).toHaveCount(6)
    await page.keyboard.press('Escape');await expect(panel(page,'search')).toBeHidden();await released(page)
    control[failure]=false
  }
  clean(audit)
})
