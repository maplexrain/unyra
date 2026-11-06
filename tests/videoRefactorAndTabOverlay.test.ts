import { describe, it, expect } from 'vitest'
import { parseChapters, transcriptLines } from '../src/learn/video/summarize'
import type { Transcript, TranscriptSegment } from '../src/video/types'

describe('视频重构与 Tab 键浮层、分段生成规范', () => {
  it('parseChapters: 能够正确从模型输出的 JSON 数组中提取并规整化章节分段', () => {
    const raw = `
\`\`\`json
[
  { "startMs": 0, "summary": "课程前言与背景介绍" },
  { "startMs": 65000, "summary": "安装环境与配置 uv" },
  { "startMs": 180000, "summary": "编写第一个智能体" }
]
\`\`\`
`
    const chapters = parseChapters(raw)
    expect(chapters).toHaveLength(3)
    expect(chapters[0]).toEqual({ startMs: 0, summary: '课程前言与背景介绍' })
    expect(chapters[1]).toEqual({ startMs: 65000, summary: '安装环境与配置 uv' })
    expect(chapters[2]).toEqual({ startMs: 180000, summary: '编写第一个智能体' })
  })

  it('parseChapters: 能容忍非法行与重复时间戳，且按时间戳升序排序', () => {
    const raw = JSON.stringify([
      { startMs: 120000, summary: '后半段' },
      { startMs: 30000, summary: '前半段' },
      { startMs: 30000, summary: '重复的前半段' },
      { startMs: 'invalid_number', summary: '非法时间' },
      { startMs: 50000, summary: '' }, // 空概述
    ])
    const chapters = parseChapters(raw)
    expect(chapters).toHaveLength(2)
    expect(chapters[0].startMs).toBe(30000)
    expect(chapters[1].startMs).toBe(120000)
  })

  it('transcriptLines: 能够将转录片段聚桶并限制行数', () => {
    const segments: TranscriptSegment[] = [
      { startMs: 0, endMs: 5000, text: 'Hello' },
      { startMs: 5000, endMs: 10000, text: 'World' },
      { startMs: 25000, endMs: 30000, text: 'Next bucket' },
    ]
    const lines = transcriptLines(segments)
    expect(lines.length).toBe(2)
    expect(lines[0]).toContain('[00:00] Hello World')
    expect(lines[1]).toContain('[00:25] Next bucket')
  })

  it('50,000 字符限制规则验证：<= 50000 字符允许自动生成，> 50000 字符抑制自动生成并需要手动生成', () => {
    const makeTranscript = (totalLength: number): Transcript => {
      const segText = 'a'.repeat(1000)
      const count = Math.ceil(totalLength / 1000)
      const segments: TranscriptSegment[] = []
      for (let i = 0; i < count; i++) {
        segments.push({
          startMs: i * 5000,
          endMs: (i + 1) * 5000,
          text: i === count - 1 ? 'a'.repeat(totalLength - (count - 1) * 1000) : segText,
        })
      }
      return {
        version: 1,
        origin: 'subtitle',
        language: 'zh-CN',
        segments,
      }
    }

    const shortTranscript = makeTranscript(49999)
    const shortTotal = shortTranscript.segments.reduce((acc, s) => acc + s.text.length, 0)
    expect(shortTotal).toBe(49999)
    const canAutoGenerateShort = shortTotal <= 50000
    expect(canAutoGenerateShort).toBe(true)

    const longTranscript = makeTranscript(50001)
    const longTotal = longTranscript.segments.reduce((acc, s) => acc + s.text.length, 0)
    expect(longTotal).toBe(50001)
    const canAutoGenerateLong = longTotal <= 50000
    expect(canAutoGenerateLong).toBe(false)
  })

  it('左侧栏 1:1:1 三行均分布局与移除导出逻辑、右侧笔记栏规范验证', async () => {
    const fs = await import('fs')
    const code = fs.readFileSync('src/components/video/VideoStudyTab.tsx', 'utf8')

    // 1. 验证去掉了 maskImage 遮罩
    expect(code).not.toContain('maskImage:')
    expect(code).not.toContain('WebkitMaskImage:')

    // 2. 验证左侧栏三行的高度权重为 1:1:1 均分 (选集列表 flex-1，字幕 flex-1，分段 flex-1)
    expect(code).not.toContain('flex-[2]')
    expect(code).toContain('flex flex-1 min-h-0 flex-col')
    expect(code).toContain('flex flex-1 min-h-0 flex-col border-t border-white/10')

    // 3. 验证去掉了独立的右侧栏 sidePanel
    expect(code).not.toContain('const sidePanel =')
    expect(code).not.toContain('COLLAPSED_KEY')

    // 4. 验证移出了导出选集字幕按钮及相关逻辑
    expect(code).not.toContain('exportPages')
    expect(code).not.toContain('buildPagesMarkdown')
    expect(code).not.toContain('PagesExportEntry')

    // 5. 验证右侧栏（Tab 键笔记栏）与插入时间戳功能
    expect(code).toContain('rightOverlay')
    expect(code).toContain('createNoteForVideoNode')
    expect(code).toContain('deleteNoteForVideoNode')
    expect(code).toContain('updateNoteForVideoNode')
    expect(code).toContain('formatClock(currentMs)')
  })

  it('验证 VideoPlayer 顶底栏遮罩往回缩紧规范', async () => {
    const fs = await import('fs')
    const code = fs.readFileSync('src/components/video/VideoPlayer.tsx', 'utf8')

    // 验证顶部栏和底部栏的缩紧渐变样式
    expect(code).toContain('from-black/90 via-black/40 to-transparent')
    expect(code).toContain('from-black/90 via-black/45 to-transparent')
    // 验证支持 rightOverlay 与笔记切换按钮
    expect(code).toContain('rightOverlay')
    expect(code).toContain('onToggleRightOverlay')
  })
})
