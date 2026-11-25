import type { Dispatch, SetStateAction } from 'react'
import type { LearnStore } from '../../../learn/types'
import { focusedGroup } from '../../../learn/groups'
import { useShortcut } from '../../../lib/useShortcut'

export interface WorkspaceShortcutsDeps {
  saveDocNow: () => Promise<void>
  setFindMode: (m: 'find' | 'replace') => void
  setFindTick: Dispatch<SetStateAction<number>>
  openExport: (groupFocus: string) => void
  getLatest: () => LearnStore
  closeTab: (groupId: string, tabId: string, which: 'self') => void
  pure: boolean
  toggleFixSide: () => void
  toggleZen: () => void
  isWeb: () => boolean
  focusWebAddress: () => void
  openWebTab: (url: string) => void
}

/**
 * 学习工作区的全局快捷键编排（登记在快捷键注册表中，支持改键和冲突检测）。
 */
export function useWorkspaceShortcuts({
  saveDocNow,
  setFindMode,
  setFindTick,
  openExport,
  getLatest,
  closeTab,
  pure,
  toggleFixSide,
  toggleZen,
  isWeb,
  focusWebAddress,
  openWebTab,
}: WorkspaceShortcutsDeps) {
  // 保存：Ctrl+S
  useShortcut('learn.save', {
    down: () => {
      void saveDocNow()
    },
  })

  // 文档区查找（Ctrl+F）与替换（Ctrl+H）
  useShortcut('doc.find', {
    down: () => {
      setFindMode('find')
      setFindTick((n) => n + 1)
    },
  })
  useShortcut('doc.replace', {
    down: () => {
      setFindMode('replace')
      setFindTick((n) => n + 1)
    },
  })

  // 导出文档（Ctrl+E）：导的是焦点格那一篇
  useShortcut('doc.export', {
    down: () => openExport(getLatest().docArea.focus),
  })

  // Ctrl+W：关掉焦点格里正看着的那个页签
  useShortcut('learn.closeTab', {
    down: () => {
      const s = getLatest()
      const group = focusedGroup(s.docArea)
      if (!group?.active) return
      closeTab(group.id, group.active, 'self')
    },
  })

  // Ctrl+Q：收起 / 展开固定在文档区外侧的 fixside 栏
  useShortcut('agent.focus', {
    down: () => {
      if (pure) return
      toggleFixSide()
    },
  })

  // F11：纯净阅读
  useShortcut('doc.zen', {
    down: () => toggleZen(),
  })

  // Ctrl+L：新建网页页签
  useShortcut('web.newTab', {
    down: () => {
      if (isWeb()) return
      const s = getLatest()
      const group = focusedGroup(s.docArea)
      const active = group?.tabs.find((x) => x.id === group.active)
      if (active?.ref.kind === 'web') focusWebAddress()
      else openWebTab('')
    },
  })
}
