// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { useWorkflowStarters } from '../src/components/learn/workspace/useWorkflowStarters'
import { emptyLearnStore } from '../src/learn/store/empty'
import type { LearnStore } from '../src/learn/types'
import { outlineUuid } from '../src/learn/nodeKinds'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

function runHook<T>(hookFn: () => T): T {
  let value!: T
  function Component() {
    value = hookFn()
    return null
  }
  const div = document.createElement('div')
  const root = createRoot(div)
  act(() => {
    root.render(React.createElement(Component))
  })
  return value
}

describe('useWorkflowStarters: startGenerateOutline', () => {
  it('大纲挂在大纲 port 下点击生成总览：无论目标是否有 rootNodeId，都能成功启动大纲工作流并附带拆分 hint', () => {
    const baseStore: LearnStore = {
      ...emptyLearnStore(),
      goals: [
        {
          id: 'g1',
          question: '学习高等数学',
          rootNodeId: '', // 空字符串，模拟无有效根节点场景
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      nodes: [
        {
          id: 'n1',
          title: '高等数学导论',
          key: 'gaoshu',
          description: '',
          docs: { teaching: '' },
          notes: [],
          annotations: [],
          status: 'learning',
          origin: 'user',
          goalId: 'g1',
          createdAt: 1,
          updatedAt: 1,
          outline: {
            intro: '总览',
            children: [{ key: 'weijifen', title: '微积分分支', summary: '' }],
            updatedAt: 1,
          },
        },
      ],
      outlines: [
        {
          id: 'sub-outline-1',
          goalId: 'g1',
          title: '微积分细化拆分',
          intro: '',
          children: [],
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      edges: [
        // 父大纲 n1 的 'weijifen' 端口连接到子大纲 o:sub-outline-1
        {
          from: 'n1',
          to: outlineUuid('sub-outline-1'),
          portKey: 'weijifen',
          createdAt: 1,
        },
      ],
    }

    const runWorkflow = vi.fn()
    const onToast = vi.fn()
    const onOpenSettings = vi.fn()

    const starters = runHook(() =>
      useWorkflowStarters({
        getLatest: () => baseStore,
        set: vi.fn(),
        onToast,
        onOpenSettings,
        agent: { runWorkflow } as any,
        hasKey: true,
        providerName: 'DeepSeek',
        activeNode: null,
        activeNodeId: null,
        activeGoal: baseStore.goals[0],
        activeGoalId: 'g1',
        store: baseStore,
        setCreating: vi.fn(),
      }),
    )

    // 调用挂在大纲 port 下的子大纲的「生成总览」
    starters.startGenerateOutline(outlineUuid('sub-outline-1'))

    // 验证 runWorkflow 被成功调用（没有因为没有 rootNodeId 或 activeNode 为 null 而静默 return）
    expect(runWorkflow).toHaveBeenCalledTimes(1)
    const [wfId, opts] = runWorkflow.mock.calls[0]
    expect(wfId).toBe('outline')
    expect(opts.params.target).toBe(outlineUuid('sub-outline-1'))
    // 验证 hint 中包含了父大纲标题与认领的目标项标题，说明大纲挂在大纲 port 下的细化拆分语义
    expect(opts.hint).toContain('子大纲细化拆解')
    expect(opts.hint).toContain('高等数学导论')
    expect(opts.hint).toContain('微积分分支')
    expect(opts.hint).toContain('大纲连接大纲port的目的是对该目标项进行进一步细化与拆分')

    // 验证给出了 Toast 提示
    expect(onToast).toHaveBeenCalledWith(expect.stringContaining('微积分细化拆分'))
  })

  it('未配置 API Key 时阻断并弹出设置，不启动工作流', () => {
    const runWorkflow = vi.fn()
    const onToast = vi.fn()
    const onOpenSettings = vi.fn()

    const starters = runHook(() =>
      useWorkflowStarters({
        getLatest: () => emptyLearnStore(),
        set: vi.fn(),
        onToast,
        onOpenSettings,
        agent: { runWorkflow } as any,
        hasKey: false,
        providerName: 'OpenAI',
        activeNode: null,
        activeNodeId: null,
        activeGoal: null,
        activeGoalId: null,
        store: emptyLearnStore(),
        setCreating: vi.fn(),
      }),
    )

    starters.startGenerateOutline('o:test')
    expect(runWorkflow).not.toHaveBeenCalled()
    expect(onOpenSettings).toHaveBeenCalled()
    expect(onToast).toHaveBeenCalledWith(expect.stringContaining('API Key'))
  })
})
