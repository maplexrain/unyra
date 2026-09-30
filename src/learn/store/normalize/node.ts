/** 节点与文档的反序列化：节点、教学文档、笔记、超级文档、注解，含各自的历史形态迁移。 */

import type { Annotation, KnowledgeNode, MasteryStatus, NodeDocs, NoteFile, SuperDocFile } from '../../types'
import { STATUSES } from '../factories'
import { normalizeAnnotationStyle } from '../../../lib/annotationStyle'
import { normalizeLearning } from '../../learning'
import { normalizeOutline } from '../../outline'
import { normalizeReviewPlan } from '../../review'
import { uniqueNoteName } from '../../notes'
import { uniqueSuperDocName } from '../../superdocs'

/** 旧的 'unknown' 迁移为 'learning'；无法识别的一律当作学习中 */
const toStatus = (v: unknown): MasteryStatus =>
  STATUSES.includes(v as MasteryStatus) ? (v as MasteryStatus) : 'learning'

function normalizeAnnotations(raw: unknown): Annotation[] {
  if (!Array.isArray(raw)) return []
  const out: Annotation[] = []
  for (const a of raw) {
    if (!a || typeof a !== 'object') continue
    const r = a as Record<string, unknown>
    const term = typeof r.term === 'string' ? r.term.trim() : ''
    const body = typeof r.body === 'string' ? r.body.trim() : ''
    if (!term || !body) continue
    if (out.some((x) => x.term === term)) continue
    // 旧数据没有 kind，一律按 AI 短释义处理
    const style = normalizeAnnotationStyle(r.style)
    // 出现序号：非负整数才认，其余（旧数据没有这一项）当第一次出现
    const at = typeof r.occurrence === 'number' && Number.isInteger(r.occurrence) && r.occurrence > 0 ? r.occurrence : 0
    out.push({
      term,
      body,
      kind: r.kind === 'note' ? 'note' : 'understand',
      ...(style ? { style } : {}),
      ...(at ? { occurrence: at } : {}),
    })
  }
  return out
}

/**
 * 拾掇出节点的教学文档。
 *
 * 认三种历史形态，一律迁到 docs.teaching 上：
 * - docs（当前形态）；
 * - content：单文档时代的教学文档正文；
 * - body：更早的字段名，教学文档与描述共用过它。
 */
function normalizeNodeDocs(raw: Record<string, unknown>): NodeDocs {
  const legacyBody = typeof raw.body === 'string' ? raw.body : ''
  const src = docsRecord(raw)
  const teaching = typeof src.teaching === 'string' ? src.teaching : ''
  return { teaching: teaching || (typeof raw.content === 'string' ? raw.content : legacyBody) }
}

/** 节点上那个 docs 对象（形状不对时给个空对象，调用方不必各自判类型） */
function docsRecord(raw: Record<string, unknown>): Record<string, unknown> {
  return raw.docs && typeof raw.docs === 'object' ? (raw.docs as Record<string, unknown>) : {}
}

/**
 * 拾掇出节点的笔记列表。
 *
 * 认两种历史形态：
 * - notes（当前形态：一节点多份笔记，每份一个文件）；
 * - docs.note（旧形态：节点那份固定的笔记文档）——并成一份名为「笔记」的笔记。
 *   「并」而不是「丢」：用户写在里面的东西是他的，不能因为改了数据模型就消失。
 *
 * 名字一律过 uniqueNoteName：手改过的数据里可能有两份同名笔记（或名字里带斜杠），
 * 而名字就是文件名，重名会在落盘时互相覆盖——那是最不该发生的一类数据损坏。
 */
function normalizeNotes(raw: Record<string, unknown>): NoteFile[] {
  const now = Date.now()
  const out: NoteFile[] = []
  const push = (name: unknown, content: unknown, createdAt: unknown, updatedAt: unknown): void => {
    const text = typeof content === 'string' ? content : ''
    const at = typeof createdAt === 'number' && Number.isFinite(createdAt) ? createdAt : now
    const seenAt = typeof updatedAt === 'number' && Number.isFinite(updatedAt) ? updatedAt : at
    out.push({ name: uniqueNoteName(out, typeof name === 'string' ? name : ''), content: text, createdAt: at, updatedAt: seenAt })
  }
  if (Array.isArray(raw.notes)) {
    for (const item of raw.notes) {
      if (!item || typeof item !== 'object') continue
      const r = item as Record<string, unknown>
      push(r.name, r.content, r.createdAt, r.updatedAt)
    }
  }
  const legacy = docsRecord(raw).note
  if (typeof legacy === 'string' && legacy.trim()) push('笔记', legacy, undefined, undefined)
  return out
}

/**
 * 拾掇出节点的超级文档列表（可交互 HTML，见 learn/superdocs）。
 * 名字与笔记同一条纪律：重名会在调用时指不清是哪一份，撞了就补序号。
 */
function normalizeSuperDocs(raw: Record<string, unknown>): SuperDocFile[] {
  const now = Date.now()
  const out: SuperDocFile[] = []
  if (!Array.isArray(raw.superdocs)) return out
  for (const item of raw.superdocs) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    const html = typeof r.html === 'string' ? r.html : ''
    const at = typeof r.createdAt === 'number' && Number.isFinite(r.createdAt) ? r.createdAt : now
    const seenAt = typeof r.updatedAt === 'number' && Number.isFinite(r.updatedAt) ? r.updatedAt : at
    const name = uniqueSuperDocName(out, typeof r.name === 'string' ? r.name : '')
    out.push({ name, html, createdAt: at, updatedAt: seenAt })
  }
  return out
}

export function normalizeNode(raw: unknown): KnowledgeNode | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string' || !r.id) return null
  if (typeof r.title !== 'string' || !r.title.trim()) return null
  const now = Date.now()
  const title = r.title.trim()
  const legacyBody = typeof r.body === 'string' ? r.body : ''
  const description =
    typeof r.description === 'string' ? r.description : legacyBody
  // 没有学习状态时不留这个键：界面与提示词都按「有没有」分支，而不是按「空不空」
  const learning = normalizeLearning(r.learning)
  // 大纲同理：形状读不出来就当「还没有」（老数据没有这一项），交互页按没有处理
  const outline = normalizeOutline(r.outline)
  // 复习计划同上（见 learn/review）
  const review = normalizeReviewPlan(r.review)
  return {
    id: r.id,
    title,
    key: typeof r.key === 'string' && r.key ? r.key : title.toLowerCase().replace(/\s+/g, ''),
    description,
    docs: normalizeNodeDocs(r),
    notes: normalizeNotes(r),
    superdocs: normalizeSuperDocs(r),
    ...(outline ? { outline } : {}),
    annotations: normalizeAnnotations(r.annotations),
    status: toStatus(r.status),
    ...(learning ? { learning } : {}),
    ...(review ? { review } : {}),
    origin: r.origin === 'ai' ? 'ai' : 'user',
    goalId: typeof r.goalId === 'string' ? r.goalId : '',
    createdAt: typeof r.createdAt === 'number' ? r.createdAt : now,
    updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : now,
  }
}
