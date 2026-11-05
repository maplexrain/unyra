/**
 * 超级文档节点：一整份可交互 HTML（讲义、演示、小工具）。叶子。
 *
 * uuid 是 SuperDocFile.id（持久 id；名字是显示与页签身份，不随 uuid 变）。
 * 实体要么在宿主文档的记录里（绑定），要么在游离池里（剪了线 / 还没绑过）——
 * 两种状态内容读写完全一样，绑定的只是那条关系线。
 * write 语义：整份覆盖、空内容拒绝、超长拒绝。
 */
import { detachSuperDoc } from '../detached'
import { addEdge, removeEdge } from '../graph'
import { SUPERDOC_MAX_CHARS, writeSuperDoc } from '../superdocs'
import { superDocsOf, type KnowledgeNode, type SuperDocFile } from '../types'
import { GNode, type ConnectFilter, type NodeCtx, type NodeHelp, type NodeRelation, type NodeResult } from './base'

export class SuperdocGNode extends GNode {
  constructor(ctx: NodeCtx, uuid: string) {
    super(ctx, uuid)
  }

  get kind(): 'superdoc' {
    return 'superdoc'
  }

  protected get kindLabel(): string {
    return '超级文档'
  }

  /** 实体在哪：绑定的回宿主，游离的回 null 宿主 */
  private locate(): { doc: SuperDocFile; node: KnowledgeNode | null; goalId: string } | null {
    const s = this.ctx.store()
    for (const node of s.nodes) {
      const doc = superDocsOf(node).find((d) => d.id === this.uuid)
      if (doc) return { doc, node, goalId: node.goalId }
    }
    for (const [goalId, pool] of Object.entries(s.detached ?? {})) {
      const doc = pool.superdocs.find((d) => d.id === this.uuid)
      if (doc) return { doc, node: null, goalId }
    }
    return null
  }

  get title(): string {
    return this.locate()?.doc.name ?? this.uuid
  }

  exists(): boolean {
    return !!this.locate()
  }

  get relations(): NodeRelation[] {
    const found = this.locate()
    const out: NodeRelation[] = []
    if (found?.node) {
      out.push({ id: found.node.id, type: 'up' })
    }
    for (const edge of this.ctx.store().edges) {
      if (edge.from === this.uuid) {
        out.push({ id: edge.to, type: 'down' })
      }
    }
    return out
  }

  get content(): unknown {
    const found = this.locate()
    if (!found) return { error: '这份超级文档已经不在了（可能刚被删除）' }
    return { title: found.doc.name, html: found.doc.html }
  }

