import { api, esc, icon, avatar, poster, kindName, toast, openModal, closeModal, empty, cards, pager } from './ui.js'
import { t, html, language, setLanguage, applyShell } from './i18n.js'
import { preparePhoto } from './photo.js'
import { mountMotion, leavePage, syncNavigation, enableGestures, prepareNavigation } from './motion.js'
import { mountTrailer, closeTrailer } from './trailer.js'
import { loadCollections, collectionCards, collectionBySlug } from './collections.js'
import { initializeHeader, closeHeaderPanels, openHeaderSearch, viewerPass } from './header-track.js'

const main = document.querySelector('#main')
const state = { me: null, generation: 0, title: null, discussion: null, onboarding: null }
const params = () => new URLSearchParams(location.search)
const urlFor = (values) => `/catalog?${new URLSearchParams(values)}`
const views = new Map()
let entryKey = history.state?.gradeKey || crypto.randomUUID()
history.replaceState({ ...history.state, gradeKey: entryKey }, '')
function rememberView() {
  const comment = document.querySelector('#comment-text')
  views.set(entryKey, { scroll: scrollY, focus: document.activeElement?.id, focusHref: document.activeElement?.closest('a[href]')?.getAttribute('href'), comment: comment?.value })
  if (views.size > 40) views.delete(views.keys().next().value)
}
function navigate(url, replace = false, link = null) {
  rememberView()
  closeHeaderPanels()
  const samePage = new URL(url, location.href).pathname === location.pathname
  prepareNavigation(link, url)
  const previous = location.pathname + location.search
  entryKey = crypto.randomUUID()
  history[replace ? 'replaceState' : 'pushState']({ gradeKey: entryKey, gradeFrom: previous }, '', url)
  render({ resetScroll: !samePage })
}
async function refreshMe() {
  const data = await api('/api/me')
  state.me = data.user ? data : null
  document.querySelector('#account').innerHTML = viewerPass(state.me?.user)
}
function needUser() { if (state.me) return true; authModal(); return false }
function authModal(mode = 'login') {
  const signup = mode === 'signup'
  closeHeaderPanels()
  openModal(html`<div class="auth-mark"><span class="auth-brand">grade${icon('brand')}</span><span>${t('Личная коллекция кино')}</span></div><h2 id="auth-title">${signup ? t('Регистрация') : t('Вход')}</h2>
    <form id="auth-form" class="stack-form">
      ${signup ? t('<label>Как вас зовут<input name="name" required minlength="2" maxlength="40" autocomplete="name" placeholder="Ваше имя"></label><label>Никнейм<input name="username" aria-label="Никнейм" aria-describedby="username-hint" required minlength="3" maxlength="24" pattern="[a-zA-Z0-9_]+" autocomplete="username" placeholder="Например, sannder"><small id="username-hint">Латинские буквы, цифры и _</small></label>') : ''}
      <label>${signup ? t('Почта') : t('Почта или никнейм')}<input name="login" ${signup ? 'type="email"' : 'type="text"'} required maxlength="254" autocomplete="${signup ? 'email' : 'username'}" placeholder="${signup ? 'you@example.com' : t('you@example.com или никнейм')}"></label>
      <label>Пароль<input name="password" type="password" required minlength="${signup ? 10 : 1}" maxlength="128" autocomplete="${signup ? 'new-password' : 'current-password'}" placeholder="${signup ? t('Не менее 10 символов') : t('Ваш пароль')}"></label>
      <p class="form-error" role="alert" hidden></p><button class="button primary full" type="submit">${signup ? t('Создать аккаунт') : t('Войти')} ${icon('arrow')}</button>
    </form><p class="auth-switch">${signup ? t('Уже есть аккаунт?') : t('Нет аккаунта?')} <button class="text-button" data-action="auth-switch" data-mode="${signup ? 'login' : 'signup'}">${signup ? t('Войти') : t('Зарегистрироваться')}</button></p>`, { kind:'auth' })
  document.querySelector('#auth-form').onsubmit = async (event) => {
    event.preventDefault()
    const form = event.currentTarget, button = form.querySelector('[type=submit]'), error = form.querySelector('.form-error'), values = Object.fromEntries(new FormData(form))
    button.disabled = true; error.hidden = true
    try {
      if (signup) await api('/api/auth/sign-up/email', { method: 'POST', body: { email: values.login.trim(), password: values.password, name: values.name.trim(), username: values.username.trim() } })
      else await api(`/api/auth/sign-in/${values.login.includes('@') ? 'email' : 'username'}`, { method: 'POST', body: { [values.login.includes('@') ? 'email' : 'username']: values.login.trim(), password: values.password } })
      await refreshMe()
      closeModal()
      toast(signup ? t('Аккаунт создан') : t('Вы вошли в аккаунт'))
      if (signup) navigate('/start')
      else render()
    } catch (err) {
      const messages = { USER_ALREADY_EXISTS:t('Эта почта уже зарегистрирована'), USERNAME_IS_ALREADY_TAKEN:t('Этот никнейм уже занят'), INVALID_EMAIL_OR_PASSWORD:t('Неверная почта или пароль'), INVALID_USERNAME_OR_PASSWORD:t('Неверный никнейм или пароль'), INVALID_USERNAME:t('Проверьте никнейм: только латиница, цифры и _') }
      error.textContent = messages[err.code] || err.message
      error.hidden = false
    } finally { button.disabled = false }
  }
}

