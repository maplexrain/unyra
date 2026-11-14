/**
 * 结构画布的**纯逻辑**：从 store 派生一张能画的图（deriveCanvas）+ 连线几何与点选。
 *
 * ## deriveCanvas（v2 的心脏）
 *
 * 输入只有 `(store, goalId, 存过的坐标表)`，输出 `{ cards, edges, heightOf }`：
 * - **卡片就是节点**（uuid 直接对上 store 实体）：每份文档、附身大纲（node.outline，
 *   写了才有卡）、游离大纲（store.outlines 的独立实体，没有文档卡）、每份笔记 /
 *   试卷 / 超级文档各一张卡；
 * - **连线全部派生**：树边（store.edges，两端是树成员 id——文档 id 或 o:{大纲id}）
 *   画在成员卡之间（to 以 o: 开头即接在大纲卡上的分类链，否则交替链）；
 *   归属边画「文档 → 自己的大纲与挂件」——图上没有任何一条存出来的线；
 * - **坐标以存过的为准，没存的自动铺排**：从根的脸出发按深度落列（BFS，
 *   同列往下挪到不重叠处），完全确定——同一份输入永远派生出同一张图。
 *
 * 为什么从组件里拆出来：仓库的 oxlint 规矩是「组件文件只导出组件」；这些事都能单测，
 * 而且都容易在「顺手优化一下」时改错。
 */

import type { LearnStore } from '../../../../learn/types'
import { examsOfNode, nodeById, prereqIds } from '../../../../learn/graph'
import { notesOf } from '../../../../learn/notes'
import { attemptScore, type ExamAttempt } from '../../../../learn/exam'
import { resolveProjectRoot } from '../../../../learn/projects'
import { superDocsOf } from '../../../../learn/types'
import { docIdOfOutlineUuid, outlineUuid } from '../../../../learn/nodeKinds'
import {
  CARD_H,
  COL_GAP,
  ROW_GAP,
  defaultHeight,
  freeSpotNear,
  cardWidthOf,
  type CardPos,
  type HeightOf,
  type StructureMap,
} from '../../../../learn/structure'
import { DOC_BODY_H, examCardHeight, noteCardHeight, outlineCardHeight } from './cardMetrics'
import { slotAnchorY } from './palette'
import type { CanvasEdge, CanvasView, CardView, ExamAttemptRow, OutlineSlotView } from './viewModel'

/**
 * 试卷卡的考试记录行：一行一次作答，状态用一句话说清、判了分的带分数。
 * 放在派生层（与 store 同一份数据），组件只管照着画。
 */
function attemptRows(attempts: ExamAttempt[]): ExamAttemptRow[] {
  const LABEL: Record<ExamAttempt['status'], string> = {
    ongoing: '进行中',
    submitted: '待判分',
    graded: '已判分',
    abandoned: '已放弃',
  }
  return attempts.map((a, i) => {
    const score = a.status === 'graded' ? attemptScore(a) : null
    return { n: i + 1, label: `${LABEL[a.status]}${score !== null ? ' · ' + score + ' 分' : ''}`, attemptId: a.id }
  })
}

/* ---------- 显示文字 ---------- */

function clip(text: string, max = 46): string {
  const s = text.replace(/\s+/g, ' ').trim()
  return s.length > max ? `${s.slice(0, max)}…` : s
}

/**
 * 把 Markdown 正文压成**一段**能塞进卡片两行的纯文字：读起来像一句话的清洗，
 * 不是保留结构的转换——完整正文在文档里，摘要只负责让人认出这是哪一篇。
 */
function plainText(md: string): string {
  return (
    md
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/^\s{0,3}#{1,6}\s*/gm, '')
      .replace(/^\s{0,3}>\s?/gm, '')
      .replace(/^\s{0,3}[-*+]\s+/gm, '')
      .replace(/^\s{0,3}\d+[.)]\s+/gm, '')
      .replace(/^\s*\|?[\s:|-]{6,}\|?\s*$/gm, ' ')
      .replace(/\|/g, ' ')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/~~([^~]+)~~/g, '$1')
      .replace(/\s*\n\s*/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
  )
}

