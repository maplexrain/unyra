/**
 * 靶心：应用里「学习目标」的记号（顶栏、目标创建页、登录页都用它）。
 *
 * 不用图标库的 Target，自己画一遍，为的是三点：
 * 1. 圆环用当前描边色、中心实心——缩到 14px 时仍能看出「靶」而不是一个点；
 * 2. 四向外侧短刻度，明确指向「对准某个目标」，不依赖外圈独自表意；
 * 3. 描边粗细与全站线条一致（1.6），跟旁边的文字、边框放在一起不突兀。
 *
 * 尺寸由 size 控制，颜色由父级文字色（currentColor）控制。
 */
export default function Bullseye({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      className={`shrink-0 ${className}`}
      aria-hidden="true"
    >
      {/* 外环：靶面 */}
      <circle cx="12" cy="12" r="8.6" />
      {/* 中环：稍细稍淡，形成「同心」的层次 */}
      <circle cx="12" cy="12" r="5.1" opacity="0.72" />
      {/* 靶心：实心点，全尺寸下最醒目的那一处 */}
      <circle cx="12" cy="12" r="1.9" fill="currentColor" stroke="none" />
      {/* 四向刻度：落在环外，不与圆环相交 */}
      <path d="M12 1.3v1.3M12 21.4v1.3M1.3 12h1.3M21.4 12h1.3" opacity="0.85" />
    </svg>
  )
}
