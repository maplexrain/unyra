/** 这个文件负责什么：磁盘 → 内存——把读进来的文件集合还原成学习数据（parseDocs），以及一个节点的笔记怎么并回一份列表（readNotes，只服务旧布局）。 */

/* ---------- 磁盘 → 内存 ---------- */

import type { Conversation } from '../../agent/types'
import { migrateConversation } from '../compact'
import type { Exam } from '../exam'
import type {
  DetachedPool,
  EssayCommit,
  EssayEntry,
  LearnStore,
  MemoryItem,
  MethodEntry,
  NoteFile,
  SuperDocFile,
  TmpEntry,
  WorkflowEntry,
} from '../types'
import { normalizeLearnStore } from '../store/normalize'
import type { StaticResource } from '../static/types'
import { parseManifest } from '../static/manifest'
import type { StructureMap } from '../structure'
import { DOCS_DIR, MANIFEST_FILE, NOTES_SUFFIX, STATIC_DIR } from '../layout'
import { LEGACY_NOTE_SUFFIX, docFileName, outlineFileName } from './names'
import { at, parseJson, type MetaFile } from './meta'
import { NODE_FILE_SUFFIX, contentOfParts, type NodeFile } from './nodeFile'
import type { LearnState } from './state'

/**
 * 从文件集合还原学习数据；没有可用的文档返回 null。
 *
 * 两种布局都认：
 * 1. **v3（当前）**：一个节点一个 `{目录名}.node.json`，正文/大纲/笔记/试卷/超级文档都在里面；
 * 2. **v2（旧）**：`{节点}.md` + `.meta.json` + `.notes/` + `superdocs/` + `exams/`。
 *
 * 先试 v3，读不出来再试 v2——迁移没跑完、或者迁移中途失败的用户都还能打开应用。
 * 这条兜底是"单写"策略的降落伞，**别删**（见 docs/refactor-node-model-v3.md 5.1.5）。
 */
export function parseDocs(files: Map<string, string>, state: unknown): LearnStore | null {
  return parseDocsV3(files, state) ?? parseDocsV2(files, state)
}

