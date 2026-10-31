/**
 * 大纲节点：一份结构化计划（intro + 直接子目标一层 children）。
 *
 * 两种住处、同一种节点（解析统一走 outline.outlineByMember）：
 * - **附身**：长在文档身上（node.outline），uuid `o:{宿主文档id}`，上游恒为宿主文档
 *   （自动）——「创建一个节点时两份文件同时成形」的那一对；
 * - **游离**：独立实体（store.outlines，见 types 的 OutlineEntity），没有宿主文档，
 *   uuid `o:{自己的实体id}`——分类层的结构节点，往下只挂子级，不挂「自己的正文」。
 *
 * 下游两类（都是 store.edges 树边，断开即拆线）：文档（目标项落地成内容叶子）与
 * 大纲（再开一层分类 / 子计划）。树边的拼法即语义：子级是文档 → to = 文档 id
 * （交替链 文档-大纲-文档…）；子级是大纲 → to = `o:{大纲id}`（分类链 文档-大纲-大纲…，
 * 不论那份大纲是附身还是游离）。附身大纲在边里以宿主文档 id 发声（voice），
 * 游离大纲以自己的 uuid 发声。
 */
import { addEdge, removeEdge } from '../graph'
import { clearOutline, deleteOutlineEntity, outlineByMember, writeOutline, writeOutlineEntity, type OutlineOf } from '../outline'
import { docIdOfOutlineUuid, GNode, type ConnectFilter, type NodeCtx, type NodeHelp, type NodePort, type NodeRelation, type NodeResult } from './base'

export class OutlineGNode extends GNode {
  constructor(ctx: NodeCtx, uuid: string) {
    super(ctx, uuid)
  }

  get kind(): 'outline' {
    return 'outline'
  }

  protected get kindLabel(): string {
    return '大纲'
  }

  /** 身后的那份记录：附身（宿主文档 + node.outline）或游离（独立实体） */
  private get found(): OutlineOf | null {
    return outlineByMember(this.ctx.store(), this.uuid)
  }

  /** 这份大纲在树边里的声部：附身 = 宿主文档 id（边落进节点文件）；游离 = 自己的 uuid */
  private get voice(): string {
    const f = this.found
    if (!f) return this.uuid
    return f.kind === 'attached' ? f.docId : f.uuid
  }

  get title(): string {
    const f = this.found
    if (!f) return '节点 · 大纲'
    return (f.kind === 'attached' ? f.doc.title : f.entity.title) + ' · 大纲'
  }

  exists(): boolean {
    return !!this.found
  }

  get relations(): NodeRelation[] {
    const f = this.found
    if (!f) return []
    const rels: NodeRelation[] = []
    if (f.kind === 'attached') {
      rels.push({ id: f.docId, type: 'up' })
    }
    /*
     * 树上游（可能多个，游离大纲与附身大纲皆可挂在另一份大纲之下）：
     * id 给上级的**大纲 uuid**（边里的 from 是声部——附身大纲用宿主文档 id，这里折回 o: 前缀），
     * portKey 跟着带上——它认领的那条目标项靠 getPortData() 读（「上级交给这一层的任务」）。
     */
    for (const e of this.ctx.store().edges) {
      if (e.to !== this.uuid && (f.kind !== 'attached' || e.to !== f.docId)) continue
      const upId = e.from.startsWith('o:') ? e.from : 'o:' + e.from
      rels.push({ id: upId, type: 'up', ...(e.portKey ? { portKey: e.portKey } : {}) })
    }
    for (const e of this.ctx.store().edges) {
      if (e.from === this.voice) rels.push({ id: e.to, type: 'down' })
    }
    return rels
  }

  /**
   * 固定接口 = 每条目标项一个口：key 是目标项 key（与画布槽位同一套）、label 是标题、
   * data 是那条计划的内容。完全从大纲内容派生，不落第二份状态。
   */
  get ports(): NodePort[] {
    const f = this.found
    const children = f?.kind === 'attached' ? (f.outline?.children ?? []) : f?.kind === 'free' ? f.entity.children : []
    return children.map((c) => ({ key: c.key, label: c.title, data: { summary: c.summary } }))
  }

  get content(): unknown {
    const f = this.found
    if (!f) return null
    if (f.kind === 'attached') return f.outline
    return { intro: f.entity.intro, children: f.entity.children, updatedAt: f.entity.updatedAt }
  }

