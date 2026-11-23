// @vitest-environment happy-dom
import { createElement, act, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { tabKey, tabTitle, tabTrail, tabNodeId } from '../src/learn/tabs'
import { normalizeTab } from '../src/learn/store/normalize/tabs'
import type { AgentTabRef, LearnStore } from '../src/learn/types'
import type { Conversation, WorkSession } from '../src/agent/types'
import { agentTabKey } from '../src/learn/agentTabs'
import { hydrateFreeChat } from '../src/learn/freeChat'
import { deleteConversation } from '../src/learn/graph/conversations'
import { repairAgentTabsAfterDelete, useAgentTabActions } from '../src/components/learn/workspace/useAgentTabActions'
import { AgentSlot, type AgentSlotDeps } from '../src/components/learn/workspace/AgentSlot'
import { goalConvByGoal } from '../src/components/learn/workspace/goalFocus'
import {
  conversationTimeOf,
  displayConversationTitle,
  formatConversationTime,
  lastMessagePreview,
  sortConversationsByTimeDesc,
} from '../src/components/learn/agent-team/conversationList'
import { AgentRosterSidebar } from '../src/components/learn/agent-team/AgentRosterSidebar'
import { AgentSettingsView } from '../src/components/learn/agent-team/AgentSettingsView'
import type { WorkflowRow } from '../src/learn/workflows'
import { SHARED_AGENT_PREFIX } from '../src/learn/ai/agentSharedPrefix'
import type { AgentProfile } from '../src/agent/agentProfile'
import type { AgentTeamMode } from '../src/components/learn/agent-team/conversationList'
import {
  isAgentTeamVisible,
  syncAgentTabForConversation,
} from '../src/components/learn/workspace/useAgentTeamHost'
import {
  focusAgentInput,
  sendAgentMessage,
  setAgentFocusHandler,
  setAgentMessenger,
  setAgentToggleHandler,
} from '../src/lib/agentFocus'

describe('智能体团队 Tab 契约', () => {
  it('tabKey 生成正确的 agentTeam 标识', () => {
    expect(tabKey({ kind: 'agentTeam' })).toBe('team:all')
    expect(tabKey({ kind: 'agentTeam', goalId: 'goal-123' })).toBe('team:goal-123')
  })

  it('tabNodeId 对系统功能页签 agentTeam 返回 null', () => {
    expect(tabNodeId({ kind: 'agentTeam' })).toBeNull()
    expect(tabNodeId({ kind: 'agentTeam', goalId: 'goal-1' })).toBeNull()
  })

  it('tabTitle 与 tabTrail 返回正确文案（页签就叫「智能体」，目标归属由页签组表达）', () => {
    expect(tabTitle({ kind: 'agentTeam' }, () => undefined)).toBe('智能体')
    expect(tabTrail({ kind: 'agentTeam' }, () => '')).toBe('')
    expect(tabTrail({ kind: 'agentTeam', goalId: 'g1' }, () => '', (id) => `目标:${id}`)).toBe('')
  })

  it('normalizeTab 支持 agentTeam 并保全 goalId', () => {
    const raw = {
      id: 'tab-team-1',
      ref: { kind: 'agentTeam', goalId: 'g-99' },
      createdAt: 1000,
      activeAt: 2000,
    }
    const normalized = normalizeTab(raw, new Map())
    expect(normalized).not.toBeNull()
    expect(normalized?.ref).toEqual({
      kind: 'agentTeam',
      goalId: 'g-99',
    })
  })
})

describe('useAgentTeamHost 纯函数编排', () => {
  const baseStore = {
    goals: [
      { id: 'g1', title: '微积分', question: '微积分', rootNodeId: 'n1', createdAt: 1, updatedAt: 1 },
      { id: 'g2', title: '线性代数', question: '线性代数', rootNodeId: 'n2', createdAt: 2, updatedAt: 2 },
    ],
    nodes: [],
    conversations: [
      { id: 'c1', goalId: 'g1', messages: [], createdAt: 1, updatedAt: 1 },
      { id: 'c2', goalId: 'g1', messages: [], createdAt: 2, updatedAt: 2 },
      { id: 'c3', goalId: 'g2', messages: [], createdAt: 3, updatedAt: 3 },
    ],
    activeGoalId: 'g1',
    activeNodeId: 'n1',
    activeConversationId: 'c1',
    agentTabs: [{ kind: 'goal', goalId: 'g1', conversationId: 'c1' }],
    agentActiveTab: 'ga:g1:c1',
    docArea: {
      focus: 'g-main',
      layout: { kind: 'group', group: 'g-main' },
      groups: [
        {
          id: 'g-main',
          active: 't-doc',
          tabs: [
            { id: 't-doc', ref: { kind: 'teach', nodeId: 'n1' }, createdAt: 1 },
            { id: 'team:all', ref: { kind: 'agentTeam' }, createdAt: 2 },
          ],
        },
        {
          id: 'g-side',
          active: null,
          tabs: [],
        },
      ],
    },
  } as unknown as LearnStore

  it('isAgentTeamVisible 仅在任意分屏激活了 agentTeam 页签时返回 true', () => {
    expect(isAgentTeamVisible(baseStore)).toBe(false)

    const mainActive: LearnStore = {
      ...baseStore,
      docArea: {
        ...baseStore.docArea,
        groups: [
          { ...baseStore.docArea.groups[0], active: 'team:all' },
          baseStore.docArea.groups[1],
        ],
      },
    }
    expect(isAgentTeamVisible(mainActive)).toBe(true)

    const sideActive: LearnStore = {
      ...baseStore,
      docArea: {
        ...baseStore.docArea,
        groups: [
          baseStore.docArea.groups[0],
          {
            id: 'g-side',
            active: 'team:all',
            tabs: [{ id: 'team:all', ref: { kind: 'agentTeam' }, createdAt: 2 }],
          },
        ],
      },
    }
    expect(isAgentTeamVisible(sideActive)).toBe(true)
  })

  it('syncAgentTabForConversation 对当前目标会话补全并激活页签且同步 activeConversationId', () => {
    const next = syncAgentTabForConversation(baseStore, 'c2')
    expect(next.agentActiveTab).toBe('ga:g1:c2')
    expect(next.activeGoalId).toBe('g1')
    expect(next.activeConversationId).toBe('c2')
    expect(next.agentTabs).toEqual([
      { kind: 'goal', goalId: 'g1', conversationId: 'c1' },
      { kind: 'goal', goalId: 'g1', conversationId: 'c2' },
    ])
  })

  it('syncAgentTabForConversation 对其他目标会话不越权切换 activeGoalId', () => {
    const next = syncAgentTabForConversation(baseStore, 'c3')
    expect(next.agentActiveTab).toBe('ga:g2:c3')
    expect(next.activeGoalId).toBe('g1')
    expect(next.activeConversationId).toBe('c1')
  })

  it('syncAgentTabForConversation 对非目标会话（自由聊天）切到 free 页签', () => {
    const next = syncAgentTabForConversation(baseStore, 'free-conv-1')
    expect(next.agentActiveTab).toBe('free')
    expect(next.activeGoalId).toBe('g1')
  })
})

describe('agentFocus 身份校验清理与延迟派发', () => {
  beforeEach(() => {
    setAgentFocusHandler(null)
    setAgentMessenger(null)
    setAgentToggleHandler(null)
  })

  it('后注册处理器 B 后清理旧处理器 A 不会误清除 B', () => {
    const focusA = vi.fn()
    const focusB = vi.fn()
    const disposeA = setAgentFocusHandler(focusA)
    const disposeB = setAgentFocusHandler(focusB)

    // 先清理 A：不应清掉 B
    disposeA()
    expect(focusAgentInput()).toBe(true)
    expect(focusA).not.toHaveBeenCalled()
    expect(focusB).toHaveBeenCalledTimes(1)

    // 再清理 B：完全清空
    disposeB()
    expect(focusAgentInput()).toBe(false)
  })

  it('messenger 身份校验清理防止误删新注册的发送器', () => {
    const sendA = vi.fn()
    const sendB = vi.fn()
    const disposeA = setAgentMessenger(sendA)
    const disposeB = setAgentMessenger(sendB)

    disposeA()
    sendAgentMessage('hello')
    expect(sendA).not.toHaveBeenCalled()
    expect(sendB).toHaveBeenCalledWith('hello')

    disposeB()
  })

  it('未挂载发送器时暂存消息，挂载注册后自动派发', () => {
    const expand = vi.fn()
    setAgentToggleHandler({ expand })

    sendAgentMessage('测试延迟派发')
    expect(expand).toHaveBeenCalledTimes(1)

    const sendNow = vi.fn()
    const dispose = setAgentMessenger(sendNow)
    expect(sendNow).toHaveBeenCalledTimes(1)
    expect(sendNow).toHaveBeenCalledWith('测试延迟派发')

    dispose()
  })
})

function makeConv(over: Partial<Conversation> & { id: string }): Conversation {
  return {
    goalId: 'g1',
    messages: [],
    createdAt: 1000,
    updatedAt: 1000,
    ...over,
  }
}

describe('conversationList 排序与展示纯函数', () => {
  it('sortConversationsByTimeDesc 按最近对话时间降序排序（updatedAt 与消息 ts 优先）', () => {
    const olderCreatedButRecentReply = makeConv({
      id: 'c1',
      createdAt: 1000,
      updatedAt: 5000,
    })
    const newestCreated = makeConv({
      id: 'c2',
      createdAt: 4000,
      updatedAt: 4000,
    })
    const messageNewerThanUpdated = makeConv({
      id: 'c3',
      createdAt: 2000,
      updatedAt: 2000,
      messages: [
        { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }], ts: 8000 },
      ],
    })

    expect(conversationTimeOf(messageNewerThanUpdated)).toBe(8000)
    const sorted = sortConversationsByTimeDesc([newestCreated, olderCreatedButRecentReply, messageNewerThanUpdated])
    expect(sorted.map((c) => c.id)).toEqual(['c3', 'c1', 'c2'])
  })

  it('displayConversationTitle 跳过隐藏系统指令', () => {
    const conv = makeConv({
      id: 'c-hidden',
      messages: [
        { id: 'm0', role: 'user', hidden: true, mark: '生成大纲', parts: [{ type: 'text', text: 'internal prompt' }], ts: 10 },
        { id: 'm1', role: 'user', parts: [{ type: 'text', text: '什么是定冠词和不定冠词？' }], ts: 20 },
      ],
    })
    expect(displayConversationTitle(conv)).toBe('什么是定冠词和不定冠词？')

    const named = makeConv({ ...conv, id: 'c-named', title: '冠词入门' })
    expect(displayConversationTitle(named)).toBe('冠词入门')
  })

  it('formatConversationTime 在刚刚、同日、昨天与跨天时格式化正确', () => {
    const baseNow = new Date(2026, 10, 20, 15, 30, 0).getTime()
    expect(formatConversationTime(baseNow - 10_000, baseNow)).toBe('刚刚')

    const earlierToday = new Date(2026, 10, 20, 9, 5, 0).getTime()
    expect(formatConversationTime(earlierToday, baseNow)).toBe('09:05')

    const yesterday = new Date(2026, 10, 19, 21, 4, 0).getTime()
    expect(formatConversationTime(yesterday, baseNow)).toBe('昨天 21:04')

    const earlierMonth = new Date(2026, 9, 3, 8, 12, 0).getTime()
    expect(formatConversationTime(earlierMonth, baseNow)).toBe('10/03 08:12')
  })
})

