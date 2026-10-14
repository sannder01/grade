import { api, esc, icon, avatar, poster, kindName, toast, openModal, closeModal, empty, cards, pager } from './ui.js'

const main = document.querySelector('#main')
const state = { me: null, generation: 0, title: null, discussion: null, external: [], onboarding: null }
const params = () => new URLSearchParams(location.search)
const urlFor = (values) => `/catalog?${new URLSearchParams(values)}`
function navigate(url, replace = false) {
  history[replace ? 'replaceState' : 'pushState']({}, '', url)
  render()
  window.scrollTo({ top: 0, behavior: 'instant' })
}
async function refreshMe() {
  const data = await api('/api/me')
  state.me = data.user ? data : null
  document.querySelector('#account').innerHTML = state.me
    ? `<a class="account-link" href="/u/${encodeURIComponent(data.user.username)}" aria-label="Мой профиль">${avatar(data.user.name)}<span>${esc(data.user.username)}</span></a><button class="text-button signout" data-action="signout" type="button">Выйти</button>`
    : '<button class="button secondary login-button" data-action="login" type="button">Войти <span>↗</span></button>'
}
function needUser() { if (state.me) return true; authModal(); return false }
function authModal(mode = 'login') {
  const signup = mode === 'signup'
  openModal(`<div class="auth-mark">✳</div><p class="eyebrow">ДОБРО ПОЖАЛОВАТЬ В GRADE</p><h2>${signup ? 'У каждой истории есть ваш взгляд.' : 'Рады видеть вас снова.'}</h2><p class="modal-subtitle">${signup ? 'Соберите свою историю просмотра. Без обязательных оценок.' : 'Войдите, чтобы продолжить свою коллекцию.'}</p>
    <form id="auth-form" class="stack-form">
      ${signup ? '<label>Как вас зовут<input name="name" required minlength="2" maxlength="40" autocomplete="name" placeholder="Ваше имя"></label><label>Никнейм<input name="username" required minlength="3" maxlength="24" pattern="[a-zA-Z0-9_]+" autocomplete="username" placeholder="Например, sannder"><small>Латинские буквы, цифры и _</small></label>' : ''}
      <label>${signup ? 'Почта' : 'Почта или никнейм'}<input name="login" ${signup ? 'type="email"' : 'type="text"'} required maxlength="254" autocomplete="${signup ? 'email' : 'username'}" placeholder="${signup ? 'you@example.com' : 'you@example.com или никнейм'}"></label>
      <label>Пароль<input name="password" type="password" required minlength="${signup ? 10 : 1}" maxlength="128" autocomplete="${signup ? 'new-password' : 'current-password'}" placeholder="${signup ? 'Не менее 10 символов' : 'Ваш пароль'}"></label>
      <p class="form-error" role="alert" hidden></p><button class="button primary full" type="submit">${signup ? 'Создать аккаунт' : 'Войти'} ${icon('arrow')}</button>
    </form><p class="auth-switch">${signup ? 'Уже есть аккаунт?' : 'Первый раз здесь?'} <button class="text-button" data-action="auth-switch" data-mode="${signup ? 'login' : 'signup'}">${signup ? 'Войти' : 'Зарегистрироваться'}</button></p>`)
  document.querySelector('#auth-form').onsubmit = async (event) => {
    event.preventDefault()
    const form = event.currentTarget, button = form.querySelector('[type=submit]'), error = form.querySelector('.form-error'), values = Object.fromEntries(new FormData(form))
    button.disabled = true; error.hidden = true
    try {
      if (signup) await api('/api/auth/sign-up/email', { method: 'POST', body: { email: values.login.trim(), password: values.password, name: values.name.trim(), username: values.username.trim() } })
      else await api(`/api/auth/sign-in/${values.login.includes('@') ? 'email' : 'username'}`, { method: 'POST', body: { [values.login.includes('@') ? 'email' : 'username']: values.login.trim(), password: values.password } })
      await refreshMe()
      closeModal()
      toast(signup ? 'Добро пожаловать в Grade!' : 'Вы вошли в аккаунт')
      if (signup) navigate('/start')
      else render()
    } catch (err) {
      const messages = { USER_ALREADY_EXISTS:'Эта почта уже зарегистрирована', USERNAME_IS_ALREADY_TAKEN:'Этот никнейм уже занят', INVALID_EMAIL_OR_PASSWORD:'Неверная почта или пароль', INVALID_USERNAME_OR_PASSWORD:'Неверный никнейм или пароль', INVALID_USERNAME:'Проверьте никнейм: только латиница, цифры и _' }
      error.textContent = messages[err.code] || err.message
      error.hidden = false
    } finally { button.disabled = false }
  }
}

