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

  it('未配置 Key 的预设提供商仍存在于 providers 列表中且可识别状态', () => {
    const dsPreset = presetOf('deepseek')!
    const unconfiguredProvider: ProviderConfig = {
      id: dsPreset.id,
      kind: 'provider',
      label: '',
      baseUrl: '',
      apiKey: '',
      models: [],
    }

    const settings: AiSettings = {
      version: 3,
      providers: [unconfiguredProvider],
      global: {
        providerId: '',
        model: '',
        effort: 'medium',
      },
    }

    // 存在于列表但未配置完成
    expect(settings.providers.some((p) => p.id === dsPreset.id)).toBe(true)
    expect(unconfiguredProvider.apiKey.trim() === '').toBe(true)

    // 重复选择已添加预设时，能够正确识别已存在项并不产生重复条目
    const exists = settings.providers.find((p) => p.id === dsPreset.id)
    expect(exists).toBeDefined()
    expect(exists?.id).toBe('deepseek')
  })

  it('各家非思考模式预设配置完整且适配正确参数', () => {
    // 阿里云百炼：通过 enableThinkingParam 发送 enable_thinking: false
    const dashscope = presetOf('dashscope')!
    expect(dashscope.quirks?.enableThinkingParam).toBe(true)
    expect(dashscope.quirks?.omitReasoningEffort).toBe(true)
    expect(dashscope.effortMap?.none).toBe('omit')

    // 硅基流动：支持 enableThinkingParam
    const siliconflow = presetOf('siliconflow')!
    expect(siliconflow.quirks?.enableThinkingParam).toBe(true)
    expect(siliconflow.effortMap?.none).toBe('omit')

    // 火山方舟：支持 enableThinkingParam
    const volcengine = presetOf('volcengine')!
    expect(volcengine.quirks?.enableThinkingParam).toBe(true)
    expect(volcengine.effortMap?.none).toBe('omit')

    // Google Gemini：支持 thinkingConfigParam（thinking_budget: 0）
    const gemini = presetOf('gemini')!
    expect(gemini.quirks?.thinkingConfigParam).toBe(true)
    expect(gemini.quirks?.omitReasoningEffort).toBe(true)
    expect(gemini.effortMap?.none).toBe('omit')

    // OpenAI 官方：reasoning_effort: 'none'
    const openai = presetOf('openai')!
    expect(openai.effortMap?.none).toBe('none')

    // DeepSeek 官方：thinking.type 机制（非思考时发送 thinking: { type: "disabled" }）
    const deepseek = presetOf('deepseek')!
    expect(deepseek.quirks?.thinkingStyle).toBe('thinking_type')
    expect(deepseek.quirks?.thinkingTypeParam).toBe(true)
    expect(deepseek.quirks?.omitReasoningEffort).toBeUndefined()

    // Ollama 本地模型：think 机制
    const ollama = presetOf('ollama')!
    expect(ollama.quirks?.thinkingStyle).toBe('think')
    expect(ollama.quirks?.thinkParam).toBe(true)
    expect(ollama.quirks?.omitReasoningEffort).toBe(true)
  })

  it('设置保存与归一化时完整保留 quirks 特殊参数', () => {
    const customConfig: ProviderConfig = {
      id: `${CUSTOM_PREFIX}test-quirks`,
      kind: 'custom',
      label: 'Custom Provider',
      baseUrl: 'https://api.example.com',
      apiKey: 'sk-123',
      models: [],
      quirks: {
        thinkingStyle: 'thinking_type',
        thinkingTypeParam: true,
        omitReasoningEffort: true,
        tokenParam: 'max_completion_tokens',
      },
    }

    const resolved = resolveDraft(customConfig)
    expect(resolved.quirks?.thinkingStyle).toBe('thinking_type')
    expect(resolved.quirks?.thinkingTypeParam).toBe(true)
    expect(resolved.quirks?.omitReasoningEffort).toBe(true)
    expect(resolved.quirks?.tokenParam).toBe('max_completion_tokens')
  })

  it('bodyFor 在各平台和模型下的非思考请求参数与模型自适应', async () => {
    const { bodyFor } = await import('../src/ai/client')

    // 1. DeepSeek 官方：deepseek-chat 设定 none 时输出 thinking: { type: 'disabled' } 且不携带 reasoning_effort
    const dsResolved = resolveDraft({
      id: 'deepseek',
      kind: 'provider',
      label: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'sk-test',
      models: [],
    })
    const dsBodyNone = bodyFor(dsResolved, {
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: 'hello' }],
      stream: true,
      reasoningEffort: 'none',
    })
    expect(dsBodyNone.model).toBe('deepseek-chat')
    expect(dsBodyNone.thinking).toEqual({ type: 'disabled' })
    expect(dsBodyNone.reasoning_effort).toBeUndefined()

    // 2. DeepSeek 官方：若用户选择了纯推理模型 deepseek-reasoner，但在非思考模式下，自动降级切换为 deepseek-chat 并禁用思考
    const dsReasonerBodyNone = bodyFor(dsResolved, {
      model: 'deepseek-reasoner',
      messages: [{ role: 'user', content: 'hello' }],
      stream: true,
      reasoningEffort: 'none',
    })
    expect(dsReasonerBodyNone.model).toBe('deepseek-chat')
    expect(dsReasonerBodyNone.thinking).toEqual({ type: 'disabled' })
    expect(dsReasonerBodyNone.reasoning_effort).toBeUndefined()

    // 3. DeepSeek 官方：开启思考时保持 deepseek-reasoner 并发送 thinking: { type: 'enabled' } 与 reasoning_effort
    const dsReasonerBodyHigh = bodyFor(dsResolved, {
      model: 'deepseek-reasoner',
      messages: [{ role: 'user', content: 'hello' }],
      stream: true,
      reasoningEffort: 'high',
    })
    expect(dsReasonerBodyHigh.model).toBe('deepseek-reasoner')
    expect(dsReasonerBodyHigh.thinking).toEqual({ type: 'enabled' })
    expect(dsReasonerBodyHigh.reasoning_effort).toBe('high')

    // 4. 阿里云百炼 / 硅基流动：发送 enable_thinking: false
    const dashscopeResolved = resolveDraft({
      id: 'dashscope',
      kind: 'provider',
      label: 'Dashscope',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      apiKey: 'sk-test',
      models: [],
    })
    const dashBodyNone = bodyFor(dashscopeResolved, {
      model: 'qwen-plus',
      messages: [{ role: 'user', content: 'hello' }],
      stream: true,
      reasoningEffort: 'none',
    })
    expect(dashBodyNone.enable_thinking).toBe(false)
    expect(dashBodyNone.reasoning_effort).toBeUndefined()

    const dashBodyHigh = bodyFor(dashscopeResolved, {
      model: 'qwen-plus',
      messages: [{ role: 'user', content: 'hello' }],
      stream: true,
      reasoningEffort: 'high',
    })
    expect(dashBodyHigh.enable_thinking).toBe(true)

    // 5. Google Gemini：发送 thinking_config: { thinking_budget: 0 }
    const geminiResolved = resolveDraft({
      id: 'gemini',
      kind: 'provider',
      label: 'Gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      apiKey: 'sk-test',
      models: [],
    })
    const geminiBodyNone = bodyFor(geminiResolved, {
      model: 'gemini-2.5-pro',
      messages: [{ role: 'user', content: 'hello' }],
      stream: true,
      reasoningEffort: 'none',
    })
    expect(geminiBodyNone.thinking_config).toEqual({ thinking_budget: 0 })
    expect(geminiBodyNone.reasoning_effort).toBeUndefined()

    // 6. Ollama 本地模型：发送 think: false / true
    const ollamaResolved = resolveDraft({
      id: 'ollama',
      kind: 'provider',
      label: 'Ollama',
      baseUrl: 'http://localhost:11434/v1',
      apiKey: '',
      models: [],
    })
    const ollamaBodyNone = bodyFor(ollamaResolved, {
      model: 'deepseek-r1:8b',
      messages: [{ role: 'user', content: 'hello' }],
      stream: true,
      reasoningEffort: 'none',
    })
    expect(ollamaBodyNone.think).toBe(false)

    // 7. OpenRouter 网关：发送 reasoning: { effort: 'none', enabled: false }
    const openrouterResolved = resolveDraft({
      id: 'openrouter',
      kind: 'provider',
      label: 'OpenRouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'sk-test',
      models: [],
    })
    const openrouterBodyNone = bodyFor(openrouterResolved, {
      model: 'deepseek/deepseek-r1',
      messages: [{ role: 'user', content: 'hello' }],
      stream: true,
      reasoningEffort: 'none',
    })
    expect(openrouterBodyNone.reasoning).toEqual({ effort: 'none', enabled: false })
    expect(openrouterBodyNone.reasoning_effort).toBe('none')

    // 8. 自定义提供商（未配 quirks，但地址包含 deepseek）：自动推断并发送 thinking: { type: 'disabled' }
    const customDsResolved: any = {
      id: 'custom:ds-proxy',
      label: 'Custom DS',
      baseUrl: 'https://my-proxy.internal/deepseek/v1',
      apiKey: 'sk-test',
    }
    const customDsBodyNone = bodyFor(customDsResolved, {
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: 'hello' }],
      stream: true,
      reasoningEffort: 'none',
    })
    expect(customDsBodyNone.thinking).toEqual({ type: 'disabled' })
    expect(customDsBodyNone.reasoning_effort).toBeUndefined()
  })

  it('流式接收时在 non-thinking 模式下绝对抑制 reasoning 并清洗 <think> 标签', async () => {
    const { streamChatWith } = await import('../src/ai/client')

    const provider = resolveDraft({
      id: 'deepseek',
      kind: 'provider',
      label: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'sk-test',
      models: [],
    })

    const origFetch = globalThis.fetch

    // 1. 模拟上游泄漏 reasoning_content，在 reasoningEffort: 'none' 下应完全屏蔽
    const sseWithLeakedReasoning = [
      'data: {"choices":[{"delta":{"reasoning_content":"Thinking secretly..."}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"Final Answer"}}]}\n\n',
      'data: [DONE]\n\n',
    ].join('')

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(sseWithLeakedReasoning))
            controller.close()
          },
        }),
        { headers: { 'Content-Type': 'text/event-stream' } },
      ),
    )

    const receivedDeltas: Array<{ content?: string; reasoning?: string }> = []
    const res1 = await streamChatWith(provider, 'deepseek-chat', {
      messages: [{ role: 'user', content: 'test' }],
      reasoningEffort: 'none',
      onDelta: (d) => receivedDeltas.push(d),
    })

    expect(receivedDeltas.some((d) => d.reasoning)).toBe(false)
    expect(res1.reasoning).toBe('')
    expect(res1.content).toBe('Final Answer')

    // 2. 模拟本地模型在 content 中返回 <think>...</think>，在 reasoningEffort: 'none' 下应完全剥除
    const sseWithThinkTag = [
      'data: {"choices":[{"delta":{"content":"<think>Internal thought process</think>Direct Result"}}]}\n\n',
      'data: [DONE]\n\n',
    ].join('')

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(sseWithThinkTag))
            controller.close()
          },
        }),
        { headers: { 'Content-Type': 'text/event-stream' } },
      ),
    )

    const receivedDeltas2: Array<{ content?: string; reasoning?: string }> = []
    const res2 = await streamChatWith(provider, 'deepseek-chat', {
      messages: [{ role: 'user', content: 'test' }],
      reasoningEffort: 'none',
      onDelta: (d) => receivedDeltas2.push(d),
    })

    expect(receivedDeltas2.some((d) => d.reasoning)).toBe(false)
    expect(res2.content).toBe('Direct Result')

    // 3. 模拟开启思考时，<think> 标签内容转为 reasoning 事件
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(sseWithThinkTag))
            controller.close()
          },
        }),
        { headers: { 'Content-Type': 'text/event-stream' } },
      ),
    )

    const receivedDeltas3: Array<{ content?: string; reasoning?: string }> = []
    const res3 = await streamChatWith(provider, 'deepseek-chat', {
      messages: [{ role: 'user', content: 'test' }],
      reasoningEffort: 'high',
      onDelta: (d) => receivedDeltas3.push(d),
    })

    expect(receivedDeltas3.some((d) => d.reasoning === 'Internal thought process')).toBe(true)
    expect(res3.reasoning).toBe('Internal thought process')
    expect(res3.content).toBe('Direct Result')

    globalThis.fetch = origFetch
  })

  it('思考模式下 assistant 消息的 reasoning_content 回传契约与跨提供商健壮性', async () => {
    const { bodyFor } = await import('../src/ai/client')
    const dsProvider = resolveDraft({
      id: 'deepseek',
      kind: 'provider',
      label: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'sk-test',
      models: [],
    })

    const messages = [
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '思考后回答', reasoning_content: '这是思考思维链' },
      { role: 'tool', tool_call_id: 'call-1', content: '工具结果' },
      // 模拟中间注入的提示词模块或合成 assistant 消息（无 reasoning_content）
      { role: 'assistant', content: '【提示词模块】这是指导规范' },
    ] as any

    // 1. DeepSeek 在 thinking 开启下：缺失 reasoning_content 的 assistant 消息自动补充空串 ""
    const dsBody = bodyFor(dsProvider, {
      model: 'deepseek-chat',
      messages,
      stream: true,
      reasoningEffort: 'medium',
    })
    const dsMessages = dsBody.messages as any[]
    expect(dsMessages[1].reasoning_content).toBe('这是思考思维链')
    expect(dsMessages[3].reasoning_content).toBe('')

    // 2. DeepSeek 在 non-thinking (none) 下：不强制填充空串
    const dsNoneBody = bodyFor(dsProvider, {
      model: 'deepseek-chat',
      messages,
      stream: true,
      reasoningEffort: 'none',
    })
    const dsNoneMessages = dsNoneBody.messages as any[]
    expect(dsNoneMessages[3].reasoning_content).toBeUndefined()

    // 3. OpenAI 官方规范：严禁向 completions 发送 reasoning_content，自动剥除
    const openaiProvider = resolveDraft({
      id: 'openai',
      kind: 'provider',
      label: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      models: [],
    })
    const openaiBody = bodyFor(openaiProvider, {
      model: 'gpt-4o',
      messages,
      stream: true,
      reasoningEffort: 'medium',
    })
    const openaiMessages = openaiBody.messages as any[]
    expect(openaiMessages[1].reasoning_content).toBeUndefined()
    expect(openaiMessages[3].reasoning_content).toBeUndefined()
  })
  it('优化模型预设配置：验证各家官方模型元信息（包含 deepseek-flash 1M 上下文与视觉能力），以及向后兼容自动升级', async () => {
    const { createDefaultProvider, makeModelEntry, withKnownModelMeta, normalizeAiSettings } = await import('../src/ai/settings')
    const { knownModelOf, presetOf } = await import('../src/ai/providers')

    // 1. 验证 DeepSeek 官方预设中的 deepseek-flash 具有 1M 上下文和视觉多模态能力
    const dsPreset = presetOf('deepseek')!
    expect(dsPreset).toBeDefined()
    const flashModel = dsPreset.knownModels?.find((m) => m.id === 'deepseek-flash')
    expect(flashModel).toBeDefined()
    expect(flashModel?.contextWindow).toBe(1_000_000)
    expect(flashModel?.inputModalities).toContain('text')
    expect(flashModel?.inputModalities).toContain('image')

    // 2. 验证 createDefaultProvider 创建的默认配置
    const defaultProvider = createDefaultProvider('sk-test')
    expect(defaultProvider.models).toHaveLength(1)
    const defaultModel = defaultProvider.models[0]
    expect(defaultModel.id).toBe('deepseek-flash')
    expect(defaultModel.name).toBe('DeepSeek Flash')
    expect(defaultModel.contextWindow).toBe(1_000_000)
    expect(defaultModel.inputModalities).toEqual(['text', 'image'])

    // 3. 验证 knownModelOf 跨厂商与前缀查找
    const gpt4o = knownModelOf('openai', 'gpt-4o')
    expect(gpt4o?.contextWindow).toBe(128_000)
    expect(gpt4o?.inputModalities).toContain('image')

    const claude = knownModelOf('anthropic', 'claude-3-7-sonnet-20250219')
    expect(claude?.contextWindow).toBe(200_000)
    expect(claude?.inputModalities).toContain('image')

    const gemini = knownModelOf('gemini', 'gemini-2.5-pro')
    expect(gemini?.contextWindow).toBe(1_000_000)
    expect(gemini?.inputModalities).toContain('image')

    const qwen = knownModelOf('dashscope', 'qwen-plus')
    expect(qwen?.contextWindow).toBe(1_000_000)

    // 4. 验证 withKnownModelMeta 自动补全
    const rawEntry = makeModelEntry('deepseek-flash')
    expect(rawEntry.contextWindow).toBe(0)
    expect(rawEntry.inputModalities).toEqual(['text'])

    const enriched = withKnownModelMeta(defaultProvider, rawEntry)
    expect(enriched.contextWindow).toBe(1_000_000)
    expect(enriched.inputModalities).toEqual(['text', 'image'])

    // 5. 验证历史数据兼容升级：旧版本保存的 128k 单模态 deepseek-flash 自动升级为 1M 视觉多模态
    const legacySaved = {
      version: 3,
      providers: [
        {
          id: 'deepseek',
          kind: 'provider',
          label: '',
          baseUrl: '',
          apiKey: 'sk-legacy',
          models: [
            {
              id: 'deepseek-flash',
              name: 'DeepSeek Flash',
              contextWindow: 128000,
              inputModalities: ['text'],
            },
          ],
        },
      ],
      global: {
        providerId: 'deepseek',
        model: 'deepseek-flash',
        effort: 'medium',
      },
    }
    const upgraded = normalizeAiSettings(legacySaved)
    const upgradedModel = upgraded.providers[0].models[0]
    expect(upgradedModel.contextWindow).toBe(1_000_000)
    expect(upgradedModel.inputModalities).toContain('image')
  })
})
