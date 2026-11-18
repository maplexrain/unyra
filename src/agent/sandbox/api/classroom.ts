/**
 * execute 沙箱: classroom.* api 实现
 *
 * 查询 course 结构契约（schema）、时间轴动词白名单（verbs）、可用组件与动效
 * （components / animations）、课件静态体检（check），并支持动态创作与注册
 * 新组件与新动效（registerComponent / registerAnimation）。
 *
 * schema / verbs 的载荷唯一事实源在 learn/classroom 的 contract.ts / verbs.ts；
 * 体检与 editContent 的写入校验共用 audit.ts——实现与文档不再各写一份。
 */
import {
  listClassroomComponents,
  listClassroomAnimations,
  registerClassroomComponent,
  registerClassroomAnimation,
  type ClassroomComponentDef,
  type ClassroomAnimationDef,
} from '../../../learn/classroom/registry'
import { classroomSchemaPayload } from '../../../learn/classroom/contract'
import { verbCatalog } from '../../../learn/classroom/verbs'
import { auditCourse } from '../../../learn/classroom/audit'
import type { LessonCourse } from '../../../learn/classroom/types'
import { asRecord, asText } from '../refs'
import { wrapApi } from '../wrap'
import type { SandboxCall, SandboxOptions } from '../types'

export function installClassroom(api: Record<string, unknown>, opts: SandboxOptions, log: SandboxCall[]): void {
  // 1. course 结构契约（写课件前必看）
  wrapApi(api, 'classroom.schema', (): { ok: true; schema: Record<string, unknown> } => {
    return { ok: true, schema: classroomSchemaPayload() }
  }, log)

  // 2. action.verb 时间轴动词白名单（与 data-anim 是两套表）
  wrapApi(api, 'classroom.verbs', (): Record<string, unknown> => {
    const catalog = verbCatalog()
    return {
      ok: true,
      ...catalog,
      note: 'state = 时间轴状态动词（可逆、seek 可重现）；anime = 走 anime.js 通道的动画动词。data-anim 是另一套幕挂载入场表：api.classroom.animations()',
    }
  }, log)

  // 3. 查询可用组件
  wrapApi(
    api,
    'classroom.components',
    (args): { ok: true; components: ClassroomComponentDef[] } => {
      const o = asRecord(args[0])
      const source =
        o.source === 'builtin' || o.source === 'external' ? o.source : undefined
      const query = typeof o.query === 'string' ? o.query : undefined
      const components = listClassroomComponents({ source, query })
      return { ok: true, components }
    },
    log,
  )

  // 4. 查询可用动效（data-anim 入场表，不是 action.verb 白名单）
  wrapApi(
    api,
    'classroom.animations',
    (args): { ok: true; animations: ClassroomAnimationDef[] } => {
      const o = asRecord(args[0])
      const source =
        o.source === 'builtin' || o.source === 'external' ? o.source : undefined
      const query = typeof o.query === 'string' ? o.query : undefined
      const animations = listClassroomAnimations({ source, query })
      return { ok: true, animations }
    },
    log,
  )

  // 5. 注册新教学组件
  wrapApi(
    api,
    'classroom.registerComponent',
    (args): { ok: boolean; message?: string } => {
      const o = asRecord(args[0])
      const tag = typeof o.tag === 'string' ? o.tag : ''
      const name = typeof o.name === 'string' ? o.name : tag
      const description = typeof o.description === 'string' ? o.description : ''
      const template = typeof o.template === 'string' ? o.template : ''
      const category = (o.category as ClassroomComponentDef['category']) || 'custom'
      const defaultProps =
        typeof o.defaultProps === 'object' && o.defaultProps !== null
          ? (o.defaultProps as Record<string, string>)
          : undefined
      const example = typeof o.example === 'string' ? o.example : undefined

      if (!tag) {
        return { ok: false, message: '必须指定组件标签名 tag，如 ui-experiment' }
      }
      return registerClassroomComponent({
        tag,
        name,
        description,
        template,
        category,
        defaultProps,
        example,
      })
    },
    log,
  )

  // 6. 注册新动效
  wrapApi(
    api,
    'classroom.registerAnimation',
    (args): { ok: boolean; message?: string } => {
      const o = asRecord(args[0])
      const verb = typeof o.verb === 'string' ? o.verb : ''
      const name = typeof o.name === 'string' ? o.name : verb
      const description = typeof o.description === 'string' ? o.description : ''
      const keyframes =
        typeof o.keyframes === 'object' && o.keyframes !== null
          ? (o.keyframes as Record<string, unknown> | Array<Record<string, unknown>>)
          : undefined
      const duration = typeof o.duration === 'number' ? o.duration : undefined
      const easing = typeof o.easing === 'string' ? o.easing : undefined
      const example = typeof o.example === 'string' ? o.example : undefined

      if (!verb) {
        return { ok: false, message: '必须指定动效动作名 verb，如 spiralZoom' }
      }
      return registerClassroomAnimation({
        verb,
        name,
        description,
        keyframes,
        duration,
        easing,
        example,
      })
    },
    log,
  )

  // 7. 静态体检（不渲染画面）：动词白名单 / target 对号 / 字幕纪律 / data-hidden 语义
  wrapApi(
    api,
    'classroom.check',
    (args): Record<string, unknown> => {
      const service = opts.nodes?.service()
      if (!service) return { error: '这一轮没有节点能力（宿主未注入 NodeService）' }
      const o = asRecord(args[0])
      const uuid = asText(o.target).trim()
      if (!uuid) return { error: 'classroom.check 要给课堂节点 uuid：{ target: 课堂uuid }' }
      const node = service.get(uuid)
      if (!node) return { error: '没有 uuid 为「' + uuid + '」的节点；先 api.node.list() 查清楚' }
      if (node.kind !== 'classroom') return { error: '「' + uuid + '」是 ' + node.kind + ' 节点，不是课堂节点' }
      const content = (node as unknown as { content: { course?: LessonCourse } }).content
      const audit = auditCourse(content?.course)
      const summary = audit.errors.length
        ? audit.errors.length + ' 个错误，' + audit.warnings.length + ' 条提醒（错误要修复：editContent 修好后重交）'
        : audit.warnings.length
          ? '结构通过，' + audit.warnings.length + ' 条提醒'
          : '体检通过'
      return { ok: true, target: uuid, ...audit, summary }
    },
    log,
  )
}