async function render() {
  const generation = ++state.generation
  const path = location.pathname
  main.innerHTML = '<div class="loading" role="status"><span class="loader"></span>Находим вашу историю…</div>'
  const nav = path === '/' ? 'home' : path === '/catalog' || path.startsWith('/title/') ? 'catalog' : params().get('tab') || 'ratings'
  document.querySelectorAll('[data-nav]').forEach((link) => { link.classList.toggle('active', link.dataset.nav === nav) })
  try {
    let content
    if (path === '/') content = await homePage()
    else if (path === '/catalog') content = await catalogPage()
    else if (/^\/title\/\d+$/.test(path)) content = await titlePage(path.split('/').pop())
    else if (path === '/me' || path.startsWith('/u/')) {
      if (path === '/me') {
        if (!state.me) content = loginRequired()
        else { navigate(`/u/${encodeURIComponent(state.me.user.username)}${location.search}`, true); return }
      } else content = await profilePage(decodeURIComponent(path.slice(3)))
    } else if (path === '/start') content = state.me ? await onboardingPage() : loginRequired()
    else if (path === '/about') content = aboutPage()
    else content = empty('Эта история ещё не найдена', 'Возможно, ссылка изменилась. В каталоге есть что посмотреть.')
    if (generation !== state.generation) return
    main.innerHTML = content
    bindPage()
    document.title = path.startsWith('/title/') && state.title ? `${state.title.name} — Grade` : 'Grade — истории, которые остаются'
    const search = params().get('q') || ''
    document.querySelector('#search').value = search
  } catch (error) {
    if (generation !== state.generation) return
    main.innerHTML = `<section class="container error-page" role="alert"><p class="eyebrow">НЕБОЛЬШОЙ АНТРАКТ</p><h1>Не удалось открыть страницу</h1><p>${esc(error.message)}</p><button class="button primary" data-action="retry">Попробовать снова</button></section>`
  }
}
const loginRequired = () => `<div class="container">${empty('Ваша коллекция начинается здесь', 'Войдите в аккаунт, чтобы видеть свои оценки и просмотренное.')}<div class="center-action"><button class="button primary" data-action="login">Войти или зарегистрироваться</button></div></div>`

