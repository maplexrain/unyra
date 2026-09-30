import { AVATAR_MAX_BYTES } from './types'

/**
 * 把用户选择的图片读成小尺寸 data URL 存进画像。
 *
 * 直接用 FileReader 读原图会动辄几 MB，而画像要写进 user.yaml、每次启动都要读一遍。
 * 这里先用 canvas 缩到最长边 256px，再按质量逐级下降编码，
 * 直到体积落进 AVATAR_MAX_BYTES 以内。
 */

const MAX_EDGE = 256

async function loadImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('图片读取失败'))
      img.src = url
    })
    return img
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** 读取并压缩头像；失败抛 Error（调用方据此提示用户） */
export async function readAvatarFile(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('请选择图片文件')
  const img = await loadImage(file)

  const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight))
  const w = Math.max(1, Math.round(img.naturalWidth * scale))
  const h = Math.max(1, Math.round(img.naturalHeight * scale))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('当前浏览器不支持处理图片')
  // 头像底色透明处用卡片色填充，避免转 JPEG 后变黑
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(img, 0, 0, w, h)

  // 优先 PNG（保真、支持透明）；超限则退到 JPEG 并逐级降质
  const png = canvas.toDataURL('image/png')
  if (png.length <= AVATAR_MAX_BYTES * 1.4 && png.startsWith('data:image/')) return png

  for (const q of [0.85, 0.7, 0.55, 0.4, 0.3]) {
    const jpeg = canvas.toDataURL('image/jpeg', q)
    if (jpeg.length <= AVATAR_MAX_BYTES * 1.4) return jpeg
  }
  throw new Error('图片过大，请换一张更小的图片')
}
