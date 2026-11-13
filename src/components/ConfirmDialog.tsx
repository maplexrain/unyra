import { useEffect, useState, useMemo, useRef } from 'react'
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

  // 选项序列：默认聚焦 confirm 主按钮；支持 Tab / 方向键自由轮换焦点
  const options = useMemo<Array<'cancel' | 'extra' | 'confirm'>>(() => {
    return extraLabel && onExtra ? ['cancel', 'extra', 'confirm'] : ['cancel', 'confirm']
  }, [extraLabel, onExtra])

  const [selected, setSelected] = useState<'cancel' | 'extra' | 'confirm'>('confirm')

  const cancelRef = useRef<HTMLButtonElement | null>(null)
  const extraRef = useRef<HTMLButtonElement | null>(null)
  const confirmRef = useRef<HTMLButtonElement | null>(null)

  // 挂载时及当前选中选项变化时，自动将 DOM 焦点锁定到对应选项按钮
  useEffect(() => {
    const el =
      selected === 'confirm'
        ? confirmRef.current
        : selected === 'extra'
          ? extraRef.current
          : cancelRef.current
    if (el) {
      el.focus()
    }
  }, [selected])

  // 挂载首帧额外聚焦兜底，确保蒙层渲染完成后焦点立即可用
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      confirmRef.current?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [])

  // 键盘快捷流：Tab / 方向键自由切换，Enter 确认当前选中的选项，D 键快速放弃
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 忽略有输入框聚焦的情况
      const target = e.target as HTMLElement | null
      const isInput =
        target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      if (isInput) return

      if (e.key === 'Tab') {
        e.preventDefault()
        e.stopPropagation()
        const step = e.shiftKey ? -1 : 1
        setSelected((cur) => {
          const idx = options.indexOf(cur)
          return options[(idx + step + options.length) % options.length]
        })
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault()
        e.stopPropagation()
        setSelected((cur) => {
          const idx = options.indexOf(cur)
          return options[(idx + 1) % options.length]
        })
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault()
        e.stopPropagation()
        setSelected((cur) => {
          const idx = options.indexOf(cur)
          return options[(idx - 1 + options.length) % options.length]
        })
      } else if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        if (selected === 'confirm') {
          onConfirm()
        } else if (selected === 'extra' && onExtra) {
          onExtra()
        } else if (selected === 'cancel') {
          close()
        }
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
  }, [options, selected, onConfirm, extraLabel, onExtra, close])

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
          {/* 1. 取消按钮 */}
          <button
            ref={cancelRef}
            type="button"
            onClick={close}
            onFocus={() => setSelected('cancel')}
            onMouseEnter={() => setSelected('cancel')}
            className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-4 py-2 text-[13px] transition outline-none cursor-pointer ${
              selected === 'cancel'
                ? 'bg-line/70 text-ink ring-2 ring-seal ring-offset-2 ring-offset-paper'
                : 'text-ink-soft hover:bg-line/60 hover:text-ink'
            }`}
          >
            <span className="whitespace-nowrap">{t('取消')}</span>
            <kbd
              className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium shadow-2xs ${
                selected === 'cancel'
                  ? 'border-seal/60 bg-seal/20 text-seal'
                  : 'border-line bg-card/60 text-ink-faint'
              }`}
            >
              {selected === 'cancel' ? '↵ Enter' : 'Esc'}
            </kbd>
          </button>

          {/* 2. 次级动作按钮（如放弃改动并关闭） */}
          {extraLabel && onExtra && (
            <button
              ref={extraRef}
              type="button"
              onClick={onExtra}
              onFocus={() => setSelected('extra')}
              onMouseEnter={() => setSelected('extra')}
              className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-4 py-2 text-[13px] font-medium transition outline-none cursor-pointer ${
                selected === 'extra'
                  ? 'border-seal/80 bg-seal/15 text-seal ring-2 ring-seal ring-offset-2 ring-offset-paper'
                  : 'border-line/70 bg-card/40 text-ink hover:bg-line/60 hover:text-ink-strong'
              }`}
            >
              <span className="whitespace-nowrap">{extraLabel}</span>
              <kbd
                className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium shadow-2xs ${
                  selected === 'extra'
                    ? 'border-seal/60 bg-seal text-white'
                    : 'border-line bg-card text-ink-faint'
                }`}
              >
                {selected === 'extra' ? '↵ Enter' : 'D'}
              </kbd>
            </button>
          )}

          {/* 3. 确认主按钮（如保存并关闭） */}
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            onFocus={() => setSelected('confirm')}
            onMouseEnter={() => setSelected('confirm')}
            className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-4 py-2 text-[13px] font-medium transition outline-none cursor-pointer ${
              selected === 'confirm'
                ? 'bg-seal text-white shadow-sm hover:bg-seal-deep ring-2 ring-seal ring-offset-2 ring-offset-paper'
                : 'bg-seal/80 text-white hover:bg-seal'
            }`}
          >
            <span className="whitespace-nowrap">{t(confirmLabel)}</span>
            <kbd
              className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium shadow-2xs ${
                selected === 'confirm'
                  ? 'border-white/50 bg-white/25 text-white'
                  : 'border-white/35 bg-white/15 text-white'
              }`}
            >
              {selected === 'confirm' ? '↵ Enter' : '↵'}
            </kbd>
          </button>
        </div>
      </div>
    </ModalScrim>
  )
}
