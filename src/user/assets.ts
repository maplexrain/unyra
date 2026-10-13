/**
 * 本文件负责：用户目录下那个 `assets/`（静态资源）的**地址约定**——URL 长什么样、
 * 怎么换算成磁盘上的相对路径。纯函数，不碰 React 也不碰 IO，便于单测。
 *
 * 为什么要有这一层：画像字段里只允许放 **URL**（budget 极小的一个字符串），
 * 而静态资源本身是磁盘上的真实文件。中间需要一个能双向换算、又不可能被
 * 「其他手段」塞进别的东西的约定。这里的约定是：
 *
 *   `asset:avatar-1730000000000.png`  ⇄  `assets/avatar-1730000000000.png`
 *
 * 即「`asset:` + 一个**纯文件名**」。为什么只允许纯文件名（不许带目录、不许 `..`）：
 * 这个字符串最终来自 user.yaml，而 user.yaml 是可以被手改的，也可能在将来的某天
 * 从别处导入。把它的形状收到「一个文件名」这么窄，路径穿越在这里就无从谈起——
 * 主进程那一侧还有 resolveInside 兜底，但两道闸比一道稳（见 electron/storage/files）。
 *
 * 目录名按需求叫 `assets`（需求原文：「在 user 目录下增加一个 assets 目录，
 * 用来存放静态资源，比如头像」），将来别的静态资源也往这里放，
 * 所以换算这一层不叫 avatar、只认「assets 下的哪一个文件」。
 */

/** 用户目录下放静态资源的目录名 */
export const ASSETS_DIR = 'assets'

/** 内置静态资源的 URL 协议前缀 */
export const ASSET_SCHEME = 'asset:'

/**
 * 允许落在 assets/ 里的文件名：一个可读的名字 + 图片扩展名。
 *
 * 与 electron/storage/binary 的 IMAGE_MIME 是同一组扩展名（那边决定「能不能写」，
 * 这边决定「认不认这个 URL」）。两边都对得上，一个 URL 才可能既写得进又显示得出。
 */
const ASSET_FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(png|jpe?g|webp|gif|bmp)$/i

/** 一个文件名能不能作为资源地址（不含任何路径成分） */
export function isAssetFile(name: string): boolean {
  // 再挡一道：`..` 与分隔符即使混过了正则也不放行（正则已经不许 `/` `\`，这里是双保险）
  if (name.includes('..') || name.includes('/') || name.includes('\\')) return false
  return ASSET_FILE_RE.test(name)
}

/** `assets/xxx.png` → `asset:xxx.png` */
export function assetUrl(rel: string): string {
  const name = rel.startsWith(ASSETS_DIR + '/') ? rel.slice(ASSETS_DIR.length + 1) : rel
  return ASSET_SCHEME + name
}

/** 这个字符串是不是一个内置资源地址 */
export function isAssetUrl(v: string): boolean {
  return v.startsWith(ASSET_SCHEME) && isAssetFile(v.slice(ASSET_SCHEME.length))
}

/** `asset:xxx.png` → `xxx.png`；不是内置资源地址（或名字不合法）时 null */
export function assetFileOf(url: string): string | null {
  if (!isAssetUrl(url)) return null
  return url.slice(ASSET_SCHEME.length)
}

/** `asset:xxx.png` → `assets/xxx.png`（相对**当前用户目录**，供 lib/storage 的 *User* 那组用） */
export function assetRelOf(url: string): string | null {
  const name = assetFileOf(url)
  return name ? `${ASSETS_DIR}/${name}` : null
}

/* ---------- 认得的图片类型 ---------- */

/**
 * 允许落在 assets/ 里的图片类型（mime ↔ 扩展名）。
 *
 * 与 electron/storage/binary 的 IMAGE_MIME 是**同一组**：那边决定「写得进吗」，
 * 这边决定「认得出吗」。写与读要对得上，一个地址才既落得了盘又显示得出来。
 * 头像与背景图共用这一张表——它们都是 assets/ 里的图片，没有理由各认一套。
 */
export const ASSET_IMAGE_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
}

/** 反向表：扩展名（小写、带点）→ mime */
export const ASSET_IMAGE_MIME: Record<string, string> = Object.fromEntries(
  Object.entries(ASSET_IMAGE_EXT).map(([mime, ext]) => ['.' + ext, mime]),
)
