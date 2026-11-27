/**
 * 智能体页的「网页」页。
 *
 * 和「对话 / 思维」并列的第三个视图，不再浮在右下角：
 * 只有当前这段对话有后台浏览器会话时，页签才出现；本页占满中央工作区。
 * 真正的 `<webview>` 常驻在 App 根部的 AgentBrowserHost，这里只负责画视口矩形与控制条。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Globe2, Hand, Pause, Play, Square, ChevronLeft } from 'lucide-react'
import { t } from '../../../i18n'
import {
  agentBrowserRuntime,
  useAgentBrowserSnapshot,
  type AgentBrowserPhase,
  type AgentBrowserSessionInfo,
} from '../../../learn/web/agentBrowser'
import { browserSessionsOf, type AgentBrowserTabScope } from './useAgentBrowserTab'

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

export default function AgentBrowserPage({
  scope,
  active = true,
}: {
  scope: AgentBrowserTabScope | null
  /** 这一枚 AgentPanel 是不是当前可见页：隐藏页不抢全局 viewport。 */
  active?: boolean
}) {
  const snapshot = useAgentBrowserSnapshot()
  const sessions = useMemo(() => browserSessionsOf(snapshot.sessions, scope), [snapshot.sessions, scope])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const shown =
    sessions.find((s) => s.sessionId === selectedId) ??
    sessions.find((s) => s.active) ??
    sessions[0] ??
    null
  const shownId = shown?.sessionId ?? null

  useEffect(() => {
    if (!active || !shownId) return
    try {
      agentBrowserRuntime.showSession(shownId)
    } catch {
      return
    }
    const el = bodyRef.current
    if (!el) {
      agentBrowserRuntime.hideSession()
      return
    }
    let raf = 0
    const update = (): void => {
      const r = el.getBoundingClientRect()
      agentBrowserRuntime.setViewport(
        shownId,
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
      agentBrowserRuntime.clearViewport(shownId)
      // 页面走掉，用户不可能还在直接操作；把接管权还给智能体，避免 work 永久等待。
      if (agentBrowserRuntime.get(shownId)?.control === 'user') {
        agentBrowserRuntime.setControl(shownId, 'agent')
      }
      agentBrowserRuntime.hideSession()
    }
  }, [active, shownId])

  if (!shown) return null

  return (
    <div
      data-agent-browser-page
      className="flex h-full min-h-0 w-full flex-1 flex-col bg-card/45"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2.5">
        <Globe2 size={16} className="shrink-0 text-seal" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-ink-strong">
            {t('智能体浏览器')} · {ownerLabel(shown)}
          </div>
          <div className="truncate text-[11px] text-ink-soft">
            {shown.title || shown.url || t('空白页')}
          </div>
        </div>
        <span className={`h-2 w-2 shrink-0 rounded-full ${dotClass(shown.phase, shown.control)}`} />
        <span className="max-w-[180px] truncate text-[11px] text-ink-soft">{phaseLabel(shown)}</span>
      </div>

      {sessions.length > 1 && (
        <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-line px-2 py-1.5">
          {sessions.map((s) => (
            <button
              key={s.sessionId}
              type="button"
              onClick={() => setSelectedId(s.sessionId)}
              className={`flex min-w-0 items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition ${
                s.sessionId === shown.sessionId
                  ? 'border-seal/40 bg-seal/10 text-ink-strong'
                  : 'border-line bg-transparent text-ink-soft hover:bg-line/40'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${dotClass(s.phase, s.control)}`} />
              <span className="max-w-[220px] truncate">{s.title || ownerLabel(s)}</span>
            </button>
          ))}
        </div>
      )}

      <div
        ref={bodyRef}
        className="relative m-3 min-h-0 flex-1 overflow-hidden rounded-lg border border-line-strong bg-paper"
      >
        {shown.phase === 'loading' && !shown.title && (
          <div className="flex h-full items-center justify-center text-[12px] text-ink-faint">
            {t('页面加载中…')}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-line px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] font-medium text-ink">{phaseLabel(shown)}</div>
            <div className="mt-0.5 truncate text-[10.5px] text-ink-faint">
              {shown.control === 'user'
                ? t('你正在操作浏览器；智能体已暂停。')
                : shown.control === 'paused'
                  ? t('智能体已暂停，等待你继续。')
                  : t('会话在后台运行；点“接管”或直接点页面可随时接手。')}
            </div>
          </div>
          {shown.control === 'user' ? (
            <button
              type="button"
              onClick={() => agentBrowserRuntime.setControl(shown.sessionId, 'agent')}
              className="flex items-center gap-1 rounded-md border border-line-strong px-2 py-1 text-[11px] text-ink transition hover:bg-line/40"
            >
              <ChevronLeft size={13} /> {t('交还')}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => agentBrowserRuntime.setControl(shown.sessionId, 'user')}
              className="flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-700 transition hover:bg-amber-500/15 dark:text-amber-300"
            >
              <Hand size={13} /> {t('接管')}
            </button>
          )}
          <button
            type="button"
            onClick={() =>
              agentBrowserRuntime.setControl(
                shown.sessionId,
                shown.control === 'paused' ? 'agent' : 'paused',
              )
            }
            className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] text-ink-soft transition hover:bg-line/40"
          >
            {shown.control === 'paused' ? <Play size={13} /> : <Pause size={13} />}
            {shown.control === 'paused' ? t('继续') : t('暂停')}
          </button>
          <button
            type="button"
            onClick={() => agentBrowserRuntime.close(shown.sessionId)}
            className="flex items-center gap-1 rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-[11px] text-rose-700 transition hover:bg-rose-500/15 dark:text-rose-300"
            title={t('停止并关闭会话')}
          >
            <Square size={12} /> {t('停止')}
          </button>
        </div>
        {shown.actions.length > 0 && (
          <div className="mt-1.5 flex gap-2 overflow-x-auto text-[10px] text-ink-faint">
            {shown.actions.slice(-3).map((a) => (
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
