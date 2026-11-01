/*
 * 这个文件负责：结构页（页签 kind 'outline'）——**一个目标的节点图**。
 *
 * 它曾经是「一个目标的大纲树」（思维导图，位置由布局算法算）。现在换成了无限画布上的
 * 类型化节点图：卡片就是节点（uuid 对上实体）、连线全部派生、位置由用户拖
 * （见 learn/structure 与 components/learn/structure/StructureCanvas）。
 *
 * 图是**目标级**的（`docs/{目标}/structure.json`，只有坐标表），不是节点级。
 * 页签绑定的那个节点只决定「打开时先看谁」（见 focusTarget）。
 */

import { memo, useCallback } from 'react'
import type { KnowledgeNode, LearnStore } from '../../learn/types'
import type { StructureMap } from '../../learn/structure'
import type { ExamActions, NodeDocActions } from './explorer/types'
import { StructureCanvas, type StructureCanvasProps } from './structure/StructureCanvas'

export type CanvasChannelProps = Pick<
  StructureCanvasProps,
  | 'onCreateNode'
  | 'onDeleteNode'
  | 'onConnect'
  | 'onDisconnect'
  | 'onCreateChildDoc'
  | 'onRenameNote'
  | 'onAddOutlineEntry'
  | 'onBindVideo'
  | 'onOpenVideo'
  | 'onGenerateDoc'
  | 'onGenerateOutline'
  | 'onGenerateVideoDoc'
  | 'onSetProjectPath'
  | 'onOpenProjectFile'
>

export interface OutlineViewProps {
  store: LearnStore
  /** 这一页属于哪个节点（页签绑定的那个）；图本身按 goalId 取 */
  node?: KnowledgeNode | null
  goalId?: string
  /** 坐标表变了：上层写进 store 并落盘（goalId 由这里补上，调用方只认坐标表） */
  onChangeStructure: (goalId: string, next: StructureMap) => void
  /** 文档那一侧的动作（点标题打开教学文档 / 笔记 / 超级文档） */
  docs: NodeDocActions
  /** 考试那一侧的动作（点试卷标题开考试窗口） */
  exams: ExamActions
  onToast?: (msg: string) => void
  /** 外部指定的聚焦目标（如 chip 路由） */
  focusTarget?: { nodeId: string; nonce: number } | null
  onFocusHandled?: () => void
  /** 统一通道：节点的建 / 删 / 连 / 改名（宿主用 NodeService 落地，与 agent 同一条路） */
  channel: CanvasChannelProps
}

function sameOutlineView(prev: OutlineViewProps, next: OutlineViewProps): boolean {
  if (prev.goalId !== next.goalId) return false
  if (prev.node !== next.node) return false
  if (prev.store.structure !== next.store.structure) return false
  if (prev.store.nodes !== next.store.nodes || prev.store.exams !== next.store.exams) return false
  // 视频卡（绑定的标题 / 空卡占位）读 videoNodes 与 videos：绑定变了图要跟着变
  if (prev.store.videoNodes !== next.store.videoNodes || prev.store.videos !== next.store.videos) return false
  // 项目卡（路径声明 / 解析结果）读 projects：声明变了图要跟着变
  if (prev.store.projects !== next.store.projects) return false

  if (prev.docs !== next.docs || prev.exams !== next.exams) return false
  if (prev.channel !== next.channel) return false
  if (prev.focusTarget !== next.focusTarget) return false
  return true
}

export default memo(function OutlineView({
  store,
  node,
  goalId: propGoalId,
  onChangeStructure,
  docs,
  exams,
  onToast,
  focusTarget,
  onFocusHandled,
  channel,
}: OutlineViewProps) {
  const goalId = propGoalId || node?.goalId || ''
  const change = useCallback((next: StructureMap) => onChangeStructure(goalId, next), [onChangeStructure, goalId])
  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-paper dark:bg-card/30">
      <div className="relative min-h-0 flex-1">
        <StructureCanvas
          store={store}
          goalId={goalId}
          onChange={change}
          docs={docs}
          exams={exams}
          onToast={onToast}
          focusTarget={focusTarget}
          onFocusHandled={onFocusHandled}
          {...channel}
        />
      </div>
    </div>
  )
}, sameOutlineView)
