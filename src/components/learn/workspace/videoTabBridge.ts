import type { DocView, LearnStore, TabRef, VideoRecap, VideoResource } from '../../../learn/types'
import { confirmVideoNode } from '../../../learn/video/nodes'
import type { TabCloseMode } from '../../../learn/tabs'
import type { VideoCreateDraft } from '../../video/VideoStudyTab'
import { t } from '../../../i18n'

/** 视频页签桥需要的宿主能力（renderGroup 是普通函数，这里用工厂而不是 hook） */
export interface VideoTabBridgeDeps {
  getLatest: () => LearnStore
  set: (s: LearnStore) => void
  openTab: (ref: TabRef, preferredView?: DocView) => void
  activeGoalId: string | null
  onToast: (msg: string) => void
  /** 关掉「就地创建」的那枚草稿页签（renderGroup 所在格） */
  closeTab: (groupId: string, tabId: string, mode: TabCloseMode) => void
  groupId: string
}

/**
 * VideoTabLayer 的五个写库回调（创建 / 标题落定 / 进度 / 选集 / 总结）。
 *
 * renderGroup 是**普通函数**（不能在里面调 hook），而 onCreate 还要关掉当前格的
 * 草稿页签——依赖格 id，所以做成按格现造的工厂：每次渲染各格造一份，
 * 与原先内联在 JSX 里的闭包同一身份语义。
 */
export function createVideoTabBridge({ getLatest, set, openTab, activeGoalId, onToast, closeTab, groupId }: VideoTabBridgeDeps) {
  return {
    onCreate: (tabId: string, draft: VideoCreateDraft, videoNodeId?: string) => {
      const id = crypto.randomUUID()
      const now = Date.now()
      const record: VideoResource = {
        id,
        pluginId: draft.pluginId,
        pluginName: draft.pluginName,
        input: draft.input,
        ...(Object.keys(draft.fields).length ? { fields: draft.fields } : {}),
        title: draft.input.slice(0, 60),
        createdAt: now,
      }
      const latest = getLatest()
      let nextStore: LearnStore = { ...latest, videos: [...(latest.videos ?? []), record] }
      if (videoNodeId) {
        const r = confirmVideoNode(
          nextStore,
          videoNodeId,
          {
            input: draft.input,
            title: draft.input.slice(0, 60),
            pluginId: draft.pluginId,
            pluginName: draft.pluginName,
            fields: draft.fields,
          },
          now,
        )
        if (!('error' in r)) {
          nextStore = r.store
        }
      }
      set(nextStore)
      if (videoNodeId) {
        openTab({ kind: 'video', videoNodeId, videoId: id, goalId: activeGoalId ?? undefined })
      } else {
        openTab({ kind: 'video', videoId: id })
        closeTab(groupId, tabId, 'self')
      }
    },
    onResolved: (videoId: string, title: string, videoNodeId?: string) => {
      const latest = getLatest()
      const list = latest.videos ?? []
      const cur = list.find((v) => v.id === videoId)
      const vNode = videoNodeId ? (latest.videoNodes ?? []).find((vn) => vn.id === videoNodeId) : null
      let touched = false
      let nextVideos = list
      let nextVideoNodes = latest.videoNodes ?? []
      if (cur && cur.title !== title) {
        nextVideos = list.map((v) => (v.id === videoId ? { ...v, title, updatedAt: Date.now() } : v))
        touched = true
      }
      if (vNode && !vNode.titleCustomized && vNode.title !== title) {
        nextVideoNodes = nextVideoNodes.map((vn) =>
          vn.id === videoNodeId ? { ...vn, title, updatedAt: Date.now() } : vn,
        )
        touched = true
      }
      if (touched) {
        set({ ...latest, videos: nextVideos, videoNodes: nextVideoNodes })
      }
    },
    onProgress: (videoId: string, positionMs: number, source?: string) => {
      const latest = getLatest()
      const list = latest.videos ?? []
      const cur = list.find((v) => v.id === videoId)
      if (!cur) return
      set({
        ...latest,
        videos: list.map((v) =>
          v.id === videoId
            ? {
                ...v,
                progress: { ...(source ? { source } : {}), positionMs: Math.round(positionMs), updatedAt: Date.now() },
              }
            : v,
        ),
      })
    },
    onSelection: (videoId: string, source: string, title?: string) => {
      const latest = getLatest()
      const list = latest.videos ?? []
      const cur = list.find((v) => v.id === videoId)
      if (!cur) return
      set({
        ...latest,
        videos: list.map((v) =>
          v.id === videoId
            ? {
                ...v,
                selection: { source, ...(title ? { title } : {}) },
                // 换集就把进度归零到新那一项：旧进度不能续到别的集上
                progress: { source, positionMs: 0, updatedAt: Date.now() },
              }
            : v,
        ),
      })
    },
    onSaveRecap: (videoId: string, source: string, recap: VideoRecap) => {
      // 视频总结（总结+分段**一次生成**）按来源落库；生成过就不再生成（空态才给入口）
      if (!recap.summary && !recap.chapters?.length) return
      const latest = getLatest()
      const list = latest.videos ?? []
      const cur = list.find((v) => v.id === videoId)
      if (!cur) return
      set({
        ...latest,
        videos: list.map((v) =>
          v.id === videoId
            ? { ...v, recaps: { ...(v.recaps ?? {}), [source]: recap }, updatedAt: Date.now() }
            : v,
        ),
      })
      if (recap.chapters?.length) {
        onToast(t('已生成总结与分段：{0} 段，分段点在进度条上', String(recap.chapters.length)))
      } else {
        onToast(t('已生成总结'))
      }
    },
  }
}
