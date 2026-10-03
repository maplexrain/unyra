/**
 * 学习状态标记：一棵小分支——底端一颗根节点，主干向上、分出左右两枝，
 * 三个端点各顶一颗小圆（表示节点），即「丩字加三个圆圈」的形状。
 *
 * 它从前是一颗 7px 圆点：颜色虽能区分状态，但一排圆点读不出「这是学习树上
 * 的节点」；分支把「节点长在树上」这层意思画了出来。颜色交给 className
 * （fill/stroke 全走 currentColor），配色见 mastery 的 STATUS_META。
 */
export default function StatusBranch({
  size = 12,
  className = '',
}: {
  size?: number
  className?: string
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true" className={className}>
      {/* 主干：根节点向上到分叉点 */}
      <path d="M8 10.8V7.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      {/* 左右两枝：分叉点向外弯到各自的节点（起点切线竖直，分叉处顺滑） */}
      <path
        d="M8 7.4C8 5.6 6.6 5.1 5.2 4.5M8 7.4C8 5.6 9.4 5.1 10.8 4.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      {/* 三个端点的节点圆：根在底、两枝各一 */}
      <circle cx="8" cy="12.7" r="2" fill="currentColor" />
      <circle cx="3.9" cy="3.3" r="2" fill="currentColor" />
      <circle cx="12.1" cy="3.3" r="2" fill="currentColor" />
    </svg>
  )
}
