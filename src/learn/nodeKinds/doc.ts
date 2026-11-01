/**
 * 文档节点：知识树的一页讲义，也是挂件的宿主。
 *
 * 它的 uuid 就是知识节点的 id。上游是大纲（`o:` 前缀；根文档的上游是入口 `entry:`），
 * 下游（自己的大纲 / 笔记 / 试卷 / 超级文档）全部由**归属关系**派生——挂件用
 * `api.node.create({ kind, under })` 创建那一刻就挂好了，不需要也不允许手工连线。
 */
import { loadAgentSettings } from '../../agent/settings'
import { layoutHintOf } from '../../agent/docFormat'
import { bindExam, bindNote, bindSuperDoc, detachExam, detachNote, detachSuperDoc } from '../detached'
import { addEdge, examsOfNode, nodeById, removeEdge, titleTaken, updateDoc, updateNode } from '../graph'
import { clearOutline } from '../outline'
import { notesOf } from '../notes'
import { superDocsOf, type KnowledgeNode } from '../types'
import { entryUuid, outlineUuid, GNode, type ConnectFilter, type NodeCtx, type NodeHelp, type NodeRelation, type NodeResult } from './base'

export class DocGNode extends GNode {
  constructor(ctx: NodeCtx, uuid: string) {
    super(ctx, uuid)
  }

  get kind(): 'doc' {
    return 'doc'
  }

  protected get kindLabel(): string {
    return '文档'
  }

  private get record(): KnowledgeNode | undefined {
    return nodeById(this.ctx.store(), this.uuid)
  }

  get title(): string {
    return this.record?.title ?? this.uuid
  }

  exists(): boolean {
    return !!this.record
  }

  private get isRoot(): boolean {
    return this.ctx.store().goals.some((g) => g.rootNodeId === this.uuid)
  }

  get relations(): NodeRelation[] {
    const s = this.ctx.store()
    const node = this.record
    if (!node) return []
    const out: NodeRelation[] = []
    if (this.isRoot) {
      out.push({ id: entryUuid(this.uuid), type: 'up' })
    } else {
      // 上游大纲或视频节点的认领记在树边上（下游侧有效）
      for (const e of s.edges) {
        if (e.to !== this.uuid) continue
        const isVideo = (s.videoNodes ?? []).some((v) => v.id === e.from)
        out.push({ id: isVideo ? e.from : outlineUuid(e.from), type: 'up', ...(e.portKey ? { portKey: e.portKey } : {}) })
      }
    }
    // 下级文档也在下游（树边 from 我）：画布在枢纽不在时按 doc→doc 画那条线，两端都要能摘
    for (const e of s.edges) {
      if (e.from !== this.uuid || !nodeById(s, e.to)) continue
      out.push({ id: e.to, type: 'down' })
    }
    // 挂载的项目节点（树边 from 我 to 项目实体）：与挂件同一款的下游
    for (const e of s.edges) {
      if (e.from !== this.uuid) continue
      if ((s.projects ?? []).some((p) => p.id === e.to)) out.push({ id: e.to, type: 'down' })
    }
    if (node.outline) out.push({ id: outlineUuid(this.uuid), type: 'down' })
    for (const n of notesOf(node)) out.push({ id: n.id, type: 'down' })
    for (const d of superDocsOf(node)) out.push({ id: d.id, type: 'down' })
    for (const e of examsOfNode(s, this.uuid)) out.push({ id: e.id, type: 'down' })
    return out
  }

  get content(): unknown {
    const node = this.record
    if (!node) return { error: '这个节点已经不在了（可能刚被删除）' }
    return {
      title: node.title,
      description: node.description,
      teaching: node.docs?.teaching ?? '',
      status: node.status,
      annotations: node.annotations ?? [],
    }
  }

