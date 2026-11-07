/*
 * 这个文件负责：视频总结的**语义分段（chapters）**在进度条上的时刻匹配——
 * 悬停预览落在哪个分段之内（进度条预览下方显示那段标题的依据）。
 * 原样搬自 VideoPlayer.tsx 的 hoverChapter 推导（注释一并带走）。
 * 分段数据按选集 source 存（见 learn/video/summarize），这里只做时刻→分段的匹配。
 */

import type { VideoChapter } from '../../learn/types'

/*
 * 悬停时刻落在哪个分段之内（progress bar 预览下方的分段标题）：
 * startMs <= 悬停时刻 < 下一段的 startMs（最后一段到片尾）。
 */
export function findHoverChapter(
  chapters: VideoChapter[] | null | undefined,
  hoverTime: number | null,
): VideoChapter | null {
  return chapters && hoverTime != null && chapters.length
    ? (chapters.find((ch, i) => {
        const ms = hoverTime * 1000
        return ms >= ch.startMs && (i === chapters.length - 1 || ms < chapters[i + 1].startMs)
      }) ?? null)
    : null
}
