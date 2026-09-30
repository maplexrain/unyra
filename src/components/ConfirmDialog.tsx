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
 * 危险操作确认框。用于删除等不可逆动作，避免误触。
 *
 * 只有「点一下按钮」这一道闸：整棵子树/整个目标被删掉之前，用户看到的是弹窗里
 * 写清后果的那句话（删掉哪些、能不能恢复），确认键上写的也是「删除目标」这样的
 * 具体动作——**问一句就够，不再要求照着敲一遍名字**：那个动作拦得住手滑，
 * 也拦得住真心要删的人，代价却是每次都要对着长标题一个字一个字地抄。
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

  return (
    <ModalScrim z="z-[60]" leaving={leaving} onClose={close}>
      <div
        role="alertdialog"
        aria-label={title}
        className={`w-full max-w-sm rounded-2xl border border-line-strong bg-paper shadow-[0_24px_64px_rgba(31,27,23,0.3)] ${
          leaving ? 'moji-dialog-out' : 'moji-dialog-in'
        }`}
      >
        <div className="flex items-start gap-2.5 border-b border-line px-5 py-3">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-seal/12 text-seal">
            <AlertTriangle size={14} />
          </span>
          <h2 className="min-w-0 flex-1 text-[15px] font-semibold text-ink-strong">
            {title}
          </h2>
          <button
            type="button"
            title={t('关闭')}
            onClick={close}
            className="flex h-6 w-6 items-center justify-center rounded-md text-ink-soft transition hover:bg-line/70 hover:text-ink"
          >
            <X size={15} />
          </button>
        </div>

        <div className="px-5 py-4 text-[13px] leading-relaxed text-ink">
          <p className="whitespace-pre-line text-ink-soft">{message}</p>
        </div>

        <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
          <button
            type="button"
            onClick={close}
            className="rounded-lg px-3.5 py-1.5 text-[12px] text-ink-soft transition hover:bg-line/60 hover:text-ink"
          >
            {t('取消')}
          </button>
          {extraLabel && onExtra && (
            <button
              type="button"
              onClick={onExtra}
              className="rounded-lg px-3.5 py-1.5 text-[12px] text-ink-soft transition hover:bg-line/60 hover:text-ink"
            >
              {extraLabel}
            </button>
          )}
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-lg bg-seal px-3.5 py-1.5 text-[12px] font-medium text-white shadow-sm transition hover:bg-seal-deep"
          >
            {t(confirmLabel)}
          </button>
        </div>
      </div>
    </ModalScrim>
  )
}
