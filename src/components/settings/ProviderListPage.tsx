/**
 * 模型设置的一级页面：已配置的提供商列表、创建提供商（官方 Logo 预设展示）、默认提供商与思考程度。
 */

import { useState } from 'react'
import {
  AlertCircle,
  Check,
  ExternalLink,
  Globe,
  KeyRound,
  Plus,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Star,
  Trash2,
} from 'lucide-react'
import {
  findReferencedDeepSeekKey,
  isConfigured,
  labelOf,
  modelEntriesOf,
  modelsOf,
  protocolOf,
  type AiSettings,
  type ProviderConfig,
  type WebSearchSettings,
} from '../../ai/settings'
import { PROVIDERS, type ProviderPreset } from '../../ai/providers'
import { compatLabel, type ReasoningEffort } from '../../ai/types'
import { t } from '../../i18n'
import EffortSlider from '../agent/EffortSlider'
import { ProviderLogo } from './ProviderLogo'

export function ProviderListPage({
  draft,
  configured,
  onOpen,
  onPickPreset,
  onAddCustom,
  onEffort,
  onPickDefault,
  onDelete,
  onUpdateSearch,
}: {
  draft: AiSettings
  configured: ProviderConfig[]
  onOpen: (id: string) => void
  onPickPreset: (preset: ProviderPreset) => void
  onAddCustom: () => void
  onEffort: (e: ReasoningEffort) => void
  onPickDefault: (providerId: string, model: string) => void
  onDelete?: (id: string) => void
  onUpdateSearch?: (search: WebSearchSettings) => void
}) {
  const [creating, setCreating] = useState(false)
  const createdIds = new Set(draft.providers.map((p) => p.id))

  const defaultId = configured.some((p) => p.id === draft.global.providerId)
    ? draft.global.providerId
    : (configured[0]?.id ?? '')
  const defaultProvider = configured.find((p) => p.id === defaultId)
  const defaultModel = defaultProvider ? draft.global.model || modelsOf(defaultProvider)[0] || '' : ''

  const dsRef = findReferencedDeepSeekKey(draft)
  const hasReferencedKey = !!dsRef
  const customSearchKey = draft.search?.apiKey?.trim() ?? ''
  const hasCustomKey = !!customSearchKey

  return (
    <>
      <section id="settings-section-providers" className="scroll-mt-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[12.5px] font-medium text-ink-strong">
            {t('已添加的提供商')}
          </span>
          <button
            type="button"
            onClick={() => setCreating((v) => !v)}
            className="flex items-center gap-1 rounded-lg border border-line bg-card px-2.5 py-1 text-[11.5px] font-medium text-ink transition hover:border-seal/50 hover:bg-seal/5 hover:text-seal-deep"
          >
            <Plus size={12} />
            {t('添加新提供商')}
          </button>
        </div>

        {draft.providers.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line bg-card/40 px-4 py-8 text-center">
            <p className="text-[12.5px] font-medium text-ink-strong">
              {t('尚未添加任何模型提供商')}
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {draft.providers.map((p) => {
              const isReady = isConfigured(p)
              const entries = modelEntriesOf(p)
              return (
                <li
                  key={p.id}
                  className="group flex items-center gap-2 rounded-xl border border-line bg-card p-1 shadow-2xs transition hover:border-seal/40 hover:bg-seal/[0.02]"
                >
                  <button
                    type="button"
                    onClick={() => onOpen(p.id)}
                    className="flex min-w-0 flex-1 items-center gap-3.5 px-2.5 py-2 text-left"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-line/80 bg-paper shadow-2xs">
                      <ProviderLogo id={p.id} protocol={protocolOf(p)} size={22} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[13px] font-medium text-ink-strong">{t(labelOf(p))}</span>
                        <span className="shrink-0 rounded bg-line/60 px-1.5 py-0.5 text-[10px] text-ink-soft">
                          {t(compatLabel(protocolOf(p)))}
                        </span>
                        {isReady ? (
                          p.id === draft.global.providerId && (
                            <span className="flex shrink-0 items-center gap-0.5 rounded bg-seal/10 px-1.5 py-0.5 text-[10.5px] font-medium text-seal-deep">
                              <Star size={9} />
                              {t('默认')}
                            </span>
                          )
                        ) : (
                          <span className="flex shrink-0 items-center gap-0.5 rounded bg-warn/15 px-1.5 py-0.5 text-[10.5px] font-medium text-warn-deep">
                            {t('未完成配置')}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-ink-faint">
                        {isReady ? (
                          <span className="truncate font-mono">
                            {entries.length
                              ? entries.map((m) => m.id).join(' · ')
                              : t('未配置模型（点击添加）')}
                          </span>
                        ) : (
                          <span className="truncate text-warn-deep/90">
                            {t('未填写 API Key，点击继续配置')}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                  <div className="flex items-center gap-1 pr-2">
                    {onDelete && (
                      <button
                        type="button"
                        title={t('删除提供商')}
                        onClick={() => onDelete(p.id)}
                        className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-faint opacity-50 transition hover:bg-danger/10 hover:text-danger hover:opacity-100"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                    <button
                      type="button"
                      title={t('点击进入配置')}
                      onClick={() => onOpen(p.id)}
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-faint transition hover:bg-line/70 hover:text-ink"
                    >
                      <Settings2 size={14} />
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        {/* 弹出/展开的预设选择面板 */}
        {creating && (
          <div className="mt-3 rounded-2xl border border-seal/30 bg-card/90 p-4 shadow-sm">
            <div className="mb-2.5 flex items-center justify-between">
              <div>
                <h4 className="text-[13px] font-semibold text-ink-strong">{t('选择要添加的模型提供商')}</h4>
              </div>
              <button
                type="button"
                onClick={() => setCreating(false)}
                className="text-[11.5px] text-ink-faint hover:text-ink"
              >
                {t('收起')}
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
              {PROVIDERS.map((p) => {
                const added = createdIds.has(p.id)
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setCreating(false)
                      onPickPreset(p)
                    }}
                    title={added ? t('该提供商已添加，点击查看或继续配置') : t(p.note)}
                    className={`flex items-center gap-2.5 rounded-xl border p-2.5 text-left transition ${
                      added
                        ? 'border-seal/30 bg-seal/[0.04] hover:border-seal/60 hover:bg-seal/[0.08] hover:shadow-2xs'
                        : 'border-line bg-paper hover:border-seal/50 hover:bg-seal/[0.04] hover:shadow-2xs'
                    }`}
                  >
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-line/60 bg-card">
                      <ProviderLogo id={p.id} size={18} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-[11.5px] font-medium text-ink-strong">
                          {t(p.label)}
                        </span>
                        {added && (
                          <span className="shrink-0 rounded bg-seal/10 px-1 py-0.2 text-[9.5px] font-medium text-seal-deep">
                            {t('已添加')}
                          </span>
                        )}
                      </div>
                      <div className="truncate text-[10px] text-ink-faint">
                        {added ? t('已添加 · 点击配置') : t(p.note)}
                      </div>
                    </div>
                  </button>
                )
              })}

              {/* 无预设自定义（与预设同级） */}
              <button
                type="button"
                onClick={() => {
                  setCreating(false)
                  onAddCustom()
                }}
                className="flex items-center gap-2.5 rounded-xl border border-line bg-paper p-2.5 text-left transition hover:border-seal/50 hover:bg-seal/[0.04] hover:shadow-2xs"
              >
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-line/60 bg-card text-ink-soft">
                  <SlidersHorizontal size={15} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[11.5px] font-medium text-ink-strong">
                    {t('无预设自定义')}
                  </div>
                  <div className="truncate text-[10px] text-ink-faint">
                    {t('自由切换协议')}
                  </div>
                </div>
              </button>
            </div>

            <div className="mt-3 flex items-center justify-between border-t border-line/70 pt-2.5">
              <span className="text-[11.5px] text-ink-soft">
                {t('没有找到您使用的平台？')}
              </span>
              <button
                type="button"
                onClick={() => {
                  setCreating(false)
                  onAddCustom()
                }}
                className="rounded-lg border border-line bg-paper px-3 py-1 text-[11.5px] font-medium text-ink-soft transition hover:border-seal/40 hover:text-seal-deep"
              >
                {t('+ 自定义接入（OpenAI / Anthropic / Responses 兼容）')}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* 默认模型与全局思考等级 */}
      <section className="rounded-xl border border-seal/25 bg-seal/[0.03] p-4">
        <div className="mb-2.5 flex items-center gap-1.5">
          <Star size={13} className="text-seal" />
          <span className="text-[12.5px] font-medium text-seal-deep">{t('默认提供商与主用模型')}</span>
        </div>
        {configured.length === 0 ? (
          <p className="text-[11.5px] leading-relaxed text-ink-faint">
            {t('还没有配置好的提供商。添加任意一家后将自动设为默认。')}
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="min-w-0">
              <span className="mb-1 block text-[11.5px] text-ink-soft">{t('默认提供商')}</span>
              <select
                value={defaultId}
                onChange={(e) => onPickDefault(e.target.value, '')}
                className="w-full rounded-lg border border-line bg-card px-2.5 py-1.5 text-[12.5px] text-ink-strong outline-none transition focus:border-seal/60"
              >
                {configured.map((p) => (
                  <option key={p.id} value={p.id}>
                    {labelOf(p)}
                  </option>
                ))}
              </select>
            </label>
            <label className="min-w-0">
              <span className="mb-1 block text-[11.5px] text-ink-soft">{t('默认模型')}</span>
              <select
                value={defaultModel}
                onChange={(e) => onPickDefault(defaultId, e.target.value)}
                className="w-full rounded-lg border border-line bg-card px-2.5 py-1.5 font-mono text-[12px] text-ink-strong outline-none transition focus:border-seal/60"
              >
                {defaultProvider &&
                  modelEntriesOf(defaultProvider).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name || m.id}
                    </option>
                  ))}
                {(!defaultProvider || !modelEntriesOf(defaultProvider).length) && (
                  <option value="">{t('（尚未添加模型）')}</option>
                )}
              </select>
            </label>
          </div>
        )}
      </section>

      {/* 思考等级滑块 */}
      <section className="rounded-xl border border-line bg-card/60 p-4">
        <div className="mb-2 flex items-center gap-1.5">
          <Sparkles size={13} className="text-seal" />
          <span className="text-[12.5px] font-medium text-ink-strong">{t('全局思考程度')}</span>
        </div>
        <EffortSlider value={draft.global.effort} onChange={onEffort} />
      </section>

      {/* 网络搜索配置 */}
      <section id="settings-section-search" className="rounded-xl border border-line bg-card/60 p-4 scroll-mt-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Globe size={14} className="text-seal" />
            <span className="text-[12.5px] font-medium text-ink-strong">{t('网络搜索配置')}</span>
          </div>
        </div>

        <div className="rounded-xl border border-line/80 bg-paper/60 p-3.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-line/80 bg-card shadow-2xs">
                <ProviderLogo id="deepseek" protocol="openai" size={22} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-medium text-ink-strong">
                    {t('DeepSeek 官方搜索 (Search & Fetch)')}
                  </span>
                  <span className="rounded bg-line/60 px-1.5 py-0.5 text-[10px] text-ink-soft">
                    {t('官方服务')}
                  </span>
                  {hasCustomKey ? (
                    <span className="flex items-center gap-1 rounded bg-seal/10 px-1.5 py-0.5 text-[10.5px] font-medium text-seal-deep">
                      <KeyRound size={10} />
                      {t('已配置独立密钥')}
                    </span>
                  ) : hasReferencedKey ? (
                    <span className="flex items-center gap-1 rounded bg-seal/10 px-1.5 py-0.5 text-[10.5px] font-medium text-seal-deep">
                      <Check size={10} />
                      {t('已自动复用提供商')}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 rounded bg-warn/15 px-1.5 py-0.5 text-[10.5px] font-medium text-warn-deep">
                      <AlertCircle size={10} />
                      {t('未配置密钥')}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-3 border-t border-line/60 pt-3 flex flex-col gap-2.5">
            {hasReferencedKey ? (
              <div className="rounded-lg border border-seal/30 bg-seal/[0.04] px-3 py-2 text-[11.5px] text-seal-deep flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Check size={14} className="shrink-0 text-seal" />
                  <span>
                    {t(
                      '已自动复用已配置的 DeepSeek 提供商（{0}）的 API Key，无需额外配置。',
                      labelOf(dsRef.provider),
                    )}
                  </span>
                </div>
                {hasCustomKey && (
                  <button
                    type="button"
                    onClick={() => onUpdateSearch?.({ provider: 'deepseek', apiKey: '' })}
                    className="shrink-0 text-[11px] font-medium underline hover:text-seal-deep"
                  >
                    {t('清除自定义 Key（恢复自动引用）')}
                  </button>
                )}
              </div>
            ) : (
              <div className="rounded-lg border border-warn/30 bg-warn/[0.05] px-3 py-2 text-[11.5px] text-warn-deep flex items-center gap-2">
                <AlertCircle size={14} className="shrink-0 text-warn" />
                <span>
                  {t('尚未检测到已配置的 DeepSeek 提供商。请在此填入 DeepSeek API Key，或在上方添加 DeepSeek 官方提供商。')}
                </span>
              </div>
            )}

            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <label className="text-[11.5px] font-medium text-ink-soft">
                  {hasReferencedKey ? t('覆盖默认 API Key（选填）') : t('DeepSeek API Key')}
                </label>
                <a
                  href="https://platform.deepseek.com/api_keys"
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 text-[11px] text-ink-faint hover:text-seal hover:underline"
                >
                  <span>{t('前往 DeepSeek 开放平台获取 Key')}</span>
                  <ExternalLink size={10} />
                </a>
              </div>
              <input
                type="password"
                value={draft.search?.apiKey ?? ''}
                onChange={(e) => onUpdateSearch?.({ provider: 'deepseek', apiKey: e.target.value })}
                placeholder={
                  hasReferencedKey
                    ? t('已自动复用提供商密钥（如需覆盖可在此填入独立的 DeepSeek API Key）')
                    : 'sk-...'
                }
                className="w-full rounded-lg border border-line bg-card px-2.5 py-1.5 font-mono text-[12px] text-ink-strong outline-none transition focus:border-seal/60 placeholder:font-sans placeholder:text-ink-faint/70"
              />
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
