/**
 * execute 沙箱: classroom.* api 实现
 *
 * 允许 Agent 动态查询可用的课堂教学组件与动效，
 * 并支持动态创作与注册新组件与新动效。
 */
import {
  listClassroomComponents,
  listClassroomAnimations,
  registerClassroomComponent,
  registerClassroomAnimation,
  type ClassroomComponentDef,
  type ClassroomAnimationDef,
} from '../../../learn/classroom/registry'
import { asRecord } from '../refs'
import { wrapApi } from '../wrap'
import type { SandboxCall } from '../types'

export function installClassroom(api: Record<string, unknown>, log: SandboxCall[]): void {
  // 1. 查询可用组件
  wrapApi(
    api,
    'classroom.components',
    (args): { ok: true; components: ClassroomComponentDef[] } => {
      const opts = asRecord(args[0])
      const source =
        opts.source === 'builtin' || opts.source === 'external' ? opts.source : undefined
      const query = typeof opts.query === 'string' ? opts.query : undefined
      const components = listClassroomComponents({ source, query })
      return { ok: true, components }
    },
    log,
  )

  // 2. 查询可用动效
  wrapApi(
    api,
    'classroom.animations',
    (args): { ok: true; animations: ClassroomAnimationDef[] } => {
      const opts = asRecord(args[0])
      const source =
        opts.source === 'builtin' || opts.source === 'external' ? opts.source : undefined
      const query = typeof opts.query === 'string' ? opts.query : undefined
      const animations = listClassroomAnimations({ source, query })
      return { ok: true, animations }
    },
    log,
  )

  // 3. 注册新教学组件
  wrapApi(
    api,
    'classroom.registerComponent',
    (args): { ok: boolean; message?: string } => {
      const opts = asRecord(args[0])
      const tag = typeof opts.tag === 'string' ? opts.tag : ''
      const name = typeof opts.name === 'string' ? opts.name : tag
      const description = typeof opts.description === 'string' ? opts.description : ''
      const template = typeof opts.template === 'string' ? opts.template : ''
      const category = (opts.category as ClassroomComponentDef['category']) || 'custom'
      const defaultProps =
        typeof opts.defaultProps === 'object' && opts.defaultProps !== null
          ? (opts.defaultProps as Record<string, string>)
          : undefined
      const example = typeof opts.example === 'string' ? opts.example : undefined

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

  // 4. 注册新动效
  wrapApi(
    api,
    'classroom.registerAnimation',
    (args): { ok: boolean; message?: string } => {
      const opts = asRecord(args[0])
      const verb = typeof opts.verb === 'string' ? opts.verb : ''
      const name = typeof opts.name === 'string' ? opts.name : verb
      const description = typeof opts.description === 'string' ? opts.description : ''
      const keyframes =
        typeof opts.keyframes === 'object' && opts.keyframes !== null
          ? (opts.keyframes as Record<string, unknown> | Array<Record<string, unknown>>)
          : undefined
      const duration = typeof opts.duration === 'number' ? opts.duration : undefined
      const easing = typeof opts.easing === 'string' ? opts.easing : undefined
      const example = typeof opts.example === 'string' ? opts.example : undefined

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
}
