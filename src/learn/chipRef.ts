/**
 * 这个文件负责：把一份 chip 引用（#[{…}] 的 payload）还原成能打开的**页签身份**（TabRef）。
 *
 * 导师在交付里写的 chip 只带模型自然知道的东西（路径、名字、考试 id），打开时得查一遍
 * 数据树——路径是 nodeDocPath 的产物，这里做的就是那次反查：先信 chip 带来的 nodeId
 * （宿主自己拖出来的都带，路径对得上就直接用），没有或对不上再遍历全部节点比对路径。
 * 试卷原件没有页签形态（它是「开考」的入口，不是一份文档），这里返回 null，
 * 由 opener 分流到考试窗口。
 */

import type { ChipPayload } from '../lib/chipSyntax'
import { nodeDocPath } from './files/build'
import { nodeById } from './graph/lookup'
import { notesOf, type LearnStore, type TabRef } from './types'
import { userAbsPath } from '../lib/storage'

/** 规整外来路径：反斜杠 → 斜杠、去掉开头的 ./（导师与文件管理器给的写法不统一） */
function normPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '')
}

export function tabRefFromChip(store: LearnStore, p: ChipPayload): TabRef | null {
  // 外部文件：路径就是身份
  if (p.type === 'local') return p.path ? { kind: 'local', path: p.path } : null
  // 工作区文件：rel 是「相对当前用户」的路径，换算成磁盘绝对路径开本地页签
  //（解析不解析看后缀，见 learn/tabs 的 viewOf）；目录没有页签形态——跳到所属节点
  if (p.type === 'ws') {
    if (p.dir) return p.nodeId ? { kind: 'teach', nodeId: p.nodeId } : null
    if (!p.path) return null
    const abs = userAbsPath(normPath(p.path))
    return abs ? { kind: 'local', path: abs } : null
  }
  // 考试：只有「某一次的副本」能开成页签；原件返回 null（opener 走考试窗口）
  if (p.type === 'exam') {
    const exam = p.examId ? store.exams.find((e) => e.id === p.examId) : undefined
    if (!exam || !p.attemptId) return null
    return { kind: 'exam', nodeId: exam.nodeId, examId: exam.id, attemptId: p.attemptId }
  }

  const want = p.path ? normPath(p.path) : null
  /** 这条路径是不是正指着它（chip 没给路径时只信 nodeId） */
  const matches = (rel: string | null): boolean => !!rel && (!want || normPath(rel) === want)

  // 先按带出来的 nodeId 对号：宿主拖出来的 chip 都带，一次查表就够
  const node = p.nodeId ? nodeById(store, p.nodeId) : undefined
  if (node) {
    const rel =
      p.type === 'note'
        ? nodeDocPath(store, node.id, { kind: 'note', note: p.note ?? '' })
        : p.type === 'outline'
          ? nodeDocPath(store, node.id, { kind: 'outline' })
          : nodeDocPath(store, node.id, { kind: 'teaching' })
    if (p.type === 'doc' && matches(rel)) return { kind: 'teach', nodeId: node.id }
    if (p.type === 'note' && p.note && matches(rel)) return { kind: 'note', nodeId: node.id, note: p.note }
    if (p.type === 'outline' && matches(rel)) return { kind: 'outline', nodeId: node.id }
    if (p.type === 'super' && p.name && matches(rel)) return { kind: 'super', nodeId: node.id, name: p.name }
  }

  // 反查：遍历全部节点，谁的哪份文档路径正好是它。节点量级几十个，点击时跑一次无所谓
  if (want) {
    for (const n of store.nodes) {
      const teachRel = nodeDocPath(store, n.id, { kind: 'teaching' })
      if (p.type === 'super' && p.name) {
        // 超级文档没有自己的文件（存在节点数据里）：按「节点教学文档路径 + 名字」认
        if (teachRel && normPath(teachRel) === want) return { kind: 'super', nodeId: n.id, name: p.name }
        continue
      }
      if (p.type === 'doc' && teachRel && normPath(teachRel) === want) return { kind: 'teach', nodeId: n.id }
      if (p.type === 'outline' && nodeDocPath(store, n.id, { kind: 'outline' }) === want) {
        return { kind: 'outline', nodeId: n.id }
      }
      for (const note of notesOf(n)) {
        if (nodeDocPath(store, n.id, { kind: 'note', note: note.name }) === want) {
          return { kind: 'note', nodeId: n.id, note: note.name }
        }
      }
    }
  }
  return null
}
