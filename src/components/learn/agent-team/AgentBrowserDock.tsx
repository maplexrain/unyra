/**
 * 智能体页内的浏览器 Dock。
 *
 * 它不是网页页签：收起时只是一枚状态条，展开时只提供视口和状态/控制按钮；
 * 真正的 webview 常驻在 App 根部的 AgentBrowserHost 里。Dock 关闭不会中断会话。
 */
import { useEffect, useRef } from 'react'
import { Globe2, Pause, Play, Square, X, Hand, ChevronLeft } from 'lucide-react'
import { t } from '../../../i18n'
import {
  agentBrowserRuntime,
  useAgentBrowserSnapshot,
  type AgentBrowserPhase,
  type AgentBrowserSessionInfo,
} from '../../../learn/web/agentBrowser'

function phaseLabel(session: AgentBrowserSessionInfo): string {
  if (session.currentAction) return session.currentAction
  if (session.control === 'paused' || session.phase === 'paused') return t('已暂停')
  if (session.phase === 'waiting_user') return t('等待你操作')
  if (session.phase === 'loading') return t('页面加载中')
  if (session.phase === 'error') return session.lastError || t('页面出错')
  if (session.phase === 'acting') return t('正在操作')
  return t('空闲')
}

function dotClass(phase: AgentBrowserPhase, control: AgentBrowserSessionInfo['control']): string {
  if (phase === 'error') return 'bg-rose-500'
  if (phase === 'waiting_user' || control === 'user') return 'bg-amber-500'
  if (phase === 'acting' || phase === 'loading') return 'bg-seal animate-pulse'
  return 'bg-emerald-500'
}

function ownerLabel(session: AgentBrowserSessionInfo): string {
  return session.owner.roleName || session.owner.role || t('智能体')
}

