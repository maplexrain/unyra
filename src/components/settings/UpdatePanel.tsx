/**
 * 设置 → 更新：开关、手动检查、安装包与下载进度。
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import {
  checkForUpdates,
  clearMockUpdate,
  downloadUpdate,
  formatBytes,
  formatSpeed,
  installUpdate,
  isMockUpdateActive,
  loadAutoUpdate,
  mockUpdatePush,
  notesHtml,
  openReleasePage,
  setAutoUpdate,
  updateCheckedText,
  updateFailText,
  useUpdateState,
} from '../../lib/update'
import { isDevUnlocked } from '../../lib/devMode'
import { pane } from '../Pane'
import { t } from '../../i18n'

export function UpdatePanel() {
  const state = useUpdateState()
  const [busy, setBusy] = useState(false)
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
    setAuto(next)
    void setAutoUpdate(next).then(setAuto)
  }

  const phase = state?.phase ?? 'idle'
  const checking = busy || phase === 'checking'
  const percent = typeof state?.percent === 'number' ? state.percent : 0
  const showPackage = phase === 'available' || phase === 'downloading' || phase === 'ready'

  let statusText: ReactNode
  let statusIcon: ReactNode = <CheckCircle2 size={18} className="text-ok-deep" />

  if (phase === 'disabled') {
    statusIcon = <RefreshCw size={18} className="text-ink-faint" />
    statusText = (
      <span className="text-ink-faint">
        {t('当前运行模式（开发环境或免安装绿色版）不参与自动检查更新。')}
      </span>
    )
  } else if (phase === 'checking') {
    statusIcon = <Loader2 size={18} className="animate-spin text-seal" />
    statusText = <span className="text-ink-soft">{t('正在检查最新版本…')}</span>
  } else if (phase === 'available') {
    statusIcon = <Sparkles size={18} className="text-seal" />
    statusText = (
      <span className="font-medium text-ink-strong">
        {t('发现新版本 v{0}，准备就绪可开始下载。', state?.version ?? '')}
      </span>
    )
  } else if (phase === 'downloading') {
    statusIcon = <Download size={18} className="animate-bounce text-seal" />
    statusText = (
      <span className="font-medium text-ink-strong">
        {t('正在后台下载新版本 v{0}…', state?.version ?? '')}
      </span>
    )
  } else if (phase === 'ready') {
    statusIcon = <CheckCircle2 size={18} className="text-seal" />
    statusText = (
      <span className="font-semibold text-seal-deep">
        {t('新版本 v{0} 已下载完成，随时可以安装并重启。', state?.version ?? '')}
      </span>
    )
  } else if (phase === 'installing') {
    statusIcon = <Loader2 size={18} className="animate-spin text-seal" />
    statusText = <span className="text-ink-soft">{t('正在准备静默安装，应用即将关闭重启…')}</span>
  } else if (phase === 'error') {
    statusIcon = <AlertTriangle size={18} className="text-warn-deep" />
    statusText = <span className="text-warn-deep">{t(updateFailText(state?.reason, state?.detail))}</span>
  } else {
    statusIcon = <CheckCircle2 size={18} className="text-ok-deep" />
    statusText = (
      <span className="text-ink-soft">
        {state?.checkedAt ? t('当前已是最新版本，无需更新。') : t('尚未检查过更新。')}
      </span>
    )
  }

  return (
    <div className={pane(5, true)}>
      {/* 头部简介与当前版本徽标 */}
      <div className="flex flex-col gap-2 border-b border-line pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <RefreshCw size={16} className="text-seal" />
            <h2 className="text-[14px] font-semibold text-ink-strong">{t('应用更新')}</h2>
          </div>
          <p className="mt-1 text-[11.5px] text-ink-soft">
            {t('查看当前版本、检测新版本发布并管理后台静默下载。')}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <code className="rounded-lg border border-line bg-card px-2.5 py-1 font-mono text-[11.5px] font-semibold text-ink-strong shadow-2xs">
            v{state?.current ?? __APP_VERSION__}
          </code>
          {state?.checkedAt && (
            <span className="text-[11px] text-ink-faint">
              {t(updateCheckedText(state.checkedAt))}
            </span>
          )}
        </div>
      </div>

      {/* 主状态卡片 */}
      <section className="rounded-xl border border-line bg-card/60 p-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-card shadow-2xs">
            {statusIcon}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] leading-snug">{statusText}</div>

            {/* 下载进度条与指标 */}
            {phase === 'downloading' && (
              <div className="mt-3">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
                  <div
                    className="h-full rounded-full bg-seal transition-[width] duration-300"
                    style={{ width: `${Math.max(3, percent)}%` }}
                  />
                </div>
                <div className="mt-1.5 flex flex-wrap items-baseline justify-between text-[11px] text-ink-faint">
                  <span className="font-medium text-ink-strong">{percent}%</span>
                  <span>
                    {formatBytes(state?.transferred)} / {formatBytes(state?.size)}
                  </span>
                  {typeof state?.bytesPerSecond === 'number' && state.bytesPerSecond > 0 && (
                    <span>{formatSpeed(state.bytesPerSecond)}</span>
                  )}
                  <span>{t('下载期间不影响使用')}</span>
                </div>
              </div>
            )}

            {/* 准备就绪提示 */}
            {phase === 'ready' && (
              <p className="mt-1 text-[11px] leading-relaxed text-ink-faint">
                {t('安装包校验通过。点击下方按钮后，应用将关闭并静默安装，升级完毕自动唤醒。')}
              </p>
            )}
          </div>
        </div>

        {/* 主操作按钮组 */}
        <div className="mt-3.5 flex flex-wrap items-center gap-2 border-t border-line/70 pt-3">
          {phase === 'ready' ? (
            <button
              type="button"
              onClick={() => void installUpdate()}
              className="flex items-center gap-1.5 rounded-lg bg-seal px-3.5 py-1.5 text-[12px] font-medium text-white shadow-xs transition hover:bg-seal-deep"
            >
              <CheckCircle2 size={13} />
              <span>{t('立即更新并重启')}</span>
            </button>
          ) : phase === 'available' ? (
            <button
              type="button"
              onClick={() => void downloadUpdate()}
              className="flex items-center gap-1.5 rounded-lg bg-seal px-3.5 py-1.5 text-[12px] font-medium text-white shadow-xs transition hover:bg-seal-deep"
            >
              <Download size={13} />
              <span>{t('下载 v{0}', state?.version ?? '')}</span>
            </button>
          ) : (
            phase !== 'disabled' &&
            phase !== 'installing' && (
              <button
                type="button"
                onClick={check}
                disabled={checking}
                className="flex items-center gap-1.5 rounded-lg border border-line bg-card px-3 py-1.5 text-[12px] font-medium text-ink transition hover:border-line-strong hover:bg-card/80 disabled:opacity-50"
              >
                {checking && <Loader2 size={13} className="animate-spin text-seal" />}
                <span>{checking ? t('正在检查…') : t('检查最新版本')}</span>
              </button>
            )
          )}

          {state?.releaseUrl && phase !== 'installing' && (
            <button
              type="button"
              onClick={() => void openReleasePage()}
              className="flex items-center gap-1.5 rounded-lg border border-line bg-card px-2.5 py-1.5 text-[11.5px] text-ink-soft transition hover:border-line-strong hover:text-ink"
            >
              <ExternalLink size={12} />
              <span>{t('查看发布页')}</span>
            </button>
          )}

          {isDevUnlocked() && phase !== 'installing' && (
            <button
              type="button"
              onClick={() => {
                if (isMockUpdateActive()) clearMockUpdate()
                else mockUpdatePush()
              }}
              title={t('开发者调试：模拟新版本下载完成推送')}
              className="flex items-center gap-1.5 rounded-lg border border-dashed border-seal/40 bg-seal/5 px-2.5 py-1.5 text-[11.5px] font-medium text-seal-deep transition hover:bg-seal/10"
            >
              <Sparkles size={12} />
              <span>{isMockUpdateActive() ? t('清除模拟更新') : t('模拟更新推送')}</span>
            </button>
          )}
        </div>
      </section>

      {/* 自动下载开关卡片 */}
      <section className="rounded-xl border border-line bg-card/60 p-3.5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[13px] font-medium text-ink-strong">{t('自动检查与静默下载')}</div>
            <p className="mt-1 text-[11px] leading-relaxed text-ink-soft">
              {t(
                '开启后：应用启动时检查一次，运行期间每 5 分钟在后台静默检查。发现新版本后在后台安静下载，下载完成后在顶栏显示更新提示。关闭后完全停止自动网络检查。'
              )}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={on}
            disabled={auto === null}
            onClick={toggleAuto}
            className={`relative mt-0.5 h-[18px] w-8 shrink-0 rounded-full transition-colors disabled:opacity-40 ${
              on ? 'bg-seal' : 'bg-line-strong/60'
            }`}
          >
            <span
              className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow-sm transition-all ${
                on ? 'left-[16px]' : 'left-[2px]'
              }`}
            />
          </button>
        </div>
      </section>

      {/* 更新说明展开区 */}
      {showPackage && html && (
        <section className="rounded-xl border border-line bg-card/60 p-3.5">
          <div className="mb-2 text-[12.5px] font-medium text-ink-strong">
            {t('版本变更说明 (v{0})', state?.version ?? '')}
          </div>
          <div className="max-h-56 overflow-y-auto rounded-lg border border-line bg-paper/60 p-3 text-[12px]">
            <div className="moji-agent-md" dangerouslySetInnerHTML={{ __html: html }} />
          </div>
        </section>
      )}

      {/* 数据安全保护声明 */}
      <div className="rounded-xl border border-line bg-card/60 p-3.5 text-[11px] leading-relaxed text-ink-soft">
        <div className="flex items-center gap-1.5 font-medium text-ink-strong">
          <ShieldCheck size={14} className="text-seal" />
          <span>{t('升级安全保证')}</span>
        </div>
        <p className="mt-1">
          {t('应用升级仅替换程序文件本身，绝对不会改动或覆盖你的用户数据目录（笔记、历史对话与配置完好保留）。')}
        </p>
      </div>
    </div>
  )
}
