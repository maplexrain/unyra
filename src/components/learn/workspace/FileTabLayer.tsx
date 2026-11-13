import { memo } from 'react'
import type { LearnStore, LearnTab } from '../../../learn/types'
import { viewOf } from '../../../learn/tabs'
import { wsRelOfTab } from '../../../learn/workspace'
import { userAbsPath } from '../../../lib/storage'
import { localRevealKey, requestSourceReveal } from '../../../lib/docReveal'
import type { OutlineHandle } from '../../../lib/outline'
import { draftOf } from '../../../learn/drafts'
import LocalDoc from '../LocalDoc'
import { t } from '../../../i18n'

export interface FileTabLayerProps {
  groupId: string
  tabs: LearnTab[]
  activeTabId: string | null
  store: LearnStore
  docScale: number
  editorScale: number
  docSaving: boolean
  docSaveError?: string
  localSaved?: { path: string; text: string } | null
  localTicks: Record<string, number>
  stageLocalDraft: (tabId: string, text: string | null) => void
  closeTab: (
    groupId: string,
    tabId: string,
    target: 'self' | 'others' | 'right' | 'all',
    opts?: { confirm?: boolean },
  ) => void
  setTabView: (tabId: string, view: 'source' | 'preview') => void
  getOutlineSlot: (tabId: string) => { current: OutlineHandle | null }
  onToast: (msg: string) => void
}

/**
 * 本地与工作区文件常驻层（Keepalive）：
 * 只要文件页签在当前分屏格中处于打开状态，其 DOM 与 CodeMirror 实例即保活在 DOM 中。
 * 切去其它页签时仅添加 hidden（display:none）挂起，切回时零延迟唤醒，
 * 彻底避免重新读取磁盘、重新初始化编辑器实例与重渲染导致的白屏闪烁，完整保留选区、光标和撤销栈。
 */
export const FileTabLayer = memo(function FileTabLayer({
  groupId,
  tabs,
  activeTabId,
  store,
  docScale,
  editorScale,
  docSaving,
  docSaveError,
  localSaved,
  localTicks,
  stageLocalDraft,
  closeTab,
  setTabView,
  getOutlineSlot,
  onToast,
}: FileTabLayerProps) {
  return (
    <>
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId

        let absPath: string | null = null
        if (tab.ref.kind === 'local') {
          absPath = tab.ref.path
        } else if (tab.ref.kind === 'ws') {
          const rel = wsRelOfTab(store, tab.ref)
          absPath = rel ? userAbsPath(rel) : null
        }

        if (!absPath) {
          if (!isActive) return null
          return (
            <div
              key={tab.id}
              className="flex min-h-0 flex-1 items-center justify-center text-[12.5px] text-ink-faint"
            >
              {t('这份工作区文件已经不在了（节点或项目被删掉了）')}
            </div>
          )
        }

        const validPath = absPath
        const draft = draftOf(store.drafts, tab.id)
        const currentView = viewOf(tab, false)
        const tick = localTicks[validPath] ?? 0

        return (
          <div
            key={tab.id + '#' + tick}
            data-file-pane={tab.id}
            className={isActive ? 'print-flat relative flex min-h-0 flex-1 flex-col' : 'hidden'}
            {...(!isActive ? { hidden: true } : {})}
          >
            <LocalDoc
              path={validPath}
              view={currentView}
              scale={docScale}
              editorScale={editorScale}
              draft={draft}
              savedText={localSaved?.path === validPath ? localSaved.text : undefined}
              onDraft={(text) => stageLocalDraft(tab.id, text)}
              saving={docSaving}
              saveError={docSaveError}
              onMissing={() => closeTab(groupId, tab.id, 'self', { confirm: false })}
              outlineSlot={getOutlineSlot(tab.id)}
              onNeedEdit={() => setTabView(tab.id, 'source')}
              onRevealSource={(loc) => {
                requestSourceReveal(localRevealKey(validPath), loc.start, loc.end)
                setTabView(tab.id, 'source')
              }}
              onCloseTab={(force) => closeTab(groupId, tab.id, 'self', { confirm: !force })}
              onCloseOtherTabs={(force) => closeTab(groupId, tab.id, 'others', { confirm: !force })}
              onToast={onToast}
            />
          </div>
        )
      })}
    </>
  )
})
