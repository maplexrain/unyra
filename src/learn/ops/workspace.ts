/**
 * workspace.*：节点的工作区目录。
 *
 * 「工作区」是磁盘上**真实存在**的系统目录（users/<uid>/docs/<目标>/<节点>/workspace/，
 * 随节点目录走；布局见 learn/workspace）：用户在资源管理器里看得见、自己也能放文件；
 * 导师从这里拿真实的资料、把「拿得走的文件」交回给用户。路径写法与文档 api 同构——
 * 节点路径在前、文件在后（`极限/数据/实验.csv`），省略 path 就是当前节点。
 *
 * 只收文本：工作区面向的是笔记、数据、代码这类模型读得动写得出的东西；
 * 二进制文件读不出文本时如实说，不去猜内容。
 */

import type { KnowledgeNode } from '../types'
import { nodeById, normalizeKey, prereqIds } from '../graph'
import { nodePathOf } from '../paths'
import { WORKSPACE_DIR } from '../layout'
import { wsJoin, wsRelOf } from '../workspace'
import type { AgentOpsDeps, WorkspaceIo } from './deps'

/** 一次 read 最多回多少字：再多就该拆文件，或让用户自己在系统里打开 */
const READ_LIMIT = 40_000
/** 一次 write 最多收多少字：几十万字的「文件」多半是编排失控，不是真需求 */
const WRITE_LIMIT = 200_000

/** 指代「当前节点」的写法，与 paths.ts 的文档路径同一套（那边不导出，这里各认各的） */
const CURRENT_ALIASES = new Set(['当前', '当前节点', '本节点', 'this', 'current', '.', '@'])

