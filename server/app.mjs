import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { toNodeHandler, fromNodeHeaders } from 'better-auth/node'
import { query, transaction } from './db.mjs'
import { catalog, titleById, externalSearch, importTitle } from './catalog.mjs'
import { HttpError, text, id, score, boolean, page, spoilerContent } from './validation.mjs'
import { getTrustedOrigins } from './origins.mjs'
import { localeFor, localizeTitles } from './localization.mjs'
import { avatarImage, avatarUrl, profileVisibility } from './avatar.mjs'
import { ratingsFor } from './ratings.mjs'

const publicPath = fileURLToPath(new URL('../public/', import.meta.url))
export function createApp(auth) {
  const app = express()
  const trustedOrigins = new Set(getTrustedOrigins())
  app.disable('x-powered-by')
  app.set('trust proxy', 1)
  app.use((req, res, next) => {
    // Overwrite a private header from Express's proxy-aware client address.
    req.headers['x-grade-client-ip'] = req.ip
    res.set({
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' https://image.tmdb.org data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
    })
    next()
  })
  app.use('/api', (req, res, next) => {
    req.locale = localeFor(req.headers['accept-language'])
    res.set({ 'Cache-Control': 'no-store, private', Vary: 'Cookie, Accept-Language' })
    if (!['GET','HEAD','OPTIONS'].includes(req.method)) {
      if (req.headers.origin ? !trustedOrigins.has(req.headers.origin) : req.headers['sec-fetch-site'] !== 'same-origin')
        return next(new HttpError(403, 'Запрос должен быть отправлен с сайта Grade'))
    }
    next()
  })
  app.all('/api/auth/*splat', toNodeHandler(auth))
  app.use('/api/me/avatar', express.raw({ type:'image/jpeg', limit:'256kb' }))
  app.use(express.json({ limit: '32kb' }))
  app.use('/api', (req, _res, next) => {
    if (['POST','PUT','PATCH'].includes(req.method) && (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)))
      return next(new HttpError(400, 'Ожидается JSON-объект'))
    next()
  })
  app.use('/api', async (req, _res, next) => {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) })
    req.user = session?.user || null
    next()
  })
  const requireUser = (req) => {
    if (!req.user) throw new HttpError(401, 'Войдите в аккаунт, чтобы продолжить')
    return req.user.id
  }
  const limitRequests = async (key, max) => {
    const result = await query(`INSERT INTO request_limits(key,count,expires_at) VALUES($1,1,NOW()+INTERVAL '1 minute')
      ON CONFLICT(key) DO UPDATE SET count=CASE WHEN request_limits.expires_at<NOW() THEN 1 ELSE request_limits.count+1 END,
      expires_at=CASE WHEN request_limits.expires_at<NOW() THEN NOW()+INTERVAL '1 minute' ELSE request_limits.expires_at END RETURNING count`, [key])
    if (result.rows[0].count > max) throw new HttpError(429, 'Слишком много действий. Подождите минуту.')
  }
  const write = async (req) => {
    const userId = requireUser(req)
    await limitRequests(userId, 60)
    return userId
  }
  app.get('/api/health', async (_req, res) => { await query('SELECT 1'); res.json({ ok: true }) })
  app.get('/api/me', async (req, res) => {
    if (!req.user) return res.json({ user: null })
    const profile = (await query('SELECT p.*,a.version AS avatar_version FROM "user" u LEFT JOIN profiles p ON p.user_id=u.id LEFT JOIN profile_avatars a ON a.user_id=u.id WHERE u.id=$1', [req.user.id])).rows[0]
    res.json({ user: { id: req.user.id, name: req.user.name, username: req.user.username || req.user.id, email: req.user.email }, bio: profile?.bio || '', avatar_color: profile?.avatar_color || 'lime', avatar_url: avatarUrl(req.user.id,profile?.avatar_version), visibility:profileVisibility(profile), onboarding_done: profile?.onboarding_done || false })
  })
  app.patch('/api/me', async (req, res) => {
    const userId = await write(req)
    const name = text(req.body.name, { min: 2, max: 40, label: 'Имя' })
    const bio = text(req.body.bio ?? '', { min: 0, max: 400, label: 'О себе' })
    const color = req.body.avatar_color
    if (color !== undefined && !['lime','violet','blue','orange','pink','gray'].includes(color)) throw new HttpError(400, 'Некорректный цвет аватара')
    await transaction(async (client) => {
      await client.query('UPDATE "user" SET name=$1,"updatedAt"=NOW() WHERE id=$2', [name, userId])
      await client.query("INSERT INTO profiles(user_id,bio,avatar_color) VALUES($1,$2,COALESCE($3,'lime')) ON CONFLICT(user_id) DO UPDATE SET bio=EXCLUDED.bio,avatar_color=COALESCE($3,profiles.avatar_color)", [userId, bio, color ?? null])
    })
    res.json({ ok: true })
  })
  app.put('/api/me/avatar', async (req, res) => {
    const userId = await write(req), content = avatarImage(req.body), version = randomUUID()
    await query('INSERT INTO profile_avatars(user_id,content,version) VALUES($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET content=EXCLUDED.content,version=EXCLUDED.version',[userId,content,version])
    res.json({ avatar_url:avatarUrl(userId,version) })
  })
  app.delete('/api/me/avatar', async (req, res) => {
    await query('DELETE FROM profile_avatars WHERE user_id=$1',[await write(req)])
    res.json({ ok:true })
  })
  app.get('/api/avatars/:userId/:version', async (req, res) => {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(req.params.userId) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(req.params.version)) throw new HttpError(404,'Фото не найдено')
    const row = (await query('SELECT content FROM profile_avatars WHERE user_id=$1 AND version=$2',[req.params.userId,req.params.version])).rows[0]
    if (!row) throw new HttpError(404,'Фото не найдено')
    res.type('image/jpeg').set('Content-Disposition','inline').send(row.content)
  })
  app.patch('/api/me/privacy', async (req, res) => {
    const userId = await write(req), values = ['watched','ratings','reviews','comments'].map(key => boolean(req.body[key]))
    const planned = req.body.planned === undefined ? null : boolean(req.body.planned)
    await query(`INSERT INTO profiles(user_id,show_watched,show_ratings,show_reviews,show_comments,show_planned) VALUES($1,$2,$3,$4,$5,COALESCE($6,TRUE))
      ON CONFLICT(user_id) DO UPDATE SET show_watched=EXCLUDED.show_watched,show_ratings=EXCLUDED.show_ratings,show_reviews=EXCLUDED.show_reviews,show_comments=EXCLUDED.show_comments,show_planned=COALESCE($6,profiles.show_planned)`,[userId,...values,planned])
    res.json({ ok:true })
  })
  app.post('/api/onboarding/complete', async (req, res) => {
    const userId = await write(req)
    await query('INSERT INTO profiles(user_id,onboarding_done) VALUES($1,TRUE) ON CONFLICT(user_id) DO UPDATE SET onboarding_done=TRUE', [userId])
    res.json({ ok: true })
  })
  app.get('/api/catalog', async (req, res) => {
    const data = await catalog(req.query, req.user?.id)
    res.json({ ...data, items: await localizeTitles(data.items, req.locale) })
  })
  app.get('/api/catalog/external', async (req, res) => {
    const search = text(req.query.q, { min: 2, max: 100, label: 'Поиск' })
    await limitRequests(`search:${req.user?.id || req.ip}`, 30)
    const kind = ['anime','movie','series'].includes(req.query.kind) ? req.query.kind : null
    res.json({ items: await externalSearch(search, kind, req.locale) })
  })
  app.post('/api/catalog/import', async (req, res) => {
    await write(req)
    res.json(await importTitle(text(req.body.external_id, { max: 40 })))
  })
  app.get('/api/titles/:id', async (req, res) => res.json((await localizeTitles([await titleById(req.params.id, req.user?.id)], req.locale))[0]))
  app.get('/api/titles/:id/external-ratings', async (req, res) => res.json(await ratingsFor(await titleById(req.params.id))))
  app.get('/api/titles/:id/my-review', async (req, res) => {
    const userId = requireUser(req)
    res.json((await query('SELECT * FROM reviews WHERE user_id=$1 AND title_id=$2', [userId, id(req.params.id)])).rows[0] || null)
  })
  app.put('/api/titles/:id/watched', async (req, res) => {
    const userId = await write(req), title = await titleById(req.params.id)
    if (boolean(req.body.watched)) await transaction(async client => {
      await client.query('INSERT INTO watched(user_id,title_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [userId,title.id])
      await client.query('DELETE FROM planned WHERE user_id=$1 AND title_id=$2', [userId,title.id])
    })
    else await query('DELETE FROM watched WHERE user_id=$1 AND title_id=$2', [userId, title.id])
    res.json({ watched: req.body.watched })
  })
  app.put('/api/titles/:id/planned', async (req, res) => {
    const userId = await write(req), title = await titleById(req.params.id), planned = boolean(req.body.planned)
    if (planned) await query('INSERT INTO planned(user_id,title_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[userId,title.id])
    else await query('DELETE FROM planned WHERE user_id=$1 AND title_id=$2',[userId,title.id])
    res.json({ planned })
  })
  app.put('/api/titles/:id/rating', async (req, res) => {
    const userId = await write(req), title = await titleById(req.params.id), value = score(req.body.score)
    await query('INSERT INTO ratings(user_id,title_id,score) VALUES($1,$2,$3) ON CONFLICT(user_id,title_id) DO UPDATE SET score=EXCLUDED.score,updated_at=NOW()', [userId, title.id, value])
    res.json((await localizeTitles([await titleById(title.id, userId)], req.locale))[0])
  })
  app.delete('/api/titles/:id/rating', async (req, res) => {
    const userId = await write(req)
    await query('DELETE FROM ratings WHERE user_id=$1 AND title_id=$2', [userId, id(req.params.id)])
    res.json({ ok: true })
  })
  app.get('/api/profiles/:username', async (req, res) => {
    const handle = text(req.params.username, { max: 100 })
    const row = (await query(`SELECT u.id,u.name,COALESCE(u.username,u.id) AS username,u."createdAt" AS joined_at,
      COALESCE(p.bio,'') AS bio,COALESCE(p.avatar_color,'lime') AS avatar_color,a.version AS avatar_version,
      p.show_watched,p.show_ratings,p.show_reviews,p.show_comments,p.show_planned
      FROM "user" u LEFT JOIN profiles p ON p.user_id=u.id LEFT JOIN profile_avatars a ON a.user_id=u.id WHERE u.username=$1 OR u.id=$1`, [handle])).rows[0]
    if (!row) throw new HttpError(404, 'Профиль не найден')
    const own = row.id === req.user?.id, visibility = profileVisibility(row)
    const user = { id:row.id, name:row.name, username:row.username, joined_at:row.joined_at, bio:row.bio,
      avatar_color:row.avatar_color, avatar_url:avatarUrl(row.id,row.avatar_version) }
    const stats = (await query(`SELECT (SELECT COUNT(*)::int FROM ratings WHERE user_id=$1) AS rated,
      (SELECT COUNT(*)::int FROM watched WHERE user_id=$1) AS watched,
      (SELECT COUNT(*)::int FROM planned WHERE user_id=$1) AS planned,
      (SELECT COUNT(*)::int FROM reviews WHERE user_id=$1) AS reviews,
      (SELECT COUNT(*)::int FROM comments WHERE user_id=$1) AS comments,
      (SELECT ROUND(AVG(score),1)::float FROM ratings WHERE user_id=$1) AS average`, [user.id])).rows[0]
    const tabs = ['ratings','watched','planned','reviews','comments']
    const tab = tabs.includes(req.query.tab) ? req.query.tab : own ? 'ratings' : tabs.find(key => visibility[key]) || 'ratings'
    const current = page(req.query.page), hidden = !own && !visibility[tab]
    let items = []
    if (!hidden && ['reviews','comments'].includes(tab)) {
      const table = tab, order = tab === 'reviews' ? 'updated_at' : 'created_at'
      items = (await query(`SELECT t.*,r.id AS post_id,r.content,r.spoiler,r.${order} AS updated_at,
        (SELECT score FROM ratings WHERE user_id=$1 AND title_id=t.id) AS my_score
        FROM ${table} r JOIN titles t ON t.id=r.title_id WHERE r.user_id=$1 ORDER BY r.${order} DESC,r.id DESC LIMIT 24 OFFSET $2`, [user.id,(current-1)*24])).rows.map(row => spoilerContent(row))
    } else if (!hidden) {
      const table = ['watched','planned'].includes(tab) ? tab : 'ratings', order = tab === 'ratings' ? 'updated_at' : 'created_at'
      items = (await query(`SELECT t.*,(SELECT score FROM ratings WHERE user_id=$1 AND title_id=t.id) AS my_score,
        EXISTS(SELECT 1 FROM watched WHERE user_id=$1 AND title_id=t.id) AS watched,
        EXISTS(SELECT 1 FROM planned WHERE user_id=$1 AND title_id=t.id) AS planned FROM ${table} list JOIN titles t ON t.id=list.title_id
        WHERE list.user_id=$1 ORDER BY list.${order} DESC,t.id DESC LIMIT 24 OFFSET $2`, [user.id,(current-1)*24])).rows
    }
    const total = stats[tab === 'ratings' ? 'rated' : tab]
    if (!own) {
      stats.average = null
      if (!visibility.ratings) stats.rated = null
      for (const key of ['watched','reviews','comments','planned']) if (!visibility[key]) stats[key] = null
      items = items.map(item => ({ ...item, my_score:visibility.ratings ? item.my_score : null, watched:visibility.watched ? item.watched : false, planned:visibility.planned ? item.planned : false }))
    }
    res.json({ user, stats, visibility, hidden, items:await localizeTitles(items,req.locale), tab, page:current, pages:hidden ? 0 : Math.ceil(total/24), own })
  })
  app.get('/api/titles/:id/discussion', async (req, res) => {
    const titleId = id(req.params.id), current = page(req.query.page), clean = req.query.filter === 'clean'
    const table = req.query.type === 'reviews' ? 'reviews' : 'comments'
    const count = (await query(`SELECT COUNT(*)::int AS total FROM ${table} WHERE title_id=$1 AND (NOT $2::boolean OR NOT spoiler)`, [titleId, clean])).rows[0].total
    const items = (await query(`SELECT c.*,u.name,COALESCE(u.username,u.id) AS username,COALESCE(p.avatar_color,'lime') AS avatar_color,a.version AS avatar_version,
      (SELECT score FROM ratings WHERE user_id=c.user_id AND title_id=c.title_id) AS user_score,
      ${table === 'comments' ? "CASE WHEN c.parent_id IS NOT NULL THEN (SELECT pu.name FROM comments pc JOIN \"user\" pu ON pu.id=pc.user_id WHERE pc.id=c.parent_id) ELSE NULL END" : 'NULL'} AS reply_to
      FROM ${table} c JOIN "user" u ON u.id=c.user_id LEFT JOIN profiles p ON p.user_id=u.id LEFT JOIN profile_avatars a ON a.user_id=u.id WHERE c.title_id=$1 AND (NOT $2::boolean OR NOT c.spoiler)
      ORDER BY c.id DESC LIMIT 20 OFFSET $3`, [titleId, clean, (current - 1) * 20])).rows.map((row) => ({ ...spoilerContent(row), avatar_url:avatarUrl(row.user_id,row.avatar_version), own: row.user_id === req.user?.id }))
    res.json({ items, total: count, page: current, pages: Math.ceil(count / 20) })
  })
  app.post('/api/titles/:id/comments', async (req, res) => {
    const userId = await write(req), title = await titleById(req.params.id)
    const content = text(req.body.content), spoiler = boolean(req.body.spoiler ?? false)
    const result = await transaction(async (client) => {
      let parent = null
      if (req.body.parent_id) {
        parent = (await client.query('SELECT id,spoiler FROM comments WHERE id=$1 AND title_id=$2 AND parent_id IS NULL FOR SHARE', [id(req.body.parent_id), title.id])).rows[0]
        if (!parent) throw new HttpError(400, 'Комментарий для ответа не найден')
      }
      return (await client.query('INSERT INTO comments(user_id,title_id,content,spoiler,parent_id) VALUES($1,$2,$3,$4,$5) RETURNING id', [userId, title.id, content, spoiler || !!parent?.spoiler, parent?.id || null])).rows[0]
    })
    res.status(201).json(result)
  })
  app.put('/api/titles/:id/review', async (req, res) => {
    const userId = await write(req), title = await titleById(req.params.id)
    const content = text(req.body.content, { min: 20, max: 10000, label: 'Отзыв' }), spoiler = boolean(req.body.spoiler ?? false)
    const result = (await query(`INSERT INTO reviews(user_id,title_id,content,spoiler) VALUES($1,$2,$3,$4)
      ON CONFLICT(user_id,title_id) DO UPDATE SET content=EXCLUDED.content,spoiler=EXCLUDED.spoiler,updated_at=NOW() RETURNING id`, [userId, title.id, content, spoiler])).rows[0]
    res.json(result)
  })
  for (const type of ['comments','reviews']) {
    app.get(`/api/${type}/:id/reveal`, async (req, res) => {
      const row = (await query(`SELECT id,content FROM ${type} WHERE id=$1`, [id(req.params.id)])).rows[0]
      if (!row) throw new HttpError(404, 'Запись не найдена')
      res.json(row)
    })
    app.delete(`/api/${type}/:id`, async (req, res) => {
      const userId = await write(req)
      const result = await query(`DELETE FROM ${type} WHERE id=$1 AND user_id=$2 RETURNING id`, [id(req.params.id), userId])
      if (!result.rows.length) throw new HttpError(404, 'Запись не найдена')
      res.json({ ok: true })
    })
  }
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Страница не найдена')))
  app.use(express.static(publicPath, { maxAge: '1h', etag: true }))
  app.get('/{*splat}', (_req, res) => res.sendFile(path.join(publicPath, 'index.html')))
  app.use((error, _req, res, _next) => {
    if (!error.status) console.error('[Grade]', error.code || error.name)
    const status = error.status || (error.code === '23505' ? 409 : 500)
    res.status(status).json({ error: status === 500 ? 'Не удалось выполнить запрос. Попробуйте ещё раз.' : error.code === '23505' ? 'Такая запись уже существует' : error.message })
  })
  return app
}
