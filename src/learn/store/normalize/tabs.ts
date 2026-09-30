/** 页签与本地文件列表的反序列化：指向已不存在的东西的页签一律丢掉，本地文件只校验形状、不查磁盘。 */

import type { DocScroll, DocView, KnowledgeNode, LearnTab, LocalFile, TabRef } from '../../types'
import { sortLocalFiles } from '../../localfiles'
import { tabKey } from '../../tabs'

/* ---------- 页签与本地文件列表 ---------- */

/**
 * 校验页签列表：指向不存在的东西的页签一律丢掉。
 *
 * 为什么必须校验而不是原样收下：state.json 是会被手改的，节点也可能在别的机器上
 * （或另一个用户的数据目录里）被删过。留着一个指向空处的页签，点开是一片空白，
 * 用户只会以为「文件坏了」——不如当场不认它。
 *
 * 单个页签的校验抽出来给 learn/groups 的 normalizeDocs 用：分组那一层只管结构
 * （哪个页签在哪一组），「这个页签指向的东西还在不在」是 store 的事。
 */
export function normalizeTab(raw: unknown, byId: Map<string, KnowledgeNode>): LearnTab | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const ref = normalizeTabRef(r.ref, byId)
  if (!ref) return null
  const view: DocView | undefined = r.view === 'source' || r.view === 'preview' ? r.view : undefined
  return {
    id: tabKey(ref),
    ref,
    ...(view ? { view } : {}),
    createdAt:
      typeof r.createdAt === 'number' && Number.isFinite(r.createdAt) ? r.createdAt : Date.now(),
  }
}

function normalizeTabRef(raw: unknown, byId: Map<string, KnowledgeNode>): TabRef | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (r.kind === 'local') {
    return typeof r.path === 'string' && r.path ? { kind: 'local', path: r.path } : null
  }
  const nodeId = typeof r.nodeId === 'string' ? r.nodeId : ''
  const node = byId.get(nodeId)
  if (!node) return null
  if (r.kind === 'teach') return { kind: 'teach', nodeId }
  if (r.kind === 'note') {
    const note = typeof r.note === 'string' ? r.note : ''
    if (!note) return null
    // 笔记也被删掉/改过名时这个页签就没有内容可指了（名字就是它的身份）
    const exists = (node.notes ?? []).some((n) => n.name.toLowerCase() === note.toLowerCase())
    return exists ? { kind: 'note', nodeId, note } : null
  }
  if (r.kind === 'super') {
    const name = typeof r.name === 'string' ? r.name : ''
    if (!name) return null
    // 超级文档同理：名字就是身份，Agent 删了它，页签也不该再留
    const exists = (node.superdocs ?? []).some((n) => n.name.toLowerCase() === name.toLowerCase())
    return exists ? { kind: 'super', nodeId, name } : null
  }
  // 大纲页只认节点：大纲内容有没有（老节点可能还没有）不影响页签的合法性——
  // 页签自己会显示「还没有大纲」的占位
  if (r.kind === 'outline') return { kind: 'outline', nodeId }
  return null
}

/**
 * 「读到哪儿了」的那张表：键是页签 id，值是像素位置。
 *
 * 只认**有限、非负**的数——手改过的 state.json 里塞进一个 NaN 或负数，
 * 该退回「从头读」，而不是把整份状态读不出来。键不做校验：页签 id 指向的东西
 * 可能已经不在了（那个节点被删了），而那时这张表里多一条没人看的记录并不碍事，
 * 页签自己会在归一化时被丢掉。
 */
export function normalizeDocScroll(raw: unknown): DocScroll {
  if (!raw || typeof raw !== 'object') return {}
  const out: DocScroll = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!key || typeof value !== 'number' || !Number.isFinite(value) || value < 0) continue
    out[key] = Math.round(value)
  }
  return out
}

/**
 * 本地文件列表：只校验形状（路径非空），**不查文件还在不在**。
 *
 * 查存在性要逐个访问磁盘，而这一步在启动的关键路径上；列表里的文件后来被删掉是常态，
 * 点开时报一句「文件不在了」并从列表里摘掉，代价小得多。
 */
export function normalizeLocalFiles(raw: unknown): LocalFile[] {
  if (!Array.isArray(raw)) return []
  const now = Date.now()
  const out: LocalFile[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    const path = typeof r.path === 'string' ? r.path : ''
    if (!path) continue
    if (out.some((f) => f.path === path)) continue
    const name = typeof r.name === 'string' && r.name ? r.name : path
    out.push({ path, name, openedAt: typeof r.openedAt === 'number' && Number.isFinite(r.openedAt) ? r.openedAt : now })
  }
  return sortLocalFiles(out)
}