describe('deleteConversation 与 repairAgentTabsAfterDelete 边界处理', () => {
  it('清空同目标唯一会话时同时清理 title/summary/messages', () => {
    const store = {
      goals: [{ id: 'g1', title: '英语', question: '英语', rootNodeId: 'n1', createdAt: 1, updatedAt: 1 }],
      nodes: [],
      conversations: [
        makeConv({
          id: 'c1',
          goalId: 'g1',
          title: '冠词练习',
          messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hello' }], ts: 10 }],
          summary: { at: 12, text: 'sum', tasks: [], messages: 1, chars: 5 },
          systemPrompt: 'sys',
        }),
      ],
      activeGoalId: 'g1',
      activeNodeId: 'n1',
      activeConversationId: 'c1',
      agentTabs: [{ kind: 'goal', goalId: 'g1', conversationId: 'c1' }],
      agentActiveTab: 'ga:g1:c1',
    } as unknown as LearnStore

    const after = deleteConversation(store, 'c1')
    expect(after.conversations).toHaveLength(1)
    expect(after.conversations[0].messages).toEqual([])
    expect(after.conversations[0].title).toBeUndefined()
    expect(after.conversations[0].summary).toBeUndefined()
    expect(after.conversations[0].systemPrompt).toBeUndefined()
  })

  it('删除当前激活目标会话后停留在同目标最新降序会话，不误跳到其他目标或丢掉 free', () => {
    const store = {
      goals: [
        { id: 'g1', title: '英语', question: '英语', rootNodeId: 'n1', createdAt: 1, updatedAt: 1 },
        { id: 'g2', title: '数学', question: '数学', rootNodeId: 'n2', createdAt: 2, updatedAt: 2 },
      ],
      nodes: [],
      conversations: [
        makeConv({ id: 'c1', goalId: 'g1', createdAt: 100, updatedAt: 100 }),
        makeConv({ id: 'c3', goalId: 'g2', createdAt: 300, updatedAt: 300 }),
      ],
      activeGoalId: 'g1',
      activeNodeId: 'n1',
      activeConversationId: 'c1',
      agentTabs: [
        { kind: 'goal', goalId: 'g2', conversationId: 'c3' },
        { kind: 'goal', goalId: 'g1', conversationId: 'c2' },
      ],
      agentActiveTab: 'ga:g1:c2',
    } as unknown as LearnStore

    const repaired = repairAgentTabsAfterDelete(store, {
      deletedConvId: 'c2',
      deletedGoalId: 'g1',
      fallbackConvId: 'c1',
    })
    expect(repaired.agentActiveTab).toBe('ga:g1:c1')

    const freePreserved = repairAgentTabsAfterDelete(
      { ...store, agentActiveTab: 'free' },
      { deletedConvId: 'c2', deletedGoalId: 'g1', fallbackConvId: 'c1' },
    )
    expect(freePreserved.agentActiveTab).toBe('free')
  })
})

