/** 这个文件负责什么：资源清单的纯函数读写——增删改查一律返回新 store（store 不可变这条约定靠它维持）。 */

import type { LearnStore } from '../types'
import { typeOfExt } from './ext'
import type { ResourceType, StaticResource } from './types'

/* ---------- store 读写（纯函数） ---------- */

export function resourcesOf(store: LearnStore, goalId: string): StaticResource[] {
  return store.resources?.[goalId] ?? []
}

export function findResource(store: LearnStore, goalId: string, uuid: string): StaticResource | null {
  return resourcesOf(store, goalId).find((r) => r.uuid === uuid) ?? null
}

/** 覆盖某个目标的资源清单；空清单不占位（与 tmp 的写法一致） */
export function withResources(
  store: LearnStore,
  goalId: string,
  list: StaticResource[],
): LearnStore {
  const resources = { ...(store.resources ?? {}) }
  if (list.length) resources[goalId] = list
  else delete resources[goalId]
  return { ...store, resources }
}

export const addResource = (store: LearnStore, goalId: string, res: StaticResource): LearnStore =>
  withResources(store, goalId, [...resourcesOf(store, goalId).filter((r) => r.uuid !== res.uuid), res])

export function patchResource(
  store: LearnStore,
  goalId: string,
  uuid: string,
  patch: Partial<Omit<StaticResource, 'uuid'>>,
): LearnStore {
  return withResources(
    store,
    goalId,
    resourcesOf(store, goalId).map((r) => (r.uuid === uuid ? { ...r, ...patch } : r)),
  )
}

export const dropResource = (store: LearnStore, goalId: string, uuid: string): LearnStore =>
  withResources(store, goalId, resourcesOf(store, goalId).filter((r) => r.uuid !== uuid))

/** 新资源条目：调用方负责把文件写到 resourceRel 上 */
export function makeResource(input: {
  uuid?: string
  name: string
  ext: string
  bytes: number
  hash?: string
  type?: ResourceType
  description?: string
  now?: number
}): StaticResource {
  const now = input.now ?? Date.now()
  return {
    uuid: input.uuid ?? crypto.randomUUID(),
    name: input.name.trim() || '未命名',
    ext: input.ext.toLowerCase(),
    type: input.type ?? typeOfExt(input.ext),
    description: input.description ?? '',
    createdAt: now,
    updatedAt: now,
    bytes: input.bytes,
    hash: input.hash ?? '',
  }
}
