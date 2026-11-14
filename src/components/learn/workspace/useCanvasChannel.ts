import { useCallback, useMemo, useRef } from 'react'
import type { DocView, FileNodeKind, KnowledgeNode, LearnStore, TabRef } from '../../../learn/types'
import { addConversation, nodeById, normalizeKey, removeEdge, resolveDisplayedConversation } from '../../../learn/graph'
import { syncGoalOutlineTabs } from '../../../learn/groups'
import { NodeService, docIdOfOutlineUuid, type GNodeKind } from '../../../learn/nodeKinds'
import { outlineByMember } from '../../../learn/outline'
import { noteById, writeNoteSummary } from '../../../learn/notes'
import { generateNoteSummary } from '../../../learn/noteSummary'
import type { StructureMap } from '../../../learn/structure'
import { resolveProjectRoot } from '../../../learn/projects'
import { examAttempted, type Exam } from '../../../learn/exam'
import { goalDirOf } from '../../../learn/static/location'
import { FILES_DIR } from '../../../learn/layout'
import { userAbsPath } from '../../../lib/storage'
import { native } from '../../../lib/native'
import type { useAgent } from '../../../learn/useAgent'
import type { useWorkflowStarters } from './useWorkflowStarters'
import type { ExamBridgeApi } from '../../../learn/useExamBridge'
import { t } from '../../../i18n'

type AgentApi = ReturnType<typeof useAgent>
type StartersApi = ReturnType<typeof useWorkflowStarters>

/** 删除目标/节点的确认载荷（与宿主的删除确认流共用一份形状） */
export interface PendingNodeDelete {
  nodeId: string
  title: string
  isRoot: boolean
  count: number
}

/** 结构画布统一通道需要的宿主能力与派生值 */
export interface CanvasChannelDeps {
  store: LearnStore
  getLatest: () => LearnStore
  set: (s: LearnStore) => void
  onToast: (msg: string) => void
  openTab: (ref: TabRef, preferredView?: DocView) => void
  exam: ExamBridgeApi
  hasKey: boolean
  providerName: string
  onOpenSettings: () => void
  agent: AgentApi
  startPrereqOutline: StartersApi['startPrereqOutline']
  startVideoOverview: StartersApi['startVideoOverview']
  goalSubtreeSize: (rootOrGoalId: string) => number
  setPendingDelete: (p: PendingNodeDelete | null) => void
  setPendingExamDelete: (e: Exam | null) => void
  setExamDeleteStage: (s: 'warn' | 'final') => void
}