async function homePage() {
  const result = await api('/api/catalog?sort=popular')
  const featured = result.items[0]
  if (!featured) return empty('Скоро здесь начнутся истории', 'Каталог пока пуст. Загляните немного позже.')
  return `<section class="hero container"><div class="hero-backdrop" style="background-image:url('${esc(featured.backdrop)}')"></div><div class="hero-content"><div class="hero-kicker"><span class="live-dot"></span> ВАШ СЛЕД В МИРЕ ИСТОРИЙ</div><h1>Смотреть.<br>Чувствовать.<br><span>Запоминать.</span></h1><p>Аниме, кино и сериалы в одном месте.<br>Собирайте просмотренное. Делитесь своим взглядом.</p><div class="hero-actions"><a href="${state.me ? '/start' : '/catalog'}" class="button primary">${state.me ? 'Вспомнить просмотренное' : 'Найти свою историю'} ${icon('arrow')}</a><span>В вашем ритме.<br>С вашим вкусом.</span></div></div><a href="/title/${featured.id}" class="hero-feature"><span class="eyebrow">СЕГОДНЯ В ФОКУСЕ</span><strong>${esc(featured.name)}</strong><span>${featured.year} · ${kindName(featured.kind)} ${icon('arrow')}</span></a><div class="hero-index"><span>01</span> / ИСТОРИИ БЕЗ ГРАНИЦ</div></section>
    <div class="container home-body">
    ${state.me && !state.me.onboarding_done ? '<a class="onboarding-banner" href="/start"><span>✳</span><div><strong>Начнём со знакомого?</strong><p>Отметьте, что уже смотрели. Оценить можно потом.</p></div>'+icon('arrow')+'</a>' : ''}
    <section class="catalog-section"><div class="section-heading"><div><p class="eyebrow">ТЕ САМЫЕ ИСТОРИИ</p><h2>С чего начнём<span class="accent">?</span></h2></div><a class="text-link" href="/catalog">Весь каталог ${icon('arrow')}</a></div><div class="category-pills"><a class="active" href="/catalog">Всё вместе</a><a href="/catalog?kind=anime">✧ Аниме</a><a href="/catalog?kind=movie">${icon('film')} Фильмы</a><a href="/catalog?kind=series">▤ Сериалы</a></div>${cards(result.items.slice(0, 6))}</section>
    <section class="memory-section"><div><p class="eyebrow">КОЛЛЕКЦИЯ, КОТОРАЯ РАСТЁТ ВМЕСТЕ С ВАМИ</p><h2>Вы это точно<br><span>смотрели.</span></h2><p>Иногда сложно вспомнить всё.<br>Начните с известных историй — просто «смотрел» или «не смотрел».</p><a class="button secondary" href="/start">Собрать просмотренное ${icon('arrow')}</a><span class="memory-footnote">Без оценок и обязательств.</span></div><div class="memory-posters">${result.items.slice(6,9).map((item, i) => `<a href="/title/${item.id}" class="memory-poster memory-${i}">${poster(item)}</a>`).join('')}<span class="memory-note">это часть<br>вашей истории ↗</span></div></section>
    <section class="catalog-section"><div class="section-heading"><div><p class="eyebrow">ПО ТУ СТОРОНУ ЭКРАНА</p><h2>Миры аниме<span class="accent">.</span></h2></div><a href="/catalog?kind=anime" class="text-link">Больше аниме ${icon('arrow')}</a></div>${cards(result.items.filter((item) => item.kind === 'anime').slice(0,6))}</section>
    <section class="principles"><article><span>01</span><h3>Смотрел — уже достаточно</h3><p>Храните просмотренное без необходимости ставить оценку.</p></article><article><span>02</span><h3>Ваши оценки — ваш вкус</h3><p>Отдельная коллекция оценок в публичном профиле.</p></article><article><span>03</span><h3>Обсуждения без сюрпризов</h3><p>Спойлеры раскрываются только тогда, когда вы готовы.</p></article></section>
    </div>`
}
async function catalogPage() {
  const p = params(), kind = p.get('kind') || '', search = p.get('q') || '', sort = p.get('sort') || 'popular'
  const result = await api(`/api/catalog?${new URLSearchParams({ kind, q:search, sort, page:p.get('page') || '1' })}`)
  return `<div class="container page"><header class="page-heading"><div><p class="eyebrow">ЧТО ПОСМОТРИМ?</p><h1>${search ? `Поиск: «${esc(search)}»` : 'Ваша следующая история<span class="accent">.</span>'}</h1><p>${search ? `Найдено тайтлов: ${result.total}` : 'Знакомое и ещё не открытое. Выбирайте по настроению.'}</p></div><span class="catalog-count">${result.total} <small>тайтлов</small></span></header>
    <div class="catalog-toolbar"><nav class="category-pills" aria-label="Тип тайтла">${[['','Всё вместе'],['anime','Аниме'],['movie','Фильмы'],['series','Сериалы']].map(([value,label]) => `<a class="${kind === value ? 'active' : ''}" href="${esc(urlFor({kind:value,q:search,sort}))}">${label}</a>`).join('')}</nav><label class="sort-label">Сначала<select id="catalog-sort"><option value="popular" ${sort === 'popular' ? 'selected' : ''}>Популярное</option><option value="rating" ${sort === 'rating' ? 'selected' : ''}>Высокие оценки Grade</option><option value="new" ${sort === 'new' ? 'selected' : ''}>Новые по году</option></select></label></div>
    ${result.items.length ? cards(result.items) : empty('Пока ничего не нашлось', 'Попробуйте другое название, оригинальное имя или жанр.')}
    ${pager(result.page, result.pages, (page) => urlFor({kind,q:search,sort,page}))}
    ${search && result.externalSearch ? '<div class="external-search"><p>Ищете что-то за пределами подборки?</p><button class="button secondary" data-action="external-search">Искать в TMDB '+icon('arrow')+'</button><div id="external-results"></div></div>' : '<p class="catalog-source-note">Стартовая подборка известных историй. Оценки Grade появляются только от реальных пользователей.</p>'}</div>`
}