async function render({ resetScroll = false, restore = null } = {}) {
  closeTrailer()
  const generation = ++state.generation
  const path = location.pathname
  main.setAttribute('aria-busy','true')
  const profile = path === '/me' || path.startsWith('/u/') || path === '/start'
  const nav = path === '/' ? 'home' : path.startsWith('/collections') ? 'collections' : path === '/catalog' || path.startsWith('/title/') ? 'catalog' : profile ? 'profile' : null
  document.querySelectorAll('[data-nav],.account-link').forEach(link => {
    const active = link.classList.contains('account-link') ? profile && link.getAttribute('href') === path : link.dataset.nav === nav
    link.classList.toggle('active',active)
    if (active) link.setAttribute('aria-current','page')
    else link.removeAttribute('aria-current')
  })
  syncNavigation()
  try {
    let content
    if (path === '/') content = await homePage()
    else if (path === '/collections' || /^\/collections\/[a-z-]+$/.test(path)) content = await collectionsPage(path.split('/')[2])
    else if (path === '/catalog') content = await catalogPage()
    else if (/^\/title\/\d+$/.test(path)) content = await titlePage(path.split('/').pop())
    else if (path === '/me' || path.startsWith('/u/')) {
      if (path === '/me') {
        if (!state.me) content = loginRequired()
        else { history.replaceState({ ...history.state },'',`/u/${encodeURIComponent(state.me.user.username)}${location.search}`); return render({ resetScroll, restore }) }
      } else content = await profilePage(decodeURIComponent(path.slice(3)))
    } else if (path === '/start') content = state.me ? await onboardingPage() : loginRequired()
    else if (path === '/about') content = aboutPage()
    else content = empty(t('Страница не найдена'), t('Вернитесь в каталог'))
    if (generation !== state.generation) return
    await leavePage(main)
    if (generation !== state.generation) return
    main.innerHTML = content
    if (restore) window.scrollTo({ top: restore.scroll, behavior:'instant' })
    else if (resetScroll) window.scrollTo({ top:0,behavior:'instant' })
    bindPage()
    if (restore?.comment != null && document.querySelector('#comment-text')) document.querySelector('#comment-text').value = restore.comment
    const restoreFocus = () => {
      if (generation !== state.generation) return
      if (restore?.focus) document.getElementById(restore.focus)?.focus({ preventScroll:true })
      else if (restore?.focusHref) main.querySelector(`a[href="${CSS.escape(restore.focusHref)}"]`)?.focus({ preventScroll:true })
    }
    if (main.inert && restore) document.addEventListener('grade:scene-closed',restoreFocus,{once:true})
    else restoreFocus()
    mountMotion(main)
    document.title = path.startsWith('/title/') && state.title ? `${state.title.name} — Grade` : t('Grade — оценки аниме, фильмов и сериалов')
    const search = params().get('q') || ''
    if (!document.querySelector('.track-header').classList.contains('search-is-open')) document.querySelector('#search').value = search
  } catch (error) {
    if (generation !== state.generation) return
    main.innerHTML = html`<section class="container error-page" role="alert"><h1>Не удалось открыть страницу</h1><p>${esc(error.message)}</p><button class="button primary" data-action="retry">Повторить</button></section>`
    if (resetScroll) window.scrollTo({ top:0,behavior:'instant' })
    mountMotion(main)
  } finally {
    if (generation === state.generation) {
      main.inert = [...document.querySelectorAll('.scene-panel')].some(panel => !panel.hidden)
      main.removeAttribute('aria-busy'); main.removeAttribute('aria-hidden')
    }
  }
}
const loginRequired = () => html`<div class="container">${empty(t('Войдите в аккаунт'), t('Здесь будут ваши оценки и просмотренное'))}<div class="center-action"><button class="button primary" data-action="login">Войти</button></div></div>`

async function homePage() {
  const [result, collections] = await Promise.all([api('/api/catalog?sort=popular'), loadCollections()])
  if (!result.items.length) return empty(t('Каталог пуст'), t('Загляните позже'))
  return html`<div class="container home-page">
    <section class="hero hero-editorial"><div class="hero-content"><p class="hero-kicker">Личная коллекция кино <span>Фильмы · Аниме · Сериалы</span></p><h1 data-hero-heading>Кино, которое<br><span class="hero-emphasis">остаётся.</span></h1><p class="hero-description">Собирайте любимое. Замечайте детали.<br> Истории, из которых складывается ваш вкус.</p><div class="hero-actions"><a href="/me" class="button primary">Моя коллекция ${icon('arrow-up-right')}</a><a href="/catalog" class="text-link">Найти своё ${icon('arrow')}</a></div></div><div class="hero-posters" aria-label="${t('Из коллекции Grade')}">${result.items.slice(0,4).map((item,i) => `<a class="hero-poster hero-poster-${i+1}" href="/title/${item.id}" aria-label="${esc(item.name)}">${poster(item,false).replace('class="poster-placeholder"','class="poster-placeholder" data-hero-media')}<span class="hero-poster-caption">${esc(item.name)}<span>${esc(item.year || '')}</span></span></a>`).join('')}</div></section>
    <div class="home-content"><section class="catalog-section"><div class="section-heading"><div><p class="eyebrow">01 / СВЯЗИ МЕЖДУ ИСТОРИЯМИ</p><h2>Собрано по настроению</h2></div><a class="text-link" href="/collections">Все подборки ${icon('arrow-up-right')}</a></div>${collectionCards(collections)}</section>
    <section class="catalog-section library-section"><div class="section-heading"><div><p class="eyebrow">02 / ОТКРЫТЫЙ КАТАЛОГ</p><h2>С чего-то всё начинается</h2></div><a class="text-link" href="/catalog?view=grade">Весь каталог ${icon('arrow-up-right')}</a></div><div class="category-pills"><a class="active" href="/catalog?view=grade">Всё</a><a href="/catalog?kind=movie&view=grade">Фильмы</a><a href="/catalog?kind=anime&view=grade">Аниме</a><a href="/catalog?kind=series&view=grade">Сериалы</a><span class="catalog-footnote">Выбирайте по себе, а не по цифрам.</span></div>${cards(result.items.slice(0, 6))}</section>
    <section class="personal-section"><div class="section-heading"><div><p class="eyebrow">03 / ВАША ТОЧКА ЗРЕНИЯ</p><h2>У каждой коллекции — свой автор.</h2></div></div><div class="personal-grid"><a class="personal-collection" href="/me?tab=planned"><span class="index-label">[ 01 ]</span><h3>Ещё впереди</h3><p>Фильмы, до которых хочется добраться.</p><span class="text-link">В планах ${icon('arrow-up-right')}</span></a><a class="personal-collection" href="/me?tab=ratings"><span class="index-label">[ 02 ]</span><h3>На вашей шкале</h3><p>Любимое и всё, что оставило впечатление.</p><span class="text-link">Мои оценки ${icon('arrow-up-right')}</span></a><a class="personal-collection" href="/me?tab=reviews"><span class="index-label">[ 03 ]</span><h3>После титров</h3><p>Мысли, которые стоит сохранить в отзыве.</p><span class="text-link">Мои заметки ${icon('arrow-up-right')}</span></a></div><div class="archive-note"><span>Ваш вкус не обязан совпадать с чужим.</span><a href="/start" class="text-link">Вспомнить просмотренное ${icon('arrow')}</a></div></section>
  </div></div>`
}

