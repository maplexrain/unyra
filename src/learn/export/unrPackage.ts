/**
 * 本文件负责：归一总目标导出与导入（.unr 格式）。
 *
 * ## 契约规范
 * - 导出文件为二进制文件，魔数前缀为 `UNR1` (4 字节 ASCII: 0x55, 0x4E, 0x52, 0x31)；
 * - 第 5 字节为格式版本号 (当前为 0x01)；
 * - 后续负载为经过标准 Gzip 压缩的 UTF-8 JSON 文本流；
 * - 扩展名为 `.unr`；
 * - 隐私安全保证：导出的数据严格排除会话历史 (conversations/messages)、个人作答记录 (attempts)、
 *   用户习惯与记忆 (memory)、临时变量 (tmp)、未保存草稿 (drafts)、本地绝对路径 (projects/localFiles)、
 *   个人排程 (schedule) 以及阅读打卡足迹 (lastStudiedAt)。
 */

import type {
  DependencyEdge,
  DetachedPool,
  EssayCommitStore,
  EssayStore,
  KnowledgeNode,
  LearningGoal,
  LearnStore,
  MethodEntry,
  OutlineEntity,
} from '../types'
import type { Exam } from '../exam'
import type { CardPos, StructureMap } from '../structure'
import { fileBaseName } from '../../lib/exportDoc'
import { isElectron, native } from '../../lib/native'

/** .unr 二进制文件魔数头：ASCII "UNR1" */
export const UNR_MAGIC = new Uint8Array([0x55, 0x4e, 0x52, 0x31])
/** 当前目标包格式版本号 */
export const UNR_VERSION = 1

/** 归一目标包 JSON 结构体 */
export interface UnrGoalPackage {
  format: 'unyra-goal'
  version: 1
  exportedAt: number
  generator: string
  goal: LearningGoal
  nodes: KnowledgeNode[]
  edges: DependencyEdge[]
  outlines?: OutlineEntity[]
  exams?: Exam[]
  structure?: StructureMap
  detached?: DetachedPool
  methods?: MethodEntry[]
  essays?: EssayStore[string]
  essayCommits?: EssayCommitStore[string]
}

