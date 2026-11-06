/**
 * 文件节点：绑定一个本地文件或网页文件（见 learn/fileNodes 与 types 的 FileNodeEntity）。
 *
 * 规范与约束：
 * 1. 分为本地文件 (local) 和网页文件 (web)。
 * 2. 绑定一个 URL：
 *    - 本地文件：只能引用存储在 docs/{目标}/files/ 中的文件。
 *    - 网页文件：没有限制，可以是一个网址。
 * 3. 上级连接节点限制：只能是文档节点 (doc)、笔记节点 (note)、超级文档节点 (superdoc)、考试节点 (exam)。
 * 4. 下级连接节点限制：只能是大纲节点 (outline)、文档节点 (doc)、笔记节点 (note)、超级文档节点 (superdoc)、考试节点 (exam)。
 * 5. 一个文件节点只能绑定一个文件或网页。
 */

import { addEdge, removeEdge } from '../graph'
import { fileNodeById, updateFileNode } from '../fileNodes'
import { GNode, type ConnectFilter, type NodeHelp, type NodeRelation, type NodeResult } from './base'

export class FileGNode extends GNode {
  constructor(ctx: ConstructorParameters<typeof GNode>[0], uuid: string) {
    super(ctx, uuid)
  }

  get kind(): 'file' {
    return 'file'
  }

  protected get kindLabel(): string {
    return '文件'
  }

  private get entity() {
    return fileNodeById(this.ctx.store(), this.uuid)
  }

  get title(): string {
    const e = this.entity
    if (!e) return '文件 · 已不在'
    return e.title
  }

  exists(): boolean {
    return !!this.entity
  }

  get relations(): NodeRelation[] {
    const s = this.ctx.store()
    const out: NodeRelation[] = []
    for (const e of s.edges) {
      if (e.to === this.uuid) {
        out.push({ id: e.from, type: 'up' })
      } else if (e.from === this.uuid) {
        out.push({ id: e.to, type: 'down', ...(e.portKey ? { portKey: e.portKey } : {}) })
      }
    }
    return out
  }

  get content(): unknown {
    const e = this.entity
    if (!e) return null
    return {
      title: e.title,
      fileKind: e.fileKind,
      url: e.url,
      domFilter: e.domFilter,
      pureMode: e.pureMode ?? true,
      cachedContent: e.cachedContent,
      cachedAt: e.cachedAt,
    }
  }

  editContent(next: unknown): NodeResult {
    const e = this.entity
    if (!e) return { error: '这个文件节点已经不在了' }
    let p = next
    if (typeof next === 'string') {
      try {
        p = JSON.parse(next)
      } catch {
        return { error: '文件节点的内容是 { title?, fileKind?, url?, domFilter?, pureMode? } 对象' }
      }
    }
    if (!p || typeof p !== 'object' || Array.isArray(p)) {
      return { error: '文件节点的内容是 { title?, fileKind?, url?, domFilter?, pureMode? } 对象' }
    }
    const input = p as Record<string, unknown>
    const patch: Parameters<typeof updateFileNode>[2] = {}
    if (typeof input.title === 'string') patch.title = input.title
    if (input.fileKind === 'local' || input.fileKind === 'web') patch.fileKind = input.fileKind
    if (typeof input.url === 'string') patch.url = input.url
    if (typeof input.domFilter === 'string') patch.domFilter = input.domFilter
    if (typeof input.pureMode === 'boolean') patch.pureMode = input.pureMode
    if (typeof input.cachedContent === 'string') patch.cachedContent = input.cachedContent
    if (typeof input.cachedAt === 'number') patch.cachedAt = input.cachedAt
    if (typeof input.titleCustomized === 'boolean') patch.titleCustomized = input.titleCustomized

    const r = updateFileNode(this.ctx.store(), this.uuid, patch, Date.now())
    if ('error' in r) return { error: r.error }
    this.ctx.commit(r.store)
    return { ok: true, note: '已更新文件节点「' + r.entity.title + '」' }
  }

  help(): NodeHelp {
    const e = this.entity
    return {
      description:
        '文件节点——绑定本地文件或网页文件。' +
        (e?.url ? `当前绑定：${e.fileKind === 'local' ? '本地文件 ' : '网页 '}「${e.url}」。` : '尚未绑定文件或网页。'),
      edit:
        '内容形状：{ title?, fileKind?: "local" | "web", url? }。' +
        '本地文件必须存放在 docs/{目标}/files/ 目录下；网页文件为一个有效网址。' +
        '一个文件节点只能绑定一个文件或网页。',
      connection:
        '上级可以是：文档节点、笔记节点、超级文档节点、考试节点；' +
        '下级可以是：大纲节点、文档节点、笔记节点、超级文档节点、考试节点。',
    }
  }

  onUpstream(node: GNode): ConnectFilter {
    if (node.kind === 'doc' || node.kind === 'note' || node.kind === 'superdoc' || node.kind === 'exam') {
      return true
    }
    return '文件节点的上级只能是文档节点、笔记节点、超级文档节点或考试节点'
  }

  onDownstream(node: GNode): ConnectFilter {
    if (['outline', 'doc', 'note', 'superdoc', 'exam'].includes(node.kind)) {
      if (node.kind === 'note') {
        const upRelations = node.relations.filter((r) => r.type === 'up')
        if (upRelations.length > 0 && !upRelations.some((r) => r.id === this.uuid)) {
          return '笔记只能有一个上级节点'
        }
      }
      return true
    }
    return '文件节点的下级只能是大纲节点、文档节点、笔记节点、超级文档节点或考试节点'
  }

  protected link(target: GNode, portKey?: string): NodeResult {
    const s = this.ctx.store()
    if (!this.entity) return { error: '这个文件节点已经不在了' }
    const r = addEdge(s, this.uuid, target.uuid, portKey)
    if (!r.added) return { error: r.reason ?? '连接失败' }
    this.ctx.commit(r.store)
    return { ok: true, note: '已把「' + target.title + '」作为下级连接到文件「' + this.title + '」' }
  }

  protected unlink(target: GNode): NodeResult {
    const s = this.ctx.store()
    const downEdge = s.edges.find((e) => e.from === this.uuid && e.to === target.uuid)
    if (downEdge) {
      this.ctx.commit(removeEdge(s, this.uuid, target.uuid))
      return { ok: true, note: '已断开与「' + target.title + '」的连接' }
    }
    const upEdge = s.edges.find((e) => e.from === target.uuid && e.to === this.uuid)
    if (upEdge) {
      this.ctx.commit(removeEdge(s, target.uuid, this.uuid))
      return { ok: true, note: '已断开与上级「' + target.title + '」的连接' }
    }
    return { error: '未找到与「' + target.title + '」的连接' }
  }
}
