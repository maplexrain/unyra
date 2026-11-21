import { useEffect, useState, useSyncExternalStore } from 'react'
import { Check, Copy, Info, Radio } from 'lucide-react'
import type { AgentSettings } from '../../agent/settings'
import type { McpServeStatus } from '../../../shared/ipc'
import { getMcpServeLog, setMcpServeEnabled, subscribeMcpServeLog } from '../../agent/mcp/serveHost'
import { native } from '../../lib/native'
import Switch from '../Switch'
import { pane } from '../Pane'
import { t } from '../../i18n'

/**
 * 「对外 MCP 服务」分页（应用本身当 MCP server，外部 harness 当外设智能体）：
 * 开关、运行状态、给外部 harness 的连接配置片段与最近的调用记录。
 * 与「MCP 服务」分页方向相反——那条是应用去**消费**外部服务，这条是**开放出去**。
 */
export function ServeTab({
  settings,
  onChange,
}: {
  settings: AgentSettings
  onChange: (next: AgentSettings) => void
}) {
  const enabled = settings.mcpServe?.enabled !== false
  const [status, setStatus] = useState<McpServeStatus | null>(null)
  const [copied, setCopied] = useState(false)
  const log = useSyncExternalStore(subscribeMcpServeLog, getMcpServeLog)

  // 状态轮询：监听与连接数的变化要在几秒内看得见（这是主进程侧的真状态）
  useEffect(() => {
    let alive = true
    const pull = (): void => {
      try {
        void native()
          .mcpServe.status()
          .then((s) => {
            if (alive) setStatus(s)
          })
          .catch(() => {})
      } catch {
        // 非 Electron 环境没有这条通道：保持空状态
      }
    }
    pull()
    const timer = setInterval(pull, 3000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])

  const setEnabled = (on: boolean): void => {
    // 持久化走设置 onChange；运行面（渲染层闸门 + 主进程管道启停）由 serveHost 推
    onChange({ ...settings, mcpServe: { enabled: on } })
    setMcpServeEnabled(on)
  }

  const listening = enabled && status?.listening === true
  const snippet = JSON.stringify(
    { mcpServers: { unyra: { command: 'node', args: [status?.bridgePath || '<mcp-bridge.mjs 的路径>'] } } },
    null,
    2,
  )
  const copySnippet = (): void => {
    void navigator.clipboard
      .writeText(snippet)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => {})
  }

  return (
    <div className={pane(4)}>
      {/* 开关 */}
      <Switch
        on={enabled}
        onChange={setEnabled}
        label={t('开放对外 MCP 服务')}
        hint={t(
          '外部 AI harness（ZCode / Claude Code 等）经 MCP 连进来操作学习数据。关掉后管道与端点文件立即收起，外部连接当场失败。',
        )}
      />

      {/* 运行状态 */}
      <section className="rounded-xl border border-line bg-card p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <Radio size={15} className={listening ? 'text-emerald-500' : 'text-ink-faint'} />
          <span className="text-[13px] font-semibold text-ink-strong">{t('运行状态')}</span>
          <span
            className={
              'ml-auto rounded px-1.5 py-px text-[10.5px] font-medium ' +
              (listening ? 'bg-emerald-500/10 text-emerald-600' : 'bg-line/60 text-ink-faint')
            }
          >
            {listening ? t('监听中') : t('已停止')}
          </span>
        </div>
        <dl className="mt-3 space-y-1.5 text-[11.5px] leading-relaxed">
          <div className="flex gap-2">
            <dt className="w-20 shrink-0 text-ink-faint">{t('管道')}</dt>
            <dd className="min-w-0 truncate font-mono text-ink-soft">{status?.pipe || '—'}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-20 shrink-0 text-ink-faint">{t('端点文件')}</dt>
            <dd className="min-w-0 truncate font-mono text-ink-soft" title={status?.endpointFile}>
              {status?.endpointFile || '—'}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-20 shrink-0 text-ink-faint">{t('当前连接')}</dt>
            <dd className="text-ink-soft">{status ? String(status.connections) : '—'}</dd>
          </div>
        </dl>
      </section>

      {/* 连接配置片段 */}
      <section className="rounded-xl border border-line bg-card p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-ink-strong">{t('外部 harness 配置')}</span>
          <button
            type="button"
            onClick={copySnippet}
            className="ml-auto flex items-center gap-1 rounded-lg border border-line bg-card px-2.5 py-1 text-[11.5px] text-ink-soft transition hover:border-seal/50 hover:text-seal"
          >
            {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
            <span>{copied ? t('已复制') : t('复制')}</span>
          </button>
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-ink-faint">
          {t('把下面这段填进外部 harness 的 mcpServers 配置（应用必须正在运行）。')}
        </p>
        <pre className="mt-2 overflow-x-auto rounded-lg border border-line bg-paper-deep px-3 py-2.5 font-mono text-[10.5px] leading-relaxed text-ink-soft">
          {snippet}
        </pre>
      </section>

      {/* 调用记录 */}
      <section className="rounded-xl border border-line bg-card p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-ink-strong">{t('最近调用')}</span>
          <span className="ml-auto text-[10.5px] text-ink-faint">{t('{0} 条', log.length)}</span>
        </div>
        {log.length ? (
          <ul className="mt-2 divide-y divide-line/60">
            {log.slice(0, 12).map((e, i) => (
              <li key={e.at + '-' + i} className="flex items-center gap-2 py-1.5 text-[11.5px]">
                <span className={'h-1.5 w-1.5 shrink-0 rounded-full ' + (e.ok ? 'bg-emerald-500' : 'bg-red-500')} />
                <span className="w-16 shrink-0 font-mono text-[10.5px] text-ink-faint">
                  {new Date(e.at).toLocaleTimeString([], { hour12: false })}
                </span>
                <span className="shrink-0 font-mono text-[11px] text-ink-strong">{e.tool}</span>
                <span className="min-w-0 flex-1 truncate text-ink-soft">{e.description || '—'}</span>
                <span className="shrink-0 tabular-nums text-[10.5px] text-ink-faint">{e.ms}ms</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-[11px] text-ink-faint">{t('还没有外部调用记录。')}</p>
        )}
      </section>

      {/* 边界说明 */}
      <section className="rounded-xl border border-line bg-sunken/60 p-3.5">
        <div className="flex items-start gap-2">
          <Info size={13} className="mt-0.5 shrink-0 text-ink-faint" />
          <p className="text-[11.5px] leading-relaxed text-ink-soft">
            {t(
              '外部会话只开放与子代理同级的沙箱能力（节点宇宙 / 记忆 / 资源 / 工作区 / 联网 / 临时变量），goal 跟随你当前打开的目标；调用互相串行，数据改动实时反映到界面。',
            )}
          </p>
        </div>
      </section>
    </div>
  )
}
