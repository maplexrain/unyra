/*
 * 本文件负责：思维导图的**HTML 节点卡片**（MindmapNodeCard）——徽章、链接样式的标题、
 * 底栏文档按钮组（笔记 / 试卷 / 超级文档）、生成大纲、未创建胶囊、折叠按钮、
 * 掌握度细条，以及卡片内部向下展开的文档 tip 挂点。
 *
 * 原样搬自 MindmapView.tsx 的 nodes.map 卡片分支（原先是主组件里的内联 JSX，
 * 拆分时改成逐项 props 的展示组件，渲染产物一字不变），注释一并带走。
 */
import { ChevronDown, ExternalLink, Minus, Plus, Sparkles } from 'lucide-react'
import type { KnowledgeNode, LearnStore, OutlineEntry, TabRef } from '../../../learn/types'
import { notesOf, superDocsOf } from '../../../learn/types'
import { examsOfNode } from '../../../learn/graph'
import { DocTypeIcon } from '../docTypes'
import type { ExamActions, NodeDocActions } from '../explorer/types'
import { t } from '../../../i18n'
import type { ActivePreviewInfo, DocKey, MindmapNodeData } from './mindmapTypes'
import { BRANCH_PALETTES, DOC_BUTTONS, DOC_LABEL } from './mindmapTypes'
import { tintColor } from './mindmapTint'
import { CARD_BASE, cardSkin, mix } from './mindmapSkin'
import { NodeDocTip } from './mindmapDocTip'

