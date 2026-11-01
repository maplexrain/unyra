/** 反序列化的顶层入口：把 nodes / goals / conversations / 资源与各类账本整份归一成 LearnStore。 */

import type {
  Conversation,
  DependencyEdge,
  DetachedPool,
  KnowledgeNode,
  LearningGoal,
  LearnStore,
  MethodEntry,
  NoteFile,
  SuperDocFile,
  MethodStore,
  WorkflowBook,
} from '../../types'
import type { Exam } from '../../exam'
import { allTabs, ensureAnchorOutlines, focusedTab, normalizeDocs, reconcileOwners, withOwners, withParked } from '../../groups'
import { tabNodeId } from '../../tabs'
import { normalizeAgentTabs } from '../../agentTabs'
import { normalizeDrafts } from '../../drafts'
import { normalizeWorkflowEntries } from '../../workflows'
import { normalizeEssayDock, normalizeEssays } from '../../essays'
import { normalizeEssayCommits } from '../../essayCommits'
import { normalizeSchedule } from '../../schedule'
import { normalizeStructureBook } from '../../structure'
import { normalizeOutlineEntities } from '../../outline'
import type { VideoChapter, VideoRecap, VideoResource } from '../../types'
import { normalizeVideoNodes, withVideoMirror } from '../../video/nodes'
import { normalizeMemoryStore } from '../../memory'
import { normalizeResourceList, retargetStaticRefs, type StaticResource } from '../../static'
import { normalizeTmpStore, pruneTmpToNodes } from '../../../lib/tmpStore'
import { normalizeNode } from './node'
import { normalizeConversation } from './conversation'
import { normalizeExam } from './exam'
import { normalizeDocScroll, normalizeFavorites, normalizeFavGroups, normalizeLocalFiles, normalizeTab } from './tabs'

/**
 * 把一份（可能来自磁盘、也可能来自导入文件）的数据归一成合法的学习数据；
 * 结构不合法返回 null。
 */
