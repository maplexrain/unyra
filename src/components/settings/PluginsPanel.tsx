/**
 * 设置 → 插件：按类别列出插件、开关、插件目录与伪编译产物的清理。
 */

import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  ChevronRight,
  Cpu,
  FolderOpen,
  PlugZap,
  RefreshCw,
  ShieldAlert,
  Trash2,
} from 'lucide-react'
import { pane } from '../Pane'
import Switch from '../Switch'
import {
  pluginCategories,
  pluginDir,
  pluginListError,
  pluginStatuses,
  refreshPlugins,
  revealPluginDir,
  pluginEnableBlocker,
  setPluginEnabled,
  type PluginStatus,
} from '../../lib/plugins'
import { artifactCount, clearArtifacts, loadArtifacts, silentCount } from '../../lib/codeArtifacts'
import { t } from '../../i18n'
import { pluginHint } from './pluginHints'

interface Props {
  onToast: (msg: string) => void
  onOpenConfig: (id: string) => void
}

export function PluginsPanel({ onToast, onOpenConfig }: Props) {
  const [list, setList] = useState<PluginStatus[]>(() => pluginStatuses())
  const [listError, setListError] = useState(() => pluginListError())
  const [busy, setBusy] = useState('')
  const [artifacts, setArtifacts] = useState(() => artifactCount())
  const [silent, setSilent] = useState(() => silentCount())
  const [blockers, setBlockers] = useState<Record<string, string>>({})

  const reload = () =>
    refreshPlugins().then((next) => {
      setList([...next])
      setListError(pluginListError())
    })

  useEffect(() => {
    void refreshPlugins().then((next) => {
      setList([...next])
      setListError(pluginListError())
    })
    void loadArtifacts().then(() => {
      setArtifacts(artifactCount())
      setSilent(silentCount())
    })
  }, [])

  useEffect(() => {
    let alive = true
    void (async () => {
      const next: Record<string, string> = {}
      for (const p of list) {
        if (p.enabled) continue
        const why = await pluginEnableBlocker(p.id)
        if (why) next[p.id] = why
      }
      if (alive) setBlockers(next)
    })()
    return () => {
      alive = false
    }
  }, [list])

  const toggle = async (id: string, on: boolean) => {
    setBusy(id)
    const err = await setPluginEnabled(id, on)
    setBusy('')
    if (err) {
      onToast(t(err))
      return
    }
    await reload()
    onToast(on ? t('已启用，重启后生效') : t('已停用，重启后生效'))
  }

  const restartNeeded = list.some((p) => p.enabled !== p.active)
  const dir = pluginDir()

  return (
    <div className={pane(5, true)}>
      {/* 头部简介与打开目录 */}
      <div className="flex flex-col gap-2 border-b border-line pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <PlugZap size={16} className="text-seal" />
            <h2 className="text-[14px] font-semibold text-ink-strong">{t('插件与扩展')}</h2>
          </div>
          <p className="mt-1 text-[11.5px] text-ink-soft">
            {t('管理 Markdown 语法增强、代码运行沙箱及本地功能性插件。')}
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            void revealPluginDir().then((err) => {
              if (err) onToast(t(err))
            })
          }}
          className="flex items-center gap-1.5 rounded-lg border border-line bg-card px-2.5 py-1.5 text-[11.5px] font-medium text-ink transition hover:border-line-strong hover:bg-card/80"
        >
          <FolderOpen size={13} className="text-seal" />
          <span>{t('打开插件目录')}</span>
        </button>
      </div>

      {/* 重启提示横幅 */}
      {restartNeeded && (
        <div className="flex items-center gap-2 rounded-xl border border-warn/30 bg-warn/10 px-3.5 py-2.5 text-[11.5px] text-warn-deep">
          <RefreshCw size={13} className="shrink-0 animate-spin" />
          <span>{t('检测到插件开关改动：插件在应用启动时统一装载，重启应用后新设置将正式生效。')}</span>
        </div>
      )}

      {/* 错误提示 */}
      {listError && (
        <div className="flex items-start gap-2 rounded-xl border border-seal/30 bg-seal/5 p-3 text-[11.5px] leading-relaxed text-seal-deep">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>{t(listError)}</span>
        </div>
      )}

      {/* 分类插件列表 */}
      {!listError &&
        pluginCategories().map((cat) => {
          const rows = list.filter((p) => p.category === cat.id)

          return (
            <section key={cat.id} className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between">
                <div className="text-[13px] font-medium text-ink-strong">{t(cat.label)}</div>
                <span className="text-[11px] text-ink-faint">{t(cat.hint)}</span>
              </div>

              {rows.length === 0 ? (
                <div className="rounded-xl border border-dashed border-line bg-card/40 p-4 text-center text-[11.5px] text-ink-faint">
                  {t('这个类别下还没有插件。')}
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {rows.map((p) => {
                    const blocked = !p.enabled ? blockers[p.id] : undefined

                    return (
                      <div
                        key={p.id}
                        className="flex flex-col justify-between gap-3 rounded-xl border border-line bg-card/70 p-3.5 transition-all duration-150 hover:border-line-strong sm:flex-row sm:items-center"
                      >
                        {/* 左侧：标题、状态与说明 */}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-[13px] font-semibold text-ink-strong">
                              {t(p.name)}
                            </span>
                            {p.active ? (
                              <span className="flex items-center gap-1 rounded-full border border-ok/40 bg-ok/10 px-2 py-0.2 text-[10px] font-medium text-ok-deep">
                                <span className="h-1.5 w-1.5 rounded-full bg-ok" />
                                {t('已就绪')}
                              </span>
                            ) : p.enabled ? (
                              <span className="flex items-center gap-1 rounded-full border border-warn/40 bg-warn/10 px-2 py-0.2 text-[10px] font-medium text-warn-deep">
                                <span className="h-1.5 w-1.5 rounded-full bg-warn" />
                                {t('重启后生效')}
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1 text-[11px] leading-relaxed text-ink-soft">
                            {pluginHint(p)}
                          </p>

                          {blocked && (
                            <div className="mt-1.5 flex items-center gap-1 text-[11px] text-warn-deep">
                              <AlertTriangle size={11} className="shrink-0" />
                              <span>{blocked}</span>
                            </div>
                          )}
                          {p.error && (
                            <div className="mt-1.5 flex items-center gap-1 text-[11px] text-seal-deep">
                              <AlertTriangle size={11} className="shrink-0" />
                              <span>{t(p.error)}</span>
                            </div>
                          )}
                        </div>

                        {/* 右侧：配置按钮与开关 */}
                        <div className="flex shrink-0 items-center gap-2.5">
                          {p.configurable && (
                            <button
                              type="button"
                              onClick={() => onOpenConfig(p.id)}
                              className="flex items-center gap-1 rounded-lg border border-line bg-card px-2.5 py-1 text-[11.5px] font-medium text-ink transition hover:border-line-strong hover:bg-card/80"
                            >
                              <span>{t('配置')}</span>
                              <ChevronRight size={12} className="text-ink-faint" />
                            </button>
                          )}
                          <Switch
                            on={p.enabled}
                            disabled={busy === p.id || !!blocked}
                            onChange={(next) => {
                              void toggle(p.id, next)
                            }}
                            label=""
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {cat.id === 'markdown' && dir && (
                <div className="rounded-lg border border-line bg-card/40 px-3 py-2 text-[11px] leading-relaxed text-ink-faint">
                  {t('往插件目录中放置 .js 脚本即可扩展语法规则：脚本内调用 ')}
                  <code className="font-mono text-seal">register(...)</code>
                  {t(' 认领代码语言或正文过滤器。目录：')}
                  <span className="break-all font-mono text-ink-soft">{dir}</span>
                </div>
              )}
            </section>
          )
        })}

      {/* 伪编译产物缓存清理卡片 */}
      <section className="rounded-xl border border-line bg-card/60 p-3.5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2.5">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-line bg-card text-seal">
              <Cpu size={15} />
            </div>
            <div>
              <div className="text-[13px] font-medium text-ink-strong">{t('代码块编译缓存')}</div>
              <p className="mt-0.5 text-[11px] leading-relaxed text-ink-soft">
                {t(
                  '共 {0} 份编译产物缓存；清理仅清除本地生成的执行缓存，下次点击代码块运行依然会自动重新编译。另有 {1} 块被判定为无输出。',
                  artifacts,
                  silent
                )}
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={!artifacts}
            onClick={() => {
              void clearArtifacts().then((err) => {
                setArtifacts(artifactCount())
                setSilent(silentCount())
                onToast(err ?? t('已清空编译产物与无输出标记'))
              })
            }}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-line bg-card px-3 py-1.5 text-[11.5px] font-medium text-ink transition hover:border-line-strong hover:bg-card/80 disabled:opacity-40"
          >
            <Trash2 size={12} className="text-ink-soft" />
            <span>{t('清空缓存')}</span>
          </button>
        </div>
      </section>

      {/* 插件同权安全性说明 */}
      <div className="rounded-xl border border-line bg-card/60 p-3.5 text-[11px] leading-relaxed text-ink-soft">
        <div className="flex items-center gap-1.5 font-medium text-seal-deep">
          <ShieldAlert size={14} />
          <span>{t('插件运行安全机制')}</span>
        </div>
        <p className="mt-1">
          {t(
            '用户放置在数据目录下的本地插件具备与应用同等的运行权限（可读取笔记内容与访问本地磁盘）。请仅安装来源可靠、内容清晰的脚本插件。内置功能性插件（如语音输入）为官方打包集成，安全隔离运行。'
          )}
        </p>
      </div>
    </div>
  )
}
