/**
 * 结构画布的视图模型类型：CardView（一张卡的视图模型，组件只认它、不碰 store）、
 * 大纲目标项行、试卷考试记录行、派生连线 CanvasEdge 与整图 CanvasView。
 * 从 structureView.ts 拆出（纯搬运，逻辑与注释原样）。
 */

import type { FileNodeKind, ProjectPathKind } from '../../../../learn/types'
import type { GNodeKind } from '../../../../learn/nodeKinds'
import type { HeightOf } from '../../../../learn/structure'

/* ---------- 卡片与目标项 ---------- */

/** 大纲卡片里的一行目标项 */
export interface OutlineSlotView {
  /** 目标项的 key（= normalizeKey(标题)） */
  key: string
  title: string
  index: number
  /** 已经挂上来的子文档 uuid；null = 这个接入点还空着（点一下就挂一份空文档） */
  childId: string | null
}

/** 一张卡的视图模型（组件只认它，不碰 store） */
export interface CardView {
  uuid: string
  kind: GNodeKind
  title: string
  subtitle: string
  /** 文档卡的两行正文摘要 */
  excerpt?: string
  /** 空文档卡：正文还没有，卡片上给一颗「生成」 */
  blank?: boolean
  /** 用户贴在卡片上的便条（存进坐标表） */
  note?: string  /** 大纲卡的目标项行（kind = outline 时才有） */
  slots?: OutlineSlotView[]
  /** 这张文档卡是本图的入口（目标的根）——卡片上挂「入口」徽章；一张图有且只有一个 */
  entry?: boolean
  /** 游离大纲卡（独立实体，没有宿主文档）：空卡给「添加目标项」而不是「生成大纲」 */
  free?: boolean
  /** 大纲卡：已生成过大纲导读（OutlineDoc/OutlineEntity 的 guide）——右键菜单的「大纲导读」据此出现 */
  hasGuide?: boolean
  /** 笔记卡：已生成的笔记总结（≤200 字，NoteFile.summary），卡面上直接展示 */
  summary?: string
  /** 试卷卡的考试记录行（kind = exam 时才有；一行一次作答） */
  attempts?: ExamAttemptRow[]
  /**
   * 项目卡的路径声明（kind = project 时才有）。解析出的绝对路径一并给——
   * 卡上的目录树展开、授权提示都以它为准；解析失败（null）卡上显示待解析。
   */
  project?: { path: string; pathKind: ProjectPathKind; resolved: string | null }
  file?: { fileKind: FileNodeKind; url: string }
  video?: { videoId: string | null; input: string; confirmed: boolean }
  x: number
  y: number
}

/** 试卷卡上的一行考试记录 */
export interface ExamAttemptRow {
  /** 第几次（从 1 起） */
  n: number
  label: string
  /** 那次作答的 id：点行打开只读副本页签用 */
  attemptId: string
}

/** 一条派生连线（from → to，方向即读图方向） */
export interface CanvasEdge {
  from: string
  to: string
}

export interface CanvasView {
  cards: CardView[]
  edges: CanvasEdge[]
  heightOf: HeightOf
}
