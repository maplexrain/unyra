import { useCallback, useEffect } from 'react'
import { setGlobalTabOperations } from '../../../lib/vimCommands'
import { setAgentToggleHandler, focusAgentInput } from '../../../lib/agentFocus'
import { setOpenTargetsProvider, buildOpenTargets } from '../../../lib/vimOpenTargets'
import {
  setSideTargetsProvider,
  buildSideTargets,
  setFixSideTargetsProvider,
  buildFixSideTargets,
} from '../../../lib/vimSideTargets'
import {
  allStoredTabs,
  clampFixSideWidth,
  findTab,
  focusedGroup,
  focusedTab,
  toggleSwapTabSidePortal,
  withTabSidePortal,
} from '../../../learn/groups'
import type { AnnotationStyle, DocView, LearnStore, TabRef } from '../../../learn/types'
import { canTabSwitchToEdit, type TabCloseMode, viewOf } from '../../../learn/tabs'
import { emptyNote } from './panes'
import { useBrowseVim } from './useBrowseVim'
import { openGlobalNoteDialog } from '../note/useAnnotationLayer'
import { captureOrGetDocSelection, setDocSelectionSnapshot } from './docSelectionSnapshot'
import { getNextTerminalSeq } from '../../terminal/terminalRegistry'
import { isWindowsPlatform } from '../../terminal/terminalPath'

interface Params {
  getLatest: () => LearnStore
  set?: (s: LearnStore) => void
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
  onUnderstand?: (nodeId: string, term: string, occurrence: number, snippet: string) => void
  onLearnConcept?: (term: string, nodeId: string) => void
  onSaveAnnotation?: (nodeId: string, term: string, body: string, style?: AnnotationStyle, occurrence?: number) => void
  onDeleteAnnotation?: (nodeId: string, term: string) => void
  onAsk?: (nodeId: string, payload: { question: string; text: string }) => void
}

/**
 * 为全局 Vim 冒号命令（如 :tabo, :q, :tabnew, :edit, :browser, :fullscreen, :open）注入跨页签与工作区操作能力。
 */
