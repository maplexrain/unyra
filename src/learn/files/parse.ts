/** 这个文件负责什么：磁盘 → 内存——把读进来的文件集合还原成学习数据（parseDocs），以及一个节点的笔记怎么并回一份列表（readNotes）。 */

/* ---------- 磁盘 → 内存 ---------- */

import type { Conversation } from '../../agent/types'
import { migrateConversation } from '../compact'
import type { Exam } from '../exam'
import type {
  LearnStore,
  MethodEntry,
  MindEntry,
  NoteFile,
  TmpEntry,
  WorkflowEntry,
} from '../types'
import { normalizeLearnStore } from '../store/normalize'
import { normalizeOutline } from '../outline'
import { normalizeReviewPlan } from '../review'
import { parseManifest } from '../static/manifest'
import type { StaticResource } from '../static/types'
import type { ReadingStore } from '../reading'
import type { CheckinStore } from '../checkin'
import { DOCS_DIR, MANIFEST_FILE, NOTES_SUFFIX, STATIC_DIR } from '../layout'
import { LEGACY_NOTE_SUFFIX, docFileName, outlineFileName } from './names'
import { at, parseJson, type MetaFile } from './meta'
import type { LearnState } from './state'

/**
 * 从文件集合还原学习数据；没有可用的文档返回 null。
 *
 * 校验与修补交给 store 的 normalizeLearnStore：磁盘上的东西可能被人手改过，
 * 与导入一份备份没有本质区别，走同一条路最省心。
 */
