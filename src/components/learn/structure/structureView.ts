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

import type { LearnStore, ProjectPathKind } from '../../../learn/types'
import { examsOfNode, nodeById, prereqIds } from '../../../learn/graph'
import { notesOf } from '../../../learn/notes'
import { attemptScore, type ExamAttempt } from '../../../learn/exam'
import { resolveProjectRoot } from '../../../learn/projects'
import { superDocsOf } from '../../../learn/types'
import { docIdOfOutlineUuid, outlineUuid, type GNodeKind } from '../../../learn/nodeKinds'
import {
  CARD_H,
  COL_GAP,
  defaultHeight,
  freeSpotNear,
  cardWidthOf,
  rectOf,
  type CardPos,
  type EdgeStyle,
  type HeightOf,
  type StructureMap,
} from '../../../learn/structure'

/* ---------- 卡片尺寸常量（内容算高度，不进数据） ---------- */

/** 大纲卡片的标题行高度（含上下 padding） */
export const OUTLINE_HEAD = 44
/** 每一行目标项的高度 */
export const SLOT_ROW = 22
/** 卡片底部那条注释标签的高度 */
export const NOTE_ROW = 20
/** 卡片上下边框的合计厚度（卡片是 border-box，算内容时先还回去） */
export const CARD_FRAME_H = 2
/** 卡片内容与下边框之间的留白（与组件里的 padding 保持一致） */
export const CARD_PAD_B = 8
/** 摘要每行的行高（显式钉住，比例值会带小数、与整数卡片高度对不上） */
export const DOC_LINE_H = 15
/** 有正文的文档卡固定两行摘要 */
export const DOC_LINES = 2
/** 有正文的文档卡：边框 + 标题行 + 两行摘要 + 底部内边距 */
export const DOC_BODY_H = CARD_FRAME_H + OUTLINE_HEAD + DOC_LINES * DOC_LINE_H + CARD_PAD_B

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

/** 试卷卡有多高：边框 + 标题行 + 头部考试按钮行 + 每条考试记录一行 + 内边距（没有记录就是标准高度） */
export function examCardHeight(rows: number): number {
  if (!rows) return CARD_H
  return Math.max(CARD_FRAME_H + OUTLINE_HEAD + (rows + 1) * SLOT_ROW + CARD_PAD_B, CARD_H)
}

/** 大纲卡有多高：边框 + 标题行 + 每条目标项一行 + 底部「＋ 添加目标项」一行 + 内边距 */
export function outlineCardHeight(count: number): number {
  if (!count) return CARD_H
  return Math.max(CARD_FRAME_H + OUTLINE_HEAD + (count + 1) * SLOT_ROW + CARD_PAD_B, CARD_H)
}



/* ---------- 卡片与目标项 ---------- */

/** 大纲卡片里的一行目标项 */
export interface OutlineSlotView {
  /** 目标项的 key（= normalizeKey(标题)） */
  key: string
  title: string
  index: number
  /** 已经挂上来的子文档 uuid；null = 这个接入点还空着（点一下就挂一份空文档） */
  childId: string | null
}

/** 一张卡的视图模型（组件只认它，不碰 store） */
export interface CardView {
  uuid: string
  kind: GNodeKind
  title: string
  subtitle: string
  /** 文档卡的两行正文摘要 */
  excerpt?: string
  /** 空文档卡：正文还没有，卡片上给一颗「生成」 */
  blank?: boolean
  /** 用户贴在卡片上的便条（存进坐标表） */
  note?: string  /** 大纲卡的目标项行（kind = outline 时才有） */
  slots?: OutlineSlotView[]
  /** 这张文档卡是本图的入口（目标的根）——卡片上挂「入口」徽章；一张图有且只有一个 */
  entry?: boolean
  /** 游离大纲卡（独立实体，没有宿主文档）：空卡给「添加目标项」而不是「生成大纲」 */
  free?: boolean
  /** 试卷卡的考试记录行（kind = exam 时才有；一行一次作答） */
  attempts?: ExamAttemptRow[]
  /**
   * 项目卡的路径声明（kind = project 时才有）。解析出的绝对路径一并给——
   * 卡上的目录树展开、授权提示都以它为准；解析失败（null）卡上显示待解析。
   */
  project?: { path: string; pathKind: ProjectPathKind; resolved: string | null }
  x: number
  y: number
}

