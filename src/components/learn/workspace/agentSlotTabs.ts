/**
 * AgentSlot 的页签小动作：打开统一设置页、打开提示词文件页、智能体页的 fixside 开关。
 *
 * 从 AgentSlot 抽出来，一是这些动作与名册 / 对话渲染无关，二是 AgentSlot 已接近
 * 仓库的 1000 行硬上限（见 AGENTS.md），新逻辑必须开新模块。
 */
import { allStoredTabs, clampFixSideWidth } from '../../../learn/groups'
import { promptFileAbsPath } from '../../../agent/promptFileStore'
import { setSettingsSection } from '../../settings/section'
import type { LearnStore, LearnTab, TabRef, DocView } from '../../../learn/types'
import type { AgentProfileId } from '../../../agent/agentProfile'
import type { PromptFileItem } from '../../../learn/ai/promptFiles'

type OpenTab = (ref: TabRef, view?: DocView) => void

interface ReturnToAgentPageArgs {
  groupId: string
  promptTabId: string
  agentTabs: LearnTab[]
  activeGoalId: string | null
  activateTab: (tabId: string) => void
  openTab: OpenTab
  closeTab: (
    groupId: string,
    tabId: string,
    mode: 'self',
    opts?: { confirm?: boolean },
  ) => void
}

/**
 * 从内置提示词只读页返回：优先激活已开着的智能体页，没有就补开一枚；
 * 然后直接关掉提示词页签（只读页没有草稿，不需要确认框）。
 */
export function returnToAgentPage({
  groupId,
  promptTabId,
  agentTabs,
  activeGoalId,
  activateTab,
  openTab,
  closeTab,
}: ReturnToAgentPageArgs): void {
  const agentTab =
    agentTabs.find(
      (tab) => tab.ref.kind === 'agentTeam' && (tab.ref.goalId ?? null) === activeGoalId,
    ) ?? agentTabs.find((tab) => tab.ref.kind === 'agentTeam')
  if (agentTab) activateTab(agentTab.id)
  else openTab({ kind: 'agentTeam' })
  closeTab(groupId, promptTabId, 'self', { confirm: false })
}

/** 打开统一设置页的智能体分页（常规 / 智能体是同一枚页签的两页） */
export function openAgentSettingsTab(openTab: OpenTab): void {
  setSettingsSection('agent')
  openTab({ kind: 'settings' })
}

/** 打开一份提示词文件：内置走只读提示词页，外置走 prompts/ 下的本地 xml 页签 */
export function openPromptFileTab(
  openTab: OpenTab,
  onToast: (text: string) => void,
  agentId: AgentProfileId,
  file: PromptFileItem,
): void {
  if (file.builtin) {
    openTab(
      { kind: 'prompt', agentId, layer: file.layer, fileId: file.id, title: file.name },
      'preview',
    )
    return
  }
  const abs = file.relPath
    ? promptFileAbsPath({ relPath: file.relPath })
    : file.fileName
      ? promptFileAbsPath(file.fileName)
      : null
  if (!abs) {
    onToast('找不到这份提示词文件的路径')
    return
  }
  openTab({ kind: 'local', path: abs, title: file.name }, 'source')
}

/** 当前目标对应的智能体团队页签 id；还没开过则为 null */
export function agentTeamTabIdOf(docArea: LearnStore['docArea'], goalId: string | null): string | null {
  const tabs = allStoredTabs(docArea)
  return tabs.find((t) => t.ref.kind === 'agentTeam' && (t.ref.goalId ?? null) === goalId)?.id ?? null
}

/** 收起 / 展开当前已固定的外侧栏；没有 fixside 时返回 false，交给调用方决定是否提示。 */
export function toggleFixSideCollapse(
  getLatest: () => LearnStore,
  set: (store: LearnStore) => void,
): boolean {
  const cur = getLatest()
  if (!cur.fixSide) return false
  set({ ...cur, fixSide: { ...cur.fixSide, collapsed: !cur.fixSide.collapsed } })
  return true
}

/** 把智能体团队页固定到 fixside；已经停在那里则收起（再次点击即快捷关闭） */
export function toggleAgentTeamFixSide(
  getLatest: () => LearnStore,
  set: (store: LearnStore) => void,
  tabId: string,
): void {
  const cur = getLatest()
  if (cur.fixSide?.targetTabId === tabId) {
    const { fixSide: _removed, ...rest } = cur
    set(rest)
    return
  }
  set({
    ...cur,
    fixSide: {
      targetTabId: tabId,
      width: clampFixSideWidth(cur.fixSide?.width),
      collapsed: false,
      ...(cur.fixSide?.left ? { left: true } : {}),
    },
  })
}
