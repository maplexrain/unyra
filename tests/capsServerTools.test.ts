/**
 * 服务端工具注入（ai/client 的 bodyFor）：DeepSeek 的两个服务端工具
 * （deepseek_web_search / deepseek_read_url）要合进 chat/completions 的 tools 数组，
 * 与本地执行的 execute 沙箱工具共存；非 OpenAI 协议、未声明支持时一律不注入。
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

  it('与本地 execute 工具互斥：工具轮只发本地工具（服务端搜索块未实现回传，共存必 400）', () => {
    const execute = { type: 'function', function: { name: 'execute', parameters: {} } }
    const body = bodyFor(provider({ serverTools: { webSearch: true, readUrl: true } }), {
      model: 'deepseek-flash',
      messages: [msg],
      stream: true,
      tools: [execute as never],
    })
    const types = toolTypes(body)
    // 本地工具优先：服务端声明不出场，agent 的联网需求由沙箱 web.search 覆盖
    expect(types).toEqual(['function'])
    expect(types).not.toContain('deepseek_web_search')
  })

  it('纯聊天（无本地工具）：server tools 单独注入', () => {
    const body = bodyFor(provider({ serverTools: { webSearch: true, readUrl: true } }), {
      model: 'deepseek-flash',
      messages: [msg],
      stream: true,
    })
    expect(toolTypes(body)).toEqual(['deepseek_web_search', 'deepseek_read_url'])
  })

  it('非 OpenAI 协议不声明（Anthropic 的服务端工具格式不同，尚未接）', () => {
    const body = bodyFor(provider({ protocol: 'anthropic', serverTools: { webSearch: true, readUrl: true } }), {
      model: 'deepseek-flash',
      messages: [msg],
      stream: true,
    })
    expect(toolTypes(body)).not.toContain('deepseek_web_search')
  })
})
