import { useEffect } from 'react'
import { setGlobalTabOperations } from '../../../lib/vimCommands'
import { setAgentToggleHandler } from '../../../lib/agentFocus'
import { setOpenTargetsProvider, buildOpenTargets } from '../../../lib/vimOpenTargets'
import { focusedGroup } from '../../../learn/groups'
import type { DocView, LearnStore, TabRef } from '../../../learn/types'
import { isMediaFile, type TabCloseMode, viewOf } from '../../../learn/tabs'
import { emptyNote } from './panes'

interface Params {
  getLatest: () => LearnStore
  closeTab: (
    groupId: string,
    tabId: string,
    mode: TabCloseMode,
    opts?: { confirm?: boolean; closingIds?: string[]; skipDirty?: boolean },
  ) => void
  openBlankTab: () => void
  toggleSide?: () => void
  expandSide?: () => void
  setPure?: (pure: boolean) => void
  isPure?: () => boolean
  togglePure?: () => void
  openWebTab?: (url: string) => void
  setTabView?: (tabId: string | null, view: DocView) => void
  openTab?: (ref: TabRef) => void
  openExam?: (examId: string) => void
  openExamCopy?: (nodeId: string, examId: string, attemptId: string) => void
  newExam?: (nodeId: string) => void
  openWsFile?: (nodeId: string, seg: string) => void
  openLocalFile?: (path: string) => void
}

/**
 * 为全局 Vim 冒号命令（如 :tabo, :q, :tabnew, :edit, :browser, :fullscreen, :open）注入跨页签与工作区操作能力。
 */
export function useVimGlobalTabOps(params: Params): void {
  const {
    getLatest,
    closeTab,
    openBlankTab,
    toggleSide,
    expandSide,
    setPure,
    isPure,
    togglePure,
    openWebTab,
    setTabView,
    openTab,
    openExam,
    openExamCopy,
    newExam,
    openWsFile,
    openLocalFile,
  } = params

  useEffect(() => {
    setGlobalTabOperations({
      closeTab: (force) => {
        const s = getLatest()
        const group = focusedGroup(s.docArea)
        if (!group?.active) return
        closeTab(group.id, group.active, 'self', { confirm: !force })
      },
      closeOtherTabs: (force, opts) => {
        const s = getLatest()
        const group = focusedGroup(s.docArea)
        if (!group?.active) return
        closeTab(group.id, group.active, 'others', {
          confirm: !force,
          skipDirty: opts?.skipDirty,
        })
      },
      newTab: () => {
        openBlankTab()
      },
      setPure: (pure) => {
        setPure?.(pure)
      },
      isPure: () => isPure?.() ?? false,
      togglePure: () => {
        togglePure?.()
      },
      openWebTab: (url) => {
        openWebTab?.(url)
      },
      switchToEdit: () => {
        const s = getLatest()
        const group = focusedGroup(s.docArea)
        if (!group || !group.active) {
          return { success: false, message: '[当前无活动页签]' }
        }
        const tab = group.tabs.find((t) => t.id === group.active)
        if (!tab) {
          return { success: false, message: '[当前无活动页签]' }
        }

        const kind = tab.ref.kind
        let isEditable = false
        if (kind === 'note' || kind === 'teach' || kind === 'super' || kind === 'draft') {
          isEditable = true
        } else if (kind === 'local') {
          const p = tab.ref.path.toLowerCase()
          isEditable = !isMediaFile(p) && !p.endsWith('.pdf')
        } else if (kind === 'ws') {
          const seg = tab.ref.seg.toLowerCase()
          isEditable = !isMediaFile(seg) && !seg.endsWith('.pdf')
        }

        if (!isEditable) {
          return { success: false, message: '[当前页面内容不可编辑]' }
        }

        const curView = viewOf(tab, emptyNote(s, tab))
        if (curView === 'source') {
          return { success: true, message: '[当前已是编辑模式]' }
        }

        if (setTabView) {
          setTabView(tab.id, 'source')
          return { success: true, message: '[已切换至编辑模式]' }
        }
        return { success: false, message: '[无法切换视图]' }
      },
    })

    if (openTab && openExam && openExamCopy && newExam) {
      setOpenTargetsProvider(() =>
        buildOpenTargets({
          store: getLatest(),
          openTab,
          openExam,
          openExamCopy,
          newExam,
          openWsFile,
          openLocalFile,
        }),
      )
    }

    setAgentToggleHandler({ toggle: toggleSide, expand: expandSide })

    return () => {
      setGlobalTabOperations(null)
      setAgentToggleHandler(null)
      setOpenTargetsProvider(null)
    }
  }, [
    getLatest,
    closeTab,
    openBlankTab,
    toggleSide,
    expandSide,
    setPure,
    isPure,
    togglePure,
    openWebTab,
    setTabView,
    openTab,
    openExam,
    openExamCopy,
    newExam,
    openWsFile,
    openLocalFile,
  ])
}
