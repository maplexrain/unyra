/**
 * 引用 chip：`#[{…}]` 这一行内联语法的编解码、分词与 DOM 形态。
 *
 * 一份文档/试卷要能被「拖进输入框 → 发给导师 → 导师在交付里再引用回来 → 点击打开」，
 * 中间必须有一个**三方可读的文本形态**——它就是 `#[{type:"doc", path:"docs/…", title:"…"}]`：
 * 输入框把它渲染成元素（发送时就是这个字符串）、消息列表把它渲染成可点击的引用、
 * 导师在系统提示词里学会了它的写法。本模块只做纯函数（语法、宽松解析、SVG 图标、
 * chip 的 HTML），不认识 store、不挂事件——打开与落点的接线在 lib/docChip。
 *
 * chip 在 DOM 里的约定（输入框与消息列表共用）：
 * - `data-moji-doc-chip="1"`：身份标记（serializeEditable / hydrate 都认它）；
 * - `data-chip`：payload 的 JSON（点击打开时读它）；
 * - `data-token`：`#[{…}]` 文本形态（复制/发送时读它，见 composerDoc 的序列化）；
 * - `contenteditable="false"`：输入框里它是**一个整体**——删就整删，不会拆开。
 */

/** 一份被引用的东西。字段按类型给：路径类给 path，试卷类给 examId/attemptId，nodeId 有就带 */
export interface ChipPayload {
  type: 'doc' | 'note' | 'outline' | 'super' | 'local' | 'exam' | 'attempt'
  /** 路径：数据树相对路径（doc/note/outline/super 的宿主路径）或本地绝对路径（local） */
  path?: string
  /** 节点 id：宿主自己拖出来时都带；导师写的是否带随缘，缺了靠 path 反查 */
  nodeId?: string
  /** 笔记名（type:'note'） */
  note?: string
  /** 超级文档名（type:'super'） */
  name?: string
  examId?: string
  /** 有 attemptId 是「某一次考试的副本」；没有是试卷原件（点击弹考试窗口） */
  attemptId?: string
  /** 显示名：界面上那一小截文字。导师写的时候带上最好，缺了由 chipLabel 兜底 */
  title?: string
}

/** 拖放/复制时 dataTransfer 里的 MIME */
export const CHIP_MIME = 'application/x-moji-chip'

/* ---------- 编码 ---------- */

/** token = `#[{…}]`。键序固定（type → path → nodeId → note → name → examId → attemptId → title），
 * 同一份东西永远编出同一段文本——对比、去重、测试都靠这一点 */
export function chipToken(p: ChipPayload): string {
  const parts: string[] = []
  const put = (key: string, v: string | undefined): void => {
    if (v) parts.push(JSON.stringify(key) + ':' + JSON.stringify(v))
  }
  put('type', p.type)
  put('path', p.path)
  put('nodeId', p.nodeId)
  put('note', p.note)
  put('name', p.name)
  put('examId', p.examId)
  put('attemptId', p.attemptId)
  put('title', p.title)
  return '#[{' + parts.join(', ') + '}]'
}

/** dataTransfer / data-chip 里存的 JSON（不含 #[] 外壳） */
export function chipJson(p: ChipPayload): string {
  return JSON.stringify(p)
}

/* ---------- 解析 ---------- */

const CHIP_TYPES = new Set(['doc', 'note', 'outline', 'super', 'local', 'exam', 'attempt'])

/** 宽松修复：导师写的 JSON 可能带裸键名、单引号/全角引号/尾逗号——严格 parse 失败了再修一次 */
function repairJson(s: string): string {
  return s
    .replace(/[“”＂]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/'/g, '"')
    // 全角冒号/逗号：落在字符串值里也无妨（冒号逗号在串内不破坏 JSON），换来键位恢复正常
    .replace(/：/g, ':')
    .replace(/，/g, ',')
    .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_-]*)(\s*:)/g, '$1"$2"$3')
    .replace(/,(\s*[}\]])/g, '$1')
}

/** 从一段 JSON 文本解析 payload；认不出来的返回 null（调用方当普通文本处理） */
export function parseChipJson(raw: string): ChipPayload | null {
  let obj: unknown
  try {
    obj = JSON.parse(raw)
  } catch {
    try {
      obj = JSON.parse(repairJson(raw))
    } catch {
      return null
    }
  }
  if (typeof obj !== 'object' || obj === null) return null
  const rec = obj as Record<string, unknown>
  const type = typeof rec.type === 'string' ? rec.type : ''
  if (!CHIP_TYPES.has(type)) return null
  const str = (k: string): string | undefined => {
    const v = rec[k]
    return typeof v === 'string' && v ? v : undefined
  }
  return {
    type: type as ChipPayload['type'],
    path: str('path'),
    nodeId: str('nodeId'),
    note: str('note'),
    name: str('name'),
    examId: str('examId'),
    attemptId: str('attemptId'),
    title: str('title'),
  }
}