  editContent(next: unknown): NodeResult {
    const f = this.found
    if (!f) return { error: '这份大纲已经不在了' }
    let p = next
    if (typeof next === 'string') {
      try {
        p = JSON.parse(next)
      } catch {
        return { error: '大纲内容是 { intro, children } 对象（传字符串时必须是合法 JSON）' }
      }
    }
    if (!p || typeof p !== 'object' || Array.isArray(p)) {
      return { error: '大纲内容是 { intro, children } 对象：children 每项 { title, summary }' }
    }
    const input = p as Record<string, unknown>
    if (f.kind === 'attached') {
      const r = writeOutline(this.ctx.store(), f.docId, input, Date.now())
      if (!r.ok) return { error: r.error }
      this.ctx.commit(r.store)
      return {
        ok: true,
        note: '已写入「' + f.doc.title + '」的大纲：' + r.outline.children.length + ' 条目标项（intro ' + r.outline.intro.length + ' 字）',
      }
    }
    const r = writeOutlineEntity(this.ctx.store(), f.entity.id, input, Date.now())
    if (!r.ok) return { error: r.error }
    this.ctx.commit(r.store)
    return {
      ok: true,
      note: '已写入大纲「' + r.entity.title + '」：' + r.entity.children.length + ' 条目标项（intro ' + r.entity.intro.length + ' 字）',
    }
  }

  help(): NodeHelp {
    const f = this.found
    const children = f?.kind === 'attached' ? (f.outline?.children ?? []) : f?.kind === 'free' ? f.entity.children : []
    return {
      description:
        '大纲节点——「这一层往下怎么学」的计划文件。' +
        (f?.kind === 'attached'
          ? '附在文档「' + f.doc.title + '」身上（上游自动连着它）。'
          : f?.kind === 'free'
            ? '独立大纲（没有宿主文档），是树上的一个结构层。'
            : '') +
        (children.length ? '现有 ' + children.length + ' 条目标项。' : '还没有写过目标项。'),
      edit: [
        '内容形状：{ intro, children }；children 每项 { title, summary }，key 由标题自动生成，不要自己编；最多 24 条。',
        '只写**直接子层级**，一层为止——「爷爷知道儿子的存在，但不知道孙子的存在」；孙辈由子目标自己的大纲负责。',
        '大纲是计划，不是落地：目标项长成文档 / 子大纲由学习者在画布上驱动（点目标项挂文档）。写大纲的这一轮不建节点。',
        'await n.content 读现状（null = 还没写过）；await n.editContent({ intro, children }) 整份覆盖，有旧的就整份重写，不要追加。',
        ...(f?.kind === 'free' ? ['独立大纲的标题在 editContent 里给 title 字段即可改。'] : []),
      ].join('\n'),
      connection: [
        f?.kind === 'attached'
          ? '上游是宿主文档（自动连着）；disconnect(宿主文档对象) 摘掉这条归属线 = 删除这份大纲（计划清空，文档与树边不动）。'
          : '独立大纲没有宿主文档；要挂进哪一层，由上一份大纲发起 connect。',
        '下游两类，都是这条树边（第三个参数给目标项 key = 认领这个接口，一个接口只认领一个下游，对方用 getPortData() 能读到这条计划）：',
        '- 文档（目标项落地成内容）：await 大纲.connect(文档对象, "down", 目标项key?)；',
        '- 大纲（目标项再开一层分类 / 子计划）：await 大纲.connect(子大纲对象, "down", 目标项key?)——孙辈由子大纲自己负责。',
        'disconnect 拆掉那一条边：文档变游离，子大纲变成没有上级的独立一层，都不删除任何东西。别的东西（笔记 / 试卷 / 超级文档）挂不进来。',
      ].join('\n'),
    }
  }

  onUpstream(node: GNode): ConnectFilter {
    if (node.kind === 'outline') {
      // 大纲连大纲：我这一层作为子层挂进对方——树边由对方的大纲落库
      return true
    }
    return '大纲的上游是宿主文档（自动连着）或另一份大纲（由那一层的大纲发起 connect）'
  }

  onDownstream(node: GNode): ConnectFilter {
    if (node.kind === 'doc' || node.kind === 'outline') return true
    return '大纲的下游只能是文档或大纲（目标项要么由文档落地，要么再开一层子大纲）'
  }

