import { beforeEach, describe, expect, it } from 'vitest'
import { OCR_PLUGIN_ID, ocrPluginOn } from '../src/lib/ocr/plugin'
import { formatBytes } from '../src/lib/ocr/model'
import { cleanOcrText } from '../src/lib/ocr/pdfTextLayer'
import {
  buildOcrCacheKey,
  clearMemoryOcrCache,
  getCachedOcrResult,
  getMemoryOcrCacheCount,
  setCachedOcrResult,
} from '../src/lib/ocr/cache'
import { pluginById, pluginsOf } from '../src/lib/plugins'
import type { OcrPageResult } from '../src/lib/native'

describe('OCR 文字识别插件与缓存系统规范', () => {
  beforeEach(() => {
    clearMemoryOcrCache()
  })

  it('插件注册：OCR 插件已作为内置功能性插件完成注册，并默认保持关闭', () => {
    const plugin = pluginById(OCR_PLUGIN_ID)
    expect(plugin).toBeDefined()
    expect(plugin?.id).toBe(OCR_PLUGIN_ID)
    expect(plugin?.category).toBe('functional')
    expect(plugin?.builtin).toBe(true)
    expect(plugin?.configurable).toBe(true)
    expect(plugin?.defaultEnabled).toBe(false)

    // 默认关闭，需下载模型后开启
    expect(ocrPluginOn()).toBe(false)
  })

  it('插件列表查询：pluginsOf(\'functional\') 中必须包含 OCR 插件', () => {
    const plugins = pluginsOf('functional')
    expect(plugins.some((p) => p.id === OCR_PLUGIN_ID)).toBe(true)
  })

  it('格式化字节工具 formatBytes 正确转换单位', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1024 * 50)).toBe('50.0 KB')
    expect(formatBytes(1024 * 1024 * 16)).toBe('16.0 MB')
    expect(formatBytes(1024 * 1024 * 38.5)).toBe('38.5 MB')
  })

  it('缓存键生成：buildOcrCacheKey 规范化文件路径与页码', () => {
    const key1 = buildOcrCacheKey('C:\\Docs\\paper.pdf', 1, 'pp-ocrv4-mobile')
    const key2 = buildOcrCacheKey('C:/Docs/paper.pdf', 1, 'pp-ocrv4-mobile')
    expect(key1).toBe(key2)
    expect(key1).toContain('c:/docs/paper.pdf#page1#m:pp-ocrv4-mobile')
  })

  it('文本清洁规整 cleanOcrText：剔除汉字与全角标点冗余空格，保留自然英文词间距', () => {
    // 纯中文空格剔除
    expect(cleanOcrText('2024 年 下 半 年 息 安 全 工 程 师 考 试 上 午')).toBe('2024年下半年息安全工程师考试上午')
    // 英文单词保留正常空格
    expect(cleanOcrText('B 銆? Enable secret')).toBe('B銆? Enable secret')
    // 中英文混排紧凑连接
    expect(cleanOcrText('Linux 操 作 系 统 自 带 审 计 功 能')).toBe('Linux操作系统自带审计功能')
    expect(cleanOcrText('SM2 算 法 是 国 家 密 码 标 准')).toBe('SM2算法是国家密码标准')
    expect(cleanOcrText('   ')).toBe('')
  })

  it('OCR 内存缓存读写与清空机制', async () => {
    expect(getMemoryOcrCacheCount()).toBe(0)

    const key = buildOcrCacheKey('sample.pdf', 3, 'test')
    const mockData: OcrPageResult = {
      page: 3,
      lines: [
        {
          text: '第一行测试文字',
          bbox: { x: 0.1, y: 0.1, width: 0.5, height: 0.03 },
        },
        {
          text: '第二行测试文字',
          bbox: { x: 0.1, y: 0.15, width: 0.45, height: 0.03 },
        },
      ],
      fullText: '第一行测试文字 第二行测试文字',
      modelId: 'test',
      createdAt: Date.now(),
    }

    await setCachedOcrResult(key, mockData)
    expect(getMemoryOcrCacheCount()).toBe(1)

    const fetched = await getCachedOcrResult(key)
    expect(fetched).toEqual(mockData)
    expect(fetched?.lines.length).toBe(2)
    expect(fetched?.lines[0].text).toBe('第一行测试文字')

    clearMemoryOcrCache()
    expect(getMemoryOcrCacheCount()).toBe(0)
  })
})