/** Gzip 压缩：优先使用 Web 标准 CompressionStream，回退到 Node.js zlib */
export async function gzipCompress(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream !== 'undefined') {
    const stream = new Blob([bytes as unknown as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'))
    const buffer = await new Response(stream).arrayBuffer()
    return new Uint8Array(buffer)
  }
  const zlib = await import('node:zlib')
  return new Uint8Array(zlib.gzipSync(bytes))
}

/** Gzip 解压：优先使用 Web 标准 DecompressionStream，回退到 Node.js zlib */
export async function gzipDecompress(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream !== 'undefined') {
    const stream = new Blob([bytes as unknown as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'))
    const buffer = await new Response(stream).arrayBuffer()
    return new Uint8Array(buffer)
  }
  const zlib = await import('node:zlib')
  return new Uint8Array(zlib.gunzipSync(bytes))
}

/**
 * 将总目标及其关联的教学内容脱敏净化为分享包数据结构。
 * 绝不包含任何对话记录、考试作答历史或个人隐私数据。
 */
export function sanitizeGoalForExport(store: LearnStore, goalId: string): UnrGoalPackage {
  const goal = store.goals.find((g) => g.id === goalId)
  if (!goal) {
    throw new Error(`目标不存在: ${goalId}`)
  }

  // 1. 净化该目标下的所有知识节点
  const nodes = store.nodes.filter((n) => n.goalId === goalId)
  const sanitizedNodes: KnowledgeNode[] = nodes.map((n) => ({
    id: n.id,
    title: n.title,
    key: n.key,
    description: n.description,
    docs: { teaching: n.docs?.teaching ?? '' },
    notes: (n.notes ?? []).map((note) => ({
      id: note.id,
      name: note.name,
      content: note.content,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    })),
    superdocs: (n.superdocs ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      html: s.html,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    })),
    outline: n.outline
      ? {
          intro: n.outline.intro ?? '',
          children: (n.outline.children ?? []).map((c) => ({
            key: c.key,
            title: c.title,
            summary: c.summary,
          })),
          updatedAt: n.outline.updatedAt ?? Date.now(),
        }
      : undefined,
    annotations: (n.annotations ?? []).map((a) => ({
      term: a.term,
      body: a.body,
      kind: a.kind,
      style: a.style ? { ...a.style } : undefined,
      occurrence: a.occurrence,
    })),
    tint: n.tint,
    // 状态重置为待学习，新学习者从头开始；清除打卡时间与足迹
    status: 'learning',
    lastStudiedAt: undefined,
    origin: n.origin ?? 'ai',
    goalId: n.goalId,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
  }))

  // 2. 游离大纲
  const outlines = (store.outlines ?? []).filter((o) => o.goalId === goalId)

  // 3. 依赖边（仅包含该目标成员之间的连线）
  const memberIds = new Set<string>([
    ...nodes.map((n) => n.id),
    ...outlines.map((o) => 'o:' + o.id),
  ])
  const edges = store.edges
    .filter((e) => memberIds.has(e.from) && memberIds.has(e.to))
    .map((e) => ({
      from: e.from,
      to: e.to,
      createdAt: e.createdAt,
      portKey: e.portKey,
    }))

  // 4. 试卷：保留题目、考查范围与时限，但强制剔除 attempts 作答记录以保护隐私
  const exams = store.exams
    .filter((e) => e.goalId === goalId || nodes.some((n) => n.id === e.nodeId))
    .map((e) => ({
      id: e.id,
      nodeId: e.nodeId,
      goalId: e.goalId,
      title: e.title,
      kind: e.kind,
      level: e.level,
      minutes: e.minutes,
      questions: e.questions.map((q) => ({
        id: q.id,
        type: q.type,
        stem: q.stem,
        options: q.options?.map((opt) => ({ id: opt.id, text: opt.text })),
        answer: q.answer ? [...q.answer] : undefined,
        rubric: q.rubric,
        image: q.image,
        points: q.points,
      })),
      createdAt: e.createdAt,
      attempts: [], // 隐私安全：作答记录一律清空
    }))

  // 5. 结构图（坐标）
  const rawStructure = store.structure?.[goalId]
  let structure: StructureMap | undefined
  if (rawStructure) {
    const validKeys = new Set<string>([
      ...nodes.map((n) => n.id),
      ...outlines.map((o) => 'o:' + o.id),
      ...exams.map((e) => 'e:' + e.id),
      goal.rootNodeId,
    ])
    const positions: Record<string, CardPos> = {}
    for (const [k, pos] of Object.entries(rawStructure.positions ?? {})) {
      if (validKeys.has(k)) {
        const card = pos as CardPos
        positions[k] = { x: card.x, y: card.y, note: card.note }
      }
    }
    structure = {
      version: 2,
      positions,
      edgeStyle: rawStructure.edgeStyle,
    }
  }

  // 6. 游离挂件池
  const detached = store.detached?.[goalId]
  // 7. 目标级持久化方法
  const methods = store.methods?.[goalId]
  // 8. 随笔与随笔提交
  const essays = store.essays?.[goalId]
  const essayCommits = store.essayCommits?.[goalId]

  return {
    format: 'unyra-goal',
    version: 1,
    exportedAt: Date.now(),
    generator: 'Unyra',
    goal: {
      id: goal.id,
      title: goal.title,
      rootNodeId: goal.rootNodeId,
      question: goal.question,
      createdAt: goal.createdAt,
      updatedAt: goal.updatedAt,
    },
    nodes: sanitizedNodes,
    edges,
    outlines: outlines.length ? outlines : undefined,
    exams: exams.length ? exams : undefined,
    structure,
    detached: detached ? JSON.parse(JSON.stringify(detached)) : undefined,
    methods: methods ? JSON.parse(JSON.stringify(methods)) : undefined,
    essays: essays ? JSON.parse(JSON.stringify(essays)) : undefined,
    essayCommits: essayCommits ? JSON.parse(JSON.stringify(essayCommits)) : undefined,
  }
}

/** 将脱敏后的目标包打包为二进制 .unr 字节流 */
export async function packUnrPackage(pkg: UnrGoalPackage): Promise<Uint8Array> {
  const jsonStr = JSON.stringify(pkg)
  const jsonBytes = new TextEncoder().encode(jsonStr)
  const compressed = await gzipCompress(jsonBytes)

  const out = new Uint8Array(5 + compressed.length)
  out.set(UNR_MAGIC, 0)
  out[4] = UNR_VERSION
  out.set(compressed, 5)
  return out
}

/** 将总目标导出为二进制 .unr 文件字节 */
export async function exportGoalToUnr(store: LearnStore, goalId: string): Promise<Uint8Array> {
  const pkg = sanitizeGoalForExport(store, goalId)
  return packUnrPackage(pkg)
}