export function createWorkspaceOps(deps: AgentOpsDeps, io: WorkspaceIo) {
  const store0 = () => deps.getLatest()

  const currentOf = (): KnowledgeNode | undefined => {
    const id = deps.nodeId()
    return id ? nodeById(store0(), id) : undefined
  }

  /**
   * path → 节点 + 文件部分。
   *
   * 节点链**严格**按标题往下走（与文档路径的「最后一段兜底」不同）：工作区里
   * 文件与节点同名的情形太自然了（目录名就是标题），兜底会把文件误认成节点。
   * 走到第一个对不上的段就停，剩下的全部当文件路径——目录嵌套是真实的，
   * 「节点段」与「文件段」的边界就是这样一条。
   */
  const resolveWs = (raw: unknown): { node: KnowledgeNode; rest: string[] } | { error: string } => {
    const segments = String(raw ?? '')
      .split('/')
      .map((s) => s.trim())
      .filter(Boolean)
    if (!segments.length) {
      const cur = currentOf()
      if (!cur) return { error: '没有指定路径，此刻也没有打开的节点；写明路径（如 极限/要点.md）或先 api.node.list()' }
      return { node: cur, rest: [] }
    }
    let cursor: KnowledgeNode
    let i = 0
    const first = segments[0]
    if (first.startsWith('#')) {
      const found = store0().nodes.find((n) => n.id === first.slice(1).trim())
      if (!found) return { error: '「' + first + '」没有对上任何节点 id（id 在 api.node.list 里）' }
      cursor = found
      i = 1
    } else if (CURRENT_ALIASES.has(first.toLowerCase())) {
      const cur = currentOf()
      if (!cur) return { error: '「当前节点」此刻不存在；写明路径或先打开一个节点' }
      cursor = cur
      i = 1
    } else {
      const goal = store0().goals.find((g) => g.id === deps.goalId())
      const root = goal ? nodeById(store0(), goal.rootNodeId) : undefined
      if (!root) return { error: '这个目标没有根节点' }
      // 第一段若就是目标根自己的标题，当作从这里出发的写法吃掉（「微积分/极限/数据.csv」才走得通）
      if (normalizeKey(first) === root.key || first === root.id) {
        cursor = root
        i = 1
      } else {
        // 头一段对不上目标根的任何子节点：它不是节点链，整条路径当文件路径、
        // 锚在**当前节点**的工作区上——光标开着「极限」时写「数据/实验.csv」，
        // 落的应该是极限的工作区，而不是目标根的。没开着节点就没得锚，把出路说清楚。
        const child = prereqIds(store0(), root.id)
          .map((id) => nodeById(store0(), id))
          .find(
            (n): n is KnowledgeNode =>
              !!n && n.goalId === root.goalId && (n.key === normalizeKey(first) || n.id === first),
          )
        if (child) {
          cursor = child
          i = 1
        } else {
          const cur = currentOf()
          if (!cur) {
            return {
              error:
                '路径「' +
                segments.join('/') +
                '」的开头不是节点，此刻也没有打开的节点；写明节点路径（如 极限/要点.md）或先打开一个节点',
            }
          }
          cursor = cur
        }
      }
    }
    for (; i < segments.length; i++) {
      const seg = segments[i]
      const child = prereqIds(store0(), cursor.id)
        .map((id) => nodeById(store0(), id))
        .find(
          (n): n is KnowledgeNode =>
            !!n && n.goalId === cursor.goalId && (n.key === normalizeKey(seg) || n.id === seg),
        )
      if (!child) break
      cursor = child
    }
    const rest = segments.slice(i)
    // 「节点/workspace/文件」的写法同样认（与 ws 引用 chip 的口径一致，见 learn/chipRef）：
    // workspace 这一段与节点工作区目录本身重复，吃掉一段；真在里面又套了一层 workspace 的，
    // 写两层照样到——只吃第一段
    if (rest[0] === WORKSPACE_DIR) rest.shift()
    return { node: cursor, rest }
  }

  /** 节点路径 + 文件部分拼成给人看的回执路径（微积分/极限/数据/实验.csv） */
  const labelOf = (node: KnowledgeNode, rest: readonly string[]): string =>
    [nodePathOf(store0(), deps.goalId(), node.id), ...rest].join('/')

  /** 节点 + 文件部分 → 磁盘相对路径；节点没进目标目录与段不合法各自给人话错误 */
  const relOf = (node: KnowledgeNode, rest: readonly string[]): { rel: string } | { error: string } => {
    const base = wsRelOf(store0(), node.id)
    if (!base) return { error: '这个节点还没有归属的目标目录（先把它挂进某个目标）' }
    if (!rest.length) return { rel: base }
    const rel = wsJoin(base, rest)
    return rel ? { rel } : { error: '路径段不合法：不能有空段、「.」「..」或反斜杠' }
  }

  return {
    async list(path?: unknown) {
      const r = resolveWs(path)
      if ('error' in r) return r
      const loc = relOf(r.node, r.rest)
      if ('error' in loc) return loc
      const res = await io.list(loc.rel)
      if (!res.ok) return { error: res.error }
      const entries = [...res.entries]
        .sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name, 'zh') : a.dir ? -1 : 1))
        .map((e) => ({ name: e.name, kind: e.dir ? 'dir' : 'file' }))
      return {
        node: labelOf(r.node, []),
        // rel 是相对当前用户的磁盘路径：写 ws 引用 chip（#[{type:"ws", path:…}]）时原样抄它，
        // 手拼的「节点路径 + 文件段」点击时定位不到（见 learn/chipRef 的两种写法说明）
        rel: loc.rel,
        dir: r.rest.join('/'),
        entries,
        ...(entries.length ? {} : { note: '（还没有文件——workspace.write 写下第一个，或让用户把文件放进来）' }),
      }
    },

    async read(path?: unknown) {
      const r = resolveWs(path)
      if ('error' in r) return r
      if (!r.rest.length) {
        return { error: '要读的是文件：路径最后要落到文件名上（如 极限/要点.md）；先用 workspace.list 看看有什么' }
      }
      const loc = relOf(r.node, r.rest)
      if ('error' in loc) return loc
      const res = await io.read(loc.rel)
      if (!res.ok) return { error: res.error }
      if (res.content === null) {
        // 文件不存在；但那个路径若是真实目录（列得到东西），把话说准
        const listed = await io.list(loc.rel)
        if (listed.ok && listed.entries.length) {
          return { error: '「' + labelOf(r.node, r.rest) + '」是目录，read 读不了；workspace.list 看看里面有什么' }
        }
        return { error: '没有这个文件「' + labelOf(r.node, r.rest) + '」。先用 workspace.list 看看目录里有什么' }
      }
      if (res.content.includes('\0')) {
        return { error: '「' + labelOf(r.node, r.rest) + '」读不出文本（多半是二进制文件）' }
      }
      if (res.content.length > READ_LIMIT) {
        return {
          path: labelOf(r.node, r.rest),
          rel: loc.rel,
          truncated: true,
          totalChars: res.content.length,
          content: res.content.slice(0, READ_LIMIT),
          note: '太长只给了前 ' + READ_LIMIT + ' 字；要分段就读就拆成小文件，或让用户在系统里打开',
        }
      }
      return { path: labelOf(r.node, r.rest), rel: loc.rel, chars: res.content.length, content: res.content }
    },

    async write(input: Record<string, unknown>) {
      const rawPath = typeof input.path === 'string' ? input.path : ''
      const content = typeof input.content === 'string' ? input.content : null
      if (!rawPath.trim()) return { error: 'write 需要一个 path（节点路径 + 文件名，如 极限/要点.md）' }
      if (content === null) return { error: 'write 需要 content（要写的文本；建空文件就给空串）' }
      if (content.length > WRITE_LIMIT) {
        return { error: 'content 太长（' + content.length + ' 字，上限 ' + WRITE_LIMIT + '）：拆成几个文件再写' }
      }
      const r = resolveWs(rawPath)
      if ('error' in r) return r
      if (!r.rest.length) {
        return {
          error: '路径最后要落到文件名上（如 极限/要点.md）——「' + labelOf(r.node, []) + '」是目录；先 workspace.list 看看',
        }
      }
      const loc = relOf(r.node, r.rest)
      if ('error' in loc) return loc
      const before = await io.read(loc.rel)
      const existed = before.ok && before.content !== null
      const res = await io.write(loc.rel, content)
      if (!res.ok) return { error: res.error ?? '写入失败' }
      return {
        path: labelOf(r.node, r.rest),
        rel: loc.rel,
        chars: content.length,
        ...(existed ? { updated: true, note: '整份覆盖了已有文件' } : { created: true }),
      }
    },
  }
}
