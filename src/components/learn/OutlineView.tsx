/*
 * 这个文件负责：大纲页（页签 kind 'outline'）——一个**目标**的路线图。
 *
 * 它是目标级的（不是节点级）：页签由目标根节点打开，页上只有一张思维导图，
 * 目标的路线怎么展开、哪些节点建了、哪些还在计划里，一眼看全。
 *
 * 页头设计（重构版）：
 * - 左侧是「目标身份区」：路线图标 + 目标级别徽章 + 标题 + 掌握状态，
 *   一眼回答「这是哪个目标、现在走到哪了」；
 * - 右侧是「进度统计区」：子目标总数 / 已创建 / 已掌握三枚计数 + 一条进度条，
 *   把整张导图的信息浓缩成数字——图看结构，数看进度，两者互补；
 * - 页头通栏铺开（不再限 960px 居中）：导图画布本来就是通栏的，
 *   页头缩在中间反而和画布对不齐。
 *
 * 动作依旧全在图里（节点卡片自带文档入口与生成按钮），页头只读不写。
 */

import { useMemo } from 'react'
import { Route } from 'lucide-react'
import type { KnowledgeNode, LearnStore, OutlineEntry, TabRef } from '../../learn/types'
import { MASTERY_LABEL } from '../../learn/types'
import type { ExamActions, NodeDocActions } from './explorer/types'
import { t } from '../../i18n'
import MindmapView, { buildMindmapTree, type MindmapNodeData } from './outline/MindmapView'

export interface OutlineViewProps {
  store: LearnStore
  /** 这一页大纲属于哪个目标 */
  node: KnowledgeNode
  /** 打开某个子目标的教学文档 */
  onOpenNode: (nodeId: string) => void
  /** 把大纲里还没创建的子目标真的建出来（交给导师开讲） */
  onCreateChild: (parentNode: KnowledgeNode, entry: OutlineEntry) => void
  /** 请导师规划 / 重排某个节点的大纲 */
  onGenerate: (node: KnowledgeNode) => void
  /** 改某个节点的自定义颜色（右键节点改色）；null = 回到「随分支」 */
  onSetTint: (nodeId: string, tint: string | null) => void
  /** 节点 tip 里的文档动作（与侧栏资源管理器同一份） */
  docs: NodeDocActions
  /** 考试那一侧的动作 */
  exams: ExamActions
  /** 焦点格里正开着的那份文档（tip 里对应行要亮） */
  activeTab: TabRef | null
}

/** 整棵树的进度统计（不含根节点自己：它代表目标，不是「要走的子目标」） */
interface OutlineStats {
  total: number
  created: number
  mastered: number
  /** 掌握度百分比：已掌握 / 总数（没有子目标时为 0） */
  pct: number
}

function collectStats(root: MindmapNodeData): OutlineStats {
  let total = 0
  let created = 0
  let mastered = 0
  const walk = (n: MindmapNodeData) => {
    if (!n.isRoot) {
      total += 1
      if (n.realNode) {
        created += 1
        if (n.status === 'mastered') mastered += 1
      }
    }
    n.children.forEach(walk)
  }
  walk(root)
  return { total, created, mastered, pct: total > 0 ? Math.round((mastered / total) * 100) : 0 }
}

export default function OutlineView({
  store,
  node,
  onOpenNode,
  onCreateChild,
  onGenerate,
  onSetTint,
  docs,
  exams,
  activeTab,
}: OutlineViewProps) {
  const isRootGoal = store.goals.some((g) => g.rootNodeId === node.id)
  const goalBadge = isRootGoal ? t('总目标') : t('阶段目标')
  const mastered = node.status === 'mastered'

  // 与导图同一份树（buildMindmapTree 是纯函数，树通常很小，开销可忽略）
  const stats = useMemo(() => collectStats(buildMindmapTree(store, node)), [store, node])

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-paper dark:bg-card/30">
      {/* 页头：目标身份（左）+ 进度统计（右） */}
      <header className="shrink-0 border-b border-line/50 bg-paper/95 shadow-2xs backdrop-blur-md dark:bg-card/90">
        <div className="flex min-w-0 items-center gap-4 px-6 py-3.5">
          {/* 身份区 */}
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-seal/25 bg-seal/10 text-seal">
            <Route size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="shrink-0 rounded-full border border-seal/30 bg-seal/10 px-2 py-px text-[10.5px] font-semibold text-seal">
                {goalBadge}
              </span>
              <span
                className={
                  'shrink-0 rounded-full px-2 py-px text-[10.5px] font-medium ' +
                  (mastered
                    ? 'bg-ok/12 text-ok'
                    : 'bg-paper-deep text-ink-soft dark:bg-card')
                }
              >
                {t(MASTERY_LABEL[node.status])}
              </span>
              {typeof node.learning?.mastery === 'number' && (
                <span className="shrink-0 font-mono text-[10.5px] text-ink-faint">
                  {node.learning.mastery}
                  {t('分')}
                </span>
              )}
            </div>
            <h2 className="mt-1 truncate text-[16px] leading-tight font-bold text-ink" title={node.title}>
              {node.title}
            </h2>
          </div>

          {/* 统计区：有子目标才出现（还没大纲时，图上的空态会引导生成） */}
          {stats.total > 0 && (
            <div className="flex shrink-0 items-center gap-5">
              <Stat label={t('子目标')} value={stats.total} tone="text-ink" />
              <Stat label={t('已创建')} value={stats.created} tone="text-seal" />
              <Stat label={t('已掌握')} value={stats.mastered} tone="text-ok" />
              <div className="w-36">
                <div className="flex items-baseline justify-between">
                  <span className="text-[10.5px] text-ink-faint">{t('掌握进度')}</span>
                  <span className="font-mono text-[11px] font-semibold text-ink">{stats.pct}%</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line/50">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-ok-deep to-ok transition-[width] duration-300"
                    style={{ width: `${stats.pct}%` }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </header>

      {/* 视图内容区：只有思维导图 */}
      <div className="relative min-h-0 flex-1">
        <MindmapView
          store={store}
          node={node}
          onOpenNode={onOpenNode}
          onCreateChild={onCreateChild}
          onGenerate={onGenerate}
          onSetTint={onSetTint}
          docs={docs}
          exams={exams}
          activeTab={activeTab}
        />
      </div>
    </div>
  )
}

/** 页头右侧的一枚计数：上数字、下标签，竖排居右 */
function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="text-right">
      <div className={`font-mono text-[16px] leading-none font-bold ${tone}`}>{value}</div>
      <div className="mt-1 text-[10.5px] text-ink-faint">{label}</div>
    </div>
  )
}
