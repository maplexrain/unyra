/**
 * 课堂节点：16:9 画布互动教学课堂（画面 + 动作 + 时间轴）
 * 上游可挂载在教学文档 (doc) 下；子级可以是笔记 (note) / 考试 (exam) / 超级文档 (superdoc) / 文件 (file)。
 */
import { addEdge, removeEdge } from '../graph'
import { auditCourse } from '../classroom/audit'
import { loadClassroomEntity, upsertClassroom } from '../classroom/store'
import type { ClassroomEntity, LessonCourse } from '../classroom/types'
import { GNode, type ConnectFilter, type NodeCtx, type NodeHelp, type NodeRelation, type NodeResult } from './base'

export class ClassroomGNode extends GNode {
  constructor(ctx: NodeCtx, uuid: string) {
    super(ctx, uuid)
  }

  get kind(): 'classroom' {
    return 'classroom'
  }

  protected get kindLabel(): string {
    return '课堂'
  }

  /** 获取身后的持久化课堂实体 */
  private get entity(): ClassroomEntity {
    return loadClassroomEntity(this.uuid, '课堂', this.ctx.store())
  }

  get title(): string {
    return this.entity.title || '课堂'
  }

  exists(): boolean {
    return true
  }

  get relations(): NodeRelation[] {
    const s = this.ctx.store()
    const out: NodeRelation[] = []
    for (const edge of s.edges) {
      if (edge.from === this.uuid) {
        out.push({ id: edge.to, type: 'down', ...(edge.portKey ? { portKey: edge.portKey } : {}) })
      } else if (edge.to === this.uuid) {
        out.push({ id: edge.from, type: 'up', ...(edge.portKey ? { portKey: edge.portKey } : {}) })
      }
    }
    return out
  }

  get content(): unknown {
    const e = this.entity
    return {
      id: e.id,
      title: e.title,
      course: e.course,
      childNodeIds: this.relations.filter((r) => r.type === 'down').map((r) => r.id),
    }
  }

  editContent(next: unknown): NodeResult {
    const e = this.entity
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      return { error: '课堂内容需要是包含 title 或 course 的对象' }
    }
    const o = next as Record<string, unknown>
    if (typeof o.title === 'string' && o.title.trim()) {
      e.title = o.title.trim()
    }
    if (o.course !== undefined) {
      if (!o.course || typeof o.course !== 'object' || Array.isArray(o.course)) {
        return { error: 'course 需要是对象（{ courseId?, title?, scenes: [...] }）；结构契约先调 api.classroom.schema()' }
      }
      /*
       * 写入前结构校验（2026-11-18 定稿）：未知 verb、悬空 target、自造的 beats 字段
       * 曾经全部静默存盘、画面全静——errors 拒存并给可据此改对的原因，warnings 随
       * ok 回执带出。契约本身运行时向 api.classroom.schema() 现查。
       */
      const audit = auditCourse(o.course)
      if (audit.errors.length) {
        return {
          error: 'course 结构校验未通过，未保存（契约见 api.classroom.schema()）：\n- ' + audit.errors.join('\n- '),
        }
      }
      const course = o.course as Record<string, unknown>
      if (typeof course.courseId !== 'string' || !course.courseId.trim()) course.courseId = this.uuid
      if (typeof course.title !== 'string' || !course.title.trim()) course.title = e.title
      e.course = course as unknown as LessonCourse
      const nextStore = upsertClassroom(this.ctx.store(), e)
      this.ctx.commit(nextStore)
      return {
        ok: true,
        note: audit.warnings.length
          ? '已保存。' + audit.warnings.length + ' 条提醒（不影响保存，建议修掉）：\n- ' + audit.warnings.join('\n- ')
          : '已保存',
      }
    }
    if (typeof o.title !== 'string' || !o.title.trim()) {
      return { error: 'title 或 course 至少给一个' }
    }
    const nextStore = upsertClassroom(this.ctx.store(), e)
    this.ctx.commit(nextStore)
    return { ok: true }
  }

  onUpstream(node: GNode): ConnectFilter {
    if (node.kind !== 'doc' && node.kind !== 'superdoc') {
      return '课堂节点只能挂载在教学文档或超级文档之下'
    }
    return true
  }

  onDownstream(node: GNode): ConnectFilter {
    if (node.kind !== 'note' && node.kind !== 'exam' && node.kind !== 'superdoc' && node.kind !== 'file') {
      return '课堂节点的下级只能连接笔记、考试、超级文档或文件节点'
    }
    return true
  }

  protected link(down: GNode, portKey?: string): NodeResult {
    const s = this.ctx.store()
    const r = addEdge(s, this.uuid, down.uuid, portKey)
    if (!r.added) return { error: r.reason ?? '连接失败' }
    this.ctx.commit(r.store)
    return { ok: true, note: '已将「' + down.title + '」作为下级连接到「' + this.title + '」' }
  }

  protected unlink(target: GNode): NodeResult {
    const s = this.ctx.store()
    this.ctx.commit(removeEdge(s, this.uuid, target.uuid))
    return { ok: true, note: '已断开与「' + target.title + '」的连接' }
  }

  help(): NodeHelp {
    return {
      description: '16:9 画布互动教学课堂（1920×1080 逻辑画布），由画面 html + 动作流 actions + 时间轴构成，驱动 H5 动画与语音讲解。',
      edit: 'editContent({ title?, course? }) 写入课件；course 完整契约（scenes[].html / actions[].speak·visual·wait·checkpoint、动词白名单、布局常量与最小示例）调 api.classroom.schema() 现查——动作列表字段名是 actions，不是 beats；写入时做结构校验，错误会拒存并回原因。',
      connection: '上游挂载教学文档；下游可挂接随堂笔记、随堂考试、拓展超级文档或配套文件。',
    }
  }
}
