import { test, expect } from '@playwright/test'
test.use({locale:'ru-RU'})

test('trailer opens in the editorial player, stops on close and disappears when unavailable', async ({ page }) => {
  const catalog = await (await page.request.get('/api/catalog')).json()
  const title = catalog.items.find(item => item.source === 'tmdb')
  expect(title).toBeTruthy()
  let available = true
  await page.route(`**/api/titles/${title.id}/trailer`, route => route.fulfill({ json:available
    ? { status:'ok', key:'M7lc1UVf-VE', name:'Official Trailer', backdrop:'https://image.tmdb.org/t/p/original/sharp-backdrop.jpg' }
    : { status:'not_found' } }))
  await page.route('https://image.tmdb.org/t/p/original/sharp-backdrop.jpg', route => route.fulfill({ contentType:'image/svg+xml', body:'<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"/>' }))
  await page.route('https://www.youtube-nocookie.com/**', route => route.fulfill({ contentType:'text/html', body:'<!doctype html><title>Video fixture</title>' }))

  await page.goto(`/title/${title.id}`)
  const preview = page.locator('#title-trailer')
  await expect(preview).toBeVisible()
  await expect(preview.locator('.trailer-art')).toHaveAttribute('src', 'https://image.tmdb.org/t/p/original/sharp-backdrop.jpg')
  await expect(preview.locator('.trailer-film-name')).toHaveText(title.name)
  await preview.getByRole('button', { name:`Смотреть трейлер: ${title.name}` }).click()
  const dialog = page.locator('#trailer-dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('iframe')).toHaveAttribute('src', /youtube-nocookie\.com\/embed\/M7lc1UVf-VE/)
  await page.getByRole('button', { name:'Закрыть трейлер' }).click()
  await expect(dialog).not.toBeVisible()
  await expect(dialog.locator('iframe')).not.toHaveAttribute('src', /./)

  available = false
  await page.reload()
  await expect(preview).toBeHidden()
})
