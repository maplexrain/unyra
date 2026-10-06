/**
 * 专注报告的**落盘**：写一份、读一份、列全部。
 *
 * 报告不进 state.json（它是「历史凭证」而不是「界面状态」，而且一轮监控一行的量级
 * 塞进整份重写的 state.json 太重）：每份一个 JSON 文件，住在用户目录的 focus/ 里，
 * 与番茄钟账本、阅读记录同一套「用户目录下平铺文件」的待遇。
 *
 * 资源管理器里的「专注报告」分类夹靠 listFocusReports 列行；写完一份就广播
 * REPORTS_CHANGED，开着的那扇列表自己刷新（与工作区目录的 ws-changed 铃同一套路）。
 */

import { listDir, readText, userPath, writeJson } from '../lib/storage'
import { normalizeFocusReport, type FocusReport } from './focusGuard'

/** 用户目录下放报告的那一层（相对当前用户；userPath 会补 users/{uid} 前缀） */
export const FOCUS_DIR = 'focus'

/** 写完一份报告后广播的事件名（资源管理器的列表订阅它） */
export const REPORTS_CHANGED = 'moji-focus-reports-changed'

export function emitReportsChanged(): void {
  window.dispatchEvent(new CustomEvent(REPORTS_CHANGED))
}

/** 把一份报告写进用户目录；写完广播。失败只记日志——报告丢了不该打断收尾流程 */
export async function writeFocusReport(report: FocusReport): Promise<boolean> {
  const rel = userPath(`${FOCUS_DIR}/${report.id}.json`)
  if (!rel) return false
  const ok = await writeJson(rel, report)
  if (ok) emitReportsChanged()
  else console.warn('[focus] 报告写入失败：', report.id)
  return ok
}

/** 读一份报告；文件不在了 / 内容坏掉了都回 null（调用方当「报告不见了」处理） */
export async function readFocusReport(id: string): Promise<FocusReport | null> {
  if (!/^[0-9a-z]+$/i.test(id)) return null
  const rel = userPath(`${FOCUS_DIR}/${id}.json`)
  if (!rel) return null
  const text = await readText(rel)
  if (!text) return null
  try {
    return normalizeFocusReport(JSON.parse(text))
  } catch {
    return null
  }
}

/** 列表行用的元数据：报告全文都在文件里，侧栏只要这几个字段 */
export interface FocusReportMeta {
  id: string
  startedAt: number
  endedAt: number
  outcome: FocusReport['outcome']
  completedGroups: number
  monitors: { screen: boolean; camera: boolean }
}

/**
 * 列出全部报告（新 → 旧）。逐份读回再取元数据：报告都是几 KB 的小文件，
 * 且只有真正能解析的才值得出现在列表里——手改坏的文件安静地缺席，比挂一行「坏数据」好。
 */
export async function listFocusReports(): Promise<FocusReportMeta[]> {
  let names: string[] = []
  try {
    const entries = await listDir(FOCUS_DIR)
    names = entries.filter((e) => !e.dir && /\.json$/i.test(e.name)).map((e) => e.name)
  } catch {
    return []
  }
  const out: FocusReportMeta[] = []
  for (const name of names) {
    const id = name.replace(/\.json$/i, '')
    const report = await readFocusReport(id)
    if (!report) continue
    out.push({
      id: report.id,
      startedAt: report.startedAt,
      endedAt: report.endedAt,
      outcome: report.outcome,
      completedGroups: report.completedGroups,
      monitors: report.monitors,
    })
  }
  out.sort((a, b) => b.startedAt - a.startedAt)
  return out
}
