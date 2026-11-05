/**
 * 文件节点的数据层：目标 × 文件/网页的绑定表（store.fileNodes，见 types 的 FileNodeEntity）。
 *
 * 节点宇宙中的文件节点分为：
 * - 本地文件 (local)：只能引用存储在 docs/{目标}/files/ 下的文件。
 * - 网页文件 (web)：网页 URL（无特别限制）。
 * 一个文件节点只能绑定一个文件或网页。
 *
 * 目标级数据：落盘在各自目标目录的 file-nodes.json（含下级/相关连线）。
 */

import { removeEdge } from './graph'
import { FILES_DIR } from './layout'
import { goalDirOf } from './static/location'
import type { FileNodeEntity, FileNodeKind, LearnStore } from './types'
import { removeUserPath } from '../lib/storage'

/** 目标的文件目录：`docs/{目标}/files`；目标不存在时 null */
export function goalFilesDir(store: LearnStore, goalId: string): string | null {
  const dir = goalDirOf(store, goalId)
  return dir ? `${dir}/${FILES_DIR}` : null
}

export function fileNodeById(store: LearnStore, id: string): FileNodeEntity | undefined {
  return (store.fileNodes ?? []).find((f) => f.id === id)
}

export function fileNodesOf(store: LearnStore, goalId: string): FileNodeEntity[] {
  return (store.fileNodes ?? []).filter((f) => f.goalId === goalId)
}

