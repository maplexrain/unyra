/**
 * 课堂组件 / 动效 / 音效注册中心 (Classroom Registry)
 *
 * 内置项在 builtinCatalog 与 sfxLibrary；外部项统一是用户目录 `doc-design/*.tsx` 里的
 * 外部 TSX 文件（由 lib/externalModules 动态加载、保存后热更新），不再写 localStorage。
 *
 * 一个文件声明一种 kind：
 * - classroom-component：React component
 * - classroom-animation：Anime.js keyframes
 * - classroom-sound：play(v, kit) 的 WebAudio 合成配方
 */
import {
  classroomAnimationTemplate,
  classroomComponentTemplate,
  classroomSoundTemplate,
  deleteExternalModuleFile,
  externalModuleFileName,
  externalModuleSeed,
  getExternalModule,
  listExternalModules,
  subscribeExternalModules,
  writeExternalModuleFile,
  type ExternalClassroomAnimationDef,
  type ExternalClassroomComponentDef,
  type ExternalClassroomSoundDef,
} from '../../lib/externalModules'

export interface ClassroomComponentDef {
  tag: string
  name: string
  description: string
  category: 'layout' | 'content' | 'interactive' | 'visual' | 'custom'
  source: 'builtin' | 'external'
  defaultProps?: Record<string, string>
  example: string
  /** 外部组件：真正被渲染的 React 组件 */
  component?: ExternalClassroomComponentDef['component']
  /** 外部 TSX 文件（相对当前用户目录） */
  file?: string
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
  file?: string
  createdAt?: number
}

export interface ClassroomSoundDef {
  name: string
  label: string
  category: 'transition' | 'accent' | 'rhythm' | 'feedback'
  mood: string
  use: string
  description?: string
  recommended?: boolean
  defaultDuration?: number
  source: 'builtin' | 'external'
  file?: string
  play: (voice: unknown, kit: { tone: (opts: unknown) => void; noise: (opts: unknown) => void }) => void
}

export { BUILTIN_COMPONENTS, BUILTIN_ANIMATIONS } from './builtinCatalog'
import { BUILTIN_COMPONENTS, BUILTIN_ANIMATIONS } from './builtinCatalog'

type Listener = () => void
const listeners = new Set<Listener>()

function notify(): void {
  for (const fn of listeners) {
    try {
      fn()
    } catch {}
  }
}

subscribeExternalModules(notify)

/** 订阅课堂注册表变化（外部 TSX 热更新也算） */
export function subscribeClassroomRegistry(cb: Listener): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function externalComponents(): ClassroomComponentDef[] {
  return listExternalModules('classroom-component').map((record) => {
    const raw = record.def as unknown as ExternalClassroomComponentDef
    return {
      tag: String(raw.tag ?? record.id),
      name: String(raw.name ?? raw.tag ?? record.id),
      description: String(raw.description ?? '外部注册组件'),
      category: (raw.category ?? 'custom') as ClassroomComponentDef['category'],
      source: 'external' as const,
      defaultProps: raw.defaultProps,
      example: String(raw.example ?? `<${String(raw.tag ?? record.id)}>\n  <div>内容</div>\n</${String(raw.tag ?? record.id)}>`),
      component: typeof raw.component === 'function' ? raw.component : undefined,
      file: record.file,
      createdAt: record.loadedAt,
    }
  })
}

function externalAnimations(): ClassroomAnimationDef[] {
  return listExternalModules('classroom-animation').map((record) => {
    const raw = record.def as unknown as ExternalClassroomAnimationDef
    return {
      verb: String(raw.verb ?? record.id),
      name: String(raw.name ?? raw.verb ?? record.id),
      description: String(raw.description ?? '外部注册动效'),
      recommendedSfx: raw.recommendedSfx || undefined,
      source: 'external' as const,
      keyframes: raw.keyframes,
      duration: raw.duration || 600,
      easing: raw.easing || 'easeOutQuad',
      example: String(raw.example ?? `<div data-anim="${String(raw.verb ?? record.id)}">${String(raw.name ?? raw.verb ?? record.id)}</div>`),
      file: record.file,
      createdAt: record.loadedAt,
    }
  })
}

