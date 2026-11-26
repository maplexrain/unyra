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
  | 'onOpenVideoNode'
  | 'onUpdateVideoNode'
  | 'onGenerateDoc'
  | 'onGenerateOutline'
  | 'onGenerateClassroom'
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
  /** 本目标全部文档节点：大纲树只能拿它们当根 */
  const docNodes = useMemo(() => store.nodes.filter((n) => n.goalId === goalId), [store.nodes, goalId])
  const treeRoot = useMemo(() => {
    const id = saved?.treeRootId
    const hit = id ? docNodes.find((n) => n.id === id) : undefined
    return hit ?? null
  }, [docNodes, saved?.treeRootId])

  const change = useCallback(
    (next: StructureMap) => onChangeStructure(goalId, next),
    [onChangeStructure, goalId],
  )

  const handleSetViewMode = useCallback(
    (nextMode: 'graph' | 'tree') => {
      /*
       * 第一次切到大纲树时：沿用上次选的根；没有就默认当前打开的文档（仍是显式可见的选择，
       * 左上角选择器随时能换）。两者都没有就不擅自挑根，让界面要求用户选。
       */
      const kept = saved?.treeRootId && docNodes.some((n) => n.id === saved.treeRootId) ? saved.treeRootId : undefined
      const fallback = node && docNodes.some((n) => n.id === node.id) ? node.id : undefined
      onChangeStructure(goalId, {
        ...(saved ?? { version: 2, positions: {} }),
        viewMode: nextMode,
        ...(nextMode === 'tree' && (kept || fallback) ? { treeRootId: kept || fallback } : {}),
      })
    },
    [goalId, saved, onChangeStructure, docNodes, node],
  )

  const handlePickTreeRoot = useCallback(
    (rootId: string) => {
      if (!rootId) return
      onChangeStructure(goalId, {
        ...(saved ?? { version: 2, positions: {} }),
        viewMode: 'tree',
        treeRootId: rootId,
      })
    },
    [goalId, saved, onChangeStructure],
  )

  const handleToggleViewMode = useCallback(() => {
    handleSetViewMode(viewMode === 'graph' ? 'tree' : 'graph')
  }, [handleSetViewMode, viewMode])

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
          <>
            {/* 大纲树的根文档选择器：只认本目标的文档节点，随时可换 */}
            <div
              data-tree-root-picker
              className="absolute top-4 left-4 z-30 flex max-w-[300px] items-center gap-2 rounded-xl border border-line bg-card/90 px-2.5 py-1.5 text-[12px] shadow-sm backdrop-blur"
            >
              <FolderTree size={13} className="shrink-0 text-ink-faint" />
              <span className="shrink-0 text-ink-faint">{t('根文档')}</span>
              {docNodes.length ? (
                <select
                  data-tree-root-select
                  value={treeRoot?.id ?? ''}
                  onChange={(e) => handlePickTreeRoot(e.target.value)}
                  className="min-w-0 max-w-[220px] cursor-pointer truncate bg-transparent font-medium text-ink outline-none"
                  title={treeRoot?.title || t('选择大纲树的根文档')}
                >
                  {!treeRoot && <option value="">{t('选择文档…')}</option>}
                  {docNodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.title || t('未命名文档')}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-ink-faint">{t('目标里还没有文档节点')}</span>
              )}
            </div>
            {treeRoot ? (
              <MindmapView
                store={store}
                node={treeRoot}
                readOnly
                docs={docs}
                exams={exams}
                onOpenNode={(nodeId: string) => docs.onOpenTeach(nodeId)}
                focusTarget={focusTarget}
                onFocusHandled={onFocusHandled}
                onToggleViewMode={handleToggleViewMode}
              />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-8 text-center">
                <FolderTree size={30} className="text-ink-faint/60" />
                <div className="text-[13px] font-medium text-ink">
                  {docNodes.length ? t('选择一份文档作为大纲树的根') : t('这个目标还没有文档节点')}
                </div>
                {docNodes.length ? (
                  <>
                    <p className="max-w-[360px] text-[12px] leading-relaxed text-ink-faint">
                      {t('大纲树只画这份文档及其下级；根文档只是当前视图的选择，之后可以随时换成别的文档。')}
                    </p>
                    <div className="flex max-h-[50vh] w-full max-w-[440px] flex-col gap-1.5 overflow-auto rounded-xl border border-line bg-card/80 p-2 text-left">
                      {docNodes.map((n) => (
                        <button
                          key={n.id}
                          type="button"
                          onClick={() => handlePickTreeRoot(n.id)}
                          className="flex items-center gap-2 rounded-lg px-3 py-2 text-[12.5px] text-ink transition hover:bg-line/50"
                        >
                          <FolderTree size={13} className="shrink-0 text-seal" />
                          <span className="min-w-0 truncate">{n.title || t('未命名文档')}</span>
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="max-w-[360px] text-[12px] leading-relaxed text-ink-faint">
                    {t('先在拓扑图里新建或导入文档，再切回大纲树选择根文档。')}
                  </p>
                )}
              </div>
            )}
          </>
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