async function profilePage(username) {
  const p = params(), data = await api(`/api/profiles/${encodeURIComponent(username)}?${new URLSearchParams({ tab:p.get('tab') || 'ratings',page:p.get('page') || '1' })}`)
  const { user, stats, own, tab } = data
  return `<div class="container page profile-page"><header class="profile-heading"><div class="profile-avatar">${avatar(user.name)}</div><div class="profile-identity"><p class="eyebrow">${own ? 'ВАШЕ ПРОСТРАНСТВО' : 'ПРОФИЛЬ ЗРИТЕЛЯ'}</p><h1>${esc(user.name)}</h1><span class="profile-handle">@${esc(user.username)}</span>${user.bio ? `<p class="profile-bio">${esc(user.bio)}</p>` : '<p class="profile-bio muted">Истории говорят за себя.</p>'}</div>${own ? '<button class="button secondary profile-edit" data-action="edit-profile">'+icon('settings')+' Редактировать</button>' : ''}</header>
    <div class="profile-stats"><div><strong>${stats.watched}</strong><span>просмотрено</span></div><div><strong>${stats.rated}</strong><span>оценок</span></div><div><strong>${stats.average ?? '—'}</strong><span>средняя оценка</span></div><div><strong>${stats.reviews}</strong><span>отзывов</span></div></div>
    <div class="profile-tabs" role="navigation" aria-label="Коллекции профиля">${[['ratings','Оценки',stats.rated],['watched','Смотрел',stats.watched],['reviews','Отзывы',stats.reviews]].map(([value,label,count]) => `<a class="${tab === value ? 'active' : ''}" href="/u/${encodeURIComponent(user.username)}?tab=${value}">${label}<span>${count}</span></a>`).join('')}</div>
    ${tab === 'watched' ? '<p class="collection-hint">Просмотренное сохраняется независимо от оценок. '+(own ? 'Оценить любой тайтл можно на его странице.' : '')+'</p>' : ''}
    ${data.items.length ? tab === 'reviews' ? `<div class="profile-reviews">${data.items.map((item) => `<article class="profile-review"><a href="/title/${item.id}">${poster(item)}</a><div><a class="review-title" href="/title/${item.id}">${esc(item.name)}</a><span class="review-date">${item.year} · ${kindName(item.kind)}${item.my_score ? ` · Моя оценка: ${item.my_score}/10` : ''}</span>${item.spoiler ? spoilerPlaceholder(item.review_id,'reviews') : `<p class="user-content">${esc(item.content)}</p>`}<a href="/title/${item.id}" class="text-link">К обсуждению ${icon('arrow')}</a></div></article>`).join('')}</div>` : cards(data.items) : empty(tab === 'ratings' ? 'Оценки ещё впереди' : tab === 'watched' ? 'Каждая коллекция с чего-то начинается' : 'Слов пока нет', own ? tab === 'watched' ? 'Отмечайте просмотренное в каталоге или начните с подборки знакомых историй.' : tab === 'ratings' ? 'Откройте тайтл и поставьте свою оценку от 1 до 10.' : 'Оставьте первый отзыв на странице аниме, фильма или сериала.' : 'В этой коллекции пока нет записей.', tab === 'watched' && own ? '/start' : '/catalog', tab === 'watched' && own ? 'Вспомнить просмотренное' : 'Открыть каталог')}
    ${pager(data.page,data.pages,(page) => `/u/${encodeURIComponent(user.username)}?${new URLSearchParams({tab,page})}`)}</div>`
}
function spoilerPlaceholder(id, type) {
  return `<div class="spoiler-placeholder" data-spoiler="${type}-${id}">${icon('eye')}<span>Здесь может быть спойлер</span><button class="text-button" data-action="reveal" data-type="${type}" data-id="${id}">Показать</button></div>`
}
async function onboardingPage() {
  if (!state.onboarding) {
    const result = await api('/api/catalog?sort=popular')
    state.onboarding = { items: result.items, index: 0, added: 0 }
  }
  const { items, index, added } = state.onboarding, item = items[index]
  if (!item) return `<div class="container page">${empty('Начало вашей коллекции положено', `Отмечено в этой подборке: ${added}. Оценки можно добавить в любой момент.`, '/me?tab=watched','К просмотренному')}<div class="center-action"><button class="button secondary" data-action="onboard-finish">Завершить подборку</button></div></div>`
  return `<div class="container onboarding-page"><header><p class="eyebrow">НАЧНЁМ СО ЗНАКОМОГО</p><h1>Уже смотрели<span class="accent">?</span></h1><p>Добавляйте в просмотренное. Ставить оценку сейчас не нужно.</p></header><div class="onboard-progress"><span style="width:${Math.round(index / items.length * 100)}%"></span></div><div class="onboard-counter"><span>${String(index + 1).padStart(2,'0')} / ${items.length}</span><button class="text-button" data-action="onboard-finish">Закончить подборку</button></div>
    <article class="onboard-card"><a class="onboard-poster" href="/title/${item.id}">${poster(item,false)}</a><div class="onboard-info"><span class="kind-label">${kindName(item.kind)} · ${item.year}</span><h2>${esc(item.name)}</h2><p class="original-name">${esc(item.original_name)}</p><p>${esc(item.description)}</p><div class="genre-tags">${item.genres.map((genre) => `<span>${esc(genre)}</span>`).join('')}</div><div class="onboard-actions"><button class="button primary" data-action="onboard-yes">${icon('check')} Смотрел</button><button class="button secondary" data-action="onboard-no">Не смотрел</button></div><button class="text-button onboard-skip" data-action="onboard-skip">Пропустить →</button><p class="small muted">${added ? `Добавлено в этой подборке: ${added}` : 'Только вы решаете, что будет в вашей коллекции.'}</p></div></article></div>`
}

