/**
 * 开发者控制台窗口那一侧的根组件（`?devConsole=1` 分支，见 main.tsx 与
 * electron/app/devConsoleWindow）。
 *
 * 只做只读展示：主进程持有日志环形缓冲，窗口打开时先回放快照，之后靠 dev:entry
 * 实时追加。这里不读用户数据、不写盘，也不再提供其它开发者功能（后续再加）。
 *
 * 窗口是无边框的独立 BrowserWindow：顶栏负责拖动与最小化/最大化/关闭，
 * macOS 的红绿灯由系统画（hiddenInset），所以左侧留出交通灯的位置。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Copy, Minus, Square, Terminal, X } from 'lucide-react'
import { isElectron, isMac } from '../../lib/native'
import { t } from '../../i18n'
import type { DevLogEntry, DevLogLevel } from '../../../shared/ipc'
import { DevWorkTestPanel } from './DevWorkTestPanel'

const MAX_ENTRIES = 2_000

/** 快照与实时流可能交错，按 id 合并去重后再按 id 排序，最后截断到窗口上限。 */
function mergeEntries(base: DevLogEntry[], extra: DevLogEntry[]): DevLogEntry[] {
  const byId = new Map<number, DevLogEntry>()
  for (const entry of base) byId.set(entry.id, entry)
  for (const entry of extra) byId.set(entry.id, entry)
  return [...byId.values()].sort((a, b) => a.id - b.id).slice(-MAX_ENTRIES)
}

