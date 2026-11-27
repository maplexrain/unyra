/** 思维列表的联网工具卡：搜索查询、来源展开、阅读页面与失败态 */
// @vitest-environment happy-dom
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { WebToolBlock } from '../src/components/agent/panel/WebToolBlock'
import type { ServerToolCall } from '../src/ai/types'

const roots: Array<{ root: ReturnType<typeof createRoot>; host: HTMLDivElement }> = []
afterEach(() => {
  for (const { root, host } of roots) {
    act(() => root.unmount())
    host.remove()
  }
  roots.length = 0
})

function render(call: ServerToolCall): HTMLElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  roots.push({ root, host })
  act(() => root.render(createElement(WebToolBlock, { call })))
  return host
}

describe('WebToolBlock', () => {
  it('搜索卡显示查询词和来源数，展开后列出可点击来源', () => {
    const host = render({
      id: 's1',
      type: 'server_tool',
      kind: 'web_search',
      action: { type: 'search', queries: ['DeepSeek 联网搜索 文档'] },
      status: 'completed',
      step: 0,
      sources: [
        { url: 'https://api-docs.deepseek.com/zh-cn/guides/web_tools/', title: '联网搜索', siteName: 'DeepSeek', snippet: '服务端工具说明' },
      ],
    })
    const card = host.querySelector('[data-web-tool="true"]') as HTMLElement
    expect(card.getAttribute('data-web-tool-kind')).toBe('web_search')
    expect(card.getAttribute('data-web-tool-status')).toBe('completed')
    expect(host.textContent).toContain('DeepSeek 联网搜索 文档')
    expect(host.textContent).toContain('1 条来源')
    expect(host.querySelector('a[href="https://api-docs.deepseek.com/zh-cn/guides/web_tools/"]')).toBeNull()

    act(() => (host.querySelector('button[aria-expanded]') as HTMLButtonElement).click())
    const link = host.querySelector('a[href="https://api-docs.deepseek.com/zh-cn/guides/web_tools/"]') as HTMLAnchorElement
    expect(link).not.toBeNull()
    expect(link.target).toBe('_blank')
    expect(host.textContent).toContain('服务端工具说明')
  })

  it('阅读页面卡显示标题与 URL；运行中显示进行中', () => {
    const host = render({
      id: 'r1',
      type: 'server_tool',
      kind: 'read_url',
      action: { type: 'read_link', url: 'https://example.com/post' },
      status: 'running',
      step: 1,
      page: { url: 'https://example.com/post', title: '一篇需要核对的原文', siteName: 'example.com' },
    })
    expect(host.querySelector('[data-web-tool-kind="read_url"]')).not.toBeNull()
    expect(host.textContent).toContain('阅读链接')
    expect(host.textContent).toContain('一篇需要核对的原文')
    expect(host.textContent).toContain('进行中')
    expect(host.querySelector('[data-web-tool-status="running"]')).not.toBeNull()
  })

  it('失败态显示错误码，不假装有来源', () => {
    const host = render({
      id: 'f1',
      type: 'server_tool',
      kind: 'web_search',
      action: { type: 'search', queries: ['超时查询'] },
      status: 'failed',
      step: 0,
      error: { code: 'timeout' },
    })
    expect(host.textContent).toContain('超时查询')
    expect(host.textContent).toContain('失败')
    const header = host.querySelector('button[aria-expanded]') as HTMLButtonElement
    expect(header).not.toBeNull()
    act(() => header.click())
    expect(host.textContent).toContain('请求失败（timeout）')
  })
})
