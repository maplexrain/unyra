/** 这个文件负责什么：meta.json 的形状（MetaFile）与落盘 JSON 的几个小工具——版本号、序列化、容错读取。 */

import type { TmpEntry } from '../types'

export const META_VERSION = 1
export const CHAT_VERSION = 1
export const TMP_VERSION = 1

export interface MetaFile {
  version: number
  id: string
  title: string
  key: string
  description: string
  status: string
  origin: string
  createdAt: number
  updatedAt: number
  annotations: unknown
  dependencies: Array<{ to: string; createdAt: number }>
  exams: unknown
  /**
   * 学习状态（自评 / 掌握度 / 错误记忆 / 检验记录）。
   * 没评估过的节点不写这一项：JSON.stringify 会把 undefined 直接略掉，
   * 于是「从没测过」与「测出来是空的」在文件里也是两回事。
   */
  learning?: unknown
  /**
   * 复习计划（见 learn/review）：节点状态首次变 mastered 时系统自动建。
   * 没有复习计划的节点不写这一项（理由同 learning）。
   */
  review?: unknown
  /**
   * 笔记清单：**只记名字与时间，正文不在里面**。
   *
   * 正文照旧一份一个 .md（`notes/{名字}.md`）——它才是用户会直接打开、改、拷走的东西；
   * 元数据里再存一份内容，就又是「同一个东西两处存放」的老问题。
   * 名字与时间放这里是为了**顺序稳定**：目录列表的顺序由文件系统决定（见 parseDocs 末尾），
   * 不记下来的话，每次启动笔记的排列都会变一次，用户会以为丢了几份。
   */
  notes?: Array<{ name: string; createdAt: number; updatedAt: number }>
  /**
   * 超级文档（可交互 HTML，见 SuperDocFile）**整份存在 meta 里**。
   *
   * 与笔记相反的取舍：笔记的正文是「用户会直接打开改的东西」，所以要落成 .md；
   * 超级文档是给渲染器消费的交互件（script 只在沙箱 iframe 里生效，文件管理器里
   * 打开毫无用处），单文件毫无收益、还多一层「meta 清单与文件本体分家」的风险，
   * 因此不落独立文件、不走 diff。没有超级文档时不写这一项。
   */
  superdocs?: unknown
  goal?: { id: string; question: string; createdAt: number; updatedAt: number }
}

export const jsonText = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`

/** 临时变量的落盘文本；没有条目返回空串（调用方据此跳过写文件） */
export const tmpText = (entries: Record<string, TmpEntry> | undefined): string =>
  entries && Object.keys(entries).length ? jsonText({ version: TMP_VERSION, entries }) : ''

export function parseJson<T>(text: string | undefined): T | null {
  if (!text) return null
  try {
    const data = JSON.parse(text) as T | null
    return data && typeof data === 'object' ? data : null
  } catch {
    return null
  }
}

/** 时间戳字段可能缺失（手改过的文件），排序时按 0 处理，别让 NaN 把顺序搅乱 */
export const at = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