  protected link(down: GNode, portKey?: string): NodeResult {
    const s = this.ctx.store()
    if (!this.found) return { error: '这份大纲已经不在了' }
    // 成员 id 即对方 uuid：文档 = 节点 id（交替链），大纲 = o:{id}（分类链，拼法即语义）
    const toMember = down.uuid
    const voice = this.voice
    const existing = s.edges.find((e) => e.from === voice && e.to === toMember)
    if (existing) {
      // 这条边已经在了：带着 portKey 来 = 改认领（换一条目标项；一对一照旧查占用）
      if (!portKey) return { error: '「' + down.title + '」已经挂在这层之下了（要改认领哪条目标项，connect 时带上它的 key）' }
      if (existing.portKey === portKey) return { ok: true, note: '「' + down.title + '」认领的就是这条目标项，没有变化' }
      const taken = s.edges.find((e) => e.from === voice && e.portKey === portKey && e.to !== toMember)
      if (taken) {
        const other = this.ctx.objectOf(taken.to)
        return { error: '接口「' + (this.ports.find((p) => p.key === portKey)?.label ?? portKey) + '」已经被「' + (other?.title ?? taken.to) + '」认领了——一个接口只认领一个下游' }
      }
      this.ctx.commit({ ...s, edges: s.edges.map((e) => (e === existing ? { ...e, portKey } : e)) })
      return { ok: true, note: '「' + down.title + '」改认领目标项「' + (this.ports.find((p) => p.key === portKey)?.label ?? portKey) + '」' }
    }
    const r = addEdge(s, voice, toMember, portKey)
    if (!r.added) {
      return { error: r.reason ?? '这条边没能挂上：会成环（「' + down.title + '」已经在「' + this.title + '」的上游里）' }
    }
    this.ctx.commit(r.store)
    const claimed = portKey ? '，认领了目标项「' + (this.ports.find((p) => p.key === portKey)?.label ?? portKey) + '」' : ''
    if (down.kind === 'outline') {
      return { ok: true, note: '已在「' + this.title + '」之下开了新的一层「' + down.title + '」' + claimed + '；那层的目标项由它自己列' }
    }
    return { ok: true, note: '已把文档「' + down.title + '」挂到「' + this.title + '」之下' + claimed }
  }

  protected unlink(target: GNode): NodeResult {
    const f = this.found
    if (!f) return { error: '这份大纲已经不在了' }
    // 附身大纲与宿主文档之间的那条「归属线」：摘掉 = 删除这份大纲（计划清空）。文档与树边都不动。
    if (f.kind === 'attached' && target.uuid === f.docId) {
      const next = clearOutline(this.ctx.store(), f.docId, Date.now())
      if (!next) return { error: '这份大纲已经不在了（还没有写过内容）' }
      this.ctx.commit(next)
      return { ok: true, note: '已删除「' + f.doc.title + '」的大纲：计划清空，文档与它的下级文档都还在' }
    }
    // 游离大纲的树上游：摘掉那条父线（这一层变成没有上级的独立层）
    if (f.kind === 'free') {
      const hostId = docIdOfOutlineUuid(target.uuid)
      const upEdge = this.ctx.store().edges.find(
        (e) => e.to === this.uuid && (e.from === target.uuid || (!!hostId && e.from === hostId)),
      )
      if (upEdge) {
        this.ctx.commit(removeEdge(this.ctx.store(), upEdge.from, this.uuid))
        return { ok: true, note: '已把「' + this.title + '」这一层摘出来：它变成没有上级的独立层，内容与下级都在' }
      }
    }
    // 树边：拆掉那一条父线（对方成游离成员 / 独立一层，内容原样）
    this.ctx.commit(removeEdge(this.ctx.store(), this.voice, target.uuid))
    return target.kind === 'outline'
      ? { ok: true, note: '已把「' + target.title + '」这一层从「' + this.title + '」之下摘出来（它变成没有上级的独立一层，内容与下级都在）' }
      : { ok: true, note: '已把文档「' + target.title + '」从「' + this.title + '」之下摘出来（它变成了没有上游的游离文档，还在画布上）' }
  }

  /** 删除整份大纲（service.delete 的落点，画布垃圾桶同路）：附身 = 清空计划；游离 = 实体连同两端树边一起摘 */
  deleteSelf(): NodeResult {
    const f = this.found
    if (!f) return { error: '这份大纲已经不在了' }
    if (f.kind === 'attached') {
      const next = clearOutline(this.ctx.store(), f.docId, Date.now())
      if (!next) return { error: '这份大纲还没有写过内容，没有可删的东西' }
      this.ctx.commit(next)
      return { ok: true, note: '已删除「' + f.doc.title + '」的大纲：计划清空，文档与它的下级文档都还在' }
    }
    const next = deleteOutlineEntity(this.ctx.store(), f.entity.id)
    if (!next) return { error: '这份大纲已经不在了' }
    this.ctx.commit(next)
    return {
      ok: true,
      note: '已删除独立大纲「' + f.entity.title + '」：它两端的树边一并摘掉（下级都还在，只是没有了上级）',
    }
  }
}
