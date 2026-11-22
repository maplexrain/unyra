/**
 * 智能体团队视图的纯逻辑辅助函数：
 * - Agent 模式分类（仅聊天 | 导师）
 * - 对话时间戳解析与按对话时间降序排序
 * - 历史侧栏标题、消息计数与时间格式化
 */

import type { Conversation } from '../../../agent/types'
import { t } from '../../../i18n'

/** agent team 左栏的声部 id（与 agent/agentProfile 的 AgentProfileId 同形：5 位） */
export type AgentTeamMode = 'free' | 'tutor' | 'dispatcher' | 'examiner' | 'designer' | 'researcher' | 'fixer'

/**
 * 解析一段对话的「最近对话时间」（毫秒时间戳）：
 * 综合 updatedAt、createdAt 与最后一条消息的 ts，兼容缺少 updatedAt 的历史数据。
 */
export function conversationTimeOf(conv: Conversation): number {
  let latestMsgTs = 0
  for (const m of conv.messages) {
    if (typeof m.ts === 'number' && Number.isFinite(m.ts) && m.ts > latestMsgTs) {
      latestMsgTs = m.ts
    }
  }
  const updated = typeof conv.updatedAt === 'number' && Number.isFinite(conv.updatedAt) ? conv.updatedAt : 0
  const created = typeof conv.createdAt === 'number' && Number.isFinite(conv.createdAt) ? conv.createdAt : 0
  return Math.max(updated, created, latestMsgTs)
}

/** 按对话时间降序排列（最近活跃 / 新建的排在最前面），时间相同按创建时间与 id 稳定排序 */
export function sortConversationsByTimeDesc(list: readonly Conversation[]): Conversation[] {
  return [...list].sort((a, b) => {
    const dt = conversationTimeOf(b) - conversationTimeOf(a)
    if (dt !== 0) return dt
    const dc = (b.createdAt || 0) - (a.createdAt || 0)
    if (dc !== 0) return dc
    return b.id.localeCompare(a.id)
  })
}

/**
 * 把一段消息文本压成**纯文本摘要**：HTML / SVG / 围栏代码这类渲染态内容
 * 不能以原文落在聊天列表里——带图题与讲解里最常见的整段 `<svg>`、课堂与
 * 超级文档的 HTML 片段、代码围栏，进了预览与标题就是一串标签原文。
 * 处理顺序：围栏代码 → `<svg>` 整段 → Markdown 图片 → 链接留文字 →
 * HTML 注释与其余标签 → 常用实体 → 空白折叠。
 * 标签剥离只认「`<` 后紧跟字母」的形状：`a < b > c` 这类比较文本不受影响。
 */
function plainPreview(text: string): string {
  let s = text
  // 围栏代码块：按 ``` 切段，奇数段都是代码（未闭合的尾巴也算代码）
  s = s
    .split(/```/)
    .map((seg, i) => (i % 2 === 1 ? ` ${t('[代码]')} ` : seg))
    .join(' ')
  s = s.replace(/<svg[\s\S]*?<\/svg\s*>/gi, ` ${t('[图]')} `)
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, ` ${t('[图]')} `)
  s = s.replace(/\[([^\]]*)\]\(([^)]*)\)/g, '$1')
  s = s.replace(/<!--[\s\S]*?-->/g, ' ')
  s = s.replace(/<\/?[a-zA-Z][^>]*>/g, ' ')
  s = s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, '&')
  // 剥标签会在中文标点前留下悬空空格（「定冠词 ？」），贴回去
  return s
    .replace(/ ([，。？；：！、）】」』])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 解析侧栏展示用的对话标题：已起名标题 > 首条可见用户消息 > 最近工作流标记 > 新对话 */
export function displayConversationTitle(conv: Conversation): string {
  const named = conv.title?.trim()
  if (named) return named

  for (const m of conv.messages) {
    if (m.role !== 'user' || m.hidden) continue
    const text = plainPreview(
      m.parts
        .filter((p) => p.type === 'text')
        .map((p) => p.text)
        .join(' '),
    )
    if (text) return text.length > 36 ? `${text.slice(0, 36)}…` : text
  }

  for (let i = conv.messages.length - 1; i >= 0; i--) {
    const mark = conv.messages[i]?.mark?.trim()
    if (mark) return t(mark)
  }

  return t('新对话')
}

/** 提取对话最近一条可见消息摘要，供联系人卡片副标题展示 */
export function lastMessagePreview(conv: Conversation | undefined | null): string {
  if (!conv) return ''
  for (let i = conv.messages.length - 1; i >= 0; i--) {
    const m = conv.messages[i]
    if (!m || (m.hidden && !m.mark)) continue
    const text = plainPreview(
      m.parts
        .filter((p) => p.type === 'text')
        .map((p) => p.text)
        .join(' '),
    )
    if (text) return text.length > 32 ? `${text.slice(0, 32)}…` : text
    if (m.mark?.trim()) return t(m.mark.trim())
  }
  return ''
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** 将对话时间戳格式化为简洁可读的本地时间标签 */
export function formatConversationTime(ts: number, now = Date.now()): string {
  if (!Number.isFinite(ts) || ts <= 0) return ''
  const diff = now - ts
  if (diff >= 0 && diff < 60_000) return t('刚刚')

  const d = new Date(ts)
  const cur = new Date(now)
  const hhmm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`

  const sameYear = d.getFullYear() === cur.getFullYear()
  const sameDay = sameYear && d.getMonth() === cur.getMonth() && d.getDate() === cur.getDate()
  if (sameDay) return hhmm

  const yesterday = new Date(cur)
  yesterday.setDate(cur.getDate() - 1)
  const isYesterday =
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate()
  if (isYesterday) return `${t('昨天')} ${hhmm}`

  if (sameYear) return `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${hhmm}`
  return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`
}
