/**
 * 函数图像的**占位高度**（见 lib/markdown 的 plotReserve）。
 *
 * 为什么这值得一条用例：图画出来的那一刻会往正文里插进几百像素（最宽 720 → 446px），
 * 而它是稍后才画的（空闲时段 + 动态 import 绘图库）。占位期不把这块高度占住，
 * 正文就会在图补上来的瞬间整体长高，大纲跳转因此「点一次没反应、要点好几次」。
 * 这条用例钉住的就是那行预留——它要是没了，界面上那个毛病会原样回来。
 */
import { describe, expect, it, vi } from 'vitest'

// renderNote 里 DOMPurify.sanitize 需要 document（node 下没有）：换成直通
vi.mock('dompurify', () => ({ default: { sanitize: (html: string) => html } }))

import { renderNote } from '../src/lib/markdown'

/** 一段 plot 围栏：反引号写在常量里，免得这段源码自己把围栏截断 */
const FENCE = '```'
const fence = (json: string): string => FENCE + 'plot\n' + json + '\n' + FENCE

describe('函数图像的占位高度', () => {
  it('没写 height：按绘制比例留（宽 : 高 = 1 : 0.62）', () => {
    const html = renderNote(fence('{ "data": [{ "fn": "x^2" }] }'))
    expect(html).toContain('class="moji-plot-stage"')
    expect(html).toContain('aspect-ratio:1/0.62')
    expect(html).toContain('data-plot=')
  })

  it('写了 height：按那个像素高度留，比例就不用了', () => {
    const html = renderNote(fence('{ "height": 320, "data": [{ "fn": "sin(x)" }] }'))
    expect(html).toContain('min-height:320px')
    expect(html).not.toContain('aspect-ratio')
  })

  it('JSON 读不出来：不留高度（错误卡片自己撑开），也不写出坏属性', () => {
    const html = renderNote(fence('{ 这不是 JSON'))
    expect(html).toContain('class="moji-plot"')
    expect(html).toContain('moji-plot-stage')
    expect(html).not.toContain('aspect-ratio')
    expect(html).not.toContain('min-height')
  })
})
