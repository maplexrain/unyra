/**
 * 笔记节点：学习者与导师都能写的一份 markdown，一节点可挂多份。
 *
 * uuid 是 NoteFile.id（持久 id，改名不变——页签、坐标、agent 句柄都靠它稳住）。
 * 实体要么在宿主文档的记录里（绑定），要么在游离池里（剪了线 / 还没绑过）——
 * 两种状态内容读写完全一样，绑定的只是那条关系线。
 */
import { renameNoteFile, writeNote, removeEdge } from '../graph'
import { detachNote } from '../detached'
import { notesOf } from '../notes'
import type { KnowledgeNode, NoteFile } from '../types'
import { GNode, type ConnectFilter, type NodeCtx, type NodeHelp, type NodeRelation, type NodeResult } from './base'

export class NoteGNode extends GNode {
  constructor(ctx: NodeCtx, uuid: string) {
    super(ctx, uuid)
  }

  get kind(): 'note' {
    return 'note'
  }

  protected get kindLabel(): string {
    return '笔记'
  }

  /** 实体在哪：绑定的回宿主，游离的回 null 宿主（goalId 记着它属于哪个目标） */
  private locate(): { note: NoteFile; node: KnowledgeNode | null; goalId: string } | null {
    const s = this.ctx.store()
    for (const node of s.nodes) {
      const note = notesOf(node).find((n) => n.id === this.uuid)
      if (note) return { note, node, goalId: node.goalId }
    }
    for (const [goalId, pool] of Object.entries(s.detached ?? {})) {
      const note = pool.notes.find((n) => n.id === this.uuid)
      if (note) return { note, node: null, goalId }
    }
    return null
  }

  get title(): string {
    return this.locate()?.note.name ?? this.uuid
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
      if (edge.to === this.uuid) {
        out.push({ id: edge.from, type: 'up' })
      }
    }
    return out
  }

  get content(): unknown {
    const found = this.locate()
    if (!found) return { error: '这份笔记已经不在了（可能刚被删除）' }
    return { title: found.note.name, text: found.note.content }
  }

  editContent(next: unknown): NodeResult {
    const found = this.locate()
    if (!found) return { error: '这份笔记已经不在了（可能刚被删除）' }
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      return { error: '笔记内容是 { title?, text } 对象；text 是整份 markdown 正文' }
    }
    const o = next as Record<string, unknown>
    if (typeof o.text !== 'string') return { error: 'text 必给（整份正文，没有内容就给空串 ""）' }
    const text = o.text
    let s = this.ctx.store()
    let name = found.note.name
    if (found.node) {
      if (typeof o.title === 'string' && o.title.trim() && o.title.trim() !== name) {
        const r = renameNoteFile(s, found.node.id, name, o.title.trim())
        if (!r.name) return { error: '改名没有成功（这个名字可能不合法）' }
        s = r.store
        name = r.name
      }
      this.ctx.commit(writeNote(s, found.node.id, name, text))
    } else {
      // 游离态：直接改池子里那份实体（改名不撞池内同名即可）
      name = typeof o.title === 'string' && o.title.trim() ? o.title.trim() : name
      const pool = s.detached?.[found.goalId]
      if (!pool) return { error: '这份笔记已经不在了（可能刚被删除）' }
      if (name !== found.note.name && pool.notes.some((n) => n.name === name && n.id !== this.uuid)) {
        return { error: '游离笔记里已经有叫「' + name + '」的了，换一个名字' }
      }
      this.ctx.commit({
        ...s,
        detached: {
          ...s.detached,
          [found.goalId]: {
            ...pool,
            notes: pool.notes.map((n) => (n.id === this.uuid ? { ...n, name, content: text, updatedAt: Date.now() } : n)),
          },
        },
      })
    }
    return { ok: true, note: '已写入笔记「' + name + '」：' + o.text.length + ' 字' }
  }

  help(): NodeHelp {
    const found = this.locate()
    return {
      description:
        '笔记节点——「' + (found?.note.name ?? '？') + '」' +
        (found?.node ? '，挂在文档「' + found.node.title + '」下。' : '（游离：还没绑到哪份文档上）。') +
        (found ? (found.note.content.trim() ? '现有 ' + found.note.content.length + ' 字。' : '还是空的。') : ''),
      edit: [
        '笔记是**学习者的东西**：动笔前 await n.content 读一遍，再 editContent({ text }) 整份写回，严禁覆盖学习者已有的内容；整理类任务以合并、追加为主。',
        'title 可选（改名要谨慎——那是学习者起的名字）；text 必给，是整份 markdown。',
      ].join('\n'),
      connection: [
        '上游是文档：拖线 / connect(文档对象, "down") 绑到某份文档（或换绑到另一份），disconnect 摘掉 = 变成游离的独立笔记（内容原样保留）。',
        '笔记是叶子，没有下游。',
      ].join('\n'),
    }
  }

  onUpstream(node: GNode): ConnectFilter {
    if (node.kind !== 'doc' && node.kind !== 'exam' && node.kind !== 'superdoc') {
      return '笔记只能挂在文档、试卷或超级文档之下'
    }
    const upRelations = this.relations.filter((r) => r.type === 'up')
    if (upRelations.length > 0 && !upRelations.some((r) => r.id === node.uuid)) {
      const hasEdgeUp = this.ctx.store().edges.some((e) => e.to === this.uuid)
      if (node.kind !== 'doc' || hasEdgeUp) {
        return '笔记只能有一个上级节点'
      }
    }
    return true
  }

  /** 摘线 = 解绑：实体挪进游离池，内容原样保留，随时可以绑到别的文档 */
  protected unlink(target?: GNode): NodeResult {
    const s = this.ctx.store()
    if (target) {
      if (s.edges.some((e) => e.from === target.uuid && e.to === this.uuid)) {
        this.ctx.commit(removeEdge(s, target.uuid, this.uuid))
        return { ok: true, note: '已断开与「' + target.title + '」的连接' }
      }
      const found = this.locate()
      if (found?.node && found.node.id === target.uuid) {
        const r = detachNote(s, this.uuid)
        if ('error' in r) return { error: r.error }
        this.ctx.commit(r.store)
        return { ok: true, note: '已解开「' + this.title + '」的绑定：它现在是独立的笔记（内容原样保留），可以拖线绑到别的文档' }
      }
    }
    let nextStore = s
    let changed = false
    if (s.edges.some((e) => e.to === this.uuid)) {
      nextStore = { ...nextStore, edges: nextStore.edges.filter((e) => e.to !== this.uuid) }
      changed = true
    }
    const found = this.locate()
    if (found?.node) {
      const r = detachNote(nextStore, this.uuid)
      if ('error' in r) return { error: r.error }
      nextStore = r.store
      changed = true
    }
    if (changed) {
      this.ctx.commit(nextStore)
      return { ok: true, note: '已解开「' + this.title + '」的绑定：它现在是独立的笔记（内容原样保留），可以拖线绑到别的文档' }
    }
    return { error: '这份笔记本来就是游离的，没有线可摘' }
  }
}
