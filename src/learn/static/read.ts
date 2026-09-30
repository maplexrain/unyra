/** 这个文件负责什么：读文件——文本资源的内容、图片字节（与聊天气泡共用同一份缓存），以及资源目录里有没有游离文件。 */

import type { LearnStore } from '../types'
import { MANIFEST_FILE } from '../layout'
import { listUserDir, readUserImage, readUserText } from '../../lib/storage'
import { loadedImage, rememberImage, subscribeImages, type Loaded } from '../images'
import { goalStaticDir, resourceRel } from './location'
import { resourcesOf } from './ops'
import type { StaticResource } from './types'

/* ---------- 读文件 ---------- */

/** 文本资源的内容；读不到返回 null */
export async function readResourceText(
  store: LearnStore,
  goalId: string,
  res: StaticResource,
): Promise<string | null> {
  const rel = resourceRel(store, goalId, res)
  if (!rel) return null
  return readUserText(rel)
}

/**
 * 图片资源的字节（带缓存）。
 *
 * 缓存与聊天气泡**共用同一份**（learn/images 的 rememberImage/loadedImage，键是 rel）：
 * 同一张图既可能挂在消息里、也可能被文档引用，读两遍没有意义。
 */
export async function loadResourceImage(
  store: LearnStore,
  goalId: string,
  res: StaticResource,
): Promise<Loaded | null> {
  const rel = resourceRel(store, goalId, res)
  return rel ? loadImageByRel(rel) : null
}

/** 按相对路径读一张图的字节（与聊天气泡共用同一份缓存）；读不到回 null */
export async function loadImageByRel(rel: string): Promise<Loaded | null> {
  const hit = loadedImage(rel)
  if (hit) return hit
  const url = await readUserImage(rel)
  if (!url) return null
  const comma = url.indexOf(',')
  const loaded = {
    mime: url.slice(5, comma).replace(/;base64$/, '') || 'image/png',
    data: url.slice(comma + 1),
    url,
  }
  rememberImage(rel, loaded)
  return loaded
}

/** 缓存里已有的 data URL（渲染时同步取；没有就等 subscribeImages 通知再重画） */
export function cachedResourceUrl(store: LearnStore, goalId: string, res: StaticResource): string | null {
  const rel = resourceRel(store, goalId, res)
  return rel ? (loadedImage(rel)?.url ?? null) : null
}

export { subscribeImages as subscribeResources }

/** 资源目录里有没有游离文件（清单里没有登记的）：界面上提示「N 个未登记文件」 */
export async function listUntracked(store: LearnStore, goalId: string): Promise<string[]> {
  const dir = goalStaticDir(store, goalId)
  if (!dir) return []
  const known = new Set(
    resourcesOf(store, goalId).map((r) => r.uuid + (r.ext ? '.' + r.ext : '')),
  )
  const entries = await listUserDir(dir)
  return entries
    .filter((e) => !e.dir && e.name !== MANIFEST_FILE && !known.has(e.name))
    .map((e) => e.name)
}
