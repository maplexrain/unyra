import { useEffect, useMemo } from 'react'
import { Loader2, RefreshCw, X } from 'lucide-react'
import { useLeaving } from '../../lib/presence'
import ModalScrim from '../ModalScrim'
import { t } from '../../i18n'
import { installUpdate, notesHtml, openReleasePage, updateFailText, useUpdateState } from '../../lib/update'

/**
 * 更新确认弹窗。
 *
 * 由 App 渲染（不在顶栏里，理由见 UpdateButton 的说明）。它只在用户**主动点了**
 * 更新入口之后才出现——下载完成不会自己弹出来。
 *
 * 点「立即更新」之后：主进程拉起安装程序并关掉应用，装完自动重新打开。
 * 这个弹窗在那半秒里改成「正在更新…」，让用户知道是自己点的那一下起了作用；
 * 万一没拉起来（极少数），状态会落到 error，弹窗当场把原因说出来，应用还开着。
 */
interface Props {
  onClose: () => void
}

export default function UpdateDialog({ onClose }: Props) {
  const state = useUpdateState()
  const { leaving, close } = useLeaving(onClose)
  const installing = state?.phase === 'installing'
  const failed = state?.phase === 'error'
  const notes = state?.notes
  const html = useMemo(() => notesHtml(notes), [notes])

  // 正在安装时不给关：那半秒里按 Escape 只会让人以为取消掉了，其实安装程序已经拉起来了
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !installing) close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close, installing])

  const title = installing ? t('正在更新') : failed ? t('更新没有完成') : t('发现新版本')

  return (
    <ModalScrim z="z-[60]" leaving={leaving} onClose={close} closeOnBackdrop={!installing}>
      <div
        role="alertdialog"
        aria-label={title}
        className={
          'w-full max-w-md rounded-2xl border border-line-strong bg-paper shadow-[0_24px_64px_rgba(31,27,23,0.3)] ' +
          (leaving ? 'moji-dialog-out' : 'moji-dialog-in')
        }
      >
        <div className="flex items-start gap-2.5 border-b border-line px-5 py-3">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-seal/12 text-seal">
            {installing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={13} />}
          </span>
          <h2 className="min-w-0 flex-1 text-[15px] font-semibold text-ink-strong">{title}</h2>
          {!installing && (
            <button
              type="button"
              title={t('关闭')}
              onClick={close}
              className="flex h-6 w-6 items-center justify-center rounded-md text-ink-soft transition hover:bg-line/70 hover:text-ink"
            >
              <X size={15} />
            </button>
          )}
        </div>

        <div className="px-5 py-4 text-[13px] leading-relaxed text-ink">
          {installing ? (
            <p className="text-ink-soft">
              {t('归一正在关闭并安装 v{0}，装好后会自动重新打开。稍等十几秒。', state?.version ?? '')}
            </p>
          ) : failed ? (
            <p className="text-warn-deep">{t(updateFailText(state?.reason, state?.detail))}</p>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <code className="rounded bg-paper-deep px-1.5 py-0.5 font-mono text-[12px] text-ink-soft">
                  v{state?.current ?? ''}
                </code>
                <span className="text-ink-faint">→</span>
                <code className="rounded bg-seal/10 px-1.5 py-0.5 font-mono text-[12px] font-medium text-seal-deep">
                  v{state?.version ?? ''}
                </code>
              </div>
              <p className="mt-2 text-ink-soft">
                {t('新版本已经下载完成，可以直接安装。归一会在安装前关闭，装好后自动重新打开。')}
              </p>

              {html && (
                <div className="mt-3 max-h-[38vh] overflow-y-auto rounded-lg border border-line bg-card px-3 py-2">
                  <div className="moji-agent-md" dangerouslySetInnerHTML={{ __html: html }} />
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
          {state?.releaseUrl && !installing && (
            <button
              type="button"
              onClick={() => void openReleasePage()}
              className="mr-auto rounded-lg px-2 py-1.5 text-[11.5px] text-ink-faint transition hover:bg-line/60 hover:text-ink"
            >
              {t('查看发布页')}
            </button>
          )}
          {installing ? (
            <span className="text-[11.5px] text-ink-faint">{t('正在切换版本…')}</span>
          ) : failed ? (
            <button
              type="button"
              onClick={close}
              className="rounded-lg bg-seal px-3.5 py-1.5 text-[12px] font-medium text-white shadow-sm transition hover:bg-seal-deep"
            >
              {t('知道了')}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={close}
                className="rounded-lg px-3.5 py-1.5 text-[12px] text-ink-soft transition hover:bg-line/60 hover:text-ink"
              >
                {t('稍后')}
              </button>
              <button
                type="button"
                onClick={() => void installUpdate()}
                className="rounded-lg bg-seal px-3.5 py-1.5 text-[12px] font-medium text-white shadow-sm transition hover:bg-seal-deep"
              >
                {t('立即更新')}
              </button>
            </>
          )}
        </div>
      </div>
    </ModalScrim>
  )
}
