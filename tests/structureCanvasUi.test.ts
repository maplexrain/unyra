// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { StructureCanvas } from '../src/components/learn/structure/StructureCanvas'
import { emptyLearnStore } from '../src/learn/store/empty'
import type { LearnStore } from '../src/learn/types'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

function createTestStore(): LearnStore {
  const base = emptyLearnStore()
  return {
    ...base,
    goals: [{ id: 'g1', rootNodeId: 'node-root', question: '高数', createdAt: 1, updatedAt: 1 }],
    nodes: [
      {
        id: 'node-root',
        title: '第 0 站 · 工具箱重启：函数、三角与代数变形 先说个我自己的一段很长很长很长的标题',
        key: 'g1_root',
        description: '',
        docs: { teaching: '# 正文' },
        notes: [],
        annotations: [],
        status: 'learning',
        origin: 'user',
        goalId: 'g1',
        createdAt: 1,
        updatedAt: 1,
        outline: {
          intro: '',
          children: [
            {
              key: 'slot_1',
              title: '函数与定义域：先问「哪儿不舒服」一段超长超长超长目标项',
              summary: '',
            },
          ],
          updatedAt: 1,
        },
      },
    ],
  }
}

describe('StructureCanvas 节点宇宙 UI 优化测试', () => {
  it('节点列表卡移到顶部居中水平排列，只显示图标，悬停向下弹出 tip 显示类型', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    const store = createTestStore()

    act(() => {
      root.render(
        React.createElement(StructureCanvas, {
          store,
          goalId: 'g1',
          onChange: vi.fn(),
          docs: {} as any,
          exams: {} as any,
        }),
      )
    })

    const palette = container.querySelector('[data-tour="palette"]') as HTMLDivElement | null
    expect(palette).toBeTruthy()

    // 1. 验证位于顶部居中且水平排列
    expect(palette?.className).toContain('top-4')
    expect(palette?.className).toContain('left-1/2')
    expect(palette?.className).toContain('-translate-x-1/2')
    expect(palette?.className).toContain('items-center')

    // 2. 验证各个项目只显示图标，不显示常驻的类型 label，而是在 hover tip 中向下弹出
    const items = palette?.querySelectorAll('[data-palette-kind]')
    expect(items?.length).toBe(7)

    items?.forEach((item) => {
      // 包含图标
      const svg = item.querySelector('svg')
      expect(svg).toBeTruthy()

      // 按钮主体本身不含常驻 label 文本
      // tip 存在于 absolute left-1/2 top-full 元素中
      const tip = item.querySelector('span.pointer-events-none') as HTMLSpanElement | null
      expect(tip).toBeTruthy()
      expect(tip?.className).toContain('top-full')
      expect(tip?.className).toContain('group-hover/palette-item:opacity-100')
      expect(tip?.textContent?.trim().length).toBeGreaterThan(0)
    })

    act(() => {
      root.unmount()
    })
    container.remove()
  })

  it('鼠标经过节点标题和目标项时通过 title 属性显示完整标题', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    const store = createTestStore()

    act(() => {
      root.render(
        React.createElement(StructureCanvas, {
          store,
          goalId: 'g1',
          onChange: vi.fn(),
          docs: {} as any,
          exams: {} as any,
        }),
      )
    })

    // 1. 验证节点标题元素带有完整标题的 title 属性
    const fullTitle = '第 0 站 · 工具箱重启：函数、三角与代数变形 先说个我自己的一段很长很长很长的标题'
    const titleSpan = Array.from(container.querySelectorAll('span')).find(
      (el) => el.textContent?.includes('第 0 站'),
    )
    expect(titleSpan).toBeTruthy()
    expect(titleSpan?.getAttribute('title')).toBe(fullTitle)

    // 2. 验证大纲槽位也带有完整的 title 属性
    const slotTitle = '函数与定义域：先问「哪儿不舒服」一段超长超长超长目标项'
    const slotSpan = Array.from(container.querySelectorAll('span')).find(
      (el) => el.textContent?.includes('函数与定义域'),
    )
    expect(slotSpan).toBeTruthy()
    expect(slotSpan?.getAttribute('title')).toBe(slotTitle)

    act(() => {
      root.unmount()
    })
    container.remove()
  })
})