describe('AgentRosterSidebar 交互渲染（竖栏 / 顶部栏 / 嵌套子对话列表）', () => {
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    localStorage.clear()
  })

  it('AgentRosterSidebar 渲染「仅聊天」与「导师」两个选项并支持切换', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const onSelectMode = vi.fn()

    act(() => {
      root.render(
        createElement(AgentRosterSidebar, {
          mode: 'tutor',
          onSelectMode,
          activeGoalTitle: '零基础英语语法入门',
          voiceStats: { free: { running: true, hasAsk: false } },
        }),
      )
    })

    const tabs = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
    expect(tabs).toHaveLength(7)
    expect(tabs[0].textContent).toContain('聊天龟')
    expect(tabs[1].textContent).toContain('调度龟')
    expect(tabs[2].textContent).toContain('导师龟')
    expect(tabs[3].textContent).toContain('出卷龟')
    expect(tabs[4].textContent).toContain('设计龟')
    expect(tabs[5].textContent).toContain('调研龟')
    expect(tabs[6].textContent).toContain('维修龟')
    expect(tabs[2].textContent).toContain('零基础英语语法入门')
    expect(tabs[0].getAttribute('aria-selected')).toBe('false')
    expect(tabs[2].getAttribute('aria-selected')).toBe('true')

    act(() => {
      tabs[0].click()
    })
    expect(onSelectMode).toHaveBeenCalledWith('free')

    act(() => {
      root.unmount()
    })
    host.remove()
  })

  it('AgentRosterSidebar 顶部栏形态（variant=top）：横排声部按钮 + 当前声部近况，无折叠语义', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const onSelectMode = vi.fn()

    act(() => {
      root.render(
        createElement(AgentRosterSidebar, {
          variant: 'top',
          mode: 'free',
          onSelectMode,
          activeGoalTitle: '零基础英语语法入门',
          voiceStats: { tutor: { running: false, hasAsk: true, count: 3 } },
        }),
      )
    })

    // 顶部栏形态有自己的识别标记，且不再有折叠语义
    const bar = host.querySelector('[data-roster-top="true"]')
    expect(bar).not.toBeNull()
    expect(bar?.getAttribute('data-roster-collapsed')).toBeNull()

    const tabs = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
    expect(tabs).toHaveLength(7)
    expect(tabs[0].getAttribute('aria-selected')).toBe('true')
    expect(tabs[1].getAttribute('aria-selected')).toBe('false')

    // 近况位只显示当前声部（free）的预览；未激活的导师摘要不出现在顶部栏
    expect(bar?.textContent).toContain('纯对话 · 联网与日程')
    expect(bar?.textContent).not.toContain('零基础英语语法入门')

    act(() => {
      tabs[1].click()
    })
    expect(onSelectMode).toHaveBeenCalledWith('dispatcher')
    act(() => {
      tabs[2].click()
    })
    expect(onSelectMode).toHaveBeenCalledWith('tutor')

    act(() => {
      root.unmount()
    })
    host.remove()
  })

  it('AgentRosterSidebar 工作上下文块（下块）：只显示当前 agent 的 work，点击打开 work 页签', () => {
    const onOpenWork = vi.fn()
    const work = (id: string, name: string, at: number, extra: Partial<WorkSession> = {}): WorkSession => ({
      id,
      name,
      roleId: 'free',
      roleConversationId: 'f-new',
      status: 'idle',
      runs: 1,
      createdAt: at,
      lastActiveAt: at,
      runtimeMs: 0,
      systemPrompt: '',
      messages: [],
      execTrace: [],
      ...extra,
    })
    const worksByAgent = {
      free: [work('w-free-new', '整理自由聊天', 9000, { runs: 2, lastDelivery: '交付一' }), work('w-free-old', '旧工作', 1000)],
      tutor: [work('w-tutor', '推导极限', 8000, { roleId: 'tutor', roleConversationId: 't-1', status: 'running' })],
    }

    const propsFor = (mode: 'free' | 'tutor') =>
      createElement(AgentRosterSidebar, {
        mode,
        onSelectMode: () => {},
        activeGoalTitle: '线性代数',
        voiceStats: {},
        worksByAgent,
        onOpenWork,
        activeGoalId: 'g1',
        goals: [],
        goalTitleOf: () => '',
      })

    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    act(() => {
      root.render(propsFor('free'))
    })

    // 下块只渲染当前 agent（free）的 work；导师的 work 不出现
    expect(host.querySelector('[data-roster-work-list="free"]')).not.toBeNull()
    expect(host.querySelector('[data-roster-work-list="tutor"]')).toBeNull()
    const rows = [...host.querySelectorAll<HTMLElement>('[data-work-id]')]
    expect(rows.map((r) => r.dataset.workId)).toEqual(['w-free-new', 'w-free-old'])
    expect(host.textContent).toContain('2 次任务')
    expect(host.textContent).toContain('交付一')

    act(() => {
      host.querySelector<HTMLButtonElement>('[data-work-id="w-free-old"]')!.click()
    })
    expect(onOpenWork).toHaveBeenCalledWith('free', 'w-free-old')

    // role 层每个 agent 只有一段会话，下块不再提供新建 / 选择 / 删除对话
    expect(host.querySelector('[data-conversation-id]')).toBeNull()
    expect([...host.querySelectorAll<HTMLButtonElement>('button')].some((b) => b.textContent?.includes('新建对话'))).toBe(false)

    act(() => {
      root.unmount()
    })
    host.remove()

    // 切到导师声部：下块整体换成导师的 work
    const host2 = document.createElement('div')
    document.body.appendChild(host2)
    const root2 = createRoot(host2)
    act(() => {
      root2.render(propsFor('tutor'))
    })
    expect(host2.querySelector('[data-roster-work-list="tutor"]')).not.toBeNull()
    expect(host2.querySelector('[data-roster-work-list="free"]')).toBeNull()
    expect(host2.textContent).toContain('运行中')
    act(() => {
      host2.querySelector<HTMLButtonElement>('[data-work-id="w-tutor"]')!.click()
    })
    expect(onOpenWork).toHaveBeenCalledWith('tutor', 'w-tutor')

    act(() => {
      root2.unmount()
    })
    host2.remove()
  })
  it('聊天列表预览与标题剥掉 HTML/SVG/围栏代码等渲染态内容（占位符 + 纯文本）', () => {
    const svgConv = {
      id: 'c-svg',
      goalId: 'g1',
      messages: [
        {
          id: 'm1',
          role: 'assistant' as const,
          parts: [
            {
              type: 'text' as const,
              text:
                '<svg viewBox="0 0 10 10"><path d="M0 0"/></svg>\n' +
                '先看这张图，再看下面的代码：\n' +
                '```html\n<div class="x">示例</div>\n```\n' +
                '结论：向量 <b>不会被拉伸</b>，准确率 < 90%。',
            },
          ],
          ts: 1000,
        },
      ],
      createdAt: 1000,
      updatedAt: 1000,
    }
    const preview = lastMessagePreview(svgConv)
    expect(preview).toContain('[图]')
    expect(preview).toContain('[代码]')
    expect(preview.startsWith('[图] 先看这张图')).toBe(true)
    expect(preview).not.toContain('<svg')
    expect(preview).not.toContain('<div')
    expect(preview).not.toContain('```')

    // 比较文本（< 后没有紧跟字母）不被当成标签剥掉
    const cmpConv = {
      id: 'c-cmp',
      goalId: 'g1',
      messages: [
        { id: 'm1', role: 'user' as const, parts: [{ type: 'text' as const, text: '准确率 < 90%，这算达标吗？' }], ts: 1000 },
      ],
      createdAt: 1000,
      updatedAt: 1000,
    }
    expect(displayConversationTitle(cmpConv)).toBe('准确率 < 90%，这算达标吗？')

    // 未闭合的围栏：尾巴整体算代码，不漏原文
    const unclosed = {
      id: 'c-unclosed',
      goalId: 'g1',
      messages: [
        { id: 'm1', role: 'assistant' as const, parts: [{ type: 'text' as const, text: '答案如下：\n```xml<svg/>' }], ts: 1000 },
      ],
      createdAt: 1000,
      updatedAt: 1000,
    }
    expect(lastMessagePreview(unclosed)).not.toContain('<svg')

    // 标题走同一条纯文本管线：首条用户消息里的 HTML 被剥掉
    const titleConv = {
      id: 'c-title',
      goalId: 'g1',
      messages: [
        {
          id: 'm1',
          role: 'user' as const,
          parts: [{ type: 'text' as const, text: '什么是 <b>定冠词</b>？附图 <img src="a.png">' }],
          ts: 1000,
        },
      ],
      createdAt: 1000,
      updatedAt: 1000,
    }
    expect(displayConversationTitle(titleConv)).toBe('什么是 定冠词？附图')

    // Markdown 图片（data URL 也一样）压成占位；链接只留文字
    const mdConv = {
      id: 'c-md',
      goalId: 'g1',
      messages: [
        {
          id: 'm1',
          role: 'assistant' as const,
          parts: [{ type: 'text' as const, text: '![图示](data:image/svg+xml;base64,AAAA) 见 [文档](docs/a.md)' }],
          ts: 1000,
        },
      ],
      createdAt: 1000,
      updatedAt: 1000,
    }
    const mdPreview = lastMessagePreview(mdConv)
    expect(mdPreview).toContain('[图]')
    expect(mdPreview).toContain('见 文档')
    expect(mdPreview).not.toContain('data:image')
  })

  it('AgentRosterSidebar 联系人卡片展示最近消息摘要与会话计数，且 lastMessagePreview 过滤内部隐藏消息', () => {
    const conv = {
      id: 'c-preview',
      goalId: 'g1',
      messages: [
        { id: 'm1', role: 'user' as const, parts: [{ type: 'text' as const, text: '请问什么是特征向量' }], ts: 1000 },
        { id: 'm2', role: 'assistant' as const, parts: [{ type: 'text' as const, text: '特征向量是在线性变换下只发生缩放的非零向量' }], ts: 2000 },
        { id: 'm3', role: 'user' as const, hidden: true, parts: [{ type: 'text' as const, text: '内部指令' }], ts: 3000 },
      ],
      createdAt: 1000,
      updatedAt: 2000,
    }
    expect(lastMessagePreview(conv)).toContain('特征向量是在线性变换下只发生缩放的非零向量')

    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    act(() => {
      root.render(
        createElement(AgentRosterSidebar, {
          mode: 'free',
          onSelectMode: () => {},
          activeGoalTitle: '线性代数',
          voiceStats: {
            free: { running: false, hasAsk: false, preview: '跨目标自由聊消息', lastTime: Date.now() - 10_000, count: 3 },
            tutor: { running: false, hasAsk: false, preview: '在线等导师回答', lastTime: Date.now() - 120_000, count: 2 },
          },
        }),
      )
    })

    expect(host.textContent).toContain('跨目标自由聊消息')
    expect(host.textContent).toContain('在线等导师回答')
    expect(host.textContent).toContain('跨目标')
    expect(host.textContent).toContain('学习导师')
    expect(
      isAgentTeamVisible(
        {
          docArea: {
            focus: 'g1',
            layout: { kind: 'group', group: 'g1' },
            groups: [
              { id: 'g1', active: 'team:g2', tabs: [{ id: 'team:g2', ref: { kind: 'agentTeam', goalId: 'g2' }, createdAt: 1 }] },
            ],
          },
        } as unknown as LearnStore,
        'g1',
      ),
    ).toBe(false)

    act(() => {
      root.unmount()
    })
    host.remove()
  })
})

