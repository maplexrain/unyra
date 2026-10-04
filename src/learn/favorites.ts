import type { FavoriteItem, FavoriteRef, TabRef } from './types'
import { fileNameOf, newWebKey } from './tabs'
import { t } from '../i18n'

/**
 * 收藏夹的纯逻辑：一条收藏指向什么、怎么认身份、怎么增删。
 *
 * 单独成模块与 learn/tabs 同一条理由：这些判断全是纯函数，能被单元测试钉住；
 * 而收藏有**三个入口**（页签右键菜单、网页地址栏的星标、侧栏收藏区的移除），
 * 逻辑只该有一份。
 *
 * 身份与 tabKey 同一套前缀（t:/n:/s:/e:/o:/l:），网页收藏用 **u: + 网址**——
 * 页签的身份是开签那一刻的 key（同一网址可开几枚），收藏的身份是网址本身
 * （收藏的是「这个页面」）。于是「同一个东西只收藏一次」照旧只比字符串。
 */

/** 一条收藏的身份（前缀与 tabKey 对齐；网页是 u: + 网址） */
export function favoriteKey(ref: FavoriteRef): string {
  if (ref.kind === 'teach') return 't:' + ref.nodeId
  if (ref.kind === 'note') return 'n:' + ref.nodeId + ':' + ref.note
  if (ref.kind === 'super') return 's:' + ref.nodeId + ':' + ref.name
  if (ref.kind === 'exam') return 'e:' + ref.examId + ':' + ref.attemptId
  if (ref.kind === 'outline') return 'o:' + ref.nodeId
  if (ref.kind === 'local') return 'l:' + ref.path
  return 'u:' + ref.url
}

/** 页签指向的东西的收藏身份；起始页（还没有网址）没有可收藏的东西，返回 null */
export function favoriteKeyOfTab(ref: TabRef): string | null {
  if (ref.kind === 'web') return ref.url ? favoriteKey(ref) : null
  return favoriteKey(ref)
}

/** 页签 → 收藏：网页只留网址；起始页返回 null（没有可收藏的东西） */
export function favoriteRefOfTab(ref: TabRef): FavoriteRef | null {
  if (ref.kind === 'web') return ref.url ? { kind: 'web', url: ref.url } : null
  return ref
}

/** 收藏 → 页签：网页现场开新签（key 是开签那一刻生成的身份，见 learn/tabs） */
export function tabRefOfFavorite(ref: FavoriteRef): TabRef {
  if (ref.kind === 'web') return { kind: 'web', url: ref.url, key: newWebKey() }
  return ref
}

/** 收藏 / 取消收藏：收藏过（比身份）就摘掉，没收藏过就排到列表末尾 */
export function toggleFavorite(list: FavoriteItem[], ref: FavoriteRef, at: number): FavoriteItem[] {
  const key = favoriteKey(ref)
  const rest = list.filter((f) => favoriteKey(f) !== key)
  return rest.length === list.length ? [...list, { ...ref, at }] : rest
}

/** 摘掉一条收藏（侧栏收藏区的移除键） */
export function removeFavorite(list: FavoriteItem[], key: string): FavoriteItem[] {
  return list.filter((f) => favoriteKey(f) !== key)
}

/* ---------- 分组文件夹（网页收藏的管理用） ---------- */

/** 组名的清理口径：前后空白去掉、限长；空串视为「没有分组」 */
const cleanGroup = (raw: string): string | undefined => {
  const name = raw.trim().slice(0, 64)
  return name || undefined
}

/** 把一条收藏移进分组（group 为 null = 移回顶层）；分组是收藏自己的属性，不在别处登记 */
export function setFavoriteGroup(list: FavoriteItem[], key: string, group: string | null): FavoriteItem[] {
  const next = cleanGroup(group ?? '') ?? undefined
  return list.map((f) => {
    if (favoriteKey(f) !== key) return f
    const item: FavoriteItem = { ...f }
    if (next) item.group = next
    else delete item.group
    return item
  })
}

/** 给分组改名：成员原样跟着走（组名就是身份，成员上的 group 字符串换一份） */
export function renameFavoriteGroup(list: FavoriteItem[], from: string, to: string): FavoriteItem[] {
  const next = cleanGroup(to)
  if (!next || next === from) return list
  return list.map((f) => (f.group === from ? { ...f, group: next } : f))
}

/** 拆掉一个分组：成员回到顶层，收藏本身一条不丢 */
export function removeFavoriteGroup(list: FavoriteItem[], group: string): FavoriteItem[] {
  return list.map((f) => {
    if (f.group !== group) return f
    const item: FavoriteItem = { ...f }
    delete item.group
    return item
  })
}

/** 改一条网页收藏的显示名（收藏那一刻存的页面标题，见 types 的 web 分支） */
export function renameWebFavorite(list: FavoriteItem[], key: string, title: string): FavoriteItem[] {
  const name = title.trim().slice(0, 200)
  if (!name) return list
  return list.map((f) => (favoriteKey(f) === key && f.kind === 'web' ? { ...f, title: name } : f))
}

/**
 * 收藏行显示的名字：与 tabTitle 同一个思路——标题全部**现查**（节点名、考试名都是活的），
 * 收藏里不存标题，改名之后收藏跟着新名字走，不会烂在旧标题上。
 * 网页显示域名（页签栏的兜底同款）；本地文件显示文件名。
 */
export function favoriteTitle(
  ref: FavoriteRef,
  nodeTitle: (nodeId: string) => string | undefined,
  examTitle?: (examId: string, attemptId: string) => string | undefined,
): string {
  if (ref.kind === 'teach') return nodeTitle(ref.nodeId) ?? t('已删除的节点')
  if (ref.kind === 'note') return ref.note
  if (ref.kind === 'super') return ref.name
  if (ref.kind === 'exam') return examTitle?.(ref.examId, ref.attemptId) ?? t('试卷副本')
  if (ref.kind === 'outline') return (nodeTitle(ref.nodeId) ?? t('已删除的节点')) + t(' · 大纲')
  if (ref.kind === 'web') {
    // 收藏那一刻记下的页面标题优先；没记下（当时页面还没加载完）退回域名
    if (ref.title) return ref.title
    try {
      return new URL(ref.url).host
    } catch {
      return ref.url
    }
  }
  return fileNameOf(ref.path)
}
