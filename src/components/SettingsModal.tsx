/**
 * 这个文件负责：设置弹窗的外壳：左侧页签、标题栏，以及把各分页路由到对应面板。
 */

import { useState } from 'react'
import { useEscapeKey } from '../lib/useEscape'
import { ArrowLeft, Check, Settings2, X } from 'lucide-react'
import {
  allProviderBaseUrls,
  isConfigured,
  labelOf,
  loadAiSettings,
  modelsOf,
  newCustomProvider,
  saveAiSettings,
  type AiSettings,
  type ProviderConfig,
} from '../ai/settings'
import { useLeaving } from '../lib/presence'
import { type ProviderPreset } from '../ai/providers'
import { REASONING_LABEL } from '../ai/types'
import { syncProxyHosts } from '../ai/http'
import {
  THEME_LABEL,
  THEME_MODES,
  THEME_SWATCH,
  loadAppearance,
  setAppearance,
  type Appearance,
} from '../lib/appearance'
import { LOCALES, LOCALE_LABEL, t, useLocale } from '../i18n'
import { changeUiLocale } from '../lib/uiLocale'
import ModalScrim from './ModalScrim'
import { pane } from './Pane'
import Switch from './Switch'
import InputPanel from './InputPanel'
import TabButton from './TabButton'
import { isDevUnlocked } from '../lib/devMode'
import { type SwitchRootResult } from '../lib/boot'
import { DEV_TAB, TABS, loadSavedTab, saveTab, type TabKey } from './settings/tabs'
import { blankLocal, type StatusState } from './settings/providerDraft'
import { WindowPanel } from './settings/WindowPanel'
import { AboutPanel } from './settings/AboutPanel'
import { UpdatePanel } from './settings/UpdatePanel'
import { StoragePanel } from './settings/StoragePanel'
import { DevPanel } from './settings/DevPanel'
import { PluginsPanel } from './settings/PluginsPanel'
import { ProviderListPage } from './settings/ProviderListPage'
import { ProviderConfigPage } from './settings/ProviderConfigPage'

interface Props {
  onClose: () => void
  onSaved: () => void
  /** 换用户数据目录：整份数据换一套，交给 App 重新载入 */
  onRootChanged: (dir?: string) => Promise<SwitchRootResult>
  onToast: (msg: string) => void
}

type Page = { view: 'list' } | { view: 'config'; providerId: string }

/* ---------- 主体 ---------- */

/**
 * 模型配置面板：两级页面。
 *
 * 一级「提供商列表」：只显示**用户已创建的**提供商 + 默认提供商/模型 + 思考程度。
 *   预设不再以「已内置的提供商」形式出现——它们只是创建时的模板。
 * 二级「配置页」：选预设（或自定义兼容格式）→ 名称 → Key → 模型列表。
 */
