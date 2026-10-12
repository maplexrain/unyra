import { describe, expect, it, vi } from 'vitest'
import {
  CUSTOM_PREFIX,
  isCustomConfig,
  isCustomId,
  newCustomProvider,
  protocolOf,
  saveAiSettings,
  subscribeAiSettings,
  type AiSettings,
  type ProviderConfig,
} from '../src/ai/settings'
import { PROVIDERS, endpoint, presetOf } from '../src/ai/providers'
import { resolveDraft } from '../src/components/settings/providerDraft'

describe('提供商预设与自定义协议联动及切换测试', () => {
  it('创建自定义提供商时默认使用 openai 兼容协议', () => {
    const custom = newCustomProvider({ compat: 'openai', label: '', baseUrl: '' })
    expect(custom.kind).toBe('custom')
    expect(custom.compat).toBe('openai')
    expect(isCustomConfig(custom)).toBe(true)
    expect(isCustomId(custom.id)).toBe(true)
    expect(custom.id.startsWith(CUSTOM_PREFIX)).toBe(true)
  })

  it('预设与自定义的协议识别：预设绑定自身协议，自定义由 compat 决定且默认 openai', () => {
    const dsPreset = presetOf('deepseek')
    expect(dsPreset).toBeDefined()

    const presetConfig: ProviderConfig = {
      id: 'deepseek',
      kind: 'provider',
      label: '',
      baseUrl: '',
      apiKey: 'sk-test',
      models: [],
    }
    expect(isCustomConfig(presetConfig)).toBe(false)
    expect(protocolOf(presetConfig)).toBe('openai')

    const customConfig: ProviderConfig = {
      id: `${CUSTOM_PREFIX}test-1`,
      kind: 'custom',
      compat: 'anthropic',
      label: 'My Claude Proxy',
      baseUrl: 'https://proxy.example.com',
      apiKey: 'sk-ant-test',
      models: [],
    }
    expect(isCustomConfig(customConfig)).toBe(true)
    expect(protocolOf(customConfig)).toBe('anthropic')

    // 缺少 compat 时回落到 openai
    const fallbackCustom: ProviderConfig = {
      id: `${CUSTOM_PREFIX}test-2`,
      kind: 'custom',
      label: '',
      baseUrl: '',
      apiKey: '',
      models: [],
    }
    expect(protocolOf(fallbackCustom)).toBe('openai')
  })

  it('自定义配置即便 id 与预设相同，也不会错误继承预设的 quirks 与 paths', () => {
    const customWithPresetId: ProviderConfig = {
      id: 'deepseek',
      kind: 'custom',
      compat: 'responses',
      label: '自定义 DeepSeek 网关',
      baseUrl: 'https://gateway.example.com',
      apiKey: 'sk-test',
      models: [],
    }

    const resolved = resolveDraft(customWithPresetId)
    expect(resolved.protocol).toBe('responses')
    expect(resolved.quirks).toBeUndefined()
    expect(resolved.modelsPath).toBeUndefined()
  })

  it('预设与自定义双向切换逻辑：无死锁，且能无缝切回', () => {
    const deepseekPreset = PROVIDERS.find((p) => p.id === 'deepseek')!
    expect(deepseekPreset).toBeDefined()

    // 1. 初始为预设
    let currentConfig: ProviderConfig = {
      id: deepseekPreset.id,
      kind: 'provider',
      label: '',
      baseUrl: '',
      apiKey: 'sk-initial',
      models: [],
    }
    expect(currentConfig.kind).toBe('provider')

    // 2. 模拟切为「无预设自定义」
    const switchToCustom = (cfg: ProviderConfig): ProviderConfig => {
      const newId = isCustomId(cfg.id) ? cfg.id : `${CUSTOM_PREFIX}generated-uuid`
      return {
        id: newId,
        kind: 'custom',
        compat: 'openai',
        label: cfg.label || '自定义配置',
        baseUrl: cfg.baseUrl,
        apiKey: cfg.apiKey,
        models: cfg.models,
      }
    }

    currentConfig = switchToCustom(currentConfig)
    expect(currentConfig.kind).toBe('custom')
    expect(currentConfig.compat).toBe('openai')
    expect(isCustomConfig(currentConfig)).toBe(true)
    expect(isCustomId(currentConfig.id)).toBe(true)

    // 3. 在自定义模式下自由切换协议
    currentConfig = { ...currentConfig, compat: 'anthropic' }
    expect(currentConfig.compat).toBe('anthropic')
    expect(protocolOf(currentConfig)).toBe('anthropic')

    // 4. 模拟切回预设 (switchPreset)
    const switchPreset = (cfg: ProviderConfig, p: typeof deepseekPreset): ProviderConfig => {
      return {
        id: p.id,
        kind: 'provider',
        label: '',
        baseUrl: '',
        apiKey: cfg.apiKey,
        models: cfg.models,
      }
    }

    currentConfig = switchPreset(currentConfig, deepseekPreset)
    expect(currentConfig.kind).toBe('provider')
    expect(currentConfig.id).toBe('deepseek')
    expect(isCustomConfig(currentConfig)).toBe(false)
    expect(currentConfig.apiKey).toBe('sk-initial') // Key 保留
  })

  it('emitAiSettings 使用异步微任务派发，解耦同步渲染与订阅更新', async () => {
    const listener = vi.fn()
    const unsubscribe = subscribeAiSettings(listener)

    const testSettings: AiSettings = {
      version: 3,
      providers: [
        {
          id: 'deepseek',
          kind: 'provider',
          label: '',
          baseUrl: '',
          apiKey: 'sk-test',
          models: [],
        },
      ],
      global: {
        providerId: 'deepseek',
        model: '',
        effort: 'medium',
      },
    }

    saveAiSettings(testSettings)

    // 在 saveAiSettings 同步返回的瞬间，listener 不应当被同步触发（防止 React 渲染中 setState 冲突）
    expect(listener).not.toHaveBeenCalled()

    // 等待微任务队列清空
    await Promise.resolve()

    // 微任务完成后，listener 应该被触发
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
  })

  it('endpoint 拼接智能消除 /v1 重复（Issue #115：同一中转站统一填 /v1 时切协议不报错）', () => {
    // 1. 中转站常用地址带 /v1，切到 Anthropic 时不产生 /v1/v1/messages
    expect(endpoint('https://proxy.example.com/v1', '/v1/messages')).toBe('https://proxy.example.com/v1/messages')
    expect(endpoint('https://proxy.example.com/v1/', '/v1/messages')).toBe('https://proxy.example.com/v1/messages')

    // 2. 中转站常用地址带 /v1，切到 OpenAI 或 Responses 协议时正常拼接
    expect(endpoint('https://proxy.example.com/v1', '/chat/completions')).toBe('https://proxy.example.com/v1/chat/completions')
    expect(endpoint('https://proxy.example.com/v1', '/responses')).toBe('https://proxy.example.com/v1/responses')

    // 3. 官方 Anthropic 地址不带 /v1，正常补齐 /v1/messages
    expect(endpoint('https://api.anthropic.com', '/v1/messages')).toBe('https://api.anthropic.com/v1/messages')

    // 4. 用户若误填完整端点，不重复拼接
    expect(endpoint('https://proxy.example.com/v1/chat/completions', '/chat/completions')).toBe(
      'https://proxy.example.com/v1/chat/completions',
    )
    expect(endpoint('https://proxy.example.com/v1/messages', '/v1/messages')).toBe(
      'https://proxy.example.com/v1/messages',
    )
    expect(endpoint('https://proxy.example.com/messages', '/v1/messages')).toBe(
      'https://proxy.example.com/messages',
    )
  })
})
