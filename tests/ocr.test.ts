/**
 * OCR 文字层的文本清洗规范（pdfTextLayer 的 cleanOcrText）：
 * 中英文混排里被识别引擎插进来的假空格要去掉，英文单词之间的真空格要留住。
 * 旧本地模型的插件身份与磁盘缓存随本地推理栈一起退役了（能力迁移见 ai/capabilitySettings）。
 */
import { describe, expect, it } from 'vitest'
import { cleanOcrText } from '../src/lib/ocr/pdfTextLayer'

describe('OCR 文本清洗 (cleanOcrText)', () => {
  it('去掉 CJK 与字母数字之间的假空格', () => {
    expect(cleanOcrText('机器 学习 是 人工智能')).toBe('机器学习是人工智能')
    expect(cleanOcrText('深度 learning 好 用')).toBe('深度learning好用')
    expect(cleanOcrText('1000 个 token')).toBe('1000个token')
  })

  it('英文单词之间的真空格原样保留', () => {
    expect(cleanOcrText('deep learning is great')).toBe('deep learning is great')
    expect(cleanOcrText('hello world')).toBe('hello world')
  })

  it('空串与纯空白安全', () => {
    expect(cleanOcrText('')).toBe('')
    expect(cleanOcrText('   ')).toBe('')
  })
})