describe('AgentRosterSidebar 智能体设置按钮与名称覆盖', () => {
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    localStorage.clear()
  })

  it('竖栏：设置入口在名册卡头像上，点击回传声部 id；头像与徽章颜色常亮', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const onOpenSettings = vi.fn()
    act(() => {
      root.render(
        createElement(AgentRosterSidebar, {
          mode: 'free',
          onSelectMode: () => {},
          activeGoalTitle: null,
          voiceStats: {},
          agentNames: { tutor: '小导师' },
          onOpenSettings,
        }),
      )
    })

    // 名册卡头像即设置入口：7 位声部各一枚；历史块不再有齿轮
    const avatars = [...host.querySelectorAll<HTMLButtonElement>('[data-agent-avatar]')]
    expect(avatars).toHaveLength(7)
    expect(host.querySelectorAll('[data-agent-settings]')).toHaveLength(0)
    expect(host.textContent).toContain('小导师')

    act(() => {
      avatars[0]!.click()
    })
    expect(onOpenSettings).toHaveBeenCalledWith('free')
    act(() => {
      avatars[2]!.click()
    })
    expect(onOpenSettings).toHaveBeenCalledWith('tutor')

    // 颜色常亮：未选中的声部（tutor）头像与角色徽章也用各自的配色，不退灰
    const tutorAvatar = host.querySelector<HTMLElement>('[data-agent-avatar="tutor"]')!
    expect(tutorAvatar.className).toContain('sky-500/15')
    const tutorBadge = [...host.querySelectorAll<HTMLElement>('span')].find((s) => s.textContent === '学习导师')!
    expect(tutorBadge.className).toContain('sky-500')

    act(() => {
      root.unmount()
    })
    host.remove()
  })

  it('顶部栏：当前声部一枚设置按钮（窄宽度形态）', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const onOpenSettings = vi.fn()
    act(() => {
      root.render(
        createElement(AgentRosterSidebar, {
          mode: 'tutor',
          onSelectMode: () => {},
          activeGoalTitle: '微积分',
          voiceStats: {},
          variant: 'top',
          onOpenSettings,
        }),
      )
    })

    const gears = [...host.querySelectorAll<HTMLButtonElement>('[data-agent-settings]')]
    expect(gears).toHaveLength(1)
    expect(gears[0]!.getAttribute('data-agent-settings')).toBe('tutor')
    expect(gears[0]!.getAttribute('aria-label')).toBe('智能体设置')

    act(() => {
      gears[0]!.click()
    })
    expect(onOpenSettings).toHaveBeenCalledWith('tutor')

    act(() => {
      root.unmount()
    })
    host.remove()
  })
})

