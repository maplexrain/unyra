import { describe, expect, it } from 'vitest'
import type { AgentPart } from '../src/agent/types'
import {
  SERVER_WEB_PREFLIGHT_SYSTEM,
  taskNeedsServerWeb,
  webPreflightContext,
} from '../src/agent/work/webPreflight'

function webPart(sources: Array<{ title: string; url: string }>): AgentPart {
  return {
    type: 'web',
    id: 'w1',
    step: 0,
    call: {
      id: 'c1',
      type: 'deepseek_web_search',
      kind: 'search',
      action: { type: 'search', queries: ['q'] },
      status: 'completed',
      sources,
    },
  }
}

describe('work 服务端联网前置检索', () => {
  it('只对明确的联网/事实任务触发，尊重“不用联网”', () => {
    expect(taskNeedsServerWeb('帮我联网搜索今天的股价')).toBe(true)
    expect(taskNeedsServerWeb('查一下最新版的官方文档')).toBe(true)
    expect(taskNeedsServerWeb('写一篇关于牛顿定律的讲义')).toBe(false)
    expect(taskNeedsServerWeb('不用联网，凭记忆解释一下')).toBe(false)
    expect(taskNeedsServerWeb('不要搜索，直接写')).toBe(false)
  })

  it('前置检索提示词要求真的调用服务端工具，不做最终交付', () => {
    expect(SERVER_WEB_PREFLIGHT_SYSTEM).toContain('deepseek_web_search')
    expect(SERVER_WEB_PREFLIGHT_SYSTEM).toContain('deepseek_read_url')
    expect(SERVER_WEB_PREFLIGHT_SYSTEM).toContain('必须真的调用联网工具')
    expect(SERVER_WEB_PREFLIGHT_SYSTEM).toContain('不要写文件')
  })

  it('把来源去重后带进主 work 上下文；没有来源就不注入', () => {
    const block = webPreflightContext(
      [webPart([{ title: '官方公告', url: 'https://example.com/a' }, { title: '重复', url: 'https://example.com/a' }])],
      '事实摘要',
    )
    expect(block).toContain('<web_preflight>')
    expect(block).toContain('官方公告 — https://example.com/a')
    expect(block).toContain('事实摘要')
    expect(block).not.toContain('重复 —')
    expect(webPreflightContext([webPart([])], '空')).toBe('')
  })
})
