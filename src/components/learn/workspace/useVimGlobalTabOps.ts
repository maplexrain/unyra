import { useEffect } from 'react'
import { setGlobalTabOperations } from '../../../lib/vimCommands'
import { focusedGroup } from '../../../learn/groups'
import type { LearnStore } from '../../../learn/types'
import type { TabCloseMode } from '../../../learn/tabs'

interface Params {
  getLatest: () => LearnStore
  closeTab: (
    groupId: string,
    tabId: string,
    mode: TabCloseMode,
    opts?: { confirm?: boolean; closingIds?: string[] },
  ) => void
  openBlankTab: () => void
}

/**
 * 为全局 Vim 冒号命令（如 :tabo, :q, :tabnew）注入跨页签操作能力。
 * 即使当前位于结构页面（大纲/思维导图）等非编辑器页面，也能精准关闭其他页签或新建页签。
 */
export function useVimGlobalTabOps({ getLatest, closeTab, openBlankTab }: Params): void {
  useEffect(() => {
    setGlobalTabOperations({
      closeTab: (force) => {
        const s = getLatest()
        const group = focusedGroup(s.docArea)
        if (!group?.active) return
        closeTab(group.id, group.active, 'self', { confirm: !force })
      },
      closeOtherTabs: (force) => {
        const s = getLatest()
        const group = focusedGroup(s.docArea)
        if (!group?.active) return
        closeTab(group.id, group.active, 'others', { confirm: !force })
      },
      newTab: () => {
        openBlankTab()
      },
    })
    return () => setGlobalTabOperations(null)
  }, [getLatest, closeTab, openBlankTab])
}
