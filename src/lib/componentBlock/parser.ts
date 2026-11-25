/**
 * 结构化教学组件 DSL 解析器
 *
 * 解析语法示例：
 * ```component
 * <Notice type="warn">
 *   <div #title>易错陷阱 · 边界条件</div>
 *   <div #describe>当分母趋近于 0 时，不能直接代入求值</div>
 * </Notice>
 * ```
 */

import type { ComponentNode, ComponentSlotNode } from './types'

interface ParsedTag {
  isClose: boolean
  isSelfClose: boolean
  tagName: string
  attrStr: string
  index: number
  length: number
}

/** 解析属性字符串，提取普通键值对与 #slot 标识 */
export function parseAttributes(attrStr: string): { attrs: Record<string, string>; slotName?: string } {
  const attrs: Record<string, string> = {}
  let slotName: string | undefined

  if (!attrStr || !attrStr.trim()) {
    return { attrs, slotName }
  }

  // 匹配 #slotName 或 key="val" / key='val' / key=val / 裸 key
  const attrRegex =
    /(?:#(?:([a-zA-Z0-9_-]+)(?:=["']([^"']*)["']|=([^\s>]+))?))|(?:([a-zA-Z0-9_-]+)(?:=["']([^"']*)["']|=([^\s>]+))?)/g

  let match: RegExpExecArray | null
  while ((match = attrRegex.exec(attrStr)) !== null) {
    if (match[1]) {
      // 命中 #slotName
      const name = match[1]
      slotName = name
      const val = match[2] ?? match[3] ?? 'true'
      attrs[`#${name}`] = val
      attrs[name] = val
    } else if (match[4]) {
      // 普通属性 key="value"
      const key = match[4]
      const val = match[5] ?? match[6] ?? 'true'
      attrs[key] = val
    }
  }

  return { attrs, slotName }
}

/** 词法扫描所有 HTML-like 标签 */
function scanTags(source: string): ParsedTag[] {
  const tags: ParsedTag[] = []
  // 匹配 <tag ...>, </tag>, <tag ... />
  // 属性部分安全匹配引号包裹的内容
  const tagRegex =
    /<(\/)?([a-zA-Z0-9_-]+)((?:\s+(?:[^>"']|"[^"]*"|'[^']*')*?)?)\s*(\/)?>/g

  let match: RegExpExecArray | null
  while ((match = tagRegex.exec(source)) !== null) {
    tags.push({
      isClose: Boolean(match[1]),
      isSelfClose: Boolean(match[4]),
      tagName: match[2]!,
      attrStr: match[3] ?? '',
      index: match.index,
      length: match[0].length,
    })
  }
  return tags
}

interface StackFrame {
  tag: string
  slotName?: string
  attrs: Record<string, string>
  slots: Record<string, ComponentSlotNode[]>
  children: ComponentSlotNode[]
  textParts: string[]
  /** 开标签结束后的源文起点：闭合时切出 raw 片段，保留嵌套 HTML */
  contentStart: number
}

/** 分组插槽里可折叠成属性的子插槽（如 #left 里的 #title / #label） */
const FIELD_SLOT_NAMES = new Set([
  'title',
  'badge',
  'label',
  'value',
  'name',
  'tone',
  'type',
  'num',
  'ratio',
])

/** 分组插槽里的正文别名（如 #left 里的 #content / #describe） */
const BODY_SLOT_NAMES = new Set(['content', 'body', 'describe', 'description', 'desc', 'text'])

/** 从分组插槽的 raw 中移除已折叠成属性的子插槽，留下真正的正文 */
function stripNamedFields(raw: string, names: string[]): string {
  let out = raw
  for (const name of names) {
    const re = new RegExp(
      `<([a-zA-Z0-9_-]+)\\s+[^>]*#${name}\\b[^>]*>[\\s\\S]*?<\\/\\1>`,
      'gi',
    )
    out = out.replace(re, '')
  }
  return out.trim()
}

/** 把一帧的嵌套插槽折叠到父级 slotNode：这是 AI 常用写法的兼容层。 */
function buildSlotNode(frame: StackFrame, raw: string): ComponentSlotNode {
  const attrs = { ...frame.attrs }
  const namedChildren = Object.entries(frame.slots).filter(([, list]) =>
    list.some((node) => node.explicitSlot),
  )

  // 1) 已知字段子插槽 -> 父级属性；显式属性优先，不被嵌套写法覆盖。
  for (const [name, list] of namedChildren) {
    if (!FIELD_SLOT_NAMES.has(name) || attrs[name]) continue
    const value = list
      .map((node) => node.content.trim())
      .filter(Boolean)
      .join(' ')
    if (value) attrs[name] = value
  }

  // 2) #content / #body / #describe 作为正文；否则保留 raw HTML（ul/li/strong 等）。
  const bodyNodes = namedChildren
    .filter(([name]) => BODY_SLOT_NAMES.has(name))
    .flatMap(([, list]) => list)
  const directText = frame.textParts.join('').trim()
  const bodyText = bodyNodes
    .map((node) => node.content.trim())
    .filter(Boolean)
    .join('\n')
  let content = ''
  if (bodyText) {
    content = [directText, bodyText].filter(Boolean).join('\n')
  } else if (namedChildren.length > 0) {
    // AI 也常写「#title + 直接一个 ul」而不包 #content：移除 #title 标签后留正文。
    content = stripNamedFields(
      raw,
      namedChildren.map(([name]) => name),
    )
  } else {
    content = raw.trim()
  }

  return {
    tag: frame.tag,
    slotName: frame.slotName || frame.tag.toLowerCase(),
    attrs,
    content,
    explicitSlot: Boolean(frame.slotName),
  }
}

/**
 * 解析 component 块源文本为 ComponentNode 列表
 */
export function parseComponentBlock(source: string): ComponentNode[] {
  const cleanSource = source.trim()
  if (!cleanSource) return []

  const tags = scanTags(cleanSource)
  if (!tags.length) {
    // 纯文本兜底（无任何标签包裹时）
    return [
      {
        tag: 'Notice',
        attrs: {},
        slots: {
          describe: [
            {
              tag: 'div',
              slotName: 'describe',
              attrs: {},
              content: cleanSource,
            },
          ],
        },
        children: [],
        rawText: cleanSource,
      },
    ]
  }

  const roots: ComponentNode[] = []
  const stack: StackFrame[] = []
  let cursor = 0

  for (const tag of tags) {
    // 收集标签前的纯文本
    if (tag.index > cursor) {
      const text = cleanSource.slice(cursor, tag.index)
      if (stack.length > 0) {
        stack[stack.length - 1]!.textParts.push(text)
      }
    }
    cursor = tag.index + tag.length

    if (tag.isClose) {
      // 闭合标签：向栈底查找同名标签
      let foundIdx = -1
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i]!.tag.toLowerCase() === tag.tagName.toLowerCase()) {
          foundIdx = i
          break
        }
      }

      if (foundIdx >= 0) {
        // 出栈至匹配帧
        while (stack.length > foundIdx) {
          const popped = stack.pop()!
          const raw = cleanSource.slice(popped.contentStart, tag.index)
          const text = popped.textParts.join('')

          if (stack.length === 0) {
            // 顶层组件完成
            roots.push({
              tag: popped.tag,
              attrs: popped.attrs,
              slots: popped.slots,
              children: popped.children,
              rawText: text.trim(),
            })
          } else {
            // 子插槽节点完成，挂载到父帧
            const parent = stack[stack.length - 1]!
            const slotName = popped.slotName || (popped.attrs['#'] ? 'default' : popped.tag.toLowerCase())
            const slotNode = buildSlotNode(popped, raw)
            if (!parent.slots[slotName]) {
              parent.slots[slotName] = []
            }
            parent.slots[slotName].push(slotNode)
            parent.children.push(slotNode)
          }
        }
      }
    } else {
      // 开始标签或自闭合标签
      const { attrs, slotName } = parseAttributes(tag.attrStr)

      if (tag.isSelfClose) {
        if (stack.length > 0) {
          const parent = stack[stack.length - 1]!
          const sName = slotName || tag.tagName.toLowerCase()
          const slotNode: ComponentSlotNode = {
            tag: tag.tagName,
            slotName: sName,
            attrs,
            content: '',
            explicitSlot: Boolean(slotName),
          }
          if (!parent.slots[sName]) parent.slots[sName] = []
          parent.slots[sName].push(slotNode)
          parent.children.push(slotNode)
        } else {
          // 自闭合顶层组件
          roots.push({
            tag: tag.tagName,
            attrs,
            slots: {},
            children: [],
            rawText: '',
          })
        }
      } else {
        // 入栈
        stack.push({
          tag: tag.tagName,
          slotName,
          attrs,
          slots: {},
          children: [],
          textParts: [],
          contentStart: tag.index + tag.length,
        })
      }
    }
  }

  // 收尾：若存在未闭合的帧，逐一出栈兜底
  while (stack.length > 0) {
    const popped = stack.pop()!
    const text = popped.textParts.join('')
    if (stack.length === 0) {
      roots.push({
        tag: popped.tag,
        attrs: popped.attrs,
        slots: popped.slots,
        children: popped.children,
        rawText: text.trim(),
      })
    } else {
      const parent = stack[stack.length - 1]!
      const slotName = popped.slotName || 'default'
      const slotNode = buildSlotNode(popped, cleanSource.slice(popped.contentStart))
      if (!parent.slots[slotName]) parent.slots[slotName] = []
      parent.slots[slotName].push(slotNode)
      parent.children.push(slotNode)
    }
  }

  return roots
}
