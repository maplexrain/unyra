/*
 * 这个文件负责：VideoPlayer 的**字幕系统**——轨道选择（关 / 内置 / 外挂）、
 * 外挂字幕文件导入（.srt / .vtt / .json）、时间轴偏移与字号缩放（记忆设置），
 * 以及换流时清掉上一集外挂字幕的复位动作。
 * 原样搬自 VideoPlayer.tsx 的字幕区块（注释一并带走）；Toast 提示与外挂载入回调
 * 按仓库惯例经 Deps 单对象递进来。activeCue 的逐帧计算留在门面（跟着 currentTime 走）。
 */

import { useCallback, useState } from 'react'
import { t } from '../../i18n'
import { parseSubtitleFile, toTranscript } from '../../video/subtitles'
import type { Transcript, TranscriptSegment } from '../../video/types'
import { SUBTITLE_SCALE_STORAGE_KEY, readStoredSubtitleScale } from './videoPlayerShared'

/** 字幕系统需要宿主提供的最小能力 */
export interface VideoSubtitleDeps {
  /** 播放器顶部的浮动 Toast 提示（导入成功/失败、字号调整都用它） */
  showToast: (msg: string) => void
  /** 外挂字幕解析成功后交回宿主一份 Transcript（宿主拿去做转录/摘要等） */
  onExternalSubtitleLoaded?: (transcript: Transcript) => void
}

/**
 * 字幕系统：轨道与外挂字幕状态、导入、时间轴偏移与字号缩放，
 * 以及换流时清掉上一集外挂字幕的复位动作（clearExternalSubtitles）。
 */
export function useVideoSubtitles({ showToast, onExternalSubtitleLoaded }: VideoSubtitleDeps) {
  // 字幕系统
  const [subtitleTrack, setSubtitleTrack] = useState<'off' | 'builtin' | 'external'>('builtin')
  const [externalSegments, setExternalSegments] = useState<TranscriptSegment[]>([])
  const [externalName, setExternalName] = useState<string>('')
  const [subtitleOffsetMs, setSubtitleOffsetMs] = useState(0) // 字幕时间偏移
  const [subtitleScale, setSubtitleScale] = useState(readStoredSubtitleScale) // 字幕字号缩放倍率

  // 字幕字号缩放微调
  const changeSubtitleScale = useCallback((scale: number) => {
    setSubtitleScale(scale)
    try {
      localStorage.setItem(SUBTITLE_SCALE_STORAGE_KEY, String(scale))
    } catch {
      // 忽略
    }
    showToast(t('字幕大小：{0}x', String(scale)))
  }, [showToast])

  // 导入外挂字幕文件 (.srt / .vtt / .json)
  const handleSubtitleFile = useCallback(
    (file: File) => {
      const reader = new FileReader()
      reader.onload = (e) => {
        const content = String(e.target?.result ?? '')
        const parsed = parseSubtitleFile(content, file.name)
        if (!parsed.length) {
          showToast(t('未从文件中解析出有效字幕'))
          return
        }
        setExternalSegments(parsed)
        setExternalName(file.name)
        setSubtitleTrack('external')
        setSubtitleOffsetMs(0)
        showToast(t('成功载入外挂字幕：共 {0} 条', String(parsed.length)))

        if (onExternalSubtitleLoaded) {
          onExternalSubtitleLoaded(toTranscript(parsed, file.name))
        }
      }
      reader.onerror = () => {
        showToast(t('读取字幕文件失败'))
      }
      reader.readAsText(file, 'utf-8')
    },
    [onExternalSubtitleLoaded, showToast],
  )

  /**
   * 外挂字幕属于上一集：换流时清掉，免得把别人的字幕挂在新集上。
   * （原 src-change effect 里的四句内联语句，语句原样搬来：轨道退回内置而非硬切 off。）
   */
  const clearExternalSubtitles = useCallback(() => {
    setExternalSegments([])
    setExternalName('')
    setSubtitleOffsetMs(0)
    setSubtitleTrack((mode) => (mode === 'external' ? 'builtin' : mode))
  }, [])

  return {
    subtitleTrack,
    setSubtitleTrack,
    externalSegments,
    externalName,
    subtitleOffsetMs,
    setSubtitleOffsetMs,
    subtitleScale,
    changeSubtitleScale,
    handleSubtitleFile,
    clearExternalSubtitles,
  }
}
