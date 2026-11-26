// @vitest-environment happy-dom
/**
 * 设置页系统提示词列表：列表下方必须显示运行时同一份拼接结果。
 */
import { createElement, act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { PromptFilesView } from '../src/components/learn/agent-team/PromptFilesView'
import { buildPromptFileSystem } from '../src/learn/ai/promptFiles'
import { DEFAULT_PROMPT_FILE_SETTINGS } from '../src/agent/promptFiles'

describe('PromptFilesView', () => {
  it('在文件列表下显示拼接后的提示词预览', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    act(() => {
      root.render(
        createElement(PromptFilesView, {
          agentId: 'tutor',
          settings: DEFAULT_PROMPT_FILE_SETTINGS,
          onChange: vi.fn(),
        }),
      )
    })
    const expected = buildPromptFileSystem('tutor', 'role', DEFAULT_PROMPT_FILE_SETTINGS)
    const preview = host.querySelector('[data-prompt-preview] pre')
    expect(preview).not.toBeNull()
    expect(preview?.textContent?.trim().slice(0, 40)).toBe(expected.trim().slice(0, 40))
    expect(host.querySelector('[data-prompt-preview]')?.textContent).toContain('拼接后的提示词预览')
    act(() => {
      root.unmount()
    })
    host.remove()
  })
})
