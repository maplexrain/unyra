/*
 * 这个文件负责：页签上按**相距层级**叠加显示的矢量折角图标（1-4 个箭头叠加）。
 * 父级文档朝上叠、子级文档朝下叠，层数越深箭头越多——一眼看出「这份文档挂在哪里」。
 * 纯展示组件：给方向与层数，画 SVG，别的不沾。
 */

function chevronPath(direction: 'up' | 'down', apexY: number, span = 4.2, wingH = 2.8): string {
  if (direction === 'up') {
    const x1 = (8 - span).toFixed(1)
    const x2 = (8 + span).toFixed(1)
    const yWing = (apexY + wingH).toFixed(1)
    return `M ${x1} ${yWing} L 8 ${apexY.toFixed(1)} L ${x2} ${yWing}`
  } else {
    const x1 = (8 - span).toFixed(1)
    const x2 = (8 + span).toFixed(1)
    const yWing = (apexY - wingH).toFixed(1)
    return `M ${x1} ${yWing} L 8 ${apexY.toFixed(1)} L ${x2} ${yWing}`
  }
}

/**
 * 依据相距层级叠加显示的矢量折角图标（1-4 个箭头叠加）
 */
export function StackedChevron({
  direction,
  count,
  className,
  style,
}: {
  direction: 'up' | 'down'
  count: number
  className?: string
  style?: React.CSSProperties
}) {
  const n = Math.min(Math.max(count, 1), 4)
  const paths: string[] = []

  if (direction === 'up') {
    if (n === 1) {
      paths.push(chevronPath('up', 6.2, 4.4, 3.6))
    } else if (n === 2) {
      paths.push(chevronPath('up', 4.6, 4.2, 2.8))
      paths.push(chevronPath('up', 8.6, 4.2, 2.8))
    } else if (n === 3) {
      paths.push(chevronPath('up', 3.6, 3.9, 2.3))
      paths.push(chevronPath('up', 6.8, 3.9, 2.3))
      paths.push(chevronPath('up', 10.0, 3.9, 2.3))
    } else {
      paths.push(chevronPath('up', 2.7, 3.7, 2.0))
      paths.push(chevronPath('up', 5.3, 3.7, 2.0))
      paths.push(chevronPath('up', 7.9, 3.7, 2.0))
      paths.push(chevronPath('up', 10.5, 3.7, 2.0))
    }
  } else {
    if (n === 1) {
      paths.push(chevronPath('down', 9.8, 4.4, 3.6))
    } else if (n === 2) {
      paths.push(chevronPath('down', 11.4, 4.2, 2.8))
      paths.push(chevronPath('down', 7.4, 4.2, 2.8))
    } else if (n === 3) {
      paths.push(chevronPath('down', 12.4, 3.9, 2.3))
      paths.push(chevronPath('down', 9.2, 3.9, 2.3))
      paths.push(chevronPath('down', 6.0, 3.9, 2.3))
    } else {
      paths.push(chevronPath('down', 13.3, 3.7, 2.0))
      paths.push(chevronPath('down', 10.7, 3.7, 2.0))
      paths.push(chevronPath('down', 8.1, 3.7, 2.0))
      paths.push(chevronPath('down', 5.5, 3.7, 2.0))
    }
  }

  const strokeWidth = n === 1 ? 2.2 : n === 2 ? 2.0 : 1.8

  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? 'h-3.5 w-3.5'}
      style={style}
    >
      {paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  )
}
