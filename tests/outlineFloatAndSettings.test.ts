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

  it('OCR 引导直达「模型 → 能力接入」，插件 tab 不再有二级页面机制', () => {
    const settingsCode = fs.readFileSync('src/components/settings/SettingsPanel.tsx', 'utf8').replace(/\r\n/g, '\n')
    const pdfCode = fs.readFileSync('src/components/learn/pdf/PdfDocView.tsx', 'utf8')

    // 1. 语音/识别能力已迁去「能力接入」：插件页的二级配置页机制整体退役
    expect(settingsCode).not.toContain('pluginPage')
    expect(settingsCode).not.toContain('moji:open-plugin-config')
    expect(fs.existsSync('src/components/settings/PluginOcrPage.tsx')).toBe(false)
    expect(fs.existsSync('src/components/settings/PluginTtsPage.tsx')).toBe(false)
    expect(fs.existsSync('src/components/settings/PluginVoicePage.tsx')).toBe(false)

    // 2. 能力页签存在，且 moji:open-caps 事件把它直开
    expect(settingsCode).toContain("activeSubTab === 'caps'")
    expect(settingsCode).toContain("'moji:open-caps'")

    // 3. OCR 引导收在独立的横幅组件里（横幅拆出自 PdfDocView 时一并搬走）：同样指向新页签
    const bannerCode = fs.readFileSync('src/components/learn/pdf/PdfOcrBanner.tsx', 'utf8')
    expect(bannerCode).toContain("localStorage.setItem('moji:settings:tab', 'ai')")
    expect(bannerCode).toContain("'moji:open-caps'")
    expect(bannerCode).not.toContain('moji:open-plugin-config')
    expect(pdfCode).toContain('PdfOcrBanner')
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
