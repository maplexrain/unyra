/** 把 `moji:static/<uuid>` 这类资源引用落回真实路径（docs/{目标}/static/{uuid}.{ext}）。 */
import type { LearnStore } from '../types'
import type { StaticResource } from './types'
import { resourceRel } from './location'

export interface ResolvedStaticResource {
  goalId: string
  resource: StaticResource
  rel: string
}

const STATIC_PREFIX = 'moji:static/'

function uuidOfKey(key: string): string {
  const base = key.split(/[\\/]/).pop() ?? key
  return base.replace(/\.[a-z0-9]+$/i, '')
}

/**
 * 解析一条静态资源引用。三种写法都认：
 * - `moji:static/<uuid>`（api.browser.screenshot / see 返回的短引用）；
 * - `moji:static/docs/…/static/<uuid>.<ext>`（带完整相对路径的旧写法）；
 * - 裸 `<uuid>`（历史消息里漏写了路径的破损引用）。
 *
 * 只按资源清单查，不去猜后缀：猜错后缀会把 webp 当 png 解码，最后还是空图。
 * 找不到时返回 null，调用方应显式报错/丢弃，而不是落一条永远读不到的空引用。
 */
export function resolveStaticResource(
  store: LearnStore,
  ref: string,
  goalId?: string,
): ResolvedStaticResource | null {
  const key = ref.trim().replace(new RegExp('^' + STATIC_PREFIX), '')
  if (!key) return null
  const uuid = uuidOfKey(key)
  const goals = goalId ? [goalId] : Object.keys(store.resources ?? {})
  for (const gid of goals) {
    const resource = (store.resources?.[gid] ?? []).find((r) => r.uuid === uuid || r.uuid === key)
    if (!resource) continue
    const rel = resourceRel(store, gid, resource)
    if (rel) return { goalId: gid, resource, rel }
  }
  return null
}
