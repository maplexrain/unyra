// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import React, { act, createRef } from 'react'
import { createRoot } from 'react-dom/client'
import { SelectionMenuPopup, type SelectionMenu } from '../src/components/learn/note/selectionMenu'
import { addAnnotation } from '../src/learn/graph/annotations'
import type { LearnStore } from '../src/learn/types'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

describe('SelectionMenuPopup mark action & annotation persistence', () => {
  const dummyMenu: SelectionMenu = {
    x: 100,
    anchorTop: 50,
    anchorBottom: 80,
    text: '高亮测试文本',
    term: '高亮测试文本',
    occurrence: 0,
    concept: true,
    loc: { start: 0, end: 6 },
  }

  it('renders mark action button with hotkey 5', () => {
    const runAction = vi.fn()
    const menuRef = createRef<HTMLDivElement>()
    const inputRef = createRef<HTMLInputElement>()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    act(() => {
      root.render(
        React.createElement(SelectionMenuPopup, {
          menu: dummyMenu,
          pending: false,
          menuRef,
          inputRef,
          asking: false,
          question: '',
          setQuestion: () => {},
          setAsking: () => {},
          menuClosing: false,
          runAction,
          submitAsk: () => {},
        })
      )
    })

    const markBtn = container.querySelector('button[data-hotkey="5"]') as HTMLButtonElement | null
    expect(markBtn).not.toBeNull()
    expect(markBtn!.textContent).toContain('标记')
    expect(markBtn!.textContent).toContain('5')

    act(() => {
      markBtn!.click()
    })
    expect(runAction).toHaveBeenCalledWith('mark')

    act(() => {
      root.unmount()
    })
    container.remove()
  })

  it('allows adding empty body annotation for mark note', () => {
    const initialStore: LearnStore = {
      nodes: [
        {
          id: 'n1',
          title: '测试节点',
          key: '测试节点',
          description: '',
          docs: { teaching: '高亮测试文本' },
          notes: [],
          annotations: [],
          status: 'learning',
          origin: 'user',
          goalId: 'g1',
          createdAt: 1000,
          updatedAt: 1000,
        },
      ],
      goals: [],
      docScroll: {},
      schedule: {},
      favorites: [],
    } as any

    const updated = addAnnotation(initialStore, 'n1', '高亮测试文本', '', 'note', undefined, 0)
    const node = updated.nodes.find((n) => n.id === 'n1')
    expect(node).toBeDefined()
    expect(node!.annotations.length).toBe(1)
    expect(node!.annotations[0].term).toBe('高亮测试文本')
    expect(node!.annotations[0].body).toBe('')
    expect(node!.annotations[0].kind).toBe('note')
  })
})
