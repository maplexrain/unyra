/**
 * 设置面板：文档区的一枚页签（TabRef kind 'settings'，见 learn/types），不再是弹窗。
 *
 * 外壳因此只有「左侧分页 + 右侧内容」两栏，高度撑满文档区正文那一格；
 * 「关闭」就是页签上那颗 ×——这里不再自带，Esc 也不关它（页签是驻留的，不是模态的）。
 * 各分页的面板组件与分页清单见本目录（tabs.ts / *Panel.tsx）。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Check, Settings2 } from 'lucide-react'
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
} from '../../ai/settings'
import { type ProviderPreset } from '../../ai/providers'
import { REASONING_LABEL } from '../../ai/types'
import { syncProxyHosts } from '../../ai/http'
import {
  loadAppearance,
  setAppearance,
  type Appearance,
} from '../../lib/appearance'
import { t } from '../../i18n'
import { type SwitchRootResult } from '../../lib/boot'
import { AppearancePanel } from './AppearancePanel'
import InputPanel from '../InputPanel'
import TabButton from '../TabButton'
import { pane } from '../Pane'
import { isDevUnlocked } from '../../lib/devMode'
import { DEV_TAB, TABS, loadSavedTab, saveTab, type TabKey } from './tabs'
import { blankLocal, type StatusState } from './providerDraft'
import { WindowPanel } from './WindowPanel'
import { AboutPanel } from './AboutPanel'
import { UpdatePanel } from './UpdatePanel'
import { StoragePanel } from './StoragePanel'
import { DevPanel } from './DevPanel'
import { PluginsPanel } from './PluginsPanel'
import { PluginVoicePage } from './PluginVoicePage'
import { VOICE_PLUGIN_ID } from '../../lib/voice/plugin'
import { ProviderListPage } from './ProviderListPage'
import { ProviderConfigPage } from './ProviderConfigPage'

interface Props {
  /** 换用户数据目录：整份数据换一套，交给上层重新载入 */
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
export default function SettingsPanel({ onRootChanged, onToast }: Props) {
  const initial = loadAiSettings()
  const [tab, setTab] = useState<TabKey>(loadSavedTab)
  /** 换分页一律走它：选择跟着落盘，下次打开设置还停在这一页 */
  const selectTab = (key: TabKey) => {
    setTab(key)
    saveTab(key)
  }
  const [draft, setDraft] = useState<AiSettings>(initial)
  const [page, setPage] = useState<Page>({ view: 'list' })
  /**
   * 「插件」那一页的二级页：非空 = 正停在某个功能性插件的配置页上（值是插件 id）。
   * 与提供商的 page 分开存：两种二级页各自属于各自的页签，切页签回来不该串台。
   */
  const [pluginPage, setPluginPage] = useState<string | null>(null)
  const [status, setStatus] = useState<StatusState>({ kind: 'idle' })
  const [appearance, setAppearanceState] = useState(loadAppearance)
  /**
   * 开发者分页的入口状态：
   * - devEntry：这次会话里对左上角「设置」三击过；
   * - devUnlocked：localStorage 里有解锁凭据（打开设置时同步读一次，免得每次都要三击）。
   * 两者任一成立就显示分页；分页自身在未解锁时先要求输入口令。
   */
  const [devEntry, setDevEntry] = useState(false)
  const [devUnlocked, setDevUnlocked] = useState(isDevUnlocked)
  const tabs = devUnlocked || devEntry ? [...TABS, DEV_TAB] : TABS

  const saveTimerRef = useRef<number | null>(null)

  const persistSettings = useCallback((next: AiSettings) => {
    const gp = next.providers.find((p) => p.id === next.global.providerId) ?? next.providers[0]
    const model = gp && modelsOf(gp).includes(next.global.model) ? next.global.model : ''
    saveAiSettings({ ...next, global: { ...next.global, providerId: gp?.id ?? '', model } })
    void syncProxyHosts(allProviderBaseUrls())
  }, [])

  const updateDraft = useCallback(
    (updater: (prev: AiSettings) => AiSettings, immediate = false) => {
      setDraft((prev) => {
        const next = updater(prev)
        if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
        if (immediate) {
          persistSettings(next)
        } else {
          saveTimerRef.current = window.setTimeout(() => {
            persistSettings(next)
          }, 300)
        }
        return next
      })
    },
    [persistSettings],
  )

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current)
      }
    }
  }, [])

  const patchProvider = (id: string, patch: Partial<ProviderConfig>) => {
    updateDraft((d) => {
      const exists = d.providers.some((p) => p.id === id)
      const providers = exists
        ? d.providers.map((p) => (p.id === id ? { ...p, ...patch } : p))
        : [...d.providers, { ...blankLocal(id), ...patch }]
      return { ...d, providers }
    })
  }

  /** 整条替换（换预设/兼容格式时用，旧字段要一起清掉） */
  const replaceConfig = (fromId: string, next: ProviderConfig) => {
    updateDraft((d) => {
      const exists = d.providers.some((p) => p.id === fromId)
      const providers = exists ? d.providers.map((p) => (p.id === fromId ? next : p)) : [...d.providers, next]
      const global =
        d.global.providerId === fromId ? { ...d.global, providerId: next.id, model: '' } : d.global
      return { ...d, providers, global }
    }, true)
    setPage({ view: 'config', providerId: next.id })
  }

  const removeProvider = (id: string, opts?: { silent?: boolean }) => {
    updateDraft((d) => {
      const providers = d.providers.filter((p) => p.id !== id)
      if (!providers.length) return d
      const providerId = providers.some((p) => p.id === d.global.providerId) ? d.global.providerId : providers[0].id
      return { ...d, providers, global: { ...d.global, providerId, model: '' } }
    }, true)
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
    updateDraft(
      (d) => ({
        ...d,
        providers: [...d.providers, { id: preset.id, kind: 'provider', label: '', baseUrl: '', apiKey: '', models: [] }],
      }),
      true,
    )
    setStatus({ kind: 'idle' })
    setPage({ view: 'config', providerId: preset.id })
  }

  const createCustom = () => {
    const created = newCustomProvider({ compat: 'openai', label: '', baseUrl: '' })
    updateDraft((d) => ({ ...d, providers: [...d.providers, created] }), true)
    setStatus({ kind: 'idle' })
    setPage({ view: 'config', providerId: created.id })
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
    <div className="flex h-full min-h-0 w-full min-w-0 bg-paper">
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

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
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
          {tab === 'plugins' && pluginPage && (
            <button
              type="button"
              title={t('返回插件列表')}
              onClick={() => setPluginPage(null)}
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
                    ? pluginPage
                      ? t('语音输入')
                      : t('插件')
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
        </header>

        {tab === 'ai' ? (
          <div className="flex min-h-0 flex-1 flex-col">
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
                  onEffort={(effort) => updateDraft((d) => ({ ...d, global: { ...d.global, effort } }), true)}
                  onPickDefault={(providerId, model) =>
                    updateDraft((d) => ({ ...d, global: { ...d.global, providerId, model } }), true)
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

            <div className="flex items-center justify-between gap-2 border-t border-line px-5 py-2.5">
              <p className="min-w-0 truncate text-[11px] text-ink-faint">
                {t('默认：')}{gp ? labelOf(gp) : t('未创建')} · {globalModelName || t('未选模型')} ·{' '}
                {t(REASONING_LABEL[draft.global.effort])}
              </p>
              <span className="flex shrink-0 items-center gap-1 text-[11px] text-ok-deep">
                <Check size={11} className="stroke-[2.5]" />
                {t('改动已自动保存')}
              </span>
            </div>
          </div>
        ) : tab === 'appearance' ? (
          <AppearancePanel
            appearance={appearance}
            onChange={applyAppearance}
            onToast={onToast}
          />
        ) : tab === 'input' ? (
          <InputPanel onToast={onToast} />
        ) : tab === 'window' ? (
          <WindowPanel onToast={onToast} />
        ) : tab === 'storage' ? (
          <StoragePanel onRootChanged={onRootChanged} onToast={onToast} />
        ) : tab === 'plugins' ? (
          pluginPage === VOICE_PLUGIN_ID ? (
            <div className={pane(4, true)}>
              <PluginVoicePage onToast={onToast} />
            </div>
          ) : (
            <PluginsPanel onToast={onToast} onOpenConfig={setPluginPage} />
          )
        ) : tab === 'update' ? (
          <UpdatePanel />
        ) : tab === 'about' ? (
          <AboutPanel onToast={onToast} />
        ) : (
          <DevPanel onUnlocked={() => setDevUnlocked(true)} />
        )}
      </div>
    </div>
  )
}