/** 目标级账本（chat / reading / essay / mind / method / workflow / structure）从目标目录读 */
function readGoalLedgers(
  files: Map<string, string>,
  goalDir: string,
  goalId: string,
  out: {
    conversations: Conversation[]
    essaysByGoal: Record<string, EssayEntry[]>
    essayCommitsByGoal: Record<string, EssayCommit[]>
    workMemory: Record<string, MemoryItem[]>
    legacyMinds: Record<string, unknown[]>
    methods: Record<string, MethodEntry[]>
    workflowsByGoal: Record<string, WorkflowEntry[]>
    structureByGoal: Record<string, StructureMap>
    detachedByGoal: Record<string, DetachedPool>
    resources: Record<string, StaticResource[]>
    /** 游离大纲（独立实体）+ 以它们为起点的树边，目标目录的 outlines.json */
    outlinesByGoal: Record<string, { outlines: unknown[]; edges: Array<Record<string, unknown>> }>
    /** 视频节点（目标 × 视频的绑定），目标目录的 video-nodes.json */
    videoNodesByGoal: Record<string, unknown[]>
    videoEdgesByGoal: Record<string, Array<Record<string, unknown>>>
  },
): void {
  const convs = parseJson<{ conversations?: unknown[] }>(files.get(`${goalDir}/chat.json`))
  for (const c of convs?.conversations ?? []) {
    if (!c || typeof c !== 'object') continue
    // 折算旧结构：throughId 时代的「压到哪一条」变成消息自己的失活标记（见 learn/compact）
    out.conversations.push(migrateConversation(c as Conversation))
  }
  const manifest = parseManifest(files.get(`${goalDir}/${STATIC_DIR}/${MANIFEST_FILE}`))
  if (manifest.length) out.resources[goalId] = manifest
  /*
    记忆只有目标目录一份。两种形状都认：
    - 新版 { version: 2, work: MemoryItem[] }；
    - 上一版 { version: 1, minds: MindEntry[] }——折成这个目标的工作记忆。
  */
  const memoryFile = parseJson<{ work?: MemoryItem[]; minds?: unknown[] }>(files.get(`${goalDir}/mind.json`))
  if (Array.isArray(memoryFile?.work) && memoryFile.work.length) out.workMemory[goalId] = memoryFile.work
  else if (Array.isArray(memoryFile?.minds) && memoryFile.minds.length) out.legacyMinds[goalId] = memoryFile.minds

  const methodFile = parseJson<{ methods?: MethodEntry[] }>(files.get(`${goalDir}/method.json`))
  if (Array.isArray(methodFile?.methods) && methodFile.methods.length) out.methods[goalId] = methodFile.methods

  const workflowFile = parseJson<{ workflows?: WorkflowEntry[] }>(files.get(`${goalDir}/workflow.json`))
  if (Array.isArray(workflowFile?.workflows) && workflowFile.workflows.length) {
    out.workflowsByGoal[goalId] = workflowFile.workflows
  }

  const essayFile = parseJson<{ essays?: EssayEntry[]; commits?: EssayCommit[] }>(files.get(`${goalDir}/essay.json`))
  if (Array.isArray(essayFile?.essays) && essayFile.essays.length) out.essaysByGoal[goalId] = essayFile.essays
  if (Array.isArray(essayFile?.commits) && essayFile.commits.length) {
    out.essayCommitsByGoal[goalId] = essayFile.commits
  }

  const structureFile = parseJson<StructureMap>(files.get(`${goalDir}/structure.json`))
  if (structureFile) out.structureByGoal[goalId] = structureFile

  // 游离挂件池（剪了线 / 没绑过的笔记与超级文档；见 learn/detached）
  const detachedFile = parseJson<DetachedPool>(files.get(`${goalDir}/detached.json`))
  if (detachedFile && (Array.isArray(detachedFile.notes) || Array.isArray(detachedFile.superdocs))) {
    out.detachedByGoal[goalId] = {
      notes: (Array.isArray(detachedFile.notes) ? detachedFile.notes : []).filter(
        (n): n is NoteFile => !!n && typeof n === 'object' && typeof (n as NoteFile).id === 'string' && typeof (n as NoteFile).name === 'string',
      ),
      superdocs: (Array.isArray(detachedFile.superdocs) ? detachedFile.superdocs : []).filter(
        (d): d is SuperDocFile => !!d && typeof d === 'object' && typeof (d as SuperDocFile).id === 'string' && typeof (d as SuperDocFile).name === 'string',
      ),
    }
  }

  // 游离大纲池（不依附文档的计划实体）+ 以游离大纲为起点的树边
  const outlinesFile = parseJson<{ outlines?: unknown[]; edges?: Array<Record<string, unknown>> }>(
    files.get(`${goalDir}/outlines.json`),
  )
  if (outlinesFile && (Array.isArray(outlinesFile.outlines) || Array.isArray(outlinesFile.edges))) {
    out.outlinesByGoal[goalId] = {
      outlines: Array.isArray(outlinesFile.outlines) ? outlinesFile.outlines : [],
      edges: Array.isArray(outlinesFile.edges) ? outlinesFile.edges : [],
    }
  }

  // 视频节点（目标 × 视频的绑定，见 learn/video/nodes）与其树边
  const videoNodesFile = parseJson<{ nodes?: unknown[]; edges?: Array<Record<string, unknown>> }>(files.get(`${goalDir}/video-nodes.json`))
  if (Array.isArray(videoNodesFile?.nodes) && videoNodesFile.nodes.length) {
    out.videoNodesByGoal[goalId] = videoNodesFile.nodes
  }
  if (Array.isArray(videoNodesFile?.edges) && videoNodesFile.edges.length) {
    out.videoEdgesByGoal[goalId] = videoNodesFile.edges
  }
}

