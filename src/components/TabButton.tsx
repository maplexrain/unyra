/**
 * 页签按钮：设置弹窗与超级导师设置弹窗左侧导航里的那一颗。
 *
 * 两处的按钮外壳**逐字相同**（连选中/未选中的那串类名都一模一样），
 * 只有「点了做什么」与图标来源不同，于是抽成这一颗：改样式只改一处，
 * 也不会两处慢慢长歪。
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
      className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] transition ${
        active ? 'bg-card font-medium text-ink-strong shadow-sm' : 'text-ink-soft hover:bg-line/50 hover:text-ink'
      }`}
    >
      <Icon size={15} className={active ? 'text-seal' : 'text-ink-faint'} />
      {label}
    </button>
  )
}
