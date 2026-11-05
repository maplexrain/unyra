/*
 * 这个文件负责：结构页（页签 kind 'outline'）——**一个目标的节点图**。
 *
 * 支持双模式切换：
 * 1. 拓扑图（自由无限画布节点图）：类型化节点图、卡片就是节点、连线自由派生、位置由用户拖拽
 *    （见 learn/structure 与 components/learn/structure/StructureCanvas）。
 * 2. 大纲树视图（横向思维导图）：横向层级、只读、下游分支可展开收起、点击节点直接打开对应页签
 *    （见 components/learn/outline/MindmapView）。
 *
 * 图是**目标级**的（`docs/{目标}/structure.json`，含坐标表与 viewMode），不是节点级。
 * 页签绑定的那个节点只决定「打开时先看谁」（见 focusTarget）。
 */

import { memo, useCallback, useMemo } from 'react'
import { FolderTree, LayoutGrid } from 'lucide-react'
import type { KnowledgeNode, LearnStore } from '../../learn/types'
import type { StructureMap } from '../../learn/structure'
import { nodeById, normalizeKey } from '../../learn/graph'
import { t } from '../../i18n'
import type { ExamActions, NodeDocActions } from './explorer/types'
import { StructureCanvas, type StructureCanvasProps } from './structure/StructureCanvas'
import MindmapView from './outline/MindmapView'

export type CanvasChannelProps = Pick<
  StructureCanvasProps,
  | 'onCreateNode'
  | 'onDeleteNode'
  | 'onConnect'
  | 'onDisconnect'
  | 'onCreateChildDoc'
  | 'onRenameNote'
  | 'onAddOutlineEntry'
  | 'onDeleteOutlineEntry'
  | 'onBindVideo'
  | 'onOpenVideo'
  | 'onGenerateDoc'
  | 'onGenerateOutline'
  | 'onGenerateVideoDoc'
  | 'onSetProjectPath'
  | 'onOpenProjectFile'
  | 'onBindFile'
  | 'onOpenFileNode'
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
  const saved = store.structure?.[goalId]
  const viewMode = saved?.viewMode === 'tree' ? 'tree' : 'graph'

  const change = useCallback(
    (next: StructureMap) => onChangeStructure(goalId, next),
    [onChangeStructure, goalId],
  )

  const handleSetViewMode = useCallback(
    (nextMode: 'graph' | 'tree') => {
      onChangeStructure(goalId, {
        ...(saved ?? { version: 2, positions: {} }),
        viewMode: nextMode,
      })
    },
    [goalId, saved, onChangeStructure],
  )

  const handleToggleViewMode = useCallback(() => {
    handleSetViewMode(viewMode === 'graph' ? 'tree' : 'graph')
  }, [handleSetViewMode, viewMode])

  const goal = store.goals.find((g) => g.id === goalId)
  const rootNode = useMemo(() => {
    if (goal?.rootNodeId) {
      const r = nodeById(store, goal.rootNodeId)
      if (r) return r
    }
    if (node) return node
    const found = store.nodes.find((n) => n.goalId === goalId)
    if (found) return found
    const placeholder: KnowledgeNode = {
      id: goal?.id ?? goalId,
      title: goal?.title || goal?.question || t('新目标'),
      key: normalizeKey(goal?.title || goal?.question || 'goal'),
      description: '',
      docs: { teaching: '' },
      notes: [],
      annotations: [],
      status: 'learning',
      origin: 'user',
      goalId,
      createdAt: goal?.createdAt ?? Date.now(),
      updatedAt: goal?.updatedAt ?? Date.now(),
    }
    return placeholder
  }, [goal, node, store, goalId])

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-paper dark:bg-card/30">
      {/* 视图模式切换胶囊：拓扑图（自由画布） vs 大纲树（思维导图） */}
      <div className="absolute top-4 right-4 z-30 flex items-center rounded-xl border border-line bg-card/90 p-1 shadow-sm backdrop-blur select-none">
        <button
          type="button"
          onClick={() => handleSetViewMode('graph')}
          className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] font-medium transition cursor-pointer ${
            viewMode === 'graph'
              ? 'bg-seal text-white shadow-xs'
              : 'text-ink-soft hover:bg-line/40 hover:text-ink'
          }`}
          title={t('自由拓扑画布：任意位置拖动、自由连线与多类型节点')}
        >
          <LayoutGrid size={13} />
          <span>{t('拓扑图')}</span>
        </button>
        <button
          type="button"
          onClick={() => handleSetViewMode('tree')}
          className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] font-medium transition cursor-pointer ${
            viewMode === 'tree'
              ? 'bg-seal text-white shadow-xs'
              : 'text-ink-soft hover:bg-line/40 hover:text-ink'
          }`}
          title={t('大纲树视图（思维导图）：横向层级、只读、下游分支可展开收起')}
        >
          <FolderTree size={13} />
          <span>{t('大纲树')}</span>
        </button>
      </div>

      <div className="relative min-h-0 flex-1">
        {viewMode === 'tree' ? (
          <MindmapView
            store={store}
            node={rootNode}
            readOnly
            docs={docs}
            exams={exams}
            onOpenNode={(nodeId: string) => docs.onOpenTeach(nodeId)}
            focusTarget={focusTarget}
            onFocusHandled={onFocusHandled}
            onToggleViewMode={handleToggleViewMode}
          />
        ) : (
          <StructureCanvas
            store={store}
            goalId={goalId}
            onChange={change}
            docs={docs}
            exams={exams}
            onToast={onToast}
            focusTarget={focusTarget}
            onFocusHandled={onFocusHandled}
            onToggleViewMode={handleToggleViewMode}
            {...channel}
          />
        )}
      </div>
    </div>
  )
}, sameOutlineView)
