/**
 * 设置 → 设计：四个资源库的统一视图模型。
 *
 * 文档组件、课堂组件、课堂动效、课堂音效原本分散在三处页面；设计页只认这一份
 * `DesignItem` 列表。内置项只读，外部项带 file（doc-design/*.tsx）可在应用文件页签编辑。
 */
import {
  listDocumentComponents,
  type DocumentComponentDef,
} from '../../../lib/componentBlock'
import {
  listClassroomAnimations,
  listClassroomComponents,
  type ClassroomAnimationDef,
  type ClassroomComponentDef,
} from '../../../learn/classroom/registry'
import { listSfx } from '../../../learn/classroom/sfx/sfxLibrary'
import type { SfxMeta } from '../../../learn/classroom/sfx/sfxLibrary'

export type DesignKind = 'doc' | 'classroom-component' | 'classroom-animation' | 'classroom-sound'

export interface DesignItem {
  kind: DesignKind
  id: string
  name: string
  tag: string
  description: string
  source: 'builtin' | 'external'
  file?: string
  example: string
  doc?: DocumentComponentDef
  component?: ClassroomComponentDef
  animation?: ClassroomAnimationDef
  sound?: SfxMeta
}

function matches(item: DesignItem, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return (
    item.name.toLowerCase().includes(q) ||
    item.tag.toLowerCase().includes(q) ||
    item.description.toLowerCase().includes(q) ||
    (item.file ?? '').toLowerCase().includes(q)
  )
}

function externalFirst<T extends { source: 'builtin' | 'external' }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    if (a.source !== b.source) return a.source === 'external' ? -1 : 1
    return 0
  })
}

export function buildDesignItems(kind: DesignKind, query = ''): DesignItem[] {
  if (kind === 'doc') {
    return externalFirst(listDocumentComponents()).map((doc) => ({
      kind,
      id: doc.id,
      name: doc.name,
      tag: doc.tag,
      description: doc.description,
      source: doc.source,
      file: doc.file,
      example: doc.example,
      doc,
    })).filter((item) => matches(item, query))
  }

  if (kind === 'classroom-component') {
    return externalFirst(listClassroomComponents()).map((component) => ({
      kind,
      id: component.tag,
      name: component.name,
      tag: component.tag,
      description: component.description,
      source: component.source,
      file: component.file,
      example: component.example,
      component,
    })).filter((item) => matches(item, query))
  }

  if (kind === 'classroom-animation') {
    return externalFirst(listClassroomAnimations()).map((animation) => ({
      kind,
      id: animation.verb,
      name: animation.name,
      tag: animation.verb,
      description: animation.description,
      source: animation.source,
      file: animation.file,
      example: animation.example,
      animation,
    })).filter((item) => matches(item, query))
  }

  const soundItems: DesignItem[] = listSfx().map((sound) => ({
    kind: 'classroom-sound',
    id: sound.name,
    name: sound.label,
    tag: sound.name,
    description: [sound.mood, sound.use].filter(Boolean).join(' · '),
    source: sound.source === 'external' ? 'external' : 'builtin',
    file: sound.file,
    example: '',
    sound,
  }))
  return externalFirst(soundItems).filter((item) => matches(item, query))
}

export function designKindLabel(kind: DesignKind): string {
  return {
    doc: '文档组件',
    'classroom-component': '课堂组件',
    'classroom-animation': '课堂动效',
    'classroom-sound': '课堂音效',
  }[kind]
}

export function designKindShort(kind: DesignKind): string {
  return {
    doc: '文档',
    'classroom-component': '组件',
    'classroom-animation': '动效',
    'classroom-sound': '音效',
  }[kind]
}
