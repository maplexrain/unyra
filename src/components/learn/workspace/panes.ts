/*
 * 这个文件负责：从 store + 页签**纯函数地**算出一份文档该显示什么
 * （正文、节点、视图、标题、暂存、试卷副本）。
 *
 * 焦点格与其余每一格走的都是这里的同一套口径：组件里那一份（pane）与
 * 每一格渲染时那一份（renderGroup）都调它——写两遍必然有一处忘了改，
 * 而那种错在界面上是「左格切了源码、右格没跟着变」这类最难看出来的一种。
 */

import type {
  DocView,
  KnowledgeNode,
  LearnStore,
  LearnTab,
  SuperDocFile,
} from '../../../learn/types'
import { docOf, notesOf } from '../../../learn/types'
import { draftOf } from '../../../learn/drafts'
import { findNote } from '../../../learn/notes'
import { nodeById } from '../../../learn/graph'
import { isPreviewable, tabNodeId, tabTitle, viewOf } from '../../../learn/tabs'
import { groupOf, type DocGroup, type DocWorkspace } from '../../../learn/groups'
import { readSuperDoc } from '../../../learn/superdocs'
import type { Exam, ExamAttempt } from '../../../learn/exam'
import type { DocSource } from '../NodeNote'

/**
 * 一片页签对应的那一份正文（暂存区里有未保存的改动就用改动后的那一版）。
 *
 * 与下面 docSource 的判据是同一套口径，抽出来是为了让**常驻的那几片**也能按各自的页签算，
 * 而不是只有当前页签算得出来。本地文件 / 超级文档 / 试卷副本的正文不由节点决定，
 * 调用方各自挡在前面（见 docSource 与 paneOf）。
 */
export function sourceOf(store: LearnStore, tab: LearnTab, node: KnowledgeNode): DocSource | null {
  const staged = draftOf(store.drafts, tab.id)
  if (tab.ref.kind === 'note') {
    const note = findNote(notesOf(node), tab.ref.note)
    if (!note) return null
    return { kind: 'note', note: note.name, content: staged ?? note.content }
  }
  return { kind: 'teaching', content: staged ?? docOf(node, 'teaching') }
}

/**
 * 这份页签指向的正文是不是**空的笔记**。
 *
 * 只看笔记：教学文档空了多半是导师正要往那儿写，那时预览里的「待写」提示比一片空白源码有用。
 * 暂存区里那一份也算数（改了一半又删空的笔记，不该按「从来没写过」处理）。
 * 它决定两件事，见 tabs 的 viewOf 与 DocFloat 的 previewable：默认落到编辑视图、预览按钮置灰。
 */
export function emptyNote(store: LearnStore, tab: LearnTab | null): boolean {
  if (!tab || tab.ref.kind !== 'note') return false
  const node = nodeById(store, tab.ref.nodeId)
  if (!node) return false
  return !(sourceOf(store, tab, node)?.content ?? '').trim()
}

/** 一格里那份文档的派生值（见 paneInfo） */
export interface DocPaneInfo {
  /** 这一格；格 id 指向一个已经不存在的组时为 undefined */
  group: DocGroup | undefined
  /** 这一格当前显示的页签；空格子为 null */
  tab: LearnTab | null
  node: KnowledgeNode | null
  source: DocSource | null
  superDoc: SuperDocFile | null
  view: DocView
  draft: string | undefined
  title: string
  previewable: boolean
  /** 这一格是一份还没写过的笔记（空的预览没有意义，见 emptyNote） */
  emptyNote: boolean
}

/**
 * 把一格里「当前页签派生出的一切」算出来（正文、节点、视图、标题、暂存…）。
 *
 * 全是纯函数，输入只有 store 与格 id：焦点格与其余几格因此走的是**同一套口径**。
 * 组件里那一份（pane）与每一格渲染时那一份（renderGroup）都调它——写两遍必然有一处忘了改，
 * 而那种错在界面上是「左格切了源码、右格没跟着变」这类最难看出来的一种。
 */
export function paneInfo(
  store: LearnStore,
  docs: DocWorkspace,
  groupId: string,
  examTitle: (examId: string, attemptId: string) => string | undefined,
): DocPaneInfo {
  const group = groupOf(docs, groupId)
  const tab = group ? (group.tabs.find((t) => t.id === group.active) ?? null) : null
  const nodeId = tab ? tabNodeId(tab.ref) : null
  const node = nodeId ? (nodeById(store, nodeId) ?? null) : null
  // 本地文件、超级文档、试卷副本、大纲页都不走这一条：它们的正文不由节点决定
  //（DocSource 的 kind 是 Markdown 世界的类型，混进来会被当成笔记渲染；
  // 大纲页是结构化数据的交互页，渲染层单独接，见 renderGroup 的 outline 分支）
  const source =
    tab &&
    node &&
    tab.ref.kind !== 'local' &&
    tab.ref.kind !== 'super' &&
    tab.ref.kind !== 'exam' &&
    tab.ref.kind !== 'outline' &&
    tab.ref.kind !== 'web'
      ? sourceOf(store, tab, node)
      : null
  const empty = emptyNote(store, tab)
  return {
    group,
    tab,
    node,
    source,
    superDoc: tab && tab.ref.kind === 'super' ? readSuperDoc(store, tab.ref.nodeId, tab.ref.name) : null,
    view: tab ? viewOf(tab, empty) : 'preview',
    draft: draftOf(store.drafts, tab?.id ?? null),
    title: tab ? tabTitle(tab.ref, (id) => nodeById(store, id)?.title, examTitle) : '',
    // 空笔记也能预览（它就是一片空白）：与「这份文件不能预览」是两回事，按钮的说明不一样
    previewable:
      !!tab && tab.ref.kind !== 'web' && !empty && (tab.ref.kind !== 'local' || isPreviewable(tab.ref.path)),
    emptyNote: empty,
  }
}

/**
 * 试卷副本页签指向的那一份：卷子 + 那一次考试（见 ExamCopyView）。
 * 卷子被删了就是一对 null——页签留着，正文里说一句它已经不在了。
 */
export function examCopyOf(
  store: LearnStore,
  tab: LearnTab | null,
): { exam: Exam | null; attempt: ExamAttempt | null } {
  if (!tab || tab.ref.kind !== 'exam') return { exam: null, attempt: null }
  const { examId, attemptId } = tab.ref
  const exam = store.exams.find((e) => e.id === examId) ?? null
  return { exam, attempt: exam?.attempts.find((a) => a.id === attemptId) ?? null }
}

/** 一片页签要渲染的节点与正文；不是 markdown 正文（教/笔记）就没有可常驻的东西 */
export function paneOf(store: LearnStore, tab: LearnTab): { node: KnowledgeNode; source: DocSource } | null {
  if (tab.ref.kind !== 'teach' && tab.ref.kind !== 'note') return null
  const node = nodeById(store, tab.ref.nodeId)
  if (!node) return null
  const source = sourceOf(store, tab, node)
  return source ? { node, source } : null
}

/** 同一目标下已存在的节点 key：正文里的学习链接据此分「已创建 / 未创建」 */
export function conceptKeysOf(store: LearnStore, node: KnowledgeNode): Set<string> {
  return new Set(store.nodes.filter((n) => n.goalId === node.goalId).map((n) => n.key))
}
