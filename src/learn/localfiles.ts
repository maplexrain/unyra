import type { LocalFile } from './types'
import { fileNameOf } from './tabs'

/**
 * 本地文件列表：拖进归一浏览过的**外部**文件（不在数据目录里的那些）。
 *
 * 只收文本类：txt 与 markdown 是需求里点名的，html 一并收下（它也能预览）。
 * 别的扩展名（图片、pdf、二进制）不在这里——拖进来只会是一串乱码，
 * 与其让它进列表再报错，不如在拖入那一刻就说清楚。
 */

/** 能拖进来浏览的扩展名 */
const LOCAL_EXTS = ['.md', '.markdown', '.txt', '.html', '.htm']

/** 列表上限：这是「最近打开」而不是收藏夹，留着最常用的一批就够 */
export const LOCAL_FILE_LIMIT = 30

/** 这个文件名能不能拖进来（大小写不敏感） */
export function isSupportedLocalFile(name: string): boolean {
  const base = fileNameOf(name).toLowerCase()
  return LOCAL_EXTS.some((ext) => base.endsWith(ext))
}

/**
 * 记一条本地文件：已经在列表里就把它挪到最前面并刷新时间（最近打开），
 * 不在就新增。列表按最近打开倒序，因此前面那种「打开旧文件」也该动一下顺序。
 */
export function addLocalFile(list: LocalFile[], path: string, at: number): LocalFile[] {
  const rest = list.filter((f) => f.path !== path)
  const name = fileNameOf(path)
  return [{ path, name, openedAt: at }, ...rest].slice(0, LOCAL_FILE_LIMIT)
}

/** 从列表里移除一条（用户手动清理；磁盘上的文件不动） */
export function removeLocalFile(list: LocalFile[], path: string): LocalFile[] {
  return list.filter((f) => f.path !== path)
}

/** 列表里的一条对应的页签引用 */
export function localTabRef(f: LocalFile): { kind: 'local'; path: string } {
  return { kind: 'local', path: f.path }
}

/** 列表按最近打开倒序（存盘时也按这个顺序，读回来就不必再排） */
export function sortLocalFiles(list: LocalFile[]): LocalFile[] {
  return [...list].sort((a, b) => b.openedAt - a.openedAt).slice(0, LOCAL_FILE_LIMIT)
}