export function normalizeLearnStore(data: unknown): LearnStore | null {
  try {
    if (!data || typeof data !== 'object') return null
    const d = data as Partial<LearnStore>
    /*
     * 原始那一份（不经过 LearnStore 的形状）：文件区那一块要读**旧版**字段
     * （顶层的 tabs / activeTab），而它们已经不在 LearnStore 里了——从 d 上读不到。
     */
    const legacy = data as { tabs?: unknown; activeTab?: unknown }
    if (!Array.isArray(d.nodes)) return null

    const parsed = d.nodes.map(normalizeNode).filter((n): n is KnowledgeNode => n !== null)

    // 同一目标内按 key 去重
    const seen = new Set<string>()
    const nodes: KnowledgeNode[] = []
    for (const n of parsed) {
      const sk = `${n.goalId}\u0001${n.key}`
      if (seen.has(sk)) continue
      seen.add(sk)
      nodes.push(n)
    }
    const ids = new Set(nodes.map((n) => n.id))

    const rawGoals: unknown[] = Array.isArray(d.goals) ? d.goals : []
    const goals: LearningGoal[] = []
    for (const rawGoal of rawGoals) {
      if (!rawGoal || typeof rawGoal !== 'object') continue
      const r = rawGoal as Record<string, unknown>
      const id = typeof r.id === 'string' ? r.id : ''
      const rootNodeId = typeof r.rootNodeId === 'string' && ids.has(r.rootNodeId) ? r.rootNodeId : ''
      if (!id) continue
      goals.push({
        id,
        title: typeof r.title === 'string' ? r.title : (typeof r.question === 'string' ? r.question : ''),
        rootNodeId,
        question: typeof r.question === 'string' ? r.question : '',
        createdAt: typeof r.createdAt === 'number' ? r.createdAt : Date.now(),
        updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : Date.now(),
      })
    }
    const goalIds = new Set(goals.map((g) => g.id))

    // 游离大纲先归一：树边的两端可能是 o:{游离实体id}（目标没了的实体在这里就丢掉）
    const freeOutlines = normalizeOutlineEntities(d.outlines).filter((o) => goalIds.has(o.goalId))
    const freeIds = new Set(freeOutlines.map((o) => o.id))

    // 视频资源与视频节点先归一（绑定行只认还存在的视频；资源上的引用镜像稍后按表重建）
    const videos = normalizeVideos(d.videos)
    const videoIds = new Set(videos.map((v) => v.id))
    const videoNodes = normalizeVideoNodes(d.videoNodes, goalIds, videoIds)
    const videoNodeIds = new Set(videoNodes.map((v) => v.id))

    const rawEdges: unknown[] = Array.isArray(d.edges) ? d.edges : []
    const edges: DependencyEdge[] = []
    const edgeSeen = new Set<string>()
    for (const rawEdge of rawEdges) {
      if (!rawEdge || typeof rawEdge !== 'object') continue
      const r = rawEdge as Record<string, unknown>
      const from = typeof r.from === 'string' ? r.from : ''
      // 旧格式的 toOutline 标记迁到拼法上：接大纲卡的边 to = o:{文档id}（分类链）
      const to = r.toOutline === true && typeof r.to === 'string' && !r.to.startsWith('o:') ? 'o:' + r.to : typeof r.to === 'string' ? r.to : ''
      // 树成员校验：文档 id 在节点表里；o: 前缀解开后是节点 id（附身大纲）或游离实体 id；res: 前缀解开后是资源归纳实体 id
      const memberOk = (m: string): boolean =>
        !!m && (
          ids.has(m) ||
          videoNodeIds.has(m) ||
          (m.startsWith('o:') && (ids.has(m.slice(2)) || freeIds.has(m.slice(2))))
        )
      if (!from || !to || from === to || !memberOk(from) || !memberOk(to)) continue
      const edgeKey = `${from}>${to}`
      if (edgeSeen.has(edgeKey)) continue
      edgeSeen.add(edgeKey)
      const portKey = typeof r.portKey === 'string' && r.portKey ? r.portKey : undefined
      edges.push({ from, to, createdAt: typeof r.createdAt === 'number' ? r.createdAt : Date.now(), ...(portKey ? { portKey } : {}) })
    }

    // 自动修补：若文档正文中包含 ```videos 代码块且当前没有上游连线，自动恢复其到对应视频节点的连线
    for (const node of nodes) {
      if (!node.docs?.teaching?.includes('```videos')) continue
      const hasUpstream = edges.some((e) => e.to === node.id)
      if (hasUpstream) continue
      const vMatch = /```videos\s*[\r\n]+([^\r\n]+)/.exec(node.docs.teaching)
      let targetVNodeId = vMatch ? vMatch[1].trim().replace(/^\{\{\s*|\s*\}\}$/g, '').replace(/^(?:uuid|videoNodeUUID)\s*[:：]\s*/i, '').trim() : ''
      if (targetVNodeId.toLowerCase() === 'videonodeuuid') targetVNodeId = ''

      let matchedVNode = targetVNodeId ? videoNodes.find((vn) => vn.id === targetVNodeId || vn.videoId === targetVNodeId) : undefined
      if (!matchedVNode && node.goalId) {
        const goalVNodes = videoNodes.filter((vn) => vn.goalId === node.goalId)
        if (goalVNodes.length === 1) matchedVNode = goalVNodes[0]
      }
      if (matchedVNode) {
        const edgeKey = `${matchedVNode.id}>${node.id}`
        if (!edgeSeen.has(edgeKey)) {
          edgeSeen.add(edgeKey)
          edges.push({ from: matchedVNode.id, to: node.id, createdAt: Date.now() })
        }
      }
    }

    // 无归属的节点（旧数据）挂到第一个目标上，避免丢失
    const fallbackGoal = goals[0]?.id ?? ''
    const fixedNodes = nodes.map((n) =>
      n.goalId && goalIds.has(n.goalId) ? n : { ...n, goalId: fallbackGoal },
    )

    // 节点 → 它所属的目标，供旧数据里的 nodeId 折算成 goalId
    const goalOfNode = new Map(fixedNodes.map((n) => [n.id, n.goalId]))
    const conversations: Conversation[] = []
    const convSeen = new Set<string>()
    if (Array.isArray(d.conversations)) {
      for (const rawConv of d.conversations) {
        const conv = normalizeConversation(rawConv, goalIds, (nodeId) => goalOfNode.get(nodeId) ?? '')
        // 按会话 id 去重。曾经这里按 nodeId 去重——那会把同一个节点的多个会话
        // 只留一条，且下一次保存时把其余的真的删掉，与「一个节点可挂多个对话」
        // 的设计正好相反。
        if (!conv || convSeen.has(conv.id)) continue
        convSeen.add(conv.id)
        conversations.push(conv)
      }
    }

    const activeGoalId =
      typeof d.activeGoalId === 'string' && goalIds.has(d.activeGoalId)
        ? d.activeGoalId
        : (goals[0]?.id ?? null)
    const activeNodeId =
      typeof d.activeNodeId === 'string' && ids.has(d.activeNodeId)
        ? d.activeNodeId
        : (goals.find((g) => g.id === activeGoalId)?.rootNodeId ?? null)
    // 会话按目标归属：当前会话必须在当前目标里，否则回落到该目标最近的一个
    const activeConversationId =
      typeof d.activeConversationId === 'string' &&
      conversations.some((c) => c.id === d.activeConversationId && c.goalId === activeGoalId)
        ? d.activeConversationId
        : ([...conversations].reverse().find((c) => c.goalId === activeGoalId)?.id ?? null)

    const exams: Exam[] = []
    if (Array.isArray(d.exams)) {
      for (const raw of d.exams) {
        const e = normalizeExam(raw)
        if (e) exams.push(e)
      }
    }

    // 游离挂件池：目标已经没了的整桶丢掉；实体只留形状对的（见 learn/detached）
    const detached: Record<string, DetachedPool> = {}
    const rawDetached = (d.detached && typeof d.detached === 'object' ? d.detached : {}) as Record<string, unknown>
    for (const [poolGoalId, rawPool] of Object.entries(rawDetached)) {
      if (!goalIds.has(poolGoalId) || !rawPool || typeof rawPool !== 'object') continue
      const p = rawPool as Record<string, unknown>
      const notes = (Array.isArray(p.notes) ? p.notes : []).filter(
        (n): n is NoteFile => !!n && typeof n === 'object' && typeof (n as NoteFile).id === 'string' && typeof (n as NoteFile).name === 'string' && typeof (n as NoteFile).content === 'string',
      )
      const superdocs = (Array.isArray(p.superdocs) ? p.superdocs : []).filter(
        (dd): dd is SuperDocFile => !!dd && typeof dd === 'object' && typeof (dd as SuperDocFile).id === 'string' && typeof (dd as SuperDocFile).name === 'string' && typeof (dd as SuperDocFile).html === 'string',
      )
      if (notes.length || superdocs.length) detached[poolGoalId] = { notes, superdocs }
    }

    // 资源清单按目标归属：目标已经没了的那些条目留不住（文件本体是另一回事）
    const resources: Record<string, StaticResource[]> = {}
    const rawResources = (d.resources && typeof d.resources === 'object' ? d.resources : {}) as Record<
      string,
      unknown
    >
    for (const [goalId, list] of Object.entries(rawResources)) {
      if (!goalIds.has(goalId)) continue
      const items = normalizeResourceList(list)
      if (items.length) resources[goalId] = items
    }

    /*
      记忆（见 learn/memory）：长期那份跨目标（来自 state.json），工作那份按目标归属——
      目标没了的记忆也没有意义（与 resources 同一条纪律）。
      老形状（上一版的 minds，目标 id → 条目）一并交下去，折成这个目标的工作记忆。
    */
    const memory = normalizeMemoryStore(
      d.memory,
      // legacyMinds 来自 parseDocs（磁盘上老形状的 mind.json）；minds 来自导入的旧备份
      (d as { legacyMinds?: unknown; minds?: unknown }).legacyMinds ??
        (d as { minds?: unknown }).minds,
      goalIds,
    )

    // 目标级持久化函数（method.*）按目标归属：目标没了的函数也没有意义
    const methods: MethodStore = {}
    const rawMethods = (d.methods && typeof d.methods === 'object' ? d.methods : {}) as Record<string, unknown>
    for (const [goalId, list] of Object.entries(rawMethods)) {
      if (!goalIds.has(goalId) || !Array.isArray(list)) continue
      const items: MethodEntry[] = []
      for (const item of list) {
        if (!item || typeof item !== 'object') continue
        const m = item as Record<string, unknown>
        const name = typeof m.name === 'string' ? m.name.trim() : ''
        const code = typeof m.code === 'string' ? m.code : ''
        if (!name || !code) continue
        // 同名条目只认第一份：手改出来的重复会调用时指不清是哪一个
        if (items.some((x) => x.name.toLowerCase() === name.toLowerCase())) continue
        items.push({
          name: name.slice(0, 64),
          code,
          createdAt: typeof m.createdAt === 'number' ? m.createdAt : Date.now(),
          updatedAt: typeof m.updatedAt === 'number' ? m.updatedAt : Date.now(),
        })
      }
      if (items.length) methods[goalId] = items
    }

    // 工作流登记表（见 learn/workflows）：global 跟着用户走（state.json 里的那一份），
    // byGoal 只留还活着的目标——目标没了的工作流也没有意义（与 method 同一条纪律）
    const workflows: WorkflowBook = {
      global: normalizeWorkflowEntries(d.workflows?.global),
      byGoal: {},
    }
    const rawGoalWorkflows = (d.workflows?.byGoal ?? {}) as Record<string, unknown>
    for (const [goalId, list] of Object.entries(rawGoalWorkflows)) {
      if (!goalIds.has(goalId)) continue
      const items = normalizeWorkflowEntries(list)
      if (items.length) workflows.byGoal[goalId] = items
    }
    // 旧文件里的 workflows.efforts（每条工作流的思考档位）2026-10-25 起不再读：
    // 档位全应用只有全局滑条一份，旧配置直接作废，下次落盘自然消失。

    const byId = new Map(fixedNodes.map((n) => [n.id, n]))
    /*
     * 文档区：新版读 docs，旧版读顶层的 tabs / activeTab（自动折成单组，见 groups 的
     * normalizeDocs）。两种数据都要认——用户升级之后第一次打开，看到的该还是那排页签。
     */
    const docAreaRaw = normalizeDocs(d.docArea, legacy, (raw) => normalizeTab(raw, byId))
    // 停靠场的键也是目标 id。旧版本只校验了形状，目标删除后留下的停靠组会在下次
    // 打开大纲时复活文档，因此读盘时先按当前目标表剪掉无主停靠组。
    const parked = Object.fromEntries(
      Object.entries(docAreaRaw.parkedTabs ?? {}).filter(([goalId]) => goalIds.has(goalId)),
    )
    const docArea0 = ensureAnchorOutlines(
      withParked(docAreaRaw, Object.keys(parked).length > 0 ? parked : undefined),
      (nodeId) => byId.get(nodeId)?.goalId ?? null,
      (goalId) => goals.find((g) => g.id === goalId)?.rootNodeId ?? null,
    )
    /*
     * 目标页签归属（见 groups/goals）：旧数据里没有这张表，现算补一份。
     *
     * 补得对不对直接决定「升级之后第一次打开会不会看到页签集体消失」——所以这一步
     * 必须在读盘时做，而不是等界面第一次过滤时才发现表是空的。判据取自节点自己的
     * goalId（页签上带着 nodeId），于是补出来的归属与用户当初的直觉一致。
     */
    const docArea: typeof docArea0 = (() => {
      const owners = reconcileOwners(docArea0.tabOwners, allTabs(docArea0), (nodeId) => byId.get(nodeId)?.goalId ?? null)
      return withOwners(docArea0, owners)
    })()
    // 「当前节点」跟着焦点格里激活的页签走：两者都是上次退出时存的，一个被手改过或者
    // 指向了已经删掉的节点时，让它们重新对齐（页签是用户看得见的那个，以它为准）
    const activeTabNode = focusedTab(docArea)
    const tabNodeId2 = activeTabNode ? tabNodeId(activeTabNode.ref) : null
    const nextActiveNodeId = tabNodeId2 && ids.has(tabNodeId2) ? tabNodeId2 : activeNodeId

    // agent 栏页签：目标没了 / 会话或子代理会话没了的当场剪掉，激活项对齐留下的页签
    let agentTabsState = normalizeAgentTabs(d.agentTabs, d.agentActiveTab, {
      goals: goalIds,
      conversations,
    })
    /*
     * 升级路径：老 state.json 里没有 agent 页签（那时还是单面板），但「上次在看哪段对话」
     * 有存——把那段会话的目标折成第一枚导师页签，重开应用对话栏不因此空白。
     */
    if (!agentTabsState.tabs.length && activeConversationId) {
      const conv = conversations.find((c) => c.id === activeConversationId)
      if (conv) {
        agentTabsState = {
          tabs: [{ kind: 'goal', goalId: conv.goalId, conversationId: conv.id }],
          active: 'ga:' + conv.goalId,
        }
      }
    }

    /** 随笔窗口的几何（认不出就是没有：下次打开按默认位置摆） */
    const essayDock = normalizeEssayDock(d.essayDock)

    const store: LearnStore = {
      version: 2,
      nodes: fixedNodes,
      edges,
      goals,
      conversations,
      exams,
      ...(Object.keys(detached).length ? { detached } : {}),
      ...(freeOutlines.length ? { outlines: freeOutlines } : {}),
      // 临时变量只保留还挂在现有节点上的那些——节点没了，它的暂存数据也没有意义
      tmp: pruneTmpToNodes(normalizeTmpStore(d.tmp), ids),
      resources,
      memory,
      methods,
      // 随笔同样是目标级的：目标没了的整本丢掉，空文本条目丢掉（见 learn/essays）
      essays: normalizeEssays(d.essays, goalIds),
      // 提交记录与随笔同一份 essay.json：目标没了的、认不出的丢掉；running 降成「未完成可重试」
      essayCommits: normalizeEssayCommits(d.essayCommits, goalIds),
      // 窗口几何只校验是不是数；夹进视口是打开那一刻的事（见 EssayDock）
      ...(essayDock ? { essayDock } : {}),
      workflows,
      /*
       * 阅读 / 打卡 / 专注：认不出的部分各自丢掉，坏数据不该拖垮整库。
       * 阅读记录还要**按节点过滤**（与上面 tmp 同一个道理）：节点被删掉之后，那些按
       * nodeId 索引的记录就成了空索引——今日阅读面板里一行 uuid、点不动的条目就是这么来的。
       * 放在这里做还能顺手清掉以前删节点时留下的旧空索引（读盘是唯一一次全量过手的机会）。
       *
       */
      // 日程是用户级数据（见 learn/schedule）：不按目标过滤，坏条目逐条丢
      schedule: normalizeSchedule(d.schedule),
      // 视频资源（见 learn/types 的 VideoResource）：用户级、不按目标过滤，坏条目逐条丢
      ...(videos.length ? { videos } : {}),
      // 视频节点（目标 × 视频的绑定）：目标没了的行丢掉、指向不存在视频的绑定摘掉
      ...(videoNodes.length ? { videoNodes } : {}),
      // 资源归纳节点（终端实体）：目标没了的行丢掉
      /*
       * 结构图（见 learn/structure）：按目标存的节点表与连线。逐张过一遍——
       * 坏坐标、认不出的类型、违规的边都在 normalizeStructure 里丢掉，
       * 目标已经不在的整张丢掉（它是那门课的结构，课没了结构也不该留着）。
       */
      ...(() => {
        const structure = normalizeStructureBook(d.structure, goalIds)
        return Object.keys(structure).length ? { structure } : {}
      })(),
      activeGoalId,
      activeNodeId: nextActiveNodeId,
      activeConversationId,
      docArea,
      // 暂存区按节点 id 校验：节点已经没了的那些不认（同页签的口径）
      drafts: normalizeDrafts(d.drafts, ids),
      // 读到哪儿了：只认有限的非负数，坏值丢掉（位置读错只该退回从头，不该让整份状态读不出来）
      docScroll: normalizeDocScroll(d.docScroll),
      localFiles: normalizeLocalFiles(d.localFiles),
      favGroups: normalizeFavGroups(d.favGroups),
      // 收藏夹按「东西还在不在」校验（与页签的口径一致）：节点没了、笔记改名了的收藏当场丢
      favorites: normalizeFavorites(d.favorites, byId, exams),
      agentTabs: agentTabsState.tabs,
      agentActiveTab: agentTabsState.active,
    }
    // 视频资源上的 boundTo 镜像按事实源（videoNodes）整表重建：读回来的那份不作数
    const mirrored = videos.length && videoNodes.length ? withVideoMirror(store) : store
    return retargetStaticRefs(mirrored)
  } catch (err) {
    // 静默吞掉等于「启动整库读空、下一次保存把好数据覆盖掉」——收藏就是这么丢的。
    // 至少要把这一声喊出来：修数据的线索全在这一条日志里。
    console.error('[learn] 学习数据解析失败，本次启动按空库处理：', err)
    return null
  }
}

/** 解析一段 JSON 文本为学习数据（导入备份用）；结构不合法返回 null */
export function parseLearnStore(raw: string): LearnStore | null {
  try {
    return normalizeLearnStore(JSON.parse(raw))
  } catch (err) {
    // 与上面同一件事：导入备份解析失败也不该是一声不吭的 null
    console.error('[learn] 备份数据解析失败：', err)
    return null
  }
}


/**
 * 视频资源：只认「字段齐全 + id 唯一」的条目。
 * title 缺了用输入截断顶上（列表里总得有个名字）；fields 只留标量值。
 */
/** 选集状态：source 必须是非空字符串 */
function normalizeSelection(raw: unknown): { source: string; title?: string } | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  const source = typeof o.source === 'string' ? o.source.trim() : ''
  if (!source) return undefined
  return { source, ...(typeof o.title === 'string' && o.title.trim() ? { title: o.title.trim() } : {}) }
}

/** 播放进度：只认「非负整数毫秒 + 时间戳」，坏形状当没记过（source 可选，旧数据没有） */
function normalizeProgress(
  raw: unknown,
): { source?: string; positionMs: number; updatedAt: number } | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  const positionMs =
    typeof o.positionMs === 'number' && Number.isFinite(o.positionMs) && o.positionMs >= 0
      ? Math.round(o.positionMs)
      : null
  const updatedAt = typeof o.updatedAt === 'number' && Number.isFinite(o.updatedAt) ? o.updatedAt : Date.now()
  const source = typeof o.source === 'string' && o.source.trim() ? o.source.trim() : undefined
  return positionMs === null ? undefined : { ...(source ? { source } : {}), positionMs, updatedAt }
}

/** 视频总结（一个动作生成的 summary + chapters，按选集 source 一份）；坏形状整份丢或按缺失兜底 */
function normalizeRecaps(raw: unknown): Record<string, VideoRecap> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const out: Record<string, VideoRecap> = {}
  for (const [source, item] of Object.entries(raw as Record<string, unknown>)) {
    if (!source.trim() || !item || typeof item !== 'object' || Array.isArray(item)) continue
    const o = item as Record<string, unknown>
    const summary = typeof o.summary === 'string' ? o.summary.replace(/\s+/g, ' ').trim().slice(0, 600) : ''
    const chapters: VideoChapter[] = []
    if (Array.isArray(o.chapters)) {
      const seen = new Set<number>()
      for (const c of o.chapters) {
        if (!c || typeof c !== 'object') continue
        const e = c as Record<string, unknown>
        const startMs =
          typeof e.startMs === 'number' && Number.isFinite(e.startMs) && e.startMs >= 0 ? Math.round(e.startMs) : null
        const text = typeof e.summary === 'string' ? e.summary.replace(/\s+/g, ' ').trim().slice(0, 60) : ''
        if (startMs === null || !text || seen.has(startMs)) continue
        seen.add(startMs)
        chapters.push({ startMs, summary: text })
      }
      chapters.sort((a, b) => a.startMs - b.startMs)
    }
    if (!summary && !chapters.length) continue
    out[source] = { ...(summary ? { summary } : {}), ...(chapters.length ? { chapters } : {}) }
  }
  return Object.keys(out).length ? out : undefined
}

function normalizeVideos(raw: unknown): VideoResource[] {
  if (!Array.isArray(raw)) return []
  const out: VideoResource[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const id = typeof o.id === 'string' ? o.id.trim() : ''
    const input = typeof o.input === 'string' ? o.input.trim() : ''
    const pluginId = typeof o.pluginId === 'string' ? o.pluginId.trim() : ''
    if (!id || !input || !pluginId || seen.has(id)) continue
    seen.add(id)
    const fields: Record<string, string | number | boolean> = {}
    if (o.fields && typeof o.fields === 'object') {
      for (const [k, v] of Object.entries(o.fields as Record<string, unknown>)) {
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') fields[k] = v
      }
    }
    const recaps = normalizeRecaps(o.recaps)
    out.push({
      id,
      pluginId,
      ...(typeof o.pluginName === 'string' && o.pluginName ? { pluginName: o.pluginName } : {}),
      input,
      ...(Object.keys(fields).length ? { fields } : {}),
      title: typeof o.title === 'string' && o.title.trim() ? o.title.trim() : input.slice(0, 60),
      ...(normalizeSelection(o.selection) ? { selection: normalizeSelection(o.selection) } : {}),
      ...(normalizeProgress(o.progress) ? { progress: normalizeProgress(o.progress) } : {}),
      ...(recaps ? { recaps } : {}),
      createdAt: typeof o.createdAt === 'number' ? o.createdAt : Date.now(),
      ...(typeof o.updatedAt === 'number' ? { updatedAt: o.updatedAt } : {}),
    })
  }
  return out
}
