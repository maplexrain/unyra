import { useEffect } from 'react'
import type { DocSource } from '../NodeNote'
import type { KnowledgeNode, LearnStore, TabRef, DocView } from '../../../learn/types'
import type { ChipPayload } from '../../../lib/docChip'
import { setChipOpener } from '../../../lib/docChip'
import { setWebLinkHandler } from '../../../lib/externalLink'
import { setPluginDocOpener } from '../../../lib/pluginDoc'
import { setSponsorsOpener } from '../../../lib/sponsorDoc'
import { setVideoBlockHost, cleanVideoNodeUuid, type VideoBlockData, type VideoEpisodeItem } from '../../../lib/videosBlock'
import { setQuoteBlockHost } from '../../../lib/quoteBlock'
import { setAiqaBlockHost } from '../../../lib/aiqaBlock'
import { setPlotFixHandler } from '../../../lib/plot'
import { setStaticView } from '../../../lib/staticView'
import {
  cachedResourceUrl,
  findResource,
  loadResourceImage,
  revealResource,
  subscribeResources,
} from '../../../learn/static'
import { resolveVideoSource } from '../../../lib/videoPlugins'
import { lineRangeToOffsets, localRevealKey, nodeRevealKey, requestSourceReveal } from '../../../lib/docReveal'
import { wsRelOfTab } from '../../../learn/workspace'
import { userAbsPath } from '../../../lib/storage'
import { nodePathOf } from '../../../learn/paths'
import { resolveDisplayedConversation } from '../../../learn/graph'
import { setEffortNotice } from '../../../learn/effortGuard'
import type { useAgent } from '../../../learn/useAgent'
import { resolveQuoteTarget, findPlotFenceRange } from './quoteTarget'
import { t } from '../../../i18n'

type AgentApi = ReturnType<typeof useAgent>

/** 宿主接线需要的宿主能力与派生值 */
export interface HostWiringDeps {
  onToast: (msg: string) => void
  activeGoalId: string | null
  store: LearnStore
  getLatest: () => LearnStore
  set: (s: LearnStore) => void
  openWebTab: (url: string) => void
  openChip: (p: ChipPayload) => void
  openTab: (ref: TabRef, preferredView?: DocView) => void
  docNode: KnowledgeNode | null
  docSource: DocSource | null
  agent: AgentApi
}

/**
 * 宿主接线：把「打开器 / 数据读取器」这一类回调登记进各自的模块级单例
 * （chip、插件文档、赞助、视频代码块、引用代码块、plot 修复、静态资源视图、
 * 网页链接、effort 提醒）。这些模块不认识 React 树，宿主是唯一的数据拥有者。
 */