/** 解析并解压 .unr 二进制文件字节，严格校验头部魔数与版本 */
export async function parseUnrPackage(bytes: Uint8Array): Promise<UnrGoalPackage> {
  if (bytes.length < 5) {
    throw new Error('不是有效的归一目标包 (.unr) 文件：文件损坏或过短')
  }
  for (let i = 0; i < 4; i++) {
    if (bytes[i] !== UNR_MAGIC[i]) {
      throw new Error('不是有效的归一目标包 (.unr) 文件：文件头标识不匹配')
    }
  }
  const version = bytes[4]
  if (version !== UNR_VERSION) {
    throw new Error(`不支持的目标包格式版本: v${version}`)
  }

  const compressed = bytes.subarray(5)
  const decompressed = await gzipDecompress(compressed)
  const jsonStr = new TextDecoder('utf-8').decode(decompressed)
  const data = JSON.parse(jsonStr) as UnrGoalPackage

  if (!data || data.format !== 'unyra-goal' || !data.goal || typeof data.goal.id !== 'string') {
    throw new Error('目标包损坏或缺少必要的根目标数据')
  }
  if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
    throw new Error('目标包损坏：节点或边数据不是合法列表')
  }

  // 严格确保导入的试卷作答记录为空，避免外部构造非法数据
  if (Array.isArray(data.exams)) {
    for (const ex of data.exams) {
      ex.attempts = []
    }
  }

  return data
}

/** 生成唯一不重名的目标标题 */
export function uniqueGoalTitle(store: LearnStore, base: string): string {
  const trimmed = base.trim() || '学习目标'
  const existing = new Set(store.goals.map((g) => g.title?.trim()).filter(Boolean))
  if (!existing.has(trimmed)) return trimmed
  let counter = 1
  let candidate = `${trimmed} (导入)`
  while (existing.has(candidate)) {
    counter++
    candidate = `${trimmed} (导入 ${counter})`
  }
  return candidate
}

/**
 * 将解析出的目标包合并导入进当前 LearnStore。
 * 当检测到任何 ID 冲突时，自动为目标及其子实体分配全局全新 UUID，
 * 并同步映射关系边、大纲、试卷与结构图画布坐标，确保完全隔离且不破坏现有数据。
 */