export default function AgentBrowserDock({
  goalId,
  focused = true,
}: {
  goalId?: string | null
  focused?: boolean
}) {
  const snapshot = useAgentBrowserSnapshot()
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const sessions = snapshot.sessions.filter((s) => !goalId || s.owner.goalId === goalId)
  const docked = sessions.find((s) => s.sessionId === snapshot.dockSessionId) ?? null
  const primary = docked ?? sessions.find((s) => s.active) ?? sessions[0] ?? null
  const open = !!docked
  const dockedId = docked?.sessionId ?? null

  useEffect(() => {
    if (!open || !dockedId || !focused) return
    const el = bodyRef.current
    if (!el) return
    let raf = 0
    const update = (): void => {
      const r = el.getBoundingClientRect()
      agentBrowserRuntime.setViewport(
        dockedId,
        { x: r.x, y: r.y, width: r.width, height: r.height },
        r.width > 0 && r.height > 0,
      )
    }
    const schedule = (): void => {
      if (typeof requestAnimationFrame !== 'function') {
        update()
        return
      }
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(update)
    }
    update()
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null
    ro?.observe(el)
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, true)
    return () => {
      cancelAnimationFrame(raf)
      ro?.disconnect()
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule, true)
      agentBrowserRuntime.clearViewport(dockedId)
      // 视口没了，用户不可能还在直接操作；把接管权还给智能体，避免 work 永久等待。
      if (agentBrowserRuntime.get(dockedId)?.control === 'user') {
        agentBrowserRuntime.setControl(dockedId, 'agent')
      }
    }
  }, [open, dockedId, focused])

  if (!focused || sessions.length === 0) return null

  if (!open && primary) {
    return (
      <button
        type="button"
        onClick={() => agentBrowserRuntime.openDock(primary.sessionId)}
        className="absolute bottom-20 right-3 z-30 flex max-w-[min(420px,70%)] items-center gap-2 rounded-full border border-line-strong bg-card/95 px-3 py-2 text-left text-[12px] text-ink shadow-lg backdrop-blur transition hover:bg-card"
        title={t('打开智能体浏览器')}
      >
        <span className={`h-2 w-2 rounded-full ${dotClass(primary.phase, primary.control)}`} />
        <Globe2 size={14} className="shrink-0 text-ink-soft" />
        <span className="truncate font-medium">{ownerLabel(primary)}</span>
        <span className="truncate text-ink-soft">{phaseLabel(primary)}</span>
        {sessions.length > 1 && (
          <span className="shrink-0 rounded-full bg-line/60 px-1.5 py-0.5 text-[10px] text-ink-soft">
            {sessions.length}
          </span>
        )}
      </button>
    )
  }

  if (!docked) return null

  return (
    <div
      className="absolute inset-y-3 right-3 z-30 flex w-[min(480px,calc(100%-24px))] flex-col overflow-hidden rounded-xl border border-line-strong bg-card shadow-2xl"
      data-agent-browser-dock
    >
      <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
        <Globe2 size={16} className="shrink-0 text-seal" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-ink-strong">
            {t('智能体浏览器')} · {ownerLabel(docked)}
          </div>
          <div className="truncate text-[11px] text-ink-soft">
            {docked.title || docked.url || t('空白页')}
          </div>
        </div>
        <span className={`h-2 w-2 shrink-0 rounded-full ${dotClass(docked.phase, docked.control)}`} />
        <button
          type="button"
          onClick={() => agentBrowserRuntime.closeDock()}
          className="rounded-md p-1 text-ink-soft transition hover:bg-line/50 hover:text-ink"
          title={t('收起（不中断浏览器）')}
        >
          <X size={16} />
        </button>
      </div>

      {sessions.length > 1 && (
        <div className="flex gap-1 overflow-x-auto border-b border-line px-2 py-1.5">
          {sessions.map((s) => (
            <button
              key={s.sessionId}
              type="button"
              onClick={() => agentBrowserRuntime.openDock(s.sessionId)}
              className={`flex min-w-0 items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition ${
                s.sessionId === docked.sessionId
                  ? 'border-seal/40 bg-seal/10 text-ink-strong'
                  : 'border-line bg-transparent text-ink-soft hover:bg-line/40'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${dotClass(s.phase, s.control)}`} />
              <span className="max-w-[150px] truncate">{s.title || ownerLabel(s)}</span>
            </button>
          ))}
        </div>
      )}

      <div ref={bodyRef} className="relative min-h-0 flex-1 overflow-hidden bg-paper">
        {docked.control !== 'user' && (
          <button
            type="button"
            onClick={() => agentBrowserRuntime.setControl(docked.sessionId, 'user')}
            className="absolute inset-0 z-20 h-full w-full cursor-pointer bg-transparent"
            title={t('点击接管浏览器')}
          />
        )}
        {docked.phase === 'loading' && !docked.title && (
          <div className="flex h-full items-center justify-center text-[12px] text-ink-faint">
            {t('页面加载中…')}
          </div>
        )}
      </div>

      <div className="border-t border-line px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] font-medium text-ink">
              {phaseLabel(docked)}
            </div>
            <div className="mt-0.5 truncate text-[10.5px] text-ink-faint">
              {docked.control === 'user'
                ? t('你正在操作浏览器；智能体已暂停。')
                : docked.control === 'paused'
                  ? t('智能体已暂停，等待你继续。')
                  : t('会话在后台运行；点“接管”可随时接手。')}
            </div>
          </div>
          {docked.control === 'user' ? (
            <button
              type="button"
              onClick={() => agentBrowserRuntime.setControl(docked.sessionId, 'agent')}
              className="flex items-center gap-1 rounded-md border border-line-strong px-2 py-1 text-[11px] text-ink transition hover:bg-line/40"
            >
              <ChevronLeft size={13} /> {t('交还')}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => agentBrowserRuntime.setControl(docked.sessionId, 'user')}
              className="flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-700 transition hover:bg-amber-500/15 dark:text-amber-300"
            >
              <Hand size={13} /> {t('接管')}
            </button>
          )}
          <button
            type="button"
            onClick={() =>
              agentBrowserRuntime.setControl(
                docked.sessionId,
                docked.control === 'paused' ? 'agent' : 'paused',
              )
            }
            className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] text-ink-soft transition hover:bg-line/40"
          >
            {docked.control === 'paused' ? <Play size={13} /> : <Pause size={13} />}
            {docked.control === 'paused' ? t('继续') : t('暂停')}
          </button>
          <button
            type="button"
            onClick={() => agentBrowserRuntime.close(docked.sessionId)}
            className="flex items-center gap-1 rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-[11px] text-rose-700 transition hover:bg-rose-500/15 dark:text-rose-300"
            title={t('停止并关闭会话')}
          >
            <Square size={12} /> {t('停止')}
          </button>
        </div>
        {docked.actions.length > 0 && (
          <div className="mt-1.5 flex gap-2 overflow-x-auto text-[10px] text-ink-faint">
            {docked.actions.slice(-3).map((a) => (
              <span key={a.id} className="shrink-0 rounded bg-line/35 px-1.5 py-0.5">
                {a.ok === false ? '✕ ' : ''}
                {a.label}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
