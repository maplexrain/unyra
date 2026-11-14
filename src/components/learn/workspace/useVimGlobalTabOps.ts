import { useEffect } from 'react'
import { setGlobalTabOperations } from '../../../lib/vimCommands'
import { setAgentToggleHandler } from '../../../lib/agentFocus'
import { focusedGroup } from '../../../learn/groups'
import type { LearnStore } from '../../../learn/types'
import type { TabCloseMode } from '../../../learn/tabs'

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
}

/**
 * 为全局 Vim 冒号命令（如 :tabo, :q, :tabnew, :agent）注入跨页签与侧栏操作能力。
 * 即使当前位于结构页面（大纲/思维导图）等非编辑器页面，也能精准关闭其他页签或调度导师栏。
 */
export function useVimGlobalTabOps({ getLatest, closeTab, openBlankTab, toggleSide, expandSide }: Params): void {
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
          // 不带 ! 的 :tabo 跳过有未保存改动的页签（体验要平滑，不弹确认打断）
          skipDirty: opts?.skipDirty,
        })
      },
      newTab: () => {
        openBlankTab()
      },
    })
    setAgentToggleHandler({ toggle: toggleSide, expand: expandSide })
    return () => {
      setGlobalTabOperations(null)
      setAgentToggleHandler(null)
    }
  }, [getLatest, closeTab, openBlankTab, toggleSide, expandSide])
}