export function importGoalFromPackage(
  store: LearnStore,
  pkg: UnrGoalPackage,
): { store: LearnStore; goal: LearningGoal } {
  // 检查是否存在冲突（目标 ID 或任何节点、大纲、试卷 ID 重合）
  const hasGoalIdCollision = store.goals.some((g) => g.id === pkg.goal.id)
  const hasNodeIdCollision = (pkg.nodes ?? []).some((pn) => store.nodes.some((sn) => sn.id === pn.id))
  const hasOutlineIdCollision = (pkg.outlines ?? []).some((po) =>
    (store.outlines ?? []).some((so) => so.id === po.id),
  )
  const hasExamIdCollision = (pkg.exams ?? []).some((pe) => store.exams.some((se) => se.id === pe.id))

  const shouldRemap = hasGoalIdCollision || hasNodeIdCollision || hasOutlineIdCollision || hasExamIdCollision

  const idMap = new Map<string, string>()
  const newGoalId = shouldRemap ? crypto.randomUUID() : pkg.goal.id
  idMap.set(pkg.goal.id, newGoalId)

  // 为每个节点分配新 ID
  for (const n of pkg.nodes ?? []) {
    const nid = shouldRemap ? crypto.randomUUID() : n.id
    idMap.set(n.id, nid)
    for (const note of n.notes ?? []) {
      idMap.set(note.id, shouldRemap ? crypto.randomUUID() : note.id)
    }
    for (const s of n.superdocs ?? []) {
      idMap.set(s.id, shouldRemap ? crypto.randomUUID() : s.id)
    }
  }

  // 为每个大纲分配新 ID
  for (const o of pkg.outlines ?? []) {
    const oid = shouldRemap ? crypto.randomUUID() : o.id
    idMap.set(o.id, oid)
    idMap.set('o:' + o.id, 'o:' + oid)
  }

  // 为每个试卷分配新 ID
  for (const e of pkg.exams ?? []) {
    const eid = shouldRemap ? crypto.randomUUID() : e.id
    idMap.set(e.id, eid)
    idMap.set('e:' + e.id, 'e:' + eid)
  }

  // 游离挂件池
  if (pkg.detached) {
    for (const note of pkg.detached.notes ?? []) {
      idMap.set(note.id, shouldRemap ? crypto.randomUUID() : note.id)
    }
    for (const s of pkg.detached.superdocs ?? []) {
      idMap.set(s.id, shouldRemap ? crypto.randomUUID() : s.id)
    }
  }

  const newGoal: LearningGoal = {
    id: newGoalId,
    title: uniqueGoalTitle(store, pkg.goal.title || '学习目标'),
    rootNodeId: idMap.get(pkg.goal.rootNodeId) ?? pkg.goal.rootNodeId,
    question: pkg.goal.question ?? '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }

  const newNodes: KnowledgeNode[] = (pkg.nodes ?? []).map((n) => ({
    ...n,
    id: idMap.get(n.id) ?? n.id,
    goalId: newGoalId,
    status: 'learning',
    lastStudiedAt: undefined,
    notes: (n.notes ?? []).map((note) => ({
      ...note,
      id: idMap.get(note.id) ?? note.id,
    })),
    superdocs: (n.superdocs ?? []).map((s) => ({
      ...s,
      id: idMap.get(s.id) ?? s.id,
    })),
  }))

  const newEdges: DependencyEdge[] = (pkg.edges ?? []).map((e) => ({
    ...e,
    from: idMap.get(e.from) ?? e.from,
    to: idMap.get(e.to) ?? e.to,
  }))

  const newOutlines: OutlineEntity[] = (pkg.outlines ?? []).map((o) => ({
    ...o,
    id: idMap.get(o.id) ?? o.id,
    goalId: newGoalId,
  }))

  const newExams: Exam[] = (pkg.exams ?? []).map((e) => ({
    ...e,
    id: idMap.get(e.id) ?? e.id,
    nodeId: idMap.get(e.nodeId) ?? e.nodeId,
    goalId: newGoalId,
    attempts: [],
  }))

  let newStructure: StructureMap | undefined
  if (pkg.structure) {
    const newPositions: Record<string, CardPos> = {}
    for (const [k, pos] of Object.entries(pkg.structure.positions ?? {})) {
      let mappedKey = idMap.get(k)
      if (!mappedKey) {
        if (k.startsWith('o:')) {
          const sub = k.slice(2)
          mappedKey = 'o:' + (idMap.get(sub) ?? sub)
        } else if (k.startsWith('e:')) {
          const sub = k.slice(2)
          mappedKey = 'e:' + (idMap.get(sub) ?? sub)
        } else {
          mappedKey = k
        }
      }
      const card = pos as CardPos
      newPositions[mappedKey] = { x: card.x, y: card.y, note: card.note }
    }
    newStructure = {
      version: 2,
      positions: newPositions,
      edgeStyle: pkg.structure.edgeStyle,
    }
  }

  let newDetached: DetachedPool | undefined
  if (pkg.detached) {
    newDetached = {
      notes: (pkg.detached.notes ?? []).map((note) => ({
        ...note,
        id: idMap.get(note.id) ?? note.id,
      })),
      superdocs: (pkg.detached.superdocs ?? []).map((s) => ({
        ...s,
        id: idMap.get(s.id) ?? s.id,
      })),
    }
  }

  const nextStore: LearnStore = {
    ...store,
    goals: [...store.goals, newGoal],
    nodes: [...store.nodes, ...newNodes],
    edges: [...store.edges, ...newEdges],
    outlines: newOutlines.length ? [...(store.outlines ?? []), ...newOutlines] : store.outlines,
    exams: newExams.length ? [...store.exams, ...newExams] : store.exams,
    structure: newStructure ? { ...(store.structure ?? {}), [newGoalId]: newStructure } : store.structure,
    detached: newDetached ? { ...(store.detached ?? {}), [newGoalId]: newDetached } : store.detached,
    methods: pkg.methods ? { ...(store.methods ?? {}), [newGoalId]: pkg.methods } : store.methods,
    essays: pkg.essays ? { ...(store.essays ?? {}), [newGoalId]: pkg.essays } : store.essays,
    essayCommits: pkg.essayCommits
      ? { ...(store.essayCommits ?? {}), [newGoalId]: pkg.essayCommits }
      : store.essayCommits,
    activeGoalId: newGoalId,
    activeNodeId: newGoal.rootNodeId,
  }

  return { store: nextStore, goal: newGoal }
}

/** 保存 .unr 文件：在 Electron 桌面端弹出原生对话框，在 Web 环境下自动触发二进制下载 */
export async function saveUnrFile(
  bytes: Uint8Array,
  suggestedName: string,
): Promise<{ ok: boolean; canceled?: boolean; path?: string; error?: string }> {
  const safeName = fileBaseName(suggestedName.replace(/\.unr$/i, '')) + '.unr'
  if (isElectron()) {
    try {
      const res = await native().saveBinary({
        suggestedName: safeName,
        data: bytes,
        title: '导出目标',
        filters: [{ name: 'Unyra Goal Package (*.unr)', extensions: ['unr'] }],
      })
      return res
    } catch (err) {
      console.warn('[unr] native.saveBinary error, falling back to download:', err)
    }
  }

  // Web 或回退环境
  try {
    const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = safeName
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : '下载失败' }
  }
}

/** 调起原生文件选择器挑选 .unr 文件 */
export function pickUnrFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.unr'
    input.style.display = 'none'
    document.body.appendChild(input)

    let resolved = false
    const finish = (file: File | null) => {
      if (resolved) return
      resolved = true
      input.remove()
      resolve(file)
    }

    input.onchange = () => {
      const file = input.files?.[0] ?? null
      finish(file)
    }
    input.oncancel = () => finish(null)

    window.addEventListener(
      'focus',
      () => {
        setTimeout(() => {
          if (!resolved && (!input.files || input.files.length === 0)) {
            finish(null)
          }
        }, 800)
      },
      { once: true },
    )

    input.click()
  })
}
