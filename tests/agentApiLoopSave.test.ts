import { describe, expect, it } from 'vitest'
import { emptyLearnStore } from '../src/learn/store/empty'
import type { KnowledgeNode, LearnStore } from '../src/learn/types'
import { NodeService } from '../src/learn/nodeKinds/service'
import { buildApi } from '../src/agent/sandbox/api'
import type { SandboxOptions } from '../src/agent/sandbox/types'

/*
 * 省 loop 三件套（2026-10-25，agent 实测反馈）：node.brief（一页纸简报）、
 * node.finish（收尾一次做完）、web.fetch 批量 + maxChars、memory.context（一页纸）。
 */

function node(id: string, title: string, key: string, teaching: string, outline?: KnowledgeNode['outline']): KnowledgeNode {
  return {
    id,
    title,
    key,
    description: '',
    docs: { teaching },
    notes: [],
    annotations: [],
    status: 'learning',
    origin: 'user',
    goalId: 'g1',
    createdAt: 1,
    updatedAt: 1,
    ...(outline ? { outline } : {}),
  }
}

function store(): LearnStore {
  const base = emptyLearnStore()
  return {
    ...base,
    goals: [{ id: 'g1', rootNodeId: 'r', question: '学汇编', createdAt: 1, updatedAt: 1 }],
    nodes: [
      node('r', '汇编入门', 'huibian', '# 汇编入门\n\n## 环境与最小程序\n### 寄存器别名\n## mov 的用法', {
        intro: '',
        children: [
          { key: 'huanjing', title: '环境与最小程序', summary: '装环境、跑最小程序' },
          { key: 'xitong', title: '系统调用', summary: 'syscall 与 ABI' },
        ],
        updatedAt: 1,
      }),
      node('a', '系统调用', 'xitong', '# 系统调用\n\n## syscall 三条规矩\n## ABI 约定', {
        intro: '',
        children: [],
        updatedAt: 1,
      }),
    ],
    edges: [{ from: 'r', to: 'a', createdAt: 1, portKey: 'xitong' }],
  }
}

function serviceOf(store: LearnStore): { svc: NodeService; read: () => LearnStore } {
  let cur = store
  const svc = new NodeService({
    getLatest: () => cur,
    set: (next) => {
      cur = next
    },
    goalId: () => 'g1',
  })
  return { svc, read: () => cur }
}

function apiOf(svc: NodeService | null, extra: Partial<SandboxOptions> = {}) {
  const opts: SandboxOptions = {
    nodeId: () => 'a',
    resolveNode: ((path: string) => ({ ok: true as const, ref: { id: path || 'a' } })) as SandboxOptions['resolveNode'],
    resolveDoc: ((path: string) => ({ ok: true as const, ref: { id: path || 'a', kind: 'teaching' as const } })) as SandboxOptions['resolveDoc'],
    docOps: {
      read: () => '',
      write: () => ({ ok: true, content: '' }),
    },
    ...(svc ? { nodes: { service: () => svc } } : {}),
    ...extra,
  }
  return buildApi(opts, []).api
}

describe('node.brief：一页纸简报（取材先问它，别默认全图）', () => {
  it('self / port（认领的目标项）/ siblings / taught（全图已讲小节）一次给齐', () => {
    const { svc } = serviceOf(store())
    const api = apiOf(svc) as { node: { brief: (u: string) => unknown } }
    const r = api.node.brief('a') as {
      ok: boolean
      self: { title: string; teachingChars: number }
      port: { key: string; title: string }
      siblings: Array<{ title: string }>
      taught: Array<{ title: string; headings: string[] }>
    }
    expect(r.ok).toBe(true)
    expect(r.self.title).toBe('系统调用')
    expect(r.port).toMatchObject({ key: 'xitong', title: '系统调用' })
    expect(r.siblings.map((s) => s.title)).toEqual(['环境与最小程序'])
    expect(r.taught).toEqual([{ title: '汇编入门', headings: ['环境与最小程序', '寄存器别名', 'mov 的用法'] }])
  })

  it('没认领目标项时 port 为 null；非文档节点拒收', () => {
    const s = store()
    const { svc } = serviceOf(s)
    const api = apiOf(svc) as { node: { brief: (u: string) => unknown } }
    const root = api.node.brief('r') as { port: unknown }
    expect(root.port).toBeNull()
    const notDoc = api.node.brief('o:r') as { error: string }
    expect(notDoc.error).toContain('只讲文档节点')
  })
})

