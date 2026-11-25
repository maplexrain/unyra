/**
 * 附件在气泡里的分工：图片 / 视频进九宫格，其余文件留在气泡外。
 * 这里只测纯排布，不拉 React —— 组件在 groupChatPanel / messageMediaGrid 里覆盖。
 */
import { describe, expect, it } from 'vitest'
import { isVideoFileName, mediaGridSpec, MAX_MEDIA } from '../src/components/agent/panel/messageMediaLayout'

describe('messageMediaLayout', () => {
  it('视频按后缀识别：mp4 / mov / webm 是视频，md / pdf / png 不是', () => {
    expect(isVideoFileName('demo.mp4')).toBe(true)
    expect(isVideoFileName('clip.MOV')).toBe(true)
    expect(isVideoFileName('录屏.webm')).toBe(true)
    expect(isVideoFileName('notes.md')).toBe(false)
    expect(isVideoFileName('paper.pdf')).toBe(false)
    expect(isVideoFileName('shot.png')).toBe(false)
  })

  it('宫格按张数换排法：1 整幅、2 并排、3 首张整行、4 两两、5+ 三列', () => {
    expect(mediaGridSpec(1)).toEqual({ cols: 1, firstWide: false })
    expect(mediaGridSpec(2)).toEqual({ cols: 2, firstWide: false })
    expect(mediaGridSpec(3)).toEqual({ cols: 2, firstWide: true })
    expect(mediaGridSpec(4)).toEqual({ cols: 2, firstWide: false })
    expect(mediaGridSpec(5).cols).toBe(3)
    expect(mediaGridSpec(MAX_MEDIA).cols).toBe(3)
  })
})
