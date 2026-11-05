/**
 * 试卷节点：一次出卷 + 历次作答。叶子，上游恒为归属文档。
 *
 * uuid 就是 Exam.id。content 只含**卷面**（title / kind / level / minutes / questions）；
 * attempts 是学习者的作答事实，不进 content、editContent 也绝不触碰它们。
 * 出题入参的容错解析全部复用 learn/exam 的 parseQuestions（能把二十来种毛病
 * 压成一句模型能改对的话），时限下限同样由 resolveExamMinutes 兜底。
 */
import { addEdge, nodeById, removeEdge, upsertExam } from '../graph'
import { detachExam } from '../detached'
import { normalizeKind, normalizeLevel, parseQuestions, questionsMix, resolveExamMinutes, examTotalPoints } from '../exam'
import type { Exam } from '../exam'
import { GNode, type ConnectFilter, type NodeCtx, type NodeHelp, type NodeRelation, type NodeResult } from './base'

export class ExamGNode extends GNode {
  constructor(ctx: NodeCtx, uuid: string) {
    super(ctx, uuid)
  }

  get kind(): 'exam' {
    return 'exam'
  }

  protected get kindLabel(): string {
    return '试卷'
  }

  private get record(): Exam | undefined {
    return this.ctx.store().exams.find((e) => e.id === this.uuid)
  }

  get title(): string {
    return this.record?.title ?? this.uuid
  }

  exists(): boolean {
    return !!this.record
  }

  private get ownerTitle(): string {
    const e = this.record
    return e ? (nodeById(this.ctx.store(), e.nodeId)?.title ?? '？') : '？'
  }

  get relations(): NodeRelation[] {
    const e = this.record
    const out: NodeRelation[] = []
    if (e && nodeById(this.ctx.store(), e.nodeId)) {
      out.push({ id: e.nodeId, type: 'up' })
    }
    for (const edge of this.ctx.store().edges) {
      if (edge.from === this.uuid) {
        out.push({ id: edge.to, type: 'down' })
      }
    }
    return out
  }

  get content(): unknown {
    const e = this.record
    if (!e) return { error: '这份试卷已经不在了（可能刚被删除）' }
    return { title: e.title, kind: e.kind, level: e.level, minutes: e.minutes, questions: e.questions }
  }

  editContent(next: unknown): NodeResult {
    const exam = this.record
    if (!exam) return { error: '这份试卷已经不在了（可能刚被删除）' }
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      return { error: '试卷内容是 { title?, kind?, level?, minutes?, questions } 对象（questions 是题目数组）' }
    }
    const o = next as Record<string, unknown>
    const parsed = parseQuestions(o.questions)
    if (!parsed.ok) return { error: parsed.message }
    const kind = normalizeKind(o.kind ?? exam.kind)
    const level = normalizeLevel(o.level ?? exam.level)
    const mins = resolveExamMinutes(o.minutes ?? exam.minutes, kind, parsed.questions.length)
    if (!mins.ok) return { error: mins.message }
    const title =
      typeof o.title === 'string' && o.title.trim()
        ? o.title.trim()
        : exam.questions.length === 0 && exam.attempts.length === 0
          ? this.record!.title
          : exam.title
    const nextExam: Exam = {
      ...exam,
      title,
      kind,
      level,
      minutes: mins.minutes,
      questions: parsed.questions,
      // attempts 是学习者的作答事实，原样保留（改卷面不动历史）
      attempts: exam.attempts,
    }
    this.ctx.commit(upsertExam(this.ctx.store(), nextExam))
    const mix = questionsMix(parsed.questions)
    const limit = mins.minutes > 0 ? '时限 ' + mins.minutes + ' 分钟' : '不限时'
    return {
      ok: true,
      note:
        '已落卷《' + title + '》：' + parsed.questions.length + ' 题（' + mix + '），' + limit +
        '，满分 ' + examTotalPoints(nextExam) + '。历次作答（' + exam.attempts.length + ' 次）原样保留',
    }
  }

  help(): NodeHelp {
    const e = this.record
    const empty = !e || (e.questions.length === 0 && e.attempts.length === 0)
    return {
      description:
        '试卷节点——「' + (e?.title ?? '？') + '」，挂在文档「' + this.ownerTitle + '」下。' +
        (e ? (empty ? '还是一份空卷（还没出题）。' : e.questions.length + ' 题，考过 ' + e.attempts.length + ' 次。') : ''),
      edit: [
        empty
          ? '这是一份空卷：await n.editContent({ questions }) 出题（title / kind / level / minutes 可选）。题目格式见下面的 schema。'
          : '改卷面：await n.content 读现状 → 改 → editContent 整份写回（换题、调时限都走这一条路）；学习者的历次作答（attempts）不在 content 里，也绝不会被动到。',
        'content 形状：{ title, kind, level, minutes, questions }；kind = "quiz"（随堂小测，不限时）/ "test"（单元测验）/ "exam"（综合大考）；level = "easy" | "medium" | "hard" | "extreme"；minutes 是整数分钟（quiz 恒为 0，其余下限 = 题目数 × 2）。',
        'questions 每题：{ id?, type, stem, options?, answer?, rubric?, image?, points? }——type = "single" | "multiple" | "truefalse" | "fill" | "short"；单选 / 多选 / 对错题必须给 options（对错题给 [{id:"true"},{id:"false"}]）；answer 是选项 id 数组（填空给答案串，简答通常留空待 rubric 评）；stem 支持 Markdown 与 LaTeX；image 收**完整 SVG 源码**（可选）。',
        '出题时 attempts 保持为空（不由你伪造）；判分与错题讲解走 api.exam.*（grade / explain），那是另一条业务通道。',
      ].join('\n'),
      connection: [
        '上游是归属文档：拖线 / connect(文档对象, "down") 换绑到别的文档（卷面与历次作答都不动，动的只是挂在谁那里）；disconnect 摘掉 = 变成游离的独立试卷。',
        '下游连接只能为笔记节点：拖线 / connect(笔记对象, "down") 将笔记作为下级接入。',
      ].join('\n'),
    }
  }

  onUpstream(node: GNode): ConnectFilter {
    if (node.kind !== 'doc' && node.kind !== 'file') return '试卷只能挂在文档或文件节点之下'
    return true
  }

  onDownstream(node: GNode): ConnectFilter {
    if (node.kind !== 'note' && node.kind !== 'file') return '考试节点的下级连接只能为笔记节点或文件节点'
    if (node.kind === 'note') {
      const upRelations = node.relations.filter((r) => r.type === 'up')
      if (upRelations.length > 0 && !upRelations.some((r) => r.id === this.uuid)) {
        return '笔记只能有一个上级节点'
      }
    }
    return true
  }

  protected link(down: GNode): NodeResult {
    if (down.kind !== 'note' && down.kind !== 'file') return { error: '考试节点的下级连接只能为笔记节点或文件节点' }
    const s = this.ctx.store()
    const r = addEdge(s, this.uuid, down.uuid)
    if (!r.added) return { error: r.reason ?? '连接失败' }
    this.ctx.commit(r.store)
    return { ok: true, note: '已把笔记「' + down.title + '」作为下级连接到《' + this.title + '》' }
  }

  /** 摘线 = 解绑：若断开的是与笔记的边则拆边；否则宿主 id 悬空变成游离试卷 */
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
    const r = detachExam(this.ctx.store(), this.uuid)
    if ('error' in r) return { error: r.error }
    this.ctx.commit(r.store)
    return { ok: true, note: '已解开《' + this.title + '》的绑定：它现在是独立的试卷（内容原样保留），可以拖线绑到别的文档' }
  }
}
