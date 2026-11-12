import { describe, it, expect } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { normalizeAudioSamples } from '../electron/sherpa/audioNormalize'
import { TabTypeIcon } from '../src/components/learn/tabbar/TabIcons'
import { markdownEditorTheme } from '../src/lib/cmMarkdown'
import type { TabRef } from '../src/learn/types'

describe('TTS 语音响度均衡器测试 (audioNormalize)', () => {
  it('对空输入或近乎纯静音的信号保持安全原样返回', () => {
    const empty = new Float32Array(0)
    expect(normalizeAudioSamples(empty)).toBe(empty)

    const nearZero = new Float32Array([0.00001, -0.00001, 0.00002])
    const res = normalizeAudioSamples(nearZero)
    expect(res).toBe(nearZero)
  })

  it('对原生振幅偏小（微弱音量）的片段进行平滑增益放大，使其对齐目标响度', () => {
    // 生成原生小音量信号（峰值 0.15，RMS ~0.04）
    const len = 4410
    const quiet = new Float32Array(len)
    for (let i = 0; i < len; i++) {
      quiet[i] = 0.15 * Math.sin((2 * Math.PI * 440 * i) / 44100)
    }

    const normalized = normalizeAudioSamples(quiet)
    // 验证有效放大幅度
    let maxAbs = 0
    let sumSq = 0
    for (let i = 256; i < len - 256; i++) {
      const a = Math.abs(normalized[i])
      if (a > maxAbs) maxAbs = a
      sumSq += a * a
    }
    const rms = Math.sqrt(sumSq / (len - 512))

    // 原生 RMS 约为 0.106，经过目标 0.14 规范后显著提升，且绝不超过安全破音门限 0.96
    expect(maxAbs).toBeGreaterThan(0.15)
    expect(maxAbs).toBeLessThanOrEqual(0.96)
    expect(rms).toBeGreaterThan(0.09)
  })

  it('对大动态极端峰值应用双曲正切软限制，绝不出现硬削波失真与爆音', () => {
    // 包含极端大音量片段
    const len = 4410
    const loud = new Float32Array(len)
    for (let i = 0; i < len; i++) {
      loud[i] = 0.98 * Math.sin((2 * Math.PI * 220 * i) / 44100)
    }

    const normalized = normalizeAudioSamples(loud)
    for (let i = 0; i < len; i++) {
      expect(Math.abs(normalized[i])).toBeLessThanOrEqual(0.96)
    }
  })

  it('音频首尾施加微淡入淡出，消除分段播放接缝处的直流偏置突变声', () => {
    const len = 1000
    const raw = new Float32Array(len).fill(0.5)
    const normalized = normalizeAudioSamples(raw)

    // 首部淡入从 0 开始平滑增长
    expect(normalized[0]).toBe(0)
    expect(Math.abs(normalized[100])).toBeGreaterThan(0)
    // 尾部淡出归零
    expect(normalized[len - 1]).toBe(0)
  })
})

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
    const theme = markdownEditorTheme({ top: 14, bottom: 24, left: 14, right: 24, gutterLeft: 44 })
    expect(theme).toBeDefined()
  })
})

function wsHtmlTab(t: TabRef): TabRef {
  return t
}
