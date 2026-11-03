// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import SponsorsDoc from '../src/components/sponsor/SponsorsDoc'
import {
  SPONSORS_CACHE_KEY,
  getInitialSponsorsMarkdown,
  isValidSponsorMarkdown,
  fetchLatestSponsorsMarkdown,
} from '../src/lib/sponsorDoc'
import * as nativeModule from '../src/lib/native'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

describe('SponsorDoc 动态致谢名单与数据拉取', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('isValidSponsorMarkdown 准确验证赞助者名单内容', () => {
    expect(isValidSponsorMarkdown('')).toBe(false)
    expect(isValidSponsorMarkdown(null)).toBe(false)
    expect(isValidSponsorMarkdown('短文本')).toBe(false)
    expect(
      isValidSponsorMarkdown(
        '# 归一 (unyra) · 特别致谢与赞助者名单\n\n| 赞助者 | 渠道 | 日期 |\n| 瑞宝 | 微信 | 2026-10-27 |',
      ),
    ).toBe(true)
  })

  it('getInitialSponsorsMarkdown 优先返回本地缓存，无缓存时回退至内置兜底', () => {
    const fallback = getInitialSponsorsMarkdown()
    expect(fallback).toContain('赞助者名单')

    const mockCustom = '# 归一 (unyra) · 特别致谢与赞助者名单\n\n新赞助者：测试用户A'
    localStorage.setItem(SPONSORS_CACHE_KEY, mockCustom)
    expect(getInitialSponsorsMarkdown()).toBe(mockCustom)
  })

  it('fetchLatestSponsorsMarkdown 成功拉取远程名单并自动写入 localStorage 缓存', async () => {
    const remoteContent =
      '# 归一 (unyra) · 特别致谢与赞助者名单\n\n| 赞助者 | 渠道 |\n| 远程新赞助者 | 微信 |'

    // 模拟原生 web.fetch 返回成功
    const nativeSpy = vi.spyOn(nativeModule, 'native').mockReturnValue({
      web: {
        fetch: vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          text: remoteContent,
        }),
      },
    } as any)

    const res = await fetchLatestSponsorsMarkdown(['https://example.com/docs/sponsors.md'])
    expect(res.ok).toBe(true)
    expect(res.content).toBe(remoteContent)
    expect(res.fromRemote).toBe(true)
    expect(localStorage.getItem(SPONSORS_CACHE_KEY)).toBe(remoteContent)
    expect(nativeSpy).toHaveBeenCalled()
  })

  it('SponsorsDoc 组件渲染、挂载自动同步、手动刷新与导出 Markdown', async () => {
    const remoteContent =
      '# 归一 (unyra) · 特别致谢与赞助者名单\n\n| 赞助者 | 渠道 |\n| 用户小明 | 微信 |'

    vi.spyOn(nativeModule, 'native').mockReturnValue({
      web: {
        fetch: vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          text: remoteContent,
        }),
      },
      saveText: vi.fn().mockResolvedValue({ ok: true }),
    } as any)

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(React.createElement(SponsorsDoc))
      // 允许 useEffect 内部微任务执行完毕
      await new Promise((r) => setTimeout(r, 20))
    })

    // 1. 验证标题与渲染的 Markdown HTML 内容包含拉取到的赞助者
    expect(container.textContent).toContain('赞助者名单与特别鸣谢')
    expect(container.textContent).toContain('用户小明')

    // 2. 找到刷新按钮与导出按钮
    const buttons = Array.from(container.querySelectorAll('button'))
    const refreshBtn = buttons.find((b) => b.textContent?.includes('刷新'))
    const exportBtn = buttons.find((b) => b.textContent?.includes('导出 Markdown'))
    expect(refreshBtn).toBeTruthy()
    expect(exportBtn).toBeTruthy()

    // 3. 模拟点击刷新按钮
    await act(async () => {
      refreshBtn?.click()
      await new Promise((r) => setTimeout(r, 20))
    })
    expect(container.textContent).toContain('已同步最新名单')

    // 4. 模拟点击导出按钮
    await act(async () => {
      exportBtn?.click()
      await new Promise((r) => setTimeout(r, 20))
    })

    // 清理
    act(() => {
      root.unmount()
    })
    container.remove()
  })
})
