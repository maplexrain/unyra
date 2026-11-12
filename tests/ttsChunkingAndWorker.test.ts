import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { splitTextIntoSpeechChunks } from '../src/lib/tts/chunkText'
import { SherpaOfflineTTSAdapter } from '../src/lib/tts/adapters/sherpaOffline'

describe('TTS 长文本分句与离线流水线测试', () => {
  describe('长文本分句算法 (splitTextIntoSpeechChunks)', () => {
    it('空文本或纯空白字符串返回空数组', () => {
      expect(splitTextIntoSpeechChunks('')).toEqual([])
      expect(splitTextIntoSpeechChunks('   \n\t  ')).toEqual([])
    })

    it('长度在阈值以内的短文本原样作为单句返回', () => {
      const short = '这是一句普通的简短通知。'
      expect(splitTextIntoSpeechChunks(short, 50)).toEqual([short])
    })

    it('按句末主标点（。！？；…\\n）准确拆分长段落', () => {
      const longText =
        '第一句话讲述了故事的开端。紧接着第二句话展开了详细的背景交代！那么第三句究竟会发生什么？' +
        '最后一句给出了结论；甚至还有省略号……换行之后也是新的一句\n真的非常奇妙。'

      const chunks = splitTextIntoSpeechChunks(longText, 30)
      expect(chunks.length).toBeGreaterThanOrEqual(4)
      // 验证没有内容遗漏
      const recombined = chunks.join('')
      expect(recombined).toContain('故事的开端')
      expect(recombined).toContain('背景交代')
      expect(recombined).toContain('究竟会发生什么')
      expect(recombined).toContain('非常奇妙')
    })

    it('针对长从句能够在次级逗号/顿号/冒号处平滑折行', () => {
      const longClause =
        '在人工智能飞速发展的今天，大规模神经网络模型被广泛应用于语音识别、语音合成、机器翻译以及自然语言理解等各个前沿领域'
      const chunks = splitTextIntoSpeechChunks(longClause, 25)
      expect(chunks.length).toBeGreaterThan(1)
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(35)
      }
    })

    it('针对无标点的超长字符流进行硬切分保护', () => {
      const dense = '0123456789'.repeat(15) // 150 字符无标点
      const chunks = splitTextIntoSpeechChunks(dense, 40)
      expect(chunks.length).toBeGreaterThanOrEqual(4)
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(40)
      }
    })

    it('合并极短的单字碎片以保持朗读连贯性', () => {
      const text = '好。接下来我们来看一个全新的例子。'
      const chunks = splitTextIntoSpeechChunks(text, 50)
      // "好。" 不应孤立存在，应合并到后续句子中或保持平稳
      expect(chunks.length).toBe(1)
      expect(chunks[0]).toContain('好')
      expect(chunks[0]).toContain('全新的例子')
    })
  })

  describe('SherpaOfflineTTSAdapter 流水线播放与中断', () => {
    let adapter: SherpaOfflineTTSAdapter
    let mockSynthesize: any
    let originalMojiNative: any
    let originalAudio: any

    class MockAudio {
      src: string
      volume: number = 1
      currentTime: number = 0
      paused: boolean = true
      onplay: (() => void) | null = null
      onended: (() => void) | null = null
      onerror: ((err: any) => void) | null = null

      constructor(src: string) {
        this.src = src
      }

      play = vi.fn().mockImplementation(() => {
        this.paused = false
        if (this.onplay) this.onplay()
        // 模拟播放短暂时间后触发 onended
        setTimeout(() => {
          if (!this.paused) {
            this.paused = true
            if (this.onended) this.onended()
          }
        }, 10)
        return Promise.resolve()
      })

      pause = vi.fn().mockImplementation(() => {
        this.paused = true
      })
    }

    beforeEach(() => {
      adapter = new SherpaOfflineTTSAdapter()
      originalMojiNative = (globalThis as any).window?.mojiNative
      originalAudio = (globalThis as any).Audio

      mockSynthesize = vi.fn().mockImplementation(async ({ text }: { text: string }) => {
        return {
          ok: true,
          audioDataUrl: `data:audio/wav;base64,mock_${encodeURIComponent(text.slice(0, 10))}`,
        }
      })

      // 注入 window.mojiNative 和 Audio
      if (!(globalThis as any).window) {
        ;(globalThis as any).window = {}
      }
      ;(globalThis as any).window.mojiNative = {
        tts: {
          synthesize: mockSynthesize,
          modelStatus: vi.fn().mockResolvedValue({ exists: true, availableModels: [] }),
          getModels: vi.fn().mockResolvedValue([
            { id: 'vits-zh-aishell3', name: 'AISHELL-3', downloaded: true },
          ]),
        },
      }
      ;(globalThis as any).Audio = MockAudio
    })

    afterEach(() => {
      if ((globalThis as any).window) {
        ;(globalThis as any).window.mojiNative = originalMojiNative
      }
      ;(globalThis as any).Audio = originalAudio
    })

    it('对多句长文本自动分句，并支持边播边预合成后续句子', async () => {
      const longInput =
        '第一句内容非常详细地展示了当前离线推理的各项优异表现。第二句深入展开细节并探讨长文本流式分句播放机制的实现原理。第三句给出了最终的实验结论以及未来可拓展优化的展望内容。'
      let started = false
      let ended = false

      await adapter.speak(longInput, {
        onStart: () => {
          started = true
        },
        onEnd: () => {
          ended = true
        },
      })

      expect(mockSynthesize).toHaveBeenCalled()
      // 至少切分为多句分别调用 synthesize
      expect(mockSynthesize.mock.calls.length).toBeGreaterThanOrEqual(2)
      expect(started).toBe(true)
      expect(ended).toBe(true)
    })

    it('调用 stop() 能立刻中断播放并取消后续句子的合成', async () => {
      const longInput =
        '第一句内容非常详细地展示了当前离线推理的各项优异表现。第二句深入展开细节并探讨长文本流式分句播放机制的实现原理。第三句给出了最终的实验结论以及未来可拓展优化的展望内容。'

      const speakPromise = adapter.speak(longInput)
      // 稍作等待后调用 stop
      await new Promise((r) => setTimeout(r, 5))
      adapter.stop()

      await speakPromise
      // 验证 currentAudio 被暂停且清空
      expect((adapter as any).currentAudio).toBeNull()
      expect((adapter as any).abortController).toBeNull()
    })
  })
})
