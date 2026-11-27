// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

vi.mock('../src/lib/native', () => ({
  native: () => ({
    designPreview: {
      status: async () => ({ running: true, port: 51900, url: 'http://127.0.0.1:51900/', fileCount: 2 }),
      ensure: async () => ({ running: true, port: 51900, url: 'http://127.0.0.1:51900/', fileCount: 2 }),
    },
    shell: { openExternal: async () => true },
  }),
}))

import { DesignPanel } from '../src/components/settings/DesignPanel'

async function renderDesignPanel() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(<DesignPanel onToast={() => {}} />)
  })
  return {
    host,
    cleanup: async () => {
      await act(async () => root.unmount())
      host.remove()
    },
  }
}

describe('设置 → 设计页', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('左侧是资源列表，右侧是详情与预览，不再有源码弹窗', async () => {
    const { host, cleanup } = await renderDesignPanel()

    const panel = host.querySelector('[data-design-panel]') as HTMLElement
    expect(panel.className).toContain('h-full')
    expect(host.textContent).toContain('设计资源')
    expect(host.textContent).toContain('内置 · 只读')
    expect(host.textContent).toContain('带眉标的提示框')
    expect(host.textContent).toContain('详细信息')
    expect(host.textContent).toContain('组件预览')
    expect(host.textContent).toContain('预览服务 · 2 个外部文件')
    expect(host.querySelector('textarea')).toBeNull()
    expect(host.textContent).not.toContain('编辑源码')

    await cleanup()
  })

  it('四个资源库都能切换', async () => {
    const { host, cleanup } = await renderDesignPanel()
    const buttons = Array.from(host.querySelectorAll('button'))
    const classroom = buttons.find((b) => b.textContent?.trim() === '组件')
    expect(classroom).toBeTruthy()
    await act(async () => classroom!.click())
    expect(host.textContent).toContain('通用容器卡片')

    const animation = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.trim() === '动效')
    expect(animation).toBeTruthy()
    await act(async () => animation!.click())
    expect(host.textContent).toContain('晨雾浮升入场')

    await cleanup()
  })
})