/** 用户级（state.json）那一半：与布局无关，v2/v3 共用 */
function userStateOf(state: unknown): Partial<LearnState> {
  return (state && typeof state === 'object' ? state : {}) as Partial<LearnState>
}

/**
 * **v3 读盘**：一个节点一个 `{目录名}.node.json`。
 *
 * 认节点的判据只有一条：`docs/{…}/{目录名}/{目录名}.node.json` ——
 * 文件名主干必须等于它所在目录的名字。目标目录里的 `chat.json` / `reading.json` 等
 * 账本文件因此不会被误认成节点。
 */
export function parseDocsV3(files: Map<string, string>, state: unknown): LearnStore | null {
  /** 目录 → 该目录里的节点文件 */
  const nodeFiles = new Map<string, { base: string; file: NodeFile }>()
  for (const [rel, text] of files) {
    if (!rel.endsWith(NODE_FILE_SUFFIX)) continue
    const parts = rel.split('/')
    if (parts.length < 3 || parts[0] !== DOCS_DIR) continue
    const base = parts[parts.length - 1].slice(0, -NODE_FILE_SUFFIX.length)
    if (base !== parts[parts.length - 2]) continue
    const file = parseJson<NodeFile>(text)
    if (!file || typeof file.id !== 'string' || !file.id) continue
    nodeFiles.set(parts.slice(0, -1).join('/'), { base, file })
  }
  const nodes: Array<Record<string, unknown>> = []
  const goals: Array<Record<string, unknown>> = []
  const edges: Array<Record<string, unknown>> = []
  const exams: Exam[] = []
  const tmp: Record<string, Record<string, TmpEntry>> = {}
  const goalOfDir = new Map<string, string>()

  // 扫描所有顶层目标目录：docs/{目标}
  const topGoalDirs = new Set<string>()
  for (const p of files.keys()) {
    if (!p.startsWith('docs/')) continue
    const segs = p.split('/')
    if (segs.length >= 2) topGoalDirs.add(`docs/${segs[1]}`)
  }

  // 1. 优先从 docs/{目标}/goal.json 读目标元数据
  for (const goalDir of topGoalDirs) {
    const gJson = parseJson<{
      id?: string
      title?: string
      question?: string
      rootNodeId?: string | null
      createdAt?: number
      updatedAt?: number
    }>(files.get(`${goalDir}/goal.json`))
    if (gJson && typeof gJson.id === 'string' && gJson.id) {
      goals.push({
        id: gJson.id,
        title: typeof gJson.title === 'string' ? gJson.title : (gJson.question ?? ''),
        question: typeof gJson.question === 'string' ? gJson.question : '',
        rootNodeId: typeof gJson.rootNodeId === 'string' ? gJson.rootNodeId : '',
        createdAt: typeof gJson.createdAt === 'number' ? gJson.createdAt : Date.now(),
        updatedAt: typeof gJson.updatedAt === 'number' ? gJson.updatedAt : Date.now(),
      })
      goalOfDir.set(goalDir, gJson.id)
    }
  }

  // 2. 兼容旧格式：自己的节点文件里带着 goal 块的根节点
  for (const [dir, { file }] of nodeFiles) {
    if (dir.split('/').length !== 2) continue
    if (goalOfDir.has(dir)) continue
    if (!file.goal || typeof file.goal.id !== 'string' || !file.goal.id) continue
    goals.push({
      id: file.goal.id,
      rootNodeId: file.id,
      question: typeof file.goal.question === 'string' ? file.goal.question : file.title,
      createdAt: typeof file.goal.createdAt === 'number' ? file.goal.createdAt : file.createdAt,
      updatedAt: typeof file.goal.updatedAt === 'number' ? file.goal.updatedAt : file.updatedAt,
    })
    goalOfDir.set(dir, file.goal.id)
  }
  if (!goals.length) return null

  const ledgers = {
    conversations: [] as Conversation[],
    essaysByGoal: {} as Record<string, EssayEntry[]>,
    essayCommitsByGoal: {} as Record<string, EssayCommit[]>,
    workMemory: {} as Record<string, MemoryItem[]>,
    legacyMinds: {} as Record<string, unknown[]>,
    methods: {} as Record<string, MethodEntry[]>,
    workflowsByGoal: {} as Record<string, WorkflowEntry[]>,
    structureByGoal: {} as Record<string, StructureMap>,
    detachedByGoal: {} as Record<string, DetachedPool>,
    resources: {} as Record<string, StaticResource[]>,
    outlinesByGoal: {} as Record<string, { outlines: unknown[]; edges: Array<Record<string, unknown>> }>,
    videoNodesByGoal: {} as Record<string, unknown[]>,
    videoEdgesByGoal: {} as Record<string, Array<Record<string, unknown>>>,
  }

  for (const [dir, { file }] of nodeFiles) {
    const goalDir = dir.split('/').slice(0, 2).join('/')
    const goalId = goalOfDir.get(goalDir)
    if (!goalId) continue

    const content = contentOfParts(file.parts ?? [], {
      createdAt: at(file.createdAt),
      updatedAt: at(file.updatedAt),
    })
    nodes.push({
      id: file.id,
      title: file.title,
      key: file.key,
      description: file.description,
      docs: { teaching: content.teaching },
      notes: content.notes,
      superdocs: content.superdocs,
      ...(content.outline ? { outline: content.outline } : {}),
      annotations: file.annotations,
      status: file.status,
      learning: file.learning,
      ...(file.tint !== undefined ? { tint: file.tint } : {}),
      origin: file.origin,
      goalId,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
    })

    for (const dep of file.dependencies ?? []) {
      if (!dep || typeof dep.to !== 'string' || !dep.to) continue
      // 旧格式的 toOutline 标记迁到拼法上：接大纲卡的边 to = o:{文档id}（分类链）
      const to = dep.toOutline === true ? 'o:' + dep.to : dep.to
      edges.push({ from: file.id, to, createdAt: dep.createdAt, ...(typeof dep.portKey === 'string' && dep.portKey ? { portKey: dep.portKey } : {}) })
    }

    for (const exam of content.exams) {
      if (!exam.nodeId) exam.nodeId = file.id
      if (!exam.goalId) exam.goalId = goalId
      exams.push(exam)
    }

    const tmpFile = parseJson<{ entries?: Record<string, TmpEntry> }>(files.get(`${dir}/tmp.json`))
    if (tmpFile?.entries && typeof tmpFile.entries === 'object') tmp[file.id] = tmpFile.entries


  }

  for (const [goalDir, goalId] of goalOfDir.entries()) {
    readGoalLedgers(files, goalDir, goalId, ledgers)
  }

  // 读回根级 exams/*.json（兜底：节点已经不在的试卷）
  for (const [rel, rawJson] of files) {
    if (rel.startsWith('exams/') && rel.endsWith('.json')) {
      const parsedExam = parseJson<Exam>(rawJson)
      if (parsedExam && parsedExam.id && !exams.some((e) => e.id === parsedExam.id)) exams.push(parsedExam)
    }
  }

  const s = userStateOf(state)
  goals.sort((a, b) => at(b.createdAt) - at(a.createdAt))
  nodes.sort((a, b) => at(a.createdAt) - at(b.createdAt))

  // 游离大纲与它们的树边并进总账（节点文件里的树边上面已经收过了）
  const freeOutlines: unknown[] = []
  for (const led of Object.values(ledgers.outlinesByGoal)) {
    freeOutlines.push(...led.outlines)
    edges.push(...led.edges)
  }
  // 视频节点（目标 × 视频的绑定）与下级树边并进总账
  const videoNodes: unknown[] = []
  for (const led of Object.values(ledgers.videoNodesByGoal)) videoNodes.push(...led)
  for (const led of Object.values(ledgers.videoEdgesByGoal)) edges.push(...led)

  return normalizeLearnStore({
    version: 2,
    nodes,
    edges,
    goals,
    ...(freeOutlines.length ? { outlines: freeOutlines } : {}),
    ...(videoNodes.length ? { videoNodes } : {}),
    conversations: ledgers.conversations,
    exams,
    tmp,
    resources: ledgers.resources,
    memory: { long: s.memory?.long ?? null, work: ledgers.workMemory },
    legacyMinds: ledgers.legacyMinds,
    methods: ledgers.methods,
    workflows: {
      global: s.workflows?.global ?? null,
      byGoal: ledgers.workflowsByGoal,
    },
    activeGoalId: s.activeGoalId ?? null,
    activeNodeId: s.activeNodeId ?? null,
    activeConversationId: s.activeConversationId ?? null,
    docArea: s.docArea ?? null,
    tabs: s.tabs ?? null,
    activeTab: s.activeTab ?? null,
    videos: s.videos ?? null,
    drafts: s.drafts ?? null,
    localFiles: s.localFiles ?? null,
    favorites: s.favorites ?? null,
    favGroups: s.favGroups ?? null,
    essays: ledgers.essaysByGoal,
    essayCommits: ledgers.essayCommitsByGoal,
    structure: ledgers.structureByGoal,
    detached: ledgers.detachedByGoal,
    essayDock: s.essayDock ?? null,
    schedule: s.schedule ?? null,
    agentTabs: s.agentTabs ?? null,
    agentActiveTab: s.agentActiveTab ?? null,
  })
}

