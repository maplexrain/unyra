/*
 * 这个文件负责：页签里那两枚**小图标组件**——页签类型的标识图标（TabTypeIcon，
 * 网页页签带活信息：转圈 / 站点图标）与视频页签上的快捷静音（VideoAudioButton）。
 */

import { useEffect, useState } from 'react'
import { FileText, Volume2, VolumeX } from 'lucide-react'
import { DocTypeIcon, WebTabTypeIcon } from '../docTypes'
import type { TabRef } from '../../../learn/types'
import { isPdfFile } from '../../../learn/tabs'
import { subscribeVideoAudio, videoAudioOf } from '../../../learn/video/videoRegistry'
import { t } from '../../../i18n'

/*
 * 页签类型的标识图标：一眼分清这一排里哪种文档是哪种。
 * 图标与颜色与左侧资源管理器共用一份（见 components/learn/docTypes）——
 * 同一个东西在两处长得一样，用户才不用重新认一遍。
 * 那一格占住原先留给「与关闭键等宽的空档」的 16px（见下面页签里那格），
 * 于是标题仍然是在整条页签里居中的——图标只是把空档填成了有用信息。
 */
/**
 * 视频页签上的快捷静音：页签在后台播、人在读文档时，不用切回去就能让它闭嘴。
 * 控制的是播放器自己的静音态（登记表，见 learn/video/videoRegistry）；
 * 播放器内部的静音 / 调音量通过元素的 volumechange 事件同步到图标上。
 * 登记表里还没有控制器的（创建态 / 流没解析出来）什么都不画。
 */
export function VideoAudioButton({ tabId }: { tabId: string }) {
  const [, bump] = useState(0)
  useEffect(() => subscribeVideoAudio(() => bump((n) => n + 1)), [])
  const ctrl = videoAudioOf(tabId)
  const el = ctrl?.element ?? null
  useEffect(() => {
    if (!el) return
    const sync = () => bump((n) => n + 1)
    el.addEventListener('volumechange', sync)
    return () => el.removeEventListener('volumechange', sync)
  }, [el])
  if (!ctrl) return null
  const muted = ctrl.getMuted()
  return (
    <button
      type="button"
      title={muted ? t('取消静音') : t('静音')}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        ctrl.setMuted(!muted)
      }}
      className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-seal transition hover:bg-line-strong/60"
    >
      {muted ? <VolumeX size={11} /> : <Volume2 size={11} />}
    </button>
  )
}

export function TabTypeIcon({ tab, favicon, loading }: { tab: TabRef; favicon?: string; loading?: boolean }) {
  // 网页页签的图标带活信息（转圈/站点图标，见 docTypes 的 WebTabTypeIcon）
  if (tab.kind === 'web') return <WebTabTypeIcon favicon={favicon} loading={loading} />
  if ((tab.kind === 'local' && isPdfFile(tab.path)) || (tab.kind === 'ws' && isPdfFile(tab.seg))) {
    return (
      <span
        aria-hidden="true"
        className="flex h-4 w-4 shrink-0 items-center justify-center text-rose-500"
        title="PDF"
      >
        <FileText size={11} />
      </span>
    )
  }
  return <DocTypeIcon kind={tab.kind} />
}
