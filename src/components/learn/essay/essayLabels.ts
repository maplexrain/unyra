/**
 * 随笔窗口里的**显示口径**（搬自 EssayDock，纯搬运）：
 * 日期、时间与标题的取法只有这一份——随笔列表、提交历史与提交详情都从这里取。
 */
import { dayOfEssay } from '../../../learn/essays'
import type { EssayEntry } from '../../../learn/types'
import { t } from '../../../i18n'

/** 日期：月日，跨年才带年份。列表与下拉都不写钟点（用户定的：随笔按天归属） */
export function dateLabelOfEssay(ts: number): string {
  const day = dayOfEssay(ts)
  const [y, m, d] = day.split('-')
  const sameYear = String(new Date().getFullYear()) === y
  return sameYear
    ? t('{0} 月 {1} 日', String(Number(m)), String(Number(d)))
    : t('{0} 年 {1} 月 {2} 日', y, String(Number(m)), String(Number(d)))
}

/** 提交记录里的时间：日期 + 钟点（历史里知道「哪一天几点提交的」是有用的） */
export function timeLabel(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return dateLabelOfEssay(ts) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
}

/** 下拉里的那一行：标题（旧数据没标题时按日期回退——normalize 会补，这里只是保险） */
export function titleOf(essay: EssayEntry): string {
  return essay.title || dateLabelOfEssay(essay.createdAt)
}
