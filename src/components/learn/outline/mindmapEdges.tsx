/*
 * 本文件负责：思维导图的 **SVG 连接曲线层**——分支渐变定义、每条边的柔光底衬 /
 * 悬停高亮 / 主曲线 / 两端连接珠 / 16px 点击热区，以及预览连线中点的快捷关闭按钮。
 * 原样搬自 MindmapView.tsx，注释一并带走。
 */
import { t } from '../../../i18n'
import { edgeOtherEnd } from './mindmapNav'
import type { ActivePreviewInfo, MindmapEdge, MindmapNodeData } from './mindmapTypes'
import { BRANCH_PALETTES, PREVIEW_TYPE_THEME } from './mindmapTypes'

/** SVG 连接曲线层（画布里的第一层，节点卡片层画在它上面） */
export function MindmapEdges({
  totalWidth,
  totalHeight,
  edges,
  nodeIndex,
  selectedId,
  isDark,
  panning,
  activePreview,
  isClosingPreview,
  onEdgeClick,
  closePreview,
}: {
  totalWidth: number
  totalHeight: number
  edges: MindmapEdge[]
  /** 节点 id → 图层数据：tooltip 里「跳到哪一头」的标题按 id 现取（那一份才是最新的） */
  nodeIndex: Map<string, MindmapNodeData>
  selectedId: string | null
  isDark: boolean
  /** 平移中不起悬停补间（光标不动、线在动） */
  panning: boolean
  activePreview: ActivePreviewInfo | null
  isClosingPreview: boolean
  /** 点一条连线：跳到与当前选中节点相对的那一端 */
  onEdgeClick: (edge: MindmapEdge) => void
  /** 点预览连线（或它中点的关闭按钮）：关掉预览并返回父节点 */
  closePreview: () => void
}) {
  return (
    <svg
      width={totalWidth}
      height={totalHeight}
      className="pointer-events-none absolute inset-0 overflow-visible"
    >
      <defs>
        {BRANCH_PALETTES.map((pal, idx) => (
          <linearGradient key={idx} id={`edge-grad-${idx}`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={pal.gradStart} />
            <stop offset="100%" stopColor={pal.gradEnd} />
          </linearGradient>
        ))}
        <linearGradient id="edge-grad-mastered" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="var(--color-ok)" stopOpacity="0.75" />
          <stop offset="100%" stopColor="var(--color-ok-deep)" stopOpacity="0.85" />
        </linearGradient>
        <linearGradient id="edge-grad-line" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="var(--color-line-strong)" stopOpacity="0.8" />
          <stop offset="100%" stopColor="var(--color-line-strong)" stopOpacity="0.5" />
        </linearGradient>
      </defs>

      {edges.map((edge) => {
        const dx = Math.max(32, (edge.x2 - edge.x1) * 0.5)
        const pathData = `M ${edge.x1} ${edge.y1} C ${edge.x1 + dx} ${edge.y1}, ${edge.x2 - dx} ${edge.y2}, ${edge.x2} ${edge.y2}`
        const pal =
          edge.branchIndex >= 0
            ? BRANCH_PALETTES[edge.branchIndex % BRANCH_PALETTES.length]
            : null

        const isPreviewEdge = edge.to.startsWith('preview:')
        const pTheme = isPreviewEdge && activePreview ? PREVIEW_TYPE_THEME[activePreview.kind] : null

        const strokeColor = pTheme
          ? pTheme.border
          : edge.status === 'mastered'
            ? 'url(#edge-grad-mastered)'
            : edge.status === 'uncreated'
              ? 'url(#edge-grad-line)'
              : pal
                ? `url(#edge-grad-${edge.branchIndex % BRANCH_PALETTES.length})`
                : 'var(--color-seal)'

        const glowColor = pTheme
          ? pTheme.color
          : edge.status === 'mastered'
            ? 'var(--color-ok)'
            : pal
              ? pal.color
              : 'var(--color-seal)'

        const strokeDash = edge.status === 'uncreated' ? '4 3' : 'none'
        /*
         * 这条线点下去会跳到哪一头：与 onEdgeClick 同一个判断（同一个函数），
         * tooltip 上先把答案说了，用户不用点一下才知道会去哪儿。
         */
        const jumpTo = nodeIndex.get(edgeOtherEnd(edge, selectedId))
        const connected = selectedId === edge.from || selectedId === edge.to
        return (
          // group/edge：鼠标落在下面那条透明热区上时，整组都算 hover，高亮那一层才亮得起来
          <g key={edge.id} className="group/edge">
            {/* 粗柔发光底衬：深底下亮一档，不然曲线在黑里显脏 */}
            <path
              d={pathData}
              fill="none"
              stroke={glowColor}
              strokeWidth={6}
              strokeOpacity={isDark ? 0.18 : 0.12}
              style={{
                transition: 'd 300ms cubic-bezier(0.2, 0, 0, 1), opacity 200ms ease',
                opacity: isPreviewEdge && isClosingPreview ? 0 : 1,
              }}
            />
            {/* 悬停高亮：一亮就说明「这条线点得动」。与选中节点相连的那几条平时也透着一点，
                扫一眼就知道从这里能往哪走 */}
            <path
              d={pathData}
              fill="none"
              stroke={glowColor}
              strokeWidth={9}
              strokeLinecap="round"
              className={
                'pointer-events-none ' +
                // 平移中不起悬停补间，理由与卡片那句一样（光标不动、线在动）
                (panning ? '' : 'transition-opacity duration-150 group-hover/edge:opacity-30 ') +
                (connected ? 'opacity-15' : 'opacity-0')
              }
              style={{
                transition: 'd 300ms cubic-bezier(0.2, 0, 0, 1)',
              }}
            />
            {/* 主分支曲线 */}
            <path
              d={pathData}
              fill="none"
              stroke={strokeColor}
              strokeWidth={isPreviewEdge ? 3 : edge.status === 'uncreated' ? 1.75 : 2.5}
              strokeDasharray={strokeDash}
              strokeLinecap="round"
              style={{
                transition: 'd 300ms cubic-bezier(0.2, 0, 0, 1), opacity 200ms ease',
                opacity: isPreviewEdge && isClosingPreview ? 0 : 1,
              }}
            />
            {/* 起始连接珠 */}
            <circle
              cx={edge.x1}
              cy={edge.y1}
              r={3}
              fill={glowColor}
              opacity={isPreviewEdge && isClosingPreview ? 0 : 0.7}
              style={{
                transition: 'cx 300ms cubic-bezier(0.2, 0, 0, 1), cy 300ms cubic-bezier(0.2, 0, 0, 1), opacity 200ms ease',
              }}
            />
            {/* 终点连接珠 */}
            <circle
              cx={edge.x2}
              cy={edge.y2}
              r={3}
              fill={
                edge.status === 'mastered'
                  ? 'var(--color-ok)'
                  : edge.status === 'uncreated'
                    ? 'var(--color-ink-faint)'
                    : glowColor
              }
              opacity={isPreviewEdge && isClosingPreview ? 0 : 0.85}
              style={{
                transition: 'cx 300ms cubic-bezier(0.2, 0, 0, 1), cy 300ms cubic-bezier(0.2, 0, 0, 1), opacity 200ms ease',
              }}
            />
            {/*
              点击热区：一条 2.5px 的曲线是点不中的，所以另铺一条 16px 的透明线来收点击。
              它必须**排在最后**——SVG 里后画的在上面，排在珠子前面才不会被珠子挡掉几段。
              pointer-events 单点设为 stroke：只认这条线画过的地方，围出来的空腔不吃事件，
              否则每一条曲线都会顺手吞掉一大片空白处的拖动。
            */}
            <path
              d={pathData}
              data-mm-edge=""
              fill="none"
              stroke="transparent"
              strokeWidth={16}
              strokeLinecap="round"
              style={{ pointerEvents: 'stroke', cursor: 'pointer', transition: 'd 300ms cubic-bezier(0.2, 0, 0, 1)' }}
              onClick={(e) => {
                e.stopPropagation()
                onEdgeClick(edge)
              }}
            >
              <title>{t('点这条线，跳到「{0}」', jumpTo?.title ?? '')}</title>
            </path>
            {/* 预览节点连线中点的快捷关闭并返回父节点按钮 */}
            {isPreviewEdge && (
              <g
                data-preview-close=""
                transform={`translate(${(edge.x1 + edge.x2) / 2}, ${(edge.y1 + edge.y2) / 2})`}
                className="cursor-pointer group/close-edge"
                onClick={(e) => {
                  e.stopPropagation()
                  closePreview()
                }}
                onMouseDown={(e) => {
                  e.stopPropagation()
                  closePreview()
                }}
                onPointerDown={(e) => e.stopPropagation()}
                style={{
                  pointerEvents: 'auto',
                  opacity: isClosingPreview ? 0 : 1,
                  transition: 'opacity 200ms ease, transform 300ms cubic-bezier(0.2, 0, 0, 1)',
                }}
              >
                <title>{t('关闭预览并返回父节点')}</title>
                {/* 透明扩大点击热区 */}
                <circle r={18} fill="transparent" style={{ pointerEvents: 'all' }} />
                <circle
                  r={11}
                  fill="var(--color-card, #ffffff)"
                  stroke={pTheme ? pTheme.border : 'var(--color-seal)'}
                  strokeWidth={1.5}
                  className="shadow-sm transition-transform duration-150 group-hover/close-edge:scale-115"
                  style={{
                    filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.15))',
                  }}
                />
                <path
                  d="M -3.5 -3.5 L 3.5 3.5 M 3.5 -3.5 L -3.5 3.5"
                  fill="none"
                  stroke={pTheme ? pTheme.color : 'var(--color-seal)'}
                  strokeWidth={1.75}
                  strokeLinecap="round"
                  className="transition-transform duration-150 group-hover/close-edge:scale-115"
                />
              </g>
            )}
          </g>
        )
      })}
    </svg>
  )
}
