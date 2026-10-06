import { Monitor, Camera, ShieldCheck, AlertTriangle, Pause } from 'lucide-react'
import { useState, useSyncExternalStore } from 'react'
import { guardSnapshot, subscribeGuard, type GuardRound, type GuardSession } from '../../agent/guardRuntime'
import { guardSystemPrompt } from '../../learn/focusGuard'
import { t } from '../../i18n'

/**
 * 守卫 agent 的上下文页签：严格专注期间「守卫看见了什么、怎么想、判了什么」的旁路观察窗。
 *
 * 守卫不在这里运行——它是模块级单例（agent/guardRuntime），不打开这个页签也照常
 * 周期抽帧、发模型、出判定；这里只是把它的上下文构建摊开给人看：系统提示词、
 * 每一轮真正送给模型的图像与现场说明、模型的思考与回复原文、解析出的判定与动作。
 * 图像字节只活在内存里（会话结束即逝），随页签看一眼是它唯一的去处。
 */

/** 判定动作的一行徽标（颜色即语义：绿正常、琥珀警告、蓝暂停、红熔断） */
const ACTION_META: Record<string, { label: string; cls: string }> = {
  none: { label: '在学', cls: 'bg-ok/10 text-ok-deep' },
  warn: { label: '分心警告', cls: 'bg-warn/10 text-warn-deep' },
  pause: { label: '判离开 · 已暂停', cls: 'bg-seal/10 text-seal-deep' },
  fuse: { label: '隐私熔断', cls: 'bg-seal-deep/10 text-seal-deep' },
}

export default function GuardView() {
  const snap = useSyncExternalStore(subscribeGuard, guardSnapshot)
  // 正在跑的优先；跑完的留到下一次严格专注开始前，供回看
  const session = snap.session ?? snap.lastSession
  if (!session) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <ShieldCheck size={28} className="text-ink-faint" />
        <p className="text-[13px] text-ink-soft">{t('守卫还没有跑过。')}</p>
        <p className="max-w-[420px] text-[11.5px] leading-relaxed text-ink-faint">
          {t('在顶栏番茄钟的 tip 里勾选「监控屏幕」或「监控摄像头」，开始专注后守卫就会在这里建起自己的上下文：每分钟看一眼画面，判断你在不在学、在不在屏幕前，涉及隐私会立即熔断。')}
        </p>
      </div>
    )
  }
  return <GuardSession session={session} />
}

