import { memo, useEffect, useRef } from 'react'
import type { DocView, LearnStore, LearnTab, TabRef } from '../../../learn/types'
import { newDraftKey } from '../../../learn/tabs'
import { draftOf } from '../../../learn/drafts'
import { readSuperDoc } from '../../../learn/superdocs'
import { nodeRevealKey } from '../../../lib/docReveal'
import SourceEditor from '../SourceEditor'
import LiveSplitPreview from '../editor/LiveSplitPreview'
import { toggleEditorPreview } from '../editor/previewBus'
import { paneOf } from './panes'
import { SRC_SCROLL_SUFFIX } from './constants'
import { t } from '../../../i18n'

/**
 * 教学文档 / 笔记 / 超级文档的**编辑态常驻层**（keepalive）：
 *
 * 页签合并之后（同一份文档只有一枚页签，阅读与编辑是页面里的两种模式），编辑器也照
 * FileTabLayer / DocPane 的规矩常驻：只要页签在这一格开着，LiveSplitPreview + SourceEditor
 * 就挂在 DOM 里，切模式、切页签都只翻 hidden——CodeMirror 实例、光标、撤销栈、分栏的
 * 开合与比例全部原样保留，不存在「切回来重建一遍」。
 *
 * 阅读态的常驻在 DocPane（见 panes.ts 的 residentPanes）；两层合起来才是完整的一页。
 */

export interface EditorTabLayerProps {
  groupId: string
  /** 这一格里教学文档 / 笔记 / 超级文档的页签（编辑器只认这三种，见 paneOf 与 super 分支） */
  tabs: LearnTab[]
  /** 当前格处于编辑态的那枚页签 id（activeTab 的 view 是 source 才有值）；null = 没有编辑态 */
  activeSourceTabId: string | null
  store: LearnStore
  editorScale: number
  docSaving: boolean
  editDocSource: (tabId: string, text: string) => void
  closeTab: (
    groupId: string,
    tabId: string,
    target: 'self' | 'others' | 'right' | 'all',
    opts?: { confirm?: boolean; skipDirty?: boolean },
  ) => void
  openTab: (ref: TabRef, preferredView?: DocView) => void
  rememberScroll: (key: string, top: number) => void
}

export function EditorTabLayer({
  groupId,
  tabs,
  activeSourceTabId,
  store,
  editorScale,
  docSaving,
  editDocSource,
  closeTab,
  openTab,
  rememberScroll,
}: EditorTabLayerProps) {
  return (
    <>
      {tabs.map((tab) => {
        /** 教学文档与笔记的正文（暂存区里那份优先）；超级文档单独取 */
        const pane = tab.ref.kind === 'teach' || tab.ref.kind === 'note' ? paneOf(store, tab) : null
        const superDoc = tab.ref.kind === 'super' ? readSuperDoc(store, tab.ref.nodeId, tab.ref.name) : null
        if (!pane && !superDoc) {
          if (tab.id !== activeSourceTabId) return null
          return (
            <div key={tab.id} className="flex min-h-0 flex-1 items-center justify-center text-[12.5px] text-ink-faint">
              {t('这份文档已经不在了')}
            </div>
          )
        }
        const isSuper = !!superDoc
        const draft = draftOf(store.drafts, tab.id)
        const value = superDoc ? (draft ?? superDoc.html) : (pane!.source.content ?? '')
        const ext = isSuper ? '.html' : '.md'
        const label =
          tab.ref.kind === 'super'
            ? tab.ref.name
            : tab.ref.kind === 'note'
              ? tab.ref.note
              : pane!.node.title
        const revealKey = pane ? nodeRevealKey(pane.node.id, pane.source.kind, pane.source.note) : undefined
        return (
          <EditorPane
            key={tab.id}
            tabId={tab.id}
            active={tab.id === activeSourceTabId}
            // 教学文档的口径：切进编辑模式时自动展开分栏预览（笔记 / md / html 的默认展开
            // 由 LiveSplitPreview 的默认态负责，用户关掉后尊重他的选择，不在这里强开）
            autoOpenPreview={tab.ref.kind === 'teach'}
            value={value}
            ext={ext}
            storageKey={(isSuper ? 'super:' : 'note:') + tab.id}
            state={docSaving ? 'saving' : draft === undefined ? 'saved' : 'dirty'}
            label={label}
            historyKey={tab.id}
            scale={editorScale}
            revealKey={revealKey}
            scrollTop={store.docScroll[tab.id + SRC_SCROLL_SUFFIX]}
            onScrollTop={(top) => rememberScroll(tab.id + SRC_SCROLL_SUFFIX, top)}
            onChange={(text) => editDocSource(tab.id, text)}
            onCloseTab={(force) => closeTab(groupId, tab.id, 'self', { confirm: !force })}
            onCloseOtherTabs={(force, opts) =>
              closeTab(groupId, tab.id, 'others', { confirm: !force, skipDirty: opts?.skipDirty })
            }
            onNewTab={() => openTab({ kind: 'draft', key: newDraftKey() })}
          />
        )
      })}
    </>
  )
}

