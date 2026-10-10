/**
 * 页签按钮：设置弹窗与超级导师设置弹窗左侧导航里的那一颗。
 */
import type { LucideIcon } from 'lucide-react'

interface Props {
  icon: LucideIcon
  label: string
  /** 选中态：底色与字重一起变，图标也跟着换色 */
  active: boolean
  onClick: () => void
}

export default function TabButton({ icon: Icon, label, active, onClick }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[13px] transition-all duration-150 outline-none focus-visible:ring-2 focus-visible:ring-seal/40 ${
        active
          ? 'border border-line-strong/50 bg-card font-semibold text-ink-strong shadow-[0_1px_3px_rgba(0,0,0,0.05)] dark:bg-elevated'
          : 'border border-transparent text-ink-soft hover:border-line/40 hover:bg-line/35 hover:text-ink'
      }`}
    >
      <Icon
        size={15}
        className={`shrink-0 transition-colors ${
          active ? 'text-seal' : 'text-ink-faint group-hover:text-ink'
        }`}
      />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {active && (
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-seal" />
      )}
    </button>
  )
}
