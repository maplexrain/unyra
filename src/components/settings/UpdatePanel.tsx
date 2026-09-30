/**
 * 这个文件负责：「更新」分页：开关、手动检查、安装包与下载进度。
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { CheckCircle2, Download, Loader2, RefreshCw } from 'lucide-react'
import {
  checkForUpdates,
  downloadUpdate,
  formatBytes,
  formatSpeed,
  installUpdate,
  loadAutoUpdate,
  notesHtml,
  openReleasePage,
  setAutoUpdate,
  updateCheckedText,
  updateFailText,
  useUpdateState,
} from '../../lib/update'
import { pane } from '../Pane'
import { t } from '../../i18n'

/**
 * 「更新」分页。
 *
 * 三件事放在同一页，因为它们是同一个问题的三个面：
 * 1. **要不要自动**——启动时查一次、之后每 5 分钟一次，查到就自己下；
 *    关掉之后连请求都不发（「不打扰」必须包括不产生网络请求），但手动那条入口留着；
 * 2. **现在什么情况**——当前版本、上次检查、有没有新版本；
 * 3. **下到哪了**——安装包文件名、体积、已下载字节与速度。
 *
 * 为什么进度只在这一页显示：顶栏在整个下载过程中是彻底安静的（那是有意为之，
 * 见 docs/packaging-and-release.md），而这一页是用户特意打开来看的——不给进度反而让人以为卡住了。
 */
