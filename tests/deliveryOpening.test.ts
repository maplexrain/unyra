// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { KnowledgeNode, LearnStore } from '../src/learn/types'
import { normalizeKey } from '../src/learn/graph'
import { wsChipUserRel, tabRefFromChip } from '../src/learn/chipRef'
import { wsRefOfRel } from '../src/learn/workspace'
import { setChipOpener } from '../src/lib/docChip'
import { DeliveryBlock } from '../src/components/agent/panel/DeliveryBlock'
import type { DeliveryRecord } from '../src/agent/delivery'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

function fixtureStore(): LearnStore {
  const node = (id: string, title: string, goalId: string): KnowledgeNode =>
    ({ id, title, key: normalizeKey(title), goalId } as unknown as KnowledgeNode)
  return {
    nodes: [
      node('rootA', '高等数学', 'gA'),
      node('childA', '极限', 'gA'),
      node('rootB', '鹈鹕骑自行车 · 3D 动画工程', 'gB'),
      node('childB', '骨骼系统', 'gB'),
    ],
    edges: [
      { from: 'rootA', to: 'childA', createdAt: 0 },
      { from: 'rootB', to: 'childB', createdAt: 0 },
    ],
    goals: [
      { id: 'gA', rootNodeId: 'rootA', question: '高等数学', createdAt: 0, updatedAt: 0 },
      { id: 'gB', rootNodeId: 'rootB', question: '鹈鹕骑自行车 · 3D 动画工程', createdAt: 0, updatedAt: 0 },
    ],
    activeGoalId: 'gB',
  } as unknown as LearnStore
}

