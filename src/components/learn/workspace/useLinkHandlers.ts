/*
 * 这个文件负责：文档正文里三种「moji:」链接的点击跳转——
 * moji:node（节点链接）、moji:doc（教学文档 / 笔记链接）、moji:super（超级文档链接）。
 *
 * 渲染层不认识 store 与页签，链接被点时只把解析结果交回来；这一层把结果
 * 落成「开哪个页签、滚到哪里、找不到时说什么」。三个处理器都是 effect 注册、
 * 卸载时注销的（见 lib/nodeLink 的模块级单槽），宿主传进来的回调变了就重挂。
 */

import { useEffect } from 'react'
import type { LearnStore, TabRef } from '../../../learn/types'
import { docOf, notesOf } from '../../../learn/types'
import { nodeById } from '../../../learn/graph'
import { readSuperDoc } from '../../../learn/superdocs'
import { focusedTab } from '../../../learn/groups'
import { needleForDoc, locateNeedle } from '../../../lib/docDom'
import { setNodeLinkHandler, setDocLinkHandler, setSuperLinkHandler, setMarkdownPathHandler } from '../../../lib/nodeLink'
import { resolveLocalPath } from '../../../lib/localFiles'
import { t } from '../../../i18n'

/** 链接跳转需要的宿主能力（openTab 是文档区「现在看什么」的唯一入口） */
export interface LinkHandlersDeps {
  getLatest: () => LearnStore
  openTab: (ref: TabRef) => void
  /** moji:doc 指向笔记而一份都没有时，当场建一份再打开 */
  createNodeNote: (nodeId: string) => void
  onToast: (msg: string) => void
}

/** 注册三种文档链接的跳转。没有返回值：注册即生效，卸载随 effect 清理。 */
export function useLinkHandlers({ getLatest, openTab, createNodeNote, onToast }: LinkHandlersDeps) {
  // 注册节点链接（moji:node/id）的点击跳转：落在该节点的教学文档上
  useEffect(() => {
    setNodeLinkHandler((nodeId) => {
      if (!nodeById(getLatest(), nodeId)) {
        onToast(t('链接指向的节点已不存在'))
        return
      }
      openTab({ kind: 'teach', nodeId })
    })
    return () => setNodeLinkHandler(null)
  }, [getLatest, openTab, onToast])

  /**
   * 注册文档链接（moji:doc/…）的点击跳转。
   * 链接里没写 id 就是「当前节点的这份文档」，写了就跳到那个节点的这份文档。
   *
   * 链接只说得清「教学文档 / 笔记」这一级（见 lib/nodeLink）：一个节点有多份笔记时，
   * 指向笔记的链接打开**第一份**；一份都没有就当场建一份再打开——
   * 写这种链接的场合（「整理到我的笔记」）本来就意味着「接下来要往笔记里写东西」。
   */
  useEffect(() => {
    setDocLinkHandler(({ nodeId, kind, line, endLine, select }) => {
      const s = getLatest()
      const target = nodeId ?? s.activeNodeId
      const node = target ? nodeById(s, target) : undefined
      if (!target || !node) {
        onToast(t('链接指向的节点已不存在'))
        return
      }
      /*
       * 尾巴上的跳转说明（#L12 / #L12-L20 / @选中的文字，见 lib/nodeLink 的 parseDocHref）：
       * 「打开那份文档，并滚到那一行、选中那一段」。定位文字按**源文**算（行号说的是源文的行），
       * 开页签之后交给 locateNeedle——它自带重试，因为换页签到渲染完成有一拍。
       * 用 fallbackRatio 兜底：表格、代码块这类行拍平之后可能对不上文字，那时按位置滚过去。
       */
      const jumpTo = (content: string): void => {
        const jump = needleForDoc(content, { line, endLine, select })
        if (!jump.needle && jump.fallbackRatio === undefined) return
        void locateNeedle(jump.needle ?? '', jump.fallbackRatio)
      }
      if (kind === 'teaching') {
        openTab({ kind: 'teach', nodeId: target })
        jumpTo(docOf(node, 'teaching'))
        return
      }
      const first = notesOf(node)[0]
      if (first) {
        openTab({ kind: 'note', nodeId: target, note: first.name })
        jumpTo(first.content)
        return
      }
      // 一份笔记都没有：建一份再打开（跳转就免了，那是刚建出来的空文件）
      createNodeNote(target)
    })
    return () => setDocLinkHandler(null)
  }, [getLatest, openTab, createNodeNote, onToast])

  /**
   * 注册超级文档链接（moji:super/…）的点击跳转。
   *
   * 两个来源共用这一个处理器：教学文档 / 笔记渲染里的链接（MarkdownView 拦截），
   * 以及超级文档 iframe 里的链接（BRIDGE 拦截后经 onSuperLink 转回来）。
   * 链接里没写 nodeId 就是「当前这份超级文档所在的节点」——超级文档链接最常见的
   * 用法就是实验之间互相引用；指名不存在的文档给一句明确的话，不开空页签。
   */
  useEffect(() => {
    setSuperLinkHandler(({ nodeId, name }) => {
      const s = getLatest()
      const cur = focusedTab(s.docArea)?.ref
      const owner = nodeId ?? (cur?.kind === 'super' ? cur.nodeId : s.activeNodeId)
      if (!owner) {
        onToast(t('链接要落在某个知识点上，先打开一个节点'))
        return
      }
      if (!readSuperDoc(s, owner, name)) {
        onToast(t('没有叫「{0}」的超级文档', name))
        return
      }
      openTab({ kind: 'super', nodeId: owner, name })
    })
    return () => setSuperLinkHandler(null)
  }, [getLatest, openTab, onToast])

  /**
   * 注册相对路径的 markdown 文件链接（`[docs/README.md](docs/README.md)`）。
   *
   * 分两种来源：
   * - **外部文件**（当前页签是本地文件）：相对**它所在目录**解析路径，开一个本地文件
   *   页签——repo 的 README 互相引用就是这么写的；
   * - **内部文档**（节点教学文档 / 笔记）：没有「当前目录」可依，改按路径的文件名
   *   匹配同名笔记，匹配不到就明说——装作能开、开出来却是空的才是最糟的。
   */
  useEffect(() => {
    setMarkdownPathHandler((raw) => {
      const cur = focusedTab(getLatest().docArea)?.ref
      if (cur?.kind === 'local') {
        openTab({ kind: 'local', path: resolveLocalPath(cur.path, raw) })
        return
      }
      const name = raw.split(/[\\/]/).pop()?.trim() ?? ''
      const hit = getLatest().nodes.find((n) => notesOf(n).some((note) => note.name === name))
      if (hit) {
        openTab({ kind: 'note', nodeId: hit.id, note: name })
        return
      }
      onToast(t('没有找到「{0}」这份 Markdown 文件', name))
    })
    return () => setMarkdownPathHandler(null)
  }, [getLatest, openTab, onToast])
}
