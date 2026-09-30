/**
 * 开关：设置面板里那种「一行一个功能，右边一个拨杆」。
 *
 * 抽出来是因为设置里这类东西越来越多（教学模式、语音、自动更新…），
 * 各写一遍迟早长得不一样。整行都是按钮（点文字也能切换），不是只有一个 12px 的滑块能点。
 */

interface Props {
  on: boolean
  onChange: (next: boolean) => void
  label: string
  /** 一句话说明，显示在标签下面 */
  hint?: string
  /** 关掉的时候也显示（例如「当前不支持」），点了不生效 */
  disabled?: boolean
}

export default function Switch({ on, onChange, label, hint, disabled }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={
        'flex w-full items-start gap-3 rounded-lg border border-line bg-card px-3 py-2.5 text-left transition ' +
        (disabled ? 'pointer-events-none opacity-50' : 'hover:border-line-strong')
      }
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] text-ink-strong">{label}</span>
        {hint && <span className="mt-0.5 block text-[11px] leading-relaxed text-ink-faint">{hint}</span>}
      </span>
      <span
        className={
          'relative mt-0.5 h-[18px] w-8 shrink-0 rounded-full transition ' +
          (on ? 'bg-seal' : 'bg-line-strong/60')
        }
      >
        <span
          className={
            'absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow-sm transition-all ' +
            (on ? 'left-[16px]' : 'left-[2px]')
          }
        />
      </span>
    </button>
  )
}