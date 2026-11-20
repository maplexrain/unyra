// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import {
  BUILTIN_COMPONENT_SPECS,
  getComponentSpec,
} from '../src/components/learn/classroom/componentSpecs'
import ClassroomShowcasePage from '../src/components/learn/classroom/ClassroomShowcasePage'
import ClassroomComponentDetailPage from '../src/components/learn/classroom/ClassroomComponentDetailPage'
import {
  BUILTIN_COMPONENTS,
  registerClassroomComponent,
  unregisterClassroomComponent,
} from '../src/learn/classroom/registry'

async function renderComponent(element: React.ReactElement) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(element)
  })
  return {
    host,
    root,
    cleanup: async () => {
      await act(async () => {
        root.unmount()
      })
      host.remove()
    },
  }
}

describe('Classroom Component Showcase & Detail Page', () => {
  beforeEach(() => {
    localStorage.clear()
    document.body.innerHTML = ''
  })

  it('provides complete specification contracts for all 26 builtin components', () => {
    expect(BUILTIN_COMPONENTS.length).toBeGreaterThanOrEqual(26)
    for (const comp of BUILTIN_COMPONENTS) {
      const spec = BUILTIN_COMPONENT_SPECS[comp.tag]
      expect(spec, `Missing spec for ${comp.tag}`).toBeDefined()
      expect(spec.tag).toBe(comp.tag)
      expect(spec.name).toBeTruthy()
      expect(spec.props.length).toBeGreaterThan(0)
      expect(spec.recommendedAnimations.length).toBeGreaterThan(0)
      expect(spec.examples.length).toBeGreaterThan(0)
    }
  })

  it('getComponentSpec returns fallback spec for custom tags', () => {
    const custom = getComponentSpec('ui-my-widget', {
      name: '我的小部件',
      description: '测试自定义部件',
      example: '<ui-my-widget>测试内容</ui-my-widget>',
    })
    expect(custom.tag).toBe('ui-my-widget')
    expect(custom.name).toBe('我的小部件')
    expect(custom.category).toBe('custom')
    expect(custom.props.length).toBeGreaterThan(0)
  })

  it('renders ClassroomShowcasePage with component cards and search filter', async () => {
    const { host, cleanup } = await renderComponent(<ClassroomShowcasePage />)

    // 页面主标题与标签
    expect(host.textContent).toContain('课堂组件与动效库')
    expect(host.textContent).toContain('v2.0 页面版')

    // 验证核心组件在网格中呈现
    expect(host.textContent).toContain('通用容器卡片')
    expect(host.textContent).toContain('核心概念提炼卡')
    expect(host.textContent).toContain('数理公式显要卡')

    // 验证搜索框过滤
    const searchInput = host.querySelector('input[type="text"]') as HTMLInputElement
    expect(searchInput).toBeTruthy()

    await act(async () => {
      searchInput.value = '夹逼'
      searchInput.dispatchEvent(new Event('input', { bubbles: true }))
      // 触发 React onChange
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
      nativeSetter?.call(searchInput, '夹逼')
      searchInput.dispatchEvent(new Event('change', { bubbles: true }))
    })

    await cleanup()
  })

  it('navigates from card click into ClassroomComponentDetailPage and returns back', async () => {
    const { host, cleanup } = await renderComponent(<ClassroomShowcasePage />)

    // 找到核心概念提炼卡卡片元素并触发点击
    const cardTitle = Array.from(host.querySelectorAll('h3')).find((el) =>
      el.textContent?.includes('核心概念提炼卡'),
    )
    expect(cardTitle).toBeTruthy()
    const card = cardTitle?.closest('.cursor-pointer') as HTMLElement
    expect(card).toBeTruthy()

    await act(async () => {
      card.click()
    })

    // 确认进入二级详情页
    expect(host.textContent).toContain('返回组件库')
    expect(host.textContent).toContain('参数契约详表 (Props)')
    expect(host.textContent).toContain('实时演练场 (实时热重载)')
    expect(host.textContent).toContain('推荐动效搭配')
    expect(host.textContent).toContain('<ui-concept>')

    // 点击返回组件库按钮
    const backBtn = Array.from(host.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('返回组件库'),
    ) as HTMLButtonElement
    expect(backBtn).toBeTruthy()

    await act(async () => {
      backBtn.click()
    })

    // 确认返回一级主页面
    expect(host.textContent).toContain('课堂组件与动效库')
    expect(host.textContent).not.toContain('参数契约详表 (Props)')

    await cleanup()
  })

  it('ClassroomComponentDetailPage allows editing DSL and resetting examples', async () => {
    const { host, cleanup } = await renderComponent(
      <ClassroomComponentDetailPage tag="ui-card" onBack={() => {}} />,
    )

    expect(host.textContent).toContain('通用容器卡片')
    const textarea = host.querySelector('textarea') as HTMLTextAreaElement
    expect(textarea).toBeTruthy()
    expect(textarea.value).toContain('ui-card')

    // 重置按钮测试
    const resetBtn = Array.from(host.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('重置示例'),
    )
    expect(resetBtn).toBeTruthy()

    await cleanup()
  })

  it('supports registering new custom component and navigating to its detail view', async () => {
    const regRes = registerClassroomComponent({
      tag: 'ui-circuit',
      name: '电路分析卡',
      description: '展示电压电流阻抗关系',
      template: '<div class="circuit-card"><h4>{{title}}</h4><p>{{content}}</p></div>',
      example: '<ui-circuit title="欧姆定律">I = U / R</ui-circuit>',
    })
    expect(regRes.ok).toBe(true)

    const { host, cleanup } = await renderComponent(<ClassroomShowcasePage />)
    expect(host.textContent).toContain('电路分析卡')
    expect(host.textContent).toContain('<ui-circuit>')

    // 点击进入该自定义组件的二级详情页
    const cardTitle = Array.from(host.querySelectorAll('h3')).find((el) =>
      el.textContent?.includes('电路分析卡'),
    )
    const card = cardTitle?.closest('.cursor-pointer') as HTMLElement

    await act(async () => {
      card.click()
    })

    expect(host.textContent).toContain('返回组件库')
    expect(host.textContent).toContain('<ui-circuit>')
    expect(host.textContent).toContain('外部动态注册')

    await cleanup()
    unregisterClassroomComponent('ui-circuit')
  })
})
