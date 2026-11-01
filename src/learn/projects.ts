/**
 * 项目节点的数据层：目标 × 真实路径的声明表（store.projects，见 types 的 ProjectNodeEntity）。
 *
 * 谁是事实源：store.projects。声明即授权——agent 对某条路径及其子树的读写权限
 * 只看「这条路径此刻是不是某个 project 实体解析出来的根」（见 resolveProjectRoot 与
 * learn/ops/project 的收口；主进程 electron/base/projectFiles 再按每次调用随行的
 * roots 白名单验第二道）。节点挂不挂树、挂在谁下面都改变不了授权——授权跟着实体走。
 *
 * 与视频节点（learn/video/nodes）同一款宿命：不进大纲树的独立实体池，挂载靠树边
 * （from 文档 to 本节点），删除时顺手摘掉两端的边。
 */
import { sanitizeSegment } from './segments'
import type { LearnStore, ProjectNodeEntity, ProjectPathKind } from './types'
import { storageAbsPath, storageRoot, userPath } from '../lib/storage'

/**
 * 从**输入的路径本身**推断拼法——用户不再显式选「相对 / 绝对」，给什么算什么：
 * 盘符（`X:\` / `X:/`）、UNC（`\\server\share`）、以 `/` 开头（POSIX 绝对）= 绝对；
 * 其余 = 相对目标根目录。
 */
export function inferPathKind(raw: string): ProjectPathKind {
  const p = (raw ?? '').trim()
  if (/^[a-zA-Z]:[\\/]/.test(p)) return 'absolute'
  if (/^\\\\/.test(p)) return 'absolute'
  if (p.startsWith('/')) return 'absolute'
  return 'relative'
}

/** 目录树里的一条目（画布展开目录树用；name 是磁盘上的原名） */
export interface ProjectDirEntry {
  name: string
  isDirectory: boolean
}

/**
 * 目录清单的显示顺序：**目录在前、文件在后**，各自按名字排序（localeCompare 带
 * 数字感知——`v2` 排在 `v10` 前面，中文按拼音）。排序只影响显示，不动磁盘。
 */
export function sortProjectEntries(entries: readonly ProjectDirEntry[]): ProjectDirEntry[] {
  return [...entries].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    return a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true })
  })
}

/** 取一枚项目节点；不在了返回 undefined */
export function projectNodeById(store: LearnStore, id: string): ProjectNodeEntity | undefined {
  return (store.projects ?? []).find((p) => p.id === id)
}

/** 某个目标名下的全部项目节点（清单、画布派生、授权收口共用） */
export function projectsOf(store: LearnStore, goalId: string): ProjectNodeEntity[] {
  return (store.projects ?? []).filter((p) => p.goalId === goalId)
}

/** 建一枚项目节点（画布 palette 落地与 agent 建节点走这里）；path 空串 = 未设置 */
export function createProjectNode(
  store: LearnStore,
  goalId: string,
  input: { title?: string; path?: string; pathKind?: ProjectPathKind },
  at: number,
): { store: LearnStore; entity: ProjectNodeEntity } {
  const entity: ProjectNodeEntity = {
    id: crypto.randomUUID(),
    goalId,
    title: (input.title ?? '').trim() || '项目',
    path: (input.path ?? '').trim(),
    pathKind: input.pathKind === 'absolute' ? 'absolute' : 'relative',
    createdAt: at,
    updatedAt: at,
  }
  return { store: { ...store, projects: [...(store.projects ?? []), entity] }, entity }
}

/** 改一枚项目节点的标题 / 路径 / 拼法（给了的字段才动）；不在了返回 null */
export function updateProjectNode(
  store: LearnStore,
  id: string,
  patch: { title?: string; path?: string; pathKind?: ProjectPathKind },
  at: number,
): { store: LearnStore; entity: ProjectNodeEntity } | null {
  const entity = projectNodeById(store, id)
  if (!entity) return null
  const next: ProjectNodeEntity = {
    ...entity,
    ...(patch.title !== undefined ? { title: patch.title.trim() || entity.title } : {}),
    ...(patch.path !== undefined ? { path: patch.path.trim() } : {}),
    ...(patch.pathKind !== undefined ? { pathKind: patch.pathKind } : {}),
    updatedAt: at,
  }
  return { store: { ...store, projects: (store.projects ?? []).map((p) => (p.id === id ? next : p)) }, entity: next }
}

/** 删掉一枚项目节点（摘掉它两端的树边；声明的路径与磁盘上的文件都原样不动） */
export function deleteProjectNode(store: LearnStore, id: string): LearnStore | null {
  if (!projectNodeById(store, id)) return null
  const edges = store.edges.filter((e) => e.from !== id && e.to !== id)
  return { ...store, edges, projects: (store.projects ?? []).filter((p) => p.id !== id) }
}