async function collectionsPage(slug) {
  const collections = await loadCollections()
  if (!slug) return html`<div class="container page"><header class="page-heading"><div><p class="eyebrow">GRADE / ПОДБОРКИ</p><h1>Истории рядом.</h1><p>Разные фильмы. Общее настроение. Ещё одна точка входа в кино.</p></div><span class="index-label">03 COLLECTIONS</span></header>${collectionCards(collections)}</div>`
  const collection = collectionBySlug(collections, slug)
  if (!collection) return empty(t('Страница не найдена'), t('Вернитесь в каталог'))
  const kind = params().get('kind') || '', sort = params().get('sort') || 'popular'
  let items = collection.items.filter(item => !kind || item.kind === kind)
  if (sort === 'new') items = [...items].sort((a,b) => b.year-a.year)
  else if (sort === 'rating') items = [...items].sort((a,b) => (b.average ?? -1)-(a.average ?? -1))
  return html`<div class="container page collection-page" data-collection-slug="${esc(slug)}"><a href="/collections" class="back-link">${icon('arrow-left')} Все подборки</a><header class="page-heading"><div><p class="eyebrow">${esc(collection.index)} / ПОДБОРКА GRADE</p><h1><span data-collection-title="${esc(slug)}">${esc(t(collection.name))}</span></h1><p>${esc(t(collection.description))}</p></div><span class="catalog-count">${items.length}<small> ${t('тайтлов')}</small></span></header><div class="catalog-toolbar"><nav class="category-pills" aria-label="${t('Тип тайтла')}">${[['',t('Всё')],['movie',t('Фильмы')],['anime',t('Аниме')],['series',t('Сериалы')]].map(([value,label]) => `<a class="${kind === value ? 'active' : ''}" href="/collections/${slug}?${new URLSearchParams({kind:value,sort})}">${label}</a>`).join('')}</nav><label class="sort-label">${t('Сначала')}<select id="collection-sort"><option value="popular" ${sort === 'popular' ? 'selected' : ''}>${t('Популярное')}</option><option value="new" ${sort === 'new' ? 'selected' : ''}>${t('По году')}</option><option value="rating" ${sort === 'rating' ? 'selected' : ''}>${t('По оценкам')}</option></select></label></div>${items.length ? cards(items) : empty(t('Ничего не найдено'),t('Попробуйте другой жанр или год'))}</div>`
}
async function catalogPage() {
  const p = params(), kind = p.get('kind') || '', search = p.get('q') || '', sort = p.get('sort') || 'popular'
  const view = p.get('view') === 'grade' ? 'grade' : 'discover'
  const genre = p.get('genre') || '', from = p.get('from') || ''
  const currentPage = p.get('page') || '1'
  const result = await api(`/api/catalog?${new URLSearchParams({ kind, q:search, sort, page:search || view === 'grade' ? currentPage : '1' })}`)
  let external = [], externalError = ''
  if (search.trim().length >= 2 && result.externalSearch && result.page === 1) {
    try {
      const data = await api(`/api/catalog/external?${new URLSearchParams({ q:search, kind })}`)
      external = data.items.filter(item => !result.items.some(local => local.source === 'tmdb' && local.external_id === item.external_id))
    } catch (error) { externalError = error.message }
  }
  let discovery = null, discoveryError = ''
  if (!search && view === 'discover') {
    try {
      discovery = await api(`/api/catalog/discover?${new URLSearchParams({ kind, genre, from, sort, page:currentPage })}`)
    } catch (error) { discoveryError = error.message }
  }
  const discovering = !search && view === 'discover' && discovery?.available
  return html`<div class="container page"><header class="page-heading"><h1>${search ? html`Поиск: «${esc(search)}»` : discovering ? t('Что посмотреть') : t('Каталог')}</h1><span class="catalog-count">${search ? result.items.length + external.length : discovering ? discovery.items.length : result.total} <small>${search ? t('показано') : discovering ? t('на странице') : t('тайтлов')}</small></span></header>
    ${!search && result.externalSearch ? html`<nav class="catalog-views" aria-label="Раздел каталога"><a class="${view === 'discover' ? 'active' : ''}" href="${esc(urlFor({view:'discover',kind,sort,genre,from}))}">${t('Что посмотреть')}</a><a class="${view === 'grade' ? 'active' : ''}" href="${esc(urlFor({view:'grade',kind,sort}))}">${t('Каталог Grade')}</a></nav>` : ''}
    <div class="catalog-toolbar"><nav class="category-pills" aria-label="Тип тайтла">${[['',t('Всё')],['anime',t('Аниме')],['movie',t('Фильмы')],['series',t('Сериалы')]].map(([value,label]) => `<a class="${kind === value ? 'active' : ''}" href="${esc(urlFor({kind:value,q:search,sort,...(!search ? {view,genre,from} : {})}))}">${label}</a>`).join('')}</nav><label class="sort-label">${t('Сначала')}<select id="catalog-sort"><option value="popular" ${sort === 'popular' ? 'selected' : ''}>${t('Популярное')}</option><option value="rating" ${sort === 'rating' ? 'selected' : ''}>${discovering ? t('По рейтингу TMDB') : t('По оценкам')}</option><option value="new" ${sort === 'new' ? 'selected' : ''}>${t('По году')}</option></select></label></div>
    ${discovering ? html`<div class="discovery-intro"><p>${t('Находите новые фильмы и сериалы по жанру и году. Подборка обновляется из TMDB.')}</p><div class="discovery-filters"><label>${t('Жанр')}<select id="catalog-genre"><option value="">${t('Любой жанр')}</option>${[['16',t('Анимация')],['18',t('Драма')],['35',t('Комедия')],['80',t('Криминал')],['99',t('Документальное')],['9648',t('Детектив')],['10751',t('Семейное')]].map(([value,label]) => `<option value="${value}" ${genre === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label>${t('Не раньше')}<select id="catalog-from"><option value="">${t('Любой год')}</option>${['2020','2010','2000','1990'].map(value => `<option value="${value}" ${from === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label></div></div>
      ${discovery.items.length ? `<div class="discovery-grid">${discovery.items.map(item => html`<button type="button" class="discovery-card" data-action="import-title" data-external-id="${esc(item.external_id)}" aria-label="${t('Открыть')} ${esc(item.name)}">${poster(item)}<span class="discovery-card-content"><strong>${esc(item.name)}</strong><small>${item.year || '—'} · ${kindName(item.kind)}</small><span>${esc(item.description || t('Описание пока недоступно'))}</span><em>${t('Подробнее')} ${icon('arrow')}</em></span></button>`).join('')}</div>` : empty(t('Ничего не найдено'), t('Попробуйте другой жанр или год'))}
      ${pager(discovery.page, discovery.pages, page => urlFor({view,kind,genre,from,sort,page}))}
      <section class="catalog-section discovery-local"><div class="section-heading"><h2>${t('Каталог Grade')}</h2><a class="text-link" href="${esc(urlFor({view:'grade',kind,sort}))}">${t('Все тайтлы')} ${icon('arrow')}</a></div>${cards(result.items.slice(0,6))}</section>` : html`
      ${discoveryError ? `<p class="catalog-source-note" role="status">${esc(discoveryError)} ${t('Подборка Grade остаётся доступной.')}</p>` : ''}
      ${result.items.length ? cards(result.items) : external.length ? '' : empty(t('Ничего не найдено'), t('Попробуйте другое название'))}
      ${pager(result.page, result.pages, (page) => urlFor({kind,q:search,sort,...(!search ? {view:'grade'} : {}),page}))}`}
    ${external.length ? html`<section class="external-search" aria-label="Внешний каталог"><p>Результаты TMDB</p><div class="external-grid">${external.map(item => html`<button type="button" class="external-item" data-action="import-title" data-external-id="${esc(item.external_id)}" aria-label="Открыть ${esc(item.name)}">${poster(item)}<span><strong>${esc(item.name)}</strong><small>${item.year || '—'} · ${kindName(item.kind)}</small></span>${icon('arrow')}</button>`).join('')}</div></section>` : ''}
    ${externalError ? html`<p class="catalog-source-note" role="status">${esc(externalError)} Поиск по Grade продолжает работать.</p>` : ''}
    </div>`
}

async function profilePage(username) {
  const p = params(), data = await api(`/api/profiles/${encodeURIComponent(username)}?${new URLSearchParams({ tab:p.get('tab') || '',page:p.get('page') || '1' })}`)
  const { user, stats, own, tab, visibility, hidden } = data
  const tabs = [['ratings',t('Оценки'),stats.rated],['watched',t('Смотрел'),stats.watched],['planned',t('В планах'),stats.planned],['reviews',t('Отзывы'),stats.reviews],['comments',t('Комментарии'),stats.comments]]
  const postTab = ['reviews','comments'].includes(tab)
  const list = hidden ? empty(t('Раздел скрыт'),t('Пользователь скрыл этот раздел'))
    : data.items.length ? postTab ? profilePosts(data.items,tab) : cards(data.items,own)
    : empty(tab === 'ratings' ? t('Нет оценок') : ['watched','planned'].includes(tab) ? t('Пока пусто') : tab === 'comments' ? t('Нет комментариев') : t('Нет отзывов'),
      own ? tab === 'planned' ? t('Добавьте то, что хотите посмотреть') : tab === 'watched' ? t('Отметьте, что уже смотрели') : tab === 'ratings' ? t('Выберите тайтл в каталоге') : t('Перейдите к обсуждению тайтла') : '',
      tab === 'watched' && own ? '/start' : '/catalog',tab === 'watched' && own ? t('Добавить') : t('Каталог'))
  return html`<div class="container page profile-page"><header class="profile-heading"><div class="profile-avatar">${avatar(user.name,user.avatar_color,user.avatar_url)}</div><div class="profile-identity"><h1>${esc(user.name)}</h1><span class="profile-handle">@${esc(user.username)}</span>${user.bio ? `<p class="profile-bio">${esc(user.bio)}</p>` : ''}</div>${own ? html`<div class="profile-actions"><button class="button secondary" data-action="edit-profile">${icon('settings')} Редактировать</button><button class="text-button" data-action="signout">Выйти</button></div>` : ''}</header>
    <div class="profile-stats"><div><strong>${stats.watched ?? '—'}</strong><span>просмотрено</span></div><div><strong>${stats.rated ?? '—'}</strong><span>оценок</span></div>${own ? html`<div><strong>${stats.average ?? '—'}</strong><span>средняя оценка</span></div>` : ''}<div><strong>${stats.reviews ?? '—'}</strong><span>отзывов</span></div></div>
    <div class="profile-tabs" role="navigation" aria-label="Коллекции профиля">${tabs.filter(([value]) => own || visibility[value]).map(([value,label,count]) => `<a class="${tab === value ? 'active' : ''}" href="/u/${encodeURIComponent(user.username)}?tab=${value}">${label}<span>${count ?? ''}</span>${own && !visibility[value] ? icon('eye') : ''}</a>`).join('')}</div>
    ${own && !visibility[tab] ? html`<p class="collection-hint">Только вы видите этот раздел</p>` : ''}
    ${tab === 'watched' && own ? t('<p class="collection-hint">Оценку можно добавить позже</p>') : ''}
    ${list}${pager(data.page,data.pages,page => `/u/${encodeURIComponent(user.username)}?${new URLSearchParams({tab,page})}`)}</div>`
}
function profilePosts(items,type) {
  return `<div class="profile-reviews">${items.map(item => html`<article class="profile-review"><a href="/title/${item.id}">${poster(item)}</a><div><a class="review-title" href="/title/${item.id}">${esc(item.name)}</a><span class="review-date">${item.year} · ${kindName(item.kind)}${item.my_score ? html` · Моя оценка: ${item.my_score}/10` : ''}</span>${item.spoiler ? spoilerPlaceholder(item.post_id,type) : `<p class="user-content">${esc(item.content)}</p>`}<a href="/title/${item.id}?type=${type}" class="text-link">К обсуждению ${icon('arrow')}</a></div></article>`).join('')}</div>`
}
function spoilerPlaceholder(id, type) {
  return html`<div class="spoiler-placeholder" data-spoiler="${type}-${id}">${icon('eye')}<span>Спойлер</span><button class="text-button" data-action="reveal" data-type="${type}" data-id="${id}">Показать</button></div>`
}
async function onboardingPage() {
  if (!state.onboarding) {
    const result = await api('/api/catalog?sort=popular')
    state.onboarding = { items: result.items, index: 0, added: 0 }
  }
  const { items, index, added } = state.onboarding, item = items[index]
  if (!item) return html`<div class="container page">${empty(t('Готово'), html`Добавлено: ${added}`, '/me?tab=watched',t('Просмотренное'))}<div class="center-action"><button class="button secondary" data-action="onboard-finish">Завершить подборку</button></div></div>`
  return html`<div class="container onboarding-page"><header><h1>Уже смотрели?</h1><p>Отмечайте без оценки</p></header><div class="onboard-progress"><span style="width:${Math.round(index / items.length * 100)}%"></span></div><div class="onboard-counter"><span>${String(index + 1).padStart(2,'0')} / ${items.length}</span><button class="text-button" data-action="onboard-finish">Закончить подборку</button></div>
    <article class="onboard-card"><a class="onboard-poster" href="/title/${item.id}">${poster(item,false)}</a><div class="onboard-info"><span class="kind-label">${kindName(item.kind)} · ${item.year}</span><h2>${esc(item.name)}</h2><p class="original-name">${esc(item.original_name)}</p><p>${esc(item.description)}</p><div class="genre-tags">${item.genres.map((genre) => `<span>${esc(genre)}</span>`).join('')}</div><div class="onboard-actions"><button class="button primary" data-action="onboard-yes">${icon('check')} Смотрел</button><button class="button secondary" data-action="onboard-no">Не смотрел</button></div><button class="text-button onboard-skip" data-action="onboard-skip">Пропустить ${icon('arrow')}</button><p class="small muted">Добавлено: ${added}</p></div></article></div>`
}

function aboutPage() {
  return html`<div class="container page about-page"><h1>О Grade</h1><p>Оценки, отзывы и просмотренное для аниме, фильмов и сериалов — списки независимы</p><h2>Каталог</h2><p>На главной — подборка известных тайтлов. Поиск также использует TMDB. Рейтинг Grade складывается из оценок пользователей.</p><p>This product uses the TMDB API but is not endorsed or certified by TMDB.</p><h2>Спойлеры</h2><p>Отметьте спойлер перед публикацией. Текст раскроется только по кнопке «Показать». Фильтр «Без спойлеров» убирает такие записи и ответы на них.</p><h2>Профиль</h2><p>Видимость коллекций настраивается в профиле — публикации в обсуждениях остаются публичными</p><p>Внешние рейтинги — <a href="https://kinopoiskapiunofficial.tech/" target="_blank" rel="noopener noreferrer">Kinopoisk Unofficial API</a></p><a class="button primary" href="/catalog">Каталог ${icon('arrow')}</a></div>`
}

function savedSpoilerFilter() {
  try { return localStorage.getItem('grade:spoiler-filter') === 'clean' ? 'clean' : 'all' } catch { return 'all' }
}
async function titlePage(titleId) {
  const type = params().get('type') === 'comments' ? 'comments' : 'reviews'
  const filter = params().get('filter') === 'clean' ? 'clean' : params().has('filter') ? 'all' : savedSpoilerFilter()
  const current = params().get('page') || '1'
  const [item, discussion] = await Promise.all([
    api(`/api/titles/${titleId}`), api(`/api/titles/${titleId}/discussion?${new URLSearchParams({type,filter,page:current})}`),
  ])
  if (location.pathname === `/title/${titleId}`) state.title = item
  return html`<div class="container title-page"><a href="${esc(history.state?.gradeFrom || '/catalog')}" class="back-link">${icon('arrow-left')} ${history.state?.gradeFrom ? t('Назад к коллекции') : t('В каталог')}</a><div class="title-layout"><aside class="title-sidebar"><div class="detail-poster">${poster(item,false)}</div><button class="button ${item.watched ? 'selected' : 'primary'} full" data-action="watch" data-id="${item.id}" data-watched="${item.watched ? 'true' : 'false'}">${icon(item.watched ? 'check' : 'plus')} ${item.watched ? t('Уже в просмотренном') : t('Смотрел')}</button><button class="button secondary full title-plan" data-action="plan" data-id="${item.id}" data-planned="${!!item.planned}" aria-pressed="${!!item.planned}">${icon('bookmark')} ${item.planned ? t('В планах') : t('В планы')}</button><p class="small muted center">Без оценки</p></aside>
    <div class="title-info"><div class="title-kicker"><span class="kind-label">${kindName(item.kind)}</span><span>${item.year || ''}</span><span>${esc(item.runtime)}</span></div><h1>${esc(item.name)}</h1><p class="original-name">${esc(item.original_name)}</p><div class="genre-tags">${item.genres.map((genre) => `<a href="/catalog?q=${encodeURIComponent(genre)}">${esc(genre)}</a>`).join('')}</div>
    <div class="title-overview"><div class="overall-score"><strong>${item.average ?? '—'}</strong><div>${icon('star')}<span>${item.votes ? html`${item.votes} оценок Grade` : t('Пока нет оценок')}</span></div></div><div id="external-ratings" data-id="${item.id}" aria-label="Рейтинги других сервисов">${ratingSources(null)}</div></div>
    <p class="title-description">${esc(item.description || t('Описание пока не добавлено.'))}</p><section id="title-trailer" class="title-trailer" aria-label="${t('Трейлер')}" hidden><div class="trailer-glow" aria-hidden="true"></div><div class="trailer-view"><img class="trailer-art" alt="" decoding="async"><div class="trailer-shade"></div><span class="trailer-eyebrow">GRADE CINEMA ${icon('brand')} ${t('Трейлер')}</span><button type="button" class="trailer-play" aria-label="${t('Смотреть трейлер')}">${icon('play')}</button><div class="trailer-meta"><div><span class="trailer-meta-label">${t('Смотреть трейлер')}</span><strong class="trailer-film-name"></strong><small class="trailer-clip-name"></small></div><span class="trailer-meta-arrow" aria-hidden="true">${icon('arrow-up-right')}</span></div></div></section><section class="rating-section"><div><h2>Ваша оценка</h2><span>${item.my_score ? html`${item.my_score} из 10` : t('Без оценки')}</span></div><div class="rating-scale" role="group" aria-label="Оценка от 1 до 10">${Array.from({length:10},(_,i) => html`<button type="button" aria-label="Оценить на ${i+1}" aria-pressed="${item.my_score === i+1}" data-action="rate" data-id="${item.id}" data-score="${i+1}" class="${item.my_score === i+1 ? 'picked' : ''}">${i+1}</button>`).join('')}</div>${item.my_score ? html`<button class="text-button remove-rating" data-action="remove-rating" data-id="${item.id}">Удалить мою оценку</button>` : ''}</section>
    <section class="discussion"><div class="discussion-header"><h2>Обсуждение</h2><button class="button secondary" data-action="review" data-id="${item.id}">${icon('plus')} Написать отзыв</button></div>
    <div class="discussion-toolbar"><nav class="discussion-tabs" aria-label="Тип обсуждения"><a class="${type === 'reviews' ? 'active' : ''}" href="/title/${item.id}?type=reviews&filter=${filter}">Отзывы</a><a class="${type === 'comments' ? 'active' : ''}" href="/title/${item.id}?type=comments&filter=${filter}">Комментарии</a></nav><label class="spoiler-filter">${icon('eye')}<select id="spoiler-filter" aria-label="Фильтр спойлеров"><option value="all" ${filter === 'all' ? 'selected' : ''}>Спойлеры скрыты</option><option value="clean" ${filter === 'clean' ? 'selected' : ''}>Без спойлеров</option></select></label></div>
    ${type === 'comments' ? html`<form id="comment-form" class="comment-form"><label for="comment-text">${state.me ? t('Комментарий') : t('Войдите, чтобы оставить комментарий')}</label><div id="reply-context" hidden></div><textarea id="comment-text" name="content" required maxlength="2000" rows="3" placeholder="Ваш комментарий"></textarea><div><label class="checkbox-label"><input type="checkbox" name="spoiler"> Есть спойлеры</label><button class="button primary" type="submit">Отправить ${icon('arrow')}</button></div></form>` : ''}
    <div class="discussion-items">${discussion.items.length ? discussion.items.map((row) => discussionItem(row,type)).join('') : `<div class="discussion-empty">${icon('chat')}<h3>${filter === 'clean' ? t('Нет записей без спойлеров') : type === 'reviews' ? t('Нет отзывов') : t('Нет комментариев')}</h3></div>`}</div>
    ${pager(discussion.page,discussion.pages,(page) => `/title/${item.id}?${new URLSearchParams({type,filter,page})}`)}</section></div></div></div>`
}
function discussionItem(row, type) {
  const date = new Intl.DateTimeFormat(language() === 'en' ? 'en-US' : 'ru-RU',{day:'numeric',month:'short',year:'numeric'}).format(new Date(row.created_at)).replace(/\.(?=\s|$)/g,'')
  return `<article class="discussion-item ${row.parent_id ? 'is-reply' : ''}"><div class="discussion-author"><a href="/u/${encodeURIComponent(row.username)}">${avatar(row.name, row.avatar_color, row.avatar_url)}</a><div><a href="/u/${encodeURIComponent(row.username)}">${esc(row.name)}</a><span>@${esc(row.username)} · ${date}</span></div>${row.user_score ? `<span class="author-score">${icon('star')} ${row.user_score}</span>` : ''}</div>
    ${row.reply_to ? html`<p class="reply-to">${icon('reply')} В ответ ${esc(row.reply_to)}</p>` : ''}
    ${row.spoiler ? spoilerPlaceholder(row.id,type) : `<p class="user-content">${esc(row.content)}</p>`}
    <div class="discussion-item-actions">${type === 'comments' && !row.parent_id ? html`<button class="text-button" data-action="reply" data-id="${row.id}" data-name="${esc(row.name)}" data-spoiler="${row.spoiler}">Ответить</button>` : ''}${row.own ? html`${type === 'reviews' ? html`<button class="text-button" data-action="review" data-id="${row.title_id}">Редактировать</button>` : ''}<button class="text-button muted" data-action="delete-post" data-id="${row.id}" data-type="${type}">Удалить</button>` : ''}</div></article>`
}

function bindPage() {
  const collectionSort = document.querySelector('#collection-sort')
  if (collectionSort) collectionSort.onchange = () => { const p = params(); p.set('sort', collectionSort.value); navigate(`${location.pathname}?${p}`) }
  if (state.title && document.querySelector('#title-trailer')) mountTrailer(state.title)
  const sources = document.querySelector('#external-ratings')
  if (sources) api(`/api/titles/${sources.dataset.id}/external-ratings`).then(data => {
    if (sources.isConnected) sources.innerHTML = ratingSources(data)
  }).catch(() => { if (sources.isConnected) sources.innerHTML = ratingSources({ status:'unavailable' }) })
  const sort = document.querySelector('#catalog-sort')
  if (sort) sort.onchange = () => { const p = params(); p.set('sort',sort.value); p.delete('page'); navigate(`/catalog?${p}`) }
  for (const [selector, key] of [['#catalog-genre','genre'],['#catalog-from','from']]) {
    const select = document.querySelector(selector)
    if (select) select.onchange = () => {
      const p = params(); if (select.value) p.set(key,select.value); else p.delete(key)
      p.delete('page'); navigate(`/catalog?${p}`)
    }
  }
  const filter = document.querySelector('#spoiler-filter')
  if (filter) filter.onchange = () => {
    try { localStorage.setItem('grade:spoiler-filter',filter.value) } catch { /* Optional preference. */ }
    const p = params(); p.set('filter',filter.value); p.delete('page'); navigate(`${location.pathname}?${p}`)
  }
  const form = document.querySelector('#comment-form')
  if (form) form.onsubmit = async (event) => {
    event.preventDefault()
    if (!needUser()) return
    const button = form.querySelector('[type=submit]'), content = form.elements.content.value
    button.disabled = true
    try {
      await api(`/api/titles/${location.pathname.split('/').pop()}/comments`, { method:'POST', body:{ content, spoiler:form.elements.spoiler.checked, parent_id:form.dataset.parent || null } })
      toast(t('Комментарий опубликован'))
      render()
    } catch (error) { toast(error.message) }
    finally { button.disabled = false }
  }
}
function ratingSources(data) {
  const items = [[t('Кинопоиск'),data?.kinopoisk],['IMDb',data?.imdb]]
  return `<div class="source-ratings">${items.map(([name,row]) => row ? `<a class="source-rating" href="${esc(row.url)}" target="_blank" rel="noopener noreferrer"><strong>${Number(row.score).toFixed(1)}</strong><span>${name} ${icon('arrow-up-right')}</span></a>` : `<div class="source-rating"><strong>—</strong><span>${name}</span></div>`).join('')}</div>${data?.status !== 'ok' ? `<small class="source-status">${!data ? t('Загрузка рейтингов') : data.status === 'not_found' ? t('Нет данных') : t('Рейтинги пока недоступны')}</small>` : ''}`
}
async function reviewModal(titleId) {
  if (!needUser()) return
  const own = await api(`/api/titles/${titleId}/my-review`)
  openModal(html`<h2>${own ? t('Редактировать отзыв') : t('Новый отзыв')}</h2><form id="review-form" class="stack-form"><label>Отзыв<textarea name="content" rows="8" required minlength="20" maxlength="10000" placeholder="Ваш отзыв">${esc(own?.content || '')}</textarea></label><label class="checkbox-label"><input type="checkbox" name="spoiler" ${own?.spoiler ? 'checked' : ''}>В отзыве есть спойлеры</label><p class="form-error" role="alert" hidden></p><button class="button primary" type="submit">${own ? t('Сохранить отзыв') : t('Опубликовать')} ${icon('arrow')}</button></form>`)
  document.querySelector('#review-form').onsubmit = async (event) => {
    event.preventDefault()
    const form = event.currentTarget, button = form.querySelector('[type=submit]'), error = form.querySelector('.form-error')
    button.disabled = true
    try {
      await api(`/api/titles/${titleId}/review`,{method:'PUT',body:{content:form.elements.content.value,spoiler:form.elements.spoiler.checked}})
      closeModal(); toast(t('Отзыв сохранён')); navigate(`/title/${titleId}?type=reviews`)
    } catch (err) { error.textContent = err.message; error.hidden = false }
    finally { button.disabled = false }
  }
}
function editProfile() {
  if (!needUser()) return
  openModal(html`<h2>Настройки</h2><form id="photo-form" class="stack-form settings-section"><h3>Фото профиля</h3><div class="photo-controls"><div id="photo-preview" class="photo-preview">${avatar(state.me.user.name,state.me.avatar_color,state.me.avatar_url)}</div><div class="photo-buttons"><label class="button secondary photo-select">Выбрать из галереи<input id="profile-photo" type="file" accept="image/*" class="sr-only"></label><button id="remove-photo" class="text-button" type="button" ${state.me.avatar_url ? '' : 'disabled'}>Удалить фото</button></div></div><small>Квадратное фото с обрезкой по центру</small><p class="form-error" role="alert" hidden></p><button id="save-photo" class="button primary" type="submit" disabled>Сохранить фото</button></form>
<form id="profile-form" class="stack-form settings-section"><h3>Профиль</h3><label>Имя<input name="name" required minlength="2" maxlength="40" value="${esc(state.me.user.name)}"></label><label>О себе<textarea name="bio" rows="3" maxlength="400" placeholder="Любимые жанры и режиссёры">${esc(state.me.bio)}</textarea></label><fieldset class="avatar-picker"><legend>Цвет аватара</legend><div>${[['lime',t('Лайм')],['violet',t('Фиолетовый')],['blue',t('Синий')],['orange',t('Оранжевый')],['pink',t('Розовый')],['gray',t('Серый')]].map(([color,label]) => `<label class="color-choice" data-color="${color}"><input type="radio" name="avatar_color" value="${color}" aria-label="${label}" ${(state.me.avatar_color || 'lime') === color ? 'checked' : ''}><span>${avatar(state.me.user.name,color)}</span></label>`).join('')}</div></fieldset><p class="form-error" role="alert" hidden></p><button class="button primary" type="submit">Сохранить ${icon('check')}</button></form>
    <form id="privacy-form" class="stack-form settings-section"><h3>Видимость профиля</h3><p class="settings-hint">Показывать посетителям профиля</p><div class="privacy-options">${[['planned',t('В планах')],['watched',t('Просмотренное')],['ratings',t('Оценки')],['reviews',t('Отзывы')],['comments',t('Комментарии')]].map(([key,label]) => `<label class="checkbox-label"><input type="checkbox" name="${key}" ${state.me.visibility[key] ? 'checked' : ''}>${label}</label>`).join('')}</div><small>Только в профиле — публикации в обсуждениях остаются видны</small><p class="form-error" role="alert" hidden></p><button class="button secondary" type="submit">Сохранить видимость</button></form>
<form id="preferences-form" class="stack-form settings-section"><h3>Предпочтения</h3><label>Язык<select name="language"><option value="ru" ${language() === 'ru' ? 'selected' : ''}>Русский</option><option value="en" ${language() === 'en' ? 'selected' : ''}>English</option></select></label><label>Спойлеры<select name="spoilers"><option value="all" ${savedSpoilerFilter() === 'all' ? 'selected' : ''}>Спойлеры скрыты</option><option value="clean" ${savedSpoilerFilter() === 'clean' ? 'selected' : ''}>Без спойлеров</option></select></label><button class="button secondary" type="submit">Применить</button></form>
    <details class="settings-section password-settings"><summary>Сменить пароль</summary><form id="password-form" class="stack-form"><label>Текущий пароль<input name="currentPassword" type="password" required maxlength="128" autocomplete="current-password"></label><label>Новый пароль<input name="newPassword" type="password" required minlength="10" maxlength="128" autocomplete="new-password" placeholder="Не менее 10 символов"></label><small>Другие сеансы будут завершены</small><p class="form-error" role="alert" hidden></p><button class="button secondary" type="submit">Обновить пароль</button></form></details><button class="text-button settings-signout" data-action="signout" type="button">Выйти из аккаунта</button>`)
  const photoForm = document.querySelector('#photo-form'), photoInput = document.querySelector('#profile-photo')
  const preview = document.querySelector('#photo-preview'), savePhoto = document.querySelector('#save-photo'), removePhoto = document.querySelector('#remove-photo')
  const photoError = photoForm.querySelector('.form-error')
  let selectedPhoto = null, selection = 0
  photoInput.onchange = async () => {
    const current = ++selection
    selectedPhoto = null; savePhoto.disabled = true; photoError.hidden = true
    try {
      if (!photoInput.files[0]) return
      const prepared = await preparePhoto(photoInput.files[0])
      if (current !== selection) return
      selectedPhoto = prepared.blob
      const image = document.createElement('img'); image.src = prepared.preview; image.alt = t('Предпросмотр фото')
      preview.replaceChildren(image); savePhoto.disabled = false
    } catch (error) { photoError.textContent = error.message; photoError.hidden = false }
  }
  photoForm.onsubmit = async event => {
    event.preventDefault()
    if (!selectedPhoto) return
    savePhoto.disabled = true; photoInput.disabled = true; removePhoto.disabled = true; photoError.hidden = true
    try {
      await api('/api/me/avatar',{ method:'PUT',raw:true,body:selectedPhoto })
      await refreshMe(); selectedPhoto = null; photoInput.value = ''
      preview.innerHTML = avatar(state.me.user.name,state.me.avatar_color,state.me.avatar_url)
      toast(t('Фото обновлено')); render()
    } catch (error) { photoError.textContent = error.message; photoError.hidden = false }
    finally { photoInput.disabled = false; savePhoto.disabled = !selectedPhoto; removePhoto.disabled = !state.me.avatar_url }
  }
  removePhoto.onclick = async () => {
    removePhoto.disabled = true; photoInput.disabled = true; savePhoto.disabled = true; photoError.hidden = true; selection++
    try {
      await api('/api/me/avatar',{method:'DELETE'})
      await refreshMe(); selectedPhoto = null; photoInput.value = ''
      preview.innerHTML = avatar(state.me.user.name,state.me.avatar_color)
      toast(t('Фото удалено')); render()
    } catch (error) { photoError.textContent = error.message; photoError.hidden = false }
    finally { photoInput.disabled = false; removePhoto.disabled = !state.me.avatar_url; savePhoto.disabled = !selectedPhoto }
  }
  document.querySelector('#privacy-form').onsubmit = async event => {
    event.preventDefault()
    const form = event.currentTarget, button = form.querySelector('[type=submit]'), error = form.querySelector('.form-error')
    button.disabled = true; error.hidden = true
    try {
      const body = Object.fromEntries(['watched','ratings','reviews','comments','planned'].map(key => [key,form.elements[key].checked]))
      await api('/api/me/privacy',{method:'PATCH',body})
      await refreshMe(); closeModal(); toast(t('Видимость обновлена')); render()
    } catch (err) { error.textContent = err.message; error.hidden = false }
    finally { button.disabled = false }
  }
  document.querySelector('#profile-form').onsubmit = async (event) => {
    event.preventDefault()
    const form = event.currentTarget, button = form.querySelector('[type=submit]'), error = form.querySelector('.form-error')
    button.disabled = true
    try {
      await api('/api/me',{method:'PATCH',body:{name:form.elements.name.value,bio:form.elements.bio.value,avatar_color:form.elements.avatar_color.value}})
      await refreshMe(); closeModal(); toast(t('Профиль обновлён')); render()
    } catch (err) { error.textContent = err.message; error.hidden = false }
    finally { button.disabled = false }
  }
  document.querySelector('#preferences-form').onsubmit = async (event) => {
    event.preventDefault()
    const form = event.currentTarget
    try { localStorage.setItem('grade:spoiler-filter',form.elements.spoilers.value) } catch { /* Optional preference */ }
    await changeLanguage(form.elements.language.value)
    toast(t('Настройки сохранены'))
  }
  document.querySelector('#password-form').onsubmit = async (event) => {
    event.preventDefault()
    const form = event.currentTarget, button = form.querySelector('[type=submit]'), error = form.querySelector('.form-error')
    button.disabled = true; error.hidden = true
    try {
      await api('/api/auth/change-password',{method:'POST',body:{currentPassword:form.elements.currentPassword.value,newPassword:form.elements.newPassword.value,revokeOtherSessions:true}})
      form.reset(); closeModal(); toast(t('Пароль обновлён'))
    } catch (err) { error.textContent = err.message; error.hidden = false }
    finally { button.disabled = false }
  }
}
async function changeLanguage(value) {
  setLanguage(value); applyShell(); closeModal(); state.onboarding = null
  document.querySelector('#toast').hidden = true
  await refreshMe(); await render()
}

document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]')
  if (button) {
    event.preventDefault()
    if (button.disabled) return
    const action = button.dataset.action
    try {
      if (action === 'login') return authModal()
      if (action === 'auth-switch') return authModal(button.dataset.mode)
      if (action === 'retry') return render()
      if (action === 'edit-profile') return editProfile()
      if (action === 'language') return await changeLanguage(language() === 'ru' ? 'en' : 'ru')
      if (action === 'signout') {
        await api('/api/auth/sign-out',{method:'POST'})
        closeModal(); state.onboarding = null
        await refreshMe(); navigate('/'); return
      }
      if (action === 'plan') {
        if (!needUser()) return
        button.disabled = true
        const planned = button.dataset.planned !== 'true'
        await api(`/api/titles/${button.dataset.id}/planned`,{method:'PUT',body:{planned}})
        toast(planned ? t('Добавлено в планы') : t('Удалено из планов'))
        return render()
      }
      if (action === 'watch') {
        if (!needUser()) return
        button.disabled = true
        const watched = button.dataset.watched !== 'true'
        await api(`/api/titles/${button.dataset.id}/watched`,{method:'PUT',body:{watched}})
        toast(watched ? t('Добавлено в просмотренное') : t('Удалено из просмотренного'))
        return render()
      }
      if (action === 'rate' || action === 'remove-rating') {
        if (!needUser()) return
        button.disabled = true
        await api(`/api/titles/${button.dataset.id}/rating`,{method:action === 'rate' ? 'PUT' : 'DELETE',body:action === 'rate' ? {score:Number(button.dataset.score)} : {}})
        toast(action === 'rate' ? t('Ваша оценка сохранена') : t('Оценка удалена'))
        return render()
      }
      if (action === 'review') return await reviewModal(button.dataset.id)
      if (action === 'reveal') {
        button.disabled = true
        const data = await api(`/api/${button.dataset.type}/${button.dataset.id}/reveal`)
        const target = button.closest('.spoiler-placeholder')
        const paragraph = document.createElement('p'); paragraph.className = 'user-content revealed-spoiler'; paragraph.textContent = data.content
        target.replaceWith(paragraph); return
      }
      if (action === 'reply') {
        if (!needUser()) return
        const form = document.querySelector('#comment-form'), context = document.querySelector('#reply-context')
        form.dataset.parent = button.dataset.id
        form.elements.spoiler.checked = button.dataset.spoiler === 'true'
        form.elements.spoiler.disabled = button.dataset.spoiler === 'true'
        context.innerHTML = html`<span>Ответ ${esc(button.dataset.name)}</span><button class="text-button" data-action="cancel-reply" type="button">Отменить</button>`; context.hidden = false
        form.scrollIntoView({behavior:'smooth',block:'center'}); form.elements.content.focus(); return
      }
      if (action === 'cancel-reply') {
        const form = document.querySelector('#comment-form'); delete form.dataset.parent
        form.elements.spoiler.disabled = false; form.elements.spoiler.checked = false
        document.querySelector('#reply-context').hidden = true; return
      }
      if (action === 'delete-post') {
        if (!needUser() || !confirm(t('Удалить вашу публикацию? Ответы на комментарий тоже будут удалены.'))) return
        button.disabled = true
        await api(`/api/${button.dataset.type}/${button.dataset.id}`,{method:'DELETE'})
        toast(t('Публикация удалена')); return render()
      }
      if (action.startsWith('onboard-')) {
        if (!needUser()) return
        const controls = [...main.querySelectorAll('[data-action^="onboard-"]')]
        controls.forEach(control => { control.disabled = true })
        button.disabled = true
        try {
        if (action === 'onboard-finish') {
          await api('/api/onboarding/complete',{method:'POST'})
          state.onboarding = null; await refreshMe(); navigate('/me?tab=watched'); return
        }
        if (action === 'onboard-yes') {
          const item = state.onboarding.items[state.onboarding.index]
          await api(`/api/titles/${item.id}/watched`,{method:'PUT',body:{watched:true}})
          state.onboarding.added++
        }
        if (action === 'onboard-no') {
          const item = state.onboarding.items[state.onboarding.index]
          await api(`/api/titles/${item.id}/watched`,{method:'PUT',body:{watched:false}})
        }
        state.onboarding.index++
        return render()
        } finally { controls.forEach(control => { if (control.isConnected) control.disabled = false }) }
      }
      if (action === 'import-title') {
        button.disabled = true
        const data = await api('/api/catalog/import',{method:'POST',body:{external_id:button.dataset.externalId}})
        return navigate(`/title/${data.id}`)
      }
    } catch (error) { toast(error.message) }
    finally { button.disabled = false }
    return
  }
  const link = event.target.closest('a[href]')
  if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0 || link.target || link.hasAttribute('download')) return
  const target = new URL(link.href, location.href)
  if (target.origin !== location.origin || target.hash) return
  if (link.classList.contains('back-link') && location.pathname.startsWith('/title/') && views.size && history.state?.gradeFrom) { event.preventDefault(); history.back(); return }
  event.preventDefault(); navigate(target.pathname + target.search, false, link)
})
document.querySelector('#search-form').onsubmit = (event) => {
  event.preventDefault(); navigate(urlFor({q:document.querySelector('#search').value.trim()}))
}
document.addEventListener('keydown',(event) => {
  if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.target.closest('input,textarea,select,[contenteditable]') && !document.querySelector('dialog[open]')) { event.preventDefault(); openHeaderSearch() }
})
document.querySelector('.modal-close').onclick = closeModal
document.querySelector('#modal').addEventListener('cancel',event => { event.preventDefault(); closeModal() })
document.querySelector('#modal').addEventListener('click',(event) => { if (event.target === event.currentTarget) closeModal() })
document.addEventListener('error',(event) => { if (event.target instanceof HTMLImageElement) event.target.remove() },true)
window.addEventListener('popstate',() => {
  closeHeaderPanels()
  rememberView()
  entryKey = history.state?.gradeKey || crypto.randomUUID()
  prepareNavigation(null, location.pathname + location.search)
  render({ resetScroll:true, restore:views.get(entryKey) })
})
applyShell()
initializeHeader()
enableGestures(main,navigate)
try { await refreshMe() } catch (error) { toast(error.message); document.querySelector('#account').innerHTML = viewerPass() }
render()