export function MindmapNodeCard({
  item,
  store,
  selected,
  panning,
  isDark,
  readOnly,
  isCollapsed,
  goalBadge,
  tip,
  tipAnchorX,
  activePreview,
  activeTab,
  docs,
  exams,
  onOpenNode,
  onCreateChild,
  onGenerate,
  selectNode,
  openTintMenu,
  toggleTip,
  toggleCollapse,
  openPreview,
  onCloseTip,
}: {
  item: MindmapNodeData
  store: LearnStore
  /** 相机是否正把这张卡当主角（选中描边、z 层级用） */
  selected: boolean
  /** 是否正在平移：平移中不给悬停反馈（见 className 里那段说明） */
  panning: boolean
  isDark: boolean
  readOnly: boolean
  /** 这张卡的子分支当前是否被折叠 */
  isCollapsed: boolean
  /** 根节点徽章文案（总目标 / 阶段目标） */
  goalBadge: string
  /** 这张卡当前开着的文档 tip 类别（null = 没开） */
  tip: DocKey | null
  /** 开着 tip 时气泡尖角的横坐标（卡片本地坐标，见 toggleTip；没开时无意义） */
  tipAnchorX: number | undefined
  activePreview: ActivePreviewInfo | null
  activeTab: TabRef | null
  docs: NodeDocActions
  exams: ExamActions
  onOpenNode: (nodeId: string) => void
  onCreateChild?: (parentNode: KnowledgeNode, entry: OutlineEntry) => void
  onGenerate?: (node: KnowledgeNode) => void
  /** 选中节点：点卡片的任何部位都会走到这里 */
  selectNode: (target: MindmapNodeData) => void
  /** 右键：打开改色菜单（视口坐标） */
  openTintMenu: (id: string, e: React.MouseEvent) => void
  /** 开/关某个文档 tip（同时只开一个），顺手把尖角位置量出来 */
  toggleTip: (item: MindmapNodeData, key: DocKey, e: React.MouseEvent) => void
  /** 折叠 / 展开这张卡的子分支（唯一不选中节点的按钮） */
  toggleCollapse: (id: string, e: React.MouseEvent) => void
  /** 打开一个预览子节点（教学文档 / 笔记 / 试卷 / 超级文档） */
  openPreview: (info: ActivePreviewInfo) => void
  /** 收起文档 tip */
  onCloseTip: () => void
}) {
  const hasChildren = item.children.length > 0
  const pal = item.branchIndex >= 0 ? BRANCH_PALETTES[item.branchIndex % BRANCH_PALETTES.length] : null
  const isMastered = item.status === 'mastered'
  const isUncreated = item.status === 'uncreated'
  // 自定义颜色优先于分支色；已掌握统一换状态绿
  const custom = tintColor(item.realNode?.tint, isDark)
  const accent = isMastered ? 'var(--color-ok)' : (custom ?? (pal ? pal.color : 'var(--color-seal)'))
  const skin = cardSkin({ accent, isRoot: item.isRoot, isUncreated, isMastered, isDark })

  return (
    <div
      data-mm-card=""
      /*
       * 点卡片的任何地方都算选中它（需求原文：「不管点击节点哪个部位都会选中节点」）。
       * 里面各处按钮自己也调 selectNode——不是重复，是为了让「点按钮」这件事
       * 同样把节点选上（幂等，已经选中时不重复动镜头）。
       */
      onClick={() => selectNode(item)}
      onContextMenu={
        !readOnly && item.realNode
          ? (e) => {
              selectNode(item)
              openTintMenu(item.id, e)
            }
          : (e) => e.preventDefault()
      }
      style={{
        left: item.x,
        top: item.y,
        width: item.width,
        height: item.height,
        borderWidth: 1.5,
        borderStyle: isUncreated ? 'dashed' : 'solid',
        borderColor: skin.borderColor,
        background: skin.background,
        boxShadow: selected
          ? `0 0 0 2px ${accent}, 0 8px 24px ${mix(accent, isDark ? 30 : 18)}`
          : skin.glow,
      }}
      className={
        CARD_BASE +
        ' flex flex-col justify-between px-3.5 pt-2.5 pb-3.5 ' +
        /*
         * 层级是**会变的**：tip 从卡片下沿探出去，会盖在别的卡片上，而卡片之间
         * 靠 DOM 顺序分前后——不把开着 tip 的这一张顶到最高，它就会被画在后面的
         * 邻居盖住一半（需求原文：「层级一定要是会变化的，不然会被其他节点挡住」）。
         * 选中的那一张排第二档，免得它的描边被邻居压掉。
         */
        (tip ? 'z-40 ' : selected ? 'z-30 ' : '') +
        // 平移中不给悬停反馈（见 panning 那段说明）：那会儿底下的卡片在不停换人
        (selected || panning ? '' : 'hover:-translate-y-0.5')
      }
    >
      {/*
        顶部**只剩徽章**：状态点、掌握度、掌握状态都拿掉了（需求原文：
        「删除节点顶部学习状态的信息」）。那些信息在图上有更好的去处且不必重复：
        「已掌握」写在卡片的着色上（整张转绿）、掌握度写在卡片下沿那道细条上，
        它们都在卡片的**形状**里，而不再另占一行字。
        徽章（总目标 / 未创建）不是学习状态，是这张卡片的身份，留着；
        一个徽章都没有时整行不渲染——不留一行空白把标题往下压。
      */}
      {(item.isRoot || isUncreated) && (
        <div className="flex items-center gap-1.5">
          {item.isRoot && (
            <span
              className="shrink-0 rounded-full px-2 py-px text-[10px] font-bold"
              style={{ backgroundColor: mix(accent, 18), color: accent }}
            >
              {goalBadge}
            </span>
          )}
          {isUncreated && (
            <span className="shrink-0 text-[9.5px] tracking-wide text-ink-faint">
              {t('未创建')}
            </span>
          )}
        </div>
      )}
      {/* 标题与摘要 */}
      <div className="min-w-0">
        {item.realNode ? (
          /*
           * 标题就是教学文档的入口（需求原文：「教学文档不要用独立的按钮，直接把节点
           * 标题改为链接样式，点击打开教学文档」）。样式照抄应用里链接的那一套
           * （见 styles/markdown.css 的 a）：印章红 + 下划线 + 悬停加深。
           * 点它 = 选中这个节点 + 打开教学文档，两件事一起做——标题既是这一支的名字，
           * 也是它的正文入口，没有理由要用户点两下。
           */
          <div className="flex items-center gap-1 min-w-0">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                selectNode(item)
                if (readOnly) {
                  onOpenNode(item.realNode!.id)
                } else {
                  openPreview({
                    parentNodeId: item.id,
                    kind: 'doc',
                    title: item.title,
                  })
                }
              }}
              title={readOnly ? t('在页签栏打开教学文档') : t('预览「{0}」的教学文档', item.title)}
              className="truncate text-left text-[14px] leading-snug font-bold text-seal underline decoration-seal/40 decoration-1 underline-offset-[3px] transition hover:text-seal-deep hover:decoration-seal flex-1"
            >
              {item.title}
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                selectNode(item)
                onOpenNode(item.realNode!.id)
              }}
              title={t('在页签栏打开教学文档')}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-seal hover:bg-seal/10 transition"
            >
              <ExternalLink size={12} />
            </button>
          </div>
        ) : (
          <span
            className="block truncate text-[14px] leading-snug font-semibold text-ink-soft"
            title={item.title}
          >
            {item.title}
          </span>
        )}
        {item.summary && (
          <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-ink-faint" title={item.summary}>
            {item.summary}
          </p>
        )}
      </div>

      {/* 底栏：文档按钮组（笔记 / 试卷 / 超级文档）+ 生成大纲。
          教学文档不再占一颗按钮——它就是上面那个标题（链接样式） */}
      <div className="flex items-center justify-between gap-1">
        <div className="flex min-w-0 items-center gap-1">
          {item.realNode &&
            DOC_BUTTONS.map((key) => {
              const count =
                key === 'note'
                  ? notesOf(item.realNode!).length
                  : key === 'exam'
                    ? examsOfNode(store, item.realNode!.id).length
                    : superDocsOf(item.realNode!).length
              const active = tip === key
              return (
                <button
                  key={key}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    // 点按钮同样是「点了节点」——选中它，再管这一栏的清单
                    selectNode(item)
                    toggleTip(item, key, e)
                  }}
                  title={t('{0}（{1}）—— 点开查看 / 新增 / 删除', DOC_LABEL[key], count)}
                  className={
                    'flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] transition ' +
                    (active
                      ? 'bg-seal/15 text-seal'
                      : 'text-ink-soft hover:bg-seal/10 hover:text-seal')
                  }
                >
                  <DocTypeIcon kind={key} size={11} />
                  <span className="font-mono">{count}</span>
                  <ChevronDown
                    size={9}
                    className={
                      'transition-transform duration-150 ' + (active ? 'rotate-180' : '')
                    }
                  />
                </button>
              )
            })}
        </div>

        {/*
          「生成」的出场条件：这个节点底下**还没有分支**（没有大纲，或大纲里一条都没列）。
          从前只认「没有大纲」，于是一个空白大纲（建节点时总会生成的那一份）会让
          按钮消失——而那恰恰是最该请导师来规划的时候。
          画布上那块「还没有大纲」的浮层已经撤掉（一次性任务本来就没有大纲，
          那是正常状态，不该被当成待办），所以这颗按钮是这条路的**唯一入口**。
        */}
        {!readOnly && item.realNode && item.children.length === 0 && onGenerate && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              selectNode(item)
              onGenerate(item.realNode!)
            }}
            title={t('请导师给「{0}」规划大纲', item.title)}
            className="flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-[10px] text-ink-faint transition hover:bg-seal/10 hover:text-seal"
          >
            <Sparkles size={11} />
            <span>{t('生成')}</span>
          </button>
        )}
      </div>

      {/* 未创建的那条计划：直接交给导师建出来（胶囊随分支色） */}
      {!readOnly && isUncreated && item.parentNode && item.parentEntry && onCreateChild && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            selectNode(item)
            onCreateChild(item.parentNode!, item.parentEntry!)
          }}
          className="absolute -bottom-2.5 left-3.5 flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10.5px] font-semibold shadow-xs transition hover:text-white"
          style={{
            borderColor: mix(accent, 55),
            color: accent,
            background: 'var(--color-card)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = accent
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'var(--color-card)'
          }}
        >
          <Plus size={10} />
          <span>{t('创建并开讲')}</span>
        </button>
      )}

      {/*
        折叠/展开控制挂载点。**唯一不选中节点的那颗按钮**：它是「怎么看这张图」的
        开关，不是「这个节点是什么」的动作——为了收一支而让镜头跳到别处，手感是崩的。
        它本身也挂在卡片右沿之外，不算「节点的部位」。
      */}
      {hasChildren && (
        <button
          type="button"
          onClick={(e) => toggleCollapse(item.id, e)}
          title={
            isCollapsed
              ? t('展开子分支（{0} 个下级）', item.children.length)
              : t('折叠子分支')
          }
          className={
            'absolute top-1/2 z-20 flex -translate-y-1/2 items-center justify-center transition hover:scale-110 ' +
            (isCollapsed
              ? '-right-3.5 h-5 rounded-full px-1.5 font-mono text-[9.5px] font-bold text-white shadow-xs'
              : '-right-3 h-4 w-4 rounded-full border border-line-strong bg-paper text-ink-faint shadow-2xs hover:border-seal hover:text-seal dark:bg-card')
          }
          style={isCollapsed ? { backgroundColor: accent } : undefined}
        >
          {isCollapsed ? (
            <div className="flex items-center gap-0.5">
              <Plus size={9} />
              <span>{item.children.length}</span>
            </div>
          ) : (
            <Minus size={9} />
          )}
        </button>
      )}

      {/* 底部掌握度细条：贴在卡片下沿，不占布局空间；已掌握时 accent 已是绿，自然拉满 */}
      {item.realNode && typeof item.mastery === 'number' && (
        <span
          aria-hidden="true"
          className="absolute inset-x-3.5 bottom-0 h-[3px] overflow-hidden rounded-t-full"
          style={{ backgroundColor: mix(accent, isDark ? 18 : 12) }}
        >
          <span
            className="block h-full rounded-t-full transition-[width] duration-300"
            style={{
              width: `${Math.min(100, Math.max(0, item.mastery))}%`,
              backgroundColor: accent,
            }}
          />
        </span>
      )}

      {/* 文档 tip：从卡片下沿向下展开的气泡（尖角对着点开它的那颗按钮） */}
      {tip && item.realNode && (
        <NodeDocTip
          node={item.realNode}
          kind={tip}
          anchorX={tipAnchorX ?? item.width / 2}
          store={store}
          docs={docs}
          exams={exams}
          activeTab={activeTab}
          activePreview={activePreview}
          onClose={onCloseTip}
          onPreview={openPreview}
          readOnly={readOnly}
        />
      )}
    </div>
  )
}
