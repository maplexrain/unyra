/**
 * 这个文件负责：提供商配置的草稿工具：把一条配置解析成可发请求的形式、造一条空白配置，以及配置页共用的状态类型。
 */

import { baseUrlOf, labelOf, protocolOf, type ProviderConfig } from '../../ai/settings'
import { presetOf } from '../../ai/providers'
import { type ResolvedProvider } from '../../ai/client'

/** 配置页的保存 / 测试状态：提供商配置页与 ConfigBody 共用，外壳也持有它 */
export type StatusState = { kind: 'idle' } | { kind: 'busy' } | { kind: 'ok'; msg: string } | { kind: 'fail'; msg: string }

/** 把一条配置解析成可发请求的形式（与 settings 的 resolveProvider 同口径） */
export function resolveDraft(cfg: ProviderConfig, extraHeaders?: Record<string, string>): ResolvedProvider {
  const preset = presetOf(cfg.id)
  return {
    id: cfg.id,
    label: labelOf(cfg),
    baseUrl: baseUrlOf(cfg),
    apiKey: cfg.apiKey.trim(),
    extraHeaders,
    quirks: preset?.quirks,
    protocol: protocolOf(cfg),
    modelsPath: preset?.modelsPath,
    maxTokens: cfg.maxTokens ?? preset?.maxTokens,
    goPlanOnly: protocolOf(cfg) === 'commandcode',
    apiVersion: cfg.apiVersion ?? preset?.apiVersion,
  }
}

export function blankLocal(id: string, kind: ProviderConfig['kind'] = 'provider'): ProviderConfig {
  return { id, kind, label: '', baseUrl: '', apiKey: '', models: [] }
}
