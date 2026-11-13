import { useEffect } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { useEscapeKey } from '../lib/useEscape'
import { useLeaving } from '../lib/presence'
import { t } from '../i18n'
import ModalScrim from './ModalScrim'

interface Props {
  title: string
  /** 正文说明，可含多行 */
  message: string
  confirmLabel?: string
  onConfirm: () => void
  onCancel: () => void
  /**
   * 第三个（次级）动作：夹在「取消」与主按钮之间的那颗普通按钮。
   * 给三选一的确认用（如关页签的「放弃改动并关闭」、保存冲突的「另存为…」）；
   * 不传就没有这颗键，普通的两键确认照旧。
   */
  extraLabel?: string
  onExtra?: () => void
}

/**
 * 危险操作确认框（已优化大字号与键盘极速流交互）：
 *
 * 1. 字体尺寸整体加大，排版呼吸感更强，告别局促；
 * 2. 按钮自带快捷选择提示（[Enter ↵] 确认保存、[D] 放弃改动、[Esc] 取消）；
 * 3. 键盘事件原生接管，按下 Enter / D / Esc 瞬间触发对应动作，彻底免去鼠标操作。
 */
export default function ConfirmDialog({
  title,
  message,
  confirmLabel = '删除',
  onConfirm,
  onCancel,
  extraLabel,
  onExtra,
}: Props) {
  // 取消走退场动画；确认是「已经做完的事」，直接执行，不必等动画
  const { leaving, close } = useLeaving(onCancel)

  useEscapeKey(close)

  // 键盘快捷流：Enter 确认主按钮，D / d 触发次级按钮，免除移动鼠标
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 忽略有输入框聚焦的情况
      const target = e.target as HTMLElement | null
      const isInput =
        target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      if (isInput) return

      if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        onConfirm()
      } else if ((e.key === 'd' || e.key === 'D') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (extraLabel && onExtra) {
          e.preventDefault()
          e.stopPropagation()
          onExtra()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [onConfirm, extraLabel, onExtra])

  return (
    <ModalScrim z="z-[60]" leaving={leaving} onClose={close}>
      <div
        role="alertdialog"
        aria-label={title}
        className={`w-full max-w-[540px] rounded-2xl border border-line-strong bg-paper shadow-[0_24px_64px_rgba(31,27,23,0.3)] ${
          leaving ? 'moji-dialog-out' : 'moji-dialog-in'
        }`}
      >
        <div className="flex items-start gap-3 border-b border-line px-6 py-4">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-seal/12 text-seal">
            <AlertTriangle size={16} />
          </span>
          <h2 className="min-w-0 flex-1 text-[16px] font-semibold text-ink-strong">
            {title}
          </h2>
          <button
            type="button"
            title={t('关闭')}
            onClick={close}
            className="flex h-7 w-7 items-center justify-center rounded-md text-ink-soft transition hover:bg-line/70 hover:text-ink"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-6 py-5 text-[14px] leading-relaxed text-ink">
          <p className="whitespace-pre-line text-ink-soft">{message}</p>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-line px-6 py-4">
          <button
            type="button"
            onClick={close}
            className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-4 py-2 text-[13px] text-ink-soft transition hover:bg-line/60 hover:text-ink"
          >
            <span className="whitespace-nowrap">{t('取消')}</span>
            <kbd className="shrink-0 rounded border border-line bg-card/60 px-1.5 py-0.5 text-[10px] font-medium text-ink-faint shadow-2xs">
              Esc
            </kbd>
          </button>
          {extraLabel && onExtra && (
            <button
              type="button"
              onClick={onExtra}
              className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-line/70 bg-card/40 px-4 py-2 text-[13px] font-medium text-ink transition hover:bg-line/60 hover:text-ink-strong"
            >
              <span className="whitespace-nowrap">{extraLabel}</span>
              <kbd className="shrink-0 rounded border border-line bg-card px-1.5 py-0.5 text-[10px] font-medium text-ink-faint shadow-2xs">
                D
              </kbd>
            </button>
          )}
          <button
            type="button"
            onClick={onConfirm}
            autoFocus
            className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-seal px-4 py-2 text-[13px] font-medium text-white shadow-sm transition hover:bg-seal-deep"
          >
            <span className="whitespace-nowrap">{t(confirmLabel)}</span>
            <kbd className="shrink-0 rounded border border-white/35 bg-white/15 px-1.5 py-0.5 text-[10px] font-medium text-white shadow-2xs">
              ↵ Enter
            </kbd>
          </button>
        </div>
      </div>
    </ModalScrim>
  )
}
