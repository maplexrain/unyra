// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import fs from 'fs'

describe('大纲悬浮窗动画、设置插件页默认状态与顶栏技巧组件清理规范', () => {
  it('大纲悬浮窗应用 paper-ink 物理舒展动画与逐行级联入场动画', () => {
    const outlineCode = fs.readFileSync('src/components/learn/DocOutline.tsx', 'utf8')
    const cssCode = fs.readFileSync('src/styles/interactive.css', 'utf8')

    // 1. 浮层根节点使用 moji-outline-pop 与 moji-outline-out
    expect(outlineCode).toContain('moji-outline-pop')
    expect(outlineCode).toContain('moji-outline-out')

    // 2. 标题行使用 moji-outline-row 级联入场与微按压
    expect(outlineCode).toContain('moji-outline-row')
    expect(outlineCode).toContain('animationDelay')
    expect(outlineCode).toContain('moji-press')

    // 3. 当前活跃小节具备 seal 指示器
    expect(outlineCode).toContain('bg-seal rounded-full')

    // 4. CSS 中定义了弹簧舒展曲线与减弱动画偏好支持
    expect(cssCode).toContain('.moji-outline-pop')
    expect(cssCode).toContain('.moji-outline-out')
    expect(cssCode).toContain('.moji-outline-row')
    expect(cssCode).toContain('transform-origin: -6px 14px')
    expect(cssCode).toContain('.moji-outline-pop,')
  })

  it('设置面板的插件 tab 打开时默认展示一级插件列表，不常驻 OCR 等二级页面', () => {
    const settingsCode = fs.readFileSync('src/components/settings/SettingsPanel.tsx', 'utf8').replace(/\r\n/g, '\n')
    const pdfCode = fs.readFileSync('src/components/learn/pdf/PdfDocView.tsx', 'utf8')

    // 1. 插件页状态默认初始化为 null，不从 localStorage 盲目恢复
    expect(settingsCode).toContain('const [pluginPage, setPluginPage] = useState<string | null>(null)')

    // 2. selectTab 切换到 plugins 时重置 pluginPage 为 null
    expect(settingsCode).toContain("if (key === 'plugins') {\n      setPluginPage(null)\n    }")

    // 3. PdfDocView 唤起设置时不污染持久化的 moji:settings:plugin 键
    expect(pdfCode).not.toContain("localStorage.setItem('moji:settings:plugin'")
  })

  it('顶栏小技巧组件及其外观配置已彻底清理', () => {
    const chromeCode = fs.readFileSync('src/components/learn/workspace/chrome.tsx', 'utf8')
    const appearanceCode = fs.readFileSync('src/lib/appearance.ts', 'utf8')
    const featuresCode = fs.readFileSync('src/components/settings/AppearanceFeaturesSection.tsx', 'utf8')

    // 1. TopBarTipCarousel 已不存在于 workspace
    expect(fs.existsSync('src/components/learn/workspace/TopBarTipCarousel.tsx')).toBe(false)
    expect(chromeCode).not.toContain('TopBarTipCarousel')
    expect(chromeCode).not.toContain('showTips')

    // 2. appearance 设置不再包含 showTips
    expect(appearanceCode).not.toContain('showTips')
    expect(featuresCode).not.toContain('showTips')
    expect(featuresCode).not.toContain('顶栏技巧提示')
  })
})
