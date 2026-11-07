/**
 * 这个文件负责什么：沙箱类型契约的**ask（结构化表单）**组——题目、载荷与回答的形状
 * （normalizeAskForm 归一化之后）。
 * 原先与其它组同写在 src/agent/sandbox/types.ts，按 API 能力组拆到这里；形状逐字未动，
 * 对外一律经门面 src/agent/sandbox/types.ts 原样转出，调用方 import 路径不变。
 */
import type { ProfileField } from '../../../user/fields'

/* ---------- ask：结构化表单 ---------- */

/** 一道题的选项：模型可以直接给字符串（自动配 id），也可以给 { id, label } */
export interface AskOption {
  id: string
  label: string
}

export type AskQuestionType = 'single' | 'multiple' | 'short' | 'slider' | 'dual_slider' | 'upload'

export interface AskFileAttachment {
  name: string
  size: number
  type: string
  path?: string
  dataUrl?: string
}

/** 表单里的一道题（normalizeAskForm 归一化之后的形状） */
export interface AskQuestion {
  /** 题目 id；模型没给时按 q1、q2… 自动配 */
  id: string
  /** single 单选 / multiple 多选 / short 简答 / slider 单滑块 / dual_slider 双滑块 / upload 附件上传 */
  type: AskQuestionType
  prompt: string
  /** single / multiple 必给（2~8 项）；其余类型恒为空数组 */
  options: AskOption[]
  /**
   * 条件显示：只有当前面某道题的答案命中 oneOf 之一时，这道题才出现——
   * 「前面选了什么，会影响后面问什么」就靠它。oneOf 与选项 id、选项文字
   * 以及「其他」补充输入的原文做精确匹配。
   */
  when?: { id: string; oneOf: string[] } | null
  /**
   * 这道题的答案要写进画像的哪个字段（见 user/fields 的 ProfileField，如 'education'）。
   *
   * 标了它，用户**提交的那一刻**回答就直接落进画像（user/fields 的 patchFromAnswers），
   * 导师不必再 update 一次——「画像缺什么就问什么」的省事写法，也是画像唯一的
   * 结构化补全通道。没标就是普通问题，只是聊聊天。
   */
  userInfo?: ProfileField
  /**
   * **没有必答题**（曾经的 required 字段已移除）：用户懒得答的题就该留空——
   * 留空在返回的 answers 里只有 id/type/prompt，不是错误，模型不要追问。
   */

  // --- 滑块组件 (slider / dual_slider) ---
  /** 滑块最小值，默认 0 */
  min?: number
  /** 滑块最大值，默认 100 */
  max?: number
  /** 滑块步长，默认 1 */
  step?: number
  /** 单位或后缀（如 '%', 'px', '分', '岁'） */
  unit?: string
  /** 默认值：单滑块为 number，双滑块为 [number, number] */
  defaultValue?: number | [number, number]

  // --- 上传组件 (upload) ---
  /** 允许接受的文件类型过滤（如 'image/*', '.pdf,.docx,.txt'） */
  accept?: string
  /** 是否允许多选文件，默认 false */
  multipleFiles?: boolean
  /** 最大文件限制（MB），默认 32MB */
  maxSizeMb?: number
}

/** 一次 ask 的载荷：questions 已由 normalizeAskForm 归一化并校验过 */
export interface AskFormPayload {
  title: string
  questions: AskQuestion[]
}

/** 用户对一道题的回答 */
export interface AskAnswer {
  id: string
  type: AskQuestionType
  prompt: string
  /** single / multiple：选中项的文字 */
  picked?: string[]
  /** single / multiple：选中项的 id */
  pickedIds?: string[]
  /** 选了「其他」时用户输入的补充 */
  other?: string
  /** short：用户输入的正文 */
  text?: string
  /** slider：单滑块数值 */
  value?: number
  /** dual_slider：双滑块范围 [low, high] */
  rangeValue?: [number, number]
  /** upload：用户上传的文件附件列表 */
  files?: AskFileAttachment[]
}

/** 表单提交后的回答集（ask 的返回值里 answers 的形状） */
export type AskAnswers = AskAnswer[]