export function UpdatePanel() {
  const state = useUpdateState()
  const [busy, setBusy] = useState(false)
  /** null = 还没从主进程读回来 */
  const [auto, setAuto] = useState<boolean | null>(null)
  const html = useMemo(() => notesHtml(state?.notes), [state?.notes])

  useEffect(() => {
    void loadAutoUpdate().then(setAuto)
  }, [])

  const check = () => {
    setBusy(true)
    void checkForUpdates().finally(() => setBusy(false))
  }

  const on = auto === true
  const toggleAuto = () => {
    const next = !on
    // 先按用户点的显示，再以主进程存盘后的值为准（存不下来就回滚，不会显示一个没生效的状态）
    setAuto(next)
    void setAutoUpdate(next).then(setAuto)
  }

  const phase = state?.phase ?? 'idle'
  const checking = busy || phase === 'checking'
  const percent = typeof state?.percent === 'number' ? state.percent : 0
  const showPackage = phase === 'available' || phase === 'downloading' || phase === 'ready'

  let status: ReactNode
  if (phase === 'disabled') {
    status = (
      <span className="text-ink-faint">
        {t('这个运行方式不参与自动更新（开发运行，或不是 Windows 打包版本）。')}
      </span>
    )
  } else if (phase === 'checking') {
    status = <span className="text-ink-soft">{t('正在检查…')}</span>
  } else if (phase === 'available') {
    status = <span className="text-ink-strong">{t('发现新版本 v{0}，还没有下载。', state?.version ?? '')}</span>
  } else if (phase === 'downloading') {
    status = <span className="text-ink-soft">{t('正在后台下载 v{0}…', state?.version ?? '')}</span>
  } else if (phase === 'ready') {
    status = <span className="text-ink-strong">{t('新版本 v{0} 已经下载完成，可以安装了。', state?.version ?? '')}</span>
  } else if (phase === 'installing') {
    status = <span className="text-ink-soft">{t('正在更新，应用即将关闭…')}</span>
  } else if (phase === 'error') {
    status = <span className="text-warn-deep">{t(updateFailText(state?.reason, state?.detail))}</span>
  } else {
    status = (
      <span className="text-ink-soft">{state?.checkedAt ? t('已是最新版本。') : t('还没有检查过。')}</span>
    )
  }

  return (
    <div className={pane(5, true)}>
      <section>
        <div className="mb-2 flex items-center gap-1.5 text-ink-soft">
          <RefreshCw size={11} className="text-ink-faint" />
          {t('版本')}
        </div>
        <div className="rounded-lg border border-line bg-card px-3 py-2.5 text-[12px] leading-relaxed">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-ink-faint">{t('当前')}</span>
            <code className="rounded bg-paper-deep px-1.5 py-0.5 font-mono text-[12px] tracking-wider text-ink-strong">
              v{state?.current ?? __APP_VERSION__}
            </code>
            <span className="text-ink-faint">· {t(updateCheckedText(state?.checkedAt))}</span>
          </div>
          <div className="mt-1.5">{status}</div>
        </div>

        {/* 主按钮只有一个：当前这一档该做的那件事。不做「检查」与「安装」并排，
            否则用户要先想清楚该点哪一颗 */}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {phase === 'ready' ? (
            <button
              type="button"
              onClick={() => void installUpdate()}
              className="rounded-lg bg-seal px-3 py-1.5 text-[12px] font-medium text-white shadow-sm transition hover:bg-seal-deep"
            >
              {t('立即更新并重启')}
            </button>
          ) : phase === 'available' ? (
            <button
              type="button"
              onClick={() => void downloadUpdate()}
              className="rounded-lg bg-seal px-3 py-1.5 text-[12px] font-medium text-white shadow-sm transition hover:bg-seal-deep"
            >
              {t('下载 v{0}', state?.version ?? '')}
            </button>
          ) : (
            phase !== 'disabled' &&
            phase !== 'installing' && (
              <button
                type="button"
                onClick={check}
                disabled={checking}
                className="flex items-center gap-1.5 rounded-lg border border-line bg-card px-3 py-1.5 text-[12px] text-ink transition hover:border-line-strong disabled:pointer-events-none disabled:opacity-50"
              >
                {checking && <Loader2 size={12} className="animate-spin" />}
                {checking ? t('请稍候…') : t('检查最新版本')}
              </button>
            )
          )}
          {state?.releaseUrl && phase !== 'installing' && (
            <button
              type="button"
              onClick={() => void openReleasePage()}
              className="rounded-lg px-2 py-1.5 text-[11.5px] text-ink-faint transition hover:bg-line/60 hover:text-ink"
            >
              {t('查看发布页')}
            </button>
          )}
        </div>
      </section>

      {showPackage && (
        <section>
          <div className="mb-2 flex items-center gap-1.5 text-ink-soft">
            {phase === 'ready' ? (
              <CheckCircle2 size={11} className="text-ok-deep" />
            ) : (
              <Download size={11} className="text-ink-faint" />
            )}
            {t('安装包')}
          </div>
          <div className="rounded-lg border border-line bg-card px-3 py-2.5 text-[12px] leading-relaxed">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="font-medium text-ink-strong">v{state?.version}</span>
              {state?.fileName && (
                <code className="rounded bg-paper-deep px-1.5 py-0.5 font-mono text-[11.5px] text-ink-soft">
                  {state.fileName}
                </code>
              )}
              {typeof state?.size === 'number' && state.size > 0 && (
                <span className="text-ink-faint">{formatBytes(state.size)}</span>
              )}
            </div>

            {phase === 'downloading' && (
              <>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-line">
                  <div
                    className="h-full rounded-full bg-seal transition-[width] duration-300"
                    style={{ width: Math.max(2, percent) + '%' }}
                  />
                </div>
                <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 text-[11px] text-ink-faint">
                  <span className="text-ink-soft">{percent}%</span>
                  <span>
                    {formatBytes(state?.transferred)} / {formatBytes(state?.size)}
                  </span>
                  {typeof state?.bytesPerSecond === 'number' && state.bytesPerSecond > 0 && (
                    <span>{formatSpeed(state.bytesPerSecond)}</span>
                  )}
                  <span className="ml-auto">{t('下载期间不影响使用')}</span>
                </div>
              </>
            )}

            {phase === 'available' && (
              <p className="mt-1.5 text-[11px] leading-relaxed text-ink-faint">
                {t('安装包还没下载。点上面的「下载 v{0}」，下好之后顶栏会出现更新入口。', state?.version ?? '')}
              </p>
            )}
            {phase === 'ready' && (
              <p className="mt-1.5 text-[11px] leading-relaxed text-ink-faint">
                {t('已经下好并校验通过。点「立即更新并重启」：应用会关闭、静默安装，装完自动打开。')}
              </p>
            )}

            {html && (
              <>
                <div className="mt-2 border-t border-line pt-2 text-[11px] text-ink-faint">{t('更新说明')}</div>
                <div className="mt-1 max-h-56 overflow-y-auto rounded-lg border border-line bg-paper/60 px-2.5 py-2">
                  {/* 来自 GitHub Release 正文，已过 DOMPurify（见 lib/update） */}
                  <div className="moji-agent-md" dangerouslySetInnerHTML={{ __html: html }} />
                </div>
              </>
            )}
          </div>
        </section>
      )}

      <section>
        <div className="rounded-lg border border-line bg-card px-3 py-2.5">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[12px] text-ink-strong">{t('自动检查并下载更新')}</div>
              <p className="mt-1 text-[11px] leading-relaxed text-ink-faint">
                {t('打开后：应用启动时查一次，之后每 5 分钟再查一次；发现新版本会在后台自己下好，下载完成后顶栏出现「↻ 更新」，由你决定什么时候装。关掉之后不再自动联网检查，上面那颗「检查最新版本」随时仍然可用。')}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={on}
              aria-label={t('自动检查并下载更新')}
              disabled={auto === null}
              onClick={toggleAuto}
              className={
                'relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition disabled:opacity-40 ' +
                (on ? 'bg-seal' : 'bg-line-strong')
              }
            >
              <span
                className={
                  'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-all ' +
                  (on ? 'left-[1.125rem]' : 'left-0.5')
                }
              />
            </button>
          </div>
          {auto === false && (
            <p className="mt-2 text-[11px] leading-relaxed text-warn-deep">
              {t('已关闭：不会自动检查，也不会自动下载。想升级时来这里点一次「检查最新版本」。')}
            </p>
          )}
        </div>
      </section>

      <div className="rounded-lg border border-line bg-card/60 px-3 py-2.5 text-[11px] leading-relaxed text-ink-soft">
        {t('升级不改动你的数据目录；安装包从公开的发布仓库下载，下载完成后可以自己决定什么时候装。')}
      </div>
    </div>
  )
}