describe('node.finish：收尾五件事一个调用', () => {
  it('content 先落；memory / delivery 逐个落并如实报告；open 没有 ui.point 就跳过', async () => {
    const { svc, read } = serviceOf(store())
    const seen: string[] = []
    const api = apiOf(svc, {
      memory: {
        list: () => ({ ok: true }),
        get: () => ({ error: 'nope' }),
        create: (p) => {
          seen.push('memory:' + String(p.title))
          return { ok: true, uuid: 'm1' }
        },
        update: () => ({ ok: true }),
        remove: () => ({ ok: true }),
      },
      delivery: {
        submit: (p) => {
          seen.push('delivery:' + String((p as { files?: unknown[] }).files?.length))
          return { ok: true }
        },
      },
    }) as { node: { finish: (u: string, plan: unknown) => Promise<unknown> } }

    const r = (await api.node.finish('a', {
      content: { title: '系统调用', description: '', teaching: '# 系统调用\n\n## 重写', status: 'learning' },
      memory: { type: 'work', title: '本轮进度', content: '讲完 syscall' },
      delivery: { files: [{ path: 'docs/x' }], sources: [] },
      open: true,
    })) as { ok: boolean; steps: Record<string, unknown> }

    expect(r.ok).toBe(true)
    expect(r.steps.content).toBe('written')
    expect(r.steps.memory).toBe('written')
    expect(r.steps.delivery).toBe('written')
    expect(String(r.steps.open)).toContain('skipped')
    expect(seen).toEqual(['memory:本轮进度', 'delivery:1'])
    // 正文真的写进去了
    expect(read().nodes.find((n) => n.id === 'a')!.docs.teaching).toContain('## 重写')
  })

  it('content 失败就直接回，后面全不做（不出现「文档没写、账都记了」的倒挂）', async () => {
    const { svc } = serviceOf(store())
    const seen: string[] = []
    const api = apiOf(svc, {
    }) as { node: { finish: (u: string, plan: unknown) => Promise<unknown> } }
    const r = (await api.node.finish('a', { content: { title: '' , teaching: '' }, })) as { error: string }
    expect(r.error).toContain('content')
    expect(seen).toEqual([])
  })
})

describe('web.fetch 批量 + maxChars', () => {
  it('数组 = 并发逐条返回，失败只标记它自己；maxChars 直接截好', async () => {
    const api = apiOf(null, {
      web: {
        fetch: async (arg: unknown) => {
          const url = String((arg as { url?: string }).url ?? '')
          if (url.includes('bad')) throw new Error('timeout')
          return { ok: true, title: url, content: 'x'.repeat(100) }
        },
      },
    }) as { fetch: (a: unknown, b?: unknown) => Promise<unknown> }
    const r = (await api.fetch(['https://a', 'https://bad', { url: 'https://b' }], { maxChars: 20 })) as {
      ok: boolean
      results: Array<{ ok: boolean; title: string; content: string; error?: string }>
    }
    expect(r.ok).toBe(true)
    expect(r.results).toHaveLength(3)
    expect(r.results[0].content.startsWith('x'.repeat(20))).toBe(true)
    expect(r.results[0].content).toContain('maxChars')
    expect(r.results[1].ok).toBe(false)
    expect(r.results[1].error).toContain('timeout')
    expect(r.results[2].title).toBe('https://b')
  })

  it('单篇也吃 maxChars；超过 5 篇拒收', async () => {
    const api = apiOf(null, {
      web: { fetch: async () => ({ ok: true, title: 't', content: 'y'.repeat(50) }) },
    }) as { fetch: (a: unknown, b?: unknown) => Promise<unknown> }
    const one = (await api.fetch('https://a', { maxChars: 10 })) as { content: string }
    expect(one.content).toContain('maxChars')
    const tooMany = (await api.fetch(['1', '2', '3', '4', '5', '6'])) as { ok: boolean; error: string }
    expect(tooMany.ok).toBe(false)
    expect(tooMany.error).toContain('最多')
  })
})

describe('memory.context：一页纸', () => {
  it('取最近 3 条拼一页并截到 maxChars', async () => {
    const api = apiOf(null, {
      memory: {
        list: () => ({
          ok: true,
          items: [
            { uuid: 'm1' }, { uuid: 'm2' }, { uuid: 'm3' }, { uuid: 'm4' },
          ],
        }),
        get: (uuid: string) => ({ title: '条目' + uuid, content: '内容'.repeat(20) + uuid }),
        create: () => ({ ok: true }),
        update: () => ({ ok: true }),
        remove: () => ({ ok: true }),
      },
    }) as { memory: { context: (q: unknown) => Promise<unknown> } }
    const r = (await api.memory.context({ scope: 'work', maxChars: 300 })) as {
      ok: boolean
      scope: string
      count: number
      text: string
    }
    expect(r.ok).toBe(true)
    expect(r.scope).toBe('work')
    expect(r.count).toBe(3) // 只取前 3 条，第 4 条不进来
    expect(r.text).toContain('条目m1')
    expect(r.text.length).toBeLessThanOrEqual(320)
  })
})
