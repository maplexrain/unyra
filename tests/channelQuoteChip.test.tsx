/** 引用条：摘要折叠规则 + 点击回调跳转目标 id */
// @vitest-environment happy-dom
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChannelQuoteChip, quoteInfoOf, stripChannelQuoteBlock } from '../src/components/agent/panel/ChannelQuoteChip'

const roots: Array<{ root: ReturnType<typeof createRoot>; host: HTMLDivElement }> = []
afterEach(() => {
  for (const { root, host } of roots) {
    act(() => root.unmount())
    host.remove()
  }
  roots.length = 0
})

describe('ChannelQuoteChip', () => {
  it('摘要折叠空白并截断，作者取被引消息的发送者', () => {
    const info = quoteInfoOf({
      text: '第一段\n\n  第二段   ' + '很长的引用内容'.repeat(20),
      from: { name: '导师龟' },
    })
    expect(info.fromName).toBe('导师龟')
    expect(info.text).not.toContain('\n')
    expect(info.text.startsWith('第一段 第二段')).toBe(true)
    expect(info.text.endsWith('…')).toBe(true)
    expect(info.text.length).toBeLessThanOrEqual(89)
  })

  it('空正文按表单 / 图片 / 文件给占位', () => {
    expect(quoteInfoOf({ text: '  ', from: { name: 'A' }, ask: {} }).text).toBe('［表单］')
    expect(quoteInfoOf({ text: '', from: { name: 'A' }, attachments: { images: [{}] } }).text).toBe('［图片］')
    expect(quoteInfoOf({ text: '', from: { name: 'A' }, attachments: { files: [{}] } }).text).toBe('［文件］')
  })

  it('用户界面只保留引用条，气泡正文末尾的内部引用块要剪掉', () => {
    expect(stripChannelQuoteBlock('一张网图，测通道用。\n\n【引用 【用户通道 · Maxwell · 2026-11-27 20:37:47】】\n继续啊？')).toBe(
      '一张网图，测通道用。',
    )
    expect(stripChannelQuoteBlock('正文里提到【引用】两个字，但不是块')).toBe('正文里提到【引用】两个字，但不是块')
    expect(stripChannelQuoteBlock('【引用 【用户通道 · Maxwell · 2026-11-27 20:37:47】】\n只引用')).toBe('')
  })

  it('点击引用条把目标消息 id 交给宿主定位', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    roots.push({ root, host })
    const onJump = vi.fn()
    act(() => {
      root.render(
        createElement(ChannelQuoteChip, {
          quoteId: 'msg-42',
          info: { fromName: '学习者', text: '上次那句' },
          onJump,
        }),
      )
    })
    const chip = host.querySelector('[data-quote-message-id="msg-42"]') as HTMLButtonElement
    act(() => chip.click())
    expect(onJump).toHaveBeenCalledWith('msg-42')
    expect(host.textContent).toContain('学习者')
    expect(host.textContent).toContain('上次那句')
  })
})
