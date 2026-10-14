import { useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Cpu,
  Edit3,
  Globe,
  Plus,
  RefreshCw,
  Server,
  Sparkles,
  Terminal,
  Trash2,
  Wrench,
} from 'lucide-react'
import type { McpPreset, McpServerConfig, McpSettings, McpTransport } from '../../agent/mcp/types'
import { MCP_PRESETS } from '../../agent/mcp/types'
import { McpClient } from '../../agent/mcp/client'
import { native } from '../../lib/native'
import ConfirmDialog from '../ConfirmDialog'
import Switch from '../Switch'
import { pane } from '../Pane'
import { t } from '../../i18n'

interface McpTabProps {
  settings?: McpSettings
  onChange: (next: McpSettings) => void
}

export function McpTab({ settings, onChange }: McpTabProps) {
  const servers = settings?.servers || []
  const globalEnabled = settings?.enabled !== false

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ id: string; success: boolean; msg: string } | null>(null)
  const [editingServer, setEditingServer] = useState<McpServerConfig | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [deletingServer, setDeletingServer] = useState<McpServerConfig | null>(null)
  const [showPresets, setShowPresets] = useState(false)

  /**
   * 停掉主进程里 stdio 服务的本地会话：进程是主进程起的，禁用 / 删除 / 关总开关时
   * 在这里收尾（不留下已经没人会用的子进程）。省略 id = 停掉全部。
   * 非桌面环境（或极老 preload）没有这条通道——静默跳过，禁用本身不依赖它。
   */
  const stopSession = (id?: string) => {
    try {
      void native().mcp.stop(id).catch(() => {})
    } catch {
      // 没有主进程桥可停
    }
  }

  const updateServer = (updated: McpServerConfig) => {
    const nextList = [...servers]
    const idx = nextList.findIndex((s) => s.id === updated.id)
    if (idx >= 0) {
      nextList[idx] = updated
    } else {
      nextList.push(updated)
    }
    onChange({
      enabled: globalEnabled,
      servers: nextList,
    })
  }

  const toggleServer = (server: McpServerConfig) => {
    if (server.enabled) stopSession(server.id)
    updateServer({
      ...server,
      enabled: !server.enabled,
      status: !server.enabled ? 'idle' : server.status,
      updatedAt: Date.now(),
    })
  }

  const removeServer = (id: string) => {
    stopSession(id)
    const nextList = servers.filter((s) => s.id !== id)
    onChange({
      enabled: globalEnabled,
      servers: nextList,
    })
  }

  const handleTestConnection = async (server: McpServerConfig) => {
    setTestingId(server.id)
    setTestResult(null)
    try {
      const tools = await McpClient.discoverTools(server)
      updateServer({
        ...server,
        status: 'connected',
        tools,
        lastError: undefined,
        updatedAt: Date.now(),
      })
      setTestResult({
        id: server.id,
        success: true,
        msg: t('连接成功！探测到 {0} 个可用工具', tools.length),
      })
      setExpandedId(server.id)
    } catch (err: any) {
      const msg = err.message || String(err)
      updateServer({
        ...server,
        status: 'error',
        lastError: msg,
        updatedAt: Date.now(),
      })
      setTestResult({
        id: server.id,
        success: false,
        msg,
      })
    } finally {
      setTestingId(null)
    }
  }

  const addFromPreset = (preset: McpPreset) => {
    const newServer: McpServerConfig = {
      id: `${preset.id}-${Date.now().toString(36)}`,
      name: preset.name,
      description: preset.description,
      transport: preset.transport,
      url: preset.url,
      command: preset.command,
      args: preset.args,
      env: preset.env,
      enabled: true,
      tools: preset.defaultTools || [],
      status: 'idle',
      updatedAt: Date.now(),
    }
    updateServer(newServer)
    setShowPresets(false)
  }

  const activeServersCount = servers.filter((s) => s.enabled).length
  const totalToolsCount = servers
    .filter((s) => s.enabled)
    .reduce((n, s) => n + (s.tools?.length || 0), 0)

  return (
    <div className={pane(4)}>
      {/* 顶部概览卡片 */}
      <section className="relative overflow-hidden rounded-2xl border border-line-strong/60 bg-gradient-to-br from-card via-card to-paper-deep/50 p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-seal/10 text-seal">
                <Cpu size={15} />
              </span>
              <h3 className="text-[14px] font-semibold text-ink-strong">{t('Model Context Protocol (MCP) 服务')}</h3>
              <span className="rounded-full bg-seal/15 px-2 py-0.5 text-[11px] font-medium text-seal-deep">
                {t('已启用 {0} 个服务 · {1} 个工具', activeServersCount, totalToolsCount)}
              </span>
            </div>
            <p className="mt-1 text-[11.5px] leading-relaxed text-ink-faint">
              {t('连接标准 MCP 服务（通过 SSE 远端端点或 stdio 本地进程），让超级导师直接调度真实世界的文件、数据库或网络工具。')}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowPresets((v) => !v)}
                className="flex items-center gap-1.5 rounded-xl border border-line bg-paper-deep px-3 py-1.5 text-[12px] font-medium text-ink-strong transition hover:bg-line/60"
              >
                <Sparkles size={13} className="text-seal" />
                {t('添加常用预设')}
                <ChevronDown size={12} className="text-ink-faint" />
              </button>

              {showPresets && (
                <div className="absolute right-0 top-full z-20 mt-1.5 w-[260px] rounded-xl border border-line-strong bg-card p-1.5 shadow-xl">
                  <div className="px-2 py-1 text-[11px] font-medium text-ink-faint">{t('官方与常用预设')}</div>
                  {MCP_PRESETS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => addFromPreset(p)}
                      className="flex w-full flex-col gap-0.5 rounded-lg px-2.5 py-1.5 text-left transition hover:bg-line/50"
                    >
                      <span className="text-[12px] font-medium text-ink-strong">{p.name}</span>
                      <span className="text-[10.5px] text-ink-faint line-clamp-1">{p.description}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => setIsCreating(true)}
              className="flex items-center gap-1.5 rounded-xl border border-seal/30 bg-seal/10 px-3 py-1.5 text-[12px] font-medium text-seal-deep transition hover:bg-seal/15"
            >
              <Plus size={14} />
              {t('添加 MCP 服务')}
            </button>
          </div>
        </div>

        <div className="mt-3.5 border-t border-line/60 pt-3">
          <Switch
            on={globalEnabled}
            onChange={(next) => {
              if (!next) stopSession()
              onChange({ enabled: next, servers })
            }}
            label={t('启用 MCP 工具调度')}
            hint={t('开启后，MCP 服务工具将注入超级导师的 execute 沙箱（api.mcp.list / discover / call）')}
          />
        </div>
      </section>

      {/* 服务器列表 */}
      {servers.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line p-8 text-center bg-card/40">
          <Server size={32} className="text-ink-faint mb-2 opacity-60" />
          <h4 className="text-[13px] font-medium text-ink-strong">{t('暂未配置任何 MCP 服务器')}</h4>
          <p className="mt-1 max-w-[340px] text-[11.5px] text-ink-faint leading-relaxed">
            {t('可以点击上方「添加常用预设」快速体验网页提取或本地文件工具，或添加自定义 SSE 协议服务端。')}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {servers.map((server) => {
            const isExpanded = expandedId === server.id
            const isTesting = testingId === server.id
            const result = testResult?.id === server.id ? testResult : null

            return (
              <div
                key={server.id}
                className={`overflow-hidden rounded-xl border transition-all duration-200 ${
                  server.enabled
                    ? 'border-line-strong/80 bg-card shadow-sm'
                    : 'border-line/60 bg-card/60 opacity-75'
                }`}
              >
                <div className="flex items-start gap-3 p-3.5">
                  <div
                    className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition ${
                      server.enabled
                        ? 'bg-seal/15 text-seal-deep'
                        : 'bg-paper-deep text-ink-faint'
                    }`}
                  >
                    {server.transport === 'sse' ? <Globe size={17} /> : <Terminal size={17} />}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-semibold text-ink-strong">{server.name}</span>
                      <span
                        className={`rounded-md px-1.5 py-0.5 text-[10px] font-mono font-medium uppercase ${
                          server.transport === 'sse'
                            ? 'bg-blue-500/10 text-blue-600 border border-blue-500/20'
                            : 'bg-amber-500/10 text-amber-600 border border-amber-500/20'
                        }`}
                      >
                        {server.transport}
                      </span>

                      {/* 连接状态胶囊 */}
                      <span className="flex items-center gap-1 rounded-full bg-paper-deep px-2 py-0.5 text-[10.5px] text-ink-soft">
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            !server.enabled
                              ? 'bg-ink-faint'
                              : server.status === 'connected'
                                ? 'bg-emerald-500 animate-pulse'
                                : server.status === 'error'
                                  ? 'bg-rose-500'
                                  : 'bg-amber-500'
                          }`}
                        />
                        {server.status === 'connected'
                          ? t('已连接')
                          : server.status === 'error'
                            ? t('连接异常')
                            : t('就绪')}
                      </span>

                      {server.tools && server.tools.length > 0 && (
                        <span className="rounded-md bg-seal/10 px-1.5 py-0.5 text-[10px] font-medium text-seal-deep">
                          {t('{0} 个工具', server.tools.length)}
                        </span>
                      )}
                    </div>

                    {server.description && (
                      <p className="mt-1 text-[11.5px] leading-relaxed text-ink-soft">{server.description}</p>
                    )}

                    <div className="mt-2 flex items-center gap-2 text-[11px] font-mono text-ink-faint">
                      <span className="rounded bg-paper-deep px-2 py-0.5 border border-line/60">
                        {server.transport === 'sse'
                          ? server.url || '未配置 URL'
                          : `${server.command || ''} ${(server.args || []).join(' ')}`}
                      </span>
                    </div>

                    {result && (
                      <div
                        className={`mt-2.5 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] ${
                          result.success
                            ? 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20'
                            : 'bg-rose-500/10 text-rose-600 border border-rose-500/20'
                        }`}
                      >
                        {result.success ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
                        <span className="truncate">{result.msg}</span>
                      </div>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    {/* 测试连接按钮 */}
                    <button
                      type="button"
                      disabled={isTesting}
                      onClick={() => handleTestConnection(server)}
                      className="flex items-center gap-1 rounded-lg border border-line bg-card px-2.5 py-1 text-[11px] text-ink-soft transition hover:border-seal/40 hover:text-seal disabled:opacity-50"
                    >
                      <RefreshCw size={11} className={isTesting ? 'animate-spin' : ''} />
                      {isTesting ? t('探测中…') : t('探测工具')}
                    </button>

                    <button
                      type="button"
                      role="switch"
                      aria-checked={server.enabled}
                      onClick={() => toggleServer(server)}
                      title={server.enabled ? t('禁用此服务') : t('启用此服务')}
                      className={`relative h-[20px] w-9 rounded-full transition-colors duration-200 ${
                        server.enabled ? 'bg-seal' : 'bg-line-strong/60'
                      }`}
                    >
                      <span
                        className={`absolute top-[2px] h-4 w-4 rounded-full bg-white shadow-sm transition-all duration-200 ${
                          server.enabled ? 'left-[18px]' : 'left-[2px]'
                        }`}
                      />
                    </button>

                    <button
                      type="button"
                      onClick={() => setExpandedId(isExpanded ? null : server.id)}
                      title={isExpanded ? t('收起工具清单') : t('展开工具清单')}
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-faint transition hover:bg-line/50 hover:text-ink"
                    >
                      {isExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                    </button>

                    <button
                      type="button"
                      onClick={() => setEditingServer(server)}
                      title={t('编辑配置')}
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-faint transition hover:bg-line/50 hover:text-ink"
                    >
                      <Edit3 size={13} />
                    </button>

                    <button
                      type="button"
                      onClick={() => setDeletingServer(server)}
                      title={t('删除此服务')}
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-faint transition hover:bg-seal/10 hover:text-seal-deep"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>

                {/* 工具列表展开抽屉 */}
                {isExpanded && (
                  <div className="border-t border-line/60 bg-paper-deep/40 p-3.5">
                    <div className="flex items-center justify-between pb-2">
                      <span className="text-[11px] font-medium text-ink-strong flex items-center gap-1.5">
                        <Wrench size={12} className="text-seal" />
                        {t('已注册的 MCP 工具 ({0})', server.tools?.length || 0)}
                      </span>
                    </div>

                    {!server.tools || server.tools.length === 0 ? (
                      <p className="text-[11px] text-ink-faint py-2">
                        {t('当前尚未发现工具，请点击右上方「探测工具」按钮刷新。')}
                      </p>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {server.tools.map((tool) => (
                          <div
                            key={tool.name}
                            className="rounded-lg border border-line bg-card p-2.5 shadow-2xs"
                          >
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono text-[11.5px] font-semibold text-seal-deep">
                                {tool.name}
                              </span>
                            </div>
                            {tool.description && (
                              <p className="mt-1 text-[10.5px] leading-relaxed text-ink-soft line-clamp-2">
                                {tool.description}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* 新建或编辑弹窗 */}
      {(isCreating || editingServer) && (
        <McpServerEditModal
          server={editingServer}
          onSave={(saved) => {
            updateServer(saved)
            setIsCreating(false)
            setEditingServer(null)
          }}
          onClose={() => {
            setIsCreating(false)
            setEditingServer(null)
          }}
        />
      )}

      {/* 删除确认弹窗 */}
      {deletingServer && (
        <ConfirmDialog
          title={t('删除 MCP 服务「{0}」？', deletingServer.name)}
          message={t('删除后该服务提供的工具将不再对导师可用。')}
          confirmLabel={t('删除')}
          onConfirm={() => {
            removeServer(deletingServer.id)
            setDeletingServer(null)
          }}
          onCancel={() => setDeletingServer(null)}
        />
      )}
    </div>
  )
}

function McpServerEditModal({
  server,
  onSave,
  onClose,
}: {
  server: McpServerConfig | null
  onSave: (server: McpServerConfig) => void
  onClose: () => void
}) {
  const [name, setName] = useState(server?.name || '')
  const [description, setDescription] = useState(server?.description || '')
  const [transport, setTransport] = useState<McpTransport>(server?.transport || 'sse')
  const [url, setUrl] = useState(server?.url || '')
  const [command, setCommand] = useState(server?.command || 'npx')
  const [argsStr, setArgsStr] = useState(server?.args ? server.args.join(' ') : '')

  const handleSave = () => {
    if (!name.trim()) return
    const args = argsStr
      .split(/\s+/)
      .map((s) => s.trim())
      .filter(Boolean)

    onSave({
      id: server?.id || `mcp-custom-${Date.now()}`,
      name: name.trim(),
      description: description.trim(),
      transport,
      url: transport === 'sse' ? url.trim() : undefined,
      command: transport === 'stdio' ? command.trim() : undefined,
      args: transport === 'stdio' ? args : undefined,
      enabled: server ? server.enabled : true,
      tools: server?.tools || [],
      status: 'idle',
      updatedAt: Date.now(),
    })
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="flex max-h-[90vh] w-full max-w-[540px] flex-col rounded-2xl border border-line-strong bg-card shadow-2xl overflow-hidden">
        <header className="border-b border-line bg-paper-deep/60 px-5 py-3.5">
          <h3 className="text-[14px] font-semibold text-ink-strong">
            {server ? t('编辑 MCP 服务') : t('添加 MCP 服务')}
          </h3>
          <p className="mt-0.5 text-[11px] text-ink-faint">
            {t('配置基于 Model Context Protocol 的服务连接参数。')}
          </p>
        </header>

        <div className="flex-1 overflow-y-auto p-5 space-y-3.5">
          <div>
            <label className="block text-[11.5px] font-medium text-ink-soft mb-1">{t('服务名称')}</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('例如：本地文件系统工具')}
              className="w-full rounded-lg border border-line bg-paper px-3 py-1.5 text-[12.5px] text-ink-strong outline-none focus:border-seal/60 focus:ring-2 focus:ring-seal/15"
            />
          </div>

          <div>
            <label className="block text-[11.5px] font-medium text-ink-soft mb-1">{t('传输协议 (Transport)')}</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setTransport('sse')}
                className={`flex items-center justify-center gap-1.5 rounded-lg border p-2 text-[12px] font-medium transition ${
                  transport === 'sse'
                    ? 'border-seal bg-seal/10 text-seal-deep'
                    : 'border-line bg-paper text-ink-soft hover:bg-line/40'
                }`}
              >
                <Globe size={13} />
                {t('HTTP / SSE (远程端点)')}
              </button>
              <button
                type="button"
                onClick={() => setTransport('stdio')}
                className={`flex items-center justify-center gap-1.5 rounded-lg border p-2 text-[12px] font-medium transition ${
                  transport === 'stdio'
                    ? 'border-seal bg-seal/10 text-seal-deep'
                    : 'border-line bg-paper text-ink-soft hover:bg-line/40'
                }`}
              >
                <Terminal size={13} />
                {t('stdio (本地进程)')}
              </button>
            </div>
          </div>

          {transport === 'sse' ? (
            <div>
              <label className="block text-[11.5px] font-medium text-ink-soft mb-1">{t('SSE 服务 URL')}</label>
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="http://localhost:8000/sse"
                className="w-full font-mono rounded-lg border border-line bg-paper px-3 py-1.5 text-[12px] text-ink-strong outline-none focus:border-seal/60 focus:ring-2 focus:ring-seal/15"
              />
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-[11.5px] font-medium text-ink-soft mb-1">{t('主命令')}</label>
                <input
                  type="text"
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder="npx"
                  className="w-full font-mono rounded-lg border border-line bg-paper px-3 py-1.5 text-[12px] text-ink-strong outline-none focus:border-seal/60 focus:ring-2 focus:ring-seal/15"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-[11.5px] font-medium text-ink-soft mb-1">{t('命令参数 (空格分隔)')}</label>
                <input
                  type="text"
                  value={argsStr}
                  onChange={(e) => setArgsStr(e.target.value)}
                  placeholder="-y @modelcontextprotocol/server-fetch"
                  className="w-full font-mono rounded-lg border border-line bg-paper px-3 py-1.5 text-[12px] text-ink-strong outline-none focus:border-seal/60 focus:ring-2 focus:ring-seal/15"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-[11.5px] font-medium text-ink-soft mb-1">{t('描述说明 (选填)')}</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('简要说明该 MCP 服务的用途')}
              className="w-full rounded-lg border border-line bg-paper px-3 py-1.5 text-[12.5px] text-ink-strong outline-none focus:border-seal/60 focus:ring-2 focus:ring-seal/15"
            />
          </div>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-line bg-paper-deep/40 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-3.5 py-1.5 text-[12px] text-ink-soft transition hover:bg-line/60 hover:text-ink"
          >
            {t('取消')}
          </button>
          <button
            type="button"
            disabled={!name.trim() || (transport === 'sse' && !url.trim())}
            onClick={handleSave}
            className="rounded-xl bg-seal px-4 py-1.5 text-[12px] font-medium text-white shadow-sm transition hover:bg-seal-deep disabled:opacity-40"
          >
            {t('保存服务')}
          </button>
        </footer>
      </div>
    </div>
  )
}
