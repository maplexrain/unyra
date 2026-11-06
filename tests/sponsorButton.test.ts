// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import SponsorButton from '../src/components/sponsor/SponsorButton'
import * as sponsorDoc from '../src/lib/sponsorDoc'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

describe('SponsorButton 赞助按钮与悬浮赞赏浮层', () => {
  it('正常渲染顶栏赞助按钮，点击后弹出展示发光赞赏码、鸣谢指引与克制真诚说明（不刻意卖惨或提失业）', async () => {
    vi.spyOn(sponsorDoc, 'fetchLatestSponsorsMarkdown').mockResolvedValue({
      ok: true,
      content: sponsorDoc.getInitialSponsorsMarkdown(),
      fromRemote: true,
    })

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    act(() => {
      root.render(React.createElement(SponsorButton))
    })

    // 1. 按钮存在且包含文字「赞助」
    const btn = container.querySelector('button') as HTMLButtonElement | null
    expect(btn).toBeTruthy()
    expect(btn?.textContent).toContain('赞助')
    expect(btn?.getAttribute('title')).toBe('赞助支持')

    // 初始状态下弹窗未挂载
    expect(container.querySelector('[role="dialog"]')).toBeNull()

    // 2. 模拟点击按钮展开弹层
    await act(async () => {
      btn?.click()
      await new Promise((r) => setTimeout(r, 20))
    })

    const dialog = container.querySelector('[role="dialog"]') as HTMLDivElement | null
    expect(dialog).toBeTruthy()

    // 3. 验证浮层包含关键内容
    // 项目名称必须是「归一 unyra」
    expect(dialog?.textContent).toContain('归一 unyra')

    // 适度、真诚，坚决不卖惨、不刻意提及失业或焦虑
    expect(dialog?.textContent).not.toContain('失业')
    expect(dialog?.textContent).not.toContain('焦虑')
    expect(dialog?.textContent).toContain('如果你觉得「归一」对你的学习和思考有所帮助')

    // 赞赏码图片存在
    const img = dialog?.querySelector('img')
    expect(img).toBeTruthy()
    expect(img?.getAttribute('alt')).toBe('Maxwell 的赞赏码')

    // 赞助者留名与联系方式提醒（克制的一行小提示）
    expect(dialog?.textContent).toContain('赞赏时可备注想留在致谢名单上的称呼或联系方式')

    // 4. 验证应用内打开赞助者名单文件的超链接按钮
    const openSponsorsSpy = vi.spyOn(sponsorDoc, 'openSponsorsTab').mockImplementation(() => {})
    const openDocBtn = Array.from(dialog?.querySelectorAll('button') ?? []).find((b) =>
      b.textContent?.includes('查看赞助者名单与致谢记录'),
    ) as HTMLButtonElement | undefined
    expect(openDocBtn).toBeTruthy()

    act(() => {
      openDocBtn?.click()
    })
    expect(openSponsorsSpy).toHaveBeenCalledTimes(1)

    // 5. 验证第二栏：赞助名单、最近赞助日期展示与排序切换
    expect(dialog?.textContent).toContain('赞助名单')
    expect(dialog?.textContent).toContain('最近赞助日期')
    expect(dialog?.textContent).toContain('2026-11-04')
    expect(dialog?.textContent).toContain('源自 GitHub 官方仓库')

    // 验证刷新按钮
    const refreshBtn = Array.from(dialog?.querySelectorAll('button') ?? []).find(
      (b) =>
        b.getAttribute('title')?.includes('GitHub') ||
        b.textContent?.includes('刷新') ||
        b.textContent?.includes('同步'),
    ) as HTMLButtonElement | undefined
    expect(refreshBtn).toBeTruthy()

    // 默认降序排序：最新赞助者（陈继华，2026-11-04）排在第一位，最早赞助者（瑞宝，2026-10-27）排在后部
    const sortBtn = Array.from(dialog?.querySelectorAll('button') ?? []).find(
      (b) => b.textContent?.includes('最新') || b.textContent?.includes('最早'),
    ) as HTMLButtonElement | undefined
    expect(sortBtn).toBeTruthy()
    expect(sortBtn?.textContent).toContain('最新在前')

    // 检查默认降序下陈继华排在瑞宝前面
    const contentText = dialog?.textContent || ''
    const idxChen = contentText.indexOf('陈继华')
    const idxRui = contentText.indexOf('瑞宝')
    expect(idxChen).toBeGreaterThan(-1)
    expect(idxRui).toBeGreaterThan(-1)
    expect(idxChen).toBeLessThan(idxRui)

    // 点击排序按钮切换为升序
    act(() => {
      sortBtn?.click()
    })
    expect(sortBtn?.textContent).toContain('最早在前')

    // 检查升序后瑞宝排在陈继华前面
    const ascContentText = dialog?.textContent || ''
    const ascIdxChen = ascContentText.indexOf('陈继华')
    const ascIdxRui = ascContentText.indexOf('瑞宝')
    expect(ascIdxRui).toBeLessThan(ascIdxChen)

    // 清理
    act(() => {
      root.unmount()
    })
    container.remove()
  })
})