  editContent(next: unknown): NodeResult {
    const found = this.locate()
    if (!found) return { error: '这份超级文档已经不在了（可能刚被删除）' }
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      return { error: '超级文档内容是 { html } 对象（一份完整的自包含 HTML）' }
    }
    const o = next as Record<string, unknown>
    if (typeof o.title === 'string' && o.title.trim() && o.title.trim() !== found.doc.name) {
      return { error: '超级文档不支持改名（名字是页签与身份的一半）；要新名字就 create 一份新的，把内容搬过去' }
    }
    if (typeof o.html !== 'string') return { error: 'html 必给：一份完整的 HTML（按钮、样式、脚本都在里面）' }
    const html = o.html
    if (!html.trim()) return { error: '内容为空：editContent 需要一份完整的 HTML' }
    if (html.length > SUPERDOC_MAX_CHARS) {
      return { error: '超级文档最长 ' + SUPERDOC_MAX_CHARS + ' 字符（收到 ' + html.length + '）；拆成几份或把重逻辑挪进 method 函数' }
    }
    if (found.node) {
      const nextStore = writeSuperDoc(this.ctx.store(), found.node.id, found.doc.name, html)
      if (!nextStore) return { error: '写入失败：归属的文档节点已经不在了' }
      this.ctx.commit(nextStore)
    } else {
      // 游离态：直接改池子里那份实体
      const s = this.ctx.store()
      const pool = s.detached?.[found.goalId]
      if (!pool) return { error: '这份超级文档已经不在了（可能刚被删除）' }
      this.ctx.commit({
        ...s,
        detached: {
          ...s.detached,
          [found.goalId]: {
            ...pool,
            superdocs: pool.superdocs.map((d) => (d.id === this.uuid ? { ...d, html, updatedAt: Date.now() } : d)),
          },
        },
      })
    }
    const hostId = found.node?.id ?? ''
    return {
      ok: true,
      note:
        '已覆盖更新「' + found.doc.name + '」（' + html.length + ' 字符）。' +
        (hostId ? '打开给用户：api.ui.superdoc("' + hostId + '", "' + found.doc.name + '")' : '它目前是游离的：绑到某份文档后才能作为页签打开'),
    }
  }

  help(): NodeHelp {
    const found = this.locate()
    return {
      description:
        '超级文档节点——「' + (found?.doc.name ?? '？') + '」' +
        (found?.node ? '，挂在文档「' + found.node.title + '」下。' : '（游离：还没绑到哪份文档上）。') +
        (found ? (found.doc.html.trim() ? '现有 ' + found.doc.html.length + ' 字符。' : '还是空的（一份壳）。') : ''),
      edit: [
        'await n.content 读源码 → 改 → await n.editContent({ html }) 整份覆盖（自包含单页：结构、<style>、<script> 都在这一份里）。',
        '主题变量自适应深浅色：var(--color-bg) / --color-sunken / --color-surface、--color-ink / --ink-strong / --ink-soft、--color-seal / --line / --warn / --success。',
        '富文本用 <moji-markdown>…</moji-markdown>（宿主解析 Markdown 与 LaTeX）；页面里的按钮调 window.api.method.call("函数名", ...args) 执行持久化函数（先 api.method.create 存好）。',
        '内置跳转协议：静态资源 moji:static/{uuid}、超级文档互跳 moji:super/{name}、节点跳转 moji:node/{nodeId}。',
        '上限 ' + SUPERDOC_MAX_CHARS + ' 字符；写完用 api.ui.superdoc 打开给用户看。',
      ].join('\n'),
      connection: [
        '上游是文档：拖线 / connect(文档对象, "down") 绑到某份文档（或换绑到另一份），disconnect 摘掉 = 变成游离的独立超级文档（内容原样保留）。',
        '下游连接只能为笔记节点：拖线 / connect(笔记对象, "down") 将笔记作为下级接入。',
      ].join('\n'),
    }
  }

  onUpstream(node: GNode): ConnectFilter {
    if (node.kind !== 'doc' && node.kind !== 'file') return '超级文档只能挂在文档或文件节点之下'
    return true
  }

  onDownstream(node: GNode): ConnectFilter {
    if (node.kind !== 'note' && node.kind !== 'file') return '超级文档节点的下级连接只能为笔记节点或文件节点'
    if (node.kind === 'note') {
      const upRelations = node.relations.filter((r) => r.type === 'up')
      if (upRelations.length > 0 && !upRelations.some((r) => r.id === this.uuid)) {
        return '笔记只能有一个上级节点'
      }
    }
    return true
  }

  protected link(down: GNode): NodeResult {
    if (down.kind !== 'note' && down.kind !== 'file') return { error: '超级文档节点的下级连接只能为笔记节点或文件节点' }
    const s = this.ctx.store()
    const r = addEdge(s, this.uuid, down.uuid)
    if (!r.added) return { error: r.reason ?? '连接失败' }
    this.ctx.commit(r.store)
    return { ok: true, note: '已把笔记「' + down.title + '」作为下级连接到「' + this.title + '」' }
  }

  /** 摘线 = 解绑：若断开的是与笔记的边则拆边；否则实体挪进游离池 */
  protected unlink(target?: GNode): NodeResult {
    if (target && target.kind === 'note' && this.ctx.store().edges.some((e) => e.from === this.uuid && e.to === target.uuid)) {
      this.ctx.commit(removeEdge(this.ctx.store(), this.uuid, target.uuid))
      return { ok: true, note: '已断开与笔记「' + target.title + '」的连接' }
    }
    if (target && target.kind === 'file') {
      const edge = this.ctx.store().edges.find((e) => (e.from === this.uuid && e.to === target.uuid) || (e.to === this.uuid && e.from === target.uuid))
      if (edge) {
        this.ctx.commit(removeEdge(this.ctx.store(), edge.from, edge.to))
        return { ok: true, note: '已断开与文件「' + target.title + '」的连接' }
      }
    }
    const r = detachSuperDoc(this.ctx.store(), this.uuid)
    if ('error' in r) return { error: r.error }
    this.ctx.commit(r.store)
    return { ok: true, note: '已解开「' + this.title + '」的绑定：它现在是独立的超级文档（内容原样保留），可以拖线绑到别的文档' }
  }
}
