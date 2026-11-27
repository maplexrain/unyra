/**
 * 外部组件的公共类型与目录约定。
 *
 * 统一目录：`users/<uid>/doc-design/*.tsx`（渲染层看到的相对当前用户路径就是 `doc-design/`）。
 * 一个文件一个组件，文件里用 `export default { kind, ... }` 声明自己属于哪一类：
 * - doc-component       文档设计排版组件（```component 围栏）
 * - classroom-component 课堂组件（classroom.components）
 * - classroom-animation 课堂动效（Anime.js keyframes）
 * - classroom-sound     课堂音效（WebAudio 合成配方）
 *
 * 文件是真正的 TSX，不参与 Vite 打包；渲染层用 Sucrase 动态编译成 React 组件，
 * 保存后热更新（轮询 + 应用内写入事件）。
 */
import type { ReactNode } from 'react'

export const EXTERNAL_MODULES_DIR = 'doc-design'

/** React 组件拿到的统一 props；文档组件用 slots，课堂组件用 content / props。 */
export interface ExternalComponentProps {
  tag?: string
  content?: string
  attrs?: Record<string, string>
  props?: Record<string, string>
  slots?: Record<string, string>
  /** 文档组件的原始解析节点，方便自定义组件读取插槽属性 */
  node?: unknown
}

export type ExternalModuleKind =
  | 'doc-component'
  | 'classroom-component'
  | 'classroom-animation'
  | 'classroom-sound'

export interface ExternalModuleRecord {
  kind: ExternalModuleKind
  /** 文件内声明的唯一 id / tag / verb / name */
  id: string
  /** 相对当前用户目录：doc-design/xxx.tsx */
  file: string
  /** 文件名（不含目录），用于删除与展示 */
  fileName: string
  /** 源码，设置页源码视图直接展示 */
  source: string
  /** 编译后的导出对象；字段形状由各类注册中心自行解释 */
  def: Record<string, unknown>
  /** 编译成功时间戳（毫秒） */
  loadedAt: number
}

export interface ExternalModuleError {
  fileName: string
  message: string
}

/** 文档组件文件导出：metadata + React 组件 */
export interface ExternalDocComponentDef {
  kind: 'doc-component'
  id?: string
  tag: string
  name?: string
  description?: string
  category?: string
  slots?: Array<{ name: string; description: string; required?: boolean }>
  attrs?: Array<{ name: string; description: string; type?: string; default?: string }>
  example?: string
  /** 推荐：真正的 React 组件 */
  component: (props: ExternalComponentProps) => ReactNode
}

/** 课堂组件文件导出：metadata + React 组件 */
export interface ExternalClassroomComponentDef {
  kind: 'classroom-component'
  tag: string
  name?: string
  description?: string
  category?: 'layout' | 'content' | 'interactive' | 'visual'
  defaultProps?: Record<string, string>
  example?: string
  component: (props: ExternalComponentProps) => ReactNode
}

/** 课堂动效文件导出：直接给 Anime.js 的 keyframes */
export interface ExternalClassroomAnimationDef {
  kind: 'classroom-animation'
  verb: string
  name?: string
  description?: string
  keyframes?: Record<string, unknown> | Array<Record<string, unknown>>
  duration?: number
  easing?: string
  recommendedSfx?: string
  example?: string
}

/** 课堂音效文件导出：play(v, kit)，kit 提供 tone / noise 两个合成原语 */
export interface ExternalClassroomSoundDef {
  kind: 'classroom-sound'
  name: string
  label?: string
  description?: string
  category?: 'transition' | 'accent' | 'rhythm' | 'feedback'
  mood?: string
  use?: string
  recommended?: boolean
  defaultDuration?: number
  play: (voice: unknown, kit: { tone: (opts: unknown) => void; noise: (opts: unknown) => void }) => void
}
