/*
 * 本文件负责：考试窗口的**作答复本**（Draft）——一份答案在考试窗口这一侧的形状
 * （选项 value / 文本 text / 整图 image / 原图 rawImage）、「这题答了没有」的判定
 * isBlank（进度条、答题卡、跳到下一题共用同一口径），以及「还没作答过」的空草稿常量。
 *
 * 门面（ExamWindow.tsx）与题卡（ExamQuestionCard.tsx）都要用它，单独成文件
 * 避免两边互相依赖。原样搬自 ExamWindow.tsx（注释一并带走）。
 */
import type { ExamQuestion } from '../../learn/exam'

export interface Draft {
  value: string[]
  text: string
  image?: string
  rawImage?: string
}

export const emptyDraft: Draft = { value: [], text: '', image: undefined, rawImage: undefined }

export function isBlank(q: ExamQuestion, draft: Draft | undefined): boolean {
  if (!draft) return true
  if (draft.image) return false
  if (q.type === 'fill' || q.type === 'short') return !draft.text.trim()
  return draft.value.length === 0
}