export function useVimGlobalTabOps(params: Params): void {
  const {
    getLatest,
    set,
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

  const openSidePortal = useCallback(
    (targetTabId: string): { success: boolean; message?: string } => {
      if (!set) return { success: false, message: '[当前环境不支持并排对照]' }
      const s = getLatest()
      const active = focusedTab(s.docArea)
      if (!active) return { success: false, message: '[当前无活动页签]' }
      if (targetTabId === active.id) return { success: false, message: '[无法与当前页面自身对照]' }
      if (s.fixSide?.targetTabId === targetTabId)
        return { success: false, message: '[该页签已在固定外侧栏中打开，不能重复并排]' }
      if (!findTab(s.docArea, targetTabId)) return { success: false, message: '[目标页签不存在]' }
      set({
        ...s,
        docArea: withTabSidePortal(s.docArea, active.id, {
          targetTabId,
          ratio: active.side?.ratio,
          swapped: active.side?.swapped,
        }),
      })
      return { success: true, message: '[已开启并排传送对照]' }
    },
    [getLatest, set],
  )

  const closeSidePortal = useCallback((): { success: boolean; message?: string } => {
    if (!set) return { success: false, message: '[当前环境不支持并排对照]' }
    const s = getLatest()
    const active = focusedTab(s.docArea)
    if (!active?.side) return { success: false, message: '[当前页面未开启并排对照]' }
    set({ ...s, docArea: withTabSidePortal(s.docArea, active.id, null) })
    return { success: true, message: '[已关闭并排对照]' }
  }, [getLatest, set])

  const swapSidePortal = useCallback((): { success: boolean; message?: string } => {
    if (!set) return { success: false, message: '[当前环境不支持并排对照]' }
    const s = getLatest()
    const active = focusedTab(s.docArea)
    if (!active?.side) return { success: false, message: '[当前页面未开启并排对照]' }
    set({ ...s, docArea: toggleSwapTabSidePortal(s.docArea, active.id) })
    return { success: true, message: '[已对调左右分栏位置]' }
  }, [getLatest, set])

  const openFixSidePortal = useCallback(
    (targetTabId: string): { success: boolean; message?: string } => {
      if (!set) return { success: false, message: '[当前环境不支持固定外侧对照]' }
      const s = getLatest()
      const exists = allStoredTabs(s.docArea).some((t) => t.id === targetTabId)
      if (!exists) return { success: false, message: '[目标页签不存在]' }
      const active = focusedTab(s.docArea)
      if (active?.side?.targetTabId === targetTabId)
        return { success: false, message: '[该页签正在并排对照中，先关闭对照再固定]' }
      set({
        ...s,
        fixSide: {
          targetTabId,
          width: clampFixSideWidth(s.fixSide?.width),
          ...(s.fixSide?.left ? { left: true } : {}),
        },
      })
      return { success: true, message: '[已开启固定外侧对照栏]' }
    },
    [getLatest, set],
  )

  const closeFixSidePortal = useCallback((): { success: boolean; message?: string } => {
    if (!set) return { success: false, message: '[当前环境不支持固定外侧对照]' }
    const s = getLatest()
    if (!s.fixSide) return { success: false, message: '[当前未开启固定外侧对照栏]' }
    const { fixSide: _removed, ...rest } = s
    set(rest)
    return { success: true, message: '[已关闭固定外侧对照栏]' }
  }, [getLatest, set])

  const swapFixSidePortal = useCallback((): { success: boolean; message?: string } => {
    if (!set) return { success: false, message: '[当前环境不支持固定外侧对照]' }
    const s = getLatest()
    if (!s.fixSide) return { success: false, message: '[当前未开启固定外侧对照栏]' }
    set({
      ...s,
      fixSide: {
        ...s.fixSide,
        left: !s.fixSide.left,
        collapsed: false,
      },
    })
    return { success: true, message: '[已对调固定外侧栏位置]' }
  }, [getLatest, set])

  const toggleFixSideCollapse = useCallback((): { success: boolean; message?: string } => {
    if (!set) return { success: false, message: '[当前环境不支持固定外侧对照]' }
    const s = getLatest()
    if (!s.fixSide) return { success: false, message: '[当前未开启固定外侧对照栏]' }
    const nextCollapsed = !s.fixSide.collapsed
    set({
      ...s,
      fixSide: {
        ...s.fixSide,
        collapsed: nextCollapsed,
      },
    })
    return { success: true, message: nextCollapsed ? '[已收起固定外侧栏]' : '[已展开固定外侧栏]' }
  }, [getLatest, set])

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
      openTab: (ref) => {
        openTab?.(ref)
      },
      openTerminalTab: (shell) => {
        const s = getLatest()
        const allTabs = s.docArea?.groups?.flatMap((g) => g.tabs) ?? []
        const nextSeq = getNextTerminalSeq(allTabs)
        const isWin = isWindowsPlatform()
        const targetShell = shell || (isWin ? 'powershell' : 'bash')
        const shortShell = targetShell === 'powershell' ? 'pwsh' : targetShell
        openTab?.({
          kind: 'terminal',
          termId: nextSeq,
          shell: targetShell,
          title: `${nextSeq}: ${shortShell}`,
        })
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

        if (!canTabSwitchToEdit(tab)) {
          return { success: false, message: '[当前页面内容不可编辑]' }
        }

        const curView = viewOf(tab, emptyNote(s, tab))
        if (curView === 'source') {
          return { success: true, message: '[当前已是编辑模式]' }
        }

        if (setTabView) {
          setTabView(tab.id, 'source')
          const scheduleFocus = () => {
            const cmContent = document.querySelector<HTMLElement>('.cm-content')
            if (cmContent) {
              cmContent.focus()
            } else {
              requestAnimationFrame(() => {
                document.querySelector<HTMLElement>('.cm-content')?.focus()
              })
            }
          }
          requestAnimationFrame(scheduleFocus)
          setTimeout(scheduleFocus, 60)
          setTimeout(scheduleFocus, 180)
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
      markSelection: () => {
        const s = getLatest()
        const info = captureOrGetDocSelection(s)
        if (!info) return { success: false, message: '[请先划选文字后再使用 :mark]' }
        const { nodeId, term, occurrence, hasMark } = info
        if (hasMark) {
          params.onDeleteAnnotation?.(nodeId, term)
          setDocSelectionSnapshot({ ...info, hasMark: false, timestamp: Date.now() })
          return { success: true, message: `[已取消「${term}」的标记]` }
        } else {
          params.onSaveAnnotation?.(nodeId, term, '', undefined, occurrence)
          setDocSelectionSnapshot({ ...info, hasMark: true, timestamp: Date.now() })
          return { success: true, message: `[已标记「${term}」]` }
        }
      },
      commentSelection: () => {
        const s = getLatest()
        const info = captureOrGetDocSelection(s)
        if (!info) return { success: false, message: '[请先划选文字后再使用 :comment]' }
        openGlobalNoteDialog(info.term, info.occurrence)
        return { success: true, message: `[打开「${info.term}」注解窗口]` }
      },
      knowSelection: () => {
        const s = getLatest()
        const info = captureOrGetDocSelection(s)
        if (!info) return { success: false, message: '[请先划选文字后再使用 :know]' }
        params.onUnderstand?.(info.nodeId, info.term, info.occurrence, info.text)
        return { success: true, message: `[已请导师解释「${info.term}」并存入目标知识库]` }
      },
      studySelection: () => {
        const s = getLatest()
        const info = captureOrGetDocSelection(s)
        if (!info) return { success: false, message: '[请先划选文字后再使用 :study]' }
        params.onLearnConcept?.(info.term, info.nodeId)
        return { success: true, message: `[已发起「${info.term}」深入学习]` }
      },
      askSelection: (query?: string) => {
        const s = getLatest()
        const info = captureOrGetDocSelection(s)
        if (!info) return { success: false, message: '[请先划选文字后再使用 :ask]' }
        const q = query?.trim()
        if (q) {
          params.onAsk?.(info.nodeId, { question: q, text: info.text })
          return { success: true, message: `[已向导师提问: ${q.slice(0, 16)}]` }
        } else {
          params.expandSide?.()
          focusAgentInput()
          return { success: true, message: '[已打开导师提问窗口]' }
        }
      },
      openSidePortal,
      closeSidePortal,
      swapSidePortal,
      openFixSidePortal,
      closeFixSidePortal,
      swapFixSidePortal,
      toggleFixSideCollapse,
    })

    setSideTargetsProvider(() =>
      buildSideTargets({
        store: getLatest(),
        openSidePortal: (tid) => {
          openSidePortal(tid)
        },
        closeSidePortal: () => {
          closeSidePortal()
        },
        swapSidePortal: () => {
          swapSidePortal()
        },
      }),
    )

    setFixSideTargetsProvider(() =>
      buildFixSideTargets({
        store: getLatest(),
        openFixSidePortal: (tid) => {
          openFixSidePortal(tid)
        },
        closeFixSidePortal: () => {
          closeFixSidePortal()
        },
        swapFixSidePortal: () => {
          swapFixSidePortal()
        },
        toggleFixSideCollapse: () => {
          toggleFixSideCollapse()
        },
      }),
    )

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
      setSideTargetsProvider(null)
      setFixSideTargetsProvider(null)
    }
  }, [
    getLatest,
    set,
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
    openSidePortal,
    closeSidePortal,
    swapSidePortal,
    openFixSidePortal,
    closeFixSidePortal,
    swapFixSidePortal,
    toggleFixSideCollapse,
  ])
}
