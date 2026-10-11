import { describe, expect, it } from 'vitest'
import type { DependencyEdge, KnowledgeNode, LearnStore } from '../src/learn/types'
import { conceptKeysOf } from '../src/components/learn/workspace/panes'
import { countVisibleWordsFromHtml } from '../src/lib/wordCount'
import { buildDirectedDistanceMaps } from '../src/components/learn/TabBar'
import { residentIds } from '../src/learn/resident'

describe('文档区 Tab 切换性能基准测试与瓶颈验证', () => {
  it('测试瓶颈 1: conceptKeysOf 在没有缓存时的重复遍历与新建 Set 开销', () => {
    // 构造模拟包含 500 个知识节点的 store
    const nodes = Array.from({ length: 500 }, (_, i) => ({
      id: `node-${i}`,
      goalId: i < 250 ? 'goal-1' : 'goal-2',
      title: `知识点 ${i}`,
      key: `concept-key-${i}`,
      kind: 'concept',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      description: '',
      docs: { teaching: '' },
      notes: [],
      annotations: [],
    })) as unknown as KnowledgeNode[]
    const mockStore = { nodes } as unknown as LearnStore
    const testNode = nodes[0]

    const runs = 1000
    const t0 = performance.now()
    let lastSet: Set<string> | null = null
    let identicalReferenceCount = 0

    for (let i = 0; i < runs; i++) {
      const s = conceptKeysOf(mockStore, testNode)
      if (s === lastSet) identicalReferenceCount++
      lastSet = s
    }
    const elapsed = performance.now() - t0

    console.log(`\n[conceptKeysOf 1000 次调用耗时]: ${elapsed.toFixed(2)} ms`)
    console.log(`[Set 引用相同次数 (期望命中缓存)]: ${identicalReferenceCount} / ${runs}`)

    // 优化后命中率应为 100%（除了第 1 次创建，其余 999 次全命中）
    expect(identicalReferenceCount).toBe(runs - 1)
  })

  it('测试瓶颈 2: countVisibleWords 针对包含公式和代码的大文档的解析与重排开销', () => {
    // 构造一份带有 100 个段落和公式的 HTML
    const htmlSnippet = `
      <div class="note-preview">
        <h2>第 1 章 微积分与导数</h2>
        <p>这是正文说明文字，包含一些分析。局部线性化与极限。</p>
        <span class="katex"><span class="katex-mathml"><math><semantics><mrow><mi>x</mi></mrow></semantics></math></span><span class="katex-html">...</span></span>
        <div class="moji-run-menu">复制/运行</div>
      </div>
    `
    const largeHtml = htmlSnippet.repeat(100)

    const t0 = performance.now()
    const runs = 20
    for (let i = 0; i < runs; i++) {
      countVisibleWordsFromHtml(largeHtml)
    }
    const elapsed = performance.now() - t0
    console.log(`\n[countVisibleWordsFromHtml 20次耗时]: ${elapsed.toFixed(2)} ms (平均每次 ${(elapsed / runs).toFixed(2)} ms)`)
  })

  it('测试瓶颈 3: 常驻上限 RESIDENT_MAX 较小时切页签的命中率', () => {
    const openTabs = ['tab-1', 'tab-2', 'tab-3', 'tab-4', 'tab-5', 'tab-6', 'tab-7', 'tab-8']
    // 模拟在 8 个页签中按顺序点击
    const sequence = [
      'tab-1', 'tab-2', 'tab-3', 'tab-4', 'tab-5',
      'tab-1', 'tab-2', 'tab-3', 'tab-6', 'tab-7',
      'tab-1', 'tab-8', 'tab-4', 'tab-5', 'tab-2'
    ]

    function simulateResident(cap: number) {
      let recent: string[] = []
      let cacheHits = 0
      for (const tab of sequence) {
        // 检查当前 tab 是否已经在常驻集合中
        const currentResidents = residentIds(openTabs, [recent[0] || ''], recent, cap)
        if (currentResidents.includes(tab)) {
          cacheHits++
        }
        recent = [tab, ...recent.filter((id) => id !== tab)].slice(0, cap)
      }
      return { cacheHits, total: sequence.length, hitRate: (cacheHits / sequence.length * 100).toFixed(1) + '%' }
    }

    const res4 = simulateResident(4)
    const res8 = simulateResident(8)
    const res12 = simulateResident(12)

    console.log(`\n[常驻上限 CAP=4 模拟命中率]: ${res4.hitRate} (${res4.cacheHits}/${res4.total})`)
    console.log(`[常驻上限 CAP=8 模拟命中率]: ${res8.hitRate} (${res8.cacheHits}/${res8.total})`)
    console.log(`[常驻上限 CAP=12 模拟命中率]: ${res12.hitRate} (${res12.cacheHits}/${res12.total})`)

    expect(res8.cacheHits).toBeGreaterThan(res4.cacheHits)
  })

  it('测试瓶颈 4: buildDirectedDistanceMaps 重复计算拓扑图', () => {
    // 构造一个包含 200 个节点的有向依赖图
    const edges: DependencyEdge[] = []
    for (let i = 0; i < 199; i++) {
      edges.push({ from: `node-${i}`, to: `node-${i + 1}`, createdAt: Date.now() })
      if (i % 5 === 0 && i + 10 < 200) {
        edges.push({ from: `node-${i}`, to: `node-${i + 10}`, createdAt: Date.now() })
      }
    }

    const t0 = performance.now()
    const runs = 200
    for (let i = 0; i < runs; i++) {
      const baseNodeId = `node-${i % 20}`
      buildDirectedDistanceMaps(edges, baseNodeId)
    }
    const elapsed = performance.now() - t0
    console.log(`\n[buildDirectedDistanceMaps 200次执行耗时]: ${elapsed.toFixed(2)} ms`)
  })
})
