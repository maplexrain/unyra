import { useCallback, useEffect } from 'react'
import { setGlobalTabOperations } from '../../../lib/vimCommands'
import { setAgentToggleHandler } from '../../../lib/agentFocus'
import { setOpenTargetsProvider, buildOpenTargets } from '../../../lib/vimOpenTargets'
import { focusedGroup } from '../../../learn/groups'
import type { DocView, LearnStore, TabRef } from '../../../learn/types'
import { isMediaFile, type TabCloseMode, viewOf } from '../../../learn/tabs'
import { emptyNote } from './panes'
import { useBrowseVim } from './useBrowseVim'

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
  activateTab?: (tabId: string) => void
  onToast?: (msg: string) => void
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
    activateTab,
    onToast,
  } = params

  const stepTab = useCallback(
    (direction: 'next' | 'prev') => {
      const s = getLatest()
      const group = focusedGroup(s.docArea)
      if (!group || group.tabs.length <= 1) return
      const curIdx = group.tabs.findIndex((t) => t.id === group.active)
      const idx = curIdx >= 0 ? curIdx : 0
      const nextIdx =
        direction === 'next'
          ? (idx + 1) % group.tabs.length
          : (idx - 1 + group.tabs.length) % group.tabs.length
      activateTab?.(group.tabs[nextIdx].id)
    },
    [activateTab, getLatest],
  )

  useBrowseVim({
    getLatest,
    onToast,
    nextTab: () => stepTab('next'),
    prevTab: () => stepTab('prev'),
  })

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
      nextTab: () => {
        stepTab('next')
      },
      prevTab: () => {
        stepTab('prev')
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
      switchToView: () => {
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
        let isPreviewable = false
        if (kind === 'note' || kind === 'teach' || kind === 'super' || kind === 'draft' || kind === 'guide') {
          isPreviewable = true
        } else if (kind === 'local') {
          const p = tab.ref.path.toLowerCase()
          isPreviewable = p.endsWith('.md') || p.endsWith('.html') || p.endsWith('.htm') || p.endsWith('.typ') || p.endsWith('.typst') || p.endsWith('.txt')
        } else if (kind === 'ws') {
          const seg = tab.ref.seg.toLowerCase()
          isPreviewable = seg.endsWith('.md') || seg.endsWith('.html') || seg.endsWith('.htm') || seg.endsWith('.typ') || seg.endsWith('.typst') || seg.endsWith('.txt')
        }

        if (!isPreviewable) {
          return { success: false, message: '[当前页面不支持浏览模式]' }
        }

        const curView = viewOf(tab, emptyNote(s, tab))
        if (curView === 'preview') {
          return { success: true, message: '[当前已是浏览模式]' }
        }

        if (setTabView) {
          setTabView(tab.id, 'preview')
          return { success: true, message: '[已切换至浏览模式]' }
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
