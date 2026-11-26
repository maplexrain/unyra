// @vitest-environment happy-dom
/**
 * 内置提示词只读页：字符数、文字可选、预览/只读源码切换，以及返回智能体页按钮。
 *
 * SourceEditor 换成轻量桩：这里验的是页面把「只读 + 原正文」交给编辑器，
 * CodeMirror 自己的挂载与 Vim 行为不在这个组件测试的范围里。
 */
import { createElement, act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../src/components/learn/SourceEditor', async () => {
  const React = await import('react')
  return {
    default: (props: { value: string; readOnly?: boolean }) =>
      React.createElement(
        'div',
        {
          'data-test-source-editor': 'true',
          'data-read-only': String(props.readOnly),
        },
        props.value,
      ),
  }
})

import { PromptFileView } from '../src/components/learn/agent-team/PromptFileView'
import { listPromptFiles } from '../src/learn/ai/promptFiles'
import { DEFAULT_AGENT_SETTINGS } from '../src/agent/settings'

function firstRoleFile() {
  const file = listPromptFiles('tutor', 'role', DEFAULT_AGENT_SETTINGS.promptFiles)[0]
  expect(file).toBeTruthy()
  return file
}

function renderView(onBack?: () => void) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  const file = firstRoleFile()
  act(() => {
    root.render(
      createElement(PromptFileView, {
        agentId: 'tutor',
        layer: 'role',
        fileId: file.id,
        ...(onBack ? { onBack } : {}),
      }),
    )
  })
  return { host, root, file }
}

function cleanup(host: HTMLElement, root: ReturnType<typeof createRoot>) {
  act(() => {
    root.unmount()
  })
  host.remove()
}

describe('PromptFileView', () => {
  it('顶部显示字符数，正文可选，返回按钮右对齐且可关闭', () => {
    const onBack = vi.fn()
    const { host, root, file } = renderView(onBack)

    expect(host.querySelector('[data-prompt-char-count]')?.textContent).toBe(
      `${file.content.length} 字符`,
    )
    expect(host.querySelector('[data-prompt-preview-body]')?.className).toContain(
      'moji-selectable',
    )
    const outlineItems = host.querySelectorAll('[data-prompt-outline-item]')
    expect(outlineItems.length).toBeGreaterThan(1)
    expect(host.querySelectorAll('[data-prompt-block]').length).toBe(outlineItems.length)
    expect(host.querySelector('[data-prompt-outline]')?.textContent).toContain('目录')

    act(() => {
      (outlineItems[1] as HTMLButtonElement).click()
    })
    expect(outlineItems[1]?.getAttribute('aria-current')).toBe('true')

    expect(host.querySelector('[data-prompt-back]')).not.toBeNull()
    expect(host.querySelector('[data-prompt-actions]')?.className).toContain('ml-auto')

    act(() => {
      host.querySelector<HTMLButtonElement>('[data-prompt-back]')?.click()
    })
    expect(onBack).toHaveBeenCalledOnce()

    cleanup(host, root)
  })

  it('顶部一键复制整份提示词正文', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    const { host, root, file } = renderView()

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-prompt-copy]')?.click()
      await Promise.resolve()
    })

    expect(writeText).toHaveBeenCalledWith(file.content)
    expect(host.querySelector('[data-prompt-copy]')?.textContent).toContain('已复制')

    cleanup(host, root)
  })

  it('能切到只读源码模式，并把原正文交给编辑器', () => {
    const { host, root, file } = renderView()

    act(() => {
      host.querySelector<HTMLButtonElement>('[data-prompt-mode="source"]')?.click()
    })

    expect(host.querySelector('[data-prompt-preview-body]')).toBeNull()
    const source = host.querySelector('[data-prompt-source]')
    expect(source?.className).toContain('moji-selectable')
    const editor = host.querySelector('[data-test-source-editor]')
    expect(editor?.getAttribute('data-read-only')).toBe('true')
    expect(editor?.textContent).toBe(file.content)

    act(() => {
      host.querySelector<HTMLButtonElement>('[data-prompt-mode="preview"]')?.click()
    })
    expect(host.querySelector('[data-prompt-source]')).toBeNull()
    expect(host.querySelector('[data-prompt-preview-body]')).not.toBeNull()

    cleanup(host, root)
  })
})
