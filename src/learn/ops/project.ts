/**
 * 项目路径读写操作（project.*，见 agent/sandbox/types 的 ProjectOps）：
 * 对**已声明**的 project 节点的真实路径及其子树做文件操作。
 *
 * 授权口径（声明即授权）：每次操作现取 store，把目标节点此刻解析出的根作为
 * 唯一授权根随调用传给主进程（electron/base/projectFiles）——节点删了、路径改了，
 * 下一拍就是新边界。这里不缓存任何解析结果。
 *
 * 寻址：uuid + subPath。subPath 相对该项目的根、'/' 分隔、空串 = 根；越出根的
 * 子路径由主进程 resolve 后拒绝（这里不预判，主进程的拒绝文案带着解析后的绝对路径）。
 */
import type { ProjectFsOp, ProjectFsRequest, ProjectFsResult } from '../../../shared/ipc'
import type { ProjectOps } from '../../agent/sandbox/types'
import type { AgentOpsDeps } from './deps'
import { projectNodeById, resolveProjectRoot } from '../projects'
import type { LearnStore, ProjectNodeEntity } from '../types'

/** project:fs 的桥（由界面层注入；见 learn/agent/sandboxOps——Node 裸跑时换成假实现） */
export interface ProjectIo {
  send: (req: ProjectFsRequest) => Promise<ProjectFsResult>
}

/** uuid → 该项目此刻的授权根（解析失败给一句人话） */
function rootOf(
  store: LearnStore,
  uuid: string,
): { entity: ProjectNodeEntity; root: string } | { error: string } {
  const entity = projectNodeById(store, (uuid ?? '').trim())
  if (!entity) {
    return { error: '没有这个项目节点（' + uuid + '）：api.node.list() 的 projects 段里有当前目标的全部项目' }
  }
  const root = resolveProjectRoot(store, entity)
  if (!root) {
    return {
      error:
        '项目「' + entity.title + '」的路径解析不出来（相对路径越出了用户目录，或数据根未就绪）：' +
        '先 api.node.get(它).content 看声明，或让用户修一下路径',
    }
  }
  return { entity, root }
}

/** 拼绝对路径：subPath 归一成交给主进程的形态（'/' 分隔，空串 = 根本身） */
function joinPath(root: string, subPath: string): string {
  const clean = (subPath ?? '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '')
  return root.replace(/[\\/]+$/, '') + (clean ? '/' + clean : '')
}

export function createProjectOps(deps: Pick<AgentOpsDeps, 'getLatest' | 'goalId'>, io: ProjectIo): ProjectOps {
  /** 一次 project:fs 调用；roots 由各方法填好再进来 */
  const run = (req: ProjectFsRequest): Promise<ProjectFsResult> => io.send(req)

  /** 失败回执的统一出口：成功形状对不上号时也翻成一句失败（不该发生，兜住） */
  const errOf = (r: ProjectFsResult): { ok: false; error: string } =>
    r.ok ? { ok: false, error: '回执形状与操作对不上（' + r.op + '）' } : { ok: false, error: r.error }

  return {
    list: async () => {
      const store = deps.getLatest()
      const goalId = deps.goalId()
      return (store.projects ?? [])
        .filter((p) => p.goalId === goalId)
        .map((p) => ({
          uuid: p.id,
          title: p.title,
          path: p.path,
          pathKind: p.pathKind,
          resolved: resolveProjectRoot(store, p),
        }))
    },

    tree: async (uuid, subPath) => {
      const found = rootOf(deps.getLatest(), uuid)
      if ('error' in found) return { ok: false, error: found.error }
      const req: ProjectFsOp & { roots: string[] } = { op: 'list', path: joinPath(found.root, subPath ?? ''), roots: [found.root] }
      const r = await run(req)
      return r.ok && r.op === 'list' ? { ok: true, path: r.path, entries: r.entries } : errOf(r)
    },

    read: async (uuid, subPath, opts) => {
      const found = rootOf(deps.getLatest(), uuid)
      if ('error' in found) return { ok: false, error: found.error }
      const r = await run({ op: 'read', path: joinPath(found.root, subPath), roots: [found.root], ...(opts ?? {}) })
      return r.ok && r.op === 'read'
        ? { ok: true, content: r.content, encoding: r.encoding, size: r.size, ...(r.totalChars !== undefined ? { totalChars: r.totalChars } : {}) }
        : errOf(r)
    },

    write: async (uuid, subPath, content, opts) => {
      const found = rootOf(deps.getLatest(), uuid)
      if ('error' in found) return { ok: false, error: found.error }
      const r = await run({ op: 'write', path: joinPath(found.root, subPath), content, roots: [found.root], ...(opts ?? {}) })
      return r.ok && r.op === 'write' ? { ok: true, path: r.path, bytesWritten: r.bytesWritten } : errOf(r)
    },

    edit: async (uuid, subPath, edit) => {
      const found = rootOf(deps.getLatest(), uuid)
      if ('error' in found) return { ok: false, error: found.error }
      const r = await run({ op: 'edit', path: joinPath(found.root, subPath), edit, roots: [found.root] })
      return r.ok && r.op === 'edit' ? { ok: true, path: r.path, modified: r.modified } : errOf(r)
    },

    mkdir: async (uuid, subPath) => {
      const found = rootOf(deps.getLatest(), uuid)
      if ('error' in found) return { ok: false, error: found.error }
      const r = await run({ op: 'mkdir', path: joinPath(found.root, subPath), roots: [found.root] })
      return r.ok ? { ok: true } : errOf(r)
    },

    move: async (uuid, subPath, toSubPath) => {
      const found = rootOf(deps.getLatest(), uuid)
      if ('error' in found) return { ok: false, error: found.error }
      const r = await run({ op: 'move', path: joinPath(found.root, subPath), to: joinPath(found.root, toSubPath), roots: [found.root] })
      return r.ok ? { ok: true } : errOf(r)
    },

    copy: async (uuid, subPath, toSubPath, opts) => {
      const found = rootOf(deps.getLatest(), uuid)
      if ('error' in found) return { ok: false, error: found.error }
      const r = await run({ op: 'copy', path: joinPath(found.root, subPath), to: joinPath(found.root, toSubPath), roots: [found.root], ...(opts ?? {}) })
      return r.ok ? { ok: true } : errOf(r)
    },

    delete: async (uuid, subPath) => {
      const found = rootOf(deps.getLatest(), uuid)
      if ('error' in found) return { ok: false, error: found.error }
      const r = await run({ op: 'delete', path: joinPath(found.root, subPath), roots: [found.root] })
      return r.ok ? { ok: true } : errOf(r)
    },
  }
}