export interface EditorPaneProps {
  tabId: string
  /** 编辑态在眼前吗（= 这枚页签是当前页签且 view 是 source）。不等于「当前页签」 */
  active: boolean
  /** 教学文档切进编辑模式时自动展开分栏预览（见 tabs 的 viewOf 口径） */
  autoOpenPreview?: boolean
  value: string
  ext: string
  storageKey: string
  state: 'saving' | 'saved' | 'dirty'
  label: string
  historyKey: string
  scale: number
  revealKey?: string
  scrollTop?: number
  onScrollTop: (top: number) => void
  onChange: (text: string) => void
  onCloseTab: (force?: boolean) => void
  onCloseOtherTabs: (force?: boolean, opts?: { skipDirty?: boolean }) => void
  onNewTab: () => void
}

/**
 * 隐藏的编辑器要不要跟着 store 重渲染——与 DocPane 的 samePane 同一条纪律：
 * 在眼前的那份永远重渲染；藏着的只在「换了一片」或「正文真的被改了」时才动，
 * 否则学习区每次 store 变化都要把 N 份 CodeMirror 一起重渲染一遍。
 */
function sameEditor(prev: EditorPaneProps, next: EditorPaneProps): boolean {
  if (prev.active !== next.active || prev.tabId !== next.tabId) return false
  if (next.active) return false
  return prev.value === next.value && prev.state === next.state && prev.revealKey === next.revealKey
}

const EditorPane = memo(function EditorPane({
  active,
  autoOpenPreview,
  value,
  ext,
  storageKey,
  state,
  label,
  historyKey,
  scale,
  revealKey,
  scrollTop,
  onScrollTop,
  onChange,
  onCloseTab,
  onCloseOtherTabs,
  onNewTab,
}: EditorPaneProps) {
  /**
   * 教学文档的口径（tabs 的 viewOf）：切进编辑模式时自动展开分栏预览。
   * 只在「从别的模式/页签切进来」那一拍发（active 翻假→真）；重启恢复时编辑态本来就在，
   * 不算「切换」，分栏开合尊重上次存下的选择。点名广播：只展开这一份的分栏，
   * 别把其它页签上用户收好的分栏状态也一起翻掉。
   */
  const wasActiveRef = useRef(active)
  useEffect(() => {
    if (autoOpenPreview && active && !wasActiveRef.current) {
      toggleEditorPreview(true, storageKey)
    }
    wasActiveRef.current = active
  }, [active, autoOpenPreview, storageKey])

  return (
    /*
      隐藏用 hidden 属性（display:none）：编辑器整体移出排版树，不参与样式重算与绘制，
      与 DocPane / FileTabLayer 的保活手法一致。
    */
    <div
      data-editor-pane={active ? 'active' : 'idle'}
      className={active ? 'relative flex min-h-0 flex-1 flex-col' : 'hidden'}
      {...(!active ? { hidden: true } : {})}
    >
      <LiveSplitPreview value={value} ext={ext} storageKey={storageKey}>
        <SourceEditor
          value={value}
          onChange={onChange}
          state={state}
          label={label}
          historyKey={historyKey}
          scale={scale}
          ext={ext}
          // 「定位源码」放下的一次性请求：挂载时按这个身份取走并选中（见 lib/docReveal）
          revealKey={revealKey}
          scrollTop={scrollTop}
          onScrollTop={onScrollTop}
          onCloseTab={onCloseTab}
          onCloseOtherTabs={onCloseOtherTabs}
          onNewTab={onNewTab}
          onSplitView={() => toggleEditorPreview(true, storageKey)}
        />
      </LiveSplitPreview>
    </div>
  )
}, sameEditor)