function timeText(ts: number): string {
  const d = new Date(ts)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`
}

const LEVEL_CLASS: Record<DevLogLevel, string> = {
  debug: 'text-[#7d8590]',
  log: 'text-[#a5d6ff]',
  info: 'text-[#79c0ff]',
  warn: 'text-[#e3b341]',
  error: 'text-[#ff7b72]',
}

function sourceBadge(entry: DevLogEntry): string {
  return entry.source === 'main'
    ? 'border-[#d29922]/35 bg-[#d29922]/10 text-[#e3b341]'
    : 'border-[#39c5cf]/35 bg-[#39c5cf]/10 text-[#56d4dd]'
}

export default function DevConsoleWindow() {
  const [entries, setEntries] = useState<DevLogEntry[]>([])
  const [maximized, setMaximized] = useState(false)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const stickToBottom = useRef(true)
  const nativeApi = isElectron() ? window.mojiNative : null
  const mac = isMac()

  // 先订阅实时流，再取快照：快照可能比实时事件晚到，mergeEntries 负责去重
  useEffect(() => {
    const api = nativeApi?.devConsole
    if (!api) return
    let alive = true
    const off = api.onEntry((entry) => {
      if (!alive) return
      setEntries((prev) => {
        const next = [...prev, entry]
        return next.length > MAX_ENTRIES ? next.slice(-MAX_ENTRIES) : next
      })
    })
    void api
      .logs()
      .then((logs) => {
        if (alive) setEntries((prev) => mergeEntries(logs, prev))
      })
      .catch(() => {
        // 读不到快照就只显示后续实时日志，不影响控制台工作
      })
    return () => {
      alive = false
      off()
    }
  }, [nativeApi])

  // 窗口尺寸变化后跟随最大化状态；macOS 的红绿灯由系统管，不订
  useEffect(() => {
    if (!nativeApi || mac) return
    let alive = true
    void nativeApi.window.isMaximized().then((v) => {
      if (alive) setMaximized(v)
    })
    const off = nativeApi.window.onMaximizeChange(setMaximized)
    return () => {
      alive = false
      off()
    }
  }, [nativeApi, mac])

  // 只有用户本来就在底部时才自动跟随；往上翻看旧日志时不能把他拽回底部
  useEffect(() => {
    const el = scrollerRef.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [entries])

  const countText = useMemo(() => t('{0} 条日志', entries.length), [entries.length])

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#0b0e14] text-[#c9d1d9]">
      <header
        className={
          'app-drag flex h-10 shrink-0 items-center gap-2 border-b border-white/[0.07] bg-[#11151c] pr-1 ' +
          (nativeApi && mac ? 'pl-[76px]' : 'pl-3')
        }
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-[#39c5cf]/10 text-[#56d4dd]">
          <Terminal size={13} />
        </span>
        <span className="shrink-0 text-[12px] font-semibold text-[#e6edf3]">{t('开发者控制台')}</span>
        <span className="min-w-0 truncate text-[10.5px] text-[#7d8590]">
          {t('主进程 + 主窗口渲染进程')}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5 rounded-full border border-[#3fb950]/30 bg-[#3fb950]/10 px-2 py-0.5 text-[10px] text-[#7ee787]">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#3fb950]" />
          {t('实时')}
        </span>
        {nativeApi && !mac && (
          <div className="no-drag flex shrink-0 items-center">
            <button
              type="button"
              onClick={() => nativeApi.window.minimize()}
              className="flex h-10 w-11 items-center justify-center text-[#8b949e] transition hover:bg-white/[0.06] hover:text-[#e6edf3]"
              aria-label={t('最小化')}
            >
              <Minus size={14} />
            </button>
            <button
              type="button"
              onClick={() => nativeApi.window.toggleMaximize()}
              className="flex h-10 w-11 items-center justify-center text-[#8b949e] transition hover:bg-white/[0.06] hover:text-[#e6edf3]"
              aria-label={maximized ? t('还原') : t('最大化')}
            >
              {maximized ? <Copy size={11} /> : <Square size={11} />}
            </button>
            <button
              type="button"
              onClick={() => nativeApi.window.close()}
              className="flex h-10 w-11 items-center justify-center text-[#8b949e] transition hover:bg-[#f85149] hover:text-white"
              aria-label={t('关闭')}
            >
              <X size={15} />
            </button>
          </div>
        )}
      </header>

      <div className="flex min-h-0 min-w-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">

          <div
            ref={scrollerRef}
            role="log"
            aria-live="polite"
            aria-label={t('开发者控制台日志')}
            className="min-h-0 flex-1 select-text overflow-auto font-mono text-[11.5px] leading-[1.55]"
            onScroll={() => {
              const el = scrollerRef.current
              if (!el) return
              stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
            }}
          >
            {entries.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-[#7d8590]">
                <Terminal size={22} className="text-[#39c5cf]/70" />
                <div className="text-[12px]">{t('等待日志…')}</div>
                <div className="text-[10.5px] text-[#58606b]">
                  {t('主进程和主窗口渲染进程的日志会实时出现在这里。')}
                </div>
              </div>
            ) : (
              entries.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-start gap-2.5 border-b border-white/[0.045] px-3 py-[3px] hover:bg-white/[0.025]"
                >
                  <span className="w-[74px] shrink-0 text-[#5b6472]">{timeText(entry.ts)}</span>
                  <span
                    title={entry.source === 'main' ? t('主进程') : t('渲染进程')}
                    className={`w-[52px] shrink-0 rounded border px-1 py-[0.5px] text-center text-[9.5px] tracking-wide ${sourceBadge(entry)}`}
                  >
                    {entry.source === 'main' ? 'MAIN' : 'RENDER'}
                  </span>
                  <span className={`w-[42px] shrink-0 text-[10px] font-semibold uppercase ${LEVEL_CLASS[entry.level]}`}>
                    {entry.level}
                  </span>
                  <span className={`min-w-0 flex-1 whitespace-pre-wrap break-words ${entry.level === 'error' ? 'text-[#ffb3ad]' : 'text-[#c9d1d9]'}`}>
                    {entry.text}
                  </span>
                  {entry.origin && (
                    <span className="max-w-[190px] shrink-0 truncate text-[9.5px] text-[#58606b]" title={entry.origin}>
                      {entry.origin}
                    </span>
                  )}
                </div>
              ))
            )}
          </div>

          <footer className="flex h-7 shrink-0 items-center gap-2 border-t border-white/[0.07] bg-[#11151c] px-3 text-[10px] text-[#7d8590]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#39c5cf]/70" />
            <span>{t('主进程 + 主窗口渲染进程')}</span>
            <span className="ml-auto tabular-nums text-[#58606b]">{countText}</span>
          </footer>
        </div>

        <DevWorkTestPanel />
      </div>
    </div>
  )
}