/** 试卷卡上的一行考试记录 */
export interface ExamAttemptRow {
  /** 第几次（从 1 起） */
  n: number
  label: string
  /** 那次作答的 id：点行打开只读副本页签用 */
  attemptId: string
}

/** 一条派生连线（from → to，方向即读图方向） */
export interface CanvasEdge {
  from: string
  to: string
}

export interface CanvasView {
  cards: CardView[]
  edges: CanvasEdge[]
  heightOf: HeightOf
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
        title: video?.title ?? '未绑定视频',
        subtitle: video ? (video.pluginName ?? '已绑定') : '选一个视频，把这门课和它绑在一起',
        ...(video ? {} : { blank: true }),
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

  /*
   * 树边（store.edges，两端是树成员 id）：画在成员卡之间——
   * - from 是文档 id：那份文档有大纲就以它的大纲卡为源（hub 翻译，交替链
   *   文档-大纲-文档…的画法），没有就直接从文档卡出发；
   * - from 是 o:（游离大纲的声部）：本就是大纲卡。
   * to 以 o: 开头即接在大纲卡上的嵌套子级（分类链 文档-大纲-大纲…）。
   */
  // 附身大纲先按「文档右边一格」立初始深度（树边 pass 要拿它当源；嵌套接入的之后反过来调）
  for (const node of docs) {
    const doc = docPending.get(node.id)
    const o = outlinePending.get(outlineUuid(node.id))
    if (doc && o) o.depth = doc.depth + 1
  }
  const fromCardOf = (from: string, to?: string): Pending | undefined => {
    if (from.startsWith('o:')) return outlinePending.get(from)
    // 项目节点是挂件款下游：上游始终是文档本身，不经大纲 hub 翻译
    if (to && projectPending.has(to)) return docPending.get(from)
    return outlinePending.get(outlineUuid(from)) ?? docPending.get(from) ?? videoPending.get(from) ?? projectPending.get(from)
  }
  for (const e of store.edges) {
    const toCard = outlinePending.get(e.to) ?? docPending.get(e.to) ?? projectPending.get(e.to)
    const fromCard = fromCardOf(e.from, e.to)
    if (!fromCard || !toCard) continue
    if (!pushEdge(fromCard.card.uuid, toCard.card.uuid)) continue
    // 深度按成员算：父成员的卡 + 1（附身大纲那一对的「右侧」即大纲卡本身）
    toCard.depth = Math.max(toCard.depth, fromCard.depth + 1)
    toCard.parent ??= fromCard
    if (!fromCard.next.includes(toCard)) fromCard.next.push(toCard)
    // 认领了接口的子级记下行号：自动铺排的顺序与锚点都按目标项来（见下面的排序与 place）
    if (fromCard.card.kind === 'outline') {
      const idx = fromCard.card.slots?.findIndex((s) => s.childId === toCard.card.uuid) ?? -1
      if (idx >= 0) toCard.slotAnchor = { parent: fromCard.card.uuid, index: idx }
    }
  }

