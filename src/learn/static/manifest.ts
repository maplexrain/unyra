/** 这个文件负责什么：资源清单的序列化与反序列化——manifestText 写出、parseManifest 读回（认不出的条目丢掉，不猜）。 */

import { typeOfExt } from './ext'
import type { StaticResource } from './types'

/**
 * 资源目录名与清单文件名的常量在 files.ts——那里是磁盘布局的唯一出处，
 * 而且顶层读循环依赖那一侧的绑定会在某些求值顺序下直接 TDZ 崩掉（见那边的说明）。
 */
/** 清单版本；结构变了才好迁移 */
export const MANIFEST_VERSION = 1

/* ---------- 清单（序列化） ---------- */

export const manifestText = (resources: StaticResource[]): string =>
  JSON.stringify({ version: MANIFEST_VERSION, resources }, null, 2) + '\n'

/** 清单字段可能被人手改过；认不出来的项直接丢掉，不猜 */
function normalizeResource(raw: unknown): StaticResource | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const uuid = typeof r.uuid === 'string' ? r.uuid.trim() : ''
  if (!uuid || /[^A-Za-z0-9_-]/.test(uuid)) return null
  const ext = typeof r.ext === 'string' ? r.ext.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() : ''
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0)
  const createdAt = num(r.createdAt)
  return {
    uuid,
    name: typeof r.name === 'string' && r.name.trim() ? r.name.trim() : uuid.slice(0, 8),
    ext,
    // 类型一律由后缀推：手改过的清单里 type 最容易写错，而后缀是文件的客观事实
    type: typeOfExt(ext),
    description: typeof r.description === 'string' ? r.description : '',
    createdAt: createdAt || num(r.updatedAt),
    updatedAt: num(r.updatedAt) || createdAt,
    bytes: num(r.bytes),
    hash: typeof r.hash === 'string' ? r.hash : '',
  }
}

/** 一份资源列表（来自磁盘清单或导入数据）→ 合法条目；认不出的丢掉，不猜 */
export function normalizeResourceList(raw: unknown): StaticResource[] {
  if (!Array.isArray(raw)) return []
  return raw.map(normalizeResource).filter((r): r is StaticResource => r !== null)
}

export function parseManifest(text: string | undefined): StaticResource[] {
  if (!text) return []
  try {
    return normalizeResourceList((JSON.parse(text) as { resources?: unknown } | null)?.resources)
  } catch {
    return []
  }
}