function GuardSession({ session }: { session: GuardSession }) {
  const stateLabel =
    session.state === 'running'
      ? t('当值中')
      : session.state === 'paused'
        ? t('已暂停——等你回来')
        : session.state === 'fused'
          ? t('已熔断')
          : t('已结束')
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 会话头：状态、开了哪几路监控、看过多少轮 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-4 py-2.5">
        <ShieldCheck size={14} className={session.state === 'fused' ? 'text-seal-deep' : 'text-seal'} />
        <span className="text-[13px] font-medium text-ink">{t('守卫 Agent')}</span>
        <span
          className={
            'rounded-full px-2 py-0.5 text-[10.5px] font-medium ' +
            (session.state === 'fused' ? 'bg-seal-deep/10 text-seal-deep' : 'bg-seal/10 text-seal-deep')
          }
        >
          {stateLabel}
        </span>
        <span className="flex items-center gap-1 text-[11px] text-ink-faint">
          {session.monitors.screen && (
            <span className="flex items-center gap-0.5">
              <Monitor size={11} /> {t('屏幕')}
            </span>
          )}
          {session.monitors.camera && (
            <span className="flex items-center gap-0.5">
              <Camera size={11} /> {t('摄像头')}
            </span>
          )}
        </span>
        <span className="ml-auto text-[11px] text-ink-faint">{t('已看 {0} 眼', session.rounds.length)}</span>
      </div>
      {session.fuse && (
        <div className="border-b border-line bg-seal-deep/5 px-4 py-2 text-[11.5px] text-seal-deep">
          {t('因隐私保护熔断：{0}', session.fuse.reason)}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {/* 上下文的第一件东西是系统提示词：按勾选的监控现算，收起来不占地方 */}
        <details className="mb-3 rounded-md border border-line bg-paper-deep/30">
          <summary className="cursor-pointer select-none px-3 py-1.5 text-[11.5px] text-ink-soft">
            {t('系统提示词（按勾选的监控现算）')}
          </summary>
          <pre className="whitespace-pre-wrap px-3 pb-2.5 text-[11px] leading-relaxed text-ink-faint">{guardSystemPrompt(session.monitors)}</pre>
        </details>
        {/* 轮次新 → 旧：回看的人关心的是「刚刚发生了什么」 */}
        {[...session.rounds].reverse().map((round) => (
          <GuardRoundCard key={round.at} round={round} />
        ))}
        {!session.rounds.length && (
          <p className="py-6 text-center text-[12px] text-ink-faint">{t('还没有看过任何一眼——等第一轮监控（开始后约半分钟）。')}</p>
        )}
      </div>
    </div>
  )
}

function GuardRoundCard({ round }: { round: GuardRound }) {
  const [zoomed, setZoomed] = useState<number | null>(null)
  const meta = round.error ? { label: t('没看懂这一轮'), cls: 'bg-line/60 text-ink-faint' } : ACTION_META[round.action] ?? ACTION_META.none
  return (
    <div className="mb-2.5 rounded-lg border border-line bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-line/60 px-3 py-1.5">
        <span className="font-mono text-[10.5px] text-ink-faint">{fmtClock(round.at)}</span>
        <span className="flex items-center gap-1 text-[10.5px] text-ink-faint">
          {round.screen && (
            <span className="flex items-center gap-0.5">
              <Monitor size={10} /> {t('屏幕')}
            </span>
          )}
          {round.camera && (
            <span className="flex items-center gap-0.5">
              <Camera size={10} /> {t('摄像头')}
            </span>
          )}
        </span>
        <span className={'ml-auto rounded-full px-2 py-0.5 text-[10px] font-medium ' + meta.cls}>
          {round.action === 'pause' ? <Pause size={9} className="mr-0.5 inline" /> : round.action === 'warn' || round.action === 'fuse' ? <AlertTriangle size={9} className="mr-0.5 inline" /> : null}
          {meta.label}
        </span>
      </div>
      <div className="px-3 py-2">
        {/* 真正送进上下文的图像：点一下放大再看（就是这些帧发给了模型） */}
        {round.images.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {round.images.map((img, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setZoomed(zoomed === i ? null : i)}
                title={t('点开看大图（这一帧已发给模型）')}
                className="overflow-hidden rounded-md border border-line transition hover:border-seal/50"
              >
                <img
                  src={`data:${img.mime};base64,${img.data}`}
                  alt={t('守卫在第 {0} 秒看到的画面', Math.round(round.at / 1000))}
                  className={zoomed === i ? 'max-h-[420px] w-auto' : 'h-16 w-auto'}
                />
              </button>
            ))}
          </div>
        )}
        <p className="text-[11px] leading-relaxed text-ink-faint">{t('随图发送：{0}', round.context)}</p>
        {round.verdict && (
          <p className="mt-1.5 text-[12px] text-ink">
            <span className="text-ink-faint">{t('判定：')}</span>
            {round.verdict.reason || t('（无说明）')}
          </p>
        )}
        {round.error && <p className="mt-1.5 text-[11.5px] text-warn-deep">{round.error}</p>}
        {/* 思考与回复原文都在细节里：默认收起，上下文摊开看时才有 */}
        {(round.reasoning || round.raw) && (
          <details className="mt-1.5">
            <summary className="cursor-pointer select-none text-[11px] text-ink-soft">{t('模型的思考与回复原文')}</summary>
            {round.reasoning && (
              <pre className="mt-1.5 whitespace-pre-wrap rounded-md bg-paper-deep/40 px-2.5 py-1.5 text-[11px] leading-relaxed text-ink-faint">{round.reasoning}</pre>
            )}
            <pre className="mt-1.5 whitespace-pre-wrap rounded-md bg-paper-deep/40 px-2.5 py-1.5 text-[11px] leading-relaxed text-ink">{round.raw}</pre>
          </details>
        )}
      </div>
    </div>
  )
}

/** 当天时钟（HH:MM:SS）：轮次的时间戳本来就是「今天第几眼」 */
function fmtClock(at: number): string {
  const d = new Date(at)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
