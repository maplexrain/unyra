/**
 * 课堂节点在 api.node.list() 里的导航段：uuid / 标题 / 挂载它的文档。
 *
 * 课堂不在文档树里（store.classrooms 单独存放），导航图单独给一段；upstream 从树边
 * 反查——工作流「分析上游教学文档」直接用它，不用猜。
 */
import { nodeById } from '../graph'
import type { LearnStore } from '../types'

export interface ClassroomListRow {
  uuid: string
  title: string
  upstream?: { uuid: string; title: string }
}

export function classroomListRows(store: LearnStore, goalId: string): ClassroomListRow[] {
  return (store.classrooms ?? [])
    .filter((cl) => cl.goalId === goalId)
    .map((cl) => {
      const upEdge = store.edges.find((e) => e.to === cl.id)
      const upDoc = upEdge ? nodeById(store, upEdge.from) : undefined
      return {
        uuid: cl.id,
        title: cl.title,
        ...(upDoc ? { upstream: { uuid: upDoc.id, title: upDoc.title } } : {}),
      }
    })
}
