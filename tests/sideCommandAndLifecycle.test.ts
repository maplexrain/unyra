// @vitest-environment happy-dom
import { createElement, act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { isAlwaysPinnedRef, isTabPinned, makeTab, closeTabs, reorderTabs, tabKey } from '../src/learn/tabs'
import {
  FIRST_GROUP,
  allTabs,
  claimTab,
  clampFixSideWidth,
  emptyDocs,
  ensureGoalAgentTeamTab,
  findFixSideTargetTab,
  findSideTargetTab,
  goalAgentTeamRef,
  normalizeFixSideState,
  openAnchorOutline,
  openInGroup,
  pruneStaleSidePortals,
  setTabSidePortalRatio,
  syncGoalAgentTeamTabs,
  toggleSwapTabSidePortal,
  unloadAnchoredGroups,
  withOwners,
  withTabSidePortal,
} from '../src/learn/groups'
import { normalizeLearnStore } from '../src/learn/store/normalize'
import { buildState } from '../src/learn/files/state'
import { makeGoal } from '../src/learn/store/factories'
import type { LearnStore, TabRef } from '../src/learn/types'
import {
  buildFixSideTargets,
  buildSideTargets,
  matchSideTargets,
  setFixSideTargetsProvider,
  setSideTargetsProvider,
} from '../src/lib/vimSideTargets'
import { executeVimCommand, setGlobalTabOperations, setVimEditorBridge } from '../src/lib/vimCommands'
import { AgentRosterSidebar } from '../src/components/learn/agent-team/AgentRosterSidebar'
import { AgentSlot, type AgentSlotDeps } from '../src/components/learn/workspace/AgentSlot'

function makeBaseStore(): LearnStore {
  const goalA = { ...makeGoal('nA', '微积分', 'gA'), createdAt: 100, updatedAt: 100 }
  const goalB = { ...makeGoal('nB', '线性代数', 'gB'), createdAt: 200, updatedAt: 200 }
  const nodeA = {
    id: 'nA',
    goalId: 'gA',
    title: '极限与连续',
    key: '极限与连续',
    description: '',
    docs: { teaching: { content: '# 极限', updatedAt: 100 } },
    notes: [],
    annotations: [],
    status: 'learning' as const,
    origin: 'user' as const,
    createdAt: 100,
    updatedAt: 100,
  }
  const nodeB = {
    id: 'nB',
    goalId: 'gB',
    title: '矩阵与特征值',
    key: '矩阵与特征值',
    description: '',
    docs: { teaching: { content: '# 矩阵', updatedAt: 200 } },
    notes: [],
    annotations: [],
    status: 'learning' as const,
    origin: 'user' as const,
    createdAt: 200,
    updatedAt: 200,
  }

  let docs = emptyDocs()
  docs = openAnchorOutline(docs, FIRST_GROUP, { kind: 'outline', nodeId: 'nA', goalId: 'gA' }, (id) => (id === 'nA' ? 'gA' : null), 100)
  docs = ensureGoalAgentTeamTab(docs, 'gA', 101, { targetGroupId: FIRST_GROUP })
  docs = openInGroup(docs, FIRST_GROUP, { kind: 'teach', nodeId: 'nA' }, 102)
  docs = withOwners(docs, claimTab(docs.tabOwners, 'gA', 't:nA'))

  return {
    version: 2,
    nodes: [nodeA, nodeB],
    edges: [],
    goals: [goalA, goalB],
    conversations: [],
    exams: [],
    resources: {},
    activeGoalId: 'gA',
    activeNodeId: 'nA',
    activeConversationId: null,
    docArea: docs,
    drafts: {},
    docScroll: {},
    localFiles: [],
  } as unknown as LearnStore
}

describe('结构与智能体团队页签始终固定（不可取消固定）', () => {
  it('outline 与 agentTeam 即使携带 pinned: false 也始终固定且不受 :tabo 影响', () => {
    const oTab = { ...makeTab({ kind: 'outline', nodeId: 'nA', goalId: 'gA' }, 1), pinned: false }
    const teamTab = { ...makeTab({ kind: 'agentTeam', goalId: 'gA' }, 2), pinned: false }
    const teachTab = makeTab({ kind: 'teach', nodeId: 'nA' }, 3)

    expect(isAlwaysPinnedRef(oTab.ref)).toBe(true)
    expect(isAlwaysPinnedRef(teamTab.ref)).toBe(true)
    expect(isAlwaysPinnedRef(teachTab.ref)).toBe(false)

    expect(isTabPinned(oTab)).toBe(true)
    expect(isTabPinned(teamTab)).toBe(true)
    expect(isTabPinned(teachTab)).toBe(false)

    const ordered = reorderTabs([teachTab, teamTab, oTab], [teachTab.id, teamTab.id, oTab.id])
    expect(ordered.map((t) => t.id)).toEqual([teamTab.id, oTab.id, teachTab.id])

    const afterOthers = closeTabs(ordered, teachTab.id, 'others', teachTab.id)
    expect(afterOthers.tabs.map((t) => t.id)).toContain(oTab.id)
    expect(afterOthers.tabs.map((t) => t.id)).toContain(teamTab.id)
    expect(afterOthers.tabs.map((t) => t.id)).toContain(teachTab.id)
  })
})

describe('每个学习目标独立拥有智能体团队页签并随结构页签同步停靠恢复', () => {
  it('ensureGoalAgentTeamTab 不抢占当前结构页签焦点，关闭结构后两者一同停靠，再次打开结构一并归队', () => {
    const store = makeBaseStore()
    const goalOfNode = (id: string) => (id === 'nA' ? 'gA' : id === 'nB' ? 'gB' : null)
    const rootOf = (gid: string) => (gid === 'gA' ? 'nA' : gid === 'gB' ? 'nB' : null)

    const tIds = allTabs(store.docArea).map((t) => t.id)
    expect(tIds).toContain('o:nA')
    expect(tIds).toContain('team:gA')
    expect(tIds).toContain('t:nA')

    // 关闭锚点结构页签 -> 整个 gA tab 组（含结构、智能体团队、教学文档）一并停靠进 parkedTabs
    const before = allTabs(store.docArea)
    const closedDocs = unloadAnchoredGroups(
      {
        ...store.docArea,
        groups: store.docArea.groups.map((g) => ({
          ...g,
          tabs: g.tabs.filter((t) => t.id !== 'o:nA'),
          active: 't:nA',
        })),
      },
      before,
      goalOfNode,
      rootOf,
    )

    expect(allTabs(closedDocs).filter((t) => t.ref.kind !== 'blank')).toHaveLength(0)
    expect(closedDocs.parkedTabs?.gA?.map((t) => t.id)).toContain('team:gA')

    // 再次打开结构页签 -> 智能体团队连同整个停靠组自动归队
    const restored = openAnchorOutline(
      closedDocs,
      FIRST_GROUP,
      { kind: 'outline', nodeId: 'nA', goalId: 'gA' },
      goalOfNode,
      500,
    )
    expect(allTabs(restored).map((t) => t.id)).toContain('team:gA')
    expect(allTabs(restored).map((t) => t.id)).toContain('t:nA')
  })

  it('syncGoalAgentTeamTabs 自动将旧版单例 team:all 迁移为当前目标独立页签并清理已删除目标残留', () => {
    const store = makeBaseStore()
    const legacyDocs = {
      ...store.docArea,
      groups: [
        {
          id: FIRST_GROUP,
          tabs: [
            makeTab({ kind: 'outline', nodeId: 'nA', goalId: 'gA' }, 1),
            makeTab({ kind: 'agentTeam' }, 2),
            makeTab({ kind: 'agentTeam', goalId: 'deleted-goal' }, 3),
          ],
          active: 'team:all',
        },
      ],
    }

    const synced = syncGoalAgentTeamTabs(legacyDocs, store.goals, 'gA')
    const ids = allTabs(synced).map((t) => t.id)
    expect(ids).toContain(tabKey(goalAgentTeamRef('gA')))
    expect(ids).not.toContain('team:all')
    expect(ids).not.toContain('team:deleted-goal')
    expect(synced.groups[0].active).toBe('team:gA')
  })
})

describe('Vim :side 页签内传送对照、拖拽比例、双击对调与持久化', () => {
  beforeEach(() => {
    setGlobalTabOperations(null)
    setVimEditorBridge(null)
    setSideTargetsProvider(null)
  })

  it('buildSideTargets 排除当前活动页签并支持拼音/关键词检索', () => {
    const store = makeBaseStore()
    // 当前焦点页签是 t:nA（极限与连续）
    expect(store.docArea.groups[0].active).toBe('t:nA')

    const targets = buildSideTargets({
      store,
      openSidePortal: () => {},
      closeSidePortal: () => {},
      swapSidePortal: () => {},
    })

    expect(targets.some((x) => x.tabId === 't:nA')).toBe(false)
    expect(targets.some((x) => x.tabId === 'o:nA')).toBe(true)
    expect(targets.some((x) => x.tabId === 'team:gA')).toBe(true)

    const pyMatch = matchSideTargets(targets, 'znttd') // 智能体团队拼音首字母
    expect(pyMatch.some((x) => x.tabId === 'team:gA')).toBe(true)
  })

  it(':side 不拆分 DocGroup、支持比例调整、双击对调并跨重启持久化', () => {
    const store = makeBaseStore()
    const groupCountBefore = store.docArea.groups.length

    let docs = withTabSidePortal(store.docArea, 't:nA', {
      targetTabId: 'o:nA',
      ratio: 0.65,
    })
    // 严格保证未多出额外分屏组 / Tab 栏
    expect(docs.groups.length).toBe(groupCountBefore)
    expect(docs.layout).toEqual({ kind: 'group', group: FIRST_GROUP })

    const active = docs.groups[0].tabs.find((t) => t.id === 't:nA')!
    expect(findSideTargetTab(docs, active)?.id).toBe('o:nA')
    expect(active.side).toEqual({ targetTabId: 'o:nA', ratio: 0.65 })

    // 双击分割线对调左右位置（swap）并镜像比例
    docs = toggleSwapTabSidePortal(docs, 't:nA')
    const swappedTab = docs.groups[0].tabs.find((t) => t.id === 't:nA')!
    expect(swappedTab.side).toEqual({ targetTabId: 'o:nA', ratio: 0.35, swapped: true })

    // 拖拽调整比例（越界会被安全钳制在 0.2 ~ 0.8）
    docs = setTabSidePortalRatio(docs, 't:nA', 0.92)
    expect(docs.groups[0].tabs.find((t) => t.id === 't:nA')?.side?.ratio).toBe(0.8)

    // 持久化写出再读回反序列化：side 状态与 pinned 状态完整保留
    const serialized = buildState({ ...store, docArea: docs })
    const reloaded = normalizeLearnStore({ ...store, ...serialized })
    expect(reloaded).not.toBeNull()
    const reloadedTab = reloaded!.docArea.groups[0].tabs.find((t) => t.id === 't:nA')
    expect(reloadedTab?.side).toEqual({ targetTabId: 'o:nA', ratio: 0.8, swapped: true })
    expect(isTabPinned(reloaded!.docArea.groups[0].tabs.find((t) => t.id === 'team:gA')!)).toBe(true)

    // 当目标页签被关闭后，pruneStaleSidePortals 自动清理悬空对照配置
    const withoutOutline = {
      ...docs,
      groups: [
        {
          ...docs.groups[0],
          tabs: docs.groups[0].tabs.filter((t) => t.id !== 'o:nA'),
        },
      ],
    }
    const cleaned = pruneStaleSidePortals(withoutOutline)
    expect(cleaned.groups[0].tabs.find((t) => t.id === 't:nA')?.side).toBeUndefined()
  })

  it('executeVimCommand 支持 :side 目标选中、:side swap 与 :side off', () => {
    const store = makeBaseStore()
    const openSpy = vi.fn(() => ({ success: true }))
    const swapSpy = vi.fn(() => ({ success: true, message: '[已对调左右分栏位置]' }))
    const closeSpy = vi.fn(() => ({ success: true, message: '[已关闭并排对照]' }))

    setGlobalTabOperations({
      openSidePortal: openSpy,
      swapSidePortal: swapSpy,
      closeSidePortal: closeSpy,
    })
    setSideTargetsProvider(() =>
      buildSideTargets({
        store,
        openSidePortal: openSpy,
        closeSidePortal: closeSpy,
        swapSidePortal: swapSpy,
      }),
    )

    const rOpen = executeVimCommand(':side 智能体团队')
    expect(rOpen.success).toBe(true)
    expect(openSpy).toHaveBeenCalledWith('team:gA')

    const rSwap = executeVimCommand(':side swap')
    expect(rSwap.success).toBe(true)
    expect(swapSpy).toHaveBeenCalledTimes(1)

    const rClose = executeVimCommand(':side off')
    expect(rClose.success).toBe(true)
    expect(closeSpy).toHaveBeenCalledTimes(1)

    // 确认 TabRef 类型被正确约束，无多余空字段
    const ref: TabRef = { kind: 'agentTeam', goalId: 'gA' }
    expect(tabKey(ref)).toBe('team:gA')
  })
})

describe('智能体团队响应式布局断点与 :side 状态隔离', () => {
  it('AgentRosterSidebar 在 forceCollapsed 时锁定收起且禁用展开，persistCollapsed=false 不写 localStorage', () => {
    localStorage.removeItem('moji:agent-team:left-collapsed')
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)

    act(() => {
      root.render(
        createElement(AgentRosterSidebar, {
          mode: 'free',
          onSelectMode: () => {},
          activeGoalTitle: '微积分',
          freeRunning: false,
          tutorRunning: false,
          tutorHasAsk: false,
          forceCollapsed: true,
          persistCollapsed: false,
        }),
      )
    })

    const aside = host.querySelector<HTMLElement>('[aria-label="智能体列表"]')
    expect(aside?.getAttribute('data-roster-collapsed')).toBe('true')
    expect(aside?.getAttribute('data-roster-locked')).toBe('true')

    const expandBtn = host.querySelector<HTMLButtonElement>('button[aria-label="展开智能体列表"]')!
    expect(expandBtn.disabled).toBe(true)
    act(() => {
      expandBtn.click()
    })
    // 点击后仍锁定收起且未污染全局 localStorage
    expect(host.querySelector('[data-roster-collapsed="true"]')).not.toBeNull()
    expect(localStorage.getItem('moji:agent-team:left-collapsed')).toBeNull()

    // 若是在 side 传送窗内允许折叠（宽度 >= 800 且 persistCollapsed=false），手动收起也不会写入 localStorage
    act(() => {
      root.render(
        createElement(AgentRosterSidebar, {
          mode: 'free',
          onSelectMode: () => {},
          activeGoalTitle: '微积分',
          freeRunning: false,
          tutorRunning: false,
          tutorHasAsk: false,
          forceCollapsed: false,
          persistCollapsed: false,
        }),
      )
    })

    const collapseBtn = host.querySelector<HTMLButtonElement>('button[aria-label="收起智能体列表"]')!
    act(() => {
      collapseBtn.click()
    })
    expect(host.querySelector('[data-roster-collapsed="true"]')).not.toBeNull()
    expect(localStorage.getItem('moji:agent-team:left-collapsed')).toBeNull()

    act(() => {
      root.unmount()
    })
    host.remove()
  })

  it('AgentSlot 根据容器宽度自动切换：>=1200 完整三栏，<1200 隐藏对话历史，<800 额外锁定收起智能体列表，且不改写 localStorage', () => {
    localStorage.removeItem('moji:agent-team:left-collapsed')
    localStorage.removeItem('moji:agent-team:right-collapsed')

    let observeCb: ((entries: Array<{ contentRect: { width: number } }>) => void) | null = null
    const OrigRO = globalThis.ResizeObserver
    globalThis.ResizeObserver = class {
      constructor(cb: (entries: Array<{ contentRect: { width: number } }>) => void) {
        observeCb = cb
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver

    try {
      const store = makeBaseStore()
      const deps: AgentSlotDeps = {
        store,
        getLatest: () => store,
        set: () => {},
        agent: {
          runningByConversation: {},
          pendingAskByConv: {},
          streams: {},
          queues: {},
          tpsByConv: {},
          liveUsageByConv: {},
          compactingConvId: null,
          subRunsAll: [],
        } as unknown as AgentSlotDeps['agent'],
        freeChats: [],
        currentFreeConvId: null,
        setFreeConvId: () => {},
        onToast: () => {},
        openTab: () => {},
        effort: 'medium',
        setGlobalEffort: () => {},
        hasKey: true,
        providerName: 'test',
        vision: false,
        agentSettings: { persona: 'default', docFormat: 'markdown', compact: { threshold: 70 } } as unknown as AgentSlotDeps['agentSettings'],
        setSettingsEpoch: () => {},
        agentPanes: [{ kind: 'free', conversationId: null }],
        activeAgentTab: { kind: 'free', conversationId: null },
        activeAgentTabId: 'free',
        activateAgentTab: () => {},
        openAgentTab: () => {},
        selectTutorGoal: () => {},
        exitSubagentView: () => {},
        handleNewGoalConversation: () => {},
        removeConversation: () => {},
        newConversationIn: () => {},
        selectConversationIn: () => {},
        pruneImagesOf: () => {},
        startSuperLab: () => {},
        newExam: () => {},
        shouldWaitInLine: () => false,
        tabGoalId: 'gA',
      }

      const host = document.createElement('div')
      document.body.appendChild(host)
      const root = createRoot(host)

      act(() => {
        root.render(createElement(AgentSlot, { deps }))
      })

      // 1. 宽度 1300px：显示左右双侧栏
      act(() => {
        observeCb?.([{ contentRect: { width: 1300 } }])
      })
      expect(host.querySelector('[aria-label="对话历史"]')).not.toBeNull()
      expect(host.querySelector('[data-roster-collapsed="true"]')).toBeNull()

      // 2. 宽度 1050px（< 1200）：隐藏对话历史侧栏，但保留可自由操作的智能体列表
      act(() => {
        observeCb?.([{ contentRect: { width: 1050 } }])
      })
      expect(host.querySelector('[aria-label="对话历史"]')).toBeNull()
      expect(host.querySelector('[data-roster-collapsed="true"]')).toBeNull()

      // 3. 宽度 700px（< 800）：不显示对话历史，且智能体列表强制收起不可展开
      act(() => {
        observeCb?.([{ contentRect: { width: 700 } }])
      })
      expect(host.querySelector('[aria-label="对话历史"]')).toBeNull()
      expect(host.querySelector('[data-roster-collapsed="true"]')).not.toBeNull()
      expect(host.querySelector('[data-roster-locked="true"]')).not.toBeNull()

      // 4. 关闭 side 或恢复宽屏（1300px）：自动回到原先状态，且从未污染 localStorage
      act(() => {
        observeCb?.([{ contentRect: { width: 1300 } }])
      })
      expect(host.querySelector('[aria-label="对话历史"]')).not.toBeNull()
      expect(host.querySelector('[data-roster-collapsed="true"]')).toBeNull()
      expect(localStorage.getItem('moji:agent-team:left-collapsed')).toBeNull()
      expect(localStorage.getItem('moji:agent-team:right-collapsed')).toBeNull()

      act(() => {
        root.unmount()
      })
      host.remove()
    } finally {
      globalThis.ResizeObserver = OrigRO
    }
  })
})

describe('Vim :fixside 固定外侧对照栏（页签外宿主机与持久化）', () => {
  beforeEach(() => {
    setGlobalTabOperations(null)
    setVimEditorBridge(null)
    setFixSideTargetsProvider(null)
  })

  it('clampFixSideWidth、normalizeFixSideState 与 buildState/normalizeLearnStore 持久化往返', () => {
    const store = makeBaseStore()
    expect(clampFixSideWidth(120)).toBe(300)
    expect(clampFixSideWidth(1500)).toBe(960)
    expect(clampFixSideWidth(undefined)).toBe(540)

    const valid = normalizeFixSideState({ targetTabId: 'team:gA', width: 620, left: false, collapsed: false }, store.docArea)
    expect(valid).toEqual({ targetTabId: 'team:gA', width: 620 })

    const leftValid = normalizeFixSideState({ targetTabId: 'team:gA', width: 480, left: true, collapsed: true }, store.docArea)
    expect(leftValid).toEqual({ targetTabId: 'team:gA', width: 480, left: true, collapsed: true })
    expect(findFixSideTargetTab(store.docArea, leftValid)?.id).toBe('team:gA')

    // 持久化落盘与读回
    const saved = buildState({ ...store, fixSide: leftValid })
    const reloaded = normalizeLearnStore({ ...store, ...saved })
    expect(reloaded?.fixSide).toEqual(leftValid)

    // 目标页签已不存在时自动清理
    const dangling = normalizeFixSideState({ targetTabId: 'not-exist-tab', width: 500 }, store.docArea)
    expect(dangling).toBeUndefined()
  })

  it('buildFixSideTargets 不排除当前激活页签且 executeVimCommand 支持 :fixside 各子命令', () => {
    const store = makeBaseStore()
    const openSpy = vi.fn(() => ({ success: true }))
    const closeSpy = vi.fn(() => ({ success: true, message: '[已关闭固定外侧对照栏]' }))
    const swapSpy = vi.fn(() => ({ success: true, message: '[已对调固定外侧栏位置]' }))
    const toggleSpy = vi.fn(() => ({ success: true, message: '[已收起固定外侧栏]' }))

    const storeWithFix = { ...store, fixSide: { targetTabId: 't:nA', width: 540 } }
    const candidates = buildFixSideTargets({
      store: storeWithFix,
      openFixSidePortal: openSpy,
      closeFixSidePortal: closeSpy,
      swapFixSidePortal: swapSpy,
      toggleFixSideCollapse: toggleSpy,
    })

    // 注意：与 :side 不同，:fixside 位于 tab 之外，当前正在看的 t:nA 也可作为候选
    expect(candidates.some((x) => x.tabId === 't:nA')).toBe(true)
    expect(candidates.some((x) => x.tabId === 'team:gA')).toBe(true)
    expect(candidates.some((x) => x.id === '__fixside_swap__')).toBe(true)
    expect(candidates.some((x) => x.id === '__fixside_close__')).toBe(true)

    setGlobalTabOperations({
      openFixSidePortal: openSpy,
      closeFixSidePortal: closeSpy,
      swapFixSidePortal: swapSpy,
      toggleFixSideCollapse: toggleSpy,
    })
    setFixSideTargetsProvider(() => candidates)

    expect(executeVimCommand(':fixside 智能体团队').success).toBe(true)
    expect(openSpy).toHaveBeenCalledWith('team:gA')

    expect(executeVimCommand(':fixside swap').success).toBe(true)
    expect(swapSpy).toHaveBeenCalledTimes(1)

    expect(executeVimCommand(':fixside toggle').success).toBe(true)
    expect(toggleSpy).toHaveBeenCalledTimes(1)

    expect(executeVimCommand(':fixside off').success).toBe(true)
    expect(closeSpy).toHaveBeenCalledTimes(1)
  })
})
