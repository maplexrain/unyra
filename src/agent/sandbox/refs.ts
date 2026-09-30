/**
 * 这个文件负责什么：沙箱的「引用与取值」——path 解析出来的 NodeRef / DocRef，
 * 以及把模型给的任意参数收成确定形状的小工具（asRecord / asText / asIndex…）。
 * 文档跳转那套纯文本规则（lib/docDom 的 needleForDoc / plainLineOf）也从这里中转出去，
 * 老的调用方（从 agent/tools 取它们的地方）不受影响。
 */
/**
 * 文档类型（与 learn/types 的 DocKind 一致；这里只放类型，避免 agent 层依赖 learn 的实现）。
 *
 * 它住在这一边而不是 ./types：DocRef 要用它，而 types 里的 ResolvedNodeRef / ResolvedDocRef
 * 又来自这里——定义放在任意一边，两个文件的类型都会互相引用成环。
 */
export type SandboxDocKind = 'teaching' | 'note'

/** path 解析出来的节点 */
export interface NodeRef {
  id: string
  title: string
  /** 人类可读的路径（如「极限/夹逼定理」），回给模型确认动的是哪一个 */
  label: string
}

/** path 解析出来的文档 */
export interface DocRef extends NodeRef {
  kind: SandboxDocKind
  /**
   * 要哪一份笔记（kind 为 'note' 时才有）。省略 = 这个节点的第一份；
   * 一份都没有时由写入方按这个名字新建（见 learn/agentOps 的 writeDocText）。
   */
  note?: string
  /** 文档的完整路径（如「极限/夹逼定理/笔记/错题本」） */
  docLabel: string
}

export type ResolvedNodeRef = { ok: true; ref: NodeRef } | { ok: false; message: string }
export type ResolvedDocRef = { ok: true; ref: DocRef } | { ok: false; message: string }

/* ---------- 参数与返回值的小工具 ---------- */

export const asRecord = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

export const asText = (v: unknown): string => (typeof v === 'string' ? v : '')
/**
 * 「可选路径」参数：模型经常把缺省参数写成 null / '' / 'undefined'，
 * 一律当成「没给」——否则解析会拿到一个空路径，报出一句莫名其妙的「找不到节点」。
 */
export const asOptionalPath = (v: unknown): string | undefined => {
  const s = asText(v).trim()
  return s && s !== 'undefined' && s !== 'null' ? s : undefined
}

/**
 * exam.create 的入参：对象照收；直接给了数组（或一段文本）时按 questions 理解——
 * 模型常把 questions 直接当参数传，asRecord 会把数组悄悄变成 {}，报出「没有 questions」这种误导。
 */
export function asExamPayload(v: unknown): Record<string, unknown> {
  if (Array.isArray(v)) return { questions: v }
  const rec = asRecord(v)
  if (Object.keys(rec).length) return rec
  if (typeof v === 'string' && v.trim()) return { questions: v }
  return rec
}

/** 把 undefined / NaN / 负数 / 小数统一收成可选整数 */
export function asIndex(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined
  const n = Math.floor(Number(v))
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

/**
 * ui.point 的行号定位用：把 Markdown **源文的一行**折成渲染文本里找得到的纯文字。
 *
 * 渲染结果里没有语法字符——「## 标题」渲染成「标题」、「**重点**」渲染成「重点」、
 * 「[文字](moji:learn "…")」渲染成「文字」。拿原始源文行去渲染文本里搜，
 * 除了纯散文行基本搜不到（agent 实测 {line:30} 一律 located:false 就是它）。
 * 链接保留文字、其余语法标记剥掉；纯公式行渲染成 KaTeX（定位扫描会跳过），
 * 这类行本来就只能落到按比例滚动。
 */
/* plainLineOf / needleForDoc 住在 lib/docDom：它们是「源文 ↔ 渲染结果」的纯文本规则，
   文档跳转语法（moji:doc/…#L12）与 ui.point 用的是同一套。这里重导出，老的调用方不受影响。 */
export { needleForDoc, plainLineOf } from '../../lib/docDom'
export type { DocJumpTarget } from '../../lib/docDom'