/** 从完整的 `#[{…}]` token 解析；外壳都不对就直接 null */
export function parseChipToken(raw: string): ChipPayload | null {
  const m = /^\s*#\[\s*\{([\s\S]*)\}\s*\]\s*$/.exec(raw)
  return m ? parseChipJson('{' + m[1] + '}') : null
}

/** 一段文本 → 文字与 chip 交替的序列；长得像 chip 但解析不开的原样留在文字里 */
export function splitChips(text: string): Array<{ kind: 'text'; text: string } | { kind: 'chip'; payload: ChipPayload; token: string }> {
  const out: Array<{ kind: 'text'; text: string } | { kind: 'chip'; payload: ChipPayload; token: string }> = []
  const re = /#\[\s*\{[\s\S]*?\}\s*\]/g
  let last = 0
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const payload = parseChipToken(m[0])
    if (!payload) continue
    if (m.index > last) out.push({ kind: 'text', text: text.slice(last, m.index) })
    out.push({ kind: 'chip', payload, token: m[0] })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) })
  return out
}

/* ---------- 外观 ---------- */

/** 显示名：title 优先，其余按类型的自然兜底 */
export function chipLabel(p: ChipPayload): string {
  if (p.title) return p.title
  if (p.type === 'attempt') return '试卷副本'
  if (p.type === 'exam') return '试卷'
  if (p.name) return p.name
  if (p.note) return p.note
  if (p.path) {
    const i = Math.max(p.path.lastIndexOf('/'), p.path.lastIndexOf('\\'))
    return i >= 0 ? p.path.slice(i + 1) : p.path
  }
  return p.type
}

/**
 * 一颗类型图标：手画的 16 格 SVG（不走图标库——chip 是动态插进 DOM 的字符串，
 * React 组件帮不上忙）。颜色与页签栏/资源管理器同一份类型色（见 components/learn/docTypes）：
 * 同一个东西在三处长得一样，用户才不用重新认一遍。
 */
const CHIP_ICON: Record<ChipPayload['type'], { color: string; d: string[] }> = {
  // 蓝：教学文档（摊开的书）
  doc: { color: '#4a8fd4', d: ['M2 3.5h3.2A2.3 2.3 0 0 1 7.5 5.8v7A1.8 1.8 0 0 0 5.7 11H2z', 'M14 3.5h-3.2a2.3 2.3 0 0 0-2.3 2.3v7a1.8 1.8 0 0 1 1.8-1.8H14z'] },
  // 琥珀：笔记（一页纸 + 两行字）
  note: { color: '#d9962e', d: ['M4 2.5h5.5L13 6v7.5H4z', 'M9.5 2.5V6H13', 'M6 9h4.5', 'M6 11.5h4.5'] },
  // 紫：超级文档（一扇应用窗口）
  super: { color: '#a066d6', d: ['M2.5 3.5h11v9h-11z', 'M2.5 6h11', 'M4.2 4.8h.01', 'M6 4.8h.01'] },
  // 松绿：大纲（分支的路线图）
  outline: { color: '#2e8b6e', d: ['M2.5 4h11', 'M4.5 8h9', 'M4.5 12h9', 'M2.5 7v6'] },
  // 中性灰：外部文件（一块硬盘）
  local: { color: '#98928a', d: ['M2.5 4.5h11v7h-11z', 'M2.5 8.5h11', 'M11 10.2h.01'] },
  // 朱：试卷（一顶学士帽）
  exam: { color: '#c0563a', d: ['M8 2.8 2.5 5.8 8 8.8l5.5-3z', 'M4.8 7.3v2.9c0 .9 1.5 1.9 3.2 1.9s3.2-1 3.2-1.9V7.3'] },
  // 朱：完成批改的试卷副本（判分圆环 + 对勾）
  attempt: { color: '#c0563a', d: ['M8 2.5a5.5 5.5 0 1 1-5.5 5.5', 'M2.5 8a5.5 5.5 0 0 1 1.6-3.9', 'M5.8 8.2 7.4 9.8 10.4 6.6'] },
}

export function chipSvg(type: ChipPayload['type']): string {
  const icon = CHIP_ICON[type] ?? CHIP_ICON.doc
  const body = icon.d.map((d) => '<path d="' + d + '"/>').join('')
  return (
    '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="' + icon.color +
    '" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + '</svg>'
  )
}

/* ---------- DOM 形态 ---------- */

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * chip 的 HTML（输入框插入、消息列表 hydrate、拖放插入共用一条路）。
 * 后面的空格让连续两枚 chip 不贴死；样式见 styles/chip.css 的 .moji-chip 一组。
 */
export function buildChipHtml(p: ChipPayload): string {
  const label = escapeHtml(chipLabel(p))
  return (
    '<span class="moji-chip" data-moji-doc-chip="1" data-chip="' + escapeHtml(chipJson(p)) +
    '" data-token="' + escapeHtml(chipToken(p)) +
    '" contenteditable="false" title="' + escapeHtml(chipToken(p)) + '">' +
    chipSvg(p.type) + '<span class="moji-chip-label">' + label + '</span></span>&nbsp;'
  )
}