  // 附身大纲与它的文档配成一对：归属边「文档 → 它的大纲」（交替链画法）；嵌套接入时反过来以大纲为入口
  for (const node of docs) {
    const doc = docPending.get(node.id)
    const o = outlinePending.get(outlineUuid(node.id))
    if (!doc || !o) continue
    const nestedIn = edges.some((e) => e.to === o.card.uuid)
    if (nestedIn) {
      // 嵌套接入：文档卡排在大纲卡左边（与父大纲同列），由大纲卡带着进 BFS
      doc.depth = Math.max(doc.depth, o.depth - 1, 1)
      doc.parent = o
      o.next.unshift(doc)
    } else {
      o.depth = doc.depth + 1
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

  // 挂件：笔记 / 试卷 / 超级文档，创建即挂，卡随实体（照旧挂在内容文档卡之下）
  for (const node of docs) {
    const doc = docPending.get(node.id)
    if (!doc) continue
    for (const note of notesOf(node)) {
      const p: Pending = {
        card: {
          uuid: note.id,
          kind: 'note',
          title: note.name,
          subtitle: note.content.trim() ? `${note.content.length} 字` : '还是空的',
        },
        depth: doc.depth + 1,
        anchorY: 0,
        next: [],
        parent: doc,
      }
      add(p)
      pushEdge(node.id, note.id)
      doc.next.push(p)
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
        depth: doc.depth + 1,
        anchorY: 0,
        next: [],
        parent: doc,
      }
      add(p)
      pushEdge(node.id, exam.id)
      doc.next.push(p)
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
        depth: doc.depth + 1,
        anchorY: 0,
        next: [],
        parent: doc,
      }
      add(p)
      pushEdge(node.id, sdoc.id)
      doc.next.push(p)
    }
  }

