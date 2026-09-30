/**
 * 这个文件负责：模型设置的一级页面：已配置的提供商列表、默认提供商 / 模型、思考程度。
 */

import { useState } from 'react'
import { Cpu, Plus, Settings2, Sparkles, Star } from 'lucide-react'
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

/* ---------- 一级：提供商列表页 ---------- */

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
          <span className="text-ink-soft">
            {t('已配置的提供商')}
            <span className="ml-2 text-[11px] text-ink-faint">{t('点击进入配置')}</span>
          </span>
          <button
            type="button"
            onClick={() => setCreating((v) => !v)}
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] text-ink-soft transition hover:bg-line/60 hover:text-seal-deep"
          >
            <Plus size={12} />
            {t('创建提供商')}
          </button>
        </div>

        {configured.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-[12px] leading-relaxed text-ink-faint">
            {t('还没有提供商。点右上「创建提供商」，从预设里挑一家，或用自定义接入中转 / 内网 / 本地模型。')}
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {configured.map((p) => {
              const entries = modelEntriesOf(p)
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => onOpen(p.id)}
                    className="flex w-full items-center gap-3 rounded-xl border border-line bg-card px-3 py-2.5 text-left transition hover:border-seal/40 hover:bg-seal/[0.03]"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-line/60 text-ink-soft">
                      <Cpu size={15} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-[13px] font-medium text-ink-strong">{t(labelOf(p))}</span>
                        <span className="shrink-0 rounded bg-line/70 px-1.5 py-0.5 text-[10px] text-ink-soft">
                          {t(compatLabel(protocolOf(p)))}
                        </span>
                        {p.id === draft.global.providerId && (
                          <span className="flex shrink-0 items-center gap-0.5 rounded bg-seal/10 px-1.5 py-0.5 text-[10px] text-seal-deep">
                            <Star size={9} />
                            {t('默认')}
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block truncate font-mono text-[11px] text-ink-faint">
                        {entries.length ? entries.map((m) => m.id).join(' · ') : t('还没有模型')}
                      </span>
                    </span>
                    <Settings2 size={14} className="shrink-0 text-ink-faint" />
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        {creating && (
          <div className="mt-2 rounded-xl border border-seal/30 bg-card px-3.5 py-3">
            <div className="mb-1.5 text-[12px] font-medium text-ink-strong">{t('选择预设')}</div>
            <div className="flex flex-wrap gap-1.5">
              {PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  disabled={createdIds.has(p.id)}
                  onClick={() => onPickPreset(p)}
                  title={createdIds.has(p.id) ? t('已经创建过了') : t(p.note)}
                  className={`rounded-lg border px-2.5 py-1 text-[11.5px] transition ${
                    createdIds.has(p.id)
                      ? 'cursor-not-allowed border-line bg-line/40 text-ink-faint'
                      : 'border-line bg-card text-ink-soft hover:border-seal/40 hover:text-seal-deep'
                  }`}
                >
                  {t(p.label)}
                </button>
              ))}
            </div>
            <div className="mt-2.5 flex items-center gap-2 border-t border-line pt-2.5">
              <span className="text-[11.5px] text-ink-soft">{t('或')}</span>
              <button
                type="button"
                onClick={onAddCustom}
                className="rounded-lg border border-line bg-card px-2.5 py-1 text-[11.5px] text-ink-soft transition hover:border-seal/40 hover:text-seal-deep"
              >
                {t('自定义提供商（OpenAI / Anthropic / Responses 兼容）')}
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-seal/25 bg-seal/[0.04] px-3.5 py-3">
        <div className="mb-2 flex items-center gap-1.5">
          <Star size={13} className="text-seal" />
          <span className="text-[12.5px] font-medium text-seal-deep">{t('默认提供商与默认模型')}</span>
          <span className="text-[11px] text-ink-faint">{t('超级导师与后续 AI 功能都用这一组')}</span>
        </div>
        {configured.length === 0 ? (
          <p className="text-[11.5px] leading-relaxed text-ink-faint">
            {t('还没有配置好的提供商。配好任意一家后会自动设为默认。')}
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
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
                  <option value="">{t('（该提供商还没有模型）')}</option>
                )}
              </select>
            </label>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-line bg-card/60 px-3.5 py-3">
        <div className="mb-2 flex items-center gap-1.5">
          <Sparkles size={13} className="text-seal" />
          <span className="text-[12.5px] font-medium text-ink-strong">{t('思考程度')}</span>
          <span className="text-[11px] text-ink-faint">{t('全局设置，不绑提供商与模型')}</span>
        </div>
        {/* 和 agent 栏里的模型选择器用同一个滑条：同一件事在两处长得一样，
            用户不必分别学一遍；底色即当前档位的荧光色 */}
        <EffortSlider value={draft.global.effort} onChange={onEffort} />
        <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
          {REASONING_LABEL[draft.global.effort]}：{t(REASONING_HINT[draft.global.effort])}
        </p>
      </section>
    </>
  )
}
