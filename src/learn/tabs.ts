import type { DocView, LearnTab, TabRef } from './types'
import { t } from '../i18n'

/**
 * 自由页签的纯逻辑：怎么算一个页签的身份、开关与左右关闭各留下什么、默认用哪种视图。
 *
 * 单独成模块（而不是写在 LearnWorkspace 里）有两个理由：
 * 1. 这些判断全是纯函数，可以被单元测试钉住——「关闭右侧」这种操作一旦算错，
 *    用户看到的是「我关的是右边，它把我左边那个也关了」，而界面上一眼看不出来；
 * 2. 后续还有别的入口要开页签（大纲链接、agent、搜索结果），逻辑只该有一份。
 */

/** 能渲染出预览的扩展名：markdown 与 html。别的文本类型只能看源码（见 viewOf） */
const PREVIEW_EXTS = ['.md', '.markdown', '.html', '.htm']

/** 本地文件的**媒体预览**扩展名：图片 / 音频 / 视频（看的是内容本身，不是文本） */
const MEDIA_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico', '.avif',
  '.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac', '.opus',
  '.mp4', '.webm', '.mkv', '.mov', '.m4v',
])

/** 路径里的文件名（两种分隔符都认：本地文件来自 Windows，链接里可能是正斜杠） */
export function fileNameOf(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i >= 0 ? p.slice(i + 1) : p
}

/** 扩展名（含点，小写）；没有扩展名时返回空串。点开头的名字（.gitignore）不算扩展名 */
export function extOf(name: string): string {
  const base = fileNameOf(name)
  const i = base.lastIndexOf('.')
  return i > 0 ? base.slice(i).toLowerCase() : ''
}

/** 这个文件能不能预览（md / html） */
export function isPreviewable(name: string): boolean {
  return PREVIEW_EXTS.includes(extOf(name))
}

/** 这个文件是不是走**媒体预览**的（图片 / 音频 / 视频） */
export function isMediaFile(name: string): boolean {
  return MEDIA_EXTS.has(extOf(name))
}

/**
 * 页签的身份。各种来源共用一个命名空间，前缀把它们分开：
 * 节点的教学文档是 `t:`、某一份笔记是 `n:`、某一份超级文档是 `s:`、
 * 某一次考试的只读副本是 `e:`、某个目标的大纲页是 `o:`、本地文件是 `l:`、
 * 网页页签是 `w:`（key 是开签那一刻生成的随机身份，见 newWebKey）。
 * 于是「同一个东西只开一次」这件事只要比字符串就够了——笔记改名时替换的也是它
 * （见 replaceTabRef）。
 *
 * 试卷副本按**考试**（而不是试卷）开页签：同一份卷子考两次是两份不同的副本，
 * 各带各的作答、判分与错题讲解。
 */
export function tabKey(ref: TabRef): string {
  if (ref.kind === 'teach') return 't:' + ref.nodeId
  if (ref.kind === 'note') return 'n:' + ref.nodeId + ':' + ref.note
  if (ref.kind === 'super') return 's:' + ref.nodeId + ':' + ref.name
  if (ref.kind === 'exam') return 'e:' + ref.examId + ':' + ref.attemptId
  if (ref.kind === 'outline') return 'o:' + ref.nodeId
  // 网页按**开签那一刻生成的 key**（而不是网址）认身份：同一个网址可以开两枚，起始页也不冲突
  if (ref.kind === 'web') return 'w:' + ref.key
  // 守卫上下文全局只有一份（当前那次严格专注的会话）；报告按报告 id 一份一签
  if (ref.kind === 'guard') return 'g:guard'
  if (ref.kind === 'report') return 'r:' + ref.reportId
  // 设置页与用量页同样全局只有一份：从哪个入口打开都是切到它，不会开出第二枚
  if (ref.kind === 'settings') return 'set:settings'
  if (ref.kind === 'usage') return 'u:usage'
  // 超级导师设置全局一份；记忆按目标归档，页签也一枚目标一份
  if (ref.kind === 'mind') return 'm:' + ref.goalId
  if (ref.kind === 'agentSettings') return 'set:agent'
  return 'l:' + ref.path
}

export function makeTab(ref: TabRef, at: number, view?: DocView): LearnTab {
  return { id: tabKey(ref), ref, ...(view ? { view } : {}), createdAt: at }
}

