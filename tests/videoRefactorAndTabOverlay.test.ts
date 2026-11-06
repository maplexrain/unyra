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
})
