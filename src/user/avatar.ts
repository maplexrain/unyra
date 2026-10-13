/**
 * 本文件负责：头像图片的**落盘与取用**——把用户挑的图片压到合适大小、写进
 * `{user}/assets/`，回一个 `asset:` URL；以及反过来把那个 URL 读回 data URL 给
 * `<img>` 用。
 *
 * 与从前最大的不同：**画像字段里不再放图片本身**。原先是把图片压成 data URL 直接写进
 * user.yaml（256KB 上限，base64 膨胀 4/3 之后三十多万字符），于是每次启动都要把这段
 * 巨长的字符串解析一遍，用户表、画像同步、任何一处读 user.yaml 的地方都跟着背这个包袱。
 * 现在字段里只有一个 `asset:头像文件.png`（三十来字符），图片是 assets/ 下的一个真实文件
 * （需求原文：「用户的头像字段不再使用base64，因为太过庞大，用户头像字段只能使用url」）。
 *
 * 压缩那一段仍然保留：它限制的是**磁盘上的文件**（头像用不着原图那几 MB），
 * 与字段长度无关。
 */
import { AVATAR_MAX_BYTES } from './types'
import { ASSET_IMAGE_EXT, ASSETS_DIR, assetRelOf, assetUrl } from './assets'
import { readUserImage, writeImage, writeUserImage } from '../lib/storage'

/** 压缩后的目标边长；头像最大也就显示到 64px，256 已经留足高倍屏的余量 */
const MAX_EDGE = 256

/** 生成的文件名的前缀：清扫孤儿文件时按它认（见 user/store 的 pruneAvatarAssets） */
export const AVATAR_FILE_PREFIX = 'avatar-'

/** data URL 的 mime → 扩展名（表在 user/assets，与背景图共用一份） */
const MIME_EXT = ASSET_IMAGE_EXT

const DATA_URL_RE = /^data:([\w.+-]+\/[\w.+-]+);base64,([A-Za-z0-9+/=]+)$/

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

/**
 * 把一张图片压成 data URL（**只给写盘用，不进画像字段**）。
 *
 * 先用 canvas 缩到最长边 256px，再按质量逐级下降编码，直到体积落进 AVATAR_MAX_BYTES。
 */
async function compressToDataUrl(file: File): Promise<string> {
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
  // 头像底色透明处用白色填充，避免转 JPEG 后变黑
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

/**
 * 存一张新头像：压好写进 `assets/`，回它的 `asset:` URL。失败抛 Error（调用方提示用户）。
 *
 * 文件名带时间戳而不是固定叫 `avatar.png`：`<img>` 的缓存、以及「刚换完头像看着还是旧的」
 * 这一类问题都跟着名字走，换一次名字就是一次干净的失效。旧文件由 pruneAvatarAssets 收尾。
 */
export async function saveAvatarFile(file: File): Promise<string> {
  const dataUrl = await compressToDataUrl(file)
  const mime = DATA_URL_RE.exec(dataUrl)?.[1] ?? 'image/png'
  const ext = MIME_EXT[mime] ?? 'png'
  const name = `${AVATAR_FILE_PREFIX}${Date.now()}.${ext}`
  const ok = await writeUserImage(`${ASSETS_DIR}/${name}`, dataUrl)
  if (!ok) throw new Error('头像保存失败')
  return assetUrl(name)
}

/**
 * 把画像字段里的头像地址解析成 `<img src>` 能用的值。
 *
 * - `asset:` → 现读成 data URL（读不到文件返回 null，调用方退回文字头像）
 * - `http(s):` → 原样返回，交给浏览器
 * - 其余（比如手改进 user.yaml 的怪值）→ null
 */
export async function resolveAvatarSrc(url: string): Promise<string | null> {
  if (!url) return null
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  const rel = avatarRelOf(url)
  if (!rel) return null
  return readUserImage(rel)
}

/**
 * 头像的 `asset:` 地址 → `assets/xxx.png`；不合法（或不是头像）时 null。
 *
 * 形状先交给 user/assets 判（`asset:` + 一个纯文件名 + 图片扩展名，路径成分在那一步
 * 就被挡掉了），这里再收一道**头像**的口径：只认 `avatar-` 开头的名字。
 * 头像字段是数据，不能让它顺手指到 assets/ 里别人的文件上。
 */
function avatarRelOf(url: string): string | null {
  const rel = assetRelOf(url)
  if (!rel) return null
  return rel.slice(ASSETS_DIR.length + 1).startsWith(AVATAR_FILE_PREFIX) ? rel : null
}

/**
 * 把老数据里那段 base64 头像落到 assets/ 里的真实文件上（一次性迁移，见 user/store）。
 *
 * 迁移失败返回原值——**宁可留着那段 base64 也不能把头像弄丢**：它虽然臃肿，但那是用户的头像。
 * 成功返回新的 `asset:` URL。
 */
export async function migrateDataUrlAvatar(uid: string, dataUrl: string): Promise<string> {
  const matched = DATA_URL_RE.exec(dataUrl.trim())
  if (!matched) return dataUrl
  /*
   * 只迁**认得出扩展名的位图**（png / jpeg / webp / gif / bmp，与主进程的写入白名单同一组）。
   * 认不出的一律原样返回、不落盘也不改字段：写一个扩展名与内容不符的文件比一张不显示的头像更糟，
   * 而这里能做的也就到此为止——那一段留在 user.yaml 里，读盘时按「不是 URL」丢掉。
   * （实际上不会遇到：上传那条路只会产出 canvas 的 png / jpeg。）
   */
  const ext = MIME_EXT[matched[1]]
  if (!ext) return dataUrl
  const name = `${AVATAR_FILE_PREFIX}${Date.now()}.${ext}`
  /*
   * 这里必须用**相对数据根**的 writeImage，不能走 writeUserImage：
   * 迁移发生在 setUserScope 之前（bootstrapUsers 里），那时「当前用户是谁」还不知道，
   * writeUserImage 会算出 null 而静默失败——头像就这么没了。
   */
  const ok = await writeImage(`users/${uid}/${ASSETS_DIR}/${name}`, dataUrl)
  return ok ? assetUrl(name) : dataUrl
}