/** 页签挂在哪个节点上；本地文件、网页、守卫、报告、设置与用量页都不属于任何节点 */
export function tabNodeId(ref: TabRef): string | null {
  return ref.kind === 'local' ||
    ref.kind === 'web' ||
    ref.kind === 'guard' ||
    ref.kind === 'report' ||
    ref.kind === 'settings' ||
    ref.kind === 'usage' ||
    ref.kind === 'mind' ||
    ref.kind === 'agentSettings'
    ? null
    : ref.nodeId
}

/**
 * 从页签 id 反解出它挂在哪个节点上（本地文件返回 null）。
 *
 * 与 tabKey 是一对，改格式必须一起改（见 learn/drafts 的 normalizeDrafts：
 * 读回来的暂存区要按它判断「这个页签指向的节点还在不在」）。
 */
export function tabIdNodeId(id: string): string | null {
  // e: 开头的试卷副本不带 nodeId（它由 examId 决定归属），所以这里也返回 null——
  // 暂存区按它判断「这个页签指向的节点还在不在」，而试卷副本本来就没有暂存这回事
  if (!id.startsWith('t:') && !id.startsWith('n:') && !id.startsWith('s:') && !id.startsWith('o:')) return null
  const rest = id.slice(2)
  const cut = rest.indexOf(':')
  return cut < 0 ? rest : rest.slice(0, cut)
}

