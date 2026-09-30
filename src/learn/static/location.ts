/** 这个文件负责什么：资源在磁盘上的位置——目标目录、资源目录、清单与文件本体在数据根下的相对路径。 */

import type { LearnStore } from '../types'
import { DOCS_DIR, MANIFEST_FILE, STATIC_DIR, nodeLayout } from '../layout'
import type { StaticResource } from './types'

/* ---------- 位置 ---------- */

/** 目标的根目录（目标目录就是根节点的目录） */
export function goalDirOf(store: LearnStore, goalId: string): string | null {
  const rootId = store.goals.find((g) => g.id === goalId)?.rootNodeId
  if (!rootId) return null
  const layout = nodeLayout(store).get(rootId)
  if (!layout) return null
  return [DOCS_DIR, ...layout.dir].join('/')
}

/** 资源目录：\`docs/{目标}/static\`；目标不存在时 null */
export function goalStaticDir(store: LearnStore, goalId: string): string | null {
  const dir = goalDirOf(store, goalId)
  return dir ? dir + '/' + STATIC_DIR : null
}

export const manifestPathOf = (store: LearnStore, goalId: string): string | null => {
  const dir = goalStaticDir(store, goalId)
  return dir ? dir + '/' + MANIFEST_FILE : null
}

/** 一条资源在数据根下的相对路径 */
export function resourceRel(store: LearnStore, goalId: string, res: StaticResource): string | null {
  const dir = goalStaticDir(store, goalId)
  return dir ? dir + '/' + res.uuid + (res.ext ? '.' + res.ext : '') : null
}
