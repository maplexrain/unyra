/**
 * 项目节点：声明一条**真实文件系统路径**的引用（见 learn/projects 与 types 的
 * ProjectNodeEntity）。
 *
 * 它不是知识结构，是一条授权声明：路径（相对目标根目录 / 电脑绝对路径两种拼法）
 * 在拓扑图上声明之后，这条路径及其下的整棵子树就对 agent 敞开——读写走 api.project.*，
 * 权限边界 = 「已声明的 project 根」。画布上它是一张可按层级展开项目目录的卡。
 *
 * 可以挂在某份文档之下（树边 from 文档 to 本节点，与挂件同一款画法），也可以
 * 不挂任何东西（游离实体）——授权只看实体在不在，与挂载无关。
 */
import { addEdge, removeEdge } from '../graph'
import { inferPathKind, projectNodeById, resolveProjectRoot, updateProjectNode } from '../projects'
import { GNode, type ConnectFilter, type NodeHelp, type NodeRelation, type NodeResult } from './base'

export class ProjectGNode extends GNode {
  constructor(ctx: ConstructorParameters<typeof GNode>[0], uuid: string) {
    super(ctx, uuid)
  }

  get kind(): 'project' {
    return 'project'
  }

  protected get kindLabel(): string {
    return '项目'
  }

  /** 身后的实体记录（projects 表里的一行） */
  private get entity() {
    return projectNodeById(this.ctx.store(), this.uuid)
  }

  get title(): string {
    const e = this.entity
    if (!e) return '项目 · 已不在'
    return e.title + ' · 项目'
  }

  exists(): boolean {
    return !!this.entity
  }

  get relations(): NodeRelation[] {
    const s = this.ctx.store()
    const out: NodeRelation[] = []
    for (const e of s.edges) {
      if (e.to === this.uuid) {
        // 上游是挂载它的文档（树边 from 文档 to 本节点）
        out.push({ id: e.from, type: 'up' })
      } else if (e.from === this.uuid) {
        out.push({ id: e.to, type: 'down' })
      }
    }
    return out
  }

  get content(): unknown {
    const e = this.entity
    if (!e) return null
    const root = resolveProjectRoot(this.ctx.store(), e)
    return {
      title: e.title,
      path: e.path,
      pathKind: e.pathKind,
      resolved: root,
      note: root
        ? null
        : e.path
          ? '路径解析失败：数据根未就绪，或相对路径越出了用户目录'
          : '还没有设置路径',
    }
  }

  /**
   * 内容形状：{ path, title? }。path 必给；拼法**由路径自己说话**（盘符 / `/` 开头 =
   * 绝对，否则相对目标根目录），调用方不用也不必给 pathKind。路径解析成不成就不拦
   * ——解析失败卡上会明说，用户自己修。
   */
  editContent(next: unknown): NodeResult {
    const e = this.entity
    if (!e) return { error: '这个项目节点已经不在了' }
    let p = next
    if (typeof next === 'string') {
      try {
        p = JSON.parse(next)
      } catch {
        return { error: '项目节点的内容是 { path, title? } 对象（传字符串时必须是合法 JSON）' }
      }
    }
    if (!p || typeof p !== 'object' || Array.isArray(p)) {
      return { error: '项目节点的内容是 { path, title? } 对象' }
    }
    const input = p as Record<string, unknown>
    if (!('path' in input)) {
      return { error: '项目节点必给 path（声明哪条真实路径）：盘符或 / 开头按绝对路径算，其余相对目标根目录' }
    }
    const path = typeof input.path === 'string' ? input.path.trim() : ''
    if (!path) return { error: 'path 不能是空串：不要这枚节点了就走 api.node.delete' }
    const title = typeof input.title === 'string' ? input.title : undefined
    const r = updateProjectNode(this.ctx.store(), this.uuid, { path, pathKind: inferPathKind(path), ...(title !== undefined ? { title } : {}) }, Date.now())
    if (!r) return { error: '这个项目节点已经不在了' }
    this.ctx.commit(r.store)
    const root = resolveProjectRoot(r.store, r.entity)
    return {
      ok: true,
      note: root
        ? '已声明项目路径「' + path + '」（' + r.entity.pathKind + '）：这条路径及其下所有文件已对 agent 敞开（api.project.*）'
        : '已保存路径「' + path + '」，但此刻解析不出绝对路径（数据根未就绪或相对路径越出了用户目录）：修好前 agent 用不了它',
    }
  }

  help(): NodeHelp {
    const e = this.entity
    const root = e ? resolveProjectRoot(this.ctx.store(), e) : null
    return {
      description:
        '项目节点——一条真实文件系统路径的授权声明。' +
        (e?.path
          ? '当前声明「' + e.path + '」（' + e.pathKind + '）' + (root ? '，已解析到 ' + root + '。' : '，此刻解析不出（数据根未就绪或越出用户目录）。')
          : '还没有设置路径。') +
        '声明之后这条路径及其下所有文件对 agent 完全开放（api.project.* 读写），边界就是已声明的那些 project 根。',
      edit:
        '内容形状：{ path, pathKind?, title? }。path 必给；pathKind = "relative"（相对目标根目录 docs/{目标段}/，默认）或 ' +
        '"absolute"（电脑上的绝对路径）。读写文件不用 editContent——用 api.project 组：' +
        'list() 拿 uuid 与解析后的根，tree(uuid) 看目录层级，read / write / edit / mkdir / move / copy / delete(uuid, subPath, …) 动文件。',
      connection:
        '可挂在文档之下（树边 from 文档 to 我）：api.node.create({ kind: "project", under: 文档uuid, path, pathKind }) 创建即挂，' +
        '或不带 under 建游离实体之后再拖线 / connect(我, "up")。我不能有下游（它是叶子引用）；disconnect 摘掉挂载，声明本身不受影响。',
    }
  }

  onDownstream(_node: GNode): ConnectFilter {
    return '项目节点是叶子引用，下游不能挂东西（要组织文件就建文档或大纲）'
  }

  onUpstream(node: GNode): ConnectFilter {
    if (node.kind === 'doc') return true
    if (node.kind === 'video') return '项目节点挂在文档之下，不挂视频节点'
    return '项目节点的上游只能是文档（声明路径的归属），不挂大纲或其它类型'
  }

  protected link(up: GNode): NodeResult {
    // 我是下游；从本项目侧发起 connect(up, "up") 时由这里落库
    // （从文档侧发起 connect(我, "down") 时走 DocGNode.link 的分派）
    const s = this.ctx.store()
    if (!this.entity) return { error: '这个项目节点已经不在了' }
    if (up.kind !== 'doc') return { error: '项目节点只能挂在文档之下' }
    const r = addEdge(s, up.uuid, this.uuid)
    if (!r.added) return { error: r.reason ?? '挂载失败' }
    this.ctx.commit(r.store)
    return { ok: true, note: '已把项目「' + this.entity.title + '」挂到「' + up.title + '」之下' }
  }

  protected unlink(target: GNode): NodeResult {
    const s = this.ctx.store()
    // 挂载边是上游文档那一方建的（from 文档 to 我）；两条路（项目侧 disconnect / 文档侧
    // disconnect）都要能摘，这里认「我作为 to」的边
    const upEdge = s.edges.find((e) => e.to === this.uuid && e.from === target.uuid)
    if (upEdge) {
      this.ctx.commit(removeEdge(s, upEdge.from, upEdge.to))
      return { ok: true, note: '已把项目「' + (this.entity?.title ?? '') + '」从「' + target.title + '」之下摘出来（授权不受影响）' }
    }
    return { error: '项目节点没有可摘的下游连接' }
  }
}
