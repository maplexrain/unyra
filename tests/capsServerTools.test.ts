/**
 * 服务端工具注入（ai/client 的 bodyFor）：DeepSeek 的两个服务端工具
 * （deepseek_web_search / deepseek_read_url）只在 work 层显式开启时注入；
 * 可以与本地 execute 沙箱共存，回传由 runtime 的 server_tool_calls 处理。
 * 非 OpenAI 协议、非 flash 模型、未声明支持时一律不注入。
 */

import { describe, expect, it } from 'vitest'
import { bodyFor, type ResolvedProvider } from '../src/ai/client'

function provider(patch: Partial<ResolvedProvider> = {}): ResolvedProvider {
  return {
    id: 'deepseek',
    label: 'DeepSeek 官方',
    baseUrl: 'https://api.deepseek.com',
    apiKey: 'sk-test',
    protocol: 'openai',
    ...patch,
  }
}

const msg = { role: 'user' as const, content: '你好' }

function toolTypes(body: Record<string, unknown>): string[] {
  const tools = body.tools as Array<{ type?: string; function?: { name?: string } }> | undefined
  return (tools ?? []).map((t) => t.type ?? t.function?.name ?? '')
}

describe('bodyFor 的服务端工具注入', () => {
  it('两个开关全开：声明两种服务端工具，tool_choice 保持 auto', () => {
    const body = bodyFor(provider({ serverTools: { webSearch: true, readUrl: true } }), {
      model: 'deepseek-flash',
      messages: [msg],
      stream: true,
      enableServerTools: true,
    })
    const types = toolTypes(body)
    expect(types).toContain('deepseek_web_search')
    expect(types).toContain('deepseek_read_url')
    expect(body.tool_choice).toBe('auto')
  })

  it('只开一个：只声明那一个', () => {
    const body = bodyFor(provider({ serverTools: { webSearch: true, readUrl: false } }), {
      model: 'deepseek-flash',
      messages: [msg],
      stream: true,
      enableServerTools: true,
    })
    const types = toolTypes(body)
    expect(types).toContain('deepseek_web_search')
    expect(types).not.toContain('deepseek_read_url')
  })

  it('未设置 serverTools：不发 tools 字段（没有本地工具时）', () => {
    const body = bodyFor(provider(), { model: 'deepseek-chat', messages: [msg], stream: true })
    expect(body.tools).toBeUndefined()
    expect(body.tool_choice).toBeUndefined()
  })

  it('work 层显式开启：本地 execute 与服务端工具共存，tool_choice 仍为 auto', () => {
    const execute = { type: 'function', function: { name: 'execute', parameters: {} } }
    const body = bodyFor(provider({ serverTools: { webSearch: true, readUrl: true } }), {
      model: 'deepseek-flash',
      messages: [msg],
      stream: true,
      tools: [execute as never],
      enableServerTools: true,
    })
    const types = toolTypes(body)
    expect(types).toEqual(['function', 'deepseek_web_search', 'deepseek_read_url'])
    expect(body.tool_choice).toBe('auto')
  })

  it('role / 自由对话没有 enableServerTools：工具轮只发本地工具', () => {
    const execute = { type: 'function', function: { name: 'execute', parameters: {} } }
    const body = bodyFor(provider({ serverTools: { webSearch: true, readUrl: true } }), {
      model: 'deepseek-flash',
      messages: [msg],
      stream: true,
      tools: [execute as never],
    })
    expect(toolTypes(body)).toEqual(['function'])
  })

  it('纯聊天没有 enableServerTools：也不注入服务端工具（联网只归 work）', () => {
    const body = bodyFor(provider({ serverTools: { webSearch: true, readUrl: true } }), {
      model: 'deepseek-flash',
      messages: [msg],
      stream: true,
    })
    expect(toolTypes(body)).toEqual([])
    expect(body.tools).toBeUndefined()
  })

  it('非 flash 模型即使开启也不声明：服务端工具只支持 deepseek-flash', () => {
    const body = bodyFor(provider({ serverTools: { webSearch: true, readUrl: true } }), {
      model: 'deepseek-chat',
      messages: [msg],
      stream: true,
      enableServerTools: true,
    })
    expect(body.tools).toBeUndefined()
  })

  it('json 模式不注入服务端工具：DeepSeek 只允许 text 与这些工具同时出现', () => {
    const body = bodyFor(provider({ serverTools: { webSearch: true, readUrl: true } }), {
      model: 'deepseek-flash',
      messages: [msg],
      stream: false,
      json: true,
      enableServerTools: true,
    })
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.tools).toBeUndefined()
    expect(body.tool_choice).toBeUndefined()
  })

  it('非 OpenAI 协议不声明（Anthropic 的服务端工具格式不同，尚未接）', () => {
    const body = bodyFor(provider({ protocol: 'anthropic', serverTools: { webSearch: true, readUrl: true } }), {
      model: 'deepseek-flash',
      messages: [msg],
      stream: true,
      enableServerTools: true,
    })
    expect(toolTypes(body)).not.toContain('deepseek_web_search')
  })
})
