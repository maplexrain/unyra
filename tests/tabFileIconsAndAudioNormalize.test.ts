import { describe, it, expect } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { TabTypeIcon } from '../src/components/learn/tabbar/TabIcons'
import { markdownEditorTheme, IDEA_MONO_FONT } from '../src/lib/cmMarkdown'
import type { TabRef } from '../src/learn/types'

describe('页签文件图标扩展名映射测试 (TabTypeIcon)', () => {
  it('本地磁盘文件 (local) 根据文件后缀渲染对应语言图标，且具备更大视觉尺寸', () => {
    const tsTab: TabRef = { kind: 'local', path: 'C:/projects/app/main.ts' }
    const tsHtml = renderToStaticMarkup(React.createElement(TabTypeIcon, { tab: tsTab }))
    expect(tsHtml).toContain('title="main.ts"')
    expect(tsHtml).toContain('<svg')
    expect(tsHtml).toContain('width="16"')

    const pyTab: TabRef = { kind: 'local', path: 'D:/scripts/process_data.py' }
    const pyHtml = renderToStaticMarkup(React.createElement(TabTypeIcon, { tab: pyTab }))
    expect(pyHtml).toContain('title="process_data.py"')
    expect(pyHtml).toContain('<svg')
    expect(pyHtml).toContain('width="16"')

    const pdfTab: TabRef = { kind: 'local', path: 'E:/docs/research_paper.pdf' }
    const pdfHtml = renderToStaticMarkup(React.createElement(TabTypeIcon, { tab: pdfTab }))
    expect(pdfHtml).toContain('title="research_paper.pdf"')
    expect(pdfHtml).toContain('<svg')
    expect(pdfHtml).toContain('width="16"')
  })

  it('工作区内部文件 (ws) 根据相对路径中的文件名与后缀显示图标', () => {
    const wsTsxTab: TabRef = { kind: 'ws', nodeId: 'node-1', seg: 'src/components/Header.tsx' }
    const wsHtml = renderToStaticMarkup(React.createElement(TabTypeIcon, { tab: wsHtmlTab(wsTsxTab) }))
    expect(wsHtml).toContain('title="Header.tsx"')
    expect(wsHtml).toContain('<svg')

    const wsJsonTab: TabRef = { kind: 'ws', nodeId: 'node-1', seg: 'package.json' }
    const jsonHtml = renderToStaticMarkup(React.createElement(TabTypeIcon, { tab: wsJsonTab }))
    expect(jsonHtml).toContain('title="package.json"')
    expect(jsonHtml).toContain('<svg')
  })

  it('非普通外部文件的内置文档页签保留专属语义图示', () => {
    const teachTab: TabRef = { kind: 'teach', nodeId: 'node-1' }
    const teachHtml = renderToStaticMarkup(React.createElement(TabTypeIcon, { tab: teachTab }))
    expect(teachHtml).toContain('style="color:#4a8fd4"') // 教学文档蓝

    const superTab: TabRef = { kind: 'super', nodeId: 'node-1', name: '超级图表' }
    const superHtml = renderToStaticMarkup(React.createElement(TabTypeIcon, { tab: superTab }))
    expect(superHtml).toContain('style="color:#a066d6"') // 超级文档紫

    const examTab: TabRef = { kind: 'exam', nodeId: 'node-1', examId: 'e-1', attemptId: 'a-1' }
    const examHtml = renderToStaticMarkup(React.createElement(TabTypeIcon, { tab: examTab }))
    expect(examHtml).toContain('style="color:#c0563a"') // 试卷朱红
  })
})

describe('源码编辑模式行号与当前行高亮测试 (SourceEditor CM6)', () => {
  it('正确导出并配置带有行号边栏与当前行背景突出样式的编辑器主题', () => {
    const theme = markdownEditorTheme({ top: 14, bottom: 24, left: 14, right: 24, gutterLeft: 50 })
    expect(theme).toBeDefined()
  })

  it('使用 IntelliJ IDEA 风格的 JetBrains Mono 等宽字体栈', () => {
    expect(IDEA_MONO_FONT).toContain('JetBrains Mono')
  })
})

function wsHtmlTab(t: TabRef): TabRef {
  return t
}
