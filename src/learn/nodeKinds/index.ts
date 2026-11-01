/**
 * 节点宇宙的登记表：类型清单、显示名、同列权重——一种类型一个类文件，
 * 行为（关系派生 / 连接过滤 / help / editContent）全在各类型身上，这里只做查表。
 *
 * 连线规则不再有中央矩阵：能不能连由 `GNode.onUpstream / onDownstream` 双边协商
 * （见 base.ts 的 connect 协议）。加一种新类型 = 建一个文件继承 GNode + 在这里登记一行。
 */
import type { GNodeKind } from './base'

export const NODE_KINDS: readonly GNodeKind[] = ['entry', 'outline', 'doc', 'note', 'exam', 'superdoc', 'video', 'project']
/** 全部类型（顺序即登记顺序；GRAPH_KINDS 是老名字的别名，画布与测试还在用） */
export const GRAPH_KINDS: readonly GNodeKind[] = NODE_KINDS

export function isGraphKind(v: unknown): v is GNodeKind {
  return typeof v === 'string' && (NODE_KINDS as readonly string[]).includes(v)
}

/** 显示名表：卡片、设置页、api 说明共用 */
export const GRAPH_KIND_LABEL: Record<GNodeKind, string> = {
  entry: '入口',
  outline: '大纲',
  doc: '文档',
  note: '笔记',
  exam: '试卷',
  superdoc: '超级文档',
  video: '视频',
  project: '项目',
}

/** 同列排序权重：读图方向「大纲 → 文档 → 叶子」，入口最左 */
export const KIND_RANK: Record<GNodeKind, number> = {
  entry: -1,
  outline: 0,
  doc: 1,
  note: 2,
  exam: 2,
  superdoc: 2,
  video: 2,
  project: 2,
}

export type { GNodeKind, GNode, NodeCtx, NodeHelp, NodePort, NodeRelation, NodeResult, ConnectFilter } from './base'
export { outlineUuid, docIdOfOutlineUuid, entryUuid, docIdOfEntryUuid } from './base'
/** 节点对象对外的全部成员（全类型同构；沙箱门面与调用校验共用这一份清单） */
export const NODE_MEMBERS_ORDER = ['content', 'editContent', 'help', 'connect', 'disconnect', 'getPortData'] as const
export type NodeMember = (typeof NODE_MEMBERS_ORDER)[number]
export { DocGNode } from './doc'
export { OutlineGNode } from './outline'
export { NoteGNode } from './note'
export { ExamGNode } from './exam'
export { SuperdocGNode } from './superdoc'
export { EntryGNode } from './entry'
export { VideoGNode } from './video'
export { ProjectGNode } from './project'
export { NodeService, locateUuid, type NodeServiceDeps, type UuidLocation } from './service'