/**
 * **v2 读盘（旧布局）**：每个目录里的 `{目录名}.meta.json` 就是一个节点，
 * 正文在 `{目录名}.md`、笔记在 `.notes/`、超级文档在 `superdocs/`、试卷在 `exams/`。
 *
 * 迁移跑完之后这里就只剩"降落伞"这一个用途：迁移失败时让用户还能打开应用。
 * 等第 3 次迁移稳定一个版本之后可以删掉（见 P4）。
 */
export function parseDocsV2(files: Map<string, string>, state: unknown): LearnStore | null {
  // 每个目录里的 `{目录名}.meta.json` 就是一个节点
  const metas = new Map<string, { base: string; meta: MetaFile }>()
  for (const [rel, text] of files) {
    const parts = rel.split('/')
    if (parts.length < 3 || parts[0] !== DOCS_DIR) continue
    const base = parts[parts.length - 2]
    if (parts[parts.length - 1] !== `${base}.meta.json`) continue
    const meta = parseJson<MetaFile>(text)
    if (!meta || typeof meta.id !== 'string' || !meta.id) continue
    metas.set(parts.slice(0, -1).join('/'), { base, meta })
  }
  if (!metas.size) return null

  const nodes: Array<Record<string, unknown>> = []
  const goals: Array<Record<string, unknown>> = []
  const edges: Array<Record<string, unknown>> = []
  const exams: Exam[] = []
  /** 节点 id → 键 → 条目；只收还认得出来的结构 */
  const tmp: Record<string, Record<string, TmpEntry>> = {}

  const ledgers = {
    conversations: [] as Conversation[],
    essaysByGoal: {} as Record<string, EssayEntry[]>,
    essayCommitsByGoal: {} as Record<string, EssayCommit[]>,
    workMemory: {} as Record<string, MemoryItem[]>,
    legacyMinds: {} as Record<string, unknown[]>,
    methods: {} as Record<string, MethodEntry[]>,
    workflowsByGoal: {} as Record<string, WorkflowEntry[]>,
    structureByGoal: {} as Record<string, StructureMap>,
    detachedByGoal: {} as Record<string, DetachedPool>,
    resources: {} as Record<string, StaticResource[]>,
    outlinesByGoal: {} as Record<string, { outlines: unknown[]; edges: Array<Record<string, unknown>> }>,
    videoNodesByGoal: {} as Record<string, unknown[]>,
    videoEdgesByGoal: {} as Record<string, Array<Record<string, unknown>>>,
  }

  // 目标目录必须是顶层（docs/{seg}）且自己那份 meta 在：结构不完整就整棵树跳过
  for (const [dir, { meta }] of metas) {
    if (dir.split('/').length !== 2) continue
    const goalInfo = meta.goal
    const goalId = typeof goalInfo?.id === 'string' && goalInfo.id ? goalInfo.id : meta.id
    goals.push({
      id: goalId,
      rootNodeId: meta.id,
      question: typeof goalInfo?.question === 'string' ? goalInfo.question : meta.title,
      createdAt: typeof goalInfo?.createdAt === 'number' ? goalInfo.createdAt : meta.createdAt,
      updatedAt: typeof goalInfo?.updatedAt === 'number' ? goalInfo.updatedAt : meta.updatedAt,
    })
  }
  if (!goals.length) return null

  const goalOfDir = (dir: string): { id: string } | null => {
    const goalDir = dir.split('/').slice(0, 2).join('/')
    const entry = metas.get(goalDir)
    if (!entry) return null
    const info = entry.meta.goal
    return { id: typeof info?.id === 'string' && info.id ? info.id : entry.meta.id }
  }

  for (const [dir, { base, meta }] of metas) {
    const goal = goalOfDir(dir)
    if (!goal) continue
    if (dir.split('/').length === 2) {
      readGoalLedgers(files, dir, goal.id, ledgers)
    } else {
      /*
       * v2 早期每个节点目录各有一份 chat.json：并进所属目标的对话列表（归属单位是目标）。
       * 不在这里挑拣——nodeId → goalId 的折算与孤儿（已删节点）丢弃由 normalize 统一做
       * （见 store/normalize/conversation），与目标目录那份走同一条口径。
       */
      const nodeChat = parseJson<{ conversations?: unknown[] }>(files.get(`${dir}/chat.json`))
      for (const c of nodeChat?.conversations ?? []) {
        if (!c || typeof c !== 'object') continue
        ledgers.conversations.push(migrateConversation(c as Conversation))
      }
    }

    const tmpFile = parseJson<{ entries?: Record<string, TmpEntry> }>(files.get(`${dir}/tmp.json`))
    if (tmpFile?.entries && typeof tmpFile.entries === 'object') tmp[meta.id] = tmpFile.entries

    // 1. 读回超级文档：扫描 ${dir}/superdocs/*.html
    const superdocsPrefix = `${dir}/superdocs/`
    const sdocsFromFiles: SuperDocFile[] = []
    const sdocSeen = new Set<string>()
    for (const [rel, html] of files) {
      if (rel.startsWith(superdocsPrefix) && rel.endsWith('.html')) {
        const name = rel.slice(superdocsPrefix.length, -5)
        if (name && !name.includes('/')) {
          sdocSeen.add(name.toLowerCase())
          sdocsFromFiles.push({
            id: crypto.randomUUID(),
            name,
            html,
            createdAt: meta.createdAt || Date.now(),
            updatedAt: meta.updatedAt || Date.now(),
          })
        }
      }
    }
    // 兼容 meta.superdocs 中的旧数据（未在物理文件中的补上）
    if (Array.isArray(meta.superdocs)) {
      for (const d of meta.superdocs as SuperDocFile[]) {
        if (d && typeof d.name === 'string' && !sdocSeen.has(d.name.toLowerCase())) {
          sdocsFromFiles.push(d)
        }
      }
    }

    // 2. 读回试卷：扫描 ${dir}/exams/*.json
    const examsPrefix = `${dir}/exams/`
    const examSeen = new Set<string>()
    for (const [rel, rawJson] of files) {
      if (rel.startsWith(examsPrefix) && rel.endsWith('.json')) {
        const parsedExam = parseJson<Exam>(rawJson)
        if (parsedExam && parsedExam.id) {
          if (!parsedExam.nodeId) parsedExam.nodeId = meta.id
          if (!parsedExam.goalId) parsedExam.goalId = goal.id
          examSeen.add(parsedExam.id)
          exams.push(parsedExam)
        }
      }
    }
    // 兼容 meta.exams 中的旧数据（未在物理文件中的补上）
    if (Array.isArray(meta.exams)) {
      for (const e of meta.exams as Exam[]) {
        if (e && e.id && !examSeen.has(e.id)) exams.push(e)
      }
    }

    const outlineParsed = parseJson(files.get(`${dir}/${outlineFileName(base)}`))
    const content = contentOfParts(
      [
        { kind: 'teaching', format: 'markdown', body: files.get(`${dir}/${docFileName(base)}`) ?? '' },
        ...(outlineParsed ? [{ kind: 'outline' as const, format: 'json' as const, body: outlineParsed }] : []),
      ],
      { createdAt: meta.createdAt, updatedAt: meta.updatedAt },
    )

    nodes.push({
      id: meta.id,
      title: meta.title,
      key: meta.key,
      description: meta.description,
      docs: { teaching: content.teaching },
      notes: readNotes(files, dir, base, meta),
      superdocs: sdocsFromFiles,
      ...(content.outline ? { outline: content.outline } : {}),
      annotations: meta.annotations,
      status: meta.status,
      // 旧数据没有这一项：交给 normalizeLearning 收成 undefined，不进内存
      learning: meta.learning,
      origin: meta.origin,
      goalId: goal.id,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
    })

    for (const dep of meta.dependencies ?? []) {
      if (!dep || typeof dep.to !== 'string' || !dep.to) continue
      // 旧格式的 toOutline 标记迁到拼法上：接大纲卡的边 to = o:{文档id}（分类链）
      const to = dep.toOutline === true ? 'o:' + dep.to : dep.to
      edges.push({ from: meta.id, to, createdAt: dep.createdAt, ...(typeof dep.portKey === 'string' && dep.portKey ? { portKey: dep.portKey } : {}) })
    }
  }

  // 读回根级 exams/*.json
  for (const [rel, rawJson] of files) {
    if (rel.startsWith('exams/') && rel.endsWith('.json')) {
      const parsedExam = parseJson<Exam>(rawJson)
      if (parsedExam && parsedExam.id && !exams.some((e) => e.id === parsedExam.id)) {
        exams.push(parsedExam)
      }
    }
  }

  const s = userStateOf(state)
  // 目标按创建时间倒序——新建的目标是插在最前面的（见 LearnWorkspace）
  goals.sort((a, b) => at(b.createdAt) - at(a.createdAt))
  nodes.sort((a, b) => at(a.createdAt) - at(b.createdAt))

  // 游离大纲与它们的树边并进总账（旧布局没有 outlines.json，这里恒为空，字段补齐走同一份归一）
  const freeOutlines2: unknown[] = []
  for (const led of Object.values(ledgers.outlinesByGoal)) {
    freeOutlines2.push(...led.outlines)
    edges.push(...led.edges)
  }
  // 视频节点（目标 × 视频的绑定）与下级树边并进总账（旧布局同样恒为空）
  const videoNodes2: unknown[] = []
  for (const led of Object.values(ledgers.videoNodesByGoal)) videoNodes2.push(...led)
  for (const led of Object.values(ledgers.videoEdgesByGoal)) edges.push(...led)

  return normalizeLearnStore({
    version: 2,
    nodes,
    edges,
    goals,
    ...(freeOutlines2.length ? { outlines: freeOutlines2 } : {}),
    ...(videoNodes2.length ? { videoNodes: videoNodes2 } : {}),
    conversations: ledgers.conversations,
    exams,
    tmp,
    resources: ledgers.resources,
    memory: { long: s.memory?.long ?? null, work: ledgers.workMemory },
    legacyMinds: ledgers.legacyMinds,
    methods: ledgers.methods,
    workflows: {
      global: s.workflows?.global ?? null,
      byGoal: ledgers.workflowsByGoal,
    },
    activeGoalId: s.activeGoalId ?? null,
    activeNodeId: s.activeNodeId ?? null,
    activeConversationId: s.activeConversationId ?? null,
    docArea: s.docArea ?? null,
    tabs: s.tabs ?? null,
    activeTab: s.activeTab ?? null,
    videos: s.videos ?? null,
    drafts: s.drafts ?? null,
    localFiles: s.localFiles ?? null,
    favorites: s.favorites ?? null,
    favGroups: s.favGroups ?? null,
    essays: ledgers.essaysByGoal,
    essayCommits: ledgers.essayCommitsByGoal,
    structure: ledgers.structureByGoal,
    detached: ledgers.detachedByGoal,
    essayDock: s.essayDock ?? null,
    schedule: s.schedule ?? null,
    agentTabs: s.agentTabs ?? null,
    agentActiveTab: s.agentActiveTab ?? null,
  })
}