describe('交付组件与工作区文件引用打开 (Delivery & Workspace Opening)', () => {
  const store = fixtureStore()

  it('1. 解决用户真实反馈：workspace/... 开头的路径能够正确解析到目标根节点的工作区', () => {
    // 针对目标 gB（鹈鹕骑自行车 · 3D 动画工程）
    const rel1 = wsChipUserRel(store, 'workspace/pelican-bike-3d/src/rig/pose.ts', 'gB')
    expect(rel1).toBe('docs/鹈鹕骑自行车 · 3D 动画工程/workspace/pelican-bike-3d/src/rig/pose.ts')

    const tabRef1 = wsRefOfRel(store, rel1!)
    expect(tabRef1).toEqual({
      kind: 'ws',
      nodeId: 'rootB',
      seg: 'pelican-bike-3d/src/rig/pose.ts',
    })

    const rel2 = wsChipUserRel(store, 'workspace/pelican-bike-3d/src/validation/rigValidation.ts', 'gB')
    expect(rel2).toBe('docs/鹈鹕骑自行车 · 3D 动画工程/workspace/pelican-bike-3d/src/validation/rigValidation.ts')

    const tabRef2 = wsRefOfRel(store, rel2!)
    expect(tabRef2).toEqual({
      kind: 'ws',
      nodeId: 'rootB',
      seg: 'pelican-bike-3d/src/validation/rigValidation.ts',
    })
  })

  it('2. 支持带根标题的手写工作区路径，彻底乱拼的路径拒绝', () => {
    const rel = wsChipUserRel(store, '鹈鹕骑自行车 · 3D 动画工程/pelican-bike-3d/src/lib/ik.ts', 'gB')
    expect(rel).toBe('docs/鹈鹕骑自行车 · 3D 动画工程/workspace/pelican-bike-3d/src/lib/ik.ts')

    const tabRef = wsRefOfRel(store, rel!)
    expect(tabRef).toEqual({
      kind: 'ws',
      nodeId: 'rootB',
      seg: 'pelican-bike-3d/src/lib/ik.ts',
    })

    // 第一段对不上任何节点且非 workspace 开头时拒绝
    expect(wsChipUserRel(store, '乱写的目录/file.ts', 'gB')).toBeNull()
  })

  it('3. 支持工作区中的 Markdown 文件（如 workspace/pelican-bike-3d/README.md）作为内部工作区文件解析', () => {
    const rel = wsChipUserRel(store, 'workspace/pelican-bike-3d/README.md', 'gB')
    expect(rel).toBe('docs/鹈鹕骑自行车 · 3D 动画工程/workspace/pelican-bike-3d/README.md')

    const tabRef = wsRefOfRel(store, rel!)
    expect(tabRef).toEqual({
      kind: 'ws',
      nodeId: 'rootB',
      seg: 'pelican-bike-3d/README.md',
    })
  })

  it('4. 多目标隔离：指定不同 goalId 时，workspace 路径准确锚定各自目标，绝不混淆', () => {
    // 目标 A（高等数学）
    const relA = wsChipUserRel(store, 'workspace/calc.py', 'gA')
    expect(relA).toBe('docs/高等数学/workspace/calc.py')
    expect(wsRefOfRel(store, relA!)).toEqual({
      kind: 'ws',
      nodeId: 'rootA',
      seg: 'calc.py',
    })

    // 目标 B（鹈鹕骑自行车）
    const relB = wsChipUserRel(store, 'workspace/calc.py', 'gB')
    expect(relB).toBe('docs/鹈鹕骑自行车 · 3D 动画工程/workspace/calc.py')
    expect(wsRefOfRel(store, relB!)).toEqual({
      kind: 'ws',
      nodeId: 'rootB',
      seg: 'calc.py',
    })
  })

  it('5. tabRefFromChip 对 type: "ws" 能够完整反查出工作区内部文件页签', () => {
    const tabRef = tabRefFromChip(store, {
      type: 'ws',
      path: 'workspace/pelican-bike-3d/src/rig/apply.ts',
      goalId: 'gB',
    })

    expect(tabRef).toEqual({
      kind: 'ws',
      nodeId: 'rootB',
      seg: 'pelican-bike-3d/src/rig/apply.ts',
    })
  })

  it('6. 子节点工作区：在子节点下的工作区文件能够精准识别到子节点本身', () => {
    const rel = wsChipUserRel(store, '骨骼系统/ik.ts', 'gB')
    expect(rel).toBe('docs/鹈鹕骑自行车 · 3D 动画工程/骨骼系统/workspace/ik.ts')

    const tabRef = wsRefOfRel(store, rel!)
    expect(tabRef).toEqual({
      kind: 'ws',
      nodeId: 'childB',
      seg: 'ik.ts',
    })
  })

  it('7. DeliveryBlock 点击事件分流测试：准确分流到 openChipRef(ws / doc) 与 onOpenFile', async () => {
    const chipOpenerMock = vi.fn()
    setChipOpener(chipOpenerMock)

    const onOpenFileMock = vi.fn()

    const delivery: DeliveryRecord = {
      files: [
        { path: '鹈鹕骑自行车 · 3D 动画工程', action: 'created', note: '项目总览与实现拆解' },
        { path: 'workspace/pelican-bike-3d/src/rig/pose.ts', action: 'created', note: '姿态纯函数' },
        { path: 'pelican-bike-3d/src/lib/ik.ts', action: 'created', note: '解析两骨 IK' },
        { path: 'C:/external/file.txt', action: 'created', note: '外部磁盘文件' },
      ],
      sources: [],
    }

    const div = document.createElement('div')
    const root = createRoot(div)

    await act(async () => {
      root.render(
        React.createElement(DeliveryBlock, {
          delivery,
          goalId: 'gB',
          onOpenFile: onOpenFileMock,
        }),
      )
    })

    const buttons = div.querySelectorAll('button')
    expect(buttons).toHaveLength(4)

    // 点击 0：文档节点「鹈鹕骑自行车 · 3D 动画工程」
    await act(async () => {
      buttons[0].dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(chipOpenerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'doc',
        path: '鹈鹕骑自行车 · 3D 动画工程',
        goalId: 'gB',
      }),
    )

    // 点击 1：工作区文件「workspace/pelican-bike-3d/src/rig/pose.ts」
    await act(async () => {
      buttons[1].dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(chipOpenerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ws',
        path: 'workspace/pelican-bike-3d/src/rig/pose.ts',
        goalId: 'gB',
      }),
    )

    // 点击 2：手写相对路径「pelican-bike-3d/src/lib/ik.ts」
    await act(async () => {
      buttons[2].dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(chipOpenerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ws',
        path: 'pelican-bike-3d/src/lib/ik.ts',
        goalId: 'gB',
      }),
    )

    // 点击 3：外部磁盘绝对路径「C:/external/file.txt」
    await act(async () => {
      buttons[3].dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onOpenFileMock).toHaveBeenCalledWith('C:/external/file.txt', '外部磁盘文件')

    setChipOpener(null)
  })
})
