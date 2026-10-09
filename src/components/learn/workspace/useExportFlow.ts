/*
 * 这个文件负责：把一份文档交出应用外的全部机制——导出弹窗的开关、
 * 弹窗与导出件共用的那行元信息（exportMeta）、以及 md / html / pdf 三条导出路。
 *
 * 入口有三条（Ctrl+E、焦点格悬浮组、资源管理器右键菜单的「导出」），
 * 它们最后都汇到 openExport / runExport 这一份上——三条路各写一套，
 * 迟早有一条忘了带暂存区的最新正文。抓函数图像的时机也在这里定死：
 * 打开弹窗那一刻（见 openExport），而不是点「导出」时。
 */

import { useCallback, useMemo, useState } from 'react'
import type { KnowledgeNode, LearnStore, LearnTab, SuperDocFile, TabRef } from '../../../learn/types'
import { draftOf } from '../../../learn/drafts'
import { groupOf, setFocus } from '../../../learn/groups'
import { viewOf } from '../../../learn/tabs'
import { nodePathOf } from '../../../learn/paths'
import { fileNameOf, findResource, isImageExt, loadResourceImage } from '../../../learn/static'
import { native } from '../../../lib/native'
import { exportBody, exportFileName, plotSnapshots, standaloneHtml } from '../../../lib/exportDoc'
import { renderEmbeddedMarkdown } from '../../../lib/superdocHtml'
import { docBodyOf } from '../../../lib/docDom'
import { emptyNote } from './panes'
import type { ExportOptions, ExportResult } from '../ExportDialog'
import type { DocSource } from '../NodeNote'
import { t } from '../../../i18n'

/** 宿主交给导出流的能力与现成的派生值（都是「焦点格那份文档」的东西） */
export interface ExportFlowDeps {
  getLatest: () => LearnStore
  set: (s: LearnStore) => void
  onToast: (msg: string) => void
  /** 焦点格当前显示的页签（导出的对象就是它） */
  activeTab: LearnTab | null
  docNode: KnowledgeNode | null
  docSource: DocSource | null
  docTitle: string
  /** 超级文档页签指向的那一份（含未保存暂存），见 paneInfo */
  superDoc: SuperDocFile | null
  store: LearnStore
  openTab: (ref: TabRef) => void
}

/**
 * 导出文档的流程与状态。
 * 返回的 exportOpen / setExportOpen / exportPlots / exportMeta 供弹窗 JSX 使用，
 * openExport / exportTab / runExport 是三个入口。
 */