function aboutPage() {
  return `<div class="container page about-page"><p class="eyebrow">О ПРОЕКТЕ</p><h1>У каждого свой Grade<span class="accent">.</span></h1><p>Здесь можно собирать просмотренное, оценивать аниме, фильмы и сериалы и делиться впечатлениями. Оценки и просмотренное — разные коллекции: одно не обязывает к другому.</p><h2>Каталог и оценки</h2><p>Сервис начинает работу с подборкой известных тайтлов. «Популярное» в этой подборке — порядок знакомства с каталогом, а не рейтинг текущих просмотров. Оценки и их количество считаются только из голосов пользователей Grade. Мы не создаём вымышленные отзывы и оценки.</p><p>Поиск по TMDB за пределами подборки появляется после подключения внешнего каталога владельцем сервиса. У постеров и сведений о произведениях свои правообладатели. This product uses the TMDB API but is not endorsed or certified by TMDB.</p><h2>Спойлеры и обсуждения</h2><p>Отмечайте спойлеры перед публикацией. Скрытый текст загружается только после нажатия «Показать». Фильтр «Без спойлеров» исключает такие сообщения из ленты. В ответах на комментарий со спойлером отметка наследуется.</p><h2>Публичный профиль</h2><p>Имя, никнейм, описание, оценки, просмотренное и отзывы видны посетителям. Почта не отображается в публичном профиле. Удалить свою оценку или публикацию можно на странице произведения.</p><a class="button primary" href="/catalog">К историям ${icon('arrow')}</a></div>`
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
  return `<div class="container title-page"><a href="/catalog" class="back-link">← В каталог</a><div class="title-layout"><aside class="title-sidebar"><div class="detail-poster">${poster(item,false)}</div><button class="button ${item.watched ? 'selected' : 'primary'} full" data-action="watch" data-id="${item.id}" data-watched="${item.watched ? 'true' : 'false'}">${icon(item.watched ? 'check' : 'plus')} ${item.watched ? 'Уже в просмотренном' : 'Смотрел'}</button><p class="small muted center">Можно сохранить без оценки.</p></aside>
    <div class="title-info"><div class="title-kicker"><span class="kind-label">${kindName(item.kind)}</span><span>${item.year || ''}</span><span>${esc(item.runtime)}</span></div><h1>${esc(item.name)}</h1><p class="original-name">${esc(item.original_name)}</p><div class="genre-tags">${item.genres.map((genre) => `<a href="/catalog?q=${encodeURIComponent(genre)}">${esc(genre)}</a>`).join('')}</div>
    <div class="title-overview"><div class="overall-score"><strong>${item.average ?? '—'}</strong><div>${icon('star')}<span>${item.votes ? `${item.votes} оценок Grade` : 'Пока нет оценок'}</span></div></div><p>Хорошая история?<br><span>Решать вам.</span></p></div>
    <p class="title-description">${esc(item.description || 'Описание пока не добавлено.')}</p><section class="rating-section"><div><h2>Ваша оценка</h2><span>${item.my_score ? `${item.my_score} из 10` : 'Какое впечатление осталось?'}</span></div><div class="rating-scale" role="group" aria-label="Оценка от 1 до 10">${Array.from({length:10},(_,i) => `<button type="button" aria-label="Оценить на ${i+1}" aria-pressed="${item.my_score === i+1}" data-action="rate" data-id="${item.id}" data-score="${i+1}" class="${item.my_score === i+1 ? 'picked' : ''}">${i+1}</button>`).join('')}</div><div class="rating-legend"><span>Совсем не моё</span><span>В самое сердце</span></div>${item.my_score ? `<button class="text-button remove-rating" data-action="remove-rating" data-id="${item.id}">Удалить мою оценку</button>` : ''}</section>
    <section class="discussion"><div class="discussion-header"><h2>После титров<span class="accent">.</span></h2><button class="button secondary" data-action="review" data-id="${item.id}">${icon('plus')} Написать отзыв</button></div>
    <div class="discussion-toolbar"><nav class="discussion-tabs" aria-label="Тип обсуждения"><a class="${type === 'reviews' ? 'active' : ''}" href="/title/${item.id}?type=reviews&filter=${filter}">Отзывы</a><a class="${type === 'comments' ? 'active' : ''}" href="/title/${item.id}?type=comments&filter=${filter}">Комментарии</a></nav><label class="spoiler-filter">${icon('eye')}<select id="spoiler-filter" aria-label="Фильтр спойлеров"><option value="all" ${filter === 'all' ? 'selected' : ''}>Спойлеры скрыты</option><option value="clean" ${filter === 'clean' ? 'selected' : ''}>Без спойлеров</option></select></label></div>
    ${type === 'comments' ? `<form id="comment-form" class="comment-form"><label for="comment-text">${state.me ? 'Что думаете об этой истории?' : 'Войдите, чтобы присоединиться к разговору'}</label><div id="reply-context" hidden></div><textarea id="comment-text" name="content" required maxlength="2000" rows="3" placeholder="Обсудим? Только не забудьте отметить спойлеры…"></textarea><div><label class="checkbox-label"><input type="checkbox" name="spoiler"> Есть спойлеры</label><button class="button primary" type="submit">Отправить ${icon('arrow')}</button></div></form>` : ''}
    <div class="discussion-items">${discussion.items.length ? discussion.items.map((row) => discussionItem(row,type)).join('') : `<div class="discussion-empty">${icon('chat')}<h3>${filter === 'clean' ? 'Пока нет записей без спойлеров' : type === 'reviews' ? 'Первое слово за вами' : 'Здесь начинается разговор'}</h3><p>${type === 'reviews' ? 'Поделитесь впечатлениями — без пересказа сюжета или с отметкой о спойлерах.' : 'Задайте вопрос или расскажите, что запомнилось.'}</p></div>`}</div>
    ${pager(discussion.page,discussion.pages,(page) => `/title/${item.id}?${new URLSearchParams({type,filter,page})}`)}</section></div></div></div>`
}
function discussionItem(row, type) {
  const date = new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'short',year:'numeric'}).format(new Date(row.created_at))
  return `<article class="discussion-item ${row.parent_id ? 'is-reply' : ''}"><div class="discussion-author"><a href="/u/${encodeURIComponent(row.username)}">${avatar(row.name)}</a><div><a href="/u/${encodeURIComponent(row.username)}">${esc(row.name)}</a><span>@${esc(row.username)} · ${date}</span></div>${row.user_score ? `<span class="author-score">${icon('star')} ${row.user_score}</span>` : ''}</div>
    ${row.reply_to ? `<p class="reply-to">↳ В ответ ${esc(row.reply_to)}</p>` : ''}
    ${row.spoiler ? spoilerPlaceholder(row.id,type) : `<p class="user-content">${esc(row.content)}</p>`}
    <div class="discussion-item-actions">${type === 'comments' && !row.parent_id ? `<button class="text-button" data-action="reply" data-id="${row.id}" data-name="${esc(row.name)}" data-spoiler="${row.spoiler}">Ответить</button>` : ''}${row.own ? `${type === 'reviews' ? `<button class="text-button" data-action="review" data-id="${row.title_id}">Редактировать</button>` : ''}<button class="text-button muted" data-action="delete-post" data-id="${row.id}" data-type="${type}">Удалить</button>` : ''}</div></article>`
}

