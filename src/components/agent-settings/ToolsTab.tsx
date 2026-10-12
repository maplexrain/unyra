import { useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  Bug,
  Check,
  CheckCircle2,
  Copy,
  Cpu,
  FolderCheck,
  FolderOpen,
  FolderPlus,
  Layers,
  RefreshCw,
  Search,
  ShieldCheck,
  Square,
  Terminal,
  Trash2,
  Wrench,
} from 'lucide-react'
import type { AgentSettings, AgentDevSettings } from '../../agent/settings'
import { SANDBOX_API_CATALOG } from '../../agent/apiCatalog'
import { clearRecords as clearContextRecords } from '../../agent/contextFilter'
import type { BaseProcessInfo } from '../../../shared/ipc'
import Switch from '../Switch'
import { pane } from '../Pane'
import { t } from '../../i18n'

interface ToolsTabProps {
  settings: AgentSettings
  onChange: (next: AgentSettings) => void
  onOpenContextDebugger: () => void
}

export function ToolsTab({ settings, onChange, onOpenContextDebugger }: ToolsTabProps) {
  // 选项卡内部视图：'all' | 'context' | 'catalog' | 'permissions' | 'process'
  const [subTab, setSubTab] = useState<'all' | 'context' | 'catalog' | 'permissions' | 'process'>('all')

  // API 目录搜索与分类过滤
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedGroup, setSelectedGroup] = useState<string>('all')
  const [copiedName, setCopiedName] = useState<string | null>(null)

  // 目标根目录与放行目录白名单管理
  const [currentRootDir, setCurrentRootDir] = useState<string>('')
  const [newDirPath, setNewDirPath] = useState('')
  const [pathError, setPathError] = useState<string | null>(null)

  // 活动进程列表
  const [processes, setProcesses] = useState<BaseProcessInfo[]>([])
  const [isRefreshingProc, setIsRefreshingProc] = useState(false)
  const [clearedSnapshot, setClearedSnapshot] = useState(false)

  // 获取目标数据根目录
  useEffect(() => {
    if (typeof window !== 'undefined' && window.mojiNative?.storage?.info) {
      window.mojiNative.storage.info().then((info) => {
        if (info?.root) setCurrentRootDir(info.root)
      }).catch(() => {})
    }
  }, [])

  // 刷新进程列表
  const refreshProcesses = async () => {
    const processApi = window.mojiNative?.process ?? window.mojiNative?.base?.process
    if (typeof window === 'undefined' || !processApi?.list) return
    setIsRefreshingProc(true)
    try {
      const res = await processApi.list()
      if (res.ok) {
        setProcesses(res.processes)
      }
    } catch {
      // 忽略无法连接 IPC
    } finally {
      setIsRefreshingProc(false)
    }
  }

  useEffect(() => {
    void refreshProcesses()
    const timer = setInterval(() => {
      void refreshProcesses()
    }, 4000)
    return () => clearInterval(timer)
  }, [])

  // 复制签名
  const handleCopySignature = (sig: string, name: string) => {
    navigator.clipboard.writeText(`await api.${sig}`).catch(() => {})
    setCopiedName(name)
    setTimeout(() => {
      setCopiedName((cur) => (cur === name ? null : cur))
    }, 1800)
  }

  // 清理快照记录
  const handleClearSnapshots = () => {
    clearContextRecords()
    setClearedSnapshot(true)
    setTimeout(() => setClearedSnapshot(false), 2000)
  }

  // 开发者快照开关更新
  const patchDev = (patch: Partial<AgentDevSettings>) => {
    const next = { ...settings, dev: { ...settings.dev, ...patch } }
    onChange(next)
    if (patch.contextDebugger === false) clearContextRecords()
  }

  // 添加放行目录
  const handleAddAllowedDir = (dirToAdd?: string) => {
    const target = (dirToAdd || newDirPath).trim()
    if (!target) {
      setPathError(t('目录路径不能为空'))
      return
    }
    const currentList = settings.permissions?.allowedDirs || []
    if (currentList.includes(target)) {
      setPathError(t('该目录已在放行白名单中'))
      return
    }
    setPathError(null)
    const nextList = [...currentList, target]
    const nextSettings: AgentSettings = {
      ...settings,
      permissions: {
        ...(settings.permissions || { allowedDirs: [] }),
        allowedDirs: nextList,
      },
    }
    onChange(nextSettings)
    setNewDirPath('')
  }

  // 移除放行目录
  const handleRemoveAllowedDir = (dirToRemove: string) => {
    const currentList = settings.permissions?.allowedDirs || []
    const nextList = currentList.filter((d) => d !== dirToRemove)
    const nextSettings: AgentSettings = {
      ...settings,
      permissions: {
        ...(settings.permissions || { allowedDirs: [] }),
        allowedDirs: nextList,
      },
    }
    onChange(nextSettings)
  }

  // 弹原生目录选择框
  const handlePickDirectory = async () => {
    if (typeof window !== 'undefined' && window.mojiNative?.storage?.pickRoot) {
      try {
        const res = await window.mojiNative.storage.pickRoot()
        if (res.ok && res.root && !res.canceled) {
          handleAddAllowedDir(res.root)
        }
      } catch {
        // fallback
      }
    }
  }

  // 强制终止进程
  const handleStopProcess = async (processId: string) => {
    const processApi = window.mojiNative?.process ?? window.mojiNative?.base?.process
    if (typeof window !== 'undefined' && processApi?.stop) {
      await processApi.stop(processId, { force: true })
      await refreshProcesses()
    }
  }

  // 过滤后的 API 清单
  const filteredCatalog = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return SANDBOX_API_CATALOG.map((group) => {
      if (selectedGroup !== 'all' && group.key !== selectedGroup) return null
      const matchedItems = group.items.filter((item) => {
        if (!q) return true
        return (
          item.name.toLowerCase().includes(q) ||
          item.signature.toLowerCase().includes(q) ||
          item.summary.toLowerCase().includes(q)
        )
      })
      if (!matchedItems.length) return null
      return { ...group, items: matchedItems }
    }).filter(Boolean) as typeof SANDBOX_API_CATALOG
  }, [searchQuery, selectedGroup])

  const totalApiCount = useMemo(() => {
    return SANDBOX_API_CATALOG.reduce((acc, g) => acc + g.items.length, 0)
  }, [])

  const runningProcCount = processes.filter((p) => p.running).length

  return (
    <div className={pane(4)}>
      {/* 顶部现代化全景指标概览卡片 */}
      <section className="relative overflow-hidden rounded-2xl border border-line bg-gradient-to-br from-card via-card to-paper-deep/50 p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-seal/10 text-seal border border-seal/20 shadow-2xs">
              <Wrench size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-[14.5px] font-bold text-ink-strong">{t('Agent 工具与运行时设施')}</h3>
                <span className="rounded-full bg-seal/15 px-2 py-0.5 text-[10.5px] font-semibold text-seal-deep">
                  {t('{0} 项原生工具能力', totalApiCount)}
                </span>
              </div>
              <p className="mt-0.5 text-[11px] text-ink-faint">
                {t('涵盖真实文件系统、受控进程树、富交互 DOM 与学习上下文完整生命周期治理')}
              </p>
            </div>
          </div>

          {/* 实时守护徽章 */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-lg border border-line bg-paper/70 px-2.5 py-1 text-[11px] font-medium text-ink-soft shadow-2xs">
              <ShieldCheck size={13} className="text-emerald-500" />
              <span>{t('安全沙箱边界就绪')}</span>
            </div>
            <div className="flex items-center gap-1.5 rounded-lg border border-line bg-paper/70 px-2.5 py-1 text-[11px] font-medium text-ink-soft shadow-2xs">
              <Cpu size={13} className="text-seal" />
              <span>{t('活动进程：{0}', runningProcCount)}</span>
            </div>
          </div>
        </div>

        {/* 快捷视图切换器 */}
        <div className="mt-4.5 flex flex-wrap gap-1.5 border-t border-line/60 pt-3">
          {[
            { key: 'all', label: '全部总览', icon: Layers },
            { key: 'context', label: '上下文治理与健康度', icon: Bug },
            { key: 'catalog', label: '沙箱 API 检索', icon: Terminal },
            { key: 'permissions', label: '文件安全放行白名单', icon: FolderCheck },
            { key: 'process', label: '系统进程任务监控', icon: Cpu },
          ].map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setSubTab(item.key as typeof subTab)}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium transition ${
                subTab === item.key
                  ? 'bg-seal text-white shadow-2xs font-semibold'
                  : 'bg-paper text-ink-faint hover:bg-paper-deep hover:text-ink-strong border border-line/50'
              }`}
            >
              <item.icon size={12} />
              <span>{t(item.label)}</span>
            </button>
          ))}
        </div>
      </section>

      {/* 1. 上下文治理与前缀缓存健康度 */}
      {(subTab === 'all' || subTab === 'context') && (
        <section className="rounded-2xl border border-line bg-card p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600">
                  <ShieldCheck size={13} />
                </span>
                <h4 className="text-[13.5px] font-bold text-ink-strong">{t('上下文管理与健康度检测')}</h4>
              </div>
              <p className="mt-1 text-[11.5px] leading-relaxed text-ink-faint">
                {t('前缀缓存 (Prefix Caching) 按请求字节级精确对齐。当系统提示词、工具声明或前期消息发生分叉时，缓存将整段失效。')}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={handleClearSnapshots}
                className="flex items-center gap-1.5 rounded-xl border border-line bg-paper px-3 py-1.5 text-[11.5px] text-ink-soft transition hover:bg-line/60 hover:text-ink"
              >
                {clearedSnapshot ? <Check size={13} className="text-emerald-500" /> : <Trash2 size={13} />}
                <span>{clearedSnapshot ? t('快照已清空') : t('清空快照记录')}</span>
              </button>
              <button
                type="button"
                disabled={!settings.dev?.contextDebugger}
                onClick={onOpenContextDebugger}
                className="flex items-center gap-1.5 rounded-xl bg-seal px-3 py-1.5 text-[11.5px] font-medium text-white shadow-2xs transition hover:bg-seal-deep disabled:pointer-events-none disabled:opacity-40"
              >
                <Bug size={13} />
                <span>{t('打开对比调试器')}</span>
              </button>
            </div>
          </div>

          {/* 上下文比对调试器开关 */}
          <div className="mt-4 rounded-xl border border-line bg-paper-deep/40 p-3.5">
            <Switch
              on={settings.dev?.contextDebugger === true}
              onChange={(next) => patchDev({ contextDebugger: next })}
              label={t('实时记录发往 API 的上下文快照')}
              hint={t('在每次向大模型发送请求前抓取一份不可变快照，用于两轮之间逐字节对账定位')}
            />
          </div>

          {/* 上下文构成分布图解条 */}
          <div className="mt-4 rounded-xl border border-line bg-sunken/40 p-4">
            <div className="flex items-center justify-between text-[11.5px] text-ink-soft font-medium mb-2">
              <span>{t('典型对话上下文用量结构预估分布')}</span>
              <span className="text-ink-faint text-[10.5px]">{t('PrefixGate 前缀门禁自动守护')}</span>
            </div>

            {/* 堆叠进度条 */}
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-line/60 p-0.5 gap-0.5">
              <div className="h-full rounded-l-full bg-indigo-500/80 transition-all" style={{ width: '18%' }} title={t('系统提示词基础 (18%)')} />
              <div className="h-full bg-purple-500/80 transition-all" style={{ width: '12%' }} title={t('动态提示词模块 (12%)')} />
              <div className="h-full bg-blue-500/80 transition-all" style={{ width: '14%' }} title={t('专业技能 Skills (14%)')} />
              <div className="h-full bg-amber-500/80 transition-all" style={{ width: '16%' }} title={t('工具与 MCP 声明 (16%)')} />
              <div className="h-full bg-emerald-500/80 transition-all" style={{ width: '25%' }} title={t('历史消息流 (25%)')} />
              <div className="h-full rounded-r-full bg-line/80 transition-all" style={{ width: '15%' }} title={t('安全余量 (15%)')} />
            </div>

            {/* 图例 */}
            <div className="mt-2.5 flex flex-wrap items-center gap-3 text-[10.5px] text-ink-faint">
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-indigo-500" />{t('System 核心')}</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-purple-500" />{t('按需模块')}</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-blue-500" />{t('Skills 技能')}</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" />{t('API/Tools 声明')}</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" />{t('对话历史')}</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-line" />{t('安全余量')}</span>
            </div>
          </div>
        </section>
      )}

      {/* 2. 原生工具文件系统权限与放行目录 */}
      {(subTab === 'all' || subTab === 'permissions') && (
        <section className="rounded-2xl border border-line bg-card p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-md bg-seal/10 text-seal">
                  <FolderCheck size={13} />
                </span>
                <h4 className="text-[13.5px] font-bold text-ink-strong">{t('真实文件系统权限放行与安全边界')}</h4>
              </div>
              <p className="mt-1 text-[11.5px] leading-relaxed text-ink-faint">
                {t('files.* 原生 API 对当前学习目标根目录拥有完全读写权限；操作外部真实系统路径须显式在此加入放行白名单，否则自动拦截。')}
              </p>
            </div>
          </div>

          {/* 目标根目录默认授权卡片 */}
          <div className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3.5 flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10.5px] font-semibold text-emerald-700">
                  {t('完全受信任 · 默认最高权限')}
                </span>
                <span className="text-[11.5px] font-medium text-ink-strong">{t('当前学习数据根目录')}</span>
              </div>
              <code className="mt-1 block truncate font-mono text-[11px] text-ink-soft" title={currentRootDir || t('当前工作区存储根')}>
                {currentRootDir || t('正在获取系统根路径…')}
              </code>
            </div>
            <CheckCircle2 size={18} className="shrink-0 text-emerald-500" />
          </div>

          {/* 外部目录添加控件 */}
          <div className="mt-4 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newDirPath}
                onChange={(e) => {
                  setNewDirPath(e.target.value)
                  if (pathError) setPathError(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddAllowedDir()
                }}
                placeholder={t('输入允许 Agent 访问的外部系统真实绝对路径，如 E:\\project\\docs')}
                className="min-w-0 flex-1 rounded-xl border border-line bg-paper px-3 py-2 text-[12px] text-ink-strong outline-none transition placeholder:text-ink-faint focus:border-seal focus:ring-2 focus:ring-seal/15 font-mono"
              />
              <button
                type="button"
                onClick={handlePickDirectory}
                className="flex shrink-0 items-center gap-1.5 rounded-xl border border-line bg-paper px-3 py-2 text-[12px] font-medium text-ink-soft transition hover:bg-paper-deep hover:text-ink-strong shadow-2xs"
                title={t('在系统文件选择器中浏览')}
              >
                <FolderOpen size={14} />
                <span>{t('浏览')}</span>
              </button>
              <button
                type="button"
                onClick={() => handleAddAllowedDir()}
                className="flex shrink-0 items-center gap-1.5 rounded-xl bg-seal px-4 py-2 text-[12px] font-medium text-white shadow-2xs transition hover:bg-seal-deep"
              >
                <FolderPlus size={14} />
                <span>{t('放行目录')}</span>
              </button>
            </div>
            {pathError && (
              <p className="flex items-center gap-1 text-[11px] text-warn-deep">
                <AlertCircle size={12} />
                <span>{pathError}</span>
              </p>
            )}
          </div>

          {/* 放行白名单清单 */}
          <div className="mt-3 overflow-hidden rounded-xl border border-line bg-paper-deep/30">
            <div className="border-b border-line bg-paper-deep/60 px-3.5 py-2 text-[11.5px] font-semibold text-ink-strong">
              {t('已放行的外部白名单目录 ({0})', (settings.permissions?.allowedDirs || []).length)}
            </div>
            {(settings.permissions?.allowedDirs || []).length === 0 ? (
              <div className="p-4 text-center text-[11.5px] text-ink-faint">
                {t('暂无外部放行目录。除当前学习目标数据根目录外，Agent 尝试访问其他外部路径均会被安全拦截。')}
              </div>
            ) : (
              <ul className="divide-y divide-line/60">
                {(settings.permissions?.allowedDirs || []).map((dir) => (
                  <li key={dir} className="flex items-center justify-between gap-3 px-3.5 py-2 hover:bg-paper/50 transition">
                    <code className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink-strong" title={dir}>
                      {dir}
                    </code>
                    <button
                      type="button"
                      onClick={() => handleRemoveAllowedDir(dir)}
                      className="rounded p-1 text-ink-faint transition hover:bg-warn/10 hover:text-warn-deep"
                      title={t('移除此放行目录')}
                    >
                      <Trash2 size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}

      {/* 3. 系统进程任务监控与生命周期保障 */}
      {(subTab === 'all' || subTab === 'process') && (
        <section className="rounded-2xl border border-line bg-card p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-md bg-indigo-500/10 text-indigo-600">
                  <Cpu size={13} />
                </span>
                <h4 className="text-[13.5px] font-bold text-ink-strong">{t('受控进程任务监控 (process.*)')}</h4>
              </div>
              <p className="mt-1 text-[11.5px] leading-relaxed text-ink-faint">
                {t('严格生命周期强绑定：进程生命周期与主应用进程强绑定，应用退出、崩溃或窗口关闭时，所有子进程树自动级联杀死，杜绝孤儿进程。')}
              </p>
            </div>

            <button
              type="button"
              onClick={refreshProcesses}
              className="flex shrink-0 items-center gap-1.5 rounded-xl border border-line bg-paper px-3 py-1.5 text-[11.5px] text-ink-soft transition hover:bg-paper-deep hover:text-ink-strong shadow-2xs"
            >
              <RefreshCw size={12} className={isRefreshingProc ? 'animate-spin text-seal' : ''} />
              <span>{t('刷新状态')}</span>
            </button>
          </div>

          <div className="mt-4 overflow-hidden rounded-xl border border-line bg-paper-deep/30">
            <div className="border-b border-line bg-paper-deep/60 px-3.5 py-2 flex items-center justify-between text-[11.5px] font-semibold text-ink-strong">
              <span>{t('活动进程清单 ({0})', processes.length)}</span>
              <span className="text-[10.5px] font-normal text-ink-faint">{t('支持增量标准输出捕获与优雅终止')}</span>
            </div>

            {processes.length === 0 ? (
              <div className="p-6 text-center text-[11.5px] text-ink-faint">
                {t('当前没有正在运行或记录中的进程任务。可通过 api.process.create 与 start 启动受控任务。')}
              </div>
            ) : (
              <ul className="divide-y divide-line/60">
                {processes.map((proc) => (
                  <li key={proc.process_id} className="flex flex-col gap-1.5 p-3.5 hover:bg-paper/40 transition">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className={`flex h-2 w-2 rounded-full ${
                            proc.running ? 'bg-emerald-500 animate-pulse' : 'bg-ink-faint'
                          }`}
                        />
                        <code className="font-mono text-[12px] font-semibold text-ink-strong truncate">
                          {proc.command} {proc.args.join(' ')}
                        </code>
                        <span className="rounded bg-line/60 px-1.5 py-px text-[10px] text-ink-soft font-mono">
                          PID: {proc.pid || '-'}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                            proc.running
                              ? 'bg-emerald-500/10 text-emerald-700'
                              : 'bg-line/80 text-ink-faint'
                          }`}
                        >
                          {proc.running ? t('运行中') : t('已退出 (代码 {0})', proc.exitCode ?? '-')}
                        </span>
                        {proc.running && (
                          <button
                            type="button"
                            onClick={() => handleStopProcess(proc.process_id)}
                            className="flex items-center gap-1 rounded bg-warn/10 hover:bg-warn/20 text-warn-deep px-2 py-0.5 text-[10.5px] font-medium transition"
                          >
                            <Square size={10} />
                            <span>{t('强制终止')}</span>
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-4 text-[10.5px] text-ink-faint font-mono">
                      <span>ID: {proc.process_id}</span>
                      <span className="truncate">CWD: {proc.cwd}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}

      {/* 4. 沙箱与 Native API 目录全景检索 */}
      {(subTab === 'all' || subTab === 'catalog') && (
        <section className="rounded-2xl border border-line bg-card p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-md bg-seal/10 text-seal">
                  <Terminal size={13} />
                </span>
                <h4 className="text-[13.5px] font-bold text-ink-strong">{t('沙箱 API 能力检索与签名手册')}</h4>
              </div>
              <p className="mt-1 text-[11.5px] leading-relaxed text-ink-faint">
                {t('沙箱注入的标准 API 规范。所有原生 Native 工具与沙箱能力在此集中收录，点击即可一键复制调用示范。')}
              </p>
            </div>

            {/* 搜索框 */}
            <div className="relative w-[240px]">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('搜索 API、签名或功能…')}
                className="w-full rounded-xl border border-line bg-paper pl-8 pr-3 py-1.5 text-[11.5px] text-ink-strong outline-none transition placeholder:text-ink-faint focus:border-seal focus:ring-2 focus:ring-seal/15"
              />
            </div>
          </div>

          {/* 分组筛选标签 */}
          <div className="mt-3.5 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setSelectedGroup('all')}
              className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition ${
                selectedGroup === 'all'
                  ? 'bg-seal/15 text-seal-deep font-semibold'
                  : 'bg-paper text-ink-faint hover:text-ink-strong border border-line/60'
              }`}
            >
              {t('全部 ({0})', totalApiCount)}
            </button>
            {SANDBOX_API_CATALOG.map((group) => (
              <button
                key={group.key}
                type="button"
                onClick={() => setSelectedGroup(group.key)}
                className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition ${
                  selectedGroup === group.key
                    ? 'bg-seal/15 text-seal-deep font-semibold'
                    : 'bg-paper text-ink-faint hover:text-ink-strong border border-line/60'
                }`}
              >
                {t(group.label.split('·')[0].trim())} ({group.items.length})
              </button>
            ))}
          </div>

          {/* API 卡片渲染 */}
          <div className="mt-4 flex flex-col gap-3">
            {filteredCatalog.length === 0 ? (
              <div className="rounded-xl border border-line bg-paper-deep/30 p-8 text-center text-[12px] text-ink-faint">
                {t('未检索到符合条件的 API')}
              </div>
            ) : (
              filteredCatalog.map((group) => (
                <div key={group.key} className="overflow-hidden rounded-xl border border-line bg-paper/50">
                  <div className="border-b border-line bg-paper-deep/60 px-3.5 py-2 flex items-center justify-between">
                    <div>
                      <span className="text-[12px] font-semibold text-ink-strong">{t(group.label)}</span>
                      <span className="ml-2 text-[10.5px] text-ink-faint">{t('{0} 个能力项', group.items.length)}</span>
                    </div>
                  </div>
                  <p className="px-3.5 py-1.5 text-[11px] leading-relaxed text-ink-faint border-b border-line/40 bg-card/20">
                    {t(group.intro)}
                  </p>
                  <ul className="divide-y divide-line/60">
                    {group.items.map((item) => (
                      <li key={item.name} className="flex flex-col gap-1 px-3.5 py-2 hover:bg-card/40 transition">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <code className="shrink-0 rounded bg-paper-deep border border-line/60 px-2 py-0.5 font-mono text-[11px] font-semibold text-seal-deep">
                              api.{item.signature}
                            </code>
                            {item.availability && item.availability !== 'always' && (
                              <span className="shrink-0 rounded bg-line/60 px-1.5 py-px text-[9.5px] text-ink-soft">
                                {item.availability === 'exam'
                                  ? t('考试在场')
                                  : item.availability === 'subagent'
                                    ? t('导师专用')
                                    : t('窗口界面')}
                              </span>
                            )}
                          </div>

                          <button
                            type="button"
                            onClick={() => handleCopySignature(item.signature, item.name)}
                            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] text-ink-faint hover:bg-paper-deep hover:text-ink-strong transition"
                            title={t('复制调用代码')}
                          >
                            {copiedName === item.name ? (
                              <>
                                <Check size={11} className="text-emerald-500" />
                                <span className="text-emerald-600 font-medium">{t('已复制')}</span>
                              </>
                            ) : (
                              <>
                                <Copy size={11} />
                                <span>{t('复制')}</span>
                              </>
                            )}
                          </button>
                        </div>
                        <p className="text-[11px] leading-relaxed text-ink-soft">{t(item.summary)}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </div>
        </section>
      )}
    </div>
  )
}