  // 游离挂件（剪了线 / 没绑过的）：独立实体，一样上画布——位置按存过的来，没存的自动找空位
  const pool = store.detached?.[goalId]
  for (const note of pool?.notes ?? []) {
    add({
      card: {
        uuid: note.id,
        kind: 'note',
        title: note.name,
        subtitle: note.content.trim() ? `${note.content.length} 字 · 游离` : '游离 · 还是空的',
      },
      depth: 2,
      anchorY: 0,
      next: [],
      parent: null,
    })
  }
  for (const sdoc of pool?.superdocs ?? []) {
    add({
      card: {
        uuid: sdoc.id,
        kind: 'superdoc',
        title: sdoc.name,
        subtitle: sdoc.html.trim() ? `${sdoc.html.length} 字符 · 游离` : '游离 · 还是空的',
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
    add({
      card: {
        uuid: exam.id,
        kind: 'exam',
        title: exam.title,
        subtitle: exam.questions.length ? `${exam.questions.length} 题 · 游离` : '游离 · 还没有题',
        ...(exam.questions.length ? {} : { blank: true }),
      },
      depth: 2,
      anchorY: 0,
      next: [],
      parent: null,
    })
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
    let anchorY = parentCard ? parentCard.y : 0
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
    for (const n of p.next) {
      if (!n.placed) place(n)
    }
  }
  // 读图起点 = 根文档（入口徽章在它身上）；没连进树的（游离文档——摘了线或删了上游）
  // 也要出现在画布上：按各自深度补铺
  const rootPending = goal.rootNodeId ? docPending.get(goal.rootNodeId) : undefined
  if (rootPending) place(rootPending)
  for (const p of byUuid.values()) {
    if (!p.placed) place(p)
  }
  return { cards, edges, heightOf }
}

/* ---------- 色板（七种节点） ---------- */

export const KIND_TONE: Record<GNodeKind, string> = {
  entry: 'border-rose-500/35 bg-rose-500/[0.06]',
  outline: 'border-seal/35 bg-seal/[0.06]',
  doc: 'border-sky-500/30 bg-sky-500/[0.06]',
  note: 'border-emerald-500/30 bg-emerald-500/[0.06]',
  exam: 'border-amber-500/30 bg-amber-500/[0.06]',
  superdoc: 'border-violet-500/30 bg-violet-500/[0.06]',
  video: 'border-cyan-500/30 bg-cyan-500/[0.06]',
  project: 'border-teal-500/30 bg-teal-500/[0.06]',
}

export const KIND_BADGE: Record<GNodeKind, string> = {
  entry: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
  outline: 'bg-seal/15 text-seal-deep',
  doc: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  note: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  exam: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  superdoc: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  video: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300',
  project: 'bg-teal-500/15 text-teal-700 dark:text-teal-300',
}

/** 目标项圆点与它的连线只用这一个颜色：颜色在图上只承载一个含义「来自某条目标项」 */
export const SLOT_ACCENT = 'var(--color-seal, #a8432f)'

/** 连线从卡片**顶部往下多少**出线（固定值：线落在一条齐平的横带上） */
export const EDGE_ANCHOR_Y = 34

/** 某条目标项在卡片里的中心 y（连线的大纲那一端要对准这一行） */
export function slotAnchorY(index: number): number {
  return OUTLINE_HEAD + index * SLOT_ROW + SLOT_ROW / 2
}

/**
 * 事件目标是不是文本输入位（输入框 / 多行框 / 可编辑区）。
 * 画布把 Delete、Ctrl+Z 这类键接在容器上，不先认出「正在打字」，注释里按个退格就会删掉节点。
 */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable === true)
}

/* ---------- 命中测试与连线几何（与 v1 同一套，卡片形状换成 CardView） ---------- */

/** 世界坐标落在哪张卡上（拖动连线时指针被容器捕获，只有几何判断可靠） */
export function hitTest(cards: readonly CardView[], x: number, y: number, height: HeightOf = defaultHeight): CardView | null {
  for (let i = cards.length - 1; i >= 0; i--) {
    const rect = rectOf(cards[i], height)
    if (x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height) return cards[i]
  }
  return null
}

export interface Point {
  x: number
  y: number
}

/** 一条连线的三次贝塞尔控制点：从左卡右沿出、进右卡左沿 */
export function edgeCurve(
  from: CardView,
  to: CardView,
  height: HeightOf = defaultHeight,
  anchor?: { from?: number; to?: number },
): [Point, Point, Point, Point] {
  const fromRect = rectOf(from, height)
  const toRect = rectOf(to, height)
  const p0 = { x: fromRect.x + fromRect.width, y: fromRect.y + (anchor?.from ?? EDGE_ANCHOR_Y) }
  const p3 = { x: toRect.x, y: toRect.y + (anchor?.to ?? EDGE_ANCHOR_Y) }
  const bend = Math.max(48, Math.abs(p3.x - p0.x) * 0.45)
  return [p0, { x: p0.x + bend, y: p0.y }, { x: p3.x - bend, y: p3.y }, p3]
}

/* ---------- 直角路由：绕开卡片 ---------- */

export const EDGE_CLEARANCE = 16
export const EDGE_STUB = 20
const TURN_COST = 48

interface RectLike {
  x: number
  y: number
  width: number
  height: number
}

function inflate(r: RectLike, by: number): RectLike {
  return { x: r.x - by, y: r.y - by, width: r.width + by * 2, height: r.height + by * 2 }
}

const EPS = 0.5

function insideRect(p: Point, r: RectLike): boolean {
  return p.x > r.x + EPS && p.x < r.x + r.width - EPS && p.y > r.y + EPS && p.y < r.y + r.height - EPS
}

function crossesRect(a: Point, b: Point, r: RectLike): boolean {
  const minX = Math.min(a.x, b.x)
  const maxX = Math.max(a.x, b.x)
  const minY = Math.min(a.y, b.y)
  const maxY = Math.max(a.y, b.y)
  return maxX > r.x + EPS && minX < r.x + r.width - EPS && maxY > r.y + EPS && minY < r.y + r.height - EPS
}

function intersectsRect(a: RectLike, b: RectLike): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

/** 老画法：右出 → 竖直 → 右进；没有卡片挡路就用它（一张图一种线型） */
export function edgeElbow(start: Point, end: Point): Point[] {
  if (Math.abs(start.y - end.y) < 0.5) return [start, end]
  const midX = end.x > start.x + 48 ? (start.x + end.x) / 2 : start.x + 40
  return [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end]
}

function simplify(points: readonly Point[]): Point[] {
  const out: Point[] = []
  for (const p of points) {
    const last = out[out.length - 1]
    if (last && Math.abs(last.x - p.x) < EPS && Math.abs(last.y - p.y) < EPS) continue
    out.push({ x: p.x, y: p.y })
  }
  for (let i = out.length - 2; i >= 1; i--) {
    const a = out[i - 1]
    const b = out[i]
    const c = out[i + 1]
    const sameX = Math.abs(a.x - b.x) < EPS && Math.abs(b.x - c.x) < EPS
    const sameY = Math.abs(a.y - b.y) < EPS && Math.abs(b.y - c.y) < EPS
    if (sameX || sameY) out.splice(i, 1)
  }
  return out
}

function axisLines(keep: readonly number[], edges: readonly number[]): number[] {
  const out = [...keep]
  for (const v of edges) {
    if (out.some((k) => Math.abs(k - v) <= 1)) continue
    out.push(v)
  }
  return out.sort((a, b) => a - b)
}

function manhattan(a: Point, b: Point): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
}

