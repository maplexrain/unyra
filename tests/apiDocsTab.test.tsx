// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { ApiDocsTab } from '../src/components/agent-settings/ApiDocsTab'

async function renderApiDocs() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(<ApiDocsTab />)
  })
  return { host, cleanup: async () => act(async () => root.unmount()) }
}

describe('Execute API 文档页', () => {
  it('从注册表列出分组与 API，且不出现 api.api 前缀', async () => {
    const { host, cleanup } = await renderApiDocs()
    expect(host.textContent).toContain('Execute API')
    expect(host.textContent).toContain('智能体名录')
    expect(host.textContent).toContain('api.agent.list()')
    expect(host.textContent).not.toContain('api.api.')
    const root = host.querySelector('[data-api-docs]') as HTMLElement
    expect(root.className).toContain('h-full')
    expect(root.className).not.toContain('overflow-y-auto')
    const nav = root.querySelector('aside nav') as HTMLElement
    const main = root.querySelector('main') as HTMLElement
    expect(nav.className).toContain('overflow-y-auto')
    expect(main.className).toContain('overflow-y-auto')
    await cleanup()
  })
})