/**
 * 读盘归一：只认「id 唯一 + 目标还在」的条目；path 非字符串的落回空串（未设置态，
 * 卡上会显示「设置路径」）。坏数据逐条丢，不拖垮整库。
 */
export function normalizeProjects(raw: unknown, goalIds: ReadonlySet<string>): ProjectNodeEntity[] {
  if (!Array.isArray(raw)) return []
  const out: ProjectNodeEntity[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const id = typeof o.id === 'string' ? o.id.trim() : ''
    const goalId = typeof o.goalId === 'string' ? o.goalId : ''
    if (!id || !goalId || seen.has(id) || !goalIds.has(goalId)) continue
    seen.add(id)
    out.push({
      id,
      goalId,
      title: typeof o.title === 'string' && o.title.trim() ? o.title.trim() : '项目',
      path: typeof o.path === 'string' ? o.path.trim() : '',
      pathKind: o.pathKind === 'absolute' ? 'absolute' : 'relative',
      createdAt: typeof o.createdAt === 'number' && Number.isFinite(o.createdAt) ? o.createdAt : Date.now(),
      updatedAt: typeof o.updatedAt === 'number' && Number.isFinite(o.updatedAt) ? o.updatedAt : Date.now(),
    })
  }
  return out
}

/* ---------- 路径解析 ---------- */

/**
 * 目标根目录在**用户目录内**的相对段（docs/{目标段}）。
 *
 * 目标目录名不是 goal.id，而是根文档标题的净化段——与写盘（learn/files/build）和
 * 资源管理器（learn/layout）同一套口径，三处必须一致：改任何一处的推导都要三处对齐。
 */
export function goalDirSeg(store: LearnStore, goalId: string): string | null {
  const goal = store.goals.find((g) => g.id === goalId)
  if (!goal) return null
  const root = goal.rootNodeId ? store.nodes.find((n) => n.id === goal.rootNodeId) : undefined
  return sanitizeSegment(root?.title || goal.title || goal.question || '未命名目标')
}

/**
 * 一条相对用户目录的 rel 归一成干净段列表：去掉空段与「.」，「..」弹一层。
 * 弹过用户根（弹空了）等于跑出用户域，拒绝——声明的根至少要在自己的数据目录里。
 */
function normalizeRelSegs(rel: string): string[] | null {
  const out: string[] = []
  for (const seg of rel.replace(/\\/g, '/').split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') {
      if (!out.length) return null
      out.pop()
      continue
    }
    out.push(seg)
  }
  return out.length ? out : null
}

/**
 * project 实体的路径 → 磁盘绝对路径（解析失败/数据根未就绪返回 null）。
 *
 * relative：目标根目录（docs/{目标段}）拼上声明的相对路径；「..」允许弹过目标段
 * （用户声明什么就是什么），但整体不许跑出用户目录。absolute：原样交给主进程
 * resolve（分隔符的归一在主进程做，渲染层只做「能不能解析」的判断）。
 */
export function resolveProjectRoot(store: LearnStore, entity: ProjectNodeEntity): string | null {
  const raw = entity.path.trim()
  if (!raw) return null
  if (entity.pathKind === 'absolute') {
    // 绝对路径原样交出去：分隔符与「../」的归一由主进程 path.resolve 统一做，
    // 随后照样要过「落在本节点声明的根之内」这道闸——绝对路径同样是授权根自己。
    return raw
  }
  const seg = goalDirSeg(store, entity.goalId)
  if (!seg) return null
  const rel = normalizeRelSegs(`docs/${seg}/${raw}`)
  if (!rel) return null
  const withUser = userPath(rel.join('/'))
  if (!withUser) return null
  return storageAbsPath(withUser)
}

/**
 * 一个目标名下全部已解析的 project 根（agent ops 的授权清单；解析失败的跳过）。
 * 每次调用现取 store——节点删了、路径改了，下一次调用立刻是新边界。
 */
export function projectRootsOf(store: LearnStore, goalId: string): Array<{ id: string; title: string; root: string }> {
  const out: Array<{ id: string; title: string; root: string }> = []
  for (const p of projectsOf(store, goalId)) {
    const root = resolveProjectRoot(store, p)
    if (root) out.push({ id: p.id, title: p.title, root })
  }
  return out
}

/** 数据根就绪了吗（relative 解析依赖它；未就绪时界面上路径显示为「待解析」） */
export function storageReady(): boolean {
  return !!storageRoot()
}