/** A* 的开集：二叉堆。拖节点时每条边都要重算，别用「每次扫一遍找最小」 */
class OpenSet {
  private ids: number[] = []
  private keys: number[] = []

  get size(): number {
    return this.ids.length
  }

  push(id: number, key: number): void {
    this.ids.push(id)
    this.keys.push(key)
    let i = this.ids.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (this.keys[parent] <= this.keys[i]) break
      this.swap(parent, i)
      i = parent
    }
  }

  pop(): number {
    const top = this.ids[0]
    const lastId = this.ids.pop() as number
    const lastKey = this.keys.pop() as number
    if (this.ids.length) {
      this.ids[0] = lastId
      this.keys[0] = lastKey
      let i = 0
      for (;;) {
        const left = i * 2 + 1
        const right = left + 1
        let small = i
        if (left < this.ids.length && this.keys[left] < this.keys[small]) small = left
        if (right < this.ids.length && this.keys[right] < this.keys[small]) small = right
        if (small === i) break
        this.swap(small, i)
        i = small
      }
    }
    return top
  }

  private swap(a: number, b: number): void {
    const id = this.ids[a]
    this.ids[a] = this.ids[b]
    this.ids[b] = id
    const key = this.keys[a]
    this.keys[a] = this.keys[b]
    this.keys[b] = key
  }
}

const STEPS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 2],
  [0, -1, 2],
]

/** 在障碍之间找一条横平竖直的路（A*，代价 = 长度 + 拐弯；网格取端点 + 障碍边这些线） */
function orthogonalRoute(start: Point, end: Point, solids: readonly RectLike[]): Point[] | null {
  const xs = axisLines(
    [start.x, end.x],
    solids.flatMap((r) => [r.x, r.x + r.width]),
  )
  const ys = axisLines(
    [start.y, end.y],
    solids.flatMap((r) => [r.y, r.y + r.height]),
  )
  const nx = xs.length
  const ny = ys.length
  const cells = nx * ny

  const blocked = new Uint8Array(cells)
  for (let xi = 0; xi < nx; xi++) {
    for (let yi = 0; yi < ny; yi++) {
      const p = { x: xs[xi], y: ys[yi] }
      if (solids.some((r) => insideRect(p, r))) blocked[xi * ny + yi] = 1
    }
  }

  const startXi = xs.indexOf(start.x)
  const startYi = ys.indexOf(start.y)
  const endXi = xs.indexOf(end.x)
  const endYi = ys.indexOf(end.y)
  if (startXi < 0 || startYi < 0 || endXi < 0 || endYi < 0) return null
  const startCell = startXi * ny + startYi
  const endCell = endXi * ny + endYi
  blocked[startCell] = 0
  blocked[endCell] = 0

  const g = new Float64Array(cells * 3).fill(Infinity)
  const prev = new Int32Array(cells * 3).fill(-1)
  const done = new Uint8Array(cells * 3)
  const open = new OpenSet()
  const first = startCell * 3
  g[first] = 0
  open.push(first, manhattan(start, end))

  while (open.size) {
    const cur = open.pop()
    if (done[cur]) continue
    done[cur] = 1
    const dir = cur % 3
    const cell = (cur - dir) / 3
    if (cell === endCell) {
      const path: Point[] = []
      for (let id = cur; id >= 0; id = prev[id]) {
        const d = id % 3
        const c = (id - d) / 3
        const xi = Math.floor(c / ny)
        path.push({ x: xs[xi], y: ys[c - xi * ny] })
      }
      return simplify(path.reverse())
    }
    const xi = Math.floor(cell / ny)
    const yi = cell - xi * ny
    const here = { x: xs[xi], y: ys[yi] }
    for (const [dx, dy, nextDir] of STEPS) {
      const tx = xi + dx
      const ty = yi + dy
      if (tx < 0 || tx >= nx || ty < 0 || ty >= ny) continue
      const target = tx * ny + ty
      if (blocked[target]) continue
      const there = { x: xs[tx], y: ys[ty] }
      if (solids.some((r) => crossesRect(here, there, r))) continue
      const next = target * 3 + nextDir
      if (done[next]) continue
      const cost = g[cur] + manhattan(here, there) + (dir && dir !== nextDir ? TURN_COST : 0)
      if (cost < g[next] - 1e-6) {
        g[next] = cost
        prev[next] = cur
        open.push(next, cost + manhattan(there, end))
      }
    }
  }
  return null
}

