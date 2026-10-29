/*
 * Grade adapts ImageTilesMenu's snapshot -> reparent -> Flip -> content pattern.
 * https://github.com/codrops/ImageTilesMenu/blob/main/js/index.js
 * MIT License. Copyright (c) 2009 - 2022 Codrops.
 * Full notice: /assets/image-tiles-menu.LICENSE.txt.
 * Native links, real Grade images and interruptible timelines replace the demo's
 * Splitting wrappers, hover zoom and isAnimating input lock. No WebGL or RAF loop.
 */
import {gsap,Flip} from './assets/motion-vendor.js'
import {api,icon} from './ui.js'
import {t,language} from './i18n.js'

gsap.registerPlugin(Flip)
const controllers=new WeakMap(), CACHE_LIMIT=24, POOL_LIMIT=24
const copy=(ru,en)=>language()==='en'?en:ru
const normalizeRoute=value=>{
  if(value==null || String(value).trim()==='')return null
  try{const url=new URL(value,location.href);return url.origin===location.origin?url.pathname+url.search:null}catch{return null}
}
const visible=node=>{
  if(!node?.isConnected || node.closest('[hidden]'))return false
  const box=node.getBoundingClientRect(),style=getComputedStyle(node)
  if(!box.width||!box.height||style.display==='none'||style.visibility==='hidden'||Number(style.opacity)<.05)return false
  let left=Math.max(0,box.left),top=Math.max(0,box.top),right=Math.min(innerWidth,box.right),bottom=Math.min(innerHeight,box.bottom)
  for(const ancestor of [node,node.closest('.scene-panel,.scene-atlas-curtain')].filter(Boolean)){
    const inset=/^inset\(([^)]+)\)/.exec(getComputedStyle(ancestor).clipPath)
    if(!inset)continue
    const rect=ancestor.getBoundingClientRect(),parts=inset[1].split('round')[0].trim().split(/\s+/)
    const values=[parts[0],parts[1]||parts[0],parts[2]||parts[0],parts[3]||parts[1]||parts[0]]
    const px=(value,size)=>parseFloat(value)*(value.endsWith('%')?size/100:1)||0
    left=Math.max(left,rect.left+px(values[3],rect.width));top=Math.max(top,rect.top+px(values[0],rect.height))
    right=Math.min(right,rect.right-px(values[1],rect.width));bottom=Math.min(bottom,rect.bottom-px(values[2],rect.height))
  }
  return right-left>2 && bottom-top>2
}
const imageURL=value=>{
  if(!String(value||'').trim())return ''
  try{const url=new URL(String(value||''),location.href);return url.origin===location.origin || url.protocol==='https:'&&url.hostname==='image.tmdb.org'?url.href:''}catch{return ''}
}
const unique=items=>[...new Map(items.filter(Boolean).map(item=>[String(item.id),item])).values()].slice(0,POOL_LIMIT)
const itemData=item=>{
  if(!item || item.id==null)return null
  const poster=imageURL(item.poster)
  return poster?{id:String(item.id),name:String(item.name||''),poster,year:item.year||'',kind:item.kind||'',collection:!!item.collection,catalog:!!item.catalog}:null
}