function externalSounds(): ClassroomSoundDef[] {
  return listExternalModules('classroom-sound').map((record) => {
    const raw = record.def as unknown as ExternalClassroomSoundDef
    return {
      name: String(raw.name ?? record.id),
      label: String(raw.label ?? raw.name ?? record.id),
      category: (['transition', 'accent', 'rhythm', 'feedback'].includes(String(raw.category))
        ? raw.category
        : 'feedback') as ClassroomSoundDef['category'],
      mood: String(raw.mood ?? '自定义'),
      use: String(raw.use ?? '自定义用法'),
      description: String(raw.description ?? ''),
      recommended: Boolean(raw.recommended),
      defaultDuration: raw.defaultDuration,
      source: 'external' as const,
      file: record.file,
      play: raw.play,
    }
  })
}

/** 查询所有已注册教学组件（包括内置与外部） */
export function listClassroomComponents(filter?: {
  source?: 'builtin' | 'external'
  query?: string
}): ClassroomComponentDef[] {
  let list = [...BUILTIN_COMPONENTS, ...externalComponents()]

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
  let list = [...BUILTIN_ANIMATIONS, ...externalAnimations()]

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
    externalComponents().find((c) => c.tag.toLowerCase() === cleanTag)
  )
}

/** 获取单项动效定义 */
export function getClassroomAnimation(verb: string): ClassroomAnimationDef | undefined {
  const cleanVerb = verb.trim().toLowerCase()
  return (
    BUILTIN_ANIMATIONS.find((a) => a.verb.toLowerCase() === cleanVerb) ||
    externalAnimations().find((a) => a.verb.toLowerCase() === cleanVerb)
  )
}

/** 获取外部音效（内置音效仍从 sfxLibrary 取；重名时外部优先由引擎决定） */
export function getExternalClassroomSound(name: string): ClassroomSoundDef | undefined {
  const clean = name.trim().toLowerCase()
  return externalSounds().find((s) => s.name.toLowerCase() === clean)
}

export function listExternalClassroomSounds(filter?: { query?: string }): ClassroomSoundDef[] {
  let list = externalSounds()
  if (filter?.query?.trim()) {
    const q = filter.query.trim().toLowerCase()
    list = list.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.label.toLowerCase().includes(q) ||
        s.description?.toLowerCase().includes(q),
    )
  }
  return list
}

/** 注册外部自定义教学组件（写 doc-design/classroom-component--<tag>.tsx） */
export async function registerClassroomComponent(def: {
  tag: string
  name: string
  description: string
  category?: ClassroomComponentDef['category']
  defaultProps?: Record<string, string>
  example?: string
  source?: string
}): Promise<{ ok: boolean; message?: string; file?: string }> {
  const cleanTag = def.tag.trim().toLowerCase()
  if (!cleanTag.startsWith('ui-') && !cleanTag.startsWith('x-')) {
    return { ok: false, message: '组件标签必须以 ui- 或 x- 开头，例如 ui-experiment' }
  }
  if (BUILTIN_COMPONENTS.some((c) => c.tag.toLowerCase() === cleanTag)) {
    return { ok: false, message: `无法覆盖内置组件: <${cleanTag}>` }
  }

  const source =
    def.source ??
    classroomComponentTemplate({
      tag: cleanTag,
      name: def.name.trim() || cleanTag,
      description: def.description.trim() || '外部注册组件',
      category: def.category === 'custom' ? 'visual' : def.category,
      defaultProps: def.defaultProps,
      example: def.example,
    })
  const written = await writeExternalModuleFile(externalModuleFileName('classroom-component', cleanTag), source)
  if (!written.ok) return { ok: false, message: written.error, file: written.file }
  return { ok: true, message: `成功注册组件 <${cleanTag}>（${written.file}）`, file: written.file }
}

/** 注册外部自定义动效（写 doc-design/classroom-animation--<verb>.tsx） */
export async function registerClassroomAnimation(def: {
  verb: string
  name: string
  description: string
  keyframes?: Record<string, unknown> | Array<Record<string, unknown>>
  duration?: number
  easing?: string
  recommendedSfx?: string
  example?: string
  source?: string
}): Promise<{ ok: boolean; message?: string; file?: string }> {
  const cleanVerb = def.verb.trim()
  if (!cleanVerb) {
    return { ok: false, message: '动效名称 (verb) 不能为空' }
  }
  if (BUILTIN_ANIMATIONS.some((a) => a.verb.toLowerCase() === cleanVerb.toLowerCase())) {
    return { ok: false, message: `无法覆盖内置动效: ${cleanVerb}` }
  }

  const source =
    def.source ??
    classroomAnimationTemplate({
      verb: cleanVerb,
      name: def.name.trim() || cleanVerb,
      description: def.description.trim() || '外部注册动效',
      keyframes: def.keyframes,
      duration: def.duration,
      easing: def.easing,
      recommendedSfx: def.recommendedSfx,
      example: def.example,
    })
  const written = await writeExternalModuleFile(externalModuleFileName('classroom-animation', cleanVerb), source)
  if (!written.ok) return { ok: false, message: written.error, file: written.file }
  return { ok: true, message: `成功注册动效 ${cleanVerb}（${written.file}）`, file: written.file }
}

