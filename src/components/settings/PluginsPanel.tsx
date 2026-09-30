/**
 * 这个文件负责：「插件」分页：按类别列出插件、开关、插件目录与伪编译产物的清理。
 */

import { useEffect, useState } from 'react'
import { AlertTriangle, FolderOpen } from 'lucide-react'
import { pane } from '../Pane'
import Switch from '../Switch'
import {
  pluginCategories,
  pluginDir,
  pluginListError,
  pluginStatuses,
  refreshPlugins,
  revealPluginDir,
  setPluginEnabled,
  type PluginStatus,
} from '../../lib/plugins'
import { artifactCount, clearArtifacts, loadArtifacts, silentCount } from '../../lib/codeArtifacts'
import { t } from '../../i18n'
import { pluginHint } from './pluginHints'

/* ---------- 插件分页 ---------- */

/**
 * 「插件」分页：按**类别**列出全部插件——内置的与用户装的在同一张表里。
 *
 * 这一页只回答三个问题：**装了什么、开没开、什么时候生效**。插件的执行在渲染层
 * （见 lib/plugins），内置插件的开关由主进程存进 appdata，用户插件的启用清单存在
 * 数据目录里；这里既不显示源码，也没有「在线安装」——用户插件就是放进那个目录的文件。
 *
 * 为什么把「重启后生效」写在脸上：插件在启动时装载一次，而 marked 的扩展装上去
 * 摘不下来、渲染结果又按源文缓存。做成热更新只会换来「一半内容用了新语法、
 * 另一半还是代码块」的界面，不如让用户重启一次。
 */
export function PluginsPanel({ onToast }: { onToast: (msg: string) => void }) {
  const [list, setList] = useState<PluginStatus[]>(() => pluginStatuses())
  const [listError, setListError] = useState(() => pluginListError())
  const [busy, setBusy] = useState('')
  /** 代码块的伪编译产物有几份、无输出标记有几个（见 lib/codeArtifacts）：都给一颗「清空」 */
  const [artifacts, setArtifacts] = useState(() => artifactCount())
  const [silent, setSilent] = useState(() => silentCount())

  const reload = () =>
    refreshPlugins().then((next) => {
      setList([...next])
      setListError(pluginListError())
    })

  // 每次打开这一页都重新列一遍：用户多半是刚往目录里丢完文件才来这里的
  useEffect(() => {
    void refreshPlugins().then((next) => {
      setList([...next])
      setListError(pluginListError())
    })
    // 产物表也顺手拉一次：这一页要显示份数
    void loadArtifacts().then(() => {
      setArtifacts(artifactCount())
      setSilent(silentCount())
    })
  }, [])

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

  /** 开关摆的状态与本次装载的结果对不上 → 这次改动还没生效 */
  const restartNeeded = list.some((p) => p.enabled !== p.active)
  const dir = pluginDir()

  return (
    <div className={pane(4, true)}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-ink-soft">{t('插件')}</div>
        <button
          type="button"
          onClick={() => {
            void revealPluginDir().then((err) => {
              if (err) onToast(t(err))
            })
          }}
          className="flex items-center gap-1.5 rounded-lg border border-line bg-card px-2.5 py-1.5 text-[11.5px] text-ink-soft transition hover:border-seal/50 hover:text-seal-deep"
        >
          <FolderOpen size={13} />
          {t('打开插件目录')}
        </button>
      </div>

      {listError && (
        <div className="flex items-start gap-2 rounded-lg border border-seal/25 bg-seal/5 px-3 py-2 text-[11.5px] leading-relaxed text-seal-deep">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span className="min-w-0">{t(listError)}</span>
        </div>
      )}

      {!listError &&
        pluginCategories().map((cat) => {
          const rows = list.filter((p) => p.category === cat.id)
          return (
            <section key={cat.id}>
              <div className="text-ink-soft">{t(cat.label)}</div>
              <p className="mb-2 mt-0.5 text-[11px] leading-relaxed text-ink-faint">{t(cat.hint)}</p>

              {rows.length === 0 ? (
                <div className="rounded-lg border border-dashed border-line-strong bg-card/40 px-3 py-3 text-[11.5px] leading-relaxed text-ink-soft">
                  {t('这个类别下还没有插件。')}
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {rows.map((p) => (
                    <div key={p.id}>
                      <Switch
                        on={p.enabled}
                        disabled={busy === p.id}
                        onChange={(next) => {
                          void toggle(p.id, next)
                        }}
                        label={t(p.name)}
                        hint={pluginHint(p)}
                      />
                      {p.error && (
                        <div className="mt-1 flex items-start gap-1.5 px-3 text-[11px] leading-relaxed text-seal-deep">
                          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                          <span className="min-w-0">{t(p.error)}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {cat.id === 'markdown' && dir && (
                <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
                  {t('往里放一个 .js 就多一个插件：文件里调用')}
                  <span className="mx-1 font-mono text-[11px]">register(...)</span>
                  {t('交出插件对象（认领一种围栏语言，或给几条正文文字规则）。目录：')}
                  <span className="ml-1 break-all font-mono text-[10.5px]">{dir}</span>
                </p>
              )}
            </section>
          )
        })}

      {/* 伪编译产物是缓存：清掉只是下次点「编译」要重新花一次模型请求 */}
      <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-card px-3 py-2">
        <div className="min-w-0 text-[11.5px] leading-relaxed text-ink-soft">
          {t('代码块的伪编译产物')}
          <span className="ml-1 text-ink-faint">
            {t('共 {0} 份，存在数据目录里；删掉只是下次要重新编译一遍。另有 {1} 块被导师判定为「无输出」（那些块不再显示编译与运行）', artifacts, silent)}
          </span>
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
          className="shrink-0 rounded-lg border border-line px-2.5 py-1.5 text-[11.5px] text-ink-soft transition hover:border-seal/50 hover:text-seal-deep disabled:opacity-40"
        >
          {t('清空')}
        </button>
      </div>

      {restartNeeded && (
        <p className="text-[11px] leading-relaxed text-ink-faint">
          {t('改动要重启应用才生效——插件在启动时装载一次，文档的渲染结果也是按内容缓存下来的。')}
        </p>
      )}

      <div className="rounded-lg border border-seal/25 bg-seal/5 px-3 py-2.5 text-[11px] leading-relaxed text-ink-soft">
        <div className="mb-1 flex items-center gap-1.5 text-seal-deep">
          <AlertTriangle size={12} />
          {t('插件与归一同权')}
        </div>
        {t('启用之后，插件读得到正文与你的全部笔记，也用得上应用与磁盘之间的那条通道。只装自己看得懂、或者来源可信的插件。')}
      </div>
    </div>
  )
}
