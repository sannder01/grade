import { t } from './i18n.js'

export async function preparePhoto(file) {
  if (!file || !file.type.startsWith('image/')) throw new Error(t('Выберите фото из галереи'))
  if (file.size > 25*1024*1024) throw new Error(t('Фото должно быть меньше 25 МБ'))
  let image
  try { image = await createImageBitmap(file,{ imageOrientation:'from-image' }) }
  catch { throw new Error(t('Не удалось открыть фото — попробуйте JPEG, PNG или WebP')) }
  try {
    const size = Math.min(image.width,image.height)
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512
    const context = canvas.getContext('2d')
    context.fillStyle = '#111312'; context.fillRect(0,0,512,512)
    context.drawImage(image,(image.width-size)/2,(image.height-size)/2,size,size,0,0,512,512)
    let blob = await new Promise(resolve => canvas.toBlob(resolve,'image/jpeg',0.87))
    if (blob?.size > 262144) blob = await new Promise(resolve => canvas.toBlob(resolve,'image/jpeg',0.65))
    if (!blob || blob.size > 262144) throw new Error(t('Не удалось подготовить фото'))
    const preview = await new Promise((resolve,reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob)
    })
    return { blob,preview }
  } finally { image.close() }
}
