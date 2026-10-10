/**
 * 设置 → 开发者：口令解锁与开发者工具调试。
 */

import { useState } from 'react'
import { Bell, Bug, Check, RefreshCw, ShieldCheck, Sparkles, Terminal, X } from 'lucide-react'
import { isDevUnlocked } from '../../lib/devMode'
import { native } from '../../lib/native'
import { clearMockUpdate, isMockUpdateActive, mockUpdatePush, useUpdateState } from '../../lib/update'
import DevUnlock from '../DevUnlock'
import { pane } from '../Pane'
import { t } from '../../i18n'
import { inputBase } from './fields'

export function DevPanel({ onUnlocked }: { onUnlocked: () => void }) {
  const [unlocked, setUnlocked] = useState(isDevUnlocked)
  const [notifyResult, setNotifyResult] = useState<{ ok: boolean; text: string } | null>(null)
  useUpdateState()
  const isMock = isMockUpdateActive()

  const sendTestNotify = () => {
    try {
      void native()
        .window.notify({
          title: t('归一通知测试'),
          body: t('这是一条测试通知：看到它、听到提示音，说明系统通知链路是通的。'),
        })
        .then((r) => {
          setNotifyResult(
            r.ok
              ? {
                  ok: true,
                  text: t(
                    '系统已受理这条通知。屏幕上没看到的话，多半是 Windows 的专注助手（勿扰）或系统通知设置把它静默压掉了。'
                  ),
                }
              : { ok: false, text: r.error ?? t('未知错误') }
          )
        })
    } catch (err) {
      setNotifyResult({ ok: false, text: err instanceof Error ? err.message : String(err) })
    }
  }

  if (!unlocked) {
    return (
      <div className={pane(5, true)}>
        <section className="flex flex-col items-center justify-center rounded-2xl border border-line bg-card/60 p-6 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-line bg-paper text-seal shadow-2xs">
            <Terminal size={24} />
          </div>

          <h2 className="mt-3 text-[15px] font-semibold text-ink-strong">
            {t('开发者模式解锁')}
          </h2>
          <p className="mt-1 max-w-md text-[11.5px] leading-relaxed text-ink-soft">
            {t('这一页平时隐蔽。输入开发者口令解锁后凭据将存入本地，后续可直接打开调试工具与诊断项。')}
          </p>

          <div className="mt-4 flex flex-col items-center gap-2">
            <DevUnlock
              inputClass={`${inputBase} w-[240px] font-mono text-center`}
              onUnlocked={() => {
                setUnlocked(true)
                onUnlocked()
              }}
            />
          </div>

          <p className="mt-4 text-[10.5px] text-ink-faint">
            {t('程序仅保存口令的 SHA-256 摘要进行校验，不会明文存盘。')}
          </p>
        </section>
      </div>
    )
  }

  return (
    <div className={pane(5, true)}>
      {/* 头部简介与已解锁徽标 */}
      <div className="flex flex-col gap-2 border-b border-line pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Terminal size={16} className="text-seal" />
            <h2 className="text-[14px] font-semibold text-ink-strong">{t('开发者与诊断')}</h2>
          </div>
          <p className="mt-1 text-[11.5px] text-ink-soft">
            {t('唤起 Chromium 开发者工具，诊断系统原生桥接与通知链路。')}
          </p>
        </div>

        <div className="flex items-center gap-1.5 rounded-full border border-ok/40 bg-ok/10 px-2.5 py-1 text-[11px] text-ok-deep">
          <ShieldCheck size={11} />
          <span>{t('开发者模式已激活')}</span>
        </div>
      </div>

      {/* 开发者工具卡片 */}
      <section className="rounded-xl border border-line bg-card/60 p-3.5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2.5">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-line bg-card text-seal">
              <Bug size={15} />
            </div>
            <div>
              <div className="text-[13px] font-medium text-ink-strong">{t('Chromium 开发者工具')}</div>
              <p className="mt-0.5 text-[11px] leading-relaxed text-ink-faint">
                {t('打开审查 DOM、网络请求与控制台报错的 DevTools 独立窗口。已开着时会自动重置置顶。')}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => native().window.devtools()}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-line bg-card px-3 py-1.5 text-[12px] font-medium text-ink transition hover:border-line-strong hover:bg-card/80"
          >
            <Bug size={13} className="text-seal" />
            <span>{t('打开 DevTools')}</span>
          </button>
        </div>
      </section>

      {/* 系统通知测试卡片 */}
      <section className="rounded-xl border border-line bg-card/60 p-3.5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2.5">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-line bg-card text-seal">
              <Bell size={15} />
            </div>
            <div>
              <div className="text-[13px] font-medium text-ink-strong">{t('系统原生通知测试')}</div>
              <p className="mt-0.5 text-[11px] leading-relaxed text-ink-faint">
                {t('向操作系统发送一条模拟通知，检测专注守卫与分心警告的系统消息通道是否正常。')}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={sendTestNotify}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-line bg-card px-3 py-1.5 text-[12px] font-medium text-ink transition hover:border-line-strong hover:bg-card/80"
          >
            <Bell size={13} className="text-seal" />
            <span>{t('发送测试通知')}</span>
          </button>
        </div>

        {notifyResult && (
          <div
            className={`mt-3 rounded-lg border p-2.5 text-[11px] leading-relaxed ${
              notifyResult.ok
                ? 'border-ok/30 bg-ok/5 text-ok-deep'
                : 'border-warn/30 bg-warn/5 text-warn-deep'
            }`}
          >
            {notifyResult.text}
          </div>
        )}
      </section>

      {/* 自动更新 UI 调试与模拟推送卡片 */}
      <section className="rounded-xl border border-line bg-card/60 p-3.5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2.5">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-line bg-card text-seal">
              <RefreshCw size={15} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-medium text-ink-strong">
                  {t('版本更新推送模拟')}
                </span>
                {isMock && (
                  <span className="rounded-full bg-seal/12 px-2 py-0.5 text-[10px] font-medium text-seal-deep">
                    {t('模拟推送中')}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-[11px] leading-relaxed text-ink-faint">
                {t('伪造一份新版本（v1.2.0）已下载就绪的状态。触发后顶栏将立即显现更新胶囊按钮，鼠标悬停可预览完整的富文本更新日志，点击可打开确认安装弹窗。')}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {isMock ? (
              <button
                type="button"
                onClick={clearMockUpdate}
                className="flex items-center gap-1.5 rounded-lg border border-line bg-card px-3 py-1.5 text-[12px] font-medium text-ink-soft transition hover:border-line-strong hover:text-ink"
              >
                <X size={13} />
                <span>{t('清除模拟状态')}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => mockUpdatePush()}
                className="flex items-center gap-1.5 rounded-lg bg-seal px-3 py-1.5 text-[12px] font-medium text-white shadow-2xs transition hover:bg-seal-deep active:scale-[0.98]"
              >
                <Sparkles size={13} />
                <span>{t('模拟新版本推送')}</span>
              </button>
            )}
          </div>
        </div>

        {isMock && (
          <div className="mt-3 flex items-center justify-between rounded-lg border border-ok/30 bg-ok/5 px-3 py-2 text-[11px] text-ok-deep">
            <span>{t('新版本 v1.2.0 模拟推送已激活！请查看右上角顶栏更新按钮或悬浮 Tip。')}</span>
            <button
              type="button"
              onClick={clearMockUpdate}
              className="text-[11px] underline underline-offset-2 opacity-80 hover:opacity-100"
            >
              {t('点击重置')}
            </button>
          </div>
        )}
      </section>

      {/* 底部提示 */}
      <div className="flex items-center gap-1.5 rounded-lg border border-line bg-card/50 px-3 py-2 text-[11px] text-ink-soft">
        <Check size={12} className="text-ok-deep stroke-[2.5]" />
        <span>{t('开发者功能仅在当前设备调试时使用，不影响常规笔记和文档。')}</span>
      </div>
    </div>
  )
}