  editContent(next: unknown): NodeResult {
    const node = this.record
    if (!node) return { error: '这个节点已经不在了（可能刚被删除）' }
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      return { error: '文档内容是 { title, description, teaching, status?, annotations? } 对象（先 await n.content 读现状再整份写回）' }
    }
    const o = next as Record<string, unknown>
    const title = typeof o.title === 'string' ? o.title.trim() : ''
    if (!title) return { error: 'title 必给且不能为空' }
    if (typeof o.description !== 'string') {
      return { error: 'description 必给（没有就给空串 ""）——整份替换，缺了这一项等于把描述清掉' }
    }
    if (typeof o.teaching !== 'string') {
      return { error: 'teaching 必给（教学正文；没有就给空串 ""）——整份替换，缺了这一项等于把正文清掉' }
    }
    let status: 'learning' | 'mastered' | undefined
    if (o.status !== undefined) {
      if (o.status !== 'learning' && o.status !== 'mastered') {
        return { error: 'status 只能是 "learning" / "mastered"（不给就保持不变）' }
      }
      status = o.status
    }
    // 注解（了解 / 批注）：可选——不给就保持原样；给了必须是数组，逐条认 { term, body }
    let annotations: Array<Record<string, unknown>> | undefined
    if (o.annotations !== undefined) {
      if (!Array.isArray(o.annotations)) return { error: 'annotations 要是数组（每项 { term, body, occurrence? }）' }
      annotations = []
      for (const item of o.annotations) {
        if (!item || typeof item !== 'object') return { error: 'annotations 的每一项都要是 { term, body } 对象' }
        const a = item as Record<string, unknown>
        const term = typeof a.term === 'string' ? a.term.trim() : ''
        const body = typeof a.body === 'string' ? a.body : ''
        if (!term || !body) return { error: 'annotations 里有一项缺 term 或 body' }
        annotations.push({
          term,
          body,
          ...(a.kind === 'understand' || a.kind === 'note' ? { kind: a.kind } : {}),
          ...(typeof a.occurrence === 'number' && Number.isFinite(a.occurrence) ? { occurrence: a.occurrence } : {}),
        })
      }
    }
    const s = this.ctx.store()
    if (title !== node.title) {
      const clash = titleTaken(s, node.goalId, title, node.id)
      if (clash) return { error: '本目标里已经有「' + clash.title + '」这个标题——同名会让按标题寻址失效，换一个' }
    }
    let nextStore = updateNode(s, node.id, {
      title,
      description: o.description,
      ...(status !== undefined ? { status } : {}),
      ...(annotations !== undefined ? { annotations: annotations as never } : {}),
    })
    nextStore = updateDoc(nextStore, node.id, o.teaching)
    this.ctx.commit(nextStore)
    const bits: string[] = ['正文 ' + o.teaching.length + ' 字']
    if (title !== node.title) bits.push('已从「' + node.title + '」改名')
    if (status !== undefined && status !== node.status) bits.push('状态 → ' + status)
    if (annotations !== undefined && annotations.length !== (node.annotations?.length ?? 0)) {
      bits.push('注解 ' + annotations.length + ' 条')
    }
    return {
      ok: true,
      note: '已写入「' + title + '」：' + bits.join('，') +
        layoutHintOf('teaching', o.teaching, loadAgentSettings().docFormat),
    }
  }

  help(): NodeHelp {
    const node = this.record
    const teaching = node?.docs?.teaching ?? ''
    const root = this.isRoot
    return {
      description:
        '文档节点——知识树的讲义页，也是挂件的宿主。' +
        (node ? (teaching.trim() ? '正文 ' + teaching.length + ' 字。' : '正文还没写。') : '') +
        (root ? '这是目标的根文档（入口连着它）。' : ''),
      edit: [
        '动线：const c = await n.content 读现状 → 改 → await n.editContent({ ...c, teaching: 新正文 })。整份替换，先读后写，不要凭记忆默写。',
        '教学文档写法：循序渐进（直觉 / 例子 → 定义与推导），数学用 LaTeX；至少两三处结构性元素（排版配方在「文档排版与视觉呈现」提示词模块里）；用了网络资料，文末写「## 📚 参考资料与权威来源」。',
        '字段：description 是 150~300 字的概念简述；status 是掌握状态（考试通过才置 "mastered"）；annotations 是正文旁的注解词条（每项 { term, body, occurrence? }，不给就保持原样）。',
        '边界：不在这里拆下一层大纲（那是大纲节点的事）；学习者的笔记在 note 节点上，不混进正文。',
      ].join('\n'),
      connection: [
        root
          ? '上游是入口（entry:，由目标绑定自动生成，不能手工连）。'
          : '上游是大纲（o: 前缀）：把这份文档挂到某份大纲下，先取那份大纲再 connect(我, "up", 目标项key?)——第三个参数给目标项 key 就认领了这个接口，之后 await 我.getPortData() 能读到「这条目标项要我写什么」。',
        '下游（大纲 / 笔记 / 试卷 / 超级文档 / 项目）都可以连线：api.node.create({ kind, under: 我的 uuid }) 创建即挂；拖线 / connect(挂件对象, "down") 绑定游离的挂件或换绑别人的，disconnect 解绑（内容原样）。与自己的大纲之间 disconnect = 删除那份大纲。',
      ].join('\n'),
    }
  }

  onUpstream(node: GNode): ConnectFilter {
    if (node.kind === 'entry') return '入口与根文档的连线由目标绑定自动生成，不能手工连'
    if (node.kind === 'video') return true
    if (node.kind !== 'outline') {
      return '文档的上游只能是大纲（o: 前缀的对象）——要挂在哪份大纲下，就取那份大纲再由它发起 connect'
    }
    return true
  }

  onDownstream(node: GNode): ConnectFilter {
    if (node.kind === 'note' || node.kind === 'superdoc' || node.kind === 'exam' || node.kind === 'project') return true
    if (node.kind === 'outline') return '大纲与文档一一对应（o: 就是这份文档的 id），由创建 / 删除大纲管理，不能手工连'
    return '这种节点不能挂到文档之下（能挂的：笔记 / 试卷 / 超级文档 / 项目 / 下级文档走大纲）'
  }

  /**
   * 绑定（上游一方落库）：把一份挂件挂到自己名下。实体从游离池或**别的文档**挪过来
   * 都行——换绑就是这一步，内容与 id 原样，动的只是挂在谁那里。
   */
  protected link(down: GNode): NodeResult {
    const s = this.ctx.store()
    if (down.kind === 'note') {
      const r = bindNote(s, down.uuid, this.uuid)
      if ('error' in r) return { error: r.error }
      this.ctx.commit(r.store)
      return { ok: true, note: '已把笔记「' + r.name + '」绑到「' + this.title + '」之下' }
    }
    if (down.kind === 'superdoc') {
      const r = bindSuperDoc(s, down.uuid, this.uuid)
      if ('error' in r) return { error: r.error }
      this.ctx.commit(r.store)
      return { ok: true, note: '已把超级文档「' + r.name + '」绑到「' + this.title + '」之下' }
    }
    if (down.kind === 'exam') {
      const r = bindExam(s, down.uuid, this.uuid)
      if ('error' in r) return { error: r.error }
      this.ctx.commit(r.store)
      return { ok: true, note: '已把试卷《' + down.title + '》绑到「' + this.title + '」之下' }
    }
    if (down.kind === 'project') {
      const r = addEdge(s, this.uuid, down.uuid)
      if (!r.added) return { error: r.reason ?? '挂载失败' }
      this.ctx.commit(r.store)
      return { ok: true, note: '已把项目「' + down.title + '」挂到「' + this.title + '」之下' }
    }
    return { error: '这种节点挂不到文档之下（能绑的：笔记 / 试卷 / 超级文档 / 项目）' }
  }

  /**
   * 摘线（按对象分派）：与自己的大纲之间摘掉 = 删除那份大纲（计划清空，文档本身不动）；
   * 与挂件之间摘掉 = 解绑（实体进游离池 / 试卷悬空，内容原样，可再绑别人）。
   */
  protected unlink(target: GNode): NodeResult {
    if (target.kind === 'outline' && target.uuid === outlineUuid(this.uuid)) {
      const next = clearOutline(this.ctx.store(), this.uuid, Date.now())
      if (!next) return { error: '这份大纲已经不在了（还没有写过内容）' }
      this.ctx.commit(next)
      return { ok: true, note: '已删除「' + this.title + '」的大纲：计划清空，文档与它的下级文档都还在' }
    }
    // 父大纲（上游树边）：摘线 = 拆那条树边，我变成没有上级的独立文档（大纲与它的其他下级不动）
    if (target.kind === 'outline') {
      // 父级两种拼法：附身大纲以宿主文档 id 发声（边 from = 文档 id），游离大纲以自己的 uuid 发声
      const upEdge = this.ctx.store().edges.find(
        (e) => e.to === this.uuid && (outlineUuid(e.from) === target.uuid || e.from === target.uuid),
      )
      if (upEdge) {
        this.ctx.commit(removeEdge(this.ctx.store(), upEdge.from, this.uuid))
        return { ok: true, note: '已把「' + this.title + '」从「' + target.title + '」之下摘出来（它变成没有上游的独立文档，内容原样，认领随线解除）' }
      }
    }
    // 上游视频节点（上游树边）：摘线 = 拆那条树边
    if (target.kind === 'video') {
      const upEdge = this.ctx.store().edges.find((e) => e.to === this.uuid && e.from === target.uuid)
      if (upEdge) {
        this.ctx.commit(removeEdge(this.ctx.store(), target.uuid, this.uuid))
        return { ok: true, note: '已把「' + this.title + '」从「' + target.title + '」之下摘出来' }
      }
    }
    // 下级文档（下游树边，画布枢纽不在时的 doc→doc 那条线）：摘线 = 拆边，对方变游离
    if (target.kind === 'doc' && this.ctx.store().edges.some((e) => e.from === this.uuid && e.to === target.uuid)) {
      this.ctx.commit(removeEdge(this.ctx.store(), this.uuid, target.uuid))
      return { ok: true, note: '已拆掉「' + this.title + '」到「' + target.title + '」的那条线：对方变成没有上级的独立文档（内容原样）' }
    }
    if (target.kind === 'note' || target.kind === 'superdoc' || target.kind === 'exam') {
      const detach = target.kind === 'note' ? detachNote : target.kind === 'superdoc' ? detachSuperDoc : detachExam
      const r = detach(this.ctx.store(), target.uuid)
      if ('error' in r) return { error: r.error }
      this.ctx.commit(r.store)
      return { ok: true, note: '已解开「' + target.title + '」与「' + this.title + '」的绑定：它现在是独立节点（内容原样保留），可以拖线绑到别的文档' }
    }
    // 挂载的项目节点：摘线 = 拆那条树边（声明与路径原样，它变成游离项目卡）
    if (target.kind === 'project' && this.ctx.store().edges.some((e) => e.from === this.uuid && e.to === target.uuid)) {
      this.ctx.commit(removeEdge(this.ctx.store(), this.uuid, target.uuid))
      return { ok: true, note: '已把项目「' + target.title + '」从「' + this.title + '」之下摘出来（声明与授权不受影响）' }
    }
    return { error: '这条连线摘不了（能解的：自己那份大纲、名下的挂件与项目）' }
  }
}
