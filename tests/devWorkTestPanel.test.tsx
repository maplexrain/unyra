// @vitest-environment happy-dom
/** 开发者控制台的 work 内嵌状态测试面板：按钮能渲染真实组件并轮换样例。 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { DevWorkTestPanel } from '../src/components/developer/DevWorkTestPanel'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function render() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => root.render(createElement(DevWorkTestPanel)))
  return { host, root }
}

describe('DevWorkTestPanel', () => {
  it('点击渲染测试后，在示例消息气泡里渲染 WorkInline，并轮换三种状态', () => {
    const { host, root } = render()
    expect(host.textContent).toContain('组件测试')
    expect(host.textContent).toContain('尚未渲染')

    const button = host.querySelector('button')
    expect(button).not.toBeNull()

    act(() => (button as HTMLButtonElement).click())
    expect(host.textContent).toContain('下面这条 work 正在运行：')
    expect(host.textContent).toContain('机器学习入门')
    expect(host.textContent).toContain('ml-onboarding')
    expect(host.textContent).toContain('运行中')
    expect(host.querySelector('[data-dev-work-preview="running"]')).not.toBeNull()
    expect(host.querySelector('[data-work-inline]')).not.toBeNull()

    act(() => (button as HTMLButtonElement).click())
    expect(host.textContent).toContain('下面这条 work 已完成：')
    expect(host.textContent).toContain('已完成')
    expect(host.textContent).toContain('本轮已完成')
    expect(host.querySelector('[data-dev-work-preview="done"]')).not.toBeNull()

    act(() => (button as HTMLButtonElement).click())
    expect(host.textContent).toContain('下面这条 work 执行出错：')
    expect(host.textContent).toContain('出错')
    expect(host.textContent).toContain('工具执行失败')
    expect(host.querySelector('[data-dev-work-preview="error"]')).not.toBeNull()

    act(() => root.unmount())
    host.remove()
  })
})