export function parseDocs(files: Map<string, string>, state: unknown): LearnStore | null {
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
  const conversations: Conversation[] = []
  const exams: Exam[] = []
  /** 节点 id → 键 → 条目；只收还认得出来的结构 */
  const tmp: Record<string, Record<string, TmpEntry>> = {}
  /** 目标 id → 资源清单（见 learn/static） */
  const resources: Record<string, StaticResource[]> = {}
  /** 目标 id → 长期记忆（见 learn/mind） */
  const minds: Record<string, MindEntry[]> = {}
  /** 目标 id → 持久化函数（见 learn/methods） */
  const methods: Record<string, MethodEntry[]> = {}
  /** 目标 id → 登记的工作流（见 learn/workflows） */
  const workflowsByGoal: Record<string, WorkflowEntry[]> = {}
  /** 目标 id → 那个目标的有效阅读账（见 learn/reading） */
  const readingByGoal: Record<string, ReadingStore> = {}
  /** 目标 id → 那个目标的打卡账（见 learn/checkin） */
  const checkinByGoal: Record<string, CheckinStore> = {}

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
    const convs = parseJson<{ conversations?: unknown[] }>(files.get(`${dir}/chat.json`))
    for (const c of convs?.conversations ?? []) {
      if (!c || typeof c !== 'object') continue
      /**
       * 旧布局：对话散在**各个节点目录**下、用 nodeId 归属；新布局只有目标目录一份、用 goalId。
       * 两种都原样交给 normalizeLearnStore：它认 goalId，也会把旧的 nodeId 折算成所属目标
       * （节点已经没了的对话因此照旧被丢掉，不会因为搬了个位置就诈尸）。
       * 写回时只剩目标目录那一份，旧文件由 diff 删掉——这就是上下文改成目标级的数据迁移。
       */
      // 折算旧结构：throughId 时代的「压到哪一条」变成消息自己的失活标记（见 learn/compact）
      conversations.push(migrateConversation(c as Conversation))
    }
    const tmpFile = parseJson<{ entries?: Record<string, TmpEntry> }>(files.get(`${dir}/tmp.json`))
    if (tmpFile?.entries && typeof tmpFile.entries === 'object') tmp[meta.id] = tmpFile.entries
    // 资源清单只有目标目录下才有这一份；子节点目录不会有
    const manifest = parseManifest(files.get(`${dir}/${STATIC_DIR}/${MANIFEST_FILE}`))
    if (manifest.length) resources[goal.id] = manifest
    // 长期记忆同样只有目标目录一份（见 buildDocs）
    const mindFile = parseJson<{ minds?: MindEntry[] }>(files.get(`${dir}/mind.json`))
    if (Array.isArray(mindFile?.minds) && mindFile.minds.length) minds[goal.id] = mindFile.minds
    // 持久化函数同上（method.json，与 mind.json 同层同纪律）
    const methodFile = parseJson<{ methods?: MethodEntry[] }>(files.get(`${dir}/method.json`))
    if (Array.isArray(methodFile?.methods) && methodFile.methods.length) methods[goal.id] = methodFile.methods
    // 目标级工作流同上（workflow.json，与 method.json 同层同纪律；全局级在 state 里，见下面 s.workflows）
    const workflowFile = parseJson<{ workflows?: WorkflowEntry[] }>(files.get(`${dir}/workflow.json`))
    if (Array.isArray(workflowFile?.workflows) && workflowFile.workflows.length) {
      workflowsByGoal[goal.id] = workflowFile.workflows
    }
    // 有效阅读与打卡同上（reading.json / checkin.json，与 workflow.json 同层同纪律）
    const readingFile = parseJson<ReadingStore>(files.get(`${dir}/reading.json`))
    if (readingFile) readingByGoal[goal.id] = readingFile
    const checkinFile = parseJson<CheckinStore>(files.get(`${dir}/checkin.json`))
    if (checkinFile) checkinByGoal[goal.id] = checkinFile
    if (Array.isArray(meta.exams)) for (const e of meta.exams) exams.push(e as Exam)

    const outlineParsed = normalizeOutline(parseJson(files.get(`${dir}/${outlineFileName(base)}`)))
    nodes.push({
      id: meta.id,
      title: meta.title,
      key: meta.key,
      description: meta.description,
      docs: { teaching: files.get(`${dir}/${docFileName(base)}`) ?? '' },
      notes: readNotes(files, dir, base, meta),
      // 超级文档整份在 meta 里（缺这一项的旧节点交给 normalizeSuperDocs 收成空清单）
      superdocs: meta.superdocs,
      // 大纲是与教学文档配对的独立文件（{节点}.outline.json）；旧数据没有，交给 normalizeNode 留空
      ...(outlineParsed ? { outline: outlineParsed } : {}),
      annotations: meta.annotations,
      status: meta.status,
      // 旧数据没有这一项：交给 normalizeLearning 收成 undefined，不进内存
      learning: meta.learning,
      // 复习计划同上（老节点没有；读不出形状的交给 normalizeReviewPlan 收成 undefined，见 learn/review）
      ...(meta.review ? { review: normalizeReviewPlan(meta.review) } : {}),
      origin: meta.origin,
      goalId: goal.id,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
    })

    for (const dep of meta.dependencies ?? []) {
      if (!dep || typeof dep.to !== 'string' || !dep.to) continue
      edges.push({ from: meta.id, to: dep.to, createdAt: dep.createdAt })
    }
  }

  const s = (state && typeof state === 'object' ? state : {}) as Partial<LearnState>
  // 目录列表的顺序由文件系统决定，不稳定；排一下序，免得每次启动侧栏顺序都在变。
  // 目标按创建时间倒序——新建的目标是插在最前面的（见 LearnWorkspace），
  // 倒序才能让重载前后的顺序一致。
  goals.sort((a, b) => at(b.createdAt) - at(a.createdAt))
  nodes.sort((a, b) => at(a.createdAt) - at(b.createdAt))
  return normalizeLearnStore({
    version: 2,
    nodes,
    edges,
    goals,
    conversations,
    exams,
    tmp,
    resources,
    minds,
    methods,
    workflows: {
      // 全局那份跟着 state.json 走（buildState）；交给 normalize 按目标存活情况校验
      global: s.workflows?.global ?? null,
      byGoal: workflowsByGoal,
      // 思考档位配置同样跟着 state.json 走；幽灵键由 normalize 对着有效 id 剪掉
      efforts: s.workflows?.efforts ?? null,
    },
    activeGoalId: s.activeGoalId ?? null,
    activeNodeId: s.activeNodeId ?? null,
    activeConversationId: s.activeConversationId ?? null,
    /*
     * 文档区（分组 + 分割）与本地文件列表原样交给 normalizeLearnStore：它们要对着
     * 「哪些节点还活着」校验，而节点正是它刚拾掇出来的那一批（同一个节点在这一层还不存在，
     * 看不出好坏）。
     *
     * docArea 是**新版**的那一份；顶层的 tabs / activeTab 只有老 state.json 里才有，
     * 两个都交下去——normalizeDocs 认新版，读不到新版时把旧版折成单组（升级那条路）。
     */
    docArea: s.docArea ?? null,
    tabs: s.tabs ?? null,
    activeTab: s.activeTab ?? null,
    drafts: s.drafts ?? null,
    localFiles: s.localFiles ?? null,
    /*
     * 阅读与打卡现在按目标存在各自目录里（reading.json / checkin.json，见上面）。
     * state.json 里那两个老字段**故意不读**：这次改口径不迁移数据，旧的那一份直接丢掉。
     * 番茄钟仍旧整份存在 state.json 里（它是用户级的：今天专注了几组与哪门课无关）。
     */
    reading: { byGoal: readingByGoal },
    checkin: { byGoal: checkinByGoal },
    pomodoro: s.pomodoro ?? null,
  })
}

/**
 * 读回一个节点的笔记。三处来源，按优先级并成一份列表：
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
    notes.push({ name, content: bodies.get(name) ?? '', createdAt: meta.createdAt, updatedAt: meta.createdAt })
  }

  const legacy = files.get(dir + '/' + base + LEGACY_NOTE_SUFFIX + '.md')
  if (legacy && !seen.has('笔记')) {
    notes.push({ name: '笔记', content: legacy, createdAt: meta.createdAt, updatedAt: meta.updatedAt })
  }
  return notes
}
