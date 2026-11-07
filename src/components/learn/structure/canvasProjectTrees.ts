/**
 * 项目卡的目录树状态 hook（组件运行时状态，不进派生）：
 * 展开的目录（projExpanded）、已加载的目录缓存（projTrees）、懒加载读盘（loadProjDir，
 * 展开那一拍才去读）、按 subPath 平铺成渲染行（projTreeRows）。换路径之后旧清单
 * 就是陈词，用 clearProjCache 整体作废。
 * 这里同时存放项目卡的三个高度常量：路径行高、树行高、树的可见行数上限——
 * 它们同时被高度函数（宿主）与项目卡渲染（CanvasCards）使用。
 */

import { useCallback, useState } from 'react'
import type { LearnStore } from '../../../learn/types'
import { resolveProjectRoot, sortProjectEntries } from '../../../learn/projects'
import { native } from '../../../lib/native'
import { t } from '../../../i18n'
import { SLOT_ROW } from './structureView'

/** 项目卡路径行的高度（标题行之下、目录树之上；副行的路径 + 拼法徽标 + 展开钮） */
export const PROJ_PATH_ROW = 26
/** 项目卡目录树的行高（与大纲目标项同一档：22px 一行） */
export const PROJ_TREE_ROW = SLOT_ROW
/** 树的可见行数上限：再深的目录滚着看（卡是画布上的卡，不能无限长） */
export const PROJ_TREE_MAX_ROWS = 12

/** 项目目录树的一行（平铺后的渲染模型：depth 决定缩进） */
export interface ProjRow {
  depth: number
  name: string
  isDirectory: boolean
  /** 相对项目根的路径（'/' 分隔；根目录的子项 = name） */
  path: string
}

/** 一个已加载目录的状态（按 subPath 缓存；error 挂在目录上，展开时显示） */
export interface ProjDirState {
  loading: boolean
  error?: string
  entries: Array<{ name: string; isDirectory: boolean }>
}

/** 项目卡目录树需要的宿主能力 */
export interface ProjectTreesDeps {
  store: LearnStore
}

/* ---------- 项目卡的目录树（组件运行时状态，不进派生） ---------- */
export function useProjectTrees({ store }: ProjectTreesDeps) {
  /** 展开的目录（键 = 项目 uuid，值 = 该卡展开的 subPath 集合；'' = 根） */
  const [projExpanded, setProjExpanded] = useState<Record<string, Set<string>>>({})
  /** 已加载的目录清单（同上按 subPath 缓存；展开那一拍才去读盘） */
  const [projTrees, setProjTrees] = useState<Record<string, Record<string, ProjDirState>>>({})

  /** 把已加载的树平铺成渲染行：展开的目录递归下钻，行数即树高 */
  const flattenProjRows = useCallback((tree: Record<string, ProjDirState> | undefined, expanded: ReadonlySet<string>): ProjRow[] => {
    const rows: ProjRow[] = []
    const walk = (dirPath: string, depth: number) => {
      const st = tree?.[dirPath]
      if (!st) return
      for (const e of st.entries) {
        const childPath = dirPath ? dirPath + '/' + e.name : e.name
        rows.push({ depth, name: e.name, isDirectory: e.isDirectory, path: childPath })
        if (e.isDirectory && expanded.has(childPath)) walk(childPath, depth + 1)
      }
    }
    walk('', 0)
    return rows
  }, [])

  /** 项目卡展开的树有多高（行数封顶；未展开 0） */
  const projTreeRows = useCallback(
    (uuid: string): ProjRow[] => {
      const expanded = projExpanded[uuid]
      if (!expanded || !expanded.size) return []
      return flattenProjRows(projTrees[uuid], expanded)
    },
    [projExpanded, projTrees, flattenProjRows],
  )

  /** 读一个目录进缓存（roots 只随本次调用走：授权边界 = 这枚节点此刻声明的根） */
  const loadProjDir = useCallback(
    async (uuid: string, dirPath: string) => {
      const entity = (store.projects ?? []).find((p) => p.id === uuid)
      if (!entity) return
      const root = resolveProjectRoot(store, entity)
      setProjTrees((m) => {
        const cur = m[uuid]?.[dirPath]
        return { ...m, [uuid]: { ...m[uuid], [dirPath]: cur?.entries ? { ...cur, loading: true } : { loading: true, entries: [] } } }
      })
      if (!root) {
        setProjTrees((m) => ({
          ...m,
          [uuid]: { ...m[uuid], [dirPath]: { loading: false, error: t('路径解析失败：相对路径要落在用户目录内，或检查数据根是否就绪'), entries: [] } },
        }))
        return
      }
      try {
        const abs = root.replace(/[\\/]+$/, '') + (dirPath ? '/' + dirPath : '')
        const r = await native().projectFs({ op: 'list', roots: [root], path: abs })
        if (r.ok && r.op === 'list') {
          setProjTrees((m) => ({
            ...m,
            [uuid]: {
              ...m[uuid],
              [dirPath]: { loading: false, entries: sortProjectEntries(r.entries.map((e) => ({ name: e.name, isDirectory: e.isDirectory }))) },
            },
          }))
        } else {
          setProjTrees((m) => ({
            ...m,
            [uuid]: { ...m[uuid], [dirPath]: { loading: false, error: 'error' in r ? r.error : t('读取失败'), entries: [] } },
          }))
        }
      } catch (err) {
        setProjTrees((m) => ({
          ...m,
          [uuid]: { ...m[uuid], [dirPath]: { loading: false, error: err instanceof Error ? err.message : String(err), entries: [] } },
        }))
      }
    },
    [store],
  )

  /** 清掉一枚项目卡的目录树缓存与展开态：换路径之后旧清单就是陈词，必须重读 */
  const clearProjCache = useCallback((uuid: string) => {
    setProjTrees((m) => ({ ...m, [uuid]: {} }))
    setProjExpanded((m) => ({ ...m, [uuid]: new Set<string>() }))
  }, [])

  /** 展开一张项目卡：根目录首次展开时才去读盘（懒加载，卡上不预先跑 IO） */
  const toggleProjRoot = useCallback(
    (uuid: string) => {
      setProjExpanded((m) => {
        const cur = m[uuid] ?? new Set<string>()
        const next = new Set(cur)
        if (next.has('')) {
          next.delete('')
        } else {
          next.add('')
          if (!projTrees[uuid]?.['']) void loadProjDir(uuid, '')
        }
        return { ...m, [uuid]: next }
      })
    },
    [projTrees, loadProjDir],
  )

  /** 展开/收起树里的一个子目录：同样展开那一拍才读盘 */
  const toggleProjDir = useCallback(
    (uuid: string, dirPath: string) => {
      setProjExpanded((m) => {
        const cur = m[uuid] ?? new Set<string>()
        const next = new Set(cur)
        if (next.has(dirPath)) {
          next.delete(dirPath)
        } else {
          next.add(dirPath)
          if (!projTrees[uuid]?.[dirPath]) void loadProjDir(uuid, dirPath)
        }
        return { ...m, [uuid]: next }
      })
    },
    [projTrees, loadProjDir],
  )

  return { projExpanded, projTrees, projTreeRows, clearProjCache, toggleProjRoot, toggleProjDir }
}