/**
 * 一条边画在哪：直角折线，遇到卡片绕着走。先试老画法（不穿卡就用），
 * 穿不过去才 A* 绕行；接入位置固定（源右沿出、目标左沿进）。
 */
export function edgeRoute(
  from: CardView,
  to: CardView,
  cards: readonly CardView[],
  height: HeightOf = defaultHeight,
  anchor?: { from?: number; to?: number },
): Point[] {
  const fromRect = rectOf(from, height)
  const toRect = rectOf(to, height)
  const start = { x: fromRect.x + fromRect.width, y: fromRect.y + (anchor?.from ?? EDGE_ANCHOR_Y) }
  const end = { x: toRect.x, y: toRect.y + (anchor?.to ?? EDGE_ANCHOR_Y) }

  const others = cards
    .filter((n) => n.uuid !== from.uuid && n.uuid !== to.uuid)
    .map((n) => inflate(rectOf(n, height), EDGE_CLEARANCE))
  const solids = [...others, fromRect, toRect]

  const elbow = edgeElbow(start, end)
  const blocked = solids.some((r) => elbow.some((p, i) => i > 0 && crossesRect(elbow[i - 1], p, r)))
  if (!blocked) return elbow

  const stubStart = { x: start.x + EDGE_STUB, y: start.y }
  const stubEnd = { x: end.x - EDGE_STUB, y: end.y }
  const around = [...others, inflate(fromRect, EDGE_CLEARANCE), inflate(toRect, EDGE_CLEARANCE)]
  const area = {
    x: Math.min(start.x, end.x) - 240,
    y: Math.min(start.y, end.y) - 240,
    width: Math.abs(start.x - end.x) + 480,
    height: Math.abs(start.y - end.y) + 480,
  }
  const near = around.filter((r) => intersectsRect(area, r))
  const found = orthogonalRoute(stubStart, stubEnd, near) ?? orthogonalRoute(stubStart, stubEnd, around)
  if (!found) return elbow

  const points = simplify([start, ...found, end])
  const hits = points.some((p, i) => i > 0 && solids.some((r) => crossesRect(points[i - 1], p, r)))
  return hits ? elbow : points
}

function distanceToSegment(x: number, y: number, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 < 0.0001) return Math.hypot(x - a.x, y - a.y)
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2))
  return Math.hypot(x - (a.x + dx * t), y - (a.y + dy * t))
}

/** 路径的 d：折线直接连，曲线要四个贝塞尔控制点 */
export function edgePathD(points: readonly Point[], style: EdgeStyle = 'straight'): string {
  if (style === 'curved' && points.length === 4) {
    const [p0, p1, p2, p3] = points
    return `M${p0.x} ${p0.y} C${p1.x} ${p1.y}, ${p2.x} ${p2.y}, ${p3.x} ${p3.y}`
  }
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ')
}

function polylineAt(points: readonly Point[], t: number): Point {
  if (!points.length) return { x: 0, y: 0 }
  const segs = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y))
  const total = segs.reduce((a, b) => a + b, 0)
  if (total < 0.5) return points[0]
  let left = t * total
  for (let i = 0; i < segs.length; i++) {
    if (left <= segs[i] || i === segs.length - 1) {
      const k = segs[i] < 0.5 ? 0 : Math.min(1, left / segs[i])
      return {
        x: points[i].x + (points[i + 1].x - points[i].x) * k,
        y: points[i].y + (points[i + 1].y - points[i].y) * k,
      }
    }
    left -= segs[i]
  }
  return points[points.length - 1]
}

