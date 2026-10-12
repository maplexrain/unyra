import { describe, expect, it } from 'vitest'
import { isDocumentTab, tabNodeId } from '../src/learn/tabs'
import { buildDirectedDistanceMaps, computeTabRelationWithMaps } from '../src/components/learn/TabBar'
import type { LearnStore, LearnTab, AgentTabRef } from '../src/learn/types'

describe('页签右键菜单项显示逻辑（无意义项不渲染）', () => {
  const makeTab = (id: string, ref: any): LearnTab => ({
    id,
    ref,
    createdAt: 1700000000000,
  })

  const mockStore = {
    nodes: [
      { id: 'node-root', title: '根概念' },
      { id: 'node-mid', title: '中间概念' },
    ],
    edges: [{ from: 'node-root', to: 'node-mid' }],
  } as unknown as LearnStore

  describe('文档区页签右键菜单', () => {
    it('只剩 1 个页签时：关闭其他、全部关闭及关联关闭均不应渲染', () => {
      const tabs = [makeTab('t-1', { kind: 'teach', nodeId: 'node-root' })]
      const otherCount = Math.max(0, tabs.length - 1)

      const targetTab = tabs[0]
      const targetBaseNodeId = tabNodeId(targetTab.ref)
      const { ancestorDistMap, descendantDistMap } = buildDirectedDistanceMaps(mockStore.edges, targetBaseNodeId)

      const unrelatedIds = tabs.filter((t) => {
        if (t.id === targetTab.id) return false
        const rel = computeTabRelationWithMaps(t, targetTab, ancestorDistMap, descendantDistMap)
        return rel.kind === 'none'
      }).map((t) => t.id)

      const childrenIds = tabs.filter((t) => {
        const rel = computeTabRelationWithMaps(t, targetTab, ancestorDistMap, descendantDistMap)
        return rel.kind === 'child'
      }).map((t) => t.id)

      const parentsIds = tabs.filter((t) => {
        const rel = computeTabRelationWithMaps(t, targetTab, ancestorDistMap, descendantDistMap)
        return rel.kind === 'parent'
      }).map((t) => t.id)

      const nonDocIds = tabs.length <= 1 ? [] : tabs.filter((t) => !isDocumentTab(t.ref)).map((t) => t.id)

      const hasRelationClose =
        unrelatedIds.length > 0 ||
        childrenIds.length > 0 ||
        parentsIds.length > 0 ||
        nonDocIds.length > 0

      // 仅剩 1 个时各选项判定
      expect(otherCount > 0).toBe(false) // 关闭其他不显示
      expect(tabs.length > 1).toBe(false) // 全部关闭不显示
      expect(hasRelationClose).toBe(false) // 关联关闭区不显示
    })

    it('多个页签时：仅在有实际匹配项时才显示对应关联关闭项，关闭其他与全部关闭正常显示', () => {
      const tabs = [
        makeTab('t-1', { kind: 'teach', nodeId: 'node-root' }),
        makeTab('t-2', { kind: 'teach', nodeId: 'node-mid' }),
        makeTab('t-3', { kind: 'web', key: 'web-1' }),
      ]
      const otherCount = Math.max(0, tabs.length - 1)
      const targetTab = tabs[0] // 根节点
      const targetBaseNodeId = tabNodeId(targetTab.ref)
      const { ancestorDistMap, descendantDistMap } = buildDirectedDistanceMaps(mockStore.edges, targetBaseNodeId)

      const unrelatedIds = tabs.filter((t) => {
        if (t.id === targetTab.id) return false
        const rel = computeTabRelationWithMaps(t, targetTab, ancestorDistMap, descendantDistMap)
        return rel.kind === 'none'
      }).map((t) => t.id)

      const childrenIds = tabs.filter((t) => {
        const rel = computeTabRelationWithMaps(t, targetTab, ancestorDistMap, descendantDistMap)
        return rel.kind === 'child'
      }).map((t) => t.id)

      const parentsIds = tabs.filter((t) => {
        const rel = computeTabRelationWithMaps(t, targetTab, ancestorDistMap, descendantDistMap)
        return rel.kind === 'parent'
      }).map((t) => t.id)

      const nonDocIds = tabs.length <= 1 ? [] : tabs.filter((t) => !isDocumentTab(t.ref)).map((t) => t.id)

      expect(otherCount > 0).toBe(true)
      expect(tabs.length > 1).toBe(true)
      expect(childrenIds.length > 0).toBe(true) // t-2 是子级，应当显示「关闭子级」
      expect(parentsIds.length > 0).toBe(false) // 没有父级，不应显示「关闭父级」
      expect(nonDocIds.length > 0).toBe(true) // t-3 是 web，应当显示「关闭非文档」
      expect(unrelatedIds.length > 0).toBe(true) // t-3 是无关联，应当显示「关闭无关联」
    })
  })

  describe('Agent 区页签右键菜单', () => {
    it('只剩 1 个可关闭导师页签（加固定聊天）时：不显示关闭其他与全部关闭', () => {
      const tabs: AgentTabRef[] = [
        { kind: 'free', conversationId: null },
        { kind: 'goal', goalId: 'g1', conversationId: 'c1' },
      ]
      const closableCount = tabs.filter((t) => t.kind !== 'free').length
      const otherCount = Math.max(0, closableCount - 1)

      expect(closableCount).toBe(1)
      expect(otherCount > 0).toBe(false) // 关闭其他 / 关闭其他（强制）不渲染
      expect(closableCount > 1).toBe(false) // 全部关闭不渲染
    })

    it('有多个可关闭导师页签时：关闭其他与全部关闭正常渲染，计数排除固定聊天', () => {
      const tabs: AgentTabRef[] = [
        { kind: 'free', conversationId: null },
        { kind: 'goal', goalId: 'g1', conversationId: 'c1' },
        { kind: 'goal', goalId: 'g2', conversationId: 'c2' },
      ]
      const closableCount = tabs.filter((t) => t.kind !== 'free').length
      const otherCount = Math.max(0, closableCount - 1)

      expect(closableCount).toBe(2)
      expect(otherCount).toBe(1)
      expect(otherCount > 0).toBe(true) // 渲染关闭其他
      expect(closableCount > 1).toBe(true) // 渲染全部关闭
    })
  })
})