describe('AgentSettingsView 智能体独立设置页', () => {
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    localStorage.clear()
  })

  const tutorRow: WorkflowRow = {
    id: 'exam',
    name: '出卷',
    description: '',
    instruction: 'x',
    createdAt: 1,
    updatedAt: 1,
    tier: 'builtin',
    runnable: false,
  }

  const buttonByText = (host: HTMLElement, text: string): HTMLButtonElement | null =>
    [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === text) ?? null

  /** 触发一次下拉选择（happy-dom + React 受控 select） */
  const pickSelect = (select: HTMLSelectElement, value: string): void => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!
    setValue.call(select, value)
    act(() => {
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
  }

  it('渲染六节内容；改名 / 选头像 / 选档位都回传覆盖字段', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const onChange = vi.fn()
    act(() => {
      root.render(
        createElement(AgentSettingsView, {
          agentId: 'tutor',
          profile: {},
          onChange,
          onReset: () => {},
          onClose: () => {},
          flowRows: [tutorRow],
        }),
      )
    })

    for (const title of ['身份', '提供商 · 模型', '思考强度', 'execute 开放的 api', '工作层的工作流', '系统提示词']) {
      expect(host.textContent).toContain(title)
    }
    // 系统提示词按分段展示：所有 pre 组合成完整提示词文本
    const presText = Array.from(host.querySelectorAll('pre')).map((p) => p.textContent).join('\n')
    expect(presText).toContain('智能导师助手')
    expect(presText).toContain('api.work.create')
    expect(presText).not.toContain('内置工作流与任务规程')

    // 改名（受控 input）
    const nameInput = host.querySelector<HTMLInputElement>('input[type="text"]')!
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setValue.call(nameInput, '小导师')
    act(() => {
      nameInput.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(onChange).toHaveBeenCalledWith({ name: '小导师' })

    // 选头像（aria-pressed 的图标按钮）
    const botAvatar = host.querySelector<HTMLButtonElement>('button[title="机器人"]')!
    expect(botAvatar).toBeTruthy()
    act(() => {
      botAvatar.click()
    })
    expect(onChange).toHaveBeenCalledWith({ avatar: 'bot' })

    // 选思考档位
    const low = host.querySelector<HTMLButtonElement>('button[title="快，短问答与批注"]')!
    expect(low).toBeTruthy()
    act(() => {
      low.click()
    })
    expect(onChange).toHaveBeenCalledWith({ effort: 'low' })

    act(() => {
      root.unmount()
    })
    host.remove()
  })

  it('api 节是纯只读能力清单：全部恒开放、无增删入口、旧设置被无视', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const onChange = vi.fn()
    act(() => {
      root.render(
        createElement(AgentSettingsView, {
          agentId: 'tutor',
          // 旧版本存下的白名单数据：视图直接无视，不渲染成可移除行
          profile: { apiGroups: ['web', 'node'] } as AgentProfile,
          onChange,
          onReset: () => {},
          onClose: () => {},
          flowRows: [],
        }),
      )
    })

    // 固定组 / 非固定组分开列，全部恒开放；没有任何移除按钮、没有添加下拉
    expect(host.textContent).toContain('固定 · 恒开放')
    expect(host.textContent).toContain('固定组')
    expect(host.textContent).toContain('非固定组')
    expect(host.textContent).toContain('role 层不直接持有领域能力')
    expect([...host.querySelectorAll<HTMLButtonElement>('button[aria-label^="移除"]')]).toHaveLength(0)
    expect(host.querySelector('[data-api-add]')).toBeNull()
    // role 的固定面只有 tmp / work / chat + compact（help 恒在），领域组一律不在
    const codeKeys = [...host.querySelectorAll('[data-api-section] code')].map((c) => c.textContent)
    for (const key of ['api.tmp', 'api.work', 'api.chat', 'api.compact', 'api.help']) {
      expect(codeKeys.filter((k) => k === key)).toHaveLength(1)
    }
    for (const key of ['api.node', 'api.wait', 'api.exam', 'api.classroom', 'api.web', 'api.browser']) {
      expect(codeKeys.some((k) => k === key)).toBe(false)
    }
    // 工作层只读：固定面与按 role 派生面都直接来自架构，没有任何增删入口
    const workLayer = host.querySelector('[data-work-layer]')
    expect(workLayer?.textContent).toContain('工作层（work）')
    expect(workLayer?.textContent).toContain('api.host')
    expect([...workLayer!.querySelectorAll('button')]).toHaveLength(0)
    // 旧设置被无视：不触发任何 onChange
    expect(onChange).not.toHaveBeenCalled()

    act(() => {
      root.unmount()
    })
    host.remove()
  })

  it('工作流白名单：内置行锁死；登记工作流的添加 / 移除 / 恢复', () => {
    const teachRow: WorkflowRow = { ...tutorRow, id: 'teach-node', name: '开讲' }
    const customRow: WorkflowRow = { ...tutorRow, id: 'wf_custom', name: '课前摸底', tier: 'goal' }

    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const onChange = vi.fn()
    act(() => {
      root.render(
        createElement(AgentSettingsView, {
          agentId: 'tutor',
          profile: {},
          onChange,
          onReset: () => {},
          onClose: () => {},
          flowRows: [tutorRow, teachRow, customRow],
        }),
      )
    })

    // 分工面内的内置行（开讲）恒在且锁死（默认态没有任何移除按钮）；下拉只列登记条目
    //（不在分工面里的内置规程——出卷——连展示都没有，更进不了下拉）
    expect(host.textContent).toContain('开讲')
    expect(host.textContent).toContain('未添加任何项：登记的工作流全部可用（本 role 的内置规程面恒开放）。')
    expect([...host.querySelectorAll<HTMLButtonElement>('button[aria-label^="移除"]')]).toHaveLength(0)
    const add = host.querySelector<HTMLSelectElement>('[data-wf-add]')!
    expect([...add.options].map((o) => o.value).filter(Boolean)).toEqual(['wf_custom'])

    pickSelect(add, 'wf_custom')
    expect(onChange).toHaveBeenCalledWith({ workflows: ['wf_custom'] })

    act(() => {
      root.unmount()
    })
    host.remove()

    // 显式清单：登记行可移除，恢复全部可用清回 undefined
    const host2 = document.createElement('div')
    document.body.appendChild(host2)
    const root2 = createRoot(host2)
    const onChange2 = vi.fn()
    act(() => {
      root2.render(
        createElement(AgentSettingsView, {
          agentId: 'tutor',
          profile: { workflows: ['wf_custom'] },
          onChange: onChange2,
          onReset: () => {},
          onClose: () => {},
          flowRows: [tutorRow, teachRow, customRow],
        }),
      )
    })

    act(() => {
      host2.querySelector<HTMLButtonElement>('button[aria-label="移除 wf_custom"]')!.click()
    })
    expect(onChange2).toHaveBeenCalledWith({ workflows: [] })

    act(() => {
      [...host2.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === '恢复全部可用')!.click()
    })
    expect(onChange2).toHaveBeenCalledWith({ workflows: undefined })

    act(() => {
      root2.unmount()
    })
    host2.remove()
  })

  it('系统提示词预览恒定：api 速查与内置规程全量在场（旧白名单数据被无视）', () => {
    const render = (profile: Partial<AgentProfile>, agentId: AgentTeamMode = 'tutor') => {
      const host = document.createElement('div')
      document.body.appendChild(host)
      const root = createRoot(host)
      act(() => {
        root.render(
          createElement(AgentSettingsView, {
            agentId,
            profile,
            onChange: () => {},
            onReset: () => {},
            onClose: () => {},
            flowRows: [tutorRow],
          }),
        )
      })
      const pre = Array.from(host.querySelectorAll('pre')).map((p) => p.textContent).join('\n\n')
      act(() => {
        root.unmount()
      })
      host.remove()
      return pre
    }

    // 导师 role 全文恒定：只留人格 / 分诊 / 固定 API，执行规程不在
    const text = render({ apiGroups: ['web'] } as AgentProfile)
    expect(text).toContain("'examiner'")
    expect(text).toContain("'designer'")
    expect(text).toContain('你是「归一 Unyra」的导师龟')
    expect(text).toContain('api.work.create')
    expect(text).not.toContain('【开讲】教学文档生成（teach-node）')
    expect(text).not.toContain('#### api.node')
    expect(text).not.toContain('#### api.exam')
    expect(text).not.toContain('【出卷】试卷命题（exam）')

    // 命题官 role：领域规程与 api 全部在 work，role 预览不再出现
    const examinerText = render({}, 'examiner')
    expect(examinerText).toContain('api.work.create')
    expect(examinerText).not.toContain('【出卷】试卷命题（exam）')
    expect(examinerText).not.toContain('【阅卷】判分与讲解（exam-grade）')
    expect(examinerText).not.toContain('#### api.exam')
    expect(examinerText.startsWith(SHARED_AGENT_PREFIX)).toBe(true)

    // 维修员 role：修图规程在 work，不在 role
    const fixerText = render({}, 'fixer')
    expect(fixerText).not.toContain('【修复函数图像】Plot 错误快速纠偏（plot-fix）')
    expect(fixerText.startsWith(SHARED_AGENT_PREFIX)).toBe(true)

    // 仅聊天 role：只有 work / chat，联网与日程在 work
    const freeText = render({}, 'free')
    expect(freeText).toContain('api.work.create')
    expect(freeText).toContain('api.chat.send')
    expect(freeText).not.toContain('api.web.search')
    expect(freeText).not.toContain('api.schedule.*')
  })

  it('返回对话与恢复默认两个出口', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const onClose = vi.fn()
    const onReset = vi.fn()
    act(() => {
      root.render(
        createElement(AgentSettingsView, {
          agentId: 'tutor',
          profile: {},
          onChange: () => {},
          onReset,
          onClose,
          flowRows: [],
        }),
      )
    })

    act(() => {
      buttonByText(host, '返回对话')!.click()
    })
    expect(onClose).toHaveBeenCalledTimes(1)
    act(() => {
      buttonByText(host, '恢复默认')!.click()
    })
    expect(onReset).toHaveBeenCalledTimes(1)

    act(() => {
      root.unmount()
    })
    host.remove()
  })

  it('仅聊天：api 只有联网与日程两组，工作流节显示通道缺失说明', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    act(() => {
      root.render(
        createElement(AgentSettingsView, {
          agentId: 'free',
          profile: {},
          onChange: () => {},
          onReset: () => {},
          onClose: () => {},
          flowRows: [],
        }),
      )
    })

    // 仅聊天：能力面由架构固定——两行内置恒开放、没有可添加项；工作流节是通道缺失说明
    expect(host.textContent).toContain('由架构固定')
    expect(host.querySelector('[data-api-add]')).toBeNull()
    expect(host.querySelector('button[aria-label="移除 web"]')).toBeNull()
    expect(host.textContent).toContain('没有工作流通道')
    // 自由聊天的系统提示词是 buildFreeChatSystem，不含导师规程
    const pre = host.querySelector('pre')
    expect(pre?.textContent).not.toContain('内置工作流与任务规程')

    act(() => {
      root.unmount()
    })
    host.remove()
  })
})

