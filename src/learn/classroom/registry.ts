/**
 * 课堂组件与动效注册中心 (Classroom Registry)
 *
 * 统一管理内置与外部动态注册的教学组件 (UI Components) 与动效 (Anime.js Animations)。
 * 支持：
 * 1. 查询全部组件与动效（供卡牌展示页面与 Agent execute api 动态检索）；
 * 2. 外部注册组件与动效（支持持久化存储在 localStorage 中）；
 * 3. 供 components.ts 与 animations.ts 在渲染与播放时无缝调度。
 */

export interface ClassroomComponentDef {
  tag: string
  name: string
  description: string
  category: 'layout' | 'content' | 'interactive' | 'visual' | 'custom'
  source: 'builtin' | 'external'
  template?: string
  defaultProps?: Record<string, string>
  example: string
  createdAt?: number
}

export interface ClassroomAnimationDef {
  verb: string
  name: string
  description: string
  category?: 'entrance' | 'focus' | 'motion' | 'data'
  recommendedSfx?: string
  source: 'builtin' | 'external'
  keyframes?: Record<string, unknown> | Array<Record<string, unknown>>
  duration?: number
  easing?: string
  example: string
  createdAt?: number
}

export { BUILTIN_COMPONENTS, BUILTIN_ANIMATIONS } from './builtinCatalog'
import { BUILTIN_COMPONENTS, BUILTIN_ANIMATIONS } from './builtinCatalog'

const STORAGE_KEY_COMPONENTS = 'moji:classroom:custom_components'
const STORAGE_KEY_ANIMATIONS = 'moji:classroom:custom_animations'

function safeReadStorage<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined' || !window.localStorage) return fallback
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function safeWriteStorage<T>(key: string, val: T): void {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    localStorage.setItem(key, JSON.stringify(val))
  } catch (e) {
    console.warn('[classroom registry] 存储失败:', e)
  }
}

/** 外部注册的组件表（内存镜像） */
let externalComponentsCache: ClassroomComponentDef[] | null = null
/** 外部注册的动效表（内存镜像） */
let externalAnimationsCache: ClassroomAnimationDef[] | null = null

function getExternalComponents(): ClassroomComponentDef[] {
  if (externalComponentsCache === null) {
    externalComponentsCache = safeReadStorage<ClassroomComponentDef[]>(STORAGE_KEY_COMPONENTS, [])
  }
  return externalComponentsCache
}

function getExternalAnimations(): ClassroomAnimationDef[] {
  if (externalAnimationsCache === null) {
    externalAnimationsCache = safeReadStorage<ClassroomAnimationDef[]>(STORAGE_KEY_ANIMATIONS, [])
  }
  return externalAnimationsCache
}

/** 查询所有已注册教学组件（包括内置与外部） */
export function listClassroomComponents(filter?: {
  source?: 'builtin' | 'external'
  query?: string
}): ClassroomComponentDef[] {
  const builtins = BUILTIN_COMPONENTS
  const externals = getExternalComponents()
  let list = [...builtins, ...externals]

  if (filter?.source) {
    list = list.filter((c) => c.source === filter.source)
  }
  if (filter?.query && filter.query.trim()) {
    const q = filter.query.trim().toLowerCase()
    list = list.filter(
      (c) =>
        c.tag.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q),
    )
  }
  return list
}

/** 查询所有已注册动效（包括内置与外部） */
export function listClassroomAnimations(filter?: {
  source?: 'builtin' | 'external'
  query?: string
}): ClassroomAnimationDef[] {
  const builtins = BUILTIN_ANIMATIONS
  const externals = getExternalAnimations()
  let list = [...builtins, ...externals]

  if (filter?.source) {
    list = list.filter((a) => a.source === filter.source)
  }
  if (filter?.query && filter.query.trim()) {
    const q = filter.query.trim().toLowerCase()
    list = list.filter(
      (a) =>
        a.verb.toLowerCase().includes(q) ||
        a.name.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q),
    )
  }
  return list
}

/** 获取单项组件定义 */
export function getClassroomComponent(tag: string): ClassroomComponentDef | undefined {
  const cleanTag = tag.trim().toLowerCase()
  return (
    BUILTIN_COMPONENTS.find((c) => c.tag.toLowerCase() === cleanTag) ||
    getExternalComponents().find((c) => c.tag.toLowerCase() === cleanTag)
  )
}

