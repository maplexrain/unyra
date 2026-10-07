/** 页签与本地文件列表的反序列化：指向已不存在的东西的页签一律丢掉，本地文件只校验形状、不查磁盘。 */

import type { DocScroll, DocView, FavoriteItem, FavoriteRef, KnowledgeNode, LearnTab, LocalFile, TabRef } from '../../types'
import type { Exam } from '../../exam'
import { sortLocalFiles } from '../../localfiles'
import { newWebKey, tabKey } from '../../tabs'
import { favoriteKey } from '../../favorites'

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
  // 网页页签不挂节点：只认 http(s) 与空（起始页）；身份 key 缺了现场补一枚（页签各自独立）
  if (r.kind === 'web') {
    const url = typeof r.url === 'string' ? r.url : ''
    if (url && !/^https?:\/\//i.test(url)) return null
    return { kind: 'web', url, key: typeof r.key === 'string' && r.key ? r.key : newWebKey() }
  }
  // 专注报告：id 就是全部身份（文件丢了由视图自己说「报告不见了」）。
  // 守卫页签**故意没有分支**：上下文只活在会话里，重启读回来就丢（下一次严格专注再建）
  if (r.kind === 'report') {
    const reportId = typeof r.reportId === 'string' ? r.reportId : ''
    return reportId ? { kind: 'report', reportId } : null
  }
  // 设置页：全局只有一份，没有需要校验的「指向」，形状对就收下
  if (r.kind === 'settings') return { kind: 'settings' }
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

/**
 * 收藏分组的登记表：只认非空字符串（trim / 64 字上限），同名只留一条，顺序照旧。
 * 组名同时长在成员身上（FavoriteItem.group），这里只登记「组本身」——空组靠它存在。
 */
export function normalizeFavGroups(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const name = item.trim().slice(0, 64)
    if (!name || out.includes(name)) continue
    out.push(name)
  }
  return out
}

/**
 * 收藏列表：与页签同一条纪律——指向不存在的东西的收藏当场丢掉（节点被删、笔记改名、
 * 考试记录清掉，收藏就成了空指），网页只认 http(s)，本地文件只校验形状（文件后来被删
 * 是常态，点开时再报）。同一身份只留一条，顺序照旧（收藏的先后就是列表的先后）。
 */
export function normalizeFavorites(
  raw: unknown,
  byId: Map<string, KnowledgeNode>,
  exams: Exam[],
): FavoriteItem[] {
  if (!Array.isArray(raw)) return []
  const now = Date.now()
  const out: FavoriteItem[] = []
  const push = (ref: FavoriteRef, at: number, group?: string): void => {
    if (out.some((f) => favoriteKey(f) === favoriteKey(ref))) return
    // 分组名是展示与管理用的附件（见 learn/favorites）：形状不对就当没有
    const g = typeof group === 'string' ? group.trim().slice(0, 64) : ''
    out.push({ ...ref, at: Number.isFinite(at) && at > 0 ? at : now, ...(g ? { group: g } : {}) })
  }
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    const at = typeof r.at === 'number' ? r.at : NaN
    const group = typeof r.group === 'string' ? r.group : undefined
    if (r.kind === 'local') {
      if (typeof r.path === 'string' && r.path) push({ kind: 'local', path: r.path }, at, group)
      continue
    }
    if (r.kind === 'web') {
      if (typeof r.url === 'string' && /^https?:\/\//i.test(r.url)) {
        const fav: FavoriteRef = { kind: 'web', url: r.url }
        // 标题与站点图标是收藏那一刻记下的展示信息（见 types 的 web 分支）；形状不对或超长就弃掉/截断
        if (typeof r.title === 'string' && r.title.trim()) fav.title = r.title.trim().slice(0, 200)
        if (typeof r.icon === 'string' && /^https?:\/\//i.test(r.icon)) fav.icon = r.icon
        push(fav, at, group)
      }
      continue
    }
    const nodeId = typeof r.nodeId === 'string' ? r.nodeId : ''
    const node = byId.get(nodeId)
    if (!node) continue
    if (r.kind === 'teach') push({ kind: 'teach', nodeId }, at, group)
    else if (r.kind === 'outline') push({ kind: 'outline', nodeId }, at, group)
    else if (r.kind === 'note') {
      const note = typeof r.note === 'string' ? r.note : ''
      if (note && (node.notes ?? []).some((n) => n.name.toLowerCase() === note.toLowerCase()))
        push({ kind: 'note', nodeId, note }, at, group)
    } else if (r.kind === 'super') {
      const name = typeof r.name === 'string' ? r.name : ''
      if (name && (node.superdocs ?? []).some((n) => n.name.toLowerCase() === name.toLowerCase()))
        push({ kind: 'super', nodeId, name }, at, group)
    } else if (r.kind === 'exam') {
      const examId = typeof r.examId === 'string' ? r.examId : ''
      const attemptId = typeof r.attemptId === 'string' ? r.attemptId : ''
      const exam = exams.find((e) => e.id === examId)
      if (examId && attemptId && exam?.attempts.some((a) => a.id === attemptId))
        push({ kind: 'exam', nodeId, examId, attemptId }, at, group)
    }
  }
  return out
}
