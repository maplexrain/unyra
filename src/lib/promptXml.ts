/**
 * 提示词正文的 XML 分块：只认**行首的顶层标签**，把每个 `<tag>…</tag>` 切成一块，
 * 供提示词浏览页生成左侧目录。标签里的 Markdown 不在这里解析，交给 renderNote。
 *
 * 不引入完整 XML 解析器：提示词是「Markdown 外套一层语义标签」，不是严格 XML；
 * 行级扫描足以避开代码围栏里的 `<div>`，也不会把标签内的正文当成标记。
 */

export interface PromptXmlBlock {
  /** 顶层标签名；没有标签时为空串 */
  tag: string
  /** 目录与块头显示的短名 */
  title: string
  /** 标签内部正文（不含外层标签） */
  body: string
  /** 含外层标签的原始文本（源码模式不用它，只用于定位） */
  raw: string
}

const TAG_TITLES: Readonly<Record<string, string>> = {
  agent_common: '通用基座',
  collaboration_rules: '团队协作',
  channel_rules: '通道纪律',
  compaction_rules: '压缩规程',
  tool_capabilities: 'API 能力',
  identity: '角色定位',
  duties: '专属分工',
  delegated_capabilities: '可委派能力',
  boundaries: '安全边界',
  role: '工作身份',
  execution_rules: '执行纪律',
  sandbox_and_tools: '工具与沙箱',
  delivery_rules: '交付规则',
  work_role: '工作分工',
  content_layout: '内容排版',
  content_syntax: '领域语法',
  workflow_procedures: '工作流',
  work_discipline: '领域纪律',
  user_extra: '附加提示',
}

const OPEN_TAG = /^<([A-Za-z][A-Za-z0-9._:-]*)(?:\s[^<>]*)?>$/
const CLOSE_TAG = /^<\/([A-Za-z][A-Za-z0-9._:-]*)>$/
const FENCE = /^(```|~~~)/

function titleOf(tag: string): string {
  return TAG_TITLES[tag] ?? tag
}

/** 一份提示词的 XML 顶层块；没有任何顶层标签时，整篇作为「全文」一块 */
export function parsePromptXml(content: string): PromptXmlBlock[] {
  const lines = content.split('\n')
  const blocks: PromptXmlBlock[] = []
  const stack: string[] = []
  let start = -1
  let startTag = ''
  let fenced = false

  for (let i = 0; i < lines.length; i += 1) {
    const trim = lines[i]!.trim()
    if (FENCE.test(trim)) {
      fenced = !fenced
      continue
    }
    if (fenced) continue

    const open = OPEN_TAG.exec(trim)
    if (open) {
      if (!stack.length) {
        start = i
        startTag = open[1]!
      }
      stack.push(open[1]!)
      continue
    }

    const close = CLOSE_TAG.exec(trim)
    if (!close || !stack.length || stack[stack.length - 1] !== close[1]) continue
    stack.pop()
    if (stack.length || start < 0) continue

    blocks.push({
      tag: startTag,
      title: titleOf(startTag),
      body: lines.slice(start + 1, i).join('\n').trim(),
      raw: lines.slice(start, i + 1).join('\n'),
    })
    start = -1
    startTag = ''
  }

  if (!blocks.length) {
    const body = content.trim()
    return body ? [{ tag: '', title: '全文', body, raw: content }] : []
  }
  return blocks
}