/* ---------- 结构画布通道（建 / 删 / 连 / 改名，与 agent 的 api.node 同一条 NodeService 路） ---------- */
export function useCanvasChannel({
  store,
  getLatest,
  set,
  onToast,
  openTab,
  exam,
  hasKey,
  providerName,
  onOpenSettings,
  agent,
  startPrereqOutline,
  startVideoOverview,
  goalSubtreeSize,
  setPendingDelete,
  setPendingExamDelete,
  setExamDeleteStage,
}: CanvasChannelDeps) {
  const generateTeachingDoc = useCallback(
    (targetNode: KnowledgeNode, hint?: string) => {
      if (!hasKey) {
        onToast(t('生成教学文档需要 AI，请先在设置中填写「{0}」的 API Key', providerName))
        onOpenSettings()
        return
      }
      const s = getLatest()
      let convId = resolveDisplayedConversation(s, targetNode.goalId)
      if (!convId) {
        const { store: nextStore, conversation } = addConversation(s, targetNode.goalId)
        set(nextStore)
        convId = conversation.id
      }
      // hint 是发起方的意图上下文（如结构画布的「落地哪条目标项」），跟着这一轮进模型
      agent.autoTeach({ goalId: targetNode.goalId, nodeId: targetNode.id, conversationId: convId }, false, hint)
      onToast(t('已开始为「{0}」生成教学文档', targetNode.title))
    },
    [hasKey, providerName, onToast, onOpenSettings, getLatest, set, agent],
  )

  /**
   * 递给正文区的「生成教学文档」回调——**身份必须稳定**。
   *
   * DocPane / NodeNote / DocBody 都是 memo，且 DocBody 的比较器显式比了这个 prop。
   * 在渲染里现造闭包（`() => generateTeachingDoc(node)`）会让比较恒为不等，
   * 于是每次工作区渲染——包括 Agent 每一跳流式——都把当前正文整棵重渲一遍。
   * 真正的那份实现依赖 agent 等易变对象，注定每轮都是新的；这里用 ref 转发，
   * 只把「稳定的一层壳」交给 props，点下去时读到的仍是最新实现。
   */
  const generateDocRef = useRef(generateTeachingDoc)
  generateDocRef.current = generateTeachingDoc
  const requestGenerateDoc = useCallback(
    (n: KnowledgeNode) => generateDocRef.current(n),
    [],
  )

  /**
   * 结构图变了：整张换上去（v2 只剩坐标表）。空表不留在 store 里——
   * `structure.json` 的空壳没有意义，读盘那一侧按「空 = 还没拖过」处理。
   */
  const updateStructure = useCallback(
    (goalId: string, next: StructureMap) => {
      const s = getLatest()
      const structure = { ...(s.structure ?? {}) }
      if (Object.keys(next.positions).length) structure[goalId] = next
      else delete structure[goalId]
      set({ ...s, structure: Object.keys(structure).length ? structure : undefined })
    },
    [getLatest, set],
  )

  /**
   * 结构画布拖出一张笔记节点时用：建一份**真实的空笔记**，把名字交回去。
   *
   * 与侧栏的「新建笔记」不同，这里**不打开页签**——用户要的是先在图上有这张卡，
   * 想写的时候点标题再打开。笔记不需要上下文，所以这一步是纯本地的、同步的。
   */
  /*
   * 节点服务（统一通道）：画布的建 / 删 / 连 / 改名与 agent 的 api.node 走的是
   * **同一个 NodeService**——画布上不再有任何「只存在于图里」的状态。目标的坐标
   * 由派生自动铺排，删除时顺手把坐标表里那条清掉（别留死键）。
   */
  const makeNodeService = useCallback(
    () => new NodeService({ getLatest, set, goalId: () => getLatest().activeGoalId ?? '' }),
    [getLatest, set],
  )

  const dropPositionOf = useCallback(
    (uuid: string) => {
      const s = getLatest()
      if (!s.structure) return
      const structure = { ...s.structure }
      let touched = false
      for (const [gid, map] of Object.entries(structure)) {
        if (!(uuid in map.positions)) continue
        const { [uuid]: _drop, ...rest } = map.positions
        structure[gid] = { ...map, positions: rest }
        touched = true
      }
      if (touched) set({ ...s, structure })
    },
    [getLatest, set],
  )

  const canvasCreateNode = useCallback(
    (kind: GNodeKind, under: string | null, _pos?: { x: number; y: number }, extra?: Record<string, unknown>) =>
      makeNodeService().create({ kind, ...(under ? { under } : {}), ...(extra ?? {}) }),
    [makeNodeService],
  )

  /**
   * 画布垃圾桶是**用户的**删除通道，与服务那条 agent 通道共用同一套「删谁只删谁」：
   * 大纲卡删除 = 清空计划（文档与下级文档都在）；试卷卡走**用户自己的两档确认**
   * （与试卷列表同一条路：列出连带删掉什么 → 二次确认 → 可撤回），正在考的先挡下；
   * 其余走统一服务（文档只删自己，下游断线成游离）。
   */
  const canvasDeleteNode = useCallback(
    (uuid: string) => {
      const target = getLatest().exams.find((e) => e.id === uuid)
      if (target) {
        if (exam.live && exam.live.examId === uuid) {
          onToast(t('有一场考试正在进行，先把它考完或放弃'))
          return { ok: true as const }
        }
        setPendingExamDelete(target)
        setExamDeleteStage(examAttempted(target) ? 'warn' : 'final')
        return { ok: true as const }
      }
      // 删根文档 = 删整个目标（根就是目标的骨架）：从画布的删除键触发也必须走两档确认
      const goal = getLatest().goals.find((g) => g.id === uuid || g.rootNodeId === uuid)
      if (goal) {
        const node = goal.rootNodeId ? nodeById(getLatest(), goal.rootNodeId) : null
        const title = goal.title || goal.question || node?.title || uuid
        setPendingDelete({ nodeId: goal.id, title, isRoot: true, count: goalSubtreeSize(goal.id) })
        return { ok: true as const }
      }
      const r = makeNodeService().delete(uuid)
      if ('ok' in r) dropPositionOf(uuid)
      return r
    },
    [getLatest, makeNodeService, dropPositionOf, onToast, exam.live, setPendingExamDelete, setExamDeleteStage, setPendingDelete, goalSubtreeSize],
  )

  const canvasConnect = useCallback(
    (fromUuid: string, toUuid: string, portKey?: string) => {
      const svc = makeNodeService()
      const from = svc.get(fromUuid)
      const to = svc.get(toUuid)
      if (!from || !to) return { error: '有一个节点刚刚不在了（可能被删除）' }
      return from.connect(to, 'down', portKey)
    },
    [makeNodeService],
  )

  const canvasDisconnect = useCallback(
    (fromUuid: string, toUuid: string) => {
      const svc = makeNodeService()
      const from = svc.get(fromUuid)
      const to = svc.get(toUuid)
      if (!from || !to) return { error: '有一个节点刚刚不在了（可能被删除）' }
      return from.disconnect(to)
    },
    [makeNodeService],
  )

  const canvasRenameNote = useCallback(
    (noteUuid: string, to: string) => {
      const svc = makeNodeService()
      const node = svc.get(noteUuid)
      if (!node || node.kind !== 'note') return { error: '这份笔记已经不在了' }
      const c = node.content as { text?: string }
      return node.editContent({ title: to, text: typeof c.text === 'string' ? c.text : '' })
    },
    [makeNodeService],
  )

  const canvasAddOutlineEntry = useCallback(
    (outlineUuid: string, title: string) => {
      const svc = makeNodeService()
      const outline = svc.get(outlineUuid)
      if (!outline || outline.kind !== 'outline') return
      const current = (outline.content as { intro?: string; children?: Array<{ title: string; summary: string }> } | null) ?? null
      const r = outline.editContent({
        intro: current?.intro ?? '',
        children: [...(current?.children ?? []), { title, summary: '' }],
      })
      if ('error' in r) onToast(r.error)
      else onToast(t('已添加目标项「{0}」', title))
    },
    [makeNodeService, onToast],
  )

    const canvasRenameOutlineEntry = useCallback(
    (outlineUuid: string, slotKey: string, nextTitle: string) => {
      const trimmed = nextTitle.trim()
      if (!trimmed) return
      const svc = makeNodeService()
      const outline = svc.get(outlineUuid)
      if (!outline || outline.kind !== 'outline') return
      const current = (outline.content as { intro?: string; children?: Array<{ key?: string; title: string; summary?: string }> } | null) ?? null
      const children = current?.children ?? []
      const targetEntry = children.find((c) => c.key === slotKey || normalizeKey(c.title) === slotKey || c.title === slotKey)
      if (!targetEntry) return
      if (targetEntry.title === trimmed) return

      const oldKey = targetEntry.key ?? normalizeKey(targetEntry.title)
      const newKey = normalizeKey(trimmed)

      const nextChildren = children.map((c) => (c === targetEntry ? { ...c, title: trimmed, key: newKey } : c))
      const r = outline.editContent({
        intro: current?.intro ?? '',
        children: nextChildren,
        allowEmpty: true,
      })
      if ('error' in r) {
        onToast(r.error)
        return
      }

      // 如果有依赖边认领了这个旧 slotKey，同步更新边上的 portKey 保持连线关系不丢
      if (oldKey !== newKey) {
        const s = getLatest()
        const docId = docIdOfOutlineUuid(outlineUuid)
        const matchingEdges = s.edges.filter(
          (e) => (e.from === outlineUuid || (docId && e.from === docId)) && (e.portKey === slotKey || e.portKey === oldKey),
        )
        if (matchingEdges.length > 0) {
          const nextEdges = s.edges.map((e) =>
            (e.from === outlineUuid || (docId && e.from === docId)) && (e.portKey === slotKey || e.portKey === oldKey)
              ? { ...e, portKey: newKey }
              : e,
          )
          set({ ...s, edges: nextEdges })
        }
      }
      onToast(t('已将目标项重命名为「{0}」', trimmed))
    },
    [makeNodeService, onToast, getLatest, set],
  )

  const canvasDeleteOutlineEntry = useCallback(
    (outlineUuid: string, slotKey: string) => {
      const svc = makeNodeService()
      const outline = svc.get(outlineUuid)
      if (!outline || outline.kind !== 'outline') return
      const current = (outline.content as { intro?: string; children?: Array<{ key?: string; title: string; summary?: string }> } | null) ?? null
      const children = current?.children ?? []
      const targetEntry = children.find((c) => c.key === slotKey || normalizeKey(c.title) === slotKey || c.title === slotKey)
      if (!targetEntry) return

      const nextChildren = children.filter((c) => c !== targetEntry)
      const r = outline.editContent({
        intro: current?.intro ?? '',
        children: nextChildren,
        allowEmpty: true,
      })
      if ('error' in r) {
        onToast(r.error)
        return
      }

      const s = getLatest()
      const docId = docIdOfOutlineUuid(outlineUuid)
      const matchingEdges = s.edges.filter(
        (e) => (e.from === outlineUuid || (docId && e.from === docId)) && (e.portKey === slotKey || (targetEntry.key && e.portKey === targetEntry.key)),
      )
      if (matchingEdges.length > 0) {
        let nextStore = getLatest()
        for (const edge of matchingEdges) {
          nextStore = removeEdge(nextStore, edge.from, edge.to)
        }
        set(nextStore)
      }
      onToast(t('已删除目标项「{0}」', targetEntry.title))
    },
    [makeNodeService, onToast, getLatest, set],
  )

  /**
   * 在目标项上挂一份带标题的空文档（统一通道）：create 的同目标去重让同一标题
   * 永远指向同一份实体；只建实体不写正文——正文由「生成文档」交给 AI。
   */
  const createChildDoc = useCallback(
    (ownerNodeId: string, title: string, portKey?: string): string | null => {
      const r = makeNodeService().create({ kind: 'doc', title, under: ownerNodeId, ...(portKey ? { portKey } : {}) })
      return 'uuid' in r ? r.uuid : null
    },
    [makeNodeService],
  )

  /** 空文档卡上的「生成文档」：复用正文区那颗按钮同一条路径；hint 为画布侧的意图 */
  const generateDocForNode = useCallback(
    (nodeId: string, hint?: string) => {
      const n = nodeById(getLatest(), nodeId)
      if (n) generateDocRef.current(n, hint)
    },
    [getLatest],
  )

  /**
   * 右键「设为入口」：把一份**没有上级**的文档立为那张图的入口（目标的根）。
   * 一张图有且只有一个——换入口就是旧的退位（它还挂在图上，多半从此变成游离卡）。
   */
  const canvasSetEntry = useCallback(
    (docUuid: string) => {
      const s = getLatest()
      const node = nodeById(s, docUuid)
      if (!node) return { error: t('这份文档已经不在了') }
      const goal = s.goals.find((g) => g.id === node.goalId)
      if (!goal) return { error: t('这个文档不属于任何学习目标') }
      if (goal.rootNodeId === docUuid) return { error: t('它已经是入口了') }
      if (s.edges.some((e) => e.to === docUuid)) {
        return { error: t('「{0}」已经有上级了——只有没有上级的文档能立为入口', node.title) }
      }
      const nextGoals = s.goals.map((g) => (g.id === goal.id ? { ...g, rootNodeId: docUuid, updatedAt: Date.now() } : g))
      const nextDocArea = syncGoalOutlineTabs(s.docArea, [{ id: goal.id, rootNodeId: docUuid }])
      set({ ...s, goals: nextGoals, docArea: nextDocArea })
      return { ok: true, note: t('已把「{0}」立为入口：这门课从这里开始（原入口文档还在图上）', node.title) }
    },
    [getLatest, set],
  )

  /**
   * 「生成大纲导读」（**大纲卡**右键菜单——导读生在大纲本体上，不是教学文档上）：
   * 给已经写成的大纲补一段对它本身的讲解（guide，只写导读、不动 intro 与 children）。
   * 规矩在「大纲导读」提示词模块里；只读的导读页签**当场打开**——生成过程中它跟着
   * 写入更新，跑完就能看到。指名 = 右键的那一张卡（文档 uuid 或 o: 大纲 uuid 都认）。
   */
  const startOutlineGuide = useCallback(
    (nodeId?: string) => {
      if (!hasKey) {
        onToast(t('生成大纲导读需要 AI，请先在设置中填写「{0}」的 API Key', providerName))
        onOpenSettings()
        return
      }
      if (!nodeId) return
      const s = getLatest()
      const outlineTarget = nodeId.startsWith('o:') ? nodeId : nodeById(s, nodeId) ? 'o:' + nodeId : null
      if (!outlineTarget) {
        onToast(t('没有找到这份大纲'))
        return
      }
      const found = outlineByMember(s, outlineTarget)
      if (!found) {
        onToast(t('没有找到这份大纲'))
        return
      }
      const outline = found.kind === 'attached' ? found.outline : found.entity
      if (!outline || (!outline.intro.trim() && !outline.children.length)) {
        onToast(t('这份大纲还没有内容，先生成大纲再写导读'))
        return
      }
      const title = found.kind === 'attached' ? found.doc.title : found.entity.title
      agent.runWorkflow('outline-guide', {
        ...(found.kind === 'attached' ? { nodeId: found.docId } : {}),
        params: { target: found.uuid },
      })
      openTab(
        found.kind === 'attached'
          ? { kind: 'guide', outlineId: found.docId }
          : { kind: 'guide', outlineId: found.entity.id, goalId: found.entity.goalId },
      )
      onToast(t('已请导师撰写「{0}」的大纲导读', title))
    },
    [hasKey, providerName, onToast, onOpenSettings, getLatest, agent, openTab],
  )

  /** 打开一份大纲已有的导读页签（大纲卡右键菜单的「大纲导读」）；没有导读时说明一句 */
  const openOutlineGuide = useCallback(
    (outlineUuid: string) => {
      const found = outlineByMember(getLatest(), outlineUuid)
      if (!found) {
        onToast(t('没有找到这份大纲'))
        return
      }
      const guide = found.kind === 'attached' ? found.outline?.guide : found.entity.guide
      if (!guide) {
        onToast(t('这份大纲还没有导读——在它的大纲卡右键「生成大纲导读」补一份'))
        return
      }
      openTab(
        found.kind === 'attached'
          ? { kind: 'guide', outlineId: found.docId }
          : { kind: 'guide', outlineId: found.entity.id, goalId: found.entity.goalId },
      )
    },
    [getLatest, onToast, openTab],
  )

  /**
   * 「生成总结」（笔记卡右键菜单）：一份笔记的 ≤200 字内容总结，落在笔记卡的卡面上。
   * 刻意不走导师对话——这是一次请求就答得完的活（内部一次性补全，见 learn/noteSummary）；
   * 生成完原位落 NoteFile.summary，卡片随 store 更新。
   */
  const startNoteSummary = useCallback(
    (noteId: string) => {
      const note = noteById(getLatest(), noteId)
      if (!note) {
        onToast(t('这份笔记已经不在了'))
        return
      }
      if (!note.content.trim()) {
        onToast(t('这份笔记还是空的，没有可总结的内容'))
        return
      }
      if (!hasKey) {
        onToast(t('生成总结需要 AI，请先在设置中填写「{0}」的 API Key', providerName))
        onOpenSettings()
        return
      }
      onToast(t('正在总结「{0}」…', note.name))
      void generateNoteSummary({ title: note.name, content: note.content })
        .then((summary) => {
          const next = writeNoteSummary(getLatest(), noteId, summary)
          if (!next) {
            onToast(t('这份笔记已经不在了'))
            return
          }
          set(next)
          onToast(t('「{0}」的总结已生成', note.name))
        })
        .catch((err: unknown) => {
          onToast(err instanceof Error ? err.message : t('总结生成失败，稍后再试'))
        })
    },
    [getLatest, set, onToast, hasKey, providerName, onOpenSettings],
  )

  /** 画布统一通道（一个稳定对象：OutlinePane 按 referential equality 冻结比较） */
  const canvasChannel = useMemo(
    () => ({
      onCreateNode: canvasCreateNode,
      onDeleteNode: canvasDeleteNode,
      onConnect: canvasConnect,
      onDisconnect: canvasDisconnect,
      onSetEntry: canvasSetEntry,
      onCreateChildDoc: createChildDoc,
      onRenameNote: canvasRenameNote,
      onAddOutlineEntry: canvasAddOutlineEntry,
      onDeleteOutlineEntry: canvasDeleteOutlineEntry,
      onRenameOutlineEntry: canvasRenameOutlineEntry,
      onGenerateDoc: generateDocForNode,
      onGenerateOutline: (docUuid: string) => startPrereqOutline(docUuid),
      onGenerateOutlineGuide: startOutlineGuide,
      onOpenOutlineGuide: openOutlineGuide,
      onGenerateNoteSummary: startNoteSummary,
      // 视频卡的绑定 / 打开：绑定走节点的 editContent（与 agent 动手是同一条路），打开走 openTab 的组联动
      onBindVideo: (nodeUuid: string, videoId: string | null) => {
        const node = makeNodeService().get(nodeUuid)
        if (!node || node.kind !== 'video') return { error: '这个视频节点已经不在了' }
        return node.editContent({ videoId })
      },
      // 项目卡的路径声明：同样走节点对象的 editContent（与 agent 同一条路），拼法由路径
      // 自己说（盘符 / / 开头 = 绝对）。保存成功后把**还不存在的目录**建出来——相对路径
      // 第一次用最常见的场景就是新建一个项目目录；解析不出根（如数据根未就绪）时跳过，
      // 第一次读写时主进程会把原因讲清楚。
      onSetProjectPath: async (nodeUuid: string, path: string) => {
        const node = makeNodeService().get(nodeUuid)
        if (!node || node.kind !== 'project') return { error: '这个项目节点已经不在了' }
        const r = node.editContent({ path })
        if ('error' in r) return r
        const entity = getLatest().projects?.find((p) => p.id === nodeUuid)
        const root = entity ? resolveProjectRoot(getLatest(), entity) : null
        if (root) {
          try {
            await native().projectFs({ op: 'mkdir', roots: [root], path: root })
          } catch {
            // 建不出来不阻断保存：卡上与第一次读写时都会有清楚的说法
          }
        }
        return r
      },
      // 点项目卡目录树里的一个文件：本地文件页签打开（TabRef.local 认磁盘绝对路径）
      onOpenProjectFile: (absPath: string) => {
        const name = absPath.split(/[\\/]/).pop() || absPath
        openTab({ kind: 'local', path: absPath, title: name })
      },
      onBindFile: (nodeUuid: string, patch: { fileKind?: FileNodeKind; url?: string; title?: string }) => {
        const node = makeNodeService().get(nodeUuid)
        if (!node || node.kind !== 'file') return { error: '这个文件节点已经不在了' }
        return node.editContent(patch)
      },
      onOpenFileNode: (nodeUuid: string) => {
        const fileEntity = store.fileNodes?.find((f) => f.id === nodeUuid)
        if (!fileEntity) {
          onToast(t('这个文件节点已经不在了'))
          return
        }
        if (!fileEntity.url) {
          onToast(t('该文件节点尚未绑定文件或网址'))
          return
        }
        if (fileEntity.fileKind === 'web') {
          openTab({
            kind: 'web',
            url: fileEntity.url,
            key: 'fn_' + fileEntity.id,
            fileNodeId: fileEntity.id,
            goalId: fileEntity.goalId,
          })
          return
        }
        const goalDir = goalDirOf(store, fileEntity.goalId)
        if (!goalDir) {
          onToast(t('找不到该文件节点所属的目标目录'))
          return
        }
        const fileName = fileEntity.url.replace(/^files\//, '')
        const relPath = `${goalDir}/${FILES_DIR}/${fileName}`
        const absPath = userAbsPath(relPath) ?? relPath
        openTab({ kind: 'local', path: absPath, title: fileEntity.title || fileName })
      },
      onOpenVideo: (videoId: string) => openTab({ kind: 'video', videoId }),
      onOpenVideoNode: (videoNodeUuid: string) => {
        const vNode = store.videoNodes?.find((vn) => vn.id === videoNodeUuid)
        if (!vNode) {
          onToast(t('这个视频节点已经不在了'))
          return
        }
        openTab({
          kind: 'video',
          videoNodeId: vNode.id,
          videoId: vNode.videoId ?? undefined,
          goalId: vNode.goalId,
        })
      },
      onUpdateVideoNode: (nodeUuid: string, patch: { input?: string; title?: string; titleCustomized?: boolean }) => {
        const node = makeNodeService().get(nodeUuid)
        if (!node || node.kind !== 'video') return { error: '这个视频节点已经不在了' }
        return node.editContent(patch)
      },
      onGenerateVideoDoc: (videoNodeUuid: string) => startVideoOverview(videoNodeUuid),
    }),
    [canvasCreateNode, canvasDeleteNode, canvasConnect, canvasDisconnect, canvasSetEntry, createChildDoc, canvasRenameNote, canvasAddOutlineEntry, canvasRenameOutlineEntry, canvasDeleteOutlineEntry, generateDocForNode, startPrereqOutline, startVideoOverview, startOutlineGuide, openOutlineGuide, startNoteSummary, makeNodeService, openTab, getLatest, set, store, onToast],
  )

  return { requestGenerateDoc, updateStructure, canvasChannel }
}
