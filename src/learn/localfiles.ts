import type { LocalFile } from './types'
import { fileNameOf } from './tabs'

/**
 * 本地文件列表：拖进归一浏览过的**外部**文件（不在数据目录里的那些）。
 *
 * 曾经只收 md / txt / html：拖别的一律拒收。现在的口径是**来者不拒**——
 * 文本类（一大串后缀，见 electron/storage/local 的 LOCAL_TEXT_EXTS）开编辑器，
 * 图片 / 音频 / 视频开媒体预览页签；预览不了的也在列表里留着路径。
 */

/** 列表上限：这是「最近打开」而不是收藏夹，留着最常用的一批就够 */
export const LOCAL_FILE_LIMIT = 30

/** 这个文件名能不能拖进来：现在一律可以（文本 / 媒体各走各的视图，见 learn/tabs 的 viewOf） */
export function isSupportedLocalFile(_name: string): boolean {
  return true
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