/**
 * 读回一个节点的笔记（**只服务旧布局 v2**）。三处来源，按优先级并成一份列表：
 *
 * 1. meta.notes 里登记的**顺序**（新建的在后）。它决定界面上的排列，必须最稳；
 * 2. `{节点}.notes/*.md` 的正文。meta 里没有登记的文件也收（有人往目录里手丢了一份），
 *    排在已登记的后面并按名字排序——顺序不稳定比丢内容好查得多；
 * 3. 老布局的 `{节点}.笔记.md`：并成一份名为「笔记」的笔记。
 *    它与 (2) 里同名（用户真的建过一份叫「笔记」的笔记）时以后者为准，避免两份内容打架。
 */
function readNotes(
  files: Map<string, string>,
  dir: string,
  base: string,
  meta: MetaFile,
): NoteFile[] {
  const prefix = dir + '/' + base + NOTES_SUFFIX + '/'
  const bodies = new Map<string, string>()
  for (const [rel, text] of files) {
    if (!rel.startsWith(prefix) || !rel.endsWith('.md')) continue
    const name = rel.slice(prefix.length, -3)
    // 只认直接放在这个目录下的文件：更深一层说明是用户自己分的子目录，不是一份笔记
    if (!name || name.includes('/')) continue
    bodies.set(name, text)
  }

  const notes: NoteFile[] = []
  const seen = new Set<string>()
  for (const item of meta.notes ?? []) {
    if (!item || typeof item.name !== 'string' || !item.name) continue
    const name = item.name
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    notes.push({
      id: typeof (item as unknown as { id?: unknown }).id === 'string' && (item as unknown as { id?: string }).id ? (item as unknown as { id: string }).id : crypto.randomUUID(),
      name,
      content: bodies.get(name) ?? '',
      createdAt: at(item.createdAt) || meta.createdAt,
      updatedAt: at(item.updatedAt) || at(item.createdAt) || meta.updatedAt,
    })
    bodies.delete(name)
  }
  // meta 里没登记的文件（手丢进来的）：按名字排序，顺序才是确定的
  for (const name of [...bodies.keys()].sort()) {
    if (seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    notes.push({ id: crypto.randomUUID(), name, content: bodies.get(name) ?? '', createdAt: meta.createdAt, updatedAt: meta.createdAt })
  }

  const legacy = files.get(dir + '/' + base + LEGACY_NOTE_SUFFIX + '.md')
  if (legacy && !seen.has('笔记')) {
    notes.push({ id: crypto.randomUUID(), name: '笔记', content: legacy, createdAt: meta.createdAt, updatedAt: meta.updatedAt })
  }
  return notes
}
