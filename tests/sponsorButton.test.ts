// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import SponsorButton from '../src/components/sponsor/SponsorButton'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

describe('SponsorButton 赞助按钮与悬浮赞赏浮层', () => {
  it('正常渲染顶栏赞助按钮，点击后弹出展示赞赏码、鸣谢指引与作者真诚心声', () => {
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
    expect(btn?.getAttribute('title')).toBe('赞助支持作者')

    // 初始状态下弹窗未挂载
    expect(container.querySelector('[role="dialog"]')).toBeNull()

    // 2. 模拟点击按钮展开弹层
    act(() => {
      btn?.click()
    })

    const dialog = container.querySelector('[role="dialog"]') as HTMLDivElement | null
    expect(dialog).toBeTruthy()

    // 3. 验证浮层包含关键内容
    // 标题与心声
    expect(dialog?.textContent).toContain('支持 Moji Notes 独立开发')
    expect(dialog?.textContent).toContain('你好，我是作者 Maxwell')
    expect(dialog?.textContent).toContain('抵御疲倦、持续优化性能与加速功能迭代')

    // 赞赏码图片
    const img = dialog?.querySelector('img')
    expect(img).toBeTruthy()
    expect(img?.getAttribute('alt')).toBe('Maxwell 的赞赏码')

    // 赞助者留名与联系方式提醒
    expect(dialog?.textContent).toContain('赞助者备注与特别致谢')
    expect(dialog?.textContent).toContain('想留在致谢名单上的称呼')
    expect(dialog?.textContent).toContain('联系方式')

    // 清理
    act(() => {
      root.unmount()
    })
    container.remove()
  })
})
