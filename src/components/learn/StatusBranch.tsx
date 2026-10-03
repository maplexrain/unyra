/**
 * 学习状态标记：一棵分叉的分支——两根枝条并列、从根部岔开（横向圆角相连），
 * 三个端点各顶一颗实心小圆（表示节点），即通用的 fork/分支标记。
 *
 * 它从前是一颗 7px 圆点：颜色虽能区分状态，但一排圆点读不出「这是学习树上
 * 的节点」；分叉把「节点长在树上」这层意思画了出来。比例的硬规矩：**两枝的
 * 横向开度要大、根部的短干要短**——收窄了就成了细杆顶两颗球，观感全毁。
 * 颜色交给 className（fill/stroke 全走 currentColor），配色见 mastery 的 STATUS_META。
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
      {/* 横向圆角连接：把两根枝条连成一个分叉（两端插进节点圆里，不留缝） */}
      <path
        d="M4.2 5.5v1.7c0 .9.7 1.4 1.8 1.4h4c1.1 0 1.8-.5 1.8-1.4V5.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      {/* 根部的短干：分叉中点向下到根节点 */}
      <path d="M8 8.6v2.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      {/* 三个端点的节点圆：两枝各一、根在底 */}
      <circle cx="4.2" cy="3.7" r="1.9" fill="currentColor" />
      <circle cx="11.8" cy="3.7" r="1.9" fill="currentColor" />
      <circle cx="8" cy="12.7" r="1.9" fill="currentColor" />
    </svg>
  )
}