/** 注册外部自定义音效（写 doc-design/classroom-sound--<name>.tsx） */
export async function registerClassroomSound(def: {
  name: string
  label: string
  description: string
  category?: ClassroomSoundDef['category']
  mood?: string
  use?: string
  defaultDuration?: number
  recommended?: boolean
  source?: string
}): Promise<{ ok: boolean; message?: string; file?: string }> {
  const cleanName = def.name.trim()
  if (!cleanName) return { ok: false, message: '音效名称 (name) 不能为空' }
  if (!/^[a-zA-Z0-9_-]+$/.test(cleanName)) {
    return { ok: false, message: '音效名称只能包含字母、数字、下划线与短横线' }
  }
  if (getExternalClassroomSound(cleanName)) {
    return { ok: false, message: `音效已存在: ${cleanName}` }
  }

  const source =
    def.source ??
    classroomSoundTemplate({
      name: cleanName,
      label: def.label.trim() || cleanName,
      description: def.description.trim() || '外部注册音效',
      category: def.category,
      mood: def.mood,
      use: def.use,
      defaultDuration: def.defaultDuration,
      recommended: def.recommended,
    })
  const written = await writeExternalModuleFile(externalModuleFileName('classroom-sound', cleanName), source)
  if (!written.ok) return { ok: false, message: written.error, file: written.file }
  return { ok: true, message: `成功注册音效 ${cleanName}（${written.file}）`, file: written.file }
}

/** 直接新建课堂组件模板文件（唯一 tag + 可运行模板），调用方打开源码即可编辑。 */
export async function createClassroomComponentFile(): Promise<{ ok: boolean; message?: string; file?: string }> {
  const tag = externalModuleSeed('ui-new').toLowerCase()
  return registerClassroomComponent({
    tag,
    name: '未命名课堂组件',
    description: '直接编辑这个 TSX 文件里的 tag / name / component；保存后自动热更新。',
  })
}

/** 直接新建课堂动效模板文件（唯一 verb + Anime.js 关键帧）。 */
export async function createClassroomAnimationFile(): Promise<{ ok: boolean; message?: string; file?: string }> {
  const verb = externalModuleSeed('new').toLowerCase()
  return registerClassroomAnimation({
    verb,
    name: '未命名课堂动效',
    description: '直接编辑这个 TSX 文件里的 verb / keyframes / duration；保存后自动热更新。',
  })
}

/** 直接新建课堂音效模板文件（唯一 name + play(v, kit) 模板）。 */
export async function createClassroomSoundFile(): Promise<{ ok: boolean; message?: string; file?: string }> {
  const name = externalModuleSeed('sound').toLowerCase()
  return registerClassroomSound({
    name,
    label: '未命名课堂音效',
    description: '直接编辑这个 TSX 文件里的 play(v, kit) 合成参数；保存后自动热更新。',
  })
}

/** 注销外部自定义组件 */
export async function unregisterClassroomComponent(tag: string): Promise<boolean> {  const record = getExternalModule('classroom-component', tag)
  if (!record) return false
  const res = await deleteExternalModuleFile(record.fileName)
  return res.ok
}

/** 注销外部自定义动效 */
export async function unregisterClassroomAnimation(verb: string): Promise<boolean> {
  const record = getExternalModule('classroom-animation', verb)
  if (!record) return false
  const res = await deleteExternalModuleFile(record.fileName)
  return res.ok
}

/** 注销外部自定义音效 */
export async function unregisterClassroomSound(name: string): Promise<boolean> {
  const record = getExternalModule('classroom-sound', name)
  if (!record) return false
  const res = await deleteExternalModuleFile(record.fileName)
  return res.ok
}
