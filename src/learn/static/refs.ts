/** 这个文件负责什么：引用扫描——`moji:static/<uuid>` 的写法解析，以及「这条资源被谁引用了」。 */

import type { LearnStore } from '../types'
import { notesOf } from '../notes'
import { nodePathOf } from '../paths'
import { resourcesOf } from './ops'
import type { ResourceRef } from './types'

/** 文档里引用资源的协议前缀：\`![说明](moji:static/<uuid>)\` */
export const STATIC_SCHEME = 'moji:static/'

/* ---------- 引用扫描 ---------- */

/** 文档里引用某条资源的写法 */
export const staticToken = (uuid: string): string => STATIC_SCHEME + uuid

/** 从 markdown 链接地址里取 uuid；不是资源引用返回 null */
export function uuidFromHref(href: string): string | null {
  const h = href.trim()
  if (!h.startsWith(STATIC_SCHEME)) return null
  const uuid = h.slice(STATIC_SCHEME.length).split(/[?#]/)[0].trim()
  return /^[A-Za-z0-9_-]+$/.test(uuid) ? uuid : null
}

/** 一段正文里引用了哪些 uuid（按出现次数） */
export function uuidsIn(text: string): Map<string, number> {
  const out = new Map<string, number>()
  const re = /moji:static\/([A-Za-z0-9_-]+)/g
  for (const m of text.matchAll(re)) out.set(m[1], (out.get(m[1]) ?? 0) + 1)
  return out
}

/**
 * 谁引用了这条资源。
 *
 * 扫的是**全库**而不是只扫本目标：资源属于目标，但文档可以跨目标引用它
 * （比如把 A 目标的插图用在自己笔记里）。跨目标的那几处标 foreign，
 * 删除时才知道自己会碰坏别人的文档。
 */
export function scanRefs(store: LearnStore, uuid: string): ResourceRef[] {
  const out: ResourceRef[] = []
  const ownerGoal = store.goals.find((g) => resourcesOf(store, g.id).some((r) => r.uuid === uuid))?.id ?? null
  for (const node of store.nodes) {
    // 教学文档 + 这个节点的每一份笔记：笔记是一份一个文件的，引用可能落在任何一份里
    const entries: Array<{ kind: 'teaching' | 'note'; note?: string; text: string }> = [
      { kind: 'teaching', text: node.docs?.teaching ?? '' },
      ...notesOf(node).map((n) => ({ kind: 'note' as const, note: n.name, text: n.content })),
    ]
    for (const entry of entries) {
      if (!entry.text) continue
      const count = uuidsIn(entry.text).get(uuid)
      if (!count) continue
      out.push({
        nodeId: node.id,
        path: nodePathOf(store, node.goalId, node.id),
        title: node.title,
        doc: entry.kind,
        docLabel: entry.note ? '笔记「' + entry.note + '」' : '教学文档',
        count,
        foreign: ownerGoal !== null && node.goalId !== ownerGoal,
      })
    }
  }
  return out.sort((a, b) => b.count - a.count)
}

/** 一条资源被引用了几处（清单列表用） */
export const refCountOf = (store: LearnStore, uuid: string): number =>
  scanRefs(store, uuid).reduce((sum, r) => sum + r.count, 0)