function bindPage() {
  const sort = document.querySelector('#catalog-sort')
  if (sort) sort.onchange = () => { const p = params(); p.set('sort',sort.value); p.delete('page'); navigate(`/catalog?${p}`) }
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
      toast('Комментарий опубликован')
      render()
    } catch (error) { toast(error.message) }
    finally { button.disabled = false }
  }
}
async function reviewModal(titleId) {
  if (!needUser()) return
  const own = await api(`/api/titles/${titleId}/my-review`)
  openModal(`<p class="eyebrow">ВАШ ВЗГЛЯД</p><h2>${own ? 'Вернуться к впечатлениям' : 'Что осталось после титров?'}</h2><p class="modal-subtitle">Один отзыв — одна история. Его можно редактировать.</p><form id="review-form" class="stack-form"><label>Отзыв<textarea name="content" rows="8" required minlength="20" maxlength="10000" placeholder="Что вам понравилось? Кому стоит посмотреть?">${esc(own?.content || '')}</textarea></label><label class="checkbox-label"><input type="checkbox" name="spoiler" ${own?.spoiler ? 'checked' : ''}>В отзыве есть спойлеры</label><p class="form-error" role="alert" hidden></p><button class="button primary" type="submit">${own ? 'Сохранить отзыв' : 'Опубликовать'} ${icon('arrow')}</button></form>`)
  document.querySelector('#review-form').onsubmit = async (event) => {
    event.preventDefault()
    const form = event.currentTarget, button = form.querySelector('[type=submit]'), error = form.querySelector('.form-error')
    button.disabled = true
    try {
      await api(`/api/titles/${titleId}/review`,{method:'PUT',body:{content:form.elements.content.value,spoiler:form.elements.spoiler.checked}})
      closeModal(); toast('Отзыв сохранён'); navigate(`/title/${titleId}?type=reviews`)
    } catch (err) { error.textContent = err.message; error.hidden = false }
    finally { button.disabled = false }
  }
}
function editProfile() {
  if (!needUser()) return
  openModal(`<p class="eyebrow">ЛИЧНОЕ</p><h2>Немного о вас.</h2><form id="profile-form" class="stack-form"><label>Имя<input name="name" required minlength="2" maxlength="40" value="${esc(state.me.user.name)}"></label><label>О себе<textarea name="bio" rows="4" maxlength="400" placeholder="Любимые жанры, режиссёры, уютные истории…">${esc(state.me.bio)}</textarea></label><p class="form-error" role="alert" hidden></p><button class="button primary" type="submit">Сохранить ${icon('check')}</button></form>`)
  document.querySelector('#profile-form').onsubmit = async (event) => {
    event.preventDefault()
    const form = event.currentTarget, button = form.querySelector('[type=submit]'), error = form.querySelector('.form-error')
    button.disabled = true
    try {
      await api('/api/me',{method:'PATCH',body:{name:form.elements.name.value,bio:form.elements.bio.value}})
      await refreshMe(); closeModal(); toast('Профиль обновлён'); render()
    } catch (err) { error.textContent = err.message; error.hidden = false }
    finally { button.disabled = false }
  }
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
      if (action === 'signout') {
        await api('/api/auth/sign-out',{method:'POST'})
        state.onboarding = null
        await refreshMe(); navigate('/'); return
      }
      if (action === 'watch') {
        if (!needUser()) return
        button.disabled = true
        const watched = button.dataset.watched !== 'true'
        await api(`/api/titles/${button.dataset.id}/watched`,{method:'PUT',body:{watched}})
        toast(watched ? 'Добавлено в «Смотрел». Оценить можно позже.' : 'Удалено из просмотренного. Оценка сохранена.')
        return render()
      }
      if (action === 'rate' || action === 'remove-rating') {
        if (!needUser()) return
        button.disabled = true
        await api(`/api/titles/${button.dataset.id}/rating`,{method:action === 'rate' ? 'PUT' : 'DELETE',body:action === 'rate' ? {score:Number(button.dataset.score)} : {}})
        toast(action === 'rate' ? 'Ваша оценка сохранена' : 'Оценка удалена. Просмотренное сохранено.')
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
        context.innerHTML = `<span>Ответ ${esc(button.dataset.name)}</span><button class="text-button" data-action="cancel-reply" type="button">Отменить</button>`; context.hidden = false
        form.scrollIntoView({behavior:'smooth',block:'center'}); form.elements.content.focus(); return
      }
      if (action === 'cancel-reply') {
        const form = document.querySelector('#comment-form'); delete form.dataset.parent
        form.elements.spoiler.disabled = false; form.elements.spoiler.checked = false
        document.querySelector('#reply-context').hidden = true; return
      }
      if (action === 'delete-post') {
        if (!needUser() || !confirm('Удалить вашу публикацию? Ответы на комментарий тоже будут удалены.')) return
        button.disabled = true
        await api(`/api/${button.dataset.type}/${button.dataset.id}`,{method:'DELETE'})
        toast('Публикация удалена'); return render()
      }
      if (action.startsWith('onboard-')) {
        if (!needUser()) return
        button.disabled = true
        if (action === 'onboard-finish') {
          await api('/api/onboarding/complete',{method:'POST'})
          state.onboarding = null; await refreshMe(); navigate('/me?tab=watched'); return
        }
        if (action === 'onboard-yes') {
          const item = state.onboarding.items[state.onboarding.index]
          await api(`/api/titles/${item.id}/watched`,{method:'PUT',body:{watched:true}})
          state.onboarding.added++
        }
        state.onboarding.index++
        return render()
      }
      if (action === 'external-search') {
        if (!needUser()) return
        button.disabled = true
        const data = await api(`/api/catalog/external?q=${encodeURIComponent(params().get('q'))}`)
        state.external = data.items
        document.querySelector('#external-results').innerHTML = data.items.length ? `<div class="external-grid">${data.items.map((item,i) => `<button type="button" class="external-item" data-action="import-title" data-index="${i}">${poster(item)}<span><strong>${esc(item.name)}</strong><small>${item.year || '—'} · ${kindName(item.kind)}</small></span>${icon('plus')}</button>`).join('')}</div>` : '<p class="muted">Во внешнем каталоге тоже ничего не нашлось.</p>'
        return
      }
      if (action === 'import-title') {
        if (!needUser()) return
        button.disabled = true
        const item = state.external[Number(button.dataset.index)]
        const data = await api('/api/catalog/import',{method:'POST',body:{external_id:item.external_id}})
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
  event.preventDefault(); navigate(target.pathname + target.search)
})
document.querySelector('#search-form').onsubmit = (event) => {
  event.preventDefault(); navigate(urlFor({q:document.querySelector('#search').value.trim()}))
}
document.addEventListener('keydown',(event) => {
  if (event.key === '/' && !event.ctrlKey && !event.metaKey && !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName) && !document.querySelector('#modal').open) { event.preventDefault(); document.querySelector('#search').focus() }
})
document.querySelector('.modal-close').onclick = closeModal
document.querySelector('#modal').addEventListener('click',(event) => { if (event.target === event.currentTarget) closeModal() })
document.addEventListener('error',(event) => { if (event.target instanceof HTMLImageElement) event.target.remove() },true)
window.addEventListener('popstate',render)
try { await refreshMe() } catch (error) { toast(error.message); document.querySelector('#account').innerHTML = '<button class="button secondary" data-action="login">Войти</button>' }
render()
