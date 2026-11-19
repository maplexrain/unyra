import { describe, expect, it } from 'vitest'
import { createExecuteTools } from '../src/agent/sandbox/execute'
import type { SandboxOptions, SandboxRequest, SandboxReply } from '../src/agent/sandbox/types'

const CTX = { nodeId: null, goalId: 'g1' }

function makeDirectSandbox(over: Partial<SandboxOptions> = {}): SandboxOptions {
  return {
    nodeId: () => null,
    resolveNode: () => ({ ok: false, message: '没有这个节点' }),
    resolveDoc: () => ({ ok: false, message: '没有这份文档' }),
    docOps: {} as never,
    nodeOps: {} as never,
    runSandbox: async (req: SandboxRequest): Promise<SandboxReply> => {
      try {
        const fn = new Function('api', 'return ' + req.body)
        const apiObj = {
          ping: () => 'pong',
          add: (a: number, b: number) => a + b,
        }
        const runner = fn(apiObj)
        const value = typeof runner === 'function' ? await runner(apiObj) : await runner
        return { ok: true, value, ms: 1 }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
    ...over,
  } as SandboxOptions
}

describe('rexecute 工具：优化重试与局部正则替换执行', () => {
  it('createExecuteTools 同时创建 execute 与配套的 rexecute 工具', () => {
    const [executeTool, rexecuteTool] = createExecuteTools(makeDirectSandbox())
    expect(executeTool.name).toBe('execute')
    expect(rexecuteTool.name).toBe('rexecute')
    expect(executeTool.rexecute).toBe(rexecuteTool)
  })

  it('在没有前序执行记录时调用 rexecute 会优雅提示无法执行', async () => {
    const [, rexecuteTool] = createExecuteTools(makeDirectSandbox())
    const res = await rexecuteTool.run({ pattern: 'foo', replacement: 'bar' }, CTX)
    expect(res.ok).toBe(false)
    expect(res.content).toContain('没有可复用的前序代码')
  })

  it('execute 成功后，可通过 rexecute 正则替换部分代码并重新执行', async () => {
    const [executeTool, rexecuteTool] = createExecuteTools(makeDirectSandbox())

    // 1. 初次执行
    const r1 = await executeTool.run(
      {
        description: '初次计算',
        body: '((api) => { return 10 + 20 })()',
      },
      CTX,
    )
    expect(r1.ok).toBe(true)
    expect(r1.content).toContain('30')
    expect(executeTool.getLastBody?.()).toBe('((api) => { return 10 + 20 })()')

    // 2. 使用 rexecute 正则替换 20 -> 50
    const r2 = await rexecuteTool.run(
      {
        description: '改为加50',
        pattern: '20',
        replacement: '50',
      },
      CTX,
    )
    expect(r2.ok).toBe(true)
    expect(r2.content).toContain('60')
    expect(r2.content).toContain('【rexecute 替换重跑（已应用 1 处替换）】')
    expect(executeTool.getLastBody?.()).toBe('((api) => { return 10 + 50 })()')
  })

  it('支持正则高级特性与修饰符', async () => {
    const [executeTool, rexecuteTool] = createExecuteTools(makeDirectSandbox())

    await executeTool.run(
      {
        description: '带数字的代码',
        body: '((api) => { const a = 100; const b = 200; return a + b })()',
      },
      CTX,
    )

    // 正则匹配 \\d+
    const r2 = await rexecuteTool.run(
      {
        pattern: '\\d{3}',
        replacement: '1',
        flags: 'g',
      },
      CTX,
    )
    expect(r2.ok).toBe(true)
    expect(r2.content).toContain('2') // 1 + 1 = 2
    expect(executeTool.getLastBody?.()).toBe('((api) => { const a = 1; const b = 1; return a + b })()')
  })

  it('正则元字符未转义时自动回退字面量精确匹配', async () => {
    const [executeTool, rexecuteTool] = createExecuteTools(makeDirectSandbox())

    await executeTool.run(
      {
        description: '调用 api',
        body: '((api) => { return api.add(3, 4) })(api)',
      },
      CTX,
    )

    // 大模型常直接传入包含未转义括号的代码片段
    const r2 = await rexecuteTool.run(
      {
        pattern: 'api.add(3, 4)',
        replacement: 'api.add(10, 20)',
      },
      CTX,
    )
    expect(r2.ok).toBe(true)
    expect(r2.content).toContain('30')
    expect(executeTool.getLastBody?.()).toBe('((api) => { return api.add(10, 20) })(api)')
  })

  it('支持多处批量替换（replacements 数组）', async () => {
    const [executeTool, rexecuteTool] = createExecuteTools(makeDirectSandbox())

    await executeTool.run(
      {
        description: '多处变量',
        body: '((api) => { const x = "hello"; const y = "world"; return x + " " + y })()',
      },
      CTX,
    )

    const r2 = await rexecuteTool.run(
      {
        description: '批量改词',
        replacements: [
          { pattern: 'hello', replacement: 'hi' },
          { pattern: 'world', replacement: 'moji' },
        ],
      },
      CTX,
    )
    expect(r2.ok).toBe(true)
    expect(r2.content).toContain('hi moji')
  })

  it('未提供替换规则时原样重跑上次代码', async () => {
    let callCount = 0
    const [executeTool, rexecuteTool] = createExecuteTools(
      makeDirectSandbox({
        runSandbox: async () => {
          callCount++
          return { ok: true, value: callCount, ms: 1 }
        },
      }),
    )

    await executeTool.run({ description: '测试重跑', body: '((api) => { return 1 })()' }, CTX)
    expect(callCount).toBe(1)

    const r2 = await rexecuteTool.run({ description: '原样重跑' }, CTX)
    expect(r2.ok).toBe(true)
    expect(callCount).toBe(2)
    expect(r2.content).toContain('【rexecute 原样重跑】')
  })

  it('替换目标不存在时报错提示且不破坏原保留代码', async () => {
    const [executeTool, rexecuteTool] = createExecuteTools(makeDirectSandbox())

    await executeTool.run({ description: '原代码', body: '((api) => 42)()' }, CTX)

    const res = await rexecuteTool.run({ pattern: 'non_existent_token', replacement: 'foo' }, CTX)
    expect(res.ok).toBe(false)
    expect(res.content).toContain('rexecute 替换未生效')
    expect(res.content).toContain('non_existent_token')
    // 原代码仍然完好
    expect(executeTool.getLastBody?.()).toBe('((api) => 42)()')
  })

  it('链式连续纠错：直到执行成功为止（核心体验目标）', async () => {
    const [executeTool, rexecuteTool] = createExecuteTools(makeDirectSandbox())

    // 第 1 步：execute 执行一段有未定义变量错误的代码
    const r1 = await executeTool.run(
      {
        description: '初次编写有两处错误的代码',
        body: '((api) => { const a = wrongVar1; const b = wrongVar2; return a + b })()',
      },
      CTX,
    )
    expect(r1.ok).toBe(false)
    expect(r1.content).toContain('执行失败')
    expect(r1.content).toContain('rexecute')

    // 第 2 步：第 1 次 rexecute，只修好了 wrongVar1，但 wrongVar2 仍有错
    const r2 = await rexecuteTool.run(
      {
        description: '修复第一个变量',
        pattern: 'wrongVar1',
        replacement: '10',
      },
      CTX,
    )
    expect(r2.ok).toBe(false)
    expect(r2.content).toContain('wrongVar2 is not defined')
    // 关键断言：此时的 lastBody 已经成功更新为包含了 10 的代码！
    expect(executeTool.getLastBody?.()).toContain('const a = 10')
    expect(executeTool.getLastBody?.()).toContain('wrongVar2')

    // 第 3 步：第 2 次 rexecute，接着修复 wrongVar2
    const r3 = await rexecuteTool.run(
      {
        description: '修复第二个变量',
        pattern: 'wrongVar2',
        replacement: '25',
      },
      CTX,
    )
    expect(r3.ok).toBe(true)
    expect(r3.content).toContain('35') // 10 + 25 = 35
    expect(executeTool.getLastBody?.()).toBe('((api) => { const a = 10; const b = 25; return a + b })()')
  })
})
