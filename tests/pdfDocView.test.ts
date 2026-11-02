import { describe, expect, it } from 'vitest'
import { isMediaFile, isPdfFile, isPreviewable, viewOf } from '../src/learn/tabs'
import type { LearnTab } from '../src/learn/types'

describe('PDF 文档与页签行为规范', () => {
  it('扩展名识别：.pdf 识别为 PDF 与媒体类型，且非 markdown/html 预览类型', () => {
    expect(isPdfFile('sample.pdf')).toBe(true)
    expect(isPdfFile('C:/path/to/document.PDF')).toBe(true)
    expect(isPdfFile('notes.md')).toBe(false)
    expect(isPdfFile('image.png')).toBe(false)
    expect(isPdfFile('.pdf')).toBe(false) // 点开头的隐藏文件无扩展名

    // 属于媒体预览大类
    expect(isMediaFile('sample.pdf')).toBe(true)
    // 不属于 Markdown/HTML 预览
    expect(isPreviewable('sample.pdf')).toBe(false)
  })

  it('viewOf 视图判定：local 与 ws 的 pdf 文件一律映射为 media 视图（严格只读，不进入编辑模式）', () => {
    const localPdfTab: LearnTab = {
      id: 'local:C:/test.pdf',
      createdAt: Date.now(),
      ref: { kind: 'local', path: 'C:/test.pdf' },
    }
    expect(viewOf(localPdfTab)).toBe('media')

    const wsPdfTab: LearnTab = {
      id: 'ws:node1:manual.pdf',
      createdAt: Date.now(),
      ref: { kind: 'ws', nodeId: 'node1', seg: 'manual.pdf' },
    }
    expect(viewOf(wsPdfTab)).toBe('media')
  })

  it('非 PDF 文件正常落到各自预期的默认视图', () => {
    const mdTab: LearnTab = {
      id: 'local:C:/test.md',
      createdAt: Date.now(),
      ref: { kind: 'local', path: 'C:/test.md' },
    }
    expect(viewOf(mdTab)).toBe('preview')

    const txtTab: LearnTab = {
      id: 'local:C:/test.txt',
      createdAt: Date.now(),
      ref: { kind: 'local', path: 'C:/test.txt' },
    }
    expect(viewOf(txtTab)).toBe('source')
  })
})