/** 清洗安全的文件名（去除路径遍历与非法字符） */
export function sanitizeFileName(raw: string): string {
  const base = raw.replace(/[\\/]/g, '/').split('/').pop() ?? 'file'
  const cleaned = base.replace(/[<>:"|?*\x00-\x1f]/g, '_').trim()
  return cleaned || 'file'
}

/**
 * 规范化本地文件 URL：
 * 只能引用存储在 docs/{目标}/files/ 中的文件。
 * 返回统一格式：`files/{文件名}`。
 */
export function normalizeLocalFileUrl(raw: string): string {
  let s = raw.trim().replace(/\\/g, '/')
  // 去除可能的 docs/{goal}/files/ 前缀或 files/ 前缀，仅保留文件名
  const match = s.match(/(?:^|\/)files\/(.+)$/)
  if (match) {
    s = match[1]
  }
  const safeName = sanitizeFileName(s)
  return `${FILES_DIR}/${safeName}`
}

/**
 * 校验本地文件路径是否合法（只能在 files/ 目录下，禁止 .. 目录穿越）
 */
export function isValidLocalFileUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false
  const norm = url.trim().replace(/\\/g, '/')
  if (norm.includes('..')) return false
  return norm.startsWith(`${FILES_DIR}/`) || !norm.includes('/')
}

/** 新建文件节点（返回新 store 与实体） */
export function createFileNode(
  store: LearnStore,
  input: {
    goalId: string
    title?: string
    fileKind?: FileNodeKind
    url?: string
    id?: string
  },
  at = Date.now(),
): { store: LearnStore; entity: FileNodeEntity } {
  const fileKind: FileNodeKind = input.fileKind === 'web' ? 'web' : 'local'
  let rawUrl = (input.url ?? '').trim()
  let url = ''
  if (rawUrl) {
    url = fileKind === 'local' ? normalizeLocalFileUrl(rawUrl) : rawUrl
  }

  const defaultTitle = fileKind === 'local'
    ? (url ? url.split('/').pop() || '未命名本地文件' : '未命名本地文件')
    : (url || '未命名网页')

  const entity: FileNodeEntity = {
    id: input.id || `file-${crypto.randomUUID()}`,
    goalId: input.goalId,
    title: (input.title ?? '').trim() || defaultTitle,
    fileKind,
    url,
    createdAt: at,
    updatedAt: at,
  }

  const current = store.fileNodes ?? []
  return {
    store: { ...store, fileNodes: [...current, entity] },
    entity,
  }
}

/** 更新文件节点（标题、类型、URL） */
export function updateFileNode(
  store: LearnStore,
  id: string,
  patch: Partial<Pick<FileNodeEntity, 'title' | 'fileKind' | 'url'>>,
  at = Date.now(),
): { store: LearnStore; entity: FileNodeEntity } | { error: string } {
  const current = store.fileNodes ?? []
  const found = current.find((f) => f.id === id)
  if (!found) return { error: `找不到 ID 为「${id}」的文件节点` }

  const nextKind = patch.fileKind ?? found.fileKind
  let nextUrl = patch.url !== undefined ? patch.url.trim() : found.url

  if (nextUrl) {
    if (nextKind === 'local') {
      if (!isValidLocalFileUrl(nextUrl)) {
        return { error: '本地文件只能引用 docs/{目标}/files/ 目录下的文件，禁止路径穿越' }
      }
      nextUrl = normalizeLocalFileUrl(nextUrl)
    }
  }

  const next: FileNodeEntity = {
    ...found,
    ...(patch.title !== undefined ? { title: patch.title.trim() || found.title } : {}),
    fileKind: nextKind,
    url: nextUrl,
    updatedAt: at,
  }

  return {
    store: {
      ...store,
      fileNodes: current.map((f) => (f.id === id ? next : f)),
    },
    entity: next,
  }
}

/** 删除文件节点（同时清理相连的树边） */
export function removeFileNode(
  store: LearnStore,
  id: string,
): { store: LearnStore; removed?: FileNodeEntity } {
  const current = store.fileNodes ?? []
  const found = current.find((f) => f.id === id)
  if (!found) return { store }

  const nextFileNodes = current.filter((f) => f.id !== id)
  let nextStore: LearnStore = { ...store, fileNodes: nextFileNodes }
  for (const e of store.edges) {
    if (e.from === id || e.to === id) {
      nextStore = removeEdge(nextStore, e.from, e.to)
    }
  }

  return {
    store: nextStore,
    removed: found,
  }
}

/** 级联物理删除本地文件 */
export async function deleteLocalFileOfNode(store: LearnStore, entity: FileNodeEntity): Promise<boolean> {
  if (entity.fileKind !== 'local' || !entity.url) return false
  const dir = goalFilesDir(store, entity.goalId)
  if (!dir) return false
  const fileName = entity.url.replace(/^files\//, '')
  const rel = `${dir}/${fileName}`
  return removeUserPath(rel)
}

/** 读盘反序列化归一化 */
export function normalizeFileNodes(raw: unknown, goalIds?: ReadonlySet<string>): FileNodeEntity[] {
  if (!Array.isArray(raw)) return []
  const out: FileNodeEntity[] = []
  const seenIds = new Set<string>()

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    const id = typeof r.id === 'string' ? r.id.trim() : ''
    const goalId = typeof r.goalId === 'string' ? r.goalId.trim() : ''
    if (!id || !goalId || (goalIds && !goalIds.has(goalId)) || seenIds.has(id)) continue
    seenIds.add(id)

    if (r.fileKind !== 'local' && r.fileKind !== 'web') continue
    const fileKind: FileNodeKind = r.fileKind
    let url = typeof r.url === 'string' ? r.url.trim() : ''
    if (url && fileKind === 'local') {
      url = normalizeLocalFileUrl(url)
    }

    const title = typeof r.title === 'string' && r.title.trim()
      ? r.title.trim()
      : fileKind === 'local'
        ? (url ? url.split('/').pop() || '未命名本地文件' : '未命名本地文件')
        : (url || '未命名网页')

    const createdAt = typeof r.createdAt === 'number' && Number.isFinite(r.createdAt) ? r.createdAt : Date.now()
    const updatedAt = typeof r.updatedAt === 'number' && Number.isFinite(r.updatedAt) ? r.updatedAt : createdAt

    out.push({
      id,
      goalId,
      title,
      fileKind,
      url,
      createdAt,
      updatedAt,
    })
  }

  return out
}
