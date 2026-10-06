/*
 * 这个文件负责：拼接**给用户看的字符串**——
 * 删除试卷前那张「会连带删掉什么」的清单，以及一份文档「已经保存」的正文。
 *
 * 两者的共同点是「读数据算出一段文字」，不碰 DOM、不碰 React，
 * 因此能单独被测试，也能被弹窗与保存流程各自调用。
 */

import type { Exam } from '../../../learn/exam'
import { examMetaLine } from '../../../learn/exam'
import type { LearnStore, TabRef } from '../../../learn/types'
import { docOf, notesOf } from '../../../learn/types'
import { findNote } from '../../../learn/notes'
import { nodeById } from '../../../learn/graph'
import { readSuperDoc } from '../../../learn/superdocs'
import { t } from '../../../i18n'

/**
 * 删除一份**考过**的试卷之前，把会连带删掉的东西逐条列出来（第一档确认的正文）。
 *
 * 为什么要写全：试过一次的记录不是一个数字，而是作答、输入顺序、单题耗时、切屏明细、
 * 判分与导师写的错题讲解——用户点「删除」时心里该有个数。数出来的东西跟着数据走，
 * 不写死（「3 份错题讲解」是算出来的，不是一句套话）。
 */
export function examDeleteWarn(exam: Exam): string {
  const attempts = exam.attempts.length
  const graded = exam.attempts.filter((a) => a.status === 'graded').length
  const explained = exam.attempts.filter((a) => a.explanation).length
  const abandoned = exam.attempts.filter((a) => a.status === 'abandoned').length
  return [
    t('《{0}》考过 {1} 次，删除会一并移除：', exam.title, attempts),
    t('· 这 {0} 次考试的作答、输入顺序、单题耗时与切屏记录', attempts),
    graded ? t('· {0} 份判分结果与导师写的错题讲解（{1} 份）', graded, explained) : '',
    abandoned ? t('· {0} 次放弃考试的记录', abandoned) : '',
    t('· 试卷本身（{0} 题，{1}）', exam.questions.length, examMetaLine(exam)),
    '',
    t('这些都无法恢复。点「我了解」之后还会再问你一次。'),
  ]
    .filter((line) => line !== '')
    .join('\n')
}

/**
 * 一份文档**已经保存**的正文（节点文档 / 笔记），用来判断暂存区里那一份是不是真的改了。
 *
 * 本地文件不在 store 里（内容不进数据目录），返回空串——那条路的比较基准是刚从磁盘
 * 读回来的内容，由 LocalDoc 自己拿着（见它的 edit）。
 */
export function savedTextOf(store: LearnStore, ref: TabRef): string {
  // 网页页签没有暂存正文（没有编辑器），与本地文件同路；
  // 守卫上下文与专注报告同样没有编辑器，自然也没有暂存
  if (ref.kind === 'local' || ref.kind === 'web' || ref.kind === 'guard' || ref.kind === 'report') return ''
  const node = nodeById(store, ref.nodeId)
  if (!node) return ''
  if (ref.kind === 'note') return findNote(notesOf(node), ref.note)?.content ?? ''
  if (ref.kind === 'super') return readSuperDoc(store, ref.nodeId, ref.name)?.html ?? ''
  return docOf(node, 'teaching')
}