export function useHostWiring({
  onToast,
  activeGoalId,
  store,
  getLatest,
  set,
  openWebTab,
  openChip,
  openTab,
  docNode,
  docSource,
  agent,
}: HostWiringDeps) {
  // 思考档位唯一性守卫的提醒出口（探针在 useAgent 注册，见 learn/effortGuard）：
  // 用户手动切档且已有带上下文的对话时，提醒一句「下一轮全价重算」
  useEffect(() => {
    setEffortNotice(() => {
      onToast(t('思考档位已切换：已有上下文的对话下一轮将无法命中服务商缓存，将整段重算'))
    })
    return () => setEffortNotice(null)
  }, [onToast])

  /**
   * 把目标级资源库的查询能力交给文档渲染层（见 lib/staticView）。
   *
   * 文档里的 `![图注](moji:static/<uuid>)` 与 `[文字](moji:static/<uuid>)` 在 DOM 提交后
   * 需要三件事：清单里这条资源是什么、图片字节、在文件管理器里定位它。这些都是 store 与磁盘的事，
   * 渲染层不认识它们，所以由这里注入。
   *
   * 依赖整个 store 快照（不只是 store.resources）：目标目录由根节点标题推出
   * （见 files.ts 的 nodeLayout），**改一次标题就会换掉资源的相对路径**，
   * 只盯清单会漏掉这一步。注册表一变，所有已渲染的文档都会重画一遍，
   * 代价只是一次签名比较（见 staticView 的 repaint）。
   */
  useEffect(() => {
    if (!activeGoalId) {
      setStaticView(null)
      return
    }
    const goalId = activeGoalId
    setStaticView({
      resource: (uuid) => findResource(getLatest(), goalId, uuid),
      // 同步那条路只走内存缓存：有图就直接贴上去，不让文档先闪一下占位
      cachedUrl: (uuid) => {
        const s = getLatest()
        const res = findResource(s, goalId, uuid)
        return res ? cachedResourceUrl(s, goalId, res) : null
      },
      loadUrl: async (uuid) => {
        const s = getLatest()
        const res = findResource(s, goalId, uuid)
        if (!res) return null
        const loaded = await loadResourceImage(s, goalId, res)
        return loaded?.url ?? null
      },
      reveal: (uuid) => {
        const s = getLatest()
        const res = findResource(s, goalId, uuid)
        if (!res) {
          onToast(t('这个资源已不在清单里，可能已被删除'))
          return
        }
        // revealResource 负责把「相对当前用户」的路径补成数据根下的完整路径
        // （漏了这一步会去 {root}/docs 下找，那里没有用户目录）。
        // 定位是异步的，但文件在登记之前就已经落盘了，不必等防抖保存。
        // 失败只提示、不抛出：磁盘上的事不该把界面打断（与节点文档的定位一致）
        void revealResource(s, goalId, res).then((ok) => {
          if (!ok) onToast(t('未能在资源管理器中定位该文件'))
        })
      },
      subscribe: subscribeResources,
    })
    return () => setStaticView(null)
  }, [activeGoalId, store, getLatest, onToast])

  // 应用内超链接与网页 chip 打开统一走应用内浏览器页签（openWebTab）
  useEffect(() => {
    setWebLinkHandler(openWebTab)
    return () => setWebLinkHandler(null)
  }, [openWebTab])

  // chip 的「点击打开」全走这一份登记（消息列表、输入框都不认识 store，见 lib/docChip）
  useEffect(() => {
    setChipOpener(openChip)
    return () => setChipOpener(null)
  }, [openChip])

  // 设置 → 插件里的「插件开发文档」：同一条打开器纪律（见 lib/pluginDoc）
  useEffect(() => {
    setPluginDocOpener(() => openTab({ kind: 'pluginDoc' }))
    return () => setPluginDocOpener(null)
  }, [openTab])

  // 顶栏「赞助」里的「赞助者名单」应用内打开器（见 lib/sponsorDoc）
  useEffect(() => {
    setSponsorsOpener(() => openTab({ kind: 'sponsors' }))
    return () => setSponsorsOpener(null)
  }, [openTab])

  // 视频代码块（```videos）的选集数据拉取与点播跳转：注册宿主接口
  useEffect(() => {
    setVideoBlockHost({
      getVideoData: async (videoNodeUuid: string): Promise<VideoBlockData | null> => {
        const s = getLatest()
        const raw = cleanVideoNodeUuid(videoNodeUuid)
        // 1. 优先按 videoNode.id 查找
        let vNode = (s.videoNodes ?? []).find((vn) => vn.id === raw)
        // 2. 次优先按 videoId 查找
        if (!vNode) vNode = (s.videoNodes ?? []).find((vn) => vn.videoId === raw)
        // 3. 兜底：从当前激活文档节点的上游连接查找视频节点
        if (!vNode && s.activeNodeId) {
          const upEdges = s.edges.filter((e) => e.to === s.activeNodeId)
          for (const e of upEdges) {
            const upV = (s.videoNodes ?? []).find((vn) => vn.id === e.from)
            if (upV) {
              vNode = upV
              break
            }
          }
        }
        // 4. 兜底：若该目标下只有一个视频节点，直接匹配它
        if (!vNode && s.activeGoalId) {
          const goalVNodes = (s.videoNodes ?? []).filter((vn) => vn.goalId === s.activeGoalId)
          if (goalVNodes.length === 1) vNode = goalVNodes[0]
        }
        // 5. 兜底：全局若只有一个视频节点
        if (!vNode && (s.videoNodes ?? []).length === 1) {
          vNode = s.videoNodes![0]
        }

        const videoId = vNode?.videoId ?? raw
        let video = (s.videos ?? []).find((v) => v.id === videoId)
        if (!video && !vNode && (s.videos ?? []).length === 1) {
          video = (s.videos ?? [])[0]
        }
        if (!video) return null

        try {
          const src = await resolveVideoSource(video.selection?.source ?? video.input, video.fields)
          let episodes: VideoEpisodeItem[] = []
          if (src.pages && src.pages.length > 0) {
            episodes = src.pages.map((p, idx) => ({
              page: typeof p.page === 'number' && p.page > 0 ? p.page : idx + 1,
              title: p.title,
              source: p.source,
              durationMs: p.durationMs,
            }))
          } else if (src.collection?.items && src.collection.items.length > 0) {
            episodes = src.collection.items.map((it, idx) => ({
              page: idx + 1,
              title: it.title,
              source: it.source,
              durationMs: it.durationMs,
            }))
          }
          return {
            videoTitle: src.title || video.title,
            pluginName: video.pluginName ?? video.pluginId,
            episodes,
          }
        } catch (err) {
          console.warn('[videosBlock] 解析视频选集失败', err)
          return null
        }
      },
      onOpenEpisode: (videoNodeUuid: string, episode: VideoEpisodeItem) => {
        const s = getLatest()
        const raw = cleanVideoNodeUuid(videoNodeUuid)
        let vNode = (s.videoNodes ?? []).find((vn) => vn.id === raw)
        if (!vNode) vNode = (s.videoNodes ?? []).find((vn) => vn.videoId === raw)
        if (!vNode && s.activeNodeId) {
          const upEdges = s.edges.filter((e) => e.to === s.activeNodeId)
          for (const e of upEdges) {
            const upV = (s.videoNodes ?? []).find((vn) => vn.id === e.from)
            if (upV) {
              vNode = upV
              break
            }
          }
        }
        if (!vNode && s.activeGoalId) {
          const goalVNodes = (s.videoNodes ?? []).filter((vn) => vn.goalId === s.activeGoalId)
          if (goalVNodes.length === 1) vNode = goalVNodes[0]
        }
        if (!vNode && (s.videoNodes ?? []).length === 1) {
          vNode = s.videoNodes![0]
        }

        const videoId = vNode?.videoId ?? raw
        const video =
          (s.videos ?? []).find((v) => v.id === videoId) ?? ((s.videos ?? []).length === 1 ? s.videos![0] : undefined)
        if (!video) return

        const nextSource = episode.source
        if (nextSource && nextSource !== (video.selection?.source ?? video.input)) {
          const updatedVideos = (s.videos ?? []).map((v) =>
            v.id === video.id
              ? {
                  ...v,
                  selection: { source: nextSource, title: episode.title },
                  progress: { source: nextSource, positionMs: 0, updatedAt: Date.now() },
                }
              : v,
          )
          set({ ...s, videos: updatedVideos })
        }
        openTab({ kind: 'video', videoId: video.id })
      },
    })
    return () => setVideoBlockHost(null)
  }, [getLatest, set, openTab])

  // 原文引用代码块（```quote）的文件内容读取与跳转：统一解析目标文件（见 quoteTarget.ts）
  useEffect(() => {
    setQuoteBlockHost({
      readFile: async (rawPath: string): Promise<string | null> => {
        const s = getLatest()
        const resolved = await resolveQuoteTarget(s, rawPath)
        return resolved ? resolved.content : null
      },
      onOpenFile: async (rawPath: string, startLine?: number, endLine?: number) => {
        const s = getLatest()
        const resolved = await resolveQuoteTarget(s, rawPath)
        if (!resolved || !resolved.tabRef) {
          let disp = (rawPath ?? '').trim()
          try {
            if (disp.includes('%')) disp = decodeURIComponent(disp)
          } catch {}
          onToast(t('未找到引用的源文件（{0}）', disp || '未知路径'))
          return
        }

        // 计算行定位区间并登记一次性定位请求
        if (startLine && startLine >= 1) {
          const eLine = endLine && endLine >= startLine ? endLine : startLine
          const offsets = lineRangeToOffsets(resolved.content, startLine, eLine)

          let revealTargetKey: string | null = null
          if (resolved.tabRef.kind === 'local') {
            revealTargetKey = localRevealKey(resolved.tabRef.path)
          } else if (resolved.tabRef.kind === 'ws') {
            const rel = wsRelOfTab(s, resolved.tabRef)
            const abs = rel ? userAbsPath(rel) : null
            if (abs) revealTargetKey = localRevealKey(abs)
          } else if (resolved.tabRef.kind === 'note') {
            revealTargetKey = nodeRevealKey(resolved.tabRef.nodeId, 'note', resolved.tabRef.note)
          }

          if (revealTargetKey) {
            requestSourceReveal(revealTargetKey, offsets.start, offsets.end)
          }
        }

        openTab(resolved.tabRef, startLine ? 'source' : undefined)
      },
    })
    return () => setQuoteBlockHost(null)
  }, [getLatest, openTab, onToast])

  // AIQA 随文问答块宿主：对话上下文持久化在知识节点上（aiqaChats），不篡改文档源码
  useEffect(() => {
    setAiqaBlockHost({
      getActiveNodeId: () => {
        return docNode ? docNode.id : null
      },
      getNodeAiqaSession: (nodeId, blockId) => {
        const s = getLatest()
        const targetId = nodeId || docNode?.id
        const target = s.nodes.find((n) => n.id === targetId)
        return target?.aiqaChats?.[blockId] ?? null
      },
      saveNodeAiqaSession: (nodeId, blockId, session) => {
        const s = getLatest()
        const targetId = nodeId || docNode?.id
        if (!targetId) return
        const nextNodes = s.nodes.map((n) => {
          if (n.id !== targetId) return n
          const chats = { ...(n.aiqaChats ?? {}) }
          if (!session || !session.messages || session.messages.length === 0) {
            delete chats[blockId]
          } else {
            chats[blockId] = session
          }
          return {
            ...n,
            aiqaChats: Object.keys(chats).length > 0 ? chats : undefined,
            updatedAt: Date.now(),
          }
        })
        set({ ...s, nodes: nextNodes })
      },
    })
    return () => setAiqaBlockHost(null)
  }, [getLatest, set, docNode])

  /*
    plot 错误卡片上的「让导师修复」：以**工作流**（learn/workflows 的 plot-fix）注入——
    隐藏指令、分界条一条，不是一条普通用户消息。报错原因、字符区间与围栏原文都算好
    塞进 {{占位符}}；区间与 doc.replace 的参数同语义，agent 一轮就能改完。
    目标是当前文档的节点——不是界面上此刻激活的那个导师页签（用户可能正看着 A 课的
    文档，agent 栏开着 B 课）。登记模式与上面的 setChipOpener 相同。
  */
  useEffect(() => {
    setPlotFixHandler(({ reason, source }) => {
      const node = docNode
      const convId = node ? resolveDisplayedConversation(getLatest(), node.goalId) : null
      if (!node || !convId) {
        onToast(t('这一页没有对应的导师会话，无法自动发送'))
        return
      }
      /*
        在当前文档源码里找这段围栏的 [start, end)：start 指向 ```plot 行首，
        end 越过收尾的 ```。找不到（文档刚被改过、或这一页不是纯文本源）就如实给
        [0, 0)，指令里会让 agent 先用 doc.find 定位——别给一个看似对的错区间。
      */
      const content = docSource?.content ?? ''
      const range = findPlotFenceRange(content, source)
      agent.runWorkflow('plot-fix', {
        target: { goalId: node.goalId, nodeId: node.id, conversationId: convId },
        params: {
          nodeTitle: node.title,
          reason,
          path: nodePathOf(getLatest(), node.goalId, node.id),
          range: range ? `[${range.start}, ${range.end})` : '[0, 0)（未能自动定位，文档可能刚被改过）',
          start: range ? range.start : 0,
          end: range ? range.end : 0,
          source,
        },
      })
      onToast(t('已把报错发给导师，请看对话栏'))
    })
    return () => setPlotFixHandler(null)
  }, [docNode, getLatest, agent, onToast])
}
