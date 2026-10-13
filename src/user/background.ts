/**
 * 本文件负责：全局背景图的**落盘、取用与老数据迁移**——与 user/avatar 是一对，
 * 差别只在图片的用途（头像 vs 全屏壁纸），所以规矩完全一样：
 *
 * - 用户挑的图写进 `{user}/assets/`，配置里只留一个 `asset:` 地址；
 * - 配置里绝不出现图片字节（需求原文：「全局背景图也要改成放在assets目录，
 *   原字段只能持有url引用」）。
 *
 * 两条路只有**大小口味**不同：头像显示到 64px，压到 256 就够；壁纸要铺满一屏，
 * 压小了当场糊。所以这里的策略是——本身就不大的图**原样落盘**（不重编码，少一代损失），
 * 太大的才缩到 2560px 再编码。
 */
import { ASSET_IMAGE_EXT, ASSETS_DIR, assetRelOf, assetUrl } from './assets'
import { getAppearance, setAppearance } from '../lib/appearance'
import { presetSrcOf, type CustomBackgroundConfig } from '../lib/customBackground'
import { listUserDir, readUserImage, removeUserPath, writeUserImage } from '../lib/storage'

/** 生成的文件名的前缀：清扫孤儿文件时按它认（见 reconcileBackgroundAssets） */
export const BG_FILE_PREFIX = 'bg-'

/**
 * 「原样落盘」的体积上限。
 *
 * 比它小的图直接写原始字节：重编码一次就少一次画质，而壁纸是要铺满屏幕的，
 * 放大看的时候糊不糊是看得出来的。比它大的（手机原图、单反出片动辄十几 MB）
 * 才走缩放。
 */
const DIRECT_MAX_BYTES = 4 * 1024 * 1024

/** 缩放后的最长边：4K 屏也够铺，再大只是白白占盘 */
const MAX_EDGE = 2560

/** 缩放后的 JPEG 质量阶梯，逐级下降直到落进 DIRECT_MAX_BYTES */
const QUALITY_LADDER = [0.9, 0.8, 0.7, 0.55]

const DATA_URL_RE = /^data:([\w.+-]+\/[\w.+-]+);base64,([A-Za-z0-9+/=]+)$/

/**
 * 同一个毫秒里写第几张图。
 *
 * 文件名靠时间戳区分新旧（换一张就是换一个地址，`<img>` 的缓存、以及「刚换完看着还是
 * 旧的」这一类问题都跟着名字走），可迁移那一步是**在一个循环里连着写好几张**的——
 * 只靠 Date.now() 会让它们撞在同一个名字上，后一张把前一张覆盖掉。
 */
let seq = 0

/** 文件 → data URL（只在内存里过一道，不落盘成 base64） */
function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error('图片读取失败'))
    }
    reader.onerror = () => reject(new Error('图片读取失败'))
    reader.readAsDataURL(file)
  })
}

async function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  const img = new Image()
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('图片读取失败'))
    img.src = dataUrl
  })
  return img
}

/** 缩到 MAX_EDGE 以内再编码成 JPEG，逐级降质直到体积达标 */
async function shrinkToFit(dataUrl: string): Promise<string> {
  const img = await loadImage(dataUrl)
  const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight))
  const w = Math.max(1, Math.round(img.naturalWidth * scale))
  const h = Math.max(1, Math.round(img.naturalHeight * scale))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('当前浏览器不支持处理图片')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(img, 0, 0, w, h)

  for (const q of QUALITY_LADDER) {
    const jpeg = canvas.toDataURL('image/jpeg', q)
    if (jpeg.length <= DIRECT_MAX_BYTES * 1.4) return jpeg
  }
  throw new Error('图片过大，请换一张更小的图片')
}

/** 把一段图片字节收进 assets/，回它的 `asset:` 地址；写不进去返回 null */
async function storeImage(dataUrl: string): Promise<string | null> {
  const rawMime = DATA_URL_RE.exec(dataUrl)?.[1] ?? ''
  // 本身就小、而且是我们认得的类型：原始字节直接落盘，不过 canvas
  const direct = dataUrl.length <= DIRECT_MAX_BYTES * 1.4 && ASSET_IMAGE_EXT[rawMime]

  let data = dataUrl
  let mime = rawMime
  if (!direct) {
    data = await shrinkToFit(dataUrl)
    mime = DATA_URL_RE.exec(data)?.[1] ?? 'image/jpeg'
  }
  const ext = ASSET_IMAGE_EXT[mime] ?? 'jpg'
  const name = `${BG_FILE_PREFIX}${Date.now()}-${seq++}.${ext}`
  const ok = await writeUserImage(`${ASSETS_DIR}/${name}`, data)
  return ok ? assetUrl(name) : null
}