/** web 页签的身份后缀：开签那一刻生成、导航不换（见 TabRef 的 web 分支与 tabKey） */
export function newWebKey(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

/**
 * 页签上显示的名字：教学文档用节点名，笔记与超级文档用各自的名字。
 *
 * 试卷副本的名字要查一次数据（「《极限小考》8/12 · 09-20」），所以它由调用方给一个
 * 查表函数——页签这一层不认识 store。
 */
export function tabTitle(
  ref: TabRef,
  nodeTitle: (nodeId: string) => string | undefined,
  examTitle?: (examId: string, attemptId: string) => string | undefined,
): string {
  if (ref.kind === 'teach') return nodeTitle(ref.nodeId) ?? t('已删除的节点')
  if (ref.kind === 'note') return ref.note
  if (ref.kind === 'super') return ref.name
  if (ref.kind === 'exam') return examTitle?.(ref.examId, ref.attemptId) ?? t('试卷副本')
  if (ref.kind === 'outline') return (nodeTitle(ref.nodeId) ?? t('已删除的节点')) + t(' · 大纲')
  if (ref.kind === 'web') {
    // 页面的真标题是活信息（见 types 的 WebTabMeta），这里只能兜底出域名；起始页没有域名
    if (!ref.url) return t('新网页页签')
    try {
      return new URL(ref.url).host
    } catch {
      return ref.url
    }
  }
  // 守卫上下文只有当前会话这一份，标题不随内容变；报告的时段画在正文里，页签上一律叫「专注报告」
  if (ref.kind === 'guard') return t('守卫 Agent')
  if (ref.kind === 'report') return t('专注报告')
  if (ref.kind === 'settings') return t('设置')
  if (ref.kind === 'usage') return t('用量统计')
  if (ref.kind === 'mind') return t('记忆管理')
  if (ref.kind === 'agentSettings') return t('超级导师设置')
  return ref.title || fileNameOf(ref.path)
}

/**
 * 页签的**路径后缀**：同名页签靠它区分（两个节点各有一份「错题本」、两个目录各有一个
 * notes.md）。只在真有重名时上层才会显示它，见 LearnWorkspace 的 tabTrails。
 *
 * 说「它住在哪儿」：节点类页签取节点到目标的路径（「极限/夹逼定理」），
 * 本地文件取所在目录，记忆页签取**目标本身**（它不挂节点，goalLabel 由调用方解析）。
 * 试卷副本不参与——它的名字里本来就带着考试时间。
 */
export function tabTrail(
  ref: TabRef,
  nodePath: (nodeId: string) => string,
  /** 记忆页签的后缀解析（目标原话）；不传时记忆页签没有后缀 */
  goalLabel?: (goalId: string) => string,
): string {
  if (ref.kind === 'exam') return ''
  if (ref.kind === 'web') return ''
  // 守卫、报告与系统页（设置/用量/导师设置）不挂在节点上，也没有「住在哪儿」可言
  if (ref.kind === 'guard' || ref.kind === 'report' || ref.kind === 'settings' || ref.kind === 'usage' || ref.kind === 'agentSettings')
    return ''
  if (ref.kind === 'mind') return goalLabel ? goalLabel(ref.goalId) : ''
  if (ref.kind === 'local') {
    const i = Math.max(ref.path.lastIndexOf('/'), ref.path.lastIndexOf('\\'))
    return i > 0 ? ref.path.slice(0, i) : ''
  }
  return nodePath(ref.nodeId)
}

/**
 * 这个页签此刻该用哪种视图。
 *
 * 默认值按文件类型给：教学文档与笔记都是 Markdown，默认看渲染结果；
 * 本地文件里只有 md / html 能预览，其余（txt 之类）默认落到源码——
 * 给一个纯文本文件渲染出一个「预览」是骗人的。
 *
 * empty = 这份正文此刻是空的（见 LearnWorkspace 的 emptyNote）：空笔记的预览是一片空白，
 * 而用户打开它就是要往里写，所以默认落到源码（编辑）视图，预览按钮也一并置灰。
 * 用户自己选过视图（tab.view）就听他的——他刚在空笔记里点过预览，那是他的选择。
 */
export function viewOf(tab: LearnTab, empty = false): DocView {
  if (tab.view) return tab.view
  if (empty) return 'source'
  if (tab.ref.kind === 'local') {
    // 媒体文件：没有「源码」可看，直接进媒体预览
    if (isMediaFile(tab.ref.path)) return 'media'
    // 需求口径：markdown 默认预览，**其余文本一律默认编辑**（html 也不例外）
    return /\.(md|markdown)$/i.test(tab.ref.path) ? 'preview' : 'source'
  }
  return 'preview'
}

/** 打开一个页签：已经有了就原样返回（由调用方负责激活），不重复开、也不改顺序 */
export function openTab(tabs: LearnTab[], ref: TabRef, at: number): LearnTab[] {
  const id = tabKey(ref)
  return tabs.some((t) => t.id === id) ? tabs : [...tabs, makeTab(ref, at)]
}

/** 换掉某个页签指向的东西（笔记改名走它），保留视图选择与创建时间 */
export function replaceTabRef(tabs: LearnTab[], from: TabRef, to: TabRef): LearnTab[] {
  const fromId = tabKey(from)
  const toId = tabKey(to)
  if (fromId === toId) return tabs
  let hit = false
  const next = tabs.map((t) => {
    if (t.id !== fromId) return t
    hit = true
    return { ...t, id: toId, ref: to }
  })
  return hit ? next : tabs
}

/** 某个节点全部页签的 id（删节点、关掉一个教学文档时用） */
export function tabIdsOfNode(tabs: LearnTab[], nodeId: string): string[] {
  return tabs.filter((t) => tabNodeId(t.ref) === nodeId).map((t) => t.id)
}

/** 右键菜单里的五种关闭方式 */
export type TabCloseMode = 'self' | 'left' | 'right' | 'others' | 'all'

/**
 * 右键菜单里的文案。**短**：菜单只有两百来像素宽，而「关闭左侧」四个字已经把
 * 「关的是哪一边」说全了——原先写成「关闭左侧文件」，右侧那枚数字反而被挤到看不见。
 */
export const TAB_CLOSE_LABEL: Record<TabCloseMode, string> = {
  self: '关闭',
  left: '关闭左侧',
  right: '关闭右侧',
  others: '关闭其他',
  all: '全部关闭',
}

/**
 * 关闭一批页签，并决定关完之后该激活哪一个。
 *
 * 落点规则与 vscode 一致：先往**右**找最近的一个还留着的页签，右边没有了才往左。
 * 「全部关闭」自然落在 null 上（一个不剩）。被关掉的那一片里不含当前页签时，
 * 当前页签保持不变——关别人不该把我正在看的这个换掉。
 */
export function closeTabs(
  tabs: LearnTab[],
  id: string,
  mode: TabCloseMode,
  active: string | null,
): { tabs: LearnTab[]; active: string | null } {
  const idx = tabs.findIndex((t) => t.id === id)
  if (idx < 0) return { tabs, active }
  const closing = new Set<string>()
  if (mode === 'all') {
    for (const t of tabs) closing.add(t.id)
  } else if (mode === 'self') {
    closing.add(tabs[idx].id)
  } else if (mode === 'left') {
    for (let i = 0; i < idx; i++) closing.add(tabs[i].id)
  } else if (mode === 'right') {
    for (let i = idx + 1; i < tabs.length; i++) closing.add(tabs[i].id)
  } else {
    for (const t of tabs) if (t.id !== id) closing.add(t.id)
  }
  const keep = tabs.filter((t) => !closing.has(t.id))
  if (active && keep.some((t) => t.id === active)) return { tabs: keep, active }
  const anchor = mode === 'all' ? 0 : idx
  const rest = tabs.map((t, i) => ({ t, i })).filter((x) => !closing.has(x.t.id))
  const landing = rest.find((x) => x.i >= anchor) ?? rest[rest.length - 1]
  return { tabs: keep, active: landing ? landing.t.id : null }
}

/** 按 id 关掉若干个页签（节点被删除时用；删掉的正是当前那个才换落点） */
export function closeTabsByIds(
  tabs: LearnTab[],
  ids: string[],
  active: string | null,
): { tabs: LearnTab[]; active: string | null } {
  const doomed = new Set(ids)
  if (!doomed.size) return { tabs, active }
  const keep = tabs.filter((t) => !doomed.has(t.id))
  if (active && !doomed.has(active)) return { tabs: keep, active }
  const rest = tabs.map((t, i) => ({ t, i })).filter((x) => !doomed.has(x.t.id))
  const firstIdx = tabs.findIndex((t) => doomed.has(t.id))
  const landing = rest.find((x) => x.i >= firstIdx) ?? rest[rest.length - 1]
  return { tabs: keep, active: landing ? landing.t.id : null }
}

/* ---------- 页签的拖动与切换 ---------- */

/**
 * 按给定的 id 顺序重排页签。
 *
 * 传进来的 ids 是**拖动之后希望看到的顺序**，允许它与现有列表对不齐：
 * 拖动过程中算出来的那份可能少一个 id（例如同一帧里别处刚开了一个页签），
 * 或者多一个已经不存在的 id（刚被关掉）。因此这里以「现有列表」为准——
 * 认得的按新顺序排在前面，没提到的按原顺序接在后面，认不出的直接忽略。
 * 这样任何一帧的快照都不会让页签凭空消失或重复。
 */
export function reorderTabs(tabs: LearnTab[], ids: string[]): LearnTab[] {
  const byId = new Map(tabs.map((t) => [t.id, t]))
  const out: LearnTab[] = []
  for (const id of ids) {
    const t = byId.get(id)
    if (!t || out.includes(t)) continue
    out.push(t)
  }
  for (const t of tabs) if (!out.includes(t)) out.push(t)
  return out
}

/**
 * 沿页签栏走一步：delta 为 +1 / -1，到头**绕回**另一端（循环）。
 *
 * 「按住右键横向拖动」用它：拖动是连续的，走到头若卡住，用户会以为拖动失灵了。
 * 一个页签都没有时返回 null（没有可去的地方）。
 */
export function stepTab(tabs: LearnTab[], active: string | null, delta: number): string | null {
  if (!tabs.length) return null
  if (delta === 0) return active
  const i = tabs.findIndex((t) => t.id === active)
  // 当前页签不在列表里（刚被关掉）：从最前/最后重新进场
  if (i < 0) return delta > 0 ? tabs[0].id : tabs[tabs.length - 1].id
  const n = tabs.length
  return tabs[(((i + delta) % n) + n) % n].id
}

/** 页签在栏上的序号；找不到返回 -1（用来判断切换动画的方向） */
export function tabIndex(tabs: LearnTab[], id: string | null): number {
  return id ? tabs.findIndex((t) => t.id === id) : -1
}

/**
 * 被拖的那一项从 from 挪到 to，它的**落点**相对原位置一共移了多少像素（正数 = 往右）。
 *
 * widths 是按下那一刻量到的每个页签的宽度（顺序就是当时的页签顺序），gap 是页签间距。
 * 为什么是量下来的那一份而不是现量：拖动过程中旁边的页签一直在让位，实时量出来的矩形
 * 一直在动，拿它算会来回抖（见 TabBar 的拖动排序）。
 *
 * 落点 = 重排之后它左边该在的位置：往右挪是它跨过的那些页签的宽度之和（每个还要算上
 * 一份间距），往左挪是负的这一份。松手那一帧要拿它把「手指底下的位置」换算到新落点上，
 * 差一格就会横着抽一下（见 TabBar 的 settle）。
 */
export function dragSlotDelta(widths: number[], from: number, to: number, gap: number): number {
  if (to === from) return 0
  let sum = 0
  if (to > from) for (let i = from + 1; i <= to; i++) sum += (widths[i] ?? 0) + gap
  else for (let i = to; i < from; i++) sum += (widths[i] ?? 0) + gap
  return to > from ? sum : -sum
}