export function createHeaderAtlas({menuPanel,searchPanel,onCovered}={}){
  if(menuPanel && controllers.has(menuPanel))return controllers.get(menuPanel)
  const owner=new AbortController(),signal=owner.signal
  const reduced=matchMedia('(prefers-reduced-motion: reduce)'),forced=matchMedia('(forced-colors: active)')
  const surfaces=new Map(),cache=new Map(),sessionStatus=new WeakMap()
  let activePanel=null,selectedMenu='home',searchItems=[],searchQuery='',searchId=''
  let pool=[],catalogRequest=null,catalogAttempted=false,requestAbort=null,destroyed=false,currentSession=null,currentDispose=null
  const calm=()=>reduced.matches||forced.matches||document.hidden

  function publish(node,values){
    let changed=false
    for(const[key,value]of Object.entries(values)){const text=String(value);if(node.dataset[key]!==text){node.dataset[key]=text;changed=true}}
    if(changed)node.dispatchEvent(new CustomEvent('grade:atlas-state',{bubbles:true,detail:{phase:node.dataset.atlasState||'',kind:node.dataset.sceneAtlas||'route',...node.dataset}}))
  }
  function tileImage(tile){
    const existing=tile.querySelector('img')
    if(existing)return existing
    const image=document.createElement('img');image.alt='';image.decoding='async';image.draggable=false
    image.addEventListener('error',()=>{
      // The app's capture-phase image fallback may already have removed img.
      // Keep this slot finished, and recreate its image on the next commit.
      const current=tile.querySelector('img')
      if(current&&current!==image)return
      tile.dataset.missing='true';delete tile.dataset.scenePreviewTitle;delete tile.dataset.active
    })
    tile.prepend(image)
    return image
  }
  function makeSurface(panel,kind){
    const host=panel?.querySelector(`.scene-atlas[data-scene-atlas="${kind}"]`)
    if(!host)return
    const grid=document.createElement('div');grid.className='scene-atlas-grid'
    const tiles=Array.from({length:6},(_,index)=>{
      const tile=document.createElement('div');tile.className='scene-atlas-tile';tile.dataset.missing='true';tile.dataset.atlasIndex=String(index)
      tileImage(tile);tile.insertAdjacentHTML('beforeend',icon('brand','scene-atlas-mark'));grid.append(tile);return tile
    })
    const caption=document.createElement('div');caption.className='scene-atlas-caption'
    const heading=document.createElement('h3'),meta=document.createElement('p');meta.className='scene-atlas-meta';caption.append(heading,meta)
    host.replaceChildren(grid,caption)
    const surface={panel,kind,host,grid,tiles,caption,heading,meta,revision:0,tween:null,open:false,borrowed:false,model:null}
    surfaces.set(panel,surface);publish(host,{atlasState:'empty',atlasSection:kind==='menu'?'home':'search',atlasOpen:'false'})
    return surface
  }
  const menu=makeSurface(menuPanel,'menu'),search=makeSurface(searchPanel,'search')
  function gather(){
    const items=[]
    for(const node of document.querySelectorAll('#main .poster-placeholder[data-poster-id]')){
      const image=node.querySelector('img'),poster=imageURL(image?.currentSrc||image?.getAttribute('src'))
      if(!poster)continue
      const card=node.closest('.title-card,.cinema-film-link,.profile-review,.onboard-card,.collection-card,.title-film-scene')
      const name=card?.querySelector('.card-title,.cinema-film-caption strong,.onboard-info h2,.profile-review h3')?.textContent.trim()
        || (card?.classList.contains('title-film-scene')?card.querySelector('h1')?.textContent.trim():'')
        || image.alt.replace(/^(?:Постер|Poster)\s*:\s*/i,'').trim()
      const metadata=card?.querySelector('.card-meta,.cinema-film-caption small')?.textContent||''
      items.push({id:node.dataset.posterId,name,poster,year:metadata.match(/\b(?:19|20)\d{2}\b/)?.[0]||'',collection:!!node.closest('.collection-card'),catalog:!!node.closest('.title-card')})
    }
    // Fresh DOM metadata wins over an older optional response after language changes.
    pool=unique([...pool,...items]);return pool
  }
  function preload(url){
    if(!url)return Promise.resolve(false)
    const old=cache.get(url)
    if(old){cache.delete(url);cache.set(url,old);return old.promise}
    const entry={promise:null,cancel:null,pending:true}
    entry.promise=new Promise(resolve=>{
      const image=new Image();let complete=false
      const finish=value=>{if(complete)return;complete=true;clearTimeout(timer);entry.pending=false;image.onload=image.onerror=null;resolve(value)}
      const cancel=()=>{image.removeAttribute('src');finish(false)}
      const timer=setTimeout(cancel,3500);entry.cancel=cancel
      image.onload=()=>Promise.resolve(image.decode?.()).catch(()=>{}).then(()=>finish(image.naturalWidth>0))
      image.onerror=()=>finish(false);image.src=url
    })
    cache.set(url,entry)
    while(cache.size>CACHE_LIMIT){const[key,entry]=cache.entries().next().value;cache.delete(key);if(entry.pending)entry.cancel()}
    return entry.promise
  }
  function clearPreviewTween(surface,settle=true){
    surface.tween?.kill();surface.tween=null
    if(settle && !surface.borrowed)gsap.set([...surface.tiles,surface.caption],{clearProps:'opacity,transform,clipPath'})
  }
  function render(surface,model){
    if(!surface || destroyed || surface.borrowed)return
    surface.model=model
    if(!surface.heading.textContent){surface.heading.textContent=model.title;surface.meta.textContent=model.meta}
    const revision=++surface.revision
    clearPreviewTween(surface,false)
    publish(surface.host,{atlasSection:model.section,atlasState:model.items.length?'loading':'empty'})
    const commit=(loaded=[])=>{
      if(destroyed||revision!==surface.revision||surface.borrowed)return false
      for(let i=0;i<surface.tiles.length;i++){
        const tile=surface.tiles[i],image=tileImage(tile),item=model.items[i]
        delete tile.dataset.scenePreviewTitle;delete tile.dataset.active
        if(item&&loaded[i]){
          image.src=item.poster;tile.dataset.missing='false';tile.dataset.titleId=item.id
          if(item.id===model.activeId){tile.dataset.scenePreviewTitle=item.id;tile.dataset.active='true'}
        }else{image.removeAttribute('src');tile.dataset.missing='true';delete tile.dataset.titleId}
      }
      surface.heading.textContent=model.title;surface.meta.textContent=model.meta
      publish(surface.host,{atlasState:loaded.some(Boolean)?'ready':'empty',atlasTitle:model.activeId||''})
      return true
    }
    const finish=loaded=>{
      if(destroyed||revision!==surface.revision||surface.borrowed)return
      if(!surface.open || calm()) {commit(loaded);clearPreviewTween(surface);return}
      const targets=[...surface.tiles,surface.caption]
      surface.tween=gsap.timeline({onComplete:()=>{if(revision===surface.revision){surface.tween=null;gsap.set(targets,{clearProps:'opacity,transform,clipPath'})}}})
        .to(targets,{opacity:.35,y:-3,duration:.1,ease:'power2.out'})
        .call(()=>commit(loaded))
        .set(targets,{y:6,clipPath:'inset(5% 0% 0% 0%)'})
        .to(targets,{opacity:1,y:0,clipPath:'inset(0% 0% 0% 0%)',duration:.22,stagger:.012,ease:'power3.out'})
    }
    if(!model.items.length){finish([]);return}
    Promise.all(model.items.map(item=>preload(item.poster))).then(finish).catch(()=>finish([]))
  }
  function menuModel(section){
    const label=menuPanel?.querySelector(`.scene-nav a[data-nav="${section}"] .track-label`)?.textContent.trim()
      || t({'home':'Обзор','collections':'Подборки','catalog':'Каталог','profile':'Моя коллекция'}[section]||'Обзор')
    if(section==='profile')return{section,title:label,meta:copy('Ваши фильмы, оценки и заметки — в личной коллекции.','Your films, ratings and notes belong in your collection.'),items:[],activeId:''}
    const curated=pool.filter(item=>item.collection),catalog=pool.filter(item=>item.catalog)
    let items=section==='collections'?[...curated,...pool]:section==='catalog'?[...catalog.slice(6),...catalog,...pool.slice(6),...pool]:pool
    return{section,title:label,meta:section==='collections'?copy('Истории, собранные по настроению.','Stories collected by mood.'):section==='catalog'?copy('Фильмы, аниме и сериалы.','Films, anime and series.'):copy('Ещё одна точка входа в кино.','Another way into cinema.'),items:unique(items).slice(0,6),activeId:''}
  }
  function renderMenu(){if(menu)render(menu,menuModel(selectedMenu))}
  function renderSearch(){
    if(!search)return
    const active=searchItems.find(item=>item.id===searchId)||searchItems[0]
    if(active)searchId=active.id
    const ordered=active?[active,...searchItems.filter(item=>item.id!==active.id)].slice(0,6):[]
    const meta=active?[active.year,active.kind?copy({movie:'Фильм',anime:'Аниме',series:'Сериал'}[active.kind]||'Тайтл',{movie:'Film',anime:'Anime',series:'Series'}[active.kind]||'Title'):''].filter(Boolean).join(' · ')
      :searchQuery?copy(`По запросу «${searchQuery}» пока нет кадров.`,`No frames found for “${searchQuery}” yet.`):copy('Введите название фильма, аниме или сериала.','Enter a film, anime or series title.')
    render(search,{section:'search',title:active?.name||copy('Найти свой кадр.','Find your frame.'),meta,items:ordered,activeId:active?.id||''})
  }
  function ensureCatalog(){
    if(catalogAttempted||pool.length>=6||destroyed)return catalogRequest
    catalogAttempted=true;requestAbort=new AbortController()
    catalogRequest=api('/api/catalog?view=grade',{signal:requestAbort.signal}).then(data=>{
      if(destroyed)return
      pool=unique([...pool,...(Array.isArray(data.items)?data.items:[]).map(itemData)])
      gather();if(menu?.open&&!menu.borrowed)renderMenu()
    }).catch(()=>{if(!destroyed&&menu?.open&&!menu.borrowed&&pool.length===0)renderMenu()})
    return catalogRequest
  }
  function open(panel){
    if(destroyed)return
    activePanel=panel
    const surface=surfaces.get(panel);if(!surface)return
    surface.open=true;publish(surface.host,{atlasOpen:'true'})
    if(surface.borrowed)return
    if(surface===menu){selectedMenu=panel.querySelector('.scene-nav a.active')?.dataset.nav||selectedMenu;gather();renderMenu();if(selectedMenu!=='profile')ensureCatalog()}
    else renderSearch()
  }
  function close(panel){
    const surface=surfaces.get(panel);if(!surface)return
    surface.open=false;surface.revision++;clearPreviewTween(surface)
    publish(surface.host,{atlasOpen:'false'})
    if(activePanel===panel)activePanel=null
  }
  function results(items=[],query=''){
    if(destroyed)return
    searchItems=unique(items.map(itemData));searchQuery=String(query||'').slice(0,100)
    if(!searchItems.some(item=>item.id===searchId))searchId=searchItems[0]?.id||''
    renderSearch()
  }
  function select(event){
    const anchor=event.target.closest?.('.scene-nav a[data-nav],.frame-result[href]')
    if(!anchor || event.type==='pointerover'&&event.relatedTarget&&anchor.contains(event.relatedTarget))return
    if(menuPanel?.contains(anchor)){
      if(anchor.dataset.nav===selectedMenu)return
      selectedMenu=anchor.dataset.nav;gather();renderMenu();if(selectedMenu!=='profile')ensureCatalog()
    }else if(searchPanel?.contains(anchor)){
      const id=/^\/title\/(\d+)$/.exec(new URL(anchor.href,location.href).pathname)?.[1]
      if(!id||id===searchId||!searchItems.some(item=>item.id===id))return
      searchId=id;renderSearch()
    }
  }

  function prepare(sourceElement,route){
    const normalized=normalizeRoute(route),surface=surfaces.get(sourceElement?.closest?.('.scene-panel')||activePanel)
    const old=currentSession
    const film=normalized && /^\/title\/\d+$/.test(new URL(normalized,location.href).pathname)
    if(!normalized||film||destroyed||calm()||!surface||surface.panel.hidden){old?.cancel();return null}
    const usable=surface.tiles.filter(tile=>{const image=tile.querySelector('img');return visible(tile)&&image?.complete&&image.naturalWidth>0&&tile.dataset.missing==='false'})
    if(usable.length<2){old?.cancel();return null}
    const flipState=Flip.getState(surface.tiles,{props:'opacity,borderRadius',simple:true,kill:false})
    const opacity=old?.surface===surface?old.opacity():1
    const transferred=old?.surface===surface?old.transfer():null
    if(old&&!transferred)old.cancel()
    surface.revision++;clearPreviewTween(surface,false)
    const layer=document.createElement('div');layer.className='scene-atlas-curtain';layer.setAttribute('aria-hidden','true');layer.inert=true
    layer.style.backgroundColor='transparent';layer.style.opacity=String(opacity)
    const grid=document.createElement('div');grid.className='scene-atlas-curtain-grid'
    const caption=document.createElement('p');caption.className='scene-atlas-curtain-caption'
    const destination=new URL(normalized,location.href),sourceLink=sourceElement?.closest?.('a')
    const query=destination.searchParams.get('q')||searchQuery
    caption.textContent=surface.kind==='search'&&destination.pathname==='/catalog'
      ? query?copy(`Поиск: «${query}»`,`Search: “${query}”`):t('Каталог')
      : sourceLink?.querySelector('.track-label')?.textContent.trim()||sourceLink?.textContent.trim()||surface.heading.textContent
    layer.append(grid,caption)
    const records=transferred||surface.tiles.map(node=>{
      const marker=document.createComment('Grade atlas position');node.before(marker)
      return{node,marker,style:null}
    })
    let settled=false,cancelling=false,presented=false,phase='',coverTween=null,revealTween=null,cancelTween=null,coveredDone=false,finishedDone=false
    let resolveCovered,resolveFinished
    const covered=new Promise(resolve=>{resolveCovered=resolve}),finished=new Promise(resolve=>{resolveFinished=resolve})
    const session={route:normalized,covered,finished,present,cancel:cancelSession,surface,transfer,opacity:()=>Number(getComputedStyle(layer).opacity)}
    currentSession=session;currentDispose=()=>finish('disposed');surface.borrowed=true
    sessionStatus.set(session,()=>!settled&&!cancelling)
    function state(next,reason='') {phase=next;publish(layer,{atlasState:next,atlasRoute:normalized,atlasReason:reason})}
    function coverResult(value){if(!coveredDone){coveredDone=true;resolveCovered(value)}}
    function finishResult(value){if(!finishedDone){finishedDone=true;resolveFinished(value)}}
    function restore(){
      for(const{node,marker,style}of records){
        if(marker.parentNode){marker.replaceWith(node);if(style===null)node.removeAttribute('style');else node.setAttribute('style',style)}
        else node.remove()
      }
      surface.borrowed=false
      if(!destroyed){
        publish(surface.host,{atlasState:surface.open?'ready':'closed'})
        if(surface.open){if(surface===menu)renderMenu();else renderSearch()}
      }
    }
    function finish(reason='finished',keepNodes=false){
      if(settled)return finished
      settled=true;clearTimeout(watchdog);coverTween?.kill();revealTween?.kill();cancelTween?.kill()
      if(!keepNodes)restore()
      state('disposed',reason);layer.remove();coverResult(false);finishResult(reason)
      if(currentSession===session){currentSession=null;currentDispose=null}
      return finished
    }
    function transfer(){
      if(settled)return null
      finish('superseded',true);return records
    }
    function cancelSession(){
      if(settled||cancelling)return finished
      cancelling=true;coverTween?.kill();revealTween?.kill();coverResult(false);state('cancelling')
      if(!calm()&&layer.isConnected&&Number(getComputedStyle(layer).opacity)>.001)cancelTween=gsap.to(layer,{opacity:0,duration:.1,ease:'power2.out',onComplete:()=>finish('cancelled')})
      else finish('cancelled')
      return finished
    }
    function present(main){
      if(settled||cancelling||presented)return finished
      presented=true
      covered.then(ok=>{
        if(settled||cancelling)return
        if(!ok||!main?.isConnected){finish('target');return}
        state('revealing')
        revealTween=gsap.timeline({onComplete:()=>finish('finished')})
          .to(surface.tiles,{clipPath:'inset(0% 0% 100% 0%)',y:-6,opacity:0,duration:.45,ease:'power3.inOut',stagger:.018},0)
          .to(caption,{y:-6,opacity:0,duration:.22,ease:'power2.out'},0)
          .to(layer,{backgroundColor:'rgba(9,9,11,0)',opacity:0,duration:.25,ease:'power2.out'},.28)
      })
      return finished
    }
    const watchdog=setTimeout(()=>cancelSession(),10000)
    try{
      document.body.append(layer)
      for(const{node}of records){grid.append(node);gsap.set(node,{clearProps:'transform,opacity,clipPath,width,height,position,top,left',borderRadius:0})}
      state('covering')
      gsap.set(caption,{opacity:0,y:6,clipPath:'inset(100% 0% 0% 0%)'})
      coverTween=gsap.timeline({onComplete:()=>{
        if(settled||cancelling)return
        state('covered')
        try{onCovered?.(session)}catch{cancelSession();return}
        coverResult(true)
      }})
        .add(Flip.from(flipState,{targets:surface.tiles,duration:.65,ease:'power3.inOut',stagger:.018,scale:false,prune:true,props:'opacity,borderRadius'}),0)
        .to(layer,{backgroundColor:'#09090b',opacity:1,duration:.32,ease:'power2.out'},.1)
        .to(caption,{opacity:1,y:0,clipPath:'inset(0% 0% 0% 0%)',duration:.3,ease:'power3.out'},.35)
    }catch{finish('setup')}
    return session
  }
  function getTransition(route){const normalized=normalizeRoute(route);return currentSession?.route===normalized&&sessionStatus.get(currentSession)?.()?currentSession:null}
  function cancel(){
    const pending=currentSession?.cancel()||Promise.resolve()
    for(const surface of surfaces.values()){surface.revision++;clearPreviewTween(surface)}
    return pending
  }
  function refreshLanguage(){
    void cancel();requestAbort?.abort();gather()
    if(menu?.open&&!menu.borrowed)renderMenu()
    if(search?.open&&!search.borrowed)renderSearch()
  }
  function staticMode(){
    if(!calm())return
    void cancel()
    for(const surface of surfaces.values())if(surface.open&&!surface.borrowed&&surface.model)render(surface,surface.model)
  }
  function destroy(){
    if(destroyed)return
    destroyed=true;owner.abort();requestAbort?.abort();currentDispose?.()
    for(const entry of cache.values())if(entry.pending)entry.cancel()
    cache.clear()
    for(const surface of surfaces.values()){surface.revision++;clearPreviewTween(surface)}
    if(menuPanel)controllers.delete(menuPanel)
  }
  for(const panel of [menuPanel,searchPanel].filter(Boolean)){
    panel.addEventListener('pointerover',select,{passive:true,signal});panel.addEventListener('focusin',select,{signal})
  }
  document.addEventListener('keydown',event=>{if(event.key==='Escape')void cancel()},{capture:true,signal})
  document.addEventListener('grade:language',refreshLanguage,{signal})
  document.addEventListener('visibilitychange',staticMode,{signal})
  reduced.addEventListener('change',staticMode,{signal});forced.addEventListener('change',staticMode,{signal})
  window.addEventListener('resize',()=>{if(currentSession)void cancel()},{passive:true,signal})
  window.addEventListener('pagehide',destroy,{once:true,signal})
  const control={open,close,results,prepare,getTransition,cancel}
  if(menuPanel)controllers.set(menuPanel,control)
  gather()
  if(menu)render(menu,menuModel(selectedMenu))
  if(search)renderSearch()
  return control
}