describe('AgentSlot 对话历史切换回归', () => {
  beforeEach(async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    localStorage.clear()
    goalConvByGoal.clear()
    await hydrateFreeChat(null)
  })

  it('点导师：当前停在声部会话（调度员）时，必须打开导师自己的会话而不是留在声部会话上', () => {
    const tutorConv = makeConv({
      id: 't1',
      goalId: 'g1',
      title: '导师讨论',
      messages: [{ id: 'mt', role: 'user', parts: [{ type: 'text', text: '导师的对话内容' }], ts: 1000 }],
      channels: [
        {
          id: 'cht',
          kind: 'user',
          direction: 'in',
          from: { kind: 'user', id: 'user', name: '用户' },
          to: { kind: 'role', id: 'tutor', name: '导师龟' },
          text: '导师的对话内容',
          ts: 1000,
        },
      ] as Conversation['channels'],
      createdAt: 1000,
      updatedAt: 1000,
    })
    const dispatcherConv = makeConv({
      id: 'd1',
      goalId: 'g1',
      voice: 'dispatcher',
      title: '调度讨论',
      messages: [{ id: 'md', role: 'user', parts: [{ type: 'text', text: '调度员的对话内容' }], ts: 2000 }],
      channels: [
        {
          id: 'chd',
          kind: 'user',
          direction: 'in',
          from: { kind: 'user', id: 'user', name: '用户' },
          to: { kind: 'role', id: 'dispatcher', name: '调度员' },
          text: '调度员的对话内容',
          ts: 2000,
        },
      ] as Conversation['channels'],
      createdAt: 2000,
      updatedAt: 2000,
    })
    const initialStore = {
      goals: [{ id: 'g1', title: '微积分', question: '微积分', rootNodeId: 'n1', createdAt: 1, updatedAt: 1 }],
      nodes: [
        {
          id: 'n1',
          goalId: 'g1',
          title: '极限',
          key: '极限',
          description: '',
          docs: { teaching: { content: '', updatedAt: 1 } },
          notes: [],
          annotations: [],
          status: 'learning',
          origin: 'user',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      conversations: [tutorConv, dispatcherConv],
      exams: [],
      resources: {},
      activeGoalId: 'g1',
      activeNodeId: 'n1',
      // 用户此刻正停在调度员的会话上
      activeConversationId: 'd1',
      agentTabs: [{ kind: 'goal', goalId: 'g1', conversationId: 'd1' }],
      agentActiveTab: 'ga:g1:d1',
      docArea: { focus: 'g-main', layout: { kind: 'group', group: 'g-main' }, groups: [{ id: 'g-main', active: null, tabs: [] }] },
      drafts: {},
      docScroll: {},
      localFiles: [],
    } as unknown as LearnStore

    let latestStore = initialStore
    const getLatest = () => latestStore
    const writeStore = (next: LearnStore) => {
      latestStore = next
    }

    function Harness() {
      const [store, setStore] = useState<LearnStore>(initialStore)
      const set = (next: LearnStore) => {
        writeStore(next)
        setStore(next)
      }

      const actions = useAgentTabActions({
        getLatest,
        set,
        onToast: () => {},
        setSidebarOpen: () => {},
        runningByConversation: {},
      })

      const agentTabs = store.agentTabs
      const agentPanes = useMemo(() => [...(agentTabs ?? [])], [agentTabs])
      const activeAgentTab = useMemo(() => {
        const tabs = agentTabs ?? []
        return tabs.find((t) => agentTabKey(t) === store.agentActiveTab) ?? tabs[0] ?? freeTabStub
      }, [store.agentActiveTab, agentTabs])

      const deps: AgentSlotDeps = {
        store,
        getLatest,
        set,
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
        agentPanes,
        activeAgentTab,
        activeAgentTabId: agentTabKey(activeAgentTab),
        activateAgentTab: actions.activateAgentTab,
        openAgentTab: actions.openAgentTab,
        selectTutorGoal: actions.selectTutorGoal,
        handleNewGoalConversation: actions.handleNewGoalConversation,
        removeConversation: actions.removeConversation,
        newConversationIn: actions.newConversationIn,
        selectConversationIn: actions.selectConversationIn,
        pruneImagesOf: actions.pruneImagesOf,
        startSuperLab: () => {},
        newExam: () => {},
        shouldWaitInLine: () => false,
        tabGoalId: 'g1',
      }

      return createElement(AgentSlot, { deps })
    }

    const freeTabStub = { kind: 'free' } as AgentTabRef
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)

    act(() => {
      root.render(createElement(Harness))
    })

    const visiblePaneText = () => {
      const panes = [...host.querySelectorAll<HTMLElement>('.moji-tab-transition')]
      return panes.map((p) => p.textContent ?? '').join('\n')
    }

    // 初始停在调度员的会话上
    expect(visiblePaneText()).toContain('调度员的对话内容')

    // 点 roster 里的「导师」行（副标题「主讲与协调」唯一标识它）
    // roster 的导师行：roleTag「学习导师」是它的唯一标识（副标题会被最近预览顶掉）
    const tutorRow = [...host.querySelectorAll<HTMLButtonElement>('button[role="tab"]')].find((b) =>
      (b.textContent ?? '').includes('学习导师'),
    )!
    expect(tutorRow).toBeTruthy()
    act(() => {
      tutorRow.click()
    })

    // 打开的必须是导师自己的会话
    expect(visiblePaneText()).toContain('导师的对话内容')
    expect(visiblePaneText()).not.toContain('调度员的对话内容')

    act(() => {
      root.unmount()
    })
    host.remove()
  })
})