export default function SettingsModal({ onClose, onSaved, onRootChanged, onToast }: Props) {
  const initial = loadAiSettings()
  const [tab, setTab] = useState<TabKey>(loadSavedTab)
  /** 换分页一律走它：选择跟着落盘，下次打开设置还停在这一页 */
  const selectTab = (key: TabKey) => {
    setTab(key)
    saveTab(key)
  }
  const [draft, setDraft] = useState<AiSettings>(initial)
  const [page, setPage] = useState<Page>({ view: 'list' })
  const [status, setStatus] = useState<StatusState>({ kind: 'idle' })
  const [appearance, setAppearanceState] = useState(loadAppearance)
  // 界面语言是全局设置（跟机器走），不属 appearance；订阅它让这页的选中态跟着换
  const locale = useLocale()
  /**
   * 开发者分页的入口状态：
   * - devEntry：这次会话里对左上角「设置」三击过；
   * - devUnlocked：localStorage 里有解锁凭据（打开设置时同步读一次，免得每次都要三击）。
   * 两者任一成立就显示分页；分页自身在未解锁时先要求输入口令。
   */
  const [devEntry, setDevEntry] = useState(false)
  const [devUnlocked, setDevUnlocked] = useState(isDevUnlocked)
  const tabs = devUnlocked || devEntry ? [...TABS, DEV_TAB] : TABS
  // 所有关闭路径都走 close：先播退场动画再真的卸载，避免「啪」地消失
  const { leaving, close } = useLeaving(onClose)

  useEscapeKey(close)

  const patchProvider = (id: string, patch: Partial<ProviderConfig>) => {
    setDraft((d) => {
      const exists = d.providers.some((p) => p.id === id)
      const providers = exists
        ? d.providers.map((p) => (p.id === id ? { ...p, ...patch } : p))
        : [...d.providers, { ...blankLocal(id), ...patch }]
      return { ...d, providers }
    })
  }

  /** 整条替换（换预设/兼容格式时用，旧字段要一起清掉） */
  const replaceConfig = (fromId: string, next: ProviderConfig) => {
    setDraft((d) => {
      const exists = d.providers.some((p) => p.id === fromId)
      const providers = exists ? d.providers.map((p) => (p.id === fromId ? next : p)) : [...d.providers, next]
      const global =
        d.global.providerId === fromId ? { ...d.global, providerId: next.id, model: '' } : d.global
      return { ...d, providers, global }
    })
    setPage({ view: 'config', providerId: next.id })
  }

  const removeProvider = (id: string, opts?: { silent?: boolean }) => {
    setDraft((d) => {
      const providers = d.providers.filter((p) => p.id !== id)
      if (!providers.length) return d
      const providerId = providers.some((p) => p.id === d.global.providerId) ? d.global.providerId : providers[0].id
      return { ...d, providers, global: { ...d.global, providerId, model: '' } }
    })
    if (!opts?.silent) setPage({ view: 'list' })
  }

  /**
   * 用预设创建一家提供商：预设已内置地址，只需填 Key。
   * 同一个预设只该有一条配置（id 就是预设 id），已经建过就直接打开它——
   * 否则会出现两条同 id 的配置，改一条等于同时改两条。
   */
  const createFromPreset = (preset: ProviderPreset) => {
    const exists = draft.providers.find((p) => p.id === preset.id)
    if (exists) {
      setStatus({ kind: 'ok', msg: t('{0} 已经创建过了，已打开它的配置', preset.label) })
      setPage({ view: 'config', providerId: exists.id })
      return
    }
    setDraft((d) => ({
      ...d,
      providers: [...d.providers, { id: preset.id, kind: 'provider', label: '', baseUrl: '', apiKey: '', models: [] }],
    }))
    setStatus({ kind: 'idle' })
    setPage({ view: 'config', providerId: preset.id })
  }

  const createCustom = () => {
    const created = newCustomProvider({ compat: 'openai', label: '', baseUrl: '' })
    setDraft((d) => ({ ...d, providers: [...d.providers, created] }))
    setStatus({ kind: 'idle' })
    setPage({ view: 'config', providerId: created.id })
  }

  const handleSave = () => {
    const gp = draft.providers.find((p) => p.id === draft.global.providerId) ?? draft.providers[0]
    const model = gp && modelsOf(gp).includes(draft.global.model) ? draft.global.model : ''
    saveAiSettings({ ...draft, global: { ...draft.global, providerId: gp?.id ?? '', model } })
    void syncProxyHosts(allProviderBaseUrls())
    onSaved()
    close()
  }

  const applyAppearance = (patch: Partial<Appearance>) => {
    const next = { ...appearance, ...patch }
    setAppearanceState(next)
    setAppearance(next)
  }

  const configured = draft.providers.filter(isConfigured)
  const gp = draft.providers.find((p) => p.id === draft.global.providerId) ?? configured[0] ?? draft.providers[0]
  const globalModelName = gp ? draft.global.model || modelsOf(gp)[0] || '' : ''

  return (
    <ModalScrim z="z-50" leaving={leaving} onClose={close}>
      <div
        role="dialog"
        aria-label={t('设置')}
        className={`flex h-[min(760px,92vh)] w-full max-w-4xl overflow-hidden rounded-2xl border border-line-strong bg-paper shadow-[0_24px_64px_rgba(0,0,0,0.42)] ${
          leaving ? 'moji-dialog-out' : 'moji-dialog-in'
        }`}
      >
        <nav className="flex w-[176px] shrink-0 flex-col gap-1 border-r border-line bg-paper-deep px-3 py-4">
          {/* 三击「设置」二字是开发者分页的隐藏入口：e.detail 就是连击数 */}
          <div
            className="flex items-center gap-2 px-2 pb-3 text-[15px] font-semibold text-ink-strong"
            onClick={(e) => {
              if (e.detail >= 3) setDevEntry(true)
            }}
          >
            <Settings2 size={16} className="shrink-0 text-seal" />
            {t('设置')}
          </div>
          {tabs.map((tb) => (
            <TabButton
              key={tb.key}
              icon={tb.icon}
              label={t(tb.label)}
              active={tab === tb.key}
              onClick={() => selectTab(tb.key)}
            />
          ))}
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center gap-2 border-b border-line px-5 py-3">
            {tab === 'ai' && page.view === 'config' && (
              <button
                type="button"
                title={t('返回提供商列表')}
                onClick={() => {
                  setPage({ view: 'list' })
                  setStatus({ kind: 'idle' })
                }}
                className="flex h-7 w-7 items-center justify-center rounded-md text-ink-soft transition hover:bg-line/70 hover:text-ink"
              >
                <ArrowLeft size={16} />
              </button>
            )}
            <h2 className="text-[15px] font-semibold text-ink-strong">
              {tab === 'appearance'
                ? t('外观')
                : tab === 'window'
                  ? t('窗口')
                  : tab === 'storage'
                    ? t('数据存储')
                    : tab === 'plugins'
                      ? t('插件')
                      : tab === 'update'
                      ? t('更新')
                    : tab === 'about'
                      ? t('关于')
                      : tab === 'dev'
                        ? t('开发者')
                      : page.view === 'list'
                        ? t('模型设置')
                        : t('提供商配置')}
            </h2>
            <button
              type="button"
              title={t('关闭')}
              onClick={close}
              className="ml-auto flex h-7 w-7 items-center justify-center rounded-md text-ink-soft transition hover:bg-line/70 hover:text-ink"
            >
              <X size={16} />
            </button>
          </header>

          {tab === 'ai' ? (
            <form
              className="flex min-h-0 flex-1 flex-col"
              onSubmit={(e) => {
                e.preventDefault()
                handleSave()
              }}
            >
              <div className={pane(4, true)}>
                {page.view === 'list' ? (
                  <ProviderListPage
                    draft={draft}
                    configured={configured}
                    onOpen={(id) => {
                      setStatus({ kind: 'idle' })
                      setPage({ view: 'config', providerId: id })
                    }}
                    onPickPreset={createFromPreset}
                    onAddCustom={createCustom}
                    onEffort={(effort) => setDraft((d) => ({ ...d, global: { ...d.global, effort } }))}
                    onPickDefault={(providerId, model) =>
                      setDraft((d) => ({ ...d, global: { ...d.global, providerId, model } }))
                    }
                  />
                ) : (
                  <ProviderConfigPage
                    draft={draft}
                    providerId={page.providerId}
                    status={status}
                    setStatus={setStatus}
                    patchProvider={patchProvider}
                    replaceConfig={replaceConfig}
                    onDelete={removeProvider}
                  />
                )}
              </div>

              <div className="flex items-center justify-between gap-2 border-t border-line px-5 py-3">
                <p className="min-w-0 truncate text-[11px] text-ink-faint">
                  {t('默认：')}{gp ? labelOf(gp) : t('未创建')} · {globalModelName || t('未选模型')} ·{' '}
                  {t(REASONING_LABEL[draft.global.effort])}
                </p>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={close}
                    className="rounded-lg px-3.5 py-1.5 text-[12px] text-ink-soft transition hover:bg-line/60 hover:text-ink"
                  >
                    {t('取消')}
                  </button>
                  <button
                    type="submit"
                    className="flex items-center gap-1.5 rounded-lg bg-ink px-3.5 py-1.5 text-[12px] font-medium text-paper shadow-sm transition hover:opacity-90"
                  >
                    <Check size={13} />
                    {t('保存')}
                  </button>
                </div>
              </div>
            </form>
          ) : tab === 'appearance' ? (
            <div className={pane(5, true)}>
              <section>
                <div className="mb-2 text-ink-soft">{t('主题')}</div>
                <div className="flex flex-wrap gap-2">
                  {THEME_MODES.map((m) => {
                    const swatch = THEME_SWATCH[m]
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => applyAppearance({ theme: m })}
                        className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px] transition ${
                          appearance.theme === m
                            ? 'border-seal/50 bg-seal/10 font-medium text-seal-deep'
                            : 'border-line bg-card text-ink-soft hover:border-line-strong hover:text-ink'
                        }`}
                      >
                        {/* 小色板：纸色打底、强调色点睛，比文字标签更快认出是哪套 */}
                        <span
                          aria-hidden="true"
                          className="flex h-3.5 w-3.5 items-center justify-center rounded-full border border-line-strong"
                          style={{ background: swatch.paper }}
                        >
                          <span className="h-1.5 w-1.5 rounded-full" style={{ background: swatch.accent }} />
                        </span>
                        {t(THEME_LABEL[m])}
                      </button>
                    )
                  })}
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
                  {t('跟随系统只在浅色 / 深色之间自动切换（OS 只有这两种偏好）；其余主题是独立配色，选定即固定。')}
                </p>
              </section>
              <section>
                <div className="mb-2 text-ink-soft">{t('界面语言')}</div>
                <div className="flex flex-wrap gap-2">
                  {LOCALES.map((l) => (
                    <button
                      key={l}
                      type="button"
                      onClick={() => changeUiLocale(l)}
                      className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px] transition ${
                        locale === l
                          ? 'border-seal/50 bg-seal/10 font-medium text-seal-deep'
                          : 'border-line bg-card text-ink-soft hover:border-line-strong hover:text-ink'
                      }`}
                    >
                      {LOCALE_LABEL[l]}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
                  {t('语言跟机器走，对所有用户生效；正文与对话内容不翻译。')}
                </p>
              </section>
              <section>
                <div className="mb-2 text-ink-soft">{t('教学模式')}</div>
                <Switch
                  on={appearance.teachingMode}
                  onChange={(next) => applyAppearance({ teachingMode: next })}
                  label={t('显示按键浮层')}
                  hint={t('打开后左下角常驻一块小窗，实时显示你按下的键（Ctrl + K 这样）。录屏讲课时观众看得见操作，而不是只看结果在变。它不挡点击，也不改任何按键行为。')}
                />
              </section>
              <div className="rounded-lg border border-line bg-card/60 px-3 py-2.5 text-[11px] leading-relaxed text-ink-soft">
                {t('外观改动即时生效并自动保存，关闭窗口即可。')}
              </div>
            </div>
          ) : tab === 'input' ? (
            <InputPanel onToast={onToast} />
          ) : tab === 'window' ? (
            <WindowPanel onToast={onToast} />
          ) : tab === 'storage' ? (
            <StoragePanel onRootChanged={onRootChanged} onToast={onToast} />
          ) : tab === 'plugins' ? (
            <PluginsPanel onToast={onToast} />
          ) : tab === 'update' ? (
            <UpdatePanel />
          ) : tab === 'about' ? (
            <AboutPanel onToast={onToast} />
          ) : (
            <DevPanel onUnlocked={() => setDevUnlocked(true)} />
          )}
        </div>
      </div>
    </ModalScrim>
  )
}
