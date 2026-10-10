/**
 * 模型设置的一级页面：已配置的提供商列表、创建提供商（官方 Logo 预设展示）、默认提供商与思考程度。
 */

import { useState } from 'react'
import { Plus, Settings2, Sparkles, Star } from 'lucide-react'
import {
  labelOf,
  modelEntriesOf,
  modelsOf,
  protocolOf,
  type AiSettings,
  type ProviderConfig,
} from '../../ai/settings'
import { PROVIDERS, type ProviderPreset } from '../../ai/providers'
import { REASONING_HINT, REASONING_LABEL, compatLabel, type ReasoningEffort } from '../../ai/types'
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
}: {
  draft: AiSettings
  configured: ProviderConfig[]
  onOpen: (id: string) => void
  onPickPreset: (preset: ProviderPreset) => void
  onAddCustom: () => void
  onEffort: (e: ReasoningEffort) => void
  onPickDefault: (providerId: string, model: string) => void
}) {
  const [creating, setCreating] = useState(false)
  const createdIds = new Set(draft.providers.map((p) => p.id))

  const defaultId = configured.some((p) => p.id === draft.global.providerId)
    ? draft.global.providerId
    : (configured[0]?.id ?? '')
  const defaultProvider = configured.find((p) => p.id === defaultId)
  const defaultModel = defaultProvider ? draft.global.model || modelsOf(defaultProvider)[0] || '' : ''

  return (
    <>
      <section>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[12.5px] font-medium text-ink-strong">
            {t('已配置的提供商')}
            <span className="ml-2 text-[11px] font-normal text-ink-faint">
              {t('点击进入配置（配置会自动保存）')}
            </span>
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

        {configured.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line bg-card/40 px-4 py-8 text-center">
            <p className="text-[12.5px] font-medium text-ink-strong">
              {t('尚未添加任何模型提供商')}
            </p>
            <p className="mt-1 text-[11.5px] text-ink-faint">
              {t('点击右上角「添加新提供商」，选择 DeepSeek、OpenAI、Kimi 等官方预设或接入自定义模型。')}
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {configured.map((p) => {
              const entries = modelEntriesOf(p)
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => onOpen(p.id)}
                    className="flex w-full items-center gap-3.5 rounded-xl border border-line bg-card px-3.5 py-3 text-left shadow-2xs transition hover:border-seal/40 hover:bg-seal/[0.02]"
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
                        {p.id === draft.global.providerId && (
                          <span className="flex shrink-0 items-center gap-0.5 rounded bg-seal/10 px-1.5 py-0.5 text-[10.5px] font-medium text-seal-deep">
                            <Star size={9} />
                            {t('默认')}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-ink-faint">
                        <span className="truncate font-mono">
                          {entries.length
                            ? entries.map((m) => m.id).join(' · ')
                            : t('未配置模型（点击添加）')}
                        </span>
                      </div>
                    </div>
                    <Settings2 size={14} className="shrink-0 text-ink-faint" />
                  </button>
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
                <p className="mt-0.5 text-[11px] text-ink-faint">
                  {t('已内置各家官方接入协议与接口地址，选中后只需填入 API Key')}
                </p>
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
                    disabled={added}
                    onClick={() => {
                      setCreating(false)
                      onPickPreset(p)
                    }}
                    title={added ? t('该提供商已添加') : t(p.note)}
                    className={`flex items-center gap-2.5 rounded-xl border p-2.5 text-left transition ${
                      added
                        ? 'cursor-not-allowed border-line bg-line/30 opacity-60'
                        : 'border-line bg-paper hover:border-seal/50 hover:bg-seal/[0.04] hover:shadow-2xs'
                    }`}
                  >
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-line/60 bg-card">
                      <ProviderLogo id={p.id} size={18} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[11.5px] font-medium text-ink-strong">
                        {t(p.label)}
                      </div>
                      <div className="truncate text-[10px] text-ink-faint">
                        {added ? t('已添加') : t(p.note)}
                      </div>
                    </div>
                  </button>
                )
              })}
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
          <span className="text-[11px] text-ink-faint">{t('超级导师与核心 AI 功能均以此为基准')}</span>
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
          <span className="text-[11px] text-ink-faint">{t('对所有支持推理思考的模型生效')}</span>
        </div>
        <EffortSlider value={draft.global.effort} onChange={onEffort} />
        <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
          {REASONING_LABEL[draft.global.effort]}：{t(REASONING_HINT[draft.global.effort])}
        </p>
      </section>
    </>
  )
}