/** 线上参数 t 处的点：折线按累计长度取，曲线是三次贝塞尔 */
export function edgePointAt(points: readonly Point[], t: number, style: EdgeStyle = 'straight'): Point {
  if (style === 'curved' && points.length === 4) {
    const [p0, p1, p2, p3] = points
    const u = 1 - t
    return {
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    }
  }
  return polylineAt(points, t)
}

function edgePointsOf(
  cards: readonly CardView[],
  edge: CanvasEdge,
  from: CardView,
  to: CardView,
  height: HeightOf,
  style: EdgeStyle,
  anchorOf?: (edge: CanvasEdge) => { from?: number; to?: number } | undefined,
  routeOf?: (edge: CanvasEdge) => readonly Point[] | undefined,
): readonly Point[] {
  const cached = routeOf?.(edge)
  if (cached) return cached
  const anchor = anchorOf?.(edge)
  return style === 'curved' ? edgeCurve(from, to, height, anchor) : edgeRoute(from, to, cards, height, anchor)
}

/** 点在哪条连线上（阈值内取最近） */
export function edgeAt(
  cards: readonly CardView[],
  edges: readonly CanvasEdge[],
  x: number,
  y: number,
  threshold = 8,
  height: HeightOf = defaultHeight,
  style: EdgeStyle = 'straight',
  anchorOf?: (edge: CanvasEdge) => { from?: number; to?: number } | undefined,
  routeOf?: (edge: CanvasEdge) => readonly Point[] | undefined,
): CanvasEdge | null {
  const byId = new Map(cards.map((c) => [c.uuid, c]))
  let best: CanvasEdge | null = null
  let bestDist = threshold
  for (const edge of edges) {
    const from = byId.get(edge.from)
    const to = byId.get(edge.to)
    if (!from || !to) continue
    const points = edgePointsOf(cards, edge, from, to, height, style, anchorOf, routeOf)
    let dist = Infinity
    if (style === 'curved' && points.length === 4) {
      for (let i = 0; i <= 24; i++) {
        const p = edgePointAt(points, i / 24, 'curved')
        dist = Math.min(dist, Math.hypot(p.x - x, p.y - y))
      }
    } else {
      for (let i = 1; i < points.length; i++) {
        dist = Math.min(dist, distanceToSegment(x, y, points[i - 1], points[i]))
      }
    }
    if (dist <= bestDist) {
      bestDist = dist
      best = edge
    }
  }
  return best
}

/** 一条连线两端那两颗小圆点的位置（按参数取，永远落在线上） */
export function edgeDots(points: readonly Point[], style: EdgeStyle = 'straight'): { from: Point; to: Point } {
  return { from: edgePointAt(points, 0.22, style), to: edgePointAt(points, 0.78, style) }
}

/** 点在哪颗小圆点上（点它 = 跳到线的另一端） */
export function edgeDotAt(
  cards: readonly CardView[],
  edges: readonly CanvasEdge[],
  x: number,
  y: number,
  threshold = 11,
  height: HeightOf = defaultHeight,
  style: EdgeStyle = 'straight',
  anchorOf?: (edge: CanvasEdge) => { from?: number; to?: number } | undefined,
  routeOf?: (edge: CanvasEdge) => readonly Point[] | undefined,
): { edge: CanvasEdge; side: 'from' | 'to' } | null {
  const byId = new Map(cards.map((c) => [c.uuid, c]))
  for (const edge of edges) {
    const from = byId.get(edge.from)
    const to = byId.get(edge.to)
    if (!from || !to) continue
    const dots = edgeDots(edgePointsOf(cards, edge, from, to, height, style, anchorOf, routeOf), style)
    if (Math.hypot(dots.from.x - x, dots.from.y - y) <= threshold) return { edge, side: 'from' }
    if (Math.hypot(dots.to.x - x, dots.to.y - y) <= threshold) return { edge, side: 'to' }
  }
  return null
}