export function useExportFlow(deps: ExportFlowDeps) {
  const { getLatest, set, onToast, activeTab, docNode, docSource, docTitle, superDoc, store, openTab } = deps

  /** 导出文档：弹窗开关（Ctrl+E 与页签栏右侧那颗按钮都走它） */
  const [exportOpen, setExportOpen] = useState(false)
  /** 打开弹窗那一刻从预览里抓下来的函数图像（见 lib/exportDoc 的 plotSnapshots） */
  const [exportPlots, setExportPlots] = useState<string[]>([])

  /** 导出弹窗与导出件页头共用的一行元信息：这份文档是什么、在哪、多长 */
  const exportMeta = useMemo(() => {
    const lines: string[] = []
    if (activeTab?.ref.kind === 'local') lines.push(activeTab.ref.path)
    else if (docNode) lines.push(nodePathOf(store, docNode.goalId, docNode.id))
    if (activeTab?.ref.kind === 'super') {
      lines.push(t('超级文档「{0}」', activeTab.ref.name))
      if (superDoc?.html.length) lines.push(t('{0} 字符', superDoc.html.length))
    } else if (docSource) {
      lines.push(docSource.kind === 'note' ? t('笔记「{0}」', docSource.note ?? '') : t('教学文档'))
      const chars = (docSource?.content ?? '').replace(/\s/g, '').length
      if (chars) lines.push(t('{0} 字', chars))
    }
    return lines.filter(Boolean)
  }, [activeTab, docNode, docSource, store, superDoc])

  /**
   * 打开导出弹窗。
   *
   * 函数图像在**这一刻**就从预览 DOM 里抓下来，而不是等用户点了「导出」再抓：
   * 一是「有没有图」决定弹窗里要不要提那句话，而渲染期不该读 DOM；
   * 二是抓到的是副本，之后用户在弹窗里怎么点都不会影响它。
   */
  const openExport = useCallback(
    (groupId: string) => {
      const s = getLatest()
      const g = groupOf(s.docArea, groupId)
      const tab = g ? (g.tabs.find((t) => t.id === g.active) ?? null) : null
      if (!tab) {
        onToast(t('没有打开的文档'))
        return
      }
      // 系统页没有可以导出的正文：说一句比弹一个空壳导出框强
      if (
        tab.ref.kind === 'settings' ||
        tab.ref.kind === 'usage' ||
        tab.ref.kind === 'mind' ||
        tab.ref.kind === 'agentSettings'
      ) {
        onToast(t('这一页没有可以导出的内容'))
        return
      }
      // 只抓**这一格**显示着的那一片：常驻的隐藏页签里也有图，混进来张数就跟正文对不上了
      const previewing = viewOf(tab, emptyNote(s, tab)) === 'preview'
      setExportPlots(previewing ? plotSnapshots(docBodyOf(groupId)) : [])
      /*
       * 焦点挪到这一格。弹窗里「导出的是哪一篇」跟着焦点格算（见 exportMeta / runExport），
       * 不挪的话在右格点导出、导出的却是左格那篇——而弹窗上的标题还是对的，最难发现的那类错。
       * 挪焦点还顺带让 Ctrl+E、Ctrl+S 之后都落在用户刚点过的那一格上。
       */
      if (s.docArea.focus !== groupId) set({ ...s, docArea: setFocus(s.docArea, groupId) })
      setExportOpen(true)
    },
    [getLatest, onToast, set],
  )

  /**
   * 导出**指定的一份文档**（资源管理器右键菜单里的「导出」）。
   *
   * 导出的对象是「焦点格显示的那一份」（弹窗与导出件都按它算，见 exportMeta / runExport），
   * 所以先把这一份开出来并激活，再打开弹窗——右键菜单天生是在说「那一份」，
   * 而它此刻可能根本没开着。openTab 只改 store（不动磁盘），是安全的。
   */
  const exportTab = useCallback(
    (ref: TabRef) => {
      openTab(ref)
      openExport(getLatest().docArea.focus)
    },
    [openTab, openExport, getLatest],
  )

  /**
   * 导出当前这份文档（Ctrl+E）。
   *
   * 三种格式的差别只在最后一步：
   * - md：源文原样交出去，一个字都不加工；
   * - html / pdf：先渲染成一份自带样式的整页 HTML（见 lib/exportDoc），再交给主进程落盘，
   *   PDF 的排版在主进程的隐藏窗口里做（见 electron/main.ts 的 file:exportPdf）。
   *
   * 源文在这里**现取**：节点文档读 store 里的那一份（含还没落盘的改动——用户刚在源码
   * 视图里改完就来导出，拿到的该是新版），本地文件页签读磁盘上的那个文件。
   */
  const runExport = useCallback(
    async (opts: ExportOptions): Promise<ExportResult> => {
      const tab = activeTab
      if (!tab) return { ok: false, error: t('没有打开的文档') }
      /*
       * 超级文档本身就是一份完整的 HTML（脚本只在沙箱 iframe 里生效，导出件里不会跑），
       * 原样存成 .html 就是最有意义的导出；md / pdf 那两条加工路对它没有意义。
       */
      if (tab.ref.kind === 'super') {
        if (opts.format !== 'html') {
          return { ok: false, error: t('超级文档只支持导出为 HTML（它本身就是一份完整网页）') }
        }
        const html = superDoc?.html ?? ''
        if (!html.trim()) return { ok: false, error: t('这份超级文档还是空的，没有可导出的内容') }
        const saved = await native().saveText({
          suggestedName: exportFileName(docTitle || t('超级文档'), 'html'),
          // 导出件里也渲染内置 markdown 元素（见 lib/superdocHtml）：收到的该是能直接打开看的成品
          content: renderEmbeddedMarkdown(html),
          title: t('导出超级文档（HTML）'),
          filters: [{ name: t('HTML 网页'), extensions: ['html', 'htm'] }],
        })
        if (saved.ok) return { ok: true, path: saved.path }
        return saved.canceled ? { ok: false, canceled: true } : { ok: false, error: saved.error }
      }
      let source = ''
      if (tab.ref.kind === 'local') {
        // 暂存区里有没保存的改动就导出它：导出的该是眼前这一版，而不是磁盘上的旧版
        const staged = draftOf(store.drafts, tab.id)
        if (staged !== undefined) {
          source = staged
        } else {
          const read = await native().local.read(tab.ref.path)
          if (!read.ok) return { ok: false, error: read.error }
          source = read.content
        }
      } else {
        // 节点文档那条路，docSource 已经把暂存区叠上去了（见它的说明）
        source = docSource?.content ?? ''
      }
      if (!source.trim()) return { ok: false, error: t('这份文档还是空的，没有可导出的内容') }

      const title = docTitle || t('未命名文档')
      const fileName = exportFileName(title, opts.format)

      if (opts.format === 'md') {
        const saved = await native().saveText({
          suggestedName: fileName,
          content: source,
          title: t('导出 Markdown 源文件'),
          filters: [
            { name: 'Markdown', extensions: ['md', 'markdown'] },
            { name: t('文本文件'), extensions: ['txt'] },
          ],
        })
        if (saved.ok) return { ok: true, path: saved.path }
        return saved.canceled ? { ok: false, canceled: true } : { ok: false, error: saved.error }
      }

      // 资源只在节点文档里有出处（本地文件不属于任何目标，它里面的 moji:static 也无从查起）
      const goalId = tab.ref.kind === 'local' ? null : (docNode?.goalId ?? null)
      const exported = await exportBody({
        source,
        annotations: opts.annotations ? docNode?.annotations : undefined,
        embedImages: opts.embedImages,
        plots: exportPlots,
        resolveAsset: async (uuid) => {
          if (!goalId) return null
          const res = findResource(store, goalId, uuid)
          if (!res) return null
          // 只有图片才有「内嵌」这回事：其余资源在导出件里只留名字
          const url = isImageExt(res.ext)
            ? ((await loadResourceImage(store, goalId, res))?.url ?? null)
            : null
          return { name: fileNameOf(res), url }
        },
      })
      const html = standaloneHtml({
        title,
        meta: exportMeta,
        body: exported.html,
        // 正文里的 Tailwind 工具类现算一份带进文件（见 lib/docTailwind）：
        // 预览那份是注入页面的，导出件里没有它，文档会整篇掉样式
        docCss: exported.css,
        theme: opts.theme,
        stamp: new Date().toLocaleString('zh-CN', { hour12: false }),
      })

      if (opts.format === 'html') {
        const saved = await native().saveText({
          suggestedName: fileName,
          content: html,
          title: t('导出 HTML 网页'),
          filters: [{ name: t('HTML 网页'), extensions: ['html', 'htm'] }],
        })
        if (saved.ok) return { ok: true, path: saved.path }
        return saved.canceled ? { ok: false, canceled: true } : { ok: false, error: saved.error }
      }

      const pdf = await native().exportPdf({
        suggestedName: fileName,
        html,
        pageSize: opts.pageSize,
        landscape: opts.landscape,
        pageNumbers: opts.pageNumbers,
      })
      if (pdf.ok) return { ok: true, path: pdf.path }
      return pdf.canceled ? { ok: false, canceled: true } : { ok: false, error: pdf.error }
    },
    [activeTab, docNode, docSource, docTitle, exportMeta, exportPlots, store, superDoc],
  )

  return {
    exportOpen,
    setExportOpen,
    exportPlots,
    exportMeta,
    openExport,
    exportTab,
    runExport,
  }
}
