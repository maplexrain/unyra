/**
 * 工具卡片的两种失败：**调用级**与**代码级**。
 *
 * 钉住的行为（用户定的）：
 * - 代码跑通了、只是其中某几次 api 调用没有生效 → 工具结果 ok:false 但 soft:true，
 *   气泡状态是「完成」，界面上点一枚黄；
 * - 这段代码根本跑不起来（语法错 / 运行时抛错 / 超时）→ 没有 soft，状态是「失败」，红色。
 *
 * 三处都要认这条分界：execute 产出它、applyEvent 记进 parts、落盘归一化不能把它丢掉
 * （丢了重启之后那一步会从黄变回红）。
 */
import { describe, expect, it } from 'vitest'
import { createExecuteTool } from '../src/agent/sandbox/execute'
import type { SandboxOptions, SandboxRequest, SandboxReply } from '../src/agent/sandbox/types'
import type { AgentPart } from '../src/agent/types'
import { applyEvent } from '../src/learn/agent/events'
import { normalizeConversation } from '../src/learn/store/normalize/conversation'

const CTX = { nodeId: null, goalId: 'g1' }

/** 最小沙箱：runSandbox 只做一件事——调一次 web.search，把它的返回值当结果交回去 */
function makeSandbox(over: Partial<SandboxOptions> = {}): SandboxOptions {
  return {
    nodeId: () => null,
    resolveNode: () => ({ ok: false, message: '没有这个节点' }),
    resolveDoc: () => ({ ok: false, message: '没有这份文档' }),
    docOps: {} as never,
    nodeOps: {} as never,
    web: {
      fetch: async () => {
        throw new Error('不该在测试里抓网页')
      },
      search: async () => ({ ok: true, results: [] }),
    },
    runSandbox: async (req: SandboxRequest): Promise<SandboxReply> => {
      const value = await req.callApi('web.search', ['勾股定理'])
      return { ok: true, value, ms: 1 }
    },
    ...over,
  } as SandboxOptions
}

describe('execute：调用级失败与代码级失败是两件事', () => {
  it('api 调用没有生效：ok 仍是 false（模型据此判断），但带上 soft', async () => {
    const tool = createExecuteTool(
      makeSandbox({
        web: {
          fetch: async () => {
            throw new Error('不该在测试里抓网页')
          },
          // 结构性失败：api 不抛异常，回一个 { ok:false, error }（见 agent/sandbox/api 的 wrapApi）
          search: async () => ({ ok: false, error: '搜索引擎没返回结果' }),
        },
      }),
    )
    const r = await tool.run({ description: '搜一下', body: '((api)=>{ return await api.web.search("勾股定理") })' }, CTX)
    expect(r.ok).toBe(false)
    expect(r.soft).toBe(true)
    // 清单照旧顶在结果最前面：模型要靠它知道哪一步没做成
    expect(r.content).toContain('没有生效')
  })

  it('全部调用都成功：soft 是假（界面上什么都不点）', async () => {
    const tool = createExecuteTool(makeSandbox())
    const r = await tool.run({ description: '搜一下', body: '((api)=>{ return await api.web.search("勾股定理") })' }, CTX)
    expect(r.ok).toBe(true)
    expect(r.soft).toBeFalsy()
  })

  it('语法错：没有 soft，这是代码级失败', async () => {
    const tool = createExecuteTool(makeSandbox())
    const r = await tool.run({ description: '写坏了', body: '((api)=>{ return 1 + })' }, CTX)
    expect(r.ok).toBe(false)
    expect(r.soft).toBeFalsy()
    expect(r.content).toContain('body 不能用')
  })

  it('运行时抛错（沙箱回 ok:false）：同样没有 soft', async () => {
    const tool = createExecuteTool(
      makeSandbox({
        runSandbox: async () => ({ ok: false, error: 'TypeError: x is not a function' }),
      }),
    )
    const r = await tool.run({ description: '跑飞了', body: '((api)=>{ return api.nope() })' }, CTX)
    expect(r.ok).toBe(false)
    expect(r.soft).toBeFalsy()
  })
})

describe('applyEvent：soft 决定气泡状态', () => {
  const partOf = (event: Parameters<typeof applyEvent>[1]): AgentPart => {
    const parts: AgentPart[] = []
    applyEvent(parts, { type: 'tool-call', id: 'a', name: 'execute', args: '{}' })
    applyEvent(parts, event)
    return parts[0]
  }

  it('调用级失败：状态是完成，不是失败', () => {
    expect(
      partOf({ type: 'tool-result', id: 'a', name: 'execute', result: 'x', ok: false, soft: true }),
    ).toMatchObject({ status: 'done', ok: false, soft: true })
  })

  it('代码级失败：状态是失败', () => {
    expect(partOf({ type: 'tool-result', id: 'a', name: 'execute', result: 'x', ok: false })).toMatchObject({
      status: 'error',
      ok: false,
    })
  })

  it('成功：状态是完成，且没有 soft', () => {
    const part = partOf({ type: 'tool-result', id: 'a', name: 'execute', result: 'x', ok: true })
    expect(part).toMatchObject({ status: 'done', ok: true })
    expect(part.type === 'tool' && part.soft).toBeFalsy()
  })
})

describe('落盘归一化：soft 不能丢', () => {
  it('重新载入之后那一步仍然是黄的', () => {
    const conv = normalizeConversation(
      {
        goalId: 'g1',
        messages: [
          {
            role: 'assistant',
            parts: [
              { type: 'tool', id: 't1', name: 'execute', args: '{}', result: 'x', ok: false, soft: true, status: 'done' },
            ],
          },
        ],
      },
      new Set(['g1']),
      () => 'g1',
    )
    expect(conv?.messages[0].parts[0]).toMatchObject({ type: 'tool', ok: false, soft: true, status: 'done' })
  })
})