/**
 * 把用户挑的一张图收进 assets/，回它的 `asset:` 地址。失败抛 Error（调用方提示用户）。
 */
export async function saveBackgroundImage(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('请选择图片格式文件')
  const url = await storeImage(await readAsDataUrl(file))
  if (!url) throw new Error('背景图保存失败')
  return url
}

/**
 * 把配置里的地址解析成 CSS / `<img>` 能直接用的值。
 *
 * - `preset:xxx` → 内置壁纸的 data URL（常量就在代码里，同步可得）
 * - `asset:xxx`  → 现读成 data URL（文件不在 / 读不出来 → null，调用方按「这张没了」处理）
 * - `http(s):`   → 原样交给浏览器
 * - `data:`      → 原样放行：**只为老数据留的一扇门**，等 reconcileBackgroundAssets
 *                  把它们迁进 assets/ 之后就再也不会走到这里（界面本身只产出前三种）
 */
export async function resolveBackgroundSrc(url: string): Promise<string | null> {
  if (!url) return null
  const preset = presetSrcOf(url)
  if (preset) return preset
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  // 老数据里那段还没迁走的 base64：先让它显示出来，下一次启动就没了
  if (url.startsWith('data:')) return url
  const rel = assetRelOf(url)
  if (!rel) return null
  return readUserImage(rel)
}

/** 一个地址是不是指向 assets/ 里的**背景图**（迁移与清扫都只认这一类） */
function backgroundRelOf(url: string): string | null {
  const rel = assetRelOf(url)
  if (!rel) return null
  return rel.slice(ASSETS_DIR.length + 1).startsWith(BG_FILE_PREFIX) ? rel : null
}

/** 配置里所有图片的地址（去重） */
function collectRefs(cfg: CustomBackgroundConfig): string[] {
  const out = new Set<string>()
  if (cfg.singleImageUrl) out.add(cfg.singleImageUrl)
  for (const g of cfg.groups) for (const img of g.images) if (img.url) out.add(img.url)
  return [...out]
}

/**
 * 启动时对一次账：**把老数据里那段 base64 迁进 assets/，再把没人引用的旧文件清掉**。
 *
 * 两件事放在一起做，是因为它们都要「配置里现在引用了哪些图」这一份答案；
 * 而这一刻在启动里是唯一的（设置刚读进来、用户作用域已经设好，见 lib/boot 的
 * enterUserScope）——那时才既有完整的配置、又能往当前用户目录里写。
 *
 * 迁移是**逐张来**的，并且只在真的换掉了地址时才写回设置：写盘失败的那一张保持原样
 * （下次启动再试），绝不能因为一张图写不进去就把整份配置弄丢。
 */
export async function reconcileBackgroundAssets(): Promise<void> {
  const cfg = getAppearance().customBg
  if (!cfg) return

  /** 一个地址迁完之后的形态（没变就返回原值） */
  const migrate = async (url: string): Promise<string> => {
    if (!url.startsWith('data:')) return url
    try {
      return (await storeImage(url)) ?? url
    } catch {
      // 压不下去 / 写不进去：留着那段 base64，至少图还在
      return url
    }
  }

  let changed = false
  const migrated = new Map<string, string>()
  for (const url of collectRefs(cfg)) {
    const next = await migrate(url)
    migrated.set(url, next)
    if (next !== url) changed = true
  }

  const resolved: CustomBackgroundConfig = {
    ...cfg,
    singleImageUrl: migrated.get(cfg.singleImageUrl) ?? cfg.singleImageUrl,
    groups: cfg.groups.map((g) => ({
      ...g,
      images: g.images.map((img) => ({ ...img, url: migrated.get(img.url) ?? img.url })),
    })),
  }
  if (changed) setAppearance({ ...getAppearance(), customBg: resolved })

  /*
   * 清扫：配置里现在到底引用了哪几个 assets/ 背景图。判据用的是**迁移之后**的那份配置——
   * 拿迁移前的算，刚落地的新文件会因为「还没人引用」被当场删掉。
   */
  const keep = new Set(
    collectRefs(resolved)
      .map((u) => backgroundRelOf(u))
      .filter((rel): rel is string => rel !== null),
  )
  for (const entry of await listUserDir(ASSETS_DIR)) {
    if (entry.dir || !entry.name.startsWith(BG_FILE_PREFIX)) continue
    const rel = `${ASSETS_DIR}/${entry.name}`
    if (keep.has(rel)) continue
    await removeUserPath(rel)
  }
}