/** 获取单项动效定义 */
export function getClassroomAnimation(verb: string): ClassroomAnimationDef | undefined {
  const cleanVerb = verb.trim().toLowerCase()
  return (
    BUILTIN_ANIMATIONS.find((a) => a.verb.toLowerCase() === cleanVerb) ||
    getExternalAnimations().find((a) => a.verb.toLowerCase() === cleanVerb)
  )
}

/** 注册外部自定义教学组件 */
export function registerClassroomComponent(def: {
  tag: string
  name: string
  description: string
  template?: string
  category?: 'layout' | 'content' | 'interactive' | 'visual' | 'custom'
  defaultProps?: Record<string, string>
  example?: string
}): { ok: boolean; message?: string } {
  const cleanTag = def.tag.trim().toLowerCase()
  if (!cleanTag.startsWith('ui-') && !cleanTag.startsWith('x-')) {
    return { ok: false, message: '组件标签必须以 ui- 或 x- 开头，例如 ui-experiment' }
  }
  if (BUILTIN_COMPONENTS.some((c) => c.tag.toLowerCase() === cleanTag)) {
    return { ok: false, message: `无法覆盖内置组件: <${cleanTag}>` }
  }

  const current = getExternalComponents()
  const nextItem: ClassroomComponentDef = {
    tag: cleanTag,
    name: def.name.trim() || cleanTag,
    description: def.description.trim() || '外部注册组件',
    category: def.category || 'custom',
    source: 'external',
    template: def.template,
    defaultProps: def.defaultProps,
    example: def.example || `<${cleanTag}>\n  <div>内容</div>\n</${cleanTag}>`,
    createdAt: Date.now(),
  }

  const filtered = current.filter((c) => c.tag.toLowerCase() !== cleanTag)
  const next = [...filtered, nextItem]
  externalComponentsCache = next
  safeWriteStorage(STORAGE_KEY_COMPONENTS, next)
  return { ok: true, message: `成功注册组件 <${cleanTag}>` }
}

/** 注册外部自定义动效 */
export function registerClassroomAnimation(def: {
  verb: string
  name: string
  description: string
  keyframes?: Record<string, unknown> | Array<Record<string, unknown>>
  duration?: number
  easing?: string
  example?: string
}): { ok: boolean; message?: string } {
  const cleanVerb = def.verb.trim()
  if (!cleanVerb) {
    return { ok: false, message: '动效名称 (verb) 不能为空' }
  }
  if (BUILTIN_ANIMATIONS.some((a) => a.verb.toLowerCase() === cleanVerb.toLowerCase())) {
    return { ok: false, message: `无法覆盖内置动效: ${cleanVerb}` }
  }

  const current = getExternalAnimations()
  const nextItem: ClassroomAnimationDef = {
    verb: cleanVerb,
    name: def.name.trim() || cleanVerb,
    description: def.description.trim() || '外部注册动效',
    source: 'external',
    keyframes: def.keyframes,
    duration: def.duration || 600,
    easing: def.easing || 'easeOutQuad',
    example: def.example || `data-anim="${cleanVerb}"`,
    createdAt: Date.now(),
  }

  const filtered = current.filter((a) => a.verb.toLowerCase() !== cleanVerb.toLowerCase())
  const next = [...filtered, nextItem]
  externalAnimationsCache = next
  safeWriteStorage(STORAGE_KEY_ANIMATIONS, next)
  return { ok: true, message: `成功注册动效 ${cleanVerb}` }
}

/** 注销外部自定义组件 */
export function unregisterClassroomComponent(tag: string): boolean {
  const cleanTag = tag.trim().toLowerCase()
  const current = getExternalComponents()
  const next = current.filter((c) => c.tag.toLowerCase() !== cleanTag)
  if (next.length === current.length) return false
  externalComponentsCache = next
  safeWriteStorage(STORAGE_KEY_COMPONENTS, next)
  return true
}

/** 注销外部自定义动效 */
export function unregisterClassroomAnimation(verb: string): boolean {
  const cleanVerb = verb.trim().toLowerCase()
  const current = getExternalAnimations()
  const next = current.filter((a) => a.verb.toLowerCase() !== cleanVerb)
  if (next.length === current.length) return false
  externalAnimationsCache = next
  safeWriteStorage(STORAGE_KEY_ANIMATIONS, next)
  return true
}
