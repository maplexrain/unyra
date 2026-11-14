import { describe, it, expect, vi, beforeEach } from 'vitest'
import { cleanTextForSpeech } from '../src/lib/tts/cleanText'
import { TTSAdapterManager } from '../src/lib/tts/manager'
import type { TTSAdapter, TTSSpeakOptions } from '../src/lib/tts/types'

describe('TTS 模块测试', () => {
  describe('文本预清洗 (cleanTextForSpeech)', () => {
    it('过滤代码块与思维链标签', () => {
      const raw = '<think>思考过程</think>你好世界```ts\nconst x = 1;\n```请听'
      const cleaned = cleanTextForSpeech(raw)
      expect(cleaned).toContain('你好世界')
      expect(cleaned).toContain('请听')
      expect(cleaned).not.toContain('思考过程')
      expect(cleaned).not.toContain('const x = 1')
    })

    it('清洗 Markdown 标记与行内格式', () => {
      const raw = '# 核心要点\n\n> 引用内容\n- 列表项\n**加粗文字** [文档链接](http://example.com) `console.log()`'
      const cleaned = cleanTextForSpeech(raw)
      expect(cleaned).toContain('核心要点')
      expect(cleaned).toContain('引用内容')
      expect(cleaned).toContain('加粗文字')
      expect(cleaned).toContain('文档链接')
      expect(cleaned).toContain('console.log()')
      expect(cleaned).not.toContain('#')
      expect(cleaned).not.toContain('http://example.com')
      expect(cleaned).not.toContain('**')
    })

    it('清理 LaTeX 公式标记', () => {
      const raw = '由爱因斯坦质能方程 $$E=mc^2$$ 以及动量 $p=mv$ 可知'
      const cleaned = cleanTextForSpeech(raw)
      expect(cleaned).toContain('E=mc^2')
      expect(cleaned).toContain('p=mv')
      expect(cleaned).not.toContain('$$')
      expect(cleaned).not.toContain('$p=mv$')
    })
  })

  describe('适配器统一管理器 (TTSAdapterManager)', () => {
    let manager: TTSAdapterManager
    let mockAdapter: TTSAdapter

    beforeEach(() => {
      manager = new TTSAdapterManager()
      mockAdapter = {
        id: 'mock-tts',
        name: 'Mock TTS',
        description: 'For testing',
        isAvailable: () => true,
        getVoices: async () => [{ id: 'mock-v1', name: 'Voice 1', lang: 'zh-CN' }],
        speak: vi.fn(async (_text: string, options?: TTSSpeakOptions) => {
          options?.onStart?.()
          options?.onEnd?.()
        }),
        pause: vi.fn(),
        resume: vi.fn(),
        stop: vi.fn(),
      }
    })

    it('支持集中注册与查询适配器', () => {
      manager.registerAdapter(mockAdapter)
      expect(manager.getAdapter('mock-tts')).toBe(mockAdapter)
      expect(manager.getAdapters().some((a) => a.id === 'mock-tts')).toBe(true)
    })

    it('激活适配器由能力配置派生：TTS 关闭/系统原生时落在 web-speech 槽位', () => {
      // setActiveAdapter 已退役——适配器选择收敛到「设置 → 模型 → 能力接入」
      manager.registerAdapter(mockAdapter)
      expect(manager.getActiveAdapter().id).toBe('web-speech')
    })

    it('调用 speak 调度适配器并正确派发生命周期', async () => {
      // 测试环境的默认能力是 TTS=系统原生：mock 以 web-speech 槽位注册才能被调度
      manager.registerAdapter({ ...mockAdapter, id: 'web-speech' })

      let started = false
      let ended = false
      await manager.speak('测试发音', {
        onStart: () => {
          started = true
        },
        onEnd: () => {
          ended = true
        },
      })

      expect(mockAdapter.speak).toHaveBeenCalled()
      expect(started).toBe(true)
      expect(ended).toBe(true)
      expect(manager.getSnapshot().state).toBe('idle')
    })

    it('支持语速调整与范围约束 (0.5 ~ 2.0)', () => {
      manager.setRate(1.25)
      expect(manager.getRate()).toBe(1.25)

      manager.setRate(3.0)
      expect(manager.getRate()).toBe(2.0)

      manager.setRate(0.1)
      expect(manager.getRate()).toBe(0.5)
    })
  })
})
