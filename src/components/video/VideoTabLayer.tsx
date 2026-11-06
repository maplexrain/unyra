/**
 * 视频页签的 **keepalive 常驻层**：这一格开着的每张视频页签都挂在 DOM 里，
 * 切去别的页签只藏不卸（用户定的：视频页要 keepalive）。
 *
 * 两种页签都归这层管：
 * - 绑定态（ref.videoId 有值或 videoNode 已关联 videoId）：资源在 store 里，页面自动解析；
 * - 创建/待确认态（无 videoId 或 videoNode 尚未确认）：输入/认领 → 确定为视频资源（回调交工作区）。
 */
import { MonitorPlay } from 'lucide-react'
import { t } from '../../i18n'
import type { LearnStore, LearnTab, TabRef, VideoNodeEntity, VideoRecap, VideoResource } from '../../learn/types'
import VideoStudyTab, { type VideoCreateDraft } from './VideoStudyTab'

export type VideoTab = LearnTab & { ref: Extract<TabRef, { kind: 'video' }> }

interface Props {
  /** 这一格挂着的全部视频页签（含创建态那一张） */
  tabs: VideoTab[]
  /** 此刻激活的视频页签 id；不是视频页签时传 null（整层仍然挂着，只是都藏着） */
  activeId: string | null
  /** 整个目标的 store */
  store?: LearnStore
  /** 提交 store 修改 */
  onCommitStore?: (next: LearnStore) => void
  /** 视频资源表（store.videos） */
  videos?: VideoResource[]
  /** 视频节点表（store.videoNodes） */
  videoNodes?: VideoNodeEntity[]
  /** 创建/确定：由工作区落库、开绑定页签、关掉创建页签 */
  onCreate: (tabId: string, draft: VideoCreateDraft, videoNodeId?: string) => void
  /** 解析成功回写标题 */
  onResolved: (videoId: string, title: string, videoNodeId?: string) => void
  /** 播放进度（毫秒，已节流）：工作区写进视频资源，下次打开跳回；source 是那一项的输入 */
  onProgress: (videoId: string, positionMs: number, source: string) => void
  /** 选集切换：把「停在的那一项」写进资源（重开页签回到同一集） */
  onSelection: (videoId: string, source: string, title: string) => void
  /** AI 视频总结完成（总结 + 分段一次生成）：按来源写进资源；生成过没有再次入口 */
  onSaveRecap: (videoId: string, source: string, recap: VideoRecap) => void
}

export default function VideoTabLayer({
  tabs,
  activeId,
  store,
  onCommitStore,
  videos,
  videoNodes,
  onCreate,
  onResolved,
  onProgress,
  onSelection,
  onSaveRecap,
}: Props) {
  return (
    <>
      {tabs.map((tab) => {
        const videoNode =
          (videoNodes ?? []).find(
            (vn) => (tab.ref.videoNodeId && vn.id === tab.ref.videoNodeId) || (tab.ref.videoId && vn.videoId === tab.ref.videoId)
          ) ?? null
        const videoId = tab.ref.videoId || videoNode?.videoId || null
        const resolvedVideoNodeId = tab.ref.videoNodeId || videoNode?.id
        const resource = videoId ? (videos ?? []).find((v) => v.id === videoId) ?? null : null
        const active = tab.id === activeId
        return (
          <div
            key={tab.id}
            className={active ? 'absolute inset-0 z-10 flex min-h-0 flex-col' : 'absolute inset-0 -z-10 hidden'}
            aria-hidden={!active}
          >
            {tab.ref.videoId && !resource && !resolvedVideoNodeId ? (
              <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-paper p-6 text-center select-none">
                <MonitorPlay size={30} className="text-seal/50" />
                <p className="text-[13px] font-medium text-ink-strong">{t('视频已删除')}</p>
                <p className="max-w-[380px] text-[11.5px] leading-relaxed text-ink-faint">
                  {t('这个页签绑定的视频资源已经不在了（可能被删除）：关掉页签即可。')}
                </p>
              </div>
            ) : (
              <VideoStudyTab
                video={resource}
                tabId={tab.id}
                active={active}
                videoNodeId={resolvedVideoNodeId}
                store={store}
                onCommitStore={onCommitStore}
                initialInput={videoNode?.input ?? ''}
                onCreate={resource ? undefined : (draft) => onCreate(tab.id, draft, resolvedVideoNodeId)}
                onResolved={(title) => {
                  if (videoId) onResolved(videoId, title, resolvedVideoNodeId)
                }}
                onProgress={(positionMs, source) => {
                  if (videoId) onProgress(videoId, positionMs, source)
                }}
                onSelection={(source, title) => {
                  if (videoId) onSelection(videoId, source, title)
                }}
                onSaveRecap={(source, recap) => {
                  if (videoId) onSaveRecap(videoId, source, recap)
                }}
              />
            )}
          </div>
        )
      })}
    </>
  )
}
