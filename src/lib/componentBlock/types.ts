/**
 * 结构化教学组件围栏 (```component) 类型定义
 */

/** 组件插槽 / 字段节点 */
export interface ComponentSlotNode {
  /** 节点标签名（div / p / span 等） */
  tag: string
  /** 插槽名（如 #title -> title, #describe -> describe） */
  slotName: string
  /** 节点上携带的键值属性（如 type="warn" label="STAGE 01"） */
  attrs: Record<string, string>
  /** 文本或子内容 */
  content: string
}

/** 顶层组件节点 */
export interface ComponentNode {
  /** 组件标签名（如 Notice / Compare / Steps 等） */
  tag: string
  /** 顶层组件属性（如 type="warn" ratio="3:2"） */
  attrs: Record<string, string>
  /** 命名插槽字典（按 slotName 索引的列表，支持重复 slot 如多个 #step / #item） */
  slots: Record<string, ComponentSlotNode[]>
  /** 顺序子节点列表（保持书写顺序） */
  children: ComponentSlotNode[]
  /** 未分配插槽的直接内容 */
  rawText: string
}

/** 渲染上下文工具接口 */
export interface ComponentRenderCtx {
  escape: (text: string) => string
  renderInline?: (text: string) => string
}

export const COMPONENT_LANG = 'component'
