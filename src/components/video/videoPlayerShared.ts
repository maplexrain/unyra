/*
 * 这个文件负责：VideoPlayer 的**常量与本地存储读取**——倍速预设档位、中心播放
 * 气泡时长，以及音量/静音/倍速/字幕字号各项设置的 localStorage key 与容错读取。
 * 原样搬自 VideoPlayer.tsx 的常量区块（注释一并带走），供门面与各子模块共用。
 */

export const SPEED_PRESETS = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0]
/** 中心播放/暂停气泡的完整时长（与 motion.css 的 moji-center-pop 对齐：淡入+停留+淡出） */
export const CENTER_FEEDBACK_MS = 700
export const VOLUME_STORAGE_KEY = 'moji.video.volume'
export const MUTED_STORAGE_KEY = 'moji.video.muted'
export const PLAYBACK_RATE_STORAGE_KEY = 'moji.video.playbackRate'

export const readStoredVolume = (): number => {
  try {
    const v = localStorage.getItem(VOLUME_STORAGE_KEY)
    if (v !== null) {
      const num = parseFloat(v)
      if (Number.isFinite(num) && num >= 0 && num <= 1) return num
    }
  } catch {
    // 忽略
  }
  return 1
}

export const readStoredMuted = (): boolean => {
  try {
    return localStorage.getItem(MUTED_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export const readStoredRate = (): number => {
  try {
    const r = localStorage.getItem(PLAYBACK_RATE_STORAGE_KEY)
    if (r !== null) {
      const num = parseFloat(r)
      if (Number.isFinite(num) && num >= 0.25 && num <= 3.0) return num
    }
  } catch {
    // 忽略
  }
  return 1.0
}

export const SUBTITLE_SCALE_STORAGE_KEY = 'moji.video.subtitleScale'
export const readStoredSubtitleScale = (): number => {
  try {
    const s = localStorage.getItem(SUBTITLE_SCALE_STORAGE_KEY)
    if (s !== null) {
      const num = parseFloat(s)
      if (Number.isFinite(num) && num >= 0.5 && num <= 2.5) return num
    }
  } catch {
    // 忽略
  }
  return 0.8
}