/* ---------- 派生 ---------- */

/**
 * 从 store 派生一张能画的图（见文件头）。`saved` 是存过的坐标表（含便条）；
 * 没有目标 / 没有节点时回空图。
 */
export function deriveCanvas(store: LearnStore, goalId: string, saved: StructureMap | undefined): CanvasView {
  const goal = store.goals.find((g) => g.id === goalId)
  const docs = store.nodes.filter((n) => n.goalId === goalId)
  const positions: Record<string, CardPos> = saved?.positions ?? {}

  if (!goal) return { cards: [], edges: [], heightOf: defaultHeight }

  /* 1. 卡片清单（先不带坐标）与连线 */

  interface Pending {
    card: Omit<CardView, 'x' | 'y'>
    depth: number
    /** 自动铺排的 y 锚（父卡的中心行；已存坐标时不用） */
    anchorY: number
    /** BFS 的下游：铺完自己之后按序铺它们 */
    next: Pending[]
    parent: Pending | null
    /** 认领了接口的子级：铺排锚到父大纲那条目标项的行上（行号 = 目标项序号） */
    slotAnchor?: { parent: string; index: number }
    targetAnchorY?: number
    placed?: boolean
  }

  const edges: CanvasEdge[] = []
  const edgeSeen = new Set<string>()
  const pushEdge = (from: string, to: string): boolean => {
    const k = `${from}>${to}`
    if (edgeSeen.has(k)) return false
    edgeSeen.add(k)
    edges.push({ from, to })
    return true
  }
  const byUuid = new Map<string, Pending>()

  const add = (p: Pending): void => {
    byUuid.set(p.card.uuid, p)
  }

  const docPending = new Map<string, Pending>()

  const makeDoc = (docId: string): Pending => {
    const node = nodeById(store, docId)
    if (!node) throw new Error('deriveCanvas: 节点已不存在（' + docId + '）')
    const body = node.docs?.teaching.trim() ?? ''
    /*
     * 认领了接口的文档：自己还没起正经标题（创建时落下的占位名「新文档 / 新文档 2」）
     * 就显示接口的 label——它是什么由它认领的那条目标项说了算（与节点对象的 getPortData
     * 同一套口径：key 到宿主大纲的目标项里对号）。断线 = 认领消失 = 自动回落占位名。
     */
    const claimEdge = store.edges.find((e) => e.to === node.id && e.portKey)
    const portLabel = claimEdge
      ? nodeById(store, claimEdge.from)?.outline?.children.find((c) => c.key === claimEdge.portKey)?.title ?? ''
      : ''
    const title = (/^新文档( \d+)?$/.test(node.title) && portLabel ? portLabel : node.title)
    const excerpt = body ? plainText(body).slice(0, 120) || body.replace(/\s+/g, ' ').slice(0, 120) : ''
    const isRoot = docId === goal.rootNodeId
    const p: Pending = {
      card: {
        uuid: node.id,
        kind: 'doc',
        title,
        subtitle: body ? `${body.length} 字` : '还没有正文',
        ...(excerpt ? { excerpt } : {}),
        ...(body ? {} : { blank: true }),
        ...(isRoot ? { entry: true as const } : {}),
      },
      depth: 1,
      anchorY: 0,
      next: [],
      parent: null,
    }
    return p
  }

  // 先把全部文档卡建出来（连树边要两端的卡）
  for (const node of docs) {
    const p = makeDoc(node.id)
    docPending.set(node.id, p)
    add(p)
  }

  /*
   * 大纲卡两类（图上是同一种节点）：
   * - 附身：node.outline，uuid `o:{宿主文档id}`，标题跟宿主文档；
   * - 游离：store.outlines 里的独立实体，uuid `o:{实体id}`，没有文档卡——
   *   分类树的结构层。
   * 目标项的 childId 直接给**树边落点那张卡**的 uuid（认领边上的 to 成员 id）。
   */
  const outlinePending = new Map<string, Pending>()
  /** 树边成员（doc id 或 o:）折成文档 id：旧式 key 对号只认文档（嵌套子级折回它的宿主） */
  const memberDocIds = (voice: string): string[] =>
    prereqIds(store, voice)
      .map((m) => (m.startsWith('o:') ? m.slice(2) : m))
      .filter((cid) => !!nodeById(store, cid))
  const slotsOf = (voice: string, entries: { key: string; title: string }[], childDocs: string[]): OutlineSlotView[] =>
    entries.map((e, index) => {
      const claimed = store.edges.find((ed) => ed.from === voice && ed.portKey === e.key)
      const legacyId =
        childDocs
          .map((cid) => nodeById(store, cid))
          .find((c) => c && c.key === e.key)?.id ?? null
      // 旧数据没有认领边时按 key 对号；对上了也看一眼真实边的拼法（to=o: 即接在大纲卡上）
      const childId =
        claimed?.to ??
        (legacyId
          ? store.edges.some((e2) => e2.from === voice && e2.to === 'o:' + legacyId)
            ? 'o:' + legacyId
            : legacyId
          : null)
      return { key: e.key, title: e.title, index, childId }
    })

  for (const node of docs) {
    if (!node.outline) continue
    const slots = slotsOf(node.id, node.outline.children, memberDocIds(node.id))
    const intro = node.outline.intro?.trim() ?? ''
    const p: Pending = {
      card: {
        uuid: outlineUuid(node.id),
        kind: 'outline',
        title: node.title,
        subtitle: slots.length ? `${slots.length} 个目标项` : intro ? clip(intro) : '还没有大纲',
        ...(node.outline.guide ? { hasGuide: true } : {}),
        slots,
      },
      depth: 1,
      anchorY: 0,
      next: [],
      parent: null,
    }
    outlinePending.set(p.card.uuid, p)
    add(p)
  }
  for (const entity of store.outlines ?? []) {
    if (entity.goalId !== goalId) continue
    const voice = outlineUuid(entity.id)
    const slots = slotsOf(voice, entity.children, memberDocIds(voice))
    const intro = entity.intro.trim()
    const p: Pending = {
      card: {
        uuid: voice,
        kind: 'outline',
        title: entity.title,
        subtitle: slots.length ? `${slots.length} 个目标项` : intro ? clip(intro) : '还没有目标项',
        ...(entity.guide ? { hasGuide: true } : {}),
        slots,
        free: true,
      },
      depth: 1,
      anchorY: 0,
      next: [],
      parent: null,
    }
    outlinePending.set(voice, p)
    add(p)
  }

  const videoPending = new Map<string, Pending>()
  for (const entity of store.videoNodes ?? []) {
    if (entity.goalId !== goalId) continue
    const video = entity.videoId ? (store.videos ?? []).find((v) => v.id === entity.videoId) : undefined
    const p: Pending = {
      card: {
        uuid: entity.id,
        kind: 'video',
        title: entity.title || video?.title || '未命名视频',
        subtitle: entity.input || video?.input || '',
        ...(entity.confirmed || video ? {} : { blank: true }),
        video: {
          videoId: entity.videoId ?? null,
          input: entity.input ?? '',
          confirmed: !!entity.confirmed,
        },
      },
      depth: 1,
      anchorY: 0,
      next: [],
      parent: null,
    }
    videoPending.set(entity.id, p)
    add(p)
  }

  /*
   * 项目卡（目标 × 真实路径的授权声明，见 learn/projects）：独立实体，游离或挂在
   * 文档之下都画。路径本体与解析结果都在派生里给足——组件只管画（目录树的懒加载
   * 是组件自己的运行时状态，不进派生）。
   */
  const projectPending = new Map<string, Pending>()
  for (const entity of store.projects ?? []) {
    if (entity.goalId !== goalId) continue
    const resolved = resolveProjectRoot(store, entity)
    const p: Pending = {
      card: {
        uuid: entity.id,
        kind: 'project',
        title: entity.title,
        subtitle: entity.path
          ? (entity.pathKind === 'relative' ? '相对 · ' : '绝对 · ') + clip(entity.path, 42)
          : '声明一条真实路径，把一个目录交给 agent',
        ...(entity.path ? {} : { blank: true }),
        project: { path: entity.path, pathKind: entity.pathKind, resolved },
      },
      depth: 1,
      anchorY: 0,
      next: [],
      parent: null,
    }
    projectPending.set(entity.id, p)
    add(p)
  }

  // 挂件：笔记 / 试卷 / 超级文档，创建即挂，卡随实体（照旧挂在内容文档卡之下）
  const docAttachments = new Map<string, Pending[]>()
  for (const node of docs) {
    const doc = docPending.get(node.id)
    if (!doc) continue
    const atts: Pending[] = []
    for (const note of notesOf(node)) {
      const p: Pending = {
        card: {
          uuid: note.id,
          kind: 'note',
          title: note.name,
          subtitle: note.content.trim() ? `${note.content.length} 字` : '还是空的',
          ...(note.summary ? { summary: note.summary } : {}),
        },
        depth: 1,
        anchorY: 0,
        next: [],
        parent: doc,
      }
      add(p)
      pushEdge(node.id, note.id)
      doc.next.push(p)
      atts.push(p)
    }
    for (const exam of examsOfNode(store, node.id)) {
      const p: Pending = {
        card: {
          uuid: exam.id,
          kind: 'exam',
          title: exam.title,
          subtitle: exam.questions.length ? `${exam.questions.length} 题` : '还没有题',
          ...(exam.questions.length ? {} : { blank: true }),
          // 考试记录一行一次作答：界面据此把卡片撑高、逐行列出（样式与大纲目标项同款）
          ...(exam.attempts.length ? { attempts: attemptRows(exam.attempts) } : {}),
        },
        depth: 1,
        anchorY: 0,
        next: [],
        parent: doc,
      }
      add(p)
      pushEdge(node.id, exam.id)
      doc.next.push(p)
      atts.push(p)
    }
    for (const sdoc of superDocsOf(node)) {
      const p: Pending = {
        card: {
          uuid: sdoc.id,
          kind: 'superdoc',
          title: sdoc.name,
          subtitle: sdoc.html.trim() ? `${sdoc.html.length} 字符` : '还是空的',
          ...(sdoc.html.trim() ? {} : { blank: true }),
        },
        depth: 1,
        anchorY: 0,
        next: [],
        parent: doc,
      }
      add(p)
      pushEdge(node.id, sdoc.id)
      doc.next.push(p)
      atts.push(p)
    }
    if (atts.length > 0) docAttachments.set(node.id, atts)
  }

  // 游离挂件（剪了线 / 没绑过的）：独立实体，一样上画布——位置按存过的来，没存的自动找空位
  // 若在 store.edges 中存在入边（如挂在视频节点、文档节点或文件节点下），则属于已连接节点，不再显示「游离」
  const pool = store.detached?.[goalId]
  const hasIncomingEdge = (uuid: string) => (store.edges ?? []).some((e) => e.to === uuid)
  for (const note of pool?.notes ?? []) {
    const connected = hasIncomingEdge(note.id)
    add({
      card: {
        uuid: note.id,
        kind: 'note',
        title: note.name,
        subtitle: connected
          ? (note.content.trim() ? `${note.content.length} 字` : '还是空的')
          : (note.content.trim() ? `${note.content.length} 字 · 游离` : '游离 · 还是空的'),
        ...(note.summary ? { summary: note.summary } : {}),
      },
      depth: 2,
      anchorY: 0,
      next: [],
      parent: null,
    })
  }
  for (const sdoc of pool?.superdocs ?? []) {
    const connected = hasIncomingEdge(sdoc.id)
    add({
      card: {
        uuid: sdoc.id,
        kind: 'superdoc',
        title: sdoc.name,
        subtitle: connected
          ? (sdoc.html.trim() ? `${sdoc.html.length} 字符` : '还是空的')
          : (sdoc.html.trim() ? `${sdoc.html.length} 字符 · 游离` : '游离 · 还是空的'),
        ...(sdoc.html.trim() ? {} : { blank: true }),
      },
      depth: 2,
      anchorY: 0,
      next: [],
      parent: null,
    })
  }
  for (const exam of store.exams) {
    if (exam.goalId !== goalId) continue
    if (nodeById(store, exam.nodeId)) continue // 绑着的已经在宿主名下画过了
    const connected = hasIncomingEdge(exam.id)
    add({
      card: {
        uuid: exam.id,
        kind: 'exam',
        title: exam.title,
        subtitle: connected
          ? (exam.questions.length ? `${exam.questions.length} 题` : '还没有题')
          : (exam.questions.length ? `${exam.questions.length} 题 · 游离` : '游离 · 还没有题'),
        ...(exam.questions.length ? {} : { blank: true }),
      },
      depth: 2,
      anchorY: 0,
      next: [],
      parent: null,
    })
  }


  const filePending = new Map<string, Pending>()
  for (const entity of store.fileNodes ?? []) {
    if (entity.goalId !== goalId) continue
    const p: Pending = {
      card: {
        uuid: entity.id,
        kind: 'file',
        title: entity.title,
        subtitle: entity.fileKind === 'local' ? (entity.url || '未绑定文件') : (entity.url || '未输入网址'),
        file: { fileKind: entity.fileKind, url: entity.url },
      },
      depth: 1,
      anchorY: 0,
      next: [],
      parent: null,
    }
    filePending.set(entity.id, p)
    add(p)
  }

  /*
   * 树边（store.edges，两端是树成员 id）：画在成员卡之间——
   * - from 是文档 id：那份文档有大纲就以它的大纲卡为源（hub 翻译，交替链
   *   文档-大纲-文档…的画法），没有就直接从文档卡出发；
   * - from 是 o:（游离大纲的声部）：本就是大纲卡。
   * to 以 o: 开头即接在大纲卡上的嵌套子级（分类链 文档-大纲-大纲…）。
   */
  const fromCardOf = (from: string, to?: string): Pending | undefined => {
    if (from.startsWith('o:')) return outlinePending.get(from)
    // 项目节点是挂件款下游：上游始终是文档本身，不经大纲 hub 翻译
    if (to && projectPending.has(to)) return docPending.get(from)
    // 笔记节点的上游：若起点在 byUuid 中存在（如考试、超级文档、文档、文件），优先返回其实体卡片
    if (to && byUuid.get(to)?.card.kind === 'note') {
      return byUuid.get(from) ?? outlinePending.get(outlineUuid(from)) ?? docPending.get(from) ?? videoPending.get(from)
    }
    // 文件节点的上游：优先返回其实体卡片
    if (to && (filePending.has(to) || videoPending.has(to))) {
      return byUuid.get(from) ?? outlinePending.get(outlineUuid(from)) ?? docPending.get(from)
    }
    return filePending.get(from) ?? outlinePending.get(outlineUuid(from)) ?? docPending.get(from) ?? videoPending.get(from) ?? projectPending.get(from) ?? byUuid.get(from)
  }
  for (const e of store.edges) {
    const toCard = outlinePending.get(e.to) ?? filePending.get(e.to) ?? videoPending.get(e.to) ?? docPending.get(e.to) ?? projectPending.get(e.to) ?? byUuid.get(e.to)
    const fromCard = fromCardOf(e.from, e.to)
    if (!fromCard || !toCard) continue
    if (!pushEdge(fromCard.card.uuid, toCard.card.uuid)) continue
    toCard.parent ??= fromCard
    if (!fromCard.next.includes(toCard)) fromCard.next.push(toCard)
    // 认领了接口的子级记下行号：自动铺排的顺序与锚点都按目标项来（见下面的排序与 place）
    if (fromCard.card.kind === 'outline') {
      const idx = fromCard.card.slots?.findIndex((s) => s.childId === toCard.card.uuid) ?? -1
      if (idx >= 0) toCard.slotAnchor = { parent: fromCard.card.uuid, index: idx }
    }
  }

  // 附身大纲与它的文档配成一对：归属边「文档 → 它的大纲」（交替链画法）；嵌套接入时反过来以大纲为入口
  const isNestedIn = (outlineCardUuid: string) => store.edges.some((e) => e.to === outlineCardUuid)
  for (const node of docs) {
    const doc = docPending.get(node.id)
    const o = outlinePending.get(outlineUuid(node.id))
    if (!doc || !o) continue
    const nestedIn = isNestedIn(o.card.uuid)
    if (nestedIn) {
      // 嵌套接入：文档卡排在大纲卡左边（与父大纲同列），由大纲卡带着进 BFS
      doc.parent = o
      o.next.unshift(doc)
    } else {
      o.parent = doc
      doc.next.push(o)
    }
    pushEdge(node.id, o.card.uuid)
  }

  /*
   * 自动铺排的顺序 = 目标项的顺序：大纲卡 next 里的子级按认领的行号排（认领优先，
   * 没认领的稳着排在后面）——不然铺出来的次序跟着边的先后走，图读起来和计划对不上。
   * 嵌套接入时宿主文档卡在最前（它贴着自己的大纲），保持第一。
   */
  for (const o of outlinePending.values()) {
    const slots = o.card.slots ?? []
    const hostId = docIdOfOutlineUuid(o.card.uuid)
    const rank = (uuid: string): number => {
      if (hostId && uuid === hostId) return -1
      const i = slots.findIndex((s) => s.childId === uuid)
      return i >= 0 ? i : slots.length
    }
    o.next.sort((a, b) => rank(a.card.uuid) - rank(b.card.uuid))
  }

  /*
   * 拓扑深度（depth）计算：
   * 树状大纲、文档、挂件纵深多层嵌套时，单遍遍历会导致深层节点的 depth 被截断、
   * 子节点被算成浅层深度（排到父节点左边倒着连线）。
   * 此处采用全局拓扑松弛（Bellman-Ford / DAG 最长路）：
   * 1. 根节点（goal.rootNodeId 对应的文档卡）固定为 depth 1；游离挂件初始为 depth 2；其他卡片初始为 depth 1；
   * 2. 任何父子依赖关系 u -> v 必须满足深度递增约束（v.depth >= u.depth + 1）；
   * 3. 循环迭代直至收敛，确保不管嵌套多少层（depth 5、6、7...），深度严格单调递增并对齐列。
   */
  let depthChanged = true
  let depthRounds = 0
  const maxDepthRounds = byUuid.size + 2
  while (depthChanged && depthRounds < maxDepthRounds) {
    depthChanged = false
    depthRounds++

    // 约束 1：树边传递 (fromCard -> toCard)
    for (const e of store.edges) {
      const toCard = outlinePending.get(e.to) ?? filePending.get(e.to) ?? videoPending.get(e.to) ?? docPending.get(e.to) ?? projectPending.get(e.to) ?? byUuid.get(e.to)
      const fromCard = fromCardOf(e.from, e.to)
      if (!fromCard || !toCard) continue
      const req = fromCard.depth + 1
      if (toCard.depth < req) {
        toCard.depth = req
        depthChanged = true
      }
    }

    // 约束 2：附身大纲与宿主文档传递
    for (const node of docs) {
      const doc = docPending.get(node.id)
      const o = outlinePending.get(outlineUuid(node.id))
      if (!doc || !o) continue
      const nestedIn = isNestedIn(o.card.uuid)
      if (nestedIn) {
        const req = Math.max(o.depth - 1, 1)
        if (doc.depth < req) {
          doc.depth = req
          depthChanged = true
        }
      } else {
        const req = doc.depth + 1
        if (o.depth < req) {
          o.depth = req
          depthChanged = true
        }
      }
    }

    // 约束 3：文档到挂件传递
    for (const [docId, atts] of docAttachments) {
      const doc = docPending.get(docId)
      if (!doc) continue
      const req = doc.depth + 1
      for (const p of atts) {
        if (p.depth < req) {
          p.depth = req
          depthChanged = true
        }
      }
    }
  }


  /* 2. 高度（内容算出来的） */

  const heightOf: HeightOf = (c) => {
    if (c.kind === 'outline') {
      const p = byUuid.get(c.uuid)
      return outlineCardHeight(p?.card.slots?.length ?? 0)
    }
    if (c.kind === 'doc') {
      const p = byUuid.get(c.uuid)
      return p?.card.excerpt ? DOC_BODY_H : CARD_H
    }
    if (c.kind === 'exam') {
      const p = byUuid.get(c.uuid)
      return examCardHeight(p?.card.attempts?.length ?? 0)
    }
    // 笔记卡高度随总结内容长（250 封顶）：估算喂自动排布，真实高度由 CSS 决定
    if (c.kind === 'note') {
      const p = byUuid.get(c.uuid)
      return noteCardHeight(!!p?.card.summary, p?.card.summary?.length ?? 0)
    }
    return CARD_H
  }

  /* 3. 坐标：存过的用存过的；没存的 BFS 自动铺排（父卡右侧同高、撞了往下挪） */

  const cards: CardView[] = []
  const placedByUuid = new Map<string, CardView>()
  const place = (p: Pending): void => {
    if (p.placed) return
    p.placed = true
    const savedPos = positions[p.card.uuid]
    const parentCard = p.parent ? placedByUuid.get(p.parent.card.uuid) : undefined
    let anchorY = p.targetAnchorY ?? (parentCard ? parentCard.y : 0)
    /*
     * 认领了接口的子级锚到父大纲那条目标项的**行**上（卡的中心对准那一行圆点）：
     * 自动排列读起来就是「第几条目标项的落地排在第几行」，连线也顺势更平。
     * 撞上别的卡时仍由 freeSpotNear 往下腾位——顺序已按行号排好，腾位不会乱序。
     */
    if (p.slotAnchor) {
      const anchorCard = placedByUuid.get(p.slotAnchor.parent)
      if (anchorCard) {
        const h = heightOf({ uuid: p.card.uuid, kind: p.card.kind })
        anchorY = anchorCard.y + slotAnchorY(p.slotAnchor.index) - h / 2
      }
    }
    let card: CardView
    if (savedPos) {
      card = { ...p.card, x: savedPos.x, y: savedPos.y, ...(savedPos.note ? { note: savedPos.note } : {}) }
    } else {
      const spot = freeSpotNear(
        [...placedByUuid.values()],
        { x: p.depth * COL_GAP, y: anchorY },
        { width: cardWidthOf(p.card.kind), height: heightOf({ uuid: p.card.uuid, kind: p.card.kind }) },
        heightOf,
      )
      card = { ...p.card, x: spot.x, y: spot.y }
    }
    cards.push(card)
    placedByUuid.set(p.card.uuid, card)

    // 为下游未认领具体 slot 的直接子节点集合计算对称居中分布的 targetAnchorY
    const unplacedNext = p.next.filter((c) => !c.placed)
    const unslottedChildren = unplacedNext.filter((c) => !c.slotAnchor)
    if (unslottedChildren.length > 0) {
      const curH = heightOf({ uuid: card.uuid, kind: card.kind })
      const parentCenterY = card.y + curH / 2
      let totalChildrenH = 0
      const childHeights: number[] = []
      for (const child of unslottedChildren) {
        const ch = heightOf({ uuid: child.card.uuid, kind: child.card.kind })
        childHeights.push(ch)
        totalChildrenH += ch
      }
      totalChildrenH += (unslottedChildren.length - 1) * ROW_GAP
      let currentChildY = parentCenterY - totalChildrenH / 2
      for (let i = 0; i < unslottedChildren.length; i++) {
        unslottedChildren[i].targetAnchorY = currentChildY
        currentChildY += childHeights[i] + ROW_GAP
      }
    }

    for (const n of p.next) {
      if (!n.placed) place(n)
    }
  }
  // 读图起点 = 根文档（入口徽章在它身上）；没连进树的（游离文档——摘了线或删了上游）
  // 也要出现在画布上：按深度升序补铺，确保父节点先于子节点就位
  const rootPending = goal.rootNodeId ? docPending.get(goal.rootNodeId) : undefined
  if (rootPending) place(rootPending)
  const remaining = [...byUuid.values()].filter((p) => !p.placed)
  remaining.sort((a, b) => a.depth - b.depth)
  for (const p of remaining) {
    if (!p.placed) place(p)
  }
  return { cards, edges, heightOf }
}
