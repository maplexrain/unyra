/**
 * Accessibility.getFullAXTree 的原始 AX 节点 → 「带 ref 的可交互元素清单」。
 *
 * 这是 browser-use 一类库喂给 LLM 的同款表示：不把整棵树倒给模型，只留**可交互的**
 * （button / link / textbox / 带 clickable 的 generic…）加上少量帮它「认出自己在哪」的
 * 结构（heading、image），每枚编一个 ref 号——模型按号指名，宿主再解析回真实节点
 * （electron/app/webSession 的 refPoint：滚进视野 + 取元素四边形中心）。
 *
 * 纯函数、零依赖（连 electron 类型都不 import）：主进程转换用它，Node 里的探针与
 * 单测也用它——这份表示法只该有一份。
 */

export interface AxRawNode {
  ignored?: boolean
  role?: { value?: string }
  name?: { value?: string }
  value?: { value?: unknown }
  properties?: Array<{ type?: string; value?: unknown }>
  backendDOMNodeId?: number
}

export interface AxSnapshotElement {
  /** 编号（每次快照从 1 重新数）；click / type 的目标可写成 { ref } 按号指名 */
  ref: number
  /** 无障碍角色：button / link / textbox / heading … */
  role: string
  /** 无障碍名称（按钮文字、链接文字、输入框的标签…） */
  name: string
  /** 输入框的当前值（只有文本框类才有） */
  value?: string
  /** 主进程内部用（DOM 域按它定位），不回给沙箱 */
  backendNodeId?: number
}

/** 有语义的可交互角色；generic 只有带 clickable 属性才收 */
const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'textbox',
  'searchbox',
  'combobox',
  'checkbox',
  'radio',
  'switch',
  'slider',
  'spinbutton',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'tab',
  'option',
  'treeitem',
])

/** 不是可交互、但帮模型「认出自己在哪」的结构 */
const CONTEXT_ROLES = new Set(['heading', 'image'])

/** 一页最多列这么多：超了先截断（模型可以滚动后再 snapshot 看后面的） */
export const MAX_SNAPSHOT_ELEMENTS = 200

export function axNodesToElements(
  nodes: AxRawNode[] | undefined,
): { elements: AxSnapshotElement[]; truncated: boolean } {
  const elements: AxSnapshotElement[] = []
  for (const node of nodes ?? []) {
    if (elements.length >= MAX_SNAPSHOT_ELEMENTS) return { elements, truncated: true }
    if (node.ignored) continue
    const role = node.role?.value ?? ''
    if (!role) continue
    const clickable = node.properties?.some((p) => p.type === 'clickable' && p.value === true) ?? false
    if (!INTERACTIVE_ROLES.has(role) && !(clickable && role !== 'StaticText') && !CONTEXT_ROLES.has(role)) continue
    const name = (node.name?.value ?? '').toString().trim()
    const rawValue = node.value?.value
    const value = typeof rawValue === 'string' ? rawValue.trim() : ''
    if (!name && !value) continue
    elements.push({
      ref: elements.length + 1,
      role,
      name,
      ...(value ? { value } : {}),
      ...(typeof node.backendDOMNodeId === 'number' ? { backendNodeId: node.backendDOMNodeId } : {}),
    })
  }
  return { elements, truncated: false }
}
