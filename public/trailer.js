import { api } from './ui.js'
import { t } from './i18n.js'

const dialog = document.querySelector('#trailer-dialog')
const video = dialog.querySelector('iframe')
const ambient = dialog.querySelector('.trailer-ambient')
const caption = dialog.querySelector('.trailer-dialog-caption')
let trigger = null

export function closeTrailer() {
  if (!dialog.open) return
  dialog.close()
  video.removeAttribute('src')
  if (trigger?.isConnected) trigger.focus({ preventScroll:true })
  trigger = null
}

dialog.querySelector('.trailer-dialog-close').addEventListener('click', closeTrailer)
dialog.addEventListener('cancel', event => { event.preventDefault(); closeTrailer() })
dialog.addEventListener('click', event => { if (event.target === dialog) closeTrailer() })
dialog.addEventListener('close', () => video.removeAttribute('src'))

export async function mountTrailer(item) {
  const section = document.querySelector('#title-trailer')
  if (!section) return
  try {
    const result = await api(`/api/titles/${item.id}/trailer`)
    if (!section.isConnected || result.status !== 'ok' || !/^[\w-]{11}$/.test(result.key)) return
    const image = section.querySelector('.trailer-art')
    const artwork = result.backdrop || item.backdrop || ''
    if (artwork) image.src = artwork
    image.alt = ''
    section.querySelector('.trailer-film-name').textContent = item.name
    section.querySelector('.trailer-clip-name').textContent = result.name
    const play = section.querySelector('.trailer-play')
    play.setAttribute('aria-label', `${t('Смотреть трейлер')}: ${item.name}`)
    play.addEventListener('click', () => {
      trigger = play
      if (artwork) ambient.src = artwork
      else ambient.removeAttribute('src')
      caption.textContent = item.name
      dialog.querySelector('.trailer-external').href = `https://www.youtube.com/watch?v=${result.key}`
      video.title = `${t('Трейлер')}: ${item.name}`
      video.src = `https://www.youtube-nocookie.com/embed/${result.key}?autoplay=1&rel=0&playsinline=1`
      dialog.showModal()
    })
    section.hidden = false
  } catch { /* A missing video service must not interrupt the title page. */ }
}
